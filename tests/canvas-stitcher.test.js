import assert from "node:assert/strict";
import test from "node:test";

import { createCanvasStitchSessionManager } from "../src/offscreen/canvas-stitcher.js";

const dataUrl = "data:image/jpeg;base64,TWFu";
const payload = (index, actualScrollY, sessionId = "stitch-1") => ({
  sessionId, segmentIndex: index,
  requestedScrollY: actualScrollY, actualScrollY,
  cssViewport: { width: 100, height: 50 }, dataUrl,
  mimeType: "image/jpeg", estimatedBytes: 3, capturedAt: 1000 + index
});

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
      callback(new Blob(["jpeg-output"], { type }));
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
  manager.start({ sessionId: "stitch-1", expectedMaximumSegments: 3,
    documentDimensions: { width: 100, height: 120 } });
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
  manager.start({ sessionId: "stitch-1", expectedMaximumSegments: 1,
    documentDimensions: { width: 100, height: 30 } });
  await manager.draw(payload(0, 0));
  assert.equal(canvas.height, 60);
  assert.equal(draws[0][3], 60);
  assert.equal(draws[0][7], 60);
  assert.equal((await manager.finish({ sessionId: "stitch-1" })).height, 60);
});

test("reports horizontal overflow while keeping the captured viewport width", async () => {
  const { manager } = setup();
  manager.start({ sessionId: "stitch-1", expectedMaximumSegments: 1,
    documentDimensions: { width: 150, height: 50 } });
  await manager.draw(payload(0, 0));
  const result = await manager.finish({ sessionId: "stitch-1" });
  assert.equal(result.width, 200);
  assert.equal(result.horizontalOverflow, true);
});

test("revokes prior and cleared results and resets Canvas dimensions", async () => {
  const { manager, revoked, canvas } = setup();
  manager.start({ sessionId: "stitch-1", expectedMaximumSegments: 1,
    documentDimensions: { width: 100, height: 50 } });
  await manager.draw(payload(0, 0));
  await manager.finish({ sessionId: "stitch-1" });
  manager.start({ sessionId: "stitch-2", expectedMaximumSegments: 1,
    documentDimensions: { width: 100, height: 50 } });
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
  oversized.start({ sessionId: "stitch-1", expectedMaximumSegments: 1,
    documentDimensions: { width: 100, height: 20000 } });
  await assert.rejects(oversized.draw(payload(0, 0)), (error) => error.code === "CANVAS_LIMIT_EXCEEDED");

  const gapped = setup().manager;
  gapped.start({ sessionId: "stitch-1", expectedMaximumSegments: 1,
    documentDimensions: { width: 100, height: 150 } });
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
  noContext.start({ sessionId: "stitch-1", expectedMaximumSegments: 1,
    documentDimensions: { width: 100, height: 50 } });
  await assert.rejects(noContext.draw(payload(0, 0)), (error) => error.code === "CANVAS_CONTEXT_UNAVAILABLE");
  assert.equal(noContextRelease.count, 1);

  const drawRelease = { count: 0 };
  const drawFailure = createCanvasStitchSessionManager(baseOptions({
    getContext: () => ({ drawImage() { throw new Error("draw"); } })
  }, drawRelease));
  drawFailure.start({ sessionId: "stitch-1", expectedMaximumSegments: 1,
    documentDimensions: { width: 100, height: 50 } });
  await assert.rejects(drawFailure.draw(payload(0, 0)), (error) => error.code === "SEGMENT_DRAW_FAILED");
  assert.equal(drawRelease.count, 1);

  const encodeRelease = { count: 0 };
  const encodingFailure = createCanvasStitchSessionManager(baseOptions({
    getContext: () => ({ drawImage() {} }),
    toBlob(callback) { callback(null); }
  }, encodeRelease));
  encodingFailure.start({ sessionId: "stitch-1", expectedMaximumSegments: 1,
    documentDimensions: { width: 100, height: 50 } });
  await encodingFailure.draw(payload(0, 0));
  await assert.rejects(encodingFailure.finish({ sessionId: "stitch-1" }),
    (error) => error.code === "IMAGE_ENCODING_FAILED");
});
