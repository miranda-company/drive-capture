# DriveCapture

DriveCapture is a planned Manifest V3 Chrome extension that will capture a high-resolution, full-page image of the active HTTP or HTTPS page and upload the resulting JPEG to a dedicated Google Drive folder created and managed by the extension.

Phases 2A through 2E, 3A, 3B, 3B.1, and the Phase 3C upload implementation are built on top of the Phase 1 shell. DriveCapture can create and validate a local full-page JPEG, prepare its managed Drive folder, and upload the reviewed offscreen-owned Blob through an explicit resumable workflow. Phase 3C has automated coverage but has not yet been manually accepted in Chrome with a real JPEG.

## Current Phase 3C explicit Drive upload

- Upload never starts automatically. The user must capture locally, review the preview, connect Google Drive, validate the managed folder, and select **Save to Google Drive**.
- Before session creation, the worker obtains trusted result metadata from offscreen and validates the result ID, retained Blob, preview lifecycle, JPEG MIME/signature/size, sanitized filename, positive dimensions, and duplicate-upload state. Popup values are not trusted.
- The service worker owns OAuth and the internal folder ID. It validates or prepares the managed folder and uses its transient token only for one authenticated resumable-session `POST`.
- The offscreen document never receives a token or Authorization header. It receives only the result ID, validated session URI, expected Blob size, and `image/jpeg`, then sends the existing Blob in one `PUT` without regenerating or Base64-encoding it.
- Every upload uses a resumable session, regardless of size. Multipart, simple media upload, `FormData`, and multi-chunk continuation are not implemented.
- Network or `5xx` uncertainty triggers exactly one empty status-query `PUT` against the same session. An incomplete `308` or expired `404` fails safely and never starts another session automatically.
- Cancellation aborts the offscreen request, clears the session-URI reference, preserves the local Blob and preview, releases the shared job lock, and permits an explicit retry.
- A successful result is transiently marked against the current local capture, preventing accidental repeat upload. A new capture or preview clear resets local upload metadata without deleting any Drive file.
- The popup receives only safe filename, MIME, size, creation/upload time, checksum availability, and a validated Google Drive view link. It never receives a token, folder/file ID field, session URI, Blob, screenshot bytes, Authorization header, or raw response.
- `chrome.storage.session` may hold only the safe current upload state, current result ID, progress, safe error, and safe final result. There is no upload history; session URIs, file IDs, tokens, Blobs, data URLs, preview URLs, and raw responses are prohibited.
- Phase 3C implementation and automated verification are complete. Manual Chrome verification and a real JPEG upload remain pending, so production upload acceptance is not claimed. Phase 3A browser acceptance and Phase 2E real-page overlay acceptance also remain pending.

## Current Phase 3B.1 Google Drive setup

- Popup opening first reads the local explicit-disconnect preference. While that preference is active, it reports **Not connected** without calling `getAuthToken()`, contacting Google Drive, or checking the managed folder. Otherwise it may perform only `chrome.identity.getAuthToken({ interactive: false })`; it never prompts or creates a folder.
- **Connect Google Drive** is the only interactive authorization path and the only action that clears an explicit local disconnect. If authorization is cancelled or setup fails, DriveCapture restores the local disconnect so reopening the popup cannot silently reconnect.
- The configured OAuth client is bound to the current unpacked Chrome extension ID. Moving or re-keying the extension can change that ID and requires a matching Chrome Extension OAuth client configuration.
- The manifest requests exactly `https://www.googleapis.com/auth/drive.file`. This lets DriveCapture work with files/folders it creates or the user explicitly opens with it; it does not grant general Drive browsing access.
- Access tokens exist only in service-worker memory. They are never stored, logged, returned to the popup, or sent to offscreen. A Drive `401` invalidates once, obtains one non-interactive replacement, and retries once.
- Folder identity is the private `drivecaptureManaged=true` and `drivecaptureSchema=1` marker, not the visible name. A valid renamed folder remains valid.
- The worker validates a cached local `{ folderId, schemaVersion: 1 }`, otherwise searches only marked folders with bounded pagination, chooses the oldest valid writable folder deterministically, or creates one metadata-only `DriveCapture` folder.
- `chrome.storage.local` contains only the folder cache record and, after an explicit Disconnect, the Boolean `driveExplicitlyDisconnected: true`. Duplicate marked folders are reported as a count and left unchanged.
- **Disconnect** is a persistent local DriveCapture disconnection. Under the shared lock it clears cached Chrome tokens and the local folder record, then stores the explicit-disconnect preference. It does not revoke the OAuth grant in the user's Google Account, delete or modify the Drive folder, or perform a Drive request afterward. Google-level authorization revocation is not implemented.
- Drive setup operations share the session-backed job lock with captures. Account changes clear the folder cache without storing account identity or prompting, and do not clear the explicit-disconnect preference.
- The Phase 3B folder metadata client remains limited to three request shapes: get folder, list marked folders, and create folder. Phase 3C adds a separate, fixed resumable-session initializer; neither client implements downloads, sharing, or permissions management.
- Phase 3B.1 implementation and automated verification are complete. Explicit authorization, managed-folder creation, cached validation, rename preservation, persistent Disconnect, and reconnect without duplication were manually verified in Chrome. Marker rediscovery after manual cache clearing, trashed-folder handling, account switching, and failure scenarios remain pending.

