// utils.js - shared helpers used by both popup.js and background.js.
// Loaded as an ES module ("type": "module" in manifest), so import with: import { ... } from './utils.js';

/** Default settings / storage shape. */
export const DEFAULTS = {
  lists: {},          // { "<listName>": ["url1", "url2"] }
  activeList: null,   // name of the currently selected list
  collectEnabled: true,
  settings: {
    clearAfterDownload: false,
    autoCollectCopy: false,
    useFolders: true,        // download into "<folderPrefix>/<ListName>/<ListName>.txt"
    folderPrefix: 'LinkCollector',
    alsoSaveBat: true,       // also drop a ready-to-run yt-dlp .bat next to the .txt
    extraYtdlpOptions: ''    // extra yt-dlp flags, parsed and filtered by the host
  }
};

/**
 * Merge whatever is in chrome.storage.local with the defaults so that
 * every consumer always gets a complete, well-formed object.
 */
export async function loadState() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return {
    lists: stored.lists && typeof stored.lists === 'object' ? stored.lists : {},
    activeList: typeof stored.activeList === 'string' ? stored.activeList : null,
    collectEnabled: stored.collectEnabled !== false,
    settings: {
      clearAfterDownload: !!(stored.settings && stored.settings.clearAfterDownload),
      autoCollectCopy: !!(stored.settings && stored.settings.autoCollectCopy),
      useFolders: !(stored.settings && stored.settings.useFolders === false),
      folderPrefix: (stored.settings && stored.settings.folderPrefix) || DEFAULTS.settings.folderPrefix,
      alsoSaveBat: !(stored.settings && stored.settings.alsoSaveBat === false),
      extraYtdlpOptions: (stored.settings && typeof stored.settings.extraYtdlpOptions === 'string')
        ? stored.settings.extraYtdlpOptions
        : DEFAULTS.settings.extraYtdlpOptions
    }
  };
}

/**
 * Normalize a URL so duplicates are detected reliably:
 *  - trim whitespace and common wrapper characters
 *  - drop a trailing "#..." fragment, but only when the fragment is not part
 *    of the video identity (time range #t=, YouTube #list= are kept)
 *  - keep the query string untouched (?v=... identifies the video)
 */
export function normalizeUrl(raw) {
  let url = String(raw == null ? '' : raw).trim();
  // strip quotes / angle brackets / parentheses that sneak in from copied text
  url = url.replace(/^["'<(\s]+/, '').replace(/["'>),\s]+$/, '');
  if (!url) return '';

  // Split off the fragment and decide whether it matters
  const hashAt = url.indexOf('#');
  if (hashAt !== -1) {
    const fragment = url.slice(hashAt + 1);
    // Fragments that carry real meaning for a downloader are kept
    const meaningful = /^(t=|list=|index=|start=|end=)/i.test(fragment);
    if (!meaningful) url = url.slice(0, hashAt);
  }

  // Validate with the URL constructor and only accept http/https
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    // Re-serialize so equivalent inputs (trailing slash, case in host) compare equal
    return parsed.href;
  } catch {
    return '';
  }
}

/** Extract every http/https URL from a blob of text (one per line or space separated). */
export function extractUrls(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s<>"'`]+/gi);
  if (!matches) return [];
  return matches.map(normalizeUrl).filter(Boolean);
}

/** Replace characters that are illegal in Windows filenames. */
export function sanitizeFilename(name) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'links';
}

/**
 * Make one folder/file name safe for chrome.downloads: no illegal characters, no
 * dots-only names and never a path separator, so a name can never escape the
 * browser's download directory.
 */
export function sanitizeSegment(name, fallback = 'LinkCollector') {
  // blank input must fall back here, sanitizeFilename() has its own default
  if (String(name == null ? '' : name).trim() === '') return fallback;
  const cleaned = sanitizeFilename(name)
    // collapse dot runs so "." and ".." can never appear as a path segment
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+$/, '')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .trim();
  return cleaned || fallback;
}

/** Number of links in the given (or active) list. */
export function countOf(state, listName) {
  const name = listName || state.activeList;
  if (!name || !state.lists[name]) return 0;
  return state.lists[name].length;
}

/** Build the .txt body: one URL per line, LF endings, trailing newline. */
export function buildTxt(urls) {
  return urls.join('\n') + '\n';
}

/**
 * Relative folder used for downloads. chrome.downloads may only write inside the
 * browser's download directory, so paths are always relative (never absolute and
 * never containing "..").
 */
export function buildDownloadPaths(listName, settings) {
  const stem = sanitizeSegment(listName, 'links');
  if (settings.useFolders) {
    // one folder per list, inside a configurable parent folder:
    //   <download dir>/<prefix>/<ListName>/<ListName>.txt
    const parent = sanitizeSegment(settings.folderPrefix, 'LinkCollector');
    const folder = `${parent}/${stem}`;
    return {
      folder,
      txt: `${folder}/${stem}.txt`,
      bat: `${folder}/${stem} - download.bat`
    };
  }
  return { folder: '', txt: `${stem}.txt`, bat: `${stem} - download.bat` };
}

/**
 * Build a Windows batch file that runs yt-dlp inside the very folder it lives in,
 * so the videos land next to the .txt. This is the "run the download script" part:
 * the extension cannot start a program itself, so the user double-clicks this file.
 */
export function buildRunBat(listName) {
  const file = sanitizeSegment(listName, 'links') + '.txt';
  // "%%" is a literal percent sign inside a .bat; yt-dlp wants %(title)s
  return [
    '@echo off',
    'chcp 65001 >nul',
    'title Download ' + file,
    'cd /d "%~dp0"',
    'echo.',
    'echo Folder: %cd%',
    'echo List:   ' + file.replace(/[&|<>^]/g, ''),
    'echo.',
    'where yt-dlp >nul 2>&1',
    'if errorlevel 1 (',
    '  echo yt-dlp was not found in PATH.',
    '  echo Install it from https://github.com/yt-dlp/yt-dlp#installation',
    '  pause',
    '  exit /b 1',
    ')',
    'yt-dlp -a "' + file + '" -o "%%(title)s.%%(ext)s" --download-archive "downloaded.txt"',
    'echo.',
    'pause'
  ].join('\r\n') + '\r\n';
}
