# Inheriti MCP

Inheriti MCP connects Inheriti Business to MCP-compatible clients over stdio. The MCP client starts the server; running `node dist/main.js` directly in a terminal waits for MCP messages.

Downloading the `.tgz` package does not install the `inheriti-mcp` command. In PowerShell, from the download folder, run `npm.cmd install --global ".\safetech-inheriti-mcp-<version>.tgz"`. Verify it with `inheriti-mcp --version` and `where.exe inheriti-mcp`.

Call `list_organizations` to open browser sign-in and see the available organizations, then `select_organization` if needed. `list_backup_plans` shows plan metadata. `reveal_plan_secret`, `download_plan_asset`, and `check_reveal_status` remain available for authorized access. MCP tool responses do not contain protected values.

Plan creation, protected `.inheriti` copies, Inheriti Workspace, and automation tools are currently unavailable in local, dev, stg, and prod builds.
