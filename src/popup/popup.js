import {
  CONTEXTS,
  DEFAULT_JPEG_QUALITY,
  STORAGE_KEYS
} from "../shared/constants.js";
import {
  createApplicationError,
  ERROR_CODES,
  validateApplicationError
} from "../shared/errors.js";
import {
  createMessage,
  MESSAGE_TYPES,
  validateMessageEnvelope
} from "../shared/messages.js";
import {
  validateActiveTabResults,
  validateVisibleViewportResult
} from "../shared/visible-viewport.js";
import { validateScrollDiagnosticResult } from "../shared/page-measurement.js";
import { validateSegmentedCaptureDiagnostic } from "../shared/segment-capture.js";
import { validateFullPageResult } from "../shared/stitching.js";
import {
  formatAspectRatio,
  formatByteSize,
  formatMegapixels,
  parseJpegQuality,
  resolveStoredJpegQuality
} from "../shared/output-settings.js";
import { createAutomaticOutputFilename } from "../shared/output-filename.js";
import { formatDriveStatus } from "../shared/google-drive.js";

const workerStatus = document.querySelector("#worker-status");
const liveStatus = document.querySelector("#live-status");
const scaffoldCheckButton = document.querySelector("#scaffold-check");
const captureButton = document.querySelector("#capture-viewport");
const previewSection = document.querySelector("#preview");
const previewImage = document.querySelector("#preview-image");
const clearPreviewButton = document.querySelector("#clear-preview");
const previewFormat = document.querySelector("#preview-format");
const previewWidth = document.querySelector("#preview-width");
const previewHeight = document.querySelector("#preview-height");
const previewSize = document.querySelector("#preview-size");
const previewTimestamp = document.querySelector("#preview-timestamp");
const diagnosticButton = document.querySelector("#scroll-diagnostic");
const cancelDiagnosticButton = document.querySelector("#cancel-diagnostic");
const diagnosticResults = document.querySelector("#diagnostic-results");
const diagnosticMetadata = document.querySelector("#diagnostic-metadata");
const diagnosticSteps = document.querySelector("#diagnostic-steps");
const segmentedButton = document.querySelector("#segmented-capture");
const cancelSegmentedButton = document.querySelector("#cancel-segmented-capture");
const segmentedResults = document.querySelector("#segmented-results");
const segmentedMetadata = document.querySelector("#segmented-metadata");
const segmentedSteps = document.querySelector("#segmented-steps");
const fullPageButton = document.querySelector("#full-page-capture");
const cancelFullPageButton = document.querySelector("#cancel-full-page-capture");
const fullPagePreview = document.querySelector("#full-page-preview");
const fullPagePreviewImage = document.querySelector("#full-page-preview-image");
const fullPageMetadata = document.querySelector("#full-page-metadata");
const clearFullPageButton = document.querySelector("#clear-full-page-preview");
const suppressOverlaysOption = document.querySelector("#suppress-overlays");
const outputFilenameInput = document.querySelector("#output-filename");
const jpegQualitySelect = document.querySelector("#jpeg-quality");
const automaticFilenamePreview = document.querySelector("#automatic-filename-preview");
const driveConfiguration = document.querySelector("#drive-configuration");
const driveConnection = document.querySelector("#drive-connection");
const driveFolder = document.querySelector("#drive-folder");
const driveOutcome = document.querySelector("#drive-outcome");
const driveConnectButton = document.querySelector("#drive-connect");
const driveCheckFolderButton = document.querySelector("#drive-check-folder");
const driveDisconnectButton = document.querySelector("#drive-disconnect");

let activeCaptureRequestId = null;
let pendingPreviewResult = null;
let previewDataUrl = null;
let activeDiagnosticRequestId = null;
let activeSegmentedRequestId = null;
let activeFullPageRequestId = null;
let activeDriveSetupRequestId = null;
let lastDriveSetupResult = null;

function userSafeError(response, fallback) {
  const error = response?.payload?.error;
  return validateApplicationError(error) ? error.message : fallback;
}

function createWorkerRequest(type, payload = {}) {
  return createMessage({
    type,
    source: CONTEXTS.POPUP,
    target: CONTEXTS.SERVICE_WORKER,
    payload
  });
}

async function sendWorkerMessage(type) {
  const request = createWorkerRequest(type);
  return chrome.runtime.sendMessage(request);
}

