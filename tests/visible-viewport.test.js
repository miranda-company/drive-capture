import assert from "node:assert/strict";
import test from "node:test";

import { ERROR_CODES, validateApplicationError } from "../src/shared/errors.js";
import {
  estimateBase64DataUrlBytes,
  validateActiveTabResults,
  validateVisibleViewportResult
} from "../src/shared/visible-viewport.js";

function tab(url, overrides = {}) {
  return { id: 7, windowId: 3, url, ...overrides };
}

function expectUnsupportedPage(url) {
  assert.throws(
    () => validateActiveTabResults([tab(url)]),
    (error) => validateApplicationError(error) && error.code === ERROR_CODES.UNSUPPORTED_PAGE
  );
}

test("accepts a normal HTTP page", () => {
  assert.equal(validateActiveTabResults([tab("http://example.com/path")]).windowId, 3);
});

test("accepts a normal HTTPS page", () => {
  assert.equal(validateActiveTabResults([tab("https://example.com/path")]).id, 7);
});

test("rejects chrome:// pages", () => expectUnsupportedPage("chrome://extensions"));
test("rejects chrome-extension:// pages", () =>
  expectUnsupportedPage("chrome-extension://abcdefghijklmnop/popup.html"));
test("rejects file:// pages", () => expectUnsupportedPage("file:///tmp/page.html"));
test("rejects about: pages", () => expectUnsupportedPage("about:blank"));
test("rejects edge:// pages", () => expectUnsupportedPage("edge://settings"));
test("rejects view-source: pages", () =>
  expectUnsupportedPage("view-source:https://example.com"));

test("rejects both Chrome Web Store hosts", () => {
  expectUnsupportedPage("https://chromewebstore.google.com/detail/example/abcdefghijklmnop");
  expectUnsupportedPage("https://chrome.google.com/webstore/detail/example/abcdefghijklmnop");
});

test("rejects malformed and missing URLs", () => {
  expectUnsupportedPage("not a URL");
  assert.throws(
    () => validateActiveTabResults([tab("")]),
    (error) => error.code === ERROR_CODES.UNSUPPORTED_PAGE
  );
});

test("rejects missing tab identifiers and non-singleton results", () => {
  assert.throws(() => validateActiveTabResults([]), (error) => error.code === ERROR_CODES.UNSUPPORTED_PAGE);
  assert.throws(
    () => validateActiveTabResults([tab("https://one.example"), tab("https://two.example")]),
    (error) => error.code === ERROR_CODES.UNSUPPORTED_PAGE
  );
  assert.throws(
    () => validateActiveTabResults([tab("https://example.com", { id: undefined })]),
    (error) => error.code === ERROR_CODES.UNSUPPORTED_PAGE
  );
  assert.throws(
    () => validateActiveTabResults([tab("https://example.com", { windowId: undefined })]),
    (error) => error.code === ERROR_CODES.UNSUPPORTED_PAGE
  );
});

test("estimates valid JPEG Base64 data URL byte sizes with padding", () => {
  assert.equal(estimateBase64DataUrlBytes("data:image/jpeg;base64,TQ=="), 1);
  assert.equal(estimateBase64DataUrlBytes("data:image/jpeg;base64,TWE="), 2);
  assert.equal(estimateBase64DataUrlBytes("data:image/jpeg;base64,TWFu"), 3);
  assert.equal(estimateBase64DataUrlBytes("data:image/jpeg;base64,TWE"), 2);
});

test("rejects empty, wrong-MIME, missing-comma, and malformed Base64 data URLs", () => {
  const invalidValues = [
    "data:image/jpeg;base64,",
    "data:image/png;base64,TQ==",
    "data:image/jpeg;base64TQ==",
    "data:image/jpeg;base64,%%%",
    "data:image/jpeg;base64,A",
    "data:image/jpeg;base64,TQ="
  ];

  for (const value of invalidValues) {
    assert.throws(
      () => estimateBase64DataUrlBytes(value),
      (error) =>
        validateApplicationError(error) && error.code === ERROR_CODES.INVALID_CAPTURE_RESULT
    );
  }
});

test("returns a finite non-negative integer estimate", () => {
  const bytes = estimateBase64DataUrlBytes("data:image/jpeg;base64,TWFu");
  assert.equal(Number.isFinite(bytes), true);
  assert.equal(Number.isInteger(bytes), true);
  assert.equal(bytes >= 0, true);
});

const VALID_RESULT = Object.freeze({
  mode: "visible-viewport",
  dataUrl: "data:image/jpeg;base64,TWFu",
  mimeType: "image/jpeg",
  estimatedBytes: 3,
  capturedAt: 1_700_000_000_000
});

test("validates a visible-viewport result", () => {
  assert.equal(validateVisibleViewportResult(VALID_RESULT), true);
});

test("rejects wrong capture mode and MIME type", () => {
  assert.equal(validateVisibleViewportResult({ ...VALID_RESULT, mode: "full-page" }), false);
  assert.equal(validateVisibleViewportResult({ ...VALID_RESULT, mimeType: "image/png" }), false);
});

test("rejects missing timestamp, invalid size, and missing data URL", () => {
  assert.equal(validateVisibleViewportResult({ ...VALID_RESULT, capturedAt: undefined }), false);
  assert.equal(validateVisibleViewportResult({ ...VALID_RESULT, estimatedBytes: -1 }), false);
  assert.equal(validateVisibleViewportResult({ ...VALID_RESULT, estimatedBytes: 4 }), false);
  assert.equal(validateVisibleViewportResult({ ...VALID_RESULT, dataUrl: undefined }), false);
});
