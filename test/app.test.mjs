import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "../src/db.mjs";
import { createAssistant } from "../src/assistant.mjs";
import { createAppServer } from "../src/app.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function withServer(run, { assistant = null } = {}) {
  const store = createStore({ path: ":memory:", seed: true });
  const server = createAppServer({
    store,
    publicDir: join(root, "public"),
    assistant,
    logger: { error() {} },
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    await run({ base, store });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
}

test("serves the app shell with security headers", async () => {
  await withServer(async ({ base }) => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
    const html = await response.text();
    assert.match(html, /KNOTES/);
    assert.match(html, /app\.js/);

    const css = await fetch(`${base}/styles.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type"), /text\/css/);

    const traversal = await fetch(`${base}/..%2fpackage.json`);
    assert.equal(traversal.status, 403);
  });
});

test("exposes bootstrap, list, get, search, and suggestions endpoints", async () => {
  await withServer(async ({ base }) => {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.notes, 14);

    const bootstrap = await (await fetch(`${base}/api/bootstrap`)).json();
    assert.equal(bootstrap.stats.total, 14);
    assert.ok(bootstrap.suggestions.some((item) => item.id === "attachments"));

    const notes = await (await fetch(`${base}/api/notes?folder=Work`)).json();
    assert.equal(notes.count, 6);
    assert.ok(notes.notes.every((note) => note.folder === "Work"));

    const one = await (await fetch(`${base}/api/notes/${notes.notes[0].id}`)).json();
    assert.equal(one.note.id, notes.notes[0].id);
    assert.ok("body" in one.note);

    const search = await (await fetch(`${base}/api/search?q=receipt`)).json();
    assert.equal(search.count, 1);
    assert.equal(search.results[0].snippetKind, "attachment");

    const scoped = await (await fetch(`${base}/api/search?q=search&scope=folder&folder=Work`)).json();
    assert.equal(scoped.count, 4);

    const suggestions = await (await fetch(`${base}/api/suggestions?q=sea`)).json();
    assert.ok(Array.isArray(suggestions.tags));
    assert.ok(Array.isArray(suggestions.notes));
  });
});

test("creates, updates, searches, and deletes a note", async () => {
  await withServer(async ({ base }) => {
    const createdResponse = await fetch(`${base}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "API integration note",
        body: "A unique zanzibar marker for search.",
        folder: "Work",
        tags: ["api"],
      }),
    });
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()).note;
    assert.equal(created.title, "API integration note");
    assert.deepEqual(created.tags.sort(), ["api"]);

    const found = await (await fetch(`${base}/api/search?q=zanzibar`)).json();
    assert.equal(found.count, 1);
    assert.equal(found.results[0].id, created.id);

    const updatedResponse = await fetch(`${base}/api/notes/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated API note", body: "Now with quokka content." }),
    });
    assert.equal(updatedResponse.status, 200);
    const updated = (await updatedResponse.json()).note;
    assert.equal(updated.title, "Updated API note");
    assert.equal((await (await fetch(`${base}/api/search?q=zanzibar`)).json()).count, 0);
    assert.equal((await (await fetch(`${base}/api/search?q=quokka`)).json()).count, 1);

    const deleted = await fetch(`${base}/api/notes/${created.id}`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.equal((await fetch(`${base}/api/notes/${created.id}`)).status, 404);
    assert.equal((await (await fetch(`${base}/api/search?q=quokka`)).json()).count, 0);
  });
});

test("uploads, searches, and removes note attachments", async () => {
  await withServer(async ({ base }) => {
    const created = (await (await fetch(`${base}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Attachment API note", body: "Body" }),
    })).json()).note;
    const bytes = Buffer.from("api attachment needle text", "utf8");

    const upload = await fetch(`${base}/api/notes/${created.id}/attachments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "api-note.txt",
        mime: "text/plain",
        data: `data:text/plain;base64,${bytes.toString("base64")}`,
      }),
    });
    assert.equal(upload.status, 201);
    const uploaded = await upload.json();
    assert.equal(uploaded.note.attachmentCount, 1);
    assert.equal(uploaded.attachment.filename, "api-note.txt");
    assert.equal(uploaded.attachment.size, bytes.length);
    assert.equal(uploaded.note.attachments[0].data, bytes.toString("base64"));

    const opened = (await (await fetch(`${base}/api/notes/${created.id}`)).json()).note;
    assert.equal(opened.attachments.length, 1);
    assert.equal((await (await fetch(`${base}/api/search?q=attachment%20needle`)).json()).count, 1);

    const removed = await fetch(`${base}/api/notes/${created.id}/attachments/0`, {
      method: "DELETE",
    });
    assert.equal(removed.status, 200);
    assert.equal((await removed.json()).note.attachmentCount, 0);
    assert.equal((await (await fetch(`${base}/api/search?q=attachment%20needle`)).json()).count, 0);
  });
});

test("attachment uploads require the passphrase when a note is locked", async () => {
  await withServer(async ({ base }) => {
    const locked = (await (await fetch(`${base}/api/notes?locked=1`)).json()).notes[0];
    const body = {
      filename: "secret.txt",
      mime: "text/plain",
      data: Buffer.from("private attachment").toString("base64"),
    };

    const denied = await fetch(`${base}/api/notes/${locked.id}/attachments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(denied.status, 401);
    assert.equal((await denied.json()).code, "locked");

    const allowed = await fetch(`${base}/api/notes/${locked.id}/attachments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, passphrase: "demo" }),
    });
    assert.equal(allowed.status, 201);
    assert.equal((await allowed.json()).note.attachmentCount, 1);

    const unlocked = (await (await fetch(`${base}/api/notes/${locked.id}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "demo" }),
    })).json());
    assert.equal(unlocked.attachments.length, 1);
  });
});

