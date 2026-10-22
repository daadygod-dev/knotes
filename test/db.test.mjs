import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createStore } from "../src/db.mjs";

function seededStore() {
  return createStore({ path: ":memory:", seed: true });
}

test("seed data is searchable, ranked, and filterable", () => {
  const store = seededStore();
  try {
    assert.equal(store.count(), 14);
    const stats = store.bootstrap().stats;
    assert.deepEqual(stats, { total: 14, locked: 1, attachments: 6, pinned: 2 });

    const receipt = store.search({ q: "receipt" });
    assert.equal(receipt.count, 1);
    assert.equal(receipt.results[0].title, "Scanned receipt — Corner Market");
    assert.equal(receipt.results[0].snippetKind, "attachment");
    assert.ok(receipt.results[0].matchedFields.includes("attachment"));

    const prefix = store.search({ q: "kuber" });
    assert.equal(prefix.count, 1);
    assert.equal(prefix.results[0].title, "Kubernetes deployment checklist");

    const ranked = store.search({ q: "search" });
    assert.ok(ranked.count >= 2);
    assert.equal(ranked.results[0].title, "Search design notes");
    assert.ok(ranked.results.every((row) => row.title !== "Passwords and account recovery"));

    assert.equal(store.search({ q: "search", folder: "Work" }).count, 4);
    assert.equal(store.search({ q: "search", tag: "product" }).count, 1);
    assert.equal(store.search({ q: "search", hasAttachments: true }).count, 2);
    assert.equal(store.search({ q: "search", pinned: true }).count, 2);
    assert.equal(store.search({ q: "search", locked: true }).count, 0);
  } finally {
    store.close();
  }
});

test("phrases, diacritics, and FTS synchronization work", () => {
  const store = createStore({ path: ":memory:" });
  try {
    const note = store.create({
      title: "Café plan",
      body: "We will mix flour and water, then rest the dough.",
      tags: ["baking"],
    });

    assert.equal(store.search({ q: "cafe" }).count, 1);
    assert.equal(store.search({ q: '"mix flour"' }).count, 1);
    assert.equal(store.search({ q: '"flour mix"' }).count, 0);
    assert.equal(store.search({ q: "rest" }).count, 1);

    const updated = store.update(note.id, { body: "Only sugar and butter remain." });
    assert.equal(updated.body, "Only sugar and butter remain.");
    assert.equal(store.search({ q: "flour" }).count, 0);
    assert.equal(store.search({ q: "sugar" }).count, 1);

    assert.equal(store.delete(note.id), true);
    assert.equal(store.search({ q: "sugar" }).count, 0);
  } finally {
    store.close();
  }
});

test("locked notes expose only metadata until unlocked or unlocked permanently", () => {
  const store = seededStore();
  try {
    const locked = store.list({ locked: true }).notes[0];
    assert.equal(locked.title, "Passwords and account recovery");
    assert.equal(locked.locked, true);
    assert.equal(locked.attachmentCount, 0);

    assert.equal(store.search({ q: "recovery" }).count, 1);
    assert.equal(store.search({ q: "private" }).count, 0);
    assert.equal(store.search({ q: "do-not-index-this" }).count, 0);
    assert.equal(store.search({ q: "also-secret" }).count, 0);

    assert.throws(
      () => store.unlock(locked.id, "wrong"),
      (error) => error.status === 401 && error.code === "bad_passphrase",
    );

    const unlocked = store.unlock(locked.id, "demo");
    assert.match(unlocked.body, /do-not-index-this/);
    assert.equal(store.search({ q: "do-not-index-this" }).count, 0);

    const opened = store.update(locked.id, { removeLock: true, passphrase: "demo" });
    assert.equal(opened.locked, false);
    assert.match(opened.body, /do-not-index-this/);
    assert.equal(store.search({ q: "do-not-index-this" }).count, 1);
    assert.equal(store.search({ q: "private" }).count, 1);
  } finally {
    store.close();
  }
});

