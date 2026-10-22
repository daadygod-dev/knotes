const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const AI_ICON = `<img class="ai-icon" src="/ai.svg" alt="" />`;
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ESCAPES[character]);

const dayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const yearFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const fullFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const els = {
  app: $("#app"),
  sidebar: $("#sidebar"),
  closeSidebar: $("#close-sidebar"),
  openSidebar: $("#open-sidebar"),
  scrim: $("#scrim"),
  newNoteSidebar: $("#new-note-sidebar"),
  newNote: $("#new-note"),
  allCount: $("#all-count"),
  folderList: $("#folder-list"),
  attachmentsCount: $("#attachments-count"),
  pinnedCount: $("#pinned-count"),
  lockedCount: $("#locked-count"),
  pinnedList: $("#pinned-list"),
  tagList: $("#tag-list"),
  listTitle: $("#list-title"),
  listSubtitle: $("#list-subtitle"),
  searchInput: $("#search-input"),
  clearSearch: $("#clear-search"),
  searchOptions: $("#search-options"),
  scopeButton: $("#scope-button"),
  scopeLabel: $("#scope-label"),
  searchStatus: $("#search-status"),
  searchResults: $("#search-results"),
  notesList: $("#notes-list"),
  listEmpty: $("#list-empty"),
  resetFilters: $("#reset-filters"),
  editorEmpty: $("#editor-empty"),
  editor: $("#editor"),
  backToList: $("#back-to-list"),
  editorFolder: $("#editor-folder"),
  editorState: $("#editor-state"),
  editorLockBadge: $("#editor-lock-badge"),
  exportButton: $("#export-button"),
  designOverlay: $("#design-overlay"),
  designPanel: $(".design-panel"),
  designKicker: $("#design-kicker"),
  designTitle: $("#design-title"),
  designCopy: $("#design-copy"),
  designStatus: $("#design-status"),
  designClose: $("#design-close"),
  pinButton: $("#pin-button"),
  lockButton: $("#lock-button"),
  assistantButton: $("#assistant-button"),
  assistantOverlay: $("#assistant-overlay"),
  assistantPanel: $("#assistant-panel"),
  assistantStatus: $("#assistant-status"),
  assistantClose: $("#assistant-close"),
  assistantNoteLabel: $("#assistant-note-label"),
  assistantThread: $("#assistant-thread"),
  assistantForm: $("#assistant-form"),
  assistantInput: $("#assistant-input"),
  assistantSend: $("#assistant-send"),
  contextMenu: $("#context-menu"),
  inlineAssist: $("#inline-assist"),
  lockedPanel: $("#locked-panel"),
  lockedTitle: $("#locked-title"),
  lockedCopy: $("#locked-copy"),
  unlockForm: $("#unlock-form"),
  unlockPassphrase: $("#unlock-passphrase"),
  unlockError: $("#unlock-error"),
  editorContent: $("#editor-content"),
  noteTitle: $("#note-title"),
  saveState: $("#save-state"),
  noteUpdated: $("#note-updated"),
  findToggle: $("#find-toggle"),
  findBar: $("#find-bar"),
  findInput: $("#find-input"),
  findAttachments: $("#find-attachments"),
  findCount: $("#find-count"),
  findPrev: $("#find-prev"),
  findNext: $("#find-next"),
  findClose: $("#find-close"),
  noteBody: $("#note-body"),
  inlineToolbar: $("#inline-toolbar"),
  slashMenu: $("#slash-menu"),
  slashOptions: $("#slash-options"),
  attachmentCount: $("#attachment-count"),
  attachmentList: $("#attachment-list"),
  addAttachment: $("#add-attachment"),
  attachmentInput: $("#attachment-input"),
  noteTags: $("#note-tags"),
  noteCreated: $("#note-created"),
  noteStorage: $("#note-storage"),
  noteId: $("#note-id"),
  toast: $("#toast"),
  lockDialog: $("#lock-dialog"),
  lockForm: $("#lock-form"),
  lockPassphrase: $("#lock-passphrase"),
  lockConfirm: $("#lock-confirm"),
  lockError: $("#lock-error"),
  lockCancel: $("#lock-cancel"),
  confirmDialog: $("#confirm-dialog"),
  confirmForm: $("#confirm-form"),
  confirmTitle: $("#confirm-title"),
  confirmCopy: $("#confirm-copy"),
  confirmSubmit: $("#confirm-submit"),
  confirmCancel: $("#confirm-cancel"),
};

const state = {
  bootstrap: { folders: [], tags: [], stats: {}, suggestions: [] },
  notes: [],
  pinnedNotes: [],
  activeFolder: "",
  activeTag: "",
  smartFilter: "",
  activeNote: null,
  activeId: null,
  blocks: [],
  draggingBlockId: null,
  dropTarget: null,
  slash: { open: false, blockId: null, start: 0, end: 0, index: 0, options: [] },
  sessionUnlocks: new Map(),
  search: { active: false, query: "", results: [], total: 0, tookMs: 0, scope: "all", seq: 0 },
  find: { open: false, query: "", includeAttachments: false, matches: [], index: -1 },
  dirty: false,
  saving: false,
  uploadingAttachments: false,
  exportDesigning: false,
  designStatusTimer: null,
  savePromise: null,
  saveTimer: null,
  searchTimer: null,
  findTimer: null,
  refreshTimer: null,
  toastTimer: null,
  recoverTimer: null,
  confirmResolve: null,
  assistant: {
    open: false,
    sending: false,
    configured: null,
    status: null,
    statusError: "",
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    messages: [],
    error: "",
    seq: 0,
    noteId: null,
  },
  contextMenuItems: [],
  inlineAssist: { timer: null, blockId: null },
  paneResize: null,
};

function isMobile() {
  return window.matchMedia("(max-width: 820px)").matches;
}

function panesAreCompact() {
  return window.matchMedia("(max-width: 1080px)").matches;
}

function isEditable(target) {
  return Boolean(target?.closest?.("input, textarea, select, [contenteditable='true']"));
}

function activeIsReadOnly() {
  return Boolean(state.activeNote?.locked) && !state.sessionUnlocks.has(state.activeNote?.id);
}

function canEditActive() {
  return Boolean(state.activeNote) && !activeIsReadOnly();
}

const PANE_DEFAULTS = { sidebar: 252, notes: 350 };
const PANE_LIMITS = { sidebar: [190, 360], notes: [240, 560] };
const PANE_STORAGE_KEY = "knotes:pane-widths";
const EDITOR_MIN_WIDTH = 360;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function paneWidths() {
  const styles = getComputedStyle(els.app);
  return {
    sidebar: Number.parseFloat(styles.getPropertyValue("--sidebar-width")) || PANE_DEFAULTS.sidebar,
    notes: Number.parseFloat(styles.getPropertyValue("--notes-width")) || PANE_DEFAULTS.notes,
  };
}

function applyPaneWidths(sidebar, notes) {
  els.app.style.setProperty("--sidebar-width", `${Math.round(sidebar)}px`);
  els.app.style.setProperty("--notes-width", `${Math.round(notes)}px`);
}

function clampPaneWidths() {
  if (isMobile() || panesAreCompact()) return;
  const widths = paneWidths();
  const available = window.innerWidth - EDITOR_MIN_WIDTH - 18;
  let notes = clamp(widths.notes, PANE_LIMITS.notes[0], PANE_LIMITS.notes[1]);
  let sidebar = clamp(widths.sidebar, PANE_LIMITS.sidebar[0], PANE_LIMITS.sidebar[1]);
  if (sidebar + notes > available) {
    notes = Math.max(PANE_LIMITS.notes[0], available - sidebar);
    if (sidebar + notes > available) {
      sidebar = Math.max(PANE_LIMITS.sidebar[0], available - notes);
    }
  }
  applyPaneWidths(sidebar, notes);
}

function loadPaneWidths() {
  try {
    const saved = JSON.parse(localStorage.getItem(PANE_STORAGE_KEY) || "null");
    if (
      saved &&
      Number.isFinite(saved.sidebar) &&
      Number.isFinite(saved.notes)
    ) {
      applyPaneWidths(saved.sidebar, saved.notes);
    }
  } catch {
    void 0;
  }
  clampPaneWidths();
}

function savePaneWidths() {
  const widths = paneWidths();
  try {
    localStorage.setItem(PANE_STORAGE_KEY, JSON.stringify(widths));
  } catch {
    void 0;
  }
}

function startPaneResize(event, resizer) {
  if (isMobile() || panesAreCompact() || event.button !== 0) return;
  event.preventDefault();
  const kind = resizer.dataset.resizer;
  const widths = paneWidths();
  state.paneResize = {
    kind,
    startX: event.clientX,
    sidebar: widths.sidebar,
    notes: widths.notes,
  };
  document.body.classList.add("is-resizing");
  window.addEventListener("pointermove", movePaneResize);
  window.addEventListener("pointerup", endPaneResize);
  window.addEventListener("pointercancel", endPaneResize);
}

function movePaneResize(event) {
  const resize = state.paneResize;
  if (!resize) return;
  const delta = event.clientX - resize.startX;
  const available = window.innerWidth - EDITOR_MIN_WIDTH - 18;
  if (resize.kind === "sidebar") {
    const max = Math.min(PANE_LIMITS.sidebar[1], available - resize.notes);
    const sidebar = clamp(resize.sidebar + delta, PANE_LIMITS.sidebar[0], max);
    applyPaneWidths(sidebar, resize.notes);
  } else {
    const max = Math.min(PANE_LIMITS.notes[1], available - resize.sidebar);
    const notes = clamp(resize.notes + delta, PANE_LIMITS.notes[0], max);
    applyPaneWidths(resize.sidebar, notes);
  }
}

function endPaneResize() {
  if (!state.paneResize) return;
  state.paneResize = null;
  document.body.classList.remove("is-resizing");
  window.removeEventListener("pointermove", movePaneResize);
  window.removeEventListener("pointerup", endPaneResize);
  window.removeEventListener("pointercancel", endPaneResize);
  savePaneWidths();
}

function nudgePaneResize(resizer, delta) {
  const widths = paneWidths();
  const available = window.innerWidth - EDITOR_MIN_WIDTH - 18;
  if (resizer.dataset.resizer === "sidebar") {
    const max = Math.min(PANE_LIMITS.sidebar[1], available - widths.notes);
    applyPaneWidths(
      clamp(widths.sidebar + delta, PANE_LIMITS.sidebar[0], max),
      widths.notes,
    );
  } else {
    const max = Math.min(PANE_LIMITS.notes[1], available - widths.sidebar);
    applyPaneWidths(
      widths.sidebar,
      clamp(widths.notes + delta, PANE_LIMITS.notes[0], max),
    );
  }
  savePaneWidths();
}

function resetPaneWidths() {
  applyPaneWidths(PANE_DEFAULTS.sidebar, PANE_DEFAULTS.notes);
  clampPaneWidths();
  savePaneWidths();
}

async function request(path, options = {}) {
  const requestOptions = { method: options.method ?? "GET", headers: { Accept: "application/json" } };
  if (options.body !== undefined) {
    requestOptions.headers["Content-Type"] = "application/json";
    requestOptions.body = JSON.stringify(options.body);
  }

  let response;
  try {
    response = await fetch(path, requestOptions);
  } catch {
    const error = new Error(
      "Can't reach the notes server. Make sure it is running, then try again.",
    );
    error.code = "network_error";
    throw error;
  }
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
  }

  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status}).`);
    error.status = response.status;
    error.code = data.code;
    throw error;
  }

  return data;
}

function handleError(error) {
  if (error?.code === "network_error") startServerRecovery();
  showToast(error?.message || "Something went wrong.", true);
}

function startServerRecovery() {
  if (state.recoverTimer) return;
  state.recoverTimer = setTimeout(probeServerRecovery, 3000);
}

async function probeServerRecovery() {
  state.recoverTimer = null;
  try {
    const response = await fetch("/api/health", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Server is not ready.");
  } catch {
    startServerRecovery();
    return;
  }

  if (state.dirty && canEditActive()) {
    const saved = await saveActive();
    if (!saved) return;
  }

  try {
    await loadBootstrap();
    if (state.search.active) {
      await runSearch(state.search.query, { silent: true });
    } else {
      await loadNotes();
    }
    await loadPinnedPreview();
  } catch {
    startServerRecovery();
    return;
  }

  showToast("Reconnected to the notes server.");
}

function showToast(message, isError = false) {
  clearTimeout(state.toastTimer);
  els.toast.textContent = message;
  els.toast.classList.toggle("is-error", isError);
  els.toast.hidden = false;
  state.toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 3200);
}

function dateValue(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function shortDate(value) {
  const date = dateValue(value);
  if (!date) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return timeFormat.format(date);
  if (date.getFullYear() === now.getFullYear()) return dayFormat.format(date);
  return yearFormat.format(date);
}

function fullDate(value) {
  const date = dateValue(value);
  return date ? fullFormat.format(date) : "";
}

function relativeTime(value) {
  const date = dateValue(value);
  if (!date) return "";
  const elapsed = Date.now() - date.getTime();
  if (elapsed >= 0 && elapsed < 60_000) return "just now";
  if (elapsed >= 0 && elapsed < 3_600_000) {
    const minutes = Math.max(1, Math.round(elapsed / 60_000));
    return `${minutes}m ago`;
  }
  return shortDate(value);
}

function foldText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase();
}

function renderSegments(segments, fallback = "") {
  if (!Array.isArray(segments) || !segments.length) return escapeHtml(fallback);
  return segments
    .map((segment) => (segment.match ? `<mark>${escapeHtml(segment.text)}</mark>` : escapeHtml(segment.text)))
    .join("");
}

function highlightText(text, query) {
  const source = String(text ?? "");
  const needle = foldText(query);
  if (!needle) return escapeHtml(source);
  const folded = foldText(source);
  let result = "";
  let cursor = 0;
  let index = folded.indexOf(needle, cursor);

  while (index !== -1) {
    result += escapeHtml(source.slice(cursor, index));
    result += `<mark>${escapeHtml(source.slice(index, index + needle.length))}</mark>`;
    cursor = index + needle.length;
    index = folded.indexOf(needle, cursor);
  }

  return result + escapeHtml(source.slice(cursor));
}

function setButtonIcon(button, name) {
  const use = button.querySelector("use");
  if (use) use.setAttribute("href", `#i-${name}`);
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