test("exports the note library as JSON", async () => {
  await withServer(async ({ base }) => {
    const response = await fetch(`${base}/api/export`);
    assert.equal(response.status, 200);
    const backup = await response.json();
    assert.equal(backup.app, "knotes");
    assert.equal(backup.version, 1);
    assert.equal(backup.notes.length, 14);
    assert.ok(backup.notes.find((note) => note.locked)?.encryptedPayload);
  });
});

test("AI HTML export designs an unlocked note and refuses locked notes", async () => {
  const designed = [];
  const assistant = {
    async designExport({ note }) {
      designed.push(note.id);
      return {
        design: {
          themeName: "Test folio",
          layout: "journal",
          pattern: "lines",
          displayFont: "serif",
          bodyFont: "serif",
          density: "balanced",
          radius: 8,
          dropCap: true,
          palette: {
            canvas: "#ebe4d8",
            paper: "#fffdf8",
            ink: "#26211b",
            muted: "#73695c",
            line: "#dcd1c0",
            accent: "#8f5c20",
            accentSoft: "#f2e5d0",
          },
        },
        meta: { provider: "test", model: "test", elapsedMs: 1 },
      };
    },
  };

  await withServer(
    async ({ base }) => {
      const notes = (await (await fetch(`${base}/api/notes?limit=50`)).json()).notes;
      const open = notes.find((note) => !note.locked);
      const response = await fetch(`${base}/api/notes/${open.id}/export/html`, { method: "POST" });
      assert.equal(response.status, 200);
      const exported = await response.json();
      assert.match(exported.html, /^<!doctype html>/);
      assert.match(exported.html, /class="page layout-journal pattern-lines/);
      assert.match(exported.html, /AI design · Test folio/);
      assert.match(exported.filename, /\(AI design \d{4}-\d{2}-\d{2}\)\.html$/);
      assert.deepEqual(designed, [open.id]);

      const locked = notes.find((note) => note.locked);
      const denied = await fetch(`${base}/api/notes/${locked.id}/export/html`, { method: "POST" });
      assert.equal(denied.status, 423);
      assert.equal((await denied.json()).code, "note_locked");
      assert.deepEqual(designed, [open.id]);
    },
    { assistant },
  );

  await withServer(async ({ base }) => {
    const note = (await (await fetch(`${base}/api/notes?limit=1`)).json()).notes[0];
    const response = await fetch(`${base}/api/notes/${note.id}/export/html`, { method: "POST" });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "ai_not_configured");
  });
});

