"""ZIP inventories expose names and sizes without opening archive members."""

import os
import pathlib
import shutil
import stat
import subprocess
import tempfile
import unittest
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / "guest/package/workspace-agent/archive/zip_index.c"


class ZipInspectorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        supplied = os.environ.get("ZIP_INDEX_BINARY")
        if supplied:
            cls.binary = pathlib.Path(supplied)
            if not cls.binary.is_file():
                raise unittest.SkipTest("ZIP_INDEX_BINARY does not exist")
            return
        if not shutil.which("pkg-config"):
            raise unittest.SkipTest("pkg-config is unavailable")
        deps = subprocess.run(["pkg-config", "--cflags", "--libs", "libzip"],
                              capture_output=True, text=True)
        if deps.returncode:
            raise unittest.SkipTest("libzip development files are unavailable")
        cls.build = tempfile.TemporaryDirectory()
        cls.binary = pathlib.Path(cls.build.name) / "workspace-zip-index"
        subprocess.run(["cc", "-std=c11", "-Wall", "-Wextra", "-Werror", str(SOURCE),
                        "-o", str(cls.binary), *deps.stdout.split()], check=True)

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "build"):
            cls.build.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = pathlib.Path(self.temp.name)
        self.archive = self.folder / "input.zip"
        self.output = self.folder / "index.txt"

    def inspect(self):
        result = subprocess.run([str(self.binary), str(self.archive), str(self.output)],
                                capture_output=True, text=True)
        return result.returncode, self.output.read_text() if self.output.exists() else ""

    def write(self, members, compression=zipfile.ZIP_STORED):
        with zipfile.ZipFile(self.archive, "w", compression=compression) as archive:
            for name, data in members:
                archive.writestr(name, data)

    def test_lists_names_and_uncompressed_sizes_without_contents(self):
        self.write([("notes/", b""), ("notes/secret.txt", b"private"),
                    ("photo.png", b"\x89PNG")])
        code, output = self.inspect()
        self.assertEqual(code, 0)
        self.assertIn("listing only; files are not opened", output)
        self.assertIn("7            notes/secret.txt", output)
        self.assertIn("4            photo.png", output)
        self.assertNotIn("private", output)

    def test_empty_archive_has_an_empty_index(self):
        self.write([])
        code, output = self.inspect()
        self.assertEqual(code, 0)
        self.assertIn("listing only; files are not opened", output)

    def test_rejects_traversal_absolute_windows_and_empty_segments(self):
        for name in ("../secret", "a/../secret", "/etc/passwd", "C:/private", "a\\b", "a//b"):
            with self.subTest(name=name):
                self.write([(name, b"x")])
                self.output.unlink(missing_ok=True)
                self.assertEqual(self.inspect(), (2, ""))

    def test_rejects_symlink(self):
        link = zipfile.ZipInfo("link")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        with zipfile.ZipFile(self.archive, "w") as archive:
            archive.writestr(link, "target")
        self.assertEqual(self.inspect(), (2, ""))

    def test_rejects_duplicate_case_insensitive_name(self):
        self.write([("Notes.txt", b"a"), ("notes.TXT", b"b")])
        self.assertEqual(self.inspect(), (2, ""))

    def test_neutralizes_unicode_controls_and_direction_marks(self):
        self.write([("safe\u0085\u202esecret.txt", b"x")])
        code, output = self.inspect()
        self.assertEqual(code, 0)
        self.assertIn("safe  secret.txt", output)
        self.assertNotIn("\u0085", output)
        self.assertNotIn("\u202e", output)

    def test_ansi_sequence_cannot_reach_output(self):
        self.write([("safe\x1b[31m\u202esecret.txt", b"x")])
        code, output = self.inspect()
        self.assertNotIn("\x1b", output)
        self.assertIn(code, (0, 2))

    def test_rejects_high_compression_ratio(self):
        self.write([("bomb", b"A" * (1024 * 1024))], zipfile.ZIP_DEFLATED)
        self.assertEqual(self.inspect(), (2, ""))

    def test_rejects_too_many_members(self):
        self.write([(f"{index}.txt", b"") for index in range(257)])
        self.assertEqual(self.inspect(), (2, ""))

    def test_rejects_large_archive(self):
        self.write([("large.bin", os.urandom(16 * 1024 * 1024))])
        self.assertEqual(self.inspect(), (2, ""))

    def test_rejects_encrypted_flag(self):
        self.write([("secret", b"data")])
        data = bytearray(self.archive.read_bytes())
        local = data.index(b"PK\x03\x04")
        central = data.index(b"PK\x01\x02")
        data[local + 6] |= 1
        data[central + 8] |= 1
        self.archive.write_bytes(data)
        self.assertEqual(self.inspect(), (2, ""))

    def test_will_not_replace_existing_output(self):
        self.write([("safe", b"x")])
        self.output.write_text("keep")
        self.assertEqual(self.inspect(), (2, "keep"))


if __name__ == "__main__":
    unittest.main()
