import { BUILD_DEPLOYMENT } from '../configuration.js';
import { CLI_FEATURE_FLAGS } from '../feature-flags.js';
import { noColorFromEnvironment, terminalWordmark } from '@safetech/inheriti-elements-brand';
import { quickPlanAssetCatalog, localPlanAssetLimit, PROTECTED_FILE_FLAGS } from '@safetech/inheriti-elements-core/node-base';

export function usage(environmentVariables: Readonly<Record<string, string | undefined>>): string {
  const configuration = BUILD_DEPLOYMENT
    ? `Configuration: this artifact is locked to the ${BUILD_DEPLOYMENT} Business deployment. Sign in, then select an organisation.`
    : `Configuration: config.json in the existing CLI configuration directory.
             apiUrl, issuer and clientId are required; applicationId is required for
             standalone plans. For Business set business: true and deployment to
             local, dev or stg; prod requires a production build.
             Environment defaults to TEST. Existing environment overrides still work.`;
  const automationEnabled = Boolean(BUILD_DEPLOYMENT && CLI_FEATURE_FLAGS[BUILD_DEPLOYMENT].automation);
  const planCreationEnabled = Boolean(BUILD_DEPLOYMENT && CLI_FEATURE_FLAGS[BUILD_DEPLOYMENT].planCreation);
  const protectedEnabled = Boolean(BUILD_DEPLOYMENT && PROTECTED_FILE_FLAGS[BUILD_DEPLOYMENT]);
  return `${terminalWordmark({ noColor: noColorFromEnvironment(environmentVariables) })}

inheriti <command>

  login              Sign in using the browser
  logout             Clear the local session
  organizations list List Business organisations and the selected one
  organizations use [id] Select a Business organisation
  ${automationEnabled ? 'automations list   List safe connection metadata' : ''}
  ${automationEnabled ? 'automations grants PLAN_ID List safe grant metadata for one plan' : ''}
  ${automationEnabled ? 'automations create|verify|trust|disable|usage|runtime Manage connections and runtime guidance' : ''}
  ${automationEnabled ? 'automations pair start|redeem|aws|google Verify a workload without copying its proof' : ''}
  ${automationEnabled ? 'secrets publish aws|google Copy approved plan fields to cloud secret stores (optional)' : ''}
  ${automationEnabled ? 'automations grant create|activate|member|revoke Manage a plan grant' : ''}
  plans list [--limit n] [--all] [--cursor c] [--organization id]
                     List plans in the selected context
  ${planCreationEnabled ? 'plans create [--title NAME] [--description TEXT] [--asset TYPE ...]\n                     Prefill the desktop assistant with plan metadata and likely asset types' : ''}
  plans show [id]    Show one plan, its assets and its participants
  plans abort [id]   Abandon the current access request for a plan
  plans logs [id] [--limit n] [--offset n] [--json|--table]
                     Show the plan activity log
  members logs MEMBER_ID [--source MEMBER|AUTOMATION] [--from DATE] [--to DATE] [--limit n] [--offset n] [--json|--table]
                     Show unified member activity in Business
  plans reveal [id] [--field asset.field ...]
                     Copy one or more selected fields without printing their values.
                     Whether approval is needed is read from the plan.
  plans download [id] --asset code-or-id --output path${protectedEnabled ? ' [--open-limit n]' : ''}
                     Save one authorized media asset.
  ${protectedEnabled ? 'plans open path    Open a saved .inheriti file in Inheriti Workspace.' : ''}
  ${'plans use [id] [--stdin asset.field] [--env NAME=asset.field ...] [--fd N=asset.field ...] ' +
    '[--temp-file NAME=asset.field ...] [--socket NAME=asset.field ...] [--ttl 30s] ' +
    '[--output suppress|inherit] -- command [args]'}
                     Run an exact executable with destination-bound secrets. No shell.
  secrets exec [id] [--env NAME=asset.field ...] [--output inherit] -- command [args]
                     Run a process with reveal-authorized environment variables.
  secrets resolve [id] --field asset.field --allow-plaintext-output
                     Resolve one field for a machine wrapper. Raw output is intended for a pipe.
  setup [--yes|--no-completion] [--shell bash|zsh|fish]
                     Enable shell autocomplete (Yes is the default)
  completion <shell> Print the tab-completion script for bash, zsh or fish
  update [--install] Check for a newer CLI build; install after confirmation
  version            Print the CLI version
  help [command]    Show detailed usage without signing in

An id or a --field left out is asked for in a terminal, and refused in a pipe.

Output:      a table by default; --json prints the raw response, and is the only
             form that returns the pagination cursor

${configuration}`;
}

