import assert from "node:assert/strict";
import test from "node:test";
import { createVerticalScrollPlan } from "../src/shared/scroll-plan.js";
import { ERROR_CODES } from "../src/shared/errors.js";

const plan = (viewportHeight, documentHeight, maximumScrollY = Math.max(0, documentHeight - viewportHeight), maximumSteps) =>
  createVerticalScrollPlan({ viewportHeight, documentHeight, maximumScrollY, ...(maximumSteps ? { maximumSteps } : {}) });

test("handles shorter, equal, exact-multiple, and partial pages", () => {
  assert.deepEqual(plan(800, 600), [0]);
  assert.deepEqual(plan(800, 800), [0]);
  assert.deepEqual(plan(800, 2400), [0, 800, 1600]);
  assert.deepEqual(plan(800, 2100), [0, 800, 1300]);
});
test("removes duplicate final targets and returns sorted bounded output", () => {
  assert.deepEqual(plan(800, 1600), [0, 800]);
  const value = plan(300, 1000);
  assert.deepEqual(value, [...value].sort((a, b) => a - b));
  assert.equal(value.every((item) => item >= 0 && item <= 700), true);
});
test("rejects zero viewport, negative input, and excessive plans", () => {
  assert.throws(() => plan(0, 100));
  assert.throws(() => plan(100, -1));
  assert.throws(() => plan(100, 1000, 900, 3), (error) => error.code === ERROR_CODES.SCROLL_PLAN_TOO_LARGE);
});
