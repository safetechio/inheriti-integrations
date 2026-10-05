# Inheriti MCP

Inheriti MCP connects Inheriti Business to MCP-compatible clients over stdio. The MCP client starts the server; running `node dist/main.js` directly in a terminal waits for MCP messages.

Call `list_organizations` to sign in and see the available organizations, then `select_organization` if needed. `list_backup_plans` shows plan metadata. `create_plan_with_assistant` opens a native window for local asset suggestions and review; use its job ID with `check_plan_creation_status`.

To enable `reveal_plan_secret`, `download_plan_asset`, and `check_reveal_status`, start the server with `--enable-secure-delivery`. Reveal opens a native window after authorization. MCP tool responses do not contain protected values. This app is part of [Inheriti Integrations](../../README.md).
