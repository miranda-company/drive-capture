import assert from "node:assert/strict";
import test from "node:test";

import { createJobState } from "../src/background/job-state.js";
import {
  createVisibleViewportCaptureCoordinator
} from "../src/background/visible-viewport-capture.js";
import { ERROR_CODES, validateApplicationError } from "../src/shared/errors.js";

const JPEG_DATA_URL = "data:image/jpeg;base64,TWFu";

function createMemoryStorage() {
  const values = new Map();
  return {
    async get(key) {
      return values.has(key) ? { [key]: structuredClone(values.get(key)) } : {};
    },
    async set(entries) {
      for (const [key, value] of Object.entries(entries)) {
        values.set(key, structuredClone(value));
      }
    },
    async remove(key) {
      values.delete(key);
    }
  };
}

function createHarness(overrides = {}) {
  const calls = [];
  const storage = createMemoryStorage();
  const jobState = createJobState(storage);
  const tabAdapter = {
    async queryActiveTab() {
      calls.push({ operation: "query" });
      return [{ id: 4, windowId: 8, url: "https://example.com/page" }];
    },
    async captureVisibleTab(windowId, options) {
      calls.push({ operation: "capture", windowId, options });
      return JPEG_DATA_URL;
    },
    ...overrides
  };
  let id = 0;
  const coordinator = createVisibleViewportCaptureCoordinator({
    tabAdapter,
    jobState,
    now: () => 1_700_000_000_000,
    createJobId: () => `capture-${++id}`
  });

  return { calls, coordinator, jobState };
}

test("captures exactly once with the active window ID and JPEG quality 92", async () => {
  const { calls, coordinator } = createHarness();
  const result = await coordinator.captureVisibleViewport();
  const captureCalls = calls.filter((call) => call.operation === "capture");

  assert.equal(captureCalls.length, 1);
  assert.deepEqual(captureCalls[0], {
    operation: "capture",
    windowId: 8,
    options: { format: "jpeg", quality: 92 }
  });
  assert.equal(result.mode, "visible-viewport");
  assert.equal(result.mimeType, "image/jpeg");
  assert.equal(result.estimatedBytes, 3);
});

test("acquires and releases the session-backed lock on success", async () => {
  const { coordinator, jobState } = createHarness();
  await coordinator.captureVisibleViewport();
  assert.equal(await jobState.readActiveJob(), null);
});

test("releases the lock after a capture failure", async () => {
  const { coordinator, jobState } = createHarness({
    async captureVisibleTab() {
      throw new Error("browser capture failed");
    }
  });

  await assert.rejects(
    coordinator.captureVisibleViewport(),
    (error) => validateApplicationError(error) && error.code === ERROR_CODES.CAPTURE_FAILED
  );
  assert.equal(await jobState.readActiveJob(), null);
});

test("rejects a concurrent capture", async () => {
  let releaseCapture;
  let captureStarted;
  const captureEntered = new Promise((resolve) => {
    captureStarted = resolve;
  });
  const { coordinator } = createHarness({
    async captureVisibleTab() {
      captureStarted();
      return new Promise((resolve) => {
        releaseCapture = () => resolve(JPEG_DATA_URL);
      });
    }
  });

  const firstCapture = coordinator.captureVisibleViewport();
  await captureEntered;
  await assert.rejects(
    coordinator.captureVisibleViewport(),
    (error) =>
      validateApplicationError(error) && error.code === ERROR_CODES.CAPTURE_IN_PROGRESS
  );
  releaseCapture();
  await firstCapture;
});

test("prevents capture when the active page is unsupported", async () => {
  let captureCalls = 0;
  const { coordinator } = createHarness({
    async queryActiveTab() {
      return [{ id: 4, windowId: 8, url: "chrome://extensions" }];
    },
    async captureVisibleTab() {
      captureCalls += 1;
      return JPEG_DATA_URL;
    }
  });

  await assert.rejects(
    coordinator.captureVisibleViewport(),
    (error) => error.code === ERROR_CODES.UNSUPPORTED_PAGE
  );
  assert.equal(captureCalls, 0);
});

test("rejects a malformed capture response", async () => {
  const { coordinator } = createHarness({
    async captureVisibleTab() {
      return "data:image/png;base64,TWFu";
    }
  });

  await assert.rejects(
    coordinator.captureVisibleViewport(),
    (error) => error.code === ERROR_CODES.INVALID_CAPTURE_RESULT
  );
});

test("converts adapter failures to structured application errors", async () => {
  const { coordinator } = createHarness({
    async queryActiveTab() {
      throw new Error("private browser failure");
    }
  });

  await assert.rejects(
    coordinator.captureVisibleViewport(),
    (error) => validateApplicationError(error) && error.code === ERROR_CODES.CAPTURE_FAILED
  );
});

test("reports lock release failure without screenshot data", async () => {
  const coordinator = createVisibleViewportCaptureCoordinator({
    tabAdapter: {
      async queryActiveTab() {
        return [{ id: 4, windowId: 8, url: "https://example.com" }];
      },
      async captureVisibleTab() {
        return JPEG_DATA_URL;
      }
    },
    jobState: {
      async acquireJobLock() {},
      async releaseJobLock() {
        throw new Error("storage failure");
      }
    },
    now: () => 1_700_000_000_000,
    createJobId: () => "capture-1"
  });

  await assert.rejects(coordinator.captureVisibleViewport(), (error) => {
    assert.equal(error.code, ERROR_CODES.INTERNAL_ERROR);
    assert.equal(JSON.stringify(error).includes(JPEG_DATA_URL), false);
    return true;
  });
});
