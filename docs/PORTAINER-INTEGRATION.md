# Portainer CE integration notes

Research baseline: upstream tag `2.45.0`, commit `d79ba72` (checked
2026-09-08).

- `api/portainer.go` calls the old `Extension` model deprecated.
- `app/react/sidebar/Sidebar.tsx` statically composes the sidebar at build time.
- `api/http/handler/file/handler.go` serves the compiled public directory with a
  normal static file server.
- `api/http/security/bouncer.go` sets CSP with `script-src 'self'` and a
  `frame-src` list that does not contain `'self'`.

Consequences: ExtBay uses no private/deprecated extension data model. The trusted
gateway injects a same-origin bootstrap and minimally extends `frame-src` with
`'self'` so its trusted management iframe can render. Untrusted extension frames
remain governed by ExtBay's stricter CSP and sandbox. Sidebar DOM placement is a
version-sensitive adapter with a fixed-position launcher fallback; it is not
presented as a Portainer API.
