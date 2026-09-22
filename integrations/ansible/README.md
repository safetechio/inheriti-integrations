# Ansible

Install the lookup plugin under `lookup_plugins/inheriti.py` in the playbook or collection, and make
the existing `inheriti` CLI available on the controller. The lookup invokes
`secrets resolve`, so the complete reveal flow and field auditing remain in the CLI and Client SDK.

```yaml
vars:
  db_password: "{{ lookup('inheriti', 'database.password', plan='production') }}"

tasks:
  - name: Deploy application
    ansible.builtin.command: ./deploy.sh
    environment:
      DB_PASSWORD: "{{ db_password }}"
```

Use `no_log: true` for tasks that contain the resolved value. The lookup writes the value only to
Ansible's in-memory result; do not enable verbose logging for it.
