import assert from "node:assert/strict";
import test from "node:test";

import { createDriveUploadCoordinator } from "../src/background/drive-upload-coordinator.js";
import { DriveRequestError } from "../src/background/google-drive-client.js";
import { createJobState } from "../src/background/job-state.js";
import { createSafeUploadStatus } from "../src/shared/drive-upload.js";
import { createApplicationError } from "../src/shared/errors.js";

function sessionStorage() {
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
    async remove(key) { values.delete(key); }
  };
}

const sessionUrl =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=session-1";
const readiness = {
  available: true,
  resultId: "result-1",
  previewUrl: "blob:preview",
  filename: "DriveCapture_Test.jpg",
  filenameSource: "custom",
  mimeType: "image/jpeg",
  blobSize: 123,
  encodedBytes: 123,
  pixelWidth: 100,
  pixelHeight: 200,
  validJpegSignature: true,
  uploaded: false
};
const file = {
  id: "file-1",
  name: readiness.filename,
  mimeType: "image/jpeg",
  size: String(readiness.blobSize),
  createdTime: "2026-07-18T12:00:00.000Z",
  parents: ["folder-1"],
  webViewLink: "https://drive.google.com/file/d/file-1/view",
  md5Checksum: "0123456789abcdef0123456789abcdef",
  appProperties: {
    drivecaptureScreenshot: "true",
    drivecaptureSchema: "1"
  }
};

function setup(overrides = {}) {
  const calls = [];
  const tokens = [];
  let stored = createSafeUploadStatus({ state: "idle", updatedAt: 1000 });
  let disconnected = overrides.disconnected ?? false;
  const jobState = overrides.jobState ?? createJobState(sessionStorage());
  const auth = {
    async acquireToken({ interactive }) {
      calls.push(`token:${interactive}`);
      const token = { token: `token-${tokens.length}`, grantedScopeConfirmed: true };
      tokens.push(token);
      return token;
    },
    async removeToken(token) { calls.push(`remove:${token}`); },
    ...overrides.auth
  };
  const driveClient = {
    async requestJson(parameters) {
      calls.push(`drive:${parameters.operation}:${parameters.token}`);
      return {};
    },
    ...overrides.driveClient
  };
  const managedFolder = {
    async ensure(request) {
      calls.push("ensure-folder");
      if (overrides.performFolderRequest) {
        await request({ operation: "get-folder", folderId: "folder-1" });
      }
      return { folder: { id: "folder-1", name: "DriveCapture" }, source: "cached" };
    },
    ...overrides.managedFolder
  };
  const localState = {
    async isExplicitlyDisconnected() {
      calls.push("read-disconnect");
      return disconnected;
    },
    ...overrides.localState
  };
  const uploadSession = {
    async start(parameters) {
      calls.push(`start-session:${parameters.token}`);
      return { uploadSessionUrl: sessionUrl };
    },
    ...overrides.uploadSession
  };
  const offscreen = {
    async ensureDocument() { calls.push("ensure-offscreen"); },
    async readiness(resultId) {
      calls.push(`readiness:${resultId ?? "current"}`);
      return readiness;
    },
    async start(payload) {
      calls.push(`upload-blob:${payload.resultId}`);
      return { completed: true, file, statusQueryCount: 0 };
    },
    async markUploaded(payload) {
      calls.push(`mark-uploaded:${payload.resultId}`);
      return { resultId: payload.resultId, uploaded: true };
    },
    async cancel(payload) {
      calls.push(`cancel:${payload.resultId}`);
      return { accepted: true };
    },
    ...overrides.offscreen
  };
  const uploadState = {
    async read() { return structuredClone(stored); },
    async write(value) {
      stored = structuredClone(value);
      calls.push(`state:${value.state}`);
      return value;
    },
    async clear() {
      calls.push("state:clear");
      stored = createSafeUploadStatus({ state: "idle", updatedAt: 1000 });
    },
    ...overrides.uploadState
  };
  const coordinator = createDriveUploadCoordinator({
    auth,
    driveClient,
    managedFolder,
    localState,
    uploadSession,
    offscreen,
    uploadState,
    jobState,
    now: () => 1000,
    createJobId: () => "upload-job"
  });
  return {
    coordinator,
    calls,
    tokens,
    jobState,
    status: () => stored,
    setDisconnected: (value) => { disconnected = value; }
  };
}

