#!/usr/bin/env python3
"""Package a staged optional application for the Workspace VM.

The release private key is supplied externally and is never copied into output.
"""

import argparse
import hashlib
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
from urllib.parse import urlsplit

MAX_IMAGE = 512 * 1024 * 1024
ED25519_SPKI_PREFIX = bytes.fromhex("302a300506032b6570032100")
SAFE_NAME = re.compile(r"[a-z0-9][a-z0-9._-]{0,63}\Z", re.ASCII)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate_tree(root, family):
    require(root.is_dir() and not root.is_symlink(), "stage must be a directory")
    for path in (root, *root.rglob("*")):
        mode = path.lstat().st_mode
        require(stat.S_ISDIR(mode) or stat.S_ISREG(mode), f"unsafe stage entry: {path}")
        if stat.S_ISREG(mode):
            require(path.stat().st_nlink == 1, f"hard-linked stage entry: {path}")
    marker = root / "family"
    launcher = root / "bin" / "launch"
    require(marker.is_file() and marker.read_bytes() == (family + "\n").encode(), "family marker mismatch")
    require(launcher.is_file() and os.access(launcher, os.X_OK), "bin/launch must be executable")


def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL)


def digest_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def build(args):
    for value in (args.id, args.version, args.family):
        require(SAFE_NAME.fullmatch(value) is not None, "invalid id, version or family")
    require(args.arch in ("x86_64", "aarch64"), "invalid guest architecture")
    require(0 < args.max_bytes <= MAX_IMAGE and args.max_bytes % 4096 == 0, "invalid maximum image size")
    url = urlsplit(args.url)
    require(args.url.startswith("https://") and url.hostname and not url.username and not url.password
            and not url.fragment and args.url.isascii() and all(33 <= ord(c) <= 126 for c in args.url),
            "artifact URL must be HTTPS without credentials or fragment")
    require(args.key.is_file(), "signing key missing")
    require(not args.key.resolve().is_relative_to(args.stage.resolve()),
            "signing key must remain outside the staged application")
    public_der = subprocess.check_output(
        ["openssl", "pkey", "-in", str(args.key), "-pubout", "-outform", "DER"],
        stderr=subprocess.DEVNULL,
    )
    require(len(public_der) == len(ED25519_SPKI_PREFIX) + 32 and
            public_der.startswith(ED25519_SPKI_PREFIX), "signing key must be Ed25519")
    validate_tree(args.stage, args.family)
    require(args.output.is_dir() and not args.output.is_symlink(), "output must be an existing directory")
    name = f"{args.id}-{args.version}-{args.arch}"
    destinations = [args.output / (name + suffix) for suffix in (".ext4", ".manifest", ".sig")]
    require(all(not path.exists() and not path.is_symlink() for path in destinations), "output already exists")
    with tempfile.TemporaryDirectory(prefix="workspace-adapter-") as temporary:
        temp = Path(temporary)
        stage = temp / "stage"
        shutil.copytree(args.stage, stage, symlinks=True)
        validate_tree(stage, args.family)
        image = temp / "image.ext4"
        # Leave room for filesystem metadata without filling the signed size ceiling.
        staged_bytes = sum(path.stat().st_size for path in stage.rglob("*") if path.is_file())
        image_size = max(8 * 1024 * 1024, ((staged_bytes * 2 + 8 * 1024 * 1024 + 4095) // 4096) * 4096)
        require(image_size <= args.max_bytes, "staged application exceeds image size ceiling")
        with image.open("wb") as file:
            file.truncate(image_size)
        run("mkfs.ext4", "-q", "-F", "-b", "4096", "-d", str(stage),
            "-U", "00000000-0000-0000-0000-000000000000",
            "-E", "lazy_itable_init=0,lazy_journal_init=0", str(image), str(image_size // 4096))
        run("e2fsck", "-fn", str(image))
        require(image.stat().st_size <= args.max_bytes, "image exceeds signed size ceiling")
        require(image.stat().st_size % 512 == 0, "image is not sector aligned")
        digest = digest_file(image)
        require(digest != "0" * 64, "invalid image digest")
        manifest = ("workspace-adapter-v1\n"
                    f"id={args.id}\nversion={args.version}\narch={args.arch}\nfamily={args.family}\n"
                    f"sha256={digest}\nmax_bytes={args.max_bytes}\nurl={args.url}\n").encode()
        require(len(manifest) <= 1024, "manifest exceeds guest limit")
        manifest_path = temp / "manifest"
        signature_path = temp / "signature"
        public_key = temp / "public.pem"
        manifest_path.write_bytes(manifest)
        run("openssl", "pkey", "-in", str(args.key), "-pubout", "-out", str(public_key))
        run("openssl", "pkeyutl", "-sign", "-rawin", "-inkey", str(args.key),
            "-in", str(manifest_path), "-out", str(signature_path))
        require(signature_path.stat().st_size == 64, "expected an Ed25519 signature")
        run("openssl", "pkeyutl", "-verify", "-pubin", "-inkey", str(public_key),
            "-rawin", "-in", str(manifest_path), "-sigfile", str(signature_path))
        for source, destination in zip((image, manifest_path, signature_path), destinations):
            shutil.copyfile(source, destination)
    return destinations


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--id", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--arch", required=True)
    parser.add_argument("--family", required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--max-bytes", required=True, type=int)
    parser.add_argument("--key", required=True, type=Path)
    args = parser.parse_args()
    try:
        paths = build(args)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"adapter build failed: {error}\n")
    for path in paths:
        print(path)


if __name__ == "__main__":
    main()
