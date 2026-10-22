# KNOTES

A local-first notes app with fast search and a full-control AI assistant, built on Node.js and SQLite FTS5.

The app runs as one small Node process, stores everything in a local SQLite database, and ships without runtime dependencies. See [EVIDENCE.md](EVIDENCE.md) for the Apple Notes research, reproducible schema inspection, and FTS5 probes behind the search design.

## Requirements

- Node.js 24 or newer
- A Node build with `node:sqlite` and FTS5 support

## Run

```powershell
cd C:\Users\user\notes-search
npm start
```

Open <http://127.0.0.1:4173>.

Running the app from source has zero runtime dependencies. `npm install` is only needed to build the Windows executable or regenerate icons.

For development with automatic restarts:

```powershell
npm run dev
```

The source entry point loads `.env` when it exists, but never overwrites variables already set in the shell.

## AI assistant

The floating **Assistant** button opens a full-screen, online-only chat. Every request uses `claude-sonnet-5`; there is no model picker. The assistant can create, rename, rewrite, append to, move, tag, pin, organize, and delete notes immediately through server-side tools. Delete is reserved for explicit requests. Quick actions add a plan, add next actions, summarize the active note, or ask what to do first.

The active note is optional, so the assistant can also create notes from scratch. Locked-note bodies remain unavailable; the assistant can still create notes and change metadata. Note text is treated as untrusted data so instructions inside a note do not become agent instructions.

Configure RadoxAI in `.env` next to the app or `KNOTES.exe`:

```dotenv
RADOXAI_API_KEY=your-key
RADOXAI_BASE_URL=https://radoxai.com/v1
```

The server supports up to 6 tool turns and 12 tool calls per request, caps note context and chat history, permits one request at a time, applies a 60-second timeout, and validates all note content before it reaches the database. The assistant cannot be used offline.

## Windows desktop app

Build the standalone desktop app with the Node runtime, server code, and all web assets embedded:

```powershell
npm install
npm run build:win
```

This writes `KNOTES.exe` as a native desktop window. It starts the included `KNOTES-server.exe` on a free local port, displays the app in a Microsoft Edge WebView2 window, and stops the server when the window closes. It does not open your browser.

Keep these generated files together in the project root:

