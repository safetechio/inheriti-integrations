# Configure Business automations with the CLI

This guide covers the local and dev TEST builds. A Business operator configures the connection and a plan editor grants access. The workload later runs the normal reveal: SafeKey Mobile custody, authentication, plan policy, and audit still apply. On dev, install the published CLI with `npm install -g @safetech/inheriti-cli@dev` after the dev package has been released; it points to the deployed Business dev API. The Business UI and API must also be deployed to dev before testing this guide there.

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

The workflow job needs `permissions: id-token: write` and must request the **Expected audience** printed by the CLI. [GitHub documents the `repository`, `environment`, and `workflow_ref` claims](https://docs.github.com/en/actions/reference/security/oidc). The public composite Action does not yet have a verified npm Action+CLI pair, so there is no supported workflow YAML to paste. Do not use a guessed commit, `@main`, or npm's `latest` tag. After a published dev CLI passes a real GitHub/Business dev/SafeKey run, Business will provide the verified pair automatically. The [GitHub Action page](../../../integrations/github-actions/README.md) tracks that release gate.

After the connection is verified and its plan grant is active, generate a workflow with `inheriti automations usage --plan PLAN_ID --connection CONNECTION_ID --field ASSET.FIELD`. The IDs can be selected interactively. Find the nonsecret `ASSET.FIELD` selector in the plan's **Data** tab. The command fetches the verified Action commit and CLI version from Business, fills the plan and connection IDs, and prints a smoke-test YAML plus the exact repository, `.github/workflows/…` file, and branch where it belongs. That location must match the verified connection. It fails if the release is not available or the workflow reference is invalid; until the release is published, no customer workflow is generated. The MCP tool `github_automation_usage` returns the same location and YAML with these three nonsecret inputs; an agent should ask you for the field selector if it cannot see the plan Data tab.

### Google Cloud

Use the service account assigned to the workload, not a personal account. The service account's **numeric unique ID** is the subject; its email address is not accepted. You can retrieve it with `gcloud iam service-accounts describe SERVICE_ACCOUNT_EMAIL --format='value(uniqueId)'`, if your Google account can inspect that service account. Choose an audience base URI for this integration; Business appends the connection ID and the CLI prints the full value.

```bash
read -r -p 'Workload service account email: ' SERVICE_ACCOUNT
read -r -p 'Audience base URI: ' AUDIENCE_BASE
SUBJECT="$(gcloud iam service-accounts describe "$SERVICE_ACCOUNT" --format='value(uniqueId)')"
if test -n "$SUBJECT"; then
  inheriti automations create --name 'Google Cloud deployment' --provider GOOGLE_CLOUD \
    --deployment-environment TEST --audience-base "$AUDIENCE_BASE" --subject "$SUBJECT"
else
  echo 'Service account unique ID unavailable' >&2
fi
```

Request an ID token with the exact audience printed by the CLI. [Google documents service account details](https://cloud.google.com/iam/docs/service-accounts-create) and [`gcloud auth print-identity-token`](https://cloud.google.com/sdk/gcloud/reference/auth/print-identity-token). The served local E2E accepted a Google-signed token using a test service account; native metadata acquisition on Cloud Run/GCE/GKE still needs a workload in Google Cloud.

### AWS ECS

`--role-arn` is the ECS **task role** (`taskRoleArn`) from the task definition, not the execution role. It identifies the workload; static access keys are not setup inputs.

```bash
read -r -p 'ECS task definition name or ARN: ' TASK_DEFINITION
TASK_ROLE="$(aws ecs describe-task-definition --task-definition "$TASK_DEFINITION" --query 'taskDefinition.taskRoleArn' --output text)"
if test -n "$TASK_ROLE" && test "$TASK_ROLE" != None; then
  inheriti automations create --name 'ECS deployment' --provider AWS \
    --deployment-environment TEST --role-arn "$TASK_ROLE"
else
  echo 'Task role unavailable' >&2
fi
```

[AWS documents the task role and `taskRoleArn`](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html). Local tests cover the contract and verifier. Native task-role proof requires an AWS task; this project has no AWS test account or role yet. If you cannot read a task definition, ask an AWS administrator for its task role ARN rather than entering credentials.

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

Run `inheriti automations verify --connection CONNECTION_ID` on the operator's desktop. Only the native window accepts the fresh proof; the CLI does not accept `--proof`. The proof must come from the configured workload. The current initial-verification flow requires a secure manual transfer from that workload; if you cannot make that transfer without logs, leave the connection pending. Closing the window without successful verification is reported as canceled. The private key remains on the runner.

```bash
inheriti automations verify
inheriti automations grant create
inheriti automations grant activate
```

The terminal asks for missing plan, connection, member, and grant IDs. Choose the protected plan and the member accountable for this automation. Creating a grant leaves it pending; activate it after reviewing those choices. A user without plan edit permission must ask a plan editor to do this step. `inheriti automations trust` changes nonsecret provider identity settings and requires fresh verification. `inheriti automations grant revoke` or `inheriti automations disable` ends access.

## 4. Execute and check the result

Run the CLI **inside the configured workload**, with that connection's ID and the exact audience printed at creation. Select the protected plan and an existing `asset.field` in Business first. The example below prompts for those nonsecret references and injects the selected field as `DEPLOY_VALUE` into the child process; replace the child command with the job that needs it.

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

The child receives only the selected field; normal plan access and SafeKey Mobile custody still run. Review the plan's **Logs** and the organization **Audit trail** in Business. A connection marked `VERIFIED` proves only the initial identity check; it does not prove that a deployed job, Action package, or cloud task has completed the reveal.

The separate local E2E report records a successful public GitHub Action wrapper run with a locally packed CLI, Google-signed identity with a local metadata adapter, mobile custody, plan logs, and audit. These results do not prove the published dev CLI and deployed Business API work together. The Google metadata adapter is test equipment.