const BLOCK_TYPES = new Set([
  "paragraph",
  "heading-1",
  "heading-2",
  "bullet-list",
  "todo",
  "code-block",
  "callout",
]);
const ALLOWED_INLINE_TAGS = new Set(["STRONG", "EM", "U", "S", "CODE", "BR"]);
const DROPPED_INLINE_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "IMG",
  "SVG",
  "MATH",
  "LINK",
  "META",
]);
const BLOCK_COMMANDS = [
  { type: "paragraph", label: "Text", description: "Plain paragraph", mark: "T", aliases: ["text", "paragraph", "plain"] },
  { type: "heading-1", label: "Heading 1", description: "Large section heading", mark: "H1", aliases: ["heading", "title", "h1"] },
  { type: "heading-2", label: "Heading 2", description: "Medium section heading", mark: "H2", aliases: ["heading", "subtitle", "h2"] },
  { type: "bullet-list", label: "Bullet list", description: "Simple bulleted list", mark: "•", aliases: ["bullet", "list", "ul"] },
  { type: "todo", label: "To-do", description: "Checklist item", mark: "[ ]", aliases: ["todo", "task", "checkbox", "check"] },
  { type: "code-block", label: "Code block", description: "Monospaced code", mark: "</>", aliases: ["code", "pre", "monospace"] },
  { type: "callout", label: "Callout", description: "Highlighted aside", mark: "!", aliases: ["note", "callout", "aside"] },
];
const BLOCK_PLACEHOLDERS = {
  paragraph: "Write something, or type / for blocks…",
  "heading-1": "Heading 1",
  "heading-2": "Heading 2",
  "bullet-list": "List item",
  todo: "To-do",
  "code-block": "Code",
  callout: "Callout",
};
const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITY_VALUES = ["low", "medium", "high"];
const PRIORITY_LABELS = { low: "Low", medium: "Medium", high: "High" };
const SIX_DOT_ICON = `<svg class="drag-dots" viewBox="0 0 18 18" aria-hidden="true"><circle cx="6" cy="4" r="1.4"></circle><circle cx="12" cy="4" r="1.4"></circle><circle cx="6" cy="9" r="1.4"></circle><circle cx="12" cy="9" r="1.4"></circle><circle cx="6" cy="14" r="1.4"></circle><circle cx="12" cy="14" r="1.4"></circle></svg>`;

function newBlockId() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `block-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(value) {
  if (typeof value !== "string" || !DUE_DATE_PATTERN.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function priorityLabel(value) {
  return PRIORITY_LABELS[value] ?? "";
}

function dueDateInfo(value) {
  const date = parseDateKey(value);
  if (!date) return null;
  const today = parseDateKey(dateKey());
  const days = Math.round((date - today) / 86_400_000);
  if (days < 0) return { state: "overdue", label: `Overdue · ${dayFormat.format(date)}` };
  if (days === 0) return { state: "today", label: "Today" };
  if (days === 1) return { state: "soon", label: "Tomorrow" };
  if (days < 7) return { state: "soon", label: dayFormat.format(date) };
  const sameYear = date.getFullYear() === today.getFullYear();
  return {
    state: "future",
    label: (sameYear ? dayFormat : yearFormat).format(date),
  };
}

function normalizeClientProperties(value, type) {
  const properties = {};
  if (value && typeof value === "object") {
    if (value.checked !== undefined) properties.checked = Boolean(value.checked);
    if (type === "todo") {
      const dueDate = parseDateKey(value.dueDate) ? value.dueDate : "";
      if (dueDate) properties.dueDate = dueDate;
      const priority = String(value.priority ?? "").toLowerCase();
      if (PRIORITY_VALUES.includes(priority)) properties.priority = priority;
    }
  }
  return properties;
}

function sanitizeInlineHtml(value) {
  const template = document.createElement("template");
  template.innerHTML = String(value ?? "");

  const cleanNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.nodeValue);
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const tag = node.tagName;
    if (DROPPED_INLINE_TAGS.has(tag)) return "";
    if (tag === "BR") return "<br>";
    const inner = Array.from(node.childNodes, cleanNode).join("");
    if (tag === "B") return `<strong>${inner}</strong>`;
    if (tag === "I") return `<em>${inner}</em>`;
    if (tag === "STRIKE") return `<s>${inner}</s>`;
    if (["DIV", "P", "LI"].includes(tag)) return `${inner}<br>`;
    if (ALLOWED_INLINE_TAGS.has(tag)) return `<${tag.toLocaleLowerCase()}>${inner}</${tag.toLocaleLowerCase()}>`;
    return inner;
  };

  return Array.from(template.content.childNodes, cleanNode)
    .join("")
    .replace(/(<br>){3,}/g, "<br><br>")
    .replace(/^(<br>)+|(<br>)+$/g, "");
}

function plainTextFromDom(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return "";
  if (node.nodeName === "BR") return "\n";
  return Array.from(node.childNodes, plainTextFromDom).join("");
}

function contentTextTokens(content) {
  const tokens = [];
  let text = "";
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const value = child.nodeValue ?? "";
        tokens.push({ start: text.length, end: text.length + value.length, node: child });
        text += value;
      } else if (child.nodeName === "BR") {
        tokens.push({ start: text.length, end: text.length + 1, node: child, break: true });
        text += "\n";
      } else {
        walk(child);
      }
    }
  };
  walk(content);
  return { text, tokens };
}

function blockPlainText(content) {
  const template = document.createElement("template");
  template.innerHTML = sanitizeInlineHtml(content);
  return plainTextFromDom(template.content).replace(/\u00a0/g, " ");
}

function blocksToPlainText(blocks) {
  return blocks.map((block) => blockPlainText(block.content)).join("\n");
}

function blocksFromPlainText(value) {
  const text = String(value ?? "").replace(/\r\n?/g, "\n");
  if (!text) return [createBlock()];
  return text.split("\n").map((line) => createBlock("paragraph", escapeHtml(line)));
}

function normalizeClientBlock(raw, seen = new Set()) {
  const source = raw && typeof raw === "object" ? raw : {};
  let id = typeof source.id === "string" ? source.id : "";
  if (!BLOCK_ID_PATTERN.test(id) || seen.has(id)) id = newBlockId();
  seen.add(id);
  const type = BLOCK_TYPES.has(source.type) ? source.type : "paragraph";
  const properties = normalizeClientProperties(source.properties, type);
  if (type === "todo" && properties.checked === undefined) properties.checked = false;
  return {
    id,
    type,
    content: sanitizeInlineHtml(source.content),
    properties,
  };
}

function normalizeClientBlocks(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).map((block) => normalizeClientBlock(block, seen));
}

function createBlock(type = "paragraph", content = "", properties = {}) {
  return normalizeClientBlock({
    id: newBlockId(),
    type,
    content,
    properties,
  });
}

function blockIsEmpty(content) {
  return blockPlainText(content).trim() === "";
}

function renderBlockControls() {
  return `
    <div class="block-controls" contenteditable="false">
      <button class="block-add" type="button" data-action="add" aria-label="Insert block below" title="Insert block below">${icon("plus")}</button>
      <button class="block-handle" type="button" draggable="true" data-action="drag" aria-label="Drag block" title="Drag block">${SIX_DOT_ICON}</button>
      <button class="block-delete" type="button" data-action="delete-block" aria-label="Delete block" title="Delete block">${icon("trash")}</button>
    </div>`;
}

function renderTodoMeta(block) {
  if (block.type !== "todo") return "";
  const due = dueDateInfo(block.properties?.dueDate);
  const priority = block.properties?.priority ?? "";
  const dueChip = `
    <label class="todo-meta-chip due-chip${due ? ` is-${due.state}` : " is-empty"}" title="${due ? due.label : "Set a due date"}">
      ${icon("calendar")}
      <span>${escapeHtml(due ? due.label : "Due")}</span>
      <input class="todo-date-input" type="date" value="${escapeHtml(block.properties?.dueDate ?? "")}" data-action="set-due" aria-label="Due date" />
    </label>`;
  const clearDue = due
    ? `<button class="todo-meta-clear" type="button" data-action="clear-due" aria-label="Clear due date" title="Clear due date">${icon("x")}</button>`
    : "";
  const priorityChip = `
    <button class="todo-meta-chip priority-chip${priority ? ` is-${priority}` : ""}" type="button" data-action="cycle-priority" aria-label="Change priority" title="Change priority">
      ${icon("flag")}
      <span>${priority ? priorityLabel(priority) : "Priority"}</span>
    </button>`;
  return `<div class="todo-meta" contenteditable="false">${dueChip}${clearDue}${priorityChip}</div>`;
}

function blockContentElement(block) {
  const headingLevel = block.type === "heading-1" ? "1" : block.type === "heading-2" ? "2" : "";
  const role = headingLevel ? ` role="heading" aria-level="${headingLevel}"` : "";
  const spellcheck = block.type === "code-block" ? "false" : "true";
  const placeholder = escapeHtml(BLOCK_PLACEHOLDERS[block.type] ?? BLOCK_PLACEHOLDERS.paragraph);
  const empty = blockIsEmpty(block.content) ? " is-empty" : "";
  return `<div class="block-content${empty}${block.type === "code-block" ? " block-code" : ""}" contenteditable="true" spellcheck="${spellcheck}" data-placeholder="${placeholder}"${role}>${sanitizeInlineHtml(block.content)}</div>`;
}

function renderBlockHtml(block) {
  const checked = block.type === "todo" && Boolean(block.properties?.checked);
  let marker = "";
  if (block.type === "bullet-list") {
    marker = `<span class="block-bullet" contenteditable="false" aria-hidden="true"></span>`;
  } else if (block.type === "todo") {
    marker = `<button class="todo-check${checked ? " is-checked" : ""}" type="button" data-action="toggle-todo" aria-label="${checked ? "Mark incomplete" : "Mark complete"}" aria-pressed="${checked}">${checked ? icon("check") : ""}</button>`;
  } else if (block.type === "callout") {
    marker = `<span class="callout-mark" contenteditable="false" aria-hidden="true">i</span>`;
  }

  return `
    <div class="block-wrapper block-${block.type}${checked ? " is-checked" : ""}" data-block-id="${escapeHtml(block.id)}">
      ${renderBlockControls()}
      <div class="block-row">
        ${marker}
        <div class="block-main">
          ${blockContentElement(block)}
          ${renderTodoMeta(block)}
        </div>
      </div>
    </div>`;
}

function renderBlocks() {
  closeSlashMenu();
  hideInlineToolbar();
  hideInlineAssist();
  els.noteBody.innerHTML = state.blocks.map(renderBlockHtml).join("");
}

function blockWrapper(id) {
  return Array.from(els.noteBody.querySelectorAll(".block-wrapper"))
    .find((wrapper) => wrapper.dataset.blockId === id) ?? null;
}

function blockContentFor(id) {
  return blockWrapper(id)?.querySelector(".block-content") ?? null;
}

function blockIndex(id) {
  return state.blocks.findIndex((block) => block.id === id);
}

function syncBlockContent(id) {
  const content = blockContentFor(id);
  const index = blockIndex(id);
  if (!content || index === -1) return null;
  const block = state.blocks[index];
  block.content = sanitizeInlineHtml(content.innerHTML);
  content.classList.toggle("is-empty", blockIsEmpty(block.content));
  return block;
}

function syncActiveBlocks() {
  if (!state.activeNote) return;
  state.activeNote.blocks = state.blocks;
  state.activeNote.body = blocksToPlainText(state.blocks);
}

function currentSelectionBlock() {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;
  const node = selection.anchorNode;
  if (!node || !els.noteBody.contains(node)) return null;
  const content = node.nodeType === Node.ELEMENT_NODE
    ? node.closest(".block-content")
    : node.parentElement?.closest(".block-content");
  return content?.closest(".block-wrapper") ?? null;
}

function caretOffset(content) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return 0;
  const range = selection.getRangeAt(0);
  if (!content.contains(range.startContainer) && range.startContainer !== content) return 0;
  const before = document.createRange();
  before.selectNodeContents(content);
  before.setEnd(range.startContainer, range.startOffset);
  return plainTextFromDom(before.cloneContents()).length;
}

function selectionRangeFor(content, start, end) {
  const { text, tokens } = contentTextTokens(content);
  const pointAt = (offset) => {
    if (!tokens.length) return { node: content, offset: 0 };
    const target = Math.max(0, Math.min(Number(offset) || 0, text.length));
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (target < token.end || index === tokens.length - 1) {
        if (token.break) return { node: token.node, after: true };
        return { node: token.node, offset: Math.max(0, Math.min(target - token.start, token.node.nodeValue.length)) };
      }
    }
    return { node: content, offset: 0 };
  };

  const range = document.createRange();
  const startPoint = pointAt(start);
  const endPoint = pointAt(end);
  if (startPoint.after) range.setStartAfter(startPoint.node);
  else range.setStart(startPoint.node, startPoint.offset);
  if (endPoint.after) range.setEndAfter(endPoint.node);
  else range.setEnd(endPoint.node, endPoint.offset);
  return range;
}

function focusBlock(id, at = "end") {
  const content = blockContentFor(id);
  if (!content) return;
  content.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(content);
  range.collapse(at === "start");
  selection.removeAllRanges();
  selection.addRange(range);
  content.classList.toggle("is-empty", blockIsEmpty(content.innerHTML));
}

function focusBlockAt(id, offset) {
  const content = blockContentFor(id);
  if (!content) return;
  content.focus();
  const range = selectionRangeFor(content, offset, offset);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function positionFloating(element, rect, gap = 8) {
  element.hidden = false;
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  const maxLeft = Math.max(8, window.innerWidth - width - 8);
  const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, maxLeft));
  let top = rect.top - height - gap;
  if (top < 8) top = rect.bottom + gap;
  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(top)}px`;
}

function caretRect(content) {
  const selection = window.getSelection();
  if (selection?.rangeCount) {
    const rect = selection.getRangeAt(0).getClientRects()[0];
    if (rect) return rect;
  }
  return content.getBoundingClientRect();
}

function hideInlineToolbar() {
  els.inlineToolbar.hidden = true;
}

function selectedFormatElement(tagNames) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  const match = element?.closest?.(tagNames.join(","));
  if (!match || !els.noteBody.contains(match)) return null;
  if (!match.contains(range.startContainer) || !match.contains(range.endContainer)) return null;
  return match;
}

function updateInlineToolbarState() {
  const formatTags = {
    bold: ["strong", "b"],
    italic: ["em", "i"],
    underline: ["u"],
    strikeThrough: ["s", "strike"],
    code: ["code"],
  };
  for (const button of $$(".format-button", els.inlineToolbar)) {
    const active = Boolean(selectedFormatElement(formatTags[button.dataset.format] ?? []));
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function handleSelectionChange() {
  if (!state.activeNote || activeIsReadOnly() || state.slash.open || state.find.open) {
    hideInlineToolbar();
    return;
  }
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) {
    hideInlineToolbar();
    return;
  }
  const range = selection.getRangeAt(0);
  const wrapper = currentSelectionBlock();
  if (!wrapper || !range.toString().trim()) {
    hideInlineToolbar();
    return;
  }
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) {
    hideInlineToolbar();
    return;
  }
  positionFloating(els.inlineToolbar, rect, 9);
  updateInlineToolbarState();
}

