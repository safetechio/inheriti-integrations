//! Opt-in device-boundary probe from a root shell in the product guest image.
#[cfg(target_os = "linux")]
mod linux {
    use inheriti_workspace::workspace::qemu_spec::{
        DisplayMode, GuestArch, HostPlatform, QemuSpec,
    };
    use std::{
        env, fs,
        io::{Read, Write},
        os::unix::{fs::DirBuilderExt, net::UnixStream},
        path::PathBuf,
        process::{Child, Command, Stdio},
        thread,
        time::{Duration, Instant},
    };

    struct RunningVm {
        child: Child,
        root: PathBuf,
    }

    impl Drop for RunningVm {
        fn drop(&mut self) {
            let _ = self.child.kill();
            let _ = self.child.wait();
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    impl RunningVm {
        fn finish(&mut self) {
            assert!(
                self.child.try_wait().expect("QEMU status").is_none(),
                "QEMU exited before probe cleanup"
            );
            self.child.kill().expect("kill QEMU after probe");
            self.child.wait().expect("reap QEMU after probe");
            fs::remove_dir_all(&self.root).expect("remove private socket directory");
            assert!(!self.root.exists(), "private socket directory remains");
        }
    }

    fn required_path(key: &str) -> PathBuf {
        let path = PathBuf::from(env::var_os(key).unwrap_or_else(|| panic!("{key} required")));
        assert!(
            path.is_absolute() && path.is_file(),
            "{key} must be an existing absolute file"
        );
        path
    }

    fn replace_pair(args: &mut [String], flag: &str, old: &str, new: String) {
        let matches: Vec<_> = args
            .windows(2)
            .enumerate()
            .filter_map(|(index, pair)| (pair[0] == flag && pair[1] == old).then_some(index))
            .collect();
        assert_eq!(matches.len(), 1, "expected one {flag} {old}");
        args[matches[0] + 1] = new;
    }

    #[test]
    #[ignore = "requires local KVM, graphical QEMU and the product guest image"]
    fn root_shell_sees_no_network_or_block_device() {
        let qemu = required_path("WORKSPACE_QEMU");
        let kernel = required_path("WORKSPACE_KERNEL");
        let initramfs = required_path("WORKSPACE_INITRAMFS");
        let root = env::temp_dir().join(format!("iw-root-{}", std::process::id()));
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&root)
            .expect("private test directory");
        let serial_path = root.join("serial.sock");
        let arch = match env::consts::ARCH {
            "x86_64" => GuestArch::X86_64,
            "aarch64" => GuestArch::Aarch64,
            other => panic!("unsupported host architecture: {other}"),
        };
        let spec = QemuSpec {
            host: HostPlatform::Linux,
            arch,
            executable: qemu,
            kernel,
            initramfs,
            application_image: None,
            application_attestation: None,
            endpoint: root.join("ingress.sock").to_str().unwrap().to_owned(),
            memory_mib: 384,
            display: DisplayMode::GraphicalSdl,
        };
        let mut command = spec.command().expect("product QEMU command");
        replace_pair(
            &mut command.args,
            "-serial",
            "none",
            format!("unix:{},server=on,wait=off", serial_path.display()),
        );
        let console = match arch {
            GuestArch::X86_64 => "ttyS0",
            GuestArch::Aarch64 => "ttyAMA0",
        };
        replace_pair(
            &mut command.args,
            "-append",
            &format!("console={console} panic=1"),
            format!("console={console} quiet loglevel=0 panic=1 rdinit=/bin/sh"),
        );
        let child = Command::new(&command.executable)
            .args(&command.args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("start QEMU");
        let mut vm = RunningVm { child, root };

        let deadline = Instant::now() + Duration::from_secs(30);
        let mut serial = loop {
            if let Ok(stream) = UnixStream::connect(&serial_path) {
                break stream;
            }
            assert!(
                vm.child.try_wait().expect("QEMU status").is_none(),
                "QEMU exited before serial connection"
            );
            assert!(
                Instant::now() < deadline,
                "serial socket did not become ready"
            );
            thread::sleep(Duration::from_millis(50));
        };
        serial
            .set_read_timeout(Some(Duration::from_millis(250)))
            .unwrap();
        let mut boot_output = Vec::new();
        while Instant::now() < deadline {
            let mut chunk = [0u8; 4096];
            match serial.read(&mut chunk) {
                Ok(0) => panic!("serial closed before shell prompt"),
                Ok(count) => boot_output.extend_from_slice(&chunk[..count]),
                Err(error)
                    if error.kind() == std::io::ErrorKind::WouldBlock
                        || error.kind() == std::io::ErrorKind::TimedOut => {}
                Err(error) => panic!("serial read failed: {error}"),
            }
            if boot_output.ends_with(b"# ") {
                break;
            }
        }
        assert!(
            boot_output.ends_with(b"# "),
            "shell prompt did not appear: {}",
            String::from_utf8_lossy(&boot_output)
        );
        // The command is echoed by the serial console. Assert only exact output lines,
        // bracketed by a completion marker, rather than matching the echoed input.
        let probe = "mount -t sysfs sysfs /sys || exit 91; printf 'IW_UID=%s\\nIW_NET=' \"$(id -u)\"; for d in /sys/class/net/*; do [ -e \"$d\" ] && printf '%s ' \"${d##*/}\"; done; printf '\\nIW_BLOCK='; for d in /sys/class/block/*; do [ -e \"$d\" ] && printf '%s ' \"${d##*/}\"; done; printf '\\nIW_DONE\\n'\n";
        serial
            .write_all(probe.as_bytes())
            .expect("send guest probe");
        let mut output = Vec::new();
        while Instant::now() < deadline {
            let mut chunk = [0u8; 4096];
            match serial.read(&mut chunk) {
                Ok(0) => panic!("serial closed before probe completed"),
                Ok(count) => output.extend_from_slice(&chunk[..count]),
                Err(error)
                    if error.kind() == std::io::ErrorKind::WouldBlock
                        || error.kind() == std::io::ErrorKind::TimedOut => {}
                Err(error) => panic!("serial read failed: {error}"),
            }
            let transcript = String::from_utf8_lossy(&output).replace('\r', "");
            let lines: Vec<_> = transcript.lines().collect();
            if lines.iter().any(|line| *line == "IW_DONE") {
                assert!(
                    lines.iter().any(|line| *line == "IW_UID=0"),
                    "guest probe did not run as root: {transcript}"
                );
                assert!(
                    lines.iter().any(|line| *line == "IW_NET=lo "),
                    "unexpected guest network devices: {transcript}"
                );
                assert!(
                    lines.iter().any(|line| *line == "IW_BLOCK="),
                    "unexpected guest block devices: {transcript}"
                );
                vm.finish();
                return;
            }
        }
        panic!(
            "guest probe timed out: {}",
            String::from_utf8_lossy(&output)
        );
    }
}