test("uploads successfully after readiness, auth, folder validation, and session creation", async () => {
  const value = setup({ performFolderRequest: true });
  const status = await value.coordinator.start({ resultId: "result-1" });

  assert.equal(status.state, "successful");
  assert.equal(status.result.filename, readiness.filename);
  assert.equal(status.result.size, readiness.blobSize);
  assert.equal("id" in status.result, false);
  assert.equal("parents" in status.result, false);
  assert.equal(JSON.stringify(status).includes(sessionUrl), false);
  assert.equal(JSON.stringify(status).includes("token-0"), false);
  assert.equal(value.calls.indexOf("ensure-folder") <
    value.calls.indexOf("start-session:token-0"), true);
  assert.equal(value.calls.indexOf("start-session:token-0") <
    value.calls.indexOf("upload-blob:result-1"), true);
  assert.equal(value.tokens[0].token, "");
  assert.equal(await value.jobState.readActiveJob(), null);
});

test("rejects missing, invalid, and already uploaded local results before OAuth", async () => {
  for (const returned of [
    { available: false },
    { ...readiness, validJpegSignature: false },
    { ...readiness, uploaded: true }
  ]) {
    const value = setup({
      offscreen: { async readiness() { return returned; } }
    });
    await assert.rejects(
      value.coordinator.start({ resultId: "result-1" }),
      (error) => ["UPLOAD_RESULT_UNAVAILABLE", "UPLOAD_ALREADY_COMPLETED"]
        .includes(error.code)
    );
    assert.equal(value.calls.some((call) => call.startsWith("token:")), false);
    assert.equal(await value.jobState.readActiveJob(), null);
  }
});

test("explicit Disconnect blocks upload without token, folder, or session access", async () => {
  const value = setup({ disconnected: true });
  await assert.rejects(
    value.coordinator.start({ resultId: "result-1" }),
    (error) => error.code === "AUTH_REQUIRED"
  );
  assert.equal(value.calls.some((call) => call.startsWith("token:")), false);
  assert.equal(value.calls.includes("ensure-folder"), false);
  assert.equal(value.calls.some((call) => call.startsWith("start-session:")), false);
});

test("non-interactive auth and folder failures stop before session creation", async () => {
  const authRequired = setup({
    auth: {
      async acquireToken({ interactive }) {
        assert.equal(interactive, false);
        throw { code: "AUTH_REQUIRED" };
      }
    }
  });
  await assert.rejects(authRequired.coordinator.start({ resultId: "result-1" }),
    (error) => error.code === "AUTH_REQUIRED");

  const folderFailed = setup({
    managedFolder: {
      async ensure() { throw { code: "DRIVE_FOLDER_INVALID" }; }
    }
  });
  await assert.rejects(folderFailed.coordinator.start({ resultId: "result-1" }),
    (error) => error.code === "DRIVE_FOLDER_INVALID");
  assert.equal(folderFailed.calls.some((call) => call.startsWith("start-session:")), false);
});

test("session creation retries one 401 non-interactively and never prompts", async () => {
  let sessions = 0;
  const value = setup({
    uploadSession: {
      async start(parameters) {
        value.calls.push(`start-session:${parameters.token}`);
        sessions += 1;
        if (sessions === 1) throw new DriveRequestError(401);
        return { uploadSessionUrl: sessionUrl };
      }
    }
  });
  await value.coordinator.start({ resultId: "result-1" });
  assert.equal(sessions, 2);
  assert.deepEqual(value.calls.filter((call) => call.startsWith("token:")),
    ["token:false", "token:false"]);
  assert.equal(value.calls.filter((call) => call.startsWith("remove:")).length, 1);
});

