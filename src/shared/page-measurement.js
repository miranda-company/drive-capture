import { createApplicationError, ERROR_CODES } from "./errors.js";

const finiteNonNegative = (value) => Number.isFinite(value) && value >= 0;

function measurementError(reason) {
  return createApplicationError({
    code: ERROR_CODES.PAGE_MEASUREMENT_FAILED,
    context: { reason }
  });
}

export function createPageMeasurement(raw) {
  const values = [
    raw?.innerWidth,
    raw?.innerHeight,
    raw?.scrollX,
    raw?.scrollY,
    raw?.devicePixelRatio,
    raw?.documentElementScrollWidth,
    raw?.documentElementScrollHeight,
    raw?.bodyScrollWidth,
    raw?.bodyScrollHeight
  ];
  if (values.some((value) => !finiteNonNegative(value))) {
    throw measurementError("invalid-number");
  }

  const width = Math.max(raw.documentElementScrollWidth, raw.bodyScrollWidth);
  const height = Math.max(raw.documentElementScrollHeight, raw.bodyScrollHeight);
  if (raw.innerWidth <= 0 || raw.innerHeight <= 0 || width <= 0 || height <= 0 || raw.devicePixelRatio <= 0) {
    throw measurementError("unusable-dimensions");
  }

  return Object.freeze({
    viewport: { width: raw.innerWidth, height: raw.innerHeight },
    document: { width, height },
    maximumScroll: {
      x: Math.max(0, width - raw.innerWidth),
      y: Math.max(0, height - raw.innerHeight)
    },
    originalScroll: { x: raw.scrollX, y: raw.scrollY },
    devicePixelRatio: raw.devicePixelRatio,
    scrollingElementKind:
      typeof raw.scrollingElementKind === "string" ? raw.scrollingElementKind : "none"
  });
}

export function validateDocumentIdentity(identity) {
  return Boolean(
    identity &&
      typeof identity.hrefFingerprint === "string" &&
      /^[a-f0-9]{8}$/.test(identity.hrefFingerprint) &&
      finiteNonNegative(identity.timeOrigin) &&
      Number.isInteger(identity.documentElementReferenceVersion) &&
      identity.documentElementReferenceVersion > 0
  );
}

export function validatePageMeasurement(value) {
  try {
    return Boolean(
      value &&
        finiteNonNegative(value.viewport?.width) && value.viewport.width > 0 &&
        finiteNonNegative(value.viewport?.height) && value.viewport.height > 0 &&
        finiteNonNegative(value.document?.width) && value.document.width > 0 &&
        finiteNonNegative(value.document?.height) && value.document.height > 0 &&
        finiteNonNegative(value.maximumScroll?.x) &&
        finiteNonNegative(value.maximumScroll?.y) &&
        finiteNonNegative(value.originalScroll?.x) &&
        finiteNonNegative(value.originalScroll?.y) &&
        finiteNonNegative(value.devicePixelRatio) && value.devicePixelRatio > 0 &&
        typeof value.scrollingElementKind === "string"
    );
  } catch {
    return false;
  }
}

export function validateScrollStepResult(value) {
  return Boolean(
    value && validateDocumentIdentity(value.identity) &&
    finiteNonNegative(value.requestedY) && finiteNonNegative(value.actualY) &&
    typeof value.clamped === "boolean" && typeof value.documentHeightChanged === "boolean" &&
    validatePageMeasurement(value.measurement)
  );
}

export function validateRestorationResult(value) {
  return Boolean(
    value && validateDocumentIdentity(value.identity) &&
    finiteNonNegative(value.actual?.x) && finiteNonNegative(value.actual?.y) &&
    typeof value.withinTolerance === "boolean" && typeof value.settled === "boolean"
  );
}

export function validateScrollDiagnosticResult(value) {
  return Boolean(
    value && typeof value.hostname === "string" && value.hostname.length > 0 &&
    !/[/?#]/.test(value.hostname) && validatePageMeasurement(value.measurement) &&
    Array.isArray(value.plannedPositions) && value.plannedPositions.every(finiteNonNegative) &&
    Array.isArray(value.steps) && value.steps.every(validateScrollStepResult) &&
    validateRestorationResult(value.restoration) &&
    Number.isInteger(value.revisionCount) && value.revisionCount >= 0 &&
    finiteNonNegative(value.durationMs)
  );
}
