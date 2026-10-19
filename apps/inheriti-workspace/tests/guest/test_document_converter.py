#!/usr/bin/env python3
"""Bounded document text conversion; runs when host libzip/libxml2 dev files exist."""
import pathlib
import subprocess
import tempfile
import unittest
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONVERTER = ROOT / "guest/package/workspace-agent/documents/document_converter.c"
MAIN = r'''
#include "document_converter.h"
int main(int argc, char **argv) {
    return argc == 3 && workspace_document_to_text(argv[1], argv[2]) == 0 ? 0 : 1;
}
'''
DOCX_TYPES = b'<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
ODT_MANIFEST = b'<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>'


class DocumentConverterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="workspace-doc-converter-")
        cls.directory = pathlib.Path(cls.temp.name)
        try:
            flags = subprocess.check_output(
                ["pkg-config", "--cflags", "--libs", "libzip", "libxml-2.0"], text=True
            ).split()
        except (FileNotFoundError, subprocess.CalledProcessError):
            raise unittest.SkipTest("libzip and libxml2 development packages unavailable")
        main = cls.directory / "main.c"
        main.write_text(MAIN)
        cls.binary = cls.directory / "document-converter"
        subprocess.run(["cc", "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror",
                        "-I", str(CONVERTER.parent), str(main), str(CONVERTER),
                        "-o", str(cls.binary), *flags, "-lz"], check=True)

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "temp"):
            cls.temp.cleanup()

    def convert(self, extension, members, expected_success):
        source = self.directory / ("input" + extension)
        target = self.directory / "out.txt"
        target.unlink(missing_ok=True)
        with zipfile.ZipFile(source, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, data in members.items():
                archive.writestr(name, data)
        result = subprocess.run([str(self.binary), str(source), str(target)], check=False)
        self.assertEqual(result.returncode == 0, expected_success)
        self.assertEqual(target.exists(), expected_success)
        return target.read_text() if expected_success else ""

    def test_docx_paragraphs_and_table_text(self):
        xml = b'''<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'''
        text = self.convert(".docx", {"word/document.xml": xml, "[Content_Types].xml": DOCX_TYPES}, True)
        self.assertIn("Hello\n", text)
        self.assertIn("Cell\n", text)

    def test_odt_paragraphs(self):
        xml = b'''<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>Hello ODT</text:p></office:text></office:body></office:document-content>'''
        text = self.convert(".odt", {"mimetype": b"application/vnd.oasis.opendocument.text", "content.xml": xml, "META-INF/manifest.xml": ODT_MANIFEST}, True)
        self.assertIn("Hello ODT\n", text)

    def test_explicit_docx_and_odt_spacing(self):
        word = b'''<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>A</w:t><w:br/><w:t>B</w:t><w:tab/><w:t>C</w:t></w:r></w:p></w:body></w:document>'''
        text = self.convert(".docx", {"word/document.xml": word, "[Content_Types].xml": DOCX_TYPES}, True)
        self.assertIn("A\nB C\n", text)
        odt = b'''<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>A<text:line-break/>B<text:s text:c="3"/>C</text:p></office:text></office:body></office:document-content>'''
        text = self.convert(".odt", {"mimetype": b"application/vnd.oasis.opendocument.text", "content.xml": odt,
                                     "META-INF/manifest.xml": ODT_MANIFEST}, True)
        self.assertIn("A\nB   C\n", text)

    def test_rejects_unbounded_odt_space_count(self):
        odt = b'''<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>A<text:s text:c="999999999"/></text:p></office:text></office:body></office:document-content>'''
        self.convert(".odt", {"mimetype": b"application/vnd.oasis.opendocument.text", "content.xml": odt,
                              "META-INF/manifest.xml": ODT_MANIFEST}, False)

    def test_rejects_macro_and_path_escape(self):
        xml = b'''<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:t>Hi</w:t></w:p></w:body></w:document>'''
        self.convert(".docx", {"word/document.xml": xml, "[Content_Types].xml": DOCX_TYPES, "word/vbaProject.bin": b"x"}, False)
        self.convert(".docx", {"word/document.xml": xml, "[Content_Types].xml": DOCX_TYPES, "../escape": b"x"}, False)

    def test_rejects_dtd_and_oversize_xml(self):
        dtd = b'''<!DOCTYPE w:document [<!ENTITY e "bad">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:t>&e;</w:t></w:p></w:body></w:document>'''
        self.convert(".docx", {"word/document.xml": dtd, "[Content_Types].xml": DOCX_TYPES}, False)
        self.convert(".docx", {"word/document.xml": b"a" * (4 * 1024 * 1024 + 1), "[Content_Types].xml": DOCX_TYPES}, False)

    def test_rejects_encrypted_odt_and_mislabeled_docx(self):
        xml = b'''<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"><office:body><office:text><p>Hi</p></office:text></office:body></office:document-content>'''
        self.convert(".odt", {"mimetype": b"application/vnd.oasis.opendocument.text", "content.xml": xml,
                              "META-INF/manifest.xml": b"<manifest:encryption-data/>"}, False)
        self.convert(".docx", {"word/document.xml": xml, "[Content_Types].xml": b"<Types/>"}, False)


if __name__ == "__main__":
    unittest.main()
