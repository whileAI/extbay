#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
EXTBAY_SOURCE_REF="${EXTBAY_SOURCE_REF:-main}"
if [ -n "${EXTBAY_IMAGE:-}" ]; then
  custom_image=true
else
  custom_image=false
  EXTBAY_IMAGE="extbay:local"
fi
EXTBAY_PORT="${EXTBAY_PORT:-9444}"
EXTBAY_BIND="${EXTBAY_BIND:-127.0.0.1}"
PORTAINER_PORT="${PORTAINER_PORT:-9000}"
EXTBAY_CONTAINER="extbay"
BACKUP_ROOT="/var/lib/extbay/backups"

die() { printf '%s\n' "extbay installer: $*" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || die "Docker was not found"
docker info >/dev/null 2>&1 || die "Docker daemon is unavailable or permission was denied"

source_dir="$SCRIPT_DIR"
source_tmp=""
cleanup_source() {
  if [ -n "$source_tmp" ]; then
    case "$source_tmp" in
      /tmp/extbay-source.*) rm -rf -- "$source_tmp" ;;
      *) die "refusing to remove unexpected temporary path: $source_tmp" ;;
    esac
    source_tmp=""
  fi
}
trap cleanup_source EXIT

if [ "$custom_image" = false ] && { [ ! -f "$source_dir/Dockerfile" ] || [ ! -f "$source_dir/schemas/extbay.schema.json" ]; }; then
  command -v curl >/dev/null 2>&1 || die "curl was not found"
  command -v tar >/dev/null 2>&1 || die "tar was not found"
  case "$EXTBAY_SOURCE_REF" in
    *[!A-Za-z0-9._/-]*|'') die "EXTBAY_SOURCE_REF contains unsupported characters" ;;
  esac
  source_tmp="$(mktemp -d /tmp/extbay-source.XXXXXX)"
  source_archive="$source_tmp/source.tar.gz"
  printf '%s\n' "Downloading ExtBay source from GitHub ($EXTBAY_SOURCE_REF)..."
  if ! curl -fsSL --proto '=https' --tlsv1.2 \
    "https://github.com/whileAI/extbay/archive/$EXTBAY_SOURCE_REF.tar.gz" \
    -o "$source_archive"; then
    cleanup_source
    die "failed to download ExtBay source from GitHub"
  fi
  mkdir "$source_tmp/source"
  if ! tar -xzf "$source_archive" --strip-components=1 -C "$source_tmp/source"; then
    cleanup_source
    die "failed to unpack ExtBay source"
  fi
  source_dir="$source_tmp/source"
fi

if [ -n "${PORTAINER_CONTAINER:-}" ]; then
  portainer_id="$(docker inspect -f '{{.Id}}' "$PORTAINER_CONTAINER" 2>/dev/null)" || die "Portainer container was not found: $PORTAINER_CONTAINER"
  running="$(docker inspect -f '{{.State.Running}}' "$portainer_id")"
  [ "$running" = true ] || die "Portainer container is not running: $PORTAINER_CONTAINER"
  portainer_name="$(docker inspect -f '{{.Name}}' "$portainer_id" | sed 's#^/##')"
else
  candidates="$(docker ps --format '{{.ID}}|{{.Image}}|{{.Names}}' | awk -F '|' '{ value=tolower($2 "|" $3); if ($2 ~ /(^|\/)portainer\/portainer(-ce)?(:|@|$)/ || value ~ /dockframe/) print }')"
  if [ -z "$candidates" ]; then
    docker ps -a --format '  {{.Names}}  {{.Image}}  {{.Status}}' >&2
    die "no running Portainer CE/DockFrame container was found; start it or set PORTAINER_CONTAINER=<name>"
  fi
  count="$(printf '%s\n' "$candidates" | wc -l | tr -d ' ')"
  [ "$count" = 1 ] || { printf '%s\n' "$candidates" >&2; die "multiple Portainer containers found; set PORTAINER_CONTAINER=<name>"; }
  portainer_id="$(printf '%s' "$candidates" | cut -d '|' -f 1)"
  portainer_name="$(printf '%s' "$candidates" | cut -d '|' -f 3)"
