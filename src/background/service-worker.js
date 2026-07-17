import {
  CONTEXTS,
  CURRENT_EXTENSION_PHASE,
  OFFSCREEN_DOCUMENT_PATH
} from "../shared/constants.js";
import {
  createApplicationError,
  ERROR_CODES,
  serializeUnknownError,
  validateApplicationError
} from "../shared/errors.js";
import {
  createMessage,
  createRequestId,
  isKnownContext,
  MESSAGE_TYPES,
  validateMessageEnvelope
} from "../shared/messages.js";
import { createJobState } from "./job-state.js";
import { createChromeTabAdapter } from "./tab-adapter.js";
import { createVisibleViewportCaptureCoordinator } from "./visible-viewport-capture.js";
import { createPageScriptAdapter } from "./page-script-adapter.js";
import { createPageScrollDiagnosticCoordinator } from "./page-scroll-diagnostic.js";
import { createOffscreenSegmentAdapter } from "./offscreen-segment-adapter.js";
import { createSegmentedCaptureDiagnosticCoordinator } from "./segmented-capture-diagnostic.js";

const jobState = createJobState();
const visibleViewportCapture = createVisibleViewportCaptureCoordinator({
  tabAdapter: createChromeTabAdapter(),
  jobState
});
const pageScrollDiagnostic = createPageScrollDiagnosticCoordinator({
  tabAdapter: createChromeTabAdapter(),
  pageAdapter: createPageScriptAdapter(),
  jobState
});
const segmentedCaptureDiagnostic = createSegmentedCaptureDiagnosticCoordinator({
  tabAdapter: createChromeTabAdapter(),
  pageAdapter: createPageScriptAdapter(),
  offscreenAdapter: createOffscreenSegmentAdapter(),
  jobState
});

chrome.runtime.onInstalled.addListener(() => {
  // Installation intentionally performs no authentication, capture, or network work.
});

function getResponseTarget(message) {
  return isKnownContext(message?.source) ? message.source : CONTEXTS.POPUP;
}

function createErrorResponse(request, error) {
  return createMessage({
    type:
      request?.type === MESSAGE_TYPES.VISIBLE_VIEWPORT_CAPTURE_REQUEST
        ? MESSAGE_TYPES.VISIBLE_VIEWPORT_CAPTURE_ERROR
        : request?.type === MESSAGE_TYPES.SCROLL_DIAGNOSTIC_REQUEST
          ? MESSAGE_TYPES.SCROLL_DIAGNOSTIC_ERROR
          : request?.type === MESSAGE_TYPES.SEGMENTED_CAPTURE_DIAGNOSTIC_REQUEST
            ? MESSAGE_TYPES.SEGMENTED_CAPTURE_DIAGNOSTIC_ERROR
        : MESSAGE_TYPES.APPLICATION_ERROR_RESPONSE,
    source: CONTEXTS.SERVICE_WORKER,
    target: getResponseTarget(request),
    requestId:
      typeof request?.requestId === "string" && request.requestId
        ? request.requestId
        : createRequestId(),
    payload: {
      ok: false,
      error: serializeUnknownError(error)
    }
  });
}

function notifyVisibleViewportCaptureStarted(requestId) {
  const message = createMessage({
    type: MESSAGE_TYPES.VISIBLE_VIEWPORT_CAPTURE_STARTED,
    source: CONTEXTS.SERVICE_WORKER,
    target: CONTEXTS.POPUP,
    requestId,
    payload: { state: "capturing-viewport" }
  });

  void chrome.runtime.sendMessage(message).catch(() => {
    // The popup may have closed. Capture cleanup and the main response continue.
  });
}

function notifyScrollProgress(requestId, payload) {
  void chrome.runtime.sendMessage(createMessage({
    type: MESSAGE_TYPES.PAGE_SCROLL_PROGRESS,
    source: CONTEXTS.SERVICE_WORKER,
    target: CONTEXTS.POPUP,
    requestId,
    payload
  })).catch(() => {});
}

function notifySegmentedCaptureProgress(requestId, payload) {
  void chrome.runtime.sendMessage(createMessage({
    type: MESSAGE_TYPES.SEGMENTED_CAPTURE_DIAGNOSTIC_PROGRESS,
    source: CONTEXTS.SERVICE_WORKER,
    target: CONTEXTS.POPUP,
    requestId,
    payload
  })).catch(() => {});
}

