#!/usr/bin/env python3
"""Stage guest-built mpv and its ELF closure as a signed optional video adapter."""

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
MAX_LIBRARIES = 256
VERSION = "0.40.0"


def readelf(path, flag):
    return subprocess.check_output(["readelf", flag, str(path)], text=True,
                                   env={**os.environ, "LC_ALL": "C"})


def check_elf(path, arch):
    header = readelf(path, "-h")
    if not re.search(r"Class:\s+ELF64\b", header) or not re.search(
        r"Machine:\s+" + re.escape(MACHINE[arch]) + r"\s*$", header, re.MULTILINE
    ):
        raise ValueError(f"wrong guest ELF architecture: {path}")


def guest_file(target, path):
    resolved = path.resolve(strict=True)
    if not resolved.is_relative_to(target) or not resolved.is_file():
        raise ValueError(f"application file escapes guest target: {path}")
    return resolved


def resolve_library(target, name):
    if not re.fullmatch(r"[A-Za-z0-9_.+-]+", name):
        raise ValueError(f"unsafe ELF dependency: {name}")
    for directory in ("lib", "lib64", "usr/lib", "usr/lib64"):
        candidate = target / directory / name
        if candidate.exists() or candidate.is_symlink():
            return guest_file(target, candidate)
    raise ValueError(f"missing guest ELF dependency: {name}")


def stage(target, destination, arch, strip_tool=None):
    target = target.resolve(strict=True)
    if not target.is_dir():
        raise ValueError("guest target must be a directory")
    binary = guest_file(target, target / "usr/bin/mpv")
    check_elf(binary, arch)
    (destination / "bin").mkdir(parents=True)
    (destination / "lib").mkdir()
    staged_binary = destination / "bin/mpv"
    shutil.copyfile(binary, staged_binary)
    staged_binary.chmod(0o755)
    pending = [binary]
    copied = set()
    while pending:
        current = pending.pop()
        for name in NEEDED.findall(readelf(current, "-d")):
            if name in copied:
                continue
            if len(copied) >= MAX_LIBRARIES:
                raise ValueError("guest ELF dependency closure too large")
            source = resolve_library(target, name)
            check_elf(source, arch)
            output = destination / "lib" / name
            shutil.copyfile(source, output)
            output.chmod(source.stat().st_mode & 0o777)
            copied.add(name)
            pending.append(source)
    if not any(name.startswith("libavcodec.so") for name in copied):
        raise ValueError("guest mpv is missing FFmpeg video decoding")
    loader_name = LOADER[arch]
    if loader_name not in copied:
        loader = resolve_library(target, loader_name)
        check_elf(loader, arch)
        output = destination / "lib" / loader_name
        shutil.copyfile(loader, output)
        copied.add(loader_name)
    (destination / "lib" / loader_name).chmod(0o755)
    if strip_tool is not None:
        for binary in [staged_binary, *(destination / "lib").iterdir()]:
            subprocess.run([str(strip_tool), "--strip-debug", str(binary)], check=True)
    (destination / "family").write_text("video\n")
    launcher = destination / "bin/launch"
    launcher.write_text(
        "#!/bin/sh\nset -eu\n"
        "app=/opt/workspace/apps\n"
        "export HOME=/run/session\n"
        "export XDG_CONFIG_HOME=/run/session/.config\n"
        "export XDG_CACHE_HOME=/run/session/.cache\n"
        f"exec \"$app/lib/{loader_name}\" --library-path \"$app/lib\" "
        "\"$app/bin/mpv\" --no-config "
        "--audio=no --hwdec=no --vo=x11 --force-window=yes -- \"$1\"\n"
    )
    launcher.chmod(0o755)
    return copied


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--key", required=True, type=Path, help="external Ed25519 private PEM")
    parser.add_argument("--arch", required=True, choices=tuple(MACHINE))
    parser.add_argument("--version", required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--max-bytes", type=int, default=256 * 1024 * 1024)
    args = parser.parse_args()
    try:
        if args.version != VERSION:
            raise ValueError(f"this recipe packages mpv {VERSION}")
        with tempfile.TemporaryDirectory(prefix="workspace-mpv-stage-") as directory:
            staged = Path(directory) / "stage"
            triplet = "x86_64" if args.arch == "x86_64" else "aarch64"
            strip_tool = args.target.parent / "host/bin" / f"{triplet}-buildroot-linux-gnu-strip"
            if not strip_tool.is_file() or not os.access(strip_tool, os.X_OK):
                raise ValueError("guest toolchain strip is missing")
            stage(args.target, staged, args.arch, strip_tool)
            subprocess.run([
                sys.executable, str(GENERIC_BUILDER), "--stage", str(staged),
                "--output", str(args.output), "--id", "mpv", "--version", VERSION,
                "--arch", args.arch, "--family", "video", "--url", args.url,
                "--max-bytes", str(args.max_bytes), "--key", str(args.key),
            ], check=True)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"mpv adapter build failed: {error}\n")


if __name__ == "__main__":
    main()
