import { CONTEXTS, MESSAGE_CONTRACT_VERSION } from "./constants.js";

export const MESSAGE_TYPES = Object.freeze({
  WORKER_PING_REQUEST: "WORKER_PING_REQUEST",
  WORKER_PING_RESPONSE: "WORKER_PING_RESPONSE",
  OFFSCREEN_SCAFFOLD_CHECK_REQUEST: "OFFSCREEN_SCAFFOLD_CHECK_REQUEST",
  OFFSCREEN_SCAFFOLD_CHECK_RESPONSE: "OFFSCREEN_SCAFFOLD_CHECK_RESPONSE",
  OFFSCREEN_PING_REQUEST: "OFFSCREEN_PING_REQUEST",
  OFFSCREEN_PING_RESPONSE: "OFFSCREEN_PING_RESPONSE",
  OFFSCREEN_CLOSE_REQUEST: "OFFSCREEN_CLOSE_REQUEST",
  APPLICATION_ERROR_RESPONSE: "APPLICATION_ERROR_RESPONSE",
  CAPTURE_REQUEST: "CAPTURE_REQUEST",
  CAPTURE_PROGRESS: "CAPTURE_PROGRESS",
  CAPTURE_SUCCESS: "CAPTURE_SUCCESS",
  CAPTURE_ERROR: "CAPTURE_ERROR",
  OFFSCREEN_IMAGE_PROCESSING_REQUEST: "OFFSCREEN_IMAGE_PROCESSING_REQUEST"
});

const KNOWN_CONTEXTS = new Set(Object.values(CONTEXTS));

function isPlainObject(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isJsonSerializable(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value !== "object" || seen.has(value)) {
    return false;
  }

  seen.add(value);

  const valid = Array.isArray(value)
    ? value.every((item) => isJsonSerializable(item, seen))
    : isPlainObject(value) &&
      Object.entries(value).every(
        ([key, item]) => typeof key === "string" && isJsonSerializable(item, seen)
      );

  seen.delete(value);
  return valid;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nestedValue of Object.values(value)) {
      deepFreeze(nestedValue);
    }
  }

  return value;
}

function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  const randomPart = Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${randomPart}`;
}

export function isSupportedMessageVersion(version) {
  return version === MESSAGE_CONTRACT_VERSION;
}

export function isKnownContext(context) {
  return KNOWN_CONTEXTS.has(context);
}

export function isMessageFor(message, source, target) {
  return (
    validateMessageEnvelope(message) &&
    message.source === source &&
    message.target === target
  );
}

export function validateMessageEnvelope(message) {
  return Boolean(
    isPlainObject(message) &&
      isSupportedMessageVersion(message.version) &&
      typeof message.type === "string" &&
      message.type.length > 0 &&
      isKnownContext(message.source) &&
      isKnownContext(message.target) &&
      typeof message.requestId === "string" &&
      message.requestId.length > 0 &&
      isPlainObject(message.payload) &&
      isJsonSerializable(message)
  );
}

export function createMessage({
  type,
  source,
  target,
  requestId = createRequestId(),
  payload = {}
}) {
  const message = {
    version: MESSAGE_CONTRACT_VERSION,
    type,
    source,
    target,
    requestId,
    payload
  };

  if (!validateMessageEnvelope(message)) {
    throw new TypeError("Cannot create an invalid or non-serializable message.");
  }

  return deepFreeze(cloneJsonValue(message));
}
