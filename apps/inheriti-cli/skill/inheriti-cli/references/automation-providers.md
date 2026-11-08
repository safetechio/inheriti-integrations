# Automation providers and runtime

Read only the section for the workload that will actually execute the protected process. Use `inheriti help automations create`, `pair`, `setup`, and `runtime` for exact options in the installed build. Operator-side `gh`, `gcloud`, or AWS CLI authentication permits discovery and setup; the runtime identity must still be the identity configured on the connection. Discover only in the chosen account/profile and region or project, then pass that same context to the Inheriti® CLI. Offer safe names/IDs when several candidates exist and let the user choose; a single result is not an implicit selection. List and inspect only projected non-secret metadata; never print an unfiltered `describe-*` response or full workload configuration, which may contain environment values. For AWS, keep `AWS_PROFILE=PROFILE AWS_REGION=REGION` identical on every `aws` and `inheriti` subprocess, including preview and installation; for example, `AWS_PROFILE=PROFILE AWS_REGION=REGION inheriti automations setup ...`.

## GitHub Actions

For automatic configuration from the user's repository/project folder, prefer the [automatic setup path](github-workflow.md#automatic-setup-from-the-project-folder). It discovers the repository and installs a dedicated generated workflow; do not ask the user to inspect or edit YAML. Use the detailed inspection below when the request specifically concerns an existing application workflow.

Use repository, GitHub job environment, workflow file, and ref already selected in Business; resolve only missing inputs before binding `automations create --provider GITHUB` to the exact `--repository OWNER/REPO`, `--environment NAME`, and `--workflow OWNER/REPO/.github/workflows/FILE.yml@refs/heads/BRANCH`. For an empty repository, propose a dedicated pairing workflow file and explicit ref instead of assuming one exists. Keep the Business deployment (`local`/`dev`), connection deployment-environment, and GitHub environment distinct; do not infer one from another. The generic `automations create --provider GITHUB` command creates only Inheriti metadata. The automatic `automations setup github` command installs and runs its dedicated pairing workflow; it does not create the repository.

### Resolve missing context

Inspect safe repository/workflow metadata first. If the user points to a local project, first identify its git root, remote names and safe repository identity, branch and status; inspect the selected app's manifests, lockfiles, scripts, Dockerfile, source/schema references to required environment variable **names**, and existing `.github/workflows` files. For a monorepo, identify the app that consumes the protected values and its actual command. Read files as data; do not run package scripts during discovery, read `.env` or secrets, or print credential-bearing remote URLs or workflow values. The current directory or sole checkout is not necessarily the intended project. `gh workflow list --repo OWNER/REPO` can show candidates in the selected repository; confirm the intended environment and ref separately. Follow the [GitHub project inspection and pairing workflow guide](github-workflow.md) for the concrete inspection and initial job.

Ask only questions not already answered by Business, the user, or verified metadata:

- “Which repository and workflow/job needs access to this plan?” Present discovered candidates when available.
- “Which GitHub environment and branch should be allowed?” Explain that these identify the trusted workload, rather than choosing `production` or `main` by default.
- “Which plan fields does that job need, and which variable names does the application expect?” Resolve field selectors from safe plan metadata; never ask for their values.
- “Should this run manually, on a schedule, or as part of the existing deployment?” Ask only when a trigger or execution step must be added; preserve an existing trigger unless a change is requested.
- Ask for the responsible member only when absent or rejected by Business. Do not ask again for a supplied plan or connection.

### First connection and pairing

