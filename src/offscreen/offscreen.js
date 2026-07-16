import { CONTEXTS, CURRENT_EXTENSION_PHASE } from "../shared/constants.js";
import { createApplicationError, ERROR_CODES } from "../shared/errors.js";
import {
  createMessage,
  MESSAGE_TYPES,
  validateMessageEnvelope
} from "../shared/messages.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!validateMessageEnvelope(message) || message.target !== CONTEXTS.OFFSCREEN) {
    return false;
  }

  if (
    message.type === MESSAGE_TYPES.OFFSCREEN_PING_REQUEST &&
    message.source === CONTEXTS.SERVICE_WORKER
  ) {
    sendResponse(
      createMessage({
        type: MESSAGE_TYPES.OFFSCREEN_PING_RESPONSE,
        source: CONTEXTS.OFFSCREEN,
        target: CONTEXTS.SERVICE_WORKER,
        requestId: message.requestId,
        payload: { ok: true, phase: CURRENT_EXTENSION_PHASE }
      })
    );
    return false;
  }

  sendResponse(
    createMessage({
      type: MESSAGE_TYPES.APPLICATION_ERROR_RESPONSE,
      source: CONTEXTS.OFFSCREEN,
      target: message.source,
      requestId: message.requestId,
      payload: {
        ok: false,
        error: createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE })
      }
    })
  );
  return false;
});
