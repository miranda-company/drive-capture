import assert from "node:assert/strict";
import test from "node:test";

import { CONTEXTS, MESSAGE_CONTRACT_VERSION } from "../src/shared/constants.js";
import {
  createMessage,
  createRequestId,
  isMessageFor,
  isSupportedMessageVersion,
  MESSAGE_TYPES,
  validateMessageEnvelope
} from "../src/shared/messages.js";

function validMessage(overrides = {}) {
  return {
    version: MESSAGE_CONTRACT_VERSION,
    type: MESSAGE_TYPES.WORKER_PING_REQUEST,
    source: CONTEXTS.POPUP,
    target: CONTEXTS.SERVICE_WORKER,
    requestId: "request-1",
    payload: {},
    ...overrides
  };
}

test("creates a valid immutable message", () => {
  const message = createMessage({
    type: MESSAGE_TYPES.WORKER_PING_REQUEST,
    source: CONTEXTS.POPUP,
    target: CONTEXTS.SERVICE_WORKER,
    payload: { check: true }
  });

  assert.equal(validateMessageEnvelope(message), true);
  assert.equal(isMessageFor(message, CONTEXTS.POPUP, CONTEXTS.SERVICE_WORKER), true);
  assert.equal(Object.isFrozen(message), true);
  assert.equal(Object.isFrozen(message.payload), true);
});

test("creates unique request IDs", () => {
  const ids = new Set(Array.from({ length: 100 }, () => createRequestId()));
  assert.equal(ids.size, 100);
});

test("rejects an invalid message version", () => {
  const message = validMessage({ version: MESSAGE_CONTRACT_VERSION + 1 });
  assert.equal(isSupportedMessageVersion(message.version), false);
  assert.equal(validateMessageEnvelope(message), false);
});

test("rejects an invalid source context", () => {
  assert.equal(validateMessageEnvelope(validMessage({ source: "unknown" })), false);
});

test("rejects an invalid target context", () => {
  assert.equal(validateMessageEnvelope(validMessage({ target: "unknown" })), false);
});

test("rejects a missing message type", () => {
  assert.equal(validateMessageEnvelope(validMessage({ type: undefined })), false);
});

test("rejects non-serializable payloads", () => {
  assert.throws(
    () =>
      createMessage({
        type: MESSAGE_TYPES.WORKER_PING_REQUEST,
        source: CONTEXTS.POPUP,
        target: CONTEXTS.SERVICE_WORKER,
        payload: { callback() {} }
      }),
    TypeError
  );

  const cyclicPayload = {};
  cyclicPayload.self = cyclicPayload;
  assert.throws(
    () =>
      createMessage({
        type: MESSAGE_TYPES.WORKER_PING_REQUEST,
        source: CONTEXTS.POPUP,
        target: CONTEXTS.SERVICE_WORKER,
        payload: cyclicPayload
      }),
    TypeError
  );
});
