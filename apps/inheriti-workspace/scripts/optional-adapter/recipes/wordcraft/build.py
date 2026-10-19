#!/usr/bin/env python3
"""Package the pinned WordCraft Linux release with guest-only runtime libraries."""

import argparse
import hashlib
import importlib.util
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[2]
GENERIC_BUILDER = ROOT / "build.py"
VERSION = "0.8.0"
ARCHIVE_SHA256 = {
    "x86_64": "0ece07cf3d91b923dfd80f90310e04983bde66f0279c6b60ddce89596dde0ddf",
    "aarch64": "a862de2256e43c987dc8ea009ba52ac25db34091fd649b666133931ac68e02cc",
}
ELF_MACHINE = {
    "x86_64": "Advanced Micro Devices X86-64",
    "aarch64": "AArch64",
}
LOADER = {
    "x86_64": "ld-linux-x86-64.so.2",
    "aarch64": "ld-linux-aarch64.so.1",
}
NEEDED = re.compile(r"\(NEEDED\).*\[([^]]+)\]")
RUNTIME_LIBRARIES = (
    "libX11.so.6", "libX11-xcb.so.1", "libxcb.so.1", "libXcursor.so.1",
    "libXi.so.6", "libxkbcommon.so.0", "libxkbcommon-x11.so.0",
)
RENDER_BACKEND = "libEGL.so.1"
OPTIONAL_RUNTIME_LIBRARIES = (
    "libGL.so.1", "libGLESv2.so.2", "libwayland-client.so.0",
    "libwayland-egl.so.1", "libdbus-1.so.3",
)

def archive_name(arch):
    return f"wordcraft-{VERSION}-linux-{arch}.tar.gz"


def digest(path):
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(chunk)
    return sha.hexdigest()


def readelf(path, flag):
    return subprocess.check_output(["readelf", flag, str(path)], text=True,
                                   env={**os.environ, "LC_ALL": "C"})


def check_elf(path, arch="x86_64"):
    header = readelf(path, "-h")
    if not re.search(r"Class:\s+ELF64\b", header) or not re.search(
        rf"Machine:\s+{re.escape(ELF_MACHINE[arch])}\s*$", header, re.MULTILINE
    ):
        raise ValueError(f"wrong guest ELF architecture: {path}")


def unpack_release(archive, stage, arch="x86_64"):
    prefix = archive_name(arch).removesuffix(".tar.gz")
    if archive.name != archive_name(arch) or digest(archive) != ARCHIVE_SHA256[arch]:
        raise ValueError("WordCraft release filename or SHA256 mismatch")
    total = 0
    with tarfile.open(archive, "r:gz") as package:
        for entry in package:
            name = PurePosixPath(entry.name)
            if (name.is_absolute() or ".." in name.parts or not name.parts or
                    name.parts[0] != prefix or not (entry.isfile() or entry.isdir())):
                raise ValueError(f"unsafe WordCraft release member: {entry.name}")
            if entry.isfile():
                total += entry.size
                if total > 256 * 1024 * 1024:
                    raise ValueError("WordCraft release exceeds extraction limit")
                relative = Path(*name.parts[1:])
                if not relative.parts or relative.parts[0] not in ("bin", "share"):
                    raise ValueError(f"unexpected WordCraft release member: {entry.name}")
                if relative.parts[0] == "bin" and relative != Path("bin/wordcraft"):
                    continue
                output = stage / relative
                output.parent.mkdir(parents=True, exist_ok=True)
                with package.extractfile(entry) as source, output.open("wb") as destination:
                    shutil.copyfileobj(source, destination)
                output.chmod(entry.mode & 0o755)
    binary = stage / "bin/wordcraft"
    if not binary.is_file():
        raise ValueError("WordCraft graphical executable missing")
    check_elf(binary, arch)


def guest_library(target, name, arch="x86_64"):
    if not re.fullmatch(r"[A-Za-z0-9_.+-]+", name):
        raise ValueError(f"unsafe library name: {name}")
    for folder in ("lib", "lib64", "usr/lib", "usr/lib64"):
        path = target / folder / name
        if path.exists():
            actual = path.resolve(strict=True)
            if not actual.is_relative_to(target) or not actual.is_file():
                raise ValueError(f"guest library escapes target: {path}")
            check_elf(actual, arch)
            return actual
    raise ValueError(f"missing guest runtime library: {name}")


