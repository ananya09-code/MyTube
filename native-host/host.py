#!/usr/bin/env python3
"""
host.py - Native messaging host for the "mytube" extension.

Protocol: 4-byte little-endian length + UTF-8 JSON, in both directions.
IMPORTANT: nothing but protocol messages may ever be written to stdout.
All logging goes to native-host/host.log.

Actions accepted (and nothing else):
    ping        -> report yt-dlp version + Desktop path
    download    -> create Desktop/<ListName>/, write the .txt, start yt-dlp there
    openFolder  -> reveal a folder in the file manager (Desktop only)
"""

import ctypes
import json
import os
import platform
import re
import shlex
import shutil
import struct
import subprocess
import sys
import traceback
from datetime import datetime

HOST_NAME = "com.linkcollector.ytdlp"
LAUNCHER_NAME = "_ytdlp-run.bat"
IS_WINDOWS = os.name == "nt"
IS_MAC = sys.platform == "darwin"

# --------------------------------------------------------------------- logging
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(BASE_DIR, "host.log")

# arguments the user may pass through the "Extra yt-dlp options" setting
BLOCKED_ARG_PREFIXES = ("--exec", "--config-location", "--config-locations", "--batch-file")
MAX_EXTRA_ARGS = 20
MAX_URLS = 5000

# flags that take no value; anything else is assumed to take one. This lets
# `-f "bv*+ba/b"` keep its quoted value while still rejecting stray words.
NO_VALUE_FLAGS = frozenset([
    "-h", "--help", "-v", "--version", "-q", "--quiet", "--no-colors",
    "--force-colors", "--no-progress", "--newline", "-N",
    "--concurrent-fragments", "-4", "--force-ipv4", "-6", "--force-ipv6",
    "-i", "--ignore-errors", "--no-abort-on-error", "--abort-on-error",
    "--no-playlist", "--yes-playlist", "--no-progress", "-y", "--yes",
    "--no-part", "--no-overwrites", "--no-clobber", "--no-mtime",
    "--continue", "--no-continue", "--no-force-overwrites",
])
MAX_MESSAGE_BYTES = 100 * 1024 * 1024  # protocol limit


def log(message):
    """Append a line to host.log. Never touches stdout."""
    try:
        stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(LOG_FILE, "a", encoding="utf-8", errors="replace") as handle:
            handle.write("[%s] %s\n" % (stamp, message))
    except OSError:
        pass


# --------------------------------------------------------------- binary stdio
def use_binary_stdio():
    """Native messaging requires binary, unbuffered, non-translated stdio."""
    for stream in (sys.stdin, sys.stdout):
        try:
            stream.reconfigure(encoding=None, errors=None, newline="\n")
        except (AttributeError, ValueError):
            pass
    if IS_WINDOWS:
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)


def read_message():
    """Read one length-prefixed JSON message, or None on EOF."""
    header = sys.stdin.buffer.read(4)
    if len(header) < 4:
        return None
    (length,) = struct.unpack("=I", header)
    if length <= 0 or length > MAX_MESSAGE_BYTES:
        raise ValueError("invalid message length: %d" % length)
    body = sys.stdin.buffer.read(length)
    if len(body) < length:
        return None
    return json.loads(body.decode("utf-8"))


def send_message(payload):
    """Write one length-prefixed JSON message to stdout."""
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


