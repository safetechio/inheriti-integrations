"""Check the bounded admission validator used before optional Office viewers."""
import os
import pathlib
import subprocess
import tempfile
import unittest
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / "guest/package/workspace-agent/documents/ooxml_validate.c"
FIXTURES = ROOT / "tests/fixtures"


class OoxmlValidatorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="workspace-ooxml-validator-")
        cls.binary = pathlib.Path(cls.temp.name) / "validator"
        supplied = os.environ.get("OOXML_VALIDATOR_BINARY")
        if supplied:
            cls.binary = pathlib.Path(supplied)
            if not cls.binary.is_file():
                raise unittest.SkipTest("OOXML_VALIDATOR_BINARY does not exist")
            return
        try:
            flags = subprocess.check_output(
                ["pkg-config", "--cflags", "--libs", "libzip"], text=True,
                stderr=subprocess.DEVNULL,
            ).split()
        except (FileNotFoundError, subprocess.CalledProcessError):
            raise unittest.SkipTest("libzip development files unavailable")
        subprocess.run(["cc", "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror",
                        str(SOURCE), "-o", str(cls.binary), *flags], check=True)

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "temp"):
            cls.temp.cleanup()

    def accepts(self, path, kind):
        return subprocess.run([str(self.binary), str(path), kind], check=False).returncode == 0

    def test_real_office_corpus_and_mismatched_kind(self):
        self.assertTrue(self.accepts(FIXTURES / "sample-letter.docx", "docx"))
        self.assertTrue(self.accepts(FIXTURES / "sample-spreadsheet.xlsx", "xlsx"))
        self.assertFalse(self.accepts(FIXTURES / "sample-letter.docx", "xlsx"))

    def test_rejects_signature_only_and_unsafe_members(self):
        with tempfile.TemporaryDirectory(prefix="workspace-ooxml-invalid-") as directory:
            source = pathlib.Path(directory) / "input.docx"
            source.write_bytes(b"PK\x03\x04mock")
            self.assertFalse(self.accepts(source, "docx"))
            types = (b'<Types><Override ContentType="application/vnd.openxmlformats-officedocument.'
                     b'wordprocessingml.document.main+xml"/></Types>')
            for extra in ("../escape", "word/vbaProject.bin", "word/evil.exe"):
                with self.subTest(extra=extra):
                    with zipfile.ZipFile(source, "w") as archive:
                        archive.writestr("[Content_Types].xml", types)
                        archive.writestr("word/document.xml", b"<document/>")
                        archive.writestr(extra, b"x")
                    self.assertFalse(self.accepts(source, "docx"))


if __name__ == "__main__":
    unittest.main()
