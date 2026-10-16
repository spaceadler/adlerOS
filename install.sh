#!/usr/bin/env bash
# install.sh: put adlerOS on a machine that already runs Docker.
#
#   ./install.sh             ask a few things, then set up and start adlerOS
#   ./install.sh --yes       take the current values (or the guesses), no questions
#   ./install.sh --no-host   skip the helper's systemd units and sudo rule
#
# It finds the apps in your compose folders and sorts them into collections,
# sets up the helper that starts and stops them for adlerOS, and starts
# adlerOS on port 8686. Safe to run again: the password and secrets in .env
# are kept, and apps it already knows aren't touched.
set -euo pipefail

ADLEROS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ADLEROS_DIR/.env"
ASSUME_YES=0 DO_HOST=1

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }
die() {
    printf 'x %s\n' "$*" >&2
    exit 1
}
interactive() { [ "$ASSUME_YES" = 0 ] && [ -t 0 ] && [ -r /dev/tty ]; }

# env_get KEY: its value in .env (quotes stripped), or nothing.
env_get() {
    [ -f "$ENV_FILE" ] || return 0
    sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1 | sed -E 's/^"(.*)"$/\1/'
}

# env_set KEY VALUE: replace KEY's line in .env, or add it. In place, so a
# running container's bind mount (if any) sees the change.
env_set() {
    local tmp
    tmp=$(mktemp)
    if grep -q "^$1=" "$ENV_FILE"; then
        K="$1" V="$2" awk -F= '$1 == ENVIRON["K"] { print ENVIRON["K"] "=" ENVIRON["V"]; next } { print }' "$ENV_FILE" >"$tmp"
    else
        { cat "$ENV_FILE"; printf '%s=%s\n' "$1" "$2"; } >"$tmp"
    fi
    cat "$tmp" >"$ENV_FILE"
    rm -f "$tmp"
}

# ask KEY "question" default: keep .env's value, else ask (or take the default).
ask() {
    local key=$1 question=$2 default=$3 current ans=""
    current=$(env_get "$key")
    [ -n "$current" ] && default=$current
    if interactive; then
        read -r -p "    $question [$default]: " ans </dev/tty || true
    fi
    env_set "$key" "${ans:-$default}"
}

guess_host() {
    local ip
    ip=$(tailscale ip -4 2>/dev/null | head -n1 || true)
    [ -n "$ip" ] || ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    printf '%s' "${ip:-$(hostname)}"
}

# Folders that often hold compose files, if they exist here.
guess_roots() {
    local d found=()
    for d in "$HOME/docker" "$HOME/stacks" "$HOME/compose" "$HOME/homelab/containers" "$HOME/containers" \
        /opt/stacks /opt/docker /srv/docker; do
        [ -d "$d" ] && found+=("$d")
    done
    local IFS=:
    printf '%s' "${found[*]:-}"
}

guess_tz() {
    timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo UTC
}

configure() {
    step "Settings (.env)"
    if [ ! -f "$ENV_FILE" ]; then
        cp "$ADLEROS_DIR/.env.example" "$ENV_FILE"
        chmod 600 "$ENV_FILE"
    fi
    # Secrets: made once, then kept.
    if grep -q '__PASS__' "$ENV_FILE"; then
        local password
        password=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)
        env_set OS_PASSWORD "$password"
        NEW_PASSWORD=$password
    fi
    if grep -q '__HEX64__' "$ENV_FILE"; then
        env_set OS_SESSION_SECRET "$(openssl rand -hex 32)"
    fi
    ask OS_NAME "Your first name, for the greeting" ""
    ask ADLEROS_HOST "This machine's address, as your browser reaches it" "$(guess_host)"
    ask COMPOSE_ROOTS "Your compose folders, separated by :" "$(guess_roots)"
    ask TZ "Timezone" "$(guess_tz)"
    env_set PUID "$(id -u)"
    env_set PGID "$(id -g)"
    for d in data registry apps wallpaper icons; do mkdir -p "$ADLEROS_DIR/$d"; done
    info "saved to .env (only you can read it)"
}

