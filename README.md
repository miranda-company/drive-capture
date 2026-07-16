# DriveCapture

DriveCapture is a planned Manifest V3 Chrome extension that will capture a high-resolution, full-page image of the active HTTP or HTTPS page and upload the resulting JPEG to a dedicated Google Drive folder created and managed by the extension.

Phase 1 is implemented: the repository contains a loadable extension shell, an accessible popup, explicit message and error contracts, a session-backed scaffold job lock, a service-worker coordinator, a minimal offscreen document, and dependency-free unit tests. The unpacked-extension flow still requires the manual Chrome smoke test below. Screenshot capture, page scrolling, image stitching, authentication, Drive folder management, and upload behavior are not implemented. See [ROADMAP.md](ROADMAP.md) for the phased implementation plan.

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

## Planned MVP features

- Full-page, scroll-and-stitch capture using `chrome.tabs.captureVisibleTab()`.
- Capture pacing of at least 550 ms between screenshot calls.
- Lazy-content settling and bounded page-height recalculation.
- Actual scroll-position tracking, overlap removal, and final-segment cropping.
- High-DPI handling based on the captured bitmap-to-CSS viewport scale, rather than assuming `devicePixelRatio` is the capture scale.
- Reversible handling of visible fixed and sticky elements to reduce repeated overlays.
- Guaranteed restoration of the original scroll position and modified inline styles.
- JPEG output with configurable quality, defaulting to approximately `0.92`.
- Safe, bounded filenames in the form `yyyy-mm-dd_hostname_path_page-title.jpg`.
- Google OAuth through `chrome.identity` with the narrow `drive.file` scope.
- Automatic creation and reuse of a dedicated `DriveCapture` folder, with its ID stored in `chrome.storage.local`.
- Multipart upload for JPEGs up to 5 MB and resumable upload above 5 MB.
- One token-refresh retry after a `401`, plus bounded exponential backoff for recoverable upload failures.
- Clear failures for unsupported pages, navigation during capture, inaccessible folders, oversized canvases, and memory limits.
- A capture-job lock and small serializable recovery metadata in `chrome.storage.session`, without persisting screenshot data or credentials.

## Architecture

DriveCapture separates privileged coordination from page interaction and DOM-based image processing.

### Popup

The popup starts capture from an explicit user action and displays capture, processing, authentication, upload, success, and error states. It does not process image pixels or retain OAuth tokens.

### Manifest V3 service worker

The service worker coordinates one capture job at a time. It queries the active tab, injects the page capture module with `chrome.scripting`, calls `chrome.tabs.captureVisibleTab()`, manages the offscreen document, obtains OAuth tokens with `chrome.identity`, and sends the short-lived token plus JSON-serializable file and folder metadata to the offscreen document. It never receives the final JPEG Blob.

Service workers have no DOM or Canvas APIs, so stitching must not happen in the worker. Chrome runtime messages must be JSON-serializable; the design therefore does not attempt to send a Blob through `chrome.runtime` messaging.

Because MV3 workers may be suspended, the active capture-job lock and only the small serializable metadata needed to recognize or recover an interrupted job will use `chrome.storage.session`. The implementation must not rely solely on module-global variables. Screenshot data, data URLs, access tokens, JPEG Blobs, and resumable-session URLs must never be written to session storage.

### Injected page capture module

The injected module measures the document and CSS viewport, finds the scrolling element, scrolls to requested positions, reports actual positions, waits for layout to settle, and temporarily hides qualifying fixed or sticky elements after the first capture. Its cleanup path restores the original scroll position and every modified inline style.

The MVP will inject this module only after the action is invoked. It will not request persistent access to every website.

### Offscreen document

The offscreen document owns the image and upload lifecycle. For every viewport, it receives one data URL, decodes and draws it immediately, returns a JSON acknowledgement, and releases that data URL and decoded bitmap before the next capture begins. It determines the real X/Y capture scale from the first bitmap and CSS viewport, stitches and crops segments, and encodes an `image/jpeg` Blob.

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

On first upload, the Drive flow creates a folder named `DriveCapture` with MIME type `application/vnd.google-apps.folder`. It may attach `appProperties` that identify the folder as DriveCapture's managed capture folder. The service worker stores the returned folder ID in `chrome.storage.local`, which keeps this installation-specific resource reference off sync storage.

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
| `scripting` | Injects the local measurement, scrolling, and cleanup module into the active page. |
| `identity` | Obtains and invalidates Google OAuth tokens through Chrome. |
| `storage` | Stores the managed folder ID locally, portable preferences in sync storage, and the small active-job lock/metadata in session storage. |
| `offscreen` | Creates an extension document with DOM, Canvas, Blob, and Fetch access for incremental image processing, encoding, and direct Drive upload. |
| `https://www.googleapis.com/*` | Allows direct requests to Google Drive API endpoints. |

The OAuth scope is `https://www.googleapis.com/auth/drive.file`. It allows DriveCapture to work with files it creates or that the user explicitly opens with the app, without granting general access to all Drive files. The extension contains no OAuth client secret.

## Known limitations

Scroll-and-stitch capture is inherently sensitive to page behavior:

- Animations, video, auto-advancing content, and continuously changing pages can produce seams or inconsistent frames.
- Virtualized lists may remove offscreen content, so the complete logical page may not exist in the DOM at once.
- Lazy-loaded content can change page height during capture. The implementation will remeasure within strict iteration and capture limits, but cannot chase an endlessly growing page.
- Fixed/sticky detection is heuristic. Hiding every positioned element could remove meaningful content; hiding too few can repeat headers, cookie banners, or floating controls.
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
4. Confirm **Capture and upload** is disabled and the notice states that capture, Google authorization, and Drive upload are not implemented.
5. Use the keyboard to focus **Run scaffold check** and confirm a clearly visible focus indicator.
6. Select **Run scaffold check**.
7. Confirm the live status reports that the job lock was acquired and released and that the offscreen document was created or reused, pinged, and closed.
8. Run the check again and confirm it still succeeds without a stale `CAPTURE_IN_PROGRESS` lock.
9. Inspect the extension service worker from `chrome://extensions` and confirm there are no errors.
10. Confirm the check causes no OAuth prompt, active-tab inspection, screenshot capture, script injection, or external network request.

`Run scaffold check` verifies only Phase 1 infrastructure: popup-to-worker messaging, the `chrome.storage.session` job lock, guarded offscreen creation through `chrome.runtime.getContexts()`, worker-to-offscreen ping messaging, offscreen closure, and `finally`-based lock release. It does not exercise future screenshot or Drive functionality.

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
- Screenshot bytes are sent only to Google Drive.
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

DriveCapture will support ordinary HTTP and HTTPS pages. Chrome internal pages, the Chrome Web Store, and other restricted contexts cannot be injected into reliably. Navigate to a normal webpage and start a new capture.

## Project status

Phase 1 code and automated checks are complete. The shell is designed to be loadable in Chrome 116 or later, but successful unpacked loading and the popup scaffold check must be confirmed with the manual smoke test above. Phase 2 and all production capture, OAuth, folder, and upload behavior remain unimplemented.
