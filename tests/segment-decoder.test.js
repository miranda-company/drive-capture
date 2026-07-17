import assert from "node:assert/strict";
import test from "node:test";

import { createSegmentSessionManager } from "../src/offscreen/segment-decoder.js";

const payload = (index = 0) => ({
  sessionId: "session-1", segmentIndex: index,
  requestedScrollY: index * 50, actualScrollY: index * 50,
  cssViewport: { width: 100, height: 50 },
  dataUrl: "data:image/jpeg;base64,TWFu", mimeType: "image/jpeg",
  estimatedBytes: 3, capturedAt: 1000 + index
});

function manager(overrides = {}) {
  return createSegmentSessionManager({
    decode: async () => ({ width: 200, height: 100 }),
    now: () => 2000,
    ...overrides
  });
}

test("creates a session, processes sequential segments, and completes", async () => {
  const sessions = manager();
  sessions.start({ sessionId: "session-1", expectedMaximumSegments: 2 });
  assert.equal((await sessions.process(payload(0))).segmentIndex, 0);
  assert.equal((await sessions.process(payload(1))).scale.x, 2);
  assert.equal(sessions.finish({ sessionId: "session-1" }).processedSegmentCount, 2);
  await assert.rejects(sessions.process(payload(2)), (error) => error.code === "SEGMENT_SESSION_INVALID");
});

test("rejects duplicate and out-of-order segment indexes", async () => {
  const sessions = manager();
  sessions.start({ sessionId: "session-1", expectedMaximumSegments: 3 });
  await sessions.process(payload(0));
  await assert.rejects(sessions.process(payload(0)), (error) => error.code === "SEGMENT_OUT_OF_ORDER");
  await assert.rejects(sessions.process(payload(2)), (error) => error.code === "SEGMENT_OUT_OF_ORDER");
});

test("enforces the declared maximum and supports abort", async () => {
  const sessions = manager();
  sessions.start({ sessionId: "session-1", expectedMaximumSegments: 1 });
  await sessions.process(payload(0));
  await assert.rejects(sessions.process(payload(1)), (error) => error.code === "SEGMENT_LIMIT_EXCEEDED");
  assert.equal(sessions.abort({ sessionId: "session-1" }).aborted, true);
  assert.throws(() => sessions.finish({ sessionId: "session-1" }), (error) => error.code === "SEGMENT_SESSION_INVALID");
});

test("rejects changed bitmap geometry and decode failures", async () => {
  let count = 0;
  const sessions = manager({ decode: async () => (++count === 1 ? { width: 200, height: 100 } : { width: 201, height: 100 }) });
  sessions.start({ sessionId: "session-1", expectedMaximumSegments: 2 });
  await sessions.process(payload(0));
  await assert.rejects(sessions.process(payload(1)), (error) => error.code === "SEGMENT_GEOMETRY_CHANGED");

  const failing = manager({ decode: async () => { throw new Error("private decode failure"); } });
  failing.start({ sessionId: "session-1", expectedMaximumSegments: 1 });
  await assert.rejects(failing.process(payload(0)), (error) => error.code === "SEGMENT_DECODE_FAILED");
});

test("rejects unknown and duplicate sessions", () => {
  const sessions = manager();
  assert.throws(() => sessions.finish({ sessionId: "missing" }), (error) => error.code === "SEGMENT_SESSION_INVALID");
  sessions.start({ sessionId: "session-1", expectedMaximumSegments: 1 });
  assert.throws(() => sessions.start({ sessionId: "session-1", expectedMaximumSegments: 1 }), (error) => error.code === "SEGMENT_SESSION_INVALID");
});
