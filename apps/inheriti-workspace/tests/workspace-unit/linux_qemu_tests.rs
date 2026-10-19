use super::*;

fn connected_runtime() -> (LinuxQemuRuntime, UnixStream) {
    let (host, guest) = UnixStream::pair().unwrap();
    let mut runtime = LinuxQemuRuntime::new(LinuxQemuConfig {
        qemu: "/qemu".into(),
        kernel: "/kernel".into(),
        initramfs: "/initramfs".into(),
        application_image: None,
        application_attestation: None,
        arch: GuestArch::X86_64,
        socket_directory: "/private".into(),
        memory_mib: 512,
        display: DisplayMode::Headless,
    });
    runtime.stream = Some(host);
    (runtime, guest)
}

#[test]
fn command_has_no_network_disk_or_host_share() {
    let config = LinuxQemuConfig {
        qemu: "/usr/bin/qemu-system-x86_64".into(),
        kernel: "/boot/vmlinuz".into(),
        initramfs: "/boot/initramfs".into(),
        application_image: None,
        application_attestation: None,
        arch: GuestArch::X86_64,
        socket_directory: "/tmp/private".into(),
        memory_mib: 512,
        display: DisplayMode::Headless,
    };
    let command = config
        .command(std::path::Path::new("/tmp/private/guest.sock"))
        .unwrap();
    let args: Vec<_> = command
        .get_args()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    assert!(args.windows(2).any(|pair| pair == ["-nic", "none"]));
    assert!(args
        .windows(2)
        .any(|pair| pair == ["-machine", "q35,accel=kvm,dump-guest-core=off"]));
    assert!(args
        .windows(2)
        .any(|pair| pair == ["-nodefaults", "-no-user-config"]));
    assert!(args
        .windows(2)
        .any(|pair| pair == ["-name", "Inheriti® Workspace"]));
    for forbidden in [
        "-drive",
        "-blockdev",
        "-fsdev",
        "-virtfs",
        "-vnc",
        "-spice",
        "-netdev",
        "-object",
    ] {
        assert!(!args.iter().any(|arg| arg == forbidden));
    }
    assert!(args
        .iter()
        .any(|arg| arg.contains("virtserialport,chardev=ingress")));

    let arm = LinuxQemuConfig {
        arch: GuestArch::Aarch64,
        qemu: "/usr/bin/qemu-system-aarch64".into(),
        ..config
    };
    let command = arm
        .command(std::path::Path::new("/tmp/private/guest.sock"))
        .unwrap();
    let args: Vec<_> = command
        .get_args()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    assert!(args
        .windows(2)
        .any(|pair| pair == ["-machine", "virt,accel=kvm,dump-guest-core=off"]));
    assert!(args.contains(&"virtio-serial-device".to_owned()));
    assert!(!args.contains(&"virtio-serial-pci".to_owned()));

    let graphical = LinuxQemuConfig {
        display: DisplayMode::GraphicalSdl,
        ..arm
    };
    let command = graphical
        .command(std::path::Path::new("/tmp/private/guest.sock"))
        .unwrap();
    let args: Vec<_> = command
        .get_args()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    assert!(args
        .windows(2)
        .any(|pair| pair == ["-display", "sdl,gl=off"]));
    assert!(args
        .windows(2)
        .any(|pair| pair == ["-device", "virtio-gpu-pci"]));
}

#[test]
fn ingress_frame_requires_guest_ack() {
    let (mut runtime, mut guest) = connected_runtime();
    let guest_thread = std::thread::spawn(move || {
        let mut frame = [0; 7 + 8 + 3];
        guest.read_exact(&mut frame).unwrap();
        assert_eq!(&frame[..7], &[1, 0, 8, 0, 0, 0, 3]);
        assert_eq!(&frame[7..], b"file.pdfPDF");
        guest.write_all(&[ACK]).unwrap();
    });
    runtime.ingress("file.pdf", b"PDF").unwrap();
    guest_thread.join().unwrap();
    assert!(runtime.ingress("../bad", b"x").is_err());
}

#[test]
fn ack_uses_remaining_frame_deadline_and_closes_transport() {
    let (mut runtime, mut guest) = connected_runtime();
    let guest_thread = std::thread::spawn(move || {
        let mut frame = [0; 7 + 8 + 1];
        guest.read_exact(&mut frame).unwrap();
        std::thread::sleep(Duration::from_millis(100));
        let _ = guest.write_all(&[ACK]);
    });
    let started = Instant::now();
    let error = runtime
        .frame_with_deadline(1, "file.pdf", b"x", started + Duration::from_millis(40))
        .unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    assert!(runtime.stream.is_none());
    assert_eq!(
        runtime.launch("file.pdf").unwrap_err().kind(),
        io::ErrorKind::NotConnected
    );
    guest_thread.join().unwrap();
}

#[test]
fn nak_and_truncated_ack_close_transport() {
    for response in [Some(0x15), None] {
        let (mut runtime, mut guest) = connected_runtime();
        let guest_thread = std::thread::spawn(move || {
            let mut frame = [0; 7 + 8];
            guest.read_exact(&mut frame).unwrap();
            if let Some(byte) = response {
                guest.write_all(&[byte]).unwrap();
            }
        });
        let error = runtime.launch("file.pdf").unwrap_err();
        assert_eq!(
            error.kind(),
            if response.is_some() {
                io::ErrorKind::InvalidData
            } else {
                io::ErrorKind::UnexpectedEof
            }
        );
        assert!(runtime.stream.is_none());
        assert_eq!(
            runtime.launch("file.pdf").unwrap_err().kind(),
            io::ErrorKind::NotConnected
        );
        guest_thread.join().unwrap();
    }
}

#[test]
fn waits_for_guest_ready_and_rejects_wrong_marker() {
    let (mut host, mut guest) = UnixStream::pair().unwrap();
    let sender = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(40));
        guest.write_all(&[READY]).unwrap();
    });
    let started = Instant::now();
    await_guest_ready(&mut host).unwrap();
    assert!(started.elapsed() >= Duration::from_millis(30));
    sender.join().unwrap();

    let (mut host, mut guest) = UnixStream::pair().unwrap();
    guest.write_all(b"X").unwrap();
    assert_eq!(
        await_guest_ready(&mut host).unwrap_err().kind(),
        io::ErrorKind::InvalidData
    );
}

#[test]
fn write_has_overall_deadline_when_guest_does_not_read() {
    let (mut host, _guest) = UnixStream::pair().unwrap();
    let bytes = vec![0x5a; 2 * 1024 * 1024];
    let started = Instant::now();
    let error = write_until(&mut host, &bytes, started + Duration::from_millis(40)).unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    assert!(started.elapsed() < Duration::from_secs(1));
}
