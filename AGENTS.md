# Inheriti Integrations

This repository owns the Inheriti CLI, MCP server, and their shared Core. Follow the instructions in any more specific `AGENTS.md` for the app you change.

## Mandatory integration into dev

Every branch created with changes MUST have its intended changes merged into `dev` before the task is considered complete. Do not leave completed work only on a feature, fix, or release branch. Verify that the changes are present in `dev`, including squash or cherry-pick integrations, and preserve newer fixes and the latest SDK versions when resolving conflicts. Return the primary checkout to `dev` and report its final dirty state. Merging locally does not authorize a push, publication, workflow dispatch, or deployment.

## Latest SDK versions

Before merging branches or producing any build, query `npm view @safetech/inheriti-client-sdk dist-tags.latest` and `npm view @safetech/inheriti-core-sdk dist-tags.latest`. Always use those latest published stable versions, not older pins from a feature/release branch or the npm `dev` tag. Keep all consumer manifests, workspace overrides, `pnpm-lock.yaml`, installed SDKs, and `scripts/assert-registry-sdk.mjs` aligned, then run `pnpm sdk:assert:registry` and the affected checks. Resolve SDK compatibility changes before completing the merge or build; never silently retain an older version.

## Keep the CLI agent skill aligned

For every CLI change, assess whether the bundled agent skill at `apps/inheriti-cli/skill/inheriti-cli/SKILL.md` or its `references/` must change. Check command names and options, output and errors, sign-in and organisation selection, plan creation and reveal governance, secret delivery, automation workflows, and installation or update behavior.

When a user-facing CLI behavior changes, update the relevant skill reference and examples in the same change. Verify that the CLI package includes the skill and that its version or content manifest matches the shipped files. Review affected skill guidance against CLI help, tests, and Business UI automation examples. Changes with no effect on an agent's CLI workflow need no skill edit; state that assessment in the change summary.

## Keep verified CLI release manifests aligned

Every CLI publication must update the matching manifest in `integrations/github-actions/`: `verified-dev-release.json` for dev, `verified-stg-release.json` for stg, and `verified-release.json` for prod. Update only the published environment. Pin the exact published npm version and the tested 40-character GitHub Action commit SHA; never use moving tags or invent verification evidence. Follow the verification requirements in `integrations/github-actions/README.md` and the release workflow in the private Client SDK repository.

The Business API reads these files from this repository's `main` branch. A CLI release is incomplete until its validated manifest is pushed to `main`, synchronized into `dev`, and its public raw URL returns HTTP 200 with the expected version and SHA. Record manifest verification separately from npm publication and installer pipeline success.
