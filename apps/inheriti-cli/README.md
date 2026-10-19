# Inheriti CLI

Inheriti CLI brings Inheriti Business plan workflows to the terminal. You can sign in, select an organisation, inspect plans, request access to protected fields, download authorized assets, and deliver secrets to a command.

Run `inheriti help` to explore commands. See the [runtime integrations](../../integrations/README.md) for examples that use the CLI in automation and cloud environments.

For a member's unified Business activity, run `inheriti members logs MEMBER_ID --json` after selecting an organisation. Add `--source AUTOMATION` or `--source MEMBER` to filter the same log stream shown in Business; `--from YYYY-MM-DD`, `--to YYYY-MM-DD`, `--limit`, and `--offset` are also available. The Business API decides which members and events your account may read.

Plan creation, protected `.inheriti` copies, Inheriti Workspace, and automation commands are currently unavailable in local, dev, stg, and prod builds.
