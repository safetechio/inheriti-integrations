#!/usr/bin/env python3
"""Enable a disposable Buildroot output for the optional mpv video adapter."""

import argparse
from pathlib import Path
import re
import subprocess

SELECT = ("BR2_PACKAGE_MPV",)
BUILD_JOBS = "BR2_JLEVEL=1"
GUEST_EXTERNAL = Path(__file__).resolve().parents[4] / "guest"


def selected_config(contents):
    for key in SELECT:
        line = f"{key}=y"
        contents, matches = re.subn(rf"^(?:# {key} is not set|{key}=.*)$", line,
                                     contents, flags=re.MULTILINE)
        if not matches:
            contents += "\n" + line + "\n"
    contents, matches = re.subn(r"^BR2_JLEVEL=.*$", BUILD_JOBS, contents,
                                 flags=re.MULTILINE)
    if not matches:
        contents += "\n" + BUILD_JOBS + "\n"
    return contents


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--buildroot", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    config = args.output / ".config"
    backup = args.output / ".config.before-mpv"
    if not config.is_file():
        parser.error("Buildroot output .config is missing")
    if backup.exists():
        parser.error("backup already exists; use the existing optional profile")
    had_workspace_agent = "BR2_PACKAGE_WORKSPACE_AGENT=y" in config.read_text().splitlines()
    backup.write_bytes(config.read_bytes())
    config.write_text(selected_config(config.read_text()))
    try:
        subprocess.run(["make", "-C", str(args.buildroot), f"O={args.output}",
                        f"BR2_EXTERNAL={GUEST_EXTERNAL}", "olddefconfig"], check=True)
        enabled = config.read_text().splitlines()
        if any(f"{key}=y" not in enabled for key in SELECT):
            raise ValueError("Buildroot rejected the mpv profile")
        if BUILD_JOBS not in enabled:
            raise ValueError("Buildroot rejected the one-job resource limit")
        if had_workspace_agent and "BR2_PACKAGE_WORKSPACE_AGENT=y" not in enabled:
            raise ValueError("Buildroot dropped the Workspace agent")
    except (subprocess.CalledProcessError, ValueError) as error:
        config.write_bytes(backup.read_bytes())
        parser.exit(1, f"optional mpv profile failed: {error}\n")
    print(f"Optional profile ready; original configuration: {backup}")


if __name__ == "__main__":
    main()
