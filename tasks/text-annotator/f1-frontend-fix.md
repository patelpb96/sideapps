FILE: apps/text-annotator/public/index.html
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Text Annotator</title>
  <link rel="stylesheet" href="/style.css">
  <script type="module" src="/app.js"></script>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">TA</span>
      <div>
        <h1>Text Annotator</h1>
        <p>Label passages in your documents</p>
      </div>
    </div>
  </header>

  <main class="workspace">
    <aside class="left-column" aria-label="Document controls">
      <section class="panel upload-panel" aria-labelledby="upload-heading">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Get started</p>
            <h2 id="upload-heading">Add a document</h2>
          </div>
        </div>

        <div id="drop-zone" class="drop-zone">
          <span class="upload-icon" aria-hidden="true">↑</span>
          <p class="drop-title">Drop a file here</p>
          <p class="muted">or choose one from your device</p>
          <input id="file-input" class="visually-hidden" type="file" accept=".txt,.md,.pdf,.docx">
          <button id="pick-file" class="button button-secondary" type="button">Choose file</button>
          <p class="file-types">TXT, MD, PDF, DOCX · up to 25 MiB</p>
        </div>
      </section>

      <section class="panel documents-panel" aria-labelledby="documents-heading">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Workspace</p>
            <h2 id="documents-heading">Documents</h2>
          </div>
          <span id="document-count" class="count-badge" aria-label="Document count">0</span>
        </div>
        <ul id="document-list" class="document-list" aria-label="Uploaded documents">
          <li class="list-empty">Loading documents…</li>
        </ul>
      </section>
    </aside>

    <section class="panel viewer-panel" aria-labelledby="active-title">
      <div class="viewer-heading">
        <div class="viewer-title-group">
          <p class="eyebrow">Document viewer</p>
          <h2 id="active-title">No document open</h2>
          <p id="active-meta" class="muted">Choose a document or upload a file to begin.</p>
        </div>
        <p id="document-warning" class="document-warning" hidden></p>
      </div>
      <div id="viewer" class="text-viewer" role="region" aria-label="Document text" tabindex="0">
        Open a document to view its text.
      </div>
    </section>

    <aside class="right-column" aria-label="Annotations and status">
      <section class="panel palette-panel" aria-labelledby="palette-heading">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Available labels</p>
            <h2 id="palette-heading">Label palette</h2>
          </div>
        </div>
        <ul class="label-legend">
          <li><span class="label-swatch label-person" aria-hidden="true"></span>Person</li>
          <li><span class="label-swatch label-organization" aria-hidden="true"></span>Organization</li>
          <li><span class="label-swatch label-location" aria-hidden="true"></span>Location</li>
          <li><span class="label-swatch label-date" aria-hidden="true"></span>Date</li>
          <li><span class="label-swatch label-amount" aria-hidden="true"></span>Amount</li>
          <li><span class="label-swatch label-other" aria-hidden="true"></span>Other</li>
        </ul>
        <p class="help-text">Select text in the document, then choose a label. Annotations cannot overlap.</p>

        <form id="offset-form" class="offset-form">
          <h3>Add by offsets</h3>
          <p id="offset-help" class="offset-help">Use zero-based character offsets; the end offset is exclusive.</p>
          <div class="offset-fields">
            <label for="offset-start">Start
              <input id="offset-start" name="start" type="number" min="0" step="1" required inputmode="numeric">
            </label>
            <label for="offset-end">End
              <input id="offset-end" name="end" type="number" min="0" step="1" required inputmode="numeric">
            </label>
          </div>
          <label for="offset-label">Label
            <select id="offset-label" name="label">
              <option>Person</option>
              <option>Organization</option>
              <option>Location</option>
              <option>Date</option>
              <option>Amount</option>
              <option>Other</option>
            </select>
          </label>
          <button id="offset-submit" class="button button-secondary" type="submit">Add annotation</button>
        </form>
      </section>

      <section class="panel annotations-panel" aria-labelledby="annotations-heading">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Current document</p>
            <h2 id="annotations-heading">Annotations</h2>
          </div>
          <span id="annotation-count" class="count-badge" aria-label="Annotation count">0</span>
        </div>
        <ul id="annotation-list" class="annotation-list">
          <li class="list-empty">Open a document to see annotations.</li>
        </ul>
        <button id="export-button" class="button button-primary export-button" type="button" disabled>
          Export annotations
        </button>
      </section>

      <section id="status-panel" class="panel status-panel" data-state="info" aria-labelledby="status-heading">
        <h2 id="status-heading">Status</h2>
        <p id="status-message" role="status" aria-live="polite" aria-atomic="true">Ready. Upload a document or open one from the list.</p>
      </section>
    </aside>
  </main>

  <div id="label-menu" class="label-menu" role="group" aria-label="Choose an annotation label" hidden></div>
