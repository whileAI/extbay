# Portainer CE integration notes

Research baseline: upstream tag `2.45.0`, commit `d79ba72` (checked
2026-09-08).

- `api/portainer.go` calls the old `Extension` model deprecated.
- `app/react/sidebar/Sidebar.tsx` statically composes the sidebar at build time.
- `api/http/handler/file/handler.go` serves the compiled public directory with a
  normal static file server.
- `api/http/security/bouncer.go` sets CSP with `script-src 'self'` and a
  `frame-src` list that does not contain `'self'`.

Consequences: ExtBay uses no private/deprecated extension data model. The
installer backs up `/public/index.html`, copies versioned ExtBay assets into the
running panel, and adds a same-origin bootstrap tag. The trusted manager renders
in an isolated Shadow DOM inside the panel content area. Extension frontend
assets are copied into versioned `/public/extbay-extensions/` paths and execute
only in `sandbox="allow-scripts"` iframes. Sidebar DOM placement remains a
version-sensitive adapter; it is not presented as a Portainer API.
