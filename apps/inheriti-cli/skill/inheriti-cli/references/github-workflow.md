# GitHub project inspection and pairing workflow

Use this only for a selected GitHub Actions automation. Carry forward any organisation, plan, field, responsible member, repository, workflow/ref, and job environment already selected in Business or supplied by the user; do not ask for them again. Keep the selected Business deployment and connection environment distinct from the GitHub job environment throughout inspection, connection creation, pairing, and protected execution.

## Automatic setup from the project folder

When the user identifies their current repository/project folder, derive its GitHub identity with the CLI; do not ask them to inspect workflows or type the repository name. Keep all selected toolbar values and follow the same separate stages as the manual guide:

1. `inheriti automations create github --organization ORGANISATION_ID` creates or reuses the **Inheriti connection** only. Optional `--environment` and `--workflow` set the identity; defaults are `inheriti` and `inheriti.yml`. No plan or member belongs to connection creation. Reuse an explicitly selected existing active connection; a disabled match remains disabled, so a fresh connection is created.
2. `inheriti automations setup github --organization ORGANISATION_ID --connection CONNECTION_ID --plan PLAN_ID --field ASSET.FIELD` prepares technical setup from the connection's stored trust. It previews by default; authorised `--apply` commits the dedicated workflow and verifies identity through GitHub. It never creates a connection or grants plan access. The generated workflow's narrow push trigger registers it in Actions; both jobs are gated to manual dispatch, so that registration run is skipped. The commit can also trigger other existing push workflows in the repository. Pairing starts only through the separate explicit manual dispatch. No manual YAML preparation is needed.

   During `--apply`, an interactive terminal shows the current setup step, elapsed time, and a GitHub run link once available. Redirected output shows one plain line per step. If pairing remains pending, rerun the same command to resume the saved attempt; do not dispatch a second job manually.
3. After `VERIFIED`, use the separate `automations grant create --organization ORGANISATION_ID` and `grant activate --organization ORGANISATION_ID` commands with the selected plan, connection and responsible member. Preserve the same grant ID on retries: create succeeds again only when that exact ID, connection and member already have a `PENDING_VERIFICATION` or `ACTIVE` grant; activation succeeds again only when that exact grant is `ACTIVE`. Conflicting grants still need review. Let Business validate eligibility.
4. Only after access is active, the generated workflow can run normally. The protected plan's usual SafeKey Mobile approval may still be required during that run. Do not dispatch protected usage merely to prove setup. Resolve its filename from the selected connection's trust, not unrelated creation-field state.

An unrelated existing file, mismatched connection, missing verified release/permission or expired pairing stops the relevant stage; do not invent success or expand publication scope. Use the detailed steps below only when adapting an existing application workflow or troubleshooting. Do that inspection yourself rather than delegating file inspection or YAML editing back to the user.

Before either automatic GitHub command mutates state, the CLI checks that `gh` is installed and authenticated. A classic GitHub OAuth token needs the `workflow` scope to write `.github/workflows/`; when the CLI reports it missing, run `gh auth refresh -h github.com -s workflow`. Fine-grained tokens may not expose the classic scopes header; the CLI checks actual repository access separately. Never request a token value in chat.

For a channel-locked **DEV** CLI with a protected local `github-dev-cli.json` profile, setup can use a local packaged CLI artifact while the Business-verified public Action/CLI release is unavailable. The profile is prepared by the supervised local harness at the CLI state root and points to a dev-marked `.tgz`, local upload API, and HTTPS download origin. Do not ask for its token, signed URL, or tarball contents in chat. Preview validates it without upload. `--apply` uploads the package, stores the short-lived signed download URL as a GitHub Actions secret through stdin, and generates a workflow pinned to the artifact version and SHA-256 for both pairing and normal usage. A later setup run refreshes the URL; it can replace only an untouched generated DEV workflow. This path does not publish npm packages, replace an arbitrary workflow, or bypass the release gate for local, staging, or production builds.

## Inspect the selected project

1. If a repository is selected, confirm its local checkout if one exists. Read its git root, current branch and status, remote **names**, and a sanitized repository identity. Do not print raw remote URLs: they can contain credentials. Compare the identity with the selected GitHub repository; do not infer intent from the current directory or a single checkout. For a new or empty repository, propose a dedicated `.github/workflows/inheriti.yml` file and explicit job environment and ref; do not pretend an existing workflow was found.
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
