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
  const localStateCalls = [];
  const tokens = [];
  let explicitlyDisconnected = overrides.explicitlyDisconnected ?? false;
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
  const localState = {
    async isExplicitlyDisconnected() {
      localStateCalls.push("read");
      return explicitlyDisconnected;
    },
    async setExplicitlyDisconnected(value) {
      localStateCalls.push(`set:${value}`);
      explicitlyDisconnected = value;
    },
    ...overrides.localState
  };
  const coordinator = createDriveSetupCoordinator({
    auth, driveClient, managedFolder, localState, jobState,
    now: () => 1000, createJobId: () => "drive-job"
  });
  return {
    coordinator,
    calls,
    localStateCalls,
    tokens,
    jobState,
    isExplicitlyDisconnected: () => explicitlyDisconnected
  };
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
  assert.deepEqual(value.localStateCalls, ["set:false"]);
  assert.equal(value.isExplicitlyDisconnected(), false);
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
  assert.deepEqual(value.localStateCalls, ["set:true"]);
  assert.equal(value.isExplicitlyDisconnected(), true);

  const reopenedStatus = await value.coordinator.status();
  assert.equal(reopenedStatus.connected, false);
  assert.equal(reopenedStatus.folder.ready, false);
  assert.deepEqual(value.calls, ["disconnect", "clear-cache"]);
  assert.deepEqual(value.localStateCalls, ["set:true", "read"]);
});

test("disconnect clears auth, then folder cache, then stores local disconnect", async () => {
  const order = [];
  const value = setup({
    auth: {
      async disconnect() {
        order.push("clear-auth");
      }
    },
    managedFolder: {
      async clearCache() {
        order.push("clear-folder-cache");
      }
    },
    localState: {
      async setExplicitlyDisconnected(value) {
        order.push(`store-disconnected:${value}`);
      }
    }
  });

  await value.coordinator.disconnect();

  assert.deepEqual(order, [
    "clear-auth",
    "clear-folder-cache",
    "store-disconnected:true"
  ]);
  assert.equal(order.some((entry) => entry.startsWith("drive:")), false);
});

test("popup status remains locally disconnected without requesting a token or Drive data", async () => {
  const value = setup({ explicitlyDisconnected: true });

  const result = await value.coordinator.status();

  assert.equal(result.configured, true);
  assert.equal(result.connected, false);
  assert.equal(result.folder.ready, false);
  assert.equal(result.status, "not-connected");
  assert.deepEqual(value.calls, []);
  assert.deepEqual(value.localStateCalls, ["read"]);
});

test("folder checking remains unavailable while explicitly disconnected", async () => {
  const value = setup({ explicitlyDisconnected: true });

  await assert.rejects(
    value.coordinator.ensureFolder(),
    (error) => error.code === "AUTH_REQUIRED"
  );

  assert.equal(value.calls.some((call) => call.startsWith("token:")), false);
  assert.equal(value.calls.some((call) => call.startsWith("drive:")), false);
  assert.equal(await value.jobState.readActiveJob(), null);
});

test("successful explicit Connect clears local disconnect and returns connected", async () => {
  const value = setup({ explicitlyDisconnected: true });

  const result = await value.coordinator.connect();

  assert.equal(result.connected, true);
  assert.equal(result.status, "folder-ready");
  assert.deepEqual(value.localStateCalls, ["set:false"]);
  assert.equal(value.isExplicitlyDisconnected(), false);
  assert.equal(value.calls.includes("token:true"), true);
});

test("cancelled explicit Connect restores local disconnect", async () => {
  const value = setup({
    explicitlyDisconnected: true,
    auth: {
      async acquireToken() {
        throw { code: "AUTH_CANCELLED", message: "cancelled" };
      }
    }
  });

  await assert.rejects(
    value.coordinator.connect(),
    (error) => error.code === "AUTH_CANCELLED"
  );

  assert.deepEqual(value.localStateCalls, ["set:false", "set:true"]);
  assert.equal(value.isExplicitlyDisconnected(), true);
  assert.equal(await value.jobState.readActiveJob(), null);
});

test("failed explicit Connect restores local disconnect", async () => {
  const value = setup({
    explicitlyDisconnected: true,
    managedFolder: {
      async ensure() {
        throw { code: "DRIVE_NETWORK_ERROR", message: "network unavailable" };
      }
    }
  });

  await assert.rejects(
    value.coordinator.connect(),
    (error) => error.code === "DRIVE_NETWORK_ERROR"
  );

  assert.deepEqual(value.localStateCalls, ["set:false", "set:true"]);
  assert.equal(value.isExplicitlyDisconnected(), true);
  assert.equal(await value.jobState.readActiveJob(), null);
});

test("account changes clear folder cache without changing explicit disconnect", async () => {
  const value = setup({ explicitlyDisconnected: true });

  await value.coordinator.handleAccountChange();

  assert.deepEqual(value.calls, ["clear-cache"]);
  assert.deepEqual(value.localStateCalls, []);
  assert.equal(value.isExplicitlyDisconnected(), true);
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
