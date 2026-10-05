// background.js - service worker. Owns all storage writes for link lists so that
// concurrent add requests can be serialized through a single promise queue.

import {
  loadState,
  normalizeUrl,
  buildTxt,
  buildRunBat,
  buildDownloadPaths,
  countOf
} from './utils.js';

const CONTEXT_MENU_ID = 'add-to-download-list';

// ---------------------------------------------------------------- promise queue
// The service worker can be killed at any time, so the queue variable only lives
// for as long as the worker does - it is rebuilt automatically on wake-up.
let queue = Promise.resolve();

/** Run tasks one after another to avoid lost updates on concurrent adds. */
function enqueue(task) {
  const result = queue.then(task, task);
  // keep the chain alive even if a task throws
  queue = result.then(() => {}, () => {});
  return result;
}

// ---------------------------------------------------------------- badge helpers
/** Paint the badge: link count of the active list, green when ON, grey when OFF. */
async function updateBadge() {
  try {
    const state = await loadState();
    const count = countOf(state);
    await chrome.action.setBadgeText({ text: count ? String(count) : '' });
    await chrome.action.setBadgeBackgroundColor({
      color: state.collectEnabled ? '#1f9d3b' : '#8a8a8a'
    });
  } catch (err) {
    console.warn('[link-collector] badge update failed:', err);
  }
}

/** Briefly show a message instead of the count ("OFF" / "!"), then restore. */
async function flashBadge(text, color) {
  try {
    await chrome.action.setBadgeText({ text });
    if (color) await chrome.action.setBadgeBackgroundColor({ color });
  } catch { /* ignore */ }
  setTimeout(updateBadge, 2000);
}

/**
 * "Notification-like" feedback. Only the badge is used, because the extension
 * deliberately does not request the "notifications" permission.
 */
async function notifyFeedback(text) {
  await flashBadge(text.length > 4 ? text.slice(0, 4) : text, '#d93025');
}

// ---------------------------------------------------------------- add links
/**
 * Add URLs to a list, skipping duplicates.
 * @returns {{added:number, duplicates:number, invalid:number}}
 */
async function addLinks(listName, urls) {
  return enqueue(async () => {
    const state = await loadState();
    const name = listName || state.activeList;
    if (!name || !state.lists[name]) {
      return { added: 0, duplicates: 0, invalid: 0, missingList: true };
    }

    const list = state.lists[name];
    const existing = new Set(list);
    let added = 0;
    let duplicates = 0;
    let invalid = 0;

    for (const raw of urls) {
      const url = normalizeUrl(raw);
      if (!url) {
        invalid += 1;
        continue;
      }
      if (existing.has(url)) {
        duplicates += 1;
        continue;
      }
      existing.add(url);
      list.push(url);
      added += 1;
    }

    if (added) {
      state.lists = { ...state.lists, [name]: list };
      try {
        await chrome.storage.local.set({ lists: state.lists });
      } catch (err) {
        console.warn('[link-collector] failed to save list:', err);
        return { added: 0, duplicates, invalid, error: String(err && err.message || err) };
      }
    }

    await updateBadge();
    return { added, duplicates, invalid, missingList: false };
  });
}

/**
 * Shared handler for context menu, shortcut, auto-collect and popup messages.
 * `manual` requests come from the popup buttons, which keep working even when
 * the Collect toggle is OFF (the user explicitly clicked the button).
 */
async function collect(urls, source, manual = false) {
  const state = await loadState();

  if (!manual && !state.collectEnabled) {
    await notifyFeedback('OFF');
    return { ok: false, reason: 'off' };
  }
  if (!state.activeList || !state.lists[state.activeList]) {
    await notifyFeedback('!');
    return { ok: false, reason: 'no-list' };
  }

  const result = await addLinks(state.activeList, urls);
  if (result.missingList) {
    await flashBadge('!', '#d93025');
    return result;
  }
  // addLinks() already refreshed the badge, so nothing else to do here
  return { ok: true, ...result, source };
}

// ---------------------------------------------------------------- download
/** Turn a string into a data: URL. Service workers cannot use URL.createObjectURL. */
function toDataUrl(text) {
  return 'data:text/plain;charset=utf-8,' + encodeURIComponent(text);
}

/**
 * Create the files for a list: a folder on disk, the .txt inside it and an
 * optional ready-to-run yt-dlp .bat. Each file goes through chrome.downloads so
 * the browser writes it to real disk, creating sub-folders as needed.
 */
async function downloadList(listName) {
  const state = await loadState();
  const name = listName || state.activeList;
  if (!name || !state.lists[name]) return { ok: false, reason: 'no-list' };

  const urls = state.lists[name];
  if (!urls.length) return { ok: false, reason: 'empty' };

  const paths = buildDownloadPaths(name, state.settings);
  // the .txt itself
  const txtUrl = toDataUrl(buildTxt(urls));
  // the "run the download script" helper
  const batUrl = toDataUrl(buildRunBat(name));

  let downloadId;
  try {
    downloadId = await chrome.downloads.download({
      url: txtUrl,
      filename: paths.txt,
      saveAs: true // Save dialog: choose where the folder goes / rename it
    });
  } catch (err) {
    return { ok: false, reason: 'error', message: String(err && err.message || err) };
  }

  // chrome.runtime.lastError means the Save dialog was cancelled or the write failed
  if (chrome.runtime.lastError || !downloadId) {
    return { ok: false, reason: 'cancelled' };
  }

  // The .bat is written silently into the same folder, so it never interrupts.
  let batSaved = false;
  if (state.settings.alsoSaveBat) {
    try {
      await chrome.downloads.download({ url: batUrl, filename: paths.bat, conflictAction: 'uniquify' });
      batSaved = !chrome.runtime.lastError;
    } catch (err) {
      console.warn('[link-collector] could not write the .bat:', err);
    }
  }

  // Only now - after the download really started - is it safe to clear the list
  if (state.settings.clearAfterDownload) {
    try {
      await chrome.storage.local.set({
        lists: { ...state.lists, [name]: [] }
      });
    } catch (err) {
      console.warn('[link-collector] could not clear list:', err);
    }
  }

  await updateBadge();
  return {
    ok: true,
    filename: paths.txt,
    folder: paths.folder,
    bat: batSaved ? paths.bat : null,
    count: urls.length,
    cleared: !!state.settings.clearAfterDownload
  };
}

