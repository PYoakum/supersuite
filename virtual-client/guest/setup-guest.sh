#!/bin/sh
# setup-guest.sh: Run inside the VM to set up the export helper.
# The browser-vm image auto-mounts 9p at /mnt.

# Create export directory
mkdir -p /mnt/export

# Install save-workspace helper (if present on 9p)
if [ -f /mnt/guest/save-workspace ]; then
  cp /mnt/guest/save-workspace /usr/local/bin/save-workspace
  chmod +x /usr/local/bin/save-workspace
  echo "save-workspace helper installed."
else
  echo "Note: save-workspace not found on 9p."
  echo "To export manually: tar cf /mnt/export/workspace.tar /root"
fi

echo "Setup complete. Shared folder at /mnt"
echo "Run 'save-workspace' to export, then click 'Save to Disk' in the browser."