test("locking and metadata edits preserve attachment counts and content", () => {
  const store = createStore({ path: ":memory:" });
  try {
    const note = store.create({
      title: "Field notes",
      body: "Visible body",
      attachments: [
        { filename: "scan.txt", kind: "text", text: "Scan text with needle" },
        { filename: "map.png", kind: "image", text: "Map text" },
      ],
    });
    assert.equal(note.attachmentCount, 2);

    const renamed = store.update(note.id, { title: "Renamed field notes" });
    assert.equal(renamed.attachmentCount, 2);
    assert.equal(renamed.attachments.length, 2);

    const locked = store.update(note.id, { lockPassphrase: "abcd" });
    assert.equal(locked.locked, true);
    assert.equal(locked.attachmentCount, 2);

    const metadataEdit = store.update(note.id, { title: "Locked and renamed" });
    assert.equal(metadataEdit.attachmentCount, 2);
    assert.equal(store.search({ q: "needle" }).count, 0);
    assert.equal(store.search({ q: "locked" }).count, 1);

    const unlocked = store.unlock(note.id, "abcd");
    assert.equal(unlocked.attachments.length, 2);
    assert.match(unlocked.attachments[0].text, /needle/);

    const edited = store.update(note.id, {
      body: "Updated secret body",
      passphrase: "abcd",
    });
    assert.equal(edited.locked, true);
    assert.equal(edited.attachmentCount, 2);
    assert.equal(store.unlock(note.id, "abcd").body, "Updated secret body");

    const opened = store.update(note.id, { removeLock: true, passphrase: "abcd" });
    assert.equal(opened.locked, false);
    assert.equal(opened.attachmentCount, 2);
    assert.equal(store.search({ q: "needle" }).count, 1);
  } finally {
    store.close();
  }
});

test("attachment files round-trip, index their text, and can be removed", () => {
  const store = createStore({ path: ":memory:" });
  try {
    const note = store.create({ title: "Files", body: "Body" });
    const bytes = Buffer.from("Attachment needle text", "utf8");
    const added = store.addAttachment(note.id, {
      filename: "evidence.txt",
      mime: "text/plain",
      data: bytes.toString("base64"),
    });

    assert.equal(added.note.attachmentCount, 1);
    assert.equal(added.attachment.size, bytes.length);
    assert.equal(added.attachment.mime, "text/plain");
    assert.equal(added.note.attachments[0].data, bytes.toString("base64"));
    assert.equal(store.search({ q: "needle" }).count, 1);

    const removed = store.removeAttachment(note.id, 0);
    assert.equal(removed.note.attachmentCount, 0);
    assert.equal(store.search({ q: "needle" }).count, 0);
    assert.throws(
      () => store.removeAttachment(note.id, 0),
      (error) => error.code === "attachment_not_found",
    );
  } finally {
    store.close();
  }
});

test("locked notes encrypt uploaded attachments and require the passphrase", () => {
  const store = createStore({ path: ":memory:" });
  try {
    const note = store.create({ title: "Private files", body: "Body" });
    store.update(note.id, { lockPassphrase: "abcd" });
    const bytes = Buffer.from("locked attachment needle", "utf8");

    assert.throws(
      () => store.addAttachment(note.id, {
        filename: "secret.txt",
        mime: "text/plain",
        data: bytes.toString("base64"),
      }),
      (error) => error.code === "locked",
    );

    const added = store.addAttachment(note.id, {
      filename: "secret.txt",
      mime: "text/plain",
      data: bytes.toString("base64"),
      passphrase: "abcd",
    });
    assert.equal(added.note.locked, true);
    assert.equal(added.note.attachmentCount, 1);
    assert.equal(added.note.attachments, null);
    assert.equal(store.search({ q: "locked attachment" }).count, 0);

    const opened = store.unlock(note.id, "abcd");
    assert.equal(opened.attachments.length, 1);
    assert.equal(opened.attachments[0].data, bytes.toString("base64"));
    assert.match(opened.attachments[0].text, /needle/);

    const removed = store.removeAttachment(note.id, 0, "abcd");
    assert.equal(removed.note.locked, true);
    assert.equal(removed.note.attachmentCount, 0);
    assert.deepEqual(store.unlock(note.id, "abcd").attachments, []);
  } finally {
    store.close();
  }
});

