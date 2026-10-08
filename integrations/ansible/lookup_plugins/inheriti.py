"""Ansible lookup for one field resolved by the existing Inheriti CLI."""

from __future__ import annotations

import subprocess
import os
from typing import Any

from ansible.errors import AnsibleError
from ansible.plugins.lookup import LookupBase


class LookupModule(LookupBase):
    """Resolve ``asset.field`` through the complete Inheriti reveal flow."""

    def run(self, terms: list[str], variables: dict[str, Any] | None = None, **kwargs: Any) -> list[str]:
        del variables
        plan = kwargs.get("plan")
        if not isinstance(plan, str) or not plan:
            raise AnsibleError("inheriti lookup requires plan='PLAN_ID'")
        if not terms:
            raise AnsibleError("inheriti lookup requires at least one asset.field selector")

        values: list[str] = []
        for selector in terms:
            try:
                value = subprocess.check_output(
                    ["inheriti", "secrets", "resolve", plan, "--field", selector, "--allow-plaintext-output"]
                    + (["--automation"] if os.environ.get("INHERITI_AUTOMATION_PROVIDER") else []),
                    text=True,
                    stderr=subprocess.PIPE,
                )
            except (OSError, subprocess.CalledProcessError):
                raise AnsibleError("Inheriti could not resolve the requested field") from None
            values.append(value.rstrip("\r\n"))
        return values
