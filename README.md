# DriveCapture

DriveCapture is a planned Manifest V3 Chrome extension that will capture a high-resolution, full-page image of the active HTTP or HTTPS page and upload the resulting JPEG to a dedicated Google Drive folder created and managed by the extension.

Phases 2A through 2E and Phase 3A are implemented on top of the Phase 1 shell. In addition to the earlier diagnostics, DriveCapture can generate a real full-page JPEG locally, heuristically suppress repeated fixed overlays, stitch incrementally in the offscreen document, apply a validated JPEG-quality preference, generate a safe output filename, validate the encoded JPEG boundaries, and expose one temporary Blob-URL preview with serializable output metadata. Authentication, Drive folder management, and upload remain unimplemented.

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
- The result is local and temporary. No screenshot is written to Chrome storage, uploaded, downloaded, fetched, or sent to an external service.

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
5. Chrome requests Google authorization if needed.
6. On first upload, DriveCapture creates a Drive folder named `DriveCapture`; later uploads validate and reuse its locally stored ID.
7. The service worker sends a short-lived OAuth token and JSON file metadata to the offscreen document, which uploads its Blob directly to Google Drive.
8. The offscreen document returns only JSON-serializable Drive metadata, and the popup reports success with a link to the created file or shows a useful error.

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
- Multipart upload for JPEGs up to 5 MB and resumable upload above 5 MB.
- One token-refresh retry after a `401`, plus bounded exponential backoff for recoverable upload failures.
- Clear failures for unsupported pages, navigation during capture, inaccessible folders, oversized canvases, and memory limits.
- A capture-job lock and small serializable recovery metadata in `chrome.storage.session`, without persisting screenshot data or credentials.

## Architecture

DriveCapture separates privileged coordination from page interaction and DOM-based image processing. Phase 3A adds output configuration and validation to the local incremental stitching/preview pipeline; upload remains future work.

### Popup

The popup preserves every earlier control and adds **Capture full page locally**, an optional per-capture filename, a validated JPEG-quality preference, cancellation, detailed progress, a responsive temporary preview, result metadata, and explicit clearing. It receives a Blob URL and serializable metadata only; it never receives the final Blob or persists the preview, filename, or output metadata. Only JPEG quality is portable in sync storage.

### Manifest V3 service worker

The service worker coordinates all workflows through the shared session-backed lock. The full-page coordinator validates requested output settings before scrolling, derives a sanitized filename from transient active-tab title/hostname metadata, measures and scrolls, enforces capture pacing, holds only the current segment data URL, waits for the offscreen draw acknowledgement, releases the reference, and retains only small serializable placement/result metadata. Canvas and Blob APIs are never used in the worker.

In the future upload pipeline, the worker will obtain OAuth tokens and send short-lived tokens plus JSON metadata to the offscreen document. It will never receive the final stitched JPEG Blob.

Service workers have no DOM or Canvas APIs, so stitching must not happen in the worker. Chrome runtime messages must be JSON-serializable; the design therefore does not attempt to send a Blob through `chrome.runtime` messaging.

Because MV3 workers may be suspended, the active capture-job lock and only the small serializable metadata needed to recognize or recover an interrupted job will use `chrome.storage.session`. The implementation must not rely solely on module-global variables. Screenshot data, data URLs, access tokens, JPEG Blobs, and resumable-session URLs must never be written to session storage.

### Injected page capture module

The local packaged page controller measures and scrolls the document, reports actual positions, detects document/viewport changes, and restores the original scroll position. Phase 2E adds a separately packaged overlay controller that owns all candidate inventory, reversible attribute assignment, `visibility` suppression, geometry verification, and restoration. No page element reference leaves the injected context.

The MVP will inject this module only after the action is invoked. It will not request persistent access to every website.

### Offscreen document

The offscreen document supports both the unchanged Phase 2C decode diagnostic and a full-page stitching session. The stitching session creates one Canvas, decodes and draws one current segment, releases its `Image` before acknowledging, records small placement metadata, and encodes one final `image/jpeg` Blob at the validated per-session quality. It verifies only the Blob's two-byte start and end slices, retains no full Base64 representation of the result, and reports JSON-safe technical metadata. Result get/clear messages expose only serializable metadata and manage URL revocation and memory release.

