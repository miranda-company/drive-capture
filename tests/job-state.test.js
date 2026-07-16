import assert from "node:assert/strict";
import test from "node:test";

import { createJobState } from "../src/background/job-state.js";
import { STORAGE_KEYS } from "../src/shared/constants.js";
import { ERROR_CODES, validateApplicationError } from "../src/shared/errors.js";

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));

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
    },
    has(key) {
      return values.has(key);
    }
  };
}

const JOB = Object.freeze({
  id: "job-1",
  tabId: 123,
  phase: "scaffold-test",
  startedAt: 1_234_567_890
});

test("acquires and reads a job lock", async () => {
  const jobs = createJobState(createMemoryStorage());

  assert.deepEqual(await jobs.acquireJobLock(JOB), JOB);
  assert.deepEqual(await jobs.readActiveJob(), JOB);
});

test("rejects a second lock with CAPTURE_IN_PROGRESS", async () => {
  const jobs = createJobState(createMemoryStorage());
  await jobs.acquireJobLock(JOB);

  await assert.rejects(
    jobs.acquireJobLock({ ...JOB, id: "job-2" }),
    (error) =>
      validateApplicationError(error) && error.code === ERROR_CODES.CAPTURE_IN_PROGRESS
  );
});

test("updates the active job phase", async () => {
  const jobs = createJobState(createMemoryStorage());
  await jobs.acquireJobLock(JOB);

  const updated = await jobs.updateJobPhase(JOB.id, "offscreen-ping");
  assert.equal(updated.phase, "offscreen-ping");
  assert.equal((await jobs.readActiveJob()).phase, "offscreen-ping");
});

test("releases the matching job lock", async () => {
  const jobs = createJobState(createMemoryStorage());
  await jobs.acquireJobLock(JOB);

  assert.equal(await jobs.releaseJobLock(JOB.id), true);
  assert.equal(await jobs.readActiveJob(), null);
});

test("removes malformed stored job state safely", async () => {
  const storage = createMemoryStorage({
    [STORAGE_KEYS.ACTIVE_JOB]: { ...JOB, accessToken: "must-not-be-stored" }
  });
  const jobs = createJobState(storage);

  assert.equal(await jobs.readActiveJob(), null);
  assert.equal(storage.has(STORAGE_KEYS.ACTIVE_JOB), false);
});

test("converts storage failures into a structured error", async () => {
  const jobs = createJobState({
    async get() {
      throw new Error("storage unavailable");
    },
    async set() {},
    async remove() {}
  });

  await assert.rejects(
    jobs.readActiveJob(),
    (error) => validateApplicationError(error) && error.code === ERROR_CODES.INTERNAL_ERROR
  );
});