async function getOffscreenContexts() {
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  return chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [documentUrl]
  });
}

async function ensureOffscreenDocument() {
  const existingContexts = await getOffscreenContexts();
  if (existingContexts.length > 0) {
    return { created: false, reused: true };
  }

  try {
    await chrome.offscreen.createDocument({
      url: "src/offscreen/offscreen.html",
      reasons: ["BLOBS"],
      justification:
        "Decode captured images, stitch them on a canvas, encode a JPEG Blob, and upload it to Google Drive."
    });
    return { created: true, reused: false };
  } catch (error) {
    const contextsAfterFailure = await getOffscreenContexts();
    if (contextsAfterFailure.length > 0) {
      return { created: false, reused: true };
    }

    throw createApplicationError({
      code: ERROR_CODES.OFFSCREEN_UNAVAILABLE,
      context: { operation: "create-offscreen-document" }
    });
  }
}

async function pingOffscreenDocument(requestId) {
  let response;
  try {
    response = await chrome.runtime.sendMessage(
      createMessage({
        type: MESSAGE_TYPES.OFFSCREEN_PING_REQUEST,
        source: CONTEXTS.SERVICE_WORKER,
        target: CONTEXTS.OFFSCREEN,
        requestId,
        payload: {}
      })
    );
  } catch {
    throw createApplicationError({
      code: ERROR_CODES.OFFSCREEN_UNAVAILABLE,
      context: { operation: "ping-offscreen-document" }
    });
  }

  if (
    !validateMessageEnvelope(response) ||
    response.type !== MESSAGE_TYPES.OFFSCREEN_PING_RESPONSE ||
    response.source !== CONTEXTS.OFFSCREEN ||
    response.target !== CONTEXTS.SERVICE_WORKER ||
    response.requestId !== requestId ||
    response.payload.ok !== true
  ) {
    if (validateApplicationError(response?.payload?.error)) {
      throw response.payload.error;
    }

    throw createApplicationError({
      code: ERROR_CODES.OFFSCREEN_UNAVAILABLE,
      context: { operation: "validate-offscreen-response" }
    });
  }

  return response.payload;
}

async function closeOffscreenDocument() {
  const existingContexts = await getOffscreenContexts();
  if (existingContexts.length === 0) {
    return false;
  }

  await chrome.offscreen.closeDocument();
  return true;
}

async function runScaffoldCheck(request) {
  const jobId = createRequestId();
  const diagnostic = {
    phase: CURRENT_EXTENSION_PHASE,
    jobLock: { acquired: false, released: false },
    offscreen: { created: false, reused: false, pinged: false, closed: false }
  };

  await jobState.acquireJobLock({
    id: jobId,
    tabId: null,
    phase: "scaffold-test",
    startedAt: Date.now()
  });
  diagnostic.jobLock.acquired = true;

  let operationError = null;

  try {
    await jobState.updateJobPhase(jobId, "offscreen-create");
    const lifecycle = await ensureOffscreenDocument();
    diagnostic.offscreen.created = lifecycle.created;
    diagnostic.offscreen.reused = lifecycle.reused;

    await jobState.updateJobPhase(jobId, "offscreen-ping");
    await pingOffscreenDocument(request.requestId);
    diagnostic.offscreen.pinged = true;
  } catch (error) {
    operationError = error;
  } finally {
    try {
      await jobState.updateJobPhase(jobId, "offscreen-close");
    } catch (error) {
      operationError ??= error;
    }

    try {
      diagnostic.offscreen.closed = await closeOffscreenDocument();
    } catch (error) {
      operationError ??= createApplicationError({
        code: ERROR_CODES.OFFSCREEN_UNAVAILABLE,
        context: { operation: "close-offscreen-document" }
      });
    }

    try {
      diagnostic.jobLock.released = await jobState.releaseJobLock(jobId);
    } catch (error) {
      operationError ??= error;
    }
  }

  if (operationError) {
    throw operationError;
  }

  return createMessage({
    type: MESSAGE_TYPES.OFFSCREEN_SCAFFOLD_CHECK_RESPONSE,
    source: CONTEXTS.SERVICE_WORKER,
    target: CONTEXTS.POPUP,
    requestId: request.requestId,
    payload: { ok: true, diagnostic }
  });
}

