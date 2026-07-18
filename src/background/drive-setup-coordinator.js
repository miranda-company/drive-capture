import { createApplicationError, ERROR_CODES } from "../shared/errors.js";
import { createSafeDriveSetupResult } from "../shared/google-drive.js";
import { createRequestId } from "../shared/messages.js";
import { DriveRequestError } from "./google-drive-client.js";

export function createDriveSetupCoordinator({
  auth,
  driveClient,
  managedFolder,
  localState,
  jobState,
  now = Date.now,
  createJobId = createRequestId,
  onProgress = () => undefined
}) {
  let mutationActive = false;
  let clearAfterMutation = false;
  let pendingOperation = Promise.resolve();

  function serialize(operation) {
    const result = pendingOperation.then(operation, operation);
    pendingOperation = result.catch(() => undefined);
    return result;
  }

  async function requestWithToken(initialAuth, parameters) {
    let tokenState = initialAuth;
    try {
      return await driveClient.requestJson({
        token: tokenState.token,
        ...parameters
      });
    } catch (error) {
      if (!(error instanceof DriveRequestError) || error.status !== 401) throw error;
      await auth.removeToken(tokenState.token);
      tokenState.token = "";
      try {
        const refreshed = await auth.acquireToken({ interactive: false });
        tokenState.token = refreshed.token;
        tokenState.grantedScopeConfirmed = refreshed.grantedScopeConfirmed;
      } catch {
        throw createApplicationError({ code: ERROR_CODES.AUTH_REQUIRED });
      }
      try {
        return await driveClient.requestJson({
          token: tokenState.token,
          ...parameters
        });
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
    const configuration = auth.configuration();
    if (!configuration.configured) {
      return createSafeDriveSetupResult({
        configured: false,
        connected: false,
        status: "not-configured"
      });
    }
    if (mutationActive) {
      return createSafeDriveSetupResult({
        configured: true,
        connected: false,
        status: "connecting"
      });
    }
    if (await localState.isExplicitlyDisconnected()) {
      return createSafeDriveSetupResult({
        configured: true,
        connected: false,
        status: "not-connected"
      });
    }
    let tokenState;
    try {
      tokenState = await auth.acquireToken({ interactive: false });
      return createSafeDriveSetupResult({
        configured: true,
        connected: true,
        grantedScopeConfirmed: tokenState.grantedScopeConfirmed,
        status: "connected"
      });
    } catch (error) {
      if (error?.code === ERROR_CODES.AUTH_REQUIRED) {
        return createSafeDriveSetupResult({
          configured: true,
          connected: false,
          status: "not-connected"
        });
      }
      throw error;
    } finally {
      if (tokenState) tokenState.token = "";
    }
  }

  async function runLocked(phase, operation) {
    const jobId = createJobId();
    let locked = false;
    mutationActive = true;
    try {
      try {
        await jobState.acquireJobLock({
          id: jobId,
          tabId: null,
          phase,
          startedAt: now()
        });
        locked = true;
      } catch (error) {
        if (error?.code === ERROR_CODES.CAPTURE_IN_PROGRESS) {
          throw createApplicationError({ code: ERROR_CODES.DRIVE_SETUP_BUSY });
        }
        throw error;
      }
      return await operation();
    } finally {
      if (locked) await jobState.releaseJobLock(jobId);
      mutationActive = false;
      if (clearAfterMutation) {
        clearAfterMutation = false;
        await managedFolder.clearCache();
      }
    }
  }

  async function connect() {
    return runLocked("drive-connect", async () => {
      onProgress({ state: "connecting" });
      let tokenState;
      try {
        await localState.setExplicitlyDisconnected(false);
        tokenState = await auth.acquireToken({ interactive: true });
        onProgress({ state: "checking-folder" });
        const folder = await managedFolder.ensure((parameters) =>
          requestWithToken(tokenState, parameters));
        return createSafeDriveSetupResult({
          configured: true,
          connected: true,
          grantedScopeConfirmed: tokenState.grantedScopeConfirmed,
          status: "folder-ready",
          folder: {
            name: folder.folder.name,
            source: folder.source,
            duplicateCount: folder.duplicateCount
          }
        });
      } catch (error) {
        await localState.setExplicitlyDisconnected(true);
        throw error;
      } finally {
        if (tokenState) tokenState.token = "";
      }
    });
  }

  async function ensureFolder() {
    return runLocked("drive-ensure-folder", async () => {
      if (await localState.isExplicitlyDisconnected()) {
        throw createApplicationError({ code: ERROR_CODES.AUTH_REQUIRED });
      }
      let tokenState = await auth.acquireToken({ interactive: false });
      try {
        onProgress({ state: "checking-folder" });
        const folder = await managedFolder.ensure((parameters) =>
          requestWithToken(tokenState, parameters));
        return createSafeDriveSetupResult({
          configured: true,
          connected: true,
          grantedScopeConfirmed: tokenState.grantedScopeConfirmed,
          status: "folder-ready",
          folder: {
            name: folder.folder.name,
            source: folder.source,
            duplicateCount: folder.duplicateCount
          }
        });
      } finally {
        tokenState.token = "";
      }
    });
  }

  async function disconnect() {
    return runLocked("drive-disconnect", async () => {
      await auth.disconnect();
      await managedFolder.clearCache();
      await localState.setExplicitlyDisconnected(true);
      return createSafeDriveSetupResult({
        configured: auth.configuration().configured,
        connected: false,
        status: "not-connected"
      });
    });
  }

  async function handleAccountChange() {
    if (mutationActive) {
      clearAfterMutation = true;
      return;
    }
    await managedFolder.clearCache();
  }

  return Object.freeze({
    status: () => serialize(status),
    connect: () => serialize(connect),
    ensureFolder: () => serialize(ensureFolder),
    disconnect: () => serialize(disconnect),
    handleAccountChange: () => serialize(handleAccountChange)
  });
}
