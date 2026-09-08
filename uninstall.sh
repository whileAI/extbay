#!/bin/sh
set -eu

EXTBAY_CONTAINER="${EXTBAY_CONTAINER:-extbay}"
EXTBAY_IMAGE="${EXTBAY_IMAGE:-extbay:local}"
PURGE_DATA="${PURGE_DATA:-0}"

die() { printf '%s\n' "extbay uninstaller: $*" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || die "Docker was not found"
docker info >/dev/null 2>&1 || die "Docker daemon is unavailable or permission was denied"

printf '%s\n' "Removing ExtBay runtime and restoring the panel UI (Portainer/DockFrame will not be restarted)..."

if [ -n "${PORTAINER_CONTAINER:-}" ]; then
  panel_id="$(docker inspect -f '{{.Id}}' "$PORTAINER_CONTAINER" 2>/dev/null || true)"
else
  panel_id="$(docker ps --format '{{.ID}}|{{.Image}}|{{.Names}}' | awk -F '|' '{ value=tolower($2 "|" $3); if ($2 ~ /(^|\/)portainer\/portainer(-ce)?(:|@|$)/ || value ~ /dockframe/) print $1 }' | head -1)"
fi
if [ -n "$panel_id" ]; then
  restore_tmp="$(mktemp -d /tmp/extbay-uninstall.XXXXXX)"
  if docker cp "$panel_id:/public/.extbay-index.backup" "$restore_tmp/index.html" >/dev/null 2>&1; then
    docker cp "$restore_tmp/index.html" "$panel_id:/public/index.html"
    touch "$restore_tmp/empty"
    for asset in extbay-config.js extbay-bootstrap.js extbay-ui.html extbay-ui.js .extbay-index.backup; do
      docker cp "$restore_tmp/empty" "$panel_id:/public/$asset" >/dev/null 2>&1 || true
    done
    printf '%s\n' "The Extensions tab was removed from DockFrame/Portainer."
  fi
  rm -rf -- "$restore_tmp"
fi

managed="$(docker ps -aq --filter label=io.extbay.managed=true)"
if [ -n "$managed" ]; then
  printf '%s\n' "$managed" | while IFS= read -r container_id; do
    [ -n "$container_id" ] && docker rm -f "$container_id" >/dev/null
  done
fi

if docker inspect "$EXTBAY_CONTAINER" >/dev/null 2>&1; then
  docker rm -f "$EXTBAY_CONTAINER" >/dev/null
fi

cli_path=/usr/local/bin/extbay
if [ -f "$cli_path" ] && grep -q '^container=extbay$' "$cli_path"; then
  rm -f -- "$cli_path"
fi

docker image rm "$EXTBAY_IMAGE" >/dev/null 2>&1 || true
rm -f -- /var/lib/extbay/runtime-tls/cert.pem /var/lib/extbay/runtime-tls/key.pem
rmdir /var/lib/extbay/runtime-tls >/dev/null 2>&1 || true

if [ "$PURGE_DATA" = "1" ]; then
  docker volume rm extbay_data >/dev/null 2>&1 || true
  docker volume ls --format '{{.Name}}' | awk '/^extbay-storage-/ { print }' | while IFS= read -r volume; do
    [ -n "$volume" ] && docker volume rm "$volume" >/dev/null 2>&1 || true
  done
  printf '%s\n' "ExtBay runtime and data volumes were removed. Installer backups under /var/lib/extbay were preserved."
else
  printf '%s\n' "ExtBay was removed. Data volumes were preserved."
  printf '%s\n' "To remove ExtBay data too, run: curl -fsSL https://raw.githubusercontent.com/whileAI/extbay/main/uninstall.sh | sudo PURGE_DATA=1 sh"
fi
