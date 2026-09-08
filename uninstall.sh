#!/bin/sh
set -eu

EXTBAY_CONTAINER="${EXTBAY_CONTAINER:-extbay}"
EXTBAY_IMAGE="${EXTBAY_IMAGE:-extbay:local}"
PURGE_DATA="${PURGE_DATA:-0}"

die() { printf '%s\n' "extbay uninstaller: $*" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || die "Docker was not found"
docker info >/dev/null 2>&1 || die "Docker daemon is unavailable or permission was denied"

printf '%s\n' "Removing ExtBay runtime (Portainer/DockFrame will not be changed or restarted)..."

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