const INLINE_FORMATS = {
  bold: ["strong", "b"],
  italic: ["em", "i"],
  underline: ["u"],
  strikeThrough: ["s", "strike"],
  code: ["code"],
};

function toggleInlineFormat(command) {
  const tags = INLINE_FORMATS[command];
  if (!tags) return false;
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  const existing = selectedFormatElement(tags);
  if (existing) {
    const parent = existing.parentNode;
    const first = existing.firstChild;
    const last = existing.lastChild;
    while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
    existing.remove();
    if (first && last) {
      const nextRange = document.createRange();
      nextRange.setStartBefore(first);
      nextRange.setEndAfter(last);
      selection.removeAllRanges();
      selection.addRange(nextRange);
    }
    return true;
  }
  if (range.collapsed) return false;

  const wrapper = document.createElement(tags[0]);
  try {
    range.surroundContents(wrapper);
  } catch {
    wrapper.append(range.extractContents());
    range.insertNode(wrapper);
  }
  const nextRange = document.createRange();
  nextRange.selectNodeContents(wrapper);
  selection.removeAllRanges();
  selection.addRange(nextRange);
  return true;
}

function applyInlineFormat(command) {
  if (!canEditActive()) return;
  const wrapper = currentSelectionBlock();
  if (!wrapper) return;
  if (!toggleInlineFormat(command)) return;
  syncBlockContent(wrapper.dataset.blockId);
  markDirty();
  updateInlineToolbarState();
  const selection = window.getSelection();
  if (selection?.rangeCount) positionFloating(els.inlineToolbar, selection.getRangeAt(0).getBoundingClientRect(), 9);
}

function openSlashMenu(blockId, start, end) {
  state.slash = { open: true, blockId, start, end, index: 0, options: [] };
  updateSlashMenu();
}

function closeSlashMenu() {
  state.slash = { open: false, blockId: null, start: 0, end: 0, index: 0, options: [] };
  els.slashMenu.hidden = true;
  els.slashOptions.innerHTML = "";
}

function updateSlashMenu() {
  if (!state.slash.open || !state.slash.blockId) {
    closeSlashMenu();
    return;
  }
  const content = blockContentFor(state.slash.blockId);
  if (!content) {
    closeSlashMenu();
    return;
  }
  const { text } = contentTextTokens(content);
  const start = state.slash.start;
  if (text[start] !== "/") {
    closeSlashMenu();
    return;
  }
  const caret = caretOffset(content);
  state.slash.end = Math.max(start + 1, Math.min(caret, text.length));
  const query = text.slice(start + 1, state.slash.end).toLocaleLowerCase();
  if (query.startsWith(" ") || query.length > 24) {
    closeSlashMenu();
    return;
  }
  const options = BLOCK_COMMANDS.filter((command) => {
    const haystack = [command.label, command.type, ...command.aliases].join(" ").toLocaleLowerCase();
    return !query || haystack.includes(query);
  });
  state.slash.options = options;
  state.slash.index = Math.max(0, Math.min(state.slash.index, options.length - 1));
  els.slashOptions.innerHTML = options.length
    ? options.map((command, index) => `
        <button class="slash-option${index === state.slash.index ? " is-active" : ""}" type="button" role="option" aria-selected="${index === state.slash.index}" data-block-type="${command.type}">
          <span class="slash-mark">${escapeHtml(command.mark)}</span>
          <span class="slash-copy"><strong>${escapeHtml(command.label)}</strong><small>${escapeHtml(command.description)}</small></span>
        </button>`).join("")
    : `<div class="slash-empty">No matching blocks</div>`;
  els.slashMenu.hidden = false;
  positionFloating(els.slashMenu, caretRect(content), 10);
}

function deleteTextRange(content, start, end) {
  const range = selectionRangeFor(content, start, end);
  range.deleteContents();
  const selection = window.getSelection();
  const collapsed = document.createRange();
  collapsed.setStart(range.startContainer, range.startOffset);
  collapsed.collapse(true);
  selection.removeAllRanges();
  selection.addRange(collapsed);
}

function selectSlashCommand(type) {
  if (!state.slash.open || !state.slash.blockId) return;
  const index = blockIndex(state.slash.blockId);
  const content = blockContentFor(state.slash.blockId);
  if (index === -1 || !content) {
    closeSlashMenu();
    return;
  }
  const start = state.slash.start;
  deleteTextRange(content, start, state.slash.end);
  const block = state.blocks[index];
  block.content = sanitizeInlineHtml(content.innerHTML);
  block.type = BLOCK_TYPES.has(type) ? type : "paragraph";
  block.properties = block.type === "todo" ? { checked: false } : {};
  closeSlashMenu();
  renderBlocks();
  focusBlockAt(block.id, start);
  markDirty();
}

function handleSlashClick(event) {
  const option = event.target.closest("[data-block-type]");
  if (!option) return;
  selectSlashCommand(option.dataset.blockType);
}

function moveSlashSelection(delta) {
  if (!state.slash.open || !state.slash.options.length) return;
  state.slash.index = (state.slash.index + delta + state.slash.options.length) % state.slash.options.length;
  const options = $$(".slash-option", els.slashOptions);
  options.forEach((option, index) => {
    option.classList.toggle("is-active", index === state.slash.index);
    option.setAttribute("aria-selected", String(index === state.slash.index));
  });
  options[state.slash.index]?.scrollIntoView({ block: "nearest" });
}

function insertBlockAfter(blockId, type = "paragraph") {
  const index = blockIndex(blockId);
  const block = createBlock(type);
  state.blocks.splice(index === -1 ? state.blocks.length : index + 1, 0, block);
  renderBlocks();
  focusBlock(block.id);
  markDirty();
  return block;
}

function deleteBlock(blockId) {
  const index = blockIndex(blockId);
  if (index === -1) return;
  if (state.blocks.length === 1) {
    state.blocks = [createBlock()];
  } else {
    state.blocks.splice(index, 1);
  }
  const focusTarget = state.blocks[Math.min(index, state.blocks.length - 1)];
  renderBlocks();
  if (focusTarget) focusBlock(focusTarget.id);
  markDirty();
}

function insertLineBreakAtSelection(content) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const br = document.createElement("br");
  range.insertNode(br);
  const nextRange = document.createRange();
  nextRange.setStartAfter(br);
  nextRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nextRange);
  content.classList.remove("is-empty");
}

function splitBlockAtCaret(blockId) {
  const content = blockContentFor(blockId);
  const index = blockIndex(blockId);
  if (!content || index === -1) return;
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!range.collapsed) range.deleteContents();
  const tailRange = range.cloneRange();
  tailRange.selectNodeContents(content);
  tailRange.setStart(range.endContainer, range.endOffset);
  const tail = tailRange.extractContents();
  const tailHolder = document.createElement("div");
  tailHolder.append(tail);
  const current = state.blocks[index];
  current.content = sanitizeInlineHtml(content.innerHTML);
  const nextType = ["bullet-list", "todo", "code-block"].includes(current.type) ? current.type : "paragraph";
  if (blockIsEmpty(current.content) && ["bullet-list", "todo", "callout"].includes(current.type)) {
    current.type = "paragraph";
    current.properties = {};
    renderBlocks();
    focusBlock(current.id, "start");
    markDirty();
    return;
  }
  const next = createBlock(nextType, tailHolder.innerHTML);
  state.blocks.splice(index + 1, 0, next);
  renderBlocks();
  focusBlock(next.id, "start");
  markDirty();
}

function convertBlockType(blockId, type) {
  const index = blockIndex(blockId);
  if (index === -1) return;
  const block = state.blocks[index];
  block.type = BLOCK_TYPES.has(type) ? type : "paragraph";
  block.properties = block.type === "todo" ? { checked: false } : {};
  renderBlocks();
  focusBlock(block.id, "start");
  markDirty();
}

function handleBlockInput(event) {
  const content = event.target.closest(".block-content");
  const wrapper = content?.closest(".block-wrapper");
  if (!content || !wrapper) return;
  const blockId = wrapper.dataset.blockId;
  syncBlockContent(blockId);
  syncActiveBlocks();
  markDirty();
  scheduleInlineAssist(blockId);

  if (state.slash.open && state.slash.blockId === blockId) {
    updateSlashMenu();
    return;
  }
  if (event.inputType === "insertText" && event.data === "/") {
    const offset = caretOffset(content);
    const { text } = contentTextTokens(content);
    const before = text.slice(0, offset - 1);
    if (!before || /\s$/.test(before)) openSlashMenu(blockId, offset - 1, offset);
  } else if (state.slash.open) {
    closeSlashMenu();
  }
}

function handleBlockKeyDown(event) {
  const content = event.target.closest(".block-content");
  const wrapper = content?.closest(".block-wrapper");
  if (!content || !wrapper) return;
  const blockId = wrapper.dataset.blockId;
  const index = blockIndex(blockId);
  if (index === -1) return;
  const block = state.blocks[index];

  if (state.slash.open && state.slash.blockId === blockId) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSlashSelection(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSlashSelection(-1);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const option = state.slash.options[state.slash.index];
      if (option) selectSlashCommand(option.type);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeSlashMenu();
      return;
    }
  }

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (block.type === "code-block") {
      insertLineBreakAtSelection(content);
      syncBlockContent(blockId);
      syncActiveBlocks();
      markDirty();
      return;
    }
    splitBlockAtCaret(blockId);
    return;
  }

  if (event.key === "Enter" && event.shiftKey) {
    event.preventDefault();
    insertLineBreakAtSelection(content);
    syncBlockContent(blockId);
    syncActiveBlocks();
    markDirty();
    return;
  }

  if (event.key === "Backspace") {
    const selection = window.getSelection();
    if (!selection || !selection.isCollapsed || caretOffset(content) !== 0) return;
    if (["heading-1", "heading-2", "bullet-list", "todo", "callout", "code-block"].includes(block.type)) {
      event.preventDefault();
      convertBlockType(blockId, "paragraph");
      return;
    }
    if (blockIsEmpty(block.content) && index > 0) {
      event.preventDefault();
      const previous = state.blocks[index - 1];
      state.blocks.splice(index, 1);
      renderBlocks();
      focusBlock(previous.id);
      markDirty();
    }
  }
}

function handleBlockPaste(event) {
  const content = event.target.closest(".block-content");
  if (!content) return;
  event.preventDefault();
  const text = event.clipboardData?.getData("text/plain") ?? "";
  if (!text) return;
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const fragment = document.createDocumentFragment();
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((line, index) => {
    if (index) fragment.append(document.createElement("br"));
    fragment.append(document.createTextNode(line));
  });
  const last = fragment.lastChild;
  range.insertNode(fragment);
  if (last) {
    const nextRange = document.createRange();
    nextRange.setStartAfter(last);
    nextRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(nextRange);
  }
  const wrapper = content.closest(".block-wrapper");
  syncBlockContent(wrapper.dataset.blockId);
  syncActiveBlocks();
  markDirty();
}

function handleBlockClick(event) {
  const toggle = event.target.closest("[data-action='toggle-todo']");
  if (toggle) {
    const wrapper = toggle.closest(".block-wrapper");
    const index = blockIndex(wrapper.dataset.blockId);
    if (index === -1) return;
    const block = state.blocks[index];
    block.properties = { ...block.properties, checked: !block.properties?.checked };
    wrapper.classList.toggle("is-checked", block.properties.checked);
    toggle.classList.toggle("is-checked", block.properties.checked);
    toggle.setAttribute("aria-pressed", String(block.properties.checked));
    toggle.setAttribute("aria-label", block.properties.checked ? "Mark incomplete" : "Mark complete");
    toggle.innerHTML = block.properties.checked ? icon("check") : "";
    markDirty();
    return;
  }
  const priority = event.target.closest("[data-action='cycle-priority']");
  if (priority) {
    const wrapper = priority.closest(".block-wrapper");
    const index = blockIndex(wrapper.dataset.blockId);
    if (index === -1) return;
    const block = state.blocks[index];
    const current = PRIORITY_VALUES.indexOf(block.properties?.priority);
    const next = current === -1 ? PRIORITY_VALUES[0] : PRIORITY_VALUES[current + 1];
    block.properties = { ...block.properties };
    if (next) block.properties.priority = next;
    else delete block.properties.priority;
    renderBlocks();
    markDirty();
    return;
  }
  const clearDue = event.target.closest("[data-action='clear-due']");
  if (clearDue) {
    const wrapper = clearDue.closest(".block-wrapper");
    const index = blockIndex(wrapper.dataset.blockId);
    if (index === -1) return;
    const block = state.blocks[index];
    block.properties = { ...block.properties };
    delete block.properties.dueDate;
    renderBlocks();
    markDirty();
    return;
  }
  const add = event.target.closest("[data-action='add']");
  if (add) {
    event.preventDefault();
    insertBlockAfter(add.closest(".block-wrapper").dataset.blockId);
    return;
  }
  const remove = event.target.closest("[data-action='delete-block']");
  if (remove) {
    event.preventDefault();
    deleteBlock(remove.closest(".block-wrapper").dataset.blockId);
  }
}

function handleTodoDateChange(event) {
  const input = event.target.closest("[data-action='set-due']");
  if (!input) return;
  const wrapper = input.closest(".block-wrapper");
  if (!wrapper) return;
  const index = blockIndex(wrapper.dataset.blockId);
  if (index === -1) return;
  const block = state.blocks[index];
  const dueDate = parseDateKey(input.value) ? input.value : "";
  block.properties = { ...block.properties };
  if (dueDate) block.properties.dueDate = dueDate;
  else delete block.properties.dueDate;
  renderBlocks();
  markDirty();
}

function clearDropIndicators() {
  $$(".is-drop-before, .is-drop-after", els.noteBody).forEach((wrapper) => {
    wrapper.classList.remove("is-drop-before", "is-drop-after");
  });
}

function handleBlockDragStart(event) {
  const handle = event.target.closest(".block-handle");
  const wrapper = handle?.closest(".block-wrapper");
  if (!wrapper) return;
  state.draggingBlockId = wrapper.dataset.blockId;
  wrapper.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", state.draggingBlockId);
  event.dataTransfer.setDragImage(wrapper, 18, 18);
}

