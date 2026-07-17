import assert from "node:assert/strict";
import test from "node:test";

import { createJobState } from "../src/background/job-state.js";
import { createSegmentedCaptureDiagnosticCoordinator } from "../src/background/segmented-capture-diagnostic.js";

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
  const calls = [];
  const jobState = createJobState(storage());
  const pageAdapter = {
    async inject() { calls.push("inject"); },
    async initialize() { calls.push("initialize"); return { identity, hostname: "example.com" }; },
    async measure() { calls.push("measure"); return { identity, rawMeasurement: raw() }; },
    async scrollStep(_tab, _request, payload) {
      calls.push(`scroll:${payload.targetY}`);
      return { identity, requestedY: payload.targetY, actualY: payload.targetY,
        clamped: false, documentHeightChanged: false, rawMeasurement: raw(120, payload.targetY) };
    },
    async cancel() { calls.push("page-cancel"); return { accepted: true }; },
    async restore() { calls.push("restore"); return { identity, actual: { x: 0, y: 0 }, withinTolerance: true, settled: true }; },
    ...overrides.pageAdapter
  };
  const tabAdapter = {
    async queryActiveTab() { calls.push("query"); return [{ id: 4, windowId: 8, url: "https://example.com" }]; },
    async captureVisibleTab() { calls.push(`capture:${clock}`); return JPEG; },
    ...overrides.tabAdapter
  };
  const offscreenAdapter = {
    async ensureDocument() { calls.push("offscreen-open"); },
    async startSession() { calls.push("session-start"); },
    async processSegment(payload) {
      calls.push(`process:${payload.segmentIndex}`);
      return { sessionId: payload.sessionId, segmentIndex: payload.segmentIndex,
        bitmap: { width: 200, height: 100 }, scale: { x: 2, y: 2 },
        estimatedBytes: payload.estimatedBytes, acknowledgedAt: clock };
    },
    async finishSession() { calls.push("session-finish"); },
    async abortSession() { calls.push("session-abort"); },
    async closeDocument() { calls.push("offscreen-close"); },
    ...overrides.offscreenAdapter
  };
  const releases = [];
  const coordinator = createSegmentedCaptureDiagnosticCoordinator({
    tabAdapter, pageAdapter, offscreenAdapter, jobState,
    now: () => clock,
    delay: async (ms) => { calls.push(`delay:${ms}`); clock += ms; overrides.onDelay?.(ms); },
    createJobId: () => overrides.jobId ?? "job-1",
    onSegmentReleased: (value) => { releases.push(value); calls.push(`release:${value.segmentIndex}`); }
  });
  return { calls, coordinator, jobState, releases, getClock: () => clock };
}

test("scrolls, captures, acknowledges, releases, and spaces every segment", async () => {
  const { calls, coordinator, jobState, releases } = harness();
  const result = await coordinator.run({ requestId: "request-1" });
  assert.equal(result.plannedSegmentCount, 3);
  assert.equal(result.capturedSegmentCount, 3);
  assert.equal(result.acknowledgedSegmentCount, 3);
  assert.deepEqual(result.captureIntervalsMs, [550, 550]);
  assert.deepEqual(releases, [{ segmentIndex: 0 }, { segmentIndex: 1 }, { segmentIndex: 2 }]);
  assert.ok(calls.indexOf("process:0") < calls.indexOf("release:0"));
  assert.ok(calls.indexOf("release:0") < calls.indexOf("capture:1550"));
  assert.equal(calls.filter((value) => value.startsWith("capture:")).length, 3);
  assert.equal(calls.at(-1), "offscreen-close");
  assert.equal(await jobState.readActiveJob(), null);
});

test("does not capture the next segment until acknowledgement resolves", async () => {
  let acknowledge;
  let entered;
  const processing = new Promise((resolve) => { entered = resolve; });
  const { calls, coordinator } = harness({ offscreenAdapter: {
    async processSegment(payload) {
      if (payload.segmentIndex === 0) {
        entered();
        await new Promise((resolve) => { acknowledge = resolve; });
      }
      return { sessionId: payload.sessionId, segmentIndex: payload.segmentIndex,
        bitmap: { width: 200, height: 100 }, scale: { x: 2, y: 2 },
        estimatedBytes: 3, acknowledgedAt: 1000 };
    }
  } });
  const running = coordinator.run({ requestId: "request-1" });
  await processing;
  assert.equal(calls.filter((value) => value.startsWith("capture:")).length, 1);
  acknowledge();
  await running;
});

