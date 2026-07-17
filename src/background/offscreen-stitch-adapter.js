import { CONTEXTS, OFFSCREEN_DOCUMENT_PATH } from "../shared/constants.js";
import { createApplicationError, ERROR_CODES, validateApplicationError } from "../shared/errors.js";
import { createMessage, MESSAGE_TYPES, validateMessageEnvelope } from "../shared/messages.js";
import { validateFullPageResult } from "../shared/stitching.js";

export function createOffscreenStitchAdapter(chromeApi = globalThis.chrome) {
  async function contexts() {
    return chromeApi.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chromeApi.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
    });
  }

  async function ensureDocument() {
    if ((await contexts()).length > 0) return { created: false, reused: true };
    try {
      await chromeApi.offscreen.createDocument({
        url: "src/offscreen/offscreen.html",
        reasons: ["BLOBS"],
        justification:
          "Decode captured images, stitch them on a canvas, encode a JPEG Blob, and upload it to Google Drive."
      });
      return { created: true, reused: false };
    } catch {
      if ((await contexts()).length > 0) return { created: false, reused: true };
      throw createApplicationError({ code: ERROR_CODES.OFFSCREEN_UNAVAILABLE });
    }
  }

  async function closeDocument() {
    if ((await contexts()).length === 0) return false;
    await chromeApi.offscreen.closeDocument();
    return true;
  }

  async function send(type, expectedType, payload = {}) {
    const request = createMessage({
      type, source: CONTEXTS.SERVICE_WORKER, target: CONTEXTS.OFFSCREEN, payload
    });
    let value;
    try {
      value = await chromeApi.runtime.sendMessage(request);
    } catch {
      throw createApplicationError({ code: ERROR_CODES.OFFSCREEN_SESSION_FAILED });
    }
    if (validateApplicationError(value?.payload?.error)) throw value.payload.error;
    if (!validateMessageEnvelope(value) || value.type !== expectedType ||
        value.source !== CONTEXTS.OFFSCREEN || value.target !== CONTEXTS.SERVICE_WORKER ||
        value.requestId !== request.requestId) {
      throw createApplicationError({ code: ERROR_CODES.OFFSCREEN_SESSION_FAILED });
    }
    return value.payload;
  }

  return Object.freeze({
    ensureDocument,
    closeDocument,
    startSession: (payload) => send(MESSAGE_TYPES.OFFSCREEN_STITCH_SESSION_START_REQUEST,
      MESSAGE_TYPES.OFFSCREEN_STITCH_SESSION_START_RESPONSE, payload),
    drawSegment: (payload) => send(MESSAGE_TYPES.OFFSCREEN_STITCH_DRAW_REQUEST,
      MESSAGE_TYPES.OFFSCREEN_STITCH_DRAW_RESPONSE, payload),
    finishSession: async (payload) => {
      const result = await send(MESSAGE_TYPES.OFFSCREEN_STITCH_FINISH_REQUEST,
        MESSAGE_TYPES.OFFSCREEN_STITCH_FINISH_RESPONSE, payload);
      if (!validateFullPageResult(result)) throw createApplicationError({ code: ERROR_CODES.OFFSCREEN_SESSION_FAILED });
      return result;
    },
    abortSession: (payload) => send(MESSAGE_TYPES.OFFSCREEN_STITCH_ABORT_REQUEST,
      MESSAGE_TYPES.OFFSCREEN_STITCH_ABORT_RESPONSE, payload),
    getResult: () => send(MESSAGE_TYPES.OFFSCREEN_STITCH_RESULT_GET_REQUEST,
      MESSAGE_TYPES.OFFSCREEN_STITCH_RESULT_GET_RESPONSE),
    clearResult: () => send(MESSAGE_TYPES.OFFSCREEN_STITCH_RESULT_CLEAR_REQUEST,
      MESSAGE_TYPES.OFFSCREEN_STITCH_RESULT_CLEAR_RESPONSE)
  });
}
