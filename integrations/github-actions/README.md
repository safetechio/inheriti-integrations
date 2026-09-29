# GitHub Actions

The composite action downloads and runs the requested Inheriti CLI version from npm. Authenticate
the runner using the configured Inheriti®
operator session and keep production workflows protected so a human can approve the reveal in
SafeKey Mobile when the plan requires it.

```yaml
- uses: safetechio/inheriti-integrations/integrations/github-actions@<full-commit-sha>
  with:
    cli-version: "<published-version>"
    plan: production
    env: |
      DB_PASSWORD=database.password
      API_KEY=service.apiKey
    run: ./deploy.sh
```

The command runs in one process. Values are not written to `GITHUB_ENV`; only the child process sees
the mapped environment variables. Pin both the Action commit and `cli-version` in production.

Child output defaults to `suppress`. Set `output: inherit` explicitly only when you accept that
child logs may expose credentials. Suppression preserves command failures and does not control
recipient retention. Compatible CLI versions and Action revisions are pending release alignment;
upgrade both together. See the [delivery policy](../README.md#delivery-and-retention).
