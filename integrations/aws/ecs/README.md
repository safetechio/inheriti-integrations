# AWS ECS

Copy `entrypoint.sh` into the image and configure the ECS task to use it as its entrypoint. The task
role identifies the workload; do not use the ECS `secrets` field for these mappings because that
would select AWS Secrets Manager/Parameter Store instead of the Inheriti® reveal protocol.

```text
ECS task -> entrypoint.sh -> inheriti secrets exec -> application
```

Set `INHERITI_SECRETS_PLAN` and newline-separated `INHERITI_SECRETS_ENV` in the task configuration.
Keep the values as selectors, never as plaintext secrets.

Child stdout and stderr are suppressed by default. For explicit inherited logs, set
`INHERITI_SECRETS_OUTPUT=inherit`; recipient output may contain credentials. See the
[delivery and retention policy](../../README.md#delivery-and-retention).
