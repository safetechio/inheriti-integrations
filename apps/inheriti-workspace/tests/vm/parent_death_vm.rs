//! Opt-in Linux process-lifecycle probe using a real QEMU guest.
#[cfg(target_os = "linux")]
mod linux {
    use inheriti_workspace::workspace::linux_qemu::{LinuxQemuConfig, LinuxQemuRuntime};
    use inheriti_workspace::workspace::qemu_spec::{DisplayMode, GuestArch};
    use inheriti_workspace::workspace::GuestRuntime;
    use std::{
        env, fs,
        os::unix::{fs::DirBuilderExt, process::ExitStatusExt},
        path::{Path, PathBuf},
        process::{Command, Stdio},
        thread,
        time::{Duration, Instant},
    };

    // /proc/<pid>/stat field 22 is starttime. Keep this with the PID so PID
    // recycling cannot make a different process look like the original QEMU.
    fn process_identity(pid: u32) -> Option<(char, u64)> {
        let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        let tail = stat.rsplit_once(") ")?.1;
        let fields: Vec<_> = tail.split_whitespace().collect();
        Some((
            fields.first()?.chars().next()?,
            fields.get(19)?.parse().ok()?,
        ))
    }

    #[test]
    #[ignore = "helper invoked only by parent_death_kills_real_qemu"]
    fn controller_process() {
        if env::var_os("WORKSPACE_PARENT_DEATH_HELPER").is_none() {
            return;
        }
        let socket_root = PathBuf::from(env::var_os("WORKSPACE_PARENT_DEATH_SOCKET_ROOT").unwrap());
        let marker = PathBuf::from(env::var_os("WORKSPACE_PARENT_DEATH_MARKER").unwrap());
        let arch = match env::consts::ARCH {
            "x86_64" => GuestArch::X86_64,
            "aarch64" => GuestArch::Aarch64,
            other => panic!("unsupported host architecture: {other}"),
        };
        let config = LinuxQemuConfig {
            qemu: PathBuf::from(env::var_os("WORKSPACE_QEMU").unwrap()),
            kernel: PathBuf::from(env::var_os("WORKSPACE_KERNEL").unwrap()),
            initramfs: PathBuf::from(env::var_os("WORKSPACE_INITRAMFS").unwrap()),
            application_image: None,
            application_attestation: None,
            socket_directory: socket_root,
            memory_mib: 384,
            arch,
            display: DisplayMode::GraphicalSdl,
        };
        let mut runtime = LinuxQemuRuntime::new(config);
        runtime.start().expect("real guest ready");
        let mut pids = Vec::new();
        for task in fs::read_dir("/proc/self/task").expect("controller tasks") {
            let children =
                fs::read_to_string(task.unwrap().path().join("children")).expect("task children");
            pids.extend(
                children
                    .split_whitespace()
                    .map(|pid| pid.parse::<u32>().unwrap()),
            );
        }
        assert_eq!(pids.len(), 1, "expected exactly the QEMU child");
        let qemu_pid = pids[0];
        let (_, starttime) = process_identity(qemu_pid).expect("QEMU process identity");
        fs::write(marker, format!("{qemu_pid} {starttime}\n")).expect("write ready marker");
        loop {
            thread::sleep(Duration::from_secs(1));
        }
    }

    struct TestRoot(PathBuf);
    impl Drop for TestRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    #[ignore = "requires local KVM, QEMU and guest image"]
    fn parent_death_kills_real_qemu() {
        for key in ["WORKSPACE_QEMU", "WORKSPACE_KERNEL", "WORKSPACE_INITRAMFS"] {
            let value = env::var_os(key).unwrap_or_else(|| panic!("{key} required"));
            assert!(Path::new(&value).is_absolute(), "{key} must be absolute");
        }
        let root = env::temp_dir().join(format!(
            "iw-pdeath-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&root)
            .expect("private socket root");
        let _guard = TestRoot(root.clone());
        let marker = root.join("ready.txt");
        struct Controller(std::process::Child);
        impl Drop for Controller {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let mut controller = Controller(
            Command::new(env::current_exe().unwrap())
                .args([
                    "--exact",
                    "linux::controller_process",
                    "--ignored",
                    "--nocapture",
                ])
                .env("WORKSPACE_PARENT_DEATH_HELPER", "1")
                .env("WORKSPACE_PARENT_DEATH_SOCKET_ROOT", &root)
                .env("WORKSPACE_PARENT_DEATH_MARKER", &marker)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("start controller"),
        );
        let deadline = Instant::now() + Duration::from_secs(45);
        let (qemu_pid, starttime) = loop {
            if let Ok(contents) = fs::read_to_string(&marker) {
                let mut fields = contents.split_whitespace();
                let pid = fields.next().unwrap().parse::<u32>().unwrap();
                let start = fields.next().unwrap().parse::<u64>().unwrap();
                break (pid, start);
            }
            if let Some(status) = controller.0.try_wait().expect("controller state") {
                panic!("controller exited before guest ready: {status}");
            }
            assert!(Instant::now() < deadline, "guest readiness deadline");
            thread::sleep(Duration::from_millis(50));
        };
        assert!(
            matches!(process_identity(qemu_pid), Some((state, value)) if state != 'Z' && value == starttime)
        );
        controller.0.kill().expect("SIGKILL controller");
        let status = controller.0.wait().expect("reap controller");
        assert_eq!(status.signal(), Some(libc::SIGKILL));
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match process_identity(qemu_pid) {
                None => break,
                Some((_, value)) if value != starttime => break,
                Some(('Z' | 'X', _)) => break,
                Some((state, _)) => {
                    assert!(
                        Instant::now() < deadline,
                        "QEMU survived controller SIGKILL in state {state}"
                    );
                    thread::sleep(Duration::from_millis(25));
                }
            }
        }
        eprintln!("controller SIGKILL terminated QEMU pid {qemu_pid} (starttime {starttime})");
    }
}
