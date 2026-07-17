# DriveCapture roadmap

This roadmap turns DriveCapture into a working extension in six reviewable phases. Each phase should preserve the narrow permission model, avoid claims about behavior that has not been tested, and finish with its acceptance criteria passing before the next phase begins.

## Phase 1: Project scaffolding and Manifest V3 setup

**Status:** Implemented on 2026-07-16. Unit tests, JavaScript syntax checks, manifest parsing, manifest-path checks, and static scope checks pass. Loading the unpacked extension and running the popup scaffold check in Chrome remain manual acceptance checks and are not yet marked verified.

### Objective

Produce a loadable, secure MV3 extension shell with explicit internal contracts and no capture or upload implementation yet.

### Implementation tasks

- Establish the project structure and naming conventions.
- Validate the `manifest.json` structure while preserving the OAuth client-ID placeholder.
- Document how the placeholder will be replaced, while deferring real Google OAuth configuration and testing to Phase 4.
- Build an accessible popup shell with idle, unavailable, and unexpected-error states.
- Build an ES-module service worker shell and a single-job coordinator that rejects concurrent requests.
- Persist the active-job lock and only small serializable job metadata in `chrome.storage.session`; do not rely solely on worker module globals.
- Define versioned message contracts for popup-to-worker, worker-to-page, and worker-to-offscreen communication.
- Define a serializable error model with stable codes, user-safe messages, retryability, and optional diagnostic context.
- Add an offscreen HTML document and module, created only when required and closed when no longer needed. Guard creation with `chrome.runtime.getContexts()` so only one exists per extension profile.
- Use `chrome.offscreen.createDocument()` with URL `src/offscreen/offscreen.html`, reason `BLOBS`, and a justification covering image decode, canvas stitching, JPEG Blob encoding, and Drive upload.
- Document that the offscreen context has DOM, Canvas, Blob, and Fetch, but only `chrome.runtime` among Chrome extension APIs.
- Add shared constants for limits, default JPEG quality, capture delay, and upload threshold.
- Add a lightweight lint/format/test setup without runtime dependencies.

### Acceptance criteria

- Chrome loads the unpacked extension without manifest or missing-resource errors.
- Clicking the action opens the local popup shell.
- The popup can send a typed/versioned ping to the service worker and display its response.
- The worker can create, ping, and close the offscreen document without using DOM APIs itself.
- Chrome 116 is enforced and `chrome.runtime.getContexts()` prevents duplicate offscreen documents, including concurrent creation attempts.
- A second simulated job receives a deterministic `CAPTURE_IN_PROGRESS` error.
- Worker restart simulation retains or safely clears the session-backed job lock without persisting screenshot data, data URLs, access tokens, Blobs, or upload-session URLs.
- No remote code, `<all_urls>`, OAuth secret, access-token persistence, screenshot logic, or Drive upload exists.

### Verification status

- Automated: shared message, error, and job-state tests pass.
- Automated: every JavaScript module passes `node --check`, and local ES-module import paths resolve.
- Static: the manifest parses, all referenced paths exist, and the scaffold contains no inline JavaScript or remote executable resources.
- Static: no OAuth request, Drive request, tab query, script injection, viewport capture, Canvas operation, Blob creation, or external network request is implemented.
- Manual pending: load the unpacked extension in Chrome 116 or later, confirm popup-to-worker ping, and run the create/reuse-ping-close offscreen scaffold check.

### Major risks

- MV3 worker suspension can invalidate assumptions based on module-global state.
- The offscreen document has only `chrome.runtime` directly available, so identity and storage calls must remain in the worker.
- Races between context inspection and creation must be handled without leaving duplicate creation failures as user-visible errors.
- The placeholder OAuth client ID intentionally prevents real authentication until Phase 4.
- Overly detailed contracts can slow iteration; contracts should remain small and versioned.

### Expected files

```text
manifest.json
README.md
ROADMAP.md
src/
  background/
    service-worker.js
    job-state.js
  offscreen/
    offscreen.html
    offscreen.js
  popup/
    popup.html
    popup.css
    popup.js
  shared/
    constants.js
    errors.js
    messages.js
tests/
  errors.test.js
  messages.test.js
```

## Phase 2: Viewport capture, scrolling, and canvas stitching

### Phase 2A checkpoint: single visible-viewport capture