</body>
</html>
```

FILE: apps/text-annotator/public/app.js
```js
const LABELS = ["Person", "Organization", "Location", "Date", "Amount", "Other"];
const MAX_FILE_SIZE = 25 * 1024 * 1024;

const fileInput = document.querySelector("#file-input");
const pickFileButton = document.querySelector("#pick-file");
const dropZone = document.querySelector("#drop-zone");
const documentList = document.querySelector("#document-list");
const documentCount = document.querySelector("#document-count");
const activeTitle = document.querySelector("#active-title");
const activeMeta = document.querySelector("#active-meta");
const documentWarning = document.querySelector("#document-warning");
const viewer = document.querySelector("#viewer");
const annotationList = document.querySelector("#annotation-list");
const annotationCount = document.querySelector("#annotation-count");
const exportButton = document.querySelector("#export-button");
const statusPanel = document.querySelector("#status-panel");
const statusMessage = document.querySelector("#status-message");
const labelMenu = document.querySelector("#label-menu");
const offsetForm = document.querySelector("#offset-form");
const offsetStart = document.querySelector("#offset-start");
const offsetEnd = document.querySelector("#offset-end");
const offsetLabel = document.querySelector("#offset-label");

let documents = [];
let currentDocument = null;
let currentAnnotations = [];
let selectedAnnotationId = null;
let pendingSelection = null;
let loadingToken = 0;
let saving = false;

class ApiError extends Error {
  constructor(message, status, code = "") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function apiFetch(path, options = {}) {
  let response;

  try {
    response = await fetch(path, options);
  } catch (error) {
    throw new Error(error?.message || "Could not connect to the server.");
  }

  if (response.status === 204) {
    return null;
  }

  const raw = await response.text();
  let payload = null;

  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const apiError = payload?.error;
    throw new ApiError(
      apiError?.message || `Request failed with status ${response.status}.`,
      response.status,
      apiError?.code || ""
    );
  }

  return payload;
}

function setStatus(message, state = "info") {
  statusMessage.textContent = message;
  statusPanel.dataset.state = state;
}

function reportError(error) {
  const message = error?.message || "An unexpected error occurred.";
  const code = error?.code ? `${error.code}: ` : "";
  setStatus(`${code}${message}`, "error");
}