// ------------------------------------------------------- native messaging host
const NATIVE_HOST = 'com.linkcollector.ytdlp';

/**
 * Send one JSON message to the native host (native-host/host.py) and resolve with
 * its reply. chrome.runtime.sendNativeMessage uses a callback, so it is wrapped
 * in a Promise here. Errors are returned as { ok:false, error } instead of thrown,
 * so callers never need try/catch around an await.
 */
function sendNative(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST, message, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          resolve({ ok: false, error: err.message || String(err), nativeError: true });
        } else if (!response) {
          resolve({ ok: false, error: 'The helper returned no response.', nativeError: true });
        } else {
          resolve(response);
        }
      });
    } catch (err) {
      resolve({ ok: false, error: String(err && err.message || err), nativeError: true });
    }
  });
}

/**
 * Create Desktop/<ListName>/, write the .txt and start yt-dlp there via the helper.
 * @returns the helper's reply, always { ok, ... }
 */
async function runDownload(listName) {
  const state = await loadState();
  const name = listName || state.activeList;
  if (!name || !state.lists[name]) return { ok: false, error: 'No active list - create one first.' };

  const urls = state.lists[name];
  if (!urls.length) return { ok: false, error: 'This list is empty' };

  const result = await sendNative({
    action: 'download',
    listName: name,
    urls,
    extraOptions: state.settings.extraYtdlpOptions || ''
  });

  // Only clear the list when the helper actually reported success
  if (result.ok && state.settings.clearAfterDownload) {
    try {
      await chrome.storage.local.set({ lists: { ...state.lists, [name]: [] } });
      result.cleared = true;
    } catch (err) {
      console.warn('[link-collector] could not clear list:', err);
    }
  }

  await updateBadge();
  return result;
}

/** Ask the helper whether it is installed and whether yt-dlp is available. */
async function pingHelper() {
  return sendNative({ action: 'ping' });
}

/** Reveal a folder created earlier. The host only allows paths inside the Desktop. */
async function openFolder(path) {
  return sendNative({ action: 'openFolder', path });
}

// ---------------------------------------------------------------- messaging
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message && message.type) {
        case 'COLLECT':
          return sendResponse(await collect(message.urls, message.source, !!message.manual));

        case 'DOWNLOAD':
          return sendResponse(await downloadList(message.listName));

        case 'DOWNLOAD_NATIVE':
          return sendResponse(await runDownload(message.listName));

        case 'PING_NATIVE':
          return sendResponse(await pingHelper());

        case 'OPEN_FOLDER':
          return sendResponse(await openFolder(message.path));

        case 'ADD_LIST':
          // create (or switch to) a topic list
          return sendResponse(await addList(message.name));

        case 'UPDATE_BADGE':
          await updateBadge();
          return sendResponse({ ok: true });

        default:
          return sendResponse({ ok: false, reason: 'unknown' });
      }
    } catch (err) {
      console.warn('[link-collector] message handler error:', err);
      return sendResponse({ ok: false, reason: 'error', message: String(err && err.message || err) });
    }
  })();
  return true; // keep the message channel open for the async response
});

/** Create a new list, or return an error if the name is empty or taken. */
async function addList(name) {
  const clean = String(name || '').trim();
  if (!clean) return { ok: false, reason: 'empty-name' };

  return enqueue(async () => {
    const state = await loadState();
    if (Object.prototype.hasOwnProperty.call(state.lists, clean)) {
      return { ok: false, reason: 'exists', name: clean };
    }
    state.lists = { ...state.lists, [clean]: [] };
    state.activeList = clean;
    try {
      await chrome.storage.local.set({ lists: state.lists, activeList: clean });
    } catch (err) {
      return { ok: false, reason: 'error', message: String(err && err.message || err) };
    }
    await updateBadge();
    return { ok: true, name: clean };
  });
}

// ---------------------------------------------------------------- context menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'Add to download list',
      contexts: ['link', 'page', 'video']
    }, () => { void chrome.runtime.lastError; });
  });
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => { updateBadge(); });

chrome.contextMenus.onClicked.addListener((info, tab) => {
  (async () => {
    try {
      const url = info.linkUrl || info.pageUrl || (tab && tab.url);
      if (!url) return;
      await collect([url], 'context-menu');
    } catch (err) {
      console.warn('[link-collector] context menu failed:', err);
    }
  })();
});

// ---------------------------------------------------------------- shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'add-current-tab') return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;
    await collect([tab.url], 'shortcut');
  } catch (err) {
    console.warn('[link-collector] shortcut failed:', err);
  }
});

// ---------------------------------------------------------------- storage sync
// Badge follows storage changes made by the popup as well as the worker.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.lists || changes.activeList || changes.collectEnabled)) {
    updateBadge();
  }
});

// make sure the badge is correct whenever the worker wakes up
updateBadge();
