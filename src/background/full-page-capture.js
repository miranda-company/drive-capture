import {
  CANCELLATION_POLL_INTERVAL_MS,
  DIAGNOSTIC_RENDER_DELAY_MS,
  MAX_DIAGNOSTIC_PLAN_REVISIONS,
  MAX_DIAGNOSTIC_SCROLL_STEPS,
  MAX_OVERLAY_CANDIDATES,
  MAX_VIEWPORT_CHANGE_PX,
  MINIMUM_CAPTURE_INTERVAL_MS,
  OVERLAY_GEOMETRY_TOLERANCE_PX,
  OVERLAY_SETTLE_DELAY_MS,
  SCROLL_POSITION_TOLERANCE_PX,
  SCROLL_SETTLE_TIMEOUT_MS,
  VISIBLE_VIEWPORT_JPEG_QUALITY
} from "../shared/constants.js";
import { createApplicationError, ERROR_CODES, validateApplicationError } from "../shared/errors.js";
import { createPageMeasurement, validateDocumentIdentity, validateRestorationResult, validateScrollStepResult } from "../shared/page-measurement.js";
import { createRequestId } from "../shared/messages.js";
import { createVerticalScrollPlan } from "../shared/scroll-plan.js";
import { validateFullPageResult } from "../shared/stitching.js";
import {
  validateOverlayPrepareResult,
  validateOverlayRestoration
} from "../shared/overlay-handling.js";
import { estimateBase64DataUrlBytes, validateActiveTabResults } from "../shared/visible-viewport.js";

const structured = (error, code = ERROR_CODES.INTERNAL_ERROR) =>
  validateApplicationError(error) ? error : createApplicationError({ code });

