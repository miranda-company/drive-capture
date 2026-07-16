import assert from "node:assert/strict";
import test from "node:test";
import {
  createPageMeasurement, validateDocumentIdentity, validatePageMeasurement,
  validateRestorationResult, validateScrollDiagnosticResult, validateScrollStepResult
} from "../src/shared/page-measurement.js";

const raw = (overrides = {}) => ({
  innerWidth: 1000, innerHeight: 800, scrollX: 12, scrollY: 34, devicePixelRatio: 2,
  documentElementScrollWidth: 1200, documentElementScrollHeight: 2100,
  bodyScrollWidth: 1100, bodyScrollHeight: 2000, scrollingElementKind: "document-element", ...overrides
});
const identity = { hrefFingerprint: "deadbeef", timeOrigin: 123, documentElementReferenceVersion: 1 };

test("measures normal dimensions and preserves original scroll", () => {
  const value = createPageMeasurement(raw());
  assert.deepEqual(value.document, { width: 1200, height: 2100 });
  assert.deepEqual(value.maximumScroll, { x: 200, y: 1300 });
  assert.deepEqual(value.originalScroll, { x: 12, y: 34 });
});
test("uses the larger body or document-element dimensions", () => {
  assert.equal(createPageMeasurement(raw({ bodyScrollHeight: 2500 })).document.height, 2500);
  assert.equal(createPageMeasurement(raw({ documentElementScrollHeight: 2600 })).document.height, 2600);
});
test("rejects zero and non-finite dimensions", () => {
  assert.throws(() => createPageMeasurement(raw({ innerHeight: 0 })));
  assert.throws(() => createPageMeasurement(raw({ bodyScrollWidth: Infinity })));
});
test("validates identities and measurement payloads", () => {
  const measurement = createPageMeasurement(raw());
  assert.equal(validateDocumentIdentity(identity), true);
  assert.equal(validateDocumentIdentity({ ...identity, hrefFingerprint: "url" }), false);
  assert.equal(validatePageMeasurement(measurement), true);
  assert.equal(validatePageMeasurement({ ...measurement, devicePixelRatio: NaN }), false);
});
test("validates scroll, restoration, and diagnostic payloads", () => {
  const measurement = createPageMeasurement(raw());
  const step = { identity, requestedY: 0, actualY: 0, clamped: false, documentHeightChanged: false, measurement };
  const restoration = { identity, actual: { x: 12, y: 34 }, withinTolerance: true, settled: true };
  assert.equal(validateScrollStepResult(step), true);
  assert.equal(validateScrollStepResult({ ...step, actualY: -1 }), false);
  assert.equal(validateRestorationResult(restoration), true);
  assert.equal(validateScrollDiagnosticResult({ hostname: "example.com", measurement, plannedPositions: [0], steps: [step], restoration, revisionCount: 0, durationMs: 10 }), true);
  assert.equal(validateScrollDiagnosticResult({ hostname: "https://example.com/path", measurement, plannedPositions: [], steps: [], restoration, revisionCount: 0, durationMs: 1 }), false);
});