1. Inspect existing connections and plan grants as described in [automations](automations.md). For a new connection, preview the exact repository/environment/workflow/ref and create it only within the requested scope. Retain the returned connection ID and expected audience as non-secret setup metadata.
2. Prepare a pairing job in that exact workflow file/ref, with the configured job `environment`, `id-token: write`, and an installed CLI targeting the same Business deployment. Use the [initial pairing workflow template](github-workflow.md#initial-pairing-workflow) and a verified published CLI version; do not guess a package version or fall back to another deployment when unavailable. In an existing workflow, gate pairing behind an explicit manual input that defaults off; normal push or deployment runs must not redeem again. A request to prepare the workflow authorizes a reversible local draft and its review, so make it without asking again. Keep unresolved placeholders in a clearly marked proposal outside active `.github/workflows` and resolve them before saving an executable workflow. Commit, push, dispatch, and deployment each require authorization covering that action.
3. The job's run step redeems identity directly from GitHub Actions. Set these non-secret job variables from the selected connection and use the existing CLI command:

   ```sh
   # Inside the configured GitHub Actions job, after installing the matching CLI.
   export INHERITI_AUTOMATION_CONNECTION_ID="<connection-id>"
   export INHERITI_AUTOMATION_AUDIENCE="<expected-audience-returned-by-cli>"
   inheriti automations pair redeem
   ```

   Never retrieve an OIDC token for the agent or paste one into `automations verify`. Running `pair redeem` in the operator's local terminal does not prove the GitHub workload identity.
4. Once the job is ready to execute, inspect the full effect of its manual dispatch on all jobs, then run `inheriti automations pair start --connection CONNECTION_ID` on the operator side and execute the approved pairing job within the returned ten-minute window. `pair start` returns after opening the window; its “Waiting” message is not confirmation of verification. If a push or dispatch is still awaiting authorization, report that prerequisite rather than repeatedly opening windows.
5. Inspect the connection for `VERIFIED`. Only then create and activate the chosen plan grant with the selected responsible member, subject to Business permissions and CLI approvals. Do not claim that successful pairing also activated a plan grant.

### Generate and integrate the actual workload

After verification and an active grant:

```sh
inheriti automations usage --plan PLAN_ID --connection CONNECTION_ID --field ASSET.FIELD
```

This emits YAML pinned to a Business-verified Action and CLI release; it refuses when that release is unavailable. Follow its printed repository/path/branch. It is a starting example with a manual trigger and a non-empty-value check, not the user's deployment command. Preview how the selected field maps to the application's variable and how the real consuming command runs through the Action's protected execution; do not introduce an `echo`, output, artifact, or chat-visible secret check. This command accepts one `--field`; do not invent repeatable flags for additional mappings. Inspect the generated Action contract before adapting it.

If the workflow already exists, merge the required job or steps without replacing existing jobs, triggers, permissions, environment protections, or deployment logic. Check effective job permissions: an existing job-level permissions block must still allow the required OIDC permission. Changing the job environment, file/ref, or repository can invalidate trust; inspect the connection before proposing a trust change, and reverify when required. Remove only pairing scaffolding introduced for this setup when it is no longer needed and its removal is in scope.

Execute only the authorized run and inspect its safe status plus plan/member logs. Report connection verification, grant activation, workflow preparation, and actual execution separately. Generated YAML, a successful pairing run, or a passing example value check does not prove the user's application deployment succeeded.

### Reuse example

User: “Use the Enterprise Safe plan in the existing deploy job in acme/payments. Business supplied connection C and member M.” Inspect C's GitHub trust and the plan grant. If its repository, environment, and workflow/ref match and C is verified, retain C, skip connection creation and pairing, and reuse an active matching grant. If the grant is missing, preview creating/activating it for M; do not silently replace a grant's responsible member. Inspect the deploy job, resolve only missing field mappings, generate usage with C explicitly, and preview the smallest workflow diff. If the actual job differs from C's trust, explain the mismatch and ask which target is intended instead of silently rebinding C.

### Pairing and run recovery

- Expired pairing window: inspect connection status and the specific run first. If still unverified and the same workload is intended, open one fresh window when the job can run and obtain fresh proof through `pair redeem`; never reuse a token or create a replacement connection merely for expiry.
- Identity/audience mismatch: compare the configured repository, job environment, workflow/ref, and expected audience with safe metadata from that run. Correct the selected setup or ask about conflicting intent; do not broaden trust or remove environment protections to pass verification.
- Missing `id-token: write`, CLI installation, GitHub access, or environment approval: identify that prerequisite and who must act. An environment waiting for approval is pending, not a pairing failure. Retry only after the prerequisite is resolved; refresh an expired window then.
- Run timeout or missing completion: inspect the returned run ID before dispatching another run. Report pending or unconfirmed when appropriate. Do not rerun a deployment just to check whether it succeeded.
- Inactive/rejected grant or unavailable verified release: stop at that gate and report the safe reason. Do not switch account, member, deployment, or package version silently.

## Google Cloud Run service or job

In the chosen project and region, identify the intended Cloud Run service or job, then bind `--provider GOOGLE_CLOUD` to a stable non-secret `--audience-base URI`, `--project`, `--region`, and one of `--service` or `--job`. The CLI can inspect the attached service account numeric ID with the local Google Cloud CLI; the service/job must exist. The runtime image needs the Inheriti® CLI before pairing. `automations pair google` launches a temporary job with the source identity after checking the generation and image. After grant activation, `automations setup` needs the application's explicit startup configuration and previews the selected service/job and field mappings; `--apply` updates that exact workload with a reviewed image/revision. Choose `--container` if more than one container exists. A pairable workload may still need startup configuration before setup. It does not create a Cloud Run resource.

For discovery, use `gcloud run services list --project PROJECT --region REGION` or `gcloud run jobs list --project PROJECT --region REGION`; confirm the active account and configuration, and avoid full workload JSON that may contain environment values.

## AWS ECS

In the chosen AWS account/profile and region, identify the intended ECS cluster and service or task definition, then bind `--provider AWS` to `--region`, `--cluster`, and an existing `--service` or `--task-definition`. Use the **task role**, never `executionRoleArn`; the CLI can resolve the role from the existing workload. For multiple containers, choose `--container`. The image must include the CLI. `automations pair aws` can run a temporary ECS task, pinning the inspected task definition and image digest; it does not change the service. After an active grant, `automations setup` previews the runtime update and requires an actual service and explicit `--apply` with a reviewed image/revision to change the ECS service. A lone task definition can be paired but has no managed service to update.

Confirm the chosen identity with `AWS_PROFILE=PROFILE aws sts get-caller-identity`; discover within its region with `AWS_PROFILE=PROFILE aws ecs list-clusters --region REGION`, then `AWS_PROFILE=PROFILE aws ecs list-services --cluster CLUSTER --region REGION`. Do not disable pagination; inspect only non-secret fields of a chosen service/task definition. Use the identical subprocess-scoped environment for identity, discovery, and Inheriti® CLI, with `AWS_PROFILE=PROFILE` and the same region. Exported session credentials can override that profile: verify the returned Account/Arn matches the intended account and stop on a mismatch; do not silently switch or clear credentials. Do not mix discovery using `aws --profile` with Inheriti® CLI using only `AWS_PROFILE`, because their credential precedence differs.

## AWS EC2

For an application directly on an instance, identify the intended region and instance, and verify its attached instance-profile role matches the connection identity. Bind the connection to `--region` and `--instance`; the attached instance-profile role is the identity. `automations runtime install ec2 --region REGION --instance INSTANCE_ID` uses SSM to install and verify the exact published CLI version on an online Linux instance. Confirm instance, region, and version before remote installation. `automations pair ec2` uses SSM for `pair redeem` and checks the attached role. Before remote actions, check that the instance is Linux and online in SSM. `automations setup` requires the actual `--service-name NAME --run-as-user USER -- APP_COMMAND [ARGS...]`; resolve these with the operator. It previews the launcher and systemd unit; `--install` writes them after confirmation but does not start the service. Do not mistake an EC2 instance for an ECS service.

Verify AWS identity in that same subprocess context as above. For candidate IDs in the selected context, use `AWS_PROFILE=PROFILE aws ec2 describe-instances --region REGION --query 'Reservations[].Instances[].[InstanceId,Tags[?Key==`Name`].Value|[0]]' --output table`; inspect the selected instance's role, platform, and SSM status before a remote action. A safe instance inspection is `AWS_PROFILE=PROFILE AWS_REGION=REGION aws ec2 describe-instances --instance-ids INSTANCE_ID --query 'Reservations[].Instances[].{Id:InstanceId,State:State.Name,ProfileArn:IamInstanceProfile.Arn,Platform:PlatformDetails}' --output json`; apply similarly narrow projections for role/SSM metadata.

## Portable runner

`--provider PORTABLE` binds a key ID, **public** key, subject, and environment to a runner configured separately. Ask for missing non-secret public-key metadata only. Keep its private key in that workload, never an agent prompt or CLI argument. Pair from the workload, activate a grant, then use `automations setup` to print or save the launcher. The CLI does not provision the runner.

## Image and installation preparation

`automations runtime install-instructions --container` prints Dockerfile guidance; without `--container`, an interactive user chooses host/container guidance. `automations runtime image --image ECR_OR_ARTIFACT_REGISTRY_TAG` previews the image operation; `--build` builds and verifies an image containing this CLI version; `--publish` also pushes it and reports an immutable digest. Inspect source context, Dockerfile, registry, tag, and destination before build/publish. Docker and registry sign-in are separate prerequisites. An image build/push does not deploy the workload; use the separate managed `automations setup --apply` flow only when the user requested that change.
