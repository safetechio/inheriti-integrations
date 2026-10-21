# Google Cloud Run

Before building the application container, run `inheriti automations runtime install-instructions` on the operator's **Inheriti® CLI**; it prompts for Business sign-in and organization selection when needed. Add the printed, exact-version npm `RUN` instruction to your Dockerfile; it checks the installed version. The build needs npm, and the final image needs a Node.js runtime. The printed `npm install --engine-strict` checks compatibility against the published package's `engines` metadata, with no version to enter manually. Build and publish the image; deploy it to the Cloud Run service or job before pairing. Use the registry's `IMAGE@sha256:DIGEST` reference for `inheriti automations setup --apply`. The digest identifies the exact container; the CLI version comes from the verified release served by the current Business deployment. If no verified release is available, the command fails instead of suggesting a version. See the [automation setup guide](../../../apps/inheriti-cli/docs/automation-setup.md).

Use `entrypoint.sh` as the container entrypoint when the reveal can complete during instance startup.
The service account identifies the workload, while Inheriti® still enforces the reveal policy.

Cloud Run starts are ephemeral, so do not use this pattern for every request. For request-time access,
put the reveal behind a deliberate application operation and keep its TTL short.

Child stdout and stderr are suppressed by default. For explicit inherited logs, set
`INHERITI_SECRETS_OUTPUT=inherit`; recipient output may contain credentials. See the
[delivery and retention policy](../../README.md#delivery-and-retention).