function handleBlockDragOver(event) {
  if (!state.draggingBlockId) return;
  const target = event.target.closest(".block-wrapper") ?? els.noteBody.querySelector(".block-wrapper:last-of-type");
  if (!target) {
    clearDropIndicators();
    state.dropTarget = null;
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  if (target.dataset.blockId === state.draggingBlockId) {
    clearDropIndicators();
    state.dropTarget = null;
    return;
  }
  const rect = target.getBoundingClientRect();
  const after = event.clientY > rect.top + rect.height / 2;
  clearDropIndicators();
  target.classList.add(after ? "is-drop-after" : "is-drop-before");
  state.dropTarget = { id: target.dataset.blockId, after };
}

function handleBlockDrop(event) {
  if (!state.draggingBlockId || !state.dropTarget) return;
  event.preventDefault();
  const from = blockIndex(state.draggingBlockId);
  if (from === -1) {
    finishBlockDrag();
    return;
  }
  const [moved] = state.blocks.splice(from, 1);
  const targetIndex = blockIndex(state.dropTarget.id);
  const insertAt = targetIndex === -1
    ? state.blocks.length
    : targetIndex + (state.dropTarget.after ? 1 : 0);
  state.blocks.splice(insertAt, 0, moved);
  finishBlockDrag();
  renderBlocks();
  markDirty();
}

function finishBlockDrag() {
  state.draggingBlockId = null;
  state.dropTarget = null;
  clearDropIndicators();
  $$(".is-dragging", els.noteBody).forEach((wrapper) => wrapper.classList.remove("is-dragging"));
}

function handleBlockDragEnd() {
  finishBlockDrag();
}

function applyBootstrap(data) {
  state.bootstrap = {
    folders: Array.isArray(data?.folders) ? data.folders : [],
    tags: Array.isArray(data?.tags) ? data.tags : [],
    stats: data?.stats ?? {},
    suggestions: Array.isArray(data?.suggestions) ? data.suggestions : [],
  };
  renderSidebar();
  updateListHeader();
}

async function loadBootstrap() {
  const data = await request("/api/bootstrap");
  applyBootstrap(data);
}

function renderSidebar() {
  const stats = state.bootstrap.stats ?? {};
  els.allCount.textContent = String(stats.total ?? 0);
  els.attachmentsCount.textContent = String(stats.attachments ?? 0);
  els.pinnedCount.textContent = String(stats.pinned ?? 0);
  els.lockedCount.textContent = String(stats.locked ?? 0);

  const folders = state.bootstrap.folders.filter(
    (folder) => Number(folder.count) > 0 || folder.name === state.activeFolder,
  );

  els.folderList.innerHTML = folders.length
    ? folders
        .map(
          (folder) => `
            <button class="nav-row" type="button" data-folder="${escapeHtml(folder.name)}">
              <span class="nav-row-main">
                ${icon("folder")}
                <span>${escapeHtml(folder.name)}</span>
              </span>
              <span class="count">${Number(folder.count) || 0}</span>
            </button>`,
        )
        .join("")
    : `<div class="pinned-empty">No folders yet</div>`;

  const tags = state.bootstrap.tags.slice(0, 40);
  els.tagList.innerHTML = tags.length
    ? tags
        .map(
          (entry) => `
            <button class="tag-button" type="button" data-tag="${escapeHtml(entry.tag)}" title="${Number(entry.count) || 0} notes">
              #${escapeHtml(entry.tag)}
            </button>`,
        )
        .join("")
    : `<div class="pinned-empty">No tags yet</div>`;

  updateNavSelection();
}

function updateNavSelection() {
  const allActive = !state.activeFolder && !state.activeTag && !state.smartFilter;
  $$("[data-library]").forEach((button) => button.classList.toggle("is-active", allActive));
  $$("[data-folder]").forEach((button) =>
    button.classList.toggle("is-active", button.dataset.folder === state.activeFolder),
  );
  $$("[data-smart]").forEach((button) =>
    button.classList.toggle("is-active", button.dataset.smart === state.smartFilter),
  );
  $$("[data-tag]").forEach((button) =>
    button.classList.toggle("is-active", button.dataset.tag === state.activeTag),
  );
}

function renderPinnedPreview(notes) {
  const pinned = Array.isArray(notes) ? notes.slice(0, 6) : [];
  state.pinnedNotes = pinned;
  els.pinnedList.innerHTML = pinned.length
    ? pinned
        .map(
          (note) => `
            <button class="pinned-item" type="button" data-pinned-id="${note.id}">
              ${icon(note.locked ? "lock" : "pin")}
              <span>${escapeHtml(note.title)}</span>
            </button>`,
        )
        .join("")
    : `<div class="pinned-empty">No pinned notes</div>`;
}

async function loadPinnedPreview() {
  try {
    const data = await request("/api/notes?pinned=1&limit=6");
    renderPinnedPreview(data.notes);
  } catch {
    renderPinnedPreview([]);
  }
}

function buildListParams() {
  const params = new URLSearchParams({ limit: "200" });
  if (state.activeFolder) params.set("folder", state.activeFolder);
  if (state.activeTag) params.set("tag", state.activeTag);
  if (state.smartFilter === "attachments") params.set("hasAttachments", "1");
  if (state.smartFilter === "pinned") params.set("pinned", "1");
  if (state.smartFilter === "locked") params.set("locked", "1");
  return params;
}

async function loadNotes({ selectFirst = false } = {}) {
  if (state.search.active) return;

  try {
    const data = await request(`/api/notes?${buildListParams().toString()}`);
    state.notes = Array.isArray(data.notes) ? data.notes : [];
    renderNotes();
    updateListHeader();
    els.listEmpty.hidden = state.notes.length > 0;
    els.notesList.hidden = state.notes.length === 0;

    if (selectFirst && !state.activeNote && state.notes.length) {
      await openNote(state.notes[0].id);
    }
  } catch (error) {
    handleError(error);
  }
}

function renderNotes() {
  if (!state.notes.length) {
    els.notesList.innerHTML = "";
    return;
  }

  els.notesList.innerHTML = state.notes
    .map((note) => {
      const meta = [
        `<span class="card-folder">${escapeHtml(note.folder)}</span>`,
        note.attachmentCount ? `<span>${icon("paperclip")}${note.attachmentCount}</span>` : "",
        note.locked ? `<span>${icon("lock")}Locked</span>` : "",
        note.pinned ? `<span>${icon("pin")}Pinned</span>` : "",
      ]
        .filter(Boolean)
        .join("");

      return `
        <button class="note-card" type="button" data-id="${note.id}">
          <div class="card-topline">
            <h2>${escapeHtml(note.title)}</h2>
            <span class="card-date">${escapeHtml(shortDate(note.updatedAt))}</span>
          </div>
          <p class="card-preview">${escapeHtml(note.preview)}</p>
          <div class="card-meta">${meta}</div>
        </button>`;
    })
    .join("");

  updateActiveStates();
}

function updateListHeader() {
  let title = "All notes";
  let subtitle = `${plural(Number(state.bootstrap.stats.total) || 0, "note")} · Search-ready`;

  if (state.search.active) {
    title = "Search";
    const scope = state.search.scope === "folder" && state.activeFolder ? ` in ${state.activeFolder}` : " across all notes";
    subtitle = `Results for “${state.search.query || "…"}”${scope}`;
  } else if (state.smartFilter === "attachments") {
    title = "With attachments";
    subtitle = plural(state.notes.length, "note") + " with indexed attachment text";
  } else if (state.smartFilter === "pinned") {
    title = "Pinned notes";
    subtitle = plural(state.notes.length, "pinned note");
  } else if (state.smartFilter === "locked") {
    title = "Locked notes";
    subtitle = plural(state.notes.length, "locked note") + " · only titles are searchable";
  } else if (state.activeTag) {
    title = `#${state.activeTag}`;
    subtitle = plural(state.notes.length, "note") + " with this tag";
  } else if (state.activeFolder) {
    title = state.activeFolder;
    subtitle = plural(state.notes.length, "note") + " in this folder";
  }

  els.listTitle.textContent = title;
  els.listSubtitle.textContent = subtitle;
}

function setSearchMode(active) {
  state.search.active = active;
  els.searchResults.hidden = !active;
  els.notesList.hidden = active;
  els.searchOptions.hidden = !active;
  els.scopeButton.hidden = !state.activeFolder;
  if (active) els.listEmpty.hidden = true;
  updateListHeader();
}

function resetSearch() {
  clearTimeout(state.searchTimer);
  state.search.seq += 1;
  state.search.active = false;
  state.search.query = "";
  state.search.results = [];
  state.search.total = 0;
  state.search.tookMs = 0;
  state.search.scope = "all";
  els.searchInput.value = "";
  els.clearSearch.hidden = true;
  els.searchResults.innerHTML = "";
  els.searchStatus.textContent = "";
  els.scopeLabel.textContent = "All notes";
  setSearchMode(false);
}

function exitSearch({ reload = true } = {}) {
  resetSearch();
  if (reload) loadNotes();
}

function searchParams(query) {
  const params = new URLSearchParams({ q: query, scope: state.search.scope });
  if (state.search.scope === "folder" && state.activeFolder) {
    params.set("folder", state.activeFolder);
  }
  if (state.smartFilter === "attachments") params.set("hasAttachments", "1");
  if (state.smartFilter === "pinned") params.set("pinned", "1");
  if (state.smartFilter === "locked") params.set("locked", "1");
  if (state.activeTag) params.set("tag", state.activeTag);
  return params;
}

async function runSearch(query, { silent = false } = {}) {
  const normalized = String(query ?? "").trim();
  if (!normalized) {
    exitSearch();
    return;
  }

  state.search.query = normalized;
  state.search.active = true;
  state.search.seq += 1;
  const sequence = state.search.seq;
  setSearchMode(true);
  els.scopeLabel.textContent = state.search.scope === "folder" && state.activeFolder ? state.activeFolder : "All notes";
  els.searchStatus.textContent = "Searching…";
  els.searchResults.setAttribute("aria-busy", "true");
  if (!silent) els.searchResults.innerHTML = "";

  try {
    const data = await request(`/api/search?${searchParams(normalized).toString()}`);
    if (sequence !== state.search.seq) return;

    state.search.results = Array.isArray(data.results) ? data.results : [];
    state.search.total = Number(data.count) || 0;
    state.search.tookMs = Number(data.tookMs) || 0;
    renderSearchResults();
  } catch (error) {
    if (sequence !== state.search.seq) return;
    els.searchStatus.textContent = "Search unavailable";
    handleError(error);
  } finally {
    if (sequence === state.search.seq) {
      els.searchResults.setAttribute("aria-busy", "false");
    }
  }
}

function renderSearchResults() {
  const results = state.search.results;
  const total = state.search.total;
  const elapsed = Math.max(1, Math.round(state.search.tookMs));
  els.searchStatus.textContent = total
    ? `${plural(total, "result")} · ${elapsed} ms`
    : `No results · ${elapsed} ms`;

  if (!results.length) {
    els.searchResults.innerHTML = `
      <div class="search-empty">
        <div class="empty-orbit">${icon("search")}</div>
        <h2>No notes found</h2>
        <p>Try a shorter prefix, another phrase, or turn off a filter.</p>
        <div class="try-searches">
          <span>Try</span>
          <button class="chip" type="button" data-try="receipt">receipt</button>
          <button class="chip" type="button" data-try="search">search</button>
          <button class="chip" type="button" data-try="kuber">kuber</button>
        </div>
      </div>`;
    return;
  }

  els.searchResults.innerHTML = results
    .map((result) => {
      const meta = [
        `<span class="card-folder">${escapeHtml(result.folder)}</span>`,
        result.attachmentCount ? `<span>${icon("paperclip")}${result.attachmentCount}</span>` : "",
        result.locked ? `<span>${icon("lock")}Locked</span>` : "",
      ]
        .filter(Boolean)
        .join("");

      return `
        <button class="result-card" type="button" data-id="${result.id}">
          <div class="card-topline">
            <h2>${renderSegments(result.titleSegments, result.title)}</h2>
            <span class="card-date">${escapeHtml(shortDate(result.updatedAt))}</span>
          </div>
          <p class="result-snippet">${renderSegments(result.snippetSegments, "")}</p>
          <div class="card-meta">
            ${meta}
            <span class="result-label">${escapeHtml(result.snippetLabel)}</span>
          </div>
        </button>`;
    })
    .join("");

  updateActiveStates();
}

function updateActiveStates() {
  $$(".note-card, .result-card").forEach((card) => {
    card.classList.toggle("is-active", Number(card.dataset.id) === state.activeId);
  });
}

function renderEditor() {
  const note = state.activeNote;
  if (!note) {
    clearEditor();
    return;
  }

  els.editorEmpty.hidden = true;
  els.editor.hidden = false;
  const readable = !activeIsReadOnly();

  els.editorFolder.textContent = note.folder || "Notes";
  els.editorLockBadge.hidden = !note.locked;
  els.pinButton.classList.toggle("is-active", Boolean(note.pinned));
  els.pinButton.title = note.pinned ? "Unpin note" : "Pin note";
  els.pinButton.setAttribute("aria-label", els.pinButton.title);
  els.exportButton.disabled = !readable;
  els.exportButton.title = readable ? "Export note" : "Unlock the note to export it";
  els.findToggle.hidden = !readable;
  updateAssistantAvailability();
  els.noteStorage.textContent = note.locked ? "Encrypted at rest" : "Local SQLite · indexed";
  els.noteId.textContent = `Note ${note.id}`;
  els.noteCreated.textContent = note.createdAt ? `Created ${fullDate(note.createdAt)}` : "";
  els.noteUpdated.textContent = note.updatedAt ? `Updated ${relativeTime(note.updatedAt)}` : "";

  if (note.locked && state.sessionUnlocks.has(note.id)) {
    setButtonIcon(els.lockButton, "unlock");
    els.lockButton.title = "Remove lock";
    els.lockButton.setAttribute("aria-label", "Remove lock");
  } else if (note.locked) {
    setButtonIcon(els.lockButton, "lock");
    els.lockButton.title = "Unlock note";
    els.lockButton.setAttribute("aria-label", "Unlock note");
  } else {
    setButtonIcon(els.lockButton, "lock");
    els.lockButton.title = "Lock note";
    els.lockButton.setAttribute("aria-label", "Lock note");
  }

  if (!readable) {
    closeFind();
    els.lockedPanel.hidden = false;
    els.editorContent.hidden = true;
    els.lockedTitle.textContent = note.title;
    const count = Number(note.attachmentCount) || 0;
    els.lockedCopy.textContent = count
      ? `Only the title and attachment count are searchable until you unlock this note. ${plural(count, "attachment")} stay encrypted.`
      : "Only the title is searchable until you unlock this note.";
    els.unlockForm.reset();
    els.unlockError.textContent = "";
    refreshSaveIndicators();
    return;
  }

  els.lockedPanel.hidden = true;
  els.editorContent.hidden = false;
  els.noteTitle.value = note.title ?? "";
  state.blocks = Array.isArray(note.blocks)
    ? normalizeClientBlocks(note.blocks)
    : blocksFromPlainText(note.body);
  if (!state.blocks.length) state.blocks = [createBlock()];
  note.blocks = state.blocks;
  els.findToggle.classList.toggle("is-active", state.find.open);
  renderBlocks();
  renderAttachmentList();
  renderTags();
  refreshSaveIndicators();
}

function clearEditor() {
  state.activeNote = null;
  state.activeId = null;
  state.blocks = [];
  state.dirty = false;
  closeFind();
  closeAssistant();
  closeContextMenu();
  closeSlashMenu();
  hideInlineToolbar();
  hideInlineAssist();
  clearInlineAssistHighlight();
  els.editor.hidden = true;
  els.editorEmpty.hidden = false;
  els.app.classList.remove("editor-open");
  updateActiveStates();
}

function renderTags() {
  const tags = Array.isArray(state.activeNote?.tags) ? state.activeNote.tags : [];
  els.noteTags.innerHTML = tags.length
    ? tags.map((tag) => `<span class="note-tag">#${escapeHtml(tag)}</span>`).join("")
    : `<span class="subtle">No tags on this note</span>`;
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function renderAttachmentList() {
  const attachments = Array.isArray(state.activeNote?.attachments) ? state.activeNote.attachments : [];
  const editable = canEditActive();
  els.attachmentCount.textContent = attachments.length ? plural(attachments.length, "file") : "";
  els.addAttachment.disabled = !editable || state.uploadingAttachments;
  els.addAttachment.innerHTML = `${icon("plus")}${state.uploadingAttachments ? "Adding…" : "Add file"}`;

  if (!attachments.length) {
    els.attachmentList.innerHTML = `<div class="attachment-empty">No attachments on this note.</div>`;
    return;
  }

  const activeMatch = state.find.matches[state.find.index];
  const markQuery = state.find.open && state.find.includeAttachments ? state.find.query : "";

  els.attachmentList.innerHTML = attachments
    .map((attachment, index) => {
      const shouldOpen = activeMatch?.kind === "attachment" && activeMatch.attachmentIndex === index;
      const text = String(attachment?.text ?? "");
      const size = formatBytes(attachment?.size);
      const kind = [attachment?.kind || "file", size].filter(Boolean).join(" · ");
      const hasFile = typeof attachment?.data === "string" && attachment.data.length > 0;
      const textHtml = text
        ? `<p class="attachment-text">${markQuery ? highlightText(text, markQuery) : escapeHtml(text)}</p>`
        : `<p class="attachment-text is-empty" hidden></p>`;
      return `
        <details class="attachment-card" data-attachment-index="${index}" ${shouldOpen ? "open" : ""}>
          <summary>
            <span class="attachment-icon">${icon("paperclip")}</span>
            <span class="attachment-name">${escapeHtml(attachment?.filename || "attachment")}</span>
            <span class="attachment-kind">${escapeHtml(kind)}</span>
          </summary>
          <div class="attachment-body">
            ${textHtml}
            <div class="attachment-actions">
              ${hasFile ? `<button class="attachment-action" type="button" data-attachment-download="${index}">${icon("download")}Download</button>` : ""}
              <button class="attachment-action is-danger" type="button" data-attachment-remove="${index}" ${editable ? "" : "disabled"}>${icon("trash")}Remove</button>
            </div>
          </div>
        </details>`;
    })
    .join("");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

async function addAttachments(files) {
  const note = state.activeNote;
  const chosen = Array.from(files ?? []);
  if (!note || !canEditActive() || !chosen.length || state.uploadingAttachments) return;

  state.uploadingAttachments = true;
  renderAttachmentList();
  let added = 0;
  try {
    for (const file of chosen) {
      if (file.size > 10 * 1024 * 1024) {
        showToast(`${file.name} is larger than 10 MB.`, true);
        continue;
      }
      const data = await readFileAsDataUrl(file);
      const result = await request(`/api/notes/${note.id}/attachments`, {
        method: "POST",
        body: {
          filename: file.name,
          mime: file.type,
          data,
          ...(note.locked ? { passphrase: state.sessionUnlocks.get(note.id) } : {}),
        },
      });
      if (state.activeNote?.id !== note.id) return;
      const serverAttachments = Array.isArray(result.note?.attachments) ? result.note.attachments : null;
      const localAttachments = Array.isArray(state.activeNote.attachments) ? state.activeNote.attachments : [];
      state.activeNote.attachments = serverAttachments ?? [...localAttachments, result.attachment];
      state.activeNote.attachmentCount = state.activeNote.attachments.length;
      added += 1;
      renderAttachmentList();
    }
    if (added) {
      scheduleLibraryRefresh();
      showToast(added === 1 ? "Attachment added." : `${added} attachments added.`);
    }
  } catch (error) {
    handleError(error);
  } finally {
    state.uploadingAttachments = false;
    if (state.activeNote) renderAttachmentList();
  }
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "download";
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function downloadAttachment(index) {
  const attachment = state.activeNote?.attachments?.[index];
  if (!attachment?.data) {
    showToast("This attachment has no stored file.", true);
    return;
  }
  try {
    const encoded = String(attachment.data).replace(/^data:[^,]*,/i, "");
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let offset = 0; offset < binary.length; offset += 1) {
      bytes[offset] = binary.charCodeAt(offset);
    }
    downloadBlob(
      attachment.filename || "attachment",
      new Blob([bytes], { type: attachment.mime || "application/octet-stream" }),
    );
  } catch {
    showToast("Could not prepare that attachment.", true);
  }
}

async function removeAttachment(index) {
  const note = state.activeNote;
  const attachment = note?.attachments?.[index];
  if (!note || !attachment || !canEditActive()) return;
  const confirmed = await askConfirm({
    title: "Remove this attachment?",
    copy: `“${attachment.filename || "Attachment"}” will be removed from this note.`,
    label: "Remove",
  });
  if (!confirmed) return;

  try {
    const result = await request(`/api/notes/${note.id}/attachments/${index}`, {
      method: "DELETE",
      body: note.locked ? { passphrase: state.sessionUnlocks.get(note.id) } : {},
    });
    if (state.activeNote?.id !== note.id) return;
    const serverAttachments = Array.isArray(result.note?.attachments) ? result.note.attachments : null;
    state.activeNote.attachments = serverAttachments
      ?? state.activeNote.attachments.filter((_, itemIndex) => itemIndex !== index);
    state.activeNote.attachmentCount = state.activeNote.attachments.length;
    closeFind();
    renderAttachmentList();
    scheduleLibraryRefresh();
    showToast("Attachment removed.");
  } catch (error) {
    handleError(error);
  }
}

function inlineMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const inner = Array.from(node.childNodes, inlineMarkdown).join("");
  const tag = node.nodeName;
  if (tag === "BR") return "\n";
  if (tag === "STRONG") return `**${inner}**`;
  if (tag === "EM") return `*${inner}*`;
  if (tag === "S") return `~~${inner}~~`;
  if (tag === "CODE") return `\`${inner}\``;
  if (tag === "U") return `<u>${inner}</u>`;
  return inner;
}

function blockMarkdown(block) {
  const template = document.createElement("template");
  template.innerHTML = sanitizeInlineHtml(block.content);
  const text = Array.from(template.content.childNodes, inlineMarkdown).join("").trimEnd();
  const prefixLines = (prefix) => text.split("\n").map((line) => `${prefix}${line}`).join("\n");

  if (block.type === "heading-1") return `# ${text}`;
  if (block.type === "heading-2") return `## ${text}`;
  if (block.type === "bullet-list") return prefixLines("- ");
  if (block.type === "todo") {
    const due = block.properties?.dueDate ? ` (due ${block.properties.dueDate})` : "";
    const priority = block.properties?.priority ? ` (${block.properties.priority} priority)` : "";
    return `- [${block.properties?.checked ? "x" : " "}] ${text}${due}${priority}`;
  }
  if (block.type === "code-block") {
    return `\`\`\`\n${blockPlainText(block.content)}\n\`\`\``;
  }
  if (block.type === "callout") return prefixLines("> ");
  return text;
}

function exportFilename(note, extension) {
  const base = String(note?.title || "note")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "note";
  return `${base}.${extension}`;
}

const DESIGN_STATUS_STEPS = [
  "Reading the note and its attachments…",
  "Choosing a palette and typography…",
  "Composing the page layout…",
  "Balancing the cover, content, and appendix…",
  "Finishing the export…",
];

function showDesignOverlay() {
  clearInterval(state.designStatusTimer);
  state.exportDesigning = true;
  els.designPanel.classList.remove("is-error", "is-done");
  els.designKicker.textContent = "AI page design";
  els.designTitle.textContent = "Designing your export";
  els.designCopy.textContent =
    "The AI is choosing a layout and palette for this note. Your download starts automatically when the design is ready.";
  els.designStatus.textContent = DESIGN_STATUS_STEPS[0];
  els.designClose.hidden = true;
  els.designOverlay.hidden = false;
  let step = 0;
  state.designStatusTimer = setInterval(() => {
    step = Math.min(step + 1, DESIGN_STATUS_STEPS.length - 1);
    els.designStatus.textContent = DESIGN_STATUS_STEPS[step];
  }, 3200);
}

function closeDesignOverlay() {
  if (state.exportDesigning) return;
  clearInterval(state.designStatusTimer);
  state.designStatusTimer = null;
  els.designOverlay.hidden = true;
}

function showDesignComplete(design) {
  clearInterval(state.designStatusTimer);
  state.designStatusTimer = null;
  state.exportDesigning = false;
  els.designPanel.classList.add("is-done");
  els.designKicker.textContent = "Design ready";
  els.designTitle.textContent = "Your page is ready";
  els.designCopy.textContent = "The designed HTML file is downloading now.";
  els.designStatus.textContent = design?.themeName ? `Theme: ${design.themeName}` : "Design complete.";
}

function showDesignFailure(error) {
  clearInterval(state.designStatusTimer);
  state.designStatusTimer = null;
  state.exportDesigning = false;
  if (error?.code === "network_error") startServerRecovery();
  els.designPanel.classList.add("is-error");
  els.designKicker.textContent = "Export interrupted";
  els.designTitle.textContent = "Design could not finish";
  els.designCopy.textContent =
    error?.message || "The AI could not design this export. Your note was not changed.";
  els.designStatus.textContent = "No file was downloaded.";
  els.designClose.hidden = false;
  els.designClose.focus();
}

async function exportDesignedHtml(note) {
  if (state.exportDesigning) return;
  showDesignOverlay();
  try {
    const result = await request(`/api/notes/${note.id}/export/html`, { method: "POST" });
    if (!result?.html) throw new Error("The AI did not return an HTML file.");
    showDesignComplete(result.design);
    await new Promise((resolve) => setTimeout(resolve, 650));
    downloadBlob(
      result.filename || exportFilename(note, "html"),
      new Blob([result.html], { type: "text/html;charset=utf-8" }),
    );
    showToast(`AI-designed export downloaded for “${note.title || "Untitled note"}”.`);
    closeDesignOverlay();
  } catch (error) {
    showDesignFailure(error);
  }
}

async function exportActiveNote(format) {
  if (!(await saveBeforeLeave())) return;
  const note = state.activeNote;
  if (!note || activeIsReadOnly()) return;
  if (format === "html") {
    await exportDesignedHtml(note);
    return;
  }
  const exportedAt = new Date().toISOString();
  if (format === "md") {
    downloadBlob(
      exportFilename(note, "md"),
      new Blob([noteMarkdown(note)], { type: "text/markdown;charset=utf-8" }),
    );
  } else {
    const payload = { app: "knotes", version: 1, exportedAt, note };
    downloadBlob(
      exportFilename(note, "json"),
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    );
  }
  showToast(`Exported “${note.title || "Untitled note"}”.`);
}

async function exportLibrary() {
  try {
    const backup = await request("/api/export");
    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(
      `knotes-backup-${date}.json`,
      new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }),
    );
    showToast("Library exported.");
  } catch (error) {
    handleError(error);
  }
}

