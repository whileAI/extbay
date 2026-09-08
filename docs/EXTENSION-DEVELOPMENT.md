# Building ExtBay extensions

This guide describes the ExtBay extension format as implemented by the current
repository. ExtBay does not use a Portainer plugin API. An extension is a
validated ZIP package containing a sandboxed web UI and, optionally, a reference
to an immutable backend container image.

## 1. Requirements

You need:

- Node.js 22 or newer for the current SDK and repository tooling;
- a ZIP implementation such as `zip`;
- an installed ExtBay instance for integration testing;
- a GitHub repository with Releases if you want to distribute through
  `github:owner/repository`.

`@extbay/sdk` currently lives in this monorepo and is not guaranteed to be
published to the public npm registry. During early development, use the package
from a local ExtBay checkout and make sure your bundler includes it in the final
browser bundle.

## 2. Minimal package layout

An `.extbay` file is an ordinary ZIP archive. `extbay.json` must be at the root
of the archive, not inside an extra directory.

```text
my-extension.extbay
├── extbay.json
└── dist
    ├── index.html
    └── app.js
```

A minimal source project can look like this:

```text
my-extension/
├── package.json
├── src/
│   └── app.ts
├── public/
│   └── index.html
└── package-root/
    ├── extbay.json
    └── dist/
```

Do not include `install.sh`, lifecycle scripts, a Docker socket, credentials, or
host binaries. ExtBay never executes an installer supplied by an extension.

### Copy-paste minimal extension

Create `hello-extbay/extbay.json`:

```json
{
  "schemaVersion": 1,
  "id": "example.hello",
  "name": "Hello ExtBay",
  "version": "1.0.0",
  "author": "Example Author",
  "compatibility": {
    "portainer": ">=2.0.0"
  },
  "runtime": {
    "reload": "hot"
  },
  "permissions": [],
  "ui": {
    "entry": "dist/index.html",
    "sidebar": {
      "title": "Hello ExtBay",
      "icon": "box"
    }
  }
}
```

Create `hello-extbay/dist/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Hello ExtBay</title>
  </head>
  <body>
    <h1 id="title">Loading…</h1>
    <script type="module" src="./app.js"></script>
  </body>
</html>
```

Create `hello-extbay/dist/app.js`:

```js
document.querySelector('#title').textContent = 'Hello from a sandboxed ExtBay extension';
```

Package and install it:

```sh
cd hello-extbay
zip -X -r ../hello-extbay-1.0.0.extbay extbay.json dist
cd ..
extbay install ./hello-extbay-1.0.0.extbay
```

This example requests no permissions and makes no privileged calls. Continue
with the SDK section when the extension needs Portainer data or actions.

## 3. Manifest

The complete JSON Schema is available at
[`schemas/extbay.schema.json`](../schemas/extbay.schema.json). Unknown fields are
rejected because every manifest object uses `additionalProperties: false`.
For the same reason, do not add a `$schema` property to `extbay.json`; configure
the schema association in your editor instead.

Example:

```json
{
  "schemaVersion": 1,
  "id": "whileai.ai-models",
  "name": "AI Models",
  "version": "1.0.0",
  "author": "whileAI",
  "description": "Manage local AI model containers.",
  "homepage": "https://github.com/whileAI/portainer-ai-models",
  "compatibility": {
    "portainer": ">=2.20.0 <3.0.0",
    "extbay": ">=0.1.0"
  },
  "runtime": {
    "reload": "hot"
  },
  "permissions": [
    "containers.read",
    "containers.control",
    "gpu.metrics",
    "extension.storage"
  ],
  "ui": {
    "entry": "dist/index.html",
    "sidebar": {
      "title": "AI Models",
      "icon": "cpu"
    }
  }
}
```

### Manifest fields

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Must be `1`. |
| `id` | Stable lowercase reverse-domain-style identifier, for example `whileai.ai-models`. It cannot change between updates. |
| `name` | Human-readable name, up to 80 characters. |
| `version` | A valid semantic version such as `1.2.0` or `2.0.0-beta.1`. Published versions are immutable. |
| `author` | Author or organization name. |
| `description` | Optional description, up to 500 characters. |
| `homepage` | Optional HTTPS URL. Plain HTTP is rejected. |
| `compatibility.portainer` | A semantic-version range checked against `/api/status`. |
| `compatibility.extbay` | Optional ExtBay semantic-version range. |
| `runtime.reload` | One of `hot`, `ui-reload`, or `portainer-restart`. |
| `permissions` | Unique permissions requested by the extension. Request only what is required. |
| `ui.entry` | Relative path to an existing HTML file inside the package. |
| `ui.sidebar` | Display title and lowercase icon identifier. |
| `backend` | Optional hardened backend container configuration. |

