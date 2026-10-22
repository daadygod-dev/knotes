# Evidence: Apple Notes search behavior

This document separates three things:

1. What Apple documents about Notes search.
2. What a public `NoteStore.sqlite` sample does and does not reveal.
3. What this app implements, and how that was verified.

It does **not** claim access to Apple's source code or private ranking algorithm.

## Bottom line

- Apple's documentation establishes the user-visible contract: search covers typed and handwritten text, objects in images, scanned documents, and tags; locked notes expose only their title; **Find in Note** can include attachments.
- The sampled Apple Notes store contains no SQLite FTS5 table. It keeps searchable display metadata such as `ZTITLE1` and `ZSNIPPET`, note bodies as blobs, and a locked note body as a bplist blob.
- That schema evidence does **not** prove Apple has no internal search index. Apple may use a private index outside this store, an in-memory structure, CloudKit, or another mechanism.
- This app uses an explicit SQLite FTS5 index and reproduces the documented search contract. It does not reproduce Apple's proprietary internals.

## 1. Documented behavior

| Behavior | Apple documentation |
| --- | --- |
| Search scope | Searches all notes for typed and handwritten text, objects in images, and text in scanned documents |
| Searchable fields | Tags, typed text, handwritten text in supported languages, image objects, and scanned-document text |
| Locked notes | If a note is locked, only its title appears in search results |
| Suggestions | Offers suggested searches such as “Notes with Drawings” |
| Find in Note | Searches inside the open note; can include PDFs and other attachments |
| Attachment access | Attachments can be found from the notes list and opened in their note |

Direct quotes:

> “In the Notes app, you can search through all your notes for typed and handwritten text, objects in images, and text in scanned documents. You can also search for text within a note.”

> “You can search for tags, typed and handwritten text (in supported languages), objects that appear in images, and text in scanned documents.”

> “If a note is locked, only its title appears in the search results.”

> “To search PDFs and other attachments, select Include Attachments.”

The iPhone and iPad guides describe the same behavior. Apple's overview also notes that search can recognize what is in images and find text inside scanned documents, and that **Find in Note** is available from the open note.

Sources:

