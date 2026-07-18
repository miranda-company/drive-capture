import {
  DRIVE_FILE_SCOPE,
  DRIVE_FOLDER_MIME_TYPE,
  DRIVE_FOLDER_SCHEMA_VERSION
} from "./constants.js";

export const OAUTH_CLIENT_ID_PLACEHOLDER =
  "YOUR_CHROME_EXTENSION_OAUTH_CLIENT_ID.apps.googleusercontent.com";

const CLIENT_ID_PATTERN =
  /^[0-9]+-[a-z0-9][a-z0-9._-]*\.apps\.googleusercontent\.com$/u;
const FOLDER_SOURCE_VALUES = new Set(["cached", "discovered", "created"]);

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function validateOAuthConfiguration(oauth2) {
  const clientId = oauth2?.client_id;
  if (typeof clientId !== "string" || clientId.trim() === "") {
    return Object.freeze({ configured: false, reason: "missing-client-id" });
  }
  if (clientId === OAUTH_CLIENT_ID_PLACEHOLDER ||
      /YOUR_|PLACEHOLDER|REPLACE_ME/iu.test(clientId)) {
    return Object.freeze({ configured: false, reason: "placeholder-client-id" });
  }
  if (!CLIENT_ID_PATTERN.test(clientId)) {
    return Object.freeze({ configured: false, reason: "malformed-client-id" });
  }
  if (!Array.isArray(oauth2.scopes) ||
      oauth2.scopes.length !== 1 ||
      oauth2.scopes[0] !== DRIVE_FILE_SCOPE) {
    return Object.freeze({ configured: false, reason: "invalid-scopes" });
  }
  return Object.freeze({ configured: true, reason: null });
}

export function validateFolderCacheRecord(value) {
  return Boolean(
    plainObject(value) &&
    Object.keys(value).length === 2 &&
    typeof value.folderId === "string" &&
    value.folderId.length > 0 &&
    value.folderId.length <= 256 &&
    !/[\s/?#]/u.test(value.folderId) &&
    value.schemaVersion === DRIVE_FOLDER_SCHEMA_VERSION
  );
}

export function validateManagedFolder(value, expectedId = null) {
  return Boolean(
    plainObject(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    (expectedId === null || value.id === expectedId) &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    value.mimeType === DRIVE_FOLDER_MIME_TYPE &&
    value.trashed === false &&
    value.appProperties?.drivecaptureManaged === "true" &&
    value.appProperties?.drivecaptureSchema === String(DRIVE_FOLDER_SCHEMA_VERSION) &&
    value.capabilities?.canAddChildren !== false &&
    (value.createdTime === undefined ||
      (typeof value.createdTime === "string" && Number.isFinite(Date.parse(value.createdTime))))
  );
}

export function selectManagedFolder(files) {
  if (!Array.isArray(files)) return null;
  const valid = files.filter((folder) => validateManagedFolder(folder));
  valid.sort((left, right) => {
    const byTime = Date.parse(left.createdTime ?? 0) - Date.parse(right.createdTime ?? 0);
    return byTime || left.id.localeCompare(right.id);
  });
  return valid.length === 0
    ? null
    : Object.freeze({ folder: valid[0], duplicateCount: valid.length - 1 });
}

export function createSafeDriveSetupResult({
  configured,
  connected,
  grantedScopeConfirmed = false,
  status,
  folder = null
}) {
  const safeFolder = folder
    ? {
        ready: true,
        name: folder.name,
        source: folder.source,
        duplicateCount: folder.duplicateCount
      }
    : { ready: false };
  if (safeFolder.ready &&
      (typeof safeFolder.name !== "string" ||
       !FOLDER_SOURCE_VALUES.has(safeFolder.source) ||
       !Number.isInteger(safeFolder.duplicateCount) ||
       safeFolder.duplicateCount < 0)) {
    throw new TypeError("Invalid safe folder result.");
  }
  return Object.freeze({
    configured: Boolean(configured),
    connected: Boolean(connected),
    grantedScopeConfirmed: Boolean(grantedScopeConfirmed),
    status,
    folder: Object.freeze(safeFolder),
    uploadAvailable: false
  });
}

export function formatDriveStatus(result) {
  if (!result?.configured) {
    return Object.freeze({
      configuration: "OAuth client configuration required.",
      connection: "Not connected",
      folder: "Unavailable",
      outcome: "Add the Chrome Extension OAuth client ID, then reload DriveCapture."
    });
  }
  if (!result.connected) {
    return Object.freeze({
      configuration: "Configured",
      connection: "Not connected",
      folder: "Not checked",
      outcome: "Connect Google Drive to prepare the managed folder."
    });
  }
  const folder = result.folder?.ready
    ? `${result.folder.name} (${result.folder.source})`
    : "Not checked";
  const duplicate = result.folder?.duplicateCount > 0
    ? ` ${result.folder.duplicateCount} additional marked folder(s) were left unchanged.`
    : "";
  return Object.freeze({
    configuration: "Configured",
    connection: "Connected",
    folder,
    outcome: `Drive connected. Uploading screenshots is not implemented yet.${duplicate}`
  });
}

export function getDriveActionAvailability(result) {
  const configured = Boolean(result?.configured);
  const connected = Boolean(result?.connected);
  return Object.freeze({
    connect: configured && !connected,
    checkFolder: configured && connected,
    disconnect: configured && connected
  });
}
