import { STORAGE_KEYS } from "../shared/constants.js";
import { createApplicationError, ERROR_CODES } from "../shared/errors.js";

export function createDriveLocalState({
  storage = globalThis.chrome?.storage?.local
} = {}) {
  if (!storage) {
    throw new TypeError("Drive local-state storage is required.");
  }

  async function isExplicitlyDisconnected() {
    let stored;
    try {
      stored = await storage.get(STORAGE_KEYS.DRIVE_EXPLICITLY_DISCONNECTED);
    } catch {
      throw createApplicationError({ code: ERROR_CODES.DRIVE_LOCAL_STATE_FAILED });
    }

    const value = stored?.[STORAGE_KEYS.DRIVE_EXPLICITLY_DISCONNECTED];
    if (value === undefined || value === false) return false;
    if (value === true) return true;

    try {
      await storage.remove(STORAGE_KEYS.DRIVE_EXPLICITLY_DISCONNECTED);
    } catch {
      throw createApplicationError({ code: ERROR_CODES.DRIVE_LOCAL_STATE_FAILED });
    }
    return false;
  }

  async function setExplicitlyDisconnected(disconnected) {
    try {
      if (disconnected) {
        await storage.set({
          [STORAGE_KEYS.DRIVE_EXPLICITLY_DISCONNECTED]: true
        });
      } else {
        await storage.remove(STORAGE_KEYS.DRIVE_EXPLICITLY_DISCONNECTED);
      }
    } catch {
      throw createApplicationError({ code: ERROR_CODES.DRIVE_LOCAL_STATE_FAILED });
    }
  }

  return Object.freeze({
    isExplicitlyDisconnected,
    setExplicitlyDisconnected
  });
}
