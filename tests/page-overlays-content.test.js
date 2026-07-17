import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../src/content/page-overlays.js", import.meta.url),
  "utf8"
);

function fakeElement(computed, rect, {
  inlineVisibility = "",
  inlinePriority = "",
  attributeValue = null,
  failRestore = false
} = {}) {
  const properties = new Map();
  if (inlineVisibility !== "") properties.set("visibility", {
    value: inlineVisibility,
    priority: inlinePriority
  });
  const attributes = new Map();
  if (attributeValue !== null) {
    attributes.set("data-drivecapture-element-id", attributeValue);
  }
  return {
    computed,
    getBoundingClientRect: () => ({ ...rect }),
    style: {
      getPropertyValue(name) { return properties.get(name)?.value ?? ""; },
      getPropertyPriority(name) { return properties.get(name)?.priority ?? ""; },
      setProperty(name, value, priority = "") {
        properties.set(name, { value, priority });
      },
      removeProperty(name) {
        if (failRestore && name === "visibility") throw new Error("restore");
        properties.delete(name);
      }
    },
    hasAttribute(name) { return attributes.has(name); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) {
      if (failRestore && name === "data-drivecapture-element-id") throw new Error("restore");
      attributes.delete(name);
    },
    readVisibility() { return properties.get("visibility") ?? null; },
    readAttribute() { return attributes.get("data-drivecapture-element-id") ?? null; }
  };
}

const box = (top, left, width, height) => ({
  top, left, width, height, right: left + width, bottom: top + height
});

function harness(elements) {
  const root = {};
  const context = {
    document: {
      documentElement: root,
      querySelectorAll() { return elements; }
    },
    innerWidth: 1000,
    innerHeight: 800,
    getComputedStyle(element) {
      return {
        position: "fixed",
        display: "block",
        visibility: "visible",
        opacity: "1",
        zIndex: "auto",
        pointerEvents: "auto",
        ...element.computed
      };
    }
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return context.__driveCaptureOverlayControllerV1;
}

test("inventories visible candidates and suppresses only qualifying fixed overlays after the first segment", () => {
  const top = fakeElement({ position: "fixed" }, box(0, 0, 1000, 80));
  const bottom = fakeElement({ position: "fixed" }, box(720, 0, 1000, 80));
  const floating = fakeElement({ position: "fixed" }, box(700, 900, 60, 60));
  const sticky = fakeElement({ position: "sticky" }, box(0, 0, 600, 40));
  const hidden = fakeElement({ position: "fixed", display: "none" }, box(0, 0, 1000, 20));
  const transparent = fakeElement({ position: "fixed", opacity: "0" }, box(0, 0, 1000, 20));
  const zero = fakeElement({ position: "fixed" }, box(0, 0, 0, 20));
  const offscreen = fakeElement({ position: "fixed" }, box(900, 0, 100, 20));
  const controller = harness([top, bottom, floating, sticky, hidden, transparent, zero, offscreen]);
  controller.begin();

  const first = controller.prepare({ suppress: false, maxCandidates: 20 });
  assert.equal(first.detected, 4);
  assert.equal(first.suppressed, 0);
  assert.equal(top.readVisibility(), null);

  const later = controller.prepare({ suppress: true, maxCandidates: 20 });
  assert.equal(later.suppressed, 3);
  assert.deepEqual(top.readVisibility(), { value: "hidden", priority: "important" });
  assert.equal(sticky.readVisibility(), null);

  const restored = controller.restore();
  assert.equal(restored.restorationSucceeded, true);
  assert.equal(restored.restored, 4);
  assert.equal(top.readVisibility(), null);
  assert.equal(top.readAttribute(), null);
});

test("preserves inline visibility priority and a pre-existing temporary attribute", () => {
  const element = fakeElement(
    { position: "fixed" },
    box(0, 0, 1000, 50),
    {
      inlineVisibility: "collapse",
      inlinePriority: "important",
      attributeValue: "page-owned-value"
    }
  );
  const controller = harness([element]);
  controller.begin();
  controller.prepare({ suppress: true, maxCandidates: 5 });
  assert.deepEqual(element.readVisibility(), { value: "hidden", priority: "important" });
  assert.notEqual(element.readAttribute(), "page-owned-value");
  controller.restore();
  assert.deepEqual(element.readVisibility(), { value: "collapse", priority: "important" });
  assert.equal(element.readAttribute(), "page-owned-value");
});

test("tracks newly appearing overlays, supports repeated cycles, and enforces the candidate limit", () => {
  const first = fakeElement({ position: "fixed" }, box(0, 0, 1000, 50));
  const elements = [first];
  const controller = harness(elements);
  controller.begin();
  controller.prepare({ suppress: false, maxCandidates: 2 });
  elements.push(fakeElement({ position: "fixed" }, box(740, 900, 50, 50)));
  assert.equal(controller.prepare({ suppress: true, maxCandidates: 2 }).detected, 2);
  assert.equal(controller.restore().restored, 2);
  controller.begin();
  assert.equal(controller.prepare({ suppress: false, maxCandidates: 2 }).detected, 2);
  controller.restore();

  const limited = harness([
    fakeElement({ position: "fixed" }, box(0, 0, 1000, 50)),
    fakeElement({ position: "fixed" }, box(740, 900, 50, 50))
  ]);
  limited.begin();
  assert.throws(
    () => limited.prepare({ suppress: false, maxCandidates: 1 }),
    (error) => error.code === "OVERLAY_LIMIT_EXCEEDED"
  );
  limited.restore();
});

test("reports partial restoration failure without claiming success", () => {
  const element = fakeElement(
    { position: "fixed" },
    box(0, 0, 1000, 50),
    { failRestore: true }
  );
  const controller = harness([element]);
  controller.begin();
  controller.prepare({ suppress: true, maxCandidates: 5 });
  const result = controller.restore();
  assert.equal(result.restorationSucceeded, false);
  assert.equal(result.restored, 0);
});
