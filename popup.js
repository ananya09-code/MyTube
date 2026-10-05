// popup.js - all popup UI logic. Uses textContent for every user-supplied string,
// and never uses prompt()/confirm() because those are unreliable in extension popups.

import { loadState, extractUrls, countOf } from './utils.js';

// ---------------------------------------------------------------- DOM refs
const $ = (id) => document.getElementById(id);

const collectToggle = $('collectToggle');
const listSelect = $('listSelect');
const newListBtn = $('newListBtn');
const deleteListBtn = $('deleteListBtn');
const newListForm = $('newListForm');
const newListName = $('newListName');
const createListBtn = $('createListBtn');
const cancelNewListBtn = $('cancelNewListBtn');
const confirmForm = $('confirmForm');
const confirmText = $('confirmText');
const confirmYesBtn = $('confirmYesBtn');
const confirmNoBtn = $('confirmNoBtn');
const addTabBtn = $('addTabBtn');
const pasteBtn = $('pasteBtn');
const emptyState = $('emptyState');
const linkList = $('linkList');
const emptyList = $('emptyList');
const status = $('status');
const openFolderRow = $('openFolderRow');
const clearAfterDownload = $('clearAfterDownload');
const autoCollectCopy = $('autoCollectCopy');
const useFolders = $('useFolders');
const alsoSaveBat = $('alsoSaveBat');
const folderPrefix = $('folderPrefix');
const extraYtdlpOptions = $('extraYtdlpOptions');
const testHelperBtn = $('testHelperBtn');
const helperStatus = $('helperStatus');
const saveTxtBtn = $('saveTxtBtn');
const linkCount = $('linkCount');
const clearBtn = $('clearBtn');
const downloadBtn = $('downloadBtn');

// ---------------------------------------------------------------- state
let state = null;          // cached copy of chrome.storage.local
let confirmAction = null;  // callback run when the inline confirm is accepted
let statusTimer = null;

/** Show a message in the status line; auto-hides after 3s. */
function setStatus(message, kind = '') {
  status.textContent = message;
  status.className = 'status' + (kind ? ' ' + kind : '');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    status.textContent = '';
    status.className = 'status';
  }, 3000);
}

/** Send a message to the service worker and never leave a rejection unhandled. */
function sendMessage(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const err = chrome.runtime.lastError;
        resolve(err ? { ok: false, reason: 'error', message: err.message } : (response || { ok: false }));
      });
    } catch (err) {
      resolve({ ok: false, reason: 'error', message: String(err && err.message || err) });
    }
  });
}

// ---------------------------------------------------------------- rendering
/** Ask the background worker to refresh the badge. */
async function refreshBadge() {
  await sendMessage({ type: 'UPDATE_BADGE' });
}

/** Draw everything from the cached state. */
function render() {
  const names = Object.keys(state.lists);
  const hasLists = names.length > 0;
  const count = countOf(state);

  // header toggle
  collectToggle.checked = state.collectEnabled;

  // settings
  clearAfterDownload.checked = state.settings.clearAfterDownload;
  autoCollectCopy.checked = state.settings.autoCollectCopy;
  useFolders.checked = state.settings.useFolders;
  alsoSaveBat.checked = state.settings.alsoSaveBat;
  if (document.activeElement !== extraYtdlpOptions) {
    extraYtdlpOptions.value = state.settings.extraYtdlpOptions;
  }
  if (document.activeElement !== folderPrefix) {
    folderPrefix.value = state.settings.folderPrefix;
  }
  // the folder name and the .bat only matter when folders are enabled
  folderPrefix.disabled = !state.settings.useFolders;
  alsoSaveBat.disabled = !state.settings.useFolders;

  // empty state
  emptyState.classList.toggle('hidden', hasLists);

  // list dropdown, shown as "Name (count)"
  listSelect.textContent = '';
  for (const name of names) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = `${name} (${state.lists[name].length})`;
    listSelect.appendChild(option);
  }
  if (state.activeList && Object.prototype.hasOwnProperty.call(state.lists, state.activeList)) {
    listSelect.value = state.activeList;
  } else if (names.length) {
    state.activeList = names[0];
    listSelect.value = names[0];
  }

  // links
  const urls = state.activeList ? state.lists[state.activeList] || [] : [];
  linkList.textContent = '';
  urls.forEach((url, index) => {
    const item = document.createElement('li');
    item.className = 'link-item';

    const num = document.createElement('span');
    num.className = 'link-num';
    num.textContent = String(index + 1);

    const label = document.createElement('span');
    label.className = 'link-url';           // CSS truncates with ellipsis
    label.textContent = url;                 // escaped automatically
    label.title = url;                       // full URL in the tooltip

    const remove = document.createElement('button');
    remove.className = 'link-remove';
    remove.type = 'button';
    remove.textContent = '\u00d7';
    remove.title = 'Remove this link';
    remove.addEventListener('click', () => removeLink(index));

    item.append(num, label, remove);
    linkList.appendChild(item);
  });

  emptyList.classList.toggle('hidden', !urls.length || !hasLists);

  // footer
  linkCount.textContent = `${count} link${count === 1 ? '' : 's'}`;

  // disable the add / download buttons while there is no list to use
  const usable = hasLists && !!state.activeList;
  addTabBtn.disabled = !usable;
  pasteBtn.disabled = !usable;
  downloadBtn.disabled = !usable;
  saveTxtBtn.disabled = !usable;
  clearBtn.disabled = !usable;
  deleteListBtn.disabled = !hasLists;
}