Paths must be relative, use `/`, and cannot contain `..` or backslashes.

### Reload modes

- `hot`: the new version is activated atomically without restarting Portainer.
- `ui-reload`: the package is activated without restarting Portainer; reopening
  the extension loads the new versioned assets.
- `portainer-restart`: ExtBay records a pending restart. It never restarts
  Portainer or DockFrame without an explicit user action.

Use `hot` unless the extension has a demonstrated reason to require another
mode.

## 4. Permissions

Every SDK call is mapped to a permission and checked by the runtime. Declaring a
permission in the manifest does not bypass Portainer RBAC.

| Permission | Current SDK operations | Notes |
| --- | --- | --- |
| `containers.read` | `containers.list`, `containers.inspect` | Read container metadata through Portainer. |
| `containers.control` | `containers.restart` | Performs a state-changing container operation. |
| `stacks.read` | `stacks.list` | Lists stacks visible to the current Portainer user. |
| `stacks.write` | Reserved | `stacks.update` currently returns `501`; raw stack writes are not exposed. |
| `volumes.read` | `volumes.list` | Lists volumes through the selected endpoint. |
| `gpu.metrics` | Reserved provider | `metrics.gpu` currently returns `501` until a provider is configured. |
| `host.metrics` | `metrics.host` | Reads the Docker endpoint information response. |
| `network.outbound` | Backend network selection | Gives an optional backend access to the outbound ExtBay network. It does not enable browser `fetch`. |
| `extension.storage` | `storage.get`, `storage.set` | Per-extension, per-Portainer-user key/value storage. |

On first installation, ExtBay shows the requested permissions and defaults to
No. If an update adds permissions, the user must approve the new set again. Do
not request permissions for planned future features.

## 5. Sandboxed UI

Extension UI code does not run in the privileged Portainer DOM. It runs in an
iframe with:

```html
<iframe sandbox="allow-scripts">
```

The frame has an opaque origin. It does not receive Portainer cookies, auth
tokens, `localStorage`, top-level navigation, forms, popups, or direct access to
the parent DOM. Direct network connections are blocked by CSP. Use the SDK for
all privileged operations.

Use external scripts instead of inline JavaScript:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>AI Models</title>
    <link rel="stylesheet" href="./app.css">
  </head>
  <body>
    <main id="app"></main>
    <script type="module" src="./app.js"></script>
  </body>
</html>
```

Keep all UI assets inside the package and use relative URLs. Do not load scripts,
fonts, images, or styles from a CDN.

## 6. Using `@extbay/sdk`

Bundle the SDK into your application code. The SDK communicates with the trusted
manager using `postMessage` RPC. The runtime validates the extension identity,
enabled state, permission, method, arguments, current Portainer user, and
Portainer RBAC before forwarding an operation.

Example:

```ts
import { extbay } from '@extbay/sdk';

const endpointInput = document.querySelector<HTMLInputElement>('#endpoint');
const listButton = document.querySelector<HTMLButtonElement>('#list');
const output = document.querySelector<HTMLPreElement>('#output');

