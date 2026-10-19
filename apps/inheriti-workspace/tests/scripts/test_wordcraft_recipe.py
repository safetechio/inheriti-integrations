"""Contract checks for the pinned WordCraft optional adapter recipe."""

import importlib.util
import io
from pathlib import Path
import shutil
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/optional-adapter/recipes/wordcraft/build.py"
spec = importlib.util.spec_from_file_location("wordcraft_recipe", SCRIPT)
recipe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recipe)


class WordCraftRecipeTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.archive = self.root / recipe.archive_name("x86_64")
        self.stage = self.root / "stage"
        self.stage.mkdir()
        self.target = self.root / "target"
        (self.target / "lib").mkdir(parents=True)

    def release(self, *extra):
        with tarfile.open(self.archive, "w:gz") as archive:
            for name, content in (("bin/wordcraft", b"\x7fELF gui"),
                                  ("bin/wordcraft-cli", b"\x7fELF cli"),
                                  ("share/icons/icon.png", b"icon"), *extra):
                member = tarfile.TarInfo(f"{recipe.archive_name('x86_64').removesuffix('.tar.gz')}/{name}")
                member.size = len(content)
                member.mode = 0o755 if name == "bin/wordcraft" else 0o644
                archive.addfile(member, io.BytesIO(content))

    @staticmethod
    def readelf(path, flag):
        if flag == "-h":
            return "Class: ELF64\nMachine: Advanced Micro Devices X86-64\n"
        if path.name == "wordcraft":
            return "(NEEDED) Shared library: [libc.so.6]\n"
        return ""

    def test_pinned_release_is_staged_without_host_execution(self):
        self.release()
        with patch.object(recipe, "digest", return_value=recipe.ARCHIVE_SHA256["x86_64"]), \
             patch.object(recipe, "readelf", side_effect=self.readelf):
            recipe.unpack_release(self.archive, self.stage)
        self.assertEqual((self.stage / "bin/wordcraft").read_bytes(), b"\x7fELF gui")
        self.assertFalse((self.stage / "bin/wordcraft-cli").exists())
        self.assertEqual((self.stage / "share/icons/icon.png").read_bytes(), b"icon")

    def test_wrong_hash_fails_closed(self):
        self.release()
        with self.assertRaisesRegex(ValueError, "SHA256 mismatch"):
            recipe.unpack_release(self.archive, self.stage)

    def test_arm64_release_requires_pinned_archive_and_arm64_elf(self):
        self.archive = self.root / recipe.archive_name("aarch64")
        with tarfile.open(self.archive, "w:gz") as archive:
            member = tarfile.TarInfo("wordcraft-0.8.0-linux-aarch64/bin/wordcraft")
            member.size = 4
            archive.addfile(member, io.BytesIO(b"\x7fELF"))
        with patch.object(recipe, "digest", return_value=recipe.ARCHIVE_SHA256["aarch64"]), \
             patch.object(recipe, "readelf", return_value="Class: ELF64\nMachine: AArch64\n"):
            recipe.unpack_release(self.archive, self.stage, "aarch64")
        with patch.object(recipe, "digest", return_value=recipe.ARCHIVE_SHA256["aarch64"]), \
             patch.object(recipe, "readelf", return_value="Class: ELF64\nMachine: Advanced Micro Devices X86-64\n"):
            with self.assertRaisesRegex(ValueError, "wrong guest ELF architecture"):
                recipe.unpack_release(self.archive, self.stage, "aarch64")
        with self.assertRaisesRegex(ValueError, "SHA256 mismatch"):
            recipe.unpack_release(self.archive, self.stage, "aarch64")

    def test_arm64_launcher_uses_arm64_guest_loader(self):
        self.release()
        for name in (*recipe.RUNTIME_LIBRARIES, recipe.RENDER_BACKEND,
                     "libc.so.6", recipe.LOADER["aarch64"]):
            (self.target / "lib" / name).write_bytes(b"\x7fELF guest")
        dri = self.target / "usr/lib/dri"
        dri.mkdir(parents=True)
        (dri / "swrast_dri.so").write_bytes(b"\x7fELF guest")
        (self.stage / "bin").mkdir()
        (self.stage / "bin/wordcraft").write_bytes(b"\x7fELF guest")
        with patch.object(recipe, "readelf", return_value="Class: ELF64\nMachine: AArch64\n"):
            recipe.stage_runtime(self.target, self.stage, "aarch64")
        self.assertIn("ld-linux-aarch64.so.1", (self.stage / "bin/launch").read_text())

    def test_tar_path_escape_fails_closed(self):
        self.release(("../../outside", b"bad"))
        with patch.object(recipe, "digest", return_value=recipe.ARCHIVE_SHA256["x86_64"]), \
             patch.object(recipe, "readelf", side_effect=self.readelf):
            with self.assertRaisesRegex(ValueError, "unsafe WordCraft release member"):
                recipe.unpack_release(self.archive, self.stage)
        self.assertFalse((self.root / "outside").exists())

    def test_requires_guest_graphics_and_copies_guest_elf_closure(self):
        self.release()
        with patch.object(recipe, "digest", return_value=recipe.ARCHIVE_SHA256["x86_64"]), \
             patch.object(recipe, "readelf", side_effect=self.readelf):
            recipe.unpack_release(self.archive, self.stage)
            for name in (*recipe.RUNTIME_LIBRARIES, "libc.so.6", recipe.LOADER["x86_64"]):
                (self.target / "lib" / name).write_bytes(b"\x7fELF guest")
            with self.assertRaisesRegex(ValueError, "EGL renderer"):
                recipe.stage_runtime(self.target, self.stage)
            (self.target / "lib/libvulkan.so.1").write_bytes(b"\x7fELF guest")
            with self.assertRaisesRegex(ValueError, "EGL renderer"):
                recipe.stage_runtime(self.target, self.stage)
            (self.target / "lib/libEGL.so.1").write_bytes(b"\x7fELF guest")
            dri = self.target / "usr/lib/dri"
            dri.mkdir(parents=True)
            (dri / "swrast_dri.so").write_bytes(b"\x7fELF guest driver")
            seen = recipe.stage_runtime(self.target, self.stage)
        self.assertIn("libc.so.6", seen)
        self.assertEqual((self.stage / "family").read_text(), "document\n")
        self.assertIn('wordcraft" "$1"', (self.stage / "bin/launch").read_text())
        self.assertIn("WGPU_BACKEND=gl", (self.stage / "bin/launch").read_text())
        self.assertEqual((self.stage / "lib/libEGL.so.1").read_bytes(), b"\x7fELF guest")
        self.assertTrue((self.stage / "lib/dri/swrast_dri.so").is_file())

    def test_guest_library_escape_fails_closed(self):
        (self.target / "lib/libX11.so.6").symlink_to("/etc/passwd")
        with self.assertRaisesRegex(ValueError, "escapes target"):
            recipe.guest_library(self.target.resolve(), "libX11.so.6")

    def test_virgl_driver_requires_and_stages_gallium_runtime(self):
        self.release()
        def elf_with_gallium_dependency(path, flag):
            if path.name.startswith("libgallium-") and flag == "-d":
                return "(NEEDED) Shared library: [libgallium-test.so.1]\n"
            if path.name == "libEGL.so.1" and flag == "-d":
                return "(NEEDED) Shared library: [libwayland-client.so.0]\n"
            if path.name == "libwayland-client.so.0" and flag == "-d":
                return "(NEEDED) Shared library: [libffi.so.8]\n"
            return self.readelf(path, flag)

        with patch.object(recipe, "digest", return_value=recipe.ARCHIVE_SHA256["x86_64"]), \
             patch.object(recipe, "readelf", side_effect=elf_with_gallium_dependency):
            recipe.unpack_release(self.archive, self.stage)
            for name in (*recipe.RUNTIME_LIBRARIES, recipe.RENDER_BACKEND,
                         "libc.so.6", recipe.LOADER["x86_64"]):
                (self.target / "lib" / name).write_bytes(b"\x7fELF guest")
            dri = self.target / "usr/lib/dri"
            dri.mkdir(parents=True)
            (dri / "virtio_gpu_dri.so").write_bytes(b"\x7fELF guest driver")
            gbm = self.target / "usr/lib/gbm"
            gbm.mkdir(parents=True)
            (gbm / "dri_gbm.so").write_bytes(b"\x7fELF guest backend")
            with self.assertRaisesRegex(ValueError, "Gallium library"):
                recipe.stage_runtime(self.target, self.stage)
            shutil.rmtree(self.stage / "lib")
            gallium = self.target / "usr/lib/libgallium-26.1.8.so"
            gallium.write_bytes(b"\x7fELF guest gallium")
            (self.target / "lib/libgallium-test.so.1").write_bytes(b"\x7fELF dependency")
            (self.target / "lib/libwayland-client.so.0").write_bytes(b"\x7fELF wayland")
            (self.target / "lib/libffi.so.8").write_bytes(b"\x7fELF ffi")
            recipe.stage_runtime(self.target, self.stage)
        self.assertEqual((self.stage / "lib/libgallium-26.1.8.so").read_bytes(),
                         b"\x7fELF guest gallium")
        self.assertEqual((self.stage / "lib/libgallium-test.so.1").read_bytes(),
                         b"\x7fELF dependency")
        self.assertEqual((self.stage / "lib/gbm/dri_gbm.so").read_bytes(),
                         b"\x7fELF guest backend")
        self.assertTrue((self.stage / "lib/libwayland-client.so.0").is_file())
        self.assertTrue((self.stage / "lib/libffi.so.8").is_file())
        self.assertIn("GBM_BACKENDS_PATH=$app/lib/gbm", (self.stage / "bin/launch").read_text())


if __name__ == "__main__":
    unittest.main()
