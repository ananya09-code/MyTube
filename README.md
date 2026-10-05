# Link Collector for yt-dlp

A plain JavaScript Manifest V3 extension (no frameworks, no npm, no build step) that collects
video links into separate **topic lists** and downloads each list as its own `.txt` file, ready for:

```
yt-dlp -a Python.txt
```

---

## 1. Install (Chrome / Edge)

1. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
2. Turn on **Developer mode** (top-right toggle in Chrome, left sidebar in Edge).
3. Click **Load unpacked** (Chrome) / **Load unpacked** (Edge).
4. Select this folder: `C:\Users\pc\desktop\mytube`
5. The extension appears in the toolbar. Pin it for one-click access (pin icon in the toolbar area).

The icons in `icons/` were generated with a small PowerShell/.NET drawing script (blue rounded
square with three white list lines) at 16, 48 and 128 px — they are real PNGs, not placeholders.

---

## 2. Native helper setup (run yt-dlp automatically)

With the helper installed, **Download videos** creates `Desktop/<ListName>/`, writes the `.txt`
there and starts yt-dlp in that folder. The extension alone cannot do this — browsers do not let
extensions start programs. The helper is a small Python script the browser talks to over
**native messaging**.

### 2.1 Prerequisites

| Requirement | Notes |
| --- | --- |
| Python 3 | <https://www.python.org/downloads/> — tick **Add python.exe to PATH** |
| yt-dlp | `pip install -U yt-dlp` (or `winget install yt-dlp`), must be in `PATH` |

### 2.2 Step by step

1. **Load the extension** (section 1) so the browser gives it an ID.
2. **Copy the extension ID**: `chrome://extensions` → Developer mode on → copy the 32-character
   ID from the extension card. It looks like `aefdklpahdlgknbmahdbkehkjlcpnfil`.
   *The ID is derived from the folder path, so it stays the same as long as you do not move the
   extension folder. If you move it, the ID changes and you must run `install.bat` again.*
3. **Run the installer**:
   - Windows: double-click `native-host\install.bat`, paste the ID, press Enter.
   - macOS / Linux: `cd native-host && ./install.sh`, then paste the ID.
4. **Restart the browser completely.** Native messaging hosts are looked up at startup.
5. **Verify**: open the popup, expand **Settings**, click **Test helper**. You should see
   `Helper OK - Desktop: ... - yt-dlp: 2026.xx.xx`.
6. **Use it**: pick a list and click **Download videos**.

### 2.3 What gets registered

`install.bat` writes `native-host/com.linkcollector.ytdlp.json` (with your real paths) and points
these registry keys at it — `HKCU` only, so **no administrator rights**:

```
HKCU\Software\Google\Chrome\NativeMessagingHosts\com.linkcollector.ytdlp
HKCU\Software\Chromium\NativeMessagingHosts\com.linkcollector.ytdlp
HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.linkcollector.ytdlp
```

`uninstall.bat` / `uninstall.sh` remove exactly those keys and the generated JSON. `host.py`,
`host.bat` and `host.sh` stay in place; delete the `native-host` folder to remove them fully.

### 2.4 The two buttons

| Button | What happens |
| --- | --- |
| **Download videos** | Helper creates `Desktop/<ListName>/`, writes `<ListName>.txt`, opens a console window running yt-dlp there |
| **Save .txt only** | The old behaviour: Save dialog, `.txt` (+ optional `.bat`) into your browser's download folder. No helper needed |

If the helper is missing, **Download videos** shows a hint to run `install.bat` and **does not**
clear the list.

### 2.5 Extra yt-dlp options

Settings → **Extra yt-dlp options**, e.g.:

```
-f "bv*+ba/b"
--cookies-from-browser chrome
```

