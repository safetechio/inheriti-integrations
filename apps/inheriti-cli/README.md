# Inheriti CLI

Inheriti CLI brings Inheriti Business plan workflows to the terminal. You can sign in, select an organisation, inspect plans, request access to protected fields, download authorized assets, and deliver secrets to a command.

Run `inheriti help` to explore commands. See the [runtime integrations](../../integrations/README.md) for examples that use the CLI in automation and cloud environments.

The CLI package includes the [Inheriti agent skill](skill/inheriti-cli/SKILL.md). Run `inheriti skill install` in a terminal to choose Codex, Claude Code, both, or another skills folder. For scripts use `--target codex|claude|all` or `--directory ABSOLUTE_PATH`. A successful choice is saved beside the CLI configuration and reconciled on later CLI commands and updates. npm postinstall may lack a terminal, so the first interactive command can offer the selector. A locally modified skill is backed up outside the agent's discovery directory. Start a new agent session after installation to load the skill. The CLI and user continue to handle authentication, approvals, and secret delivery.

A custom skills folder needs an existing, writable parent owned by your user on the same filesystem, so the installer can safely stage files and preserve backups beside it.

For a member's unified Business activity, run `inheriti members logs MEMBER_ID --json` after selecting an organisation. Add `--source AUTOMATION` or `--source MEMBER` to filter the same log stream shown in Business; `--from YYYY-MM-DD`, `--to YYYY-MM-DD`, `--limit`, and `--offset` are also available. The Business API decides which members and events your account may read.

Plan creation, protected `.inheriti` copies, and Inheriti Workspace are currently unavailable in local, dev, stg, and prod builds. Automation commands are enabled in local and dev builds and unavailable in stg and prod builds.
