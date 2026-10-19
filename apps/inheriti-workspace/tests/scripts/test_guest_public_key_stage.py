"""Release public-key staging for optional applications."""

import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest


HOOK = Path(__file__).resolve().parents[2] / "guest" / "post-build.sh"


class GuestPublicKeyStageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.target = self.root / "target"
        (self.target / "etc").mkdir(parents=True)
        self.destination = self.target / "etc" / "workspace-adapter-pubkey.pem"
        self.private = self.root / "private.pem"
        self.public = self.root / "public.pem"
        subprocess.run(["openssl", "genpkey", "-algorithm", "Ed25519", "-out", str(self.private)],
                       check=True, capture_output=True)
        with self.public.open("wb") as file:
            subprocess.run(["openssl", "pkey", "-in", str(self.private), "-pubout"],
                           check=True, stdout=file, stderr=subprocess.PIPE)

    def stage(self, key=None):
        env = os.environ.copy()
        env.pop("WORKSPACE_ADAPTER_PUBLIC_KEY_PEM", None)
        if key is not None:
            env["WORKSPACE_ADAPTER_PUBLIC_KEY_PEM"] = str(key)
        return subprocess.run(["bash", str(HOOK), str(self.target)], env=env,
                              capture_output=True, text=True)

    def test_stages_only_public_ed25519_key(self):
        result = self.stage(self.public)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.destination.read_bytes(), self.public.read_bytes())
        self.assertEqual(stat.S_IMODE(self.destination.stat().st_mode), 0o444)
        self.assertNotIn(self.private.read_bytes(), self.destination.read_bytes())

    def test_keyless_build_removes_stale_key(self):
        self.assertEqual(self.stage(self.public).returncode, 0)
        self.assertEqual(self.stage().returncode, 0)
        self.assertFalse(self.destination.exists())

    def test_rejects_public_pem_with_appended_private_key(self):
        concatenated = self.root / "concatenated.pem"
        concatenated.write_bytes(self.public.read_bytes() + self.private.read_bytes())
        result = self.stage(concatenated)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.destination.exists())
        self.assertFalse(any((self.target / "etc").glob(".workspace-adapter-pubkey.*")))

    def test_rejects_private_wrong_algorithm_symlink_and_oversize(self):
        rsa_private = self.root / "rsa-private.pem"
        rsa_public = self.root / "rsa-public.pem"
        subprocess.run(["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048",
                        "-out", str(rsa_private)], check=True, capture_output=True)
        with rsa_public.open("wb") as file:
            subprocess.run(["openssl", "pkey", "-in", str(rsa_private), "-pubout"],
                           check=True, stdout=file, stderr=subprocess.PIPE)
        symlink = self.root / "link.pem"
        symlink.symlink_to(self.public)
        oversized = self.root / "oversized.pem"
        oversized.write_bytes(b"x" * 4097)
        for key in (self.private, rsa_public, symlink, oversized, self.root / "missing.pem"):
            with self.subTest(key=key.name):
                self.destination.write_bytes(b"stale")
                result = self.stage(key)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(self.destination.exists())


if __name__ == "__main__":
    unittest.main()
