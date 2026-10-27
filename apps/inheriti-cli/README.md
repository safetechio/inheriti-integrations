# Inheriti CLI

Inheriti CLI brings Inheriti Business plan workflows to the terminal. You can sign in, select an organisation, inspect plans, request access to protected fields, download authorized assets, and deliver secrets to a command.

Run `inheriti help` to explore commands. See the [runtime integrations](../../integrations/README.md) for examples that use the CLI in automation and cloud environments.

The CLI package includes the [Inheriti agent skill](skill/inheriti-cli/SKILL.md). Installation and updates reconcile it automatically in a detected user-level Codex skills directory; the first CLI run repairs an installation whose package manager skipped lifecycle scripts. A locally modified copy is backed up outside the agent's skill discovery directory before the matching packaged copy is installed. An agent session that already loaded an older skill may need to be restarted to discover the new one. No separate skill marketplace or manual installation command is required. The skill guides the full plan and automation workflow while the CLI and user continue to handle authentication, approvals, and secret delivery.

For a member's unified Business activity, run `inheriti members logs MEMBER_ID --json` after selecting an organisation. Add `--source AUTOMATION` or `--source MEMBER` to filter the same log stream shown in Business; `--from YYYY-MM-DD`, `--to YYYY-MM-DD`, `--limit`, and `--offset` are also available. The Business API decides which members and events your account may read.

Plan creation, protected `.inheriti` copies, and Inheriti Workspace are currently unavailable in local, dev, stg, and prod builds. Automation commands are enabled in local and dev builds and unavailable in stg and prod builds.