## Current Phase 3A output configuration

- An empty filename field generates `DriveCapture_<page-label>_<local-timestamp>.jpg`. The timestamp uses local time with millisecond precision; the page label prefers a sanitized active-tab title, then hostname, then `Webpage`.
- Automatic labels never use the URL path, query, fragment, page contents, or other browsing metadata. Unsanitized title/hostname values remain transient and are neither stored nor logged.
- A custom name is optional and per capture. It is Unicode-normalized, stripped of repeated `.jpg`/`.jpeg` extensions, sanitized for portable filesystems, capped so the complete name is at most 140 Unicode code points, and emitted with exactly one lowercase `.jpg`. A punctuation-only value fails with `INVALID_OUTPUT_FILENAME`.
- JPEG quality is selected from exactly 0.80, 0.90, 0.92, or 0.95. The default is 0.92. This quality alone is saved to `chrome.storage.sync`; filenames and capture/output metadata are not persisted.
- The worker validates `{ requestedFilename, jpegQuality, suppressRepeatedOverlays }` before page scrolling. It sends only the final sanitized filename, its source, and validated quality to offscreen.
- Offscreen applies the per-session quality to `canvas.toBlob()`, retains the Blob, and reads only its first and final two-byte slices to validate JPEG SOI (`FF D8`) and EOI (`FF D9`) markers. It accepts `image/jpeg` and the browser-equivalent `image/jpg`, normalizing reported metadata to `image/jpeg`. Invalid MIME, size, signature, or slice reads fail with `JPEG_VALIDATION_FAILED`.
- The popup reports the selectable filename, source, MIME/format, quality, Blob size, pixel dimensions, megapixels, aspect ratio, segment count, measured scale, JPEG-signature status, horizontal overflow, overlay restoration, stitching diagnostics, and creation time.
- The custom filename is retained after failure so it can be corrected. It is cleared after capture success or explicit result clearing.
- Phase 3A implementation is complete and automated verification passes, but manual Chrome verification remains pending. Browser-specific JPEG encoding, filename UI behavior, JPEG-quality persistence, and preview cleanup are not yet fully accepted. The Phase 2E real-page overlay-suppression matrix also remains pending.

## Current Phase 2E overlay handling

- The full-page control includes **Suppress repeated fixed/sticky elements**, enabled by default for that capture only. Disabling it bypasses all overlay scanning, attributes, and style changes and retains Phase 2D behavior.
- After each planned scroll, the injected controller performs one bounded visible-candidate scan. It ignores hidden, transparent, zero-sized, and offscreen elements and tracks at most 200 candidates.
- Fixed elements are conservatively classified as top, bottom, or floating overlays and are eligible for suppression after the first segment. Sticky in-flow elements are inventoried but remain visible by default to avoid erasing article or table content.
- The first segment keeps eligible overlays visible. Before later captures, qualifying fixed overlays are changed only with `visibility: hidden !important`, preserving layout.
- DriveCapture preserves the original inline visibility value and priority and any pre-existing `data-drivecapture-element-id` value. Cleanup restores or removes each temporary value before restoring scroll and releasing the job lock.
- Viewport, document, and scroll geometry are remeasured after suppression. Unexpected changes abort with a structured error rather than stitching incompatible segments.
- Results report detected, suppressed, and restored counts plus overlap, newly covered, and maximum-gap diagnostics. They never contain page text, HTML, selectors, form values, or full URLs.
- The heuristic cannot be perfect. Some sticky content may still repeat, and unusual fixed interfaces may be hidden when suppression is enabled.

## Current Phase 2D local full-page capture

- **Capture full page locally** is a production coordinator separate from the Phase 2C diagnostic. All workflows continue to share the `chrome.storage.session` job lock.
- The worker measures and scrolls the page, enforces at least 550 ms between capture calls, sends one current JPEG data URL to offscreen, waits for a draw acknowledgement, clears the reference, and only then captures the next viewport.
- The offscreen document allocates one DOM `HTMLCanvasElement` after the first bitmap establishes the measured X/Y scale. The canvas width is the captured viewport bitmap width; horizontal scrolling is not attempted, and wider-document overflow is reported.
- Segments are placed from `round(actualScrollY * scaleY)`. Overlaps are overwritten at their real coordinates, unexpected vertical gaps fail, and the usable final source height is cropped to the document boundary.
- The finished canvas is encoded with `canvas.toBlob("image/jpeg", validatedQuality)`, defaulting to 0.92. The Blob, Canvas, decoded image, and preview URL stay exclusively in offscreen memory; runtime messages carry only the current data URL or small JSON metadata, never the final Blob.
- Only one completed result is retained. Starting another capture or selecting **Clear full-page preview** revokes the old URL and releases the Blob and Canvas. The offscreen document stays alive while a preview exists and closes after explicit clearing or any failed capture.
- Conservative pre-allocation limits are 16,384 px wide, 32,767 px high, 100,000,000 pixels, and 400,000,000 estimated RGBA bytes. Unsafe pages fail rather than being truncated.
- With Phase 2E suppression disabled, fixed and sticky elements may repeat exactly as in Phase 2D.
- The result remains local and temporary unless the user explicitly selects **Save to Google Drive**. It is never written to Chrome storage or downloaded.

## Current Phase 2C diagnostic

