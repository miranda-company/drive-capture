import { PAGE_MESSAGE_TIMEOUT_MS } from "../shared/constants.js";
import { createApplicationError, ERROR_CODES, validateApplicationError } from "../shared/errors.js";
import { CONTEXTS } from "../shared/constants.js";
import { createMessage, MESSAGE_TYPES, validateMessageEnvelope } from "../shared/messages.js";

export function createPageScriptAdapter({ chromeApi = globalThis.chrome, timeoutMs = PAGE_MESSAGE_TIMEOUT_MS } = {}) {
  async function inject(tabId) {
    try {
      await chromeApi.scripting.executeScript({
        target: { tabId },
        files: ["src/content/page-measurement.js"]
      });
    } catch {
      throw createApplicationError({ code: ERROR_CODES.PAGE_SCRIPT_UNAVAILABLE });
    }
  }

  async function send(tabId, type, expectedType, requestId, payload = {}) {
    let timer;
    try {
      const response = await Promise.race([
        chromeApi.tabs.sendMessage(tabId, createMessage({
          type, source: CONTEXTS.SERVICE_WORKER, target: CONTEXTS.PAGE, requestId, payload
        })),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
        })
      ]);
      if (validateApplicationError(response?.payload?.error)) throw response.payload.error;
      if (!validateMessageEnvelope(response) || response.type !== expectedType ||
          response.source !== CONTEXTS.PAGE || response.target !== CONTEXTS.SERVICE_WORKER ||
          response.requestId !== requestId) {
        throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
      }
      return response.payload;
    } catch (error) {
      if (validateApplicationError(error)) throw error;
      throw createApplicationError({ code: ERROR_CODES.PAGE_SCRIPT_UNAVAILABLE });
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    inject,
    initialize: (tabId, requestId, payload) => send(tabId, MESSAGE_TYPES.PAGE_CONTROLLER_INITIALIZE_REQUEST, MESSAGE_TYPES.PAGE_CONTROLLER_INITIALIZE_RESPONSE, requestId, payload),
    measure: (tabId, requestId, payload) => send(tabId, MESSAGE_TYPES.PAGE_MEASUREMENT_REQUEST, MESSAGE_TYPES.PAGE_MEASUREMENT_RESPONSE, requestId, payload),
    scrollStep: (tabId, requestId, payload) => send(tabId, MESSAGE_TYPES.PAGE_SCROLL_STEP_REQUEST, MESSAGE_TYPES.PAGE_SCROLL_STEP_RESULT, requestId, payload),
    restore: (tabId, requestId, payload) => send(tabId, MESSAGE_TYPES.PAGE_RESTORE_REQUEST, MESSAGE_TYPES.PAGE_RESTORE_RESULT, requestId, payload)
  });
}
