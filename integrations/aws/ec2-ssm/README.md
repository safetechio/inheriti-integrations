# AWS EC2 and SSM

Install `inheriti` on the managed instance and provide its normal CLI configuration. Then
run `run-command.sh` through Systems Manager. The command and mappings travel through SSM; plaintext
is produced only inside the instance process.

```bash
export INHERITI_SECRETS_PLAN=production
export INHERITI_SECRETS_ENV=$'DB_PASSWORD=database.password\nAPI_KEY=service.apiKey'
./run-command.sh ./deploy.sh
```

The instance role provides AWS identity. SafeKey, DMS and moderation rules remain enforced by the
Inheriti® reveal flow.
