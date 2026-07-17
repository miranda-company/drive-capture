import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyOverlayCandidate,
  intersectsViewport,
  isVisibleOverlayCandidate,
  OVERLAY_CLASSIFICATIONS,
  shouldSuppressOverlay
} from "../src/shared/overlay-handling.js";

const viewport = { width: 1000, height: 800 };
const rect = (top, left, width, height) => ({
  top,
  left,
  width,
  height,
  right: left + width,
  bottom: top + height
});

test("classifies fixed top, bottom, floating, sticky, and unknown candidates", () => {
  assert.equal(classifyOverlayCandidate({
    position: "fixed", rect: rect(0, 0, 1000, 80), viewport
  }), OVERLAY_CLASSIFICATIONS.TOP);
  assert.equal(classifyOverlayCandidate({
    position: "fixed", rect: rect(720, 0, 1000, 80), viewport
  }), OVERLAY_CLASSIFICATIONS.BOTTOM);
  assert.equal(classifyOverlayCandidate({
    position: "fixed", rect: rect(700, 900, 60, 60), viewport
  }), OVERLAY_CLASSIFICATIONS.FLOATING);
  assert.equal(classifyOverlayCandidate({
    position: "sticky", rect: rect(0, 0, 600, 40), viewport
  }), OVERLAY_CLASSIFICATIONS.STICKY);
  assert.equal(classifyOverlayCandidate({
    position: "relative", rect: rect(0, 0, 600, 40), viewport
  }), OVERLAY_CLASSIFICATIONS.UNKNOWN);
});

test("rejects hidden, transparent, zero-sized, and offscreen candidates", () => {
  const visible = { display: "block", visibility: "visible", opacity: "1", viewport };
  assert.equal(isVisibleOverlayCandidate({ ...visible, display: "none", rect: rect(0, 0, 100, 20) }), false);
  assert.equal(isVisibleOverlayCandidate({ ...visible, visibility: "hidden", rect: rect(0, 0, 100, 20) }), false);
  assert.equal(isVisibleOverlayCandidate({ ...visible, opacity: "0", rect: rect(0, 0, 100, 20) }), false);
  assert.equal(isVisibleOverlayCandidate({ ...visible, rect: rect(0, 0, 0, 20) }), false);
  assert.equal(intersectsViewport(rect(900, 0, 100, 20), viewport), false);
});

test("suppresses conservative fixed overlays but not sticky in-flow content", () => {
  assert.equal(shouldSuppressOverlay({
    position: "fixed", classification: OVERLAY_CLASSIFICATIONS.TOP
  }), true);
  assert.equal(shouldSuppressOverlay({
    position: "fixed", classification: OVERLAY_CLASSIFICATIONS.FLOATING
  }), true);
  assert.equal(shouldSuppressOverlay({
    position: "sticky", classification: OVERLAY_CLASSIFICATIONS.STICKY
  }), false);
});
