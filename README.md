# Inheriti Integrations

Source for the Inheriti CLI, MCP server, VS Code extension, InheritiGuard Chrome
extension, and runtime integrations.

The CLI reuses plan master keys across commands through the SDK's `KeyVault` port,
backed by the operating system's credential store. Keys are scoped to the deployment,
local state path, signed-in account, login session and key reference. Token refresh
preserves them; logout and a new login clear them. Keys are never written to
`session.json`. If the credential store is unavailable, reveals use an in-memory
cache for the current command and report that subsequent commands will request the
key again. Clearing failures are reported rather than silently ignored.

Run `inheriti setup` after installation to enable shell autocomplete; Yes is selected
by default and the wizard shows the file it will update. Use `--yes` for explicit
noninteractive installation, `--no-completion` to skip, or `--shell bash|zsh|fish`
to select a shell. Setup requires no configuration or sign-in. Package installation
only prints this setup notice and never edits shell files. Open a new shell after setup.

For manual setup, Bash uses `source <(inheriti completion bash)`, Zsh uses
`source <(inheriti completion zsh)` after `compinit`, and Fish uses
`inheriti completion fish > ~/.config/fish/completions/inheriti.fish`.

Start MCP with `inheriti-mcp --enable-secure-delivery` to enable field reveals and asset
downloads through one-time local browser pages. Secret values, bytes, and delivery
URLs never appear in tool results. Plan metadata includes asset codes and field
names for selector discovery. Use `reveal_plan_secret` with `selector` for one
field, `selectors` and optional `assets` for a selection, or `all: true` for all
fields and downloadable files. A batch uses one plan-access flow and one secure
browser page; every selected field and file still uses the SDK’s action checks
and audit reporting. File downloads remain separate buttons on that page.

MCP keeps authentication and acquired master keys in memory for the current
session and selected organization. Use `logout` to cancel local work and forget
held keys, or `abort_plan_access` to abandon an interrupted server access before
retrying. Cancellation failures remain visible; a pending SafeKey Mobile key
release may need to expire before retrying. Development builds reject LIVE
configuration.
