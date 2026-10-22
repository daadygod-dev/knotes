export const MARK_START = "\u0001";
export const MARK_END = "\u0002";

const MAX_QUERY_LENGTH = 240;
const MAX_TERMS = 12;
const MAX_TERM_LENGTH = 64;

function cleanTerm(value) {
  return value
    .normalize("NFKC")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, MAX_TERM_LENGTH);
}

export function parseQuery(raw) {
  const text = String(raw ?? "").normalize("NFKC").trim().slice(0, MAX_QUERY_LENGTH);
  const items = [];
  const seen = new Set();
  const pattern = /"([^"]*)"|([\p{L}\p{N}_-]+)/gu;

  for (const match of text.matchAll(pattern)) {
    const isPhrase = match[1] !== undefined;
    const value = cleanTerm(isPhrase ? match[1] : match[2]);
    if (!value) continue;
    const key = `${isPhrase ? "p" : "w"}:${value.toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ type: isPhrase ? "phrase" : "word", value });
    if (items.length >= MAX_TERMS) break;
  }

  return {
    text,
    items,
    terms: items.map((item) => item.value),
  };
}

function escapeQuoted(value) {
  return value.replaceAll('"', '""');
}

export function buildMatch(parsed) {
  if (!parsed.items.length) return null;
  return parsed.items
    .map((item, index) => {
      const quoted = `"${escapeQuoted(item.value)}"`;
      const isLast = index === parsed.items.length - 1;
      return item.type === "word" && isLast ? `${quoted}*` : quoted;
    })
    .join(" AND ");
}

export function markedHasHit(marked) {
  return typeof marked === "string" && marked.includes(MARK_START);
}

export function segmentsFromMarked(marked) {
  const source = typeof marked === "string" ? marked : "";
  const segments = [];
  let cursor = 0;

  while (cursor < source.length) {
    const start = source.indexOf(MARK_START, cursor);
    if (start === -1) {
      segments.push({ text: source.slice(cursor), match: false });
      break;
    }
    if (start > cursor) {
      segments.push({ text: source.slice(cursor, start), match: false });
    }
    const end = source.indexOf(MARK_END, start + 1);
    if (end === -1) {
      segments.push({ text: source.slice(start), match: false });
      break;
    }
    segments.push({ text: source.slice(start + 1, end), match: true });
    cursor = end + 1;
  }

  return segments.filter((segment) => segment.text.length > 0);
}

export function plainPreview(text, maxLength = 180) {
  const collapsed = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (collapsed.length <= maxLength) return collapsed;
  const cut = collapsed.slice(0, maxLength);
  const boundary = cut.lastIndexOf(" ");
  return `${cut.slice(0, boundary > 80 ? boundary : maxLength)}…`;
}

function fold(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase();
}

function findAttachmentName(attachmentsJson, terms) {
  if (!attachmentsJson) return null;
  let attachments;
  try {
    attachments = JSON.parse(attachmentsJson);
  } catch {
    return null;
  }
  if (!Array.isArray(attachments)) return null;

  const needles = terms.map(fold).filter(Boolean);
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== "object") continue;
    const haystack = fold(`${attachment.filename ?? ""}\n${attachment.text ?? ""}`);
    if (needles.some((needle) => haystack.includes(needle))) {
      return String(attachment.filename ?? "attachment");
    }
  }
  return null;
}

export function buildSearchResult(row, query) {
  const titleSegments = segmentsFromMarked(row.title_snippet || row.title);
  const titleMatched = markedHasHit(row.title_snippet);
  const bodyMatched = markedHasHit(row.body_snippet);
  const attachmentMatched = markedHasHit(row.attachment_snippet);
  const tagsMatched = markedHasHit(row.tags_snippet);

  const matchedFields = [];
  if (titleMatched) matchedFields.push("title");
  if (bodyMatched) matchedFields.push("body");
  if (tagsMatched) matchedFields.push("tags");
  if (attachmentMatched) matchedFields.push("attachment");

  let snippetSegments;
  let snippetLabel;
  let snippetKind;

  if (row.locked) {
    snippetSegments = titleSegments;
    snippetLabel = "Locked note · title only";
    snippetKind = "locked";
  } else if (attachmentMatched && !bodyMatched) {
    const attachmentName = findAttachmentName(row.attachments_json, query.terms);
    snippetSegments = segmentsFromMarked(row.attachment_snippet);
    snippetLabel = attachmentName ? `In attachment · ${attachmentName}` : "In attachment";
    snippetKind = "attachment";
  } else if (bodyMatched) {
    snippetSegments = segmentsFromMarked(row.body_snippet);
    snippetLabel = "In note";
    snippetKind = "body";
  } else if (titleMatched) {
    snippetSegments = [{ text: plainPreview(row.body_preview, 180), match: false }];
    snippetLabel = "Title match";
    snippetKind = "title";
  } else if (tagsMatched) {
    snippetSegments = segmentsFromMarked(row.tags_snippet);
    snippetLabel = "Tag match";
    snippetKind = "tags";
  } else {
    snippetSegments = [{ text: plainPreview(row.body_preview, 180), match: false }];
    snippetLabel = "Note";
    snippetKind = "body";
  }

  snippetSegments = snippetSegments.filter((segment) => segment.text.length > 0);
  if (!snippetSegments.length) {
    snippetSegments = [{ text: plainPreview(row.body_preview, 180), match: false }];
  }

  return {
    id: row.id,
    title: row.title,
    titleSegments,
    snippetSegments,
    snippetLabel,
    snippetKind,
    folder: row.folder,
    tags: row.tags ?? [],
    locked: Boolean(row.locked),
    pinned: Boolean(row.pinned),
    attachmentCount: row.attachment_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    matchedFields,
    score: row.rank,
  };
}
