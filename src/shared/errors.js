import { isJsonSerializable } from "./messages.js";

export const ERROR_CODES = Object.freeze({
  UNSUPPORTED_PAGE: "UNSUPPORTED_PAGE",
  CAPTURE_IN_PROGRESS: "CAPTURE_IN_PROGRESS",
  CAPTURE_FAILED: "CAPTURE_FAILED",
  INVALID_CAPTURE_RESULT: "INVALID_CAPTURE_RESULT",
  PAGE_CHANGED: "PAGE_CHANGED",
  PAGE_MEASUREMENT_FAILED: "PAGE_MEASUREMENT_FAILED",
  SCROLL_PLAN_TOO_LARGE: "SCROLL_PLAN_TOO_LARGE",
  SCROLL_UNSTABLE: "SCROLL_UNSTABLE",
  VIEWPORT_CHANGED: "VIEWPORT_CHANGED",
  DYNAMIC_PAGE_UNSTABLE: "DYNAMIC_PAGE_UNSTABLE",
  RESTORATION_FAILED: "RESTORATION_FAILED",
  OPERATION_CANCELLED: "OPERATION_CANCELLED",
  PAGE_SCRIPT_UNAVAILABLE: "PAGE_SCRIPT_UNAVAILABLE",
  IMAGE_TOO_LARGE: "IMAGE_TOO_LARGE",
  AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
  DRIVE_FOLDER_INACCESSIBLE: "DRIVE_FOLDER_INACCESSIBLE",
  UPLOAD_FAILED: "UPLOAD_FAILED",
  INVALID_MESSAGE: "INVALID_MESSAGE",
  OFFSCREEN_UNAVAILABLE: "OFFSCREEN_UNAVAILABLE",
  SEGMENT_DECODE_FAILED: "SEGMENT_DECODE_FAILED",
  SEGMENT_GEOMETRY_CHANGED: "SEGMENT_GEOMETRY_CHANGED",
  SEGMENT_OUT_OF_ORDER: "SEGMENT_OUT_OF_ORDER",
  SEGMENT_SESSION_INVALID: "SEGMENT_SESSION_INVALID",
  SEGMENT_LIMIT_EXCEEDED: "SEGMENT_LIMIT_EXCEEDED",
  OFFSCREEN_SESSION_FAILED: "OFFSCREEN_SESSION_FAILED",
  CANVAS_ALLOCATION_FAILED: "CANVAS_ALLOCATION_FAILED",
  CANVAS_CONTEXT_UNAVAILABLE: "CANVAS_CONTEXT_UNAVAILABLE",
  CANVAS_LIMIT_EXCEEDED: "CANVAS_LIMIT_EXCEEDED",
  SEGMENT_DRAW_FAILED: "SEGMENT_DRAW_FAILED",
  SEGMENT_GAP_DETECTED: "SEGMENT_GAP_DETECTED",
  IMAGE_ENCODING_FAILED: "IMAGE_ENCODING_FAILED",
  PREVIEW_URL_FAILED: "PREVIEW_URL_FAILED",
  FULL_PAGE_RESULT_UNAVAILABLE: "FULL_PAGE_RESULT_UNAVAILABLE",
  FULL_PAGE_RESULT_CLEANUP_FAILED: "FULL_PAGE_RESULT_CLEANUP_FAILED",
  OVERLAY_SCAN_FAILED: "OVERLAY_SCAN_FAILED",
  OVERLAY_LIMIT_EXCEEDED: "OVERLAY_LIMIT_EXCEEDED",
  OVERLAY_SUPPRESSION_FAILED: "OVERLAY_SUPPRESSION_FAILED",
  OVERLAY_SUPPRESSION_UNSTABLE: "OVERLAY_SUPPRESSION_UNSTABLE",
  OVERLAY_RESTORATION_FAILED: "OVERLAY_RESTORATION_FAILED",
  STITCHING_GEOMETRY_INVALID: "STITCHING_GEOMETRY_INVALID",
  INVALID_OUTPUT_FILENAME: "INVALID_OUTPUT_FILENAME",
  INVALID_JPEG_QUALITY: "INVALID_JPEG_QUALITY",
  OUTPUT_METADATA_INVALID: "OUTPUT_METADATA_INVALID",
  JPEG_VALIDATION_FAILED: "JPEG_VALIDATION_FAILED",
  PAGE_LABEL_UNAVAILABLE: "PAGE_LABEL_UNAVAILABLE",
  OAUTH_NOT_CONFIGURED: "OAUTH_NOT_CONFIGURED",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  AUTH_CANCELLED: "AUTH_CANCELLED",
  AUTH_FAILED: "AUTH_FAILED",
  AUTH_SCOPE_MISSING: "AUTH_SCOPE_MISSING",
  DRIVE_REQUEST_TIMEOUT: "DRIVE_REQUEST_TIMEOUT",
  DRIVE_NETWORK_ERROR: "DRIVE_NETWORK_ERROR",
  DRIVE_ACCESS_DENIED: "DRIVE_ACCESS_DENIED",
  DRIVE_API_UNAVAILABLE: "DRIVE_API_UNAVAILABLE",
  DRIVE_RATE_LIMITED: "DRIVE_RATE_LIMITED",
  DRIVE_RESPONSE_INVALID: "DRIVE_RESPONSE_INVALID",
  DRIVE_FOLDER_INVALID: "DRIVE_FOLDER_INVALID",
  DRIVE_FOLDER_DISCOVERY_FAILED: "DRIVE_FOLDER_DISCOVERY_FAILED",
  DRIVE_FOLDER_CREATE_FAILED: "DRIVE_FOLDER_CREATE_FAILED",
  DRIVE_FOLDER_CACHE_FAILED: "DRIVE_FOLDER_CACHE_FAILED",
  DRIVE_LOCAL_STATE_FAILED: "DRIVE_LOCAL_STATE_FAILED",
  DRIVE_SETUP_BUSY: "DRIVE_SETUP_BUSY",
  INTERNAL_ERROR: "INTERNAL_ERROR"
});

