import assert from "node:assert/strict";
import test from "node:test";
import { createJobState } from "../src/background/job-state.js";
import { createPageScrollDiagnosticCoordinator } from "../src/background/page-scroll-diagnostic.js";
import { ERROR_CODES } from "../src/shared/errors.js";

const identity = { hrefFingerprint: "deadbeef", timeOrigin: 123, documentElementReferenceVersion: 1 };
const raw = (height = 2100, y = 0, viewportHeight = 800) => ({
  innerWidth: 1000, innerHeight: viewportHeight, scrollX: 0, scrollY: y, devicePixelRatio: 2,
  documentElementScrollWidth: 1000, documentElementScrollHeight: height,
  bodyScrollWidth: 1000, bodyScrollHeight: height, scrollingElementKind: "document-element"
});
function storage() {
  const map = new Map();
  return { async get(k) { return map.has(k) ? { [k]: structuredClone(map.get(k)) } : {}; },
    async set(v) { for (const [k, x] of Object.entries(v)) map.set(k, structuredClone(x)); },
    async remove(k) { map.delete(k); } };
}
function harness(custom = {}) {
  const calls = [];
  const jobState = createJobState(storage());
  let currentHeight = 2100;
  const pageAdapter = {
    async inject() { calls.push("inject"); },
    async initialize() { calls.push("initialize"); return { identity, hostname: "example.com" }; },
    async measure() { calls.push("measure"); return { identity, rawMeasurement: raw(currentHeight) }; },
    async scrollStep(_tab, _request, payload) {
      calls.push(payload.targetY);
      return { identity, requestedY: payload.targetY, actualY: payload.targetY, clamped: false,
        documentHeightChanged: false, rawMeasurement: raw(currentHeight, payload.targetY) };
    },
    async restore() { calls.push("restore"); return { identity, actual: { x: 0, y: 0 }, withinTolerance: true, settled: true }; },
    ...custom
  };
  let clock = 100;
  const coordinator = createPageScrollDiagnosticCoordinator({
    tabAdapter: { async queryActiveTab() { return [{ id: 1, windowId: 2, url: "https://example.com" }]; } },
    pageAdapter, jobState, now: () => ++clock, createJobId: () => "job"
  });
  return { coordinator, calls, jobState, setHeight: (h) => { currentHeight = h; } };
}

test("initializes, visits steps in order, reports progress, and restores", async () => {
  const { coordinator, calls, jobState } = harness();
  const progress = [];
  const result = await coordinator.run({ requestId: "request", onProgress: (value) => progress.push(value) });
  assert.deepEqual(result.plannedPositions, [0, 800, 1300]);
  assert.deepEqual(result.steps.map((step) => step.actualY), [0, 800, 1300]);
  assert.equal(calls.at(-1), "restore");
  assert.equal(progress.some((item) => item.state === "scrolling"), true);
  assert.equal(await jobState.readActiveJob(), null);
});
test("records a clamped actual position", async () => {
  const { coordinator } = harness({ async scrollStep(_t, _r, payload) {
    return { identity, requestedY: payload.targetY, actualY: Math.max(0, payload.targetY - 5), clamped: payload.targetY > 0,
      documentHeightChanged: false, rawMeasurement: raw(2100, Math.max(0, payload.targetY - 5)) };
  } });
  const result = await coordinator.run({ requestId: "request" });
  assert.equal(result.steps.some((step) => step.clamped), true);
});
test("revises a dynamically growing plan within bounds", async () => {
  let count = 0;
  const { coordinator } = harness({ async scrollStep(_t, _r, payload) {
    count += 1; const height = count === 1 ? 2500 : 2500;
    return { identity, requestedY: payload.targetY, actualY: payload.targetY, clamped: false,
      documentHeightChanged: count === 1, rawMeasurement: raw(height, payload.targetY) };
  } });
  const result = await coordinator.run({ requestId: "request" });
  assert.equal(result.revisionCount, 1);
  assert.equal(result.plannedPositions.at(-1), 1700);
});
test("aborts an endlessly growing page and restores", async () => {
  let height = 2100;
  const calls = [];
  const { coordinator, jobState } = harness({ async scrollStep(_t, _r, payload) {
    height += 100; return { identity, requestedY: payload.targetY, actualY: payload.targetY, clamped: false,
      documentHeightChanged: true, rawMeasurement: raw(height, payload.targetY) };
  }, async restore() { calls.push("restore"); return { identity, actual: { x: 0, y: 0 }, withinTolerance: true, settled: true }; } });
  await assert.rejects(coordinator.run({ requestId: "request" }), (error) => error.code === ERROR_CODES.DYNAMIC_PAGE_UNSTABLE);
  assert.deepEqual(calls, ["restore"]);
  assert.equal(await jobState.readActiveJob(), null);
});
test("restores after page, resize, and scroll failures", async () => {
  for (const code of [ERROR_CODES.PAGE_CHANGED, ERROR_CODES.VIEWPORT_CHANGED, ERROR_CODES.SCROLL_UNSTABLE]) {
    let restored = false;
    const { coordinator } = harness({ async scrollStep() { throw { code, message: "safe", retryable: false, context: {} }; },
      async restore() { restored = true; return { identity, actual: { x: 0, y: 0 }, withinTolerance: true, settled: true }; } });
    await assert.rejects(coordinator.run({ requestId: code }), (error) => error.code === code);
    assert.equal(restored, true);
  }
});
test("cancels, restores, rejects shared lock concurrency, and releases every outcome", async () => {
  let release;
  const entered = new Promise((resolve) => { release = resolve; });
  let continueStep;
  const { coordinator, jobState, calls } = harness({ async scrollStep(_t, _r, payload) {
    release(); await new Promise((resolve) => { continueStep = resolve; });
    return { identity, requestedY: payload.targetY, actualY: payload.targetY, clamped: false, documentHeightChanged: false, rawMeasurement: raw(2100, payload.targetY) };
  } });
  const first = coordinator.run({ requestId: "first" });
  await entered;
  await assert.rejects(coordinator.run({ requestId: "second" }), (error) => error.code === ERROR_CODES.CAPTURE_IN_PROGRESS);
  assert.equal(coordinator.cancel("first"), true);
  continueStep();
  await assert.rejects(first, (error) => error.code === ERROR_CODES.OPERATION_CANCELLED);
  assert.equal(calls.includes("restore"), true);
  assert.equal(await jobState.readActiveJob(), null);
});
test("turns restoration failure into a cleanup error", async () => {
  const { coordinator } = harness({ async restore() { return { identity, actual: { x: 0, y: 50 }, withinTolerance: false, settled: true }; } });
  await assert.rejects(coordinator.run({ requestId: "request" }), (error) => error.code === ERROR_CODES.RESTORATION_FAILED);
});
