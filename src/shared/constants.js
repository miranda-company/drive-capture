export const MESSAGE_CONTRACT_VERSION = 1;

export const CONTEXTS = Object.freeze({
  POPUP: "popup",
  SERVICE_WORKER: "service-worker",
  OFFSCREEN: "offscreen",
  PAGE: "page"
});

export const DEFAULT_JPEG_QUALITY = 0.92;
export const VISIBLE_VIEWPORT_JPEG_QUALITY = 92;
export const MINIMUM_CAPTURE_INTERVAL_MS = 550;
export const MAX_DIAGNOSTIC_SCROLL_STEPS = 100;
export const MAX_DIAGNOSTIC_PLAN_REVISIONS = 2;
export const SCROLL_SETTLE_TIMEOUT_MS = 1500;
export const SCROLL_POSITION_TOLERANCE_PX = 2;
export const MAX_VIEWPORT_CHANGE_PX = 2;
export const DIAGNOSTIC_RENDER_DELAY_MS = 250;
export const PAGE_MESSAGE_TIMEOUT_MS = 4000;
export const SEGMENT_SCALE_TOLERANCE = 0.01;
export const MAX_CANVAS_WIDTH_PX = 16384;
export const MAX_CANVAS_HEIGHT_PX = 32767;
export const MAX_CANVAS_PIXELS = 100_000_000;
export const MAX_CANVAS_RGBA_BYTES = 400_000_000;
export const STITCH_GAP_TOLERANCE_PX = 4;
export const CANCELLATION_POLL_INTERVAL_MS = 50;
export const MULTIPART_UPLOAD_THRESHOLD_BYTES = 5 * 1024 * 1024;
export const MANAGED_DRIVE_FOLDER_NAME = "DriveCapture";

export const STORAGE_KEYS = Object.freeze({
  ACTIVE_JOB: "activeCaptureJob",
  MANAGED_DRIVE_FOLDER_ID: "managedDriveFolderId",
  JPEG_QUALITY: "jpegQuality",
  CAPTURE_DELAY_MS: "captureDelayMs"
});

export const CURRENT_EXTENSION_PHASE = "phase-2d-local-full-page-stitching";
export const OFFSCREEN_DOCUMENT_PATH = "src/offscreen/offscreen.html";