function openExportMenu() {
  if (!state.activeNote || activeIsReadOnly()) return;
  const rect = els.exportButton.getBoundingClientRect();
  openContextMenu(rect.left, rect.bottom + 5, [
    { label: "Export note as Markdown", icon: "download", onSelect: () => exportActiveNote("md") },
    { label: "Export note as HTML", icon: "download", onSelect: () => exportActiveNote("html") },
    { label: "Export note as JSON", icon: "download", onSelect: () => exportActiveNote("json") },
    { separator: true },
    { label: "Export library backup", icon: "download", onSelect: exportLibrary },
  ]);
}

function refreshSaveIndicators() {
  const note = state.activeNote;
  let label = "Saved";
  if (note?.locked && !state.sessionUnlocks.has(note.id)) {
    label = "Locked";
  } else if (state.saving) {
    label = "Saving…";
  } else if (state.dirty) {
    label = "Unsaved";
  } else if (note?.locked) {
    label = "Unlocked this session";
  }

  els.saveState.textContent = label;
  els.saveState.classList.toggle("is-dirty", label === "Unsaved" || label === "Saving…");
  els.editorState.textContent = label;
}

function markDirty() {
  if (!canEditActive()) return;
  state.activeNote.title = els.noteTitle.value;
  syncActiveBlocks();
  state.dirty = true;
  refreshSaveIndicators();
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    state.saveTimer = null;
    saveActive();
  }, 550);
}

async function performSave() {
  const active = state.activeNote;
  if (!active || !canEditActive()) return true;

  const payload = {
    title: els.noteTitle.value,
    blocks: state.blocks,
    body: blocksToPlainText(state.blocks),
    folder: active.folder,
    pinned: Boolean(active.pinned),
  };
  if (active.locked) payload.passphrase = state.sessionUnlocks.get(active.id);

  state.dirty = false;
  state.saving = true;
  refreshSaveIndicators();

  try {
    const { note } = await request(`/api/notes/${active.id}`, { method: "PUT", body: payload });
    if (state.activeNote?.id !== note.id) return true;

    const localTitle = els.noteTitle.value;
    const localBlocks = state.blocks;
    const localAttachments = state.activeNote.attachments;
    state.activeNote = {
      ...note,
      title: localTitle,
      blocks: localBlocks,
      body: blocksToPlainText(localBlocks),
      attachments: Array.isArray(note.attachments) && !note.locked ? note.attachments : localAttachments,
    };
    els.noteUpdated.textContent = `Updated ${relativeTime(note.updatedAt)}`;
    renderTags();
    refreshSaveIndicators();
    scheduleLibraryRefresh();
    return true;
  } catch (error) {
    state.dirty = true;
    refreshSaveIndicators();
    handleError(error);
    return false;
  } finally {
    state.saving = false;
    if (state.activeNote) refreshSaveIndicators();
  }
}

async function saveActive() {
  if (!canEditActive()) return true;
  if (state.savePromise) {
    await state.savePromise;
    if (!state.dirty) return true;
  }
  if (!state.dirty) return true;

  const promise = performSave();
  state.savePromise = promise;
  try {
    return await promise;
  } finally {
    if (state.savePromise === promise) state.savePromise = null;
  }
}

