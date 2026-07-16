import { VISIBLE_VIEWPORT_JPEG_QUALITY } from "../shared/constants.js";
import {
  createApplicationError,
  ERROR_CODES,
  validateApplicationError
} from "../shared/errors.js";
import { createRequestId } from "../shared/messages.js";
import {
  estimateBase64DataUrlBytes,
  JPEG_MIME_TYPE,
  validateActiveTabResults,
  validateVisibleViewportResult,
  VISIBLE_VIEWPORT_MODE
} from "../shared/visible-viewport.js";

function structuredCaptureError(error, operation) {
  if (validateApplicationError(error)) {
    return error;
  }

  return createApplicationError({
    code: ERROR_CODES.CAPTURE_FAILED,
    context: { operation }
  });
}

export function createVisibleViewportCaptureCoordinator({
  tabAdapter,
  jobState,
  now = Date.now,
  createJobId = createRequestId
}) {
  if (!tabAdapter || !jobState) {
    throw new TypeError("Tab and job-state adapters are required.");
  }

  async function captureVisibleViewport({ onCaptureStarted = () => undefined } = {}) {
    const jobId = createJobId();

    try {
      await jobState.acquireJobLock({
        id: jobId,
        tabId: null,
        phase: "capturing-visible-viewport",
        startedAt: now()
      });
    } catch (error) {
      throw structuredCaptureError(error, "acquire-capture-lock");
    }

    let result = null;
    let operationError = null;

    try {
      let tabs;
      try {
        tabs = await tabAdapter.queryActiveTab();
      } catch (error) {
        throw structuredCaptureError(error, "query-active-tab");
      }

      const activeTab = validateActiveTabResults(tabs);
      onCaptureStarted();

      let dataUrl;
      try {
        dataUrl = await tabAdapter.captureVisibleTab(activeTab.windowId, {
          format: "jpeg",
          quality: VISIBLE_VIEWPORT_JPEG_QUALITY
        });
      } catch (error) {
        throw structuredCaptureError(error, "capture-visible-tab");
      }

      result = {
        mode: VISIBLE_VIEWPORT_MODE,
        dataUrl,
        mimeType: JPEG_MIME_TYPE,
        estimatedBytes: estimateBase64DataUrlBytes(dataUrl),
        capturedAt: now()
      };

      if (!validateVisibleViewportResult(result)) {
        throw createApplicationError({ code: ERROR_CODES.INVALID_CAPTURE_RESULT });
      }
    } catch (error) {
      operationError = structuredCaptureError(error, "capture-visible-viewport");
    } finally {
      try {
        const released = await jobState.releaseJobLock(jobId);
        if (!released) {
          throw new Error("Capture lock was not released.");
        }
      } catch {
        operationError = createApplicationError({
          code: ERROR_CODES.INTERNAL_ERROR,
          message: "DriveCapture could not finish capture cleanup safely.",
          context: { operation: "release-capture-lock" }
        });
        result = null;
      }
    }

    if (operationError) {
      throw operationError;
    }

    return result;
  }

  return Object.freeze({ captureVisibleViewport });
}
