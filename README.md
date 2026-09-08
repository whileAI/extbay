# ExtBay

ExtBay is an open-source, security-first extension runtime for Portainer CE. It
does not rely on a nonexistent Portainer plugin API: a gateway proxies Portainer
and adds an isolated Extensions surface while the original image and
`portainer_data` remain untouched.

> Status: early security-focused MVP. Do not expose it to the Internet before an
> independent security review. Stack writes, GPU provider, signature trust CLI,
> zero-downtime production cut-over are still incomplete.

In this MVP, `network.outbound` controls backend-container egress. UI frames have
`connect-src 'none'`; a future outbound RPC will require a hostname allowlist and
DNS-rebinding-safe transport. `gpu.metrics` is typed in the SDK but returns 501
until an explicit metrics provider is configured. `stacks.write` is reserved by
the schema but not exposed as a raw API proxy.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/whileAI/extbay/main/install.sh | sudo sh
```

The script and source are downloaded directly from GitHub. The installer builds
`extbay:local` on the machine; no prebuilt ExtBay image or separate download
server is required. ExtBay does not operate a website, hosted registry,
marketplace, telemetry service, or central extension catalog.

The installer recognizes official Portainer images and DockFrame containers by
image/name. For any other fork, identify its running container explicitly (and
set its internal HTTP port when it is not `9000`):

```sh
curl -fsSL https://raw.githubusercontent.com/whileAI/extbay/main/install.sh | sudo PORTAINER_CONTAINER=dockframe PORTAINER_PORT=9000 sh
```

For a reproducible installation, replace `main` in both the raw URL and
`EXTBAY_SOURCE_REF` with a release tag or commit SHA.

The safe default publishes ExtBay on `127.0.0.1:9444`; open DockFrame/Portainer
through this address to see the embedded **Extensions** section with **Installed**,
**Updates**, and **Settings** tabs. The installer discovers the panel container,
backs up `docker inspect`, and
does not restart or recreate Portainer. It never deletes `portainer_data`.

ExtBay automatically checks supported GitHub Release and HTTPS sources when an
administrator opens the Extensions section. An available update offers **Install
update** or **Later (1 day)**. Installation is never silent, new permissions are
shown again, and an update that needs `portainer-restart` only sets a pending
status—it never restarts the panel.

```sh
extbay install github:whileAI/portainer-ai-models
extbay install github:whileAI/portainer-ai-models@1.2.0
extbay install https://example.com/plugin.extbay
extbay install ./plugin.extbay
extbay list
extbay update whileai.ai-models
extbay disable whileai.ai-models
extbay enable whileai.ai-models
extbay rollback whileai.ai-models 1.0.0
extbay uninstall whileai.ai-models
extbay doctor
```

`github:` resolves a release from the specified extension repository. A direct
HTTPS URL is fetched exactly as supplied. A local `.extbay` never leaves the
machine. ExtBay has no default registry and performs no catalog lookup.

Installation is fail-closed in non-interactive mode unless `--yes` is supplied.
New permissions on update require another confirmation.

## Uninstall ExtBay

```sh
curl -fsSL https://raw.githubusercontent.com/whileAI/extbay/main/uninstall.sh | sudo sh
```

This removes the ExtBay runtime, CLI, image, and managed backend containers
without changing or restarting Portainer/DockFrame. Extension data and backups
are preserved by default. To explicitly delete ExtBay volumes too, use
`sudo PURGE_DATA=1 sh`; `portainer_data` is never touched.

For signed packages, publish `<package>.extbay.sig` containing
`{"algorithm":"ed25519","keyId":"...","signature":"<base64>"}`. The signature
covers the exact `.extbay` bytes and the public key must already exist in
`/data/trust/keys.json`. An optional `<package>.extbay.sha256` is also verified.
An invalid or untrusted present signature fails closed; unsigned packages are
clearly reported by the CLI.

The trusted ExtBay container is read-only apart from `/data`, capability-free,
resource-limited, and has the Docker socket solely for lifecycle management of
hardened backend containers. Extension containers never receive that socket.

## Development

```sh
npm ci
npm run typecheck
npm test
docker build -t extbay:dev .
sudo EXTBAY_IMAGE=extbay:dev sh install.sh
```

See [architecture](docs/ARCHITECTURE.md), the
[manifest schema](schemas/extbay.schema.json), and [security policy](SECURITY.md).

## License

Apache License 2.0. See [LICENSE](LICENSE).