test("unlock endpoint rejects bad passphrases and returns encrypted content", async () => {
  await withServer(async ({ base }) => {
    const locked = (await (await fetch(`${base}/api/notes?locked=1`)).json()).notes[0];

    const wrong = await fetch(`${base}/api/notes/${locked.id}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "nope" }),
    });
    assert.equal(wrong.status, 401);
    assert.equal((await wrong.json()).code, "bad_passphrase");

    const right = await fetch(`${base}/api/notes/${locked.id}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "demo" }),
    });
    assert.equal(right.status, 200);
    const opened = await right.json();
    assert.match(opened.body, /do-not-index-this/);
    assert.deepEqual(opened.attachments, []);
  });
});

test("returns useful errors for malformed requests and missing routes", async () => {
  await withServer(async ({ base }) => {
    const badJson = await fetch(`${base}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    assert.equal(badJson.status, 400);
    assert.equal((await badJson.json()).code, "invalid_json");

    const method = await fetch(`${base}/api/notes/1`, { method: "POST" });
    assert.equal(method.status, 405);
    assert.match(method.headers.get("allow"), /GET/);

    const missing = await fetch(`${base}/api/notes/99999`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, "not_found");

    const unknown = await fetch(`${base}/api/unknown`);
    assert.equal(unknown.status, 404);
  });
});

test("block payloads stay canonical across create, update, and unlock", async () => {
  await withServer(async ({ base }) => {
    const createdResponse = await fetch(`${base}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Block API note",
        body: "Fallback body that must not win",
        folder: "Work",
        blocks: [
          { id: "intro", type: "paragraph", content: "Alpha <strong>zebra</strong>" },
          {
            id: "task",
            type: "todo",
            content: "Beta",
            properties: { checked: true },
          },
        ],
      }),
    });
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()).note;
    assert.equal(created.body, "Alpha zebra\nBeta");
    assert.deepEqual(
      created.blocks.map((block) => block.type),
      ["paragraph", "todo"],
    );
    assert.equal(created.blocks[1].properties.checked, true);
    assert.equal((await (await fetch(`${base}/api/search?q=zebra`)).json()).count, 1);

    const updatedResponse = await fetch(`${base}/api/notes/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: "Fallback update that must not win",
        blocks: [{ id: "next", type: "heading-2", content: "Gamma" }],
      }),
    });
    assert.equal(updatedResponse.status, 200);
    const updated = (await updatedResponse.json()).note;
    assert.equal(updated.body, "Gamma");
    assert.deepEqual(updated.blocks.map((block) => block.type), ["heading-2"]);
    assert.equal((await (await fetch(`${base}/api/search?q=zebra`)).json()).count, 0);
    assert.equal((await (await fetch(`${base}/api/search?q=gamma`)).json()).count, 1);

    const lockedResponse = await fetch(`${base}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Locked block API note",
        blocks: [{ id: "secret", type: "paragraph", content: "classified zebra" }],
        lockPassphrase: "abcd",
      }),
    });
    assert.equal(lockedResponse.status, 201);
    const locked = (await lockedResponse.json()).note;
    assert.equal(locked.locked, true);
    assert.equal(locked.body, null);
    assert.equal(locked.blocks, null);
    assert.equal((await (await fetch(`${base}/api/search?q=classified`)).json()).count, 0);

    const openedResponse = await fetch(`${base}/api/notes/${locked.id}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "abcd" }),
    });
    assert.equal(openedResponse.status, 200);
    const opened = await openedResponse.json();
    assert.equal(opened.body, "classified zebra");
    assert.deepEqual(opened.blocks.map((block) => block.type), ["paragraph"]);

    const reopenedResponse = await fetch(`${base}/api/notes/${locked.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removeLock: true, passphrase: "abcd" }),
    });
    assert.equal(reopenedResponse.status, 200);
    const reopened = (await reopenedResponse.json()).note;
    assert.equal(reopened.locked, false);
    assert.equal(reopened.body, "classified zebra");
    assert.equal((await (await fetch(`${base}/api/search?q=classified`)).json()).count, 1);
  });
});