function setCaptureState(state, message) {
  liveStatus.dataset.state = state;
  liveStatus.textContent = message;
}

function setBusy(isBusy) {
  captureButton.disabled = isBusy;
  scaffoldCheckButton.disabled = isBusy;
  diagnosticButton.disabled = isBusy;
  segmentedButton.disabled = isBusy;
  fullPageButton.disabled = isBusy;
  suppressOverlaysOption.disabled = isBusy;
  outputFilenameInput.disabled = isBusy;
  jpegQualitySelect.disabled = isBusy;
  driveConnectButton.disabled = isBusy || !lastDriveSetupResult?.configured ||
    lastDriveSetupResult?.connected;
  driveCheckFolderButton.disabled = isBusy || !lastDriveSetupResult?.connected;
  driveDisconnectButton.disabled = isBusy || !lastDriveSetupResult?.connected;
}

function showDriveSetupResult(result) {
  lastDriveSetupResult = result;
  const display = formatDriveStatus(result);
  driveConfiguration.textContent = display.configuration;
  driveConnection.textContent = display.connection;
  driveFolder.textContent = display.folder;
  driveOutcome.textContent = display.outcome;
  driveConnectButton.disabled = !result.configured || result.connected;
  driveCheckFolderButton.disabled = !result.configured || !result.connected;
  driveDisconnectButton.disabled = !result.configured || !result.connected;
}

async function runDriveSetupAction(type, { busy = true } = {}) {
  if (busy) setBusy(true);
  const request = createWorkerRequest(type);
  activeDriveSetupRequestId = request.requestId;
  try {
    const response = await chrome.runtime.sendMessage(request);
    if (!validateMessageEnvelope(response) || response.requestId !== request.requestId) {
      throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
    }
    if (response.type === MESSAGE_TYPES.DRIVE_SETUP_ERROR) {
      throw validateApplicationError(response.payload.error)
        ? response.payload.error
        : createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
    }
    if (response.type !== MESSAGE_TYPES.DRIVE_SETUP_RESULT) {
      throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
    }
    showDriveSetupResult(response.payload);
  } catch (error) {
    driveOutcome.textContent = validateApplicationError(error)
      ? error.message
      : "Drive setup could not be checked.";
  } finally {
    activeDriveSetupRequestId = null;
    if (busy) setBusy(false);
  }
}

function showFullPageResult(result) {
  fullPageMetadata.replaceChildren();
  for (const [label, value, selectable = false] of [
    ["Filename", result.filename, true],
    ["Filename source", result.filenameSource === "custom" ? "Custom" : "Automatic"],
    ["Format", `${result.format} (${result.mimeType})`],
    ["JPEG quality", `${Math.round(result.jpegQuality * 100)}%`],
    ["Bitmap", `${result.pixelWidth} × ${result.pixelHeight} px`],
    ["Megapixels", formatMegapixels(result.megapixels)],
    ["Aspect ratio", formatAspectRatio(result.aspectRatio)],
    ["Blob size", formatByteSize(result.blobSize)],
    ["JPEG signature", result.validJpegSignature ? "Valid" : "Invalid"],
    ["Segments", String(result.segmentCount)],
    ["Capture scale", `${result.captureScale.x.toFixed(4)} × ${result.captureScale.y.toFixed(4)}`],
    ["Horizontal overflow", result.horizontalOverflow ? "Not captured beyond viewport width" : "None"],
    ["Capture duration", Number.isFinite(result.durationMs) ? `${Math.round(result.durationMs)} ms` : "—"],
    ["Encoding duration", `${Math.round(result.encodingDurationMs)} ms`],
    ["Restored scroll", result.restoration
      ? `${result.restoration.actual.x}, ${result.restoration.actual.y} (${result.restoration.withinTolerance ? "restored" : "not restored"})`
      : "—"],
    ["Fixed/sticky candidates", String(result.overlayHandling?.detected ?? 0)],
    ["Overlays suppressed", String(result.overlayHandling?.suppressed ?? 0)],
    ["Elements restored", String(result.overlayHandling?.restored ?? 0)],
    ["Overlay restoration", result.overlayHandling?.restorationSucceeded === false
      ? "Failed or not applicable"
      : "Succeeded"],
    ["Total overlap", `${result.stitchingDiagnostics.totalOverlapPixels} px`],
    ["Newly covered", `${result.stitchingDiagnostics.totalNewlyCoveredPixels} px`],
    ["Maximum gap", `${result.stitchingDiagnostics.maximumGapPixels} px`],
    ["Created", new Date(result.createdAt).toLocaleString()]
  ]) {
    const wrapper = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = value;
    if (selectable) detail.classList.add("selectable");
    wrapper.append(term, detail);
    fullPageMetadata.append(wrapper);
  }
  fullPagePreviewImage.src = result.previewUrl;
  fullPagePreview.hidden = false;
}

