import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const controllerSource = await readFile(
  new URL("../src/content/page-measurement.js", import.meta.url),
  "utf8"
);
const overlaySource = await readFile(
  new URL("../src/content/page-overlays.js", import.meta.url),
  "utf8"
);

function createControllerHarness() {
  let listener;
  const root = { scrollWidth: 1000, scrollHeight: 2400 };
  const body = { scrollWidth: 1000, scrollHeight: 2400 };
  const location = { href: "https://example.com/page1", hostname: "example.com" };
  const context = {
    chrome: {
      runtime: {
        onMessage: {
          addListener(value) {
            listener = value;
          }
        }
      }
    },
    document: {
      documentElement: root,
      body,
      scrollingElement: root,
      querySelectorAll() { return []; }
    },
    innerHeight: 800,
    innerWidth: 1000,
    location,
    performance: {
      now: () => 0,
      timeOrigin: 123
    },
    scrollX: 0,
    scrollY: 0,
    getComputedStyle() {
      return {
        position: "static",
        display: "block",
        visibility: "visible",
        opacity: "1",
        zIndex: "auto",
        pointerEvents: "auto"
      };
    },
    setTimeout,
    window: {
      devicePixelRatio: 2,
      innerHeight: 800,
      innerWidth: 1000,
      scrollX: 0,
      scrollY: 0,
      scrollTo() {}
    }
  };
  context.globalThis = context;
  vm.runInNewContext(overlaySource, context);
  vm.runInNewContext(controllerSource, context);

  async function send(message) {
    return new Promise((resolve, reject) => {
      const keepChannelOpen = listener(message, {}, resolve);
      if (keepChannelOpen !== true) {
        reject(new Error("The controller did not keep the response channel open."));
      }
    });
  }

  return { location, send };
}

function request(type, payload = {}) {
  return {
    version: 1,
    type,
    source: "service-worker",
    target: "page",
    requestId: "request-1",
    payload
  };
}

test("allows same-document history URL changes without reporting PAGE_CHANGED", async () => {
  const { location, send } = createControllerHarness();
  const initialized = await send(
    request("PAGE_CONTROLLER_INITIALIZE_REQUEST", { maxViewportChange: 2 })
  );

  location.href = "https://example.com/page2";

  const measured = await send(
    request("PAGE_MEASUREMENT_REQUEST", {
      identity: initialized.payload.identity
    })
  );

  assert.equal(measured.type, "PAGE_MEASUREMENT_RESPONSE");
  assert.equal(measured.payload.rawMeasurement.documentElementScrollHeight, 2400);
});

test("interrupts settle or render waits after a page-controller cancellation", async () => {
  const { send } = createControllerHarness();
  const initialized = await send(
    request("PAGE_CONTROLLER_INITIALIZE_REQUEST", { maxViewportChange: 2 })
  );
  const scrolling = send(request("PAGE_SCROLL_STEP_REQUEST", {
    identity: initialized.payload.identity,
    targetY: 800,
    previousDocumentHeight: 2400,
    settleTimeoutMs: 1000,
    tolerance: 2,
    renderDelayMs: 250
  }));

  await new Promise((resolve) => setTimeout(resolve, 5));
  const cancelled = await send(request("PAGE_CONTROLLER_CANCEL_REQUEST"));
  const outcome = await scrolling;

  assert.equal(cancelled.type, "PAGE_CONTROLLER_CANCEL_RESPONSE");
  assert.equal(outcome.payload.error.code, "OPERATION_CANCELLED");
});

test("acknowledges overlay preparation and restoration with serializable metadata", async () => {
  const { send } = createControllerHarness();
  const initialized = await send(
    request("PAGE_CONTROLLER_INITIALIZE_REQUEST", { maxViewportChange: 2 })
  );
  const prepared = await send(request("PAGE_OVERLAY_PREPARE_REQUEST", {
    identity: initialized.payload.identity,
    suppress: false,
    maxCandidates: 20,
    settleDelayMs: 0
  }));
  assert.equal(prepared.type, "PAGE_OVERLAY_PREPARE_RESPONSE");
  assert.equal(prepared.payload.detected, 0);
  assert.equal(prepared.payload.candidates.length, 0);

  const restored = await send(request("PAGE_OVERLAY_RESTORE_REQUEST", {
    identity: initialized.payload.identity
  }));
  assert.equal(restored.type, "PAGE_OVERLAY_RESTORE_RESPONSE");
  assert.equal(restored.payload.restorationSucceeded, true);
});