test("capture, decode, and geometry failures abort, restore, close, and release the lock", async () => {
  for (const failure of ["capture", "decode", "geometry"]) {
    const options = failure === "capture"
      ? { tabAdapter: { async captureVisibleTab() { throw new Error("capture"); } } }
      : { offscreenAdapter: { async processSegment() {
        const code = failure === "decode" ? "SEGMENT_DECODE_FAILED" : "SEGMENT_GEOMETRY_CHANGED";
        throw { code, message: "Structured segment failure.", retryable: false, context: {} };
      } } };
    const { calls, coordinator, jobState } = harness(options);
    await assert.rejects(coordinator.run({ requestId: failure }));
    assert.equal(calls.includes("session-abort"), true);
    assert.equal(calls.includes("restore"), true);
    assert.equal(calls.includes("offscreen-close"), true);
    assert.equal(await jobState.readActiveJob(), null);
  }
});

test("cancellation during the throttle wait prevents the next capture", async () => {
  let coordinator;
  let cancelled = false;
  const setup = harness({ onDelay() {
    if (!cancelled) {
      cancelled = true;
      coordinator.cancel("request-1");
    }
  } });
  coordinator = setup.coordinator;
  await assert.rejects(
    coordinator.run({ requestId: "request-1" }),
    (error) => error.code === "OPERATION_CANCELLED"
  );
  assert.equal(setup.calls.filter((value) => value.startsWith("capture:")).length, 1);
  assert.equal(setup.calls.includes("page-cancel"), true);
  assert.equal(await setup.jobState.readActiveJob(), null);
});

test("cancellation after capture discards its data before offscreen processing", async () => {
  let coordinator;
  const setup = harness({ tabAdapter: {
    async captureVisibleTab() {
      coordinator.cancel("request-1");
      return JPEG;
    }
  } });
  coordinator = setup.coordinator;
  await assert.rejects(coordinator.run({ requestId: "request-1" }), (error) => error.code === "OPERATION_CANCELLED");
  assert.equal(setup.calls.some((value) => value.startsWith("process:")), false);
  assert.equal(setup.releases.length, 1);
});

test("dynamic, navigation, and resize failures use complete cleanup", async () => {
  let height = 120;
  const dynamic = harness({ pageAdapter: {
    async scrollStep(_tab, _request, payload) {
      height += 10;
      return { identity, requestedY: payload.targetY, actualY: payload.targetY,
        clamped: false, documentHeightChanged: true, rawMeasurement: raw(height, payload.targetY) };
    }
  } });
  await assert.rejects(dynamic.coordinator.run({ requestId: "dynamic" }), (error) => error.code === "DYNAMIC_PAGE_UNSTABLE");
  assert.equal(dynamic.calls.includes("session-abort"), true);
  assert.equal(await dynamic.jobState.readActiveJob(), null);

  const navigation = harness({ pageAdapter: {
    async scrollStep() { throw { code: "PAGE_CHANGED", message: "The page changed while the operation was running.", retryable: false, context: {} }; }
  } });
  await assert.rejects(navigation.coordinator.run({ requestId: "navigation" }), (error) => error.code === "PAGE_CHANGED");
  assert.equal(navigation.calls.includes("restore"), true);
  assert.equal(navigation.calls.includes("offscreen-close"), true);

  const resize = harness({ pageAdapter: {
    async scrollStep() { throw { code: "VIEWPORT_CHANGED", message: "The browser viewport changed during the diagnostic.", retryable: false, context: {} }; }
  } });
  await assert.rejects(resize.coordinator.run({ requestId: "resize" }), (error) => error.code === "VIEWPORT_CHANGED");
  assert.equal(resize.calls.includes("session-abort"), true);
  assert.equal(await resize.jobState.readActiveJob(), null);
});

test("restoration failure is reported after session and lock cleanup", async () => {
  const setup = harness({ pageAdapter: {
    async restore() { return { identity, actual: { x: 0, y: 20 }, withinTolerance: false, settled: true }; }
  } });
  await assert.rejects(
    setup.coordinator.run({ requestId: "restore-failure" }),
    (error) => error.code === "RESTORATION_FAILED"
  );
  assert.equal(setup.calls.includes("offscreen-close"), true);
  assert.equal(await setup.jobState.readActiveJob(), null);
});

test("shared job lock rejects a concurrent segmented diagnostic", async () => {
  let release;
  let entered;
  let processCount = 0;
  const started = new Promise((resolve) => { entered = resolve; });
  const setup = harness({ offscreenAdapter: {
    async processSegment(payload) {
      processCount += 1;
      if (processCount === 1) {
        entered();
        await new Promise((resolve) => { release = resolve; });
      }
      return { sessionId: payload.sessionId, segmentIndex: payload.segmentIndex,
        bitmap: { width: 200, height: 100 }, scale: { x: 2, y: 2 }, estimatedBytes: 3, acknowledgedAt: 1000 };
    }
  } });
  const first = setup.coordinator.run({ requestId: "first" });
  await started;
  await assert.rejects(setup.coordinator.run({ requestId: "second" }), (error) => error.code === "CAPTURE_IN_PROGRESS");
  release();
  await first;
});
