#!/usr/bin/env python3
"""Signed optional app descriptors must be checked before disk mount."""
import base64
import hashlib
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import unittest

GUEST = Path(__file__).resolve().parents[2] / "guest"
SCRIPT = GUEST / "overlay/usr/sbin/workspace-mount-adapter"


class AdapterMountTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="workspace-app-mount-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.device = self.root / "vda"
        self.key = self.root / "public.pem"
        self.private = self.root / "private.pem"
        self.cmdline = self.root / "cmdline"
        self.target = self.root / "apps"
        self.mount_log = self.root / "mount-args"
        fake_bin = self.root / "bin"
        fake_bin.mkdir()
        mount = fake_bin / "mount"
        mount.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$MOUNT_LOG"\n'
                         'mkdir -p "$MOUNT_TARGET/bin"\nprintf "%s\\n" "$MOUNT_FAMILY" > "$MOUNT_TARGET/family"\n'
                         'if [ "$MOUNT_LAUNCH" = yes ]; then\n'
                         '  printf "#!/bin/sh\\nexit 0\\n" > "$MOUNT_TARGET/bin/launch"\n'
                         '  chmod +x "$MOUNT_TARGET/bin/launch"\nfi\n')
        mount.chmod(0o755)
        source = SCRIPT.read_text()
        for original, replacement in (
            ("device=/dev/vda", f"device={self.device}"),
            ("key=/etc/workspace-adapter-pubkey.pem", f"key={self.key}"),
            ("cmdline=/proc/cmdline", f"cmdline={self.cmdline}"),
            ("target=/opt/workspace/apps", f"target={self.target}"),
            ("manifest=/run/workspace-adapter.manifest", f"manifest={self.root / 'manifest'}"),
            ("signature=/run/workspace-adapter.signature", f"signature={self.root / 'signature'}"),
        ):
            self.assertIn(original, source)
            source = source.replace(original, replacement, 1)
        self.script = self.root / "gate"
        self.script.write_text(source)
        self.env = {**os.environ, "PATH": f"{fake_bin}:{os.environ['PATH']}",
                    "MOUNT_LOG": str(self.mount_log), "MOUNT_TARGET": str(self.target),
                    "MOUNT_FAMILY": "spreadsheet", "MOUNT_LAUNCH": "yes"}
        subprocess.run(["openssl", "genpkey", "-algorithm", "ED25519", "-out", str(self.private)],
                       check=True, capture_output=True)
        subprocess.run(["openssl", "pkey", "-in", str(self.private), "-pubout", "-out", str(self.key)],
                       check=True, capture_output=True)

    def descriptor(self, *, digest=None, size=None, family="spreadsheet", arch=None,
                   url="https://example.com/gridcraft.ext4"):
        digest = digest or hashlib.sha256(self.device.read_bytes()).hexdigest()
        size = size or len(self.device.read_bytes())
        arch = arch or platform.machine()
        return (f"workspace-adapter-v1\nid=gridcraft\nversion=1.0\narch={arch}\n"
                f"family={family}\nsha256={digest}\nmax_bytes={size}\n"
                f"url={url}\n").encode()

    def authorize(self, manifest):
        document = self.root / "document"
        document.write_bytes(manifest)
        signature = self.root / "signed"
        subprocess.run(["openssl", "pkeyutl", "-sign", "-inkey", str(self.private),
                        "-rawin", "-in", str(document), "-out", str(signature)],
                       check=True, capture_output=True)
        encoded = lambda data: base64.b64encode(data).decode()
        self.cmdline.write_text("console=ttyS0 "
            f"workspace.adapter.manifest={encoded(manifest)} "
            f"workspace.adapter.signature={encoded(signature.read_bytes())}\n")

    def authorize_artifacts(self, manifest, signature):
        encoded = lambda data: base64.b64encode(data).decode()
        self.cmdline.write_text("console=ttyS0 "
            f"workspace.adapter.manifest={encoded(manifest)} "
            f"workspace.adapter.signature={encoded(signature)}\n")

    def run_gate(self):
        return subprocess.run(["sh", str(self.script)], env=self.env,
                              capture_output=True, text=True)

    def test_absent_image_keeps_fixed_base_working(self):
        self.cmdline.write_text("console=ttyS0\n")
        self.assertEqual(self.run_gate().returncode, 0)
        self.assertFalse(self.mount_log.exists())

    def test_requested_image_missing_fails_before_agent_start(self):
        self.device.write_bytes(b"image")
        self.authorize(self.descriptor())
        self.device.unlink()
        self.assertNotEqual(self.run_gate().returncode, 0)
        self.assertFalse(self.mount_log.exists())

    def test_signed_image_mounts_read_only(self):
        self.device.write_bytes(b"approved adapter image")
        self.authorize(self.descriptor())
        result = self.run_gate()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.mount_log.read_text().splitlines(), [
            "-t", "ext4", "-o", "ro,noload,nosuid,nodev", str(self.device), str(self.target)])

    def test_builder_artifacts_mount_and_tamper_rejection(self):
        guest_arch = {"x86_64": "x86_64", "amd64": "x86_64",
                      "aarch64": "aarch64", "arm64": "aarch64"}.get(platform.machine())
        if guest_arch is None:
            self.skipTest(f"unsupported local architecture: {platform.machine()}")

        stage = self.root / "staged-gridcraft"
        (stage / "bin").mkdir(parents=True)
        (stage / "family").write_text("spreadsheet\n")
        launcher = stage / "bin" / "launch"
        launcher.write_text("#!/bin/sh\nexit 0\n")
        launcher.chmod(0o755)
        output = self.root / "artifacts"
        output.mkdir()
        builder = Path(__file__).resolve().parents[2] / "scripts" / "optional-adapter" / "build.py"
        subprocess.run([
            sys.executable, str(builder), "--stage", str(stage), "--output", str(output),
            "--id", "gridcraft", "--version", "1.0", "--arch", guest_arch,
            "--family", "spreadsheet", "--url", "https://releases.example.org/gridcraft-1.0.ext4",
            "--max-bytes", str(16 * 1024 * 1024), "--key", str(self.private),
        ], check=True, capture_output=True, text=True)

        image_path = output / f"gridcraft-1.0-{guest_arch}.ext4"
        manifest_path = output / f"gridcraft-1.0-{guest_arch}.manifest"
        signature_path = output / f"gridcraft-1.0-{guest_arch}.sig"
        self.assertTrue(image_path.is_file())
        self.assertTrue(manifest_path.is_file())
        self.assertTrue(signature_path.is_file())
        image = image_path.read_bytes()
        manifest = manifest_path.read_bytes()
        signature = signature_path.read_bytes()
        self.assertGreaterEqual(len(image), 8 * 1024 * 1024)
        self.assertEqual(len(signature), 64)
        self.device.write_bytes(image)
        self.authorize_artifacts(manifest, signature)

        accepted = self.run_gate()
        self.assertEqual(accepted.returncode, 0, accepted.stderr)
        self.assertEqual(self.mount_log.read_text().splitlines(), [
            "-t", "ext4", "-o", "ro,noload,nosuid,nodev", str(self.device), str(self.target)])

        self.mount_log.unlink()
        tampered_image = bytearray(image)
        tampered_image[0] ^= 0x01
        self.device.write_bytes(tampered_image)
        rejected_image = self.run_gate()
        self.assertNotEqual(rejected_image.returncode, 0, rejected_image.stderr)
        self.assertFalse(self.mount_log.exists())

        self.device.write_bytes(image)
        self.mount_log.unlink(missing_ok=True)
        tampered_signature = bytearray(signature)
        tampered_signature[-1] ^= 0x01
        self.authorize_artifacts(manifest, tampered_signature)
        rejected_signature = self.run_gate()
        self.assertNotEqual(rejected_signature.returncode, 0, rejected_signature.stderr)
        self.assertFalse(self.mount_log.exists())

    def test_signed_ipv6_https_url_uses_same_guest_grammar(self):
        self.device.write_bytes(b"approved adapter image")
        self.authorize(self.descriptor(url="https://[::1]/adapter.bundle"))
        self.assertEqual(self.run_gate().returncode, 0)

    def test_missing_signature_or_key_rejected_before_mount(self):
        self.device.write_bytes(b"image")
        self.authorize(self.descriptor())
        self.cmdline.write_text(self.cmdline.read_text().split(" workspace.adapter.signature=")[0] + "\n")
        self.assertNotEqual(self.run_gate().returncode, 0)
        self.assertFalse(self.mount_log.exists())
        self.authorize(self.descriptor())
        self.key.unlink()
        self.assertNotEqual(self.run_gate().returncode, 0)
        self.key.write_text("invalid")
        self.assertNotEqual(self.run_gate().returncode, 0)
        self.assertFalse(self.mount_log.exists())

    def test_modified_image_and_wrong_arch_rejected(self):
        self.device.write_bytes(b"image")
        self.authorize(self.descriptor())
        self.device.write_bytes(b"changed")
        self.assertNotEqual(self.run_gate().returncode, 0)
        self.assertFalse(self.mount_log.exists())
        self.authorize(self.descriptor(arch="aarch64" if platform.machine() == "x86_64" else "x86_64"))
        self.assertNotEqual(self.run_gate().returncode, 0)
        self.assertFalse(self.mount_log.exists())

    def test_modified_manifest_rejected_before_mount(self):
        self.device.write_bytes(b"image")
        self.authorize(self.descriptor())
        self.cmdline.write_text(self.cmdline.read_text().replace("console=ttyS0", "console=ttyS1"))
        # Kernel parameters unrelated to the signed descriptor are harmless.
        self.assertEqual(self.run_gate().returncode, 0)
        self.mount_log.unlink()
        self.authorize(self.descriptor())
        self.cmdline.write_text(self.cmdline.read_text().replace("workspace.adapter.signature=", "workspace.adapter.signature=A"))
        self.assertNotEqual(self.run_gate().returncode, 0)
        self.assertFalse(self.mount_log.exists())

    def test_signed_family_must_match_mounted_image(self):
        self.device.write_bytes(b"image")
        self.authorize(self.descriptor(family="document"))
        self.assertNotEqual(self.run_gate().returncode, 0)

    def test_missing_launcher_rejected_after_verification(self):
        self.device.write_bytes(b"image")
        self.authorize(self.descriptor())
        self.env["MOUNT_LAUNCH"] = "no"
        self.assertNotEqual(self.run_gate().returncode, 0)

    def test_signed_noncanonical_descriptor_rejected_before_mount(self):
        self.device.write_bytes(b"image")
        self.authorize(self.descriptor().replace(b"version=1.0\n", b"version=1.0\r\n"))
        self.assertNotEqual(self.run_gate().returncode, 0)
        self.assertFalse(self.mount_log.exists())


if __name__ == "__main__":
    unittest.main()