- `KNOTES.exe` - desktop window and single-instance launcher
- `KNOTES-server.exe` - embedded Node server
- `Microsoft.Web.WebView2.Core.dll`, `Microsoft.Web.WebView2.WinForms.dll`, and `WebView2Loader.dll` - WebView2 host libraries
- `.env` - assistant configuration
- `data\` - local database and window storage

The build downloads the WebView2 SDK into `.build\webview2` on first use and compiles the launcher with the .NET Framework compiler included with Windows. The target PC needs the Microsoft Edge WebView2 Runtime, which is included with Windows 11 and current Windows 10 installations. If it is missing, install it from <https://developer.microsoft.com/microsoft-edge/webview2/>.

Launching `KNOTES.exe` again focuses the existing window. The interface follows the Windows app light/dark setting automatically, including live theme changes while the window is open.

### Updates

KNOTES checks [GitHub Releases](https://github.com/daadygod-dev/knotes/releases) for updates at most once every 24 hours. A newer release is downloaded in the background, checked against the release's SHA-256 checksum, unpacked into a staging folder, and offered as a restart prompt. The updater replaces only the application files; `.env` and `data\` are preserved. If an update is downloaded but not installed, the restart prompt returns on the next launch.

Set `KNOTES_UPDATE=0` in `.env` to disable update checks, or set `KNOTES_UPDATE_REPO=owner/name` to use another public repository.

Each release must use a tag such as `v1.0.1` that matches `package.json` and include:

- `KNOTES-win-x64.zip`
- `SHA256SUMS.txt`

`npm run build:win` writes both files to `.build\release\`. Pushing a matching `v*` tag runs `.github/workflows/release.yml`, which tests the app, builds the package, and publishes those files. The executables are currently unsigned, so SmartScreen may warn on first launch; code signing is recommended before relying on automatic updates for distribution.

## App icon

The desktop-ready icon package is installed in `public/icons/`:

- `app-icon.ico` - Windows multi-size icon with 16, 24, 32, 48, 64, 128, and 256 px frames.
- `app-icon-16.png` through `app-icon-1024.png` - transparent PNG sizes.
- `app-icon-180.png` and `app-icon-192.png` - Apple touch and PWA sizes.
- `public/app-icon.png` and `public/app-icon.ico` - canonical square brand source and Windows icon for desktop packaging.
- `public/og-image.png` and `public/brand-lockup.png` - ratio-safe horizontal social and brand lockups.
- `public/site.webmanifest` - installable web-app metadata.

The browser shell links the ICO, all standard PNG favicon sizes, the 180 px Apple touch icon, the web manifest, and the OG/Twitter image metadata.

The optional icon generator is `scripts/generate-app-icon.mjs`. It uses the OpenAI Images API and writes a 1024px transparent PNG to `public/app-icon.png`.

Print the prompt without making an API call:

```powershell
npm run icon:prompt
```

Generate the icon:

```powershell
$env:OPENAI_API_KEY = "your-key"
npm run icon
```

`OPENAI_IMAGE_MODEL` defaults to `gpt-image-1`. A custom destination can be passed with `--output=path\to\icon.png`.

Build a multi-size Windows desktop icon from the generated PNG:

```powershell
npm run icon:win
```

This writes `public/app-icon.ico`, every PNG size in `public/icons/`, and the horizontal OG and lockup assets. The 1920x1920 source is only downscaled, never enlarged. The API key is read from the environment and is never written to the project.

## Test

```powershell
npm test
```

The suite uses the built-in `node:test` runner and covers the FTS index, ranking, query parsing, block persistence and sanitization, legacy block migration, locking/encryption, CRUD, attachment uploads and removal, library export, AI HTML export design validation and rendering, API errors, manifest/icon serving, static serving, security headers, fixed-model assistant status, autonomous note tools, action reporting, explicit deletion, locked-note isolation, and provider error mapping.

Current result: **38 tests, 38 passing**.

## Search behavior

Search covers:

- Note titles
- Typed note bodies
- Tags
- Extracted attachment text, when present
- Locked notes by **title only**; body, attachments, and tags are not indexed while locked

Query behavior:

- Multiple words are combined with `AND`.
- The final word gets prefix matching, so `kuber` finds `Kubernetes`.
- Quoted text is an exact phrase, such as `"mix flour"`.
- Matching is diacritic-insensitive, so `cafe` finds `Café`.
- Queries are capped at 240 characters and 12 terms.
- Results use SQLite FTS5 BM25 ranking with title and tag boosts.
- Snippets identify whether the match came from the title, body, tag, or attachment.

The search scope button switches between **All notes** and the **current folder**. Smart filters cover pinned notes, locked notes, and notes with attachments.

**Find in Note** is separate from global search. It finds plain-text matches in the open note and can optionally include attachment text.

## Locked notes

Locked note bodies and attachments are encrypted with AES-256-GCM. A 32-byte key is derived with scrypt (`N=16384`, `r=8`, `p=1`) and a random salt. Each payload has a random 96-bit IV and an authentication tag.

While locked:

- Only the title is placed in the FTS index.
- Body, attachment text, and tags are removed from the FTS index.
- Metadata such as title, folder, tags, and attachment count remains visible.
- Unlocking is required to edit or read encrypted content.

The seeded locked note uses the demo passphrase `demo`. This is sample data, not a production secret.

## Attachments

The editor can attach files up to 10 MB each, with a maximum of 20 files or 30 MB per note. File bytes are stored as base64 in the note's `attachments` JSON, alongside the filename, MIME type, kind, size, and extracted text. Text-like files contribute to full-text search; images and PDFs are stored and downloadable but are not OCRed or parsed.

Attachments on locked notes are encrypted with the note payload. Adding, downloading, or removing them requires the note to be unlocked with its passphrase. The seed data includes simulated receipt scans, meeting notes, and other extracted text so attachment search can be exercised without an OCR pipeline.

The UI supports adding multiple files, downloading stored files, and removing attachments. Export a single note as Markdown, AI-designed HTML, or JSON from the editor's export button, or export the entire library as a JSON backup.

### AI-designed HTML export

Choosing **Export note as HTML** asks the configured AI for a visual direction, then renders that direction on the server into a self-contained page. A blocking overlay stays visible while the AI works and the download starts automatically when the design is ready.

The AI returns only validated design tokens: palette, typography, layout, background pattern, density, corner radius, and drop-cap preference. It never returns raw HTML or CSS. The server applies those tokens to a trusted renderer, enforces readable text/background contrast, escapes all note content, and embeds attachments as downloadable `data:` links. Exported pages contain no scripts, external fonts, or network requests.

AI HTML export requires `RADOXAI_API_KEY`, uses the same fixed `claude-sonnet-5` model as the assistant, and cannot export a locked note until it is unlocked. If the AI is not configured, the export fails without downloading anything.

## Block editor

Notes are stored as structured blocks: `{ id, type, content, properties }`. The editor supports paragraphs, two heading levels, bullet lists, to-dos, code blocks, and callouts, with inline bold/italic/underline/strikethrough/code formatting.

`POST /api/notes` and `PUT /api/notes/:id` accept a `blocks` array. Block content is sanitized to `strong`, `em`, `u`, `s`, `code`, and `br`; scripts, images, event handlers, and other HTML are removed. Duplicate or malformed IDs are replaced, and todo blocks carry a boolean `checked` property.

The server derives the plain-text `body` from the blocks for previews, search, and backward compatibility. Legacy requests that send only `body` are converted into paragraph blocks, and existing body-only databases are migrated in place. If both fields are sent, `blocks` wins.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Health check and note count |
| `GET` | `/api/bootstrap` | Folders, tags, pinned notes, stats, and initial notes |
| `GET` | `/api/notes` | List/filter notes |
| `POST` | `/api/notes` | Create a note |
| `GET` | `/api/notes/:id` | Read one note |
| `PUT`, `PATCH` | `/api/notes/:id` | Update one note |
| `DELETE` | `/api/notes/:id` | Delete one note |
| `POST` | `/api/notes/:id/unlock` | Decrypt one note for the current session |
| `POST` | `/api/notes/:id/attachments` | Add a file attachment |
| `DELETE` | `/api/notes/:id/attachments/:index` | Remove an attachment by zero-based index |
| `POST` | `/api/notes/:id/export/html` | AI-design one note and return a self-contained HTML document |
| `GET` | `/api/export` | Export the note library as JSON |
| `GET` | `/api/search` | Full-text search |
| `GET` | `/api/suggestions` | Search suggestions |
| `GET` | `/api/assistant/status` | Provider configuration and fixed model |
| `POST` | `/api/assistant/chat` | Chat plus autonomous note tools; optional `noteId` |

List and search filters:

- `folder`
- `tag`
- `hasAttachments=1`
- `pinned=1`
- `locked=1`
- `limit`

Search also accepts `scope=folder`; the app clears the folder filter when scope is `all`.

Example:

```powershell
curl.exe "http://127.0.0.1:4173/api/search?q=receipt"
curl.exe "http://127.0.0.1:4173/api/search?q=search&folder=Work&hasAttachments=1"
```

Unlock example:

```powershell
curl.exe -X POST "http://127.0.0.1:4173/api/notes/14/unlock" `
  -H "Content-Type: application/json" `
  -d '{"passphrase":"demo"}'
