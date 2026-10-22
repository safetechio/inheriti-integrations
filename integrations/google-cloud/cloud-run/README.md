# Google Cloud Run

Run `inheriti automations runtime install-instructions --container` on your computer and add the printed CLI installation instruction to your application's Dockerfile once. Build and deploy with your usual method. Before pairing, the service needs a ready revision with the CLI in its image; a Cloud Run job must exist with that image. The image needs Node.js and a shell at runtime. `inheriti automations pair google` reads the image from the existing service or job, so no image tag is needed. See the [automation setup guide](../../../apps/inheriti-cli/docs/automation-setup.md).

After pairing and grant activation, generate the launcher with `inheriti automations setup --plan PLAN_ID --connection CONNECTION_ID --map-all`. Save the printed script as an executable file in your project and copy it into the image. In your deployment configuration, use it as the container command, pass the original application command and arguments to it, and save the nonsecret environment settings and service account. Deploy again with your usual method. Each new instance requests the approved plan fields before starting the application.

The service account identifies the workload, while Inheriti® still enforces the reveal policy.

Cloud Run starts are ephemeral, so do not use this pattern for every request. For request-time access,
put the reveal behind a deliberate application operation and keep its TTL short.

Child stdout and stderr are suppressed by default. For explicit inherited logs, set
`INHERITI_SECRETS_OUTPUT=inherit`; recipient output may contain credentials. See the
[delivery and retention policy](../../README.md#delivery-and-retention).