**Status:** Implemented on 2026-07-17. Unit tests and static checks cover the adapter, supported-page rules, JPEG data URL/size validation, capture result contract, session lock, one-call coordinator behavior, and popup message path. Visible-viewport capture has also been manually tested in Chrome. Phase 2 as a whole is not complete.

Implemented in this checkpoint:

- Query exactly the active tab in the current window through an injectable adapter.
- Validate tab/window identifiers and allow only normal HTTP(S) pages, excluding both Chrome Web Store hosts.
- Acquire the session-backed job lock, call `captureVisibleTab()` once with JPEG quality `92`, validate the returned data URL, and release the lock in `finally`.
- Return an explicit `visible-viewport` result without URL or title metadata.
- Preview the JPEG temporarily in the popup with accessible progress, error, metadata, clear, focus, and teardown behavior.
- Keep screenshot data out of all storage, logs, files, network requests, error context, and the offscreen document.
- Preserve the Chrome 116-compatible non-async message-listener response pattern.

Still pending for the rest of Phase 2:

- Sticky/fixed-element handling, throttled multi-segment screenshot capture, incremental offscreen processing, measured bitmap scaling, Canvas stitching/cropping, and production full-page cleanup.

Phase 2A acceptance status:

- Automated: all injected-adapter tests pass, including one capture call, correct window/quality, lock release on failure, concurrent rejection, unsupported pages, malformed results, and safe adapter failures.
- Static: the permission boundary is unchanged and no screenshot storage, OAuth, Drive, Fetch, injection, scrolling, Canvas, Blob processing, download, or network behavior was added.
- Manual: visible-viewport capture was tested in Chrome. No separate completion claim is recorded for restricted-page, preview-clear, concurrency, storage, network, or console checks.

### Phase 2B checkpoint: measurement and controlled-scrolling diagnostic

**Status:** Implemented on 2026-07-17 with automated tests. Chrome verification now covers successful restoration, cancellation, popup closure, bounded dynamic-page failure, a short page, and the visible-capture regression. Navigation recovery is partially verified; viewport resize, all concurrency combinations, and complete runtime/privacy inspection remain pending. Full Phase 2 is not complete.

Completed in this checkpoint:

- Explicit-user-action injection of a local packaged page controller.
- Defensive viewport/document measurement and bounded non-reversible document identity.
- Sorted, deduplicated, maximum-bounded vertical plans with strict step and revision limits.
- Instant scrolling with settle checks, actual-position/clamping records, render delay, dynamic-height observation, and popup progress/results.
- Detection of navigation/document replacement, significant viewport change, missing page communication, unstable scrolling, and unbounded dynamic growth.
- Cancellation plus restoration and shared session-lock release through cleanup paths.
- Hostname-only reporting with no full URL or page-content storage/logging.

Still pending:

- High-DPI placement, overlap/cropping, Canvas stitching, final encoding, and sticky/fixed-element modification.

### Phase 2C checkpoint: incremental viewport capture and offscreen decoding

**Status:** Implemented with automated tests. Manual Chrome acceptance remains pending, so real segmented-capture success is not yet claimed and full Phase 2 is not complete.

Completed in this checkpoint:

- A separate **Test segmented capture** workflow preserving the Phase 1, 2A, and 2B controls.
- One JPEG capture per bounded scroll position with at least 550 ms between actual `captureVisibleTab()` calls and no automatic retries.
- Explicit offscreen start, process, finish, and abort session messages with sequential-index and maximum-segment enforcement.
- Immediate offscreen JPEG decoding, bitmap validation, first-segment scale measurement, later-segment geometry checks, JSON acknowledgements, and image/data-URL release before the next capture.
- Metadata-only popup progress and results with no screenshot preview or retained screenshot state.
- Cancellation during page waits and capture throttling, plus cleanup coverage for capture, decode, geometry, navigation, dynamic-page, restoration, messaging, and shared-lock failures.
- Stable segment/session error codes and bounded small metadata only; no screenshot storage or external request.

Still pending for full Phase 2:

- Canvas allocation, pixel drawing, segment placement, overlap removal, final cropping, final JPEG encoding, and sticky/fixed-element handling.
- Manual Chrome verification across long/short pages, zoom and high-DPI configurations, cancellation, resize, navigation, dynamic pages, storage/network inspection, and regression workflows.

### Objective

Reliably capture bounded static pages by coordinating page scrolling, throttled viewport screenshots, and offscreen canvas stitching, while always restoring the page.

### Implementation tasks

