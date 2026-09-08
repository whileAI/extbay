# ExtBay architecture

## Verified Portainer boundary

ExtBay does not claim or depend on a Portainer plugin API. Portainer CE 2.45.0
serves a statically built Angular/React application. Its `Extension` model is
explicitly deprecated and there is no supported API for adding routes or sidebar
items at runtime. ExtBay therefore integrates through a reversible static-asset
adapter.

```text
Browser ──normal panel URL── Portainer/DockFrame
                              ├── injected ExtBay bootstrap
                              ├── trusted manager (Shadow DOM)
                              └── sandboxed extension iframe
                                         │
                              ExtBay Runtime API/RPC
                                ├── Portainer authentication/RBAC
                                └── Docker API (backend lifecycle only)
```

The installer copies the trusted manager assets into `/public` and injects one
bootstrap script into the panel index. Extension code is never executed in the
privileged panel DOM: versioned extension assets are copied to a same-origin
static path solely to satisfy Portainer's CSP, then loaded in an opaque-origin
sandboxed iframe. The authenticated runtime API listens separately, but is a
backend daemon rather than a user-facing site.

## Loading modes

- `hot`: install into a versioned directory and atomically update state. A new
  iframe URL contains the package hash, so browser caches cannot retain old code.
- `ui-reload`: same atomic activation, followed by an iframe-only reload notice.
- `portainer-restart`: records a pending restart. Only an explicit CLI/UI action
  with confirmation may restart Portainer.

## Sandbox and RPC

Extension UI is loaded with `sandbox="allow-scripts"`, without
`allow-same-origin`, navigation, popups, forms, or top-level access. Its origin is
opaque. A per-frame random nonce and `MessagePort` establish an RPC session. The
host checks `event.source`; the runtime checks the authenticated Portainer user,
extension id, enabled state, granted permission, method allowlist, argument
schema, endpoint access, and rate/size limits. Cookies, CSRF values and Portainer
tokens are never included in RPC responses.

## Installation and rollback

The installer backs up `docker inspect` and `/public/index.html`, starts the
runtime, copies the UI adapter into the running panel, and verifies the marker.
It does not restart or recreate Portainer and never modifies `portainer_data`.
On failure it restores the original index and removes the new runtime.
`uninstall.sh` performs the same restoration. A panel container recreation or
upgrade replaces its writable layer, so ExtBay must then be installed again.

Extension updates are staged, validated, hashed and health-checked before the
active-version pointer changes. Rollback only changes that pointer to an already
verified version. Backend containers are replaced after the new one becomes
healthy.

## Trust boundary

The manager/runtime is trusted infrastructure and may access the Docker socket
only to manage extension backend containers. Extension RPC for Portainer
resources uses Portainer's API so Portainer RBAC remains authoritative. Backend
containers run non-root with all capabilities dropped, `no-new-privileges`,
read-only root filesystem, limits, a private network by default, and no Docker
socket. `network.outbound` opts into a separately controlled egress network.

## Distribution model

ExtBay has no central service, website, registry, marketplace, accounts, or
telemetry. The runtime and CLI operate locally. Extension sources are explicit:
a local `.extbay`, a caller-supplied HTTPS URL, or a GitHub Release selected by
`github:owner/repository[@version]`. ExtBay never searches a catalog or silently
selects a third-party source.