test("serves the web manifest and installed icon assets", async () => {
  await withServer(async ({ base }) => {
    const manifestResponse = await fetch(`${base}/site.webmanifest`);
    assert.equal(manifestResponse.status, 200);
    assert.match(
      manifestResponse.headers.get("content-type"),
      /application\/manifest\+json/,
    );
    const manifest = await manifestResponse.json();
    assert.equal(manifest.short_name, "KNOTES");
    const sizes = manifest.icons.map((icon) => icon.sizes);
    for (const size of ["16x16", "180x180", "192x192", "256x256", "512x512", "1024x1024"]) {
      assert.ok(sizes.includes(size), `manifest should list ${size}`);
    }
    assert.ok(!sizes.includes("2048x2048"), "manifest should not exceed the source size");
    assert.ok(manifest.icons.some((icon) => icon.type === "image/x-icon"));
    assert.ok(manifest.icons.some((icon) => icon.purpose?.includes("maskable")));

    const assets = [
      "/brand-icon.svg",
      "/icons/app-icon.ico",
      "/icons/app-icon-16.png",
      "/icons/app-icon-64.png",
      "/icons/app-icon-180.png",
      "/icons/app-icon-192.png",
      "/icons/app-icon-256.png",
      "/icons/app-icon-512.png",
      "/icons/app-icon-1024.png",
      "/app-icon.ico",
      "/app-icon.png",
      "/brand-lockup.png",
      "/og-image.png",
    ];
    for (const asset of assets) {
      const response = await fetch(`${base}${asset}`);
      assert.equal(response.status, 200, asset);
      assert.match(response.headers.get("content-type"), /image\//, asset);
    }

    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /rel="manifest" href="\/site\.webmanifest"/);
    assert.match(html, /app-icon-180\.png/);
  });
});

