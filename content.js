// content.js - runs on every page (<all_urls>).
// Listens for the "copy" event, extracts http/https URLs from the copied text and
// hands them to the background service worker. Does nothing unless the user has
// enabled BOTH the main "Collect links" toggle and the auto-collect setting.

(async () => {
  // cache the flags so we do not hit storage on every copy
  let enabled = false;
  let autoCollect = false;

  // read the flags from chrome.storage.local on load and whenever they change
  const refresh = async () => {
    try {
      const data = await chrome.storage.local.get(['collectEnabled', 'settings']);
      enabled = data.collectEnabled !== false; // default ON
      autoCollect = !!(data.settings && data.settings.autoCollectCopy);
    } catch {
      enabled = false;
      autoCollect = false;
    }
  };
  await refresh();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.collectEnabled) enabled = changes.collectEnabled.newValue !== false;
    if (changes.settings) autoCollect = !!(changes.settings.newValue && changes.settings.newValue.autoCollectCopy);
  });

  // same URL regex as utils.js extractUrls() (content scripts cannot import ES modules)
  const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;

  document.addEventListener('copy', (event) => {
    if (!enabled || !autoCollect) return;

    // get the copied text from the selection; fall back to the clipboardData
    const selection = String((window.getSelection && window.getSelection()) || '');
    const text = selection || (event.clipboardData && event.clipboardData.getData('text/plain')) || '';
    if (!text) return;

    const urls = text.match(URL_RE);
    if (!urls || !urls.length) return;

    try {
      chrome.runtime.sendMessage({ type: 'COLLECT', urls, source: 'auto-copy' }, (response) => {
        // read lastError so it is never logged as "Unchecked runtime.lastError"
        void chrome.runtime.lastError;
        void response;
      });
    } catch (err) {
      console.warn('[link-collector] auto-collect failed:', err);
    }
  }, true);
})();
