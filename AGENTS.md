# Inheriti Integrations

This repository owns the Inheriti CLI, MCP server, and their shared Core. Follow the instructions in any more specific `AGENTS.md` for the app you change.

## Keep the CLI agent skill aligned

For every CLI change, assess whether the bundled agent skill at `apps/inheriti-cli/skill/inheriti-cli/SKILL.md` or its `references/` must change. Check command names and options, output and errors, sign-in and organisation selection, plan creation and reveal governance, secret delivery, automation workflows, and installation or update behavior.

When a user-facing CLI behavior changes, update the relevant skill reference and examples in the same change. Verify that the CLI package includes the skill and that its version or content manifest matches the shipped files. Review affected skill guidance against CLI help, tests, and Business UI automation examples. Changes with no effect on an agent's CLI workflow need no skill edit; state that assessment in the change summary.
