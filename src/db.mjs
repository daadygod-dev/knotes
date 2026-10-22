import { DatabaseSync } from "node:sqlite";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  scryptSync,
} from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildMatch,
  buildSearchResult,
  parseQuery,
  plainPreview,
} from "./search.mjs";

const DEFAULT_FOLDER = "Notes";
const MAX_BODY = 200_000;
const MAX_BLOCKS = 2_000;
const MAX_BLOCK_CONTENT = 20_000;
const MAX_ATTACHMENTS = 20;
const MAX_ATTACHMENT_TEXT = 100_000;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = 30 * 1024 * 1024;
const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "log",
  "xml",
  "html",
  "htm",
  "css",
  "js",
  "mjs",
  "ts",
  "yml",
  "yaml",
]);
const TEXT_ATTACHMENT_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
]);
const MAX_TAGS = 30;
const BLOCK_TYPES = new Set([
  "paragraph",
  "heading-1",
  "heading-2",
  "bullet-list",
  "todo",
  "code-block",
  "callout",
]);
const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TODO_PRIORITIES = new Set(["low", "medium", "high"]);
const ALLOWED_INLINE_TAGS = new Set(["strong", "em", "u", "s", "code", "br"]);
const DROPPED_INLINE_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "img",
  "svg",
  "math",
  "link",
  "meta",
]);
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const MULTILINE_CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

export class AppError extends Error {
  constructor(status, message, code = "error") {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

export function encryptPayload(payload, passphrase) {
  const secret = validatePassphrase(passphrase);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(secret, salt, 32, SCRYPT_OPTIONS);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    v: 1,
    kdf: "scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: data.toString("base64"),
  });
}

export function decryptPayload(serialized, passphrase) {
  const secret = validatePassphrase(passphrase);

  let envelope;
  try {
    envelope = JSON.parse(serialized);
  } catch {
    throw new AppError(500, "The encrypted note payload is corrupted.", "corrupt_note");
  }

  if (!envelope || envelope.v !== 1) {
    throw new AppError(500, "Unsupported note payload.", "corrupt_note");
  }

  try {
    const salt = Buffer.from(envelope.salt, "base64");
    const iv = Buffer.from(envelope.iv, "base64");
    const tag = Buffer.from(envelope.tag, "base64");
    const data = Buffer.from(envelope.data, "base64");
    const key = scryptSync(secret, salt, 32, SCRYPT_OPTIONS);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new AppError(401, "Incorrect passphrase.", "bad_passphrase");
  }
}

function validatePassphrase(value) {
  if (typeof value !== "string" || value.length < 4) {
    throw new AppError(400, "Passphrase must be at least 4 characters.", "weak_passphrase");
  }
  if (value.length > 200) {
    throw new AppError(400, "Passphrase is too long.", "invalid_passphrase");
  }
  return value.normalize("NFKC");
}

function nowIso() {
  return new Date().toISOString();
}

function cleanString(value, { max, fallback = "", allowNewlines = true } = {}) {
  let result = value == null ? fallback : String(value);
  result = result.normalize("NFKC").replace(/\r\n?/g, "\n");
  result = result.replace(
    allowNewlines ? CONTROL_CHARS : MULTILINE_CONTROL_CHARS,
    "",
  );
  return result.slice(0, max);
}

function cleanTitle(value) {
  const title = cleanString(value, { max: 200, fallback: "Untitled", allowNewlines: false })
    .replace(/\s+/g, " ")
    .trim();
  return title || "Untitled";
}

function cleanFolder(value) {
  const folder = cleanString(value, { max: 60, fallback: DEFAULT_FOLDER, allowNewlines: false })
    .replace(/\s+/g, " ")
    .trim();
  return folder || DEFAULT_FOLDER;
}

function cleanBody(value) {
  return cleanString(value, { max: MAX_BODY, fallback: "" });
}

function escapeBlockHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function decodeBlockEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (match, code) => {
      const point = Number(code);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : match;
    })
    .replace(/&#x([0-9a-f]+);/gi, (match, code) => {
      const point = Number.parseInt(code, 16);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : match;
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function sanitizeBlockContent(value) {
  let html = String(value ?? "").replace(/\u0000/g, "");
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of DROPPED_INLINE_TAGS) {
    html = html.replace(
      new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"),
      "",
    );
    html = html.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi"), "");
  }
  html = html.replace(
    /<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi,
    (match, tagName) => {
      const tag = tagName.toLocaleLowerCase();
      const closing = match.startsWith("</");
      if (tag === "br") return "<br>";
      if (tag === "b") return closing ? "</strong>" : "<strong>";
      if (tag === "i") return closing ? "</em>" : "<em>";
      if (tag === "strike") return closing ? "</s>" : "<s>";
      if (["div", "p", "li"].includes(tag)) {
        return closing ? "<br>" : "";
      }
      return ALLOWED_INLINE_TAGS.has(tag)
        ? (closing ? `</${tag}>` : `<${tag}>`)
        : "";
    },
  );
  html = html.replace(/<\/br\s*>/gi, "");
  return html.slice(0, MAX_BLOCK_CONTENT);
}

