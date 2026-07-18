import assert from "node:assert/strict";
import test from "node:test";

import { createDriveLocalState } from "../src/background/drive-local-state.js";
import { STORAGE_KEYS } from "../src/shared/constants.js";

function localStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
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

test("explicit disconnect stores only a local boolean and reconnect removes it", async () => {
  const storage = localStorage();
  const state = createDriveLocalState({ storage });

  await state.setExplicitlyDisconnected(true);
  assert.deepEqual(
    Object.fromEntries(storage.values),
    { [STORAGE_KEYS.DRIVE_EXPLICITLY_DISCONNECTED]: true }
  );
  assert.equal(await state.isExplicitlyDisconnected(), true);

  await state.setExplicitlyDisconnected(false);
  assert.deepEqual(Object.fromEntries(storage.values), {});
  assert.equal(await state.isExplicitlyDisconnected(), false);
});

test("malformed explicit-disconnect state is removed and treated as disconnected false", async () => {
  const storage = localStorage({
    [STORAGE_KEYS.DRIVE_EXPLICITLY_DISCONNECTED]: {
      token: "must-not-be-preserved",
      email: "must-not-be-preserved"
    }
  });
  const state = createDriveLocalState({ storage });

  assert.equal(await state.isExplicitlyDisconnected(), false);
  assert.deepEqual(Object.fromEntries(storage.values), {});
});

test("local Drive state storage failures return a structured application error", async () => {
  const failure = new Error("storage failed");
  const state = createDriveLocalState({
    storage: {
      async get() { throw failure; },
      async set() { throw failure; },
      async remove() { throw failure; }
    }
  });

  await assert.rejects(
    state.isExplicitlyDisconnected(),
    (error) => error.code === "DRIVE_LOCAL_STATE_FAILED"
  );
  await assert.rejects(
    state.setExplicitlyDisconnected(true),
    (error) => error.code === "DRIVE_LOCAL_STATE_FAILED"
  );
});
