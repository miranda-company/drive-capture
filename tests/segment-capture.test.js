import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateSegmentGeometry,
  isConsistentSegmentGeometry,
  validateSegmentPayload,
  validateSegmentSessionStart
} from "../src/shared/segment-capture.js";

const valid = {
  sessionId: "session-1",
  segmentIndex: 0,
  requestedScrollY: 0,
  actualScrollY: 0,
  cssViewport: { width: 100, height: 50 },
  dataUrl: "data:image/jpeg;base64,TWFu",
  mimeType: "image/jpeg",
  estimatedBytes: 3,
  capturedAt: 1000
};

test("validates a complete JPEG segment payload", () => {
  assert.equal(validateSegmentPayload(valid), true);
  assert.equal(validateSegmentSessionStart({ sessionId: "session-1", expectedMaximumSegments: 4 }), true);
});

test("rejects malformed segment fields", () => {
  for (const replacement of [
    { mimeType: "image/png" }, { dataUrl: "" }, { segmentIndex: -1 },
    { cssViewport: { width: 0, height: 50 } }, { capturedAt: -1 }, { capturedAt: 0 }, { sessionId: "" }
  ]) assert.equal(validateSegmentPayload({ ...valid, ...replacement }), false);
});

test("calculates scale and accepts consistent geometry within tolerance", () => {
  const first = calculateSegmentGeometry({
    bitmap: { width: 200, height: 100 }, cssViewport: { width: 100, height: 50 }
  });
  const close = calculateSegmentGeometry({
    bitmap: { width: 200, height: 100 }, cssViewport: { width: 100.2, height: 50.1 }
  });
  assert.deepEqual(first.scale, { x: 2, y: 2 });
  assert.equal(isConsistentSegmentGeometry(first, close, 0.01), true);
});

test("rejects changed and invalid capture geometry", () => {
  const first = calculateSegmentGeometry({
    bitmap: { width: 200, height: 100 }, cssViewport: { width: 100, height: 50 }
  });
  for (const bitmap of [{ width: 201, height: 100 }, { width: 200, height: 101 }]) {
    const changed = calculateSegmentGeometry({ bitmap, cssViewport: { width: 100, height: 50 } });
    assert.equal(isConsistentSegmentGeometry(first, changed, 0.01), false);
  }
  assert.equal(calculateSegmentGeometry({ bitmap: { width: Infinity, height: 1 }, cssViewport: { width: 1, height: 1 } }), null);
  assert.equal(calculateSegmentGeometry({ bitmap: { width: 1, height: 1 }, cssViewport: { width: 0, height: 1 } }), null);
});