function plainTextFromBlockContent(value) {
  return decodeBlockEntities(
    String(value ?? "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?(?:div|p|li)\b[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  ).replace(/\u00a0/g, " ");
}

function blocksToBody(blocks) {
  return cleanBody(
    blocks
      .map((block) => plainTextFromBlockContent(block.content))
      .join("\n"),
  );
}

function createBlock(type = "paragraph", content = "", properties = {}) {
  return {
    id: randomUUID(),
    type: BLOCK_TYPES.has(type) ? type : "paragraph",
    content: sanitizeBlockContent(content),
    properties: { ...properties },
  };
}

function blocksFromBody(body) {
  const text = cleanBody(body);
  if (!text) return [createBlock()];
  return text.split("\n").map((line) => createBlock("paragraph", escapeBlockHtml(line)));
}

function normalizeDueDate(value) {
  if (typeof value !== "string" || !DUE_DATE_PATTERN.test(value)) return "";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return "";
  }
  return value;
}

function normalizePriority(value) {
  const priority = typeof value === "string" ? value.trim().toLowerCase() : "";
  return TODO_PRIORITIES.has(priority) ? priority : "";
}

function normalizeBlockProperties(value, type) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const properties = {};
  if (value.checked !== undefined) properties.checked = asBoolean(value.checked);
  if (type !== "todo") return properties;

  const dueDate = normalizeDueDate(value.dueDate);
  if (dueDate) properties.dueDate = dueDate;
  const priority = normalizePriority(value.priority);
  if (priority) properties.priority = priority;
  return properties;
}

export function normalizeBlocks(value) {
  if (!Array.isArray(value)) {
    throw new AppError(400, "Blocks must be an array.", "invalid_blocks");
  }
  if (value.length > MAX_BLOCKS) {
    throw new AppError(400, `Notes are limited to ${MAX_BLOCKS} blocks.`, "too_many_blocks");
  }

  const seen = new Set();
  const blocks = value.map((raw, index) => {
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    let id = typeof source.id === "string" ? source.id : "";
    if (!BLOCK_ID_PATTERN.test(id) || seen.has(id)) id = randomUUID();
    seen.add(id);
    const type = BLOCK_TYPES.has(source.type) ? source.type : "paragraph";
    const content = sanitizeBlockContent(source.content);
    const properties = normalizeBlockProperties(source.properties, type);
    if (type === "todo" && properties.checked === undefined) properties.checked = false;
    return {
      id,
      type,
      content: String(content).slice(0, MAX_BLOCK_CONTENT),
      properties,
      index,
    };
  });

  const body = blocksToBody(blocks);
  if (body.length > MAX_BODY) {
    throw new AppError(400, "Note content is too large.", "body_too_large");
  }

  return blocks.map(({ index, ...block }) => block);
}

function parseStoredBlocks(json, body) {
  try {
    const parsed = JSON.parse(json || "[]");
    if (Array.isArray(parsed) && parsed.length) return normalizeBlocks(parsed);
  } catch {
    void 0;
  }
  return blocksFromBody(body ?? "");
}