- **Test segmented capture** measures the page, creates the bounded Phase 2B scroll plan, and captures exactly one JPEG per visited position.
- Calls to `chrome.tabs.captureVisibleTab()` are spaced by at least 550 ms and are never automatically retried.
- Each data URL is sent immediately to an explicit offscreen session, decoded with a temporary `Image`, acknowledged with bitmap dimensions and measured X/Y scale, and released before the next capture begins.
- The offscreen session retains only its ID, limits, processed count, first bitmap dimensions, and expected scale. It rejects malformed, duplicate, out-of-order, excessive, completed-session, decode, and geometry-change requests.
- The popup displays segment metadata only: scroll positions, sizes, capture intervals, bitmap geometry, scale, totals, restoration, and duration. It never receives or displays the segment screenshots.
- Success, failure, cancellation, dynamic growth, navigation, resize, and messaging failures share cleanup that aborts or finishes the offscreen session, restores the page, releases the session lock, and closes the offscreen document.
- No Canvas is created, no pixels are stitched, no final JPEG or Blob is generated, and no screenshot is stored, fetched, uploaded, or downloaded.

## Current Phase 2B diagnostic

- **Test full-page scrolling** injects one local packaged controller only after an explicit popup request.
- Measures the CSS viewport, defensive document dimensions, maximum scroll, original scroll, device-pixel ratio, scrolling element, hostname, and bounded document identity.
- Creates a sorted vertical plan containing `0` and the maximum scroll position, with strict step and dynamic-height revision limits.
- Records requested and actual Y positions and browser clamping, with `Step X of Y` progress.
- Detects navigation/document replacement, material viewport changes, missing controller communication, and unstable scrolling.
- Always attempts restoration and shared-lock release in cleanup, including failure and cancellation paths.
- Infinite and dynamically growing pages are intentionally bounded and may return `DYNAMIC_PAGE_UNSTABLE`.
- Does not capture images during scrolling, modify fixed/sticky elements, insert DOM nodes, store page contents/full URLs, or use Canvas, OAuth, Drive, downloads, or the offscreen document.

## Current Phase 2A behavior

- Queries only the active tab in the current window after the user selects **Capture visible viewport**.
- Accepts normal `http:` and `https:` pages.
- Rejects browser-internal pages including `chrome://`, `chrome-extension://`, `edge://`, `about:`, `file:`, and `view-source:` pages.
- Explicitly rejects `chromewebstore.google.com` and `chrome.google.com/webstore` pages.
- Calls `chrome.tabs.captureVisibleTab()` exactly once with JPEG quality `92`; it does not retry automatically.
- Uses the session-backed capture lock and releases it in `finally` on success or failure.
- Sends the single JPEG data URL directly from the worker to the open popup for this proof of concept only.
- Keeps the data URL only in popup module memory, removes the image source and references when cleared or closed, and never writes screenshot data to extension storage, IndexedDB, Cache Storage, the filesystem, or logs.
- Does not use page-script injection, scrolling, Canvas, Blob processing, OAuth, Google Drive, downloads, the offscreen document, or external network requests for capture.

## User workflow

The intended MVP workflow is:

1. The user opens a normal HTTP or HTTPS page.
2. The user clicks the DriveCapture toolbar action and starts capture explicitly.
3. The extension validates the active tab, measures the page, and captures each visible viewport while scrolling.
4. An offscreen document incrementally decodes and stitches each capture, then encodes and retains the JPEG Blob.
5. The user connects Google Drive explicitly if needed and validates the managed folder.
6. The user selects **Save to Google Drive**; capture completion alone never starts an upload.
7. The worker uses a transient OAuth token to initialize one resumable session for the validated filename, size, MIME, and internal folder ID.
8. The worker sends only the session URI and non-secret Blob expectations to offscreen; offscreen uploads its retained Blob directly and returns expected JSON metadata for worker validation.
9. The popup reports a safe result and exposes **Open in Google Drive** only as an explicit link click.

The popup will prevent overlapping capture jobs. Interactive OAuth will only begin in response to the user's capture or sign-in action.

## MVP features and remaining work

- Local full-page, incremental scroll-and-stitch capture using `chrome.tabs.captureVisibleTab()` is implemented in Phase 2D.
- Capture pacing of at least 550 ms between screenshot calls.
- Lazy-content settling and bounded page-height recalculation.
- Actual scroll-position tracking, overlap removal, and final-segment cropping.
- High-DPI handling based on the captured bitmap-to-CSS viewport scale, rather than assuming `devicePixelRatio` is the capture scale.
- Reversible handling of visible fixed and sticky elements to reduce repeated overlays.
- Guaranteed restoration of the original scroll position and modified inline styles.
- JPEG output with validated quality choices, defaulting to `0.92`, is implemented in Phase 3A.
- Safe filenames in the form `DriveCapture_<page-label>_<local-timestamp>.jpg`, capped at 140 Unicode code points, are implemented in Phase 3A.
- Google OAuth through `chrome.identity` with the narrow `drive.file` scope.
- Automatic creation and reuse of a dedicated `DriveCapture` folder, with its ID stored in `chrome.storage.local`.
- Explicit one-session resumable upload for every JPEG is implemented in Phase 3C.
- One token invalidation/non-interactive refresh retry is allowed only while creating the upload session after a `401`.
- One same-session status query handles an uncertain network or `5xx` outcome; no automatic second session or multi-chunk continuation exists.
- Clear failures for unsupported pages, navigation during capture, inaccessible folders, oversized canvases, and memory limits.
- A capture-job lock and small serializable recovery metadata in `chrome.storage.session`, without persisting screenshot data or credentials.