async function handleMessage(message) {
  if (!validateMessageEnvelope(message)) {
    throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
  }

  if (message.target !== CONTEXTS.SERVICE_WORKER) {
    return null;
  }

  switch (message.type) {
    case MESSAGE_TYPES.WORKER_PING_REQUEST:
      return createMessage({
        type: MESSAGE_TYPES.WORKER_PING_RESPONSE,
        source: CONTEXTS.SERVICE_WORKER,
        target: message.source,
        requestId: message.requestId,
        payload: { ok: true, phase: CURRENT_EXTENSION_PHASE }
      });

    case MESSAGE_TYPES.OFFSCREEN_SCAFFOLD_CHECK_REQUEST:
      if (message.source !== CONTEXTS.POPUP) {
        throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
      }
      return runScaffoldCheck(message);

    case MESSAGE_TYPES.VISIBLE_VIEWPORT_CAPTURE_REQUEST: {
      if (message.source !== CONTEXTS.POPUP) {
        throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
      }

      const result = await visibleViewportCapture.captureVisibleViewport({
        onCaptureStarted: () => notifyVisibleViewportCaptureStarted(message.requestId)
      });

      return createMessage({
        type: MESSAGE_TYPES.VISIBLE_VIEWPORT_CAPTURE_SUCCESS,
        source: CONTEXTS.SERVICE_WORKER,
        target: CONTEXTS.POPUP,
        requestId: message.requestId,
        payload: result
      });
    }

    case MESSAGE_TYPES.SCROLL_DIAGNOSTIC_REQUEST: {
      if (message.source !== CONTEXTS.POPUP) throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
      const diagnostic = await pageScrollDiagnostic.run({
        requestId: message.requestId,
        onProgress: (payload) => notifyScrollProgress(message.requestId, payload)
      });
      return createMessage({
        type: MESSAGE_TYPES.SCROLL_DIAGNOSTIC_SUCCESS,
        source: CONTEXTS.SERVICE_WORKER,
        target: CONTEXTS.POPUP,
        requestId: message.requestId,
        payload: diagnostic
      });
    }

    case MESSAGE_TYPES.SCROLL_DIAGNOSTIC_CANCEL_REQUEST:
      if (message.source !== CONTEXTS.POPUP || typeof message.payload.diagnosticRequestId !== "string") {
        throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
      }
      return createMessage({
        type: MESSAGE_TYPES.SCROLL_DIAGNOSTIC_CANCEL_RESPONSE,
        source: CONTEXTS.SERVICE_WORKER,
        target: CONTEXTS.POPUP,
        requestId: message.requestId,
        payload: { accepted: pageScrollDiagnostic.cancel(message.payload.diagnosticRequestId) }
      });

    case MESSAGE_TYPES.SEGMENTED_CAPTURE_DIAGNOSTIC_REQUEST: {
      if (message.source !== CONTEXTS.POPUP) throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
      const diagnostic = await segmentedCaptureDiagnostic.run({
        requestId: message.requestId,
        onProgress: (payload) => notifySegmentedCaptureProgress(message.requestId, payload)
      });
      return createMessage({
        type: MESSAGE_TYPES.SEGMENTED_CAPTURE_DIAGNOSTIC_SUCCESS,
        source: CONTEXTS.SERVICE_WORKER,
        target: CONTEXTS.POPUP,
        requestId: message.requestId,
        payload: diagnostic
      });
    }

    case MESSAGE_TYPES.SEGMENTED_CAPTURE_DIAGNOSTIC_CANCEL_REQUEST:
      if (message.source !== CONTEXTS.POPUP || typeof message.payload.diagnosticRequestId !== "string") {
        throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
      }
      return createMessage({
        type: MESSAGE_TYPES.SEGMENTED_CAPTURE_DIAGNOSTIC_CANCEL_RESPONSE,
        source: CONTEXTS.SERVICE_WORKER,
        target: CONTEXTS.POPUP,
        requestId: message.requestId,
        payload: { accepted: segmentedCaptureDiagnostic.cancel(message.payload.diagnosticRequestId) }
      });

    default:
      throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (validateMessageEnvelope(message) && message.target !== CONTEXTS.SERVICE_WORKER) {
    return false;
  }

  handleMessage(message)
    .then((response) => {
      if (response) {
        sendResponse(response);
      }
    })
    .catch((error) => {
      sendResponse(createErrorResponse(message, error));
    });

  return true;
});