function normalizeTag(value) {
  return cleanString(value, { max: 40, fallback: "", allowNewlines: false })
    .toLocaleLowerCase()
    .replace(/^#/, "")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .slice(0, 40);
}

function cleanTags(value) {
  const source = Array.isArray(value)
    ? value
    : String(value ?? "").split(",");

  const tags = [];
  const seen = new Set();
  for (const item of source) {
    const tag = normalizeTag(item);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

function extractInlineTags(text) {
  const tags = [];
  const seen = new Set();
  const pattern = /(?:^|[\s([{])#([\p{L}\p{N}_-]{1,40})/gu;
  for (const match of String(text ?? "").matchAll(pattern)) {
    const tag = normalizeTag(match[1]);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

function mergeTags(explicit, body) {
  const merged = [];
  const seen = new Set();
  for (const tag of [...explicit, ...extractInlineTags(body)]) {
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    merged.push(tag);
    if (merged.length >= MAX_TAGS) break;
  }
  return merged;
}

function kindForFilename(filename) {
  const extension = String(filename).toLocaleLowerCase().split(".").pop();
  const groups = {
    pdf: ["pdf"],
    image: ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "svg"],
    text: ["txt", "md", "markdown", "csv", "json", "log", "rtf"],
    audio: ["mp3", "m4a", "wav", "aac", "ogg"],
    video: ["mp4", "mov", "m4v", "webm"],
  };
  for (const [kind, extensions] of Object.entries(groups)) {
    if (extensions.includes(extension)) return kind;
  }
  return "file";
}

function attachmentExtension(filename) {
  return String(filename).toLocaleLowerCase().split(".").pop() ?? "";
}

function cleanMime(value, filename) {
  const mime = String(value ?? "").trim().toLocaleLowerCase().slice(0, 100);
  if (/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mime)) {
    return mime;
  }
  const extension = attachmentExtension(filename);
  const fallbacks = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    json: "application/json",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    mp4: "video/mp4",
  };
  return fallbacks[extension] ?? "application/octet-stream";
}

function decodeAttachmentData(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new AppError(400, "Attachment data must be a base64 string.", "invalid_attachment_data");
  }

  const encoded = value
    .trim()
    .replace(/^data:[^,]*,/i, "")
    .replace(/\s+/g, "");
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new AppError(400, "Attachment data must be valid base64.", "invalid_attachment_data");
  }

  const data = Buffer.from(encoded, "base64");
  if (!data.length) {
    throw new AppError(400, "The attachment is empty.", "invalid_attachment_data");
  }
  if (data.length > MAX_ATTACHMENT_BYTES) {
    throw new AppError(413, "Attachments are limited to 10 MB each.", "attachment_too_large");
  }
  return data;
}

function extractAttachmentText(data, filename, mime) {
  const extension = attachmentExtension(filename);
  const isText = mime.startsWith("text/")
    || TEXT_ATTACHMENT_TYPES.has(mime)
    || TEXT_ATTACHMENT_EXTENSIONS.has(extension);
  if (!isText || data.length > 2 * 1024 * 1024) return "";

  let text = data.toString("utf8");
  if (mime.includes("html") || extension === "html" || extension === "htm") {
    text = text
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
      .replace(/<[^>]+>/g, " ");
  }
  return cleanString(text, { max: MAX_ATTACHMENT_TEXT, fallback: "" });
}

function cleanAttachments(value) {
  if (value == null) return null;
  if (!Array.isArray(value)) {
    throw new AppError(400, "Attachments must be an array.", "invalid_attachments");
  }

  let totalBytes = 0;
  const attachments = value.slice(0, MAX_ATTACHMENTS).map((attachment, index) => {
    const source = attachment && typeof attachment === "object" ? attachment : {};
    const filename = cleanString(source.filename, {
      max: 200,
      fallback: `attachment-${index + 1}`,
      allowNewlines: false,
    }).trim() || `attachment-${index + 1}`;
    const kind = kindForFilename(filename);
    const mime = cleanMime(source.mime, filename);
    const data = decodeAttachmentData(source.data);
    const text = cleanString(source.text, {
      max: MAX_ATTACHMENT_TEXT,
      fallback: "",
    }) || (data ? extractAttachmentText(data, filename, mime) : "");
    const result = { filename, text, kind };
    if (data) {
      totalBytes += data.length;
      result.mime = mime;
      result.size = data.length;
      result.data = data.toString("base64");
    } else if (Number.isInteger(source.size) && source.size >= 0) {
      result.size = source.size;
      result.mime = mime;
    }
    return result;
  });

  if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
    throw new AppError(413, "Attachments are limited to 30 MB per note.", "attachments_too_large");
  }
  return attachments;
}

function parseAttachments(json) {
  try {
    const parsed = JSON.parse(json || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function asBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function escapeLike(value) {
  return String(value ?? "").replace(/[\\%_]/g, "\\$&");
}

function fold(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase();
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT,
    blocks TEXT NOT NULL DEFAULT '[]',
    attachments TEXT NOT NULL DEFAULT '[]',
    folder TEXT NOT NULL DEFAULT 'Notes',
    pinned INTEGER NOT NULL DEFAULT 0,
    locked INTEGER NOT NULL DEFAULT 0,
    encrypted_payload TEXT,
    attachment_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS note_tags (
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (note_id, tag)
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    note_id UNINDEXED,
    title,
    body,
    tags,
    attachment_text,
    tokenize = 'unicode61 remove_diacritics 2',
    prefix = '2 3 4'
  );

  CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder);
  CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_notes_locked ON notes(locked);
  CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag);
  PRAGMA user_version = 2;
`;

export class Store {
  constructor(db, path) {
    this.db = db;
    this.path = path;
  }

  close() {
    this.db.close();
  }

  migrateLegacyBlocks() {
    const rows = this.db
      .prepare(`
        SELECT id, body FROM notes
        WHERE body IS NOT NULL AND body <> ''
          AND (blocks IS NULL OR blocks = '' OR blocks = '[]')
      `)
      .all();
    if (!rows.length) return;

    const update = this.db.prepare("UPDATE notes SET blocks = ? WHERE id = ?");
    this._transaction(() => {
      for (const row of rows) {
        update.run(JSON.stringify(blocksFromBody(row.body)), row.id);
        this._indexNote(this._rawNote(row.id));
      }
    });
  }

  _transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        void 0;
      }
      throw error;
    }
  }

  _filters({ folder = "", tag = "", hasAttachments = false, pinned = false, locked = false } = {}) {
    const clauses = [];
    const params = [];

    const normalizedFolder = String(folder ?? "").trim();
    if (normalizedFolder) {
      clauses.push("n.folder = ?");
      params.push(normalizedFolder);
    }

    const normalizedTag = normalizeTag(tag);
    if (normalizedTag) {
      clauses.push(
        "EXISTS (SELECT 1 FROM note_tags t WHERE t.note_id = n.id AND t.tag = ?)",
      );
      params.push(normalizedTag);
    }

    if (asBoolean(hasAttachments)) clauses.push("n.attachment_count > 0");
    if (asBoolean(pinned)) clauses.push("n.pinned = 1");
    if (asBoolean(locked)) clauses.push("n.locked = 1");

    return {
      sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
      params,
    };
  }

  _tagsFor(noteId) {
    return this.db
      .prepare("SELECT tag FROM note_tags WHERE note_id = ? ORDER BY tag")
      .all(noteId)
      .map((row) => row.tag);
  }

  _tagsForMany(ids) {
    const map = new Map();
    if (!ids.length) return map;
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT note_id, tag FROM note_tags WHERE note_id IN (${placeholders}) ORDER BY tag`,
      )
      .all(...ids);
    for (const row of rows) {
      if (!map.has(row.note_id)) map.set(row.note_id, []);
      map.get(row.note_id).push(row.tag);
    }
    return map;
  }

  _syncTags(noteId, tags) {
    this.db.prepare("DELETE FROM note_tags WHERE note_id = ?").run(noteId);
    const insert = this.db.prepare(
      "INSERT INTO note_tags(note_id, tag) VALUES (?, ?)",
    );
    for (const tag of tags) insert.run(noteId, tag);
  }

  _indexNote(row) {
    const tags = this._tagsFor(row.id);
    let bodyText = "";
    let attachmentText = "";

    if (!row.locked) {
      bodyText = row.body ?? "";
      attachmentText = parseAttachments(row.attachments)
        .map((attachment) => attachment.text ?? "")
        .join("\n");
    }

    this.db.prepare("DELETE FROM notes_fts WHERE note_id = ?").run(row.id);
    this.db
      .prepare(
        "INSERT INTO notes_fts(note_id, title, body, tags, attachment_text) VALUES (?, ?, ?, ?, ?)",
      )
      .run(row.id, row.title, bodyText, row.locked ? "" : tags.join(" "), attachmentText);
  }

  _rawNote(id) {
    return this.db
      .prepare("SELECT * FROM notes WHERE id = ?")
      .get(id);
  }

  _summary(row, tags) {
    return {
      id: row.id,
      title: row.title,
      folder: row.folder,
      tags,
      pinned: Boolean(row.pinned),
      locked: Boolean(row.locked),
      attachmentCount: row.attachment_count ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      preview: row.locked
        ? "Locked note · title only"
        : plainPreview(row.body_preview, 180) || "No additional text",
    };
  }

  count() {
    return this.db.prepare("SELECT count(*) AS n FROM notes").get().n;
  }

  list(options = {}) {
    const filters = this._filters(options);
    const limit = Math.min(Math.max(Number(options.limit) || 200, 1), 500);

    const rows = this.db
      .prepare(`
        SELECT n.id, n.title, n.folder, n.pinned, n.locked, n.attachment_count,
               n.created_at, n.updated_at,
               substr(n.body, 1, 600) AS body_preview
        FROM notes n
        ${filters.sql}
        ORDER BY n.pinned DESC, n.updated_at DESC
        LIMIT ?
      `)
      .all(...filters.params, limit);

    const total = this.db
      .prepare(`SELECT count(*) AS n FROM notes n ${filters.sql}`)
      .get(...filters.params).n;

    const tags = this._tagsForMany(rows.map((row) => row.id));
    return {
      count: total,
      notes: rows.map((row) => this._summary(row, tags.get(row.id) ?? [])),
    };
  }

  search(options = {}) {
    const started = performance.now();
    const query = parseQuery(options.q);
    const match = buildMatch(query);
    if (!match) {
      return {
        query: query.text,
        terms: [],
        count: 0,
        tookMs: 0,
        results: [],
      };
    }

    const filters = this._filters(options);
    const extra = filters.sql
      ? `AND ${filters.sql.replace(/^WHERE /, "")}`
      : "";
    const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 100);

    const rows = this.db
      .prepare(`
        SELECT n.id, n.title, n.folder, n.pinned, n.locked, n.attachment_count,
               n.created_at, n.updated_at, n.attachments,
               substr(n.body, 1, 400) AS body_preview,
               bm25(notes_fts, 0.0, 8.0, 1.0, 4.0, 0.6) AS rank,
               snippet(notes_fts, 1, char(1), char(2), '…', 80) AS title_snippet,
               snippet(notes_fts, 2, char(1), char(2), '…', 18) AS body_snippet,
               snippet(notes_fts, 3, char(1), char(2), '…', 12) AS tags_snippet,
               snippet(notes_fts, 4, char(1), char(2), '…', 18) AS attachment_snippet
        FROM notes_fts
        JOIN notes n ON n.id = notes_fts.note_id
        WHERE notes_fts MATCH ?
        ${extra}
        ORDER BY rank ASC, n.pinned DESC, n.updated_at DESC
        LIMIT ?
      `)
      .all(match, ...filters.params, limit);

    const total = this.db
      .prepare(`
        SELECT count(*) AS n
        FROM notes_fts
        JOIN notes n ON n.id = notes_fts.note_id
        WHERE notes_fts MATCH ?
        ${extra}
      `)
      .get(match, ...filters.params).n;

    const tags = this._tagsForMany(rows.map((row) => row.id));
    const results = rows.map((row) => {
      const enriched = { ...row, tags: tags.get(row.id) ?? [] };
      return buildSearchResult(enriched, query);
    });

    return {
      query: query.text,
      terms: query.terms,
      count: total,
      tookMs: Math.round((performance.now() - started) * 10) / 10,
      results,
    };
  }

  get(id) {
    const row = this._rawNote(id);
    if (!row) return null;
    const tags = this._tagsFor(row.id);
    const attachments = row.locked ? null : parseAttachments(row.attachments);

    return {
      id: row.id,
      title: row.title,
      body: row.locked ? null : row.body,
      blocks: row.locked ? null : parseStoredBlocks(row.blocks, row.body),
      attachments,
      folder: row.folder,
      tags,
      pinned: Boolean(row.pinned),
      locked: Boolean(row.locked),
      attachmentCount: row.attachment_count ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      preview: row.locked
        ? "Locked note · title only"
        : plainPreview(row.body, 180) || "No additional text",
    };
  }

  unlock(id, passphrase) {
    const row = this._rawNote(id);
    if (!row) throw new AppError(404, "Note not found.", "not_found");
    if (!row.locked) {
      return {
        body: row.body ?? "",
        blocks: parseStoredBlocks(row.blocks, row.body),
        attachments: parseAttachments(row.attachments),
      };
    }
    const payload = decryptPayload(row.encrypted_payload, passphrase);
    const body = String(payload.body ?? "");
    return {
      body,
      blocks: Array.isArray(payload.blocks) ? normalizeBlocks(payload.blocks) : blocksFromBody(body),
      attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    };
  }

  _attachmentState(id, passphrase) {
    const row = this._rawNote(id);
    if (!row) throw new AppError(404, "Note not found.", "not_found");
    if (row.locked) {
      if (typeof passphrase !== "string" || passphrase.length < 4) {
        throw new AppError(401, "This note is locked. Enter its passphrase.", "locked");
      }
      const current = decryptPayload(row.encrypted_payload, passphrase);
      return {
        row,
        attachments: Array.isArray(current.attachments) ? current.attachments : [],
      };
    }
    return { row, attachments: parseAttachments(row.attachments) };
  }

  addAttachment(id, input = {}) {
    const { row, attachments } = this._attachmentState(id, input.passphrase);
    if (attachments.length >= MAX_ATTACHMENTS) {
      throw new AppError(400, `Notes are limited to ${MAX_ATTACHMENTS} attachments.`, "too_many_attachments");
    }

    const attachment = cleanAttachments([input])?.[0];
    if (!attachment?.data) {
      throw new AppError(400, "Choose a file to attach.", "attachment_data_required");
    }
    const next = [...attachments, attachment];
    const note = this.update(id, {
      attachments: next,
      ...(row.locked ? { passphrase: input.passphrase } : {}),
    });
    return { note, attachment, index: next.length - 1 };
  }

  removeAttachment(id, index, passphrase) {
    const { row, attachments } = this._attachmentState(id, passphrase);
    const attachmentIndex = Number(index);
    if (
      !Number.isInteger(attachmentIndex)
      || attachmentIndex < 0
      || attachmentIndex >= attachments.length
    ) {
      throw new AppError(404, "Attachment not found.", "attachment_not_found");
    }

    const removed = attachments[attachmentIndex];
    const next = attachments.filter((_, itemIndex) => itemIndex !== attachmentIndex);
    const note = this.update(id, {
      attachments: next,
      ...(row.locked ? { passphrase } : {}),
    });
    return { note, removed };
  }

  exportAll() {
    const ids = this.db
      .prepare("SELECT id FROM notes ORDER BY updated_at DESC, id DESC")
      .all();
    const notes = ids.map(({ id }) => {
      const note = this.get(id);
      if (note?.locked) {
        note.encryptedPayload = this._rawNote(id).encrypted_payload;
      }
      return note;
    }).filter(Boolean);

    return {
      app: "knotes",
      version: 1,
      exportedAt: nowIso(),
      notes,
    };
  }

  create(input = {}) {
    const title = cleanTitle(input.title);
    const blocks = input.blocks !== undefined
      ? normalizeBlocks(input.blocks)
      : blocksFromBody(input.body);
    const body = blocksToBody(blocks);
    const folder = cleanFolder(input.folder);
    const attachments = cleanAttachments(input.attachments) ?? [];
    const explicitTags = cleanTags(input.tags);
    const tags = mergeTags(explicitTags, body);
    const pinned = asBoolean(input.pinned) ? 1 : 0;
    const lockPassphrase = input.lockPassphrase
      ? validatePassphrase(input.lockPassphrase)
      : null;
    const timestamp = nowIso();

    const id = this._transaction(() => {
      let storedBody = body;
      let storedBlocks = JSON.stringify(blocks);
      let storedAttachments = JSON.stringify(attachments);
      let locked = 0;
      let encryptedPayload = null;

      if (lockPassphrase) {
        encryptedPayload = encryptPayload({ blocks, body, attachments }, lockPassphrase);
        storedBody = null;
        storedBlocks = "[]";
        storedAttachments = "[]";
        locked = 1;
      }

      const result = this.db
        .prepare(`
          INSERT INTO notes(
            title, body, blocks, attachments, folder, pinned, locked, encrypted_payload,
            attachment_count, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          title,
          storedBody,
          storedBlocks,
          storedAttachments,
          folder,
          pinned,
          locked,
          encryptedPayload,
          attachments.length,
          timestamp,
          timestamp,
        );

      const noteId = Number(result.lastInsertRowid);
      this._syncTags(noteId, tags);
      this._indexNote(this._rawNote(noteId));
      return noteId;
    });

    return this.get(id);
  }

  update(id, input = {}) {
    const row = this._rawNote(id);
    if (!row) throw new AppError(404, "Note not found.", "not_found");

    const title = input.title !== undefined ? cleanTitle(input.title) : row.title;
    const folder = input.folder !== undefined ? cleanFolder(input.folder) : row.folder;
    const pinned = input.pinned !== undefined
      ? (asBoolean(input.pinned) ? 1 : 0)
      : row.pinned;
    const inputTags = input.tags !== undefined ? cleanTags(input.tags) : null;
    const existingTags = this._tagsFor(id);
    const hasBlocks = input.blocks !== undefined;
    const hasBody = input.body !== undefined;
    const hasAttachments = input.attachments !== undefined;
    const requestedBlocks = hasBlocks ? normalizeBlocks(input.blocks) : null;
    const requestedBody = hasBody ? cleanBody(input.body) : null;
    const requestedContent = hasBlocks
      ? requestedBlocks
      : (hasBody ? blocksFromBody(requestedBody) : null);
    const requestedAttachments = hasAttachments
      ? (cleanAttachments(input.attachments) ?? [])
      : null;
    const newPassphrase = input.lockPassphrase
      ? validatePassphrase(input.lockPassphrase)
      : null;
    const removeLock = asBoolean(input.removeLock);
    const timestamp = nowIso();

    this._transaction(() => {
      let body = row.body;
      let blocks = parseStoredBlocks(row.blocks, row.body);
      let storedBlocks = row.blocks && row.blocks !== "" ? row.blocks : JSON.stringify(blocks);
      let attachments = parseAttachments(row.attachments);
      let locked = Boolean(row.locked);
      let encryptedPayload = row.encrypted_payload;
      let attachmentCount = row.attachment_count ?? 0;
      let tags;

      if (row.locked) {
        const contentChanged = hasBlocks || hasBody || hasAttachments
          || Boolean(newPassphrase) || removeLock;

        if (contentChanged) {
          if (typeof input.passphrase !== "string" || input.passphrase.length < 4) {
            throw new AppError(401, "This note is locked. Enter its passphrase.", "locked");
          }

          const current = decryptPayload(row.encrypted_payload, input.passphrase);
          const currentBody = String(current.body ?? "");
          const currentBlocks = Array.isArray(current.blocks)
            ? normalizeBlocks(current.blocks)
            : blocksFromBody(currentBody);
          blocks = requestedContent ?? currentBlocks;
          body = blocksToBody(blocks);
          attachments = hasAttachments
            ? requestedAttachments
            : (Array.isArray(current.attachments) ? current.attachments : []);
          tags = this._nextTags({
            inputTags,
            oldBody: currentBody,
            newBody: body,
            existingTags,
          });
          attachmentCount = attachments.length;

          if (removeLock) {
            locked = false;
            encryptedPayload = null;
            storedBlocks = JSON.stringify(blocks);
          } else {
            const passphrase = newPassphrase || input.passphrase;
            encryptedPayload = encryptPayload({ blocks, body, attachments }, passphrase);
            body = null;
            blocks = [];
            storedBlocks = "[]";
            attachments = [];
            locked = true;
          }
        } else {
          tags = inputTags ?? existingTags;
        }

        this.db
          .prepare(`
            UPDATE notes
            SET title = ?, body = ?, blocks = ?, attachments = ?, folder = ?, pinned = ?,
                locked = ?, encrypted_payload = ?, attachment_count = ?, updated_at = ?
            WHERE id = ?
          `)
          .run(
            title,
            body,
            storedBlocks,
            JSON.stringify(attachments),
            folder,
            pinned,
            locked ? 1 : 0,
            encryptedPayload,
            attachmentCount,
            timestamp,
            id,
          );
      } else {
        if (hasBlocks || hasBody) {
          blocks = requestedContent;
          body = blocksToBody(blocks);
        }
        attachments = hasAttachments ? requestedAttachments : attachments;
        attachmentCount = attachments.length;
        tags = this._nextTags({
          inputTags,
          oldBody: row.body ?? "",
          newBody: body,
          existingTags,
        });

        if (newPassphrase) {
          encryptedPayload = encryptPayload({ blocks, body, attachments }, newPassphrase);
          body = null;
          blocks = [];
          storedBlocks = "[]";
          attachments = [];
          locked = true;
        } else {
          storedBlocks = JSON.stringify(blocks);
        }

        this.db
          .prepare(`
            UPDATE notes
            SET title = ?, body = ?, blocks = ?, attachments = ?, folder = ?, pinned = ?,
                locked = ?, encrypted_payload = ?, attachment_count = ?, updated_at = ?
            WHERE id = ?
          `)
          .run(
            title,
            body,
            storedBlocks,
            JSON.stringify(attachments),
            folder,
            pinned,
            locked ? 1 : 0,
            encryptedPayload,
            attachmentCount,
            timestamp,
            id,
          );
      }

      this._syncTags(id, tags);
      this._indexNote(this._rawNote(id));
    });

    return this.get(id);
  }

  _nextTags({ inputTags, oldBody, newBody, existingTags }) {
    if (inputTags !== null) {
      return mergeTags(inputTags, newBody);
    }
    const oldInline = new Set(extractInlineTags(oldBody));
    const explicit = existingTags.filter((tag) => !oldInline.has(tag));
    return mergeTags(explicit, newBody);
  }

  delete(id) {
    const row = this._rawNote(id);
    if (!row) return false;
    this._transaction(() => {
      this.db.prepare("DELETE FROM notes_fts WHERE note_id = ?").run(id);
      this.db.prepare("DELETE FROM notes WHERE id = ?").run(id);
    });
    return true;
  }

  bootstrap() {
    const folders = this.db
      .prepare("SELECT folder AS name, count(*) AS count FROM notes GROUP BY folder ORDER BY folder")
      .all();
    const tags = this.db
      .prepare("SELECT tag, count(*) AS count FROM note_tags GROUP BY tag ORDER BY count DESC, tag ASC")
      .all();
    const stats = this.db
      .prepare(`
        SELECT count(*) AS total,
               sum(locked) AS locked,
               sum(attachment_count) AS attachments,
               sum(pinned) AS pinned
        FROM notes
      `)
      .get();

    if (!folders.some((folder) => folder.name === DEFAULT_FOLDER)) {
      folders.unshift({ name: DEFAULT_FOLDER, count: 0 });
    }

    return {
      folders,
      tags,
      stats: {
        total: stats.total ?? 0,
        locked: stats.locked ?? 0,
        attachments: stats.attachments ?? 0,
        pinned: stats.pinned ?? 0,
      },
      suggestions: [
        { id: "attachments", label: "Notes with attachments", kind: "filter" },
        { id: "pinned", label: "Pinned notes", kind: "filter" },
        { id: "locked", label: "Locked notes", kind: "filter" },
      ],
    };
  }

  suggestions(q) {
    const text = String(q ?? "").trim();
    if (!text) {
      const tags = this.db
        .prepare("SELECT tag, count(*) AS count FROM note_tags GROUP BY tag ORDER BY count DESC, tag ASC LIMIT 6")
        .all();
      return { tags, notes: [] };
    }

    const needle = `%${escapeLike(fold(text))}%`;
    const prefix = `${escapeLike(fold(text))}%`;

    const tags = this.db
      .prepare(`
        SELECT tag, count(*) AS count
        FROM note_tags
        WHERE tag LIKE ? ESCAPE '\\'
        GROUP BY tag
        ORDER BY count DESC, tag ASC
        LIMIT 5
      `)
      .all(prefix);

    const notes = this.db
      .prepare(`
        SELECT id, title, folder
        FROM notes
        WHERE lower(title) LIKE ? ESCAPE '\\'
        ORDER BY pinned DESC, updated_at DESC
        LIMIT 5
      `)
      .all(needle);

    return { tags, notes };
  }

  seed() {
    if (this.count() > 0) return;

    const day = 86_400_000;
    const base = Date.now();
    const seeds = [
      {
        title: "Weekly product meeting",
        folder: "Work",
        tags: ["work", "product"],
        pinned: true,
        body: `Agenda for Monday

1. Search quality — prefix matching while typing, highlighted snippets, and filters.
2. First-run experience for new sellers.
3. Billing follow-ups and the PayPal draft invoice.

Decision: ship the search prototype this week and measure activation. #work`,
        attachments: [
          {
            filename: "whiteboard.txt",
            text: "Search quality: prefix matching, highlighted snippets, filters, offline index. Activation target: first note created in under five minutes.",
          },
        ],
      },
      {
        title: "Search design notes",
        folder: "Work",
        tags: ["search", "design"],
        pinned: true,
        body: `Apple Notes search patterns worth copying:

- One search field across all notes, with suggested searches when it is empty.
- Typed text, handwriting, image objects, and scanned documents are all searchable.
- Locked notes expose only their title in results.
- Find in Note is a separate mode with an "Include Attachments" switch.
- Results show a short snippet with highlighted matches, not just a title.

Our implementation uses an inverted index with BM25 ranking. #search #design`,
      },
      {
        title: "Kubernetes deployment checklist",
        folder: "Work",
        tags: ["infra"],
        body: `Before every rollout:

- Check the deployment diff and resource limits.
- Run kubectl rollout status and watch the pods.
- Verify readiness probes and rollback plan.
- Page the on-call engineer if error rates climb.

Cluster: staging-rw-1. Namespace: payments.`,
        attachments: [
          {
            filename: "rollout-commands.md",
            text: "kubectl rollout restart deployment/api -n payments\nkubectl rollout status deployment/api -n payments\nkubectl get pods -n payments -w",
          },
        ],
      },
      {
        title: "Cookie recipe",
        folder: "Personal",
        tags: ["recipes", "baking"],
        body: `Brown butter chocolate chip cookies

- 115 g butter, browned and cooled
- 100 g brown sugar
- 50 g white sugar
- 1 egg and 1 yolk
- 150 g flour
- 1/2 tsp baking soda
- 120 g dark chocolate

Bake at 180 C for 11 minutes. Rest the dough overnight. #recipes`,
      },
      {
        title: "Rwanda travel plan",
        folder: "Travel",
        tags: ["travel"],
        body: `Route for the long weekend:

Kigali → Musanze → Lake Kivu → Kigali.

Book the Volcanoes National Park permit early. Pack a rain jacket and a power bank. Try the coffee in Huye on the way back. #travel #rwanda`,
        attachments: [
          {
            filename: "route-map.png",
            text: "Map showing Kigali, Musanze, Rubavu, and the Lake Kivu shoreline.",
          },
        ],
      },
      {
        title: "Scanned receipt — Corner Market",
        folder: "Personal",
        tags: ["receipts"],
        body: `Groceries for the week. Keep this for the household budget.`,
        attachments: [
          {
            filename: "corner-market-receipt.pdf",
            text: "Corner Market receipt. Total 12,500 RWF. Milk, bread, coffee, bananas, rice. Paid by mobile money.",
          },
        ],
      },
      {
        title: "PayPal invoice follow-up",
        folder: "Work",
        tags: ["payments"],
        body: `Draft invoice to Acme for the consulting sprint.

Amount: 850 USD. Due date: Friday. Include the approved scope and the payment link. Do not send until the draft is reviewed. #payments`,
      },
      {
        title: "Onboarding call with Amina",
        folder: "Work",
        tags: ["customers", "onboarding"],
        body: `Discussed onboarding, activation metrics, and the first-run experience.

Amina wants a guided first note and a search hint. The aha moment is finding an old note in under two seconds. #customers`,
        attachments: [
          {
            filename: "onboarding-notes.md",
            text: "Activation metric: first note created within 5 minutes. Search is the aha moment. Next step: share the prototype with three sellers.",
          },
        ],
      },
      {
        title: "Book highlights — Deep Work",
        folder: "Personal",
        tags: ["books"],
        body: `Focus is the new IQ.

- Schedule blocks of deep work.
- Treat attention as a scarce resource.
- Measure output, not hours.
- Shallow work expands to fill the time available. #books`,
      },
      {
        title: "Grocery list",
        folder: "Personal",
        tags: ["errands"],
        body: `- Milk
- Eggs
- Bread
- Coffee beans
- Bananas
- Rice #errands`,
      },
      {
        title: "Garden ideas",
        folder: "Personal",
        tags: ["home"],
        body: `Small balcony garden:

Tomatoes in the sunniest corner, basil next to them, and sunflowers along the railing. Water in the morning before work. #home`,
        attachments: [
          {
            filename: "seed-packets.jpg",
            text: "Seed packets for cherry tomatoes, basil, and dwarf sunflowers.",
          },
        ],
      },
      {
        title: "Q3 budget",
        folder: "Work",
        tags: ["finance"],
        body: `Marketing spend, runway, and contractor costs.

Keep the search prototype within the existing budget. Review the PayPal fees before the next invoice. #finance`,
      },
      {
        title: "Podcast episode ideas",
        folder: "Personal",
        tags: ["media"],
        body: `Episode ideas:

1. How search indexes actually work — inverted indexes, tokenizers, and BM25.
2. Building local-first notes with SQLite.
3. Why snippets matter more than result counts. #media`,
      },
      {
        title: "Passwords and account recovery",
        folder: "Personal",
        tags: ["private"],
        lockPassphrase: "demo",
        body: `Recovery codes and account notes.

Wi-Fi password: do-not-index-this.
Backup email recovery phrase: also-secret.
The point of this note is that only its title should appear in search results.`,
      },
    ];

    seeds.forEach((seed, index) => {
      const created = new Date(base - (index * 1.7 + 0.4) * day).toISOString();
      const note = this.create(seed);
      this.db
        .prepare("UPDATE notes SET created_at = ?, updated_at = ? WHERE id = ?")
        .run(created, created, note.id);
    });
  }
}

export function createStore({ path = ":memory:", seed = false } = {}) {
  if (path !== ":memory:") {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }

  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  if (path !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA busy_timeout = 5000;");
  }
  db.exec(SCHEMA);
  const columns = db.prepare("PRAGMA table_info(notes)").all();
  if (!columns.some((column) => column.name === "blocks")) {
    db.exec("ALTER TABLE notes ADD COLUMN blocks TEXT NOT NULL DEFAULT '[]'");
  }

  const store = new Store(db, path);
  store.migrateLegacyBlocks();
  if (seed && store.count() === 0) store.seed();
  return store;
}