function assistantReply(message) {
  return new Response(JSON.stringify({ choices: [{ message }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function toolCall(id, name, args) {
  return {
    id,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

test("assistant status is fixed to Sonnet 5 and chat fails cleanly when unconfigured", async () => {
  const assistant = createAssistant({ apiKey: "" });
  await withServer(
    async ({ base }) => {
      const status = await (await fetch(`${base}/api/assistant/status`)).json();
      assert.equal(status.configured, false);
      assert.equal(status.model, "claude-sonnet-5");

      const response = await fetch(`${base}/api/assistant/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "Create a note." }] }),
      });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, "ai_not_configured");

      assert.equal((await fetch(`${base}/api/assistant/models`)).status, 404);
      assert.equal((await fetch(`${base}/api/assistant/plan`, { method: "POST" })).status, 404);
    },
    { assistant },
  );
});

test("assistant designs an HTML export without exposing tools to the model", async () => {
  const calls = [];
  const assistant = createAssistant({
    apiKey: "cc_test_key",
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, body });
      return assistantReply({
        content: JSON.stringify({
          themeName: "Copper folio",
          layout: "journal",
          pattern: "lines",
          displayFont: "serif",
          bodyFont: "serif",
          density: "balanced",
          radius: 6,
          dropCap: true,
          palette: {
            canvas: "#ece3d3",
            paper: "#fffdf8",
            ink: "#211c16",
            muted: "#756a5b",
            line: "#dccfbc",
            accent: "#965f20",
            accentSoft: "#f1e3cc",
          },
        }),
      });
    },
  });

  await withServer(
    async ({ base }) => {
      const note = (await (await fetch(`${base}/api/notes?limit=1`)).json()).notes[0];
      const response = await fetch(`${base}/api/notes/${note.id}/export/html`, { method: "POST" });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.design.themeName, "Copper folio");
      assert.match(result.html, /class="page layout-journal pattern-lines/);
      assert.match(result.html, /AI design · Copper folio/);

      assert.equal(calls.length, 1);
      assert.equal(calls[0].body.tools, undefined);
      assert.equal(calls[0].body.tool_choice, undefined);
      assert.equal(calls[0].body.max_tokens, 8000);
      assert.match(calls[0].body.messages[0].content, /art director for KNOTES/);
    },
    { assistant },
  );
});

test("assistant applies note tools and reports the actions it took", async () => {
  const calls = [];
  let targetId = 0;
  let step = 0;
  const assistant = createAssistant({
    apiKey: "cc_test_key",
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, options, body });
      step += 1;
      if (step === 1) {
        return assistantReply({
          content: null,
          tool_calls: [
            toolCall("call_update", "update_note", {
              id: targetId,
              title: "Launch week",
              content:
                "# Launch plan\n- [ ] Ship release @due(2026-10-24) !high\n- [ ] Bad metadata @due(2026-02-30) !urgent\nUnsafe <script>alert(1)</script> tail",
              tags: ["launch"],
            }),
            toolCall("call_create", "create_note", {
              title: "Retro notes",
              content: "## Wrap-up\n- [ ] Collect feedback",
              folder: "Work",
              tags: ["retro"],
              pinned: true,
            }),
          ],
        });
      }
      if (step === 2) {
        return assistantReply({
          content: null,
          tool_calls: [
            toolCall("call_append", "append_to_note", {
              id: targetId,
              content: "- [x] Retro done",
            }),
          ],
        });
      }
      return assistantReply({
        content: "Updated Launch week, created Retro notes, and appended the wrap-up.",
      });
    },
  });

  await withServer(
    async ({ base, store }) => {
      const note = store.create({ title: "Old launch", body: "Prepare zanzibar." });
      targetId = note.id;
      const response = await fetch(`${base}/api/assistant/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          noteId: note.id,
          messages: [{ role: "user", content: "Tidy up the launch note and make a retro note." }],
        }),
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.match(payload.message, /Updated Launch week/);
      assert.equal(payload.changed, true);
      assert.equal(payload.partial, false);
      assert.equal(payload.meta.provider, "Radox AI");
      assert.equal(payload.meta.model, "claude-sonnet-5");
      assert.deepEqual(
        payload.actions.map((action) => action.action),
        ["updated", "created", "appended"],
      );

      const updated = store.get(note.id);
      assert.equal(updated.title, "Launch week");
      assert.equal(updated.blocks[0].type, "heading-1");
      assert.equal(updated.blocks[1].properties.dueDate, "2026-10-24");
      assert.equal(updated.blocks[1].properties.priority, "high");
      assert.ok(!("dueDate" in updated.blocks[2].properties));
      assert.ok(!("priority" in updated.blocks[2].properties));
      assert.ok(!updated.blocks.some((block) => String(block.content).includes("<script>")));
      assert.ok(updated.tags.includes("launch"));

      const retro = store.list({ limit: 50 }).notes.find((entry) => entry.title === "Retro notes");
      assert.ok(retro);
      assert.equal(retro.folder, "Work");
      assert.equal(retro.pinned, true);
      assert.deepEqual(retro.tags, ["retro"]);
      assert.equal(store.get(note.id).blocks.at(-1).properties.checked, true);

      assert.equal(calls.length, 3);
      for (const call of calls) {
        assert.equal(call.url, "https://radoxai.com/v1/chat/completions");
        assert.equal(call.options.headers.Authorization, "Bearer cc_test_key");
        assert.equal(call.body.model, "claude-sonnet-5");
        assert.ok(Array.isArray(call.body.tools));
        assert.equal("response_format" in call.body, false);
      }
      assert.deepEqual(
        calls[0].body.tools.map((tool) => tool.function.name).sort(),
        ["append_to_note", "create_note", "delete_note", "list_notes", "read_note", "update_note"],
      );
      assert.match(calls[0].body.messages[0].content, /untrusted/i);
      assert.match(calls[0].body.messages[0].content, /Old launch/);
      assert.doesNotMatch(JSON.stringify(payload), /cc_test_key/);
      assert.match(calls[2].body.messages.at(-1).content, /"ok":true/);
    },
    { assistant },
  );
});

test("assistant deletes only the note named by an explicit delete tool call", async () => {
  let targetId = 0;
  let step = 0;
  const assistant = createAssistant({
    apiKey: "cc_test_key",
    fetchImpl: async () => {
      step += 1;
      if (step === 1) {
        return assistantReply({
          content: null,
          tool_calls: [toolCall("call_delete", "delete_note", { id: targetId })],
        });
      }
      return assistantReply({ content: 'Deleted "Disposable".' });
    },
  });

  await withServer(
    async ({ base, store }) => {
      targetId = store.create({ title: "Disposable" }).id;
      const keeper = store.create({ title: "Keeper" });
      const response = await fetch(`${base}/api/assistant/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "Delete Disposable." }] }),
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.deepEqual(payload.actions, [
        { action: "deleted", noteId: targetId, title: "Disposable" },
      ]);
      assert.equal(store.get(targetId), null);
      assert.ok(store.get(keeper.id));
    },
    { assistant },
  );
});

test("assistant keeps locked note content out of prompts and refuses content writes", async () => {
  const calls = [];
  let step = 0;
  let lockedId = 0;
  const assistant = createAssistant({
    apiKey: "cc_test_key",
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      step += 1;
      if (step === 1) {
        return assistantReply({
          content: null,
          tool_calls: [
            toolCall("call_locked_update", "update_note", {
              id: lockedId,
              content: "overwrite the secret",
            }),
          ],
        });
      }
      return assistantReply({ content: "That note is locked, so I cannot change its content." });
    },
  });

  await withServer(
    async ({ base, store }) => {
      const locked = store.create({
        title: "Private plans",
        body: "the hidden zanzibar secret",
        lockPassphrase: "abcd",
      });
      lockedId = locked.id;
      const response = await fetch(`${base}/api/assistant/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          noteId: locked.id,
          messages: [{ role: "user", content: "Rewrite this note." }],
        }),
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.changed, false);
      assert.deepEqual(payload.actions, []);
      assert.match(calls[0].messages[0].content, /"locked":true/);
      assert.doesNotMatch(calls[0].messages[0].content, /zanzibar secret/);
      assert.equal(store.unlock(locked.id, "abcd").body, "the hidden zanzibar secret");
    },
    { assistant },
  );
});

test("assistant maps provider auth failures without leaking details", async () => {
  const assistant = createAssistant({
    apiKey: "cc_bad_key",
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: { message: "bad key sk-secret" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
  });

  await withServer(
    async ({ base, store }) => {
      const note = store.create({ title: "Auth failure" });
      const response = await fetch(`${base}/api/assistant/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          noteId: note.id,
          messages: [{ role: "user", content: "Hello" }],
        }),
      });
      assert.equal(response.status, 502);
      const payload = await response.json();
      assert.equal(payload.code, "ai_auth_error");
      assert.doesNotMatch(JSON.stringify(payload), /sk-secret/);
    },
    { assistant },
  );
});
