#!/bin/bash
# Lets adlerOS run your homelab maintenance scripts (Settings → Maintenance):
#   sudo ./install-maint.sh [the folder with your scripts]   (default ~/homelab/dev/scripts)
# Copies them and homelab-stacks.conf, root-owned, to
# /usr/local/libexec/adleros/scripts/, installs the launcher (maint) beside
# them, and a sudo rule letting your user run exactly that launcher.
# Run it again after you change a script: adlerOS runs the copies.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run it with sudo." >&2; exit 1; }
user=${SUDO_USER:?run it with sudo, as yourself}
home=$(getent passwd "$user" | cut -d: -f6)
src=${1:-$home/homelab/dev/scripts}
here=$(dirname "$(readlink -f "$0")")
lib=/usr/local/libexec/adleros
scripts=(aa-all_in_one.sh zz-script_backup.sh zx-system_updater.sh yy-system_cleanup.sh zy-script_updater.sh xz-script_cleanup.sh)
for s in "${scripts[@]}" homelab-stacks.conf; do
    [ -f "$src/$s" ] || { echo "Not found: $src/$s" >&2; exit 1; }
done
install -d -m 0755 -o root -g root "$lib" "$lib/scripts"
for s in "${scripts[@]}"; do install -m 0755 -o root -g root "$src/$s" "$lib/scripts/$s"; done
install -m 0644 -o root -g root "$src/homelab-stacks.conf" "$lib/scripts/homelab-stacks.conf"
install -m 0755 -o root -g root "$here/maint" "$lib/maint"
tmp=$(mktemp)
{
    echo "# Written by adlerOS's install-maint.sh. The adlerOS helper runs as $user and"
    echo "# may run exactly this launcher as root, without a password (it takes"
    echo "# only fixed names, and runs only the root-owned copies beside it)."
    echo "$user ALL=(root) NOPASSWD: $lib/maint"
} >"$tmp"
if ! visudo -cf "$tmp" >/dev/null; then
    rm -f "$tmp"
    echo "The sudo rule didn't validate; the scripts are copied, the rule isn't installed." >&2
    exit 1
fi
install -m 0440 -o root -g root "$tmp" /etc/sudoers.d/adleros-maint
rm -f "$tmp"
echo "Done: adlerOS can run your maintenance scripts (Settings → Maintenance, admin mode)."