test("library export includes unlocked content and encrypted locked payloads", () => {
  const store = seededStore();
  try {
    const backup = store.exportAll();
    assert.equal(backup.app, "knotes");
    assert.equal(backup.notes.length, 14);
    assert.ok(backup.exportedAt);

    const locked = backup.notes.find((note) => note.locked);
    assert.ok(locked);
    assert.equal(locked.body, null);
    assert.match(locked.encryptedPayload, /"v":1/);
  } finally {
    store.close();
  }
});

test("list filters and pagination counts are consistent", () => {
  const store = seededStore();
  try {
    const work = store.list({ folder: "Work" });
    assert.equal(work.count, 6);
    assert.ok(work.notes.every((note) => note.folder === "Work"));

    const attachments = store.list({ hasAttachments: true });
    assert.equal(attachments.count, 6);
    assert.ok(attachments.notes.every((note) => note.attachmentCount > 0));

    const pinned = store.list({ pinned: true });
    assert.equal(pinned.count, 2);
    assert.ok(pinned.notes.every((note) => note.pinned));

    const limited = store.list({ limit: 3 });
    assert.equal(limited.notes.length, 3);
    assert.equal(limited.count, 14);
  } finally {
    store.close();
  }
});

test("structured blocks round-trip, sanitize, and index their plaintext", () => {
  const store = createStore({ path: ":memory:" });
  try {
    const note = store.create({
      title: "Block round trip",
      blocks: [
        { id: "intro", type: "paragraph", content: "Plan <strong>bold</strong>" },
        {
          id: "intro",
          type: "todo",
          content: "Buy <em>milk</em>",
          properties: { checked: true },
        },
        {
          id: "bad id!",
          type: "not-a-type",
          content: "<script>alert(1)</script><img src=x onerror=alert(2)>Safe &amp; sound",
        },
        {
          id: "lines",
          type: "callout",
          content: "<div>Line one</div><div>Line two</div>",
        },
      ],
    });

    assert.equal(note.blocks.length, 4);
    assert.equal(note.blocks[0].type, "paragraph");
    assert.match(note.blocks[0].content, /<strong>bold<\/strong>/);
    assert.notEqual(note.blocks[1].id, "intro");
    assert.equal(note.blocks[1].properties.checked, true);
    assert.equal(note.blocks[2].type, "paragraph");
    assert.doesNotMatch(note.blocks[2].content, /script|img|onerror|alert/i);
    assert.match(note.blocks[2].content, /Safe &amp; sound/);
    assert.equal(note.blocks[3].type, "callout");
    assert.equal(
      note.body,
      "Plan bold\nBuy milk\nSafe & sound\nLine one\nLine two\n",
    );

    assert.equal(store.search({ q: "milk" }).count, 1);
    assert.equal(store.search({ q: "sound" }).count, 1);
    assert.equal(store.search({ q: "alert" }).count, 0);

    const updated = store.update(note.id, {
      blocks: [
        { id: "next", type: "bullet-list", content: "Fresh <u>quokka</u>" },
        { id: "done", type: "todo", content: "Later" },
      ],
    });
    assert.equal(updated.body, "Fresh quokka\nLater");
    assert.deepEqual(updated.blocks.map((block) => block.type), ["bullet-list", "todo"]);
    assert.equal(store.search({ q: "milk" }).count, 0);
    assert.equal(store.search({ q: "quokka" }).count, 1);
  } finally {
    store.close();
  }
});

