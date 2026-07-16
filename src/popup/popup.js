import { CONTEXTS } from "../shared/constants.js";
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
import { validateVisibleViewportResult } from "../shared/visible-viewport.js";

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

let activeCaptureRequestId = null;
let pendingPreviewResult = null;
let previewDataUrl = null;

function userSafeError(response, fallback) {
  const error = response?.payload?.error;
  return validateApplicationError(error) ? error.message : fallback;
}

function createWorkerRequest(type) {
  return createMessage({
    type,
    source: CONTEXTS.POPUP,
    target: CONTEXTS.SERVICE_WORKER,
    payload: {}
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

  return false;
});

scaffoldCheckButton.addEventListener("click", runScaffoldCheck);
captureButton.addEventListener("click", captureVisibleViewport);
clearPreviewButton.addEventListener("click", () => releasePreview());
previewImage.addEventListener("load", showLoadedPreview);
previewImage.addEventListener("error", () => captureFailure("The JPEG preview could not be displayed."));
window.addEventListener("pagehide", () => {
  activeCaptureRequestId = null;
  releasePreview({ announce: false, restoreFocus: false });
});
void checkWorkerConnection();
