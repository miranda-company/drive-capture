import { MAX_DIAGNOSTIC_SCROLL_STEPS } from "./constants.js";
import { createApplicationError, ERROR_CODES } from "./errors.js";

export function createVerticalScrollPlan({
  viewportHeight,
  documentHeight,
  maximumScrollY,
  maximumSteps = MAX_DIAGNOSTIC_SCROLL_STEPS
}) {
  if (
    !Number.isFinite(viewportHeight) || viewportHeight <= 0 ||
    !Number.isFinite(documentHeight) || documentHeight < 0 ||
    !Number.isFinite(maximumScrollY) || maximumScrollY < 0 ||
    !Number.isInteger(maximumSteps) || maximumSteps < 1
  ) {
    throw createApplicationError({ code: ERROR_CODES.PAGE_MEASUREMENT_FAILED });
  }

  const maximum = Math.min(maximumScrollY, Math.max(0, documentHeight - viewportHeight));
  const targets = [0];
  for (let target = viewportHeight; target < maximum; target += viewportHeight) {
    targets.push(Math.min(maximum, Math.max(0, target)));
    if (targets.length >= maximumSteps) {
      throw createApplicationError({ code: ERROR_CODES.SCROLL_PLAN_TOO_LARGE });
    }
  }
  if (targets[targets.length - 1] !== maximum) targets.push(maximum);
  if (targets.length > maximumSteps) {
    throw createApplicationError({ code: ERROR_CODES.SCROLL_PLAN_TOO_LARGE });
  }
  return Object.freeze([...new Set(targets)].sort((a, b) => a - b));
}