test("todo due dates and priorities stay canonical", () => {
  const store = createStore({ path: ":memory:" });
  try {
    const note = store.create({
      title: "Todo metadata",
      blocks: [
        {
          id: "one",
          type: "todo",
          content: "Ship release",
          properties: {
            checked: false,
            dueDate: "2026-10-24",
            priority: "HIGH",
          },
        },
        {
          id: "two",
          type: "todo",
          content: "Invalid values",
          properties: {
            checked: true,
            dueDate: "2026-02-30",
            priority: "urgent",
          },
        },
        {
          id: "three",
          type: "paragraph",
          content: "Not a todo",
          properties: { dueDate: "2026-10-24", priority: "high" },
        },
      ],
    });

    assert.equal(note.blocks[0].properties.checked, false);
    assert.equal(note.blocks[0].properties.dueDate, "2026-10-24");
    assert.equal(note.blocks[0].properties.priority, "high");
    assert.equal(note.blocks[1].properties.checked, true);
    assert.ok(!("dueDate" in note.blocks[1].properties));
    assert.ok(!("priority" in note.blocks[1].properties));
    assert.ok(!("dueDate" in note.blocks[2].properties));
    assert.ok(!("priority" in note.blocks[2].properties));

    const updated = store.update(note.id, {
      blocks: [
        {
          type: "todo",
          content: "Rescheduled",
          properties: {
            checked: false,
            dueDate: "2026-11-01",
            priority: "low",
          },
        },
      ],
    });
    assert.equal(updated.blocks[0].properties.dueDate, "2026-11-01");
    assert.equal(updated.blocks[0].properties.priority, "low");
    assert.equal(updated.body, "Rescheduled");
    assert.equal(store.search({ q: "Rescheduled" }).count, 1);
  } finally {
    store.close();
  }
});

test("locked notes encrypt and restore structured blocks", () => {
  const store = createStore({ path: ":memory:" });
  try {
    const note = store.create({
      title: "Locked blocks",
      blocks: [{ id: "secret", type: "paragraph", content: "classified zebra" }],
      lockPassphrase: "abcd",
    });

    assert.equal(note.locked, true);
    assert.equal(note.body, null);
    assert.equal(note.blocks, null);
    assert.equal(store.search({ q: "classified" }).count, 0);

    const opened = store.unlock(note.id, "abcd");
    assert.equal(opened.body, "classified zebra");
    assert.deepEqual(opened.blocks.map((block) => block.type), ["paragraph"]);

    const edited = store.update(note.id, {
      blocks: [{ id: "changed", type: "heading-2", content: "changed yak" }],
      passphrase: "abcd",
    });
    assert.equal(edited.locked, true);
    assert.equal(edited.blocks, null);
    assert.equal(store.unlock(note.id, "abcd").body, "changed yak");

    const reopened = store.update(note.id, { removeLock: true, passphrase: "abcd" });
    assert.equal(reopened.locked, false);
    assert.equal(reopened.body, "changed yak");
    assert.deepEqual(reopened.blocks.map((block) => block.type), ["heading-2"]);
    assert.equal(store.search({ q: "yak" }).count, 1);
  } finally {
    store.close();
  }
});

test("legacy bodies migrate into blocks and missing columns are upgraded", () => {
  const directory = mkdtempSync(join(tmpdir(), "notes-blocks-"));
  const databasePath = join(directory, "legacy.db");
  let store = null;

  try {
    store = createStore({ path: databasePath });
    const note = store.create({
      title: "Legacy body",
      body: "First line\nSecond line",
    });
    store.close();
    store = null;

    const raw = new DatabaseSync(databasePath);
    raw.exec("ALTER TABLE notes DROP COLUMN blocks");
    raw.close();

    store = createStore({ path: databasePath });
    const columns = store.db
      .prepare("PRAGMA table_info(notes)")
      .all()
      .map((column) => column.name);
    assert.ok(columns.includes("blocks"));

    const upgraded = store.get(note.id);
    assert.equal(upgraded.body, "First line\nSecond line");
    assert.deepEqual(
      upgraded.blocks.map((block) => block.type),
      ["paragraph", "paragraph"],
    );
    assert.deepEqual(
      upgraded.blocks.map((block) => block.content),
      ["First line", "Second line"],
    );

    store.db.exec("UPDATE notes SET blocks = '[]'");
    store.close();
    store = null;

    store = createStore({ path: databasePath });
    const remigrated = store.get(note.id);
    assert.equal(remigrated.blocks.length, 2);
    assert.equal(remigrated.blocks[1].content, "Second line");
  } finally {
    if (store) store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