The value is split with proper quote handling on the host, so `-f "bv*+ba/b"` reaches yt-dlp as
two arguments. Only flags starting with `-` are accepted; shell metacharacters (`;` `&` `|` `` ` ``
`$` `>` `<`) are rejected, and `--exec`, `--config-location(s)` and `--batch-file` are blocked.
Bad input is refused before anything is written.

### 2.6 Resulting layout

```
Desktop/
  Python/                     <- created per list
    Python.txt                <- one URL per line, UTF-8
    downloaded.txt            <- archive, so re-runs skip finished videos
    _ytdlp-run.bat            <- the launcher that is running right now
    <videos...>              <- yt-dlp output lands here too
```

The console window stays open on purpose so you can read errors. Delete `_ytdlp-run.bat` if you
do not want it there; it is rewritten on the next download.

### 2.7 Why the videos land there

The helper starts yt-dlp with `cwd` set to the list folder and `-o "%(title)s.%(ext)s"`, so output
files are written next to the `.txt`. The process is detached (`CREATE_NEW_CONSOLE` +
`CREATE_NEW_PROCESS_GROUP`, no inherited pipes) so it survives Chrome closing the host connection.

---

## 3. How to use

1. **Click the extension icon** to open the popup.
2. **Create a list**: click **New list**, type a name (e.g. `Python`), press **Create** (or Enter).
   The new list becomes the active list. Empty and duplicate names are rejected with a message.
3. **Turn collecting ON** with the big switch next to "Collect links" (default is ON).
   The badge on the icon shows the number of links in the active list; green = ON, grey = OFF.
4. **Add links**, using any of these:
   - Right-click a link, a video or a page → **Add to download list**
     (a right-clicked link uses its target URL, otherwise the page URL).
   - Press **Alt+Shift+A** to add the current tab's URL.
   - In the popup: **Add current tab**.
   - In the popup: **Paste from clipboard** — reads the clipboard, finds every `http`/`https`
     URL (separated by spaces, commas or newlines) and adds them all. Duplicates are skipped and
     the status line reports e.g. `Added 3, skipped 1 duplicate`.
   - Optionally enable **Settings → Auto-collect links I copy on web pages** (see limitations).
5. **Switch lists** with the dropdown (`Name (count)`). Only the active list changes.
6. **Remove links**: click the small **×** on a row, or use **Clear** in the footer.
   **Clear** and **Delete list** both ask for an inline confirmation first.
7. **Download videos** (needs the native helper, section 2): click **Download videos**. The helper
   creates `Desktop/<ListName>/`, writes the `.txt` and opens a console window running yt-dlp
   there. Watch that window for progress; it stays open when finished.

8. **Save .txt only** (no helper required): click **Save .txt only**. A Save dialog opens. Accept
   it (or point it at your Desktop) and the extension creates this structure:

   ```
   <your downloads folder>/
     LinkCollector/            <- the "Folder name" setting
       Python/                 <- one folder per list
         Python.txt            <- one URL per line
         Python - download.bat <- double-click this to run yt-dlp here
   ```

   Both files are written with `chrome.downloads`, so the folders are created for you.
   Illegal filename characters `\ / : * ? " < > |` become `_`, and names that would escape
   the download folder (`..`) are neutralised.

8. **Run yt-dlp yourself**: double-click `<ListName> - download.bat` in that folder. It `cd`s into
   its own folder and runs `yt-dlp -a "<ListName>.txt" -o "%(title)s.%(ext)s"
   --download-archive "downloaded.txt"`, so the videos, the list and the archive all end up
   in the same place. It stops with a message if `yt-dlp` is not in your `PATH`.
   (If the native helper is installed, **Download videos** does all of this for you — section 2.)

   To make the folder appear on your **Desktop**: `chrome://settings/downloads` → Location →
   Change → Desktop. Then everything lands in `Desktop\LinkCollector\<ListName>\`.

### When the toggle is OFF
The context menu, the keyboard shortcut and auto-collect do **not** add links and the badge
briefly flashes `OFF`. The popup buttons *Add current tab* and *Paste from clipboard* still work,
because clicking them is an explicit action.

### When no list exists yet
If a link arrives while there is no active list, nothing is added and the badge flashes `!`.
The popup shows an empty state: "No topic lists yet — Create your first topic list to start
collecting links", with the add and download buttons disabled.

---

## 4. Change the keyboard shortcut

1. Go to `chrome://extensions/shortcuts` (`edge://extensions/shortcuts` in Edge).
2. Find **Link Collector for yt-dlp** → **Add current tab to the active list**.
3. Click the pencil / the shortcut field and press the new key combination
   (e.g. `Ctrl+Shift+Y`, or `Alt+Shift+A` again to keep it).

---

## 5. Run the downloaded file with yt-dlp

Download one `.txt` per topic into one folder per topic, e.g.:

```
Videos\
  Python\
    Python.txt
  Cooking\
    Cooking.txt
```

Open a terminal **inside the folder that contains the .txt file** and run one of:

```bash
# download everything in the list with yt-dlp's default naming
yt-dlp -a Python.txt

# use nicer file names
yt-dlp -a Python.txt -o "%(title)s.%(ext)s"

# skip videos that were downloaded before (archive file)
yt-dlp -a Python.txt --download-archive done.txt
```

The native helper runs exactly this, inside `Desktop/<ListName>/`:

```bat
cd /d "%~dp0"
yt-dlp -a "Python.txt" -o "%%(title)s.%%(ext)s" --download-archive "downloaded.txt"
```

(The `%%` is a literal percent sign inside a `.bat`; yt-dlp receives `%(title)s`.)

Notes:
- The `.txt` has **one URL per line**, LF line endings, UTF-8, and a trailing newline, so it is
  a valid `-a` input file.
- `--download-archive` remembers finished videos so future runs skip them. The helper uses
  `downloaded.txt` inside the list folder; a hand-run command can use `done.txt`. Keep the
  archive file next to the list.
- Add `--cookies-from-browser chrome` if the videos need your login.
- One folder per topic keeps output files separated; running the command *inside* that folder is
  the simplest way to avoid path juggling.

---

## 6. Known limitations

- **Without the native helper, the extension cannot run yt-dlp.** Browsers have no API for starting
  a program. That is why `native-host/` exists. Without it, use **Save .txt only** and run yt-dlp
  yourself.
- **The helper replies as soon as yt-dlp starts, not when it finishes.** Chrome closes the
  connection as soon as the popup is done, and waiting would risk the worker being killed. The
  console window is the place to watch progress. "Clear list automatically after download"
  therefore clears the list when the download *starts*, not when it completes — the `.txt` is
  still on disk either way.
- **The native host is trusted code.** It runs with your user account. It only accepts three
  actions (`ping`, `download`, `openFolder`), never runs a shell, and only opens folders inside the
  Desktop — but review `native-host/host.py` if you want to check that for yourself.
- **The helper only writes to the Desktop.** Not to any arbitrary folder. `openFolder` is limited
  to Desktop sub-folders too.
- **Download videos always uses `Desktop/<ListName>/`** and ignores the *Folder name* setting,
  which only applies to **Save .txt only**.
- **The "download folder cannot be an arbitrary absolute path" rule still applies to Save .txt
  only.** `chrome.downloads` may only write below the browser's download directory.
- **Windows may warn about the `.bat`.** SmartScreen or an antivirus can flag a freshly written
  batch file. Choose "Run anyway" / allow it once if you trust it.
- **yt-dlp without a JavaScript runtime prints a warning** and some sites may fail. Install Deno, or
  add `--js-runtimes` via *Extra yt-dlp options*.
- **"Copy link address" cannot be detected.** The content script only sees the page's `copy`
  event with selected text. Copying a link from the context menu, or from a page's own copy button
  that uses the clipboard API without a selection, is invisible to the extension. Use the context
  menu **Add to download list**, the shortcut, or **Paste from clipboard** in the popup instead.
- **Auto-collect only sees selected text.** Copying a long block of text containing URLs collects
  those URLs — including any links that are only mentioned in prose.
- **Clipboard reading needs a click.** Browsers only allow `navigator.clipboard.readText()` from a
  user gesture, so **Paste from clipboard** must be clicked inside the popup. The extension also
  needs the `clipboardRead` permission, which Chrome may ask for.
- **"Add current tab" needs the tab URL.** It relies on the `activeTab` permission. On internal
  browser pages (`chrome://`, the Web Store, PDF viewer) there is no readable URL, so nothing is
  added.
- **Folder names come from the list name.** Characters illegal on Windows (`\ / : * ? " < > |`)
  become `_`, so `My/Cooking: "videos"` lands in `My_Cooking_ _videos_`.
- **Chrome may show a "download blocked" or "unknown file type" prompt** for `.txt` files in rare
  configurations; allow it once.
- **Design choice:** the extension never deletes or moves files outside what you asked for. Deleting
  a list permanently removes it from storage; there is no undo.
- **Design choice:** switching lists uses the dropdown in the popup; there is no separate
  "per-site" list.

---

## 7. Troubleshooting / where to see errors

### Native helper problems

| Message | Cause | Fix |
| --- | --- | --- |
| `Specified native messaging host not found.` | Not installed, or the registered path/ID does not match | Run `native-host\install.bat` again with the **exact** ID from `chrome://extensions`. Then restart the browser. |
| `Access to the specified native messaging host is forbidden.` | `allowed_origins` does not contain your extension ID | Re-run the installer. The ID changes if the extension folder was moved or renamed. |
| `Native host has exited.` | The host itself crashed. Almost always Python missing from `PATH`. | Open `native-host\host.log` — the traceback is at the bottom. Check `py -3 --version` and `python --version` in a terminal. |
| Console window opens but flashes / no video | `yt-dlp` not found | The host logs this. Run `yt-dlp --version`; if it fails, add the folder from the pip warning (often `…\Python\Scripts`) to `PATH`. |
| `yt-dlp not found` after a download | Same as above | The `.txt` was still saved, so nothing is lost — install yt-dlp and press Download videos again. |
| Files land in the wrong Desktop | OneDrive redirected your Desktop | The helper uses `SHGetKnownFolderPath`, so it follows the redirect. If the folder is `C:\Users\you\OneDrive\Desktop`, that is the real Desktop and the files are correct. |

`host.log` records every action, every error and every traceback. It is the first place to look.

### Extension problems

1. **Extension errors:** `chrome://extensions` → find the extension → **Errors** button.
   Errors from the background service worker and from the popup are listed here.
2. **Service worker console:** `chrome://extensions` → the extension card →
   **Inspect views: service worker**. This opens DevTools for `background.js`. Note that the worker
   is stopped when idle, so it wakes up again on the next event — logs from earlier runs may be gone.
3. **Popup console:** right-click inside the popup → **Inspect**.
4. **Page content script console:** open DevTools on the page (F12) and look in the **Console**;
   auto-collect logs start with `[link-collector]`.
5. **Storage contents:** `chrome://extensions` → extension → **Extension details** →
   **View storage** (in newer Chrome: *Inspect views → service worker → Application → Extension
   Storage*), which shows `lists`, `activeList`, `collectEnabled` and `settings`.
6. **Nothing is added:** check the toggle is ON and a list is active; watch the badge for `OFF` or `!`.
7. **Download does not happen:** check the list is not empty (status shows *This list is empty*)
   and that a topic folder is writable.
8. **`.bat` does nothing / flashes and closes:** run it from a terminal to read the message; the
   usual cause is `yt-dlp` not being in `PATH` (install it or add its folder to `PATH`).
9. **Files land somewhere unexpected:** that is the browser's download directory, not the Desktop.
   Change it in `chrome://settings/downloads`.
10. **Folder name looks odd:** the "Folder name" setting and list names are sanitized, so
    `\ / : * ? " < > |` become `_`.
8. **Reset everything:** in the storage inspector delete the `local` keys, or remove and re-add the
   extension in Developer mode (this deletes all lists).

---

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest: permissions, action, background worker, command, content script |
| `background.js` | Service worker: add queue, context menu, shortcut, badge, `runDownload` via native messaging, messages |
| `utils.js` | Shared ES module helpers: `loadState`, `normalizeUrl`, `extractUrls`, `sanitizeSegment`, `buildTxt`, `buildRunBat`, `buildDownloadPaths` |
| `content.js` | Auto-collect on page `copy` events |
| `popup.html` / `popup.css` / `popup.js` | The popup UI (light + dark) |
| `icons/icon16.png`, `icon48.png`, `icon128.png` | Toolbar and store icons (generated) |
| `native-host/host.py` | Native messaging host (Python 3, stdlib only): `ping`, `download`, `openFolder` |
| `native-host/host.bat` / `host.sh` | Launchers the browser is pointed at (Chrome cannot run `.py` directly) |
| `native-host/com.linkcollector.ytdlp.json` | Host manifest **template** — the real one is generated by the installer |
| `native-host/install.bat` / `install.sh` | Registers the host (HKCU on Windows, profile folders on macOS/Linux) |
| `native-host/uninstall.bat` / `uninstall.sh` | Removes what the installers created |
| `README.md` | This file |

`native-host/host.log` appears once the host has run; it is the first place to look for helper
errors.
#   M y T u b e  
 