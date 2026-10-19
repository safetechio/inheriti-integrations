#!/usr/bin/env python3
"""Package a guest-built Gnumeric installation as a signed optional adapter.

The Buildroot external package installs under /opt/workspace/apps. This recipe
copies that installation and its guest ELF dependency closure. It rejects host
ELFs and missing guest libraries; it does not fetch or trust host applications.
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
PREFIX = Path("opt/workspace/apps")
NEEDED = re.compile(r"\(NEEDED\).*\[([^]]+)\]")
MACHINE = {"x86_64": "Advanced Micro Devices X86-64", "aarch64": "AArch64"}
LOADER = {"x86_64": "ld-linux-x86-64.so.2", "aarch64": "ld-linux-aarch64.so.1"}
MAX_FILES = 512
GNUMERIC_VERSION = "1.12.62"
# GTK loads these resources at runtime rather than through ELF NEEDED entries.
RUNTIME_DATA = (
    ("usr/lib/gdk-pixbuf-2.0", "lib/gdk-pixbuf-2.0"),
    ("usr/lib/gtk-3.0", "lib/gtk-3.0"),
    ("usr/lib/gio/modules", "lib/gio/modules"),
    ("usr/lib/dri", "lib/dri"),
    ("usr/share/glib-2.0/schemas", "share/glib-2.0/schemas"),
    ("usr/share/icons/hicolor", "share/icons/hicolor"),
    ("usr/share/themes", "share/themes"),
)


def readelf(path, flag):
    return subprocess.check_output(["readelf", flag, str(path)], text=True,
                                   env={**os.environ, "LC_ALL": "C"})


def check_elf(path, arch):
    header = readelf(path, "-h")
    if not re.search(r"Class:\s+ELF64\b", header) or not re.search(
        r"Machine:\s+" + re.escape(MACHINE[arch]) + r"\s*$", header, re.MULTILINE
    ):
        raise ValueError(f"wrong guest ELF architecture: {path}")


def safe_file(target, path):
    resolved = path.resolve(strict=True)
    if not resolved.is_relative_to(target) or not resolved.is_file():
        raise ValueError(f"application file escapes guest target: {path}")
    return resolved


def resolve_library(target, staged, name):
    if not name or "/" in name or name in (".", ".."):
        raise ValueError(f"unsafe ELF dependency: {name}")
    for directory in (staged / "lib", staged / "lib64", target / "lib", target / "lib64",
                      target / "usr/lib", target / "usr/lib64"):
        candidate = directory / name
        if candidate.exists():
            if candidate.is_relative_to(staged):
                return candidate
            return safe_file(target, candidate)
    raise ValueError(f"missing guest ELF dependency: {name}")


def copy_guest_tree(target, source, destination):
    if not source.is_dir():
        return
    for path in source.rglob("*"):
        relative = path.relative_to(source)
        output = destination / relative
        if path.is_symlink():
            resolved = path.resolve(strict=True)
            if not resolved.is_relative_to(target):
                raise ValueError(f"application file escapes guest target: {path}")
            if resolved.is_dir():
                raise ValueError(f"directory symlinks are unsupported: {path}")
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(safe_file(target, path), output)
            output.chmod(path.stat().st_mode & 0o777)
        elif path.is_dir():
            output.mkdir(parents=True, exist_ok=True)
        elif path.is_file():
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(safe_file(target, path), output)
            output.chmod(path.stat().st_mode & 0o777)
        else:
            raise ValueError(f"unsupported guest application entry: {path}")


def stage(target, destination, arch):
    target = target.resolve(strict=True)
    source = target / PREFIX
    binary = safe_file(target, source / "bin/gnumeric")
    if not source.is_dir():
        raise ValueError("Gnumeric is not installed in the guest adapter prefix")
    check_elf(binary, arch)
    copy_guest_tree(target, source, destination)
    for library in ("libgsf-1.so*", "libgoffice-0.10.so*"):
        if not any((destination / "lib").glob(library)):
            raise ValueError(f"guest-built optional library missing from adapter prefix: {library}")
    for plugin in (f"lib/gnumeric/{GNUMERIC_VERSION}/plugins/excel/excel.so",
                   "lib/goffice/0.10/plugins/gnumeric/gnumeric.so"):
        if not (destination / plugin).is_file():
            raise ValueError(f"required spreadsheet plugin missing: {plugin}")
    for guest_relative, adapter_relative in RUNTIME_DATA:
        copy_guest_tree(target, target / guest_relative, destination / adapter_relative)
    pixbuf_cache = destination / "lib/gdk-pixbuf-2.0/2.10.0/loaders.cache"
    if not pixbuf_cache.is_file():
        raise ValueError("guest GDK Pixbuf loader cache is missing")
    cache = pixbuf_cache.read_text()
    pixbuf_cache.write_text(cache.replace('"/usr/lib/gdk-pixbuf-2.0/',
                                        '"/opt/workspace/apps/lib/gdk-pixbuf-2.0/'))
    schemas = destination / "share/glib-2.0/schemas"
    if list(schemas.glob("*.gschema.xml")):
        compiler = target.parent / "host/bin/glib-compile-schemas"
        if not compiler.is_file():
            raise ValueError("Buildroot host GLib schema compiler is missing")
        subprocess.run([str(compiler), str(schemas)], check=True)
    (destination / "family").write_text("spreadsheet\n")
    (destination / "lib").mkdir(exist_ok=True)
    pending = []
    for path in destination.rglob("*"):
        if path.is_file():
            with path.open("rb") as file:
                if file.read(4) == b"\x7fELF":
                    pending.append(path)
    seen = set()
    while pending:
        current = pending.pop()
        check_elf(current, arch)
        for name in NEEDED.findall(readelf(current, "-d")):
            if name in seen:
                continue
            if len(seen) >= MAX_FILES:
                raise ValueError("guest ELF dependency closure too large")
            library = resolve_library(target, destination, name)
            check_elf(library, arch)
            if not library.is_relative_to(destination):
                staged = destination / "lib" / name
                shutil.copyfile(library, staged)
                staged.chmod(library.stat().st_mode & 0o777)
                pending.append(staged)
            seen.add(name)
    loader = resolve_library(target, destination, LOADER[arch])
    if not loader.is_relative_to(destination):
        shutil.copyfile(loader, destination / "lib" / LOADER[arch])
    (destination / "lib" / LOADER[arch]).chmod(0o755)
    launcher = destination / "bin/launch"
    launcher.write_text(
        "#!/bin/sh\nset -eu\n"
        "app=/opt/workspace/apps\n"
        "export HOME=/run/session\n"
        "export XDG_CONFIG_HOME=/run/session/.config\n"
        "export XDG_DATA_HOME=/run/session/.local/share\n"
        "export XDG_CACHE_HOME=/run/session/.cache\n"
        "export XDG_RUNTIME_DIR=/run/session\n"
        "export XDG_DATA_DIRS=$app/share:/usr/share\n"
        "export GSETTINGS_SCHEMA_DIR=$app/share/glib-2.0/schemas\n"
        "export GDK_PIXBUF_MODULE_FILE=$app/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache\n"
        "export GIO_MODULE_DIR=$app/lib/gio/modules\n"
        "export GTK_PATH=$app/lib/gtk-3.0\n"
        "export LIBGL_DRIVERS_PATH=$app/lib/dri\n"
        f"exec \"$app/lib/{LOADER[arch]}\" --library-path \"$app/lib\" "
        "\"$app/bin/gnumeric\" \"$1\"\n"
    )
    launcher.chmod(0o755)
    return seen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True, type=Path, help="Buildroot output/target")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--key", required=True, type=Path, help="external Ed25519 private PEM")
    parser.add_argument("--arch", required=True, choices=tuple(MACHINE))
    parser.add_argument("--version", required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--max-bytes", type=int, default=512 * 1024 * 1024)
    args = parser.parse_args()
    try:
        if args.version != GNUMERIC_VERSION:
            raise ValueError(f"this recipe builds Gnumeric {GNUMERIC_VERSION}")
        with tempfile.TemporaryDirectory(prefix="workspace-gnumeric-stage-") as directory:
            staged = Path(directory) / "stage"
            stage(args.target, staged, args.arch)
            subprocess.run(
                [sys.executable, str(GENERIC_BUILDER), "--stage", str(staged),
                 "--output", str(args.output), "--id", "gnumeric", "--version", args.version,
                 "--arch", args.arch, "--family", "spreadsheet", "--url", args.url,
                 "--max-bytes", str(args.max_bytes), "--key", str(args.key)],
                check=True,
            )
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Gnumeric adapter build failed: {error}\n")


if __name__ == "__main__":
    main()
