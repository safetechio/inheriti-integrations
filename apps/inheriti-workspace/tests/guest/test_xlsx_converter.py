"""Focused tests for the guest's bounded, read-only XLSX text converter."""

import pathlib
import os
import shutil
import subprocess
import tempfile
import unittest
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / "guest/package/workspace-agent/xlsx/xlsx_to_tsv.c"
FIXTURE = ROOT / "tests/fixtures/sample-spreadsheet.xlsx"


def workbook_parts(cells: str, *, shared: str | None = None) -> dict[str, str]:
    parts = {
        "xl/workbook.xml": (
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>'
        ),
        "xl/_rels/workbook.xml.rels": (
            '<Relationships><Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
            'Target="worksheets/sheet1.xml"/></Relationships>'
        ),
        "xl/worksheets/sheet1.xml": (
            '<worksheet><sheetData><row r="1">' + cells + "</row></sheetData></worksheet>"
        ),
    }
    if shared is not None:
        parts["xl/sharedStrings.xml"] = "<sst><si><t>" + shared + "</t></si></sst>"
    return parts


class XlsxConverterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        supplied_binary = os.environ.get("XLSX_CONVERTER_BINARY")
        if supplied_binary:
            cls.binary = pathlib.Path(supplied_binary)
            if not cls.binary.is_file():
                raise unittest.SkipTest("XLSX_CONVERTER_BINARY does not exist")
            return
        if not shutil.which("pkg-config"):
            raise unittest.SkipTest("pkg-config is unavailable")
        deps = subprocess.run(
            ["pkg-config", "--cflags", "--libs", "libzip", "libxml-2.0"],
            capture_output=True,
            text=True,
        )
        if deps.returncode:
            raise unittest.SkipTest("libzip and libxml2 development files are unavailable")
        cls.build = tempfile.TemporaryDirectory()
        cls.binary = pathlib.Path(cls.build.name) / "xlsx-to-tsv"
        subprocess.run(
            ["cc", "-std=c11", "-Wall", "-Wextra", "-Werror", str(SOURCE),
             "-o", str(cls.binary), *deps.stdout.split()],
            check=True,
        )

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "build"):
            cls.build.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = pathlib.Path(self.temp.name)

    def convert(self, source: pathlib.Path) -> tuple[int, str]:
        target = self.folder / "output.tsv"
        process = subprocess.run([str(self.binary), str(source), str(target)])
        return process.returncode, target.read_text() if target.exists() else ""

    def archive(self, parts: dict[str, str]) -> pathlib.Path:
        target = self.folder / "input.xlsx"
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for path, content in parts.items():
                zf.writestr(path, content)
        return target

    def test_checked_in_fixture(self):
        code, output = self.convert(FIXTURE)
        self.assertEqual(code, 0)
        self.assertIn("Sheet: Fixture\nWorkspace fixture\t42\n", output)

    def test_shared_strings_and_terminal_controls_are_neutralized(self):
        parts = workbook_parts('<c r="A1" t="s"><v>0</v></c><c r="C1"><v>12</v></c>', shared="A&#10;B")
        code, output = self.convert(self.archive(parts))
        self.assertEqual(code, 0)
        self.assertIn("A B\t\t12\n", output)

    def test_unicode_controls_and_bidi_marks_are_neutralized(self):
        parts = workbook_parts(
            '<c r="A1" t="inlineStr"><is><t>safe&#133;next&#155;then‮end⁦done</t></is></c>'
        )
        parts["xl/workbook.xml"] = parts["xl/workbook.xml"].replace(
            'name="Report"', 'name="Re‮port⁦"'
        )
        code, output = self.convert(self.archive(parts))
        self.assertEqual(code, 0)
        self.assertIn("Sheet: Re port \n", output)
        self.assertIn("safe next then end done\n", output)
        self.assertNotIn("\u0085", output)
        self.assertNotIn("\u009b", output)
        self.assertNotIn("\u202e", output)
        self.assertNotIn("\u2066", output)

    def test_multiple_sheets_and_cached_formula_value(self):
        parts = workbook_parts('<c r="A1"><f>1+1</f><v>2</v></c>')
        parts["xl/workbook.xml"] = parts["xl/workbook.xml"].replace(
            "</sheets>", '<sheet name="Next" sheetId="2" r:id="rId2"/></sheets>'
        )
        parts["xl/_rels/workbook.xml.rels"] = parts["xl/_rels/workbook.xml.rels"].replace(
            "</Relationships>",
            '<Relationship Id="rId2" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
            'Target="worksheets/sheet2.xml"/></Relationships>',
        )
        parts["xl/worksheets/sheet2.xml"] = (
            '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr">'
            '<is><t>Second</t></is></c></row></sheetData></worksheet>'
        )
        code, output = self.convert(self.archive(parts))
        self.assertEqual(code, 0)
        self.assertIn("Sheet: Report\n2\n", output)
        self.assertIn("Sheet: Next\nSecond\n", output)

    def test_package_absolute_worksheet_target(self):
        parts = workbook_parts('<c r="A1"><v>7</v></c>')
        parts["xl/_rels/workbook.xml.rels"] = parts["xl/_rels/workbook.xml.rels"].replace(
            'Target="worksheets/sheet1.xml"',
            'Target="/xl/worksheets/sheet1.xml"',
        )
        code, output = self.convert(self.archive(parts))
        self.assertEqual(code, 0)
        self.assertIn("Sheet: Report\n7\n", output)

    def test_external_or_traversing_worksheet_target_is_rejected(self):
        for target in ("/other/sheet1.xml", "../worksheets/sheet1.xml", "https://example.invalid/sheet.xml"):
            with self.subTest(target=target):
                parts = workbook_parts('<c r="A1"><v>7</v></c>')
                parts["xl/_rels/workbook.xml.rels"] = parts["xl/_rels/workbook.xml.rels"].replace(
                    'Target="worksheets/sheet1.xml"', f'Target="{target}"'
                )
                code, output = self.convert(self.archive(parts))
                self.assertEqual(code, 2)
                self.assertEqual(output, "")

    def test_formula_without_cached_value_is_rejected(self):
        parts = workbook_parts('<c r="A1"><f>NOW()</f></c>')
        code, output = self.convert(self.archive(parts))
        self.assertEqual(code, 2)
        self.assertEqual(output, "")

    def test_dtd_is_rejected_without_output(self):
        parts = workbook_parts('<c r="A1"><v>1</v></c>')
        parts["xl/workbook.xml"] = '<!DOCTYPE workbook [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + parts["xl/workbook.xml"]
        code, output = self.convert(self.archive(parts))
        self.assertEqual(code, 2)
        self.assertEqual(output, "")

    def test_unsupported_cell_type_is_rejected(self):
        parts = workbook_parts('<c r="A1" t="unsupported"><v>1</v></c>')
        code, output = self.convert(self.archive(parts))
        self.assertEqual(code, 2)
        self.assertEqual(output, "")

    def test_macro_payload_is_rejected(self):
        parts = workbook_parts('<c r="A1"><v>1</v></c>')
        parts["xl/vbaProject.bin"] = "not a real macro"
        code, output = self.convert(self.archive(parts))
        self.assertEqual(code, 2)
        self.assertEqual(output, "")

    def test_part_size_limit(self):
        parts = workbook_parts('<c r="A1"><v>1</v></c>')
        parts["xl/unused.xml"] = "x" * (2 * 1024 * 1024 + 1)
        code, output = self.convert(self.archive(parts))
        self.assertEqual(code, 2)
        self.assertEqual(output, "")


if __name__ == "__main__":
    unittest.main()