listButton?.addEventListener('click', async () => {
  try {
    const endpointId = Number(endpointInput?.value);
    const containers = await extbay.containers.list(endpointId);
    if (output) output.textContent = JSON.stringify(containers, null, 2);
  } catch (error) {
    if (output) {
      output.textContent = error instanceof Error ? error.message : String(error);
    }
  }
});
```

The current SDK requires the extension to receive or ask the user for a
Portainer endpoint ID; endpoint discovery is not yet exposed as an SDK method.
Call SDK methods after the frame has loaded, normally in response to user input.
Calling immediately during module evaluation can happen before the ExtBay
initialization message and will fail with `ExtBay SDK has not been initialized`.

### Container operations

```ts
const containers = await extbay.containers.list(endpointId);
const details = await extbay.containers.inspect(endpointId, containerId);
await extbay.containers.restart(endpointId, containerId);
```

Required permissions are `containers.read` for list/inspect and
`containers.control` for restart.

### Stacks and volumes

```ts
const stacks = await extbay.stacks.list(endpointId);
const volumes = await extbay.volumes.list(endpointId);
```

Required permissions are `stacks.read` and `volumes.read`.

### Metrics

```ts
const host = await extbay.metrics.host(endpointId);
const gpu = await extbay.metrics.gpu(endpointId);
```

`metrics.host` requires `host.metrics`. `metrics.gpu` requires `gpu.metrics`, but
the GPU provider is not implemented in the current runtime and returns `501`.

### Extension storage

```ts
type Preferences = { compact: boolean };

