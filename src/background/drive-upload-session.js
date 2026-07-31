import {
  DRIVE_UPLOAD_TIMEOUT_MS,
  DRIVE_FOLDER_SCHEMA_VERSION
} from "../shared/constants.js";
import { createApplicationError, ERROR_CODES } from "../shared/errors.js";
import {
  validateUploadSessionUrl,
  validateUploadSourceMetadata
} from "../shared/drive-upload.js";
import { DriveRequestError } from "./google-drive-client.js";

const UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/drive/v3/files";
const UPLOAD_RESULT_FIELDS =
  "id,name,mimeType,size,createdTime,parents,webViewLink,md5Checksum,appProperties";

function mapSessionError(status) {
  if (status === 401) return new DriveRequestError(401);
  if (status === 403) {
    return createApplicationError({ code: ERROR_CODES.UPLOAD_ACCESS_DENIED });
  }
  if (status === 429) {
    return createApplicationError({
      code: ERROR_CODES.UPLOAD_RATE_LIMITED,
      retryable: true
    });
  }
  if (status >= 500) {
    return createApplicationError({
      code: ERROR_CODES.UPLOAD_SERVICE_UNAVAILABLE,
      retryable: true
    });
  }
  return createApplicationError({ code: ERROR_CODES.UPLOAD_SESSION_INVALID });
}

export function createDriveUploadSession({
  fetchImpl = globalThis.fetch,
  AbortControllerImpl = globalThis.AbortController,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
  timeoutMs = DRIVE_UPLOAD_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== "function" ||
      typeof AbortControllerImpl !== "function") {
    throw new TypeError("Upload session HTTP adapters are required.");
  }

  async function start({ token, folderId, result }) {
    if (typeof token !== "string" || !token) {
      throw createApplicationError({ code: ERROR_CODES.AUTH_REQUIRED });
    }
    if (typeof folderId !== "string" || !folderId || /[\s/?#]/u.test(folderId) ||
        !validateUploadSourceMetadata(result) || result.uploaded) {
      throw createApplicationError({ code: ERROR_CODES.UPLOAD_RESULT_UNAVAILABLE });
    }

    const url = new URL(UPLOAD_ENDPOINT);
    url.searchParams.set("uploadType", "resumable");
    url.searchParams.set("fields", UPLOAD_RESULT_FIELDS);
    const body = JSON.stringify({
      name: result.filename,
      mimeType: "image/jpeg",
      parents: [folderId],
      appProperties: {
        drivecaptureScreenshot: "true",
        drivecaptureSchema: String(DRIVE_FOLDER_SCHEMA_VERSION)
      }
    });
    const controller = new AbortControllerImpl();
    const timeout = setTimeoutImpl(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(url.href, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": "image/jpeg",
          "X-Upload-Content-Length": String(result.blobSize)
        },
        body,
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") {
        throw createApplicationError({
          code: ERROR_CODES.UPLOAD_TIMEOUT,
          retryable: true
        });
      }
      throw createApplicationError({
        code: ERROR_CODES.UPLOAD_NETWORK_ERROR,
        retryable: true
      });
    } finally {
      clearTimeoutImpl(timeout);
    }

    if (!response.ok) throw mapSessionError(response.status);
    const uploadSessionUrl = response.headers?.get?.("Location");
    if (!validateUploadSessionUrl(uploadSessionUrl)) {
      throw createApplicationError({ code: ERROR_CODES.UPLOAD_SESSION_INVALID });
    }
    return { uploadSessionUrl };
  }

  return Object.freeze({ start });
}

export const DRIVE_UPLOAD_RESULT_FIELDS = UPLOAD_RESULT_FIELDS;