function hideFullPageResult() {
  fullPagePreviewImage.removeAttribute("src");
  fullPageMetadata.replaceChildren();
  fullPagePreview.hidden = true;
}

async function clearFullPageResult({ announce = true } = {}) {
  hideFullPageResult();
  outputFilenameInput.value = "";
  try { await sendWorkerMessage(MESSAGE_TYPES.FULL_PAGE_RESULT_CLEAR_REQUEST); } catch {}
  if (announce) setCaptureState("idle", "Idle — temporary full-page preview cleared.");
}

async function runFullPageCapture() {
  hideFullPageResult();
  setBusy(true);
  cancelFullPageButton.hidden = false;
  setCaptureState("measuring-page", "Measuring page…");
  try {
    const request = createWorkerRequest(MESSAGE_TYPES.FULL_PAGE_CAPTURE_REQUEST, {
      requestedFilename: outputFilenameInput.value,
      jpegQuality: parseJpegQuality(jpegQualitySelect.value),
      suppressRepeatedOverlays: suppressOverlaysOption.checked
    });
    activeFullPageRequestId = request.requestId;
    const response = await chrome.runtime.sendMessage(request);
    if (!validateMessageEnvelope(response) || response.requestId !== request.requestId) {
      throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
    }
    if (response.type === MESSAGE_TYPES.FULL_PAGE_CAPTURE_ERROR) {
      throw validateApplicationError(response.payload.error)
        ? response.payload.error : createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
    }
    if (response.type !== MESSAGE_TYPES.FULL_PAGE_CAPTURE_SUCCESS ||
        !validateFullPageResult(response.payload)) {
      throw createApplicationError({ code: ERROR_CODES.INVALID_CAPTURE_RESULT });
    }
    showFullPageResult(response.payload);
    outputFilenameInput.value = "";
    setCaptureState("full-page-successful", "Full-page capture successful — temporary local preview ready.");
  } catch (error) {
    const cancelled = validateApplicationError(error) && error.code === ERROR_CODES.OPERATION_CANCELLED;
    setCaptureState(cancelled ? "full-page-cancelled" : "full-page-failed",
      `${cancelled ? "Capture cancelled" : "Capture failed"} — ${
        validateApplicationError(error) ? error.message : "Unexpected internal failure."
      }`);
  } finally {
    activeFullPageRequestId = null;
    cancelFullPageButton.hidden = true;
    setBusy(false);
    fullPageButton.focus();
  }
}

async function refreshAutomaticFilenamePreview() {
  try {
    const tab = validateActiveTabResults(await chrome.tabs.query({
      active: true,
      currentWindow: true
    }));
    const automatic = createAutomaticOutputFilename({
      title: tab.title,
      hostname: new URL(tab.url).hostname
    });
    automaticFilenamePreview.textContent = `Automatic: ${automatic.filename}`;
    outputFilenameInput.placeholder = automatic.filename;
  } catch {
    automaticFilenamePreview.textContent =
      "Automatic: DriveCapture_Webpage_<local-timestamp>.jpg";
  }
}

async function loadJpegQualityPreference() {
  let quality = DEFAULT_JPEG_QUALITY;
  try {
    const stored = await chrome.storage.sync.get(STORAGE_KEYS.JPEG_QUALITY);
    quality = resolveStoredJpegQuality(stored[STORAGE_KEYS.JPEG_QUALITY]);
  } catch {}
  jpegQualitySelect.value = String(quality);
}

async function saveJpegQualityPreference() {
  try {
    const quality = parseJpegQuality(jpegQualitySelect.value);
    await chrome.storage.sync.set({ [STORAGE_KEYS.JPEG_QUALITY]: quality });
  } catch {
    jpegQualitySelect.value = String(DEFAULT_JPEG_QUALITY);
  }
}

