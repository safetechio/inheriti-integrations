#!/usr/bin/env python3
"""Local framing test; it does not prove VM isolation."""
import pathlib
import socket
import struct
import subprocess
import sys
import tempfile


def frame(sock, opcode, name, payload=b""):
    encoded = name.encode()
    sock.sendall(struct.pack(">BHI", opcode, len(encoded), len(payload)) + encoded + payload)
    try:
        return sock.recv(1)
    except ConnectionResetError:
        return b""


def run_case(agent, payload, expect_launch, tamper=False):
    with tempfile.TemporaryDirectory() as directory:
        path = pathlib.Path(directory) / "input"
        host, guest = socket.socketpair()
        with host, guest:
            host.settimeout(3)
            process = subprocess.Popen(
                [agent, "--fd", str(guest.fileno()), str(path)],
                pass_fds=(guest.fileno(),),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            guest.close()
            assert host.recv(1) == b"R"
            assert frame(host, 1, "sample.pdf", payload) == b"\x06"
            assert path.read_bytes() == payload
            if tamper:
                path.write_bytes(payload + b"changed")
            assert frame(host, 2, "sample.pdf") == expect_launch
            host.close()
            assert process.wait(timeout=3) == 0


def run_frames(agent, frames, expected, check_files=None):
    with tempfile.TemporaryDirectory() as directory:
        path = pathlib.Path(directory) / "input"
        host, guest = socket.socketpair()
        with host, guest:
            host.settimeout(3)
            process = subprocess.Popen(
                [agent, "--fd", str(guest.fileno()), str(path)],
                pass_fds=(guest.fileno(),),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            guest.close()
            assert host.recv(1) == b"R"
            for (opcode, name, payload), reply in zip(frames, expected):
                if reply == b"":
                    encoded = name.encode()
                    host.sendall(struct.pack(">BHI", opcode, len(encoded), len(payload)) + encoded)
                    assert host.recv(1) == b""
                else:
                    assert frame(host, opcode, name, payload) == reply
            if check_files:
                for suffix, payload in check_files.items():
                    assert (pathlib.Path(str(path) + suffix)).read_bytes() == payload
            host.close()
            assert process.wait(timeout=3) == 0


def pair(name, payload):
    return [(1, name, payload), (2, name, b"")]


def run_multi_file_cases(agent):
    first = b"%PDF-1.7\nfirst"
    second = b"\x89PNG\r\n\x1a\nsecond"
    run_frames(agent, pair("first.pdf", first) + pair("second.png", second),
               [b"\x06"] * 4, {"": first, "-2": second})
    run_frames(agent, [(1, "first.pdf", first), (2, "other.pdf", b"")],
               [b"\x06", b""])
    run_frames(agent, [(1, "first.pdf", first), (1, "second.png", second)],
               [b"\x06", b""])
    run_frames(agent, pair("first.pdf", first) + [(1, "FIRST.PDF", second)],
               [b"\x06", b"\x06", b""])
    run_frames(agent, pair("first.pdf", first) + [(1, "../bad.pdf", second)],
               [b"\x06", b"\x06", b""])
    run_frames(agent, pair("first.pdf", first) + [(1, "second.png", b"x" * (16 * 1024 * 1024))],
               [b"\x06", b"\x06", b""])
    for name in ("COM10.pdf", "COM1report.pdf", "LPT2notes.pdf"):
        run_frames(agent, pair(name, first), [b"\x06", b"\x06"], {"": first})
    for name in ("COM1.pdf", "LPT2.txt", "con.pdf", "NUL"):
        run_frames(agent, [(1, name, first)], [b""])
    frames = []
    for index in range(16):
        frames += pair(f"file{index}.pdf", first)
    frames.append((1, "file16.pdf", first))
    run_frames(agent, frames, [b"\x06"] * 32 + [b""])


def main():
    agent = sys.argv[1]
    run_case(agent, b"%PDF-1.7\nsynthetic", b"\x06")
    run_case(agent, b"\x89PNG\r\n\x1a\nsynthetic", b"\x06")
    run_case(agent, b"\xff\xd8\xffsynthetic", b"\x06")
    run_case(agent, b"RIFF0000WEBPsynthetic", b"\x06")
    run_case(agent, b"unsupported", b"\x15")
    run_case(agent, b"%PDF-1.7\nsynthetic", b"\x15", tamper=True)
    run_multi_file_cases(agent)
    print("20 local protocol cases passed")


if __name__ == "__main__":
    main()
