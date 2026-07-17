import { MAX_DIAGNOSTIC_SCROLL_STEPS } from "./constants.js";
import { estimateBase64DataUrlBytes } from "./visible-viewport.js";

const positiveFinite = (value) => Number.isFinite(value) && value > 0;
const nonNegativeFinite = (value) => Number.isFinite(value) && value >= 0;
const positiveInteger = (value) => Number.isInteger(value) && value > 0;
const nonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;

export function validateSegmentSessionStart(value) {
  return Boolean(
    value && typeof value.sessionId === "string" &&
      value.sessionId.length > 0 && value.sessionId.length <= 128 &&
      positiveInteger(value.expectedMaximumSegments) &&
      value.expectedMaximumSegments <= MAX_DIAGNOSTIC_SCROLL_STEPS
  );
}

export function validateSegmentPayload(value) {
  if (!value || typeof value.sessionId !== "string" || value.sessionId.length === 0 || value.sessionId.length > 128) return false;
  if (!nonNegativeInteger(value.segmentIndex)) return false;
  if (!nonNegativeFinite(value.requestedScrollY) || !nonNegativeFinite(value.actualScrollY)) return false;
  if (!positiveFinite(value.cssViewport?.width) || !positiveFinite(value.cssViewport?.height)) return false;
  if (value.mimeType !== "image/jpeg" || typeof value.dataUrl !== "string") return false;
  if (!nonNegativeInteger(value.estimatedBytes) || !positiveInteger(value.capturedAt)) return false;

  try {
    return estimateBase64DataUrlBytes(value.dataUrl) === value.estimatedBytes;
  } catch {
    return false;
  }
}

export function calculateSegmentGeometry({ bitmap, cssViewport }) {
  if (
    !positiveInteger(bitmap?.width) || !positiveInteger(bitmap?.height) ||
    !positiveFinite(cssViewport?.width) || !positiveFinite(cssViewport?.height)
  ) return null;

  const scale = {
    x: bitmap.width / cssViewport.width,
    y: bitmap.height / cssViewport.height
  };
  return positiveFinite(scale.x) && positiveFinite(scale.y)
    ? { bitmap: { width: bitmap.width, height: bitmap.height }, scale }
    : null;
}

export function isConsistentSegmentGeometry(expected, actual, tolerance) {
  return Boolean(
    expected && actual && nonNegativeFinite(tolerance) &&
      expected.bitmap.width === actual.bitmap.width &&
      expected.bitmap.height === actual.bitmap.height &&
      Math.abs(expected.scale.x - actual.scale.x) <= tolerance &&
      Math.abs(expected.scale.y - actual.scale.y) <= tolerance
  );
}

export function validateSegmentAcknowledgement(value) {
  return Boolean(
    value && typeof value.sessionId === "string" && value.sessionId.length > 0 &&
      nonNegativeInteger(value.segmentIndex) &&
      positiveInteger(value.bitmap?.width) && positiveInteger(value.bitmap?.height) &&
      positiveFinite(value.scale?.x) && positiveFinite(value.scale?.y) &&
      nonNegativeInteger(value.estimatedBytes) && positiveInteger(value.acknowledgedAt)
  );
}

function validateDiagnosticSegment(value, index) {
  return Boolean(
    validateSegmentAcknowledgement(value) &&
      nonNegativeFinite(value.requestedScrollY) && nonNegativeFinite(value.actualScrollY) &&
      positiveInteger(value.capturedAt) &&
      (index === 0 ? value.captureIntervalMs === null : nonNegativeFinite(value.captureIntervalMs))
  );
}

export function validateSegmentedCaptureDiagnostic(value) {
  return Boolean(
    value && positiveFinite(value.measurement?.viewport?.width) &&
      positiveFinite(value.measurement?.viewport?.height) &&
      positiveFinite(value.measurement?.document?.width) &&
      positiveFinite(value.measurement?.document?.height) &&
      positiveInteger(value.plannedSegmentCount) &&
      nonNegativeInteger(value.capturedSegmentCount) &&
      value.capturedSegmentCount === value.acknowledgedSegmentCount &&
      Array.isArray(value.segments) && value.segments.length === value.acknowledgedSegmentCount &&
      value.segments.every(validateDiagnosticSegment) &&
      Array.isArray(value.captureIntervalsMs) && value.captureIntervalsMs.every(nonNegativeFinite) &&
      nonNegativeInteger(value.totalEstimatedBytes) &&
      nonNegativeFinite(value.restoration?.actual?.x) && nonNegativeFinite(value.restoration?.actual?.y) &&
      typeof value.restoration?.withinTolerance === "boolean" &&
      nonNegativeFinite(value.durationMs)
  );
}
