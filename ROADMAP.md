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

- Sticky/fixed-element handling and its reversible style restoration.
- Manual Chrome verification across long/short pages, zoom and high-DPI configurations, cancellation, resize, navigation, dynamic pages, storage/network inspection, and regression workflows.

### Phase 2D checkpoint: incremental Canvas stitching and local preview

**Status:** Implemented with automated tests. Local Canvas stitching and popup loading of the offscreen-created Blob URL were manually verified in Chrome on 2026-07-17. Broader visual, cleanup, zoom, cancellation, failure-path, and regression scenarios remain pending, and full Phase 2 remains incomplete.

Completed in this checkpoint:

- A separate **Capture full page locally** production workflow that preserves all Phase 1–2C controls and uses the shared session-backed lock.
- One-at-a-time capture, offscreen decode/draw acknowledgement, current data-URL release, and at least 550 ms between capture calls.
- One offscreen DOM Canvas sized from the first bitmap's measured scale, with current-visible-width scope and horizontal-overflow metadata.
- Placement from actual scroll coordinates, overlap overwrite, gap rejection, final-document-boundary cropping, and small serializable placement records.
- Pre-allocation Canvas limits of 16,384 × 32,767 pixels, 100,000,000 total pixels, and 400,000,000 estimated RGBA bytes.
- Offscreen JPEG Blob encoding at quality 0.92, one temporary Blob URL/result, explicit get/clear/replacement lifecycle, URL revocation, and Canvas reset.
- Cleanup coverage for cancellation, capture/draw/decode/geometry/gap/limit/encoding failures, post-allocation dynamic growth, navigation, resize, restoration, messaging, and lock release.
- No screenshot storage, upload, download, OAuth operation, external request, horizontal scrolling, or fixed/sticky style modification.

Still pending:

- Manual Chrome verification of long/short pages, multiple zoom/high-DPI settings, cancellation/failure paths, memory cleanup, regressions, and offscreen Blob-URL rendering in the popup.
- Manual Phase 2E difficult-page verification, followed by authentication and Google Drive upload phases.

### Phase 2E checkpoint: fixed/sticky suppression and screenshot hardening

**Status:** Implementation is complete and automated verification passes. Manual Chrome verification of overlay suppression remains pending. Fixed/sticky handling remains heuristic; visual correctness, DOM restoration on real pages, cancellation restoration, and difficult-page behavior are not yet fully accepted. Full Phase 2 is not complete.

Completed in this checkpoint:

- A per-capture suppression option, enabled by default, with a strict no-DOM-modification path when disabled.
- Bounded visible fixed/sticky inventory using temporary controller-owned IDs and operational metadata only.
- Conservative top, bottom, floating, sticky-in-flow, and unknown classification; fixed repeated overlays are suppressible while sticky in-flow content remains visible by default.
- First-segment visibility followed by acknowledged `visibility: hidden !important` suppression before later captures.
- Preservation and restoration of inline visibility values/priorities and pre-existing temporary-attribute values.
- Geometry checks after suppression and stable scan, limit, suppression, instability, restoration, and stitching errors.
- Mandatory overlay restoration before scroll restoration and lock release across success, failure, encoding, cancellation, navigation/resize, and dynamic-page cleanup.
- Extended result metadata for overlay handling, source cropping, overlap, newly covered pixels, gaps, and overwritten rows.

Still pending:

- Manual Chrome verification across representative fixed headers, cookie bars, floating controls, sticky headings, cancellation/failure cleanup, zoom/high-DPI, Infinite Scroll, DOM/storage/network inspection, and earlier regressions.
- Further tuning for unusual sticky/fixed interfaces; the heuristic intentionally cannot guarantee perfect classification.
- OAuth, managed Drive folder creation, and upload phases.

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

### Phase 3A checkpoint: filename, JPEG configuration, and output metadata

**Status:** Phase 3A implementation is complete and automated verification passes. Manual Chrome verification remains pending; browser-specific JPEG encoding, filename UI behavior, JPEG-quality persistence, and preview cleanup are not yet fully accepted. Phase 2E real-page overlay-suppression verification also remains pending and is not implied by this checkpoint.

Completed in this checkpoint:

- Automatic `DriveCapture_<page-label>_<local-timestamp>.jpg` names using an injectable clock, local millisecond timestamp, sanitized useful title, hostname fallback, and final `Webpage` fallback.
- No automatic use of a full URL, path, query, fragment, page contents, or persisted unsanitized active-tab metadata.
- Optional per-capture custom filename with Unicode normalization, portable sanitation, repeated JPEG-extension removal, punctuation-only rejection, exactly one lowercase `.jpg`, and a 140-code-point complete-name limit.
- Exact JPEG-quality choices of 0.80, 0.90, 0.92, and 0.95; default 0.92; only the selected quality is stored in `chrome.storage.sync`.
- Worker-boundary validation before scrolling and offscreen-boundary validation before allocation/encoding.
- Per-session offscreen JPEG encoding plus minimal SOI/EOI validation using only two-byte Blob slices. The final Blob remains offscreen.
- Serializable result metadata for filename/source, format/MIME, quality, Blob size, pixel geometry, megapixels, aspect ratio, segment/scale data, signature status, horizontal overflow, overlay restoration, stitching diagnostics, and creation time.
- Popup controls and human-readable metadata without filename or result persistence.
- Stable output errors: `INVALID_OUTPUT_FILENAME`, `INVALID_JPEG_QUALITY`, `OUTPUT_METADATA_INVALID`, `JPEG_VALIDATION_FAILED`, and the defined `PAGE_LABEL_UNAVAILABLE` fallback condition.

Still pending:

- Manual Chrome verification of filenames, all quality choices, preference reload, metadata display, failure correction, clearing/replacement, and runtime/privacy behavior.
- Phase 2E visual and DOM-restoration acceptance on real pages.
- OAuth, Google Drive, download, upload, external Fetch, cloud persistence, and horizontal capture.

### Objective

Encode the stitched result as a memory-conscious JPEG Blob and generate deterministic, safe, bounded filenames.

### Implementation tasks

- Encode with `canvas.toBlob()` using `image/jpeg` and one of the exact supported quality values, defaulting to `0.92`.
- Reject null Blob results and report canvas or memory failures without silently truncating output.
- Keep the encoded Blob inside the offscreen document for the later upload phase; never attempt to send it through Chrome runtime messaging.
- Build filenames from a useful transient tab title, hostname fallback, and local millisecond timestamp.
- Never incorporate the URL path, query, fragment, or page contents.
- Remove control characters and filesystem-invalid characters; normalize Unicode, collapse whitespace/hyphens, and trim separators.
- Provide `Webpage` when neither title nor hostname produces a usable label.
- Enforce a 140-code-point complete-name limit while preserving exactly one lowercase `.jpg`.
- Release each decoded bitmap immediately after drawing; retain only the active preview's Canvas and Blob, then release both on clear, replacement, or failed-job cleanup.
- Add unit tests for sanitization, truncation, Unicode, empty inputs, dates, scale, overlap, and crop calculations.

### Acceptance criteria

- Output is a non-empty Blob with MIME type `image/jpeg`.
- Default and custom quality values are validated and applied.
- Example metadata produces `DriveCapture_camera-product-page_2026-07-16_14-30-12-123.jpg`.
- Generated names contain no query string, fragment, control character, invalid separator, or lost extension.
- Every filename is at most 140 Unicode code points.
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
    canvas-stitcher.js
  shared/
    output-filename.js
    output-settings.js
tests/
  output-filename.test.js
  output-settings.test.js
  canvas-stitcher.test.js