## Architecture

DriveCapture separates privileged coordination from page interaction and DOM-based image processing. Phase 3C adds an explicit resumable upload while preserving the token/Blob boundary.

### Popup

The popup preserves every earlier capture control and adds compact Drive configuration, connection, managed-folder, upload prerequisites, progress, cancellation, and safe outcome states. It never receives access tokens, raw folder/file ID fields, upload-session URIs, or screenshot bytes. Only explicit **Connect Google Drive** can request interactive authorization, and only explicit **Save to Google Drive** starts upload.

### Manifest V3 service worker

The service worker coordinates all workflows through the shared session-backed lock. It is the only context that acquires OAuth tokens, builds Authorization headers, owns the internal folder ID, performs the three fixed folder metadata requests, and initializes the resumable upload session. It sends no token or Authorization header to offscreen and never receives the final stitched JPEG Blob.

Service workers have no DOM or Canvas APIs, so stitching must not happen in the worker. Chrome runtime messages must be JSON-serializable; the design therefore does not attempt to send a Blob through `chrome.runtime` messaging.

Because MV3 workers may be suspended, the active capture-job lock and only the small serializable metadata needed to recognize or recover an interrupted job will use `chrome.storage.session`. The implementation must not rely solely on module-global variables. Screenshot data, data URLs, access tokens, JPEG Blobs, and resumable-session URLs must never be written to session storage.

### Injected page capture module

The local packaged page controller measures and scrolls the document, reports actual positions, detects document/viewport changes, and restores the original scroll position. Phase 2E adds a separately packaged overlay controller that owns all candidate inventory, reversible attribute assignment, `visibility` suppression, geometry verification, and restoration. No page element reference leaves the injected context.

The MVP will inject this module only after the action is invoked. It will not request persistent access to every website.

### Offscreen document

The offscreen document supports both the unchanged Phase 2C decode diagnostic and a full-page stitching session. The stitching session creates one Canvas, decodes and draws one current segment, releases its `Image` before acknowledging, records small placement metadata, and encodes one final `image/jpeg` Blob at the validated per-session quality. It verifies only the Blob's two-byte start and end slices, retains no full Base64 representation of the result, and reports JSON-safe technical metadata. Result get/clear messages expose only serializable metadata and manage URL revocation and memory release.

The Blob stays inside the offscreen document. Phase 3C gives offscreen only a strictly validated Google upload-session URI plus result ID, expected byte size, and JPEG MIME. Offscreen revalidates the retained result and session URI, sends the entire Blob once, performs at most one same-session uncertainty query, clears the URI reference, and keeps the preview available.

Chrome 116 or later is required so the worker can call `chrome.runtime.getContexts()` before creating the offscreen document. Only one offscreen document should exist per extension profile. Planned creation contract:

```javascript
await chrome.offscreen.createDocument({
  url: "src/offscreen/offscreen.html",
  reasons: ["BLOBS"],
  justification:
    "Decode captured images, stitch them on a canvas, encode a JPEG Blob, and upload it to Google Drive."
});
```

The worker must guard this call with `chrome.runtime.getContexts()` and tolerate another request winning the creation race. The offscreen context has web-platform APIs including DOM, Canvas, Blob, and Fetch. Of the Chrome extension APIs, only `chrome.runtime` is directly available there, so storage and identity work remain in the service worker.

### Google Drive client

The Phase 3B service-worker client supports JSON metadata only: cached-folder validation, bounded marked-folder discovery, and managed-folder creation. It creates a folder named `DriveCapture` with MIME type `application/vnd.google-apps.folder` and authoritative `appProperties`, then stores its ID and schema version in `chrome.storage.local`. The only other local Drive state is the Boolean explicit-disconnect preference.

The metadata client validates the cached folder and accepts user renames. Missing, trashed, unmarked, non-folder, or unwritable items are never modified; explicit setup continues to bounded marker discovery and, when necessary, creates one replacement. Google Picker remains a later enhancement.

The separate Phase 3C session initializer has exactly one upload path: authenticated `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable`. Its JSON metadata contains only the sanitized filename, JPEG MIME, internal parent ID, and DriveCapture screenshot markers. The only binary Drive request is offscreen's unauthenticated session `PUT`; multipart, sharing, permissions, download, and arbitrary Drive operations remain absent.

## Technology stack

- Chrome Extensions Manifest V3
- Vanilla JavaScript and ES modules where Chrome supports them
- HTML5 and CSS3
- Chrome `tabs`, `scripting`, `identity`, `storage`, `runtime`, and `offscreen` APIs
- HTML Canvas and Fetch APIs
- Google Drive API v3
- No third-party screenshot or OAuth libraries
- No remote executable code

## Permissions

The scaffold intentionally avoids `<all_urls>`. It also does not request the optional `"tabs"` manifest permission: the `activeTab` grant is sufficient for the user-initiated active-tab workflow and access to sensitive tab fields in that context.

