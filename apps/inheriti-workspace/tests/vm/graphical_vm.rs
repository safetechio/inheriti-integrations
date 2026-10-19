//! Opt-in Linux graphical appliance probes. The monitor exists only in this test wrapper.

#[cfg(target_os = "linux")]
mod linux {
    use inheriti_workspace::workspace::linux_qemu::{LinuxQemuConfig, LinuxQemuRuntime};
    use inheriti_workspace::workspace::qemu_spec::{DisplayMode, GuestArch};
    use inheriti_workspace::workspace::Workspace;
    use std::fs;
    use std::io::{Read, Write};
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    use std::os::unix::net::UnixStream;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    static VM_LOCK: Mutex<()> = Mutex::new(());

    struct TempRoot(PathBuf);
    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn required_path(name: &str) -> PathBuf {
        let path = PathBuf::from(std::env::var_os(name).unwrap_or_else(|| panic!("set {name}")));
        assert!(
            path.is_absolute() && path.is_file(),
            "invalid {name}: {}",
            path.display()
        );
        path
    }

    fn shell_quote(value: &Path) -> String {
        format!("'{}'", value.to_string_lossy().replace('\'', "'\\''"))
    }

    fn ppm_pixels(ppm: &[u8]) -> Option<(usize, usize, &[u8])> {
        if !ppm.starts_with(b"P6\n") {
            return None;
        }
        let mut cursor = 3;
        let mut fields = Vec::new();
        while fields.len() < 3 {
            while ppm.get(cursor).is_some_and(u8::is_ascii_whitespace) {
                cursor += 1;
            }
            if ppm.get(cursor) == Some(&b'#') {
                while ppm.get(cursor).is_some_and(|byte| *byte != b'\n') {
                    cursor += 1;
                }
                continue;
            }
            let start = cursor;
            while ppm.get(cursor).is_some_and(u8::is_ascii_digit) {
                cursor += 1;
            }
            if start == cursor {
                return None;
            }
            fields.push(
                std::str::from_utf8(&ppm[start..cursor])
                    .ok()?
                    .parse::<usize>()
                    .ok()?,
            );
        }
        if ppm.get(cursor) != Some(&b'\n') && ppm.get(cursor) != Some(&b' ') {
            return None;
        }
        cursor += 1;
        let [width, height, 255] = fields[..] else {
            return None;
        };
        let size = width.checked_mul(height)?.checked_mul(3)?;
        if width < 64 || height < 64 {
            return None;
        }
        Some((width, height, ppm.get(cursor..cursor.checked_add(size)?)?))
    }

    fn has_magenta_fixture(ppm: &[u8]) -> bool {
        ppm_pixels(ppm).is_some_and(|(_, _, pixels)| {
            pixels
                .chunks_exact(3)
                .filter(|rgb| *rgb == [0xe3, 0x1b, 0x91])
                .take(1024)
                .count()
                == 1024
        })
    }

    fn has_photo_pixels(ppm: &[u8]) -> bool {
        let Some((width, height, pixels)) = ppm_pixels(ppm) else {
            return false;
        };
        // The test guest has a black desktop. Feh must display the 810x540
        // fixture at its natural resolution, with every decoded RGB pixel intact.
        let mut bounds = (width, height, 0, 0);
        for (index, rgb) in pixels.chunks_exact(3).enumerate() {
            if rgb != [0, 0, 0] {
                let (x, y) = (index % width, index / width);
                bounds.0 = bounds.0.min(x);
                bounds.1 = bounds.1.min(y);
                bounds.2 = bounds.2.max(x + 1);
                bounds.3 = bounds.3.max(y + 1);
            }
        }
        let (left, top, right, bottom) = bounds;
        if right <= left || bottom <= top || right - left != 810 || bottom - top != 540 {
            return false;
        }
        let mut hash = 0xcbf29ce484222325_u64;
        for y in top..bottom {
            for byte in &pixels[(y * width + left) * 3..(y * width + right) * 3] {
                hash = (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3);
            }
        }
        hash == 0x49d9576673eaa859
    }

