//! Opt-in real-VM probe: an unexpected NIC must prevent guest readiness.
#[cfg(target_os = "linux")]
mod linux {
    use inheriti_workspace::workspace::handoff::{HandoffError, HandoffFailure};
    use inheriti_workspace::workspace::linux_qemu::{LinuxQemuConfig, LinuxQemuRuntime};
    use inheriti_workspace::workspace::qemu_spec::{DisplayMode, GuestArch};
    use inheriti_workspace::workspace::Workspace;
    use std::{
        env, fs,
        os::unix::fs::{DirBuilderExt, PermissionsExt},
        path::{Path, PathBuf},
        sync::atomic::{AtomicBool, Ordering},
    };

    struct TestRoot(PathBuf);
    impl Drop for TestRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    #[ignore = "requires local KVM, graphical QEMU and guest image"]
    fn injected_nic_is_rejected_before_authorization() {
        for key in ["WORKSPACE_QEMU", "WORKSPACE_KERNEL", "WORKSPACE_INITRAMFS"] {
            let value = env::var_os(key).unwrap_or_else(|| panic!("{key} required"));
            assert!(Path::new(&value).is_absolute(), "{key} must be absolute");
        }
        let root = env::temp_dir().join(format!("iw-net-{}", std::process::id()));
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&root)
            .expect("private test root");
        let _guard = TestRoot(root.clone());
        let wrapper = root.join("qemu-with-nic");
        fs::write(
            &wrapper,
            r##"#!/bin/bash
set -eu
args=("$@")
found=0
for ((i=0; i<${#args[@]}-1; i++)); do
    if [[ ${args[i]} == -nic && ${args[i+1]} == none ]]; then
        args=("${args[@]:0:i}" -netdev 'user,id=iw,restrict=on' -device 'virtio-net-pci,netdev=iw,romfile=' "${args[@]:i+2}")
        found=$((found+1))
    fi
done
[[ $found == 1 ]] || exit 90
printf '%s\n' "$$" > "$WORKSPACE_NIC_QEMU_PID"
exec "$WORKSPACE_REAL_QEMU" "${args[@]}" 2> "$WORKSPACE_NIC_QEMU_STDERR"
"##,
        )
        .expect("write QEMU wrapper");
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700))
            .expect("executable wrapper");
        let pid_marker = root.join("qemu.pid");
        let stderr_log = root.join("qemu.stderr");
        // The wrapper is test-only and substitutes precisely the production -nic none.
        env::set_var(
            "WORKSPACE_REAL_QEMU",
            env::var_os("WORKSPACE_QEMU").unwrap(),
        );
        env::set_var("WORKSPACE_NIC_QEMU_PID", &pid_marker);
        env::set_var("WORKSPACE_NIC_QEMU_STDERR", &stderr_log);
        let socket_root = root.join("sockets");
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&socket_root)
            .expect("private socket root");
        let mut config = LinuxQemuConfig {
            qemu: PathBuf::from(env::var_os("WORKSPACE_QEMU").unwrap()),
            kernel: PathBuf::from(env::var_os("WORKSPACE_KERNEL").unwrap()),
            initramfs: PathBuf::from(env::var_os("WORKSPACE_INITRAMFS").unwrap()),
            application_image: None,
            application_attestation: None,
            socket_directory: socket_root.clone(),
            memory_mib: 384,
            arch: match env::consts::ARCH {
                "x86_64" => GuestArch::X86_64,
                "aarch64" => GuestArch::Aarch64,
                other => panic!("unsupported host architecture: {other}"),
            },
            display: DisplayMode::GraphicalSdl,
        };
        // Prove this exact image and runtime can become ready and open a file.
        // Otherwise a broken guest could make the negative probe pass vacuously.
        let baseline_authorized = AtomicBool::new(false);
        let mut baseline = Workspace::new(LinuxQemuRuntime::new(config.clone()));
        baseline
            .open_authorized("baseline.txt", || {
                baseline_authorized.store(true, Ordering::SeqCst);
                Ok::<Vec<u8>, ()>(b"baseline".to_vec())
            })
            .expect("guest baseline opens a supported file");
        assert!(baseline_authorized.load(Ordering::SeqCst));
        baseline.close().expect("baseline guest closes");
        assert_eq!(fs::read_dir(&socket_root).unwrap().count(), 0);

        config.qemu = wrapper;
        let authorized = AtomicBool::new(false);
        let mut workspace = Workspace::new(LinuxQemuRuntime::new(config));
        let result = workspace.open_authorized("secret.txt", || {
            authorized.store(true, Ordering::SeqCst);
            Ok::<Vec<u8>, ()>(b"secret".to_vec())
        });
        assert!(
            matches!(
                result,
                Err(HandoffError::Failure(HandoffFailure::Runtime(_)))
            ),
            "unexpected handoff result: {result:?}"
        );
        assert!(
            !authorized.load(Ordering::SeqCst),
            "authorization was called"
        );
        let pid: u32 = fs::read_to_string(&pid_marker)
            .expect("QEMU wrapper executed")
            .trim()
            .parse()
            .expect("QEMU PID");
        let stderr = fs::read_to_string(&stderr_log).expect("QEMU stderr");
        assert!(stderr.trim().is_empty(), "QEMU itself failed: {stderr}");
        assert!(
            !Path::new(&format!("/proc/{pid}")).exists(),
            "QEMU child remained alive"
        );
        assert_eq!(fs::read_dir(&socket_root).unwrap().count(), 0);
    }
}
