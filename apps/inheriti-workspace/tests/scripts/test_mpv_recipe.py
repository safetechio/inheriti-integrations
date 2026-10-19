"""Contracts for the optional guest-built mpv video adapter."""

import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/optional-adapter/recipes/mpv/build.py"
spec = importlib.util.spec_from_file_location("mpv_recipe", SCRIPT)
recipe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recipe)
PROFILE = ROOT / "scripts/optional-adapter/recipes/mpv/prepare_profile.py"
profile_spec = importlib.util.spec_from_file_location("mpv_profile", PROFILE)
profile = importlib.util.module_from_spec(profile_spec)
profile_spec.loader.exec_module(profile)


class MpvRecipeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.target = self.root / "target"
        (self.target / "usr/bin").mkdir(parents=True)
        (self.target / "usr/lib").mkdir()
        (self.target / "usr/bin/mpv").write_bytes(b"mock guest mpv")
        (self.target / "usr/lib/libavcodec.so.61").write_bytes(b"mock guest codec")
        (self.target / "usr/lib/ld-linux-x86-64.so.2").write_bytes(b"mock loader")
        self.stage = self.root / "stage"

    def mock_readelf(self, path, flag):
        if flag == "-h":
            return "Class: ELF64\nMachine: Advanced Micro Devices X86-64\n"
        if path.name == "mpv":
            return "(NEEDED) Shared library: [libavcodec.so.61]\n"
        return ""

    def test_profile_selects_mpv_and_single_job(self):
        contents = profile.selected_config("# BR2_PACKAGE_MPV is not set\nBR2_JLEVEL=8\n")
        self.assertIn("BR2_PACKAGE_MPV=y", contents.splitlines())
        self.assertIn("BR2_JLEVEL=1", contents.splitlines())
        self.assertNotIn("BR2_JLEVEL=8", contents)

    def test_stages_guest_video_with_muted_local_launcher(self):
        with patch.object(recipe, "readelf", side_effect=self.mock_readelf):
            copied = recipe.stage(self.target, self.stage, "x86_64")
        self.assertEqual(copied, {"libavcodec.so.61", "ld-linux-x86-64.so.2"})
        self.assertEqual((self.stage / "family").read_text(), "video\n")
        self.assertTrue(os.access(self.stage / "bin/launch", os.X_OK))
        launcher = (self.stage / "bin/launch").read_text()
        for flag in ("--no-config", "--audio=no", "--hwdec=no", "--vo=x11"):
            self.assertIn(flag, launcher)
        for unsupported in ("--no-scripts", "--no-ytdl", "--no-osc"):
            self.assertNotIn(unsupported, launcher)
        self.assertIn('-- "$1"', launcher)
        self.assertNotIn('"$@"', launcher)
        self.assertFalse(any(path.is_symlink() for path in self.stage.rglob("*")))

    def test_strips_only_staged_guest_elfs_with_supplied_tool(self):
        tool = self.root / "strip"
        tool.write_text('#!/bin/sh\nprintf "%s\\n" "$2" >> "$WORKSPACE_STRIP_LOG"\n')
        tool.chmod(0o755)
        log = self.root / "stripped"
        with patch.object(recipe, "readelf", side_effect=self.mock_readelf), \
                patch.dict(os.environ, {"WORKSPACE_STRIP_LOG": str(log)}):
            recipe.stage(self.target, self.stage, "x86_64", tool)
        stripped = log.read_text().splitlines()
        self.assertEqual(len(stripped), 3)
        self.assertTrue(all(str(self.stage) in path for path in stripped))
        self.assertEqual((self.target / "usr/bin/mpv").read_bytes(), b"mock guest mpv")

    def test_launcher_passes_one_local_file(self):
        with patch.object(recipe, "readelf", side_effect=self.mock_readelf):
            recipe.stage(self.target, self.stage, "x86_64")
        loader = self.stage / "lib/ld-linux-x86-64.so.2"
        loader.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$WORKSPACE_ARGS_FILE"\n')
        loader.chmod(0o755)
        launcher = self.stage / "bin/launch"
        launcher.write_text(launcher.read_text().replace("/opt/workspace/apps", str(self.stage)))
        arguments = self.root / "args"
        subprocess.run([str(launcher), "/run/video.mp4", "ignored"], check=True,
                       env={**os.environ, "WORKSPACE_ARGS_FILE": str(arguments)})
        self.assertEqual(arguments.read_text().splitlines()[-2:], ["--", "/run/video.mp4"])
        self.assertNotIn("ignored", arguments.read_text())

    def test_missing_video_decoder_fails_closed(self):
        (self.target / "usr/lib/libavcodec.so.61").unlink()
        with patch.object(recipe, "readelf", side_effect=self.mock_readelf):
            with self.assertRaisesRegex(ValueError, "missing guest ELF dependency"):
                recipe.stage(self.target, self.stage, "x86_64")

    def test_dependency_symlink_escape_fails_closed(self):
        (self.target / "usr/lib/libavcodec.so.61").unlink()
        (self.target / "usr/lib/libavcodec.so.61").symlink_to("/etc/passwd")
        with patch.object(recipe, "readelf", side_effect=self.mock_readelf):
            with self.assertRaisesRegex(ValueError, "escapes guest target"):
                recipe.stage(self.target, self.stage, "x86_64")

    def test_wrong_architecture_fails_closed(self):
        with patch.object(recipe, "readelf", return_value="Class: ELF64\nMachine: AArch64\n"):
            with self.assertRaisesRegex(ValueError, "wrong guest ELF architecture"):
                recipe.stage(self.target, self.stage, "x86_64")

    def test_arm_loader_is_guest_bundled(self):
        (self.target / "usr/lib/ld-linux-aarch64.so.1").write_bytes(b"mock arm loader")

        def arm_readelf(path, flag):
            return self.mock_readelf(path, flag).replace("Advanced Micro Devices X86-64", "AArch64")

        with patch.object(recipe, "readelf", side_effect=arm_readelf):
            copied = recipe.stage(self.target, self.stage, "aarch64")
        self.assertIn("ld-linux-aarch64.so.1", copied)


if __name__ == "__main__":
    unittest.main()
