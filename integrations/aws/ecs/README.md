# AWS ECS

Run `inheriti automations runtime install-instructions --container` on your computer and add the printed CLI installation instruction to your application's Dockerfile once. Build and deploy with your usual method; the ECS service must have a healthy running task with the CLI in its image before pairing. The image needs Node.js and a shell at runtime. `inheriti automations pair aws --connection CONNECTION_ID --region REGION --cluster CLUSTER --service SERVICE` uses the image digest of the running task, so no image tag is needed. See the [automation setup guide](../../../apps/inheriti-cli/docs/automation-setup.md).

After pairing and grant activation, generate the launcher with `inheriti automations setup --plan PLAN_ID --connection CONNECTION_ID --map-all`. Save the printed script in your project as an executable file, copy it into the image, and configure your ECS task definition to use it as the entry point, with your original application command and arguments as the task command. Save the nonsecret environment settings and task role in the same deployment configuration, then deploy again with your usual method. Every new task requests the approved plan fields when it starts. Do not use the ECS `secrets` field for these mappings; that selects AWS Secrets Manager or Parameter Store instead of the Inheriti® reveal protocol.

```text
ECS task -> Inheriti launcher -> inheriti secrets exec -> application
```

The generated launcher contains the plan ID and field selectors, never plaintext secret values. Set `INHERITI_AUTOMATION_PROVIDER=AWS`, `INHERITI_AUTOMATION_CONNECTION_ID`, and `AWS_REGION` in the task environment. The CLI uses the ECS task role to sign a fresh Inheriti challenge; do not configure static AWS keys.

Child stdout and stderr are suppressed by default. For explicit inherited logs, set
`INHERITI_SECRETS_OUTPUT=inherit`; recipient output may contain credentials. See the
[delivery and retention policy](../../README.md#delivery-and-retention).
