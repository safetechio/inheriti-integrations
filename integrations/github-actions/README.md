# GitHub Actions

The composite action downloads and runs an exact Inheriti CLI version from npm. The calling job
must grant `id-token: write`, use the GitHub environment bound to its Business connection, and
provide the connection ID and exact audience returned during setup. Keep the workflow protected
so a human can approve the reveal in SafeKey Mobile when the plan requires it.

There is no published, verified Action+CLI version pair yet. The current CLI `latest` npm tag is
not a compatible release to assume here. A customer workflow must be generated from a tested
pair after publication; copying a commit from this repository or using `@main` is not a release
process. Until then, use the [CLI automation setup guide](../../apps/inheriti-cli/docs/automation-setup.md)
for connection configuration and the isolated E2E harness for provider tests.

The command runs in one process. Values are not written to `GITHUB_ENV`; only the child process sees
the mapped environment variables. Pin both the Action commit and `cli-version` in production.

Child output defaults to `suppress`. Set `output: inherit` explicitly only when you accept that
child logs may expose credentials. Suppression preserves command failures and does not control
recipient retention. Pin the tested Action revision and exact CLI version together when that pair
is published. See the [delivery policy](../README.md#delivery-and-retention).

## Verified setup version

Business dev reads `integrations/github-actions/verified-dev-release.json` from this
repository's `main` branch to generate the plan's copyable workflow. Publish that file only
after an end-to-end run uses the **published dev npm CLI package** with the exact Action commit,
deployed Business dev API, and normal SafeKey Mobile reveal. Stable deployments use the separate
`verified-release.json` file. The dev manifest format is:

```json
{
  "actionRepository": "safetechio/inheriti-integrations",
  "actionRef": "<40-character tested commit SHA>",
  "cliVersion": "<published x.y.z-dev.N CLI version>"
}
```

The dev file does not exist yet. Until the release gate passes, Business leaves workflow
copying unavailable instead of suggesting `@main`, npm `latest`, or a test-only package.
