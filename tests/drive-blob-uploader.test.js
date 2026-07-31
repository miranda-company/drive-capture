import assert from "node:assert/strict";
import test from "node:test";

import { createDriveBlobUploader } from "../src/offscreen/drive-blob-uploader.js";

const sessionUrl =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=session-1";
const bytes = new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
const blob = new Blob([bytes], { type: "image/jpeg" });
const metadata = {
  resultId: "result-1",
  filename: "DriveCapture_Test.jpg",
  uploaded: false
};
const file = {
  id: "file-1",
  name: metadata.filename,
  mimeType: "image/jpeg",
  size: String(blob.size),
  parents: ["folder-1"],
  webViewLink: "https://drive.google.com/file/d/file-1/view",
  appProperties: {
    drivecaptureScreenshot: "true",
    drivecaptureSchema: "1"
  }
};
const request = {
  resultId: "result-1",
  uploadSessionUrl: sessionUrl,
  expectedBlobSize: blob.size,
  expectedMimeType: "image/jpeg"
};

function response(status, value = file, range = null) {
  return {
    status,
    headers: {
      get(name) {
        return name === "Range" ? range : null;
      }
    },
    async text() {
      return typeof value === "string" ? value : JSON.stringify(value);
    }
  };
}

function setup(fetchImpl, source = { blob, metadata }) {
  return createDriveBlobUploader({
    getUploadSource: () => source,
    fetchImpl,
    setTimeoutImpl: () => 1,
    clearTimeoutImpl() {}
  });
}

test("uploads the exact Blob once with PUT and no authorization or body conversion", async () => {
  for (const status of [200, 201]) {
    const calls = [];
    const uploader = setup(async (url, options) => {
      calls.push({ url, options });
      return response(status);
    });
    const result = await uploader.start(request);
    assert.equal(result.completed, true);
    assert.equal(result.statusQueryCount, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, sessionUrl);
    assert.equal(calls[0].options.method, "PUT");
    assert.equal(calls[0].options.body, blob);
    assert.deepEqual(calls[0].options.headers, {
      "Content-Type": "image/jpeg"
    });
    assert.equal("Authorization" in calls[0].options.headers, false);
    assert.equal("Content-Length" in calls[0].options.headers, false);
    assert.deepEqual(result.file, file);
    assert.deepEqual(uploader.status(), {
      state: "completed",
      resultId: "result-1"
    });
  }
});

test("rejects missing results, Blob mismatch, MIME mismatch, prior upload, and invalid URL", async () => {
  const never = async () => { throw new Error("must not fetch"); };
  for (const [source, payload, code] of [
    [null, request, "UPLOAD_RESULT_UNAVAILABLE"],
    [{ blob: new Blob([bytes], { type: "image/jpeg" }), metadata },
      { ...request, expectedBlobSize: blob.size + 1 }, "UPLOAD_RESULT_UNAVAILABLE"],
    [{ blob: new Blob([bytes], { type: "image/png" }), metadata },
      request, "UPLOAD_RESULT_UNAVAILABLE"],
    [{ blob, metadata: { ...metadata, uploaded: true } },
      request, "UPLOAD_ALREADY_COMPLETED"],
    [{ blob, metadata },
      { ...request, uploadSessionUrl: "https://evil.example/session" },
      "UPLOAD_SESSION_INVALID"]
  ]) {
    const uploader = createDriveBlobUploader({
      getUploadSource() {
        if (!source) {
          const error = new Error("missing");
          error.code = "UPLOAD_RESULT_UNAVAILABLE";
          throw error;
        }
        return source;
      },
      fetchImpl: never
    });
    await assert.rejects(uploader.start(payload), (error) => error.code === code);
  }
});

test("maps direct incomplete, expired, access, rate-limit, and invalid responses", async () => {
  for (const [status, expected] of [
    [308, "UPLOAD_INCOMPLETE"],
    [404, "UPLOAD_SESSION_EXPIRED"],
    [403, "UPLOAD_ACCESS_DENIED"],
    [429, "UPLOAD_RATE_LIMITED"],
    [400, "UPLOAD_RESPONSE_INVALID"]
  ]) {
    const uploader = setup(async () => response(status));
    await assert.rejects(uploader.start(request), (error) => error.code === expected);
  }
});

test("queries one existing session after a network failure and accepts completed status", async () => {
  const calls = [];
  const uploader = setup(async (_url, options) => {
    calls.push(options);
    if (calls.length === 1) throw new Error("offline");
    return response(200);
  });
  const result = await uploader.start(request);
  assert.equal(result.completed, true);
  assert.equal(result.statusQueryCount, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].headers, {
    "Content-Range": `bytes */${blob.size}`
  });
  assert.equal("body" in calls[1], false);
});

test("queries one existing session after 5xx and reports incomplete without a new session", async () => {
  const calls = [];
  const uploader = setup(async (_url, options) => {
    calls.push(options);
    return calls.length === 1
      ? response(503)
      : response(308, {}, `bytes=0-${blob.size - 2}`);
  });
  await assert.rejects(
    uploader.start(request),
    (error) => error.code === "UPLOAD_INCOMPLETE"
  );
  assert.equal(calls.length, 2);
});

test("rejects invalid status Range and never performs a second query", async () => {
  let calls = 0;
  const uploader = setup(async () => {
    calls += 1;
    return calls === 1
      ? response(503)
      : response(308, {}, `bytes=0-${blob.size}`);
  });
  await assert.rejects(
    uploader.start(request),
    (error) => error.code === "UPLOAD_RESPONSE_INVALID"
  );
  assert.equal(calls, 2);
});

test("cancellation aborts the active request, queries once, and permits explicit retry", async () => {
  let calls = 0;
  const uploader = setup(async (_url, options) => {
    calls += 1;
    if (calls === 1) {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    }
    return response(308);
  });
  const running = uploader.start(request);
  await Promise.resolve();
  assert.deepEqual(uploader.cancel({ resultId: "result-1" }), { accepted: true });
  await assert.rejects(running, (error) => error.code === "UPLOAD_ABORTED");
  assert.equal(calls, 2);
  assert.deepEqual(uploader.status(), {
    state: "cancelled",
    resultId: "result-1"
  });

  const retry = setup(async () => response(200));
  assert.equal((await retry.start(request)).completed, true);
});

test("invalid successful JSON is rejected and active session state is cleared", async () => {
  const uploader = setup(async () => response(200, "{"));
  await assert.rejects(
    uploader.start(request),
    (error) => error.code === "UPLOAD_RESPONSE_INVALID"
  );
  assert.deepEqual(uploader.cancel({ resultId: "result-1" }), { accepted: false });
});

test("an offscreen timeout performs one status query and reports timeout when still uncertain", async () => {
  let calls = 0;
  const uploader = createDriveBlobUploader({
    getUploadSource: () => ({ blob, metadata }),
    fetchImpl: async (_url, options) => {
      calls += 1;
      if (calls === 1 && options.signal.aborted) {
        const error = new Error("timed out");
        error.name = "AbortError";
        throw error;
      }
      return response(308);
    },
    setTimeoutImpl(callback) {
      if (calls === 0) callback();
      return 1;
    },
    clearTimeoutImpl() {}
  });

  await assert.rejects(
    uploader.start(request),
    (error) => error.code === "UPLOAD_TIMEOUT"
  );
  assert.equal(calls, 2);
});