| Permission | Reason |
| --- | --- |
| `activeTab` | Grants temporary access to the current page after the user invokes the extension. |
| `scripting` | Injects the local Phase 2B measurement and controlled-scrolling controller after an explicit user action. |
| `identity` | Acquires and clears transient Google OAuth tokens only in the service worker, including upload-session initialization. |
| `storage` | Stores the managed folder ID and explicit-disconnect Boolean locally, portable preferences in sync storage, and the small active-job/upload status in session storage. |
| `offscreen` | Hosts image decoding, DOM Canvas, Blob encoding, preview lifecycle, and the session-URI Blob upload. |
| `https://www.googleapis.com/*` | Allows direct requests to Google Drive API endpoints. |

The OAuth scope is `https://www.googleapis.com/auth/drive.file`. It allows DriveCapture to work with files it creates or that the user explicitly opens with the app, without granting general access to all Drive files. The extension contains no OAuth client secret.

## Known limitations

Scroll-and-stitch capture is inherently sensitive to page behavior:

- Animations, video, auto-advancing content, and continuously changing pages can produce seams or inconsistent frames.
- Virtualized lists may remove offscreen content, so the complete logical page may not exist in the DOM at once.
- Lazy-loaded content can change page height during capture. The implementation will remeasure within strict iteration and capture limits, but cannot chase an endlessly growing page.
- Phase 2E uses a conservative heuristic. Fixed headers, cookie banners, and floating controls are normally suppressed after the first segment, but sticky in-flow content remains visible and may repeat. Unusual layouts can still be misclassified.
- Cross-origin frames can be visible in screenshots but cannot be inspected or coordinated by the injected page module.
- Browser zoom, display scaling, and screenshot bitmap sizing can differ. Placement must use measured capture scale and actual scroll positions.
- Chrome may restrict script injection or capture on browser-internal pages, the Chrome Web Store, extension pages, and other protected URLs.
- Canvas dimensions and available memory impose a hard limit on very long or wide pages. DriveCapture must fail clearly rather than return a silently truncated image.
- Navigation, tab closure, or viewport resizing during a job will abort capture to avoid mixing incompatible segments.

## Prerequisites

- Google Chrome 116 or later, required for `chrome.runtime.getContexts()`-guarded offscreen-document creation.
- A Google account with access to Google Drive.
- A Google Cloud project where the Google Drive API is enabled.
- A stable Chrome extension ID registered in the OAuth client configuration.

## Google Cloud Console setup

1. Open the Google Cloud Console and create or select a project.
2. Enable **Google Drive API v3** for the project.
3. Configure the OAuth consent screen. Supply the required application and support details and add test users while the application remains in testing.
4. Add only the `https://www.googleapis.com/auth/drive.file` scope.
5. Create an OAuth client ID for a **Chrome extension**.
6. Enter the exact extension ID shown by Chrome. The ID in Google Cloud must match the loaded extension or `chrome.identity.getAuthToken()` will fail.
7. Replace `YOUR_CHROME_EXTENSION_OAUTH_CLIENT_ID.apps.googleusercontent.com` in `manifest.json` with the generated client ID. Never add a client secret to the extension.
8. Reload the extension before testing connection status or consent.

### Keeping the development extension ID stable

Chrome derives an unpacked extension's ID from its public key and/or installation context. Loading the same directory usually keeps the ID locally, but moving or recreating the project can change it.

For repeatable development across paths or machines, generate or reuse a development extension key and place its public-key value in the manifest's top-level `key` field. Keep the private `.pem` file outside the repository and never commit it. Register the resulting extension ID in Google Cloud. The initial scaffold omits `key` because its value is developer-specific; adding it intentionally is preferable to shipping a fake key.

If the extension ID changes, update the Chrome-extension OAuth client configuration or create a matching development client, then reload the extension.

## Local installation

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the DriveCapture project directory.
5. Open the extension's details page and note its extension ID for OAuth configuration.

The manifest contains the configured Chrome Extension OAuth client ID for this development extension ID. If the extension ID changes, create or select a matching Chrome Extension OAuth client in Google Cloud, update `manifest.json`, and reload the extension. DriveCapture still detects a missing, placeholder, or malformed client configuration and makes no token request in that state.

## Reloading after changes

Open `chrome://extensions` and click the **Reload** button on the DriveCapture card. Reload the target webpage as well after changing injected code. Close and reopen the popup after popup changes. Use the extension card's **service worker** link to inspect background errors.

## Phase 1 manual smoke test

After loading or reloading the unpacked extension:

1. Confirm Chrome reports no manifest or missing-resource error on the DriveCapture card.
2. Select the DriveCapture toolbar action and confirm the popup opens.
3. Confirm the popup displays `DriveCapture`, the scaffold-installed message, and `Connected` for the service worker.
4. Confirm **Run scaffold check** and **Capture visible viewport** are present, and do not start capture during this scaffold-only check.
5. Use the keyboard to focus **Run scaffold check** and confirm a clearly visible focus indicator.
6. Select **Run scaffold check**.
7. Confirm the live status reports that the job lock was acquired and released and that the offscreen document was created or reused, pinged, and closed.
8. Run the check again and confirm it still succeeds without a stale `CAPTURE_IN_PROGRESS` lock.
9. Inspect the extension service worker from `chrome://extensions` and confirm there are no errors.
10. Confirm the check causes no OAuth prompt, active-tab inspection, screenshot capture, script injection, or external network request.