const DEFAULT_MESSAGES = Object.freeze({
  [ERROR_CODES.UNSUPPORTED_PAGE]: "This page is not supported.",
  [ERROR_CODES.CAPTURE_IN_PROGRESS]: "Another DriveCapture job is already running.",
  [ERROR_CODES.CAPTURE_FAILED]: "Chrome could not capture the visible viewport.",
  [ERROR_CODES.INVALID_CAPTURE_RESULT]: "Chrome returned an invalid screenshot.",
  [ERROR_CODES.PAGE_CHANGED]: "The page changed while the operation was running.",
  [ERROR_CODES.PAGE_MEASUREMENT_FAILED]: "The page dimensions could not be measured safely.",
  [ERROR_CODES.SCROLL_PLAN_TOO_LARGE]: "This page requires too many diagnostic scroll steps.",
  [ERROR_CODES.SCROLL_UNSTABLE]: "The page did not settle after scrolling.",
  [ERROR_CODES.VIEWPORT_CHANGED]: "The browser viewport changed during the diagnostic.",
  [ERROR_CODES.DYNAMIC_PAGE_UNSTABLE]: "The page kept changing size during the operation.",
  [ERROR_CODES.RESTORATION_FAILED]: "DriveCapture could not restore the original page position.",
  [ERROR_CODES.OPERATION_CANCELLED]: "The operation was cancelled.",
  [ERROR_CODES.PAGE_SCRIPT_UNAVAILABLE]: "DriveCapture could not communicate with this page.",
  [ERROR_CODES.IMAGE_TOO_LARGE]: "The page is too large to process safely.",
  [ERROR_CODES.AUTHENTICATION_REQUIRED]: "Google authorization is required.",
  [ERROR_CODES.DRIVE_FOLDER_INACCESSIBLE]: "The DriveCapture folder is inaccessible.",
  [ERROR_CODES.UPLOAD_FAILED]: "The file could not be uploaded.",
  [ERROR_CODES.INVALID_MESSAGE]: "DriveCapture received an invalid internal message.",
  [ERROR_CODES.OFFSCREEN_UNAVAILABLE]: "The image-processing document is unavailable.",
  [ERROR_CODES.SEGMENT_DECODE_FAILED]: "A captured JPEG segment could not be decoded.",
  [ERROR_CODES.SEGMENT_GEOMETRY_CHANGED]: "The captured viewport geometry changed during the diagnostic.",
  [ERROR_CODES.SEGMENT_OUT_OF_ORDER]: "A captured segment arrived out of order.",
  [ERROR_CODES.SEGMENT_SESSION_INVALID]: "The offscreen segment session is invalid or no longer active.",
  [ERROR_CODES.SEGMENT_LIMIT_EXCEEDED]: "The segmented capture exceeded its declared limit.",
  [ERROR_CODES.OFFSCREEN_SESSION_FAILED]: "The offscreen segment session failed.",
  [ERROR_CODES.CANVAS_ALLOCATION_FAILED]: "The full-page canvas could not be allocated safely.",
  [ERROR_CODES.CANVAS_CONTEXT_UNAVAILABLE]: "The offscreen canvas drawing context is unavailable.",
  [ERROR_CODES.CANVAS_LIMIT_EXCEEDED]: "The page exceeds the configured Canvas safety limits.",
  [ERROR_CODES.SEGMENT_DRAW_FAILED]: "A captured segment could not be drawn onto the full-page image.",
  [ERROR_CODES.SEGMENT_GAP_DETECTED]: "The captured segments would leave a gap in the full-page image.",
  [ERROR_CODES.IMAGE_ENCODING_FAILED]: "The stitched image could not be encoded as JPEG.",
  [ERROR_CODES.PREVIEW_URL_FAILED]: "A temporary preview URL could not be created.",
  [ERROR_CODES.FULL_PAGE_RESULT_UNAVAILABLE]: "No temporary full-page result is available.",
  [ERROR_CODES.FULL_PAGE_RESULT_CLEANUP_FAILED]: "The temporary full-page result could not be cleared safely.",
  [ERROR_CODES.OVERLAY_SCAN_FAILED]: "DriveCapture could not inspect fixed and sticky page elements safely.",
  [ERROR_CODES.OVERLAY_LIMIT_EXCEEDED]: "The page contains too many fixed or sticky elements to track safely.",
  [ERROR_CODES.OVERLAY_SUPPRESSION_FAILED]: "Repeated page overlays could not be suppressed safely.",
  [ERROR_CODES.OVERLAY_SUPPRESSION_UNSTABLE]: "Suppressing repeated overlays changed the page geometry unexpectedly.",
  [ERROR_CODES.OVERLAY_RESTORATION_FAILED]: "DriveCapture could not restore every modified page overlay.",
  [ERROR_CODES.STITCHING_GEOMETRY_INVALID]: "The captured segment geometry is incompatible with the stitched image.",
  [ERROR_CODES.INVALID_OUTPUT_FILENAME]: "Enter a filename containing at least one letter or number.",
  [ERROR_CODES.INVALID_JPEG_QUALITY]: "Select a supported JPEG quality.",
  [ERROR_CODES.OUTPUT_METADATA_INVALID]: "The generated image metadata is invalid.",
  [ERROR_CODES.JPEG_VALIDATION_FAILED]: "The generated file is not a valid JPEG.",
  [ERROR_CODES.PAGE_LABEL_UNAVAILABLE]: "The page label is unavailable.",
  [ERROR_CODES.OAUTH_NOT_CONFIGURED]: "Google Drive connection is not configured for this extension.",
  [ERROR_CODES.AUTH_REQUIRED]: "Connect Google Drive to continue.",
  [ERROR_CODES.AUTH_CANCELLED]: "Google Drive connection was cancelled.",
  [ERROR_CODES.AUTH_FAILED]: "Google Drive authorization failed.",
  [ERROR_CODES.AUTH_SCOPE_MISSING]: "The required Google Drive permission was not granted.",
  [ERROR_CODES.DRIVE_REQUEST_TIMEOUT]: "Google Drive did not respond in time.",
  [ERROR_CODES.DRIVE_NETWORK_ERROR]: "Google Drive could not be reached.",
  [ERROR_CODES.DRIVE_ACCESS_DENIED]: "Google Drive access was denied or is unavailable.",
  [ERROR_CODES.DRIVE_API_UNAVAILABLE]: "Google Drive is temporarily unavailable.",
  [ERROR_CODES.DRIVE_RATE_LIMITED]: "Google Drive is temporarily rate limiting requests.",
  [ERROR_CODES.DRIVE_RESPONSE_INVALID]: "Google Drive returned an invalid response.",
  [ERROR_CODES.DRIVE_FOLDER_INVALID]: "The managed Drive folder is not usable.",
  [ERROR_CODES.DRIVE_FOLDER_DISCOVERY_FAILED]: "The managed Drive folder could not be found safely.",
  [ERROR_CODES.DRIVE_FOLDER_CREATE_FAILED]: "The managed Drive folder could not be created.",
  [ERROR_CODES.DRIVE_FOLDER_CACHE_FAILED]: "The managed Drive folder cache could not be updated.",
  [ERROR_CODES.DRIVE_LOCAL_STATE_FAILED]: "DriveCapture could not update the local Drive connection state.",
  [ERROR_CODES.DRIVE_SETUP_BUSY]: "Another DriveCapture operation is already running.",
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
