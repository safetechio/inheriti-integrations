# Inheriti MCP

Inheriti MCP connects Inheriti Business to MCP-compatible clients over stdio. The MCP client starts the server; running `node dist/main.js` directly in a terminal waits for MCP messages.

Downloading the `.tgz` package does not install the `inheriti-mcp` command. In PowerShell, from the download folder, run `npm.cmd install --global ".\safetech-inheriti-mcp-<version>.tgz"`. Verify it with `inheriti-mcp --version` and `where.exe inheriti-mcp`.

Call `list_organizations` to open browser sign-in and see the available organizations, then `select_organization` if needed. If the browser does not open, use the URL returned by the tool. `list_backup_plans` shows plan metadata. `create_plan_with_assistant` opens a native window for local asset suggestions and review; use its job ID with `check_plan_creation_status`.

## Automation setup

Automation setup is available when this MCP server targets a local Business API (`localhost`, `127.0.0.1`, or `*.localhost`) or the exact Business dev API (`https://business-api-dev.inheriti.com/integrations/`). It remains unavailable for stg and prod. Sign in through `list_organizations` and select the intended organization first. The Business API controls access: listing connections requires tenant settings permission, and listing a plan's grants requires permission to edit that plan.

1. Call `list_automation_connections` for safe connection metadata. Call `list_automation_grants` with a `planId` to inspect that plan's grants. `list_automation_members` provides member IDs, display names, and status to choose the responsible member; it omits email addresses.
2. Use `create_automation_connection` or `change_automation_trust` with nonsecret provider trust details the human has supplied. Never pass a private key, credential, or identity proof in tool arguments or conversation text. Use `disable_automation_connection` when access should end.

   For GitHub, ask for the repository, environment, and full `workflow_ref` claim. For Google Cloud, ask for the workload identity audience base and the service account's numeric unique ID; MCP appends the connection ID and returns the exact expected audience. For AWS, ask for the automation's IAM task role ARN. For Portable, ask for the runner's PEM public key and key ID; the private key stays on the runner. GitHub creation and trust changes also return the exact expected audience.
3. Call `start_automation_setup` with the connection ID to open the native window for human identity proof. For a pending connection, use its ID from `list_automation_connections` to resume verification. Poll `check_automation_setup_status` until `COMPLETE`, `FAILED`, or `CANCELED`; pass `cancel: true` to stop a waiting job. Organization switching and logout also cancel it.
4. Use `create_automation_grant` with the plan, connection, and responsible member IDs, then `activate_automation_grant` after review. `replace_automation_responsible_member` and `revoke_automation_grant` manage an existing grant. Business enforces plan editor permissions. Re-list metadata to see the current state.
5. For GitHub, call `github_automation_usage` with the plan ID, verified connection ID, and the nonsecret `asset.field` selector from the plan **Data** tab. Ask the human for the selector if it is unavailable; never guess a field or request its value. The tool returns copyable YAML and the exact repository, `.github/workflows/…` file, and branch required by the verified connection. It fails if the grant is inactive, the connection is unverified, its workflow reference is invalid, or Business has no verified Action and CLI release. Do not substitute `@main`, a guessed SHA, or npm `latest`.

The list tools return only allowlisted metadata, and setup status contains no proof or credentials. A connection appearing in a list does not establish that a provider workload can use it. The [CLI setup workflow](../../integrations/README.md#automation-setup) also reserves its window for identity proof.

`reveal_plan_secret`, `download_plan_asset`, and `check_reveal_status` are available by default. Reveal opens a native window after authorization. MCP tool responses do not contain protected values. Existing configurations with `--enable-secure-delivery` continue to work. This app is part of [Inheriti Integrations](../../README.md).