async function cancelFullPageCapture() {
  if (!activeFullPageRequestId) return;
  cancelFullPageButton.disabled = true;
  setCaptureState("restoring-page", "Restoring page…");
  const request = createMessage({
    type: MESSAGE_TYPES.FULL_PAGE_CAPTURE_CANCEL_REQUEST,
    source: CONTEXTS.POPUP,
    target: CONTEXTS.SERVICE_WORKER,
    payload: { captureRequestId: activeFullPageRequestId }
  });
  try { await chrome.runtime.sendMessage(request); } catch {}
  cancelFullPageButton.disabled = false;
}

async function restoreFullPageResult() {
  try {
    const response = await sendWorkerMessage(MESSAGE_TYPES.FULL_PAGE_RESULT_GET_REQUEST);
    if (response?.type === MESSAGE_TYPES.FULL_PAGE_RESULT_GET_RESPONSE &&
        validateFullPageResult(response.payload)) showFullPageResult(response.payload);
  } catch {}
}

function clearDiagnosticResults() {
  diagnosticResults.hidden = true;
  diagnosticMetadata.replaceChildren();
  diagnosticSteps.replaceChildren();
}

function addMetadata(label, value) {
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  const detail = document.createElement("dd");
  term.textContent = label;
  detail.textContent = value;
  wrapper.append(term, detail);
  diagnosticMetadata.append(wrapper);
}

function addSegmentedMetadata(label, value) {
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  const detail = document.createElement("dd");
  term.textContent = label;
  detail.textContent = value;
  wrapper.append(term, detail);
  segmentedMetadata.append(wrapper);
}

function clearSegmentedResults() {
  segmentedResults.hidden = true;
  segmentedMetadata.replaceChildren();
  segmentedSteps.replaceChildren();
}

function showSegmentedResult(result) {
  clearSegmentedResults();
  const first = result.segments[0];
  addSegmentedMetadata("CSS viewport", `${result.measurement.viewport.width} × ${result.measurement.viewport.height}`);
  addSegmentedMetadata("Document", `${result.measurement.document.width} × ${result.measurement.document.height}`);
  addSegmentedMetadata("Planned segments", String(result.plannedSegmentCount));
  addSegmentedMetadata("Captured segments", String(result.capturedSegmentCount));
  addSegmentedMetadata("Acknowledged segments", String(result.acknowledgedSegmentCount));
  addSegmentedMetadata("First bitmap", `${first.bitmap.width} × ${first.bitmap.height}`);
  addSegmentedMetadata("Capture scale", `${first.scale.x.toFixed(4)} × ${first.scale.y.toFixed(4)}`);
  addSegmentedMetadata("Total estimated bytes", new Intl.NumberFormat().format(result.totalEstimatedBytes));
  addSegmentedMetadata("Restored scroll", `${result.restoration.actual.x}, ${result.restoration.actual.y}`);
  addSegmentedMetadata("Duration", `${Math.round(result.durationMs)} ms`);
  result.segments.forEach((segment) => {
    const row = document.createElement("tr");
    for (const value of [
      segment.segmentIndex + 1,
      segment.requestedScrollY,
      segment.actualScrollY,
      segment.estimatedBytes,
      segment.captureIntervalMs === null ? "—" : `${segment.captureIntervalMs} ms`
    ]) {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      row.append(cell);
    }
    segmentedSteps.append(row);
  });
  segmentedResults.hidden = false;
}

function showDiagnosticResult(result) {
  clearDiagnosticResults();
  const measurement = result.measurement;
  addMetadata("Hostname", result.hostname);
  addMetadata("CSS viewport", `${measurement.viewport.width} × ${measurement.viewport.height}`);
  addMetadata("Document", `${measurement.document.width} × ${measurement.document.height}`);
  addMetadata("Maximum scroll", `${measurement.maximumScroll.x}, ${measurement.maximumScroll.y}`);
  addMetadata("Device pixel ratio", String(measurement.devicePixelRatio));
  addMetadata("Original scroll", `${measurement.originalScroll.x}, ${measurement.originalScroll.y}`);
  addMetadata("Planned positions", String(result.plannedPositions.length));
  addMetadata("Positions visited", String(result.steps.length));
  addMetadata("Restored scroll", `${result.restoration.actual.x}, ${result.restoration.actual.y}`);
  addMetadata("Restored within tolerance", result.restoration.withinTolerance ? "Yes" : "No");
  addMetadata("Duration", `${Math.round(result.durationMs)} ms`);
  result.steps.forEach((step, index) => {
    const row = document.createElement("tr");
    for (const value of [index + 1, step.requestedY, step.actualY, step.clamped ? "Yes" : "No"]) {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      row.append(cell);
    }
    diagnosticSteps.append(row);
  });
  diagnosticResults.hidden = false;
}

