import assert from "node:assert/strict";
import test from "node:test";

import { DRIVE_FILE_SCOPE } from "../src/shared/constants.js";
import {
  createSafeDriveSetupResult,
  formatDriveStatus,
  OAUTH_CLIENT_ID_PLACEHOLDER,
  selectManagedFolder,
  validateFolderCacheRecord,
  validateManagedFolder,
  validateOAuthConfiguration
} from "../src/shared/google-drive.js";

const folder = (overrides = {}) => ({
  id: "folder-1",
  name: "DriveCapture",
  mimeType: "application/vnd.google-apps.folder",
  trashed: false,
  createdTime: "2025-01-01T00:00:00.000Z",
  appProperties: { drivecaptureManaged: "true", drivecaptureSchema: "1" },
  capabilities: { canAddChildren: true },
  ...overrides
});

test("validates only a plausible client ID with exactly drive.file", () => {
  assert.deepEqual(validateOAuthConfiguration({}), {
    configured: false, reason: "missing-client-id"
  });
  assert.deepEqual(validateOAuthConfiguration({
    client_id: OAUTH_CLIENT_ID_PLACEHOLDER,
    scopes: [DRIVE_FILE_SCOPE]
  }), { configured: false, reason: "placeholder-client-id" });
  assert.deepEqual(validateOAuthConfiguration({
    client_id: "bad.apps.googleusercontent.com",
    scopes: [DRIVE_FILE_SCOPE]
  }), { configured: false, reason: "malformed-client-id" });
  assert.deepEqual(validateOAuthConfiguration({
    client_id: "123456-example.apps.googleusercontent.com",
    scopes: [DRIVE_FILE_SCOPE]
  }), { configured: true, reason: null });
  for (const scopes of [[], [DRIVE_FILE_SCOPE, "openid"], ["https://www.googleapis.com/auth/drive"]]) {
    assert.equal(validateOAuthConfiguration({
      client_id: "123456-example.apps.googleusercontent.com", scopes
    }).configured, false);
  }
});

test("validates minimal folder cache records", () => {
  assert.equal(validateFolderCacheRecord({ folderId: "opaque-id", schemaVersion: 1 }), true);
  for (const value of [
    null,
    {},
    { folderId: "", schemaVersion: 1 },
    { folderId: "id", schemaVersion: 2 },
    { folderId: "id/path", schemaVersion: 1 },
    { folderId: "id", schemaVersion: 1, name: "DriveCapture" }
  ]) assert.equal(validateFolderCacheRecord(value), false);
});

test("accepts renamed marked writable folders and rejects invalid variants", () => {
  assert.equal(validateManagedFolder(folder({ name: "My renamed folder" })), true);
  assert.equal(validateManagedFolder(folder(), "folder-1"), true);
  for (const value of [
    folder({ trashed: true }),
    folder({ mimeType: "text/plain" }),
    folder({ appProperties: {} }),
    folder({ appProperties: { drivecaptureManaged: "true", drivecaptureSchema: "2" } }),
    folder({ capabilities: { canAddChildren: false } })
  ]) assert.equal(validateManagedFolder(value), false);
});

test("selects the oldest valid marked folder deterministically", () => {
  const selected = selectManagedFolder([
    folder({ id: "later", createdTime: "2026-01-01T00:00:00Z" }),
    folder({ id: "old-b", createdTime: "2025-01-01T00:00:00Z" }),
    folder({ id: "old-a", createdTime: "2025-01-01T00:00:00Z" }),
    folder({ id: "invalid", trashed: true })
  ]);
  assert.equal(selected.folder.id, "old-a");
  assert.equal(selected.duplicateCount, 2);
});

test("safe result and popup formatting never expose folder IDs", () => {
  const result = createSafeDriveSetupResult({
    configured: true,
    connected: true,
    grantedScopeConfirmed: true,
    status: "folder-ready",
    folder: { name: "Renamed", source: "discovered", duplicateCount: 2 }
  });
  assert.equal(JSON.stringify(result).includes("folderId"), false);
  const display = formatDriveStatus(result);
  assert.match(display.outcome, /Uploading screenshots is not implemented/u);
  assert.match(display.outcome, /2 additional/u);
  assert.equal(JSON.stringify(display).includes("folderId"), false);
});