async function saveBeforeLeave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  while (state.dirty && canEditActive()) {
    const saved = await saveActive();
    if (!saved) return false;
  }
  return true;
}

async function openNote(id, options = {}) {
  if (state.activeId === id && !options.force) {
    if (options.findQuery && canEditActive()) openFind(options.findQuery, true);
    if (isMobile()) els.app.classList.add("editor-open");
    return;
  }

  if (!(await saveBeforeLeave())) return;

  try {
    let { note } = await request(`/api/notes/${id}`);

    if (note.locked && state.sessionUnlocks.has(id)) {
      try {
        const unlocked = await request(`/api/notes/${id}/unlock`, {
          method: "POST",
          body: { passphrase: state.sessionUnlocks.get(id) },
        });
        note = {
          ...note,
          body: unlocked.body ?? "",
          blocks: Array.isArray(unlocked.blocks) ? unlocked.blocks : null,
          attachments: Array.isArray(unlocked.attachments) ? unlocked.attachments : [],
        };
      } catch {
        state.sessionUnlocks.delete(id);
      }
    } else if (!note.locked) {
      state.sessionUnlocks.delete(id);
    }

    state.activeNote = note;
    state.activeId = note.id;
    state.dirty = false;
    state.saving = false;
    closeFind();
    closeAssistant();
    closeContextMenu();
    renderEditor();
    updateActiveStates();
    closeSidebar();
    if (isMobile()) els.app.classList.add("editor-open");

    if (options.focusTitle) {
      els.noteTitle.focus();
      els.noteTitle.select();
    }
    if (options.findQuery && canEditActive()) {
      openFind(options.findQuery, true);
    }
  } catch (error) {
    handleError(error);
  }
}

async function newNote() {
  if (!(await saveBeforeLeave())) return;
  resetSearch();
  state.smartFilter = "";
  state.activeTag = "";
  const folder = state.activeFolder || "Notes";

  try {
    const { note } = await request("/api/notes", {
      method: "POST",
      body: { title: "Untitled note", body: "", blocks: [createBlock()], folder },
    });
    await loadBootstrap();
    await loadNotes();
    await loadPinnedPreview();
    await openNote(note.id, { focusTitle: true });
  } catch (error) {
    handleError(error);
  }
}

function noteSummaryById(id) {
  const matches = [
    ...state.notes,
    ...state.pinnedNotes,
    ...(state.search.active ? state.search.results : []),
  ];
  const found = matches.find((note) => Number(note.id) === Number(id));
  if (found) {
    return {
      id: Number(found.id),
      title: found.title || "Untitled note",
      pinned: Boolean(found.pinned),
    };
  }
  if (Number(state.activeNote?.id) === Number(id)) {
    return {
      id: Number(id),
      title: state.activeNote.title || "Untitled note",
      pinned: Boolean(state.activeNote.pinned),
    };
  }
  return { id: Number(id), title: `Note ${id}`, pinned: false };
}

function closeContextMenu() {
  els.contextMenu.hidden = true;
  els.contextMenu.innerHTML = "";
  state.contextMenuItems = [];
}

function openContextMenu(x, y, items) {
  closeContextMenu();
  if (!items?.length) return;
  state.contextMenuItems = items;
  els.contextMenu.innerHTML = items
    .map((item, index) =>
      item.separator
        ? `<div class="context-menu-separator" role="separator"></div>`
        : `<button class="context-menu-item${item.danger ? " is-danger" : ""}" type="button" role="menuitem" data-menu-index="${index}">
            ${item.icon ? icon(item.icon) : ""}
            <span>${escapeHtml(item.label)}</span>
          </button>`,
    )
    .join("");
  els.contextMenu.hidden = false;

  const rect = els.contextMenu.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
  els.contextMenu.style.left = `${left}px`;
  els.contextMenu.style.top = `${top}px`;
  els.contextMenu.querySelector("button")?.focus({ preventScroll: true });
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    showToast("Copied to clipboard.");
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    showToast("Copied to clipboard.");
  }
}

async function togglePinnedNote(note) {
  try {
    const { note: updated } = await request(`/api/notes/${note.id}`, {
      method: "PUT",
      body: { pinned: !note.pinned },
    });
    if (Number(state.activeId) === Number(note.id) && state.activeNote) {
      state.activeNote.pinned = updated.pinned;
      els.pinButton.classList.toggle("is-active", Boolean(updated.pinned));
      els.pinButton.title = updated.pinned ? "Unpin note" : "Pin note";
      els.pinButton.setAttribute("aria-label", els.pinButton.title);
    }
    await loadBootstrap();
    if (state.search.active) await runSearch(state.search.query, { silent: true });
    else await loadNotes();
    await loadPinnedPreview();
    showToast(updated.pinned ? "Note pinned." : "Note unpinned.");
  } catch (error) {
    handleError(error);
  }
}

async function deleteNote(note) {
  if (!note?.id) return;
  closeContextMenu();
  const confirmed = await askConfirm({
    title: "Delete this note?",
    copy: `“${note.title || "Untitled note"}” will be removed from this device. This cannot be undone.`,
    label: "Delete",
  });
  if (!confirmed) return;

  try {
    await request(`/api/notes/${note.id}`, { method: "DELETE" });
    state.sessionUnlocks.delete(note.id);
    if (Number(state.activeId) === Number(note.id)) clearEditor();
    await loadBootstrap();
    if (state.search.active) await runSearch(state.search.query, { silent: true });
    else await loadNotes();
    await loadPinnedPreview();
    if (isMobile()) els.app.classList.remove("editor-open");
    updateListHeader();
    showToast("Note deleted.");
  } catch (error) {
    handleError(error);
  }
}

function handleNoteContextMenu(event) {
  const target = event.target.closest("[data-id], [data-pinned-id]");
  if (!target) return;
  const id = Number(target.dataset.id ?? target.dataset.pinnedId);
  if (!id) return;
  event.preventDefault();
  const note = noteSummaryById(id);
  openContextMenu(event.clientX, event.clientY, [
    { label: "Open note", icon: "note", onSelect: () => openNote(id) },
    {
      label: note.pinned ? "Unpin note" : "Pin note",
      icon: "pin",
      onSelect: () => togglePinnedNote(note),
    },
    { label: "Copy title", icon: "copy", onSelect: () => copyText(note.title) },
    { separator: true },
    { label: "Delete note", icon: "trash", danger: true, onSelect: () => deleteNote(note) },
  ]);
}

function handleBlockContextMenu(event) {
  const wrapper = event.target.closest(".block-wrapper");
  if (!wrapper) return;
  event.preventDefault();
  const id = wrapper.dataset.blockId;
  openContextMenu(event.clientX, event.clientY, [
    { label: "Add block below", icon: "plus", onSelect: () => insertBlockAfter(id) },
    { separator: true },
    { label: "Delete block", icon: "trash", danger: true, onSelect: () => deleteBlock(id) },
  ]);
}

function clearInlineAssistHighlight() {
  $$(".block-wrapper.is-ai-active", els.noteBody).forEach((wrapper) => {
    wrapper.classList.remove("is-ai-active");
  });
}

function hideInlineAssist() {
  clearTimeout(state.inlineAssist.timer);
  state.inlineAssist.timer = null;
  state.inlineAssist.blockId = null;
  els.inlineAssist.hidden = true;
}

function showInlineAssist(blockId) {
  if (!canEditActive() || state.assistant.open || state.slash.open) {
    hideInlineAssist();
    return;
  }
  const block = state.blocks[blockIndex(blockId)];
  const wrapper = blockWrapper(blockId);
  if (!block || !wrapper || blockIsEmpty(block.content)) {
    hideInlineAssist();
    return;
  }

  state.inlineAssist.blockId = blockId;
  els.inlineAssist.hidden = false;
  const chip = els.inlineAssist.getBoundingClientRect();
  const rect = wrapper.getBoundingClientRect();
  const left = clamp(rect.right - chip.width, 12, window.innerWidth - chip.width - 12);
  let top = rect.bottom + 6;
  if (top + chip.height > window.innerHeight - 12) {
    top = rect.top - chip.height - 6;
  }
  els.inlineAssist.style.left = `${Math.round(left)}px`;
  els.inlineAssist.style.top = `${Math.round(Math.max(12, top))}px`;
}

function scheduleInlineAssist(blockId) {
  if (!canEditActive() || state.assistant.open || state.slash.open) return;
  clearInlineAssistHighlight();
  blockWrapper(blockId)?.classList.add("is-ai-active");
  clearTimeout(state.inlineAssist.timer);
  state.inlineAssist.timer = setTimeout(() => {
    state.inlineAssist.timer = null;
    showInlineAssist(blockId);
  }, 850);
}

async function useInlineAssist(action) {
  const blockId = state.inlineAssist.blockId;
  const block = state.blocks[blockIndex(blockId)];
  const focusText = block
    ? blockPlainText(block.content).replace(/\s+/g, " ").trim().slice(0, 160)
    : "";
  hideInlineAssist();
  await openAssistant();
  if (!state.assistant.open) return;
  await sendAssistantPrompt(
    assistantQuickText(action === "summary" ? "summary" : "actions", focusText),
  );
}

function assistantActionBadge(action) {
  const labels = {
    created: "Created",
    updated: "Updated",
    appended: "Appended",
    deleted: "Deleted",
  };
  const label = labels[action?.action] || "Changed";
  const title = String(action?.title || "").trim();
  return `<span class="assistant-action is-${escapeHtml(action?.action || "changed")}">${escapeHtml(label)}${title ? ` · ${escapeHtml(title)}` : ""}</span>`;
}

function assistantMessageHtml(message) {
  const isUser = message.role === "user";
  const actions = Array.isArray(message.actions)
    ? message.actions.map(assistantActionBadge).join("")
    : "";
  return `
    <div class="assistant-message is-${isUser ? "user" : "assistant"}">
      <span class="assistant-avatar${isUser ? " is-user" : ""}">${isUser ? "You" : AI_ICON}</span>
      <div class="assistant-bubble">
        <span class="assistant-bubble-text">${escapeHtml(message.content)}</span>
        ${actions ? `<span class="assistant-actions">${actions}</span>` : ""}
      </div>
    </div>`;
}

function scrollAssistantThread() {
  if (!state.assistant.open || !els.assistantThread) return;
  requestAnimationFrame(() => {
    els.assistantThread.scrollTop = els.assistantThread.scrollHeight;
  });
}

function renderAssistantThread() {
  const a = state.assistant;
  const parts = a.messages.map(assistantMessageHtml);

  if (a.sending) {
    parts.push(`
      <div class="assistant-loading">
        <span class="assistant-loading-dot"></span>
        <span class="assistant-loading-dot"></span>
        <span class="assistant-loading-dot"></span>
        <span>Sonnet 5 is working on your notes…</span>
      </div>`);
  }

  if (!a.online) {
    parts.push(`
      <div class="assistant-setup assistant-offline">
        <strong>You are offline</strong>
        <p>The assistant is online only. Reconnect to the internet, then try again.</p>
      </div>`);
  } else if (a.error) {
    parts.push(`<div class="assistant-error">${escapeHtml(a.error)}</div>`);
  }
  if (a.statusError) {
    parts.push(`<div class="assistant-error">${escapeHtml(a.statusError)}</div>`);
  }
  if (a.configured === false) {
    parts.push(`
      <div class="assistant-setup">
        <strong>Connect Radox AI</strong>
        <p>Set <code>RADOXAI_API_KEY</code> in <code>.env</code>, then restart KNOTES.</p>
        <p>Every request uses <code>claude-sonnet-5</code>.</p>
      </div>`);
  }

  if (!parts.length) {
    parts.push(`
      <div class="assistant-empty">
        <span>${AI_ICON}</span>
        <div>
          <strong>Tell me what to do</strong>
          <p>I can create notes, rewrite them, add plans and todos, organize folders and tags, or delete a note you name. Changes happen immediately.</p>
        </div>
      </div>`);
  }

  els.assistantThread.innerHTML = parts.join("");
  scrollAssistantThread();
}

function updateAssistantAvailability() {
  const a = state.assistant;
  a.online = typeof navigator === "undefined" ? true : navigator.onLine;
  if (!els.assistantButton) return;
  els.assistantButton.classList.toggle("is-disabled", !a.online);
  els.assistantButton.setAttribute("aria-disabled", String(!a.online));
  els.assistantButton.title = a.online
    ? "Open assistant"
    : "The assistant needs an internet connection";
  if (a.open) renderAssistant();
}

function updateAssistantComposer() {
  if (!els.assistantSend) return;
  const a = state.assistant;
  const unavailable = !a.online || a.configured === false;
  els.assistantInput.disabled = a.sending || unavailable;
  els.assistantInput.placeholder = !a.online
    ? "You are offline. Reconnect to use the assistant."
    : a.configured === false
      ? "Add RADOXAI_API_KEY to enable the assistant."
      : "Tell Sonnet 5 what to do…";
  els.assistantSend.disabled =
    a.sending || unavailable || a.configured !== true || !els.assistantInput.value.trim();
  els.assistantSend.textContent = a.sending ? "Working…" : "Send";
}

function renderAssistant() {
  const a = state.assistant;
  if (!els.assistantPanel) return;
  const status = a.status;
  let statusLabel = "Checking provider…";
  if (!a.online) statusLabel = "Offline · internet required";
  else if (a.statusError) statusLabel = "Provider check failed";
  else if (status) {
    statusLabel = status.configured
      ? `${status.provider} · Sonnet 5`
      : "Provider key missing";
  }
  els.assistantStatus.textContent = statusLabel;
  els.assistantStatus.classList.toggle(
    "is-error",
    Boolean(a.statusError) || a.configured === false || !a.online,
  );

  const active = state.activeNote;
  els.assistantNoteLabel.textContent = active
    ? `${active.locked ? "Locked · " : ""}${active.title}`
    : "No active note";

  const busy = a.sending;
  $$("[data-assistant-action]", els.assistantPanel).forEach((button) => {
    button.disabled =
      busy || !a.online || a.configured !== true || !state.activeNote;
    button.classList.remove("is-active");
  });

  renderAssistantThread();
  updateAssistantComposer();
}

async function refreshAssistantStatus(seq = state.assistant.seq) {
  const a = state.assistant;
  if (!a.online) {
    a.configured = null;
    a.statusError = "";
    if (a.open) renderAssistant();
    return;
  }
  try {
    const status = await request("/api/assistant/status");
    if (!a.open || seq !== a.seq) return;
    a.status = status;
    a.configured = Boolean(status.configured);
    a.statusError = "";
  } catch (error) {
    if (!a.open || seq !== a.seq) return;
    a.status = null;
    a.configured = null;
    a.statusError = error?.message || "Could not check the AI provider.";
  }
  if (a.open) renderAssistant();
}