fi
portainer_version="$(docker exec "$portainer_id" /portainer --version 2>/dev/null | head -1 || true)"
[ -n "$portainer_version" ] || portainer_version="unknown"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="$BACKUP_ROOT/$timestamp"
install -d -m 0700 "$backup_dir"
docker inspect "$portainer_id" > "$backup_dir/portainer.inspect.json"
printf '%s\n' "$portainer_id" > "$backup_dir/portainer.id"
printf '%s\n' "$portainer_version" > "$backup_dir/portainer.version"

if docker inspect "$EXTBAY_CONTAINER" >/dev/null 2>&1; then
  die "container $EXTBAY_CONTAINER already exists; use the upgrade procedure"
fi

network="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}' "$portainer_id" | head -1)"
[ -n "$network" ] || network="bridge"
portainer_ip="$(docker inspect -f "{{with index .NetworkSettings.Networks \"$network\"}}{{.IPAddress}}{{end}}" "$portainer_id")"
[ -n "$portainer_ip" ] || die "could not determine Portainer address on network $network"

cleanup_container() {
  docker rm -f "$EXTBAY_CONTAINER" >/dev/null 2>&1 || true
}
cleanup_interrupted() {
  cleanup_container
  cleanup_source
}
trap cleanup_interrupted HUP INT TERM

if [ "$custom_image" = false ]; then
  [ -f "$source_dir/Dockerfile" ] || die "downloaded source does not contain Dockerfile"
  printf '%s\n' "Building ExtBay locally from source..."
  if ! docker build -t "$EXTBAY_IMAGE" "$source_dir"; then
    cleanup_source
    die "failed to build ExtBay"
  fi
  cleanup_source
elif ! docker image inspect "$EXTBAY_IMAGE" >/dev/null 2>&1; then
  docker pull "$EXTBAY_IMAGE"
fi
if ! docker run -d \
  --name "$EXTBAY_CONTAINER" \
  --restart unless-stopped \
  --network "$network" \
  -p "$EXTBAY_BIND:$EXTBAY_PORT:9444" \
  -e "EXTBAY_PORTAINER_URL=http://$portainer_ip:$PORTAINER_PORT" \
  -e "EXTBAY_LISTEN=0.0.0.0:9444" \
  -v extbay_data:/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --pids-limit 256 \
  --memory 512m \
  --cpus 1.0 \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  "$EXTBAY_IMAGE" >/dev/null; then
  cleanup_container
  die "failed to create ExtBay; Portainer was not changed"
fi

healthy=false
i=0
while [ "$i" -lt 30 ]; do
  if docker exec "$EXTBAY_CONTAINER" node -e "fetch('http://127.0.0.1:9444/extbay/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then healthy=true; break; fi
  i=$((i + 1)); sleep 1
done
if [ "$healthy" != true ]; then
  cleanup_container
  die "ExtBay health check failed; ExtBay container was removed. Portainer was not changed. Backup: $backup_dir"
fi
trap - HUP INT TERM

cli_path=/usr/local/bin/extbay
cli_tmp="$(mktemp)"
cat > "$cli_tmp" <<'EOF'
#!/bin/sh
set -eu
container=extbay
case "${1:-}" in
  install)
    source_arg="${2:-}"
    if [ -n "$source_arg" ] && [ -f "$source_arg" ]; then
      import_name="import-$$.extbay"
      docker exec "$container" mkdir -p /data/imports
      docker cp "$source_arg" "$container:/data/imports/$import_name"
      shift 2
      set +e
      docker exec -i "$container" node /app/packages/cli/dist/main.js install "/data/imports/$import_name" "$@"
      status=$?
      set -e
      docker exec "$container" rm -f "/data/imports/$import_name" >/dev/null 2>&1 || true
      exit "$status"
    fi
    ;;
esac
exec docker exec -i "$container" node /app/packages/cli/dist/main.js "$@"
EOF
install -m 0755 "$cli_tmp" "$cli_path"
rm -f "$cli_tmp"

printf '\nExtBay installed for Portainer %s (%s).\n' "$portainer_name" "$portainer_version"
printf 'Open Portainer through ExtBay: http://%s:%s\n' "$EXTBAY_BIND" "$EXTBAY_PORT"
printf 'The secure default binds localhost only; use an authenticated TLS reverse proxy for remote access.\n'
printf 'Portainer was not restarted or modified. Backup: %s\n' "$backup_dir"
