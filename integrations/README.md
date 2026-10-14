# Inheriti® runtime integrations

## Automation setup

Business operators on local or dev manage connection and grant metadata through CLI arguments; only identity proof uses a native window:

Use the [CLI step-by-step guide](../apps/inheriti-cli/docs/automation-setup.md) for required permissions, every provider field, its source, and tested limits. Run `inheriti help automations create` for the command's field list. Connection and grant IDs can be selected in a terminal when omitted.

1. Sign in with `inheriti login` and select an eligible organisation with `inheriti organizations use ID`.
2. Run `inheriti automations create --name NAME --provider PROVIDER --deployment-environment TEST PROVIDER_FIELDS` to create a connection.
3. Configure the workload, then run `inheriti automations verify --connection CONNECTION_ID`. Enter a fresh proof from the workload in the native window. Use `inheriti automations trust` for nonsecret trust changes, then verify again.
4. Run `inheriti automations grant create --plan PLAN_ID --connection CONNECTION_ID --member MEMBER_ID`, then `inheriti automations grant activate --plan PLAN_ID --grant GRANT_ID`. The Business API checks the operator's permissions and records these changes.
5. Use `inheriti automations list` and `inheriti automations grants PLAN_ID` to inspect safe metadata. Use `grant member`, `grant revoke`, or `automations disable` to change responsibility or end access.

Setup requires a human Business session. Identity verification requires an interactive terminal and desktop window. It is enabled in the local and dev CLI builds. Provider proofs, private keys, and reconstructed fields are never CLI arguments or printed by these commands. The connection and grant lists show API metadata; they do not prove a provider can authenticate or that a live workload can use the plan. Local or mock tests do not replace provider E2E validation.

For a self-managed runner, choose **Custom runner (Portable)**. Ansible uses the connection matching its controller's identity; see the [Ansible lookup setup](./ansible/README.md), including the custom runner option.

## Automation execution

These runtime integrations wrap the `inheriti` CLI.

```text
platform wrapper -> inheriti secrets exec -> Client SDK -> Business Integrations API
```

The wrapper never receives or stores plaintext itself. The CLI opens the normal reveal flow (master
key, DMS, authentication, moderation, custodian and expiry), authorizes each requested field, and
injects it only into the child process environment. Child output is inherited only when the caller
explicitly requests `--output inherit`.

## Common command

```bash
inheriti secrets exec production \
  --env DB_PASSWORD=database.password \
  --output suppress -- ./deploy.sh
```

Use `secrets resolve PLAN_ID --field ASSET.FIELD --allow-plaintext-output` only with a trusted
nonterminal receiver, such as the Ansible lookup wrapper. Terminal stdout is rejected even when
stdin is piped. Pipes and redirected files can still retain plaintext; never send it to a log.

All platform wrappers suppress child stdout and stderr by default. Set
`INHERITI_SECRETS_OUTPUT=inherit` explicitly only when you accept that child logs may expose
credentials. The GitHub Action independently defaults its `output` input to `suppress`; choose
`output: inherit` explicitly for inherited logs. Output suppression preserves child failures and
does not prevent the recipient from writing files or sending credentials elsewhere.

## Integrations

- [GitHub Actions](./github-actions/README.md)
- [AWS EC2 and SSM](./aws/ec2-ssm/README.md)
- [AWS ECS](./aws/ecs/README.md)
- [Google Compute Engine](./google-cloud/compute-engine/README.md)
- [Google Cloud Run](./google-cloud/cloud-run/README.md)
- [Google Kubernetes Engine](./google-cloud/gke/README.md)

These examples require a host authentication method supported by the CLI. A headless workload must
still have an approved reveal path; workload identity identifies the host but does not bypass
SafeKey, DMS or moderation policy.

## Delivery and retention

Safe metadata output is separate from reconstructed fields. Prefer stdin or file descriptors when
the recipient supports them; `plans use` supports these along with environment variables, restricted temporary
files and limited-use local sockets. The receiver controls retention after delivery. Environment
values can reach subprocesses and diagnostics. Temporary files are removed on handled completion,
not securely erased; abrupt termination can leave them behind. A private socket directory provides
account-level isolation, not authenticated recipient identity. Check platform support before using
sockets or descriptors, and do not treat POSIX mode bits as Windows ACL guarantees.

`--ttl` bounds the whole command, including authorization, delivery and child execution. The
command also observes reveal-session expiry when the SDK exposes it. Cancellation terminates
the direct child with a bounded grace period; it does not contain descendants or revoke a
credential already delivered to a receiver.

Clipboard copying remains opt-in through `plans reveal`. Add `--clipboard-ttl 30s` to keep the
command alive for best-effort conditional cleanup: it clears only content still matching its copy.
Replacement content is preserved, but the comparison is not atomic and identical copies cannot be
distinguished. Cleanup does not erase clipboard history or synchronization, and cannot survive
SIGKILL or shutdown. Asset downloads are explicit persistent exports owned by the operator.

Organization-key session memory is permitted and distinct from reconstructed field values. The CLI
currently also reuses scoped organization keys through the OS credential store across commands;
persistent caching remains a separate policy decision. Authentication session files do not contain
reconstructed fields or organization keys. JavaScript strings cannot be reliably zeroed.

## Upgrade together

Old resolve invocation:

```bash
inheriti secrets resolve production --field database.password
```

New invocation, with stdout captured by a trusted receiver:

```bash
inheriti secrets resolve production --field database.password --allow-plaintext-output | trusted-consumer
```

Upgrade the CLI, Ansible lookup and runtime wrappers together. Runtime output now defaults to
`suppress`; inherited logs require explicit opt-in. Existing published artifacts and pinned Action
commits keep their previous behavior until upgraded. Compatible CLI versions and Action revisions
are pending release alignment; do not assume an old pinned revision implements this contract.