function resetMetadata() {
  previewFormat.textContent = "—";
  previewWidth.textContent = "—";
  previewHeight.textContent = "—";
  previewSize.textContent = "—";
  previewTimestamp.textContent = "—";
}

function releasePreview({ announce = true, restoreFocus = true } = {}) {
  previewImage.removeAttribute("src");
  previewDataUrl = null;
  pendingPreviewResult = null;
  previewSection.hidden = true;
  resetMetadata();

  if (announce) {
    setCaptureState("idle", "Idle — temporary preview cleared.");
  }

  if (restoreFocus) {
    captureButton.focus();
  }
}

async function checkWorkerConnection() {
  try {
    const response = await sendWorkerMessage(MESSAGE_TYPES.WORKER_PING_REQUEST);
    if (
      !validateMessageEnvelope(response) ||
      response.type !== MESSAGE_TYPES.WORKER_PING_RESPONSE ||
      response.payload.ok !== true
    ) {
      throw new Error("Invalid worker response.");
    }

    workerStatus.textContent = "Connected";
    workerStatus.dataset.state = "connected";
  } catch {
    workerStatus.textContent = "Unavailable";
    workerStatus.dataset.state = "error";
    liveStatus.textContent = "The service worker did not respond. Reload the extension and try again.";
  }
}

async function runScaffoldCheck() {
  setBusy(true);
  liveStatus.textContent = "Running the scaffold check…";

  try {
    const response = await sendWorkerMessage(
      MESSAGE_TYPES.OFFSCREEN_SCAFFOLD_CHECK_REQUEST
    );

    if (
      !validateMessageEnvelope(response) ||
      response.type !== MESSAGE_TYPES.OFFSCREEN_SCAFFOLD_CHECK_RESPONSE ||
      response.payload.ok !== true
    ) {
      throw new Error(userSafeError(response, "The scaffold check returned an invalid response."));
    }

    const { jobLock, offscreen } = response.payload.diagnostic;
    liveStatus.textContent =
      `Scaffold check passed. Job lock acquired and released: ${
        jobLock.acquired && jobLock.released ? "yes" : "no"
      }. Offscreen document created or reused, pinged, and closed: ${
        (offscreen.created || offscreen.reused) && offscreen.pinged && offscreen.closed
          ? "yes"
          : "no"
      }.`;
  } catch (error) {
    liveStatus.textContent =
      error instanceof Error
        ? `Scaffold check failed: ${error.message}`
        : "The scaffold check failed unexpectedly.";
  } finally {
    setBusy(false);
    scaffoldCheckButton.focus();
  }
}

function captureFailure(message) {
  releasePreview({ announce: false, restoreFocus: false });
  setCaptureState("capture-failed", `Capture failed — ${message}`);
  if (!captureButton.disabled) {
    captureButton.focus();
  }
}

async function captureVisibleViewport() {
  releasePreview({ announce: false, restoreFocus: false });
  setBusy(true);
  setCaptureState("validating-page", "Validating page…");

  const request = createWorkerRequest(MESSAGE_TYPES.VISIBLE_VIEWPORT_CAPTURE_REQUEST);
  activeCaptureRequestId = request.requestId;

  try {
    const response = await chrome.runtime.sendMessage(request);
    if (
      !validateMessageEnvelope(response) ||
      response.requestId !== request.requestId ||
      response.source !== CONTEXTS.SERVICE_WORKER ||
      response.target !== CONTEXTS.POPUP
    ) {
      throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
    }

    if (response.type === MESSAGE_TYPES.VISIBLE_VIEWPORT_CAPTURE_ERROR) {
      if (validateApplicationError(response.payload.error)) {
        throw response.payload.error;
      }
      throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
    }

    if (
      response.type !== MESSAGE_TYPES.VISIBLE_VIEWPORT_CAPTURE_SUCCESS ||
      !validateVisibleViewportResult(response.payload)
    ) {
      throw createApplicationError({ code: ERROR_CODES.INVALID_CAPTURE_RESULT });
    }

    pendingPreviewResult = response.payload;
    previewDataUrl = response.payload.dataUrl;
    previewSection.hidden = false;
    previewImage.src = previewDataUrl;
  } catch (error) {
    captureFailure(
      validateApplicationError(error)
        ? error.message
        : "The capture failed unexpectedly."
    );
  } finally {
    activeCaptureRequestId = null;
    setBusy(false);
    if (liveStatus.dataset.state === "capture-failed") {
      captureButton.focus();
    }
  }
}