The Blob stays inside the offscreen document. When stitching is complete, the service worker supplies a short-lived OAuth token and JSON metadata. The offscreen document uses Fetch directly for multipart or resumable Drive upload, then returns only JSON-serializable Drive metadata such as `id`, `name`, `webViewLink`, and `parents`. It releases the Blob, canvas, token reference, and upload state after success or failure. Access tokens and resumable-session URLs are never stored or logged.

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

This client is planned but not implemented. On first upload, the future Drive flow will create a folder named `DriveCapture` with MIME type `application/vnd.google-apps.folder`. It may attach `appProperties` that identify the folder as DriveCapture's managed capture folder. The service worker will store the returned folder ID in `chrome.storage.local`, which keeps this installation-specific resource reference off sync storage.

On later uploads, the offscreen upload flow validates the stored folder using the token and reuses it as the file's parent. If the folder is missing or inaccessible, the extension informs the user before creating a replacement and updating the locally stored ID. Google Picker selection of an existing folder is a later enhancement, not part of the normal MVP workflow.

The offscreen Drive client selects multipart or resumable upload based on the retained Blob size and returns `id`, `name`, `webViewLink`, and `parents`. If Drive returns `401`, it returns a serializable authentication error to the worker; the worker removes the cached token, obtains a fresh token, and retries the upload once by sending the replacement token back to the offscreen document.

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
| `identity` | Reserved for future Google OAuth; unused in Phase 2A. |
| `storage` | Stores the managed folder ID locally, portable preferences in sync storage, and the small active-job lock/metadata in session storage. |
| `offscreen` | Hosts the Phase 2C decoder and Phase 2D DOM Canvas, Blob encoding, and temporary result lifecycle. |
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

The Phase 1 scaffold deliberately preserves the placeholder OAuth client ID. It does not request authorization, so real Google Cloud OAuth configuration and replacement of that placeholder are deferred to Phase 4.

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

## Future implementation testing plan

Once the relevant roadmap phase is implemented:

1. Start with a short, static HTTPS page and verify the popup state sequence.
2. Confirm the resulting image contains the page once, has no obvious seams, and preserves the original page scroll position.
3. Test at multiple browser zoom and operating-system display-scale settings.
4. Test a long page with lazy-loaded images and a sticky header.
5. Verify capture calls remain at least 550 ms apart and the maximum capture limit stops unbounded pages.
6. Try a protected URL such as `chrome://extensions` and confirm a human-readable rejection.
7. Upload both a file at or below 5 MB and a file above 5 MB to exercise multipart and resumable paths.
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
- Phase 2D screenshot bytes remain local. A future upload phase will send them only from offscreen to Google Drive.
- The extension requests only `drive.file`, not full Drive access.
- Access tokens are held in memory only as needed, never stored in `chrome.storage`, and never logged.
- Resumable-session URLs are retained only in offscreen memory for the active upload and are never stored or logged.
- No OAuth client secret belongs in a Chrome extension.
- All executable JavaScript is packaged locally; remote scripts, `eval`, and `new Function` are prohibited.
- Logs must contain operational metadata only and must exclude tokens and screenshot contents.
- `chrome.storage.sync` contains only portable, non-secret preferences such as JPEG quality and capture delay.
- The managed Drive folder ID is installation-specific and stored in `chrome.storage.local`.
- `chrome.storage.session` contains only a capture lock and small serializable job metadata, never screenshots, data URLs, tokens, Blobs, or upload-session URLs.

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

Phase 3A filename generation, exact JPEG-quality configuration, boundary-signature validation, and expanded local output metadata are implemented with automated coverage. Phase 3A manual Chrome verification remains pending. Phase 2E fixed-overlay suppression is implemented, but its manual Chrome verification also remains pending. Local Phase 2D stitching and popup display of the offscreen Blob URL were manually verified on 2026-07-17. The earlier scaffold, visible capture, scrolling diagnostic, and segmented diagnostic remain available. OAuth, Drive, external upload Fetch, and downloads remain unimplemented.