`Run scaffold check` verifies only Phase 1 infrastructure: popup-to-worker messaging, the `chrome.storage.session` job lock, guarded offscreen creation through `chrome.runtime.getContexts()`, worker-to-offscreen ping messaging, offscreen closure, and `finally`-based lock release. It does not exercise future screenshot or Drive functionality.

## Phase 2A manual Chrome verification

On 2026-07-17, the visible-viewport capture was manually tested in Chrome. This record intentionally makes no additional manual claims about restricted-page handling, preview clearing, concurrent capture, extension storage, network activity, or service-worker console output because those checks were not separately reported as completed.

## Phase 2B manual Chrome verification

On 2026-07-17, the following Phase 2B scenarios were separately exercised in Chrome. A result is marked passed only where the outcome was directly observed.

| Test | Result | Relevant observations |
| --- | --- | --- |
| Successful restoration | Passed | On `eloquent.es`, the complete 9-position plan restored `(0, 3200)` to `(0, 3200)`, a difference of `(0, 0)` with the configured 2 px tolerance. A subsequent operation could start. |
| Cancellation | Passed | Cancellation was requested after a non-zero step. The popup reported that the diagnostic was canceled, the page restored to its starting position, and later capture and diagnostic jobs succeeded, confirming lock release. |
| Popup closure | Passed | Closing the popup during active scrolling allowed the worker-owned operation to continue cleanup and restore the page. A later capture and diagnostic succeeded without a stale lock. This completion-and-restoration behavior is intentional; popup lifetime does not own the worker job. |
| Viewport resize | Not separately verified | Automated coverage exercises the structured `VIEWPORT_CHANGED` cleanup path, but the complete Chrome scenario has not been independently observed. |
| Navigation | Partially verified | Navigating from `eloquent.es` to `example.com` stopped interaction with the old document; the replacement page remained at `(0, 0)` and accepted a new diagnostic. The initiating popup closed during navigation, so its old operation's structured error was not directly observed. The removed document is not claimed to have been restored. |
| Dynamic page | Passed: controlled failure | The Infinite Scroll full-page demo initially measured 3420 px high. Its same-document History API URL change exposed and led to correction of a false `PAGE_CHANGED` defect. After the correction, the diagnostic exceeded the limit of 2 dynamic-plan revisions and returned `DYNAMIC_PAGE_UNSTABLE` ("The page kept changing size during the diagnostic") without hanging; cleanup attempts restoration and lock release in `finally`. |
| Short page | Passed | `example.com` measured 1680 × 896 with zero maximum scroll. The plan and visited positions each contained only one zero-position step, no movement occurred, and restoration succeeded at `(0, 0)`. |
| Visible-capture regression | Passed | A 3360 × 1792 temporary JPEG preview appeared, was cleared, and a following 9-position diagnostic completed and restored successfully. |
| Concurrency | Not separately verified | Shared-lock rejection is covered automatically, but all three requested Chrome concurrency combinations have not been independently observed. |
| Privacy and runtime inspection | Not separately verified | Static and automated checks cover storage and logging boundaries; the complete Chrome network, service-worker console, and session-storage inspection remains pending. |

## Phase 2C manual Chrome verification

Real segmented capture has not yet been claimed as manually verified. After reloading the extension and target page in Chrome:

1. On a long static HTTPS page, start from the middle and run **Test segmented capture**.
2. Confirm every position is captured and acknowledged sequentially, metadata appears without screenshot previews, intervals are at least 550 ms, bitmap dimensions and scale are plausible, and the original position is restored.
3. Repeat on a page no taller than the viewport, at another browser zoom, and on a Retina/high-DPI display.
4. Cancel during throttling and after an acknowledged segment; then verify restoration and that another job starts without a stale lock.
5. Repeat with resize, navigation, and the Infinite Scroll demo; confirm bounded structured failures and cleanup.
6. Re-run the visible-viewport preview and original scrolling diagnostic.
7. Inspect service-worker/offscreen consoles, network activity, and extension storage to confirm there are no errors, external requests, stored screenshots, or stale session jobs.

## Phase 2D manual Chrome verification

On 2026-07-17, local full-page Canvas stitching and the temporary preview were manually verified successfully in Chrome. This confirms that the offscreen-generated stitched result and its Blob URL can be displayed by the popup in the tested extension profile.

No separate manual claim is recorded for page restoration, top/bottom completeness, seams or duplicated regions, sticky/fixed repetition, result clearing or replacement, memory cleanup, zoom, high-DPI output, cancellation, resize, navigation, Infinite Scroll, earlier-feature regressions, storage, network activity, or console inspection. Those scenarios remain unverified unless reported separately.

## Phase 2E manual Chrome verification

Phase 2E implementation is complete and automated verification passes, but manual Chrome verification of overlay suppression remains pending. Fixed/sticky handling remains heuristic. Visual correctness, DOM restoration on real pages, cancellation restoration, and difficult-page behavior are not yet fully accepted. After reloading the extension and target page:

1. Compare full-page captures with suppression enabled and disabled on pages containing a fixed top header, bottom cookie bar, floating action control, and sticky section headings.
2. Start from the middle and verify scroll restoration plus restoration of every modified element.
3. Cancel after suppression and force a capture failure; inspect the page DOM for leftover DriveCapture attributes or hidden elements.
4. Clear and replace the preview, then repeat on a short page, at 125%/150% zoom, on high-DPI output, and on the Infinite Scroll demo.
5. Re-run visible-viewport, scrolling, segmented-capture, and scaffold regressions.
6. Inspect extension storage, page DOM, network activity, and worker/offscreen consoles for page data, screenshot persistence, external requests, stale locks, or cleanup errors.

## Phase 3A manual Chrome verification

Phase 3A implementation and automated coverage are complete, but no Phase 3A Chrome result is claimed yet. Phase 2E overlay-suppression acceptance remains independently pending. The Phase 3A manual procedure is:

1. Reload the unpacked extension and capture with an empty filename; verify the automatic title/hostname/fallback label, local millisecond timestamp, rendered preview, and complete metadata.
2. Capture with a custom name without an extension and verify exactly one `.jpg`; then enter a punctuation-only name and verify `INVALID_OUTPUT_FILENAME` occurs before page scrolling.
3. Exercise 80%, 90%, 92%, and 95%; verify each result reports the selected quality, a valid signature, and a plausible size while still rendering.
4. Confirm a failed capture retains the editable custom name, success clears it, explicit preview clearing clears result/filename metadata, and replacement makes the prior Blob URL unavailable.
5. Close and reopen the popup; confirm JPEG quality persists but no custom filename, page metadata, result metadata, or screenshot data is restored from storage.
6. Re-run scaffold, visible-viewport, scrolling, and segmented-capture controls.
7. Inspect extension storage, worker/offscreen consoles, and network activity for stale locks, screenshots, full URLs, filename input, Blob URLs, external requests, or unexpected errors.
8. Confirm a completed/failed operation leaves no stale job lock. Do not mark Phase 2E visual or DOM-restoration scenarios complete unless they are separately exercised.

## Phase 3B.1 manual Chrome verification

The following results record only the Chrome checks reported as completed for Phase 3B.1.

| Manual check | Result |
| --- | --- |
| OAuth configuration recognized by the popup | Passed |
| Popup initialization caused no automatic consent prompt | Passed |
| Explicit **Connect Google Drive** completed successfully | Passed |
| Google Drive connection showed **Connected** | Passed |
| **Check Drive folder** created or prepared one managed folder | Passed |
| Managed folder existed in My Drive and was empty | Passed |
| Closing and reopening the popup caused no consent prompt | Passed |
| Cached-folder validation returned the existing managed folder | Passed |
| Renaming the folder to `DriveCapture Test` preserved recognition | Passed |
| DriveCapture did not rename the folder back | Passed |
| Disconnect cleared the local connected state | Passed |
| Disconnect did not delete or modify the Drive folder | Passed |
| Explicit disconnected state persisted after popup closure and reopening | Passed |
| No non-interactive silent reconnection occurred after explicit Disconnect | Passed |
| Explicit reconnect succeeded | Passed |
| Reconnect reused the existing renamed folder | Passed |
| No duplicate managed folder was created | Passed |
| No screenshot or other file was uploaded | Passed |
| Manual folder-cache clearing followed by marker-based rediscovery | Pending |
| Trashed-folder lifecycle | Pending |
| Account switching | Pending |
| Disabled Drive API failure | Pending |
| Non-test-user failure | Pending |
| Detailed Chrome storage inspection | Pending |
| Detailed service-worker, popup, and Network inspection | Pending |
| Local screenshot-capture regression after OAuth setup | Pending |
| Phase 2E real-page overlay acceptance | Pending |
| Phase 3A browser acceptance | Pending |

Disconnect is a persistent local DriveCapture state, not Google-account revocation. The existing OAuth grant may remain in the user’s Google Account; Google-level authorization revocation is not implemented. Explicit Connect clears the local disconnected state. The managed folder survives Disconnect, and a renamed folder remains valid because its private `appProperties` marker—not its visible name—defines its identity.

## Future implementation testing plan

Once the relevant roadmap phase is implemented:

1. Start with a short, static HTTPS page and verify the popup state sequence.
2. Confirm the resulting image contains the page once, has no obvious seams, and preserves the original page scroll position.
3. Test at multiple browser zoom and operating-system display-scale settings.
4. Test a long page with lazy-loaded images and a sticky header.
5. Verify capture calls remain at least 550 ms apart and the maximum capture limit stops unbounded pages.
6. Try a protected URL such as `chrome://extensions` and confirm a human-readable rejection.
7. Upload both a smaller and larger JPEG to exercise the same one-Blob resumable path and cancellation where practical.
8. Revoke or invalidate the token and verify exactly one refresh retry after a `401`.
9. Delete or revoke access to the managed `DriveCapture` folder and verify the extension informs the user before creating and locally recording a replacement.
10. Confirm each capture segment is acknowledged and released by the offscreen document before the next viewport is captured.

## Security and privacy

