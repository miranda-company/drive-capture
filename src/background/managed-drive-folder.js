import {
  DRIVE_DISCOVERY_MAX_PAGES,
  DRIVE_FOLDER_SCHEMA_VERSION,
  STORAGE_KEYS
} from "../shared/constants.js";
import { createApplicationError, ERROR_CODES } from "../shared/errors.js";
import {
  selectManagedFolder,
  validateFolderCacheRecord,
  validateManagedFolder
} from "../shared/google-drive.js";
import { DriveRequestError } from "./google-drive-client.js";

export function createManagedDriveFolder({
  storage = globalThis.chrome?.storage?.local,
  request: defaultRequest
} = {}) {
  if (!storage) {
    throw new TypeError("Managed folder adapters are required.");
  }
  let inFlight = null;

  async function clearCache() {
    try {
      await storage.remove(STORAGE_KEYS.MANAGED_DRIVE_FOLDER_ID);
    } catch {
      throw createApplicationError({ code: ERROR_CODES.DRIVE_FOLDER_CACHE_FAILED });
    }
  }

  async function readCache() {
    let stored;
    try {
      stored = await storage.get(STORAGE_KEYS.MANAGED_DRIVE_FOLDER_ID);
    } catch {
      throw createApplicationError({ code: ERROR_CODES.DRIVE_FOLDER_CACHE_FAILED });
    }
    const record = stored?.[STORAGE_KEYS.MANAGED_DRIVE_FOLDER_ID];
    if (record === undefined) return null;
    if (!validateFolderCacheRecord(record)) {
      await clearCache();
      return null;
    }
    return { ...record };
  }

  async function writeCache(folderId) {
    const record = { folderId, schemaVersion: DRIVE_FOLDER_SCHEMA_VERSION };
    if (!validateFolderCacheRecord(record)) {
      throw createApplicationError({ code: ERROR_CODES.DRIVE_FOLDER_CACHE_FAILED });
    }
    try {
      await storage.set({ [STORAGE_KEYS.MANAGED_DRIVE_FOLDER_ID]: record });
    } catch {
      throw createApplicationError({ code: ERROR_CODES.DRIVE_FOLDER_CACHE_FAILED });
    }
  }

  async function ensureUnsafe(request) {
    if (typeof request !== "function") {
      throw new TypeError("A Drive request adapter is required.");
    }
    const cached = await readCache();
    if (cached) {
      try {
        const folder = await request({
          operation: "get-folder",
          folderId: cached.folderId
        });
        if (validateManagedFolder(folder, cached.folderId)) {
          return { folder, source: "cached", duplicateCount: 0 };
        }
        await clearCache();
      } catch (error) {
        if (error instanceof DriveRequestError && error.status === 404) {
          await clearCache();
        } else if (error?.code === ERROR_CODES.DRIVE_ACCESS_DENIED) {
          await clearCache();
        } else {
          throw error;
        }
      }
    }

    const discovered = [];
    let pageToken;
    for (let page = 0; page < DRIVE_DISCOVERY_MAX_PAGES; page += 1) {
      let response;
      try {
        response = await request({ operation: "list-folders", pageToken });
      } catch (error) {
        if (error?.code) throw error;
        throw createApplicationError({ code: ERROR_CODES.DRIVE_FOLDER_DISCOVERY_FAILED });
      }
      if (!response || !Array.isArray(response.files) ||
          (response.nextPageToken !== undefined &&
           typeof response.nextPageToken !== "string")) {
        throw createApplicationError({ code: ERROR_CODES.DRIVE_FOLDER_DISCOVERY_FAILED });
      }
      discovered.push(...response.files);
      pageToken = response.nextPageToken;
      if (!pageToken) break;
      if (page === DRIVE_DISCOVERY_MAX_PAGES - 1) {
        throw createApplicationError({ code: ERROR_CODES.DRIVE_FOLDER_DISCOVERY_FAILED });
      }
    }

    const selected = selectManagedFolder(discovered);
    if (selected) {
      await writeCache(selected.folder.id);
      return {
        folder: selected.folder,
        source: "discovered",
        duplicateCount: selected.duplicateCount
      };
    }

    let created;
    try {
      created = await request({ operation: "create-folder" });
    } catch (error) {
      if (error?.code) throw error;
      throw createApplicationError({ code: ERROR_CODES.DRIVE_FOLDER_CREATE_FAILED });
    }
    if (!validateManagedFolder(created)) {
      throw createApplicationError({ code: ERROR_CODES.DRIVE_FOLDER_CREATE_FAILED });
    }
    await writeCache(created.id);
    return { folder: created, source: "created", duplicateCount: 0 };
  }

  function ensure(request = defaultRequest) {
    if (inFlight) return inFlight;
    inFlight = ensureUnsafe(request).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return Object.freeze({ ensure, readCache, clearCache });
}
