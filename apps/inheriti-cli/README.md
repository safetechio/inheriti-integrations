# Inheriti CLI

Inheriti CLI brings Inheriti Business plan workflows to the terminal. You can sign in, select an organisation, inspect plans, request access to protected fields, download authorized assets, and deliver secrets to a command.

Run `inheriti help` to explore commands. See the [runtime integrations](../../integrations/README.md) for examples that use the CLI in automation and cloud environments.

For a member's unified Business activity, run `inheriti members logs MEMBER_ID --json` after selecting an organisation. Add `--source AUTOMATION` or `--source MEMBER` to filter the same log stream shown in Business; `--from YYYY-MM-DD`, `--to YYYY-MM-DD`, `--limit`, and `--offset` are also available. The Business API decides which members and events your account may read.

## Automation setup

Start with the [automation guide](docs/automation-setup.md#start-here). Choose the workload that will receive a protected plan field:

| Workload | First example |
| --- | --- |
| GitHub Actions | [Inject a field into a workflow job](docs/automation-setup.md#github-actions) |
| Google Cloud Run | [Inject plan fields into a job or service](docs/automation-setup.md#google-cloud-run) |
| AWS ECS | [Inject plan fields into a service process](docs/automation-setup.md#aws-ecs) |
| Custom runner / Ansible | [Use a signed runner identity](docs/automation-setup.md#custom-runner-and-ansible) |

Each route explains the required values, where to find them, the shared [verification and plan access](docs/automation-setup.md#3-verify-identity-then-grant-plan-access) steps, and how to run the job. The guide covers local and dev Business builds. GitHub's generated workflow requires a verified published Action and CLI pair; until that release exists, the CLI cannot print customer YAML.

The CLI takes nonsecret connection and grant settings as arguments or terminal selections. Only `inheriti automations verify` opens the native window, which asks for the short-lived identity proof. The runner's private key is never requested.

For an existing Cloud Run job or ECS service, `inheriti automations create` reads the workload identity through your authenticated provider CLI. You supply the target name, not a copied service account ID or task role ARN. After verification and plan grant activation, `inheriti automations setup` prints a safe preview. With a prepared immutable image containing the Inheriti CLI, `--apply` updates the selected job or ECS service. See the [setup guide](docs/automation-setup.md#configure-the-workload-once) for the image prerequisite and revision check.

After activating a GitHub plan grant, run `inheriti automations usage --field ASSET.FIELD` to print a smoke-test workflow with the verified Action and CLI versions, plan and connection IDs, and exact repository, file, and branch. Find `ASSET.FIELD` in the plan Data tab; the CLI can prompt for the plan and connection IDs.

## Automation execution

An approved workload uses `inheriti secrets exec PLAN_ID --automation --env NAME=ASSET.FIELD -- EXECUTABLE` with provider identity configured in its environment. This is separate from the human setup session. The CLI delivers authorized fields to the exact child process and suppresses its output by default. The Business API still checks connection and grant status, and the plan's reveal policy still applies.

See the [runtime integration commands and platform wrappers](../../integrations/README.md#automation-execution) for complete examples and local, mock, and provider E2E validation limits.

### Publish to AWS secrets

This optional one-time copy supports applications that already read AWS secrets. For direct runtime access, use `inheriti secrets exec` above. After publication, the application reads the copy under AWS IAM; later plan changes or revocation do not update or delete it. Inheriti does not automatically synchronize or rotate the copy.

`inheriti secrets publish aws` previews target metadata for selected plan text fields. Add `--apply` to reveal and publish them to one AWS Secrets Manager JSON secret or separate SSM SecureString parameters. The CLI verifies the expected AWS account. See the [automation setup guide](docs/automation-setup.md#publish-plan-fields-to-aws-secrets) for flags, IAM permissions, and the reveal flow.

### Publish to Google Cloud Secret Manager

This optional one-time copy supports applications that already read Google Cloud Secret Manager. For direct runtime access, use `inheriti secrets exec` above. After publication, the application reads the copy under Google Cloud IAM; later plan changes or revocation do not update or delete it. Inheriti does not automatically synchronize or rotate the copy.

`inheriti secrets publish google` previews one Secret Manager target per selected plan text field. Add `--apply` to run the existing secure reveal and create a version for each target. See the [Google Cloud publication guide](docs/automation-setup.md#publish-plan-fields-to-google-cloud-secret-manager) for the complete command, credentials, and update limits.
