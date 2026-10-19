#!/usr/bin/env python3
"""Real KVM boot and virtio protocol probe; no production app integration."""
import argparse
import os
import pathlib
import socket
import struct
import subprocess
import tempfile
import time


def frame(sock, opcode, name, payload=b""):
    encoded = name.encode()
    sock.sendall(struct.pack(">BHI", opcode, len(encoded), len(payload)) + encoded + payload)
    return sock.recv(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--kernel", type=pathlib.Path, required=True)
    parser.add_argument("--initramfs", type=pathlib.Path, required=True)
    parser.add_argument("--image", default="inheriti-workspace-qemu-local")
    parser.add_argument("--pdf-fixture", type=pathlib.Path)
    args = parser.parse_args()
    kernel = args.kernel.resolve(strict=True)
    initramfs = args.initramfs.resolve(strict=True)
    if kernel.parent != initramfs.parent:
        parser.error("kernel and initramfs must share a directory for the Docker bind mount")
    with tempfile.TemporaryDirectory(prefix="workspace-", dir=kernel.parent) as directory:
        socket_path = pathlib.Path(directory) / "guest.sock"
        cidfile = pathlib.Path(directory) / "container.cid"
        command = [
            "docker", "run", "--rm", "--cidfile", str(cidfile),
            "--network", "none", "--device", "/dev/kvm",
            "--cap-drop", "ALL", "--memory", "512m", "--pids-limit", "64",
            "--user", f"{os.getuid()}:{os.getgid()}",
            "--group-add", str(os.stat("/dev/kvm").st_gid),
            "--security-opt", "no-new-privileges",
            "-v", f"{kernel.parent}:{kernel.parent}:rw", args.image,
            "-nodefaults", "-no-user-config", "-machine", "q35,accel=kvm",
            "-cpu", "host", "-smp", "1", "-m", "256", "-display", "none",
            "-monitor", "none", "-serial", "stdio", "-nic", "none",
            "-kernel", str(kernel), "-initrd", str(initramfs),
            "-append", "console=ttyS0 panic=1 rdinit=/init",
            "-chardev", f"socket,id=ingress,path={socket_path},server=on,wait=off",
            "-device", "virtio-serial-pci",
            "-device", "virtserialport,chardev=ingress,name=org.inheriti.workspace",
        ]
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 20
            while True:
                if process.poll() is not None:
                    raise RuntimeError(f"QEMU exited: {process.stderr.read().decode(errors='replace')}")
                try:
                    guest = socket.socket(socket.AF_UNIX)
                    guest.connect(str(socket_path))
                    break
                except (FileNotFoundError, ConnectionRefusedError):
                    guest.close()
                    if time.monotonic() >= deadline:
                        raise TimeoutError("QEMU virtio socket did not appear")
                    time.sleep(0.05)
            with guest:
                guest.settimeout(10)
                assert guest.recv(1) == b"R"
                payload = args.pdf_fixture.read_bytes() if args.pdf_fixture else b"%PDF-1.7\nWorkspace guest probe\n"
                assert frame(guest, 1, "sample.pdf", payload) == b"\x06"
                assert frame(guest, 2, "sample.pdf") == b"\x06"
                if cidfile.exists():
                    container_id = cidfile.read_text().strip()
                    usage = subprocess.check_output(
                        ["docker", "stats", "--no-stream", "--format", "{{.MemUsage}}", container_id],
                        text=True,
                    ).strip()
                    print(f"Docker QEMU memory while active: {usage}")
            print("VM boot, tmpfs ingress, and PDF probe passed")
        finally:
            if cidfile.exists():
                container_id = cidfile.read_text().strip()
                subprocess.run(["docker", "rm", "-f", container_id], capture_output=True, check=False)
            process.terminate()
            try:
                stdout, stderr = process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                stdout, stderr = process.communicate()
            if os.environ.get("WORKSPACE_VM_DEBUG"):
                print(stdout.decode(errors="replace")[-6000:])
                print(stderr.decode(errors="replace")[-2000:])
            if cidfile.exists():
                result = subprocess.run(
                    ["docker", "inspect", "--format", "{{.State.Running}}", cidfile.read_text().strip()],
                    capture_output=True,
                )
                if result.returncode == 0:
                    raise RuntimeError("QEMU Docker container survived test teardown")


if __name__ == "__main__":
    main()