const preferences = await extbay.storage.get<Preferences>('preferences');
await extbay.storage.set('preferences', { compact: true });
```

Storage requires `extension.storage`. Keys are limited to 128 characters, a
single JSON value is limited to 64 KiB, and the per-user extension document is
limited to 1 MiB. Storage is isolated by extension ID and Portainer user ID.

## 7. Optional backend container

An extension cannot run arbitrary host installation commands. If it needs a
backend, reference an existing Docker image pinned by digest:

```json
{
  "backend": {
    "image": "ghcr.io/whileai/ai-models-backend@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "command": ["/app/server"],
    "memory": "256MiB",
    "cpus": 0.5,
    "healthPath": "/health"
  }
}
```

Tags such as `latest` are rejected. The backend runs with these defaults:

- user `65532:65532`;
- all Linux capabilities dropped;
- `no-new-privileges`;
- read-only root filesystem;
- PID, CPU, and memory limits;
- a private per-extension volume mounted at `/data`;
- no Docker socket;
- an internal network unless `network.outbound` was approved;
- a 64 MiB `noexec`, `nosuid`, `nodev` `/tmp`.

The image must be able to run as UID/GID `65532` and write persistent data only
under `/data`. Add a Docker `HEALTHCHECK` to the image. In the current runtime,
Docker health status is enforced when present; `backend.healthPath` is reserved
for a future direct HTTP health probe.

The current SDK does not expose a generic browser-to-backend transport. Do not
assume that publishing a container port makes it reachable from the extension
iframe.

## 8. Build the package

Build the browser application first, then assemble a clean package root:

```sh
npm run build
mkdir -p package-root/dist
cp extbay.json package-root/extbay.json
cp -R dist/. package-root/dist/
```

Create the archive from inside `package-root` so `extbay.json` is at ZIP root:

```sh
cd package-root
zip -X -r ../ai-models-1.0.0.extbay extbay.json dist
cd ..
```

Do not run `zip` against the `package-root` directory itself. This incorrect
layout will create `package-root/extbay.json`, which ExtBay rejects.

Default package limits are:

- archive: 50 MiB;
- files/directories: 2,048 entries;
- total unpacked size: 200 MiB;
- no symlinks;
- no absolute paths, backslashes, NUL bytes, or traversal paths.

## 9. Local validation and testing

The most accurate validation is a local installation because it checks the
schema, archive paths, UI entry, compatibility, SHA-256, optional companions,
permissions, backend image, and health:

```sh
extbay install ./ai-models-1.0.0.extbay
extbay list
extbay logs whileai.ai-models
```

Exercise every declared SDK operation with both an allowed and a denied
permission set. Verify the extension in light and dark themes, with a collapsed
sidebar, and at narrow viewport widths.

Test rollback before publishing:

```sh
extbay install ./ai-models-1.1.0.extbay
extbay rollback whileai.ai-models 1.0.0
```

Use a new semantic version whenever package bytes change. Reusing the same
`id@version` with different bytes fails with an immutable-version conflict.

## 10. Checksums and signatures

Generate the optional checksum companion:

```sh
sha256sum ai-models-1.0.0.extbay > ai-models-1.0.0.extbay.sha256
```

ExtBay also supports an Ed25519 detached-signature document:

```json
{
  "algorithm": "ed25519",
  "keyId": "whileai-release-2026",
  "signature": "BASE64_SIGNATURE"
}
```

The file name must be `<package>.extbay.sig`. The signature covers the exact
`.extbay` bytes, not the checksum or unpacked files. The corresponding public
key must already be trusted by the ExtBay administrator in
`/data/trust/keys.json`:

```json
{
  "whileai-release-2026": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
}
```

If a signature companion exists, an invalid signature, unknown key ID, or
malformed document fails closed. Unsigned packages are currently allowed but are
reported as `unsigned`.

Protect the private signing key outside the extension repository and CI logs.
Use a dedicated release key and document your rotation/revocation process.

## 11. Publish with GitHub Releases

Create a GitHub Release whose tag is the extension version, for example `1.2.0`
or `v1.2.0`. Attach exactly one file ending in `.extbay`:

```text
ai-models-1.2.0.extbay
ai-models-1.2.0.extbay.sha256    # optional
ai-models-1.2.0.extbay.sig       # optional
```

Install the latest release:

```sh
extbay install github:whileAI/portainer-ai-models
```

Install a specific release:

```sh
extbay install github:whileAI/portainer-ai-models@1.2.0
```

Automatic update checks apply to unpinned `github:owner/repository` sources and
direct HTTPS sources. A pinned GitHub source with `@version` and a local file are
not automatically advanced. ExtBay compares `extbay.json.version`, not the
Release creation date.

If a release has zero or multiple `.extbay` assets, installation fails. Keep
debug archives, source archives, and platform-specific files from using the
`.extbay` suffix.

## 12. Update rules

For every update:

1. keep the same extension `id`;
2. increment `version` using semantic versioning;
3. never replace the bytes of an already published version;
4. keep permissions unchanged unless the feature genuinely needs more access;
5. publish the `.sha256` and `.sig` companions together with the package;
6. verify `hot`, `ui-reload`, or restart behavior;
7. retain at least one known-good version for rollback.

When new permissions appear, ExtBay displays them and requires approval again.
An update cannot silently expand its privileges.

## 13. Security checklist

Before publishing, confirm that the extension:

- does not try to read Portainer cookies, tokens, or `localStorage`;
- does not access `/var/run/docker.sock`;
- uses the SDK instead of raw Portainer/internal API calls;
- requests the minimum permission set;
- treats container names, labels, logs, and API responses as untrusted data;
- never inserts untrusted text through `innerHTML`;
- bundles dependencies and does not use remote scripts;
- pins backend images by digest;
- runs correctly as UID/GID `65532` with a read-only root filesystem;
- does not put secrets in the manifest, frontend bundle, image command, or logs;
- validates all user input and handles denied RPC calls;
- has been tested with network access unavailable.

Report security issues according to [`SECURITY.md`](../SECURITY.md).

## 14. Common errors

### `extbay.json is required at archive root`

The ZIP contains an extra parent directory. Recreate it from inside the package
root.

### `UI entry does not exist`

`ui.entry` does not exactly match a packaged file. Paths are case-sensitive.

### `approved permissions must exactly match requested permissions`

The package changed between inspection and installation, or the approval does
not match the manifest. Inspect the artifact and retry; do not bypass the check.

### `immutable version conflict`

The same `id@version` was already installed with a different SHA-256. Publish a
new semantic version.

### `permission denied: ...`

The SDK method requires a permission not granted to the installed version. Add
it only if necessary, increment the version, and let the user approve it.

### `release must contain exactly one .extbay asset`

The GitHub Release has no package or has more than one asset ending in
`.extbay`.

### Backend health timeout

Check `extbay logs <extension-id>`, the image architecture, UID `65532`, resource
limits, command, and Docker `HEALTHCHECK`.

## 15. Release checklist

- [ ] `extbay.json` passes the current schema.
- [ ] `id` is stable and `version` is incremented.
- [ ] `ui.entry` exists and uses only packaged assets.
- [ ] Every SDK call has a corresponding permission.
- [ ] No unused permission is requested.
- [ ] Light theme, dark theme, and narrow layout were tested.
- [ ] The sandbox works without cookies, `localStorage`, or direct network access.
- [ ] The backend image is digest-pinned and runs as UID/GID `65532`.
- [ ] Installation, update, disable/enable, uninstall, and rollback were tested.
- [ ] SHA-256 was generated.
- [ ] The package was signed when a trusted release key is available.
- [ ] The GitHub Release contains exactly one `.extbay` asset.
