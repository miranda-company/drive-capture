export const MESSAGE_CONTRACT_VERSION = 1;

export const CONTEXTS = Object.freeze({
  POPUP: "popup",
  SERVICE_WORKER: "service-worker",
  OFFSCREEN: "offscreen",
  PAGE: "page"
});

export const DEFAULT_JPEG_QUALITY = 0.92;
export const ALLOWED_JPEG_QUALITIES = Object.freeze([0.8, 0.9, 0.92, 0.95]);
export const MAX_OUTPUT_FILENAME_LENGTH = 140;
export const MAX_PAGE_LABEL_LENGTH = 70;
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
export const MAX_OVERLAY_CANDIDATES = 200;
export const OVERLAY_GEOMETRY_TOLERANCE_PX = 2;
export const OVERLAY_SETTLE_DELAY_MS = 50;
export const OVERLAY_ATTRIBUTE_NAME = "data-drivecapture-element-id";
export const CANCELLATION_POLL_INTERVAL_MS = 50;
export const MULTIPART_UPLOAD_THRESHOLD_BYTES = 5 * 1024 * 1024;
export const MANAGED_DRIVE_FOLDER_NAME = "DriveCapture";
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
export const DRIVE_FOLDER_SCHEMA_VERSION = 1;
export const DRIVE_REQUEST_TIMEOUT_MS = 15_000;
export const DRIVE_DISCOVERY_MAX_PAGES = 3;
export const DRIVE_DISCOVERY_PAGE_SIZE = 50;

export const STORAGE_KEYS = Object.freeze({
  ACTIVE_JOB: "activeCaptureJob",
  MANAGED_DRIVE_FOLDER_ID: "managedDriveFolderId",
  JPEG_QUALITY: "jpegQuality",
  CAPTURE_DELAY_MS: "captureDelayMs"
});

export const CURRENT_EXTENSION_PHASE = "phase-3b-drive-setup";
export const OFFSCREEN_DOCUMENT_PATH = "src/offscreen/offscreen.html";