```

The exact seeded note ID can differ after recreating the database. Read `/api/bootstrap` or `/api/notes?locked=1` first.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4173` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address |
| `NOTES_DB` | `data/notes.db` | SQLite database path |
| `NOTES_SEED` | enabled | Set to `0` to disable seeding an empty database |
| `RADOXAI_API_KEY` | empty | RadoxAI key; enables the assistant and AI-designed HTML export |
| `RADOXAI_BASE_URL` | `https://radoxai.com/v1` | OpenAI-compatible provider base URL |
| `KNOTES_UPDATE` | enabled | Set to `0` to disable GitHub update checks |
| `KNOTES_UPDATE_REPO` | `daadygod-dev/knotes` | Public GitHub repository used for releases |

The default database is created on first run. Seed data is inserted only when the database is empty. To reset while the server is stopped:

```powershell
Remove-Item .\data\notes.db, .\data\notes.db-shm, .\data\notes.db-wal -ErrorAction SilentlyContinue
```

## Keyboard shortcuts

- `Ctrl/Cmd+K`: focus search
- `Ctrl/Cmd+S`: save the open note
- `N`: create a note when focus is not in an editable field
- `Escape`: close the assistant, Find in Note, dialogs, slash menu, or clear search
- `Enter` in the title field: move to the body
- `Enter` in a block: split into a new block
- `Shift+Enter`: insert a line break within a block
- `/` at the start of an empty block: open block commands
- `Backspace` at the start of a block: convert it to a paragraph, then remove it when empty

