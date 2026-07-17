import assert from "node:assert/strict";
import test from "node:test";

import { createDriveSetupCoordinator } from "../src/background/drive-setup-coordinator.js";
import { DriveRequestError } from "../src/background/google-drive-client.js";
import { createJobState } from "../src/background/job-state.js";

function sessionStorage() {
  const values = new Map();
  return {
    async get(key) { return values.has(key) ? { [key]: structuredClone(values.get(key)) } : {}; },
    async set(entries) { for (const [key, value] of Object.entries(entries)) values.set(key, structuredClone(value)); },
    async remove(key) { values.delete(key); }
  };
}

const folderResult = {
  folder: { name: "DriveCapture" },
  source: "created",
  duplicateCount: 0
};

function setup(overrides = {}) {
  const calls = [];
  const tokens = [];
  const jobState = createJobState(sessionStorage());
  const auth = {
    configuration: () => ({ configured: true }),
    async acquireToken({ interactive }) {
      calls.push(`token:${interactive}`);
      const value = { token: `token-${tokens.length}`, grantedScopeConfirmed: true };
      tokens.push(value);
      return value;
    },
    async removeToken(token) { calls.push(`remove:${token}`); },
    async disconnect() { calls.push("disconnect"); },
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
      calls.push("ensure");
      if (overrides.performRequest) await request({ operation: "list-folders" });
      return folderResult;
    },
    async clearCache() { calls.push("clear-cache"); },
    ...overrides.managedFolder
  };
  const coordinator = createDriveSetupCoordinator({
    auth, driveClient, managedFolder, jobState,
    now: () => 1000, createJobId: () => "drive-job"
  });
  return { coordinator, calls, tokens, jobState };
}

test("status is non-interactive and prompt-required is a normal not-connected result", async () => {
  const connected = setup();
  assert.equal((await connected.coordinator.status()).status, "connected");
  assert.deepEqual(connected.calls, ["token:false"]);
  const disconnected = setup({
    auth: { async acquireToken() { throw { code: "AUTH_REQUIRED" }; } }
  });
  assert.equal((await disconnected.coordinator.status()).status, "not-connected");
});

test("not-configured status performs no token request", async () => {
  const value = setup({ auth: { configuration: () => ({ configured: false }) } });
  assert.equal((await value.coordinator.status()).status, "not-configured");
  assert.deepEqual(value.calls, []);
});

test("connect alone uses interactive auth and returns no token or folder ID", async () => {
  const value = setup();
  const result = await value.coordinator.connect();
  assert.equal(value.calls[0], "token:true");
  assert.equal(JSON.stringify(result).includes("token-"), false);
  assert.equal(JSON.stringify(result).includes("folderId"), false);
  assert.equal(result.uploadAvailable, false);
  assert.equal(value.tokens[0].token, "");
  assert.equal(await value.jobState.readActiveJob(), null);
});

test("ensure uses only non-interactive auth", async () => {
  const value = setup();
  await value.coordinator.ensureFolder();
  assert.equal(value.calls.includes("token:false"), true);
  assert.equal(value.calls.includes("token:true"), false);
});

test("a 401 removes once, refreshes non-interactively, and retries once", async () => {
  let requests = 0;
  const value = setup({
    performRequest: true,
    driveClient: {
      async requestJson(parameters) {
        value.calls.push(`drive:${parameters.token}`);
        requests += 1;
        if (requests === 1) throw new DriveRequestError(401);
        return { files: [] };
      }
    }
  });
  await value.coordinator.connect();
  assert.deepEqual(value.calls.filter((item) => item.startsWith("token:")),
    ["token:true", "token:false"]);
  assert.equal(value.calls.filter((item) => item.startsWith("remove:")).length, 1);
  assert.equal(requests, 2);
});

test("a repeated 401 becomes AUTH_REQUIRED without interactive retry", async () => {
  const value = setup({
    performRequest: true,
    driveClient: { async requestJson() { throw new DriveRequestError(401); } }
  });
  await assert.rejects(value.coordinator.connect(), (error) => error.code === "AUTH_REQUIRED");
  assert.deepEqual(value.calls.filter((item) => item.startsWith("token:")),
    ["token:true", "token:false"]);
  assert.equal(await value.jobState.readActiveJob(), null);
});

test("disconnect clears cached auth and folder state without a Drive request", async () => {
  const value = setup();
  const result = await value.coordinator.disconnect();
  assert.equal(result.connected, false);
  assert.deepEqual(value.calls, ["disconnect", "clear-cache"]);
});

test("shared lock rejects Drive setup and releases after failures", async () => {
  const value = setup();
  await value.jobState.acquireJobLock({
    id: "capture", tabId: 1, phase: "capture", startedAt: 1
  });
  await assert.rejects(value.coordinator.connect(), (error) => error.code === "DRIVE_SETUP_BUSY");
  await value.jobState.releaseJobLock("capture");

  const failed = setup({ managedFolder: { async ensure() { throw new Error("fail"); } } });
  await assert.rejects(failed.coordinator.connect());
  assert.equal(await failed.jobState.readActiveJob(), null);
});

test("account change clears immediately or after an active mutation", async () => {
  const idle = setup();
  await idle.coordinator.handleAccountChange();
  assert.deepEqual(idle.calls, ["clear-cache"]);
});

test("an active Drive setup lock blocks a capture lock until cleanup", async () => {
  let release;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const value = setup({
    managedFolder: {
      async ensure() {
        entered();
        await new Promise((resolve) => { release = resolve; });
        return folderResult;
      }
    }
  });
  const running = value.coordinator.connect();
  await started;
  await assert.rejects(
    value.jobState.acquireJobLock({
      id: "capture", tabId: 1, phase: "capture", startedAt: 2
    }),
    (error) => error.code === "CAPTURE_IN_PROGRESS"
  );
  release();
  await running;
  assert.equal(await value.jobState.readActiveJob(), null);
});
