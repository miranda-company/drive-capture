import {
  MAX_OUTPUT_FILENAME_LENGTH,
  MAX_PAGE_LABEL_LENGTH
} from "./constants.js";
import { createApplicationError, ERROR_CODES } from "./errors.js";

const JPEG_EXTENSION_PATTERN = /(?:\.jpe?g)+$/iu;
const GENERIC_TITLES = new Set([
  "home",
  "homepage",
  "new tab",
  "start",
  "untitled"
]);

function truncateCodePoints(value, maximumLength) {
  return Array.from(value).slice(0, maximumLength).join("");
}

function trimPortableBoundaries(value) {
  return value
    .replace(/^[\s._-]+/u, "")
    .replace(/[\s._-]+$/u, "");
}

export function sanitizeFilenameStem(value, maximumLength = MAX_OUTPUT_FILENAME_LENGTH - 4) {
  if (typeof value !== "string" || !Number.isInteger(maximumLength) || maximumLength <= 0) {
    return "";
  }
  const withoutExtension = value.normalize("NFKC").trim().replace(JPEG_EXTENSION_PATTERN, "");
  const sanitized = trimPortableBoundaries(
    withoutExtension
      .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
      .replace(/[\/\\:*?"<>|]/gu, " ")
      .replace(/[^\p{L}\p{N}\p{M} ._()-]+/gu, " ")
      .replace(/\s+/gu, "-")
      .replace(/[-_.]{2,}/gu, "-")
  );
  const truncated = trimPortableBoundaries(truncateCodePoints(sanitized, maximumLength));
  return /[\p{L}\p{N}]/u.test(truncated) ? truncated : "";
}

export function formatLocalTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw createApplicationError({ code: ERROR_CODES.INVALID_OUTPUT_FILENAME });
  }
  const part = (number, length = 2) => String(number).padStart(length, "0");
  return [
    `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`,
    `${part(date.getHours())}-${part(date.getMinutes())}-${part(date.getSeconds())}-${part(date.getMilliseconds(), 3)}`
  ].join("_");
}

export function selectPageLabel({ title, hostname } = {}) {
  const normalizedTitle = typeof title === "string" ? title.trim() : "";
  const titleIsGeneric = GENERIC_TITLES.has(normalizedTitle.toLocaleLowerCase("en-US"));
  const titleLabel = titleIsGeneric
    ? ""
    : sanitizeFilenameStem(normalizedTitle, MAX_PAGE_LABEL_LENGTH);
  if (titleLabel) return Object.freeze({ label: titleLabel, source: "title" });

  const hostnameLabel = sanitizeFilenameStem(
    typeof hostname === "string" ? hostname : "",
    MAX_PAGE_LABEL_LENGTH
  );
  if (hostnameLabel) return Object.freeze({ label: hostnameLabel, source: "hostname" });
  return Object.freeze({ label: "Webpage", source: "fallback" });
}

export function createAutomaticOutputFilename({ title, hostname, now = Date.now } = {}) {
  const pageLabel = selectPageLabel({ title, hostname });
  const timestamp = formatLocalTimestamp(now());
  const fixedLength = "DriveCapture__".length + timestamp.length + ".jpg".length;
  const label = sanitizeFilenameStem(
    pageLabel.label,
    Math.min(MAX_PAGE_LABEL_LENGTH, MAX_OUTPUT_FILENAME_LENGTH - fixedLength)
  ) || "Webpage";
  return Object.freeze({
    filename: `DriveCapture_${label}_${timestamp}.jpg`,
    source: "automatic",
    pageLabelSource: pageLabel.source
  });
}

export function resolveOutputFilename({
  requestedFilename = "",
  title,
  hostname,
  now = Date.now
} = {}) {
  if (typeof requestedFilename !== "string") {
    throw createApplicationError({ code: ERROR_CODES.INVALID_OUTPUT_FILENAME });
  }
  if (requestedFilename.trim() === "") {
    return createAutomaticOutputFilename({ title, hostname, now });
  }
  const stem = sanitizeFilenameStem(
    requestedFilename,
    MAX_OUTPUT_FILENAME_LENGTH - ".jpg".length
  );
  if (!stem) {
    throw createApplicationError({ code: ERROR_CODES.INVALID_OUTPUT_FILENAME });
  }
  return Object.freeze({
    filename: `${stem}.jpg`,
    source: "custom",
    pageLabelSource: null
  });
}

export function validateResolvedOutputFilename(filename, source) {
  if (typeof filename !== "string" ||
      Array.from(filename).length > MAX_OUTPUT_FILENAME_LENGTH ||
      !filename.endsWith(".jpg") ||
      filename.slice(0, -4) !== sanitizeFilenameStem(filename, MAX_OUTPUT_FILENAME_LENGTH - 4) ||
      (source !== "automatic" && source !== "custom")) {
    throw createApplicationError({ code: ERROR_CODES.INVALID_OUTPUT_FILENAME });
  }
  return Object.freeze({ filename, source });
}
