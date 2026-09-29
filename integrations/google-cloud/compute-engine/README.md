# Google Compute Engine

Install the CLI in the image or startup configuration and run `startup.sh` from systemd or a startup
script. Attach a service account for workload identity and configure the Inheriti® operator session
according to the deployment's approval policy.

```text
Compute Engine -> startup.sh -> CLI reveal -> deploy process
```

Child stdout and stderr are suppressed by default. For explicit inherited logs, set
`INHERITI_SECRETS_OUTPUT=inherit`; recipient output may contain credentials. See the
[delivery and retention policy](../../README.md#delivery-and-retention).
