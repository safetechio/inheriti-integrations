"""Local packaging contract for optional application images."""

import importlib.util
from pathlib import Path
import hashlib
import os
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "optional-adapter" / "build.py"
spec = importlib.util.spec_from_file_location("optional_adapter_builder", SCRIPT)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class OptionalAdapterBuilderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.stage = self.root / "stage"
        self.stage.mkdir()
        (self.stage / "bin").mkdir()
        (self.stage / "family").write_text("document\n")
        launch = self.stage / "bin" / "launch"
        launch.write_text("#!/bin/sh\nexit 0\n")
        launch.chmod(0o755)
        self.output = self.root / "output"
        self.output.mkdir()
        self.key = self.root / "release-private.pem"
        subprocess.run(["openssl", "genpkey", "-algorithm", "Ed25519", "-out", str(self.key)], check=True)
        self.args = type("Args", (), dict(stage=self.stage, output=self.output, id="abiword", version="1.0",
                                       arch="x86_64", family="document", url="https://example.org/abiword.ext4",
                                       max_bytes=16 * 1024 * 1024, key=self.key))()

    def test_signed_ext4_contract(self):
        image, manifest, signature = builder.build(self.args)
        self.assertGreaterEqual(image.stat().st_size, 8 * 1024 * 1024)
        self.assertLessEqual(image.stat().st_size, self.args.max_bytes)
        self.assertEqual(image.stat().st_size % 512, 0)
        lines = manifest.read_text().splitlines()
        self.assertEqual(lines[:5], ["workspace-adapter-v1", "id=abiword", "version=1.0",
                                    "arch=x86_64", "family=document"])
        self.assertEqual(lines[5], "sha256=" + hashlib.sha256(image.read_bytes()).hexdigest())
        self.assertEqual(lines[6], "max_bytes=16777216")
        self.assertEqual(signature.stat().st_size, 64)
        public = self.root / "public.pem"
        with public.open("wb") as file:
            subprocess.run(["openssl", "pkey", "-in", str(self.key), "-pubout"], stdout=file, check=True)
        subprocess.run(["openssl", "pkeyutl", "-verify", "-pubin", "-inkey", str(public),
                        "-rawin", "-in", str(manifest), "-sigfile", str(signature)],
                       check=True, stdout=subprocess.DEVNULL)
        contents = subprocess.run(["debugfs", "-R", "cat /family", str(image)], check=True,
                                  capture_output=True, text=True).stdout
        self.assertEqual(contents, "document\n")
        launcher = subprocess.run(["debugfs", "-R", "cat /bin/launch", str(image)], check=True,
                                  capture_output=True, text=True).stdout
        self.assertIn("exit 0", launcher)

    def test_rejects_symlink_and_bad_family(self):
        os.symlink("family", self.stage / "alias")
        with self.assertRaisesRegex(ValueError, "unsafe stage entry"):
            builder.build(self.args)
        (self.stage / "alias").unlink()
        self.args.family = "spreadsheets"
        with self.assertRaisesRegex(ValueError, "family marker mismatch"):
            builder.build(self.args)

    def test_rejects_invalid_url_and_size(self):
        self.args.url = "https://user:password@example.org/file"
        with self.assertRaisesRegex(ValueError, "artifact URL"):
            builder.build(self.args)
        self.args.url = "https://example.org/file"
        self.args.max_bytes = 4096
        with self.assertRaisesRegex(ValueError, "size ceiling"):
            builder.build(self.args)

    def test_signing_key_cannot_enter_application_image(self):
        self.args.key = self.stage / "release-private.pem"
        subprocess.run(["openssl", "genpkey", "-algorithm", "Ed25519", "-out", str(self.args.key)],
                       check=True)
        with self.assertRaisesRegex(ValueError, "outside the staged application"):
            builder.build(self.args)

    def test_rejects_rsa_key_even_with_ed25519_sized_signature(self):
        rsa = self.root / "rsa-private.pem"
        subprocess.run(["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:512",
                        "-out", str(rsa)], check=True, capture_output=True)
        self.args.key = rsa
        with self.assertRaisesRegex(ValueError, "signing key must be Ed25519"):
            builder.build(self.args)
        self.assertEqual(list(self.output.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
