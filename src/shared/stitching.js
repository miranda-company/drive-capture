import {
  MAX_CANVAS_HEIGHT_PX,
  MAX_CANVAS_PIXELS,
  MAX_CANVAS_RGBA_BYTES,
  MAX_CANVAS_WIDTH_PX,
  MAX_OUTPUT_FILENAME_LENGTH,
  STITCH_GAP_TOLERANCE_PX
} from "./constants.js";
import { isAllowedJpegQuality } from "./output-settings.js";

const positiveFinite = (value) => Number.isFinite(value) && value > 0;
const nonNegativeFinite = (value) => Number.isFinite(value) && value >= 0;
const positiveInteger = (value) => Number.isInteger(value) && value > 0;

export function calculateCanvasAllocation({ bitmapWidth, documentHeight, scaleY }, limits = {}) {
  if (!positiveInteger(bitmapWidth) || !positiveFinite(documentHeight) || !positiveFinite(scaleY)) return null;
  const width = bitmapWidth;
  const height = Math.round(documentHeight * scaleY);
  const pixels = width * height;
  const rgbaBytes = pixels * 4;
  const applied = {
    maxWidth: limits.maxWidth ?? MAX_CANVAS_WIDTH_PX,
    maxHeight: limits.maxHeight ?? MAX_CANVAS_HEIGHT_PX,
    maxPixels: limits.maxPixels ?? MAX_CANVAS_PIXELS,
    maxRgbaBytes: limits.maxRgbaBytes ?? MAX_CANVAS_RGBA_BYTES
  };
  if (!positiveInteger(height) || width > applied.maxWidth || height > applied.maxHeight ||
      pixels > applied.maxPixels || rgbaBytes > applied.maxRgbaBytes) return null;
  return { width, height, pixels, rgbaBytes, limits: applied };
}

export function calculateSegmentPlacement({
  actualScrollY, bitmapWidth, bitmapHeight, scaleY, canvasWidth, canvasHeight,
  documentHeight, coveredBottom = 0, gapTolerance = STITCH_GAP_TOLERANCE_PX
}) {
  if (!nonNegativeFinite(actualScrollY) || !positiveInteger(bitmapWidth) ||
      !positiveInteger(bitmapHeight) || !positiveFinite(scaleY) ||
      !positiveInteger(canvasWidth) || !positiveInteger(canvasHeight) ||
      !positiveFinite(documentHeight) ||
      !nonNegativeFinite(coveredBottom) || !nonNegativeFinite(gapTolerance) ||
      bitmapWidth !== canvasWidth) return null;
  const destinationY = Math.round(actualScrollY * scaleY);
  if (destinationY >= canvasHeight) return null;
  const remainingCssHeight = Math.max(0, documentHeight - actualScrollY);
  const drawHeight = Math.min(
    bitmapHeight,
    Math.round(remainingCssHeight * scaleY),
    canvasHeight - destinationY
  );
  if (!positiveInteger(drawHeight)) return null;
  const gap = Math.max(0, destinationY - coveredBottom);
  const overlap = Math.max(0, coveredBottom - destinationY);
  const newCoveredBottom = Math.max(coveredBottom, destinationY + drawHeight);
  return {
    source: { x: 0, y: 0, width: bitmapWidth, height: drawHeight },
    destination: { x: 0, y: destinationY, width: bitmapWidth, height: drawHeight },
    gap, overlap,
    overwrittenRowCount: overlap,
    newlyCoveredPixels: Math.max(0, newCoveredBottom - coveredBottom),
    coveredBottom: newCoveredBottom,
    hasUnsafeGap: gap > gapTolerance
  };
}

export function validateFullPageResult(value) {
  return Boolean(value && value.available === true && typeof value.previewUrl === "string" &&
    value.previewUrl.startsWith("blob:") && value.mimeType === "image/jpeg" &&
    positiveInteger(value.width) && positiveInteger(value.height) &&
    positiveInteger(value.encodedBytes) && positiveInteger(value.createdAt) &&
    positiveInteger(value.segmentCount) && Array.isArray(value.placements) &&
    value.placements.length === value.segmentCount && typeof value.horizontalOverflow === "boolean" &&
    typeof value.filename === "string" && value.filename.endsWith(".jpg") &&
    Array.from(value.filename).length <= MAX_OUTPUT_FILENAME_LENGTH &&
    (value.filenameSource === "automatic" || value.filenameSource === "custom") &&
    value.format === "JPEG" && value.pixelWidth === value.width &&
    value.pixelHeight === value.height && value.blobSize === value.encodedBytes &&
    isAllowedJpegQuality(value.jpegQuality) &&
    value.megapixels === (value.pixelWidth * value.pixelHeight) / 1_000_000 &&
    value.aspectRatio === value.pixelWidth / value.pixelHeight &&
    value.validJpegSignature === true &&
    Number.isFinite(value.scale?.x) && value.scale.x > 0 &&
    Number.isFinite(value.scale?.y) && value.scale.y > 0 &&
    value.captureScale?.x === value.scale.x &&
    value.captureScale?.y === value.scale.y &&
    Number.isFinite(value.stitchingDiagnostics?.totalOverlapPixels) &&
    value.stitchingDiagnostics.totalOverlapPixels >= 0 &&
    Number.isFinite(value.stitchingDiagnostics?.totalNewlyCoveredPixels) &&
    value.stitchingDiagnostics.totalNewlyCoveredPixels >= 0 &&
    Number.isFinite(value.stitchingDiagnostics?.maximumGapPixels) &&
    value.stitchingDiagnostics.maximumGapPixels >= 0);
}