## Project layout

```text
notes-search/
  .github/workflows/
    release.yml           Tagged Windows build and GitHub release
  desktop/
    Program.cs            WebView2 window, updater, and server lifecycle
    app.manifest          DPI awareness and Windows compatibility
  public/                 Browser app (HTML, CSS, vanilla JS)
  scripts/
    build-windows.mjs     SEA build, WebView2 assets, and desktop compile
    fts-probe.mjs         Reproducible FTS5 ranking/snippet probe
    generate-app-icon.mjs OpenAI app-icon prompt/generator
    inspect-note-store.mjs Apple Notes fixture schema inspector
    make-windows-icon.ps1 Multi-size ICO, PNG set, and lockup generator
  src/
    app.mjs               HTTP server, API routes, static files, headers
    assistant.mjs         Fixed Sonnet 5 client and autonomous note tools
    db.mjs                SQLite schema, store, FTS sync, encryption, seed data
    search.mjs            Query parser, snippets, result shaping
    server.mjs            Process entry point and .env loader
  test/                   node:test suites
  data/                   Local database and WebView2 profile (ignored by git)
  KNOTES.exe              Desktop window launcher (ignored by git)
  KNOTES-server.exe       Embedded local server (ignored by git)
```

## Design notes

- The whole interface uses the bundled General Sans variable font from `public/Fonts`, loaded through `public/fonts.css`.
- `notes_fts` uses `unicode61 remove_diacritics 2` and a `2 3 4` prefix index.
- The FTS table is a projection of the `notes` table; writes update both in a transaction.
- Search snippets use control characters as match markers, then become escaped `{text, match}` segments in JSON. The browser never receives raw HTML for highlighting.
- The server sets a restrictive CSP, `nosniff`, `no-referrer`, and same-origin policies.
- API bodies are limited to 2 MB, except attachment uploads at 16 MB.
- Static file paths are resolved and checked so requests cannot escape `public/`.
- Notes are local to this machine; there is no sync or multi-user authentication.

## Limitations

- No image OCR, handwriting recognition, audio transcription, or native PDF text extraction. Text is indexed only for text-like attachments.
- AI-designed HTML export requires a network connection and RadoxAI key. Attachment bytes are embedded so the page is portable, which can produce large HTML files.
- No sync, sharing, or multi-user accounts.
- The proprietary Apple Notes search implementation is not reproduced. The app reproduces the documented behavior with an open FTS5 design.
