import { isJsonSerializable } from "./messages.js";

export const ERROR_CODES = Object.freeze({
  UNSUPPORTED_PAGE: "UNSUPPORTED_PAGE",
  CAPTURE_IN_PROGRESS: "CAPTURE_IN_PROGRESS",
  CAPTURE_FAILED: "CAPTURE_FAILED",
  INVALID_CAPTURE_RESULT: "INVALID_CAPTURE_RESULT",
  PAGE_CHANGED: "PAGE_CHANGED",
  IMAGE_TOO_LARGE: "IMAGE_TOO_LARGE",
  AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
  DRIVE_FOLDER_INACCESSIBLE: "DRIVE_FOLDER_INACCESSIBLE",
  UPLOAD_FAILED: "UPLOAD_FAILED",
  INVALID_MESSAGE: "INVALID_MESSAGE",
  OFFSCREEN_UNAVAILABLE: "OFFSCREEN_UNAVAILABLE",
  INTERNAL_ERROR: "INTERNAL_ERROR"
});

const DEFAULT_MESSAGES = Object.freeze({
  [ERROR_CODES.UNSUPPORTED_PAGE]: "This page is not supported.",
  [ERROR_CODES.CAPTURE_IN_PROGRESS]: "Another DriveCapture job is already running.",
  [ERROR_CODES.CAPTURE_FAILED]: "Chrome could not capture the visible viewport.",
  [ERROR_CODES.INVALID_CAPTURE_RESULT]: "Chrome returned an invalid screenshot.",
  [ERROR_CODES.PAGE_CHANGED]: "The page changed while the operation was running.",
  [ERROR_CODES.IMAGE_TOO_LARGE]: "The page is too large to process safely.",
  [ERROR_CODES.AUTHENTICATION_REQUIRED]: "Google authorization is required.",
  [ERROR_CODES.DRIVE_FOLDER_INACCESSIBLE]: "The DriveCapture folder is inaccessible.",
  [ERROR_CODES.UPLOAD_FAILED]: "The file could not be uploaded.",
  [ERROR_CODES.INVALID_MESSAGE]: "DriveCapture received an invalid internal message.",
  [ERROR_CODES.OFFSCREEN_UNAVAILABLE]: "The image-processing document is unavailable.",
  [ERROR_CODES.INTERNAL_ERROR]: "DriveCapture encountered an unexpected error."
});

const SECRET_KEY_PATTERN =
  /token|authorization|credential|secret|password|screenshot|data.?url|blob|session.?url|resumable/i;
const BEARER_PATTERN = /bearer\s+[a-z0-9._~+/=-]+/i;

function isPlainObject(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stringContainsCredentialUrl(value) {
  try {
    const url = new URL(value);
    return Boolean(
      url.username ||
        url.password ||
        [...url.searchParams.keys()].some((key) =>
          /token|authorization|credential|secret|password|signature|api.?key/i.test(key)
        )
    );
  } catch {
    return false;
  }
}

function sanitizeMessage(code, message) {
  if (typeof message !== "string" || message.length === 0) {
    return DEFAULT_MESSAGES[code];
  }

  if (BEARER_PATTERN.test(message) || stringContainsCredentialUrl(message)) {
    return DEFAULT_MESSAGES[code];
  }

  return message.slice(0, 500);
}

function sanitizeContextValue(value, seen = new Set()) {
  if (value === null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string") {
    if (BEARER_PATTERN.test(value) || stringContainsCredentialUrl(value)) {
      return "[redacted]";
    }

    return value.slice(0, 500);
  }

  if (typeof value !== "object" || seen.has(value)) {
    return undefined;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    const sanitizedArray = value
      .map((item) => sanitizeContextValue(item, seen))
      .filter((item) => item !== undefined);
    seen.delete(value);
    return sanitizedArray;
  }

  if (!isPlainObject(value)) {
    seen.delete(value);
    return undefined;
  }

  const sanitizedObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      continue;
    }

    const sanitizedItem = sanitizeContextValue(item, seen);
    if (sanitizedItem !== undefined) {
      sanitizedObject[key] = sanitizedItem;
    }
  }

  seen.delete(value);
  return sanitizedObject;
}

export function createApplicationError({
  code,
  message = DEFAULT_MESSAGES[code],
  retryable = false,
  context = {}
}) {
  if (!Object.values(ERROR_CODES).includes(code)) {
    throw new TypeError("Unknown application error code.");
  }

  const safeContext = sanitizeContextValue(context) ?? {};
  const applicationError = {
    code,
    message: sanitizeMessage(code, message),
    retryable: Boolean(retryable),
    context: safeContext
  };

  if (!validateApplicationError(applicationError)) {
    throw new TypeError("Cannot create an invalid application error.");
  }

  return Object.freeze(applicationError);
}

export function validateApplicationError(error) {
  return Boolean(
    isPlainObject(error) &&
      Object.values(ERROR_CODES).includes(error.code) &&
      typeof error.message === "string" &&
      error.message.length > 0 &&
      typeof error.retryable === "boolean" &&
      isPlainObject(error.context) &&
      isJsonSerializable(error)
  );
}

export function serializeUnknownError(error, context = {}) {
  if (validateApplicationError(error)) {
    return createApplicationError({
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      context: { ...error.context, ...context }
    });
  }

  return createApplicationError({
    code: ERROR_CODES.INTERNAL_ERROR,
    context
  });
}
