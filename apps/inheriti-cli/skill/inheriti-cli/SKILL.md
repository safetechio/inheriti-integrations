---
name: inheriti-cli
description: Use the Inheriti CLI to find, create, inspect, reveal, download, or use protected plans and to configure Business automations from a user's natural-language request.
---

# Inheriti CLI

Turn the user's requested outcome into the smallest supported CLI workflow. Check `inheriti version` and `inheriti help` for the installed build; commands vary by Business deployment and feature flags. Read only the reference for the task at hand. The CLI handles sign-in, governance, custody, and progress; the agent supplies non-secret context and interprets safe status.

1. Identify the selected Organisation and resolve a plan name through safe metadata (`plans list`, then `plans show`). Disambiguate matches before an access or change. Ask only for missing non-secret facts.
2. Identify **where** the result is needed: a person's clipboard or file, a local child process, a verified workload, or a persistent provider secret store. Choose the command from that destination, not from an application name. For example, Terraform may run locally or in a workload; inspect its actual execution path before choosing delivery.
3. Preview the exact plan, selected fields, executable, file, workload, mappings, or cloud destination before a consequential action. Let the CLI and user complete its own prompts and approvals. Verify with safe metadata or status; never request a secret value in chat or capture it from clipboard, command output, logs, or a file.

Use [identity and discovery](references/identity-and-discovery.md) for login, Organisation selection, plan lookup, versions, and diagnostics. For plan creation or metadata, read [plans and inspection](references/plans-create-and-inspect.md). For field access, files, and cancellation, read [reveal and files](references/reveal-and-files.md). To run a program with plan fields, read [process delivery](references/process-delivery.md). For connection and grant lifecycle, read [automations](references/automations.md), then the relevant section of [provider workflows](references/automation-providers.md). Read [troubleshooting](references/troubleshooting.md) when a flow fails or pauses.

Do not place secret values, custody shares, proofs, private keys, or bearer tokens in prompts, CLI arguments, shell history, environment setup, provider settings, or agent-visible output. `secrets resolve` is a special trusted-pipe API, not a way for the agent to read a value. Avoid `--output inherit` unless the user explicitly accepts the child program's logs. A natural-language request does not replace a plan's approval or authorise an unrelated deployment.
