#!/usr/bin/env python3
"""Opt-in KVM probe for a signed optional adapter and an original DOCX.

This probe intentionally does not create or install a guest image.  The private
key must be the release key whose public half was embedded in the guest during
its build.  The key is only read by the local adapter packager and is never
copied into the temporary adapter image.
"""

from __future__ import annotations

import argparse
import base64
import os
from pathlib import Path
import signal
import socket
import struct
import subprocess
import tempfile
import time


ROOT = Path(__file__).resolve().parents[2]
BUILDER = ROOT / "scripts" / "optional-adapter" / "build.py"
DOCX_FIXTURE = ROOT / "tests" / "fixtures" / "sample-letter.docx"


def run_checked(command: list[str]) -> None:
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL)


def verify_key_pair(private_key: Path, public_key: Path) -> None:
    """Fail before boot if the signing key is not the guest's public key."""

    with tempfile.TemporaryDirectory(prefix="workspace-adapter-key-") as directory:
        derived = Path(directory) / "derived.pem"
        run_checked(["openssl", "pkey", "-in", str(private_key), "-pubout", "-out", str(derived)])
        run_checked(["openssl", "pkey", "-pubin", "-in", str(public_key), "-pubout", "-out", str(derived) + ".canonical"])
        if derived.read_bytes() != (Path(str(derived) + ".canonical")).read_bytes():
            raise RuntimeError("--private-key does not match --public-key embedded in the guest")


def frame(channel: socket.socket, opcode: int, name: str, payload: bytes = b"") -> bytes:
    encoded = name.encode("utf-8")
    channel.sendall(struct.pack(">BHI", opcode, len(encoded), len(payload)) + encoded + payload)
    return channel.recv(1)


def qemu_command(
    qemu: Path,
    kernel: Path,
    initramfs: Path,
    image: Path,
    manifest: bytes,
    signature: bytes,
    socket_path: Path,
    serial_log: Path,
) -> list[str]:
    encoded_manifest = base64.b64encode(manifest).decode("ascii")
    encoded_signature = base64.b64encode(signature).decode("ascii")
    append = (
        "console=ttyS0 panic=1 "
        f"workspace.adapter.manifest={encoded_manifest} "
        f"workspace.adapter.signature={encoded_signature}"
    )
    return [
        str(qemu), "-nodefaults", "-no-user-config",
        "-machine", "q35,accel=kvm,dump-guest-core=off", "-cpu", "host",
        "-smp", "1", "-m", "384", "-display", "none", "-monitor", "none",
        "-serial", f"file:{serial_log}", "-nic", "none",
        "-kernel", str(kernel), "-initrd", str(initramfs), "-append", append,
        "-chardev", f"socket,id=ingress,path={socket_path},server=on,wait=off",
        "-device", "virtio-serial-pci",
        "-device", "virtserialport,chardev=ingress,name=org.inheriti.workspace",
        "-device", "virtio-gpu-pci", "-device", "virtio-keyboard-pci",
        "-device", "virtio-tablet-pci",
        "-drive", f"media=disk,if=none,id=workspace_apps,file={image},format=raw,readonly=on",
        "-device", "virtio-blk-pci,drive=workspace_apps",
    ]


def stop(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)


def wait_for_socket(process: subprocess.Popen[bytes], path: Path, timeout: float) -> socket.socket:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"QEMU exited before the guest channel was ready ({process.returncode})")
        channel = socket.socket(socket.AF_UNIX)
        try:
            channel.connect(str(path))
            return channel
        except (FileNotFoundError, ConnectionRefusedError):
            channel.close()
            time.sleep(0.1)
    raise TimeoutError("guest virtio channel did not become available")


