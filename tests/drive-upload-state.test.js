import assert from "node:assert/strict";
import test from "node:test";

import { createDriveUploadState } from "../src/background/drive-upload-state.js";
import { STORAGE_KEYS } from "../src/shared/constants.js";
import { createSafeUploadStatus } from "../src/shared/drive-upload.js";

function storageArea(initial = {}) {
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
    async remove(key) { values.delete(key); }
  };
}

test("stores only a safe session status without upload secrets or raw IDs", async () => {
  const storage = storageArea();
  const state = createDriveUploadState({ storage });
  const status = createSafeUploadStatus({
    state: "uploading",
    resultId: "result-1",
    updatedAt: 1000
  });
  await state.write(status);
  const stored = storage.values.get(STORAGE_KEYS.DRIVE_UPLOAD_STATUS);
  assert.deepEqual(stored, status);
  for (const forbidden of [
    "token",
    "uploadSessionUrl",
    "blob",
    "dataUrl",
    "previewUrl",
    "fileId",
    "folderId",
    "authorization",
    "email"
  ]) assert.equal(JSON.stringify(stored).includes(forbidden), false);
});

test("removes malformed session status and storage failures are structured", async () => {
  const storage = storageArea({
    [STORAGE_KEYS.DRIVE_UPLOAD_STATUS]: {
      state: "uploading",
      uploadSessionUrl: "https://sensitive"
    }
  });
  const state = createDriveUploadState({ storage });
  assert.equal((await state.read()).state, "idle");
  assert.equal(storage.values.has(STORAGE_KEYS.DRIVE_UPLOAD_STATUS), false);

  const failed = createDriveUploadState({
    storage: {
      async get() { throw new Error("fail"); },
      async set() { throw new Error("fail"); },
      async remove() { throw new Error("fail"); }
    }
  });
  await assert.rejects(failed.read(), (error) => error.code === "UPLOAD_STATE_FAILED");
  await assert.rejects(
    failed.write(createSafeUploadStatus({ state: "idle", updatedAt: 1 })),
    (error) => error.code === "UPLOAD_STATE_FAILED"
  );
});
