import {
  ALLOWED_JPEG_QUALITIES,
  DEFAULT_JPEG_QUALITY
} from "./constants.js";
import { createApplicationError, ERROR_CODES } from "./errors.js";

export function isAllowedJpegQuality(value) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    ALLOWED_JPEG_QUALITIES.includes(value);
}

export function requireJpegQuality(value) {
  if (!isAllowedJpegQuality(value)) {
    throw createApplicationError({ code: ERROR_CODES.INVALID_JPEG_QUALITY });
  }
  return value;
}

export function resolveStoredJpegQuality(value) {
  return isAllowedJpegQuality(value) ? value : DEFAULT_JPEG_QUALITY;
}

export function parseJpegQuality(value) {
  const parsed = typeof value === "string" && value.trim() !== ""
    ? Number(value)
    : value;
  return requireJpegQuality(parsed);
}

export function calculateImageMetrics(width, height) {
  if (!Number.isInteger(width) || width <= 0 ||
      !Number.isInteger(height) || height <= 0) {
    throw createApplicationError({ code: ERROR_CODES.OUTPUT_METADATA_INVALID });
  }
  return Object.freeze({
    megapixels: (width * height) / 1_000_000,
    aspectRatio: width / height
  });
}

export function formatByteSize(bytes) {
  if (!Number.isInteger(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

export function formatAspectRatio(value) {
  return Number.isFinite(value) && value > 0 ? `${value.toFixed(3)}:1` : "—";
}

export function formatMegapixels(value) {
  return Number.isFinite(value) && value > 0 ? `${value.toFixed(2)} MP` : "—";
}
