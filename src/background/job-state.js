import { STORAGE_KEYS } from "../shared/constants.js";
import { createApplicationError, ERROR_CODES } from "../shared/errors.js";

function isPlainObject(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function validateJobRecord(record) {
  const allowedKeys = new Set(["id", "tabId", "phase", "startedAt"]);
  return Boolean(
    isPlainObject(record) &&
      Object.keys(record).length === allowedKeys.size &&
      Object.keys(record).every((key) => allowedKeys.has(key)) &&
      typeof record.id === "string" &&
      record.id.length > 0 &&
      (record.tabId === null || (Number.isInteger(record.tabId) && record.tabId >= 0)) &&
      typeof record.phase === "string" &&
      record.phase.length > 0 &&
      Number.isInteger(record.startedAt) &&
      record.startedAt > 0
  );
}

function storageError(operation) {
  return createApplicationError({
    code: ERROR_CODES.INTERNAL_ERROR,
    context: { operation }
  });
}

export function createJobState(storageArea = globalThis.chrome?.storage?.session) {
  if (!storageArea) {
    throw new TypeError("A storage adapter is required.");
  }

  let pendingOperation = Promise.resolve();

  function runExclusive(operation) {
    const result = pendingOperation.then(operation, operation);
    pendingOperation = result.catch(() => undefined);
    return result;
  }

  async function readActiveJobUnsafe() {
    let stored;
    try {
      stored = await storageArea.get(STORAGE_KEYS.ACTIVE_JOB);
    } catch {
      throw storageError("read-active-job");
    }

    const record = stored?.[STORAGE_KEYS.ACTIVE_JOB];
    if (record === undefined) {
      return null;
    }

    if (!validateJobRecord(record)) {
      try {
        await storageArea.remove(STORAGE_KEYS.ACTIVE_JOB);
      } catch {
        throw storageError("remove-malformed-active-job");
      }
      return null;
    }

    return { ...record };
  }

  function readActiveJob() {
    return runExclusive(readActiveJobUnsafe);
  }

  function acquireJobLock({ id, tabId = null, phase, startedAt = Date.now() }) {
    return runExclusive(async () => {
      const activeJob = await readActiveJobUnsafe();
      if (activeJob) {
        throw createApplicationError({
          code: ERROR_CODES.CAPTURE_IN_PROGRESS,
          context: { activeJobId: activeJob.id, phase: activeJob.phase }
        });
      }

      const record = { id, tabId, phase, startedAt };
      if (!validateJobRecord(record)) {
        throw createApplicationError({
          code: ERROR_CODES.INTERNAL_ERROR,
          context: { operation: "validate-new-job" }
        });
      }

      try {
        await storageArea.set({ [STORAGE_KEYS.ACTIVE_JOB]: record });
      } catch {
        throw storageError("acquire-job-lock");
      }

      return { ...record };
    });
  }

  function updateJobPhase(jobId, phase) {
    return runExclusive(async () => {
      const activeJob = await readActiveJobUnsafe();
      if (!activeJob || activeJob.id !== jobId || typeof phase !== "string" || !phase) {
        throw createApplicationError({
          code: ERROR_CODES.INTERNAL_ERROR,
          context: { operation: "update-job-phase" }
        });
      }

      const updatedJob = { ...activeJob, phase };
      try {
        await storageArea.set({ [STORAGE_KEYS.ACTIVE_JOB]: updatedJob });
      } catch {
        throw storageError("update-job-phase");
      }

      return { ...updatedJob };
    });
  }

  function releaseJobLock(jobId) {
    return runExclusive(async () => {
      const activeJob = await readActiveJobUnsafe();
      if (!activeJob || activeJob.id !== jobId) {
        return false;
      }

      try {
        await storageArea.remove(STORAGE_KEYS.ACTIVE_JOB);
      } catch {
        throw storageError("release-job-lock");
      }

      return true;
    });
  }

  return Object.freeze({
    readActiveJob,
    acquireJobLock,
    updateJobPhase,
    releaseJobLock
  });
}

// Automatic age-based stale-job recovery is intentionally deferred. A later
// phase must define when abandoning an interrupted job is safe for page cleanup.
