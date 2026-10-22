import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE VIRTUAL TABLE notes_fts USING fts5(
    note_id UNINDEXED,
    title,
    body,
    tags,
    attachment_text,
    tokenize='unicode61 remove_diacritics 2',
    prefix='2 3 4'
  );
  INSERT INTO notes_fts VALUES
    (1, 'Weekly meeting notes', 'We met to discuss the roadmap', 'work', 'Scanned agenda: onboarding'),
    (2, 'Cookie recipe', 'Mix flour and sugar', 'food', ''),
    (3, 'Café plan', 'Coffee and pastries', 'food', '');
`);

const query = db.prepare(`
  SELECT note_id,
         bm25(notes_fts, 0.0, 8.0, 1.0, 4.0, 0.6) AS rank,
         snippet(notes_fts, 1, char(1), char(2), '…', 64) AS title_snippet,
         snippet(notes_fts, 2, char(1), char(2), '…', 18) AS body_snippet,
         snippet(notes_fts, 4, char(1), char(2), '…', 18) AS attachment_snippet
  FROM notes_fts
  WHERE notes_fts MATCH ?
  ORDER BY rank
`);

const terms = ['"meet"*', '"onboard"*', '"cafe"*', '"roadmap" AND "meet"*', '"mix flour"'];

for (const term of terms) {
  const rows = query.all(term).map((row) => ({
    note_id: row.note_id,
    rank: Number(row.rank.toFixed(4)),
    title: row.title_snippet.replaceAll("\u0001", "[").replaceAll("\u0002", "]"),
    body: row.body_snippet.replaceAll("\u0001", "[").replaceAll("\u0002", "]"),
    attachment: row.attachment_snippet.replaceAll("\u0001", "[").replaceAll("\u0002", "]"),
  }));
  console.log(JSON.stringify({ term, rows }, null, 2));
}

db.close();
