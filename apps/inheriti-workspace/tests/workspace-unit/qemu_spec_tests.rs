use super::*;
use base64::Engine;

fn attestation() -> SignedApplicationAttestation {
    let engine = base64::engine::general_purpose::STANDARD;
    SignedApplicationAttestation {
        manifest_b64: engine.encode(br#"{"id":"test"}"#),
        signature_b64: engine.encode([7u8; 64]),
    }
}

fn fixture(host: HostPlatform, arch: GuestArch) -> QemuSpec {
    let (executable, kernel, initramfs, endpoint) = match host {
        HostPlatform::Windows => (
            r"C:\qemu.exe",
            r"C:\kernel",
            r"C:\initrd",
            "inheriti-workspace",
        ),
        _ => (
            "/usr/bin/qemu",
            "/opt/workspace/kernel",
            "/opt/workspace/initrd",
            "/run/user/1000/workspace.sock",
        ),
    };
    QemuSpec {
        host,
        arch,
        executable: executable.into(),
        kernel: kernel.into(),
        initramfs: initramfs.into(),
        application_image: None,
        application_attestation: None,
        endpoint: endpoint.into(),
        memory_mib: 512,
        display: DisplayMode::Headless,
    }
}

#[test]
fn host_and_arch_matrix_has_only_expected_transport() {
    for host in [
        HostPlatform::Linux,
        HostPlatform::Windows,
        HostPlatform::MacOs,
    ] {
        for arch in [GuestArch::X86_64, GuestArch::Aarch64] {
            let command = fixture(host, arch).command().unwrap();
            let args = &command.args;
            let machine = args[args.iter().position(|arg| arg == "-machine").unwrap() + 1].as_str();
            let accel = match host {
                HostPlatform::Linux => "kvm",
                HostPlatform::Windows => "whpx",
                HostPlatform::MacOs => "hvf",
            };
            let machine_type = match arch {
                GuestArch::X86_64 => "q35",
                GuestArch::Aarch64 => "virt",
            };
            assert_eq!(
                machine,
                format!("{machine_type},accel={accel},dump-guest-core=off")
            );
            let console = match arch {
                GuestArch::X86_64 => "ttyS0",
                GuestArch::Aarch64 => "ttyAMA0",
            };
            assert!(args.windows(2).any(|pair| {
                pair[0] == "-append" && pair[1] == format!("console={console} panic=1")
            }));
            assert!(args.contains(
                &match arch {
                    GuestArch::X86_64 => "virtio-serial-pci",
                    GuestArch::Aarch64 => "virtio-serial-device",
                }
                .into()
            ));
            let chardev = &args[args.iter().position(|arg| arg == "-chardev").unwrap() + 1];
            if host == HostPlatform::Windows {
                assert_eq!(chardev, "pipe,id=ingress,path=inheriti-workspace");
            } else {
                assert!(chardev.starts_with("socket,id=ingress,path="));
            }
            for forbidden in [
                "-drive",
                "-blockdev",
                "-netdev",
                "-fsdev",
                "-virtfs",
                "-device usb-tablet",
                "-vga",
                "-display gtk",
            ] {
                assert!(!args.iter().any(|arg| arg == forbidden), "{forbidden}");
            }
            assert!(!args.iter().any(|arg| arg.contains("tcg")));
            assert!(args.windows(2).any(|pair| pair == ["-nic", "none"]));
            assert!(args.windows(2).any(|pair| pair == ["-display", "none"]));
        }
    }
}

#[test]
fn rejects_invalid_paths_endpoints_and_memory() {
    let mut spec = fixture(HostPlatform::Linux, GuestArch::X86_64);
    for endpoint in ["relative", "/tmp/bad,server=off", "/tmp/bad\npath"] {
        spec.endpoint = endpoint.into();
        assert_eq!(spec.command(), Err(SpecError::InvalidEndpoint));
    }
    spec.endpoint = "/tmp/good".into();
    spec.kernel = "/tmp/bad,option".into();
    assert_eq!(spec.command(), Err(SpecError::InvalidPath));
    spec.kernel = "relative".into();
    assert_eq!(spec.command(), Err(SpecError::InvalidPath));
    spec.kernel = "/kernel".into();
    spec.memory_mib = 64;
    assert_eq!(spec.command(), Err(SpecError::InvalidMemory));
    let mut windows = fixture(HostPlatform::Windows, GuestArch::Aarch64);
    for endpoint in [
        r"\\.\pipe\inheriti-workspace",
        r"C:\ordinary\file",
        "bad/name",
        "bad,name",
        "bad\nname",
        "",
    ] {
        windows.endpoint = endpoint.into();
        assert_eq!(windows.command(), Err(SpecError::InvalidEndpoint));
    }
    windows.endpoint = "x".repeat(81);
    assert_eq!(windows.command(), Err(SpecError::InvalidEndpoint));
}

#[test]
fn graphical_sdl_has_one_gpu_and_no_escape_devices_across_hosts_and_arches() {
    for host in [
        HostPlatform::Linux,
        HostPlatform::Windows,
        HostPlatform::MacOs,
    ] {
        for arch in [GuestArch::X86_64, GuestArch::Aarch64] {
            let mut spec = fixture(host, arch);
            spec.display = DisplayMode::GraphicalSdl;
            let args = spec.command().unwrap().args;
            assert!(args
                .windows(2)
                .any(|pair| pair == ["-display", "sdl,gl=off"]));
            for device in ["virtio-gpu-pci", "virtio-keyboard-pci", "virtio-tablet-pci"] {
                assert_eq!(
                    args.windows(2)
                        .filter(|pair| *pair == ["-device", device])
                        .count(),
                    1,
                    "{host:?} {arch:?}: {device}"
                );
            }
            assert!(args.windows(2).any(|pair| pair == ["-nic", "none"]));
            for forbidden in [
                "-drive",
                "-blockdev",
                "-fsdev",
                "-virtfs",
                "-netdev",
                "-vnc",
                "-spice",
                "-audiodev",
            ] {
                assert!(!args.iter().any(|arg| arg == forbidden), "{forbidden}");
            }
            spec.endpoint = "invalid,option=on".into();
            assert_eq!(spec.command(), Err(SpecError::InvalidEndpoint));
        }
    }
}

#[test]
fn graphical_virgl_has_gl_display_gpu_and_input_without_host_access() {
    for host in [
        HostPlatform::Linux,
        HostPlatform::Windows,
        HostPlatform::MacOs,
    ] {
        for arch in [GuestArch::X86_64, GuestArch::Aarch64] {
            let mut spec = fixture(host, arch);
            spec.display = DisplayMode::GraphicalVirgl;
            let args = spec.command().unwrap().args;
            for pair in [
                ["-name", "Inheriti® Workspace"],
                ["-display", "sdl,gl=on"],
                ["-device", "virtio-gpu-gl"],
                ["-device", "virtio-keyboard-pci"],
                ["-device", "virtio-tablet-pci"],
                ["-monitor", "none"],
                ["-nic", "none"],
            ] {
                assert_eq!(
                    args.windows(2).filter(|window| *window == pair).count(),
                    1,
                    "{host:?} {arch:?}: {pair:?}"
                );
            }
            for forbidden in [
                "virtio-gpu-pci",
                "-drive",
                "-blockdev",
                "-fsdev",
                "-virtfs",
                "-netdev",
                "-vnc",
                "-spice",
                "-audiodev",
            ] {
                assert!(
                    !args.iter().any(|arg| arg == forbidden),
                    "{host:?} {arch:?}: {forbidden}"
                );
            }
        }
    }
}

#[test]
fn video_playback_has_one_output_stream_only_across_hosts_and_arches() {
    for host in [
        HostPlatform::Linux,
        HostPlatform::Windows,
        HostPlatform::MacOs,
    ] {
        for arch in [GuestArch::X86_64, GuestArch::Aarch64] {
            let mut spec = fixture(host, arch);
            spec.display = DisplayMode::GraphicalSdlPlayback;
            let args = spec.command().unwrap().args;
            for pair in [
                ["-display", "sdl,gl=off"],
                ["-audiodev", "sdl,id=workspace_audio"],
                [
                    "-device",
                    "virtio-sound-pci,audiodev=workspace_audio,streams=1",
                ],
                ["-device", "virtio-gpu-pci"],
                ["-nic", "none"],
            ] {
                assert_eq!(
                    args.windows(2).filter(|window| *window == pair).count(),
                    1,
                    "{host:?} {arch:?}: {pair:?}"
                );
            }
            for forbidden in [
                "-fsdev",
                "-virtfs",
                "-netdev",
                "-vnc",
                "-spice",
                "streams=2",
            ] {
                assert!(
                    !args.iter().any(|arg| arg.contains(forbidden)),
                    "{host:?} {arch:?}: {forbidden}"
                );
            }
        }
    }
}

#[test]
fn optional_application_image_is_one_read_only_block_device_on_every_host_and_arch() {
    for host in [
        HostPlatform::Linux,
        HostPlatform::Windows,
        HostPlatform::MacOs,
    ] {
        for arch in [GuestArch::X86_64, GuestArch::Aarch64] {
            let mut spec = fixture(host, arch);
            let path = match host {
                HostPlatform::Windows => r"C:\cache\apps.img",
                _ => "/cache/apps.img",
            };
            spec.application_image = Some(path.into());
            spec.application_attestation = Some(attestation());
            let args = spec.command().unwrap().args;
            let append = &args[args.iter().position(|arg| arg == "-append").unwrap() + 1];
            let expected_attestation = attestation();
            assert!(append.contains(&format!(
                "workspace.adapter.manifest={}",
                expected_attestation.manifest_b64
            )));
            assert!(append.contains(&format!(
                "workspace.adapter.signature={}",
                expected_attestation.signature_b64
            )));
            assert_eq!(
                args.windows(2).filter(|pair| pair[0] == "-drive").count(),
                1
            );
            let drive =
                format!("media=disk,if=none,id=workspace_apps,file={path},format=raw,readonly=on");
            assert!(args
                .windows(2)
                .any(|pair| pair[0] == "-drive" && pair[1] == drive));
            assert!(args
                .windows(2)
                .any(|pair| pair == ["-device", "virtio-blk-pci,drive=workspace_apps"]));
            assert!(args.windows(2).any(|pair| pair == ["-nic", "none"]));
            assert!(!args
                .iter()
                .any(|arg| arg == "-fsdev" || arg == "-virtfs" || arg == "-netdev"));
            spec.application_image = Some("relative/apps.img".into());
            assert_eq!(spec.command(), Err(SpecError::InvalidPath));
            spec.application_image = Some(
                match host {
                    HostPlatform::Windows => r"C:\cache\apps.img,if=ide",
                    _ => "/cache/apps.img,if=ide",
                }
                .into(),
            );
            assert_eq!(spec.command(), Err(SpecError::InvalidPath));
        }
    }
}

#[test]
fn image_and_attestation_are_required_together() {
    let mut spec = fixture(HostPlatform::Linux, GuestArch::X86_64);
    spec.application_image = Some("/cache/apps.img".into());
    assert_eq!(spec.command(), Err(SpecError::InvalidAttestation));
    spec.application_image = None;
    spec.application_attestation = Some(attestation());
    assert_eq!(spec.command(), Err(SpecError::InvalidAttestation));
}

#[test]
fn rejects_malformed_or_oversized_attestation() {
    let mut spec = fixture(HostPlatform::Linux, GuestArch::X86_64);
    spec.application_image = Some("/cache/apps.img".into());
    let engine = base64::engine::general_purpose::STANDARD;
    let mut value = attestation();
    for bad in ["", "abcd-", "YQ", "YQ==\n"] {
        value.manifest_b64 = bad.into();
        spec.application_attestation = Some(value.clone());
        assert_eq!(spec.command(), Err(SpecError::InvalidAttestation));
    }
    value.manifest_b64 = engine.encode(vec![b'a'; 1025]);
    spec.application_attestation = Some(value.clone());
    assert_eq!(spec.command(), Err(SpecError::InvalidAttestation));
    value.manifest_b64 = attestation().manifest_b64;
    value.signature_b64 = engine.encode([7u8; 63]);
    spec.application_attestation = Some(value);
    assert_eq!(spec.command(), Err(SpecError::InvalidAttestation));
}