async function runScrollDiagnostic() {
  clearDiagnosticResults();
  setBusy(true);
  cancelDiagnosticButton.hidden = false;
  setCaptureState("inspecting-page", "Inspecting page…");
  const request = createWorkerRequest(MESSAGE_TYPES.SCROLL_DIAGNOSTIC_REQUEST);
  activeDiagnosticRequestId = request.requestId;
  try {
    const response = await chrome.runtime.sendMessage(request);
    if (!validateMessageEnvelope(response) || response.requestId !== request.requestId) {
      throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
    }
    if (response.type === MESSAGE_TYPES.SCROLL_DIAGNOSTIC_ERROR) {
      throw validateApplicationError(response.payload.error)
        ? response.payload.error : createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
    }
    if (response.type !== MESSAGE_TYPES.SCROLL_DIAGNOSTIC_SUCCESS || !validateScrollDiagnosticResult(response.payload)) {
      throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
    }
    showDiagnosticResult(response.payload);
    setCaptureState("diagnostic-successful", "Diagnostic successful — original page position restored.");
  } catch (error) {
    setCaptureState("diagnostic-failed", `Diagnostic failed — ${validateApplicationError(error) ? error.message : "Unexpected internal failure."}`);
  } finally {
    activeDiagnosticRequestId = null;
    cancelDiagnosticButton.hidden = true;
    setBusy(false);
    diagnosticButton.focus();
  }
}

async function cancelScrollDiagnostic() {
  if (!activeDiagnosticRequestId) return;
  cancelDiagnosticButton.disabled = true;
  setCaptureState("restoring-page", "Restoring page…");
  const request = createMessage({
    type: MESSAGE_TYPES.SCROLL_DIAGNOSTIC_CANCEL_REQUEST,
    source: CONTEXTS.POPUP,
    target: CONTEXTS.SERVICE_WORKER,
    payload: { diagnosticRequestId: activeDiagnosticRequestId }
  });
  try { await chrome.runtime.sendMessage(request); } catch {}
  cancelDiagnosticButton.disabled = false;
}

async function runSegmentedCaptureDiagnostic() {
  clearSegmentedResults();
  setBusy(true);
  cancelSegmentedButton.hidden = false;
  setCaptureState("measuring-page", "Measuring page…");
  const request = createWorkerRequest(MESSAGE_TYPES.SEGMENTED_CAPTURE_DIAGNOSTIC_REQUEST);
  activeSegmentedRequestId = request.requestId;
  try {
    const response = await chrome.runtime.sendMessage(request);
    if (!validateMessageEnvelope(response) || response.requestId !== request.requestId) {
      throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
    }
    if (response.type === MESSAGE_TYPES.SEGMENTED_CAPTURE_DIAGNOSTIC_ERROR) {
      throw validateApplicationError(response.payload.error)
        ? response.payload.error
        : createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
    }
    if (response.type !== MESSAGE_TYPES.SEGMENTED_CAPTURE_DIAGNOSTIC_SUCCESS ||
        !validateSegmentedCaptureDiagnostic(response.payload)) {
      throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
    }
    showSegmentedResult(response.payload);
    setCaptureState("segmented-successful", "Diagnostic successful — every segment was acknowledged and released.");
  } catch (error) {
    const cancelled = validateApplicationError(error) && error.code === ERROR_CODES.OPERATION_CANCELLED;
    setCaptureState(
      cancelled ? "segmented-cancelled" : "segmented-failed",
      `${cancelled ? "Diagnostic cancelled" : "Diagnostic failed"} — ${
        validateApplicationError(error) ? error.message : "Unexpected internal failure."
      }`
    );
  } finally {
    activeSegmentedRequestId = null;
    cancelSegmentedButton.hidden = true;
    setBusy(false);
    segmentedButton.focus();
  }
}

