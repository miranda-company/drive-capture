export const MESSAGE_CONTRACT_VERSION = 1;

export const CONTEXTS = Object.freeze({
  POPUP: "popup",
  SERVICE_WORKER: "service-worker",
  OFFSCREEN: "offscreen",
  PAGE: "page"
});

export const DEFAULT_JPEG_QUALITY = 0.92;
export const MINIMUM_CAPTURE_INTERVAL_MS = 550;
export const MULTIPART_UPLOAD_THRESHOLD_BYTES = 5 * 1024 * 1024;
export const MANAGED_DRIVE_FOLDER_NAME = "DriveCapture";

export const STORAGE_KEYS = Object.freeze({
  ACTIVE_JOB: "activeCaptureJob",
  MANAGED_DRIVE_FOLDER_ID: "managedDriveFolderId",
  JPEG_QUALITY: "jpegQuality",
  CAPTURE_DELAY_MS: "captureDelayMs"
});

export const CURRENT_EXTENSION_PHASE = "phase-1-scaffold";
export const OFFSCREEN_DOCUMENT_PATH = "src/offscreen/offscreen.html";
