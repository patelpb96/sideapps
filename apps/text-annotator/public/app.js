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
