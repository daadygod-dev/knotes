import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const input = process.argv[2];
if (!input) {
  console.error("Usage: node scripts/inspect-note-store.mjs <NoteStore.sqlite>");
  process.exit(1);
}

const file = resolve(input);
const bytes = readFileSync(file);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const db = new DatabaseSync(file, { readOnly: true });

try {
  const tables = db
    .prepare("SELECT name, type, sql FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name")
    .all()
    .map((table) => ({
      name: table.name,
      type: table.type,
      virtual: /VIRTUAL TABLE/i.test(table.sql ?? ""),
      fts: /fts[345]?/i.test(table.name) || /USING\s+fts/i.test(table.sql ?? ""),
    }));

  const columns = db
    .prepare("PRAGMA table_info(ZICCLOUDSYNCINGOBJECT)")
    .all()
    .map((column) => ({ name: column.name, type: column.type }));

  const citedColumns = [
    "ZTITLE1",
    "ZSNIPPET",
    "ZWIDGETSNIPPET",
    "ZSMARTFOLDERQUERYJSON",
    "ZISPASSWORDPROTECTED",
    "ZATTRIBUTEDSNIPPET",
    "ZATTRIBUTEDTITLE",
    "ZPASSWORDHINT",
    "ZNOTEDATA",
  ];
  const metadataColumns = columns
    .filter((column) => citedColumns.includes(column.name))
    .map((column) => column.name);

  const noteCount = db
    .prepare("SELECT count(*) AS count FROM ZICCLOUDSYNCINGOBJECT WHERE ZTITLE1 IS NOT NULL")
    .get().count;

  const lockedCount = db
    .prepare("SELECT count(*) AS count FROM ZICCLOUDSYNCINGOBJECT WHERE ZISPASSWORDPROTECTED = 1")
    .get().count;

  const sampleNotes = db
    .prepare(`
      SELECT o.ZTITLE1 AS title, o.ZSNIPPET AS snippet, o.ZISPASSWORDPROTECTED AS locked,
             length(d.ZDATA) AS bodyBytes
      FROM ZICCLOUDSYNCINGOBJECT o
      LEFT JOIN ZICNOTEDATA d ON d.Z_PK = o.ZNOTEDATA
      WHERE o.ZTITLE1 IS NOT NULL
      ORDER BY o.Z_PK
      LIMIT 6
    `)
    .all();

  const body = db
    .prepare("SELECT ZDATA AS data FROM ZICNOTEDATA WHERE ZDATA IS NOT NULL AND length(ZDATA) > 0 LIMIT 1")
    .get();
  const bodyMagic = body?.data ? Buffer.from(body.data).subarray(0, 8).toString("hex") : null;

  const lockedBody = db
    .prepare(`
      SELECT o.ZTITLE1 AS title, length(d.ZDATA) AS bodyBytes, substr(d.ZDATA, 1, 8) AS magic
      FROM ZICCLOUDSYNCINGOBJECT o
      JOIN ZICNOTEDATA d ON d.Z_PK = o.ZNOTEDATA
      WHERE o.ZISPASSWORDPROTECTED = 1
      LIMIT 1
    `)
    .get();

  console.log(
    JSON.stringify(
      {
        file,
        size: bytes.length,
        sha256,
        tableCount: tables.length,
        tables: tables.map((table) => table.name),
        virtualTables: tables.filter((table) => table.virtual).map((table) => table.name),
        ftsTables: tables.filter((table) => table.fts).map((table) => table.name),
        metadataColumns,
        noteCount,
        lockedCount,
        sampleNotes,
        firstBodyMagic: bodyMagic,
        lockedBody: lockedBody
          ? { ...lockedBody, magic: Buffer.from(lockedBody.magic).toString("hex") }
          : null,
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}
