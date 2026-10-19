#!/usr/bin/env python3
"""Stage the guest-built MuPDF executable and its ELF closure, then sign an adapter.

This reads only a Buildroot target directory. It never imports host distribution
libraries, and the release signing key remains outside the staged filesystem.
"""

import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
GENERIC_BUILDER = ROOT / "build.py"
NEEDED = re.compile(r"\(NEEDED\).*\[([^]]+)\]")
MACHINE = {"x86_64": "Advanced Micro Devices X86-64", "aarch64": "AArch64"}
LOADER = {"x86_64": "ld-linux-x86-64.so.2", "aarch64": "ld-linux-aarch64.so.1"}
MAX_FILES = 128


def readelf(path, flag):
    return subprocess.check_output(["readelf", flag, str(path)], text=True,
                                   env={**os.environ, "LC_ALL": "C"})


def check_elf(path, arch):
    header = readelf(path, "-h")
    if not re.search(r"Class:\s+ELF64\b", header) or not re.search(
        r"Machine:\s+" + re.escape(MACHINE[arch]) + r"\s*$", header, re.MULTILINE
    ):
        raise ValueError(f"wrong guest ELF architecture: {path}")


def target_file(target, path):
    resolved = path.resolve(strict=True)
    if not resolved.is_relative_to(target.resolve()) or not resolved.is_file():
        raise ValueError(f"library escapes guest target: {path}")
    return resolved


def resolve_library(target, name):
    if "/" in name or name in ("", ".", ".."):
        raise ValueError(f"unsafe ELF dependency: {name}")
    for directory in (target / "lib", target / "lib64", target / "usr/lib", target / "usr/lib64"):
        candidate = directory / name
        if candidate.exists():
            return target_file(target, candidate)
    raise ValueError(f"missing guest ELF dependency: {name}")


def stage(target, destination, arch):
    target = target.resolve(strict=True)
    if not target.is_dir():
        raise ValueError("guest target must be a directory")
    binary = target_file(target, target / "usr/bin/mupdf-x11")
    check_elf(binary, arch)
    (destination / "bin").mkdir(parents=True)
    (destination / "lib").mkdir()
    shutil.copyfile(binary, destination / "bin/mupdf-x11")
    (destination / "bin/mupdf-x11").chmod(0o755)
    (destination / "family").write_text("pdf\n")
    launcher = destination / "bin/launch"
    launcher.write_text(
        "#!/bin/sh\n"
        "set -eu\n"
        "app=/opt/workspace/apps\n"
        f"exec \"$app/lib/{LOADER[arch]}\" --library-path \"$app/lib\" "
        "\"$app/bin/mupdf-x11\" \"$1\"\n"
    )
    launcher.chmod(0o755)
    pending = [binary]
    copied = set()
    while pending:
        current = pending.pop()
        for name in NEEDED.findall(readelf(current, "-d")):
            if name in copied:
                continue
            if len(copied) >= MAX_FILES:
                raise ValueError("guest ELF dependency closure too large")
            source = resolve_library(target, name)
            check_elf(source, arch)
            staged_library = destination / "lib" / name
            shutil.copyfile(source, staged_library)
            if name == LOADER[arch]:
                staged_library.chmod(0o755)
            copied.add(name)
            pending.append(source)
    if "libmupdf.so" not in copied:
        raise ValueError("guest MuPDF executable is not linked to libmupdf.so")
    if LOADER[arch] not in copied:
        loader = resolve_library(target, LOADER[arch])
        check_elf(loader, arch)
        staged_loader = destination / "lib" / LOADER[arch]
        shutil.copyfile(loader, staged_loader)
        staged_loader.chmod(0o755)
        copied.add(LOADER[arch])
    return copied


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True, type=Path, help="Buildroot output/target")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--key", required=True, type=Path, help="external Ed25519 private PEM")
    parser.add_argument("--arch", required=True, choices=tuple(MACHINE))
    parser.add_argument("--version", required=True)
    parser.add_argument("--url", required=True, help="HTTPS artifact URL for the signed manifest")
    parser.add_argument("--max-bytes", type=int, default=256 * 1024 * 1024)
    args = parser.parse_args()
    try:
        with tempfile.TemporaryDirectory(prefix="workspace-mupdf-stage-") as directory:
            staged = Path(directory) / "stage"
            stage(args.target, staged, args.arch)
            subprocess.run(
                [sys.executable, str(GENERIC_BUILDER), "--stage", str(staged),
                 "--output", str(args.output), "--id", "mupdf", "--version", args.version,
                 "--arch", args.arch, "--family", "pdf", "--url", args.url,
                 "--max-bytes", str(args.max_bytes), "--key", str(args.key)],
                check=True,
            )
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"MuPDF adapter build failed: {error}\n")


if __name__ == "__main__":
    main()
