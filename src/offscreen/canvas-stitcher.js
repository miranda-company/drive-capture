import {
  DEFAULT_JPEG_QUALITY,
  MAX_DIAGNOSTIC_SCROLL_STEPS,
  SEGMENT_SCALE_TOLERANCE,
  STITCH_GAP_TOLERANCE_PX
} from "../shared/constants.js";
import { createApplicationError, ERROR_CODES, validateApplicationError } from "../shared/errors.js";
import {
  calculateSegmentGeometry,
  isConsistentSegmentGeometry,
  validateSegmentPayload
} from "../shared/segment-capture.js";
import {
  calculateCanvasAllocation,
  calculateSegmentPlacement
} from "../shared/stitching.js";

const positiveFinite = (value) => Number.isFinite(value) && value > 0;
const positiveInteger = (value) => Number.isInteger(value) && value > 0;

export function decodeDrawableJpeg(dataUrl, ImageConstructor = globalThis.Image) {
  return new Promise((resolve, reject) => {
    if (typeof ImageConstructor !== "function") {
      reject(createApplicationError({ code: ERROR_CODES.SEGMENT_DECODE_FAILED }));
      return;
    }
    const image = new ImageConstructor();
    const release = () => {
      image.onload = null;
      image.onerror = null;
      image.src = "";
    };
    image.onload = () => resolve({
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release
    });
    image.onerror = () => {
      release();
      reject(createApplicationError({ code: ERROR_CODES.SEGMENT_DECODE_FAILED }));
    };
    image.src = dataUrl;
  });
}

function encodeJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.type !== "image/jpeg" || !positiveInteger(blob.size)) {
        reject(createApplicationError({ code: ERROR_CODES.IMAGE_ENCODING_FAILED }));
        return;
      }
      resolve(blob);
    }, "image/jpeg", quality);
  });
}

