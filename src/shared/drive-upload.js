import { MAX_OUTPUT_FILENAME_LENGTH } from "./constants.js";
import { validateResolvedOutputFilename } from "./output-filename.js";

const SAFE_UPLOAD_STATES = new Set([
  "idle",
  "ready",
  "preparing-upload",
  "validating-folder",
  "starting-session",
  "uploading",
  "verifying-upload",
  "successful",
  "cancelled",
  "failed"
]);

const positiveInteger = (value) => Number.isInteger(value) && value > 0;
const opaqueId = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 512 &&
  !/[\s/?#]/u.test(value);

export function validateUploadSessionUrl(value) {
  if (typeof value !== "string" || value.length > 4096) return false;
  try {
    const url = new URL(value);
    const sessionId = url.searchParams.get("upload_id");
    return url.protocol === "https:" &&
      url.hostname === "www.googleapis.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      url.pathname === "/upload/drive/v3/files" &&
      url.searchParams.get("uploadType") === "resumable" &&
      typeof sessionId === "string" &&
      sessionId.length > 0 &&
      sessionId.length <= 2048;
  } catch {
    return false;
  }
}

export function validateUploadSourceMetadata(value) {
  if (!value || value.available !== true ||
      typeof value.resultId !== "string" || value.resultId.length === 0 ||
      value.mimeType !== "image/jpeg" ||
      !positiveInteger(value.blobSize) ||
      value.encodedBytes !== value.blobSize ||
      value.validJpegSignature !== true ||
      !positiveInteger(value.pixelWidth) ||
      !positiveInteger(value.pixelHeight) ||
      typeof value.previewUrl !== "string" ||
      !value.previewUrl.startsWith("blob:") ||
      typeof value.uploaded !== "boolean") {
    return false;
  }
  try {
    validateResolvedOutputFilename(value.filename, value.filenameSource);
  } catch {
    return false;
  }
  return Array.from(value.filename).length <= MAX_OUTPUT_FILENAME_LENGTH;
}

export function validateOffscreenUploadRequest(value) {
  return Boolean(
    value &&
    typeof value.resultId === "string" &&
    value.resultId.length > 0 &&
    validateUploadSessionUrl(value.uploadSessionUrl) &&
    positiveInteger(value.expectedBlobSize) &&
    value.expectedMimeType === "image/jpeg"
  );
}

export function validateDriveFileMetadata(value, expected) {
  if (!value || !expected ||
      !opaqueId(value.id) ||
      value.name !== expected.filename ||
      value.mimeType !== "image/jpeg" ||
      value.appProperties?.drivecaptureScreenshot !== "true" ||
      value.appProperties?.drivecaptureSchema !== "1") {
    return false;
  }
  if (value.size !== undefined &&
      (!/^[1-9]\d*$/u.test(String(value.size)) ||
       Number(value.size) !== expected.blobSize)) {
    return false;
  }
  if (value.parents !== undefined &&
      (!Array.isArray(value.parents) ||
       !value.parents.includes(expected.folderId))) {
    return false;
  }
  if (value.createdTime !== undefined &&
      (typeof value.createdTime !== "string" ||
       !Number.isFinite(Date.parse(value.createdTime)))) {
    return false;
  }
  if (value.webViewLink !== undefined) {
    try {
      const link = new URL(value.webViewLink);
      if (link.protocol !== "https:" ||
          link.hostname !== "drive.google.com" ||
          link.username || link.password) {
        return false;
      }
    } catch {
      return false;
    }
  }
  if (value.md5Checksum !== undefined &&
      (typeof value.md5Checksum !== "string" ||
       !/^[a-f0-9]{32}$/iu.test(value.md5Checksum))) {
    return false;
  }
  return true;
}

export function createSafeUploadResult(value, expected, uploadedAt = Date.now()) {
  if (!validateDriveFileMetadata(value, expected) || !positiveInteger(uploadedAt)) {
    throw new TypeError("Invalid Drive upload result.");
  }
  return Object.freeze({
    uploaded: true,
    filename: value.name,
    mimeType: "image/jpeg",
    size: expected.blobSize,
    createdTime: value.createdTime ?? null,
    webViewLink: value.webViewLink ?? null,
    checksumAvailable: typeof value.md5Checksum === "string",
    uploadedAt
  });
}

export function validateSafeUploadResult(value) {
  if (!value || value.uploaded !== true ||
      typeof value.filename !== "string" ||
      !value.filename.endsWith(".jpg") ||
      value.mimeType !== "image/jpeg" ||
      !positiveInteger(value.size) ||
      !positiveInteger(value.uploadedAt) ||
      typeof value.checksumAvailable !== "boolean") {
    return false;
  }
  try {
    validateResolvedOutputFilename(value.filename, "custom");
  } catch {
    return false;
  }
  if (value.createdTime !== null &&
      (typeof value.createdTime !== "string" ||
       !Number.isFinite(Date.parse(value.createdTime)))) return false;
  if (value.webViewLink !== null) {
    try {
      const url = new URL(value.webViewLink);
      if (url.protocol !== "https:" || url.hostname !== "drive.google.com") return false;
    } catch {
      return false;
    }
  }
  return !("id" in value) && !("parents" in value);
}

export function validateSafeUploadStatus(value) {
  if (!value || !SAFE_UPLOAD_STATES.has(value.state) ||
      !positiveInteger(value.updatedAt) ||
      (value.resultId !== null &&
       (typeof value.resultId !== "string" || value.resultId.length === 0)) ||
      typeof value.canUpload !== "boolean") {
    return false;
  }
  if (value.result !== null && !validateSafeUploadResult(value.result)) return false;
  if (value.error !== null &&
      (!value.error || typeof value.error.code !== "string" ||
       typeof value.error.message !== "string")) return false;
  return true;
}

export function createSafeUploadStatus({
  state,
  resultId = null,
  canUpload = false,
  result = null,
  error = null,
  updatedAt = Date.now()
}) {
  const value = { state, resultId, canUpload, result, error, updatedAt };
  if (!validateSafeUploadStatus(value)) {
    throw new TypeError("Invalid safe upload status.");
  }
  return Object.freeze(value);
}