/** Reload state from storage and redraw. */
async function reload() {
  try {
    state = await loadState();
    render();
  } catch (err) {
    setStatus('Storage error: ' + (err && err.message ? err.message : err), 'err');
  }
}

// ---------------------------------------------------------------- actions
/** Persist only the given storage keys. */
async function save(patch) {
  try {
    await chrome.storage.local.set(patch);
    return true;
  } catch (err) {
    setStatus('Storage error: ' + (err && err.message ? err.message : err), 'err');
    return false;
  }
}

/** Create a new topic list from the inline form. */
async function createList() {
  const name = newListName.value.trim();
  if (!name) {
    setStatus('Please type a list name', 'err');
    return;
  }
  if (Object.prototype.hasOwnProperty.call(state.lists, name)) {
    setStatus(`A list called "${name}" already exists`, 'err');
    return;
  }
  const result = await sendMessage({ type: 'ADD_LIST', name });
  if (!result.ok) {
    setStatus(result.reason === 'exists'
      ? `A list called "${name}" already exists`
      : 'Could not create list', 'err');
    return;
  }
  newListName.value = '';
  newListForm.classList.add('hidden');
  setStatus(`Created "${name}"`, 'ok');
  await reload();
}

/** Delete the active list; other lists are never touched. */
async function deleteActiveList() {
  const name = state.activeList;
  if (!name) return;
  const next = { ...state.lists };
  delete next[name];
  const remaining = Object.keys(next);
  const activeList = remaining.length ? remaining[0] : null;
  const ok = await save({ lists: next, activeList });
  if (!ok) return;
  setStatus(`Deleted "${name}"`, 'ok');
  await reload();
}

/** Remove one link by index from the active list. */
async function removeLink(index) {
  const name = state.activeList;
  if (!name || !state.lists[name]) return;
  const list = state.lists[name].filter((_, i) => i !== index);
  if (await save({ lists: { ...state.lists, [name]: list } })) {
    await reload();
  }
}

/** Empty the active list. */
async function clearActiveList() {
  const name = state.activeList;
  if (!name || !state.lists[name]) return;
  if (await save({ lists: { ...state.lists, [name]: [] } })) {
    setStatus(`Cleared "${name}"`, 'ok');
    await reload();
  }
}

/** Add the URL of the currently active tab. */
async function addCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      setStatus('No URL on this tab', 'err');
      return;
    }
    // manual: true -> an explicit popup click works even when the toggle is OFF
    const result = await sendMessage({ type: 'COLLECT', urls: [tab.url], source: 'popup-tab', manual: true });
    reportAddResult(result);
  } catch (err) {
    setStatus('Could not read tab: ' + (err && err.message ? err.message : err), 'err');
  }
}

/** Read the clipboard and add every URL found in it. */
async function pasteFromClipboard() {
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch (err) {
    setStatus('Cannot read clipboard: ' + (err && err.message ? err.message : err), 'err');
    return;
  }
  const urls = extractUrls(text);
  if (!urls.length) {
    setStatus('No http/https links found in the clipboard', 'err');
    return;
  }
  // manual: true -> an explicit popup click works even when the toggle is OFF
  const result = await sendMessage({ type: 'COLLECT', urls, source: 'popup-clipboard', manual: true });
  reportAddResult(result);
}

