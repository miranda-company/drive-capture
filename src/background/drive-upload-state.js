import { STORAGE_KEYS } from "../shared/constants.js";
import { createApplicationError, ERROR_CODES } from "../shared/errors.js";
import {
  createSafeUploadStatus,
  validateSafeUploadStatus
} from "../shared/drive-upload.js";

export function createDriveUploadState({
  storage = globalThis.chrome?.storage?.session
} = {}) {
  if (!storage) throw new TypeError("Upload status storage is required.");

  async function clear() {
    try {
      await storage.remove(STORAGE_KEYS.DRIVE_UPLOAD_STATUS);
    } catch {
      throw createApplicationError({ code: ERROR_CODES.UPLOAD_STATE_FAILED });
    }
  }

  async function read() {
    let stored;
    try {
      stored = await storage.get(STORAGE_KEYS.DRIVE_UPLOAD_STATUS);
    } catch {
      throw createApplicationError({ code: ERROR_CODES.UPLOAD_STATE_FAILED });
    }
    const status = stored?.[STORAGE_KEYS.DRIVE_UPLOAD_STATUS];
    if (status === undefined) {
      return createSafeUploadStatus({ state: "idle" });
    }
    if (!validateSafeUploadStatus(status)) {
      await clear();
      return createSafeUploadStatus({ state: "idle" });
    }
    return structuredClone(status);
  }

  async function write(status) {
    if (!validateSafeUploadStatus(status)) {
      throw createApplicationError({ code: ERROR_CODES.UPLOAD_STATE_FAILED });
    }
    try {
      await storage.set({
        [STORAGE_KEYS.DRIVE_UPLOAD_STATUS]: structuredClone(status)
      });
    } catch {
      throw createApplicationError({ code: ERROR_CODES.UPLOAD_STATE_FAILED });
    }
    return structuredClone(status);
  }

  return Object.freeze({ clear, read, write });
}
