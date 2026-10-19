#!/usr/bin/env python3
"""Enable the guest VirGL Mesa driver in a disposable GridCraft Buildroot output."""

import argparse
from pathlib import Path
import re
import subprocess

GUEST_EXTERNAL = Path(__file__).resolve().parents[5] / "guest"
GNUMERIC_EXTERNAL = Path(__file__).resolve().parents[2] / "gnumeric/buildroot-external"
SELECT = "BR2_PACKAGE_MESA3D_GALLIUM_DRIVER_VIRGL"
WAYLAND = "BR2_PACKAGE_WAYLAND"
PATCH_DIR = Path(__file__).resolve().parent / "patches"
REQUIRED = (
    "BR2_PACKAGE_MESA3D_GALLIUM_DRIVER_SOFTPIPE",
    "BR2_PACKAGE_MESA3D_OPENGL_EGL",
    "BR2_PACKAGE_MESA3D_OPENGL_ES",
    "BR2_PACKAGE_LIBXKBCOMMON",
)


def selected_config(contents: str) -> str:
    for option in (SELECT, WAYLAND):
        contents, count = re.subn(
            rf"^(?:# {option} is not set|{option}=.*)$",
            f"{option}=y",
            contents,
            flags=re.MULTILINE,
        )
        if not count:
            contents += f"\n{option}=y\n"
    contents, count = re.subn(r"^BR2_JLEVEL=.*$", "BR2_JLEVEL=1", contents,
                              flags=re.MULTILINE)
    if not count:
        contents += "\nBR2_JLEVEL=1\n"
    contents, count = re.subn(r'^BR2_GLOBAL_PATCH_DIR=.*$',
                              f'BR2_GLOBAL_PATCH_DIR="{PATCH_DIR}"', contents,
                              flags=re.MULTILINE)
    if not count:
        contents += f'\nBR2_GLOBAL_PATCH_DIR="{PATCH_DIR}"\n'
    return contents


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--buildroot", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    config = args.output / ".config"
    backup = args.output / ".config.before-gridcraft-virgl"
    if not config.is_file() or backup.exists():
        parser.error("Buildroot output config missing or VirGL backup already exists")
    before = config.read_text()
    if any(f"{key}=y" not in before.splitlines() for key in REQUIRED):
        parser.error("start from a disposable optional GridCraft output")
    backup.write_text(before)
    config.write_text(selected_config(before))
    try:
        subprocess.run([
            "make", "-C", str(args.buildroot), f"O={args.output}",
            f"BR2_EXTERNAL={GUEST_EXTERNAL}:{GNUMERIC_EXTERNAL}", "olddefconfig",
        ], check=True)
        enabled = config.read_text().splitlines()
        if (any(f"{option}=y" not in enabled for option in (SELECT, WAYLAND)) or
                "BR2_JLEVEL=1" not in enabled or
                f'BR2_GLOBAL_PATCH_DIR="{PATCH_DIR}"' not in enabled):
            raise ValueError("Buildroot rejected the optional VirGL driver")
    except (subprocess.CalledProcessError, ValueError) as error:
        config.write_text(before)
        parser.exit(1, f"optional VirGL profile failed: {error}\n")
    print(f"Optional VirGL profile ready; original config: {backup}")


if __name__ == "__main__":
    main()