    fn fnv1a64(bytes: &[u8]) -> u64 {
        bytes.iter().fold(0xcbf29ce484222325_u64, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        })
    }

    fn has_document_window_pixels(ppm: &[u8]) -> bool {
        let Some((width, height, pixels)) = ppm_pixels(ppm) else {
            return false;
        };
        // A successful ingress ACK is insufficient: the black desktop must
        // contain a substantial light page/terminal, with visible dark text.
        let mut bounds = (width, height, 0, 0);
        let mut light = 0;
        for (index, rgb) in pixels.chunks_exact(3).enumerate() {
            if rgb.iter().all(|channel| *channel >= 225) {
                let (x, y) = (index % width, index / width);
                bounds.0 = bounds.0.min(x);
                bounds.1 = bounds.1.min(y);
                bounds.2 = bounds.2.max(x + 1);
                bounds.3 = bounds.3.max(y + 1);
                light += 1;
            }
        }
        let (left, top, right, bottom) = bounds;
        if light < 30_000 || right.saturating_sub(left) < 300 || bottom.saturating_sub(top) < 180 {
            return false;
        }
        let mut dark = 0;
        for y in (top + 8)..bottom.saturating_sub(8) {
            for rgb in pixels[(y * width + left) * 3..(y * width + right) * 3].chunks_exact(3) {
                if rgb.iter().all(|channel| *channel <= 90) {
                    dark += 1;
                    if dark >= 100 {
                        return true;
                    }
                }
            }
        }
        false
    }

    fn run_graphical_fixture(name: &str, bytes: Vec<u8>, visible: fn(&[u8]) -> bool) {
        run_graphical_fixture_with_timeout(
            name,
            bytes,
            visible,
            Duration::from_secs(10),
            None,
            true,
        );
    }

    fn run_graphical_fixture_with_timeout(
        name: &str,
        bytes: Vec<u8>,
        visible: fn(&[u8]) -> bool,
        timeout: Duration,
        interaction: Option<fn(&mut UnixStream, &Path, &[u8])>,
        expect_launch: bool,
    ) {
        let _lock = VM_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert!(
            std::env::var_os("DISPLAY").is_some() || std::env::var_os("WAYLAND_DISPLAY").is_some(),
            "SDL desktop display required"
        );
        let qemu = required_path("WORKSPACE_QEMU");
        let kernel = required_path("WORKSPACE_KERNEL");
        let initramfs = required_path("WORKSPACE_INITRAMFS");
        let memory_mib = std::env::var("WORKSPACE_MEMORY_MIB")
            .ok()
            .map(|value| value.parse::<u16>().expect("WORKSPACE_MEMORY_MIB integer"))
            .unwrap_or(384);
        assert!(
            (128..=512).contains(&memory_mib),
            "WORKSPACE_MEMORY_MIB must be 128..=512"
        );
        let root = std::env::temp_dir().join(format!("iw-gfx-{}", std::process::id()));
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&root)
            .expect("private test directory");
        let _root_guard = TempRoot(root.clone());
        let wrapper = root.join("qemu-test-wrapper");
        let monitor = root.join("monitor.sock");
        let dump = root.join("screen.ppm");
        let evidence = std::env::var_os("WORKSPACE_GRAPHICAL_DUMP").map(PathBuf::from);
        // Production QemuSpec keeps `-monitor none`; this wrapper replaces that pair
        // only for this executable, so the test can inspect guest display pixels.
        let script = format!(
            "#!/usr/bin/env bash\nset -euo pipefail\nargs=()\nwhile (($#)); do\n  if [[ $1 == -monitor && ${{2-}} == none ]]; then shift 2; else args+=(\"$1\"); shift; fi\ndone\nexec {} \"${{args[@]}}\" -monitor {}\n",
            shell_quote(&qemu),
            shell_quote(Path::new(&format!("unix:{},server=on,wait=off", monitor.display())))
        );
        fs::write(&wrapper, script).expect("write test wrapper");
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).unwrap();
        let arch = match std::env::consts::ARCH {
            "x86_64" => GuestArch::X86_64,
            "aarch64" => GuestArch::Aarch64,
            other => panic!("unsupported host architecture: {other}"),
        };
        let mut workspace = Workspace::new(LinuxQemuRuntime::new(LinuxQemuConfig {
            qemu: wrapper,
            kernel,
            initramfs,
            application_image: None,
            application_attestation: None,
            arch,
            socket_directory: root.clone(),
            memory_mib,
            display: DisplayMode::GraphicalSdl,
        }));
        let mut authorized = false;
        let opened = workspace.open_authorized(name, || {
            authorized = true;
            Ok::<Vec<u8>, ()>(bytes)
        });
        if !expect_launch {
            assert!(authorized, "guest did not reach file authorization");
            assert!(opened.is_err(), "malformed document unexpectedly launched");
            return;
        }
        opened.expect("guest ingress and launch");
        let deadline = Instant::now() + timeout;
        let mut observed = false;
        let mut first_visible_screen = None;
        let mut monitor_result = String::new();
        let mut stream = loop {
            match UnixStream::connect(&monitor) {
                Ok(stream) => break stream,
                Err(_) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(100))
                }
                Err(error) => panic!("QEMU test monitor unavailable: {error}"),
            }
        };
        stream
            .set_read_timeout(Some(Duration::from_millis(500)))
            .unwrap();
        let mut response = [0_u8; 512];
        let _ = stream.read(&mut response);
        while Instant::now() < deadline {
            let _ = fs::remove_file(&dump);
            writeln!(stream, "screendump {}", dump.display()).expect("QEMU monitor command");
            stream.flush().unwrap();
            std::thread::sleep(Duration::from_millis(200));
            if let Ok(size) = stream.read(&mut response) {
                monitor_result = String::from_utf8_lossy(&response[..size]).into_owned();
            }
            if let Ok(screen) = fs::read(&dump) {
                if let Some(path) = &evidence {
                    fs::write(path, &screen).expect("save graphical test screendump");
                }
                if visible(&screen) {
                    observed = true;
                    first_visible_screen = Some(screen);
                    break;
                }
            }
        }
        if let (Some(action), Some(screen)) = (interaction, first_visible_screen.as_deref()) {
            action(&mut stream, &dump, screen);
        }
        workspace.close().expect("guest teardown");
        assert!(
            observed,
            "{name} pixels never appeared in the guest display; monitor: {monitor_result:?}"
        );
    }

    #[test]
    #[ignore = "requires KVM, SDL-capable QEMU, a graphical guest image, and a desktop display"]
    fn png_pixels_reach_qemu_display() {
        run_graphical_fixture(
            "fixture.png",
            include_bytes!("fixture-magenta.png").to_vec(),
            has_magenta_fixture,
        );
    }

    #[test]
    #[ignore = "requires KVM, SDL-capable QEMU, the selected JPEG fixture, and a desktop display"]
    fn real_jpeg_pixels_reach_qemu_display() {
        let jpeg = fs::read(required_path("WORKSPACE_JPEG_FIXTURE")).expect("read JPEG fixture");
        assert_eq!(jpeg.len(), 277_800, "unexpected JPEG fixture size");
        assert_eq!(
            fnv1a64(&jpeg),
            0xfbf885f67f717b2f,
            "unexpected JPEG fixture hash"
        );
        run_graphical_fixture("seebensee.jpg", jpeg, has_photo_pixels);
    }

    #[test]
    #[ignore = "requires KVM, SDL-capable QEMU, a graphical guest image, and a desktop display"]
    fn text_document_pixels_reach_qemu_display() {
        run_graphical_fixture(
            "notes.txt",
            include_bytes!("../fixtures/sample-notes.txt").to_vec(),
            has_document_window_pixels,
        );
    }

    #[test]
    #[ignore = "requires KVM, SDL-capable QEMU, a graphical guest image, and a desktop display"]
    fn json_document_pixels_reach_qemu_display() {
        run_graphical_fixture(
            "data.json",
            include_bytes!("../fixtures/sample-data.json").to_vec(),
            has_document_window_pixels,
        );
    }

    #[test]
    #[ignore = "requires KVM, SDL-capable QEMU, a graphical guest image, and a desktop display"]
    fn csv_document_pixels_reach_qemu_display() {
        run_graphical_fixture(
            "table.csv",
            include_bytes!("../fixtures/sample-table.csv").to_vec(),
            has_document_window_pixels,
        );
    }

    #[test]
    #[ignore = "requires KVM, SDL-capable QEMU, a graphical guest image, and a desktop display"]
    fn pdf_page_pixels_reach_qemu_display() {
        run_graphical_fixture_with_timeout(
            "document.pdf",
            include_bytes!("../fixtures/sample-document.pdf").to_vec(),
            has_document_window_pixels,
            Duration::from_secs(25),
            None,
            true,
        );
    }

    fn has_page_color(ppm: &[u8], red: bool) -> bool {
        ppm_pixels(ppm).is_some_and(|(_, _, pixels)| {
            pixels
                .chunks_exact(3)
                .filter(|rgb| {
                    if red {
                        rgb[0] > 180 && rgb[1] < 80 && rgb[2] < 80
                    } else {
                        rgb[0] < 80 && rgb[1] < 100 && rgb[2] > 180
                    }
                })
                .take(10_000)
                .count()
                == 10_000
        })
    }

    fn has_first_pdf_page(ppm: &[u8]) -> bool {
        has_page_color(ppm, true)
    }

    fn red_page_pixels(ppm: &[u8]) -> usize {
        ppm_pixels(ppm).map_or(0, |(_, _, pixels)| {
            pixels
                .chunks_exact(3)
                .filter(|rgb| rgb[0] > 180 && rgb[1] < 80 && rgb[2] < 80)
                .count()
        })
    }

    fn wait_for_second_pdf_page(stream: &mut UnixStream, dump: &Path) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            let _ = fs::remove_file(dump);
            writeln!(stream, "screendump {}", dump.display()).unwrap();
            stream.flush().unwrap();
            std::thread::sleep(Duration::from_millis(150));
            if let Ok(screen) = fs::read(dump) {
                if has_page_color(&screen, false) {
                    if let Some(path) = std::env::var_os("WORKSPACE_GRAPHICAL_DUMP") {
                        fs::write(path, &screen).expect("save second PDF page screenshot");
                    }
                    return;
                }
            }
        }
        panic!("the blue second PDF page did not appear");
    }

    fn check_pdf_next_page(stream: &mut UnixStream, dump: &Path, first: &[u8]) {
        assert!(has_page_color(first, true), "first PDF page was not red");
        writeln!(stream, "sendkey pgdn").expect("send Page Down to guest");
        stream.flush().unwrap();
        wait_for_second_pdf_page(stream, dump);
    }

    fn check_pdf_search(stream: &mut UnixStream, dump: &Path, first: &[u8]) {
        assert!(has_page_color(first, true), "first PDF page was not red");
        for key in ["slash", "s", "e", "c", "o", "n", "d", "ret"] {
            writeln!(stream, "sendkey {key}").expect("send PDF search keystroke");
            stream.flush().unwrap();
            std::thread::sleep(Duration::from_millis(40));
        }
        wait_for_second_pdf_page(stream, dump);
    }

    fn check_pdf_zoom(stream: &mut UnixStream, dump: &Path, first: &[u8]) {
        let before = red_page_pixels(first);
        assert!(before > 10_000, "first PDF page was not red");
        writeln!(stream, "sendkey shift-equal").expect("send PDF zoom key");
        stream.flush().unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            let _ = fs::remove_file(dump);
            writeln!(stream, "screendump {}", dump.display()).unwrap();
            stream.flush().unwrap();
            std::thread::sleep(Duration::from_millis(150));
            if let Ok(screen) = fs::read(dump) {
                if red_page_pixels(&screen) > before + before / 10 {
                    return;
                }
            }
        }
        panic!("PDF zoom did not enlarge the rendered page");
    }

    fn check_pdf_viewer_close(stream: &mut UnixStream, _: &Path, first: &[u8]) {
        assert!(has_page_color(first, true), "first PDF page was not red");
        writeln!(stream, "sendkey q").expect("close PDF viewer");
        stream.flush().unwrap();
        let deadline = Instant::now() + Duration::from_secs(8);
        let mut response = [0_u8; 512];
        while Instant::now() < deadline {
            match stream.read(&mut response) {
                Ok(0) => return,
                Ok(_) => (),
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    ()
                }
                Err(error) => panic!("QEMU monitor read failed: {error}"),
            }
        }
        panic!("VM remained alive after the PDF viewer closed");
    }

    #[test]
    #[ignore = "requires KVM, SDL-capable QEMU, a graphical guest image, and a desktop display"]
    fn pdf_application_navigates_to_second_page() {
        run_graphical_fixture_with_timeout(
            "two-pages.pdf",
            include_bytes!("fixture-two-pages.pdf").to_vec(),
            has_first_pdf_page,
            Duration::from_secs(25),
            Some(check_pdf_next_page),
            true,
        );
    }

    #[test]
    #[ignore = "requires KVM, SDL-capable QEMU, a graphical guest image, and a desktop display"]
    fn pdf_application_searches_second_page() {
        run_graphical_fixture_with_timeout(
            "two-pages.pdf",
            include_bytes!("fixture-two-pages.pdf").to_vec(),
            has_first_pdf_page,
            Duration::from_secs(25),
            Some(check_pdf_search),
            true,
        );
    }

    #[test]
    #[ignore = "requires KVM, SDL-capable QEMU, a graphical guest image, and a desktop display"]
    fn pdf_application_zooms_page() {
        run_graphical_fixture_with_timeout(
            "two-pages.pdf",
            include_bytes!("fixture-two-pages.pdf").to_vec(),
            has_first_pdf_page,
            Duration::from_secs(25),
            Some(check_pdf_zoom),
            true,
        );
    }

    #[test]
    #[ignore = "requires KVM, SDL-capable QEMU, a graphical guest image, and a desktop display"]
    fn pdf_viewer_close_ends_guest_session() {
        run_graphical_fixture_with_timeout(
            "two-pages.pdf",
            include_bytes!("fixture-two-pages.pdf").to_vec(),
            has_first_pdf_page,
            Duration::from_secs(25),
            Some(check_pdf_viewer_close),
            true,
        );
    }

    #[test]
    #[ignore = "requires KVM, SDL-capable QEMU, a graphical guest image, and a desktop display"]
    fn malformed_pdf_is_rejected_by_guest_application() {
        run_graphical_fixture_with_timeout(
            "invalid.pdf",
            b"%PDF-1.7\ninvalid PDF body".to_vec(),
            has_document_window_pixels,
            Duration::from_secs(5),
            None,
            false,
        );
    }

    #[test]
    #[ignore = "requires KVM, SDL-capable QEMU, a graphical guest image, and a desktop display"]
    fn xlsx_document_pixels_reach_qemu_display() {
        run_graphical_fixture(
            "spreadsheet.xlsx",
            include_bytes!("../fixtures/sample-spreadsheet.xlsx").to_vec(),
            has_document_window_pixels,
        );
    }

    #[test]
    #[ignore = "requires KVM, SDL-capable QEMU, a graphical guest image, and a desktop display"]
    fn docx_document_pixels_reach_qemu_display() {
        run_graphical_fixture(
            "letter.docx",
            include_bytes!("../fixtures/sample-letter.docx").to_vec(),
            has_document_window_pixels,
        );
    }

    #[test]
    #[ignore = "requires KVM, SDL-capable QEMU, a graphical guest image, and a desktop display"]
    fn odt_document_pixels_reach_qemu_display() {
        run_graphical_fixture(
            "letter.odt",
            include_bytes!("../fixtures/sample-letter.odt").to_vec(),
            has_document_window_pixels,
        );
    }

    #[test]
    #[ignore = "requires KVM, SDL-capable QEMU, a graphical guest image, and a desktop display"]
    fn zip_index_pixels_reach_qemu_display() {
        run_graphical_fixture(
            "archive.zip",
            include_bytes!("../fixtures/sample-archive.zip").to_vec(),
            has_document_window_pixels,
        );
    }
}
