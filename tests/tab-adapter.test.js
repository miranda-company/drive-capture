import assert from "node:assert/strict";
import test from "node:test";

import { createChromeTabAdapter } from "../src/background/tab-adapter.js";

test("queries only the active tab in the current window", async () => {
  const calls = [];
  const adapter = createChromeTabAdapter({
    tabs: {
      async query(options) {
        calls.push(options);
        return [{ id: 1 }];
      },
      async captureVisibleTab() {
        return "unused";
      }
    }
  });

  await adapter.queryActiveTab();
  assert.deepEqual(calls, [{ active: true, currentWindow: true }]);
});

test("passes the window and capture options directly to Chrome", async () => {
  const calls = [];
  const adapter = createChromeTabAdapter({
    tabs: {
      async query() {
        return [];
      },
      async captureVisibleTab(windowId, options) {
        calls.push({ windowId, options });
        return "data:image/jpeg;base64,TQ==";
      }
    }
  });

  await adapter.captureVisibleTab(9, { format: "jpeg", quality: 92 });
  assert.deepEqual(calls, [{ windowId: 9, options: { format: "jpeg", quality: 92 } }]);
});