- Apple, [Search through your notes on iPhone](https://support.apple.com/guide/iphone/search-notes-iphb8628c6b8/ios), accessed 2026-10-20.
- Apple, [Search through your notes on iPad](https://support.apple.com/guide/ipad/search-notes-ipad64863a98/ipados), accessed 2026-10-20.
- Apple, [Use Notes on your iPhone, iPad, and iPod touch](https://support.apple.com/en-us/118442), published 2026-09-14, accessed 2026-10-20.

What the documentation does **not** say:

- Which full-text engine Apple uses
- How results are ranked
- Whether an index is stored in `NoteStore.sqlite`, elsewhere on disk, or in memory
- How handwriting, image-object, or OCR matches are represented internally

## 2. On-disk sample inspection

### Fixture

- File: `C:\Users\user\AppData\Local\Temp\opencode\apple-notes-evidence\NoteStore.sqlite`
- Size: `348160` bytes
- SHA-256: `f58a5026d982e7c362267a11ed130a2b40b00e861b19fbb4dbe9296d38733ea4`
- This is a public sample used for schema inspection, not a database extracted from this Windows machine.

### Reproduce

From the project root:

```powershell
node --no-warnings scripts/inspect-note-store.mjs "C:\Users\user\AppData\Local\Temp\opencode\apple-notes-evidence\NoteStore.sqlite"
```

### Observed output

```json
{
  "size": 348160,
  "sha256": "f58a5026d982e7c362267a11ed130a2b40b00e861b19fbb4dbe9296d38733ea4",
  "tableCount": 14,
  "tables": [
    "ACHANGE",
    "ATRANSACTION",
    "ATRANSACTIONSTRING",
    "ZICASSETSIGNATURE",
    "ZICCLOUDSTATE",
    "ZICCLOUDSYNCINGOBJECT",
    "ZICINVITATION",
    "ZICLOCATION",
    "ZICNOTEDATA",
    "ZICNOTEPARTICIPANT",
    "ZICSERVERCHANGETOKEN",
    "Z_METADATA",
    "Z_MODELCACHE",
    "Z_PRIMARYKEY"
  ],
  "virtualTables": [],
  "ftsTables": [],
  "metadataColumns": [
    "ZISPASSWORDPROTECTED",
    "ZNOTEDATA",
    "ZPASSWORDHINT",
    "ZSNIPPET",
    "ZTITLE1",
    "ZWIDGETSNIPPET",
    "ZSMARTFOLDERQUERYJSON",
    "ZATTRIBUTEDSNIPPET",
    "ZATTRIBUTEDTITLE"
  ],
  "noteCount": 8,
  "lockedCount": 1,
  "firstBodyMagic": "1f8b080000000000",
  "lockedBody": {
    "title": "This note is password protected",
    "bodyBytes": 904,
    "magic": "62706c6973743030"
  }
}
```

Additional observed sample rows:

```json
[
  {
    "title": "This is a note in a subfolder",
    "snippet": "This note is in a subfolder",
    "locked": 0,
    "bodyBytes": 340
  },
  {
    "title": "This note has tags",
    "snippet": "This note has tags “travel” and “vacation”",
    "locked": 0,
    "bodyBytes": 469
  },
  {
    "title": "This note is password protected",
    "snippet": null,
    "locked": 1,
    "bodyBytes": 904
  }
]
```

### Interpretation

Established by this sample:

- The store is a Core Data-style SQLite database with 14 tables.
- There are no virtual tables, and no table declared with `USING fts5` or another FTS module.
- `ZICCLOUDSYNCINGOBJECT` exposes display/search metadata including `ZTITLE1`, `ZSNIPPET`, `ZWIDGETSNIPPET`, `ZSMARTFOLDERQUERYJSON`, `ZATTRIBUTEDTITLE`, `ZATTRIBUTEDSNIPPET`, and `ZISPASSWORDPROTECTED`.
- `ZICNOTEDATA` stores body blobs. The first sampled body begins `1f8b`, the gzip magic, consistent with compressed note content.
- The sampled locked note has a null snippet and a 904-byte body beginning `62706c6973743030` (`bplist00`), consistent with a property-list payload rather than plain text.
- The sample has 8 titled notes, one of which is locked.

Not established:

- That Apple does not use FTS5 anywhere.
- That Apple's search is a simple `LIKE` scan over `ZTITLE1` and `ZSNIPPET`.
- That the ranking used by the Notes UI can be derived from the sample.
- That the sample's schema matches every current iOS/macOS release or every account type.

`ZSNIPPET` and `ZWIDGETSNIPPET` are useful corroboration that Apple stores display snippets as metadata. They are not proof of the live query path.

## 3. FTS5 behavior probe

The app's search primitives are independently reproducible without the app or fixture:

```powershell
node --no-warnings scripts/fts-probe.mjs
```

The probe creates an FTS5 table with the same tokenizer, prefix configuration, and BM25 weights as the app, then runs five representative queries.

Observed results:

```json
{
  "term": "\"meet\"*",
  "rows": [
    {
      "note_id": 1,
      "rank": -0.9317,
      "title": "Weekly [meeting] notes",
      "body": "We met to discuss the roadmap",
      "attachment": "Scanned agenda: onboarding"
    }
  ]
}
```

```json
{
  "term": "\"onboard\"*",
  "rows": [
    {
      "note_id": 1,
      "rank": -0.2997,
      "title": "Weekly meeting notes",
      "body": "We met to discuss the roadmap",
      "attachment": "Scanned agenda: [onboarding]"
    }
  ]
}
```

```json
{
  "term": "\"cafe\"*",
  "rows": [
    {
      "note_id": 3,
      "rank": -1.0076,
      "title": "[Café] plan",
      "body": "Coffee and pastries",
      "attachment": ""
    }
  ]
}
```

```json
{
  "term": "\"roadmap\" AND \"meet\"*",
  "rows": [
    {
      "note_id": 1,
      "rank": -1.3557,
      "title": "Weekly [meeting] notes",
      "body": "We met to discuss the [roadmap]",
      "attachment": "Scanned agenda: onboarding"
    }
  ]
}
```

```json
{
  "term": "\"mix flour\"",
  "rows": [
    {
      "note_id": 2,
      "rank": -0.5544,
      "title": "Cookie recipe",
      "body": "[Mix flour] and sugar",
      "attachment": ""
    }
  ]
}
```

This confirms:

- Prefix matching works for the final token.
- Diacritics are folded: `cafe` matches `Café`.
- Multiple terms are combined with `AND`.
- Quoted text is matched as a phrase.
- Attachment text is indexed in a separate FTS column.
- Snippets mark the matching spans.
- FTS5 BM25 returns negative scores where a lower value ranks first.

The app's SQL and weights are in [`src/db.mjs`](src/db.mjs) and [`src/search.mjs`](src/search.mjs).

## 4. Implementation mapping

| Apple-documented behavior | App implementation |
| --- | --- |
| Search all notes | `/api/search` with `scope=all`; UI “All notes” mode |
| Search typed text | FTS columns `title` and `body` |
| Search tags | Separate `tags` FTS column; tags also appear in suggestions |
| Search attachments | `attachment_text` FTS column fed by extracted attachment text |
| Locked notes show only title | While locked, FTS indexing stores title only; body, tags, and attachment text are omitted. A test asserts the locked tag `private` is not searchable until unlock. |
| Suggested searches | `/api/suggestions` returns matching tags/notes; the UI exposes smart filters. It does not reproduce Apple's exact suggestion catalog. |
| Find in Note | Dedicated find bar over the open note, with next/previous navigation |
| Include Attachments in Find | Optional “Include attachments” checkbox; matches are highlighted in attachment previews |
| Highlighted match context | Server returns safe `{text, match}` segments; the client renders `<mark>` elements without injecting HTML |
| Relevance ranking | SQLite FTS5 BM25 with explicit weights: title `8.0`, body `1.0`, tags `4.0`, attachments `0.6` |

Deliberate differences:

- Apple documents handwriting, image-object, and scanned-document search. This app searches **already extracted** attachment text; it has no OCR, handwriting recognition, or image-understanding pipeline.
- Apple's ranking and index internals are private. This app's BM25 weights are a transparent approximation, not a recovered Apple formula.
- The app does not implement Apple's “Notes with Drawings” suggestion or gallery-specific search.
- Attachments are JSON records containing base64 file bytes plus extracted text for text-like files. The UI uploads and downloads files, but does not perform OCR, handwriting recognition, or PDF parsing.
- Apple may show only a title for locked notes in search results; this app now follows that rule exactly in the FTS index and result label.

## 5. Verification

### Automated tests

```powershell
npm test
```

Result:

```text
tests 38
pass 38
fail 0
```

The suite covers:

- FTS ranking and filters
- Prefix, phrase, and diacritic behavior
- FTS synchronization on create/update/delete
- Locked-note title-only search, including the locked tag exclusion
- AES-GCM unlock and permanent lock removal
- Attachment upload, download data round-trip, FTS indexing, and removal
- Locked attachment encryption and passphrase enforcement
- Library export including encrypted locked payloads
- AI HTML design normalization, contrast enforcement, fenced-JSON parsing, bounded prompts, rendered escaping, embedded attachments, and filenames
- AI HTML export success, unconfigured-provider refusal, and locked-note refusal
- Attachment-count preservation across metadata edits and locking
- API CRUD, unlock, security headers, malformed JSON, oversized bodies, and missing routes
- Assistant tool calls, locked-note isolation, deletion safety, and provider error mapping

### Browser smoke test

A current smoke test used headless Microsoft Edge controlled through the DevTools Protocol against the real server and database. It opened “Weekly product meeting”, chose **Export note as HTML**, observed the blocking design overlay through its status changes, and confirmed the automatic download.

```text
menu: Export note as Markdown / HTML / JSON / library backup
overlay: visible, "Designing your export", "Reading the note and its attachments..."
overlay progress: palette, layout, cover/body balancing, finishing
overlay success: "Design ready", "Theme: Sprint Syntax"
download: Weekly product meeting (AI design 2026-10-22).html
download size: 1,160,239 bytes
```

A rendered AI export was also captured at 1200 px wide and inspected: the masthead, cover, metadata grid, content, attachment appendix, and footer all rendered without overflow. The generated page contained embedded attachment data, no scripts, and no external asset requests.

Screenshots:

- `C:\Users\user\AppData\Local\Temp\opencode\notes-search-ui.png`
- `C:\Users\user\AppData\Local\Temp\opencode\notes-find-ui.png`
- `C:\Users\user\AppData\Local\Temp\opencode\notes-locked-ui.png`
- `C:\Users\user\AppData\Local\Temp\opencode\notes-unlocked-ui.png`
- `C:\Users\user\AppData\Local\Temp\opencode\notes-mobile-ui.png`
- `C:\Users\user\AppData\Local\Temp\opencode\notes-mobile-editor.png`

The final smoke run reported no console errors or page errors after adding the favicon.

## 6. Limits

- The fixture is a small public sample, not a live account or a controlled Apple test device. Its schema may differ from current releases.
- The fixture does not expose Apple's query planner, ranking code, or private index.
- Absence of an FTS table in the sample is not evidence that Apple's Notes app lacks an internal search index.
- The app's attachment search depends on text supplied with the attachment. It does not read pixels, handwriting, or PDF structure.
- No claim is made that the app's result ordering matches Apple's.

## Sources

1. Apple, [Search through your notes on iPhone](https://support.apple.com/guide/iphone/search-notes-iphb8628c6b8/ios), accessed 2026-10-20.
2. Apple, [Search through your notes on iPad](https://support.apple.com/guide/ipad/search-notes-ipad64863a98/ipados), accessed 2026-10-20.
3. Apple, [Use Notes on your iPhone, iPad, and iPod touch](https://support.apple.com/en-us/118442), published 2026-09-14, accessed 2026-10-20.
4. Apple, [Core Spotlight](https://developer.apple.com/documentation/corespotlight), accessed 2026-10-20. Core Spotlight is a public API for exposing app content to Spotlight and Safari; its existence does not establish how Notes implements its own search.
5. SQLite, [FTS5](https://sqlite.org/fts5.html), accessed 2026-10-20.
6. Node.js, [`node:sqlite`](https://nodejs.org/api/sqlite.html), accessed 2026-10-20.
