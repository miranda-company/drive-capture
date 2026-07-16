import {
  DIAGNOSTIC_RENDER_DELAY_MS,
  MAX_DIAGNOSTIC_PLAN_REVISIONS,
  MAX_VIEWPORT_CHANGE_PX,
  SCROLL_POSITION_TOLERANCE_PX,
  SCROLL_SETTLE_TIMEOUT_MS
} from "../shared/constants.js";
import { createApplicationError, ERROR_CODES, validateApplicationError } from "../shared/errors.js";
import { createRequestId } from "../shared/messages.js";
import {
  createPageMeasurement,
  validateDocumentIdentity,
  validateRestorationResult,
  validateScrollDiagnosticResult,
  validateScrollStepResult
} from "../shared/page-measurement.js";
import { createVerticalScrollPlan } from "../shared/scroll-plan.js";
import { validateActiveTabResults } from "../shared/visible-viewport.js";

const structured = (error, code = ERROR_CODES.INTERNAL_ERROR) =>
  validateApplicationError(error) ? error : createApplicationError({ code });

export function createPageScrollDiagnosticCoordinator({
  tabAdapter, pageAdapter, jobState, now = Date.now, createJobId = createRequestId
}) {
  const cancellations = new Set();
  const activeRequests = new Set();
  const cancel = (requestId) => activeRequests.has(requestId) && (cancellations.add(requestId), true);
  const checkCancelled = (requestId) => {
    if (cancellations.has(requestId)) throw createApplicationError({ code: ERROR_CODES.OPERATION_CANCELLED });
  };

  async function run({ requestId, onProgress = () => undefined }) {
    const jobId = createJobId();
    const startedAt = now();
    activeRequests.add(requestId);
    let locked = false;
    let initialized = false;
    let tabId;
    let identity;
    let restoration;
    let result;
    let operationError;

    try {
      await jobState.acquireJobLock({ id: jobId, tabId: null, phase: "testing-page-scroll", startedAt });
      locked = true;
      onProgress({ state: "inspecting-page" });
      const tab = validateActiveTabResults(await tabAdapter.queryActiveTab());
      tabId = tab.id;
      checkCancelled(requestId);
      await pageAdapter.inject(tabId);
      const initializedPage = await pageAdapter.initialize(tabId, requestId, { maxViewportChange: MAX_VIEWPORT_CHANGE_PX });
      identity = initializedPage.identity;
      if (!validateDocumentIdentity(identity) || typeof initializedPage.hostname !== "string" || /[/?#]/.test(initializedPage.hostname)) {
        throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
      }
      initialized = true;
      checkCancelled(requestId);
      const measured = await pageAdapter.measure(tabId, requestId, { identity });
      let measurement = createPageMeasurement(measured.rawMeasurement);
      onProgress({ state: "creating-scroll-plan" });
      let targets = [...createVerticalScrollPlan({
        viewportHeight: measurement.viewport.height,
        documentHeight: measurement.document.height,
        maximumScrollY: measurement.maximumScroll.y
      })];
      const steps = [];
      let revisionCount = 0;
      let previousHeight = measurement.document.height;

      for (let index = 0; index < targets.length; index += 1) {
        checkCancelled(requestId);
        onProgress({ state: "scrolling", step: index + 1, total: targets.length });
        const rawStep = await pageAdapter.scrollStep(tabId, requestId, {
          identity,
          targetY: targets[index],
          previousDocumentHeight: previousHeight,
          settleTimeoutMs: SCROLL_SETTLE_TIMEOUT_MS,
          tolerance: SCROLL_POSITION_TOLERANCE_PX,
          renderDelayMs: DIAGNOSTIC_RENDER_DELAY_MS
        });
        const stepMeasurement = createPageMeasurement(rawStep.rawMeasurement);
        const step = {
          identity: rawStep.identity,
          requestedY: rawStep.requestedY,
          actualY: rawStep.actualY,
          clamped: rawStep.clamped,
          documentHeightChanged: rawStep.documentHeightChanged,
          measurement: stepMeasurement
        };
        if (!validateScrollStepResult(step)) throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
        steps.push(step);
        measurement = stepMeasurement;
        if (measurement.document.height !== previousHeight) {
          revisionCount += 1;
          if (revisionCount > MAX_DIAGNOSTIC_PLAN_REVISIONS) {
            throw createApplicationError({ code: ERROR_CODES.DYNAMIC_PAGE_UNSTABLE });
          }
          const revised = createVerticalScrollPlan({
            viewportHeight: measurement.viewport.height,
            documentHeight: measurement.document.height,
            maximumScrollY: measurement.maximumScroll.y
          });
          const completed = targets.slice(0, index + 1);
          const remaining = revised.filter((target) => target > rawStep.actualY + SCROLL_POSITION_TOLERANCE_PX && !completed.includes(target));
          targets = [...completed, ...remaining];
          previousHeight = measurement.document.height;
        }
      }

      checkCancelled(requestId);
      result = { hostname: initializedPage.hostname, measurement: createPageMeasurement(measured.rawMeasurement), plannedPositions: targets, steps, revisionCount };
    } catch (error) {
      operationError = structured(error);
    } finally {
      if (initialized) {
        onProgress({ state: "restoring-page" });
        try {
          const restored = await pageAdapter.restore(tabId, requestId, {
            identity, settleTimeoutMs: SCROLL_SETTLE_TIMEOUT_MS, tolerance: SCROLL_POSITION_TOLERANCE_PX
          });
          restoration = restored;
          if (!validateRestorationResult(restored) || !restored.withinTolerance) {
            throw createApplicationError({ code: ERROR_CODES.RESTORATION_FAILED });
          }
        } catch (error) {
          if (!operationError) operationError = structured(error, ERROR_CODES.RESTORATION_FAILED);
        }
      }
      if (locked) {
        try {
          if (!(await jobState.releaseJobLock(jobId))) throw new Error("release failed");
        } catch {
          operationError = createApplicationError({ code: ERROR_CODES.INTERNAL_ERROR, context: { operation: "release-diagnostic-lock" } });
        }
      }
      cancellations.delete(requestId);
      activeRequests.delete(requestId);
    }

    if (operationError) throw operationError;
    const diagnostic = { ...result, restoration, durationMs: Math.max(0, now() - startedAt) };
    if (!validateScrollDiagnosticResult(diagnostic)) throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
    return diagnostic;
  }

  return Object.freeze({ run, cancel });
}