def run_positive(command: list[str], socket_path: Path, serial_log: Path, fixture: bytes) -> None:
    process = subprocess.Popen(command, start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        with wait_for_socket(process, socket_path, 45) as channel:
            channel.settimeout(20)
            if channel.recv(1) != b"R":
                raise RuntimeError("guest did not report ready")
            name = "sample-letter.docx"
            if frame(channel, 1, name, fixture) != b"\x06":
                raise RuntimeError("guest rejected the valid DOCX admission")
            if frame(channel, 2, name) != b"\x06":
                raise RuntimeError("guest rejected the valid DOCX launch")
    finally:
        stop(process)
        if process.returncode not in (0, -signal.SIGTERM, -signal.SIGKILL):
            stderr = process.stderr.read().decode(errors="replace")[-2000:] if process.stderr else ""
            raise RuntimeError(f"QEMU failed ({process.returncode}): {stderr}")


def run_rejected_ooxml(command: list[str], socket_path: Path) -> None:
    process = subprocess.Popen(command, start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        with wait_for_socket(process, socket_path, 45) as channel:
            channel.settimeout(20)
            if channel.recv(1) != b"R":
                raise RuntimeError("guest did not report ready for OOXML rejection probe")
            if frame(channel, 1, "invalid.docx", b"PK\x03\x04not-an-office-document") != b"\x15":
                raise RuntimeError("guest admitted malformed OOXML to optional application")
    finally:
        stop(process)


def run_negative(command: list[str], socket_path: Path, serial_log: Path) -> None:
    process = subprocess.Popen(command, start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if process.poll() is not None:
                break
            if socket_path.exists():
                # QEMU creates the host-side socket before the guest has
                # mounted the adapter.  The guest readiness byte is the
                # meaningful boundary here.
                channel = socket.socket(socket.AF_UNIX)
                try:
                    channel.settimeout(0.5)
                    channel.connect(str(socket_path))
                    if channel.recv(1) == b"R":
                        raise RuntimeError("guest reported ready after a bad adapter signature")
                except (ConnectionRefusedError, FileNotFoundError, TimeoutError):
                    pass
                finally:
                    channel.close()
            time.sleep(0.1)
        if process.poll() is None:
            raise TimeoutError("guest did not power off after a bad adapter signature")
    finally:
        stop(process)


def build_adapter(private_key: Path, output: Path, stage: Path) -> tuple[Path, Path, Path]:
    launcher = stage / "bin" / "launch"
    stage.joinpath("family").write_text("document\n")
    launcher.write_text(
        "#!/bin/sh\n"
        "[ -r \"$1\" ] && [ \"$(wc -c < \"$1\")\" -gt 0 ] || exit 1\n"
        "exec /usr/bin/xterm -e /bin/sh -c 'sleep 30'\n"
    )
    launcher.chmod(0o755)
    result = subprocess.run(
        ["python3", str(BUILDER), "--stage", str(stage), "--output", str(output),
         "--id", "document-smoke", "--version", "1.0", "--arch", "x86_64",
         "--family", "document", "--url", "https://example.invalid/document-smoke.ext4",
         "--max-bytes", str(16 * 1024 * 1024), "--key", str(private_key)],
        check=True, capture_output=True, text=True,
    )
    paths = [Path(line) for line in result.stdout.splitlines()]
    if len(paths) != 3:
        raise RuntimeError("adapter builder did not return its three artifacts")
    return paths[0], paths[1], paths[2]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--qemu", required=True, type=Path)
    parser.add_argument("--kernel", required=True, type=Path)
    parser.add_argument("--initramfs", required=True, type=Path)
    parser.add_argument("--private-key", required=True, type=Path)
    parser.add_argument("--public-key", required=True, type=Path,
                        help="the same public PEM staged into /etc/workspace-adapter-pubkey.pem")
    parser.add_argument("--fixture", type=Path, default=DOCX_FIXTURE)
    parser.add_argument("--skip-negative", action="store_true")
    args = parser.parse_args()
    for path in (args.qemu, args.kernel, args.initramfs, args.private_key, args.public_key, args.fixture):
        if not path.is_file():
            parser.error(f"file not found: {path}")
    verify_key_pair(args.private_key, args.public_key)
    with tempfile.TemporaryDirectory(prefix="workspace-signed-adapter-vm-") as directory:
        root = Path(directory)
        stage = root / "stage"
        (stage / "bin").mkdir(parents=True)
        output = root / "adapter"
        output.mkdir()
        image, manifest_path, signature_path = build_adapter(args.private_key, output, stage)
        manifest = manifest_path.read_bytes()
        signature = signature_path.read_bytes()
        socket_path = root / "guest.sock"
        serial_log = root / "serial.log"
        command = qemu_command(args.qemu, args.kernel, args.initramfs, image, manifest, signature, socket_path, serial_log)
        run_positive(command, socket_path, serial_log, args.fixture.read_bytes())
        print("SIGNED_OPTIONAL_DOCX_VM_SESSION_OK")
        if not args.skip_negative:
            socket_path.unlink(missing_ok=True)
            run_rejected_ooxml(qemu_command(args.qemu, args.kernel, args.initramfs, image,
                                            manifest, signature, socket_path, root / "serial-invalid-docx.log"),
                               socket_path)
            print("MALFORMED_OOXML_REJECTED_VM_OK")
            bad_signature = bytearray(signature)
            bad_signature[0] ^= 1
            socket_path.unlink(missing_ok=True)
            run_negative(qemu_command(args.qemu, args.kernel, args.initramfs, image, manifest,
                                      bytes(bad_signature), socket_path, root / "serial-bad.log"),
                         socket_path, root / "serial-bad.log")
            print("BAD_SIGNATURE_FAIL_CLOSED_OK")


if __name__ == "__main__":
    main()