function labelClass(label) {
  const knownLabel = LABELS.includes(label) ? label : "Other";
  return `label-${knownLabel.toLowerCase()}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value) || 0);
}

function updateMutationControls() {
  const disabled = saving || !currentDocument;

  labelMenu.querySelectorAll("button").forEach((button) => {
    button.disabled = disabled;
  });
  offsetForm.querySelectorAll("input, select, button").forEach((control) => {
    control.disabled = disabled;
  });
  annotationList.querySelectorAll(".button-delete").forEach((button) => {
    button.disabled = disabled;
  });
}

function renderDocumentList() {
  documentCount.textContent = formatNumber(documents.length);
  documentList.replaceChildren();

  if (documents.length === 0) {
    const empty = document.createElement("li");
    empty.className = "list-empty";
    empty.textContent = "No documents yet. Upload a file to get started.";
    documentList.append(empty);
    return;
  }

  for (const item of documents) {
    const row = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "document-row";

    if (currentDocument?.id === item.id) {
      button.setAttribute("aria-current", "true");
    }

    const name = document.createElement("span");
    name.className = "document-name";
    name.textContent = item.filename || "Untitled document";

    const meta = document.createElement("span");
    meta.className = "document-row-meta";
    const ext = String(item.ext || "").toUpperCase() || "FILE";
    meta.textContent = `${ext} · ${formatNumber(item.chars)} chars · ${formatNumber(item.annotations)} annotations`;

    const id = document.createElement("span");
    id.className = "document-id";
    id.textContent = item.id || "";

    button.append(name, meta, id);
    button.addEventListener("click", () => openDocument(item.id));
    row.append(button);
    documentList.append(row);
  }
}

async function refreshDocuments({ silent = false } = {}) {
  try {
    const result = await apiFetch("/api/documents");
    documents = Array.isArray(result?.documents) ? result.documents : [];
    renderDocumentList();
  } catch (error) {
    if (!silent) {
      reportError(error);
    }
  }
}

function validateAnnotationList(annotations, textLength) {
  if (!Array.isArray(annotations)) {
    throw new Error("The server returned an invalid annotation list.");
  }

  const ids = new Set();
  const validated = [];

  for (const annotation of annotations) {
    if (!annotation || typeof annotation !== "object" || Array.isArray(annotation) ||
        typeof annotation.id !== "string" || annotation.id.trim() === "" ||
        !Number.isInteger(annotation.start) || !Number.isInteger(annotation.end) ||
        !LABELS.includes(annotation.label)) {
      throw new Error("The server returned invalid annotation data (expected an id, start, end, and valid label).");
    }

    if (annotation.start < 0 || annotation.end <= annotation.start || annotation.end > textLength) {
      throw new Error("The server returned invalid annotation bounds for this document.");
    }

    if (ids.has(annotation.id)) {
      throw new Error("The server returned duplicate annotation IDs.");
    }

    ids.add(annotation.id);
    validated.push(annotation);
  }

  const sorted = [...validated].sort((a, b) => a.start - b.start || a.end - b.end);
  let previousEnd = -1;

  for (const annotation of sorted) {
    if (annotation.start < previousEnd) {
      throw new Error("The server returned overlapping annotations.");
    }
    previousEnd = annotation.end;
  }

  return validated;
}

function renderViewer() {
  if (!currentDocument) {
    viewer.replaceChildren(document.createTextNode("Open a document to view its text."));
    return;
  }

  const text = currentDocument.text;
  const fragment = document.createDocumentFragment();
  const sorted = [...currentAnnotations].sort((a, b) => a.start - b.start || a.end - b.end);
  let cursor = 0;

  for (const annotation of sorted) {
    const start = Number(annotation.start);
    const end = Number(annotation.end);

    if (!Number.isInteger(start) || !Number.isInteger(end) ||
        start < cursor || end <= start || end > text.length) {
      continue;
    }

    fragment.append(document.createTextNode(text.slice(cursor, start)));

    const mark = document.createElement("mark");
    mark.className = labelClass(annotation.label);
    mark.dataset.annotationId = annotation.id;
    mark.title = `${annotation.label} annotation`;
    mark.setAttribute("aria-label", `${annotation.label} annotation`);
    mark.append(document.createTextNode(text.slice(start, end)));
    fragment.append(mark);

    cursor = end;
  }

  fragment.append(document.createTextNode(text.slice(cursor)));
  viewer.replaceChildren(fragment);
}

function renderAnnotationList() {
  annotationCount.textContent = formatNumber(currentAnnotations.length);
  annotationList.replaceChildren();

  if (!currentDocument) {
    const empty = document.createElement("li");
    empty.className = "list-empty";
    empty.textContent = "Open a document to see annotations.";
    annotationList.append(empty);
    return;
  }

  if (currentAnnotations.length === 0) {
    const empty = document.createElement("li");
    empty.className = "list-empty";
    empty.textContent = "No annotations yet. Select text to add one.";
    annotationList.append(empty);
    return;
  }

  for (const annotation of currentAnnotations) {
    const row = document.createElement("li");
    row.className = "annotation-row";
    row.dataset.annotationId = annotation.id;

    if (annotation.id === selectedAnnotationId) {
      row.classList.add("is-selected");
      row.setAttribute("aria-current", "true");
    }

    const details = document.createElement("div");
    details.className = "annotation-details";

    const label = document.createElement("span");
    label.className = `annotation-label ${labelClass(annotation.label)}`;
    label.textContent = annotation.label;

    const snippet = document.createElement("span");
    snippet.className = "annotation-snippet";
    snippet.textContent = typeof annotation.text === "string"
      ? annotation.text
      : currentDocument.text.slice(annotation.start, annotation.end);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button button-delete";
    remove.textContent = "Delete";
    remove.setAttribute("aria-label", `Delete ${annotation.label} annotation`);
    remove.disabled = saving;
    remove.addEventListener("click", () => {
      if (saving) {
        setStatus("Please wait for the current annotation save to finish.", "info");
        return;
      }
      const remaining = currentAnnotations.filter((item) => item.id !== annotation.id);
      saveAnnotationList(remaining, "Annotation deleted.");
    });

    details.append(label, snippet);
    row.append(details, remove);
    annotationList.append(row);
  }
}

function renderCurrentDocument() {
  if (!currentDocument) {
    activeTitle.textContent = "No document open";
    activeMeta.textContent = "Choose a document or upload a file to begin.";
    documentWarning.hidden = true;
    exportButton.disabled = true;
  } else {
    activeTitle.textContent = currentDocument.filename || "Untitled document";
    const ext = String(currentDocument.ext || "").toUpperCase() || "FILE";
    const chars = currentDocument.meta?.chars ?? currentDocument.text.length;
    activeMeta.textContent = `${ext} · ${formatNumber(chars)} characters · ${currentDocument.id}`;
    const warnings = Array.isArray(currentDocument.warnings) ? currentDocument.warnings : [];
    documentWarning.textContent = warnings.join(" ");
    documentWarning.hidden = warnings.length === 0;
    exportButton.disabled = false;
  }

  renderViewer();
  renderAnnotationList();
  renderDocumentList();
  updateMutationControls();
}

async function openDocument(id, { showStatus = true } = {}) {
  const token = ++loadingToken;

  if (showStatus) {
    setStatus("Opening document…", "info");
  }

  try {
    const [documentResult, annotationResult] = await Promise.all([
      apiFetch(`/api/documents/${encodeURIComponent(id)}`),
      apiFetch(`/api/documents/${encodeURIComponent(id)}/annotations`)
    ]);

    if (token !== loadingToken) return false;

    const loadedDocument = documentResult?.document;
    if (!loadedDocument || typeof loadedDocument.text !== "string") {
      throw new Error("The server returned an invalid document.");
    }

    const loadedAnnotations = validateAnnotationList(
      annotationResult?.annotations,
      loadedDocument.text.length
    );

    currentDocument = loadedDocument;
    currentAnnotations = loadedAnnotations;
    selectedAnnotationId = null;
    pendingSelection = null;
    hideLabelMenu();
    renderCurrentDocument();

    if (showStatus) {
      setStatus(`Opened ${loadedDocument.filename || "document"}.`, "success");
    }

    return true;
  } catch (error) {
    if (token === loadingToken) {
      reportError(error);
    }
    return false;
  }
}

async function uploadFile(file) {
  if (!file) return;

  if (file.size > MAX_FILE_SIZE) {
    setStatus("File is too large. The maximum upload size is 25 MiB.", "error");
    fileInput.value = "";
    return;
  }

  pickFileButton.disabled = true;
  setStatus(`Uploading ${file.name}…`, "info");

  try {
    const body = await file.arrayBuffer();
    const result = await apiFetch("/api/documents", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Filename": encodeURIComponent(file.name)
      },
      body
    });

    const uploaded = result?.document;
    if (!uploaded?.id) {
      throw new Error("The server did not return the uploaded document.");
    }

    await refreshDocuments({ silent: true });
    const opened = await openDocument(uploaded.id, { showStatus: false });
    if (opened) {
      setStatus(`Uploaded and opened ${uploaded.filename || file.name}.`, "success");
    }
  } catch (error) {
    reportError(error);
  } finally {
    pickFileButton.disabled = false;
    fileInput.value = "";
  }
}

function offsetAtBoundary(container, offset) {
  const prefix = document.createRange();
  prefix.setStart(viewer, 0);
  prefix.setEnd(container, offset);
  const targetOffset = prefix.toString().length;

  const walker = document.createTreeWalker(viewer, NodeFilter.SHOW_TEXT);
  let node;
  let total = 0;

  while ((node = walker.nextNode())) {
    if (targetOffset <= total + node.length) {
      return total + Math.min(targetOffset - total, node.length);
    }
    total += node.length;
  }

  return total;
}

function hideLabelMenu(clearSelection = true) {
  labelMenu.hidden = true;
  if (clearSelection) {
    pendingSelection = null;
  }
}

function positionLabelMenu(rect) {
  if (labelMenu.hidden) return;

  const menuRect = labelMenu.getBoundingClientRect();
  const margin = 8;
  const left = Math.max(
    margin,
    Math.min(rect.left + rect.width / 2 - menuRect.width / 2, window.innerWidth - menuRect.width - margin)
  );

  let top = rect.bottom + margin;
  if (top + menuRect.height > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - menuRect.height - margin);
  }

  labelMenu.style.left = `${left}px`;
  labelMenu.style.top = `${top}px`;
}

function updateSelectionMenu() {
  if (!currentDocument) {
    hideLabelMenu();
    return;
  }

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0 ||
      !viewer.contains(selection.anchorNode) || !viewer.contains(selection.focusNode)) {
    hideLabelMenu();
    return;
  }

  const range = selection.getRangeAt(0);
  const start = offsetAtBoundary(range.startContainer, range.startOffset);
  const end = offsetAtBoundary(range.endContainer, range.endOffset);

  if (end <= start || end > currentDocument.text.length) {
    hideLabelMenu();
    return;
  }

  pendingSelection = { start, end };
  const rect = range.getBoundingClientRect();
  labelMenu.hidden = false;
  requestAnimationFrame(() => positionLabelMenu(rect));
  setStatus(`Selected ${formatNumber(end - start)} characters. Choose a label.`, "info");
}

function buildLabelMenu() {
  labelMenu.replaceChildren();

  for (const label of LABELS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `label-choice ${labelClass(label)}`;
    button.textContent = label;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => addSelectedAnnotation(label));
    labelMenu.append(button);
  }
}

function validateAnnotationRange(start, end, label) {
  if (!currentDocument) {
    setStatus("Open a document before adding annotations.", "error");
    return false;
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) ||
      start < 0 || end <= start || end > currentDocument.text.length) {
    setStatus("Invalid offsets. Start and end must be within the document, with end greater than start.", "error");
    return false;
  }

  if (!LABELS.includes(label)) {
    setStatus("Choose a valid annotation label.", "error");
    return false;
  }

  const overlaps = currentAnnotations.some((annotation) =>
    start < annotation.end && end > annotation.start
  );

  if (overlaps) {
    setStatus(
      "Cannot add this annotation: annotations cannot overlap. Delete or select a non-overlapping passage.",
      "error"
    );
    return false;
  }

  return true;
}

async function addAnnotationByRange(start, end, label) {
  if (saving) {
    setStatus("Please wait for the current annotation save to finish.", "info");
    return false;
  }

  if (!validateAnnotationRange(start, end, label)) {
    return false;
  }

  const proposed = [
    ...currentAnnotations.map(({ start: itemStart, end: itemEnd, label: itemLabel }) => ({
      start: itemStart,
      end: itemEnd,
      label: itemLabel
    })),
    { start, end, label }
  ];

  return saveAnnotationList(proposed, `${label} annotation added.`);
}

async function addSelectedAnnotation(label) {
  if (saving) {
    setStatus("Please wait for the current annotation save to finish.", "info");
    return;
  }
  if (!currentDocument || !pendingSelection) return;

  const { start, end } = pendingSelection;
  const saved = await addAnnotationByRange(start, end, label);

  if (saved) {
    hideLabelMenu();
    window.getSelection()?.removeAllRanges();
  }
}

async function saveAnnotationList(proposed, successMessage) {
  if (!currentDocument) return false;
  if (saving) {
    setStatus("Please wait for the current annotation save to finish.", "info");
    return false;
  }

  const documentId = currentDocument.id;
  const documentTextLength = currentDocument.text.length;
  saving = true;
  updateMutationControls();
  setStatus("Saving annotations…", "info");

  try {
    const result = await apiFetch(
      `/api/documents/${encodeURIComponent(documentId)}/annotations`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          annotations: proposed.map(({ start, end, label }) => ({ start, end, label }))
        })
      }
    );

    if (currentDocument?.id !== documentId) {
      await refreshDocuments({ silent: true });
      return false;
    }

    const savedAnnotations = validateAnnotationList(
      result?.annotations,
      documentTextLength
    );

    currentAnnotations = savedAnnotations;
    if (!currentAnnotations.some((annotation) => annotation.id === selectedAnnotationId)) {
      selectedAnnotationId = null;
    }

    renderCurrentDocument();
    await refreshDocuments({ silent: true });
    setStatus(successMessage, "success");
    return true;
  } catch (error) {
    if (currentDocument?.id === documentId) {
      reportError(error);
    }
    return false;
  } finally {
    saving = false;
    updateMutationControls();
  }
}

function selectAnnotation(annotationId) {
  selectedAnnotationId = annotationId;
  renderAnnotationList();

  const row = [...annotationList.querySelectorAll(".annotation-row[data-annotation-id]")]
    .find((item) => item.dataset.annotationId === annotationId);

  row?.scrollIntoView({ block: "nearest" });
}

viewer.addEventListener("mouseup", () => {
  window.setTimeout(updateSelectionMenu, 0);
});

viewer.addEventListener("click", (event) => {
  const mark = event.target.closest("mark[data-annotation-id]");
  if (mark?.dataset.annotationId) {
    selectAnnotation(mark.dataset.annotationId);
  }
});

document.addEventListener("selectionchange", () => {
  window.setTimeout(updateSelectionMenu, 0);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !labelMenu.hidden) {
    hideLabelMenu();
  }
});

pickFileButton.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const [file] = fileInput.files || [];
  if (file) uploadFile(file);
});

offsetForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (offsetStart.value.trim() === "" || offsetEnd.value.trim() === "") {
    setStatus("Enter both a start and end offset.", "error");
    return;
  }

  const saved = await addAnnotationByRange(
    Number(offsetStart.value),
    Number(offsetEnd.value),
    offsetLabel.value
  );

  if (saved) {
    offsetForm.reset();
  }
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("is-dragging");
});

dropZone.addEventListener("dragleave", (event) => {
  if (!dropZone.contains(event.relatedTarget)) {
    dropZone.classList.remove("is-dragging");
  }
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-dragging");
  const [file] = event.dataTransfer?.files || [];
  if (file) uploadFile(file);
});

exportButton.addEventListener("click", () => {
  if (!currentDocument) return;

  const payload = {
    document: {
      id: currentDocument.id,
      filename: currentDocument.filename
    },
    annotations: currentAnnotations
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${currentDocument.filename || "document"}.annotations.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("Annotations exported as JSON.", "success");
});

buildLabelMenu();
renderCurrentDocument();
refreshDocuments();
```

FILE: apps/text-annotator/public/style.css
```css
:root {
  color-scheme: light;
  --page: #f3f5f7;
  --surface: #ffffff;
  --surface-alt: #f7f8fa;
  --text: #17212b;
  --muted: #596675;
  --border: #cbd2da;
  --border-strong: #8d99a6;
  --accent: #164f72;
  --accent-hover: #103d59;
  --focus: #176a9a;
  --status-bg: #f0f4f7;
  --status-border: #8d99a6;
  --error: #9a2222;
  --error-bg: #fff0ef;
  --success: #176238;
  --success-bg: #edf8f0;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--page);
  color: var(--text);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.45;
}

button,
input,
select {
  font: inherit;
}

button {
  color: inherit;
}

button:focus-visible,
input:focus-visible,
select:focus-visible,
[tabindex="0"]:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}

[hidden] {
  display: none !important;
}

.topbar {
  min-height: 76px;
  padding: 12px 24px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 1600px;
  margin: 0 auto;
}

.brand-mark {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  background: var(--accent);
  color: #ffffff;
  font-size: 0.9rem;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.brand h1 {
  margin: 0;
  font-size: 1.15rem;
  line-height: 1.2;
}

.brand p {
  margin: 3px 0 0;
  color: var(--muted);
  font-size: 0.85rem;
}

.workspace {
  display: grid;
  grid-template-columns: minmax(220px, 250px) minmax(360px, 1fr) minmax(260px, 310px);
  align-items: start;
  gap: 16px;
  max-width: 1650px;
  margin: 0 auto;
  padding: 18px 20px 24px;
}

.left-column,
.right-column {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.panel {
  min-width: 0;
  background: var(--surface);
  border: 1px solid var(--border);
}

.upload-panel,
.documents-panel,
.palette-panel,
.annotations-panel,
.status-panel {
  padding: 16px;
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.panel-heading h2,
.status-panel h2 {
  margin: 0;
  font-size: 1rem;
  line-height: 1.3;
}

.eyebrow {
  margin: 0 0 3px;
  color: var(--muted);
  font-size: 0.68rem;
  font-weight: 750;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.count-badge {
  display: inline-grid;
  min-width: 28px;
  min-height: 26px;
  padding: 2px 7px;
  place-items: center;
  border: 1px solid var(--border);
  background: var(--surface-alt);
  color: var(--text);
  font-size: 0.78rem;
  font-weight: 700;
}

.drop-zone {
  display: flex;
  min-height: 200px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px 10px;
  border: 1px dashed var(--border-strong);
  background: var(--surface-alt);
  text-align: center;
  transition: background-color 120ms ease, border-color 120ms ease;
}

.drop-zone.is-dragging {
  border-color: var(--accent);
  background: #e8f2f8;
}

.upload-icon {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 1px solid var(--border-strong);
  color: var(--accent);
  font-size: 1.2rem;
  font-weight: 700;
}

.drop-title {
  margin: 9px 0 0;
  font-weight: 700;
}

.muted,
.file-types,
.help-text {
  color: var(--muted);
}

.drop-zone .muted {
  margin: 2px 0 12px;
  font-size: 0.84rem;
}

.file-types {
  margin: 12px 0 0;
  font-size: 0.72rem;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  clip-path: inset(50%);
}

.button {
  min-height: 36px;
  padding: 7px 11px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 650;
}

.button:hover:not(:disabled) {
  background: var(--surface-alt);
}

.button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.button-secondary {
  color: var(--text);
}

.button-primary {
  border-color: var(--accent);
  background: var(--accent);
  color: #ffffff;
}

.button-primary:hover:not(:disabled) {
  border-color: var(--accent-hover);
  background: var(--accent-hover);
}

.document-list,
.annotation-list,
.label-legend {
  margin: 0;
  padding: 0;
  list-style: none;
}

.document-list {
  display: grid;
  gap: 7px;
}

.document-row {
  display: grid;
  width: 100%;
  gap: 3px;
  padding: 9px;
  border: 1px solid var(--border);
  background: var(--surface);
  text-align: left;
  cursor: pointer;
}

.document-row:hover {
  border-color: var(--border-strong);
  background: var(--surface-alt);
}

.document-row[aria-current="true"] {
  border-left: 3px solid var(--accent);
  background: var(--surface-alt);
}

.document-name {
  overflow: hidden;
  font-size: 0.84rem;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.document-row-meta,
.document-id {
  color: var(--muted);
  font-size: 0.71rem;
  overflow-wrap: anywhere;
}

.list-empty {
  padding: 12px 4px;
  color: var(--muted);
  font-size: 0.82rem;
}

.viewer-panel {
  display: flex;
  min-height: min(760px, calc(100vh - 112px));
  flex-direction: column;
}

.viewer-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 17px 18px 14px;
  border-bottom: 1px solid var(--border);
}

.viewer-title-group {
  min-width: 0;
}

.viewer-heading h2 {
  overflow-wrap: anywhere;
  margin: 0;
  font-size: 1.08rem;
}

.viewer-heading .muted {
  margin: 4px 0 0;
  font-size: 0.78rem;
  overflow-wrap: anywhere;
}

.document-warning {
  max-width: 38%;
  margin: 0;
  padding: 6px 8px;
  border: 1px solid #a66a17;
  background: #fff7e7;
  color: #633d08;
  font-size: 0.76rem;
}

.text-viewer {
  flex: 1;
  min-height: 420px;
  padding: 22px;
  overflow: auto;
  background: var(--surface);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 0.98rem;
  line-height: 1.75;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}

.label-legend {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px 12px;
}

.label-legend li {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 0.8rem;
}

.label-swatch {
  width: 13px;
  height: 13px;
  flex: 0 0 13px;
  border: 1px solid var(--label-border);
  background: var(--label-bg);
}

.help-text {
  margin: 14px 0 0;
  font-size: 0.77rem;
}

.offset-form {
  display: grid;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.offset-form h3 {
  margin: 0;
  font-size: 0.84rem;
}

.offset-help {
  margin: -5px 0 0;
  color: var(--muted);
  font-size: 0.72rem;
}

.offset-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.offset-form label {
  display: grid;
  min-width: 0;
  gap: 4px;
  color: var(--muted);
  font-size: 0.75rem;
  font-weight: 650;
}

.offset-form input,
.offset-form select {
  width: 100%;
  min-width: 0;
  min-height: 34px;
  padding: 5px 7px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text);
  font-size: 0.82rem;
}

.offset-form .button {
  width: 100%;
}

.annotation-list {
  display: grid;
  gap: 8px;
  max-height: 380px;
  overflow: auto;
}

.annotation-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 9px;
  border: 1px solid var(--border);
  background: var(--surface);
}

.annotation-row.is-selected {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.annotation-details {
  display: grid;
  min-width: 0;
  gap: 5px;
}

.annotation-label {
  width: fit-content;
  padding: 1px 5px;
  border: 1px solid var(--label-border);
  background: var(--label-bg);
  color: var(--label-fg);
  font-size: 0.7rem;
  font-weight: 750;
}

.annotation-snippet {
  display: -webkit-box;
  overflow: hidden;
  color: var(--text);
  font-size: 0.78rem;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.button-delete {
  min-height: 30px;
  flex: 0 0 auto;
  padding: 4px 7px;
  font-size: 0.72rem;
}

.export-button {
  width: 100%;
  margin-top: 14px;
}

.status-panel {
  border-left: 3px solid var(--status-border);
  background: var(--status-bg);
}

.status-panel h2 {
  margin-bottom: 6px;
  font-size: 0.88rem;
}

.status-panel p {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--text);
  font-size: 0.8rem;
}

.status-panel[data-state="error"] {
  border-left-color: var(--error);
  background: var(--error-bg);
}

.status-panel[data-state="error"] p {
  color: var(--error);
}

.status-panel[data-state="success"] {
  border-left-color: var(--success);
  background: var(--success-bg);
}

.status-panel[data-state="success"] p {
  color: var(--success);
}

.label-menu {
  position: fixed;
  z-index: 10;
  display: grid;
  width: 252px;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 9px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  box-shadow: 0 4px 18px #0002;
}

.label-choice {
  min-height: 34px;
  padding: 5px 7px;
  border: 1px solid var(--label-border);
  background: var(--label-bg);
  color: var(--label-fg);
  cursor: pointer;
  font-size: 0.78rem;
  font-weight: 700;
  text-align: left;
}

.label-choice:hover:not(:disabled) {
  border-color: var(--label-fg);
  filter: brightness(0.96);
}

.label-choice:disabled {
  cursor: wait;
  opacity: 0.65;
}

mark.label-person {
  --label-bg: #f9dce3;
  --label-fg: #722338;
  --label-border: #c8798c;
}

mark.label-organization {
  --label-bg: #dceafa;
  --label-fg: #183f70;
  --label-border: #7195c2;
}

mark.label-location {
  --label-bg: #dff1e4;
  --label-fg: #245b35;
  --label-border: #78a985;
}

mark.label-date {
  --label-bg: #fff0ce;
  --label-fg: #674800;
  --label-border: #c5a34c;
}

mark.label-amount {
  --label-bg: #f0e2fa;
  --label-fg: #593070;
  --label-border: #a483bd;
}

mark.label-other {
  --label-bg: #e5e8eb;
  --label-fg: #35414d;
  --label-border: #929da8;
}

.label-person {
  --label-bg: #f9dce3;
  --label-fg: #722338;
  --label-border: #c8798c;
}

.label-organization {
  --label-bg: #dceafa;
  --label-fg: #183f70;
  --label-border: #7195c2;
}

.label-location {
  --label-bg: #dff1e4;
  --label-fg: #245b35;
  --label-border: #78a985;
}

.label-date {
  --label-bg: #fff0ce;
  --label-fg: #674800;
  --label-border: #c5a34c;
}

.label-amount {
  --label-bg: #f0e2fa;
  --label-fg: #593070;
  --label-border: #a483bd;
}

.label-other {
  --label-bg: #e5e8eb;
  --label-fg: #35414d;
  --label-border: #929da8;
}

@media (max-width: 1120px) {
  .workspace {
    grid-template-columns: minmax(210px, 240px) minmax(0, 1fr);
  }

  .right-column {
    grid-column: 1 / -1;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: start;
  }

  .status-panel {
    grid-column: 1 / -1;
  }

  .viewer-panel {
    min-height: 620px;
  }
}

@media (max-width: 700px) {
  .topbar {
    padding: 11px 14px;
  }

  .workspace {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    padding: 12px;
  }

  .left-column,
  .right-column {
    grid-column: auto;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }

  .viewer-panel {
    min-height: 0;
  }

  .text-viewer {
    min-height: 380px;
    padding: 16px;
  }

  .right-column .status-panel {
    grid-column: auto;
  }

  .viewer-heading {
    flex-direction: column;
  }

  .document-warning {
    max-width: none;
  }
}

@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --page: #13191f;
    --surface: #1c252d;
    --surface-alt: #222e38;
    --text: #ecf1f5;
    --muted: #b0bdc8;
    --border: #3d4a55;
    --border-strong: #71808d;
    --accent: #70b8e2;
    --accent-hover: #8ac9ed;
    --focus: #8bd1ff;
    --status-bg: #222e38;
    --status-border: #71808d;
    --error: #ffaaa5;
    --error-bg: #3b2325;
    --success: #a1e3b5;
    --success-bg: #1e3427;
  }

  .brand-mark {
    color: #10202a;
  }

  .button-primary {
    color: #10202a;
  }

  .drop-zone.is-dragging {
    background: #203746;
  }

  .document-warning {
    border-color: #9c7b3a;
    background: #3b3221;
    color: #f0d99f;
  }

  mark.label-person,
  .label-person {
    --label-bg: #572a37;
    --label-fg: #ffd5df;
    --label-border: #bd7187;
  }

  mark.label-organization,
  .label-organization {
    --label-bg: #243b57;
    --label-fg: #d2e4ff;
    --label-border: #7298c5;
  }

  mark.label-location,
  .label-location {
    --label-bg: #254432;
    --label-fg: #d1f2d9;
    --label-border: #78ad86;
  }

  mark.label-date,
  .label-date {
    --label-bg: #4b3c1d;
    --label-fg: #ffebbb;
    --label-border: #c3a354;
  }

  mark.label-amount,
  .label-amount {
    --label-bg: #443052;
    --label-fg: #eedaff;
    --label-border: #aa89c2;
  }

  mark.label-other,
  .label-other {
    --label-bg: #343e47;
    --label-fg: #e1e7ec;
    --label-border: #8795a1;
  }
}
```
