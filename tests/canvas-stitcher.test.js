import assert from "node:assert/strict";
import test from "node:test";

import {
  createCanvasStitchSessionManager,
  validateJpegBlob
} from "../src/offscreen/canvas-stitcher.js";

const dataUrl = "data:image/jpeg;base64,TWFu";
const payload = (index, actualScrollY, sessionId = "stitch-1") => ({
  sessionId, segmentIndex: index,
  requestedScrollY: actualScrollY, actualScrollY,
  cssViewport: { width: 100, height: 50 }, dataUrl,
  mimeType: "image/jpeg", estimatedBytes: 3, capturedAt: 1000 + index
});
const startPayload = (sessionId, expectedMaximumSegments, documentDimensions, jpegQuality = 0.92) => ({
  sessionId,
  expectedMaximumSegments,
  documentDimensions,
  jpegQuality,
  filename: "DriveCapture_Example_2026-07-17_12-00-00-123.jpg",
  filenameSource: "automatic"
});
const validJpegBytes = new Uint8Array([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);

function setup() {
  const draws = [];
  const releases = [];
  const revoked = [];
  let urlIndex = 0;
  const canvas = {
    width: 0, height: 0,
    getContext() { return { drawImage(...args) { draws.push(args.slice(1)); } }; },
    toBlob(callback, type, quality) {
      assert.equal(type, "image/jpeg");
      assert.equal(quality, 0.92);
      callback(new Blob([validJpegBytes], { type }));
    }
  };
  const manager = createCanvasStitchSessionManager({
    createCanvas: () => canvas,
    decode: async () => ({
      image: {}, width: 200, height: 100,
      release() { releases.push(true); }
    }),
    urlApi: {
      createObjectURL() { urlIndex += 1; return `blob:preview-${urlIndex}`; },
      revokeObjectURL(value) { revoked.push(value); }
    },
    now: () => 2000
  });
  return { manager, canvas, draws, releases, revoked };
}

test("draws incrementally, releases every decoded image, and retains only the final Blob result", async () => {
  const { manager, canvas, draws, releases } = setup();
  manager.start(startPayload("stitch-1", 3, { width: 100, height: 120 }));
  await manager.draw(payload(0, 0));
  await manager.draw(payload(1, 50));
  await manager.draw(payload(2, 70));
  assert.equal(canvas.width, 200);
  assert.equal(canvas.height, 240);
  assert.equal(draws.length, 3);
  assert.equal(draws[2][7], 100);
  assert.equal(releases.length, 3);
  const result = await manager.finish({ sessionId: "stitch-1" });
  assert.equal(result.previewUrl, "blob:preview-1");
  assert.equal(result.filename, "DriveCapture_Example_2026-07-17_12-00-00-123.jpg");
  assert.equal(result.jpegQuality, 0.92);
  assert.equal(result.validJpegSignature, true);
  assert.equal(result.blobSize, validJpegBytes.length);
  assert.deepEqual(result.captureScale, { x: 2, y: 2 });
  assert.equal(result.segmentCount, 3);
  assert.equal(result.placements[2].overlap, 60);
  assert.equal(result.placements[2].previousBottom, 200);
  assert.equal(result.placements[2].sourceCropHeight, 100);
  assert.deepEqual(result.stitchingDiagnostics, {
    totalOverlapPixels: 60,
    totalNewlyCoveredPixels: 240,
    maximumGapPixels: 0
  });
  assert.deepEqual(manager.getResult(), result);
});

test("crops a short page to the final canvas height", async () => {
  const { manager, draws, canvas } = setup();
  manager.start(startPayload("stitch-1", 1, { width: 100, height: 30 }));
  await manager.draw(payload(0, 0));
  assert.equal(canvas.height, 60);
  assert.equal(draws[0][3], 60);
  assert.equal(draws[0][7], 60);
  assert.equal((await manager.finish({ sessionId: "stitch-1" })).height, 60);
});

test("reports horizontal overflow while keeping the captured viewport width", async () => {
  const { manager } = setup();
  manager.start(startPayload("stitch-1", 1, { width: 150, height: 50 }));
  await manager.draw(payload(0, 0));
  const result = await manager.finish({ sessionId: "stitch-1" });
  assert.equal(result.width, 200);
  assert.equal(result.horizontalOverflow, true);
});

test("revokes prior and cleared results and resets Canvas dimensions", async () => {
  const { manager, revoked, canvas } = setup();
  manager.start(startPayload("stitch-1", 1, { width: 100, height: 50 }));
  await manager.draw(payload(0, 0));
  await manager.finish({ sessionId: "stitch-1" });
  manager.start(startPayload("stitch-2", 1, { width: 100, height: 50 }));
  assert.deepEqual(revoked, ["blob:preview-1"]);
  assert.equal(canvas.width, 0);
  assert.equal(canvas.height, 0);
  await manager.draw(payload(0, 0, "stitch-2"));
  await manager.finish({ sessionId: "stitch-2" });
  assert.equal(manager.clearResult().cleared, true);
  assert.deepEqual(revoked, ["blob:preview-1", "blob:preview-2"]);
  assert.equal(canvas.width, 0);
  assert.equal(canvas.height, 0);
});

test("rejects unsafe allocation and gaps before encoding", async () => {
  const oversized = setup().manager;
  oversized.start(startPayload("stitch-1", 1, { width: 100, height: 20000 }));
  await assert.rejects(oversized.draw(payload(0, 0)), (error) => error.code === "CANVAS_LIMIT_EXCEEDED");

  const gapped = setup().manager;
  gapped.start(startPayload("stitch-1", 1, { width: 100, height: 150 }));
  await assert.rejects(gapped.draw(payload(0, 60)), (error) => error.code === "SEGMENT_GAP_DETECTED");
});

test("returns stable context, draw, and encoding failures and releases decoded images", async () => {
  const baseOptions = (canvas, released) => ({
    createCanvas: () => canvas,
    decode: async () => ({ image: {}, width: 200, height: 100, release() { released.count += 1; } }),
    urlApi: { createObjectURL: () => "blob:test", revokeObjectURL() {} }
  });

  const noContextRelease = { count: 0 };
  const noContext = createCanvasStitchSessionManager(baseOptions({ getContext: () => null }, noContextRelease));
  noContext.start(startPayload("stitch-1", 1, { width: 100, height: 50 }));
  await assert.rejects(noContext.draw(payload(0, 0)), (error) => error.code === "CANVAS_CONTEXT_UNAVAILABLE");
  assert.equal(noContextRelease.count, 1);

  const drawRelease = { count: 0 };
  const drawFailure = createCanvasStitchSessionManager(baseOptions({
    getContext: () => ({ drawImage() { throw new Error("draw"); } })
  }, drawRelease));
  drawFailure.start(startPayload("stitch-1", 1, { width: 100, height: 50 }));
  await assert.rejects(drawFailure.draw(payload(0, 0)), (error) => error.code === "SEGMENT_DRAW_FAILED");
  assert.equal(drawRelease.count, 1);

  const encodeRelease = { count: 0 };
  const encodingFailure = createCanvasStitchSessionManager(baseOptions({
    getContext: () => ({ drawImage() {} }),
    toBlob(callback) { callback(null); }
  }, encodeRelease));
  encodingFailure.start(startPayload("stitch-1", 1, { width: 100, height: 50 }));
  await encodingFailure.draw(payload(0, 0));
  await assert.rejects(encodingFailure.finish({ sessionId: "stitch-1" }),
    (error) => error.code === "IMAGE_ENCODING_FAILED");
});

test("uses each supported per-session JPEG quality", async () => {
  for (const quality of [0.8, 0.9, 0.92, 0.95]) {
    let receivedQuality;
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage() {} }),
      toBlob(callback, _type, value) {
        receivedQuality = value;
        callback(new Blob([validJpegBytes], { type: "image/jpeg" }));
      }
    };
    const manager = createCanvasStitchSessionManager({
      createCanvas: () => canvas,
      decode: async () => ({ image: {}, width: 200, height: 100, release() {} }),
      urlApi: { createObjectURL: () => "blob:test", revokeObjectURL() {} }
    });
    manager.start(startPayload(`quality-${quality}`, 1, { width: 100, height: 50 }, quality));
    await manager.draw(payload(0, 0, `quality-${quality}`));
    await manager.finish({ sessionId: `quality-${quality}` });
    assert.equal(receivedQuality, quality);
  }
});

