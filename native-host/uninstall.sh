#!/bin/sh
# ------------------------------------------------------------------
#  Removes everything install.sh created.
# ------------------------------------------------------------------
set -u

HOST_NAME="com.linkcollector.ytdlp"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo
echo "Removing native helper registration..."
echo

REMOVED=0

# registry-style folders used by Chrome / Chromium / Edge
for dir in \
    "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \
    "$HOME/Library/Application Support/Chromium/NativeMessagingHosts" \
    "$HOME/.config/chromium/NativeMessagingHosts" \
    "$HOME/.config/google-chrome/NativeMessagingHosts" \
    "$HOME/.config/microsoft-edge/NativeMessagingHosts" \
    "$HOME/.var/app/com.google.Chrome/data/Google/Chrome/NativeMessagingHosts" \
    "$HOME/.var/app/com.microsoft.Edge/data/Microsoft/Edge/NativeMessagingHosts"
do
    if [ -f "$dir/$HOST_NAME.json" ]; then
        if rm -f "$dir/$HOST_NAME.json"; then
            echo "  [OK]   removed $dir/$HOST_NAME.json"
            REMOVED=$((REMOVED + 1))
        else
            echo "  [WARN] could not remove $dir/$HOST_NAME.json"
        fi
    fi
done

if [ -f "$HERE/$HOST_NAME.json" ]; then
    rm -f "$HERE/$HOST_NAME.json"
    echo "  [OK]   removed $HERE/$HOST_NAME.json"
fi

echo
if [ "$REMOVED" -eq 0 ]; then
    echo "Nothing was registered - nothing to undo."
else
    echo "Removed $REMOVED registration(s)."
    echo "Restart your browser to make it forget the helper."
    echo "host.py and host.sh were left in place; delete the native-host folder to remove them."
fi
echo
