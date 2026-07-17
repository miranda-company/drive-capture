import assert from "node:assert/strict";
import test from "node:test";

import { createFullPageCaptureCoordinator } from "../src/background/full-page-capture.js";
import { createJobState } from "../src/background/job-state.js";

const JPEG = "data:image/jpeg;base64,TWFu";
const identity = { hrefFingerprint: "deadbeef", timeOrigin: 1, documentElementReferenceVersion: 1 };
const raw = (height = 120, y = 0) => ({
  innerWidth: 100, innerHeight: 50, scrollX: 0, scrollY: y, devicePixelRatio: 2,
  documentElementScrollWidth: 100, documentElementScrollHeight: height,
  bodyScrollWidth: 100, bodyScrollHeight: height, scrollingElementKind: "document-element"
});

function storage() {
  const values = new Map();
  return {
    async get(key) { return values.has(key) ? { [key]: structuredClone(values.get(key)) } : {}; },
    async set(entries) { for (const [key, value] of Object.entries(entries)) values.set(key, structuredClone(value)); },
    async remove(key) { values.delete(key); }
  };
}

function harness(overrides = {}) {
  let clock = 1000;
  let currentY = 0;
  const calls = [];
  const releases = [];
  const jobState = createJobState(storage());
  const pageAdapter = {
    async inject() { calls.push("inject"); },
    async initialize() { calls.push("initialize"); return { identity, hostname: "example.com" }; },
    async measure() { calls.push("measure"); return { identity, rawMeasurement: raw() }; },
    async scrollStep(_tab, _request, payload) {
      currentY = payload.targetY;
      calls.push(`scroll:${payload.targetY}`);
      return { identity, requestedY: payload.targetY, actualY: payload.targetY,
        clamped: false, documentHeightChanged: false, rawMeasurement: raw(120, payload.targetY) };
    },
    async cancel() { calls.push("page-cancel"); return { accepted: true }; },
    async prepareOverlays(_tab, _request, payload) {
      calls.push(`overlay-prepare:${payload.suppress}`);
      return {
        identity,
        candidates: [],
        detected: 0,
        suppressed: 0,
        suppressionApplied: payload.suppress,
        rawMeasurement: raw(120, payload.expectedScrollY)
      };
    },
    async restoreOverlays() {
      calls.push("overlay-restore");
      return {
        identity,
        detected: 0,
        suppressed: 0,
        restored: 0,
        restorationSucceeded: true,
        applicable: true
      };
    },
    async restore() { calls.push("restore"); return { identity, actual: { x: 0, y: 0 }, withinTolerance: true, settled: true }; },
    ...overrides.pageAdapter
  };
  const tabAdapter = {
    async queryActiveTab() { calls.push("query"); return [{ id: 4, windowId: 8, url: "https://example.com" }]; },
    async captureVisibleTab() { calls.push(`capture:${clock}`); return JPEG; },
    ...overrides.tabAdapter
  };
  const placements = [0, 100, 140].map((destinationY, segmentIndex) => ({
    segmentIndex, actualScrollY: [0, 50, 70][segmentIndex], destinationY,
    drawnHeight: 100, overlap: segmentIndex === 2 ? 60 : 0,
    newlyCoveredPixels: segmentIndex === 2 ? 40 : 100,
    coveredBottom: [100, 200, 240][segmentIndex]
  }));
  const offscreenAdapter = {
    async ensureDocument() { calls.push("offscreen-open"); },
    async clearResult() { calls.push("result-clear"); return { cleared: false }; },
    async startSession() { calls.push("session-start"); },
    async drawSegment(payload) { calls.push(`draw:${payload.segmentIndex}`); return { segmentIndex: payload.segmentIndex }; },
    async finishSession() {
      calls.push("session-finish");
      return { available: true, previewUrl: "blob:full-page", mimeType: "image/jpeg",
        width: 200, height: 240, encodedBytes: 1000, createdAt: 3000,
        segmentCount: 3, placements, horizontalOverflow: false, scale: { x: 2, y: 2 },
        stitchingDiagnostics: {
          totalOverlapPixels: 60,
          totalNewlyCoveredPixels: 240,
          maximumGapPixels: 0
        } };
    },
    async abortSession() { calls.push("session-abort"); },
    async closeDocument() { calls.push("offscreen-close"); },
    ...overrides.offscreenAdapter
  };
  const coordinator = createFullPageCaptureCoordinator({
    tabAdapter, pageAdapter, offscreenAdapter, jobState,
    now: () => clock,
    delay: async (ms) => { calls.push(`delay:${ms}`); clock += ms; overrides.onDelay?.(); },
    createJobId: () => "job-1",
    onSegmentReleased: (value) => { releases.push(value); calls.push(`release:${value.segmentIndex}`); }
  });
  return { coordinator, calls, releases, jobState };
}