export function commandUsage(topic: readonly string[], environmentVariables: Readonly<Record<string, string | undefined>>): string {
  const command = topic.join(' ');
  if (command === 'plans' && !Boolean(BUILD_DEPLOYMENT && CLI_FEATURE_FLAGS[BUILD_DEPLOYMENT].planCreation))
    return 'Usage: inheriti plans <list|show|logs|reveal|download|use|abort>';
  if (command === 'plans download' && !Boolean(BUILD_DEPLOYMENT && PROTECTED_FILE_FLAGS[BUILD_DEPLOYMENT]))
    return 'Usage: inheriti plans download [PLAN_ID] --asset CODE_OR_ID --output PATH\n\nAuthorize and save one media asset to a new file with owner-only permissions. Existing files are never overwritten.';
  if (command === 'secrets' && !Boolean(BUILD_DEPLOYMENT && CLI_FEATURE_FLAGS[BUILD_DEPLOYMENT].automation))
    return 'Usage: inheriti secrets <exec|resolve>\n\nRun reveal-authorized secret delivery.';
  const details: Readonly<Record<string, string>> = {
    login: `Usage: inheriti login\n\nSign in using the system browser. Requires an interactive terminal.`,
    logout: `Usage: inheriti logout\n\nClear the locally stored operator session. This does not delete plans or plan data.`,
    organizations: `Usage: inheriti organizations <list|use [ID]>\n\nList eligible Business organisations or select one for this account.`,
    automations: `Usage: inheriti automations <list|grants PLAN_ID|create|verify|trust|disable|usage|runtime install-instructions|setup|pair|grant ` +
      `create|activate|member|revoke>\n\nManage Business automation connections and grants locally. ` +
      `Run inheriti help automations create, usage or grant for flags. Requires sign-in and a selected ` +
      `Organisation.`,
    'automations list': `Usage: inheriti automations list\n\nPrint safe connection metadata for the selected Business Organisation.`,
    'automations grants': `Usage: inheriti automations grants PLAN_ID\n\nPrint safe grant metadata for one plan in the selected Business Organisation.`,
    'automations create': `Usage: inheriti automations create --name NAME --provider GITHUB|GOOGLE_CLOUD|AWS|PORTABLE ` +
      `--deployment-environment TEST|LIVE [--id ID] PROVIDER_FIELDS\n\nGITHUB: --repository OWNER/REPO ` +
      `from the repository URL; --environment NAME from Settings > Environments and the job; ` +
      `--workflow 'OWNER/REPO/.github/workflows/FILE.yml@refs/heads/BRANCH' for the file and branch ` +
      `that run it. GOOGLE_CLOUD: --audience-base URI is a stable nonsecret value you choose; ` +
      `--project PROJECT --region REGION (--job JOB | --service SERVICE) reads the attached service account numeric ID ` +
      `automatically using the installed Google Cloud CLI. Alternatively pass --subject NUMERIC_ID. ` +
      `AWS: --region REGION --cluster CLUSTER --service SERVICE reads taskRoleArn automatically ` +
      `using the installed AWS CLI; --task-definition ARN can replace --service. Alternatively ` +
      `--region REGION --instance INSTANCE_ID reads the attached EC2 instance profile role, or ` +
      `pass --role-arn TASK_ROLE_ARN, never executionRoleArn. For multi-container workloads, ` +
      `also pass --container NAME. PORTABLE: --key-id ID ` +
      `--public-key 'MULTILINE_PEM_PUBLIC_KEY' --subject NAME --environment NAME must match the runner ` +
      `configuration. The command prints the exact audience for GitHub and Google Cloud. No private ` +
      `key or proof arguments. See the automation setup guide in the CLI README.`,
    'automations verify': `Usage: inheriti automations verify [--connection ID]\n\nOpen a native window for a fresh proof ` +
      `from the running workload. You must already have a secure way to transfer that proof: this command ` +
      `opens the window but does not collect proof from Cloud Run or ECS. Never pass proof on the command line or ` +
      `print it in logs.`,
    'automations pair': `Usage: inheriti automations pair <start|redeem|aws|google>\n\nOpen a short-lived pairing window as an authenticated organisation owner. Verify from inside the configured workload; the proof travels directly to Business.`,
    'automations pair start': `Usage: inheriti automations pair start [--connection ID]\n\nOpen a ten-minute pairing window for the selected connection. No ticket or proof is printed. Run pair redeem inside that workload before expiry.`,
    'automations pair redeem': `Usage: inheriti automations pair redeem\n\nRun inside the configured workload during its pairing window with the usual provider identity settings. Obtains a fresh native proof and verifies the connection directly; no operator login is needed inside the workload.`,
    'automations pair aws': `Usage: inheriti automations pair aws --connection ID --region REGION --cluster CLUSTER --service SERVICE --image IMAGE_DIGEST [--container NAME] [--cli-path ABSOLUTE_PATH] [--expect-revision TASK_DEFINITION_ARN]\n\nRun one temporary ECS task with the service task role to verify the connection. The immutable image must include Inheriti CLI. The service is not changed. Review the task revision before noninteractive use.`,
    'automations pair google': `Usage: inheriti automations pair google --connection ID --project PROJECT --region REGION (--service SERVICE | --job JOB) [--expect-revision GENERATION]\n\nRun one temporary Cloud Run job with the source workload identity to verify the connection. Its immutable image must include Inheriti CLI at /usr/local/bin/inheriti. The source workload is not changed. Review its generation before noninteractive use.`,
    'automations trust': `Usage: inheriti automations trust [--connection ID] --provider GITHUB|GOOGLE_CLOUD|AWS|PORTABLE ` +
      `PROVIDER_FIELDS\n\nReplace nonsecret trust fields using the same provider fields as create. ` +
      `Reverification may be required.`,
    'automations disable': `Usage: inheriti automations disable [--connection ID]`,
    'automations usage': `Usage: inheriti automations usage [--plan PLAN_ID] [--connection CONNECTION_ID] --field ` +
      `ASSET.FIELD\n\nPrint copyable GitHub Actions YAML for an active plan grant and verified GitHub ` +
      `connection. Find ASSET.FIELD in the plan Data tab. The generated command only checks that the ` +
      `injected value is present. The Action reference and CLI version come from Business's verified ` +
      `release; if unavailable, no workflow is printed.`,
    'automations runtime': `Usage: inheriti automations runtime install-instructions\n\nPrint the exact verified CLI package version and installation commands for a Linux EC2 instance or an ECS/Cloud Run container. The version comes from Inheriti® Business. Prompts for sign-in and Organisation selection when needed; fails if no verified release is available.`,
    'automations runtime install-instructions': `Usage: inheriti automations runtime install-instructions\n\nPrint the exact verified CLI package version and installation commands for a Linux EC2 instance or an ECS/Cloud Run container. The version comes from Inheriti® Business. Prompts for sign-in and Organisation selection when needed; fails if no verified release is available.`,
    'secrets publish': `Usage: inheriti secrets publish <aws|google> [OPTIONS]\n\nOptional one-time copy for existing cloud-store consumers; use secrets exec for direct Inheriti runtime access. After publication, reads use provider IAM. Plan changes or revocation do not update or delete the copy; there is no automatic synchronization or rotation. Preview cloud destinations by default. ` +
      `Use inheriti help secrets publish aws or inheriti help secrets publish google for provider options.`,
    'secrets publish aws': `Usage: inheriti secrets publish aws --plan PLAN_ID --region AWS_REGION --account-id 12_DIGITS ` +
      `(--secret NAME | --parameter-prefix /PATH) (--map KEY=ASSET.FIELD ... | --map-all [--except ASSET.FIELD ...] | ` +
      `--only ASSET.FIELD ...) [--apply]\n\nPreview target metadata by default. --apply reveals selected text fields and ` +
      `publishes one JSON secret or one SecureString parameter per field. Requires a selected Business Organisation, ` +
      `AWS credentials and IAM permissions. Subsequent reads use AWS IAM; plan changes or revocation do not update or delete this copy. No automatic synchronization or rotation. Confirm the account ID and mappings before applying. Values never belong in flags.`,
    'secrets publish google': `Usage: inheriti secrets publish google --plan PLAN_ID --project PROJECT_ID --secret-prefix PREFIX ` +
      `(--map KEY=ASSET.FIELD ... | --map-all [--except ASSET.FIELD ...] | --only ASSET.FIELD ...) [--apply]\n\n` +
      `Preview one Google Cloud Secret Manager target per selected field. --apply publishes new versions only to new ` +
      `or Inheriti-managed secrets. Requires Application Default Credentials and Secret Manager permissions. Subsequent reads use Google Cloud IAM; plan changes or revocation do not update or delete these copies. No automatic synchronization or rotation.`,
    'automations setup': `Usage: inheriti automations setup --plan PLAN_ID [--connection CONNECTION_ID] ` +
      `(--map-all [--except ASSET.FIELD ...] | --only ASSET.FIELD ... | --map NAME=ASSET.FIELD ... | --field ASSET.FIELD --env-name NAME) ` +
      `[--project PROJECT --region REGION (--job JOB | --service SERVICE) | --region REGION --cluster CLUSTER ` +
      `(--service SERVICE | --task-definition ARN) | --region REGION --instance INSTANCE_ID ` +
      `--service-name NAME --run-as-user USER -- APP_COMMAND [ARGS...]] [--container NAME] [--script-path ABSOLUTE_PATH] ` +
      `[--cli-path ABSOLUTE_PATH] [--apply --image IMAGE_DIGEST [--expect-revision REVISION]]\n\n` +
      `Prepare a Cloud Run, ECS, EC2, or custom runner launch script for a verified connection and active plan grant. ` +
      `Use --map-all or repeatable --only for generated names; --except omits fields from --map-all. ` +
      `Repeat --map to rename a generated variable or map fields explicitly. Review mappings before applying. ` +
      `Without a managed target, save the launcher for a VM or cluster. ` +
      `Managed cloud targets require an exact target. The CLI path inside the image defaults to /usr/local/bin/inheriti; ` +
      `use --cli-path for a different absolute path. ` +
      `By default this prints a safe preview and script. To update an existing Cloud Run job, service, or ECS service, ` +
      `first build an immutable image containing the CLI, then use --apply with its image digest ` +
      `and the revision from the preview. In an interactive terminal, review the safe preview and confirm ` +
      `instead of passing a revision. It does not build or publish images. Mount any private key only on ` +
      `the custom runner. Never pass secret values as flags.`,
    'automations grant': `Usage: inheriti automations grant create|activate|member|revoke [--plan PLAN_ID] [--grant ` +
      `GRANT_ID] [--connection CONNECTION_ID] [--member MEMBER_ID]\n\nCreate requires connection and ` +
      `responsible member; activate/revoke require grant; member also requires a new responsible ` +
      `member. Missing IDs can be selected in a terminal.`,
    plans: `Usage: inheriti plans <create|list|show|logs|reveal|download|use|abort>\n\nCreate a plan or ` +
      `inspect plan metadata and activity. Business commands accept --organization ID to select an ` +
      `eligible organisation for that command. Run inheriti help plans <command> for details.`,
    'plans create': `Usage: inheriti plans create [--title NAME] [--description TEXT] [--asset TYPE ...]\n\nPrefill ` +
      `editable, non-secret plan metadata and likely asset types in the desktop window. Repeat --asset ` +
      `for up to ${localPlanAssetLimit} catalog types. Types: ` +
      `${quickPlanAssetCatalog.map(({ id }) => id).join(', ')}. Enter secret values only in the window. ` +
      `Requires an interactive terminal, a ` +
      `selected Organisation, and sign-in. First use offers a model and runtime download of about 1.1 ` +
      `GB.`,
    'plans list': `Usage: inheriti plans list [--limit N] [--all] [--cursor CURSOR] [--json|--table] ` +
      `[--organization ID]\n\nList non-sensitive plan metadata. --all fetches up to 50 pages; use the ` +
      `next cursor to continue. --json never includes reconstructed secret values.`,
    'plans show': `Usage: inheriti plans show [PLAN_ID] [--json|--table]\n\nShow one plan's non-sensitive assets, ` +
      `fields, participants, governance, and reveal policy. An interactive terminal can prompt for ` +
      `PLAN_ID.`,
    'plans logs': `Usage: inheriti plans logs [PLAN_ID] [--limit N] [--offset N] [--json|--table]\n\nShow ` +
      `authorized plan activity. The table summarizes events; --json includes all safe log fields and ` +
      `total count. An interactive terminal can prompt for PLAN_ID.`,
    members: `Usage: inheriti members logs MEMBER_ID [--source MEMBER|AUTOMATION] [--from DATE] [--to DATE] ` +
      `[--limit N] [--offset N] [--json|--table]\n\nShow authorized member activity in the selected ` +
      `Business Organisation.`,
    'members logs': `Usage: inheriti members logs MEMBER_ID [--source MEMBER|AUTOMATION] [--from YYYY-MM-DD] [--to ` +
      `YYYY-MM-DD] [--limit N] [--offset N] [--json|--table]\n\nRead the same member activity shown in ` +
      `Business, including automation events when authorized. --json returns only safe event fields ` +
      `and the total count.`,
    'plans reveal': `Usage: inheriti plans reveal [PLAN_ID] [--field ASSET.FIELD ...] [--clipboard-ttl ` +
      `DURATION]\n\nRun the plan's authorization flow and copy selected fields to the local clipboard. ` +
      `Values are never printed. In a terminal, omit --field to select fields with Space or choose ` +
      `ALL. Each field copy is authorized and audited independently. --clipboard-ttl waits in the ` +
      `foreground and conditionally clears unchanged clipboard content. Cleanup is best effort; ` +
      `clipboard history, synchronization, shutdown and SIGKILL remain outside its control.`,
    'plans open': `Usage: inheriti plans open PATH\n\nOpen a local .inheriti file in the installed Inheriti Workspace. The file path stays on this computer.`,
    'plans download': `Usage: inheriti plans download [PLAN_ID] --asset CODE_OR_ID --output PATH ` +
      `[--open-limit N]\n\nAuthorize and save one media asset to a new file with owner-only ` +
      `permissions. The Business deployment determines whether this is a protected .inheriti copy; ` +
      `when enabled, --output must end in .inheriti and its opening limit defaults to one. ` +
      `Existing files are never overwritten.`,
    'plans use': `Usage: inheriti plans use [PLAN_ID] [--stdin ASSET.FIELD] [--env NAME=ASSET.FIELD ...] [--fd ` +
      `N=ASSET.FIELD ...] [--temp-file NAME=ASSET.FIELD ...] [--socket NAME=ASSET.FIELD ...] [--ttl ` +
      `DURATION] [--output suppress|inherit] -- EXECUTABLE [ARGUMENT ...]\n\nAuthorize and deliver ` +
      `secrets directly to one trusted child process without printing them or placing them in ` +
      `arguments. --stdin maps one field to stdin. Repeat --env for child-only environment variables, ` +
      `--fd for descriptors 3-255, --temp-file to pass a restricted temporary path through NAME, and ` +
      `--socket to pass a one-connection local socket endpoint through NAME. DURATION accepts ms, s, ` +
      `m, or h, up to 2147483647ms. --ttl bounds the whole command; authorization expiry may end ` +
      `delivery sooner. Child environment variables may be inspectable by same-user processes. ` +
      `Temporary files and socket endpoints are removed on handled completion; unlinking is not secure ` +
      `deletion. A socket trusts the local account, not the identity of its first peer. Sockets and ` +
      `descriptors are unsupported on Windows. Child stdout and stderr are suppressed because a ` +
      `generic executable could echo its credential; only Inheriti metadata/status is returned. ` +
      `--output inherit explicitly exposes child logs, which may contain credentials. Approve the ` +
      `exact command before an agent runs it.`,
    secrets: `Usage: inheriti secrets <exec|resolve|publish>\n\nDirect Inheriti runtime delivery uses exec and the same ` +
      `reveal and use flows as plans commands. Publish is an optional one-time cloud-store copy. Business commands accept --organization ID to select an ` +
      `eligible organisation for that command.`,
    'secrets exec': `Usage: inheriti secrets exec [PLAN_ID] [--env NAME=ASSET.FIELD ...] [--output inherit] -- ` +
      `EXECUTABLE [ARGUMENT ...]\n\nRun a child process with reveal-authorized environment variables. ` +
      `The reveal flow, approvals and field auditing are unchanged. Output is suppressed by default; ` +
      `--output inherit keeps the child's logs visible and may expose credentials.`,
    'secrets resolve': `Usage: inheriti secrets resolve [PLAN_ID] --field ASSET.FIELD ` +
      `--allow-plaintext-output\n\nResolve one field through the full reveal flow and write only its ` +
      `value to stdout for a trusted wrapper. Do not use this command in a terminal or redirect its ` +
      `output to logs.`,
    'plans abort': `Usage: inheriti plans abort PLAN_ID\n\nAbandon the current access request for this operator. The next reveal starts a new access flow.`,
    setup: `Usage: inheriti setup [--yes|--no-completion] [--shell bash|zsh|fish]\n\nOffer to enable shell ` +
      `autocomplete, with Yes selected by default. --yes installs without prompting; --no-completion ` +
      `skips. No configuration or sign-in is required.`,
    completion: `Usage: inheriti completion <bash|zsh|fish>\n\nPrint a shell-completion script. This command does not require configuration or sign-in.`,
    update: `Usage: inheriti update [--install]\n\nCheck for an update in this build's channel. --install confirms and installs it with npm.`,
    help: `Usage: inheriti help [COMMAND [SUBCOMMAND]]\n\nExamples:\n  inheriti help plans reveal\n  inheriti plans reveal --help`,
  };
  return details[command] ?? usage(environmentVariables);
}

export function helpTopic(argv: readonly string[]): readonly string[] | undefined {
  const [command, ...rest] = argv;
  if (command === 'help') return rest.length === 0 ? ['help'] : rest;
  const helpAt = argv.indexOf('--help');
  if (helpAt >= 0) return argv.slice(0, helpAt);
  return undefined;
}
