import { createApplicationError, ERROR_CODES } from "./errors.js";

export const VISIBLE_VIEWPORT_MODE = "visible-viewport";
export const JPEG_MIME_TYPE = "image/jpeg";
export const JPEG_DATA_URL_PREFIX = "data:image/jpeg;base64,";

const CHROME_WEB_STORE_HOST = "chromewebstore.google.com";
const LEGACY_CHROME_WEB_STORE_HOST = "chrome.google.com";

function unsupportedPage(message, reason) {
  return createApplicationError({
    code: ERROR_CODES.UNSUPPORTED_PAGE,
    message,
    context: { reason }
  });
}

export function validateActiveTabResults(tabs) {
  if (!Array.isArray(tabs) || tabs.length !== 1) {
    throw unsupportedPage(
      "DriveCapture needs one active webpage to capture.",
      "active-tab-count"
    );
  }

  const [tab] = tabs;
  if (!tab || !Number.isInteger(tab.id) || tab.id < 0) {
    throw unsupportedPage("The active webpage is unavailable.", "missing-tab-id");
  }

  if (!Number.isInteger(tab.windowId) || tab.windowId < 0) {
    throw unsupportedPage("The active browser window is unavailable.", "missing-window-id");
  }

  if (typeof tab.url !== "string" || tab.url.trim().length === 0) {
    throw unsupportedPage("The active page does not have a usable address.", "missing-url");
  }

  let url;
  try {
    url = new URL(tab.url);
  } catch {
    throw unsupportedPage("The active page address is not valid.", "malformed-url");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw unsupportedPage(
      "DriveCapture works only on regular HTTP and HTTPS webpages.",
      "unsupported-protocol"
    );
  }

  const isChromeWebStore =
    url.hostname === CHROME_WEB_STORE_HOST ||
    (url.hostname === LEGACY_CHROME_WEB_STORE_HOST &&
      (url.pathname === "/webstore" || url.pathname.startsWith("/webstore/")));

  if (isChromeWebStore) {
    throw unsupportedPage(
      "Chrome does not allow extensions to capture the Chrome Web Store.",
      "chrome-web-store"
    );
  }

  return Object.freeze({
    id: tab.id,
    windowId: tab.windowId,
    url: url.href,
    title: typeof tab.title === "string" ? tab.title : ""
  });
}

function invalidCapture(reason) {
  return createApplicationError({
    code: ERROR_CODES.INVALID_CAPTURE_RESULT,
    context: { reason }
  });
}

export function estimateBase64DataUrlBytes(dataUrl) {
  if (typeof dataUrl !== "string") {
    throw invalidCapture("data-url-type");
  }

  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) {
    throw invalidCapture("missing-data-url-comma");
  }

  if (dataUrl.slice(0, commaIndex + 1) !== JPEG_DATA_URL_PREFIX) {
    throw invalidCapture("wrong-data-url-mime");
  }

  const payload = dataUrl.slice(commaIndex + 1);
  if (payload.length === 0) {
    throw invalidCapture("empty-base64-payload");
  }

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) {
    throw invalidCapture("invalid-base64-characters");
  }

  const firstPaddingIndex = payload.indexOf("=");
  const unpaddedLength = firstPaddingIndex === -1 ? payload.length : firstPaddingIndex;
  const paddingLength = payload.length - unpaddedLength;

  if (
    unpaddedLength % 4 === 1 ||
    (paddingLength > 0 && payload.length % 4 !== 0) ||
    (paddingLength === 1 && unpaddedLength % 4 !== 3) ||
    (paddingLength === 2 && unpaddedLength % 4 !== 2)
  ) {
    throw invalidCapture("invalid-base64-length");
  }

  const estimatedBytes = Math.floor((unpaddedLength * 6) / 8);
  if (!Number.isSafeInteger(estimatedBytes) || estimatedBytes < 0) {
    throw invalidCapture("invalid-byte-estimate");
  }

  return estimatedBytes;
}

export function validateVisibleViewportResult(result) {
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    result.mode !== VISIBLE_VIEWPORT_MODE ||
    result.mimeType !== JPEG_MIME_TYPE ||
    typeof result.dataUrl !== "string" ||
    !Number.isSafeInteger(result.estimatedBytes) ||
    result.estimatedBytes < 0 ||
    !Number.isFinite(result.capturedAt) ||
    !Number.isInteger(result.capturedAt) ||
    result.capturedAt <= 0
  ) {
    return false;
  }

  try {
    return estimateBase64DataUrlBytes(result.dataUrl) === result.estimatedBytes;
  } catch {
    return false;
  }
}