def stage_runtime(target, stage, arch="x86_64"):
    target = target.resolve(strict=True)
    library_dir = stage / "lib"
    library_dir.mkdir(exist_ok=True)
    for name in RUNTIME_LIBRARIES:
        guest_library(target, name, arch)
    if not any((target / folder / RENDER_BACKEND).exists() for folder in ("lib", "usr/lib")):
        raise ValueError("guest needs EGL renderer libraries")
    pending = [stage / "bin/wordcraft"]
    runtime = RUNTIME_LIBRARIES + (RENDER_BACKEND,) + tuple(name for name in OPTIONAL_RUNTIME_LIBRARIES
                                         if any((target / folder / name).exists()
                                                for folder in ("lib", "usr/lib")))
    pending.extend(copy_library(target, library_dir, name, arch) for name in runtime)
    pending.append(copy_library(target, library_dir, LOADER[arch], arch))
    seen = set(runtime + (LOADER[arch],))
    dri = target / "usr/lib/dri"
    if not dri.is_dir():
        raise ValueError("guest EGL renderer has no Mesa DRI drivers")
    destination = library_dir / "dri"
    destination.mkdir()
    for driver in dri.glob("*.so"):
        actual = driver.resolve(strict=True)
        if not actual.is_relative_to(target) or not actual.is_file():
            raise ValueError(f"guest DRI driver escapes target: {driver}")
        check_elf(actual, arch)
        output = destination / driver.name
        shutil.copyfile(actual, output)
        output.chmod(actual.stat().st_mode & 0o777)
        pending.append(output)
    if not any(destination.glob("*.so")):
        raise ValueError("guest EGL renderer has no Mesa DRI drivers")
    # Mesa's DRI stub loads its versioned Gallium implementation at runtime;
    # readelf on the stub alone does not expose this dependency.
    virgl = (dri / "virtio_gpu_dri.so").exists()
    if virgl:
        gbm_backend = target / "usr/lib/gbm/dri_gbm.so"
        if not gbm_backend.is_file():
            raise ValueError("VirGL guest needs Mesa GBM DRI backend")
        backend = gbm_backend.resolve(strict=True)
        if not backend.is_relative_to(target) or not backend.is_file():
            raise ValueError("guest GBM backend escapes target")
        check_elf(backend, arch)
        gbm_destination = library_dir / "gbm"
        gbm_destination.mkdir()
        gbm_output = gbm_destination / "dri_gbm.so"
        shutil.copyfile(backend, gbm_output)
        gbm_output.chmod(backend.stat().st_mode & 0o777)
        pending.append(gbm_output)
        gallium = list((target / "usr/lib").glob("libgallium-*.so"))
        if len(gallium) != 1:
            raise ValueError("VirGL guest needs exactly one Mesa Gallium library")
        source = gallium[0].resolve(strict=True)
        if not source.is_relative_to(target) or not source.is_file():
            raise ValueError("guest Gallium library escapes target")
        check_elf(source, arch)
        output = library_dir / gallium[0].name
        shutil.copyfile(source, output)
        output.chmod(source.stat().st_mode & 0o777)
        pending.append(output)
    while pending:
        for name in NEEDED.findall(readelf(pending.pop(), "-d")):
            if name in seen:
                continue
            if len(seen) >= 256:
                raise ValueError("guest ELF dependency closure too large")
            pending.append(copy_library(target, library_dir, name, arch))
            seen.add(name)
    (stage / "family").write_text("document\n")
    launcher = stage / "bin/launch"
    gbm_env = "export GBM_BACKENDS_PATH=$app/lib/gbm\n" if virgl else ""
    launcher.write_text(
        "#!/bin/sh\nset -eu\n"
        "app=/opt/workspace/apps\n"
        "export HOME=/run/session\n"
        "export XDG_CONFIG_HOME=/run/session/.config\n"
        "export XDG_DATA_HOME=/run/session/.local/share\n"
        "export XDG_CACHE_HOME=/run/session/.cache\n"
        "export XDG_RUNTIME_DIR=/run/session\n"
        "export XDG_DATA_DIRS=$app/share:/usr/share\n"
        "export LIBGL_DRIVERS_PATH=$app/lib/dri\n"
        f"{gbm_env}"
        "export WGPU_BACKEND=gl\n"
        f"exec \"$app/lib/{LOADER[arch]}\" --library-path \"$app/lib\" "
        "\"$app/bin/wordcraft\" \"$1\"\n"
    )
    launcher.chmod(0o755)
    return seen


def copy_library(target, destination, name, arch="x86_64"):
    source = guest_library(target, name, arch)
    output = destination / name
    shutil.copyfile(source, output)
    output.chmod(source.stat().st_mode & 0o777)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--target", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--key", required=True, type=Path)
    parser.add_argument("--version", required=True)
    parser.add_argument("--arch", choices=tuple(ARCHIVE_SHA256), default="x86_64")
    parser.add_argument("--url", required=True)
    parser.add_argument("--max-bytes", type=int, default=512 * 1024 * 1024)
    args = parser.parse_args()
    try:
        if args.version != VERSION:
            raise ValueError(f"this recipe packages WordCraft {VERSION}")
        with tempfile.TemporaryDirectory(prefix="workspace-wordcraft-stage-") as directory:
            stage = Path(directory) / "stage"
            stage.mkdir()
            unpack_release(args.archive, stage, args.arch)
            stage_runtime(args.target, stage, args.arch)
            subprocess.run([
                sys.executable, str(GENERIC_BUILDER), "--stage", str(stage),
                "--output", str(args.output), "--id", "wordcraft", "--version", VERSION,
                "--arch", args.arch, "--family", "document", "--url", args.url,
                "--max-bytes", str(args.max_bytes), "--key", str(args.key),
            ], check=True)
    except (ValueError, OSError, subprocess.CalledProcessError, tarfile.TarError) as error:
        parser.exit(1, f"WordCraft adapter build failed: {error}\n")


if __name__ == "__main__":
    main()
