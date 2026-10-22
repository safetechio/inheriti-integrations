# Configure Business automations with the CLI

This guide covers the local and dev TEST builds. A Business operator configures the connection and a plan editor grants access. The workload later runs the normal reveal: SafeKey Mobile custody, authentication, plan policy, and audit still apply. On dev, install the published CLI with `npm install -g @safetech/inheriti-cli@dev` after the dev package has been released; it points to the deployed Business dev API. The Business UI and API must also be deployed to dev before testing this guide there.

## Start here

This walkthrough uses a plan with fields such as `database.username` and `database.password`. These selectors are **not** secret values. Map each field to the environment variable your application already reads, for example `DB_USER=database.username` and `DB_PASSWORD=database.password`. Inheriti supplies the values to the application process when it starts; the values do not belong in the cloud service configuration. Choose real fields from your plan's **Data** tab.

1. [Check Business permissions](#1-check-access-before-collecting-provider-details).
2. Choose where the command will actually run: [GitHub Actions](#github-actions), [Google Cloud Run](#google-cloud-run), [AWS ECS](#aws-ecs), an [AWS EC2 instance](#aws-ec2-instance), or a [custom runner / Ansible](#custom-runner-and-ansible). Create a connection for that workload's identity.
3. [Verify the connection and grant it access to a plan](#3-verify-identity-then-grant-plan-access).
4. [Run the provider's example and check the plan logs](#4-execute-and-check-the-result). An approval in SafeKey Mobile may be required by the plan's reveal policy.

`gh` is used in the GitHub example to identify the repository. For Cloud Run and ECS, install and authenticate the provider CLI on your computer; Inheriti calls it to inspect the selected job or service. These operator-side sessions do not replace the identity of the workload that later runs the reveal.

**Before you begin:** GitHub workflow generation is blocked until Business publishes a verified Action/CLI release. Initial identity pairing opens a short-lived window for the configured workload to send its proof directly to Business. If the workload cannot run the CLI during that window, leave the connection pending or use the advanced manual verification flow.

## 1. Check access before collecting provider details

```bash
inheriti login
inheriti organizations list
inheriti organizations use
inheriti automations list
```

Select the organization in the terminal. If `automations list` says you cannot manage automation, stop here and ask an organization settings manager to create the connection. To grant access, you must also be able to edit the protected plan. The Business API checks both permissions again when you save. These commands are available in the local build; the UI hides setup sections when the member lacks the required permission.

No provider API key, private key, password, or identity token belongs in CLI arguments or an agent conversation. The only setup window asks for a short-lived identity proof.

## 2. Create one connection

Pick the provider whose identity the **running workload** will use. `--deployment-environment TEST` selects the Business connection environment; a provider's `--environment` is a separate exact-match identity field. The command prints a connection ID. For GitHub and Google Cloud it also prints the exact audience to request; copy that output into the workload configuration.

### GitHub Actions

**Already have a repository?** Choose the branch, workflow path, and job environment you will use. **Starting new?** [Create the repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository) and choose those values first. The initial pairing job must run in that repository with `id-token: write`; after verification and grant activation, Inheriti can generate the final workflow for the selected plan. The CLI does not create the repository or initial pairing job.

Required data:

| Field | Why it is required | Where to find it |
| --- | --- | --- |
| `--repository` | Binds the connection to one repository. | The `owner/name` portion of its GitHub URL; `gh repo view --json nameWithOwner --jq .nameWithOwner` inside the checkout. |
| `--environment` | Binds it to the job environment. | The job's `environment:` value and repository **Settings → Environments**. The job must use this environment. |
| `--workflow` | Binds it to one workflow file and ref. | `owner/repo/.github/workflows/file.yml@refs/heads/branch`, matching GitHub's `workflow_ref` claim. |

Run from the repository that owns the workflow. This copyable sequence asks only for values that cannot be inferred reliably:

```bash
REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
read -r -p 'GitHub environment used by the job: ' JOB_ENV
read -r -p 'Workflow file, for example deploy.yml: ' WORKFLOW_FILE
read -r -p 'Branch that runs it, for example main: ' BRANCH
inheriti automations create --name "$REPO deployment" --provider GITHUB \
  --deployment-environment TEST --repository "$REPO" --environment "$JOB_ENV" \
  --workflow "$REPO/.github/workflows/$WORKFLOW_FILE@refs/heads/$BRANCH"
```

The workflow job needs `permissions: id-token: write` and must request the **Expected audience** printed by the CLI. [GitHub documents the `repository`, `environment`, and `workflow_ref` claims](https://docs.github.com/en/actions/reference/security/oidc); [Settings → Environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) shows the job environment. The public composite Action does not yet have a verified npm Action+CLI pair, so there is no supported workflow YAML to paste. Do not use a guessed commit, `@main`, or npm's `latest` tag. After a published dev CLI passes a real GitHub/Business dev/SafeKey run, Business will provide the verified pair automatically. The [GitHub Action page](../../../integrations/github-actions/README.md) tracks that release gate.

After the connection is verified and its plan grant is active, generate a workflow with `inheriti automations usage --plan PLAN_ID --connection CONNECTION_ID --field ASSET.FIELD`. The IDs can be selected interactively. Find the nonsecret `ASSET.FIELD` selector in the plan's **Data** tab. The command fetches the verified Action commit and CLI version from Business, fills the plan and connection IDs, and prints a smoke-test YAML plus the exact repository, `.github/workflows/…` file, and branch where it belongs. That location must match the verified connection. It fails if the release is not available or the workflow reference is invalid; until the release is published, no customer workflow is generated. The MCP tool `github_automation_usage` returns the same location and YAML with these three nonsecret inputs; an agent should ask you for the field selector if it cannot see the plan Data tab.

For the first job, run `inheriti automations usage --field database.password` and select the plan and connection when prompted. Paste its YAML into the **exact file and branch printed by the CLI**, commit it, then run that workflow from GitHub's **Actions** tab. The generated `run` command is a smoke check for the injected variable. To use the value in your own job, replace that command with the process that reads the mapped variable; if that process needs repository files, add a checkout step first. Keep the generated Action commit, CLI version, plan ID, connection ID, audience, and field mapping. The job may wait for SafeKey Mobile approval; inspect the [result in Business](#4-execute-and-check-the-result). This step is unavailable until Business serves the verified release.

### Google Cloud Run

Run `inheriti automations runtime install-instructions --container` on your computer and add its printed CLI installation instruction to your application's Dockerfile once. Build and deploy with your usual method. Before pairing, the Cloud Run service needs a ready revision with the CLI in its image, or the Cloud Run job must exist with that image. If the app cannot start without plan values, use a temporary startup command for this first deployment; after pairing and grant activation, configure the Inheriti launcher and redeploy with your usual method.

**Already have a Cloud Run service?** Use its project, region, and name; confirm which service account is attached. It need not be receiving traffic. **Starting new?** [Deploy an initial service](https://docs.cloud.google.com/run/docs/deploying) with the service account and an explicit application startup command. For a scheduled batch process, [create a Cloud Run job](https://docs.cloud.google.com/run/docs/create-jobs) with a service account and use `--job` instead of `--service`.

The attached service account is the workload identity. Choose a stable, nonsecret audience base URI under a domain your organisation controls, then sign in to Google Cloud locally with the normal Google Cloud CLI. Inheriti inspects the existing service or job and resolves the service account's numeric unique ID automatically; you do not need to copy it from IAM or run a separate `gcloud` command.

```bash
read -r -p 'Cloud Run project: ' PROJECT
read -r -p 'Cloud Run region: ' REGION
read -r -p 'Cloud Run service: ' SERVICE
read -r -p 'Audience base URI: ' AUDIENCE_BASE
inheriti automations create --name 'Cloud Run application' --provider GOOGLE_CLOUD \
  --deployment-environment TEST --audience-base "$AUDIENCE_BASE" \
  --project "$PROJECT" --region "$REGION" --service "$SERVICE"
```

The CLI prints the connection ID and exact expected audience. It does not create or edit the Cloud Run service. A Google account with permission to read the service and its service account is required. [Cloud Run service identity](https://cloud.google.com/run/docs/securing/service-identity) explains the identity attached to the workload.

### AWS ECS

This path covers ECS services on **Fargate and EC2 capacity**. Both use the same task role, task definition, and service update mechanism.

Run `inheriti automations runtime install-instructions --container` on your computer and add its printed CLI installation instruction to your application's Dockerfile once. Build and deploy the application with your usual method. The ECS service must have a healthy running task whose image contains the CLI before pairing. If the app cannot start without plan values, use a temporary startup command for this first deployment; after pairing and grant activation, configure the Inheriti launcher and redeploy with your usual method.

**Already have an ECS service?** Use its region, cluster, and name; confirm that its task definition has a **task role**, separate from the execution role. **Starting new?** [Register a task definition](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/create-task-definition.html) with that role and an explicit application entry point, then [create the service](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/create-service-console-v2.html) in a cluster.

Sign in to AWS locally once with your usual AWS CLI profile or SSO session. Inheriti inspects the existing service and resolves its `taskRoleArn` automatically; you do not need to copy the ARN or run a separate `aws` command. A task definition ARN may be used instead of `--service` for a standalone task; keep `--cluster` for the target context.

```bash
read -r -p 'ECS region: ' REGION
read -r -p 'ECS cluster: ' CLUSTER
read -r -p 'ECS service: ' SERVICE
inheriti automations create --name 'ECS task' --provider AWS \
  --deployment-environment TEST --region "$REGION" \
  --cluster "$CLUSTER" --service "$SERVICE"
```

The CLI prints the connection ID. It reads the **task role**, never the execution role or an access key, and does not create or edit the ECS service. The AWS session needs permission to inspect the service and task definition. [AWS task roles](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html) describes the distinction.

### AWS EC2 instance

For an application running directly on an EC2 instance, attach an instance profile with the intended IAM role first. The operator's AWS CLI needs `ec2:DescribeInstances` and `iam:GetInstanceProfile`; Inheriti reads the actual attached role instead of guessing it from the profile name.

From your computer, install the same published **Inheriti® CLI** version on the EC2 instance through AWS Systems Manager, before pairing:

```bash
inheriti automations runtime install ec2 --region REGION --instance i-INSTANCE_ID
```

The instance must be online in SSM and able to reach the npm registry. On Amazon Linux 2023, the command checks Node.js and npm and installs a compatible runtime from the instance's DNF repositories if either is missing or Node.js is too old. It uses the CLI package's Node.js requirement, without a fixed version in the installer. If an older Node.js is already active, Inheriti uses the compatible runtime without changing the instance's default `node`. The instance needs access to those repositories and permission to install packages. Your AWS CLI needs `ssm:DescribeInstanceInformation`, `ssm:SendCommand` and `ssm:GetCommandInvocation`. The command verifies `/usr/local/bin/inheriti` after installation; `setup --install` later checks that the systemd run-as user can execute it.

```bash
inheriti automations create --name 'EC2 application' --provider AWS \
  --deployment-environment TEST --region REGION --instance i-INSTANCE_ID
```

This creates the pending connection. The instance later obtains its own temporary credentials through IMDSv2. It must be able to reach the Business API, and its service user must have access to the installed Inheriti CLI. The CLI does not change the EC2 instance or its application at this step.

For the initial identity check, use the operator's computer. Its AWS CLI needs `ec2:DescribeInstances`, `iam:GetInstanceProfile`, `ssm:DescribeInstanceInformation`, `ssm:SendCommand`, and `ssm:GetCommandInvocation`. The instance must be an online SSM managed Linux instance with the CLI installed at `/usr/local/bin/inheriti` and network access to Business. The wrapper checks the attached role, opens the pairing window, and runs the proof once through Systems Manager:

```bash
inheriti automations pair ec2 --connection CONNECTION_ID --region REGION --instance i-INSTANCE_ID
```

The instance profile supplies the AWS proof; the command sends it directly to Business without printing credentials or remote output. After Business shows the connection as verified, continue with the plan grant and systemd preparation below.

### Custom runner and Ansible

Choose `PORTABLE` when your runner signs its own assertion with Ed25519. Ansible uses the identity of its controller or runner; it is not a separate provider. You need a stable key ID, runner subject, runner environment, and the **public** PEM key. Keep the matching private key on the runner.

```bash
read -r -p 'Public PEM key file: ' PUBLIC_KEY_FILE
read -r -p 'Runner subject: ' RUNNER_SUBJECT
read -r -p 'Runner environment: ' RUNNER_ENV
inheriti automations create --name 'Custom deployment runner' --provider PORTABLE \
  --deployment-environment TEST --key-id runner-key-1 \
  --public-key "$(cat "$PUBLIC_KEY_FILE")" --subject "$RUNNER_SUBJECT" \
  --environment "$RUNNER_ENV"
```

This command reads only the public key. Its PEM content is an argument, so use this only with a public key file; never substitute a private key file. The local TEST E2E created and verified a Custom runner connection with a fresh signed assertion.

## 3. Verify identity, then grant plan access

The connection created in step 2 is initially pending. The Cloud Run, ECS, and EC2 wrappers below open the ten-minute pairing window themselves. For GitHub, prepare the one-off workload and open the window from the operator's authenticated CLI:

```bash
inheriti automations pair start --connection CONNECTION_ID
```

The image must already contain Inheriti CLI and be able to reach Business. The Cloud Run wrapper reads the selected service or job, creates a temporary job with its pinned image and service account, opens the pairing window, executes it once, and deletes it. It does not change the source workload. It refuses network or volume settings it cannot safely carry over. The ECS wrapper uses the image digest of a healthy running task, registers a temporary task definition with its task role and network settings, then removes it. The EC2 wrapper uses Systems Manager to run the proof with the instance role. Do not use your desktop's `gcloud` or `aws` identity to redeem.

```bash
# Cloud Run service (use --job JOB for an existing Cloud Run job).
inheriti automations pair google --connection CONNECTION_ID --project PROJECT \
  --region REGION --service SERVICE

# ECS Fargate or ECS on EC2: the image must already contain Inheriti CLI.
inheriti automations pair aws --connection CONNECTION_ID --region REGION \
  --cluster CLUSTER --service SERVICE
```

The wrappers set the nonsecret provider and connection settings, including the exact Google Cloud audience. The job/task must run with the configured identity; GitHub Actions uses its native OIDC variables and expected audience without setting the provider variable. The CLI obtains a fresh native proof and sends it directly to Business; the proof never belongs in command arguments, chat, logs, or source control. If the window expires, retry the appropriate pairing command. The normal service is configured in the next section, after verification and grant activation.

After the connection is verified, run these commands on the **operator's desktop** with the same organization selected in step 1. The CLI shows a selector whenever an ID is omitted; it does not automatically choose a plan, connection, member, or grant.

```bash
inheriti automations grant create
inheriti automations grant activate
```

1. **Create the grant:** choose the **protected Business plan** whose data the workload needs, choose that same connection, then choose the **responsible organization member**. This member is accountable for the automation. The CLI prints the new grant ID, and its status remains pending.
2. **Activate:** choose the **same plan**, then the **grant just created**. Review the choices before activation. A plan editor must perform the grant steps if your account lacks plan edit permission. Use `inheriti automations grants PLAN_ID` to inspect the plan's grants and IDs afterward.

The short commands above depend on terminal selectors. If you already know the nonsecret IDs, you can pass them explicitly: `inheriti automations grant create --plan PLAN_ID --connection CONNECTION_ID --member MEMBER_ID`, then `inheriti automations grant activate --plan PLAN_ID --grant GRANT_ID`. Get `PLAN_ID` from Business plan details, `CONNECTION_ID` from step 2 or `inheriti automations list`, `MEMBER_ID` from the organization's members, and `GRANT_ID` from the create output or `inheriti automations grants PLAN_ID`. For workloads unable to run the CLI in a pairing window, `inheriti automations verify --connection CONNECTION_ID` remains an advanced manual fallback requiring an interactive desktop and secure proof transfer.

**Only after verification and activation** can the workload request the plan field. These commands configure Inheriti access; they do not create a GitHub repository, Cloud Run job, ECS task, or provider identity. `inheriti automations trust` changes nonsecret provider identity settings and requires fresh verification. `inheriti automations grant revoke` or `inheriti automations disable` ends access.

To correct a mistake, use `inheriti automations trust --connection ID --provider ...` (MCP: `change_automation_trust`) for the provider identity, or `inheriti automations grant member --plan PLAN_ID --grant GRANT_ID --member MEMBER_ID` (MCP: `replace_automation_responsible_member`) for the responsible member. To stop access for one plan, use `inheriti automations grant revoke --plan PLAN_ID --grant GRANT_ID` (MCP: `revoke_automation_grant`); you can create a fresh grant for the same connection and plan after revocation once the Business API migration is deployed. To stop the connection for every plan, use `inheriti automations disable --connection ID` (MCP: `disable_automation_connection`). Disabling and revoking retain audit history; a disabled connection cannot be reactivated, so create a new one if needed.

### Configure the workload once

After verification and grant activation, `inheriti automations setup` checks the selected plan fields and generates a launcher. Use `--map-all` to select all text fields, `--map-all --except ASSET.FIELD` to leave out some, or repeat `--only ASSET.FIELD` to select a few. Generated environment names come from `ASSET.FIELD`; `--map NAME=ASSET.FIELD` sets a name your app already reads. Keep the application's original startup command explicit in your deployment configuration.

Run this on your computer for either Cloud Run or ECS, then save the printed executable launcher and nonsecret environment settings in your project. Copy the launcher into the image and keep the original application command and arguments. For Cloud Run, set the container command to the launcher, pass the app command as arguments, and retain the service account and expected audience in your deployment configuration. For ECS, set the task entry point to the launcher, pass the app command as the task command, and retain the task role. Deploy with your usual method; every new instance or task requests approved values when it starts. The command does not edit your Dockerfile, deployment configuration, or running workload.

```bash
inheriti automations setup --plan PLAN_ID --connection CONNECTION_ID --map-all
```

The Cloud Run example below shows the optional direct service update with `--apply`. It uses a published image containing the CLI and requires an interactive review for bulk mappings. This does not save the launcher or settings in your project.

To update a Cloud Run service immediately, run one command after publishing its image. The CLI shows the resolved mappings and workload revision, then asks you to confirm the update:

```bash
inheriti automations setup --plan PLAN_ID --map-all \
  --project PROJECT --region REGION --service SERVICE \
  --image ARTIFACT_REGISTRY_IMAGE:TAG --apply
```

The preview shows only the image, identity, revision, and environment variable **names**; existing environment values and startup arguments stay on your computer. For a separate review in an interactive terminal, preview without `--apply` first:

```bash
inheriti automations setup --plan PLAN_ID \
  --map-all --map DB_USER=database.username --map DB_PASSWORD=database.password \
  --project PROJECT --region REGION --service SERVICE
```

The example includes every eligible text field and names the two database variables `DB_USER` and `DB_PASSWORD` to match the application. To omit a field, add `--except ASSET.FIELD`; use a selector that exists in your plan. To include just a few fields, replace `--map-all` with repeated `--only ASSET.FIELD` flags; keep any `--map` name overrides for those selected fields.

Choose the verified connection when prompted, or pass `--connection CONNECTION_ID`. Review the preview's revision and published image, then apply the same command with `--image IMAGE:TAG --expect-revision REVISION --apply`. The CLI resolves a supported registry tag to a digest before applying and reports the pinned image. The revision must be copied from the preview; a changed workload is rejected. Bulk field selection always requires an interactive confirmation; noninteractive automation needs explicit `--map` entries and `--expect-revision`. Cloud Run jobs remain available with `--job JOB` for batch workloads; job execution and scheduling are separate.

`--apply` remains available for an optional immediate ECS update: it registers a new task definition, updates the service, waits for stability, and restores the previous task definition if rollout fails. It does not update your deployment configuration. Each new task or instance starts the application through the launcher, which obtains the current approved field values and injects the mapped variables into that process. A running process keeps its startup values; deploy or restart it to pick up changed values. To prepare a VM or Kubernetes workload, omit the managed target flags: the CLI prints a launcher and nonsecret configuration, but does not install them on the server or cluster. A standalone ECS task definition and a custom runner still need their scheduler or service configured by their owner. Use `inheriti help automations setup` for the exact flags and [AWS ECS task definition permissions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html) or [Cloud Run service permissions](https://docs.cloud.google.com/run/docs/reference/iam/permissions) for the deployment account.

For a **plain EC2 instance**, run the one-time preparation after its AWS connection is verified and its grant is active:

```bash
inheriti automations setup --plan PLAN_ID --connection CONNECTION_ID --map-all \
  --region REGION --instance i-INSTANCE_ID --service-name my-app \
  --run-as-user app --install -- /usr/bin/node /opt/my-app/server.js
```

The CLI checks that the attached instance profile role matches the connection, shows the mappings and target paths, then asks before installing the launcher, run script and `systemd` unit through AWS Systems Manager. **Replace the application command after `--` with the real startup command on the instance; the sample Node path is not discovered by the CLI.** The instance must be an online SSM managed Linux host with the matching CLI already executable at `/usr/local/bin/inheriti`. Setup checks that the executable exists, and checks an absolute script path for common interpreters. Existing target files are not replaced. If the application command was wrong, rerun with `--install --replace` after correcting it; this only updates the run script when the launcher and unit still match and the service is stopped. Setup reloads `systemd` but does not enable or start the service. Review the new unit and disable the old application service before running `sudo systemctl enable --now my-app.service`, so the app does not start twice. Omit `--install` to print the scripts without changing EC2. Each boot or restart then runs `inheriti secrets exec` and waits for the existing Business authorization, Organisation Key and custodian share flow. A running process retains its startup values until restarted.

## 4. Execute and check the result

The configured service runs the CLI **inside its own workload** before starting your application. The protected plan ID comes from Business, the connection ID and expected audience come from `automations create`, and field selectors such as `database.username` and `database.password` come from the plan's **Data** tab. Those are nonsecret references. Configure them in the workload; never put the revealed values in GitHub YAML, Cloud Run environment settings, or an ECS task definition.

The command below is useful on an interactive custom runner. It prompts for nonsecret references and checks that the mapped variable reached the child process without printing it. A headless cloud service uses the setup command above instead of prompts.

```bash
read -r -p 'Protected plan ID: ' PLAN_ID
read -r -p 'Asset.field to inject: ' FIELD_REF
read -r -p 'Automation connection ID: ' INHERITI_AUTOMATION_CONNECTION_ID
export INHERITI_AUTOMATION_CONNECTION_ID
```

Set the provider-specific variables in that same workload before executing the command:

- **GitHub Actions:** The calling job must grant `id-token: write`. The [Action wrapper](../../../integrations/github-actions/README.md) sets the connection ID and audience from its inputs and obtains GitHub's short-lived OIDC token. A supported Action/CLI version pair is still pending publication; do not use the current npm `latest` for this flow.
- **Google Cloud:** Run on a Google workload whose attached service account has the configured numeric subject; the CLI obtains a fresh ID token from its metadata server. Enter the exact audience printed by `automations create`:

  ```bash
  export INHERITI_AUTOMATION_PROVIDER=GOOGLE_CLOUD
  read -r -p 'Expected audience from connection setup: ' INHERITI_AUTOMATION_AUDIENCE
  export INHERITI_AUTOMATION_AUDIENCE
  ```

- **AWS ECS:** Run in the ECS task with the configured task role; the CLI obtains task credentials and signs a fresh challenge. No static access key is needed:

  ```bash
  export INHERITI_AUTOMATION_PROVIDER=AWS
  read -r -p 'AWS region of the task: ' AWS_REGION
  export AWS_REGION
  ```

- **Custom runner/Ansible:** Enter the exact key ID, subject, and environment configured in step 2. The private Ed25519 PEM file must belong to the running user and have owner-only permissions; do not paste its contents into a command:

  ```bash
  export INHERITI_AUTOMATION_PROVIDER=PORTABLE
  read -r -p 'Private key file path on this runner: ' INHERITI_AUTOMATION_PRIVATE_KEY_FILE
  read -r -p 'Configured key ID: ' INHERITI_AUTOMATION_KEY_ID
  read -r -p 'Configured runner subject: ' INHERITI_AUTOMATION_RUNNER_SUBJECT
  read -r -p 'Configured runner environment: ' INHERITI_AUTOMATION_ENVIRONMENT
  export INHERITI_AUTOMATION_PRIVATE_KEY_FILE INHERITI_AUTOMATION_KEY_ID
  export INHERITI_AUTOMATION_RUNNER_SUBJECT INHERITI_AUTOMATION_ENVIRONMENT
  ```

```bash
inheriti secrets exec "$PLAN_ID" --automation --env "DEPLOY_VALUE=$FIELD_REF" -- \
  sh -c 'test -n "$DEPLOY_VALUE"'
```

### Google Cloud Run execution

In your Cloud Run **service or job**, attach the **same service account** whose numeric unique ID was configured in the connection. Install the CLI in the image. Set these **nonsecret** environment values in your deployment configuration:

| Name | Value | Where it comes from |
| --- | --- | --- |
| `INHERITI_AUTOMATION_PROVIDER` | `GOOGLE_CLOUD` | Fixed CLI provider name. |
| `INHERITI_AUTOMATION_CONNECTION_ID` | Connection ID | Output of `automations create` or Business connection details. |
| `INHERITI_AUTOMATION_AUDIENCE` | Exact Expected audience | Output of `automations create` or Business connection details. |

The generated launcher contains the protected plan ID and field selectors; it contains no secret values. [Cloud Run service identity settings](https://cloud.google.com/run/docs/configuring/services/service-identity) explain where to attach the service account. To check the mapping inside a test container without printing either value, use:

```bash
inheriti secrets exec PLAN_ID --automation \
  --env DB_USER=database.username --env DB_PASSWORD=database.password -- \
  sh -c 'test -n "$DB_USER" && test -n "$DB_PASSWORD"'
```

For your application, save the generated launcher as the container command so each new instance starts through `inheriti secrets exec`. Cloud Run must run that process with the attached service account; running the command locally with `gcloud` credentials tests a different identity.

### AWS ECS execution

In your ECS task definition, set the **task role** to the ARN configured in the connection and install the CLI in the image. Set these **nonsecret** container environment values:

| Name | Value | Where it comes from |
| --- | --- | --- |
| `INHERITI_AUTOMATION_PROVIDER` | `AWS` | Fixed CLI provider name. |
| `INHERITI_AUTOMATION_CONNECTION_ID` | Connection ID | Output of `automations create` or Business connection details. |
| `AWS_REGION` | Task's AWS region | ECS task location. |

The generated launcher contains the protected plan ID and field selectors; it contains no secret values. The [ECS task role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html) provides short-lived credentials to the task. The [task definition environment](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/taskdef-envfiles.html) holds only the nonsecret references above. To check the mapping inside a test task without printing either value, use:

```bash
inheriti secrets exec PLAN_ID --automation \
  --env DB_USER=database.username --env DB_PASSWORD=database.password -- \
  sh -c 'test -n "$DB_USER" && test -n "$DB_PASSWORD"'
```

For the real task, configure the generated launcher as the entry point in your deployment configuration so the app receives both variables on every new deployment. The ECS **execution role** or a local AWS login cannot stand in for the configured task role.

### Real application example: PostgreSQL

For either Cloud Run or ECS, suppose `database.password` is the PostgreSQL password in your plan. With `psql` installed in the workload image and the **nonsecret** `DB_HOST`, `DB_USER`, and `DB_NAME` set in its environment, run:

```bash
inheriti secrets exec "$INHERITI_SECRETS_PLAN" --automation \
  --env PGPASSWORD=database.password -- \
  psql "host=$DB_HOST user=$DB_USER dbname=$DB_NAME sslmode=require" -c 'select 1'
```

The CLI reveals the field, starts `psql` with `PGPASSWORD` only in that child process, and exits with its status. The query checks that the credential works without displaying it. Your application can use the same pattern with its own environment variable and process.

The child receives only the selected field; normal plan access and SafeKey Mobile custody still run. Review the plan's **Logs** and the organization **Audit trail** in Business. A successful smoke check means the child received a nonempty value; it does not prove that your application consumed it correctly. A connection marked `VERIFIED` proves only the initial identity check; it does not prove that a deployed job, Action package, or cloud task has completed the reveal.

The separate local E2E report records a successful public GitHub Action wrapper run with a locally packed CLI, Google-signed identity with a local metadata adapter, mobile custody, plan logs, and audit. These results do not prove the published dev CLI and deployed Business API work together. The Google metadata adapter is test equipment.

## Publish plan fields to AWS secrets

Direct runtime access uses `inheriti secrets exec` above. For an application that already reads AWS secrets, an operator can make an optional one-time copy of selected text fields to AWS Secrets Manager as one JSON object, or to SSM Parameter Store as separate `SecureString` parameters. Subsequent reads use AWS IAM. Plan changes or revocation do not update or delete the copy; there is no automatic synchronization or rotation. Publication does not update a running workload.

```bash
inheriti login
inheriti organizations use
inheriti secrets publish aws --plan PLAN_ID --region us-east-1 --account-id 123456789012 \
  --secret app/config --map DATABASE_PASSWORD=database.password
# Review the metadata preview, then repeat the same command with --apply.
```

For SSM, use `--parameter-prefix /app/config` instead of `--secret app/config`. The command creates `/app/config/DATABASE_PASSWORD` for the mapping above. Use repeatable `--map KEY=ASSET.FIELD`, `--only ASSET.FIELD`, or `--map-all`; `--except ASSET.FIELD` works with `--map-all`. Only plan text fields are eligible. Without `--apply`, the CLI inspects target metadata and does not reveal plan values. With `--apply`, the CLI checks the AWS account against `--account-id`, requests the plan's normal master key and custodian share, then writes the selected values. It reports target names and versions, never values. SSM publishes each parameter as a separate reveal action, so an interruption may leave earlier parameters updated.

The AWS credentials available to this CLI need STS `GetCallerIdentity`, plus Secrets Manager `DescribeSecret`, `GetSecretValue` and `UpdateSecretVersionStage` (when updating an existing JSON secret), `CreateSecret`, and `PutSecretValue` for `--secret`; or SSM `DescribeParameters` and `PutParameter` for `--parameter-prefix`. Grant access only to the intended targets and account. A KMS key policy may also need to allow the relevant encryption operations. Existing Secrets Manager JSON keys are retained; service-managed, rotating, replica, binary, and non-JSON secrets are rejected. Review the preview and target permissions before applying. Never put plan values in command arguments, shell history, or logs.

If an apply is interrupted, inspect target versions before retrying. An AWS write already in flight may have completed, and earlier SSM parameters may already be updated.

## Publish plan fields to Google Cloud Secret Manager

For direct Cloud Run startup injection, use the Cloud Run service workflow above with `inheriti secrets exec`. Use this optional one-time copy when an existing application reads Google Cloud Secret Manager. Each selected text field becomes a separate secret named `PREFIX` plus its mapped key. Subsequent reads use Google Cloud IAM. Plan changes or revocation do not update or delete the copy; there is no automatic synchronization or rotation.

Authenticate the CLI host with [Application Default Credentials](https://docs.cloud.google.com/docs/authentication/application-default-credentials). The destination project must have Secret Manager enabled; the host identity needs permission to inspect secrets, create missing secrets, and add versions to the chosen targets. Existing secrets are updated only when they carry the `inheriti_managed=true` label created by this command.

```bash
inheriti login
inheriti organizations use
read -r -p "Google Cloud project ID: " GOOGLE_PROJECT
read -r -p "Secret prefix (for example app_): " SECRET_PREFIX
inheriti secrets publish google --plan PLAN_ID --project "$GOOGLE_PROJECT" \
  --secret-prefix "$SECRET_PREFIX" --map DATABASE_PASSWORD=database.password
# Review the destination preview, then repeat the same command with --apply.
```

Use repeatable `--map KEY=ASSET.FIELD`, `--only ASSET.FIELD`, or `--map-all`. With `--map-all`, `--except ASSET.FIELD` excludes selected fields. Only plan text fields are eligible. Preview inspects target metadata without revealing values. Apply uses the plan's normal master key, custodian share, and governance flow, then adds a [new secret version](https://docs.cloud.google.com/secret-manager/docs/add-secret-version) for each mapped field. Secret values never appear in the CLI result. A partial failure may leave earlier secrets updated; inspect their versions before retrying. The command does not update Cloud Run services or other consumers.