test("a repeated session 401 fails AUTH_REQUIRED after exactly two attempts", async () => {
  let sessions = 0;
  const value = setup({
    uploadSession: {
      async start() {
        sessions += 1;
        throw new DriveRequestError(401);
      }
    }
  });
  await assert.rejects(
    value.coordinator.start({ resultId: "result-1" }),
    (error) => error.code === "AUTH_REQUIRED"
  );
  assert.equal(sessions, 2);
  assert.equal(value.calls.filter((call) => call.startsWith("token:")).length, 2);
});

test("shared lock prevents duplicate sessions and blocks capture while uploading", async () => {
  let release;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const value = setup({
    offscreen: {
      async start() {
        entered();
        return new Promise((resolve) => { release = () => resolve({
          completed: true,
          file,
          statusQueryCount: 0
        }); });
      }
    }
  });
  const running = value.coordinator.start({ resultId: "result-1" });
  await started;
  await assert.rejects(
    value.coordinator.start({ resultId: "result-1" }),
    (error) => error.code === "UPLOAD_BUSY"
  );
  await assert.rejects(
    value.jobState.acquireJobLock({
      id: "capture",
      tabId: 1,
      phase: "capture",
      startedAt: 2
    }),
    (error) => error.code === "CAPTURE_IN_PROGRESS"
  );
  release();
  await running;
  assert.equal(value.calls.filter((call) => call.startsWith("start-session:")).length, 1);
});

test("an existing capture lock blocks upload before session creation", async () => {
  const value = setup();
  await value.jobState.acquireJobLock({
    id: "capture",
    tabId: 1,
    phase: "capture",
    startedAt: 1
  });
  await assert.rejects(
    value.coordinator.start({ resultId: "result-1" }),
    (error) => error.code === "UPLOAD_BUSY"
  );
  assert.equal(value.calls.some((call) => call.startsWith("start-session:")), false);
  await value.jobState.releaseJobLock("capture");
});

test("cancellation reaches offscreen and every failure releases the lock", async () => {
  let rejectUpload;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const value = setup({
    offscreen: {
      async start() {
        entered();
        return new Promise((_resolve, reject) => { rejectUpload = reject; });
      },
      async cancel(payload) {
        value.calls.push(`cancel:${payload.resultId}`);
        rejectUpload(createApplicationError({ code: "UPLOAD_ABORTED" }));
        return { accepted: true };
      }
    }
  });
  const running = value.coordinator.start({ resultId: "result-1" });
  await started;
  assert.deepEqual(
    await value.coordinator.cancel({ resultId: "result-1" }),
    { accepted: true }
  );
  await assert.rejects(running, (error) => error.code === "UPLOAD_ABORTED");
  assert.equal(value.status().state, "cancelled");
  assert.equal(await value.jobState.readActiveJob(), null);

  const failed = setup({
    offscreen: {
      async start() {
        throw createApplicationError({ code: "UPLOAD_NETWORK_ERROR" });
      }
    }
  });
  await assert.rejects(failed.coordinator.start({ resultId: "result-1" }));
  assert.equal(await failed.jobState.readActiveJob(), null);
});

test("status survives popup reopening safely and clearing removes no Drive file", async () => {
  const value = setup();
  await value.coordinator.start({ resultId: "result-1" });
  const reopened = await value.coordinator.status();
  assert.equal(reopened.state, "successful");
  assert.equal(reopened.result.filename, readiness.filename);
  assert.equal(value.calls.some((call) => call.includes("delete")), false);

  await value.coordinator.clearStatus();
  assert.equal(value.status().state, "idle");
  assert.equal(value.calls.some((call) => call.startsWith("drive:delete")), false);
});
