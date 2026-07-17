(() => {
  const KEY = "__driveCaptureOverlayControllerV1";
  if (globalThis[KEY]) return;

  const ATTRIBUTE = "data-drivecapture-element-id";
  let inventory = new Map();
  let nextId = 1;
  let root = document.documentElement;

  const appError = (code, message) => ({ code, message, retryable: false, context: {} });
  const viewport = () => ({ width: innerWidth, height: innerHeight });
  const rectObject = (rect) => ({
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height
  });
  const intersects = (rect, area) =>
    rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 &&
    rect.left < area.width && rect.top < area.height;
  const classify = (position, rect, area) => {
    if (position === "sticky") return "sticky-in-flow";
    if (position !== "fixed") return "unknown";
    const substantialWidth = rect.width >= area.width * 0.25;
    if (rect.top <= 2 && substantialWidth) return "top-overlay";
    if (rect.bottom >= area.height - 2 && substantialWidth) return "bottom-overlay";
    return "floating-overlay";
  };
  const suppressible = (candidate) =>
    candidate.position === "fixed" &&
    ["top-overlay", "bottom-overlay", "floating-overlay"].includes(candidate.classification);

  function restoreEntry(entry) {
    if (entry.visibilityModified) {
      if (entry.hadInlineVisibility) {
        entry.element.style.setProperty(
          "visibility",
          entry.inlineVisibility,
          entry.inlineVisibilityPriority
        );
      } else {
        entry.element.style.removeProperty("visibility");
      }
    }
    if (entry.hadAttribute) {
      entry.element.setAttribute(ATTRIBUTE, entry.attributeValue);
    } else {
      entry.element.removeAttribute(ATTRIBUTE);
    }
  }

  function restore() {
    if (document.documentElement !== root) {
      inventory = new Map();
      return {
        detected: 0,
        suppressed: 0,
        restored: 0,
        restorationSucceeded: false,
        applicable: false
      };
    }
    const entries = [...inventory.values()];
    const detected = entries.length;
    const suppressed = entries.filter((entry) => entry.wasSuppressed).length;
    let restored = 0;
    let failed = 0;
    for (const entry of entries) {
      try {
        restoreEntry(entry);
        restored += 1;
      } catch {
        failed += 1;
      }
    }
    inventory = new Map();
    return {
      detected,
      suppressed,
      restored,
      restorationSucceeded: failed === 0,
      applicable: true
    };
  }

  function begin() {
    const previous = restore();
    if (previous.applicable && !previous.restorationSucceeded) {
      throw appError("OVERLAY_RESTORATION_FAILED",
        "DriveCapture could not restore every modified page overlay.");
    }
    inventory = new Map();
    nextId = 1;
    root = document.documentElement;
    return { ready: true };
  }

  function scan(maxCandidates) {
    let elements;
    try {
      elements = document.querySelectorAll("*");
    } catch {
      throw appError("OVERLAY_SCAN_FAILED",
        "DriveCapture could not inspect fixed and sticky page elements safely.");
    }
    const area = viewport();
    const visibleCandidates = [];
    try {
      for (const element of elements) {
        const style = getComputedStyle(element);
        if (style.position !== "fixed" && style.position !== "sticky") continue;
        const rect = rectObject(element.getBoundingClientRect());
        const opacity = Number.parseFloat(style.opacity);
        if (style.display === "none" || style.visibility === "hidden" ||
            !(opacity > 0) || !intersects(rect, area)) continue;

        let entry = inventory.get(element);
        if (!entry) {
          if (inventory.size >= maxCandidates) {
            throw appError("OVERLAY_LIMIT_EXCEEDED",
              "The page contains too many fixed or sticky elements to track safely.");
          }
          const elementId = `drivecapture-${nextId}`;
          nextId += 1;
          entry = {
            element,
            elementId,
            hadAttribute: element.hasAttribute(ATTRIBUTE),
            attributeValue: element.getAttribute(ATTRIBUTE),
            hadInlineVisibility: element.style.getPropertyValue("visibility") !== "",
            inlineVisibility: element.style.getPropertyValue("visibility"),
            inlineVisibilityPriority: element.style.getPropertyPriority("visibility"),
            visibilityModified: false,
            wasSuppressed: false,
            position: style.position,
            classification: classify(style.position, rect, area)
          };
          element.setAttribute(ATTRIBUTE, elementId);
          inventory.set(element, entry);
        }
        visibleCandidates.push({
          elementId: entry.elementId,
          position: style.position,
          boundingRect: rect,
          viewport: area,
          zIndex: String(style.zIndex),
          visibility: String(style.visibility),
          opacity,
          pointerEvents: String(style.pointerEvents),
          intersectsViewport: true,
          classification: entry.classification
        });
      }
    } catch (error) {
      if (error?.code) throw error;
      throw appError("OVERLAY_SCAN_FAILED",
        "DriveCapture could not inspect fixed and sticky page elements safely.");
    }
    return visibleCandidates;
  }

  function prepare({ suppress, maxCandidates }) {
    if (typeof suppress !== "boolean" || !Number.isInteger(maxCandidates) ||
        maxCandidates <= 0) {
      throw appError("OVERLAY_SCAN_FAILED",
        "DriveCapture could not inspect fixed and sticky page elements safely.");
    }
    const candidates = scan(maxCandidates);
    if (suppress) {
      try {
        for (const entry of inventory.values()) {
          if (!suppressible(entry) || entry.visibilityModified) continue;
          entry.element.style.setProperty("visibility", "hidden", "important");
          entry.visibilityModified = true;
          entry.wasSuppressed = true;
        }
      } catch {
        throw appError("OVERLAY_SUPPRESSION_FAILED",
          "Repeated page overlays could not be suppressed safely.");
      }
    }
    return {
      candidates,
      detected: inventory.size,
      suppressed: [...inventory.values()].filter((entry) => entry.wasSuppressed).length,
      suppressionApplied: Boolean(suppress)
    };
  }

  globalThis[KEY] = Object.freeze({ begin, prepare, restore });
})();
