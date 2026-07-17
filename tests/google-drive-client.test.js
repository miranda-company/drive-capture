import assert from "node:assert/strict";
import test from "node:test";

import {
  createGoogleDriveClient,
  DriveRequestError
} from "../src/background/google-drive-client.js";

const response = (status, value = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  async text() { return typeof value === "string" ? value : JSON.stringify(value); }
});

test("uses only fixed JSON Drive paths, minimal fields, and an internal auth header", async () => {
  const calls = [];
  const client = createGoogleDriveClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, { files: [] });
    }
  });
  await client.requestJson({ token: "secret-token", operation: "get-folder", folderId: "folder-1" });
  await client.requestJson({ token: "secret-token", operation: "list-folders", pageToken: "next token" });
  await client.requestJson({ token: "secret-token", operation: "create-folder" });
  assert.equal(calls.every((call) => call.url.startsWith("https://www.googleapis.com/drive/v3/files")), true);
  assert.equal(calls.some((call) => call.url.includes("/upload/") || call.url.includes("uploadType")), false);
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret-token");
  assert.match(calls[1].url, /appProperties/u);
  assert.equal(calls[1].url.includes("name+%3D"), false);
  const body = JSON.parse(calls[2].options.body);
  assert.deepEqual(body.appProperties, {
    drivecaptureManaged: "true",
    drivecaptureSchema: "1"
  });
  assert.equal(body.mimeType, "application/vnd.google-apps.folder");
  assert.equal(calls[2].options.headers["Content-Type"], "application/json");
});

test("maps Drive HTTP failures without returning response bodies", async () => {
  for (const [status, expected] of [
    [401, 401],
    [404, 404],
    [403, "DRIVE_ACCESS_DENIED"],
    [429, "DRIVE_RATE_LIMITED"],
    [503, "DRIVE_API_UNAVAILABLE"],
    [400, "DRIVE_RESPONSE_INVALID"]
  ]) {
    const client = createGoogleDriveClient({
      fetchImpl: async () => response(status, { error: { message: "sensitive" } })
    });
    await assert.rejects(
      client.requestJson({ token: "x", operation: "list-folders" }),
      (error) => expected === status
        ? error instanceof DriveRequestError && error.status === expected
        : error.code === expected && !JSON.stringify(error).includes("sensitive")
    );
  }
});

test("maps invalid JSON, network failure, and timeout", async () => {
  const invalid = createGoogleDriveClient({ fetchImpl: async () => response(200, "{") });
  await assert.rejects(invalid.requestJson({ token: "x", operation: "list-folders" }),
    (error) => error.code === "DRIVE_RESPONSE_INVALID");
  const network = createGoogleDriveClient({ fetchImpl: async () => { throw new Error("offline"); } });
  await assert.rejects(network.requestJson({ token: "x", operation: "list-folders" }),
    (error) => error.code === "DRIVE_NETWORK_ERROR");
  const timeout = createGoogleDriveClient({
    fetchImpl: async (_url, options) => {
      if (options.signal.aborted) {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      }
      return response(200);
    },
    setTimeoutImpl(callback) { callback(); return 1; },
    clearTimeoutImpl() {}
  });
  await assert.rejects(timeout.requestJson({ token: "x", operation: "list-folders" }),
    (error) => error.code === "DRIVE_REQUEST_TIMEOUT");
});

test("rejects arbitrary operations and folder paths", async () => {
  const client = createGoogleDriveClient({ fetchImpl: async () => response(200) });
  await assert.rejects(client.requestJson({ token: "x", operation: "upload" }),
    (error) => error.code === "DRIVE_RESPONSE_INVALID");
  await assert.rejects(client.requestJson({
    token: "x", operation: "get-folder", folderId: "../upload"
  }), (error) => error.code === "DRIVE_FOLDER_INVALID");
});
