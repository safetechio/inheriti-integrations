# Ansible

Install the lookup plugin under `lookup_plugins/inheriti.py` in the playbook or collection, and make
the existing `inheriti` CLI available on the controller. The lookup invokes
`secrets resolve --allow-plaintext-output`, so the complete reveal flow and field auditing remain in the CLI and Client SDK.

```yaml
vars:
  db_password: "{{ lookup('inheriti', 'database.password', plan='production') }}"

tasks:
  - name: Deploy application
    no_log: true
    ansible.builtin.command: ./deploy.sh
    environment:
      DB_PASSWORD: "{{ db_password }}"
```

Use `no_log: true` for tasks that contain the resolved value. The lookup writes the value only to
Ansible's in-memory result; do not enable verbose logging for it.

Do not cache the resolved value as a persistent fact or display it with debug tasks. Authenticate
the controller through a supported CLI session; noninteractive execution still requires plan
authorization. This lookup requires the matching hardened CLI and never retries without the
acknowledgment flag. For compatibility, trailing CR/LF characters are still stripped from the
result; secrets ending with newlines are not preserved losslessly.

For a controller without ambient OIDC identity, set `INHERITI_AUTOMATION_PROVIDER=PORTABLE`,
`INHERITI_AUTOMATION_CONNECTION_ID`, `INHERITI_AUTOMATION_KEY_ID`,
`INHERITI_AUTOMATION_RUNNER_SUBJECT`, `INHERITI_AUTOMATION_ENVIRONMENT`, and
`INHERITI_AUTOMATION_PRIVATE_KEY_FILE`. The file must contain the matching canonical Ed25519
PKCS#8 PEM private key, owned by the CLI user and readable only by that user (`chmod 600`).
Store only the path in the environment. Portable proof acquisition fails closed on Windows,
where these POSIX ownership and permission checks are unavailable.