test("captures, draws, and releases one segment at a time with 550 ms pacing", async () => {
  const setup = harness();
  const result = await setup.coordinator.run({ requestId: "request-1" });
  assert.deepEqual(result.captureIntervalsMs, [550, 550]);
  assert.deepEqual(setup.releases, [{ segmentIndex: 0 }, { segmentIndex: 1 }, { segmentIndex: 2 }]);
  assert.ok(setup.calls.indexOf("draw:0") < setup.calls.indexOf("release:0"));
  assert.ok(setup.calls.indexOf("release:0") < setup.calls.indexOf("capture:1550"));
  assert.equal(setup.calls.includes("offscreen-close"), false);
  assert.equal(setup.calls.at(-1), "restore");
  assert.equal(await setup.jobState.readActiveJob(), null);
  assert.deepEqual(
    setup.calls.filter((value) => value.startsWith("overlay-prepare:")),
    ["overlay-prepare:false", "overlay-prepare:true", "overlay-prepare:true"]
  );
  assert.ok(setup.calls.indexOf("overlay-prepare:true") < setup.calls.indexOf("capture:1550"));
  assert.ok(setup.calls.indexOf("overlay-restore") < setup.calls.indexOf("restore"));
});

test("does not capture the next viewport before the draw acknowledgement", async () => {
  let acknowledge;
  let entered;
  const drawing = new Promise((resolve) => { entered = resolve; });
  const setup = harness({ offscreenAdapter: {
    async drawSegment(payload) {
      if (payload.segmentIndex === 0) {
        entered();
        await new Promise((resolve) => { acknowledge = resolve; });
      }
      return { segmentIndex: payload.segmentIndex };
    }
  } });
  const running = setup.coordinator.run({ requestId: "request-1" });
  await drawing;
  assert.equal(setup.calls.filter((value) => value.startsWith("capture:")).length, 1);
  acknowledge();
  await running;
});

test("capture failure aborts the session, restores, clears, closes, and releases the lock", async () => {
  const setup = harness({ tabAdapter: {
    async captureVisibleTab() { throw new Error("capture failed"); }
  } });
  await assert.rejects(setup.coordinator.run({ requestId: "request-1" }),
    (error) => error.code === "CAPTURE_FAILED");
  assert.equal(setup.calls.includes("session-abort"), true);
  assert.equal(setup.calls.includes("restore"), true);
  assert.equal(setup.calls.includes("offscreen-close"), true);
  assert.equal(await setup.jobState.readActiveJob(), null);
});

test("a height change after canvas allocation fails as DYNAMIC_PAGE_UNSTABLE", async () => {
  let step = 0;
  const setup = harness({ pageAdapter: {
    async scrollStep(_tab, _request, payload) {
      step += 1;
      const height = step === 1 ? 120 : 130;
      return { identity, requestedY: payload.targetY, actualY: payload.targetY,
        clamped: false, documentHeightChanged: height !== 120, rawMeasurement: raw(height, payload.targetY) };
    }
  } });
  await assert.rejects(setup.coordinator.run({ requestId: "request-1" }),
    (error) => error.code === "DYNAMIC_PAGE_UNSTABLE");
  assert.equal(setup.calls.includes("session-abort"), true);
  assert.equal(setup.calls.includes("offscreen-close"), true);
});

test("cancellation during capture throttling prevents later captures and cleans up", async () => {
  let coordinator;
  let cancelled = false;
  const setup = harness({ onDelay() {
    if (!cancelled) {
      cancelled = true;
      coordinator.cancel("request-1");
    }
  } });
  coordinator = setup.coordinator;
  await assert.rejects(coordinator.run({ requestId: "request-1" }),
    (error) => error.code === "OPERATION_CANCELLED");
  assert.equal(setup.calls.filter((value) => value.startsWith("capture:")).length, 1);
  assert.equal(setup.calls.includes("page-cancel"), true);
  assert.equal(setup.calls.includes("session-abort"), true);
  assert.equal(setup.calls.includes("overlay-restore"), true);
  assert.equal(setup.calls.includes("offscreen-close"), true);
  assert.equal(await setup.jobState.readActiveJob(), null);
});