```

### Phase 3B.1 checkpoint: configured OAuth, managed-folder setup, and persistent Disconnect

**Status:** Phase 3B.1 implementation and automated verification are complete. A real Chrome Extension OAuth client is configured for the current extension ID. Explicit connection, managed-folder creation, cached validation, folder rename preservation, persistent local Disconnect, and reconnect without duplication were manually verified in Chrome. Screenshot upload is not implemented. Phase 3A browser verification and Phase 2E real-page verification remain pending.

Completed:

- Pure validation for missing, placeholder, malformed, and plausible Chrome Extension OAuth client IDs plus the exact single `drive.file` scope.
- Non-interactive derived status and an explicit interactive Connect path, both service-worker-only.
- Transient token lifecycle, scope confirmation, one invalidation/non-interactive retry after `401`, explicit cached-token clearing, and account-change cache clearing.
- Persistent local explicit-disconnect state that suppresses non-interactive token and Drive requests until the user selects Connect; cancelled or failed Connect restores that state, and account changes do not clear it.
- A fixed JSON-only Drive client with three metadata request shapes: get a cached folder, list marked folders, and create the managed folder.
- Validated local folder cache containing only `{ folderId, schemaVersion }`.
- Marker-authoritative validation, rename support, bounded marker discovery, deterministic duplicate selection, and metadata-only creation.
- Shared-lock exclusion between Drive mutations and capture jobs.
- Safe popup status with no token, raw ID, raw Google error, or implication that screenshot upload is available.
- Real OAuth client configuration bound to the current Chrome extension ID; a changed extension ID requires a matching OAuth client configuration.

Manually verified in Chrome:

- OAuth configuration recognition without an automatic consent prompt during popup initialization.
- Explicit interactive connection and the resulting Connected status.
- Managed-folder creation/preparation with one empty folder in My Drive.
- Cached validation of the existing folder after reopening the popup.
- Recognition of the renamed `DriveCapture Test` folder without renaming it back.
- Persistent local Disconnect without deleting or modifying the Drive folder or silently reconnecting.
- Explicit reconnect that reused the renamed marked folder without creating a duplicate.
- No screenshot or other file upload.

Manual verification still pending:

- Marker-based rediscovery after manually clearing the local folder cache.
- Trashed-folder lifecycle and replacement behavior.
- Account switching, disabled Drive API, and non-test-user failure behavior.
- Detailed Chrome storage, service-worker, popup, and Network inspection.
- Local screenshot-capture regression after OAuth setup.
- Phase 3A browser acceptance and Phase 2E real-page overlay acceptance.

Not implemented:

- Screenshot, media, multipart, or resumable upload; download; sharing; permissions management; cloud screenshot persistence; or horizontal capture.
- The remaining Chrome/Drive edge-case verification listed above.

The Phase 3B folder is preparation for a later upload phase. Google Drive integration is not complete.

## Phase 4: Production OAuth configuration and upload authorization handoff

### Objective

Complete the remaining Phase 3B.1 authentication and folder-lifecycle edge-case verification before adding any upload token handoff.

### Implementation tasks

- Maintain the Google Cloud consent-screen and Chrome-extension OAuth client configuration for the current extension ID.
- If the extension ID changes, configure the matching Chrome Extension OAuth client while keeping `drive.file` as the only scope.
- Request a cached token non-interactively when an authorized user starts an operation.
- If no valid grant exists, request interactively only from the explicit user action flow.
- Keep access tokens in transient memory only; prohibit storage and token logging.
- On a Drive `401`, call `chrome.identity.removeCachedAuthToken()`, request a fresh token, and retry the failed operation once.
- Send a short-lived token to the offscreen document only when it needs to perform the Drive request; receive only serializable success metadata or error details in return.
- Keep Disconnect as a persistent local DriveCapture disconnection: clear cached tokens and folder state, block silent token reacquisition until explicit Connect, and clearly distinguish this from remote grant revocation.
- Consider Google-level authorization revocation as separate future work; it is not part of the local Disconnect behavior.
- Map canceled consent, invalid client, revoked access, offline state, and account errors to user-facing authentication states.
- Add mocks for token success, denial, invalidation, and one-time refresh behavior.

### Acceptance criteria

- First authorization occurs only following an explicit capture or sign-in action.
- Returning authorized users can obtain a cached token without an interactive prompt.
- Exactly one token invalidation and refresh occurs after `401`; repeated `401` fails clearly.
- No access token appears in storage, normal logs, errors, or telemetry.
- The offscreen document clears its token reference after the upload attempt and never stores or logs it.
- Disconnect persists across popup closure, performs no non-interactive token or Drive request while active, and accurately explains that Google consent may remain granted.
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

- Portable options validate and persist JPEG quality and capture delay through `chrome.storage.sync`; the managed folder ID and explicit-disconnect Boolean remain in `chrome.storage.local`.
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