async function cancelSegmentedCaptureDiagnostic() {
  if (!activeSegmentedRequestId) return;
  cancelSegmentedButton.disabled = true;
  setCaptureState("restoring-page", "Restoring page…");
  const request = createMessage({
    type: MESSAGE_TYPES.SEGMENTED_CAPTURE_DIAGNOSTIC_CANCEL_REQUEST,
    source: CONTEXTS.POPUP,
    target: CONTEXTS.SERVICE_WORKER,
    payload: { diagnosticRequestId: activeSegmentedRequestId }
  });
  try { await chrome.runtime.sendMessage(request); } catch {}
  cancelSegmentedButton.disabled = false;
}

function showLoadedPreview() {
  if (!pendingPreviewResult || !previewDataUrl) {
    return;
  }

  if (previewImage.naturalWidth <= 0 || previewImage.naturalHeight <= 0) {
    captureFailure("The preview dimensions are invalid.");
    return;
  }

  previewFormat.textContent = "JPEG";
  previewWidth.textContent = `${previewImage.naturalWidth} px`;
  previewHeight.textContent = `${previewImage.naturalHeight} px`;
  previewSize.textContent = `${new Intl.NumberFormat().format(
    pendingPreviewResult.estimatedBytes
  )} bytes`;
  previewTimestamp.textContent = new Date(
    pendingPreviewResult.capturedAt
  ).toLocaleString();
  pendingPreviewResult = null;
  setCaptureState("capture-successful", "Capture successful — temporary preview ready.");
  clearPreviewButton.focus();
}

chrome.runtime.onMessage.addListener((message) => {
  if (
    validateMessageEnvelope(message) &&
    message.type === MESSAGE_TYPES.VISIBLE_VIEWPORT_CAPTURE_STARTED &&
    message.source === CONTEXTS.SERVICE_WORKER &&
    message.target === CONTEXTS.POPUP &&
    message.requestId === activeCaptureRequestId &&
    message.payload.state === "capturing-viewport"
  ) {
    setCaptureState("capturing-viewport", "Capturing viewport…");
  }

  if (validateMessageEnvelope(message) && message.type === MESSAGE_TYPES.PAGE_SCROLL_PROGRESS &&
      message.source === CONTEXTS.SERVICE_WORKER && message.target === CONTEXTS.POPUP &&
      message.requestId === activeDiagnosticRequestId) {
    const progress = message.payload;
    if (progress.state === "inspecting-page") setCaptureState("inspecting-page", "Inspecting page…");
    if (progress.state === "creating-scroll-plan") setCaptureState("creating-scroll-plan", "Creating scroll plan…");
    if (progress.state === "scrolling") setCaptureState("scrolling", `Scrolling — Step ${progress.step} of ${progress.total}`);
    if (progress.state === "restoring-page") setCaptureState("restoring-page", "Restoring page…");
  }

  if (validateMessageEnvelope(message) &&
      message.type === MESSAGE_TYPES.SEGMENTED_CAPTURE_DIAGNOSTIC_PROGRESS &&
      message.source === CONTEXTS.SERVICE_WORKER && message.target === CONTEXTS.POPUP &&
      message.requestId === activeSegmentedRequestId) {
    const progress = message.payload;
    if (progress.state === "measuring-page") setCaptureState("measuring-page", "Measuring page…");
    if (progress.state === "preparing-offscreen") setCaptureState("preparing-offscreen", "Preparing offscreen processor…");
    if (progress.state === "scrolling") setCaptureState("scrolling", `Scrolling — Step ${progress.step} of ${progress.total}`);
    if (progress.state === "waiting-to-capture") setCaptureState("waiting-to-capture", "Waiting to capture…");
    if (progress.state === "capturing-segment") setCaptureState("capturing-segment", `Capturing segment ${progress.step} of ${progress.total}…`);
    if (progress.state === "decoding-segment") setCaptureState("decoding-segment", `Decoding segment ${progress.step} of ${progress.total}…`);
    if (progress.state === "restoring-page") setCaptureState("restoring-page", "Restoring page…");
  }

  if (validateMessageEnvelope(message) && message.type === MESSAGE_TYPES.FULL_PAGE_CAPTURE_PROGRESS &&
      message.source === CONTEXTS.SERVICE_WORKER && message.target === CONTEXTS.POPUP &&
      message.requestId === activeFullPageRequestId) {
    const progress = message.payload;
    if (progress.state === "measuring-page") setCaptureState("measuring-page", "Measuring page…");
    if (progress.state === "preparing-offscreen") setCaptureState("preparing-offscreen", "Preparing offscreen processor…");
    if (progress.state === "preparing-canvas") setCaptureState("preparing-canvas", "Preparing canvas…");
    if (progress.state === "inspecting-overlays") setCaptureState("inspecting-overlays", "Inspecting fixed and sticky elements…");
    if (progress.state === "suppressing-overlays") setCaptureState("suppressing-overlays", "Suppressing repeated overlays…");
    if (progress.state === "scrolling") setCaptureState("scrolling", `Scrolling — Step ${progress.step} of ${progress.total}`);
    if (progress.state === "waiting-to-capture") setCaptureState("waiting-to-capture", "Waiting to capture…");
    if (progress.state === "capturing-segment") setCaptureState("capturing-segment", `Capturing segment ${progress.step} of ${progress.total}…`);
    if (progress.state === "drawing-segment") setCaptureState("drawing-segment", `Drawing segment ${progress.step} of ${progress.total}…`);
    if (progress.state === "encoding-image") setCaptureState("encoding-image", "Encoding temporary JPEG…");
    if (progress.state === "restoring-page") setCaptureState("restoring-page", "Restoring page…");
    if (progress.state === "restoring-overlays") setCaptureState("restoring-overlays", "Restoring page overlays…");
  }

  if (validateMessageEnvelope(message) &&
      message.type === MESSAGE_TYPES.DRIVE_SETUP_PROGRESS &&
      message.source === CONTEXTS.SERVICE_WORKER &&
      message.target === CONTEXTS.POPUP &&
      message.requestId === activeDriveSetupRequestId) {
    driveOutcome.textContent = message.payload.state === "connecting"
      ? "Waiting for Google authorization…"
      : "Checking the managed DriveCapture folder…";
  }

  if (validateMessageEnvelope(message) &&
      message.type === MESSAGE_TYPES.DRIVE_SETUP_RESULT &&
      message.source === CONTEXTS.SERVICE_WORKER &&
      message.target === CONTEXTS.POPUP &&
      activeDriveSetupRequestId === null) {
    showDriveSetupResult(message.payload);
  }

  return false;
});

