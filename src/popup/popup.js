import { CONTEXTS } from "../shared/constants.js";
import {
  createMessage,
  MESSAGE_TYPES,
  validateMessageEnvelope
} from "../shared/messages.js";

const workerStatus = document.querySelector("#worker-status");
const liveStatus = document.querySelector("#live-status");
const scaffoldCheckButton = document.querySelector("#scaffold-check");

function userSafeError(response, fallback) {
  const message = response?.payload?.error?.message;
  return typeof message === "string" && message ? message : fallback;
}

async function sendWorkerMessage(type) {
  const request = createMessage({
    type,
    source: CONTEXTS.POPUP,
    target: CONTEXTS.SERVICE_WORKER,
    payload: {}
  });

  return chrome.runtime.sendMessage(request);
}

async function checkWorkerConnection() {
  try {
    const response = await sendWorkerMessage(MESSAGE_TYPES.WORKER_PING_REQUEST);
    if (
      !validateMessageEnvelope(response) ||
      response.type !== MESSAGE_TYPES.WORKER_PING_RESPONSE ||
      response.payload.ok !== true
    ) {
      throw new Error("Invalid worker response.");
    }

    workerStatus.textContent = "Connected";
    workerStatus.dataset.state = "connected";
  } catch {
    workerStatus.textContent = "Unavailable";
    workerStatus.dataset.state = "error";
    liveStatus.textContent = "The service worker did not respond. Reload the extension and try again.";
  }
}

async function runScaffoldCheck() {
  scaffoldCheckButton.disabled = true;
  liveStatus.textContent = "Running the scaffold check…";

  try {
    const response = await sendWorkerMessage(
      MESSAGE_TYPES.OFFSCREEN_SCAFFOLD_CHECK_REQUEST
    );

    if (
      !validateMessageEnvelope(response) ||
      response.type !== MESSAGE_TYPES.OFFSCREEN_SCAFFOLD_CHECK_RESPONSE ||
      response.payload.ok !== true
    ) {
      throw new Error(userSafeError(response, "The scaffold check returned an invalid response."));
    }

    const { jobLock, offscreen } = response.payload.diagnostic;
    liveStatus.textContent =
      `Scaffold check passed. Job lock acquired and released: ${
        jobLock.acquired && jobLock.released ? "yes" : "no"
      }. Offscreen document created or reused, pinged, and closed: ${
        (offscreen.created || offscreen.reused) && offscreen.pinged && offscreen.closed
          ? "yes"
          : "no"
      }.`;
  } catch (error) {
    liveStatus.textContent =
      error instanceof Error
        ? `Scaffold check failed: ${error.message}`
        : "The scaffold check failed unexpectedly.";
  } finally {
    scaffoldCheckButton.disabled = false;
  }
}

scaffoldCheckButton.addEventListener("click", runScaffoldCheck);
void checkWorkerConnection();
