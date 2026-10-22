import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExportDesignMessages,
  exportFileName,
  normalizeExportDesign,
  parseExportDesign,
  renderExportHtml,
} from "../src/export-html.mjs";

const note = {
  id: 7,
  title: "Café <launch> & notes",
  folder: "Work",
  tags: ["product", "<script>"],
  createdAt: "2026-10-20T09:00:00.000Z",
  updatedAt: "2026-10-21T11:30:00.000Z",
  blocks: [
    { type: "heading-1", content: "Launch plan" },
    { type: "paragraph", content: "Ship <strong>carefully</strong>." },
    { type: "bullet-list", content: "First step" },
    { type: "bullet-list", content: "Second step" },
    { type: "callout", content: "Keep the rollout quiet." },
  ],
  attachments: [
    {
      filename: "agenda.txt",
      kind: "document",
      mime: "text/plain",
      size: 12,
      text: "Agenda text",
      data: "YWdlbmRhIHRleHQ=",
    },
  ],
};

const design = {
  themeName: "Quiet signal",
  layout: "magazine",
  pattern: "grid",
  displayFont: "serif",
  bodyFont: "sans",
  density: "airy",
  radius: 12,
  dropCap: true,
  palette: {
    canvas: "#ece6da",
    paper: "#fffdf8",
    ink: "#1f1b16",
    muted: "#766b5d",
    line: "#ddd2c1",
    accent: "#8b5a1f",
    accentSoft: "#f1e4cf",
  },
};

test("normalizes an AI design and enforces readable colors", () => {
  const normalized = normalizeExportDesign(design);
  assert.equal(normalized.layout, "magazine");
  assert.equal(normalized.themeName, "Quiet signal");
  assert.equal(normalized.dropCap, true);

  const invalid = normalizeExportDesign({
    layout: "unknown",
    pattern: "sparkles",
    displayFont: "comic",
    radius: 90,
    palette: { paper: "#ffffff", ink: "#eeeeee", accent: "red" },
  });
  assert.equal(invalid.layout, "editorial");
  assert.equal(invalid.pattern, "glow");
  assert.equal(invalid.displayFont, "serif");
  assert.equal(invalid.radius, 24);
  assert.equal(invalid.palette.ink, "#2d2720");

  const dark = normalizeExportDesign({
    palette: { paper: "#12100d", ink: "#111111", muted: "#222222", accent: "#333333" },
  });
  assert.notEqual(dark.palette.ink, "#111111");
  assert.notEqual(dark.palette.muted, "#222222");
  assert.notEqual(dark.palette.accent, "#333333");
});

test("parses fenced JSON and rejects non-object output", () => {
  const parsed = parseExportDesign("```json\n{\"themeName\":\"Paper and ink\",\"layout\":\"journal\"}\n```");
  assert.equal(parsed.themeName, "Paper and ink");
  assert.equal(parsed.layout, "journal");
  assert.equal(parseExportDesign("not json"), null);
  assert.equal(parseExportDesign("[1,2,3]"), null);
});

test("builds a bounded design brief without leaking attachment bytes", () => {
  const messages = buildExportDesignMessages(note);
  assert.equal(messages[0].role, "system");
  assert.equal(messages[1].role, "user");
  assert.match(messages[1].content, /Café <launch> & notes/);
  assert.match(messages[1].content, /agenda\.txt/);
  assert.doesNotMatch(messages[1].content, /YWdlbmRhIHRleHQ=/);
  assert.match(messages[0].content, /Return only a JSON object/);
});

test("renders a designed, escaped, attachment-aware HTML document", () => {
  const html = renderExportHtml(note, design);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /class="page layout-magazine pattern-grid density-airy has-dropcap"/);
  assert.match(html, /--accent:#8b5a1f/);
  assert.match(html, /Café &lt;launch&gt; &amp; notes/);
  assert.match(html, /#&lt;script&gt;/);
  assert.match(html, /<ul><li>First step<\/li><li>Second step<\/li><\/ul>/);
  assert.match(html, /data:text\/plain;base64,YWdlbmRhIHRleHQ=/);
  assert.match(html, /download="agenda\.txt"/);
  assert.match(html, /AI design · Quiet signal/);
  assert.doesNotMatch(html, /<script/i);
});

test("creates a safe, descriptive HTML filename", () => {
  const name = exportFileName('A/B: "C"?', new Date("2026-10-22T12:00:00Z"));
  assert.equal(name, "A-B- -C- (AI design 2026-10-22).html");
});
