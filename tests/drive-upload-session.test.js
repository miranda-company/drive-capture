import assert from "node:assert/strict";
import test from "node:test";

import {
  createDriveUploadSession,
  DRIVE_UPLOAD_RESULT_FIELDS
} from "../src/background/drive-upload-session.js";
import { DriveRequestError } from "../src/background/google-drive-client.js";

const location =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=session-1";
const result = {
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

function response(status, sessionLocation = location) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name === "Location" ? sessionLocation : null }
  };
}

test("starts one fixed resumable session with minimal screenshot metadata", async () => {
  const calls = [];
  const session = createDriveUploadSession({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200);
    }
  });

  const value = await session.start({
    token: "transient-token",
    folderId: "folder-1",
    result
  });

  assert.deepEqual(value, { uploadSessionUrl: location });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname,
    "https://www.googleapis.com/upload/drive/v3/files");
  assert.equal(url.searchParams.get("uploadType"), "resumable");
  assert.equal(url.searchParams.get("fields"), DRIVE_UPLOAD_RESULT_FIELDS);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer transient-token");
  assert.equal(calls[0].options.headers["X-Upload-Content-Type"], "image/jpeg");
  assert.equal(calls[0].options.headers["X-Upload-Content-Length"], "123");
  const metadata = JSON.parse(calls[0].options.body);
  assert.deepEqual(metadata, {
    name: result.filename,
    mimeType: "image/jpeg",
    parents: ["folder-1"],
    appProperties: {
      drivecaptureScreenshot: "true",
      drivecaptureSchema: "1"
    }
  });
  assert.equal(JSON.stringify(metadata).includes("preview"), false);
  assert.equal(JSON.stringify(metadata).includes("http"), false);
});

test("rejects missing and malformed resumable Location headers", async () => {
  for (const invalid of [
    null,
    "http://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=x",
    "https://evil.example/upload/drive/v3/files?uploadType=resumable&upload_id=x",
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable"
  ]) {
    const session = createDriveUploadSession({
      fetchImpl: async () => response(200, invalid)
    });
    await assert.rejects(
      session.start({ token: "token", folderId: "folder-1", result }),
      (error) => error.code === "UPLOAD_SESSION_INVALID"
    );
  }
});

test("maps session HTTP failures and exposes 401 only as an internal retry signal", async () => {
  for (const [status, expected] of [
    [401, "internal-401"],
    [403, "UPLOAD_ACCESS_DENIED"],
    [429, "UPLOAD_RATE_LIMITED"],
    [503, "UPLOAD_SERVICE_UNAVAILABLE"],
    [400, "UPLOAD_SESSION_INVALID"]
  ]) {
    const session = createDriveUploadSession({
      fetchImpl: async () => response(status)
    });
    await assert.rejects(
      session.start({ token: "secret", folderId: "folder-1", result }),
      (error) => expected === "internal-401"
        ? error instanceof DriveRequestError && error.status === 401
        : error.code === expected && !JSON.stringify(error).includes("secret")
    );
  }
});

test("maps session network and timeout failures without returning credentials", async () => {
  const network = createDriveUploadSession({
    fetchImpl: async () => { throw new Error("network with secret-token"); }
  });
  await assert.rejects(
    network.start({ token: "secret-token", folderId: "folder-1", result }),
    (error) => error.code === "UPLOAD_NETWORK_ERROR" &&
      !JSON.stringify(error).includes("secret-token")
  );

  const timeout = createDriveUploadSession({
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
  await assert.rejects(
    timeout.start({ token: "token", folderId: "folder-1", result }),
    (error) => error.code === "UPLOAD_TIMEOUT"
  );
});

test("rejects invalid local metadata before making a session request", async () => {
  let calls = 0;
  const session = createDriveUploadSession({
    fetchImpl: async () => { calls += 1; return response(200); }
  });
  await assert.rejects(
    session.start({
      token: "token",
      folderId: "folder-1",
      result: { ...result, filename: "unsafe.jpg.jpg" }
    }),
    (error) => error.code === "UPLOAD_RESULT_UNAVAILABLE"
  );
  assert.equal(calls, 0);
});
