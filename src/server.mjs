import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isSea } from "node:sea";
import { createStore } from "./db.mjs";
import { createAssistant } from "./assistant.mjs";
import { createAppServer } from "./app.mjs";

const entryPath = process.argv[1]
  ? resolve(process.argv[1])
  : join(process.cwd(), "src", "server.mjs");
const rootDir = isSea() ? dirname(process.execPath) : dirname(dirname(entryPath));

function loadEnvFile(filePath) {
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || key in process.env) continue;
    let value = line.slice(separator + 1).trim();
    const quote = value[0];
    if ((quote === "'" || quote === '"' || quote === "`") && value.endsWith(quote)) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    }
    process.env[key] = value;
  }
}

loadEnvFile(join(rootDir, ".env"));

const databasePath = process.env.NOTES_DB || join(rootDir, "data", "notes.db");
const publicDir = join(rootDir, "public");
const host = process.env.HOST || "127.0.0.1";
const preferredPort = Number(process.env.PORT) || 4173;
const maxPortAttempts = 10;

let store = null;
let server = null;
let activePort = preferredPort;

function shownHost() {
  if (host === "0.0.0.0" || host === "::") return "127.0.0.1";
  return host;
}

function urlFor(port) {
  return `http://${shownHost()}:${port}`;
}

function openBrowser(url) {
  if (process.env.KNOTES_NO_OPEN === "1") return;
  try {
    const child =
      process.platform === "win32"
        ? spawn("cmd", ["/c", "start", "", url], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          })
        : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], {
            detached: true,
            stdio: "ignore",
          });
    child.unref();
  } catch {
    // The URL is printed below if the browser cannot be launched.
  }
}

async function isKnotesRunning(port) {
  try {
    const response = await fetch(`${urlFor(port)}/api/health`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(1200),
    });
    if (!response.ok) return false;
    const payload = await response.json();
    return payload?.app === "knotes";
  } catch {
    return false;
  }
}

function listen(port, assistant) {
  return new Promise((resolveListen, rejectListen) => {
    const candidate = createAppServer({ store, publicDir, assistant });
    const onError = (error) => {
      candidate.off("listening", onListening);
      rejectListen(error);
    };
    const onListening = () => {
      candidate.off("error", onError);
      resolveListen(candidate);
    };
    candidate.once("error", onError);
    candidate.once("listening", onListening);
    candidate.listen(port, host);
  });
}

async function startListening(assistant) {
  for (let offset = 0; offset < maxPortAttempts; offset += 1) {
    const port = preferredPort + offset;
    if (await isKnotesRunning(port)) {
      console.log(`KNOTES is already running at ${urlFor(port)}`);
      openBrowser(urlFor(port));
      return null;
    }

    try {
      const listening = await listen(port, assistant);
      activePort = port;
      return listening;
    } catch (error) {
      if (error?.code !== "EADDRINUSE") throw error;
    }
  }

  throw new Error(
    `KNOTES could not find a free port between ${preferredPort} and ${preferredPort + maxPortAttempts - 1}.`,
  );
}

async function main() {
  store = createStore({
    path: databasePath,
    seed: process.env.NOTES_SEED !== "0",
  });

  const assistant = createAssistant({
    apiKey:
      process.env.RADOXAI_API_KEY ||
      process.env.RADOX_API_KEY ||
      process.env.AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      "",
    baseUrl:
      process.env.RADOXAI_BASE_URL ||
      process.env.RADOXAI_BASE_UR ||
      "https://radoxai.com/v1",
  });

  server = await startListening(assistant);
  if (!server) {
    store.close();
    return;
  }

  server.on("error", (error) => {
    console.error(error);
  });

  const ai = assistant.status();
  const address = urlFor(activePort);
  console.log(`KNOTES is running at ${address}`);
  console.log(
    ai.configured
      ? `AI assistant: ${ai.provider} / ${ai.model}`
      : "AI assistant: not configured (set RADOXAI_API_KEY)",
  );
  if (isSea()) openBrowser(address);
}

function shutdown() {
  if (!server) {
    store?.close();
    process.exit(0);
    return;
  }
  server.close(() => {
    store?.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((error) => {
  console.error(error?.stack || error);
  store?.close();
  process.exitCode = 1;
});
