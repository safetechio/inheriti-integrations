# GitHub project inspection and pairing workflow

Use this only for a selected GitHub Actions automation. Keep the selected Business deployment, GitHub repository, workflow file/ref, and job environment explicit throughout inspection, connection creation, pairing, and protected execution.

## Inspect the selected project

1. Confirm which local checkout the user means. Read its git root, current branch and status, remote **names**, and a sanitized repository identity. Do not print raw remote URLs: they can contain credentials. Compare the identity with the GitHub repository the user selected; do not infer intent from the current directory or a single checkout.
2. For the selected app, inspect package manifests, lockfiles, declared scripts and runtime engines, Dockerfile or deployment configuration, and `.github/workflows` files. In a monorepo, trace the actual app path and working directory. Inspect text without executing package scripts. Never read `.env` files, credential stores, secret values, workflow logs containing values, or full unfiltered provider metadata.
3. Trace the command that will consume protected values and the required environment variable **names** from source, schema, or safe documentation. Compare these with safe plan field selectors and the existing workflow's trigger, environment, permissions, install steps, and run command. Ask only for technical choices still unresolved, such as a target workflow, environment, mapping, or command when no reliable source establishes it.

## Initial pairing workflow

This is a complete pairing-only workflow shape for a **new** file. A request to prepare it authorizes a reversible local draft; make and review that draft without asking again. Keep unresolved placeholders in a clearly marked proposal outside active `.github/workflows`. Resolve every angle-bracket placeholder from inspected, non-secret metadata before saving an executable workflow there. The selected workflow path and branch must exactly match the connection trust; its job environment must match the trusted GitHub environment. Use the same CLI package and deployment verified for this Business instance. Inspect the selected CLI package's `engines.node`, then choose a compatible Node version; do not guess either version. If the project already has a compatible Node setup, reuse it. Otherwise use a reviewed, pinned `actions/setup-node` commit SHA; resolve the placeholder to that exact SHA before writing. Choose a runner that can reach the selected Business deployment.

```yaml
name: Pair Inheriti automation identity
on:
  workflow_dispatch:
permissions:
  id-token: write
jobs:
  pair-inheriti:
    runs-on: <selected-runner>
    environment: <selected-github-environment>
    steps:
      - uses: actions/setup-node@<reviewed-setup-node-commit-sha>
        with:
          node-version: '<node-version-compatible-with-verified-cli-engines.node>'
      - name: Install verified Inheriti CLI
        run: npm install --global --engine-strict '@safetech/inheriti-cli@<exact-verified-published-version>'
      - name: Redeem GitHub workload identity
        env:
          INHERITI_AUTOMATION_CONNECTION_ID: <selected-connection-id>
          INHERITI_AUTOMATION_AUDIENCE: <expected-audience-returned-by-cli>
        run: inheriti automations pair redeem
```

The connection ID and audience are setup metadata, not credentials. Never put an OIDC token, plan value, identity proof, or secret in YAML, command arguments, chat, logs, or outputs. The CLI install must use the verified release for the chosen deployment; if no published verified release is available, stop and report that gate. For local Business, the hosted runner cannot normally reach `localhost`, and there is no verified local GitHub release manifest; do not substitute a dev release or bypass deployment locks through API environment overrides.

For an **existing** workflow, prefer a separate pairing job gated by an explicit manual input that defaults off. Never add an unconditional `pair redeem` step to a push, schedule, or normal deployment job: it would rerun after the pairing window is consumed. For example, add `workflow_dispatch.inputs.pair_inheriti` as a boolean with `default: false`, then gate the pairing job with `if: github.event_name == 'workflow_dispatch' && inputs.pair_inheriti`. The corresponding approved dispatch is `gh workflow run FILE --repo OWNER/REPO --ref BRANCH -f pair_inheriti=true`. Preserve all existing triggers and jobs. If the workflow has no `workflow_dispatch`, add it only after checking what its other jobs would do during manual dispatch. If a separate job is impossible, gate each pairing-only step with the same condition and verify the existing job's effective `id-token: write` permission. Keep unrelated environment protections and permissions. Reuse a compatible existing CLI and Node setup only after verifying its version, engine, and Business endpoint. Prepare and review the local diff when requested; show unresolved choices as a proposal outside active workflows until they are resolved.

The workflow must exist on the repository's default branch for GitHub's manual `workflow_dispatch` entry point. Confirm that prerequisite and the selected ref; `gh workflow run FILE --repo OWNER/REPO --ref BRANCH` selects the ref to run after the workflow is available. For an existing combined workflow, use the matching `-f pair_inheriti=true` input shown above. Inspect the full effect of that dispatch on every job before running it; pairing must not unintentionally trigger deployment or other side effects. See [GitHub's manual-run documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow) and [`gh workflow run`](https://cli.github.com/manual/gh_workflow_run). Commit, push, environment approval, and dispatch need authorization for those actions. Start the ten-minute `inheriti automations pair start --connection CONNECTION_ID` window only when the approved job is ready to execute. Record the run ID, inspect its safe status and the connection's verification state, and poll when pending; do not treat a dispatch or “Waiting” message as proof. Create or activate a plan grant only after the connection is `VERIFIED`.

After pairing, remove only temporary pairing scaffolding introduced for this setup when transitioning to the real workload, unless a gated pairing-only recovery job is intentionally retained. `inheriti automations usage --plan PLAN_ID --connection CONNECTION_ID --field ASSET.FIELD` generates a one-field, non-empty-value smoke test. Inspect the generated Action's supported inputs, then map every required plan field through its `env` input and run the selected application's real consuming command through its protected `run` execution. Prepare that job's own checkout, compatible runtime and dependency installation from the inspected project; setup in the separate pairing job does not carry over. Give checkout `contents: read` alongside the required OIDC permission, and resolve added Action references to reviewed versions before making the proposal executable. Preserve the existing workflow's trigger and deployment behavior. Preview the mapping and target changes before writing or running; never print a protected value to prove it works.