- Inject a local page-capture module after the user invokes the extension.
- Reject missing tabs, non-HTTP(S) URLs, browser-internal pages, and known restricted pages before injection.
- Record a document identity, original scroll position, CSS viewport, scrollable dimensions, and scrolling element.
- Generate scroll targets from actual viewport and document measurements.
- Scroll, wait for scroll/layout settling, and report the actual X/Y position reached.
- Enforce at least 550 ms between `captureVisibleTab()` calls and support a bounded additional render delay.
- Process captures incrementally: capture one viewport, send its data URL to the offscreen document, decode and draw immediately, wait for a JSON acknowledgement, release the data URL and decoded bitmap, and only then continue to the next viewport.
- Remeasure height when lazy-loaded content changes it, with maximum capture and iteration limits.
- Detect visible fixed/sticky elements, preserve original inline values, show appropriate elements on the first capture, and hide qualifying repeats thereafter.
- Detect navigation, document replacement, tab closure, viewport changes, and incompatible dimension changes; abort safely.
- Decode the first bitmap offscreen and derive X/Y scale from bitmap pixels divided by CSS viewport dimensions.
- Place segments using actual scroll positions and measured scale.
- Remove overlap and crop the final partial viewport without duplicating rows.
- Check canvas limits and estimated memory before allocation; detect allocation, decode, and encoding failures.
- Restore scroll and every modified style in a `finally` path on success, failure, or cancellation.
- Never retain all Base64 captures until the end; release each decoded bitmap and data URL after its segment is drawn and acknowledged.
- Retain only the active stitching canvas and small serializable placement metadata between segments.
- Document the fixed/sticky and dynamic-page heuristics.

### Acceptance criteria

- A bounded static test page produces one complete stitched image without repeated rows.
- A partial final viewport is cropped to the document boundary.
- Tests with browser zoom/display scale use measured bitmap scale and retain correct geometry.
- Actual scroll positions, including clamped final positions, determine placement.
- Capture timestamps demonstrate at least 550 ms between calls.
- Each segment's data URL and decoded bitmap are released before the next `captureVisibleTab()` call begins.
- The original scroll position and modified inline styles are restored after both success and forced failure.
- Navigation, resize, protected pages, excessive capture count, and oversized canvas conditions return stable, human-readable errors.
- No Canvas or DOM API is called from the service worker.

### Major risks

- Dynamic, animated, virtualized, or infinite pages may never present a stable document.
- Cross-origin frames cannot be inspected even though their rendered pixels may be captured.
- Maximum canvas dimensions vary by browser build, GPU, platform, and available memory.
- Fixed/sticky heuristics can either repeat overlays or hide legitimate content.
- Holding many Base64 captures simultaneously can exhaust memory before stitching.

### Expected files

```text
src/
  background/
    capture-coordinator.js
  content/
    page-capture.js
  offscreen/
    canvas-stitcher.js
  shared/
    capture-math.js
    limits.js
tests/
  capture-math.test.js
  fixtures/
    static-page.html
    sticky-page.html
    lazy-page.html
```

## Phase 3: Image processing and filename logic

### Objective

Encode the stitched result as a memory-conscious JPEG Blob and generate deterministic, safe, bounded filenames.

### Implementation tasks

- Encode with `canvas.toBlob()` using `image/jpeg` and a configurable quality default near `0.92`.
- Reject null Blob results and report canvas or memory failures without silently truncating output.
- Keep the encoded Blob inside the offscreen document for the later upload phase; never attempt to send it through Chrome runtime messaging.
- Build filenames from local date, hostname, useful pathname segments, and page title.
- Remove protocol, query, fragment, control characters, and filesystem-invalid characters.
- Normalize Unicode, lowercase text, collapse unwanted sequences to one hyphen, and trim separators.
- Provide fallbacks for missing hostname, path, or title.
- Enforce a 180-character complete-name limit while preserving `.jpg`.
- Release canvas, bitmap, and intermediate references after Blob creation.
- Add unit tests for sanitization, truncation, Unicode, empty inputs, dates, scale, overlap, and crop calculations.

### Acceptance criteria

- Output is a non-empty Blob with MIME type `image/jpeg`.
- Default and custom quality values are validated and applied.
- Example metadata produces `2026-07-16_example-com_products_camera-product-page.jpg`.
- Generated names contain no query string, fragment, control character, invalid separator, or lost extension.
- Every filename is at most 180 characters.
- Unit tests cover edge cases in filename sanitation and capture calculations.
- Repeated captures do not retain prior canvases, bitmaps, Blobs, or data URLs after job cleanup.

