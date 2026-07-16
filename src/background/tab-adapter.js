export function createChromeTabAdapter(chromeApi = globalThis.chrome) {
  if (!chromeApi?.tabs) {
    throw new TypeError("The Chrome tabs API is required.");
  }

  return Object.freeze({
    queryActiveTab() {
      return chromeApi.tabs.query({
        active: true,
        currentWindow: true
      });
    },

    captureVisibleTab(windowId, options) {
      return chromeApi.tabs.captureVisibleTab(windowId, options);
    }
  });
}
