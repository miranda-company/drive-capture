import { CONTEXTS, CURRENT_EXTENSION_PHASE } from "../shared/constants.js";
import { createApplicationError, ERROR_CODES, serializeUnknownError } from "../shared/errors.js";
import { createMessage, MESSAGE_TYPES, validateMessageEnvelope } from "../shared/messages.js";
import { createSegmentSessionManager } from "./segment-decoder.js";
import { createCanvasStitchSessionManager } from "./canvas-stitcher.js";

const sessions = createSegmentSessionManager();
const stitching = createCanvasStitchSessionManager();

function response(message, type, payload) {
  return createMessage({
    type,
    source: CONTEXTS.OFFSCREEN,
    target: CONTEXTS.SERVICE_WORKER,
    requestId: message.requestId,
    payload
  });
}

async function handleAsync(message) {
  switch (message.type) {
    case MESSAGE_TYPES.OFFSCREEN_SEGMENT_SESSION_START_REQUEST:
      return response(message, MESSAGE_TYPES.OFFSCREEN_SEGMENT_SESSION_START_RESPONSE, sessions.start(message.payload));
    case MESSAGE_TYPES.OFFSCREEN_SEGMENT_PROCESS_REQUEST:
      return response(message, MESSAGE_TYPES.OFFSCREEN_SEGMENT_PROCESS_RESPONSE, await sessions.process(message.payload));
    case MESSAGE_TYPES.OFFSCREEN_SEGMENT_SESSION_FINISH_REQUEST:
      return response(message, MESSAGE_TYPES.OFFSCREEN_SEGMENT_SESSION_FINISH_RESPONSE, sessions.finish(message.payload));
    case MESSAGE_TYPES.OFFSCREEN_SEGMENT_SESSION_ABORT_REQUEST:
      return response(message, MESSAGE_TYPES.OFFSCREEN_SEGMENT_SESSION_ABORT_RESPONSE, sessions.abort(message.payload));
    case MESSAGE_TYPES.OFFSCREEN_STITCH_SESSION_START_REQUEST:
      return response(message, MESSAGE_TYPES.OFFSCREEN_STITCH_SESSION_START_RESPONSE, stitching.start(message.payload));
    case MESSAGE_TYPES.OFFSCREEN_STITCH_DRAW_REQUEST:
      return response(message, MESSAGE_TYPES.OFFSCREEN_STITCH_DRAW_RESPONSE, await stitching.draw(message.payload));
    case MESSAGE_TYPES.OFFSCREEN_STITCH_FINISH_REQUEST:
      return response(message, MESSAGE_TYPES.OFFSCREEN_STITCH_FINISH_RESPONSE, await stitching.finish(message.payload));
    case MESSAGE_TYPES.OFFSCREEN_STITCH_ABORT_REQUEST:
      return response(message, MESSAGE_TYPES.OFFSCREEN_STITCH_ABORT_RESPONSE, stitching.abort(message.payload));
    case MESSAGE_TYPES.OFFSCREEN_STITCH_RESULT_GET_REQUEST:
      return response(message, MESSAGE_TYPES.OFFSCREEN_STITCH_RESULT_GET_RESPONSE, stitching.getResult());
    case MESSAGE_TYPES.OFFSCREEN_STITCH_RESULT_CLEAR_REQUEST:
      return response(message, MESSAGE_TYPES.OFFSCREEN_STITCH_RESULT_CLEAR_RESPONSE, stitching.clearResult());
    default:
      throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!validateMessageEnvelope(message) || message.target !== CONTEXTS.OFFSCREEN) return false;
  if (message.source !== CONTEXTS.SERVICE_WORKER) {
    sendResponse(response(message, MESSAGE_TYPES.APPLICATION_ERROR_RESPONSE, {
      ok: false,
      error: createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE })
    }));
    return false;
  }

  if (message.type === MESSAGE_TYPES.OFFSCREEN_PING_REQUEST) {
    sendResponse(response(message, MESSAGE_TYPES.OFFSCREEN_PING_RESPONSE, {
      ok: true,
      phase: CURRENT_EXTENSION_PHASE
    }));
    return false;
  }

  handleAsync(message)
    .then(sendResponse)
    .catch((error) => {
      sendResponse(response(message, MESSAGE_TYPES.APPLICATION_ERROR_RESPONSE, {
        ok: false,
        error: serializeUnknownError(error)
      }));
    });
  return true;
});
