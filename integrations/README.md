# Inheriti® runtime integrations

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
  --output inherit -- ./deploy.sh
```

Use `secrets resolve --field` only from a trusted pipe such as the Ansible lookup wrapper. Never
send its stdout to a log or terminal.

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
