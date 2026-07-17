import { SEGMENT_SCALE_TOLERANCE } from "../shared/constants.js";
import { createApplicationError, ERROR_CODES, validateApplicationError } from "../shared/errors.js";
import {
  calculateSegmentGeometry,
  isConsistentSegmentGeometry,
  validateSegmentPayload,
  validateSegmentSessionStart
} from "../shared/segment-capture.js";

export function decodeJpegSegment(dataUrl, ImageConstructor = globalThis.Image) {
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
    image.onload = () => {
      const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
      release();
      resolve(dimensions);
    };
    image.onerror = () => {
      release();
      reject(createApplicationError({ code: ERROR_CODES.SEGMENT_DECODE_FAILED }));
    };
    image.src = dataUrl;
  });
}

export function createSegmentSessionManager({
  decode = decodeJpegSegment,
  now = Date.now,
  scaleTolerance = SEGMENT_SCALE_TOLERANCE
} = {}) {
  const sessions = new Map();

  function getActive(sessionId) {
    const session = sessions.get(sessionId);
    if (!session || session.status !== "active") {
      throw createApplicationError({ code: ERROR_CODES.SEGMENT_SESSION_INVALID });
    }
    return session;
  }

  function start(payload) {
    if (!validateSegmentSessionStart(payload) || sessions.has(payload?.sessionId)) {
      throw createApplicationError({ code: ERROR_CODES.SEGMENT_SESSION_INVALID });
    }
    const session = {
      sessionId: payload.sessionId,
      expectedMaximumSegments: payload.expectedMaximumSegments,
      processedSegmentCount: 0,
      firstGeometry: null,
      status: "active"
    };
    sessions.set(payload.sessionId, session);
    return { sessionId: session.sessionId, expectedMaximumSegments: session.expectedMaximumSegments };
  }

  async function process(payload) {
    if (!validateSegmentPayload(payload)) {
      throw createApplicationError({ code: ERROR_CODES.INVALID_CAPTURE_RESULT });
    }
    const session = getActive(payload.sessionId);
    if (payload.segmentIndex !== session.processedSegmentCount) {
      throw createApplicationError({ code: ERROR_CODES.SEGMENT_OUT_OF_ORDER });
    }
    if (session.processedSegmentCount >= session.expectedMaximumSegments) {
      throw createApplicationError({ code: ERROR_CODES.SEGMENT_LIMIT_EXCEEDED });
    }

    let bitmap;
    try {
      bitmap = await decode(payload.dataUrl);
    } catch (error) {
      throw validateApplicationError(error)
        ? error
        : createApplicationError({ code: ERROR_CODES.SEGMENT_DECODE_FAILED });
    }
    const geometry = calculateSegmentGeometry({ bitmap, cssViewport: payload.cssViewport });
    if (!geometry) throw createApplicationError({ code: ERROR_CODES.SEGMENT_DECODE_FAILED });
    if (session.firstGeometry && !isConsistentSegmentGeometry(session.firstGeometry, geometry, scaleTolerance)) {
      throw createApplicationError({ code: ERROR_CODES.SEGMENT_GEOMETRY_CHANGED });
    }
    session.firstGeometry ??= geometry;
    session.processedSegmentCount += 1;

    return {
      sessionId: session.sessionId,
      segmentIndex: payload.segmentIndex,
      bitmap: geometry.bitmap,
      scale: geometry.scale,
      estimatedBytes: payload.estimatedBytes,
      acknowledgedAt: now()
    };
  }

  function finish({ sessionId }) {
    const session = getActive(sessionId);
    session.status = "completed";
    return {
      sessionId,
      processedSegmentCount: session.processedSegmentCount,
      firstBitmapDimensions: session.firstGeometry?.bitmap ?? null,
      captureScale: session.firstGeometry?.scale ?? null
    };
  }

  function abort({ sessionId }) {
    const session = getActive(sessionId);
    session.status = "aborted";
    return { sessionId, aborted: true, processedSegmentCount: session.processedSegmentCount };
  }

  return Object.freeze({ start, process, finish, abort });
}