/** Turn a background response into a status message. */
function reportAddResult(result) {
  if (!result) return;
  if (result.reason === 'off') {
    setStatus('Collect links is OFF - turn it on first', 'err');
    return;
  }
  if (result.reason === 'no-list' || result.missingList) {
    setStatus('No active list - create one first', 'err');
    return;
  }
  if (result.reason === 'error') {
    setStatus('Error: ' + (result.message || 'unknown'), 'err');
    return;
  }
  const parts = [`Added ${result.added}`];
  if (result.duplicates) parts.push(`skipped ${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'}`);
  if (result.invalid) parts.push(`skipped ${result.invalid} invalid`);
  setStatus(parts.join(', '), 'ok');
  reload();
}

// ---------------------------------------------------------------- inline confirm
/** Show the inline confirmation bar and remember what Yes should do. */
function askConfirm(text, action) {
  confirmText.textContent = text;
  confirmAction = action;
  confirmForm.classList.remove('hidden');
  confirmYesBtn.focus();
}

function hideConfirm() {
  confirmForm.classList.add('hidden');
  confirmAction = null;
}

// ---------------------------------------------------------------- wiring
collectToggle.addEventListener('change', async () => {
  if (await save({ collectEnabled: collectToggle.checked })) {
    await reload();
    setStatus(collectToggle.checked ? 'Collect links is ON' : 'Collect links is OFF');
  }
});

listSelect.addEventListener('change', async () => {
  if (await save({ activeList: listSelect.value })) {
    state.activeList = listSelect.value;
    render();
    await refreshBadge();
    setStatus(`Active list: ${listSelect.value}`, 'ok');
  }
});

newListBtn.addEventListener('click', () => {
  newListForm.classList.remove('hidden');
  newListName.value = '';
  newListName.focus();
});
createListBtn.addEventListener('click', createList);
cancelNewListBtn.addEventListener('click', () => {
  newListForm.classList.add('hidden');
  newListName.value = '';
});
newListName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createList();
  if (e.key === 'Escape') cancelNewListBtn.click();
});

deleteListBtn.addEventListener('click', () => {
  const name = state.activeList;
  if (!name) return;
  askConfirm(`Delete the list "${name}" and its ${countOf(state)} link(s)?`, deleteActiveList);
});

clearBtn.addEventListener('click', () => {
  const name = state.activeList;
  if (!name) return;
  const count = countOf(state);
  if (!count) {
    setStatus('This list is empty', 'err');
    return;
  }
  askConfirm(`Remove all ${count} link(s) from "${name}"?`, clearActiveList);
});

confirmYesBtn.addEventListener('click', async () => {
  const action = confirmAction;
  hideConfirm();
  if (action) await action();
});
confirmNoBtn.addEventListener('click', hideConfirm);

addTabBtn.addEventListener('click', addCurrentTab);
pasteBtn.addEventListener('click', pasteFromClipboard);

clearAfterDownload.addEventListener('change', async () => {
  await save({ settings: { ...state.settings, clearAfterDownload: clearAfterDownload.checked } });
  setStatus('Setting saved', 'ok');
});

autoCollectCopy.addEventListener('change', async () => {
  await save({ settings: { ...state.settings, autoCollectCopy: autoCollectCopy.checked } });
  setStatus('Setting saved', 'ok');
});

useFolders.addEventListener('change', async () => {
  await save({ settings: { ...state.settings, useFolders: useFolders.checked } });
  setStatus('Setting saved', 'ok');
});

alsoSaveBat.addEventListener('change', async () => {
  await save({ settings: { ...state.settings, alsoSaveBat: alsoSaveBat.checked } });
  setStatus('Setting saved', 'ok');
});

// save the folder name when leaving the field or pressing Enter
const saveFolderPrefix = async () => {
  const clean = folderPrefix.value.trim().replace(/[\\/:*?"<>|]/g, '_') || 'LinkCollector';
  folderPrefix.value = clean;
  if (clean === state.settings.folderPrefix) return;
  if (await save({ settings: { ...state.settings, folderPrefix: clean } })) {
    setStatus(`Folder name: ${clean}`, 'ok');
  }
};
folderPrefix.addEventListener('change', saveFolderPrefix);
folderPrefix.addEventListener('blur', saveFolderPrefix);
folderPrefix.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') folderPrefix.blur();
});

// ------------------------------------------------------------ Download videos
// Recognise the two native-messaging failures that mean "helper not installed".
const HELPER_HINTS = [
  'specified native messaging host not found',
  'access to the specified native messaging host is forbidden',
  'native host has exited'
];

