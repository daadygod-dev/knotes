import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { getAsset, isSea } from "node:sea";
import { AppError } from "./db.mjs";

const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function baseHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...baseHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendError(res, error, logger) {
  if (error instanceof AppError) {
    sendJson(res, error.status, { error: error.message, code: error.code });
    return;
  }
  logger.error?.(error);
  sendJson(res, 500, { error: "Something went wrong.", code: "internal_error" });
}

async function readJson(req) {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > MAX_JSON_BYTES) {
    req.resume();
    throw new AppError(413, "Request body is too large.", "body_too_large");
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) {
      throw new AppError(413, "Request body is too large.", "body_too_large");
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(400, "Request body must be valid JSON.", "invalid_json");
  }
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(404, "Note not found.", "not_found");
  }
  return id;
}

function parseLimit(value, fallback) {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit), 1), 200);
}

function boolParam(value) {
  return value === "1" || value === "true" || value === "yes";
}

function queryFilters(url) {
  return {
    folder: url.searchParams.get("folder") ?? "",
    tag: url.searchParams.get("tag") ?? "",
    hasAttachments: boolParam(url.searchParams.get("hasAttachments")),
    pinned: boolParam(url.searchParams.get("pinned")),
    locked: boolParam(url.searchParams.get("locked")),
  };
}

async function handleApi(req, res, url, store, assistant, logger) {
  const { pathname } = url;
  const method = req.method ?? "GET";

  if (pathname === "/api/health" && method === "GET") {
    sendJson(res, 200, { ok: true, app: "knotes", notes: store.count() });
    return;
  }

  if (pathname === "/api/assistant/status") {
    if (method !== "GET") {
      res.setHeader("Allow", "GET");
      throw new AppError(405, "Method not allowed.", "method_not_allowed");
    }
    sendJson(
      res,
      200,
      assistant?.status?.() ?? {
        configured: false,
        provider: "Not configured",
        model: "",
      },
    );
    return;
  }

  if (pathname === "/api/assistant/chat") {
    if (method !== "POST") {
      res.setHeader("Allow", "POST");
      throw new AppError(405, "Method not allowed.", "method_not_allowed");
    }
    if (!assistant) {
      throw new AppError(
        503,
        "The AI assistant is not configured. Set RADOXAI_API_KEY.",
        "ai_not_configured",
      );
    }
    const input = await readJson(req);
    let note = null;
    if (input.noteId !== undefined && input.noteId !== null && input.noteId !== "") {
      note = store.get(parseId(input.noteId));
      if (!note) throw new AppError(404, "Note not found.", "note_not_found");
    }
    const result = await assistant.chat({
      store,
      note,
      messages: input.messages,
    });
    sendJson(res, 200, result);
    return;
  }

  if (pathname === "/api/bootstrap" && method === "GET") {
    sendJson(res, 200, store.bootstrap());
    return;
  }

  if (pathname === "/api/search" && method === "GET") {
    const scope = url.searchParams.get("scope") === "folder" ? "folder" : "all";
    const filters = queryFilters(url);
    if (scope === "all") filters.folder = "";
    const result = store.search({
      ...filters,
      q: url.searchParams.get("q") ?? "",
      limit: parseLimit(url.searchParams.get("limit"), 50),
    });
    sendJson(res, 200, result);
    return;
  }

  if (pathname === "/api/suggestions" && method === "GET") {
    sendJson(res, 200, store.suggestions(url.searchParams.get("q") ?? ""));
    return;
  }

  if (pathname === "/api/notes" && method === "GET") {
    const filters = queryFilters(url);
    const result = store.list({
      ...filters,
      limit: parseLimit(url.searchParams.get("limit"), 200),
    });
    sendJson(res, 200, result);
    return;
  }

  if (pathname === "/api/notes" && method === "POST") {
    const input = await readJson(req);
    const note = store.create(input);
    sendJson(res, 201, { note });
    return;
  }

  const unlockMatch = pathname.match(/^\/api\/notes\/(\d+)\/unlock$/);
  if (unlockMatch) {
    if (method !== "POST") {
      res.setHeader("Allow", "POST");
      throw new AppError(405, "Method not allowed.", "method_not_allowed");
    }
    const id = parseId(unlockMatch[1]);
    const input = await readJson(req);
    const unlocked = store.unlock(id, input.passphrase);
    sendJson(res, 200, unlocked);
    return;
  }

  const noteMatch = pathname.match(/^\/api\/notes\/(\d+)$/);
  if (noteMatch) {
    const id = parseId(noteMatch[1]);

    if (method === "GET") {
      const note = store.get(id);
      if (!note) throw new AppError(404, "Note not found.", "not_found");
      sendJson(res, 200, { note });
      return;
    }

    if (method === "PUT" || method === "PATCH") {
      const input = await readJson(req);
      const note = store.update(id, input);
      sendJson(res, 200, { note });
      return;
    }

    if (method === "DELETE") {
      const deleted = store.delete(id);
      if (!deleted) throw new AppError(404, "Note not found.", "not_found");
      sendJson(res, 200, { ok: true });
      return;
    }

    res.setHeader("Allow", "GET, PUT, PATCH, DELETE");
    throw new AppError(405, "Method not allowed.", "method_not_allowed");
  }

  throw new AppError(404, "Endpoint not found.", "not_found");
}

function embeddedAsset(relative) {
  if (!isSea()) return null;
  try {
    const asset = getAsset(`public/${relative.replace(/\\/g, "/")}`);
    return Buffer.from(asset);
  } catch {
    return null;
  }
}

async function serveStatic(req, res, url, publicDir) {
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    throw new AppError(405, "Method not allowed.", "method_not_allowed");
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new AppError(400, "Invalid path.", "invalid_path");
  }

  if (pathname.includes("\0")) {
    throw new AppError(400, "Invalid path.", "invalid_path");
  }

  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = resolve(publicDir, relative);
  const root = resolve(publicDir);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    throw new AppError(403, "Forbidden.", "forbidden");
  }

  let body = embeddedAsset(relative);
  if (!body) {
    try {
      body = await readFile(filePath);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "EISDIR") {
        throw new AppError(404, "Not found.", "not_found");
      }
      throw error;
    }
  }

  const type = MIME_TYPES[extname(filePath).toLocaleLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, {
    ...baseHeaders(),
    "Content-Type": type,
    "Content-Length": body.length,
    "Cache-Control": "no-cache",
  });
  res.end(method === "HEAD" ? undefined : body);
}

export function createAppServer({ store, publicDir, assistant = null, logger = console }) {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    const run = url.pathname.startsWith("/api/")
      ? handleApi(req, res, url, store, assistant, logger)
      : serveStatic(req, res, url, publicDir);

    run.catch((error) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendError(res, error, logger);
    });
  });
}