### Major risks

- JPEG encoding can temporarily require substantially more memory than the final Blob size.
- Unicode normalization/transliteration choices can make names less recognizable.
- Date behavior depends on the user's local timezone and midnight transitions.
- Excessively aggressive sanitation can collapse distinct pages to similar names.

### Expected files

```text
src/
  offscreen/
    jpeg-encoder.js
  shared/
    filename.js
    preferences.js
tests/
  filename.test.js
  jpeg-encoder.test.js
  capture-math.test.js
```

## Phase 4: Google OAuth authentication

### Objective

Authenticate through Chrome Identity with the least-privileged Drive scope and predictable token lifecycle behavior.

### Implementation tasks

- Complete Google Cloud consent-screen and Chrome-extension OAuth client configuration.
- Replace the manifest client-ID placeholder while keeping `drive.file` as the only scope.
- Request a cached token non-interactively when an authorized user starts an operation.
- If no valid grant exists, request interactively only from the explicit user action flow.
- Keep access tokens in transient memory only; prohibit storage and token logging.
- On a Drive `401`, call `chrome.identity.removeCachedAuthToken()`, request a fresh token, and retry the failed operation once.
- Send a short-lived token to the offscreen document only when it needs to perform the Drive request; receive only serializable success metadata or error details in return.
- Implement disconnect/logout by removing cached tokens and, if offered, clearly distinguish local cache removal from remote grant revocation.
- Map canceled consent, invalid client, revoked access, offline state, and account errors to user-facing authentication states.
- Add mocks for token success, denial, invalidation, and one-time refresh behavior.

### Acceptance criteria

- First authorization occurs only following an explicit capture or sign-in action.
- Returning authorized users can obtain a cached token without an interactive prompt.
- Exactly one token invalidation and refresh occurs after `401`; repeated `401` fails clearly.
- No access token appears in storage, normal logs, errors, or telemetry.
- The offscreen document clears its token reference after the upload attempt and never stores or logs it.
- Disconnect clears Chrome's cached token and accurately explains whether Google consent remains granted.
- The extension requests `drive.file` and no broader Drive scope.

### Major risks

- Extension-ID and OAuth-client mismatches block all authentication.
- Consent-screen testing status and test-user lists can look like application defects.
- Chrome account state may differ from the Google account expected by the user.
- Token revocation and cached-token removal have different semantics.

### Expected files

```text
src/
  background/
    auth.js
  popup/
    auth-view.js
  shared/
    auth-errors.js
tests/
  auth.test.js
```

## Phase 5: Google Drive integration

### Objective

Create and manage DriveCapture's dedicated Drive folder, then upload the offscreen-owned JPEG safely using the appropriate Drive upload protocol and bounded recovery behavior.

### Implementation tasks

- On first upload, create a folder named `DriveCapture` with MIME type `application/vnd.google-apps.folder` and optional identifying `appProperties`.
- Return the created folder metadata to the worker and store its ID in `chrome.storage.local`.
- On later uploads, have the worker read the locally stored ID and send it as JSON metadata to the offscreen document for validation and reuse.
- Distinguish a missing/inaccessible managed folder from malformed requests; inform the user before creating a replacement and saving its new ID locally.
- Build metadata containing `name`, `mimeType: image/jpeg`, and `parents: [folderId]`.
- Request response fields `id,name,webViewLink,parents`.
- Keep the JPEG Blob in the offscreen document. Send only the token and JSON metadata from the worker, upload via offscreen Fetch, and return only JSON-serializable Drive metadata.
- Use multipart upload when Blob size is at most 5 MB.
- Initiate and complete a resumable upload when Blob size is greater than 5 MB.
- Keep resumable-session URLs only in offscreen memory for the active upload; never store or log them.
- Implement bounded exponential backoff with jitter for `429`, recoverable `5xx`, and eligible network failures.
- Do not retry permanent `400`, `403`, or `404` responses blindly.
- Integrate the one-time `401` token-refresh path from Phase 4.
- On `401`, return a serializable authentication error so the worker can invalidate the token, obtain one replacement token, and ask the offscreen document to retry once.
- Recover resumable progress where supported; fail clearly when a session expires or cannot be resumed.
- Parse successful metadata and expose the Drive `webViewLink` in the popup.

### Acceptance criteria

