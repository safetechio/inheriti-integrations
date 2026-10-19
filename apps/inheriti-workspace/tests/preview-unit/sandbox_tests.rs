use super::*;
use std::time::{Duration, Instant};
#[test]
fn sandbox_command_has_only_fixed_helper_and_isolation() {
    let helper = std::env::current_exe().unwrap();
    let libraries = runtime_libraries(&helper).unwrap();
    let args = sandbox_args(&helper, &libraries).unwrap();
    assert!(args.starts_with(&[
        "--unshare-net".into(),
        "--unshare-pid".into(),
        "--unshare-ipc".into(),
        "--clearenv".into()
    ]));
    assert_eq!(args.last().unwrap(), "/app/preview-helper");
    assert!(!args
        .iter()
        .any(|arg| arg == "--bind" || arg == "--share-net"));
}
#[test]
fn missing_helper_fails_closed() {
    assert!(sandbox_args(Path::new("/missing-viewer-helper"), &BTreeSet::new()).is_err());
}
#[test]
fn sleeping_child_times_out_and_is_reaped() {
    let mut command = Command::new("sleep");
    command.arg("10");
    let start = Instant::now();
    assert_eq!(run_bounded(command, None), Err("process timed out".into()));
    assert!(start.elapsed() < Duration::from_secs(7));
}
#[test]
fn excessive_output_is_rejected() {
    let mut command = Command::new("head");
    command.args(["-c", "70000", "/dev/zero"]);
    assert_eq!(
        run_bounded(command, None),
        Err("process output too large".into())
    );
}
#[test]
fn descendant_holding_stdout_cannot_extend_deadline() {
    let mut command = Command::new("sh");
    command.args(["-c", "sleep 10 & exit 0"]);
    let start = Instant::now();
    assert_eq!(run_bounded(command, None), Err("process timed out".into()));
    assert!(start.elapsed() < Duration::from_secs(7));
}
#[test]
fn timeout_kills_descendants() {
    let marker = std::env::temp_dir().join(format!(
        "inheriti-workspace-descendant-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&marker);
    let mut command = Command::new("sh");
    command
        .arg("-c")
        .arg("(sleep 6; touch \"$MARKER\") & wait")
        .env("MARKER", &marker);
    assert_eq!(run_bounded(command, None), Err("process timed out".into()));
    std::thread::sleep(Duration::from_secs(2));
    assert!(!marker.exists(), "sandbox descendant survived timeout");
}
#[test]
fn blocked_stdin_cannot_extend_deadline() {
    let mut command = Command::new("sleep");
    command.arg("10");
    let input = vec![0_u8; 1024 * 1024];
    let start = Instant::now();
    assert_eq!(
        run_bounded(command, Some(&input)),
        Err("process timed out".into())
    );
    assert!(start.elapsed() < Duration::from_secs(7));
}
#[test]
fn preview_command_rejects_unsupported_inputs_before_launch() {
    assert_eq!(
        preview_text_linux(b"hello", "text/html"),
        Err("unsupported preview input".into())
    );
    assert_eq!(
        preview_text_linux(b"", "text/plain"),
        Err("unsupported preview input".into())
    );
    assert_eq!(
        preview_text_linux(
            &vec![b'a'; inheriti_workspace::MAX_INPUT_BYTES + 1],
            "text/plain"
        ),
        Err("unsupported preview input".into())
    );
}
#[test]
fn preview_command_sends_plain_text_to_helper() {
    let helper = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("preview-helper");
    assert!(
        helper.is_file(),
        "build preview-helper before this Linux integration fixture"
    );
    assert_eq!(
        preview_text_linux_with_helper(b"Safe text\n", "text/plain", &helper),
        Ok("Safe text\n".into())
    );
    assert_eq!(
        preview_text_linux_with_helper(b"<script>alert(1)</script>", "text/plain", &helper),
        Err("sandbox rejected preview".into())
    );
}
#[test]
fn preview_command_decodes_webp_in_sandbox() {
    let helper = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("preview-helper");
    let mut synthetic = Vec::new();
    image_webp::WebPEncoder::new(&mut synthetic)
        .encode(&[1, 2, 3, 255], 1, 1, image_webp::ColorType::Rgba8)
        .unwrap();
    assert_eq!(
        preview_webp_linux_with_helper(&synthetic, &helper),
        Ok((1, 1, vec![1, 2, 3, 255]))
    );
    assert!(preview_webp_linux_with_helper(b"bad image", &helper).is_err());
}
