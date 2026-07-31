import { CONTEXTS, OFFSCREEN_DOCUMENT_PATH } from "../shared/constants.js";
import { createApplicationError, ERROR_CODES, validateApplicationError } from "../shared/errors.js";
import { createMessage, MESSAGE_TYPES, validateMessageEnvelope } from "../shared/messages.js";
import {
  validateUploadSourceMetadata
} from "../shared/drive-upload.js";

export function createOffscreenUploadAdapter(chromeApi = globalThis.chrome) {
  async function ensureDocument() {
    const documentUrl = chromeApi.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
    const contexts = await chromeApi.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [documentUrl]
    });
    if (contexts.length > 0) return { created: false, reused: true };
    try {
      await chromeApi.offscreen.createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: ["BLOBS"],
        justification:
          "Decode captured images, stitch them on a canvas, encode a JPEG Blob, and upload it to Google Drive."
      });
      return { created: true, reused: false };
    } catch {
      throw createApplicationError({ code: ERROR_CODES.OFFSCREEN_UNAVAILABLE });
    }
  }

  async function send(type, expectedType, payload = {}) {
    const request = createMessage({
      type,
      source: CONTEXTS.SERVICE_WORKER,
      target: CONTEXTS.OFFSCREEN,
      payload
    });
    let response;
    try {
      response = await chromeApi.runtime.sendMessage(request);
    } catch {
      throw createApplicationError({ code: ERROR_CODES.OFFSCREEN_SESSION_FAILED });
    }
    if (validateApplicationError(response?.payload?.error)) throw response.payload.error;
    if (!validateMessageEnvelope(response) ||
        response.type !== expectedType ||
        response.source !== CONTEXTS.OFFSCREEN ||
        response.target !== CONTEXTS.SERVICE_WORKER ||
        response.requestId !== request.requestId) {
      throw createApplicationError({ code: ERROR_CODES.OFFSCREEN_SESSION_FAILED });
    }
    return response.payload;
  }

  return Object.freeze({
    ensureDocument,
    readiness: async (resultId) => {
      const value = await send(
        MESSAGE_TYPES.OFFSCREEN_UPLOAD_READINESS_REQUEST,
        MESSAGE_TYPES.OFFSCREEN_UPLOAD_READINESS_RESPONSE,
        resultId ? { resultId } : {}
      );
      if (value.available && !validateUploadSourceMetadata(value)) {
        throw createApplicationError({ code: ERROR_CODES.UPLOAD_RESULT_UNAVAILABLE });
      }
      return value;
    },
    start: (payload) => send(
      MESSAGE_TYPES.OFFSCREEN_UPLOAD_START_REQUEST,
      MESSAGE_TYPES.OFFSCREEN_UPLOAD_START_RESPONSE,
      payload
    ),
    query: (payload) => send(
      MESSAGE_TYPES.OFFSCREEN_UPLOAD_QUERY_REQUEST,
      MESSAGE_TYPES.OFFSCREEN_UPLOAD_QUERY_RESPONSE,
      payload
    ),
    cancel: (payload) => send(
      MESSAGE_TYPES.OFFSCREEN_UPLOAD_CANCEL_REQUEST,
      MESSAGE_TYPES.OFFSCREEN_UPLOAD_CANCEL_RESPONSE,
      payload
    ),
    markUploaded: (payload) => send(
      MESSAGE_TYPES.OFFSCREEN_UPLOAD_MARK_REQUEST,
      MESSAGE_TYPES.OFFSCREEN_UPLOAD_MARK_RESPONSE,
      payload
    ),
    status: () => send(
      MESSAGE_TYPES.OFFSCREEN_UPLOAD_STATUS_REQUEST,
      MESSAGE_TYPES.OFFSCREEN_UPLOAD_STATUS_RESPONSE
    )
  });
}
