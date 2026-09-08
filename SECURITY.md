# Security policy

Please use GitHub's private vulnerability reporting for `whileAI/extbay`. Do not
open a public issue until a fix and disclosure date have been coordinated.
Include a minimal reproduction, affected version, impact, and suggested
mitigation.

ExtBay treats the gateway/runtime as trusted infrastructure. Extensions are
untrusted. Report any way an extension can read Portainer credentials or storage,
reach the Docker socket, escape its iframe/backend sandbox, bypass permissions,
write outside its package/storage directory, or cause an unconfirmed Portainer
restart as a security vulnerability.

Security fixes take priority over compatibility. Supported releases and signed
release artifacts will be documented before the first stable release.
