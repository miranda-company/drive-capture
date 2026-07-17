import { DRIVE_FILE_SCOPE } from "../shared/constants.js";
import { createApplicationError, ERROR_CODES } from "../shared/errors.js";
import { validateOAuthConfiguration } from "../shared/google-drive.js";

export function createGoogleAuth({
  identity = globalThis.chrome?.identity,
  getManifest = () => globalThis.chrome?.runtime?.getManifest()
} = {}) {
  if (!identity || typeof getManifest !== "function") {
    throw new TypeError("Google auth adapters are required.");
  }

  function configuration() {
    return validateOAuthConfiguration(getManifest()?.oauth2);
  }

  async function acquireToken({ interactive }) {
    if (!configuration().configured) {
      throw createApplicationError({ code: ERROR_CODES.OAUTH_NOT_CONFIGURED });
    }
    let tokenResult;
    try {
      tokenResult = await identity.getAuthToken({ interactive: Boolean(interactive) });
    } catch {
      throw createApplicationError({
        code: interactive ? ERROR_CODES.AUTH_CANCELLED : ERROR_CODES.AUTH_REQUIRED
      });
    }
    const token = typeof tokenResult === "string" ? tokenResult : tokenResult?.token;
    if (typeof token !== "string" || token.length === 0) {
      throw createApplicationError({
        code: interactive ? ERROR_CODES.AUTH_FAILED : ERROR_CODES.AUTH_REQUIRED
      });
    }
    const grantedScopes = typeof tokenResult === "object"
      ? tokenResult?.grantedScopes
      : undefined;
    if (grantedScopes !== undefined &&
        (!Array.isArray(grantedScopes) || !grantedScopes.includes(DRIVE_FILE_SCOPE))) {
      throw createApplicationError({ code: ERROR_CODES.AUTH_SCOPE_MISSING });
    }
    return {
      token,
      grantedScopeConfirmed: Array.isArray(grantedScopes)
        ? grantedScopes.includes(DRIVE_FILE_SCOPE)
        : false
    };
  }

  async function removeToken(token) {
    if (typeof token === "string" && token) {
      await identity.removeCachedAuthToken({ token });
    }
  }

  async function disconnect() {
    await identity.clearAllCachedAuthTokens();
  }

  return Object.freeze({
    configuration,
    acquireToken,
    removeToken,
    disconnect
  });
}
