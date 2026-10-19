#!/usr/bin/env python3
"""Add GridCraft graphical libraries to a disposable optional Buildroot output."""

import argparse
from pathlib import Path
import re
import subprocess

SELECT = (
    "BR2_PACKAGE_LIBXKBCOMMON",
    "BR2_PACKAGE_MESA3D_OPENGL_EGL",
    "BR2_PACKAGE_MESA3D_OPENGL_ES",
)
REQUIRED_EXISTING = (
    "BR2_PACKAGE_MESA3D",
    "BR2_PACKAGE_MESA3D_GALLIUM_DRIVER_SOFTPIPE",
    "BR2_PACKAGE_XORG7",
)
GUEST_EXTERNAL = Path(__file__).resolve().parents[4] / "guest"
GNUMERIC_EXTERNAL = Path(__file__).resolve().parents[1] / "gnumeric/buildroot-external"


def selected_config(contents):
    for key in SELECT:
        line = f"{key}=y"
        contents, count = re.subn(rf"^(?:# {key} is not set|{key}=.*)$", line,
                                  contents, flags=re.MULTILINE)
        if not count:
            contents += "\n" + line + "\n"
    contents, count = re.subn(r"^BR2_JLEVEL=.*$", "BR2_JLEVEL=1", contents,
                              flags=re.MULTILINE)
    if not count:
        contents += "\nBR2_JLEVEL=1\n"
    return contents


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--buildroot", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    config = args.output / ".config"
    backup = args.output / ".config.before-gridcraft"
    if not config.is_file() or backup.exists():
        parser.error("Buildroot output config missing or GridCraft backup already exists")
    before = config.read_text()
    if any(f"{key}=y" not in before.splitlines() for key in REQUIRED_EXISTING):
        parser.error("start from an optional X11/Mesa softpipe guest output")
    backup.write_text(before)
    config.write_text(selected_config(before))
    try:
        subprocess.run(["make", "-C", str(args.buildroot), f"O={args.output}",
                        f"BR2_EXTERNAL={GUEST_EXTERNAL}:{GNUMERIC_EXTERNAL}",
                        "olddefconfig"], check=True)
        enabled = config.read_text().splitlines()
        if any(f"{key}=y" not in enabled for key in SELECT) or "BR2_JLEVEL=1" not in enabled:
            raise ValueError("Buildroot rejected required GridCraft graphics options")
    except (subprocess.CalledProcessError, ValueError) as error:
        config.write_text(before)
        parser.exit(1, f"optional GridCraft profile failed: {error}\n")
    print(f"Optional GridCraft profile ready; original config: {backup}")


if __name__ == "__main__":
    main()
