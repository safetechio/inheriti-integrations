# Inheriti® Integrations

Inheriti® Integrations brings Inheriti® Business protection plans into the tools people already use. This repository contains desktop, browser, and developer tools for signing in, working with organizations, and protecting or accessing plan data.

- **[Inheriti® Go](apps/inheriti-go/README.md)** — a desktop companion for creating and editing plans.
- **[Inheriti® Importer](apps/inheriti-importer/README.md)** — import secrets from external sources into Inheriti® Business plans.
- **[Inheriti® CLI](apps/inheriti-cli/README.md)** — plan workflows from the terminal.
- **[Inheriti® MCP](apps/inheriti-mcp/README.md)** — plan tools for MCP-compatible clients.
- **[Inheriti® IDE](apps/inheriti-ide/README.md)** — a VS Code extension for working with plans while coding.
- **[InheritiGuard](apps/inheriti-guard/README.md)** — a Chrome extension for browser workflows.

The integrations share the Inheriti® Elements SDKs for authentication and plan operations. The [runtime integrations](integrations/README.md) include examples for cloud and automation platforms.

## Human authentication authority

`INTEGRATION_AUTHORITY` in `packages/core/src/deployment.ts` selects one credential strategy for all integration hosts in a deployment. Its source value is `business` by default. Change it to `safeid-oidc` only with the matching Business API and Web UI source constants and a coordinated release; no new environment variable selects the strategy.

| Strategy | Login and stored session | API credential |
|---|---|---|
| `business` | SafeID supplies the initial identity proof. The Client SDK exchanges it through the Business operator-session API and stores the Business access/refresh pair and family. | Business operator access token. |
| `safeid-oidc` | The Client SDK stores an authority-bound SafeID access/refresh pair. Each host refreshes and revokes directly with SafeID; no Business family is created. | SafeID access token for `inheriti-integrations-api`, verified by the Business API before local user and organization authorization. |

CLI, IDE, MCP, Go, Workspace, Importer, and Guard use the selected strategy. Stored sessions are bound to authority, API URL, audience, client, issuer, and environment; changing strategy or configuration requires a new sign-in. Keep the Client SDK and each host's dependency revision aligned before activation. The Web browser uses a different transport: its API broker owns provider refresh behind an HttpOnly cookie in SafeID mode. See the [Client SDK operator authentication guide](../elements/sdk/sdk/docs/operator-auth.md) and the [Business API authentication guide](../bussiness/api/docs/architecture/authentication-and-security.md).