export function createFullPageCaptureCoordinator({
  tabAdapter,
  pageAdapter,
  offscreenAdapter,
  jobState,
  now = Date.now,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  createJobId = createRequestId,
  onSegmentReleased = () => undefined
}) {
  const active = new Map();
  const cancellations = new Set();

  function checkCancelled(requestId) {
    if (cancellations.has(requestId)) {
      throw createApplicationError({ code: ERROR_CODES.OPERATION_CANCELLED });
    }
  }

  function cancel(requestId) {
    const operation = active.get(requestId);
    if (!operation) return false;
    cancellations.add(requestId);
    if (operation.tabId !== null) void pageAdapter.cancel(operation.tabId, requestId).catch(() => {});
    return true;
  }

  async function waitForCaptureSlot(requestId, lastCaptureAt, onProgress, step, total) {
    if (lastCaptureAt === null) return;
    while (now() - lastCaptureAt < MINIMUM_CAPTURE_INTERVAL_MS) {
      checkCancelled(requestId);
      onProgress({ state: "waiting-to-capture", step, total });
      const remaining = MINIMUM_CAPTURE_INTERVAL_MS - (now() - lastCaptureAt);
      await delay(Math.min(CANCELLATION_POLL_INTERVAL_MS, remaining));
    }
    checkCancelled(requestId);
  }

  async function run({
    requestId,
    suppressOverlays = true,
    onProgress = () => undefined
  }) {
    if (typeof suppressOverlays !== "boolean") {
      throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
    }
    const jobId = createJobId();
    const startedAt = now();
    const operation = { tabId: null };
    active.set(requestId, operation);
    let locked = false;
    let initialized = false;
    let offscreenReady = false;
    let sessionStarted = false;
    let sessionFinished = false;
    let tab;
    let identity;
    let restoration;
    let result;
    let operationError;
    let currentDataUrl = null;
    let overlayHandlingStarted = false;
    let overlaySummary = { detected: 0, suppressed: 0 };
    let overlayRestoration = {
      detected: 0,
      suppressed: 0,
      restored: 0,
      restorationSucceeded: true,
      applicable: true
    };
    const captureTimestamps = [];

    try {
      await jobState.acquireJobLock({ id: jobId, tabId: null, phase: "capturing-full-page-locally", startedAt });
      locked = true;
      onProgress({ state: "measuring-page" });
      tab = validateActiveTabResults(await tabAdapter.queryActiveTab());
      operation.tabId = tab.id;
      checkCancelled(requestId);
      await pageAdapter.inject(tab.id);
      const initializedPage = await pageAdapter.initialize(tab.id, requestId, {
        maxViewportChange: MAX_VIEWPORT_CHANGE_PX
      });
      identity = initializedPage.identity;
      if (!validateDocumentIdentity(identity)) throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
      initialized = true;
      const measured = await pageAdapter.measure(tab.id, requestId, { identity });
      let measurement = createPageMeasurement(measured.rawMeasurement);
      let targets = [...createVerticalScrollPlan({
        viewportHeight: measurement.viewport.height,
        documentHeight: measurement.document.height,
        maximumScrollY: measurement.maximumScroll.y
      })];

      onProgress({ state: "preparing-offscreen" });
      await offscreenAdapter.ensureDocument();
      offscreenReady = true;
      await offscreenAdapter.clearResult();

      let allocatedDocumentHeight = null;
      let previousHeight = measurement.document.height;
      let preallocationRevisionCount = 0;

      for (let index = 0; index < targets.length; index += 1) {
        checkCancelled(requestId);
        onProgress({ state: "scrolling", step: index + 1, total: targets.length });
        const rawStep = await pageAdapter.scrollStep(tab.id, requestId, {
          identity,
          targetY: targets[index],
          previousDocumentHeight: previousHeight,
          settleTimeoutMs: SCROLL_SETTLE_TIMEOUT_MS,
          tolerance: SCROLL_POSITION_TOLERANCE_PX,
          renderDelayMs: DIAGNOSTIC_RENDER_DELAY_MS
        });
        const step = {
          identity: rawStep.identity,
          requestedY: rawStep.requestedY,
          actualY: rawStep.actualY,
          clamped: rawStep.clamped,
          documentHeightChanged: rawStep.documentHeightChanged,
          measurement: createPageMeasurement(rawStep.rawMeasurement)
        };
        if (!validateScrollStepResult(step)) throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
        measurement = step.measurement;

        if (!sessionStarted && measurement.document.height !== previousHeight) {
          preallocationRevisionCount += 1;
          if (preallocationRevisionCount > MAX_DIAGNOSTIC_PLAN_REVISIONS) {
            throw createApplicationError({ code: ERROR_CODES.DYNAMIC_PAGE_UNSTABLE });
          }
          targets = [...createVerticalScrollPlan({
            viewportHeight: measurement.viewport.height,
            documentHeight: measurement.document.height,
            maximumScrollY: measurement.maximumScroll.y
          })];
          index = -1;
          previousHeight = measurement.document.height;
          continue;
        }
        if (sessionStarted && measurement.document.height !== allocatedDocumentHeight) {
          throw createApplicationError({ code: ERROR_CODES.DYNAMIC_PAGE_UNSTABLE });
        }

        if (!sessionStarted) {
          onProgress({ state: "preparing-canvas" });
          allocatedDocumentHeight = measurement.document.height;
          await offscreenAdapter.startSession({
            sessionId: jobId,
            expectedMaximumSegments: MAX_DIAGNOSTIC_SCROLL_STEPS,
            documentDimensions: { ...measurement.document }
          });
          sessionStarted = true;
        }
        previousHeight = measurement.document.height;

        if (suppressOverlays) {
          checkCancelled(requestId);
          onProgress({
            state: index === 0 ? "inspecting-overlays" : "suppressing-overlays",
            step: index + 1,
            total: targets.length
          });
          overlayHandlingStarted = true;
          const prepared = await pageAdapter.prepareOverlays(tab.id, requestId, {
            identity,
            suppress: index > 0,
            maxCandidates: MAX_OVERLAY_CANDIDATES,
            settleDelayMs: OVERLAY_SETTLE_DELAY_MS,
            expectedScrollY: rawStep.actualY
          });
          if (!validateOverlayPrepareResult(prepared)) {
            throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
          }
          overlaySummary = {
            detected: prepared.detected,
            suppressed: prepared.suppressed
          };
          const afterSuppression = createPageMeasurement(prepared.rawMeasurement);
          const geometryStable =
            Math.abs(afterSuppression.viewport.width - measurement.viewport.width) <= OVERLAY_GEOMETRY_TOLERANCE_PX &&
            Math.abs(afterSuppression.viewport.height - measurement.viewport.height) <= OVERLAY_GEOMETRY_TOLERANCE_PX &&
            Math.abs(afterSuppression.document.width - measurement.document.width) <= OVERLAY_GEOMETRY_TOLERANCE_PX &&
            Math.abs(afterSuppression.document.height - measurement.document.height) <= OVERLAY_GEOMETRY_TOLERANCE_PX &&
            Math.abs(afterSuppression.originalScroll.x - measurement.originalScroll.x) <= OVERLAY_GEOMETRY_TOLERANCE_PX &&
            Math.abs(afterSuppression.originalScroll.y - rawStep.actualY) <= OVERLAY_GEOMETRY_TOLERANCE_PX;
          if (!geometryStable) {
            throw createApplicationError({ code: ERROR_CODES.OVERLAY_SUPPRESSION_UNSTABLE });
          }
          measurement = afterSuppression;
          checkCancelled(requestId);
        }

        await waitForCaptureSlot(requestId, captureTimestamps.at(-1) ?? null,
          onProgress, index + 1, targets.length);
        checkCancelled(requestId);
        onProgress({ state: "capturing-segment", step: index + 1, total: targets.length });
        const capturedAt = now();
        try {
          currentDataUrl = await tabAdapter.captureVisibleTab(tab.windowId, {
            format: "jpeg", quality: VISIBLE_VIEWPORT_JPEG_QUALITY
          });
        } catch {
          throw createApplicationError({ code: ERROR_CODES.CAPTURE_FAILED });
        }
        captureTimestamps.push(capturedAt);
        let estimatedBytes;
        try {
          estimatedBytes = estimateBase64DataUrlBytes(currentDataUrl);
        } catch {
          throw createApplicationError({ code: ERROR_CODES.INVALID_CAPTURE_RESULT });
        }
        checkCancelled(requestId);
        onProgress({ state: "drawing-segment", step: index + 1, total: targets.length });
        await offscreenAdapter.drawSegment({
          sessionId: jobId,
          segmentIndex: index,
          requestedScrollY: rawStep.requestedY,
          actualScrollY: rawStep.actualY,
          cssViewport: { ...measurement.viewport },
          dataUrl: currentDataUrl,
          mimeType: "image/jpeg",
          estimatedBytes,
          capturedAt
        });
        currentDataUrl = null;
        onSegmentReleased({ segmentIndex: index });
        checkCancelled(requestId);
      }

      checkCancelled(requestId);
      onProgress({ state: "encoding-image" });
      result = await offscreenAdapter.finishSession({ sessionId: jobId });
      sessionFinished = true;
      if (!validateFullPageResult(result)) throw createApplicationError({ code: ERROR_CODES.INVALID_CAPTURE_RESULT });
      checkCancelled(requestId);
    } catch (error) {
      operationError = structured(error);
    } finally {
      if (currentDataUrl !== null) {
        currentDataUrl = null;
        onSegmentReleased({ segmentIndex: null });
      }
      if (sessionStarted && !sessionFinished) {
        try { await offscreenAdapter.abortSession({ sessionId: jobId }); }
        catch (error) { operationError ??= structured(error, ERROR_CODES.OFFSCREEN_SESSION_FAILED); }
      }
      if (overlayHandlingStarted) {
        onProgress({ state: "restoring-overlays" });
        try {
          const restored = await pageAdapter.restoreOverlays(tab.id, requestId, { identity });
          if (!validateOverlayRestoration(restored) || !restored.applicable ||
              !restored.restorationSucceeded || restored.restored !== restored.detected) {
            throw createApplicationError({ code: ERROR_CODES.OVERLAY_RESTORATION_FAILED });
          }
          overlayRestoration = restored;
        } catch (error) {
          if (operationError?.code === ERROR_CODES.PAGE_CHANGED ||
              error?.code === ERROR_CODES.PAGE_CHANGED ||
              error?.code === ERROR_CODES.PAGE_SCRIPT_UNAVAILABLE) {
            overlayRestoration = {
              detected: overlaySummary.detected,
              suppressed: overlaySummary.suppressed,
              restored: 0,
              restorationSucceeded: false,
              applicable: false
            };
          } else {
            operationError = createApplicationError({
              code: ERROR_CODES.OVERLAY_RESTORATION_FAILED
            });
          }
        }
      }
      if (initialized) {
        onProgress({ state: "restoring-page" });
        try {
          restoration = await pageAdapter.restore(tab.id, requestId, {
            identity,
            settleTimeoutMs: SCROLL_SETTLE_TIMEOUT_MS,
            tolerance: SCROLL_POSITION_TOLERANCE_PX
          });
          if (!validateRestorationResult(restoration) || !restoration.withinTolerance) {
            throw createApplicationError({ code: ERROR_CODES.RESTORATION_FAILED });
          }
        } catch {
          if (operationError?.code !== ERROR_CODES.PAGE_CHANGED &&
              operationError?.code !== ERROR_CODES.OVERLAY_RESTORATION_FAILED) {
            operationError = createApplicationError({ code: ERROR_CODES.RESTORATION_FAILED });
          }
        }
      }
      if (locked) {
        try {
          if (!(await jobState.releaseJobLock(jobId))) throw new Error("release failed");
        } catch {
          operationError = createApplicationError({ code: ERROR_CODES.INTERNAL_ERROR, context: { operation: "release-full-page-lock" } });
        }
      }
      if (offscreenReady && operationError) {
        try {
          await offscreenAdapter.clearResult();
          await offscreenAdapter.closeDocument();
        } catch (error) {
          operationError ??= structured(error, ERROR_CODES.OFFSCREEN_SESSION_FAILED);
        }
      }
      cancellations.delete(requestId);
      active.delete(requestId);
    }

    if (operationError) throw operationError;
    return {
      ...result,
      restoration,
      overlayHandling: {
        enabled: suppressOverlays,
        detected: suppressOverlays ? overlayRestoration.detected : 0,
        suppressed: suppressOverlays ? overlayRestoration.suppressed : 0,
        restored: suppressOverlays ? overlayRestoration.restored : 0,
        restorationSucceeded: suppressOverlays
          ? overlayRestoration.restorationSucceeded
          : true,
        restorationApplicable: suppressOverlays
          ? overlayRestoration.applicable
          : true
      },
      captureIntervalsMs: captureTimestamps.slice(1).map((timestamp, index) =>
        timestamp - captureTimestamps[index]),
      durationMs: Math.max(0, now() - startedAt)
    };
  }

  return Object.freeze({ run, cancel });
}