export function createCanvasStitchSessionManager({
  decode = decodeDrawableJpeg,
  createCanvas = () => document.createElement("canvas"),
  urlApi = globalThis.URL,
  now = Date.now,
  quality = DEFAULT_JPEG_QUALITY,
  scaleTolerance = SEGMENT_SCALE_TOLERANCE,
  gapTolerance = STITCH_GAP_TOLERANCE_PX,
  limits = {}
} = {}) {
  let active = null;
  let completed = null;

  function clearResult() {
    let cleanupFailed = false;
    if (completed?.previewUrl) {
      try { urlApi.revokeObjectURL(completed.previewUrl); }
      catch { cleanupFailed = true; }
    }
    if (completed?.canvas) {
      completed.canvas.width = 0;
      completed.canvas.height = 0;
    }
    const cleared = Boolean(completed);
    completed = null;
    if (cleanupFailed) {
      throw createApplicationError({ code: ERROR_CODES.FULL_PAGE_RESULT_CLEANUP_FAILED });
    }
    return { cleared };
  }

  function getActive(sessionId) {
    if (!active || active.sessionId !== sessionId) {
      throw createApplicationError({ code: ERROR_CODES.SEGMENT_SESSION_INVALID });
    }
    return active;
  }

  function start(payload) {
    if (active || typeof payload?.sessionId !== "string" || !payload.sessionId ||
        !positiveInteger(payload.expectedMaximumSegments) ||
        payload.expectedMaximumSegments > MAX_DIAGNOSTIC_SCROLL_STEPS ||
        !positiveFinite(payload.documentDimensions?.width) ||
        !positiveFinite(payload.documentDimensions?.height)) {
      throw createApplicationError({ code: ERROR_CODES.SEGMENT_SESSION_INVALID });
    }
    clearResult();
    active = {
      sessionId: payload.sessionId,
      expectedMaximumSegments: payload.expectedMaximumSegments,
      documentDimensions: { ...payload.documentDimensions },
      segmentCount: 0,
      geometry: null,
      canvas: null,
      context: null,
      allocation: null,
      coveredBottom: 0,
      placements: []
    };
    return { sessionId: active.sessionId, expectedMaximumSegments: active.expectedMaximumSegments };
  }

  async function draw(payload) {
    if (!validateSegmentPayload(payload)) {
      throw createApplicationError({ code: ERROR_CODES.INVALID_CAPTURE_RESULT });
    }
    const session = getActive(payload.sessionId);
    if (payload.segmentIndex !== session.segmentCount) {
      throw createApplicationError({ code: ERROR_CODES.SEGMENT_OUT_OF_ORDER });
    }
    if (session.segmentCount >= session.expectedMaximumSegments) {
      throw createApplicationError({ code: ERROR_CODES.SEGMENT_LIMIT_EXCEEDED });
    }

    let drawable;
    try {
      drawable = await decode(payload.dataUrl);
      const geometry = calculateSegmentGeometry({
        bitmap: { width: drawable.width, height: drawable.height },
        cssViewport: payload.cssViewport
      });
      if (!geometry) throw createApplicationError({ code: ERROR_CODES.SEGMENT_DECODE_FAILED });
      if (session.geometry && !isConsistentSegmentGeometry(session.geometry, geometry, scaleTolerance)) {
        throw createApplicationError({ code: ERROR_CODES.SEGMENT_GEOMETRY_CHANGED });
      }

      if (!session.canvas) {
        const allocation = calculateCanvasAllocation({
          bitmapWidth: geometry.bitmap.width,
          documentHeight: session.documentDimensions.height,
          scaleY: geometry.scale.y
        }, limits);
        if (!allocation) throw createApplicationError({ code: ERROR_CODES.CANVAS_LIMIT_EXCEEDED });
        let canvas;
        try {
          canvas = createCanvas();
          canvas.width = allocation.width;
          canvas.height = allocation.height;
        } catch {
          throw createApplicationError({ code: ERROR_CODES.CANVAS_ALLOCATION_FAILED });
        }
        let context;
        try { context = canvas.getContext("2d", { alpha: false }); }
        catch { throw createApplicationError({ code: ERROR_CODES.CANVAS_CONTEXT_UNAVAILABLE }); }
        if (!context) throw createApplicationError({ code: ERROR_CODES.CANVAS_CONTEXT_UNAVAILABLE });
        session.canvas = canvas;
        session.context = context;
        session.allocation = allocation;
        session.geometry = geometry;
      }

      const placement = calculateSegmentPlacement({
        actualScrollY: payload.actualScrollY,
        bitmapWidth: geometry.bitmap.width,
        bitmapHeight: geometry.bitmap.height,
        scaleY: geometry.scale.y,
        canvasWidth: session.allocation.width,
        canvasHeight: session.allocation.height,
        documentHeight: session.documentDimensions.height,
        coveredBottom: session.coveredBottom,
        gapTolerance
      });
      if (!placement) {
        throw createApplicationError({ code: ERROR_CODES.STITCHING_GEOMETRY_INVALID });
      }
      if (placement.hasUnsafeGap) {
        throw createApplicationError({ code: ERROR_CODES.SEGMENT_GAP_DETECTED });
      }
      const source = placement.source;
      const destination = placement.destination;
      const previousBottom = session.coveredBottom;
      try {
        session.context.drawImage(
          drawable.image,
          source.x, source.y, source.width, source.height,
          destination.x, destination.y, destination.width, destination.height
        );
      } catch {
        throw createApplicationError({ code: ERROR_CODES.SEGMENT_DRAW_FAILED });
      }
      session.coveredBottom = placement.coveredBottom;
      session.segmentCount += 1;
      const serializablePlacement = {
        segmentIndex: payload.segmentIndex,
        actualScrollY: payload.actualScrollY,
        destinationY: destination.y,
        previousBottom,
        sourceCropHeight: source.height,
        drawnHeight: destination.height,
        overlap: placement.overlap,
        uncoveredGap: placement.gap,
        overwrittenRowCount: placement.overwrittenRowCount,
        newlyCoveredPixels: placement.newlyCoveredPixels,
        coveredBottom: placement.coveredBottom
      };
      session.placements.push(serializablePlacement);
      return {
        sessionId: session.sessionId,
        ...serializablePlacement,
        bitmap: geometry.bitmap,
        scale: geometry.scale,
        estimatedBytes: payload.estimatedBytes,
        acknowledgedAt: now()
      };
    } catch (error) {
      throw validateApplicationError(error)
        ? error
        : createApplicationError({ code: ERROR_CODES.OFFSCREEN_SESSION_FAILED });
    } finally {
      drawable?.release?.();
      drawable = null;
    }
  }

  async function finish({ sessionId }) {
    const session = getActive(sessionId);
    if (!session.canvas || session.segmentCount === 0 ||
        session.allocation.height - session.coveredBottom > gapTolerance) {
      throw createApplicationError({ code: ERROR_CODES.SEGMENT_GAP_DETECTED });
    }
    const encodingStartedAt = now();
    const blob = await encodeJpeg(session.canvas, quality);
    let previewUrl;
    try { previewUrl = urlApi.createObjectURL(blob); }
    catch { throw createApplicationError({ code: ERROR_CODES.PREVIEW_URL_FAILED }); }
    if (typeof previewUrl !== "string" || !previewUrl.startsWith("blob:")) {
      throw createApplicationError({ code: ERROR_CODES.PREVIEW_URL_FAILED });
    }
    completed = {
      available: true,
      resultId: session.sessionId,
      previewUrl,
      mimeType: "image/jpeg",
      width: session.allocation.width,
      height: session.allocation.height,
      encodedBytes: blob.size,
      createdAt: now(),
      encodingDurationMs: Math.max(0, now() - encodingStartedAt),
      segmentCount: session.segmentCount,
      placements: session.placements.map((placement) => ({ ...placement })),
      stitchingDiagnostics: {
        totalOverlapPixels: session.placements.reduce(
          (total, placement) => total + placement.overlap,
          0
        ),
        totalNewlyCoveredPixels: session.placements.reduce(
          (total, placement) => total + placement.newlyCoveredPixels,
          0
        ),
        maximumGapPixels: session.placements.reduce(
          (maximum, placement) => Math.max(maximum, placement.uncoveredGap),
          0
        )
      },
      horizontalOverflow: session.documentDimensions.width >
        session.allocation.width / session.geometry.scale.x,
      scale: { ...session.geometry.scale },
      canvas: session.canvas,
      blob
    };
    active = null;
    const { canvas: _canvas, blob: _blob, ...metadata } = completed;
    return metadata;
  }

  function abort({ sessionId }) {
    const session = getActive(sessionId);
    if (session.canvas) {
      session.canvas.width = 0;
      session.canvas.height = 0;
    }
    const segmentCount = session.segmentCount;
    active = null;
    return { sessionId, aborted: true, processedSegmentCount: segmentCount };
  }

  function getResult() {
    if (!completed) return { available: false };
    const { canvas: _canvas, blob: _blob, ...metadata } = completed;
    return metadata;
  }

  return Object.freeze({ start, draw, finish, abort, getResult, clearResult });
}
