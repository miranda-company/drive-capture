import assert from "node:assert/strict";
import test from "node:test";

import {
  createSafeUploadResult,
  createSafeUploadStatus,
  validateDriveFileMetadata,
  validateOffscreenUploadRequest,
  validateSafeUploadResult,
  validateSafeUploadStatus,
  validateUploadSessionUrl,
  validateUploadSourceMetadata
} from "../src/shared/drive-upload.js";

const sessionUrl =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=opaque-session";
const source = {
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
  id: "file-id",
  name: source.filename,
  mimeType: "image/jpeg",
  size: "123",
  createdTime: "2026-07-18T12:00:00.000Z",
  parents: ["folder-id"],
  webViewLink: "https://drive.google.com/file/d/file-id/view",
  md5Checksum: "0123456789abcdef0123456789abcdef",
  appProperties: {
    drivecaptureScreenshot: "true",
    drivecaptureSchema: "1"
  }
};
const expected = {
  filename: source.filename,
  blobSize: source.blobSize,
  folderId: "folder-id"
};

test("accepts only the fixed HTTPS Google resumable-session shape", () => {
  assert.equal(validateUploadSessionUrl(sessionUrl), true);
  for (const value of [
    "",
    "http://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=x",
    "https://evil.example/upload/drive/v3/files?uploadType=resumable&upload_id=x",
    "https://www.googleapis.com/drive/v3/files?uploadType=resumable&upload_id=x",
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=media&upload_id=x",
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
    "https://user:pass@www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=x"
  ]) assert.equal(validateUploadSessionUrl(value), false, value);
});

test("validates trusted local upload metadata and the offscreen request contract", () => {
  assert.equal(validateUploadSourceMetadata(source), true);
  assert.equal(validateOffscreenUploadRequest({
    resultId: source.resultId,
    uploadSessionUrl: sessionUrl,
    expectedBlobSize: source.blobSize,
    expectedMimeType: "image/jpeg"
  }), true);
  for (const patch of [
    { available: false },
    { previewUrl: "" },
    { filename: "bad.jpg.jpg" },
    { mimeType: "image/png" },
    { blobSize: 0 },
    { encodedBytes: 122 },
    { validJpegSignature: false },
    { pixelWidth: 0 }
  ]) assert.equal(validateUploadSourceMetadata({ ...source, ...patch }), false);
});

test("validates completion metadata against filename, size, parent, markers, and link", () => {
  assert.equal(validateDriveFileMetadata(file, expected), true);
  for (const patch of [
    { id: "" },
    { name: "other.jpg" },
    { mimeType: "image/png" },
    { size: "124" },
    { parents: ["other-folder"] },
    { webViewLink: "https://evil.example/file" },
    { md5Checksum: "not-a-checksum" },
    { appProperties: {} }
  ]) assert.equal(validateDriveFileMetadata({ ...file, ...patch }, expected), false);
});

test("safe upload results omit raw IDs and validate as JSON-safe popup metadata", () => {
  const safe = createSafeUploadResult(file, expected, 1000);
  assert.equal(validateSafeUploadResult(safe), true);
  assert.equal("id" in safe, false);
  assert.equal("parents" in safe, false);
  assert.deepEqual(Object.keys(safe).sort(), [
    "checksumAvailable",
    "createdTime",
    "filename",
    "mimeType",
    "size",
    "uploaded",
    "uploadedAt",
    "webViewLink"
  ]);
});

test("safe upload status allows only bounded serializable state", () => {
  const result = createSafeUploadResult(file, expected, 1000);
  const status = createSafeUploadStatus({
    state: "successful",
    resultId: "result-1",
    result,
    updatedAt: 1001
  });
  assert.equal(validateSafeUploadStatus(status), true);
  assert.equal(validateSafeUploadStatus({
    ...status,
    result: { ...result, id: "raw-id" }
  }), false);
});
