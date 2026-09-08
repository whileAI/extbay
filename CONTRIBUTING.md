# Contributing

Open an issue before large changes. Keep code and technical identifiers in
English. Every security-boundary change needs tests for both allowed and denied
behavior. Run `npm ci`, `npm run typecheck`, `npm test`, and `npm audit` before a
pull request.

Do not add extension install scripts, direct extension access to Docker, dynamic
code execution in the Portainer DOM, permissive iframe sandbox flags, or silent
Portainer restarts. New permissions require a schema entry, RPC mapping, argument
validation, documentation, and denial tests.

Contributions are accepted under the Apache License 2.0.