test("draw and encoding failures discard the partial result and complete cleanup", async () => {
  for (const method of ["drawSegment", "finishSession"]) {
    const code = method === "drawSegment" ? "SEGMENT_GAP_DETECTED" : "IMAGE_ENCODING_FAILED";
    const setup = harness({ offscreenAdapter: {
      async [method]() { throw { code, message: "Safe failure.", retryable: false, context: {} }; }
    } });
    await assert.rejects(setup.coordinator.run({ requestId: method }), (error) => error.code === code);
    assert.equal(setup.calls.includes("session-abort"), true);
    assert.equal(setup.calls.includes("restore"), true);
    assert.equal(setup.calls.includes("offscreen-close"), true);
    assert.equal(await setup.jobState.readActiveJob(), null);
  }
});

test("the shared lock rejects a concurrent full-page capture", async () => {
  let acknowledge;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const setup = harness({ offscreenAdapter: {
    async drawSegment(payload) {
      if (payload.segmentIndex === 0) {
        entered();
        await new Promise((resolve) => { acknowledge = resolve; });
      }
      return { segmentIndex: payload.segmentIndex };
    }
  } });
  const first = setup.coordinator.run({ requestId: "first" });
  await started;
  await assert.rejects(setup.coordinator.run({ requestId: "second" }),
    (error) => error.code === "CAPTURE_IN_PROGRESS");
  acknowledge();
  await first;
});

test("navigation and resize errors restore, close offscreen, and release the lock", async () => {
  for (const code of ["PAGE_CHANGED", "VIEWPORT_CHANGED"]) {
    const setup = harness({ pageAdapter: {
      async scrollStep() { throw { code, message: "Safe page failure.", retryable: false, context: {} }; }
    } });
    await assert.rejects(setup.coordinator.run({ requestId: code }), (error) => error.code === code);
    assert.equal(setup.calls.includes("restore"), true);
    assert.equal(setup.calls.includes("offscreen-close"), true);
    assert.equal(await setup.jobState.readActiveJob(), null);
  }
});

test("suppression can be disabled without page overlay calls or modifications", async () => {
  const setup = harness();
  const result = await setup.coordinator.run({
    requestId: "request-1",
    suppressOverlays: false
  });
  assert.equal(setup.calls.some((value) => value.startsWith("overlay-")), false);
  assert.deepEqual(result.overlayHandling, {
    enabled: false,
    detected: 0,
    suppressed: 0,
    restored: 0,
    restorationSucceeded: true,
    restorationApplicable: true
  });
});

test("reports detected, suppressed, and restored overlays after successful cleanup", async () => {
  let prepareCount = 0;
  const setup = harness({ pageAdapter: {
    async prepareOverlays(_tab, _request, payload) {
      prepareCount += 1;
      return {
        identity,
        candidates: [],
        detected: prepareCount === 1 ? 2 : 3,
        suppressed: payload.suppress ? 2 : 0,
        suppressionApplied: payload.suppress,
        rawMeasurement: raw(120, payload.expectedScrollY)
      };
    },
    async restoreOverlays() {
      return {
        identity,
        detected: 3,
        suppressed: 2,
        restored: 3,
        restorationSucceeded: true,
        applicable: true
      };
    }
  } });
  const result = await setup.coordinator.run({ requestId: "request-1" });
  assert.deepEqual(result.overlayHandling, {
    enabled: true,
    detected: 3,
    suppressed: 2,
    restored: 3,
    restorationSucceeded: true,
    restorationApplicable: true
  });
});

test("layout instability after suppression aborts and still restores overlays and scroll", async () => {
  const setup = harness({ pageAdapter: {
    async prepareOverlays(_tab, _request, payload) {
      return {
        identity,
        candidates: [],
        detected: 1,
        suppressed: payload.suppress ? 1 : 0,
        suppressionApplied: payload.suppress,
        rawMeasurement: raw(140, payload.expectedScrollY)
      };
    }
  } });
  await assert.rejects(
    setup.coordinator.run({ requestId: "request-1" }),
    (error) => error.code === "OVERLAY_SUPPRESSION_UNSTABLE"
  );
  assert.equal(setup.calls.includes("overlay-restore"), true);
  assert.equal(setup.calls.includes("restore"), true);
  assert.equal(await setup.jobState.readActiveJob(), null);
});

test("overlay restoration failure prevents a successful result and releases the lock", async () => {
  const setup = harness({ pageAdapter: {
    async restoreOverlays() {
      return {
        identity,
        detected: 1,
        suppressed: 1,
        restored: 0,
        restorationSucceeded: false,
        applicable: true
      };
    }
  } });
  await assert.rejects(
    setup.coordinator.run({ requestId: "request-1" }),
    (error) => error.code === "OVERLAY_RESTORATION_FAILED"
  );
  assert.equal(setup.calls.includes("restore"), true);
  assert.equal(setup.calls.includes("offscreen-close"), true);
  assert.equal(await setup.jobState.readActiveJob(), null);
});
