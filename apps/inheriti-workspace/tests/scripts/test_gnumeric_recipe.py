"""Contract tests for the optional guest-built Gnumeric package."""

import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/optional-adapter/recipes/gnumeric/build.py"
spec = importlib.util.spec_from_file_location("gnumeric_recipe", SCRIPT)
recipe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recipe)
PROFILE = SCRIPT.parent / "prepare_profile.py"
profile_spec = importlib.util.spec_from_file_location("gnumeric_profile", PROFILE)
profile = importlib.util.module_from_spec(profile_spec)
profile_spec.loader.exec_module(profile)


class GnumericRecipeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.target = self.root / "target"
        (self.target / "opt/workspace/apps/bin").mkdir(parents=True)
        (self.target / "opt/workspace/apps/lib").mkdir(parents=True)
        (self.target / "opt/workspace/apps/lib/gnumeric/1.12.62/plugins/excel").mkdir(parents=True)
        (self.target / "opt/workspace/apps/lib/goffice/0.10/plugins/gnumeric").mkdir(parents=True)
        (self.target / "opt/workspace/apps/share/gnumeric").mkdir(parents=True)
        (self.target / "lib").mkdir()
        (self.target / "usr/lib/gdk-pixbuf-2.0/2.10.0").mkdir(parents=True)
        (self.target / "opt/workspace/apps/bin/gnumeric").write_bytes(b"\x7fELF guest executable")
        (self.target / "opt/workspace/apps/lib/libgsf-1.so.114").write_bytes(b"\x7fELF guest gsf")
        (self.target / "opt/workspace/apps/lib/libgoffice-0.10.so.10").write_bytes(
            b"\x7fELF guest goffice")
        (self.target / "opt/workspace/apps/lib/gnumeric/1.12.62/plugins/excel/excel.so").write_bytes(
            b"\x7fELF guest excel plugin")
        (self.target / "opt/workspace/apps/lib/goffice/0.10/plugins/gnumeric/gnumeric.so").write_bytes(
            b"\x7fELF guest goffice bridge")
        (self.target / "opt/workspace/apps/share/gnumeric/data.xml").write_text("guest data")
        (self.target / "lib/libgtk-3.so.0").write_bytes(b"\x7fELF guest library")
        (self.target / "lib/ld-linux-x86-64.so.2").write_bytes(b"\x7fELF guest loader")
        (self.target / "usr/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache").write_text(
            '"/usr/lib/gdk-pixbuf-2.0/2.10.0/loaders/libpixbufloader-png.so"\n'
        )
        self.stage = self.root / "stage"

    def readelf(self, path, flag):
        if flag == "-h":
            return "Class: ELF64\nMachine: Advanced Micro Devices X86-64\n"
        if path.name == "gnumeric":
            return "(NEEDED) Shared library: [libgtk-3.so.0]\n"
        return ""

    def test_stages_guest_binary_data_and_dependency_closure(self):
        with patch.object(recipe, "readelf", side_effect=self.readelf):
            copied = recipe.stage(self.target, self.stage, "x86_64")
        self.assertEqual(copied, {"libgtk-3.so.0"})
        self.assertEqual((self.stage / "family").read_text(), "spreadsheet\n")
        self.assertEqual((self.stage / "share/gnumeric/data.xml").read_text(), "guest data")
        self.assertIn('"/opt/workspace/apps/lib/gdk-pixbuf-2.0/',
                      (self.stage / "lib/gdk-pixbuf-2.0/2.10.0/loaders.cache").read_text())
        self.assertIn('gnumeric" "$1"', (self.stage / "bin/launch").read_text())
        self.assertIn("XDG_CONFIG_HOME=/run/session/.config", (self.stage / "bin/launch").read_text())
        self.assertFalse(any(path.is_symlink() for path in self.stage.rglob("*")))

    def test_missing_guest_library_fails_closed(self):
        (self.target / "lib/libgtk-3.so.0").unlink()
        with patch.object(recipe, "readelf", side_effect=self.readelf):
            with self.assertRaisesRegex(ValueError, "missing guest ELF dependency"):
                recipe.stage(self.target, self.stage, "x86_64")

    def test_gnome_libraries_must_be_inside_optional_prefix(self):
        (self.target / "opt/workspace/apps/lib/libgsf-1.so.114").unlink()
        (self.target / "usr/lib").mkdir(parents=True, exist_ok=True)
        (self.target / "usr/lib/libgsf-1.so.114").write_bytes(b"\x7fELF old guest gsf")
        with patch.object(recipe, "readelf", side_effect=self.readelf):
            with self.assertRaisesRegex(ValueError, "optional library missing"):
                recipe.stage(self.target, self.stage, "x86_64")

    def test_excel_plugin_is_required(self):
        (self.target / "opt/workspace/apps/lib/gnumeric/1.12.62/plugins/excel/excel.so").unlink()
        with patch.object(recipe, "readelf", side_effect=self.readelf):
            with self.assertRaisesRegex(ValueError, "required spreadsheet plugin missing"):
                recipe.stage(self.target, self.stage, "x86_64")

    def test_missing_schema_compiler_fails_closed(self):
        schemas = self.target / "opt/workspace/apps/share/glib-2.0/schemas"
        schemas.mkdir(parents=True)
        (schemas / "org.gnome.gnumeric.gschema.xml").write_text("<schemalist/>")
        with patch.object(recipe, "readelf", side_effect=self.readelf):
            with self.assertRaisesRegex(ValueError, "schema compiler is missing"):
                recipe.stage(self.target, self.stage, "x86_64")

    def test_host_symlink_escape_fails_closed(self):
        (self.target / "opt/workspace/apps/share/gnumeric/data.xml").unlink()
        (self.target / "opt/workspace/apps/share/gnumeric/data.xml").symlink_to("/etc/passwd")
        with patch.object(recipe, "readelf", side_effect=self.readelf):
            with self.assertRaisesRegex(ValueError, "escapes guest target"):
                recipe.stage(self.target, self.stage, "x86_64")

    def test_wrong_architecture_fails_closed(self):
        with patch.object(recipe, "readelf", return_value="Class: ELF64\nMachine: AArch64\n"):
            with self.assertRaisesRegex(ValueError, "wrong guest ELF architecture"):
                recipe.stage(self.target, self.stage, "x86_64")

    def test_aarch64_uses_guest_aarch64_loader(self):
        (self.target / "lib/ld-linux-aarch64.so.1").write_bytes(b"\x7fELF guest arm loader")

        def arm_readelf(path, flag):
            return self.readelf(path, flag).replace("Advanced Micro Devices X86-64", "AArch64")

        with patch.object(recipe, "readelf", side_effect=arm_readelf):
            recipe.stage(self.target, self.stage, "aarch64")
        self.assertIn('ld-linux-aarch64.so.1" --library-path',
                      (self.stage / "bin/launch").read_text())

    def test_requires_guest_built_gnumeric(self):
        (self.target / "opt/workspace/apps/bin/gnumeric").unlink()
        with self.assertRaises((FileNotFoundError, ValueError)):
            recipe.stage(self.target, self.stage, "x86_64")

    def test_missing_gdk_loader_cache_fails_closed(self):
        (self.target / "usr/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache").unlink()
        with patch.object(recipe, "readelf", side_effect=self.readelf):
            with self.assertRaisesRegex(ValueError, "loader cache is missing"):
                recipe.stage(self.target, self.stage, "x86_64")

    def test_optional_profile_replaces_disabled_selections(self):
        contents = ("# BR2_PACKAGE_MESA3D is not set\nBR2_PACKAGE_LIBGTK3=n\n"
                    "BR2_PACKAGE_WORKSPACE_AGENT=y\n")
        selected = profile.selected_config(contents)
        for key in profile.SELECT:
            self.assertEqual(selected.splitlines().count(f"{key}=y"), 1)
        self.assertNotIn("# BR2_PACKAGE_MESA3D is not set", selected)
        self.assertIn("BR2_JLEVEL=1", selected)
        self.assertIn("BR2_PACKAGE_WORKSPACE_AGENT=y", selected)
        self.assertTrue((profile.GUEST_EXTERNAL / "external.desc").is_file())

    @unittest.skipUnless(os.environ.get("WORKSPACE_GNUMERIC_TARGET"),
                         "set WORKSPACE_GNUMERIC_TARGET for real guest closure test")
    def test_real_buildroot_guest_closure(self):
        target = Path(os.environ["WORKSPACE_GNUMERIC_TARGET"])
        copied = recipe.stage(target, self.stage, "x86_64")
        self.assertIn("libgtk-3.so.0", copied)
        self.assertLessEqual(len(copied), recipe.MAX_FILES)
        result = subprocess.run([str(self.stage / "lib/ld-linux-x86-64.so.2"),
                                 "--library-path", str(self.stage / "lib"), "--verify",
                                 str(self.stage / "bin/gnumeric")],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
