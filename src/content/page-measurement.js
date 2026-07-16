(() => {
  const KEY = "__driveCaptureMeasurementControllerV1";
  if (globalThis[KEY]) return;

  const VERSION = 1;
  const PAGE = "page";
  const WORKER = "service-worker";
  const TYPES = {
    INIT: "PAGE_CONTROLLER_INITIALIZE_REQUEST",
    INIT_RESULT: "PAGE_CONTROLLER_INITIALIZE_RESPONSE",
    MEASURE: "PAGE_MEASUREMENT_REQUEST",
    MEASURE_RESULT: "PAGE_MEASUREMENT_RESPONSE",
    SCROLL: "PAGE_SCROLL_STEP_REQUEST",
    SCROLL_RESULT: "PAGE_SCROLL_STEP_RESULT",
    RESTORE: "PAGE_RESTORE_REQUEST",
    RESTORE_RESULT: "PAGE_RESTORE_RESULT",
    ERROR: "APPLICATION_ERROR_RESPONSE"
  };
  let state = null;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const hashHref = () => {
    let hash = 0x811c9dc5;
    for (const character of location.href) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  };
  const rawMeasurement = () => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollX: Math.max(0, window.scrollX),
    scrollY: Math.max(0, window.scrollY),
    devicePixelRatio: window.devicePixelRatio,
    documentElementScrollWidth: document.documentElement?.scrollWidth ?? 0,
    documentElementScrollHeight: document.documentElement?.scrollHeight ?? 0,
    bodyScrollWidth: document.body?.scrollWidth ?? 0,
    bodyScrollHeight: document.body?.scrollHeight ?? 0,
    scrollingElementKind: document.scrollingElement === document.documentElement
      ? "document-element" : document.scrollingElement === document.body ? "body" :
        document.scrollingElement ? "other" : "none"
  });
  const identityMatches = (identity) => state && identity &&
    identity.hrefFingerprint === state.identity.hrefFingerprint &&
    identity.timeOrigin === state.identity.timeOrigin &&
    hashHref() === state.identity.hrefFingerprint &&
    performance.timeOrigin === state.identity.timeOrigin &&
    document.documentElement === state.root;
  const appError = (code, message) => ({ code, message, retryable: false, context: {} });
  const assertIdentity = (identity, checkViewport = true) => {
    if (!identityMatches(identity)) throw appError("PAGE_CHANGED", "The page changed while the operation was running.");
    if (checkViewport && (Math.abs(innerWidth - state.viewport.width) > state.maxViewportChange ||
        Math.abs(innerHeight - state.viewport.height) > state.maxViewportChange)) {
      throw appError("VIEWPORT_CHANGED", "The browser viewport changed during the diagnostic.");
    }
  };
  async function settle(timeoutMs, tolerance) {
    const start = performance.now();
    let previousX = scrollX;
    let previousY = scrollY;
    let stableChecks = 0;
    while (performance.now() - start < timeoutMs) {
      await delay(50);
      const stable = Math.abs(scrollX - previousX) <= tolerance && Math.abs(scrollY - previousY) <= tolerance;
      stableChecks = stable ? stableChecks + 1 : 0;
      if (stableChecks >= 2) return { settled: true, timedOut: false };
      previousX = scrollX;
      previousY = scrollY;
    }
    await delay(50);
    if (Math.abs(scrollX - previousX) <= tolerance && Math.abs(scrollY - previousY) <= tolerance) {
      return { settled: true, timedOut: true };
    }
    throw appError("SCROLL_UNSTABLE", "The page did not settle after scrolling.");
  }
  const envelope = (request, type, payload) => ({
    version: VERSION, type, source: PAGE, target: WORKER, requestId: request.requestId, payload
  });

  async function handle(message) {
    if (message.type === TYPES.INIT) {
      const measurement = rawMeasurement();
      state = {
        root: document.documentElement,
        identity: { hrefFingerprint: hashHref(), timeOrigin: performance.timeOrigin, documentElementReferenceVersion: 1 },
        original: { x: measurement.scrollX, y: measurement.scrollY },
        viewport: { width: measurement.innerWidth, height: measurement.innerHeight },
        maxViewportChange: message.payload.maxViewportChange
      };
      return envelope(message, TYPES.INIT_RESULT, { identity: state.identity, hostname: location.hostname });
    }
    if (!state) throw appError("PAGE_SCRIPT_UNAVAILABLE", "DriveCapture could not communicate with this page.");
    if (message.type === TYPES.MEASURE) {
      assertIdentity(message.payload.identity);
      return envelope(message, TYPES.MEASURE_RESULT, { identity: state.identity, rawMeasurement: rawMeasurement() });
    }
    if (message.type === TYPES.SCROLL) {
      assertIdentity(message.payload.identity);
      window.scrollTo({ left: state.original.x, top: message.payload.targetY, behavior: "instant" });
      const settled = await settle(message.payload.settleTimeoutMs, message.payload.tolerance);
      await delay(message.payload.renderDelayMs);
      assertIdentity(message.payload.identity);
      const measurement = rawMeasurement();
      const actualY = measurement.scrollY;
      return envelope(message, TYPES.SCROLL_RESULT, {
        identity: state.identity,
        requestedY: message.payload.targetY,
        actualY,
        clamped: Math.abs(actualY - message.payload.targetY) > message.payload.tolerance,
        timedOut: settled.timedOut,
        rawMeasurement: measurement,
        documentHeightChanged: Math.max(measurement.documentElementScrollHeight, measurement.bodyScrollHeight) !== message.payload.previousDocumentHeight
      });
    }
    if (message.type === TYPES.RESTORE) {
      assertIdentity(message.payload.identity, false);
      window.scrollTo({ left: state.original.x, top: state.original.y, behavior: "instant" });
      const settled = await settle(message.payload.settleTimeoutMs, message.payload.tolerance);
      const actual = { x: Math.max(0, scrollX), y: Math.max(0, scrollY) };
      return envelope(message, TYPES.RESTORE_RESULT, {
        identity: state.identity, actual, settled: settled.settled,
        withinTolerance: Math.abs(actual.x - state.original.x) <= message.payload.tolerance && Math.abs(actual.y - state.original.y) <= message.payload.tolerance
      });
    }
    throw appError("INVALID_MESSAGE", "DriveCapture received an invalid internal message.");
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.version !== VERSION || message.source !== WORKER || message.target !== PAGE) return false;
    handle(message).then(sendResponse).catch((error) => {
      const safe = error?.code ? error : appError("INTERNAL_ERROR", "DriveCapture encountered an unexpected error.");
      sendResponse(envelope(message, TYPES.ERROR, { ok: false, error: safe }));
    });
    return true;
  });
  globalThis[KEY] = true;
})();