- Capture begins only after an explicit user action.
- `activeTab` is used instead of persistent website access.
- In Phase 2A, screenshot bytes travel only from Chrome to the service worker and directly to the open popup for temporary preview; no network request is made.
- The Phase 2A data URL is removed from popup state and the image `src` when the preview is cleared or the popup closes.
- In Phase 2C, the worker and offscreen document hold only the current segment; its data URL and decoded image representation are released before the next capture, while the popup receives metadata only.
- In Phase 3A, offscreen memory holds one Canvas, one currently decoding image, one validated final Blob, and one preview URL. The worker holds one current segment data URL only until its draw acknowledgement.
- Screenshot data is never stored in `chrome.storage`, IndexedDB, Cache Storage, the filesystem, or logs.
- Phase 3C sends the retained final Blob only from offscreen to its validated Google resumable-session URI and only after the explicit upload action.
- The extension requests only `drive.file`, not full Drive access.
- Access tokens are held in memory only as needed, never stored in `chrome.storage`, and never logged.
- Resumable-session URLs are retained only in offscreen memory for the active upload and are never stored or logged.
- No OAuth client secret belongs in a Chrome extension.
- All executable JavaScript is packaged locally; remote scripts, `eval`, and `new Function` are prohibited.
- Logs must contain operational metadata only and must exclude tokens and screenshot contents.
- `chrome.storage.sync` contains only portable, non-secret preferences such as JPEG quality and capture delay.
- `chrome.storage.local` contains only the installation-specific managed-folder cache and the Boolean explicit-disconnect preference. It contains no token, account ID, email, authorization header, or OAuth response.
- Disconnect is local to DriveCapture and persists until explicit reconnection. The Google OAuth grant may remain in the user's Google Account because Google-level revocation is not implemented.
- `chrome.storage.session` contains only the shared job lock plus safe current upload progress/result metadata, never screenshots, data URLs, preview URLs, tokens, Blobs, raw file IDs, raw responses, or upload-session URLs.

## Phase 3C manual Chrome verification

Phase 3C has not yet been manually verified in Chrome, and no real JPEG upload is claimed. After reloading the unpacked extension:

1. Connect Google Drive and validate the existing marked folder.
2. Capture a long page locally and verify its preview, filename, MIME, size, dimensions, and JPEG signature.
3. Confirm no upload starts after capture; select **Save to Google Drive** explicitly.
4. Verify preparing, folder validation, session creation, uploading, and verification states appear.
5. Confirm exactly one JPEG is added to the managed folder, with the expected filename and approximately matching size.
6. Open the JPEG in Drive and verify it is visually valid; confirm the local preview remains.
7. Select **Open in Google Drive** and confirm it opens the correct JPEG only after the click.
8. Close and reopen the popup; confirm no upload restarts and the same result cannot be uploaded accidentally.
9. Capture and upload a second page with a custom filename; confirm exactly one additional JPEG appears.
10. Disconnect and confirm upload becomes unavailable while existing Drive files and the local preview remain; reconnect and confirm folder reuse.
11. Inspect local, sync, and session storage plus worker/offscreen/popup consoles and Network activity for tokens, session URIs, screenshot bytes, raw IDs, raw responses, or stale locks.
12. Confirm the network shows only the expected resumable-session `POST`, Blob `PUT`, and at most one uncertainty status `PUT`, with no sharing or permissions request.
13. Test cancellation on a sufficiently large JPEG where practical and confirm the preview survives and an explicit retry is possible.

Interrupted-network, timeout, `308`, expired-session `404`, disabled API, quota, rate-limit, permission, browser shutdown, account-switch, and other difficult failure cases remain pending until separately exercised. Phase 3A browser acceptance and Phase 2E real-page overlay acceptance also remain pending.

## Troubleshooting

### OAuth client-ID mismatch

Symptoms can include authorization failure, an invalid client response, or `chrome.identity` returning `OAuth2 not granted or revoked`.

- Compare the extension ID on `chrome://extensions` with the ID registered on the Google Cloud Chrome-extension OAuth client.
- Confirm the manifest contains that client's complete `*.apps.googleusercontent.com` ID.
- Reload the extension after editing `manifest.json`.
- Confirm the consent screen is configured and the signed-in account is an allowed test user when the app is in testing.
- If a development key was changed or lost, restore it or register the newly derived extension ID.

### Inaccessible Drive folder

The Drive API may return `404` to avoid revealing an inaccessible folder, or `403` when the user lacks permission.

- Confirm the authenticated account can open the managed `DriveCapture` folder and add files to it.
- If the folder was deleted or access was revoked, DriveCapture should report that condition before creating a replacement and saving the new ID locally.
- Do not paste or manually configure an arbitrary folder ID in the normal MVP workflow.
- Keep `drive.file`; do not broaden the scope merely to enumerate the user's Drive.
- Check account quota and organizational policies if folder recreation or upload still fails.
- Google Picker selection of an existing folder remains a later enhancement.

### Unsupported page

DriveCapture accepts ordinary HTTP and HTTPS pages. It rejects browser-internal protocols, local files, source views, both Chrome Web Store hosts, missing tabs, and malformed page addresses. Navigate to a normal webpage and start a new capture.

## Project status

Phase 3C's explicit resumable upload implementation is complete with automated coverage, alongside the manually verified Phase 3B.1 OAuth/folder lifecycle. No real Phase 3C JPEG upload or Chrome success is claimed yet. Phase 3C manual acceptance, the remaining Phase 3B.1 edge cases, Phase 3A browser verification, and Phase 2E real-page overlay verification remain pending. Automatic upload, upload history, downloads, sharing, permissions management, Google-level OAuth revocation, horizontal capture, and multi-chunk continuation remain unimplemented.
