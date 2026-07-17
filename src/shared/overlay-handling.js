const finite = (value) => Number.isFinite(value);
const nonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;

export const OVERLAY_CLASSIFICATIONS = Object.freeze({
  TOP: "top-overlay",
  BOTTOM: "bottom-overlay",
  FLOATING: "floating-overlay",
  STICKY: "sticky-in-flow",
  UNKNOWN: "unknown"
});

export function intersectsViewport(rect, viewport) {
  return Boolean(
    rect && viewport && finite(rect.top) && finite(rect.right) &&
      finite(rect.bottom) && finite(rect.left) && finite(rect.width) &&
      finite(rect.height) && finite(viewport.width) && finite(viewport.height) &&
      rect.width > 0 && rect.height > 0 &&
      rect.right > 0 && rect.bottom > 0 &&
      rect.left < viewport.width && rect.top < viewport.height
  );
}

export function isVisibleOverlayCandidate({ display, visibility, opacity, rect, viewport }) {
  return display !== "none" && visibility !== "hidden" &&
    Number(opacity) > 0 && intersectsViewport(rect, viewport);
}

export function classifyOverlayCandidate({ position, rect, viewport, edgeTolerance = 2 }) {
  if (!intersectsViewport(rect, viewport)) return OVERLAY_CLASSIFICATIONS.UNKNOWN;
  if (position === "sticky") return OVERLAY_CLASSIFICATIONS.STICKY;
  if (position !== "fixed") return OVERLAY_CLASSIFICATIONS.UNKNOWN;
  const substantialWidth = rect.width >= viewport.width * 0.25;
  if (rect.top <= edgeTolerance && substantialWidth) return OVERLAY_CLASSIFICATIONS.TOP;
  if (rect.bottom >= viewport.height - edgeTolerance && substantialWidth) {
    return OVERLAY_CLASSIFICATIONS.BOTTOM;
  }
  return OVERLAY_CLASSIFICATIONS.FLOATING;
}

export function shouldSuppressOverlay(candidate) {
  return Boolean(candidate?.position === "fixed" && [
    OVERLAY_CLASSIFICATIONS.TOP,
    OVERLAY_CLASSIFICATIONS.BOTTOM,
    OVERLAY_CLASSIFICATIONS.FLOATING
  ].includes(candidate.classification));
}

export function validateOverlayCandidate(value) {
  return Boolean(
    value && typeof value.elementId === "string" && value.elementId.length > 0 &&
      ["fixed", "sticky"].includes(value.position) &&
      intersectsViewport(value.boundingRect, value.viewport) &&
      typeof value.zIndex === "string" &&
      typeof value.visibility === "string" &&
      finite(value.opacity) &&
      typeof value.pointerEvents === "string" &&
      value.intersectsViewport === true &&
      Object.values(OVERLAY_CLASSIFICATIONS).includes(value.classification)
  );
}

export function validateOverlayPrepareResult(value) {
  return Boolean(
    value && Array.isArray(value.candidates) &&
      value.candidates.every(validateOverlayCandidate) &&
      nonNegativeInteger(value.detected) &&
      nonNegativeInteger(value.suppressed) &&
      typeof value.suppressionApplied === "boolean" &&
      value.rawMeasurement && typeof value.rawMeasurement === "object"
  );
}

export function validateOverlayRestoration(value) {
  return Boolean(
    value && nonNegativeInteger(value.detected) &&
      nonNegativeInteger(value.suppressed) &&
      nonNegativeInteger(value.restored) &&
      typeof value.restorationSucceeded === "boolean" &&
      typeof value.applicable === "boolean"
  );
}
