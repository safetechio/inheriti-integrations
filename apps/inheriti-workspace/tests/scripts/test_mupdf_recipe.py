"""Checks for the optional guest-built MuPDF package recipe."""

import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/optional-adapter/recipes/mupdf/build.py"
spec = importlib.util.spec_from_file_location("mupdf_recipe", SCRIPT)
recipe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recipe)


class MuPdfRecipeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.target = self.root / "target"
        (self.target / "usr/bin").mkdir(parents=True)
        (self.target / "usr/lib").mkdir()
        (self.target / "usr/bin/mupdf-x11").write_bytes(b"mock binary")
        (self.target / "usr/lib/libmupdf.so").write_bytes(b"mock library")
        (self.target / "usr/lib/ld-linux-x86-64.so.2").write_bytes(b"mock loader")
        self.stage = self.root / "stage"

    def mock_readelf(self, path, flag):
        if flag == "-h":
            return "Class: ELF64\nMachine: Advanced Micro Devices X86-64\n"
        if path.name == "mupdf-x11":
            return "(NEEDED) Shared library: [libmupdf.so]\n"
        return ""

    def test_stages_launcher_and_dependency_closure(self):
        with patch.object(recipe, "readelf", side_effect=self.mock_readelf):
            copied = recipe.stage(self.target, self.stage, "x86_64")
        self.assertEqual(copied, {"libmupdf.so", "ld-linux-x86-64.so.2"})
        self.assertEqual((self.stage / "family").read_text(), "pdf\n")
        self.assertEqual((self.stage / "lib/libmupdf.so").read_bytes(), b"mock library")
        launcher = (self.stage / "bin/launch").read_text()
        self.assertIn('ld-linux-x86-64.so.2" --library-path "$app/lib"', launcher)
        self.assertIn('mupdf-x11" "$1"', launcher)
        self.assertNotIn('"$@"', launcher)
        self.assertTrue(os.access(self.stage / "bin/launch", os.X_OK))
        self.assertFalse(any(path.is_symlink() for path in self.stage.rglob("*")))

    def test_missing_dependency_fails_closed(self):
        (self.target / "usr/lib/libmupdf.so").unlink()
        with patch.object(recipe, "readelf", side_effect=self.mock_readelf):
            with self.assertRaisesRegex(ValueError, "missing guest ELF dependency"):
                recipe.stage(self.target, self.stage, "x86_64")

    def test_symlink_escape_fails_closed(self):
        (self.target / "usr/lib/libmupdf.so").unlink()
        (self.target / "usr/lib/libmupdf.so").symlink_to("/etc/passwd")
        with patch.object(recipe, "readelf", side_effect=self.mock_readelf):
            with self.assertRaisesRegex(ValueError, "escapes guest target"):
                recipe.stage(self.target, self.stage, "x86_64")

    def test_wrong_architecture_fails_closed(self):
        with patch.object(recipe, "readelf", return_value="Class: ELF64\nMachine: AArch64\n"):
            with self.assertRaisesRegex(ValueError, "wrong guest ELF architecture"):
                recipe.stage(self.target, self.stage, "x86_64")

    def test_aarch64_uses_bundled_loader(self):
        (self.target / "usr/lib/ld-linux-aarch64.so.1").write_bytes(b"mock arm loader")

        def arm_readelf(path, flag):
            return self.mock_readelf(path, flag).replace("Advanced Micro Devices X86-64", "AArch64")

        with patch.object(recipe, "readelf", side_effect=arm_readelf):
            copied = recipe.stage(self.target, self.stage, "aarch64")
        self.assertIn("ld-linux-aarch64.so.1", copied)
        self.assertIn('ld-linux-aarch64.so.1" --library-path "$app/lib"',
                      (self.stage / "bin/launch").read_text())

    def test_launcher_passes_only_pdf_to_bundled_loader(self):
        with patch.object(recipe, "readelf", side_effect=self.mock_readelf):
            recipe.stage(self.target, self.stage, "x86_64")
        loader = self.stage / "lib/ld-linux-x86-64.so.2"
        loader.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$WORKSPACE_ARGS_FILE"\n')
        loader.chmod(0o755)
        launcher = self.stage / "bin/launch"
        launcher.write_text(launcher.read_text().replace("/opt/workspace/apps", str(self.stage)))
        arguments = self.root / "args"
        subprocess.run([str(launcher), "/run/document.pdf", "/run/session"], check=True,
                       env={**os.environ, "WORKSPACE_ARGS_FILE": str(arguments)})
        self.assertEqual(arguments.read_text().splitlines(),
                         ["--library-path", str(self.stage / "lib"),
                          str(self.stage / "bin/mupdf-x11"), "/run/document.pdf"])

    @unittest.skipUnless(os.environ.get("WORKSPACE_GUEST_TARGET"), "set WORKSPACE_GUEST_TARGET for real closure test")
    def test_real_buildroot_guest_closure(self):
        target = Path(os.environ["WORKSPACE_GUEST_TARGET"])
        copied = recipe.stage(target, self.stage, "x86_64")
        self.assertIn("libmupdf.so", copied)
        self.assertGreater(len(copied), 5)
        self.assertLessEqual(len(copied), recipe.MAX_FILES)
        result = subprocess.run([str(self.stage / "lib/ld-linux-x86-64.so.2"),
                                 "--library-path", str(self.stage / "lib"), "--verify",
                                 str(self.stage / "bin/mupdf-x11")], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
