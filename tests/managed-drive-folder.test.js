import assert from "node:assert/strict";
import test from "node:test";

import { createManagedDriveFolder } from "../src/background/managed-drive-folder.js";
import { DriveRequestError } from "../src/background/google-drive-client.js";

const folder = (overrides = {}) => ({
  id: "folder-1",
  name: "DriveCapture",
  mimeType: "application/vnd.google-apps.folder",
  trashed: false,
  createdTime: "2025-01-01T00:00:00Z",
  appProperties: { drivecaptureManaged: "true", drivecaptureSchema: "1" },
  capabilities: { canAddChildren: true },
  ...overrides
});

function storage(initial) {
  const values = new Map();
  if (initial !== undefined) values.set("managedDriveFolderId", structuredClone(initial));
  return {
    values,
    async get(key) { return values.has(key) ? { [key]: structuredClone(values.get(key)) } : {}; },
    async set(entries) { for (const [key, value] of Object.entries(entries)) values.set(key, structuredClone(value)); },
    async remove(key) { values.delete(key); }
  };
}

test("validates and reuses a renamed cached folder", async () => {
  const store = storage({ folderId: "folder-1", schemaVersion: 1 });
  const calls = [];
  const manager = createManagedDriveFolder({
    storage: store,
    request: async (value) => {
      calls.push(value);
      return folder({ name: "User renamed this" });
    }
  });
  const result = await manager.ensure();
  assert.equal(result.source, "cached");
  assert.equal(result.folder.name, "User renamed this");
  assert.deepEqual(calls, [{ operation: "get-folder", folderId: "folder-1" }]);
});

test("clears malformed cache and discovers by marker with pagination", async () => {
  const store = storage({ folderId: "", schemaVersion: 1 });
  const calls = [];
  const manager = createManagedDriveFolder({
    storage: store,
    request: async (value) => {
      calls.push(value);
      if (!value.pageToken) return { files: [folder({ trashed: true })], nextPageToken: "p2" };
      return { files: [folder({ id: "found", name: "Renamed" })] };
    }
  });
  const result = await manager.ensure();
  assert.equal(result.source, "discovered");
  assert.equal(result.folder.id, "found");
  assert.deepEqual(store.values.get("managedDriveFolderId"), {
    folderId: "found", schemaVersion: 1
  });
  assert.equal(calls.length, 2);
});

test("404 invalidates cached folder before discovery", async () => {
  const store = storage({ folderId: "missing", schemaVersion: 1 });
  const operations = [];
  const manager = createManagedDriveFolder({
    storage: store,
    request: async (value) => {
      operations.push(value.operation);
      if (value.operation === "get-folder") throw new DriveRequestError(404);
      return { files: [folder({ id: "replacement" })] };
    }
  });
  assert.equal((await manager.ensure()).source, "discovered");
  assert.deepEqual(operations, ["get-folder", "list-folders"]);
});

test("creates one correctly validated folder after empty discovery and caches it", async () => {
  const store = storage();
  const operations = [];
  const manager = createManagedDriveFolder({
    storage: store,
    request: async (value) => {
      operations.push(value.operation);
      return value.operation === "list-folders" ? { files: [] } : folder({ id: "created" });
    }
  });
  const result = await manager.ensure();
  assert.equal(result.source, "created");
  assert.deepEqual(operations, ["list-folders", "create-folder"]);
  assert.deepEqual(store.values.get("managedDriveFolderId"), {
    folderId: "created", schemaVersion: 1
  });
});

test("invalid creation is not cached or retried in the same operation", async () => {
  const store = storage();
  let creates = 0;
  const manager = createManagedDriveFolder({
    storage: store,
    request: async ({ operation }) => {
      if (operation === "list-folders") return { files: [] };
      creates += 1;
      return folder({ appProperties: {} });
    }
  });
  await assert.rejects(manager.ensure(), (error) => error.code === "DRIVE_FOLDER_CREATE_FAILED");
  assert.equal(creates, 1);
  assert.equal(store.values.has("managedDriveFolderId"), false);
});

test("bounded discovery rejects a fourth page without creating", async () => {
  let lists = 0;
  let creates = 0;
  const manager = createManagedDriveFolder({
    storage: storage(),
    request: async ({ operation }) => {
      if (operation === "create-folder") {
        creates += 1;
        return folder();
      }
      lists += 1;
      return { files: [], nextPageToken: `page-${lists + 1}` };
    }
  });
  await assert.rejects(manager.ensure(),
    (error) => error.code === "DRIVE_FOLDER_DISCOVERY_FAILED");
  assert.equal(lists, 3);
  assert.equal(creates, 0);
});

test("concurrent ensure calls share one creation operation", async () => {
  const store = storage();
  let creates = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const manager = createManagedDriveFolder({
    storage: store,
    request: async ({ operation }) => {
      if (operation === "list-folders") return { files: [] };
      creates += 1;
      await gate;
      return folder({ id: "created" });
    }
  });
  const first = manager.ensure();
  const second = manager.ensure();
  await Promise.resolve();
  release();
  const [one, two] = await Promise.all([first, second]);
  assert.equal(creates, 1);
  assert.deepEqual(one, two);
});

test("cache read, write, and clear failures are structured", async () => {
  const failing = (method) => ({
    async get() { if (method === "get") throw new Error(); return {}; },
    async set() { if (method === "set") throw new Error(); },
    async remove() { if (method === "remove") throw new Error(); }
  });
  await assert.rejects(
    createManagedDriveFolder({ storage: failing("get"), request: async () => ({}) }).ensure(),
    (error) => error.code === "DRIVE_FOLDER_CACHE_FAILED"
  );
  await assert.rejects(
    createManagedDriveFolder({
      storage: failing("set"),
      request: async ({ operation }) => operation === "list-folders"
        ? { files: [folder()] } : folder()
    }).ensure(),
    (error) => error.code === "DRIVE_FOLDER_CACHE_FAILED"
  );
  await assert.rejects(
    createManagedDriveFolder({ storage: failing("remove") }).clearCache(),
    (error) => error.code === "DRIVE_FOLDER_CACHE_FAILED"
  );
});
