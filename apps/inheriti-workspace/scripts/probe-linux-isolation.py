#!/usr/bin/env python3
"""Synthetic Linux namespace probe; no protected file material is used."""

import pathlib
import base64
import os
import re
import socket
import subprocess
import sys
import tempfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "src-tauri" / "Cargo.toml"
BINARIES = ("preview-helper", "isolation-probe")


def runtime_libraries(binary):
    output = subprocess.check_output(("ldd", str(binary)), text=True)
    paths = {pathlib.Path(path) for path in re.findall(r"(?<!\S)(/[\w./+-]+)", output)}
    if not paths or "not found" in output:
        raise RuntimeError(f"unresolved runtime library for {binary.name}")
    return paths


def sandbox_command(binary, libraries):
    directories = {pathlib.Path("/app")}
    for library in libraries:
        parent = library.parent
        while parent != pathlib.Path("/"):
            directories.add(parent)
            parent = parent.parent
    command = ["bwrap", "--unshare-net", "--unshare-pid", "--unshare-ipc", "--clearenv", "--die-with-parent", "--new-session"]
    for directory in sorted(directories, key=lambda path: (len(path.parts), str(path))):
        command.extend(("--dir", str(directory)))
    command.extend(("--proc", "/proc", "--dev", "/dev", "--ro-bind", str(binary), "/app/probe"))
    for library in sorted(libraries):
        command.extend(("--ro-bind", str(library), str(library)))
    return command + ["/app/probe"]


def pdf_sandbox_command(program):
    libraries = runtime_libraries(program)
    command = sandbox_command(program, libraries)
    command[command.index("--proc"):command.index("--proc")] = ["--dir", "/usr/share", "--dir", "/etc"]
    for directory in ("/usr/share/poppler", "/usr/share/fonts", "/etc/fonts"):
        if pathlib.Path(directory).is_dir():
            command[-1:-1] = ["--ro-bind", directory, directory]
    return command


def synthetic_pdf():
    objects = (
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents 4 0 R >>",
        "<< /Length 0 >>\nstream\n\nendstream",
    )
    result = bytearray(b"%PDF-1.4\n")
    offsets = []
    for index, obj in enumerate(objects, 1):
        offsets.append(len(result))
        result.extend(f"{index} 0 obj\n{obj}\nendobj\n".encode())
    xref = len(result)
    result.extend(b"xref\n0 5\n0000000000 65535 f \n")
    for offset in offsets:
        result.extend(f"{offset:010} 00000 n \n".encode())
    result.extend(f"trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(result)


def main():
    with tempfile.TemporaryDirectory(prefix="viewer-isolation-") as directory:
        probe = pathlib.Path(directory) / "isolation-probe"
        subprocess.run(("rustc", str(ROOT / "scripts" / "isolation-probe.rs"), "-o", str(probe)), check=True)
        if sys.argv[1:] == ["--installed"]:
            helper = pathlib.Path("/usr/bin/preview-helper")
            if not helper.is_file():
                raise RuntimeError("installed preview-helper missing")
        elif len(sys.argv) == 2:
            package = pathlib.Path(sys.argv[1]).resolve()
            extracted = pathlib.Path(directory) / "package"
            subprocess.run(("dpkg-deb", "-x", str(package), str(extracted)), check=True)
            helper = extracted / "usr" / "bin" / "preview-helper"
        elif len(sys.argv) == 1:
            subprocess.run(
                ("cargo", "build", "--offline", "--manifest-path", str(MANIFEST), "--bin", BINARIES[0]),
                check=True,
            )
            helper = ROOT / "src-tauri" / "target" / "debug" / "preview-helper"
        else:
            raise RuntimeError("usage: probe-linux-isolation.py [viewer.deb|--installed]")
        binaries = {"preview-helper": helper, "isolation-probe": probe}
        libraries = set().union(*(runtime_libraries(binary) for binary in binaries.values()))
        canary = pathlib.Path(directory) / "outside-mounts"
        canary.write_text("synthetic canary", encoding="utf-8")
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
            port = listener.getsockname()[1]
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                pass
            probe = subprocess.run(
                sandbox_command(binaries["isolation-probe"], libraries) + [str(canary), str(port), os.readlink('/proc/self/ns/ipc')],
                capture_output=True, text=True, timeout=10,
            )
            if probe.returncode:
                raise RuntimeError(f"namespace probe failed ({probe.returncode}): {probe.stderr or probe.stdout}")
            if probe.stdout.strip() != "canary_blocked=true network_blocked=true ipc_isolated=true":
                raise RuntimeError(f"unexpected probe result: {probe.stdout}")
            helper = subprocess.run(
                sandbox_command(binaries["preview-helper"], libraries),
                input="Synthetic safe text\n", capture_output=True, text=True, timeout=10,
            )
            if helper.returncode or helper.stdout != "Synthetic safe text\n":
                raise RuntimeError(f"helper failed ({helper.returncode}): {helper.stderr}")
            for hostile in (b"<script>alert(1)</script>", b"\x7fELF\x00", b"a" * (64 * 1024 + 1)):
                rejected = subprocess.run(
                    sandbox_command(binaries["preview-helper"], libraries),
                    input=hostile, capture_output=True, timeout=10,
                )
                if rejected.returncode == 0 or rejected.stdout:
                    raise RuntimeError("packaged helper accepted hostile input")
            webp = base64.b64decode("UklGRiAAAABXRUJQVlA4TBQAAAAvAAAAAAdQgVQIIAAKmv7HiIj+Bw==")
            image = subprocess.run(
                sandbox_command(binaries["preview-helper"], libraries) + ["--webp"],
                input=webp, capture_output=True, timeout=10,
            )
            if image.returncode or image.stdout != b"\x01\x00\x00\x00\x01\x00\x00\x00\x01\x02\x03\xff":
                raise RuntimeError("packaged helper failed bounded WebP decode")
            rejected_image = subprocess.run(
                sandbox_command(binaries["preview-helper"], libraries) + ["--webp"],
                input=b"bad WebP", capture_output=True, timeout=10,
            )
            if rejected_image.returncode == 0 or rejected_image.stdout:
                raise RuntimeError("packaged helper accepted malformed WebP")
            pdf = synthetic_pdf()
            metadata = subprocess.run(pdf_sandbox_command(pathlib.Path("/usr/bin/pdfinfo")) + ["-"],
                                      input=pdf, capture_output=True, timeout=10)
            if metadata.returncode or b"Pages:           1" not in metadata.stdout:
                raise RuntimeError("isolated PDF metadata failed")
            page = subprocess.run(pdf_sandbox_command(pathlib.Path("/usr/bin/pdftoppm")) +
                                  ["-f", "1", "-l", "1", "-singlefile", "-scale-to", "16", "-"],
                                  input=pdf, capture_output=True, timeout=10)
            if page.returncode or not page.stdout.startswith(b"P6\n"):
                raise RuntimeError("isolated PDF raster failed")
            print("Linux bwrap: canary blocked, host listener unreachable, text/WebP/PDF accepted, hostile inputs rejected")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
