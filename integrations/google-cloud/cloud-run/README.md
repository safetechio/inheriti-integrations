# Google Cloud Run

Use `entrypoint.sh` as the container entrypoint when the reveal can complete during instance startup.
The service account identifies the workload, while Inheriti® still enforces the reveal policy.

Cloud Run starts are ephemeral, so do not use this pattern for every request. For request-time access,
put the reveal behind a deliberate application operation and keep its TTL short.
