import { DRIVE_UPLOAD_TIMEOUT_MS } from "../shared/constants.js";
import { createApplicationError, ERROR_CODES } from "../shared/errors.js";
import {
  validateOffscreenUploadRequest,
  validateUploadSessionUrl
} from "../shared/drive-upload.js";

const EXPECTED_FILE_KEYS = Object.freeze([
  "id",
  "name",
  "mimeType",
  "size",
  "createdTime",
  "parents",
  "webViewLink",
  "md5Checksum",
  "appProperties"
]);

function safeFileMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createApplicationError({ code: ERROR_CODES.UPLOAD_RESPONSE_INVALID });
  }
  const selected = {};
  for (const key of EXPECTED_FILE_KEYS) {
    if (value[key] !== undefined) selected[key] = value[key];
  }
  return selected;
}

async function parseFileResponse(response) {
  let value;
  try {
    value = JSON.parse(await response.text());
  } catch {
    throw createApplicationError({ code: ERROR_CODES.UPLOAD_RESPONSE_INVALID });
  }
  return safeFileMetadata(value);
}

function mappedUploadError(status) {
  if (status === 308) {
    return createApplicationError({
      code: ERROR_CODES.UPLOAD_INCOMPLETE,
      retryable: true
    });
  }
  if (status === 404) {
    return createApplicationError({
      code: ERROR_CODES.UPLOAD_SESSION_EXPIRED,
      retryable: true
    });
  }
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
  return createApplicationError({ code: ERROR_CODES.UPLOAD_RESPONSE_INVALID });
}

function validateIncompleteRange(response, total) {
  const range = response.headers?.get?.("Range");
  if (range === null || range === undefined || range === "") return true;
  const match = /^bytes=0-(\d+)$/u.exec(range);
  return Boolean(match && Number(match[1]) < total);
}

export function createDriveBlobUploader({
  getUploadSource,
  fetchImpl = globalThis.fetch,
  AbortControllerImpl = globalThis.AbortController,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
  timeoutMs = DRIVE_UPLOAD_TIMEOUT_MS
} = {}) {
  if (typeof getUploadSource !== "function" ||
      typeof fetchImpl !== "function" ||
      typeof AbortControllerImpl !== "function") {
    throw new TypeError("Offscreen upload adapters are required.");
  }

  let active = null;
  let last = { state: "idle", resultId: null };

  async function queryOnce(operation) {
    if (operation.statusQueries >= 1 ||
        !validateUploadSessionUrl(operation.uploadSessionUrl)) {
      throw createApplicationError({ code: ERROR_CODES.UPLOAD_RESPONSE_INVALID });
    }
    operation.statusQueries += 1;
    const controller = new AbortControllerImpl();
    operation.queryController = controller;
    let timedOut = false;
    const timer = setTimeoutImpl(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    let response;
    try {
      response = await fetchImpl(operation.uploadSessionUrl, {
        method: "PUT",
        headers: {
          "Content-Range": `bytes */${operation.expectedBlobSize}`
        },
        signal: controller.signal
      });
    } catch {
      if (timedOut) {
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
      clearTimeoutImpl(timer);
      operation.queryController = null;
    }
    if (response.status === 200 || response.status === 201) {
      return {
        completed: true,
        file: await parseFileResponse(response),
        statusQueryCount: operation.statusQueries
      };
    }
    if (response.status === 308) {
      if (!validateIncompleteRange(response, operation.expectedBlobSize)) {
        throw createApplicationError({ code: ERROR_CODES.UPLOAD_RESPONSE_INVALID });
      }
      throw createApplicationError({
        code: ERROR_CODES.UPLOAD_INCOMPLETE,
        retryable: true
      });
    }
    throw mappedUploadError(response.status);
  }

  async function start(payload) {
    if (!validateOffscreenUploadRequest(payload)) {
      throw createApplicationError({ code: ERROR_CODES.UPLOAD_SESSION_INVALID });
    }
    if (active) throw createApplicationError({ code: ERROR_CODES.UPLOAD_BUSY });
    const source = getUploadSource(payload.resultId);
    if (!source?.blob ||
        source.blob.size !== payload.expectedBlobSize ||
        source.blob.type !== payload.expectedMimeType ||
        source.metadata?.uploaded === true) {
      throw createApplicationError({
        code: source?.metadata?.uploaded
          ? ERROR_CODES.UPLOAD_ALREADY_COMPLETED
          : ERROR_CODES.UPLOAD_RESULT_UNAVAILABLE
      });
    }

    const controller = new AbortControllerImpl();
    const operation = {
      resultId: payload.resultId,
      uploadSessionUrl: payload.uploadSessionUrl,
      expectedBlobSize: payload.expectedBlobSize,
      controller,
      cancelled: false,
      timedOut: false,
      statusQueries: 0,
      queryController: null
    };
    active = operation;
    last = { state: "uploading", resultId: payload.resultId };
    const timer = setTimeoutImpl(() => {
      operation.timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      let response;
      try {
        response = await fetchImpl(operation.uploadSessionUrl, {
          method: "PUT",
          headers: { "Content-Type": "image/jpeg" },
          body: source.blob,
          signal: controller.signal
        });
      } catch (error) {
        try {
          const queried = await queryOnce(operation);
          last = { state: "completed", resultId: payload.resultId };
          return queried;
        } catch (queryError) {
          if (operation.cancelled) {
            throw createApplicationError({ code: ERROR_CODES.UPLOAD_ABORTED });
          }
          if (operation.timedOut || error?.name === "AbortError") {
            throw createApplicationError({
              code: ERROR_CODES.UPLOAD_TIMEOUT,
              retryable: true
            });
          }
          if (queryError?.code) throw queryError;
          throw createApplicationError({
            code: ERROR_CODES.UPLOAD_NETWORK_ERROR,
            retryable: true
          });
        }
      }

      if (response.status === 200 || response.status === 201) {
        const result = {
          completed: true,
          file: await parseFileResponse(response),
          statusQueryCount: operation.statusQueries
        };
        last = { state: "completed", resultId: payload.resultId };
        return result;
      }
      if (response.status >= 500) {
        const result = await queryOnce(operation);
        last = { state: "completed", resultId: payload.resultId };
        return result;
      }
      throw mappedUploadError(response.status);
    } catch (error) {
      last = {
        state: error?.code === ERROR_CODES.UPLOAD_ABORTED ? "cancelled" : "failed",
        resultId: payload.resultId
      };
      throw error;
    } finally {
      clearTimeoutImpl(timer);
      operation.uploadSessionUrl = "";
      active = null;
    }
  }

  function cancel({ resultId }) {
    if (!active || active.resultId !== resultId) {
      return { accepted: false };
    }
    active.cancelled = true;
    active.controller.abort();
    active.queryController?.abort();
    return { accepted: true };
  }

  function query({ resultId }) {
    if (!active || active.resultId !== resultId) {
      throw createApplicationError({ code: ERROR_CODES.UPLOAD_RESULT_UNAVAILABLE });
    }
    return queryOnce(active);
  }

  function status() {
    return { ...last };
  }

  return Object.freeze({ start, cancel, query, status });
}
