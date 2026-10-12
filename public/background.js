// Clicking the toolbar icon opens the editor in a tab, or focuses it if it is already open
// (a single tab avoids two editors writing the same diagram to storage).
// runtime.getContexts sees the extension's own tabs without needing the "tabs" permission.
const APP_URL = chrome.runtime.getURL('index.html');

chrome.action.onClicked.addListener(async () => {
  try {
    const [ctx] = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [APP_URL] });
    if (ctx && ctx.tabId >= 0) {
      await chrome.tabs.update(ctx.tabId, { active: true });
      if (ctx.windowId >= 0) await chrome.windows.update(ctx.windowId, { focused: true });
      return;
    }
  } catch {
    // Older Chrome without getContexts: just open a new tab.
  }
  await chrome.tabs.create({ url: APP_URL });
});
