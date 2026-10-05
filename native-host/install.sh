#!/bin/sh
# ------------------------------------------------------------------
#  Registers the native messaging host for mytube
#  on macOS and Linux. No root access is required.
# ------------------------------------------------------------------
set -u

HOST_NAME="com.linkcollector.ytdlp"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo
echo "=============================================="
echo " mytube - native helper installer"
echo "=============================================="
echo
echo "Helper folder: $HERE"

# ------------------------------------------------------------------
#  1. Prerequisites
# ------------------------------------------------------------------
echo
echo "Checking prerequisites..."

PYTHON=""
for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1; then
        if "$candidate" -c "import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)" >/dev/null 2>&1; then
            PYTHON="$(command -v "$candidate")"
            break
        fi
    fi
done

if [ -n "$PYTHON" ]; then
    echo "  [OK]   Python 3 found ($PYTHON)"
else
    echo "  [WARN] Python 3 was NOT found."
    echo "         The native helper cannot run without it."
    echo "         macOS:  brew install python   (or install from python.org)"
    echo "         Debian: sudo apt install python3"
    echo "         Fedora: sudo dnf install python3"
    exit 1
fi

if command -v yt-dlp >/dev/null 2>&1 || "$PYTHON" -c "import yt_dlp" >/dev/null 2>&1; then
    echo "  [OK]   yt-dlp found"
else
    echo "  [WARN] yt-dlp was NOT found in PATH."
    echo "         The helper still works - it will only save the .txt files."
    echo "         Install with:  pip install -U yt-dlp   (or: brew install yt-dlp)"
fi

# ------------------------------------------------------------------
#  2. Extension ID
# ------------------------------------------------------------------
echo
echo "---------------------------------------------------------------"
echo " I need your extension ID."
echo
echo " How to find it:"
echo "   1. Open  chrome://extensions  (or edge://extensions)"
echo "   2. Make sure \"Developer mode\" is ON (top right)"
echo "   3. Find \"mytube\""
echo "   4. Copy the long 32-character \"ID\" shown on its card"
echo
echo " It looks like:  aefdklpahdlgknbmahdbkehkjlcpnfil"
echo "---------------------------------------------------------------"
echo

printf "Paste your extension ID here: "
EXTID="$(cat)"
EXTID="$(printf '%s' "$EXTID" | tr -d " \t'\"")"
EXTID="$(printf '%s' "$EXTID" | tr 'A-F' 'a-f')"

if [ -z "$EXTID" ]; then
    echo
    echo "  [ERROR] No extension ID was entered."
    exit 1
fi

EXTLEN="${#EXTID}"
if [ "$EXTLEN" -ne 32 ]; then
    echo
    echo "  [ERROR] '$EXTID' is $EXTLEN characters long, but an extension ID is 32."
    echo "          Copy it again from the extension card in chrome://extensions."
    exit 1
fi

case "$EXTID" in
    *[!abcdefghijklmnop]*)
        echo
        echo "  [ERROR] '$EXTID' contains characters that are not valid in an extension ID."
        echo "          Only the letters a to p are allowed."
        exit 1
        ;;
esac

# ------------------------------------------------------------------
#  3. Write the host manifest
# ------------------------------------------------------------------
HOST_SH="$HERE/host.sh"
JSONFILE="$HERE/$HOST_NAME.json"

echo
echo "Writing host manifest..."

cat > "$JSONFILE" <<EOF
{
  "name": "$HOST_NAME",
  "description": "mytube native helper - runs yt-dlp on a topic list",
  "path": "$HOST_SH",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTID/"]
}
EOF

if [ ! -f "$JSONFILE" ]; then
    echo "  [ERROR] Could not write $JSONFILE"
    exit 1
fi
echo "  [OK]   $JSONFILE"

# the launcher must be executable for the browser to run it
chmod +x "$HOST_SH" "$HERE/host.py" 2>/dev/null

# ------------------------------------------------------------------
#  4. Copy into the NativeMessagingHosts folders that exist
# ------------------------------------------------------------------
echo
echo "Registering the host..."

INSTALLED=0
for dir in \
    "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \
    "$HOME/Library/Application Support/Chromium/NativeMessagingHosts" \
    "$HOME/.config/chromium/NativeMessagingHosts" \
    "$HOME/.config/google-chrome/NativeMessagingHosts" \
    "$HOME/.config/microsoft-edge/NativeMessagingHosts"
do
    if [ -d "$(dirname "$dir")" ]; then
        mkdir -p "$dir" 2>/dev/null
        if cp "$JSONFILE" "$dir/$HOST_NAME.json" 2>/dev/null; then
            echo "  [OK]   $dir/$HOST_NAME.json"
            INSTALLED=$((INSTALLED + 1))
        else
            echo "  [WARN] Could not copy into $dir"
        fi
    fi
done

# Flatpak/Snap installs keep the profile elsewhere
for dir in \
    "$HOME/.var/app/com.google.Chrome/data/Google/Chrome/NativeMessagingHosts" \
    "$HOME/.var/app/com.microsoft.Edge/data/Microsoft/Edge/NativeMessagingHosts"
do
    if [ -d "$(dirname "$dir")" ]; then
        mkdir -p "$dir" 2>/dev/null
        if cp "$JSONFILE" "$dir/$HOST_NAME.json" 2>/dev/null; then
            echo "  [OK]   $dir/$HOST_NAME.json (flatpak)"
            INSTALLED=$((INSTALLED + 1))
        fi
    fi
done

if [ "$INSTALLED" -eq 0 ]; then
    echo
    echo "  [WARN] No browser profile folder was found."
    echo "         Start your browser once, then run this script again."
    echo "         Or copy $JSONFILE into your profile's NativeMessagingHosts"
    echo "         folder by hand and edit \"path\" and \"allowed_origins\"."
    exit 1
fi

# ------------------------------------------------------------------
#  5. Done
# ------------------------------------------------------------------
echo
echo "=============================================="
echo " Installed into $INSTALLED profile(s)."
echo "=============================================="
echo
echo "  Extension ID : $EXTID"
echo "  Host manifest: $JSONFILE"
echo "  Log file     : $HERE/host.log"
echo
echo "  Next steps:"
echo "    1. Close and reopen your browser."
echo "    2. Open the extension popup, expand Settings"
echo "       and click \"Test helper\"."
echo
