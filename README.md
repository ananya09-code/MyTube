# mytube

A Chrome/Edge extension that collects video links into **topic lists** and downloads them with
[yt-dlp](https://github.com/yt-dlp/yt-dlp) into a folder per topic.

Stop copying links into a text file one by one. mytube keeps a separate list per topic, writes
`Desktop/<ListName>/<ListName>.txt`, and runs yt-dlp in that folder — videos, list and
"already downloaded" archive all end up in the same place.

```
Desktop/
  Python/
    Python.txt          one URL per line
    downloaded.txt      archive: re-runs skip finished videos
    <the videos...>
```

- **Plain JavaScript, HTML and CSS.** No frameworks, no npm, no build step.
- **Private by default.** All lists live in `chrome.storage.local`. Nothing is uploaded anywhere.

---

## Features

| | |
| --- | --- |
| **Topic lists** | Unlimited lists, switchable from a dropdown showing `Name (count)` |
| **Four ways to add** | Context menu, `Alt+Shift+A` shortcut, popup buttons, clipboard paste |
| **No duplicates** | URLs are normalised (query strings kept, tracking fragments dropped) and compared |
| **Auto-collect** | Optionally grab links from text you copy on any page |
| **One-click download** | Creates `Desktop/<ListName>/` and runs yt-dlp there in a visible console |
| **Never re-downloads** | Keeps a `downloaded.txt` archive inside each list folder |
| **Extra flags** | A settings field for things like `--cookies-from-browser chrome` |
| **Light + dark** | Follows your system theme |
| **Cross-platform** | Windows, macOS and Linux |

---

## Requirements

| Requirement | Needed for | Install |
| --- | --- | --- |
| Chrome or Edge | everything | — |
| Python 3 | the native helper | <https://www.python.org/downloads/> (tick *Add python.exe to PATH*) |
| yt-dlp | downloading videos | `pip install -U yt-dlp` |

You can use the extension **without** Python or yt-dlp — the *Save .txt only* button just writes
the list file and you run yt-dlp yourself.

---

## Install

1. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Pin **mytube** in your toolbar.

## Native helper setup (one click downloads)

The browser cannot start programs by itself, so a small Python helper does it over
[native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

1. **Copy your extension ID.** `chrome://extensions` → Developer mode on → copy the 32-character
   ID from the mytube card. It looks like `ldohapnbdkmaekgcojmkikiggidfcnmk`.
2. **Run the installer** and paste that ID:
   - Windows: double-click `native-host\install.bat`
   - macOS / Linux: `cd native-host && ./install.sh`
3. **Restart your browser completely** — hosts are only looked up at startup.
4. Open the popup → **Settings** → **Test helper**. You should see
   `Helper OK - Desktop: … - yt-dlp: …`.

The installer writes to `HKCU` only (Windows) or your browser profile folder (macOS/Linux), so
**no administrator rights are needed**. `uninstall.bat` / `uninstall.sh` undo it.

> The extension ID depends on the folder path, so it stays the same as long as you do not move
> this folder. If you move it, re-run the installer with the new ID.

---

## Usage

### Create a list

Click **New list**, type a name (e.g. `Python`), press **Create**. It becomes the active list and
the toolbar badge shows its link count — green while collecting, grey when off.

### Add links

- **Right-click** a link, video or page → **Add to download list**
- **`Alt+Shift+A`** adds the current tab
- **Add current tab** in the popup
- **Paste from clipboard** grabs every `http`/`https` URL in the clipboard, whatever separator you
  used, and reports `Added 3, skipped 1 duplicate`
- **Auto-collect** (Settings) collects links from text you copy on a page

### Download

| Button | What happens |
| --- | --- |
| **Download videos** | Helper creates `Desktop/<ListName>/`, writes the `.txt`, opens a console window running yt-dlp there |
| **Save .txt only** | Save dialog → `.txt` (plus a `.bat`) in your browser's download folder. No helper needed |

The console window stays open on purpose so you can read errors. Re-running skips anything already
in `downloaded.txt`.

### Change the shortcut

`chrome://extensions/shortcuts` → *Add the current tab to the active list* → click and press a new
key combination.

### Extra yt-dlp options

Settings → **Extra yt-dlp options**:

```
-f "bv*+ba/b" --cookies-from-browser chrome
```

Split with proper quote handling, so `-f "bv*+ba/b"` arrives as two arguments. Only flags starting
with `-` are accepted; shell metacharacters are rejected, and `--exec`, `--config-location(s)`
and `--batch-file` are blocked.

---

## Run yt-dlp yourself

If you prefer a terminal, `cd` into the list folder:

```bash
yt-dlp -a Python.txt                                    # default naming
yt-dlp -a Python.txt -o "%(title)s.%(ext)s"             # nicer names
yt-dlp -a Python.txt --download-archive done.txt        # skip already-downloaded
```

The `.txt` is UTF-8, one URL per line, LF endings, with a trailing newline — a valid `-a` input
file. Keep the archive file next to the list so repeat runs stay fast.

---

## How it works

```
popup.js ──chrome.runtime.sendMessage──▶ background.js (service worker)
                                              │
                     chrome.runtime.sendNativeMessage
                                              ▼
                                         host.py ──▶ Desktop/<List>/
                                              │            ├─ <List>.txt
                                              │            ├─ downloaded.txt
                                              │            └─ yt-dlp (detached console)
```

The service worker owns all writes to `chrome.storage.local` so concurrent adds cannot clobber
each other — they go through a promise queue. The host is started by the browser, replies over
stdin/stdout with length-prefixed JSON, and launches yt-dlp fully detached so it survives Chrome
closing the connection.

---

## Files

```
manifest.json                     MV3 manifest, permissions, command, content script
background.js                     service worker: add queue, context menu, shortcut,
                                  badge, native messaging, download
utils.js                          shared helpers (ES module)
content.js                        auto-collect on page copy events
popup.html / popup.css / popup.js the popup UI
icons/                            16 / 48 / 128 px
native-host/
  host.py                         the native messaging host (stdlib only)
  host.bat / host.sh              launchers the browser points at
  com.linkcollector.ytdlp.json    host manifest template
  install.bat / install.sh        register the host
  uninstall.bat / uninstall.sh    remove the registration
```

`native-host/host.log` is created at runtime — it is the first place to look for helper errors.

---

## Security notes

The helper is code that runs with your user account. It is deliberately narrow:

- accepts only three actions: `ping`, `download`, `openFolder`
- never runs a shell; yt-dlp is started with an argument list, not a command string
- validates URLs and rejects everything that is not `http`/`https`
- `openFolder` only opens existing sub-folders of the Desktop, via an absolute path
- extra options must be `-` flags, with shell metacharacters and a few dangerous yt-dlp flags
  rejected
- writes only to the Desktop, and only to `Desktop/<ListName>/`

---

## Troubleshooting

**Extension errors** → `chrome://extensions` → mytube → **Errors**.

**Service worker console** → `chrome://extensions` → **Inspect views: service worker**. The
worker sleeps when idle, so it restarts on the next event.

**Helper errors** → open `native-host\host.log`.

| Message | Cause | Fix |
| --- | --- | --- |
| `Specified native messaging host not found.` | Not installed, or the ID does not match | Re-run the installer with the exact ID, then restart the browser |
| `Access to the specified native messaging host is forbidden.` | `allowed_origins` mismatch | Re-run the installer |
| `Native host has exited.` | The host crashed — almost always Python missing from `PATH` | Check `py -3 --version` in a terminal, read `host.log` |
| `yt-dlp not found` | yt-dlp not on `PATH` | `pip install -U yt-dlp`, or add the Scripts folder pip named to `PATH`. Your `.txt` was still saved |
| Videos land in an unexpected Desktop | OneDrive redirected it | Not a bug — `SHGetKnownFolderPath` follows the real Desktop |
| Console flashes and closes | yt-dlp failed | Run the same command in a terminal to see the error |
| `No supported JavaScript runtime` | yt-dlp warning | Install Deno, or pass `--js-runtimes` via extra options |

---

## Known limitations

- **The extension cannot run yt-dlp without the helper.** Browsers have no API for starting a
  program. The helper exists for that; without it, use *Save .txt only*.
- **The helper reports "started", not "finished".** It replies as soon as yt-dlp launches, so
  "clear list after download" clears the list at that point. The `.txt` stays on disk regardless,
  and the console window shows progress.
- **Downloads always go to the Desktop**, not to an arbitrary folder.
- **"Copy link address" cannot be auto-collected.** The content script only sees the page `copy`
  event with selected text; a link copied from the browser's context menu is invisible to it. Use
  the context menu item or *Paste from clipboard*.
- **Clipboard reading needs a click** inside the popup (browser rule, not a bug).
- **`Add current tab` cannot read internal pages** (`chrome://`, the Web Store, PDF viewer).
- **Folder names are sanitised**: `\ / : * ? " < > |` become `_`, so `My/Cooking` becomes
  `My_Cooking`.

---

## License

MIT — see [LICENSE](LICENSE).
