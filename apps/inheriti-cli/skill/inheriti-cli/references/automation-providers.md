# Automation providers and runtime

Read only the section for the workload that will actually execute the protected process. Use `inheriti help automations create`, `pair`, `setup`, and `runtime` for exact options in the installed build. Operator-side `gh`, `gcloud`, or AWS CLI authentication permits discovery and setup; the runtime identity must still be the identity configured on the connection.

## GitHub Actions

Bind `automations create --provider GITHUB` to the exact `--repository OWNER/REPO`, job `--environment NAME`, and `--workflow OWNER/REPO/.github/workflows/FILE.yml@refs/heads/BRANCH`. The job needs `id-token: write` and the audience returned by the CLI. The CLI does not create a repository or initial pairing job. After proof verification and an active grant, `automations usage --plan PLAN_ID --connection CONNECTION_ID --field ASSET.FIELD` emits YAML pinned to a Business-verified Action and CLI release; it refuses to emit a workflow when that release is unavailable. Put it in the exact repository/file/ref it names, then verify the run through safe plan logs.

## Google Cloud Run service or job

Bind `--provider GOOGLE_CLOUD` to a stable non-secret `--audience-base URI`, `--project`, `--region`, and one of `--service` or `--job`. The CLI can inspect the attached service account numeric ID with the local Google Cloud CLI; the service/job must exist. The runtime image needs the Inheriti CLI before pairing. `automations pair google` launches a temporary job with the source identity after checking the generation and image. After grant activation, `automations setup` previews the selected service/job and field mappings; `--apply` updates that exact workload with a reviewed image/revision. It does not create a Cloud Run resource.

## AWS ECS

Bind `--provider AWS` to `--region`, `--cluster`, and an existing `--service` or `--task-definition`. Use the **task role**, never `executionRoleArn`; the CLI can resolve the role from the existing workload. For multiple containers, choose `--container`. The image must include the CLI. `automations pair aws` can run a temporary ECS task, pinning the inspected task definition and image digest; it does not change the service. After an active grant, `automations setup` previews the runtime update and requires explicit `--apply` with a reviewed image/revision to change the ECS service.

## AWS EC2

For an application directly on an instance, bind the connection to `--region` and `--instance`; the attached instance-profile role is the identity. `automations runtime install ec2 --region REGION --instance INSTANCE_ID` uses SSM to install and verify the exact published CLI version on an online Linux instance. Confirm instance, region, and version before remote installation. `automations pair ec2` uses SSM for `pair redeem` and checks the attached role. `automations setup` previews the launcher and systemd unit; `--install` writes them after confirmation but does not start the service. Do not mistake an EC2 instance for an ECS service.

## Portable runner

`--provider PORTABLE` binds a key ID, **public** key, subject, and environment to a runner configured separately. Keep its private key in that workload, never an agent prompt or CLI argument. Pair from the workload, activate a grant, then use `automations setup` to print or save the launcher. The CLI does not provision the runner.

## Image and installation preparation

`automations runtime install-instructions --container` prints Dockerfile guidance; without `--container`, an interactive user chooses host/container guidance. `automations runtime image --image ECR_OR_ARTIFACT_REGISTRY_TAG` previews the image operation; `--build` builds and verifies an image containing this CLI version; `--publish` also pushes it and reports an immutable digest. Inspect source context, Dockerfile, registry, tag, and destination before build/publish. Docker and registry sign-in are separate prerequisites. An image build/push does not deploy the workload; use the separate managed `automations setup --apply` flow only when the user requested that change.