async function openAssistant() {
  if (state.assistant.open) {
    els.assistantInput.focus();
    return;
  }

  closeContextMenu();
  hideInlineAssist();
  clearInlineAssistHighlight();

  const a = state.assistant;
  const noteId = state.activeNote?.id ?? null;
  if (a.noteId !== noteId) {
    a.messages = [];
    a.noteId = noteId;
  }
  a.open = true;
  a.configured = null;
  a.error = "";
  a.statusError = "";
  a.online = typeof navigator === "undefined" ? true : navigator.onLine;
  a.seq += 1;
  const seq = a.seq;

  els.assistantOverlay.hidden = false;
  els.assistantButton.classList.add("is-active");
  els.assistantButton.setAttribute("aria-expanded", "true");
  document.body.classList.add("assistant-is-open");
  renderAssistant();
  els.assistantInput.focus();

  await refreshAssistantStatus(seq);
}

function closeAssistant() {
  const a = state.assistant;
  if (!a.open) return;
  a.open = false;
  a.seq += 1;
  els.assistantOverlay.hidden = true;
  els.assistantButton.classList.remove("is-active");
  els.assistantButton.setAttribute("aria-expanded", "false");
  document.body.classList.remove("assistant-is-open");
  if (els.assistantOverlay.contains(document.activeElement)) {
    els.assistantButton.focus();
  }
}

function assistantQuickText(action, focus = "") {
  const focusLine = focus ? `\n\nFocus on this part: ${focus}` : "";
  if (action === "actions") {
    return `Add clear, concrete next actions to the active note as todo items. Apply the changes to the note now.${focusLine}`;
  }
  if (action === "summary") {
    return `Summarize the active note for me in the chat. Do not change the note unless I ask.${focusLine}`;
  }
  return `Add a practical, ordered plan to the active note. Apply the changes to the note now.${focusLine}`;
}

async function sendAssistantPrompt(text) {
  const a = state.assistant;
  if (!a.open) await openAssistant();
  if (!a.open) return;
  els.assistantInput.value = String(text || "").trim().slice(0, 8_000);
  updateAssistantComposer();
  if (!els.assistantInput.value) return;
  await sendAssistantMessage();
}

async function fetchNote(id) {
  try {
    const { note } = await request(`/api/notes/${id}`);
    if (note.locked && state.sessionUnlocks.has(note.id)) {
      try {
        const unlocked = await request(`/api/notes/${note.id}/unlock`, {
          method: "POST",
          body: { passphrase: state.sessionUnlocks.get(note.id) },
        });
        return {
          ...note,
          body: unlocked.body ?? "",
          blocks: Array.isArray(unlocked.blocks) ? unlocked.blocks : null,
          attachments: Array.isArray(unlocked.attachments) ? unlocked.attachments : [],
        };
      } catch {
        state.sessionUnlocks.delete(note.id);
      }
    }
    return note;
  } catch {
    return null;
  }
}

async function activateNoteForAssistant(id) {
  const note = await fetchNote(id);
  if (!note) return false;
  state.activeNote = note;
  state.activeId = note.id;
  state.dirty = false;
  state.saving = false;
  closeFind();
  closeContextMenu();
  if (!note.locked) {
    state.blocks = Array.isArray(note.blocks)
      ? normalizeClientBlocks(note.blocks)
      : blocksFromPlainText(note.body);
    if (!state.blocks.length) state.blocks = [createBlock()];
    note.blocks = state.blocks;
  }
  renderEditor();
  updateActiveStates();
  return true;
}

function clearEditorForAssistant() {
  state.activeNote = null;
  state.activeId = null;
  state.blocks = [];
  state.dirty = false;
  state.saving = false;
  closeFind();
  closeContextMenu();
  closeSlashMenu();
  hideInlineToolbar();
  hideInlineAssist();
  clearInlineAssistHighlight();
  els.editor.hidden = true;
  els.editorEmpty.hidden = false;
  els.app.classList.remove("editor-open");
  updateActiveStates();
}

function assistantActionToast(actions) {
  const created = actions.filter((action) => action.action === "created").length;
  const updated = actions.filter(
    (action) => action.action === "updated" || action.action === "appended",
  ).length;
  const deleted = actions.filter((action) => action.action === "deleted").length;
  const parts = [];
  if (created) parts.push(`created ${created}`);
  if (updated) parts.push(`updated ${updated}`);
  if (deleted) parts.push(`deleted ${deleted}`);
  if (!parts.length) return "";
  return `Sonnet 5 ${parts.join(", ")} ${parts.length === 1 && created + updated + deleted === 1 ? "note" : "notes"}.`;
}

async function syncAfterAssistant(actions) {
  await loadBootstrap();
  if (state.search.active) await runSearch(state.search.query, { silent: true });
  else await loadNotes();
  await loadPinnedPreview();

  const created = [...actions].reverse().find((action) => action.action === "created");
  if (created?.noteId) {
    await activateNoteForAssistant(created.noteId);
  } else if (state.activeId) {
    const refreshed = await fetchNote(state.activeId);
    if (refreshed) await activateNoteForAssistant(refreshed.id);
    else if (state.notes.length) await activateNoteForAssistant(state.notes[0].id);
    else clearEditorForAssistant();
  } else if (state.notes.length) {
    await activateNoteForAssistant(state.notes[0].id);
  } else {
    clearEditorForAssistant();
  }

  const a = state.assistant;
  a.noteId = state.activeNote?.id ?? null;
}

async function sendAssistantMessage(event) {
  event?.preventDefault();
  const a = state.assistant;
  if (!a.open || a.sending) return;
  a.online = typeof navigator === "undefined" ? true : navigator.onLine;
  if (!a.online) {
    a.error = "You are offline. Reconnect to use the assistant.";
    renderAssistant();
    return;
  }
  if (a.configured === false) {
    a.error = "The assistant needs RADOXAI_API_KEY before it can run.";
    renderAssistant();
    return;
  }

  const text = els.assistantInput.value.trim();
  if (!text) return;
  if (canEditActive() && !(await saveActive())) {
    a.error = "The note could not be saved. Try again before sending.";
    renderAssistant();
    return;
  }

  const noteId = state.activeNote?.id ?? null;
  a.messages.push({ role: "user", content: text.slice(0, 8_000) });
  els.assistantInput.value = "";
  const seq = ++a.seq;
  a.sending = true;
  a.error = "";
  renderAssistant();

  try {
    const result = await request("/api/assistant/chat", {
      method: "POST",
      body: {
        noteId,
        messages: a.messages,
      },
    });
    if (!a.open || seq !== a.seq) return;
    const reply = String(result.message ?? "").trim().slice(0, 12_000);
    if (!reply) throw new Error("The assistant returned an empty reply.");
    const actions = Array.isArray(result.actions) ? result.actions : [];
    a.messages.push({ role: "assistant", content: reply, actions });
    a.configured = true;
    a.statusError = "";
    a.status = {
      configured: true,
      provider: result.meta?.provider || a.status?.provider || "Radox AI",
      model: result.meta?.model || "claude-sonnet-5",
    };
    if (result.changed) {
      await syncAfterAssistant(actions);
      const toast = assistantActionToast(actions);
      if (toast) showToast(toast);
    }
  } catch (error) {
    if (!a.open || seq !== a.seq) return;
    if (!navigator.onLine) {
      a.online = false;
      a.error = "You are offline. Reconnect to use the assistant.";
    } else if (error?.status === 503 || error?.code === "ai_not_configured") {
      a.configured = false;
      a.error = error?.message || "The assistant is not configured.";
    } else {
      a.error = error?.message || "The assistant could not complete that request.";
    }
  } finally {
    if (seq === a.seq) {
      a.sending = false;
      renderAssistant();
    }
  }
}

async function pinActive() {
  const note = state.activeNote;
  if (!note) return;
  if (!(await saveBeforeLeave())) return;

  try {
    const { note: updated } = await request(`/api/notes/${note.id}`, {
      method: "PUT",
      body: { pinned: !note.pinned },
    });
    state.activeNote = {
      ...updated,
      body: state.activeNote.body,
      blocks: state.activeNote.blocks,
      attachments: state.activeNote.attachments,
      sessionUnlocked: state.activeNote.sessionUnlocked,
    };
    renderEditor();
    scheduleLibraryRefresh();
  } catch (error) {
    handleError(error);
  }
}

async function unlockActive(passphrase) {
  const note = state.activeNote;
  if (!note) return;
  els.unlockError.textContent = "";

  try {
    const unlocked = await request(`/api/notes/${note.id}/unlock`, {
      method: "POST",
      body: { passphrase },
    });
    state.sessionUnlocks.set(note.id, passphrase);
    state.activeNote = {
      ...note,
      body: unlocked.body ?? "",
      blocks: Array.isArray(unlocked.blocks) ? unlocked.blocks : null,
      attachments: Array.isArray(unlocked.attachments) ? unlocked.attachments : [],
      sessionUnlocked: true,
    };
    els.unlockForm.reset();
    renderEditor();
    showToast("Note unlocked for this session.");
  } catch (error) {
    els.unlockError.textContent = error.status === 401 ? "Incorrect passphrase." : error.message;
    els.unlockPassphrase.focus();
    els.unlockPassphrase.select();
  }
}

async function removeLock() {
  const note = state.activeNote;
  if (!note || !state.sessionUnlocks.has(note.id)) return;
  if (!(await saveBeforeLeave())) return;

  try {
    const { note: updated } = await request(`/api/notes/${note.id}`, {
      method: "PUT",
      body: { removeLock: true, passphrase: state.sessionUnlocks.get(note.id) },
    });
    state.sessionUnlocks.delete(note.id);
    state.activeNote = updated;
    state.dirty = false;
    renderEditor();
    scheduleLibraryRefresh();
    showToast("Lock removed. The note is fully searchable.");
  } catch (error) {
    handleError(error);
  }
}

async function lockActive() {
  const note = state.activeNote;
  if (!note) return;

  if (note.locked && state.sessionUnlocks.has(note.id)) {
    await removeLock();
    return;
  }

  if (note.locked) {
    els.lockedPanel.scrollIntoView({ block: "center", behavior: "smooth" });
    els.unlockPassphrase.focus();
    return;
  }

  if (!(await saveBeforeLeave())) return;
  els.lockForm.reset();
  els.lockError.textContent = "";
  els.lockDialog.showModal();
  els.lockPassphrase.focus();
}

function openFind(query = "", includeAttachments = false) {
  if (!canEditActive()) return;
  state.find.open = true;
  state.find.query = String(query ?? "");
  state.find.includeAttachments = Boolean(includeAttachments);
  els.findInput.value = state.find.query;
  els.findAttachments.checked = state.find.includeAttachments;
  els.findBar.hidden = false;
  els.findToggle.classList.add("is-active");
  runFind();
  els.findInput.focus();
  els.findInput.select();
}

function closeFind() {
  clearTimeout(state.findTimer);
  state.find.open = false;
  state.find.query = "";
  state.find.includeAttachments = false;
  state.find.matches = [];
  state.find.index = -1;
  els.findBar.hidden = true;
  els.findToggle.classList.remove("is-active");
  els.findCount.textContent = "0 matches";
  els.findInput.value = "";
  els.findAttachments.checked = false;
  els.findPrev.disabled = true;
  els.findNext.disabled = true;
  window.getSelection()?.removeAllRanges();
  if (state.activeNote && !activeIsReadOnly()) renderAttachmentList();
}

function foldWithOffsets(value) {
  let folded = "";
  const offsets = [];
  let sourceIndex = 0;
  for (const character of String(value ?? "")) {
    const replacement = character
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLocaleLowerCase();
    for (const next of replacement) {
      folded += next;
      offsets.push(sourceIndex);
    }
    sourceIndex += character.length;
  }
  offsets.push(sourceIndex);
  return { folded, offsets };
}

function collectFindMatches(query, includeAttachments) {
  const note = state.activeNote;
  const matches = [];
  const needle = foldText(query);
  if (!note || !needle) return matches;

  for (const block of state.blocks) {
    const text = blockPlainText(block.content);
    const { folded, offsets } = foldWithOffsets(text);
    let cursor = 0;
    let index = folded.indexOf(needle, cursor);
    while (index !== -1) {
      matches.push({
        kind: "block",
        blockId: block.id,
        start: offsets[index],
        end: offsets[index + needle.length],
      });
      cursor = index + Math.max(needle.length, 1);
      index = folded.indexOf(needle, cursor);
    }
  }

  if (includeAttachments) {
    const attachments = Array.isArray(note.attachments) ? note.attachments : [];
    attachments.forEach((attachment, attachmentIndex) => {
      const text = String(attachment?.text ?? "");
      const { folded, offsets } = foldWithOffsets(text);
      let from = 0;
      let found = folded.indexOf(needle, from);
      while (found !== -1) {
        matches.push({
          kind: "attachment",
          attachmentIndex,
          start: offsets[found],
          end: offsets[found + needle.length],
        });
        from = found + Math.max(needle.length, 1);
        found = folded.indexOf(needle, from);
      }
    });
  }

  return matches;
}

function renderFindCount() {
  const total = state.find.matches.length;
  const index = state.find.index;
  if (!state.find.query) {
    els.findCount.textContent = "0 matches";
  } else if (!total) {
    els.findCount.textContent = "No matches";
  } else {
    els.findCount.textContent = `${index + 1} of ${total}`;
  }
  els.findPrev.disabled = total === 0;
  els.findNext.disabled = total === 0;
}

function runFind() {
  if (!state.find.open || !state.activeNote) return;
  state.find.query = els.findInput.value.trim();
  state.find.includeAttachments = els.findAttachments.checked;
  state.find.matches = collectFindMatches(state.find.query, state.find.includeAttachments);
  state.find.index = state.find.matches.length ? 0 : -1;
  renderAttachmentList();
  renderFindCount();
  if (state.find.matches.length) selectFindMatch(0);
}

