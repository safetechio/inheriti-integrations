# Inheriti MCP

Inheriti MCP connects Inheriti Business to MCP-compatible clients over stdio. The MCP client starts the server; running `node dist/main.js` directly in a terminal waits for MCP messages.

Downloading the `.tgz` package does not install the `inheriti-mcp` command. In PowerShell, from the download folder, run `npm.cmd install --global ".\safetech-inheriti-mcp-<version>.tgz"`. Verify it with `inheriti-mcp --version` and `where.exe inheriti-mcp`.

Call `list_organizations` to sign in and see the available organizations, then `select_organization` if needed. `list_backup_plans` shows plan metadata. `create_plan_with_assistant` opens a native window for local asset suggestions and review; use its job ID with `check_plan_creation_status`.

`reveal_plan_secret`, `download_plan_asset`, and `check_reveal_status` are available by default. Reveal opens a native window after authorization. MCP tool responses do not contain protected values. Existing configurations with `--enable-secure-delivery` continue to work. This app is part of [Inheriti Integrations](../../README.md).
