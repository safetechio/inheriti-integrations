# Inheriti MCP

Inheriti MCP connects Inheriti Business to MCP-compatible clients over stdio. The MCP client starts the server; running `node dist/main.js` directly in a terminal waits for MCP messages.

Downloading the `.tgz` package does not install the `inheriti-mcp` command. In PowerShell, from the download folder, run `npm.cmd install --global ".\safetech-inheriti-mcp-<version>.tgz"`. Verify it with `inheriti-mcp --version` and `where.exe inheriti-mcp`.

Call `list_organizations` to open browser sign-in and see the available organizations, then `select_organization` if needed. `list_backup_plans` shows plan metadata.

## Control your organisation

Owners and Managers can ask their MCP client to review the organisation they selected. The API applies their Business permissions to every request, and plan results still follow each plan's access rules.

Examples to ask your assistant:

- “Show the active members and their roles in my selected organisation.” Uses `list_organization_members`, with `limit` and `offset` to page through results.
- “What changed this week, and who was responsible?” Uses `list_organization_audit_trail` with explicit ISO `from` and `to` dates. `category`, `memberId` and `responsibleMemberId` can narrow the review.
- “Compare plan activity in October and tell me how many approvals are pending now.” Uses `get_organization_insights` with `from` and `to`; the range applies to charts and results, while current totals and named monthly or 30-day statistics retain their own windows.
- “Who is declared as owner or moderator on this plan?” Uses `get_plan_responsibilities` with a plan ID from `list_backup_plans`. These are declared relationships, not a calculation of effective access.
- “Find active plans whose names start with ‘Payroll’ and that contain documents.” Uses `list_backup_plans` with `status`, `namePrefix` and `assetType`; continue with `nextCursor` where present.

The audit trail returns presented event metadata. It does not return raw event data or protected plan values.

For example, after selecting an organisation, an assistant can call `list_organization_audit_trail` with `{ "from": "2026-10-01T00:00:00.000Z", "to": "2026-10-31T23:59:59.999Z", "limit": 50 }`, then follow `nextCursor` for the next page. It can call `list_backup_plans` with `{ "status": ["PROTECTED"], "namePrefix": "Payroll", "assetType": "DOCUMENT" }` and pass one returned plan ID to `get_plan_responsibilities`.

<!-- Plan creation and reveal tools remain disabled in MCP for all deployments; keep source for future review. -->

<!-- Plan creation, protected `.inheriti` copies, Inheriti Workspace, and automation tools are currently unavailable in local, dev, stg, and prod builds. -->