# The helper runs as you and starts when adlerOS queues a request; root only
# for restart and shut down, through a sudo rule for exactly that script.
install_agent() {
    step "The adlerOS helper"
    local lib=/usr/local/libexec/adleros units=/etc/systemd/system tmp unit
    if [[ $ADLEROS_DIR =~ [[:space:]\|\&\\] ]]; then
        warn "this folder's path has a space or one of | & \\; move it for the helper to work"
        return
    fi
    command -v systemctl >/dev/null || {
        warn "no systemd here: adlerOS works, but can't start or stop apps"
        return
    }
    sudo -v || die "needs sudo for the helper (or run with --no-host)"
    tmp=$(mktemp)
    sudo install -d -m 0755 -o root -g root "$lib"
    sudo install -m 0755 -o root -g root "$ADLEROS_DIR/agent/power" "$lib/power"
    {
        echo "# Written by adlerOS's install.sh. The adlerOS helper runs as $USER and"
        echo "# may run exactly these as root, without a password, and nothing else."
        echo "$USER ALL=(root) NOPASSWD: $lib/power reboot, $lib/power poweroff"
    } >"$tmp"
    sudo visudo -cf "$tmp" >/dev/null || die "the generated sudoers rule didn't validate; nothing was installed"
    sudo install -m 0440 -o root -g root "$tmp" /etc/sudoers.d/adleros
    for unit in service path; do
        # Single quotes on purpose: envsubst takes the names, not the values.
        # shellcheck disable=SC2016
        AGENT_USER=$USER AGENT_GROUP=$(id -gn) ADLEROS_DIR=$ADLEROS_DIR \
            envsubst '${AGENT_USER} ${AGENT_GROUP} ${ADLEROS_DIR}' \
            <"$ADLEROS_DIR/agent/adleros-agent.$unit.template" >"$tmp"
        sudo install -m 0644 -o root -g root "$tmp" "$units/adleros-agent.$unit"
    done
    rm -f "$tmp"
    sudo systemctl daemon-reload
    sudo systemctl enable --now adleros-agent.path >/dev/null 2>&1
    info "ready (log: journalctl -u adleros-agent)"
}

discover() {
    step "Looking for your apps"
    if ! docker info >/dev/null 2>&1; then
        warn "your user can't use Docker yet (add it to the docker group, log in again, re-run)"
        return
    fi
    python3 -I "$ADLEROS_DIR/agent/apps.py" discover | sed 's/^/    /'
}

start() {
    step "Starting adlerOS"
    (cd "$ADLEROS_DIR" && docker compose up -d --quiet-pull 2>&1 | sed 's/^/    /')
    local port host
    port=$(env_get ADLEROS_PORT)
    host=$(env_get ADLEROS_HOST)
    say ""
    say "    adlerOS: http://${host:-localhost}:${port:-8686}"
    if [ -n "${NEW_PASSWORD:-}" ]; then
        say "    Password: $NEW_PASSWORD   (it's OS_PASSWORD in .env; change it in Settings)"
    else
        say "    Password: OS_PASSWORD in $ENV_FILE"
    fi
    say "    Only reachable from your own network or VPN? Good: keep it that way."
}

main() {
    while [ $# -gt 0 ]; do
        case $1 in
        -y | --yes) ASSUME_YES=1 && shift ;;
        --no-host) DO_HOST=0 && shift ;;
        -h | --help) sed -n '2,12p' "$0" | sed -E 's/^# ?//' && exit 0 ;;
        *) die "unknown option '$1' (see --help)" ;;
        esac
    done
    [ "$(id -u)" -ne 0 ] || die "run this as your normal user, not root; it uses sudo where it needs to"
    for c in docker python3 openssl envsubst; do
        command -v $c >/dev/null || die "'$c' is missing; install it first (envsubst is in gettext)"
    done
    docker compose version >/dev/null 2>&1 || die "'docker compose' is missing (the Compose plugin)"
    configure
    if [ $DO_HOST = 1 ]; then install_agent; fi
    discover
    start
}

main "$@"