function selectFindMatch(index) {
  const total = state.find.matches.length;
  if (!total) {
    state.find.index = -1;
    renderFindCount();
    return;
  }

  state.find.index = ((index % total) + total) % total;
  const match = state.find.matches[state.find.index];
  renderFindCount();

  if (match.kind === "block") {
    const content = blockContentFor(match.blockId);
    if (!content) return;
    const range = selectionRangeFor(content, match.start, match.end);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    content.closest(".block-wrapper")?.scrollIntoView({ block: "center", behavior: "smooth" });
    return;
  }

  renderAttachmentList();
  const detail = els.attachmentList.querySelector(`[data-attachment-index="${match.attachmentIndex}"]`);
  if (detail) {
    detail.open = true;
    detail.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

function openLockDialogError(message) {
  els.lockError.textContent = message;
}

async function submitLock() {
  const note = state.activeNote;
  if (!note) return;
  const passphrase = els.lockPassphrase.value;
  const confirmation = els.lockConfirm.value;

  if (passphrase.length < 4) {
    openLockDialogError("Use at least 4 characters.");
    return;
  }
  if (passphrase !== confirmation) {
    openLockDialogError("The passphrases do not match.");
    return;
  }

  try {
    const { note: updated } = await request(`/api/notes/${note.id}`, {
      method: "PUT",
      body: { lockPassphrase: passphrase },
    });
    state.sessionUnlocks.delete(note.id);
    state.activeNote = updated;
    state.dirty = false;
    els.lockDialog.close();
    renderEditor();
    scheduleLibraryRefresh();
    showToast("Note locked. Only its title remains searchable.");
  } catch (error) {
    openLockDialogError(error.message);
  }
}

function askConfirm({ title, copy, label }) {
  els.confirmTitle.textContent = title;
  els.confirmCopy.textContent = copy;
  els.confirmSubmit.textContent = label;

  return new Promise((resolve) => {
    state.confirmResolve = (value) => {
      if (!state.confirmResolve) return;
      state.confirmResolve = null;
      els.confirmDialog.close();
      resolve(value);
    };
    els.confirmDialog.showModal();
  });
}

function scheduleLibraryRefresh() {
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(async () => {
    state.refreshTimer = null;
    try {
      await loadBootstrap();
      if (state.search.active) {
        await runSearch(state.search.query, { silent: true });
      } else {
        await loadNotes();
      }
      await loadPinnedPreview();
    } catch (error) {
      handleError(error);
    }
  }, 300);
}

function openSidebar() {
  els.app.classList.add("sidebar-open");
  els.scrim.hidden = false;
}

function closeSidebar() {
  els.app.classList.remove("sidebar-open");
  els.scrim.hidden = true;
}

async function backToList() {
  if (!(await saveBeforeLeave())) return;
  els.app.classList.remove("editor-open");
}

function focusSearch(value = "") {
  if (value) {
    els.searchInput.value = value;
    els.clearSearch.hidden = false;
    runSearch(value);
  }
  els.searchInput.focus();
  els.searchInput.select();
}

function bindEvents() {
  els.newNote.addEventListener("click", newNote);
  els.newNoteSidebar.addEventListener("click", async () => {
    closeSidebar();
    await newNote();
  });
  els.exportButton.addEventListener("click", openExportMenu);
  els.designClose.addEventListener("click", closeDesignOverlay);
  els.pinButton.addEventListener("click", pinActive);
  els.lockButton.addEventListener("click", lockActive);
  els.addAttachment.addEventListener("click", () => els.attachmentInput.click());
  els.attachmentInput.addEventListener("change", () => {
    const files = Array.from(els.attachmentInput.files ?? []);
    els.attachmentInput.value = "";
    addAttachments(files);
  });
  els.attachmentList.addEventListener("click", (event) => {
    const download = event.target.closest("[data-attachment-download]");
    if (download) {
      event.preventDefault();
      event.stopPropagation();
      downloadAttachment(Number(download.dataset.attachmentDownload));
      return;
    }
    const remove = event.target.closest("[data-attachment-remove]");
    if (remove) {
      event.preventDefault();
      event.stopPropagation();
      removeAttachment(Number(remove.dataset.attachmentRemove));
    }
  });
  els.assistantButton.addEventListener("click", openAssistant);
  els.assistantClose.addEventListener("click", closeAssistant);
  els.assistantOverlay.addEventListener("click", (event) => {
    if (event.target === els.assistantOverlay) closeAssistant();
  });
  els.assistantForm.addEventListener("submit", sendAssistantMessage);
  els.assistantInput.addEventListener("input", updateAssistantComposer);
  els.assistantInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      els.assistantForm.requestSubmit();
    }
  });
  $$("[data-assistant-action]").forEach((button) => {
    button.addEventListener("click", () =>
      sendAssistantPrompt(assistantQuickText(button.dataset.assistantAction)),
    );
  });
  $$("[data-quick-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      sendAssistantPrompt(button.dataset.quickPrompt || "");
    });
  });
  window.addEventListener("online", () => {
    state.assistant.online = true;
    state.assistant.error = "";
    updateAssistantAvailability();
    refreshAssistantStatus();
  });
  window.addEventListener("offline", () => {
    state.assistant.online = false;
    state.assistant.configured = null;
    state.assistant.error = "";
    updateAssistantAvailability();
  });
  els.inlineAssist.addEventListener("pointerdown", (event) => event.preventDefault());
  els.inlineAssist.addEventListener("click", (event) => {
    const button = event.target.closest("[data-inline-assist]");
    if (button) useInlineAssist(button.dataset.inlineAssist);
  });
  $$(".pane-resizer").forEach((resizer) => {
    resizer.addEventListener("pointerdown", (event) => startPaneResize(event, resizer));
    resizer.addEventListener("dblclick", resetPaneWidths);
    resizer.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        nudgePaneResize(resizer, event.key === "ArrowLeft" ? -16 : 16);
      }
      if (event.key === "Home") {
        event.preventDefault();
        resetPaneWidths();
      }
    });
  });
  els.contextMenu.addEventListener("click", (event) => {
    const button = event.target.closest("[data-menu-index]");
    if (!button) return;
    const item = state.contextMenuItems[Number(button.dataset.menuIndex)];
    closeContextMenu();
    item?.onSelect?.();
  });
  els.backToList.addEventListener("click", backToList);
  els.openSidebar.addEventListener("click", openSidebar);
  els.closeSidebar.addEventListener("click", closeSidebar);
  els.scrim.addEventListener("click", closeSidebar);
  els.resetFilters.addEventListener("click", async () => {
    if (!(await saveBeforeLeave())) return;
    state.activeFolder = "";
    state.activeTag = "";
    state.smartFilter = "";
    resetSearch();
    renderSidebar();
    await loadNotes();
  });

  els.notesList.addEventListener("click", (event) => {
    const card = event.target.closest("[data-id]");
    if (card) openNote(Number(card.dataset.id));
  });
  els.notesList.addEventListener("contextmenu", handleNoteContextMenu);
  els.pinnedList.addEventListener("contextmenu", handleNoteContextMenu);
  els.searchResults.addEventListener("contextmenu", handleNoteContextMenu);

  els.searchResults.addEventListener("click", (event) => {
    const tryButton = event.target.closest("[data-try]");
    if (tryButton) {
      focusSearch(tryButton.dataset.try);
      return;
    }
    const card = event.target.closest("[data-id]");
    if (card) {
      openNote(Number(card.dataset.id), {
        findQuery: state.search.query,
        findAttachments: true,
      });
    }
  });

  els.pinnedList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-pinned-id]");
    if (item) openNote(Number(item.dataset.pinnedId));
  });

  els.sidebar.addEventListener("click", async (event) => {
    const target = event.target;
    const library = target.closest("[data-library]");
    const smart = target.closest("[data-smart]");
    const folder = target.closest("[data-folder]");
    const tag = target.closest("[data-tag]");
    if (!library && !smart && !folder && !tag) return;

    if (!(await saveBeforeLeave())) return;
    state.activeTag = "";
    state.smartFilter = "";

    if (library) {
      state.activeFolder = "";
    } else if (smart) {
      state.activeFolder = "";
      state.smartFilter = smart.dataset.smart === state.smartFilter ? "" : smart.dataset.smart;
    } else if (folder) {
      state.activeFolder = folder.dataset.folder;
    } else if (tag) {
      state.activeFolder = "";
      state.activeTag = tag.dataset.tag;
    }

    resetSearch();
    renderSidebar();
    await loadNotes();
    els.app.classList.remove("editor-open");
    closeSidebar();
  });

  els.searchInput.addEventListener("input", () => {
    const value = els.searchInput.value;
    els.clearSearch.hidden = !value;
    if (!value.trim()) {
      exitSearch();
      return;
    }
    clearTimeout(state.searchTimer);
    state.search.active = true;
    setSearchMode(true);
    els.searchStatus.textContent = "Searching…";
    state.searchTimer = setTimeout(() => {
      state.searchTimer = null;
      runSearch(els.searchInput.value);
    }, 150);
  });

  els.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && els.searchInput.value) {
      event.preventDefault();
      exitSearch();
      els.searchInput.blur();
      return;
    }
    if (event.key === "Enter" && state.search.results.length) {
      event.preventDefault();
      const first = state.search.results[0];
      openNote(first.id, { findQuery: state.search.query, findAttachments: true });
    }
  });

  els.clearSearch.addEventListener("click", () => {
    exitSearch();
    els.searchInput.focus();
  });

  els.scopeButton.addEventListener("click", () => {
    if (!state.activeFolder) return;
    state.search.scope = state.search.scope === "folder" ? "all" : "folder";
    els.scopeLabel.textContent = state.search.scope === "folder" ? state.activeFolder : "All notes";
    if (state.search.query) runSearch(state.search.query);
  });

  els.noteTitle.addEventListener("input", markDirty);

  els.noteTitle.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const first = state.blocks[0];
      if (first) focusBlock(first.id, "start");
    }
  });

  els.noteBody.addEventListener("input", handleBlockInput);
  els.noteBody.addEventListener("change", handleTodoDateChange);
  els.noteBody.addEventListener("keydown", handleBlockKeyDown);
  els.noteBody.addEventListener("focusin", (event) => {
    const wrapper = event.target.closest(".block-wrapper");
    if (!wrapper || !canEditActive()) return;
    clearInlineAssistHighlight();
    wrapper.classList.add("is-ai-active");
  });
  els.noteBody.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!els.noteBody.contains(document.activeElement)) {
        clearInlineAssistHighlight();
        hideInlineAssist();
      }
    }, 120);
  });
  els.noteBody.addEventListener("paste", handleBlockPaste);
  els.noteBody.addEventListener("click", handleBlockClick);
  els.noteBody.addEventListener("contextmenu", handleBlockContextMenu);
  els.noteBody.addEventListener("dragstart", handleBlockDragStart);
  els.noteBody.addEventListener("dragover", handleBlockDragOver);
  els.noteBody.addEventListener("drop", handleBlockDrop);
  els.noteBody.addEventListener("dragend", handleBlockDragEnd);
  els.noteBody.addEventListener("dragleave", (event) => {
    if (!els.noteBody.contains(event.relatedTarget)) {
      clearDropIndicators();
      state.dropTarget = null;
    }
  });
  document.addEventListener("selectionchange", handleSelectionChange);
  els.inlineToolbar.addEventListener("mousedown", (event) => event.preventDefault());
  els.inlineToolbar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-format]");
    if (button) applyInlineFormat(button.dataset.format);
  });
  els.slashMenu.addEventListener("mousedown", (event) => event.preventDefault());
  els.slashOptions.addEventListener("click", handleSlashClick);
  document.addEventListener("mousedown", (event) => {
    if (!state.slash.open) return;
    if (event.target.closest("#slash-menu")) return;
    const content = event.target.closest(".block-content");
    if (content?.closest(".block-wrapper")?.dataset.blockId === state.slash.blockId) return;
    closeSlashMenu();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!els.contextMenu.hidden && !event.target.closest("#context-menu")) closeContextMenu();
    if (!els.inlineAssist.hidden && !event.target.closest("#inline-assist")) hideInlineAssist();
  });
  document.addEventListener(
    "scroll",
    () => {
      closeContextMenu();
      hideInlineAssist();
    },
    true,
  );
  els.editorContent.addEventListener("scroll", hideInlineToolbar);

  els.findToggle.addEventListener("click", () => {
    if (state.find.open) {
      closeFind();
      return;
    }
    openFind(state.search.query || "", Boolean(state.search.query));
  });

  els.findInput.addEventListener("input", () => {
    clearTimeout(state.findTimer);
    state.findTimer = setTimeout(() => {
      state.findTimer = null;
      runFind();
    }, 120);
  });

  els.findInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (state.find.matches.length) {
        selectFindMatch(state.find.index + (event.shiftKey ? -1 : 1));
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeFind();
    }
  });

  els.findAttachments.addEventListener("change", runFind);
  els.findPrev.addEventListener("click", () => selectFindMatch(state.find.index - 1));
  els.findNext.addEventListener("click", () => selectFindMatch(state.find.index + 1));
  els.findClose.addEventListener("click", closeFind);

  els.unlockForm.addEventListener("submit", (event) => {
    event.preventDefault();
    unlockActive(els.unlockPassphrase.value);
  });

  els.lockCancel.addEventListener("click", () => els.lockDialog.close());
  els.lockForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitLock();
  });
  els.lockDialog.addEventListener("close", () => {
    els.lockError.textContent = "";
    els.lockForm.reset();
  });

  els.confirmForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.confirmResolve?.(true);
  });
  els.confirmCancel.addEventListener("click", () => state.confirmResolve?.(false));
  els.confirmDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    state.confirmResolve?.(false);
  });

  $$("[data-try]").forEach((button) => {
    button.addEventListener("click", () => focusSearch(button.dataset.try || ""));
  });

  window.addEventListener("keydown", (event) => {
    if (!els.designOverlay.hidden) {
      if (event.key === "Escape" && !els.designClose.hidden) {
        event.preventDefault();
        closeDesignOverlay();
        return;
      }
      event.preventDefault();
      return;
    }
    const key = event.key.toLocaleLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === "k") {
      event.preventDefault();
      focusSearch();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && key === "s") {
      event.preventDefault();
      saveActive();
      return;
    }
    if (event.key === "Escape") {
      if (document.querySelector("dialog[open]")) return;
      if (!els.contextMenu.hidden) {
        event.preventDefault();
        closeContextMenu();
        return;
      }
      if (state.assistant.open) {
        event.preventDefault();
        closeAssistant();
        return;
      }
      if (state.slash.open) {
        event.preventDefault();
        closeSlashMenu();
        return;
      }
      if (state.find.open) {
        event.preventDefault();
        closeFind();
        return;
      }
      if (state.search.active) {
        event.preventDefault();
        exitSearch();
        return;
      }
      if (els.app.classList.contains("sidebar-open")) {
        event.preventDefault();
        closeSidebar();
        return;
      }
      if (els.app.classList.contains("editor-open") && isMobile()) {
        event.preventDefault();
        backToList();
      }
      return;
    }
    if (!event.metaKey && !event.ctrlKey && !event.altKey && key === "n" && !isEditable(event.target)) {
      event.preventDefault();
      newNote();
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && state.dirty) saveActive();
  });

  window.addEventListener("resize", () => {
    if (!isMobile()) closeSidebar();
    closeContextMenu();
    hideInlineToolbar();
    hideInlineAssist();
    clampPaneWidths();
    if (state.slash.open) updateSlashMenu();
  });
}

async function init() {
  loadPaneWidths();
  bindEvents();
  try {
    await loadBootstrap();
    await Promise.all([loadPinnedPreview(), loadNotes({ selectFirst: !isMobile() })]);
  } catch (error) {
    handleError(error);
  }
}

init();





