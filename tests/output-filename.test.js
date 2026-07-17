import assert from "node:assert/strict";
import test from "node:test";

import {
  createAutomaticOutputFilename,
  formatLocalTimestamp,
  resolveOutputFilename,
  sanitizeFilenameStem,
  selectPageLabel,
  validateResolvedOutputFilename
} from "../src/shared/output-filename.js";

test("creates a deterministic local-time automatic filename with millisecond precision", () => {
  const localDate = new Date(2026, 6, 17, 14, 5, 6, 7);
  const result = createAutomaticOutputFilename({
    title: "Quarterly Results",
    hostname: "example.com",
    now: () => localDate
  });
  assert.equal(
    result.filename,
    "DriveCapture_Quarterly-Results_2026-07-17_14-05-06-007.jpg"
  );
  assert.equal(formatLocalTimestamp(localDate), "2026-07-17_14-05-06-007");
  assert.equal(result.source, "automatic");
});

test("prefers a useful title, falls back to hostname, then Webpage", () => {
  assert.deepEqual(selectPageLabel({
    title: "Project Overview",
    hostname: "example.com"
  }), { label: "Project-Overview", source: "title" });
  assert.deepEqual(selectPageLabel({
    title: "Untitled",
    hostname: "docs.example.com"
  }), { label: "docs.example.com", source: "hostname" });
  assert.deepEqual(selectPageLabel({
    title: "???",
    hostname: ""
  }), { label: "Webpage", source: "fallback" });
});

test("sanitizes reserved characters, controls, whitespace, and punctuation-only names", () => {
  assert.equal(
    sanitizeFilenameStem("  Report:/\\*?\"<>|\u0000  July  "),
    "Report-July"
  );
  assert.equal(sanitizeFilenameStem("... --- ___ ..."), "");
  assert.equal(sanitizeFilenameStem("Résumé 東京"), "Résumé-東京");
  assert.equal(sanitizeFilenameStem("Report...__---Final"), "Report-Final");
});

test("normalizes JPEG extensions and always emits exactly one lowercase .jpg", () => {
  for (const requestedFilename of [
    "Capture",
    "Capture.jpg",
    "Capture.JPEG",
    "Capture.jpg.jpeg.JPG"
  ]) {
    assert.equal(
      resolveOutputFilename({ requestedFilename }).filename,
      "Capture.jpg"
    );
  }
});

test("uses automatic naming for empty input and records custom filename source", () => {
  const automatic = resolveOutputFilename({
    requestedFilename: "",
    title: "Example",
    now: () => new Date(2026, 0, 2, 3, 4, 5, 6)
  });
  assert.equal(automatic.source, "automatic");
  const custom = resolveOutputFilename({ requestedFilename: "My Capture" });
  assert.deepEqual(
    { filename: custom.filename, source: custom.source },
    { filename: "My-Capture.jpg", source: "custom" }
  );
});

test("rejects custom names that contain no letters or numbers", () => {
  for (const requestedFilename of ["...", "---", " /:*? ", "😀😀"]) {
    assert.throws(
      () => resolveOutputFilename({ requestedFilename }),
      (error) => error.code === "INVALID_OUTPUT_FILENAME"
    );
  }
});

test("limits complete names to 140 Unicode-safe code points without splitting surrogates", () => {
  const result = resolveOutputFilename({
    requestedFilename: `${"𐐀".repeat(200)}Capture`
  });
  assert.ok(Array.from(result.filename).length <= 140);
  assert.equal(result.filename.endsWith(".jpg"), true);
  assert.equal(result.filename.endsWith("\ud801.jpg"), false);
});

test("automatic labels are capped at 70 characters and exclude URL paths and queries", () => {
  const result = createAutomaticOutputFilename({
    title: "A".repeat(100),
    hostname: "example.com",
    now: () => new Date(2026, 0, 2, 3, 4, 5, 6)
  });
  assert.equal(result.filename.includes("A".repeat(71)), false);
  assert.ok(Array.from(result.filename).length <= 140);

  const fallback = createAutomaticOutputFilename({
    title: "",
    hostname: "example.com",
    now: () => new Date(2026, 0, 2, 3, 4, 5, 6)
  });
  assert.equal(fallback.filename.includes("private"), false);
  assert.equal(fallback.filename.includes("?"), false);
});

test("validates only canonical resolved filename metadata", () => {
  assert.deepEqual(
    validateResolvedOutputFilename("Capture.jpg", "custom"),
    { filename: "Capture.jpg", source: "custom" }
  );
  for (const [filename, source] of [
    ["Capture.jpeg", "custom"],
    ["Capture.JPG", "custom"],
    ["Capture/secret.jpg", "custom"],
    ["Capture.jpg", "unknown"]
  ]) {
    assert.throws(
      () => validateResolvedOutputFilename(filename, source),
      (error) => error.code === "INVALID_OUTPUT_FILENAME"
    );
  }
});
