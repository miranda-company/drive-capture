import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateImageMetrics,
  formatAspectRatio,
  formatByteSize,
  formatMegapixels,
  isAllowedJpegQuality,
  parseJpegQuality,
  requireJpegQuality,
  resolveStoredJpegQuality
} from "../src/shared/output-settings.js";

test("accepts exactly the four supported JPEG qualities", () => {
  for (const quality of [0.8, 0.9, 0.92, 0.95]) {
    assert.equal(isAllowedJpegQuality(quality), true);
    assert.equal(requireJpegQuality(quality), quality);
    assert.equal(parseJpegQuality(String(quality)), quality);
  }
  for (const quality of [0, 0.91, 1, NaN, "0.92", null]) {
    assert.equal(isAllowedJpegQuality(quality), false);
    assert.throws(
      () => requireJpegQuality(quality),
      (error) => error.code === "INVALID_JPEG_QUALITY"
    );
  }
});

test("uses 0.92 when a stored preference is absent or invalid", () => {
  assert.equal(resolveStoredJpegQuality(undefined), 0.92);
  assert.equal(resolveStoredJpegQuality(0.91), 0.92);
  assert.equal(resolveStoredJpegQuality(0.8), 0.8);
});

test("calculates and formats human-readable image metadata", () => {
  assert.deepEqual(calculateImageMetrics(2000, 1000), {
    megapixels: 2,
    aspectRatio: 2
  });
  assert.equal(formatByteSize(500), "500 bytes");
  assert.equal(formatByteSize(2048), "2.00 KB");
  assert.equal(formatAspectRatio(16 / 9), "1.778:1");
  assert.equal(formatMegapixels(2), "2.00 MP");
});

test("rejects invalid output dimensions", () => {
  assert.throws(
    () => calculateImageMetrics(0, 100),
    (error) => error.code === "OUTPUT_METADATA_INVALID"
  );
});