- A JPEG of 5 MB or less uses multipart upload and lands in the managed `DriveCapture` folder.
- A JPEG larger than 5 MB uses resumable upload and lands in the managed `DriveCapture` folder.
- First upload creates and locally records the managed `DriveCapture` folder; later uploads validate and reuse it.
- The folder is created with `application/vnd.google-apps.folder` and, when used, the expected identifying `appProperties`.
- A missing or inaccessible managed folder causes a user notification before a replacement is created and locally recorded.
- The created file has the expected name, MIME type, parent, and returned fields.
- `400`, `401`, `403`, `404`, `429`, recoverable `5xx`, offline, and interrupted-session cases produce tested outcomes.
- Backoff has a strict attempt/time bound and permanent failures are not retried.
- Success displays a safe link to the created Drive file.
- Screenshot bytes are sent only to Google Drive endpoints.
- Runtime messages never contain a Blob, and storage never contains screenshot bytes, tokens, Blobs, or resumable-session URLs.

### Major risks

- Folder lookup should use the stored ID rather than broad Drive enumeration; duplicate managed folders are possible after deletion, access loss, or interrupted creation.
- Shared drives and organizational policies can change permission behavior.
- Large uploads require the offscreen document to remain alive for the active resumable session; an offscreen teardown or browser shutdown must fail clearly because session URLs are intentionally not persisted.
- Retrying non-idempotent initiation requests carelessly can create duplicate files.
- Session URLs and access tokens are credentials and require log redaction.

### Expected files

```text
src/
  background/
    drive-coordinator.js
  offscreen/
    drive-client.js
    multipart-upload.js
    resumable-upload.js
    retry.js
  popup/
    upload-view.js
tests/
  managed-folder.test.js
  drive-client.test.js
  multipart-upload.test.js
  resumable-upload.test.js
  retry.test.js
```

## Phase 6: Options page and UI polish

### Objective

Make configuration and progress understandable, accessible, and review-ready without expanding data access.

### Implementation tasks

- Show current managed `DriveCapture` folder status without exposing arbitrary folder-ID entry in the normal interface.
- Add a recreate-folder action with a clear explanation of when a replacement will be made.
- Add validated JPEG-quality and post-scroll capture-delay preferences.
- Keep Google Picker folder selection as an optional future enhancement; review its additional API, origin, and scope requirements before adoption.
- Allow consideration of a developer-only folder override for diagnostics, clearly excluded from the normal user interface and product workflow.
- Add popup states for idle, measuring, capturing with progress, processing, authenticating, uploading, success, cancellation, and error.
- Prevent repeated clicks and provide safe cancellation where cleanup can be guaranteed.
- Add keyboard navigation, visible focus, semantic status regions, useful labels, contrast, and reduced-motion behavior.
- Separate user-facing strings for localization readiness and avoid concatenated sentence fragments.
- Add privacy disclosure and data-flow documentation.
- Complete Chrome Web Store permission, privacy, OAuth verification, and remote-code reviews.
- Run final manual tests across representative page types, scales, network failures, and account states.

### Acceptance criteria

- Portable options validate and persist JPEG quality and capture delay through `chrome.storage.sync`; the managed folder ID remains in `chrome.storage.local`.
- Folder status and recreation outcomes are accessible and understandable without requiring users to copy an ID.
- Invalid quality values and delays receive inline accessible feedback.
- Popup progress is understandable to screen-reader and keyboard-only users.
- All user-facing strings are isolated for later localization.
- The privacy disclosure matches the actual data flow and permissions.
- The packaged extension contains no remote executable code or undeclared resource.
- Chrome Web Store review materials accurately justify each permission and do not claim unsupported functionality.

### Major risks

- Google Picker may require broader configuration and must remain optional rather than replacing the managed-folder MVP.
- A developer override could accidentally leak into the product UI unless it is strictly gated or omitted from production builds.
- Progress precision is limited because encoding and upload stages do not always expose granular progress.
- Cancellation during capture, encoding, or upload can leave different cleanup obligations.
- Sync-storage propagation can surprise users with settings shared across Chrome profiles/devices.
- Store and OAuth verification requirements can change before release.

### Expected files

```text
manifest.json
src/
  options/
    options.html
    options.css
    options.js
  popup/
    popup.html
    popup.css
    popup.js
  shared/
    i18n.js
    preferences.js
_locales/
  en/
    messages.json
docs/
  privacy.md
  release-checklist.md
tests/
  preferences.test.js
  accessibility/
```
