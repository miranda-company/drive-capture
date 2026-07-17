import {
  DRIVE_DISCOVERY_PAGE_SIZE,
  DRIVE_FOLDER_MIME_TYPE,
  DRIVE_REQUEST_TIMEOUT_MS,
  MANAGED_DRIVE_FOLDER_NAME
} from "../shared/constants.js";
import { createApplicationError, ERROR_CODES } from "../shared/errors.js";

const BASE_URL = "https://www.googleapis.com/drive/v3";
const FOLDER_FIELDS =
  "id,name,mimeType,trashed,createdTime,appProperties,capabilities(canAddChildren)";
const LIST_FIELDS = `nextPageToken,files(${FOLDER_FIELDS})`;
const FOLDER_QUERY =
  `mimeType = '${DRIVE_FOLDER_MIME_TYPE}' and trashed = false and ` +
  "appProperties has { key = 'drivecaptureManaged' and value = 'true' }";

export class DriveRequestError extends Error {
  constructor(status) {
    super("Drive request failed.");
    this.name = "DriveRequestError";
    this.status = status;
  }
}

function mappedHttpError(status) {
  if (status === 401 || status === 404) return new DriveRequestError(status);
  if (status === 403) return createApplicationError({ code: ERROR_CODES.DRIVE_ACCESS_DENIED });
  if (status === 429) return createApplicationError({ code: ERROR_CODES.DRIVE_RATE_LIMITED, retryable: true });
  if (status >= 500) return createApplicationError({ code: ERROR_CODES.DRIVE_API_UNAVAILABLE, retryable: true });
  return createApplicationError({ code: ERROR_CODES.DRIVE_RESPONSE_INVALID });
}

export function createGoogleDriveClient({
  fetchImpl = globalThis.fetch,
  AbortControllerImpl = globalThis.AbortController,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
  timeoutMs = DRIVE_REQUEST_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== "function" || typeof AbortControllerImpl !== "function") {
    throw new TypeError("Drive HTTP adapters are required.");
  }

  async function requestJson({ token, operation, folderId, pageToken }) {
    if (typeof token !== "string" || !token) {
      throw createApplicationError({ code: ERROR_CODES.AUTH_REQUIRED });
    }
    const url = new URL(BASE_URL);
    let method = "GET";
    let body;
    if (operation === "get-folder") {
      if (typeof folderId !== "string" || !folderId || /[/?#]/u.test(folderId)) {
        throw createApplicationError({ code: ERROR_CODES.DRIVE_FOLDER_INVALID });
      }
      url.pathname += `/files/${encodeURIComponent(folderId)}`;
      url.searchParams.set("fields", FOLDER_FIELDS);
    } else if (operation === "list-folders") {
      url.pathname += "/files";
      url.searchParams.set("spaces", "drive");
      url.searchParams.set("q", FOLDER_QUERY);
      url.searchParams.set("fields", LIST_FIELDS);
      url.searchParams.set("pageSize", String(DRIVE_DISCOVERY_PAGE_SIZE));
      if (pageToken) url.searchParams.set("pageToken", pageToken);
    } else if (operation === "create-folder") {
      url.pathname += "/files";
      url.searchParams.set("fields", FOLDER_FIELDS);
      method = "POST";
      body = JSON.stringify({
        name: MANAGED_DRIVE_FOLDER_NAME,
        mimeType: DRIVE_FOLDER_MIME_TYPE,
        appProperties: {
          drivecaptureManaged: "true",
          drivecaptureSchema: "1"
        }
      });
    } else {
      throw createApplicationError({ code: ERROR_CODES.DRIVE_RESPONSE_INVALID });
    }

    const controller = new AbortControllerImpl();
    const timeout = setTimeoutImpl(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(url.href, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {})
        },
        ...(body ? { body } : {}),
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") {
        throw createApplicationError({ code: ERROR_CODES.DRIVE_REQUEST_TIMEOUT, retryable: true });
      }
      throw createApplicationError({ code: ERROR_CODES.DRIVE_NETWORK_ERROR, retryable: true });
    } finally {
      clearTimeoutImpl(timeout);
    }
    if (!response.ok) throw mappedHttpError(response.status);
    let text;
    try {
      text = await response.text();
      return text ? JSON.parse(text) : {};
    } catch {
      throw createApplicationError({ code: ERROR_CODES.DRIVE_RESPONSE_INVALID });
    }
  }

  return Object.freeze({ requestJson });
}