test("validates only the JPEG boundary slices and rejects bad output", async () => {
  const blob = new Blob([validJpegBytes], { type: "image/jpeg" });
  const slices = [];
  const result = await validateJpegBlob(blob, async (slice) => {
    slices.push(slice.size);
    return slice.arrayBuffer();
  });
  assert.deepEqual(slices, [2, 2]);
  assert.equal(result.validJpegSignature, true);

  for (const invalid of [
    new Blob([new Uint8Array([0, 0, 1, 2, 0xff, 0xd9])], { type: "image/jpeg" }),
    new Blob([new Uint8Array([0xff, 0xd8, 1, 2, 0, 0])], { type: "image/jpeg" }),
    new Blob([], { type: "image/jpeg" }),
    new Blob([validJpegBytes], { type: "image/png" })
  ]) {
    await assert.rejects(validateJpegBlob(invalid),
      (error) => error.code === "JPEG_VALIDATION_FAILED");
  }

  await assert.rejects(
    validateJpegBlob(blob, async () => { throw new Error("read failed"); }),
    (error) => error.code === "JPEG_VALIDATION_FAILED"
  );
  assert.deepEqual(Object.keys(result).sort(), [
    "blobSize",
    "mimeType",
    "validJpegSignature"
  ]);
  assert.equal(
    (await validateJpegBlob(new Blob([validJpegBytes], { type: "image/jpg" }))).mimeType,
    "image/jpeg"
  );
});

test("rejects unsupported quality before allocating or drawing", () => {
  const { manager } = setup();
  assert.throws(
    () => manager.start(startPayload("stitch-1", 1, { width: 100, height: 50 }, 0.91)),
    (error) => error.code === "INVALID_JPEG_QUALITY"
  );
});
