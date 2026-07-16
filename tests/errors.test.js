import assert from "node:assert/strict";
import test from "node:test";

import {
  createApplicationError,
  ERROR_CODES,
  serializeUnknownError,
  validateApplicationError
} from "../src/shared/errors.js";

test("creates a valid serializable application error", () => {
  const error = createApplicationError({
    code: ERROR_CODES.UNSUPPORTED_PAGE,
    context: { pageType: "internal" }
  });

  assert.equal(validateApplicationError(error), true);
  assert.equal(error.code, ERROR_CODES.UNSUPPORTED_PAGE);
  assert.equal(error.retryable, false);
  assert.deepEqual(error.context, { pageType: "internal" });
});

test("serializes an unknown JavaScript error without exposing its details", () => {
  const original = new Error("Bearer private-token-value");
  original.stack = "private stack trace";

  const serialized = serializeUnknownError(original, { operation: "test" });

  assert.equal(serialized.code, ERROR_CODES.INTERNAL_ERROR);
  assert.equal(serialized.message, "DriveCapture encountered an unexpected error.");
  assert.deepEqual(serialized.context, { operation: "test" });
  assert.equal(JSON.stringify(serialized).includes("private-token-value"), false);
  assert.equal(JSON.stringify(serialized).includes("stack trace"), false);
});

test("uses a stable INTERNAL_ERROR fallback", () => {
  const serialized = serializeUnknownError("unexpected failure");
  assert.equal(serialized.code, ERROR_CODES.INTERNAL_ERROR);
  assert.equal(serialized.retryable, false);
});

test("validates serialized application errors", () => {
  const valid = createApplicationError({ code: ERROR_CODES.INVALID_MESSAGE });
  assert.equal(validateApplicationError(valid), true);
  assert.equal(validateApplicationError({ ...valid, retryable: "no" }), false);
  assert.equal(validateApplicationError({ ...valid, code: "UNKNOWN" }), false);
});

test("removes secret-bearing and non-serializable error context", () => {
  const error = createApplicationError({
    code: ERROR_CODES.UPLOAD_FAILED,
    context: {
      operation: "future-test",
      accessToken: "secret-token",
      screenshot: "image-data",
      credentialUrl: "https://user:password@example.com/private",
      details: "https://example.com/callback?access_token=private",
      nested: {
        authorization: "Bearer value",
        safe: "retained"
      },
      unsupported: () => undefined
    }
  });

  assert.deepEqual(error.context, {
    operation: "future-test",
    details: "[redacted]",
    nested: { safe: "retained" }
  });
  assert.equal(validateApplicationError(error), true);
});

test("replaces a credential-bearing custom message with the safe default", () => {
  const error = createApplicationError({
    code: ERROR_CODES.UPLOAD_FAILED,
    message: "Request failed with Bearer private-token"
  });

  assert.equal(error.message, "The file could not be uploaded.");
});
