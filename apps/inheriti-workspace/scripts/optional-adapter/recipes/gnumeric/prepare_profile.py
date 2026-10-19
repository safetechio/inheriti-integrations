#!/usr/bin/env python3
"""Enable the optional Gnumeric build in an existing Buildroot output directory."""

import argparse
from pathlib import Path
import re
import subprocess

SELECT = (
    "BR2_PACKAGE_MESA3D",
    "BR2_PACKAGE_MESA3D_GALLIUM_DRIVER_SOFTPIPE",
    "BR2_PACKAGE_MESA3D_OPENGL_GLX",
    "BR2_PACKAGE_LIBGTK3",
    "BR2_PACKAGE_LIBGTK3_X11",
    "BR2_PACKAGE_WORKSPACE_GNUMERIC",
)
BUILD_JOBS = "BR2_JLEVEL=1"
EXTERNAL = Path(__file__).resolve().parent / "buildroot-external"
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
    backup = args.output / ".config.before-gnumeric"
    if not config.is_file():
        parser.error("Buildroot output .config is missing")
    had_workspace_agent = "BR2_PACKAGE_WORKSPACE_AGENT=y" in config.read_text().splitlines()
    if backup.exists():
        parser.error("backup already exists; keep and use the existing optional profile")
    backup.write_bytes(config.read_bytes())
    config.write_text(selected_config(config.read_text()))
    try:
        subprocess.run(["make", "-C", str(args.buildroot), f"O={args.output}",
                        f"BR2_EXTERNAL={GUEST_EXTERNAL}:{EXTERNAL}", "olddefconfig"], check=True)
        enabled = config.read_text()
        if any(f"{key}=y" not in enabled.splitlines() for key in SELECT):
            raise ValueError("Buildroot rejected a required Gnumeric profile selection")
        if BUILD_JOBS not in enabled.splitlines():
            raise ValueError("Buildroot rejected the one-job resource limit")
        if had_workspace_agent and "BR2_PACKAGE_WORKSPACE_AGENT=y" not in enabled.splitlines():
            raise ValueError("Buildroot dropped the base Workspace agent")
    except (subprocess.CalledProcessError, ValueError) as error:
        config.write_bytes(backup.read_bytes())
        parser.exit(1, f"optional Gnumeric profile failed: {error}\n")
    print(f"Optional profile ready; original configuration: {backup}")


if __name__ == "__main__":
    main()
