import assert from "node:assert/strict";
import test from "node:test";

import { DRIVE_FILE_SCOPE } from "../src/shared/constants.js";
import { createGoogleAuth } from "../src/background/google-auth.js";
import { OAUTH_CLIENT_ID_PLACEHOLDER } from "../src/shared/google-drive.js";

const manifest = (clientId = "123456-example.apps.googleusercontent.com") => ({
  oauth2: { client_id: clientId, scopes: [DRIVE_FILE_SCOPE] }
});

test("placeholder configuration never calls getAuthToken", async () => {
  let calls = 0;
  const auth = createGoogleAuth({
    identity: { async getAuthToken() { calls += 1; } },
    getManifest: () => manifest(OAUTH_CLIENT_ID_PLACEHOLDER)
  });
  await assert.rejects(auth.acquireToken({ interactive: true }),
    (error) => error.code === "OAUTH_NOT_CONFIGURED");
  assert.equal(calls, 0);
});

test("non-interactive and explicit interactive token calls remain distinct", async () => {
  const options = [];
  const auth = createGoogleAuth({
    identity: {
      async getAuthToken(value) {
        options.push(value);
        return { token: "transient", grantedScopes: [DRIVE_FILE_SCOPE] };
      }
    },
    getManifest: manifest
  });
  assert.equal((await auth.acquireToken({ interactive: false })).grantedScopeConfirmed, true);
  await auth.acquireToken({ interactive: true });
  assert.deepEqual(options, [{ interactive: false }, { interactive: true }]);
});

test("maps prompt-required, cancellation, missing token, and missing scope safely", async () => {
  for (const [interactive, identity, code] of [
    [false, { getAuthToken: async () => { throw new Error("prompt"); } }, "AUTH_REQUIRED"],
    [true, { getAuthToken: async () => { throw new Error("cancel"); } }, "AUTH_CANCELLED"],
    [true, { getAuthToken: async () => ({ token: "" }) }, "AUTH_FAILED"],
    [true, { getAuthToken: async () => ({ token: "x", grantedScopes: [] }) }, "AUTH_SCOPE_MISSING"]
  ]) {
    const auth = createGoogleAuth({ identity, getManifest: manifest });
    await assert.rejects(auth.acquireToken({ interactive }), (error) => error.code === code);
  }
});

test("removes one token and disconnects through cache-only identity methods", async () => {
  const calls = [];
  const auth = createGoogleAuth({
    identity: {
      getAuthToken: async () => "x",
      removeCachedAuthToken: async (value) => calls.push(["remove", value]),
      clearAllCachedAuthTokens: async () => calls.push(["clear"])
    },
    getManifest: manifest
  });
  await auth.removeToken("transient");
  await auth.disconnect();
  assert.deepEqual(calls, [["remove", { token: "transient" }], ["clear"]]);
});