function helperHint(result) {
  const error = String(result.error || '').toLowerCase();
  const missing = HELPER_HINTS.some((needle) => error.includes(needle));
  if (missing) {
    return ' Helper not installed. Run native-host/install.bat, then restart the browser ' +
           '(see README). The list was NOT cleared.';
  }
  return '';
}

/** Render the result of a DOWNLOAD_NATIVE call. */
function reportNativeResult(result) {
  if (!result) return;

  if (result.ok) {
    const folder = result.folder || '';
    const tail = result.cleared ? ' - list cleared' : '';
    setStatus(`Started! Folder: ${folder}${tail}`, 'ok');
    showOpenFolder(folder, result.count);
    return;
  }

  // the .txt was written but yt-dlp could not be started
  if (result.savedOnly) {
    setStatus(`Saved ${result.txt} but yt-dlp was not found. ${result.error || ''}`.trim(), 'err');
    return;
  }

  setStatus('Error: ' + (result.error || 'unknown error') + helperHint(result), 'err');
}

/** Show the "Open folder" button under the status line. */
function showOpenFolder(folder, count) {
  openFolderRow.textContent = '';
  if (!folder) return;

  const link = document.createElement('button');
  link.className = 'link-btn';
  link.type = 'button';
  link.textContent = 'Open folder';

  const label = document.createElement('span');
  label.className = 'hint';
  label.textContent = ` ${count} link${count === 1 ? '' : 's'} downloading`;

  link.addEventListener('click', async () => {
    const result = await sendMessage({ type: 'OPEN_FOLDER', path: folder });
    if (!result.ok) setStatus('Could not open folder: ' + (result.error || ''), 'err');
  });

  openFolderRow.append(link, label);
}

downloadBtn.addEventListener('click', async () => {
  downloadBtn.disabled = true;
  openFolderRow.textContent = '';
  setStatus('Starting download...');
  const result = await sendMessage({ type: 'DOWNLOAD_NATIVE', listName: state.activeList });
  reportNativeResult(result);
  await reload();
});

// ------------------------------------------------------ Save .txt only (old)
saveTxtBtn.addEventListener('click', async () => {
  saveTxtBtn.disabled = true;
  const result = await sendMessage({ type: 'DOWNLOAD', listName: state.activeList });
  if (!result.ok) {
    if (result.reason === 'empty') setStatus('This list is empty', 'err');
    else if (result.reason === 'no-list') setStatus('No active list - create one first', 'err');
    else if (result.reason === 'cancelled') setStatus('Save cancelled - list kept', 'err');
    else setStatus('Save failed: ' + (result.message || ''), 'err');
  } else {
    let text = result.folder ? `Saved to ${result.folder}/` : `Saved ${result.filename}`;
    if (result.bat) text += ` - double-click "${result.bat.split('/').pop()}" to run yt-dlp`;
    if (result.cleared) text += ' - list cleared';
    setStatus(text, 'ok');
  }
  await reload();
});

// ------------------------------------------------------------- Test helper
testHelperBtn.addEventListener('click', async () => {
  testHelperBtn.disabled = true;
  helperStatus.textContent = 'Contacting helper...';
  helperStatus.className = 'status';
  const result = await sendMessage({ type: 'PING_NATIVE' });

  if (result.ok) {
    const version = result.ytdlp || 'NOT FOUND in PATH';
    helperStatus.textContent = `Helper OK - Desktop: ${result.desktop} - yt-dlp: ${version}`;
    helperStatus.className = 'status ' + (result.ytdlp ? 'ok' : 'err');
  } else {
    helperStatus.textContent = 'Helper problem: ' + (result.error || '') + helperHint(result);
    helperStatus.className = 'status err';
  }
  testHelperBtn.disabled = false;
});

// ----------------------------------------------- Extra yt-dlp options field
const saveExtraOptions = async () => {
  const value = extraYtdlpOptions.value.trim();
  if (value === state.settings.extraYtdlpOptions) return;
  if (await save({ settings: { ...state.settings, extraYtdlpOptions: value } })) {
    setStatus('yt-dlp options saved', 'ok');
  }
};
extraYtdlpOptions.addEventListener('change', saveExtraOptions);
extraYtdlpOptions.addEventListener('blur', saveExtraOptions);
extraYtdlpOptions.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') extraYtdlpOptions.blur();
});

// keep the popup in sync with changes made elsewhere (context menu, shortcut)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') reload();
});

// first paint
reload().then(refreshBadge);
