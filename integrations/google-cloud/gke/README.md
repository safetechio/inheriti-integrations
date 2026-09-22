# Google Kubernetes Engine

Use `entrypoint.sh` as the application container command for startup-time injection. Configure
Workload Identity Federation for the pod's service account and keep selectors in Kubernetes
configuration, never secret values.

An init container alone cannot populate another container's environment. Use the entrypoint pattern
for environment variables; use a sidecar and a memory-backed socket only when rotation or renewal is
required.