# -------------------------------------------------------------------- helpers
def safe_folder_name(name):
    """Turn a list name into a folder name that is valid on every OS."""
    cleaned = re.sub(r'[\\/:*?"<>|]', "_", str(name or ""))
    # leading/trailing dots and spaces upset Windows Explorer and macOS
    cleaned = re.sub(r"\.{2,}", ".", cleaned)
    cleaned = re.sub(r"^\.+", "", cleaned)
    cleaned = re.sub(r"\s+$", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = cleaned[:100].rstrip(". ")
    return cleaned or "links"


def desktop_path():
    """
    Return the real Desktop folder.

    On Windows SHGetKnownFolderPath is used so OneDrive-redirected Desktops and
    localized folder names resolve correctly. If that fails we fall back to
    USERPROFILE\\Desktop, then to the home folder.
    """
    if IS_WINDOWS:
        try:
            folderid_desktop = "{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}"  # FOLDERID_Desktop
            buf = ctypes.create_unicode_buffer(1024)
            ctypes.windll.shell32.SHGetKnownFolderPath(
                ctypes.c_wchar_p(folderid_desktop), 0, None, ctypes.byref(buf)
            )
            if buf.value:
                return buf.value
        except Exception as exc:  # pragma: no cover - depends on the machine
            log("SHGetKnownFolderPath failed: %r" % (exc,))
        profile = os.environ.get("USERPROFILE") or os.path.expanduser("~")
        candidate = os.path.join(profile, "Desktop")
        if os.path.isdir(candidate):
            return candidate
        return profile
    home = os.path.expanduser("~")
    candidate = os.path.join(home, "Desktop")
    if os.path.isdir(candidate):
        return candidate
    return home  # Desktop does not exist on most Linux systems


def sanitize_urls(urls):
    """Keep only valid, unique http/https URLs. Query strings are preserved."""
    seen = set()
    clean = []
    if not isinstance(urls, list):
        return clean
    for raw in urls[:MAX_URLS]:
        if not isinstance(raw, str):
            continue
        url = raw.strip().strip('"\'<>()')
        if not url:
            continue
        try:
            from urllib.parse import urlsplit
            parts = urlsplit(url)
            if parts.scheme not in ("http", "https") or not parts.netloc:
                continue
        except ValueError:
            continue
        if url not in seen:
            seen.add(url)
            clean.append(url)
    return clean


def sanitize_extra_options(raw):
    """
    Turn the "Extra yt-dlp options" text field into an argument list.

    shlex.split handles the quoting, then every token must look like a flag. Shell
    metacharacters are rejected outright. Returns (args, error_message).
    """
    text = str(raw or "").strip()
    if not text:
        return [], None
    if re.search(r"[;&|`$><\n\r]", text):
        return None, "Extra yt-dlp options contain shell metacharacters (& ; | ` $ > <)."
    try:
        # posix=True so quotes group arguments on every OS: -f "bv*+ba/b" -> one arg
        tokens = shlex.split(text, posix=True)
    except ValueError as exc:
        return None, "Could not parse the extra yt-dlp options: %s" % exc
    args = []
    # a flag may be followed by its value, e.g. -f "bv*+ba/b" or --limit-rate 2M
    expecting_value = False
    for token in tokens:
        if token.startswith("-"):
            name = token.split("=", 1)[0].lower()
            if name in BLOCKED_ARG_PREFIXES:
                return None, "That yt-dlp option is not allowed here: %s" % name
            expecting_value = ("=" not in token and name not in NO_VALUE_FLAGS)
        else:
            # a bare word is only acceptable as the value of the flag before it
            if not expecting_value:
                return None, (
                    "Unexpected value %r - every extra yt-dlp option must start with '-'." % token
                )
            expecting_value = False
        args.append(token)
        if len(args) > MAX_EXTRA_ARGS:
            return None, "Too many extra yt-dlp options (max %d)." % MAX_EXTRA_ARGS
    return args, None


def _scripts_dir():
    """The directory pip installs console scripts into for the running Python."""
    import sysconfig
    path = sysconfig.get_path("scripts")
    return path if path and os.path.isdir(path) else None


def find_ytdlp():
    """
    Return an argument prefix that runs yt-dlp, or None when it is unavailable.

    An argument list is returned (not a single exe) so the "python -m yt_dlp"
    fallback can be expressed. `pip install yt-dlp` often puts the exe in the
    Python Scripts folder without adding it to PATH, which is common enough to
    be worth handling instead of reporting "not found".
    """
    for exe in ("yt-dlp", "yt-dlp.exe", "yt_dlp"):
        found = shutil.which(exe)
        if found:
            return [found]

    # look next to the interpreter running this host
    for exe in ("yt-dlp.exe", "yt-dlp"):
        scripts = _scripts_dir()
        if scripts:
            candidate = os.path.join(scripts, exe)
            if os.path.isfile(candidate):
                return [candidate]

    # last resort: the module form, which works whenever yt_dlp is importable
    for exe in (sys.executable, "python3", "python"):
        if shutil.which(exe) or exe == sys.executable:
            try:
                probe = subprocess.run(
                    [exe, "-m", "yt_dlp", "--version"],
                    capture_output=True, text=True, timeout=20,
                    creationflags=subprocess.CREATE_NO_WINDOW if IS_WINDOWS else 0,
                )
                if probe.returncode == 0 and probe.stdout.strip():
                    return [exe, "-m", "yt_dlp"]
            except Exception:
                continue
    return None


def ytdlp_version():
    command = find_ytdlp()
    if not command:
        return None
    try:
        out = subprocess.run(
            command + ["--version"],
            capture_output=True, text=True, timeout=20,
            creationflags=subprocess.CREATE_NO_WINDOW if IS_WINDOWS else 0,
        )
        version = (out.stdout or "").strip()
        return version or None
    except Exception as exc:
        log("yt-dlp --version failed: %r" % (exc,))
        return None


def quote_for_shell(arg):
    """Quote a single argument for cmd.exe (Windows)."""
    return '"' + arg.replace('"', '""') + '"'


def escape_for_batch(text):
    """
    Make text safe to embed in a .bat file.

    A percent sign is how cmd.exe reads variables, so "%(title)s" would be eaten.
    Doubling it ("%%") makes the batch parser emit a literal percent sign.
    """
    return str(text).replace("%", "%%")


def quote_for_posix(arg):
    """Quote a single argument for a POSIX shell."""
    return "'" + arg.replace("'", "'\\''") + "'"


def apple_escape(text):
    """Escape text for embedding inside an AppleScript string literal."""
    return text.replace("\\", "\\\\").replace('"', '\\"')


def start_ytdlp(folder, txt_name, extra_args):
    """
    Start yt-dlp inside `folder` and let it outlive this process.

    Chrome kills the host as soon as the port closes, so the download must be
    fully detached. Returns a short description of what was launched.
    """
    command = list(find_ytdlp()) + [
        "-a", txt_name,
        "--download-archive", "downloaded.txt",
        "-o", "%(title)s.%(ext)s",
    ] + extra_args
    # the list file is always <folder name>.txt
    folder_name = txt_name[:-4] if txt_name.lower().endswith(".txt") else txt_name

    log("launching: %s (cwd=%s)" % (" ".join(command), folder))

    if IS_WINDOWS:
        # A launcher .bat is written next to the list and then run in a new visible
        # console. Going through a file (instead of a long 'cmd /k <string>'
        # argument) is what makes quoting survive: CreateProcess mangles a command
        # string that contains its own quotes, and "%%" keeps "%(title)s" intact
        # through the batch parser.
        launcher_path = os.path.join(folder, LAUNCHER_NAME)
        launcher_cmd = " ".join(quote_for_shell(part) for part in command)
        with open(launcher_path, "w", encoding="utf-8", newline="") as handle:
            handle.write(
                "@echo off\r\n"
                "chcp 65001 >nul\r\n"
                'title yt-dlp: %s\r\n'
                'cd /d "%%~dp0"\r\n'
                "echo.\r\n"
                "echo Downloading from %s\r\n"
                "echo.\r\n"
                "%s\r\n"
                "echo.\r\n"
                "echo Finished (or stopped). This window stays open on purpose.\r\n"
                "pause\r\n"
                % (escape_for_batch(folder_name), escape_for_batch(txt_name),
                   escape_for_batch(launcher_cmd))
            )
        # CREATE_NEW_CONSOLE and DETACHED_PROCESS cannot be combined - Windows
        # rejects that pair. CREATE_NEW_CONSOLE already puts the child in its own
        # console, and close_fds keeps every browser pipe out of it, so the
        # download survives this host exiting.
        flags = subprocess.CREATE_NEW_CONSOLE | subprocess.CREATE_NEW_PROCESS_GROUP
        subprocess.Popen(["cmd", "/k", LAUNCHER_NAME], cwd=folder, close_fds=True, creationflags=flags)
        return "cmd /k " + LAUNCHER_NAME

    if IS_MAC:
        # Open Terminal.app and run the command there. The window stays open and
        # shows "[Process completed]" when done, so errors remain readable.
        cmdline = " ".join(quote_for_posix(part) for part in command)
        script = 'tell application "Terminal" to do script "cd %s; %s"' % (
            apple_escape(quote_for_posix(folder)),
            apple_escape(cmdline),
        )
        try:
            subprocess.Popen(
                ["osascript", "-e", script],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True
            )
            return "osascript " + cmdline
        except Exception as exc:
            log("osascript failed (%r), falling back to a detached process" % (exc,))

    # Linux: prefer a real terminal emulator so progress is visible
    for emulator in ("x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal", "xterm"):
        exe_path = shutil.which(emulator)
        if not exe_path:
            continue
        try:
            if emulator == "gnome-terminal":
                full = [exe_path, "--", "bash", "-lc", " ".join(command)]
            else:
                full = [exe_path, "-e", " ".join(quote_for_posix(part) for part in command)]
            subprocess.Popen(
                full, cwd=folder, start_new_session=True,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
            return emulator + " " + " ".join(command)
        except Exception as exc:
            log("terminal %s failed: %r" % (emulator, exc))

    # Last resort: detached background process, output written next to the list
    log_path = os.path.join(folder, "yt-dlp.log")
    with open(log_path, "ab") as out:
        subprocess.Popen(
            command, cwd=folder, stdout=out, stderr=subprocess.STDOUT,
            start_new_session=True, close_fds=True
        )
    return "detached (log: %s)" % log_path


def open_in_file_manager(path):
    """
    Reveal a folder in the file manager.

    Only an existing sub-folder of the Desktop is allowed - not the Desktop
    itself, and never a path that climbs out of it.
    """
    if not isinstance(path, str) or not path.strip():
        raise ValueError("No folder path was given.")

    path = path.strip()
    # only absolute paths are accepted; a relative one would be resolved against
    # whatever directory the browser happened to start the host in
    if not os.path.isabs(path):
        raise ValueError("An absolute folder path is required.")

    desktop = os.path.realpath(desktop_path())
    target = os.path.realpath(path)
    if target == desktop:
        raise ValueError("That is the Desktop itself; open a list folder instead.")

    # commonpath raises if the paths are on different drives, which is a refusal
    try:
        inside = os.path.commonpath([desktop, target]) == desktop
    except ValueError:
        inside = False
    if not inside:
        raise ValueError("Only folders inside the Desktop can be opened.")

    if not os.path.isdir(target):
        raise ValueError("Folder does not exist: %s" % target)

    if IS_WINDOWS:
        os.startfile(target)  # noqa: S606 - Windows-only API
    elif IS_MAC:
        subprocess.Popen(["open", target])
    else:
        subprocess.Popen(["xdg-open", target])
    return target


# -------------------------------------------------------------------- actions
def action_ping(_message):
    return {"ok": True, "ytdlp": ytdlp_version(), "desktop": desktop_path(), "platform": platform.platform()}


def action_download(message):
    """Create Desktop/<ListName>/, write the .txt and start yt-dlp there."""
    folder_name = safe_folder_name(message.get("listName"))
    urls = sanitize_urls(message.get("urls"))
    if not urls:
        return {"ok": False, "error": "No valid http/https links to download."}

    extra_args, extra_error = sanitize_extra_options(message.get("extraOptions"))
    if extra_error:
        return {"ok": False, "error": extra_error}

    desktop = desktop_path()
    folder = os.path.join(desktop, folder_name)
    os.makedirs(folder, exist_ok=True)

    # 1. always write the .txt first, so nothing is ever lost
    txt_name = folder_name + ".txt"
    txt_path = os.path.join(folder, txt_name)
    with open(txt_path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(urls) + "\n")
    log("wrote %s (%d urls)" % (txt_path, len(urls)))

    # 2. start yt-dlp in that folder
    if not find_ytdlp():
        log("yt-dlp not found in PATH")
        return {
            "ok": False,
            "savedOnly": True,
            "folder": folder,
            "txt": txt_path,
            "count": len(urls),
            "error": "yt-dlp not found. Install it and make sure it is in PATH. "
                     "The .txt was saved anyway.",
        }

    launched = start_ytdlp(folder, txt_name, extra_args)
    log("launched ok: %s" % launched)
    return {
        "ok": True,
        "folder": folder,
        "txt": txt_path,
        "count": len(urls),
        "command": launched,
    }


def action_open_folder(message):
    # passed through unchanged so open_in_file_manager can reject non-strings
    target = open_in_file_manager(message.get("path"))
    return {"ok": True, "folder": target}


ACTIONS = {
    "ping": action_ping,
    "download": action_download,
    "openFolder": action_open_folder,
}


def main():
    use_binary_stdio()
    log("host started (python %s, %s)" % (platform.python_version(), platform.platform()))

    while True:
        try:
            message = read_message()
        except (ValueError, json.JSONDecodeError, OSError) as exc:
            log("failed to read message: %r" % (exc,))
            break
        if message is None:
            log("stdin closed, exiting")
            break

        action = message.get("action") if isinstance(message, dict) else None
        handler = ACTIONS.get(action)
        log("action=%r" % (action,))

        if handler is None:
            send_message({"ok": False, "error": "Unsupported action: %r" % (action,)})
            continue

        try:
            send_message(handler(message))
        except Exception as exc:
            log("action %r failed:\n%s" % (action, traceback.format_exc()))
            send_message({"ok": False, "error": str(exc) or exc.__class__.__name__})

    log("host stopped")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("fatal:\n%s" % traceback.format_exc())
