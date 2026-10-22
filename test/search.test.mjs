import test from "node:test";
import assert from "node:assert/strict";
import {
  MARK_START,
  MARK_END,
  parseQuery,
  buildMatch,
  markedHasHit,
  segmentsFromMarked,
  plainPreview,
} from "../src/search.mjs";

test("parseQuery extracts words and phrases, deduplicates, and limits terms", () => {
  const parsed = parseQuery('  "mix flour" mix flour receipt  ');
  assert.deepEqual(parsed.terms, ["mix flour", "mix", "flour", "receipt"]);
  assert.equal(parsed.items[0].type, "phrase");
  assert.equal(parsed.items[1].type, "word");
  assert.equal(parsed.items.filter((item) => item.value === "mix").length, 1);
});

test("buildMatch prefixes only the final word and quotes every term", () => {
  assert.equal(buildMatch(parseQuery("kuber deploy")), '"kuber" AND "deploy"*');
  assert.equal(buildMatch(parseQuery('"exact phrase"')), '"exact phrase"');
  assert.equal(buildMatch(parseQuery("   ")), null);
});

test("snippet markers become safe segments", () => {
  const marked = `before ${MARK_START}match${MARK_END} after`;
  assert.equal(markedHasHit(marked), true);
  assert.deepEqual(segmentsFromMarked(marked), [
    { text: "before ", match: false },
    { text: "match", match: true },
    { text: " after", match: false },
  ]);
});

test("plainPreview collapses whitespace and truncates on a word boundary", () => {
  assert.equal(plainPreview("hello\n\nworld"), "hello world");
  assert.match(plainPreview("one ".repeat(80), 40), /…$/);
  assert.ok(plainPreview("one ".repeat(80), 40).length <= 41);
});
