# ExtBay architecture

## Verified Portainer boundary

ExtBay does not claim or depend on a Portainer plugin API. Portainer CE 2.45.0
serves a statically built Angular/React application. Its `Extension` model is
explicitly deprecated and there is no supported API for adding routes or sidebar
items at runtime. ExtBay therefore integrates at the HTTP boundary.

```text
Browser ──HTTPS── ExtBay Gateway ─────── Portainer CE
                   │    │                 /api/users/me
                   │    └── session check ─┘
                   │
                   ├── /extbay/ui (trusted host)
                   ├── /extbay/extensions/* (untrusted static files)
                   └── Runtime API/RPC ── exact Portainer API allowlist
                            │
                            └── Docker API (backend lifecycle only)
```

The gateway proxies Portainer unchanged, injects one pinned bootstrap script
into HTML responses, and owns `/extbay/*`. It never injects extension code into
Portainer's DOM.

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

The current installer adds the gateway on a new localhost-only port, which does
not restart or modify Portainer. It backs up `docker inspect` and never removes
`portainer_data`; a failed health check removes only the new ExtBay container.
A future cut-over mode may preserve the existing Portainer URL, but it must
recreate Portainer to move public bindings and will require a separate explicit
interactive confirmation plus tested reconstruction/rollback. No such operation
is present in the current installer.

Extension updates are staged, validated, hashed and health-checked before the
active-version pointer changes. Rollback only changes that pointer to an already
verified version. Backend containers are replaced after the new one becomes
healthy.

## Trust boundary

The gateway/runtime is trusted infrastructure and may access the Docker socket
only to manage extension backend containers. Extension RPC for Portainer
resources uses Portainer's API so Portainer RBAC remains authoritative. Backend
containers run non-root with all capabilities dropped, `no-new-privileges`,
read-only root filesystem, limits, a private network by default, and no Docker
socket. `network.outbound` opts into a separately controlled egress network.
