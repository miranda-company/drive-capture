import { createApplicationError, ERROR_CODES, serializeUnknownError } from "../shared/errors.js";
import {
  createSafeUploadResult,
  createSafeUploadStatus,
  validateDriveFileMetadata,
  validateUploadSourceMetadata
} from "../shared/drive-upload.js";
import { createRequestId } from "../shared/messages.js";
import { DriveRequestError } from "./google-drive-client.js";

export function createDriveUploadCoordinator({
  auth,
  driveClient,
  managedFolder,
  localState,
  uploadSession,
  offscreen,
  uploadState,
  jobState,
  now = Date.now,
  createJobId = createRequestId,
  onProgress = () => undefined
}) {
  let active = null;

  async function publish(status) {
    await uploadState.write(status);
    onProgress(status);
    return status;
  }

  async function progress(state, resultId) {
    return publish(createSafeUploadStatus({
      state,
      resultId,
      canUpload: false,
      updatedAt: now()
    }));
  }

  async function requestWithToken(initialTokenState, operation) {
    let tokenState = initialTokenState;
    try {
      return await operation(tokenState.token);
    } catch (error) {
      if (!(error instanceof DriveRequestError) || error.status !== 401) throw error;
      await auth.removeToken(tokenState.token);
      tokenState.token = "";
      let refreshed;
      try {
        refreshed = await auth.acquireToken({ interactive: false });
      } catch {
        throw createApplicationError({ code: ERROR_CODES.AUTH_REQUIRED });
      }
      tokenState.token = refreshed.token;
      tokenState.grantedScopeConfirmed = refreshed.grantedScopeConfirmed;
      try {
        return await operation(tokenState.token);
      } catch (retryError) {
        if (retryError instanceof DriveRequestError && retryError.status === 401) {
          await auth.removeToken(tokenState.token);
          tokenState.token = "";
          throw createApplicationError({ code: ERROR_CODES.AUTH_REQUIRED });
        }
        throw retryError;
      }
    }
  }

  async function status() {
    let stored = await uploadState.read();
    let readiness;
    try {
      readiness = await offscreen.readiness(stored.resultId ?? undefined);
    } catch {
      readiness = { available: false };
    }
    if (!readiness.available) {
      if (stored.state !== "idle") await uploadState.clear();
      return createSafeUploadStatus({ state: "idle", updatedAt: now() });
    }
    if (!validateUploadSourceMetadata(readiness)) {
      throw createApplicationError({ code: ERROR_CODES.UPLOAD_RESULT_UNAVAILABLE });
    }
    if (stored.resultId && stored.resultId !== readiness.resultId) {
      await uploadState.clear();
      stored = createSafeUploadStatus({ state: "idle", updatedAt: now() });
    }
    if (stored.resultId === readiness.resultId &&
        ["uploading", "verifying-upload", "successful", "cancelled", "failed"]
          .includes(stored.state)) {
      return stored;
    }
    return createSafeUploadStatus({
      state: "ready",
      resultId: readiness.resultId,
      canUpload: !readiness.uploaded,
      updatedAt: now()
    });
  }

  async function start({ resultId }) {
    if (typeof resultId !== "string" || !resultId) {
      throw createApplicationError({ code: ERROR_CODES.UPLOAD_RESULT_UNAVAILABLE });
    }
    const jobId = createJobId();
    let locked = false;
    let tokenState;
    let uploadSessionUrl = "";
    try {
      try {
        await jobState.acquireJobLock({
          id: jobId,
          tabId: null,
          phase: "uploading-drive-jpeg",
          startedAt: now()
        });
        locked = true;
      } catch (error) {
        if (error?.code === ERROR_CODES.CAPTURE_IN_PROGRESS) {
          throw createApplicationError({ code: ERROR_CODES.UPLOAD_BUSY });
        }
        throw error;
      }

      active = { resultId, jobId };
      await progress("preparing-upload", resultId);
      await offscreen.ensureDocument();
      const readiness = await offscreen.readiness(resultId);
      if (!validateUploadSourceMetadata(readiness) || readiness.uploaded) {
        throw createApplicationError({
          code: readiness?.uploaded
            ? ERROR_CODES.UPLOAD_ALREADY_COMPLETED
            : ERROR_CODES.UPLOAD_RESULT_UNAVAILABLE
        });
      }
      if (await localState.isExplicitlyDisconnected()) {
        throw createApplicationError({ code: ERROR_CODES.AUTH_REQUIRED });
      }

      tokenState = await auth.acquireToken({ interactive: false });
      await progress("validating-folder", resultId);
      const folder = await managedFolder.ensure((parameters) =>
        requestWithToken(tokenState, (token) =>
          driveClient.requestJson({ token, ...parameters })));
      const folderId = folder?.folder?.id;
      if (typeof folderId !== "string" || !folderId) {
        throw createApplicationError({ code: ERROR_CODES.DRIVE_FOLDER_INVALID });
      }

      await progress("starting-session", resultId);
      let session = await requestWithToken(tokenState, (token) =>
        uploadSession.start({
          token,
          folderId,
          result: readiness
        }));
      uploadSessionUrl = session.uploadSessionUrl;
      session.uploadSessionUrl = "";
      session = null;

      await progress("uploading", resultId);
      const uploaded = await offscreen.start({
        resultId,
        uploadSessionUrl,
        expectedBlobSize: readiness.blobSize,
        expectedMimeType: "image/jpeg"
      });
      uploadSessionUrl = "";

      await progress("verifying-upload", resultId);
      const expected = {
        filename: readiness.filename,
        blobSize: readiness.blobSize,
        folderId
      };
      if (!uploaded?.completed ||
          !validateDriveFileMetadata(uploaded.file, expected)) {
        throw createApplicationError({ code: ERROR_CODES.UPLOAD_VALIDATION_FAILED });
      }
      const safeResult = createSafeUploadResult(uploaded.file, expected, now());
      await offscreen.markUploaded({ resultId });
      const safeStatus = createSafeUploadStatus({
        state: "successful",
        resultId,
        canUpload: false,
        result: safeResult,
        updatedAt: now()
      });
      await publish(safeStatus);
      return safeStatus;
    } catch (error) {
      if (locked) {
        const safeError = serializeUnknownError(error);
        const failed = createSafeUploadStatus({
          state: safeError.code === ERROR_CODES.UPLOAD_ABORTED
            ? "cancelled"
            : "failed",
          resultId,
          canUpload: true,
          error: {
            code: safeError.code,
            message: safeError.message
          },
          updatedAt: now()
        });
        try { await publish(failed); } catch {}
      }
      throw error;
    } finally {
      uploadSessionUrl = "";
      if (tokenState) tokenState.token = "";
      active = null;
      if (locked) await jobState.releaseJobLock(jobId);
    }
  }

  async function cancel({ resultId }) {
    if (typeof resultId !== "string" || !resultId) {
      throw createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
    }
    if (!active || active.resultId !== resultId) return { accepted: false };
    return offscreen.cancel({ resultId });
  }

  async function clearStatus() {
    await uploadState.clear();
  }

  async function isActive() {
    if (active) return true;
    const stored = await uploadState.read();
    return ["preparing-upload", "validating-folder", "starting-session",
      "uploading", "verifying-upload"].includes(stored.state);
  }

  return Object.freeze({ status, start, cancel, clearStatus, isActive });
}