scaffoldCheckButton.addEventListener("click", runScaffoldCheck);
captureButton.addEventListener("click", captureVisibleViewport);
clearPreviewButton.addEventListener("click", () => releasePreview());
diagnosticButton.addEventListener("click", runScrollDiagnostic);
cancelDiagnosticButton.addEventListener("click", cancelScrollDiagnostic);
segmentedButton.addEventListener("click", runSegmentedCaptureDiagnostic);
cancelSegmentedButton.addEventListener("click", cancelSegmentedCaptureDiagnostic);
fullPageButton.addEventListener("click", runFullPageCapture);
cancelFullPageButton.addEventListener("click", cancelFullPageCapture);
clearFullPageButton.addEventListener("click", () => clearFullPageResult());
jpegQualitySelect.addEventListener("change", saveJpegQualityPreference);
driveConnectButton.addEventListener("click", () =>
  runDriveSetupAction(MESSAGE_TYPES.DRIVE_SETUP_CONNECT_REQUEST));
driveCheckFolderButton.addEventListener("click", () =>
  runDriveSetupAction(MESSAGE_TYPES.DRIVE_SETUP_ENSURE_FOLDER_REQUEST));
driveDisconnectButton.addEventListener("click", () =>
  runDriveSetupAction(MESSAGE_TYPES.DRIVE_SETUP_DISCONNECT_REQUEST));
fullPagePreviewImage.addEventListener("error", () => {
  void clearFullPageResult({ announce: false });
  setCaptureState("full-page-failed", "Capture failed — the temporary full-page preview could not be displayed.");
});
previewImage.addEventListener("load", showLoadedPreview);
previewImage.addEventListener("error", () => captureFailure("The JPEG preview could not be displayed."));
window.addEventListener("pagehide", () => {
  activeCaptureRequestId = null;
  releasePreview({ announce: false, restoreFocus: false });
  if (!fullPagePreview.hidden) void clearFullPageResult({ announce: false });
});
void checkWorkerConnection();
void loadJpegQualityPreference();
void refreshAutomaticFilenamePreview();
void restoreFullPageResult();
void runDriveSetupAction(MESSAGE_TYPES.DRIVE_SETUP_STATUS_REQUEST, { busy: false });
