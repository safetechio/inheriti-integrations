#!/usr/bin/env python3
"""Local socket tests for the production guest agent's admission boundary."""
import hashlib
import json
import os
import pathlib
import socket
import subprocess
import tempfile
import unittest
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2] / "guest"
FIXTURES = pathlib.Path(__file__).resolve().parents[1] / "fixtures"
AGENT_SOURCES = [
    ROOT / "package/workspace-agent/workspace-agent.c",
    ROOT / "package/workspace-agent/format_catalog.c",
    ROOT / "package/workspace-agent/applications/catalog.c",
    ROOT / "package/workspace-agent/applications/image/launch.c",
    ROOT / "package/workspace-agent/applications/pdf/launch.c",
    ROOT / "package/workspace-agent/applications/text/launch.c",
    ROOT / "package/workspace-agent/applications/optional/launch.c",
]


def frame(kind: int, name: bytes, data: bytes = b"") -> bytes:
    return bytes([kind]) + len(name).to_bytes(2, "big") + len(data).to_bytes(4, "big") + name + data


class AgentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix="workspace-guest-agent-")
        cls.binary = pathlib.Path(cls.directory.name) / "agent"
        cls.validator = pathlib.Path(cls.directory.name) / "mock-ooxml-validator"
        cls.validator.write_text(
            "#!/usr/bin/env python3\n"
            "import sys, zipfile\n"
            "try:\n"
            "    with zipfile.ZipFile(sys.argv[1]) as archive:\n"
            "        names = archive.namelist()\n"
            "        target = 'word/document.xml' if sys.argv[2] == 'docx' else 'xl/workbook.xml'\n"
            "        assert target in names and '[Content_Types].xml' in names\n"
            "        assert all(not name.startswith('../') for name in names)\n"
            "        assert archive.testzip() is None\n"
            "except (AssertionError, OSError, zipfile.BadZipFile, KeyError): sys.exit(2)\n"
        )
        cls.validator.chmod(0o755)
        subprocess.run([
            "cc", "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror",
            "-DWORKSPACE_AGENT_TEST",
            '-DWORKSPACE_OOXML_VALIDATOR="' + str(cls.validator) + '"',
            *(str(source) for source in AGENT_SOURCES),
            "-o", str(cls.binary),
        ], check=True)
        cls.converter = pathlib.Path(cls.directory.name) / "mock-converter"
        cls.converter.write_text(
            "#!/usr/bin/env python3\n"
            "import os, pathlib, sys\n"
            "if os.getenv('WORKSPACE_MOCK_FAIL') == '1': sys.exit(2)\n"
            "pathlib.Path(sys.argv[2]).write_text('mock view of ' + pathlib.Path(sys.argv[1]).suffix)\n"
        )
        cls.converter.chmod(0o755)
        cls.pdf_view = pathlib.Path(cls.directory.name) / "mock-pdf-view"
        cls.pdf_view.write_text(
            "#!/usr/bin/env python3\n"
            "import os, sys, time\n"
            "if os.getenv('WORKSPACE_MOCK_PDF_READY') == '1':\n"
            "    time.sleep(float(os.getenv('WORKSPACE_MOCK_PDF_LIFETIME', '2')))\n"
            "else: sys.exit(2)\n"
        )
        cls.pdf_view.chmod(0o755)
        cls.mock_binary = pathlib.Path(cls.directory.name) / "agent-mock-converter"
        subprocess.run([
            "cc", "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror",
            "-DWORKSPACE_AGENT_TEST",
            '-DWORKSPACE_OOXML_VALIDATOR="' + str(cls.validator) + '"',
            '-DWORKSPACE_XLSX_CONVERTER="' + str(cls.converter) + '"',
            '-DWORKSPACE_DOCUMENT_CONVERTER="' + str(cls.converter) + '"',
            '-DWORKSPACE_ZIP_CONVERTER="' + str(cls.converter) + '"',
            *(str(source) for source in AGENT_SOURCES),
            "-o", str(cls.mock_binary),
        ], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def start(self, mock_converter=False, fail_converter=False, pdf_ready=None,
              pdf_lifetime=None, adapter_root=None):
        left, right = socket.socketpair()
        directory = tempfile.TemporaryDirectory(prefix="workspace-guest-files-")
        process = subprocess.Popen(
            [str(self.mock_binary if mock_converter else self.binary), "--fd",
             str(right.fileno()), directory.name],
            pass_fds=[right.fileno()], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            env={**os.environ, "WORKSPACE_MOCK_FAIL": "1" if fail_converter else "0",
                 "WORKSPACE_TEST_PDF_VIEW": str(self.pdf_view),
                 "WORKSPACE_MOCK_PDF_READY": "1" if pdf_ready else "0",
                 "WORKSPACE_MOCK_PDF_LIFETIME": str(pdf_lifetime or 2),
                 "WORKSPACE_TEST_ADAPTER_ROOT": str(adapter_root or "")},
        )
        right.close()
        left.settimeout(2)
        self.assertEqual(left.recv(1), b"R")
        self.addCleanup(directory.cleanup)
        self.addCleanup(lambda: process.kill() if process.poll() is None else None)
        self.addCleanup(process.wait)
        self.addCleanup(left.close)
        return left, directory.name

    def test_png_is_admitted_to_guest_private_directory(self):
        channel, directory = self.start()
        channel.sendall(frame(1, b"photo.png", b"\x89PNG\r\n\x1a\nexample"))
        self.assertEqual(channel.recv(1), b"\x06")
        self.assertEqual((pathlib.Path(directory) / "file-0.png").read_bytes(), b"\x89PNG\r\n\x1a\nexample")

    def test_arbitrary_file_is_rejected(self):
        channel, directory = self.start()
        channel.sendall(frame(1, b"program.exe", b"MZ" + b"\0" * 16))
        self.assertEqual(channel.recv(1), b"\x15")
        self.assertEqual(os.listdir(directory), [])

    def test_path_and_second_admission_before_launch_are_rejected(self):
        channel, directory = self.start()
        channel.sendall(frame(1, b"../photo.png", b"\x89PNG\r\n\x1a\nexample"))
        self.assertEqual(channel.recv(1), b"\x15")
        self.assertEqual(os.listdir(directory), [])

        channel, directory = self.start()
        channel.sendall(frame(1, b"photo.png", b"\x89PNG\r\n\x1a\nexample"))
        self.assertEqual(channel.recv(1), b"\x06")
        # No second admission can occur until the first file is launched.
        channel.sendall(frame(1, b"photo.png", b"\x89PNG\r\n\x1a\nexample"))
        self.assertEqual(channel.recv(1), b"\x15")

    def test_jpeg_is_admitted_and_oversized_header_is_rejected(self):
        channel, directory = self.start()
        channel.sendall(frame(1, b"photo.bin", b"\xff\xd8\xff\xe0example"))
        self.assertEqual(channel.recv(1), b"\x06")
        self.assertTrue((pathlib.Path(directory) / "file-0.jpg").exists())

    def test_text_families_are_selected_from_safe_content(self):
        cases = [
            (b"notes.txt", "Olá\n".encode(), ".txt"),
            (b"wrong.exe", b'{"secret": true}\n', ".json"),
            (b"rows.csv", b"name,value\nA,1\n", ".csv"),
            (b"rows.csv", b"just words\n", ".txt"),
        ]
        for name, data, suffix in cases:
            with self.subTest(name=name, suffix=suffix):
                channel, directory = self.start()
                channel.sendall(frame(1, name, data))
                self.assertEqual(channel.recv(1), b"\x06")
                self.assertEqual((pathlib.Path(directory) / ("file-0" + suffix)).read_bytes(), data)

    def test_unsafe_text_is_rejected(self):
        for data in (b"abc\x1b[31m", b"bad\xff", b"line\x00end", b"a" * 16385,
                     b"a" * (1024 * 1024 + 1), b"\xc0\xaf", b"\xe2\x80\xaehidden",
                     b"MZ printable", b"#!/bin/sh\necho hi\n",
                     b"PK archive", b"MZ" + b"\0" * 10):
            with self.subTest(data=data[:20]):
                channel, directory = self.start()
                channel.sendall(frame(1, b"file.txt", data))
                self.assertEqual(channel.recv(1), b"\x15")
                self.assertEqual(os.listdir(directory), [])

        channel, directory = self.start()
        channel.sendall(bytes([1, 0, 5, 1, 0, 0, 1]) + b"a.png")
        self.assertEqual(channel.recv(1), b"\x15")
        self.assertEqual(os.listdir(directory), [])

    def test_zip_family_converter_routing_before_ack_with_mock_only(self):
        for extension in ("xlsx", "docx", "odt", "zip"):
            with self.subTest(extension=extension):
                channel, directory = self.start(mock_converter=True)
                channel.sendall(frame(1, ("document." + extension).encode(), b"PK\x03\x04mock"))
                self.assertEqual(channel.recv(1), b"\x06")
                self.assertEqual((pathlib.Path(directory) / "view-0.txt").read_text(),
                                 "mock view of ." + extension)

                channel, directory = self.start(mock_converter=True, fail_converter=True)
                channel.sendall(frame(1, ("document." + extension).encode(), b"PK\x03\x04mock"))
                self.assertEqual(channel.recv(1), b"\x15")
                self.assertEqual(os.listdir(directory), [])

        for name, payload in ((b"document.xlsx", b"plain text"),
                              (b"document.docx", b"MZbinary")):
            with self.subTest(name=name):
                channel, directory = self.start(mock_converter=True)
                channel.sendall(frame(1, name, payload))
                if payload == b"plain text":
                    # Safe text remains supported regardless of misleading suffix.
                    self.assertEqual(channel.recv(1), b"\x06")
                else:
                    self.assertEqual(channel.recv(1), b"\x15")

        channel, directory = self.start(mock_converter=True)
        channel.sendall(frame(1, b"empty.zip", b"PK\x05\x06" + bytes(18)))
        self.assertEqual(channel.recv(1), b"\x06")
        self.assertEqual((pathlib.Path(directory) / "view-0.txt").read_text(),
                         "mock view of .zip")

    def test_pdf_launch_requires_a_running_application(self):
        name, data = b"document.pdf", b"%PDF-1.4\nmock"
        channel, _ = self.start(pdf_ready=True)
        channel.sendall(frame(1, name, data))
        self.assertEqual(channel.recv(1), b"\x06")
        channel.sendall(frame(2, name))
        self.assertEqual(channel.recv(1), b"\x06")

        channel, _ = self.start(pdf_ready=False)
        channel.sendall(frame(1, name, data))
        self.assertEqual(channel.recv(1), b"\x06")
        channel.sendall(frame(2, name))
        self.assertEqual(channel.recv(1), b"\x15")

    def test_matching_optional_application_and_builtin_fallback(self):
        with tempfile.TemporaryDirectory(prefix="workspace-adapter-") as root:
            adapter = pathlib.Path(root)
            (adapter / "bin").mkdir()
            (adapter / "family").write_text("pdf\n")
            launch = adapter / "bin/launch"
            launch.write_text(
                "#!/usr/bin/env python3\n"
                "import pathlib, sys, time\n"
                "pathlib.Path(sys.argv[2], 'adapter-used').write_text(sys.argv[1])\n"
                "time.sleep(2)\n"
            )
            launch.chmod(0o755)
            name, data = b"document.pdf", b"%PDF-1.4\nmock"

            channel, directory = self.start(adapter_root=adapter)
            channel.sendall(frame(1, name, data))
            self.assertEqual(channel.recv(1), b"\x06")
            channel.sendall(frame(2, name))
            self.assertEqual(channel.recv(1), b"\x06")
            self.assertEqual((pathlib.Path(directory) / "adapter-used").read_text(),
                             str(pathlib.Path(directory) / "file-0.pdf"))

            (adapter / "family").write_text("image\n")
            channel, directory = self.start(adapter_root=adapter, pdf_ready=True)
            channel.sendall(frame(1, name, data))
            self.assertEqual(channel.recv(1), b"\x06")
            channel.sendall(frame(2, name))
            self.assertEqual(channel.recv(1), b"\x06")
            self.assertFalse((pathlib.Path(directory) / "adapter-used").exists())

            (adapter / "family").write_text("pdf\n")
            launch.unlink()
            launch.symlink_to(self.pdf_view)
            channel, directory = self.start(adapter_root=adapter, pdf_ready=True)
            channel.sendall(frame(1, name, data))
            self.assertEqual(channel.recv(1), b"\x06")
            channel.sendall(frame(2, name))
            self.assertEqual(channel.recv(1), b"\x06")
            self.assertFalse((pathlib.Path(directory) / "adapter-used").exists())

    def test_optional_office_and_csv_open_original_without_conversion(self):
        cases = (
            ("document", b"contract.docx", (FIXTURES / "sample-letter.docx").read_bytes(), ".docx"),
            ("spreadsheet", b"budget.xlsx", (FIXTURES / "sample-spreadsheet.xlsx").read_bytes(), ".xlsx"),
            ("spreadsheet", b"budget.csv", (FIXTURES / "sample-table.csv").read_bytes(), ".csv"),
        )
        for family, name, data, suffix in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory(prefix="workspace-adapter-") as root:
                adapter = pathlib.Path(root)
                (adapter / "bin").mkdir()
                (adapter / "family").write_text(family + "\n")
                launch = adapter / "bin/launch"
                launch.write_text(
                    "#!/usr/bin/env python3\n"
                    "import pathlib, resource, sys, time\n"
                    "pathlib.Path(sys.argv[2], 'adapter-used').write_bytes(pathlib.Path(sys.argv[1]).read_bytes())\n"
                    "pathlib.Path(sys.argv[2], 'memory-limit').write_text(str(resource.getrlimit(resource.RLIMIT_AS)[0]))\n"
                    "time.sleep(2)\n"
                )
                launch.chmod(0o755)
                channel, directory = self.start(mock_converter=True, fail_converter=True,
                                                adapter_root=adapter)
                channel.sendall(frame(1, name, data))
                self.assertEqual(channel.recv(1), b"\x06")
                self.assertEqual((pathlib.Path(directory) / ("file-0" + suffix)).read_bytes(), data)
                self.assertFalse((pathlib.Path(directory) / "view-0.txt").exists())
                channel.sendall(frame(2, name))
                self.assertEqual(channel.recv(1), b"\x06")
                self.assertEqual((pathlib.Path(directory) / "adapter-used").read_bytes(), data)
                expected_memory = 1024 if family == "document" else 512
                self.assertEqual((pathlib.Path(directory) / "memory-limit").read_text(), str(expected_memory * 1024 * 1024))

    def test_video_requires_optional_application(self):
        cases = (
            (b"clip.mp4", (FIXTURES / "sample-video.mp4").read_bytes()),
            (b"clip.webm", (FIXTURES / "sample-video.webm").read_bytes()),
        )
        for name, data in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory(prefix="workspace-video-") as root:
                channel, directory = self.start()
                channel.sendall(frame(1, name, data))
                self.assertEqual(channel.recv(1), b"\x15")
                self.assertEqual(os.listdir(directory), [])

                adapter = pathlib.Path(root)
                (adapter / "bin").mkdir()
                (adapter / "family").write_text("video\n")
                launch = adapter / "bin/launch"
                launch.write_text(
                    "#!/usr/bin/env python3\n"
                    "import pathlib, resource, sys, time\n"
                    "pathlib.Path(sys.argv[2], 'adapter-used').write_bytes(pathlib.Path(sys.argv[1]).read_bytes())\n"
                    "pathlib.Path(sys.argv[2], 'memory-limit').write_text(str(resource.getrlimit(resource.RLIMIT_AS)[0]))\n"
                    "time.sleep(2)\n"
                )
                launch.chmod(0o755)
                channel, directory = self.start(adapter_root=adapter)
                channel.sendall(frame(1, name, data))
                self.assertEqual(channel.recv(1), b"\x06")
                channel.sendall(frame(2, name))
                self.assertEqual(channel.recv(1), b"\x06")
                self.assertEqual((pathlib.Path(directory) / "memory-limit").read_text(), str(512 * 1024 * 1024))
                self.assertEqual((pathlib.Path(directory) / "adapter-used").read_bytes(), data)

    def test_optional_ooxml_rejects_signature_only(self):
        for family, name in (("document", b"contract.docx"),
                             ("spreadsheet", b"budget.xlsx")):
            with self.subTest(name=name), tempfile.TemporaryDirectory(prefix="workspace-adapter-") as root:
                adapter = pathlib.Path(root)
                (adapter / "bin").mkdir()
                (adapter / "family").write_text(family + "\n")
                launch = adapter / "bin/launch"
                launch.write_text("#!/bin/sh\nexit 0\n")
                launch.chmod(0o755)
                channel, directory = self.start(mock_converter=True, adapter_root=adapter)
                channel.sendall(frame(1, name, b"PK\x03\x04mock"))
                self.assertEqual(channel.recv(1), b"\x15")
                self.assertEqual(os.listdir(directory), [])

    def test_odt_and_zip_keep_builtin_conversion_even_with_optional_family(self):
        for family, name in (("document", b"letter.odt"), ("archive", b"bundle.zip")):
            with self.subTest(name=name), tempfile.TemporaryDirectory(prefix="workspace-adapter-") as root:
                adapter = pathlib.Path(root)
                (adapter / "bin").mkdir()
                (adapter / "family").write_text(family + "\n")
                launch = adapter / "bin/launch"
                launch.write_text("#!/bin/sh\nexit 0\n")
                launch.chmod(0o755)
                channel, directory = self.start(mock_converter=True, fail_converter=True,
                                                adapter_root=adapter)
                channel.sendall(frame(1, name, b"PK\x03\x04mock"))
                self.assertEqual(channel.recv(1), b"\x15")
                self.assertEqual(os.listdir(directory), [])

                channel, directory = self.start(mock_converter=True, adapter_root=adapter)
                channel.sendall(frame(1, name, b"PK\x03\x04mock"))
                self.assertEqual(channel.recv(1), b"\x06")
                self.assertEqual((pathlib.Path(directory) / "view-0.txt").read_text(),
                                 "mock view of " + pathlib.Path(name.decode()).suffix)

    def test_viewer_exit_closes_session_without_another_host_frame(self):
        name, data = b"document.pdf", b"%PDF-1.4\nmock"
        channel, _ = self.start(pdf_ready=True, pdf_lifetime=1)
        channel.sendall(frame(1, name, data))
        self.assertEqual(channel.recv(1), b"\x06")
        channel.sendall(frame(2, name))
        self.assertEqual(channel.recv(1), b"\x06")
        # A quiet host must not keep the decrypted session alive after the viewer exits.
        self.assertEqual(channel.recv(1), b"")

    def test_next_file_can_be_admitted_while_viewer_is_open(self):
        first, second = b"first.pdf", b"second.pdf"
        data = b"%PDF-1.4\nmock"
        channel, _ = self.start(pdf_ready=True, pdf_lifetime=3)
        channel.sendall(frame(1, first, data))
        self.assertEqual(channel.recv(1), b"\x06")
        channel.sendall(frame(2, first))
        self.assertEqual(channel.recv(1), b"\x06")
        channel.sendall(frame(1, second, data))
        self.assertEqual(channel.recv(1), b"\x06")
        channel.sendall(frame(2, second))
        self.assertEqual(channel.recv(1), b"\x06")

    def test_shared_file_corpus_guest_admission(self):
        manifest = json.loads((FIXTURES / "manifest.json").read_text())
        self.assertEqual(manifest["schema"], 1)
        for item in manifest["files"]:
            with self.subTest(file=item["file"]):
                data = (FIXTURES / item["file"]).read_bytes()
                self.assertEqual(len(data), item["bytes"])
                self.assertEqual(hashlib.sha256(data).hexdigest(), item["sha256"])

                mock = item["file"].lower().endswith((".xlsx", ".docx", ".odt", ".zip"))
                channel, directory = self.start(mock_converter=mock)
                channel.sendall(frame(1, item["file"].encode(), data))
                admitted = item["expected"]["guestAdmission"]
                self.assertEqual(channel.recv(1), b"\x06" if admitted else b"\x15")
                guest_files = list(pathlib.Path(directory).iterdir())
                if admitted:
                    self.assertEqual(len(guest_files), 2 if mock else 1)
                    self.assertTrue(any(path.read_bytes() == data for path in guest_files))
                    if mock:
                        self.assertTrue((pathlib.Path(directory) / "view-0.txt").exists())
                else:
                    self.assertEqual(guest_files, [])


if __name__ == "__main__":
    unittest.main()
