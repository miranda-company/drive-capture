import assert from "node:assert/strict";
import test from "node:test";

import { calculateCanvasAllocation, calculateSegmentPlacement } from "../src/shared/stitching.js";

test("calculates a bounded high-DPI canvas allocation", () => {
  assert.deepEqual(calculateCanvasAllocation({ bitmapWidth: 200, documentHeight: 120, scaleY: 2 }), {
    width: 200, height: 240, pixels: 48000, rgbaBytes: 192000,
    limits: { maxWidth: 16384, maxHeight: 32767, maxPixels: 100000000, maxRgbaBytes: 400000000 }
  });
  assert.equal(calculateCanvasAllocation({ bitmapWidth: 20000, documentHeight: 120, scaleY: 2 }), null);
  assert.equal(calculateCanvasAllocation({ bitmapWidth: 10000, documentHeight: 10000, scaleY: 2 }), null);
});

test("places from actual scroll, overwrites overlap, and crops the final partial viewport", () => {
  const first = calculateSegmentPlacement({
    actualScrollY: 0, bitmapWidth: 200, bitmapHeight: 100, scaleY: 2,
    canvasWidth: 200, canvasHeight: 240, documentHeight: 120, coveredBottom: 0
  });
  const second = calculateSegmentPlacement({
    actualScrollY: 50, bitmapWidth: 200, bitmapHeight: 100, scaleY: 2,
    canvasWidth: 200, canvasHeight: 240, documentHeight: 120, coveredBottom: first.coveredBottom
  });
  const final = calculateSegmentPlacement({
    actualScrollY: 70, bitmapWidth: 200, bitmapHeight: 100, scaleY: 2,
    canvasWidth: 200, canvasHeight: 240, documentHeight: 120, coveredBottom: second.coveredBottom
  });
  assert.equal(second.destination.y, 100);
  assert.equal(final.overlap, 60);
  assert.equal(final.destination.height, 100);
  assert.equal(final.coveredBottom, 240);
});

test("flags an uncovered segment gap", () => {
  const placement = calculateSegmentPlacement({
    actualScrollY: 60, bitmapWidth: 200, bitmapHeight: 100, scaleY: 2,
    canvasWidth: 200, canvasHeight: 300, documentHeight: 150, coveredBottom: 100, gapTolerance: 4
  });
  assert.equal(placement.gap, 20);
  assert.equal(placement.hasUnsafeGap, true);
});

test("supports non-integer and Retina capture scales", () => {
  const nonInteger = calculateCanvasAllocation({ bitmapWidth: 125, documentHeight: 101, scaleY: 1.25 });
  assert.equal(nonInteger.height, 126);
  const retina = calculateCanvasAllocation({ bitmapWidth: 200, documentHeight: 101, scaleY: 2 });
  assert.equal(retina.height, 202);
});
