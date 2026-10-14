# Inheriti CLI

Inheriti CLI brings Inheriti Business plan workflows to the terminal. You can sign in, select an organisation, inspect plans, request access to protected fields, download authorized assets, and deliver secrets to a command.

Run `inheriti help` to explore commands. See the [runtime integrations](../../integrations/README.md) for examples that use the CLI in automation and cloud environments.

## Automation setup

Use the [step-by-step automation guide](docs/automation-setup.md) for GitHub Actions, Google Cloud, AWS, and a custom runner. It explains each required field, where to find it, the permissions needed, and what has actually been tested. The guide covers the local and dev Business builds; the public GitHub Action still needs a verified Action and published CLI pair before its workflow can be copied into a repository.

The CLI takes nonsecret connection and grant settings as arguments or terminal selections. Only `inheriti automations verify` opens the native window, which asks for the short-lived identity proof. The runner's private key is never requested.

After activating a GitHub plan grant, run `inheriti automations usage --field ASSET.FIELD` to print a smoke-test workflow with the verified Action and CLI versions, plan and connection IDs, and exact repository, file, and branch. Find `ASSET.FIELD` in the plan Data tab; the CLI can prompt for the plan and connection IDs.

## Automation execution

An approved workload uses `inheriti secrets exec PLAN_ID --automation --env NAME=ASSET.FIELD -- EXECUTABLE` with provider identity configured in its environment. This is separate from the human setup session. The CLI delivers authorized fields to the exact child process and suppresses its output by default. The Business API still checks connection and grant status, and the plan's reveal policy still applies.

See the [runtime integration commands and platform wrappers](../../integrations/README.md#automation-execution) for complete examples and local, mock, and provider E2E validation limits.
