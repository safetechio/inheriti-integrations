#![cfg(windows)]

use std::{
    io::{Read, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

const DEADLINE: Duration = Duration::from_secs(5);
const MAX_OUTPUT: usize = 64 * 1024;

fn sidecars() -> Result<(PathBuf, PathBuf), String> {
    let directory = std::env::current_exe()
        .map_err(|_| "viewer executable unavailable")?
        .parent()
        .ok_or("viewer executable unavailable")?
        .to_path_buf();
    Ok((
        directory.join("preview-broker.exe"),
        directory.join("preview-helper.exe"),
    ))
}

pub(crate) fn ensure_preview_available() -> Result<(), String> {
    let (broker, helper) = sidecars()?;
    if !broker.is_file() || !helper.is_file() {
        return Err("isolated preview unavailable on this platform".into());
    }
    let mut child = ReapChild(
        Command::new(broker)
            .arg("--check")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "isolated preview unavailable on this platform")?,
    );
    let deadline = Instant::now() + DEADLINE;
    loop {
        if let Some(status) = child.0.try_wait().map_err(|_| "sandbox wait failed")? {
            return if status.success() {
                Ok(())
            } else {
                Err("isolated preview unavailable on this platform".into())
            };
        }
        if Instant::now() >= deadline {
            return Err("isolated preview unavailable on this platform".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

struct ReapChild(Child);

impl Drop for ReapChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

pub(crate) fn preview_text(bytes: &[u8], mime: &str) -> Result<String, String> {
    if mime != "text/plain" || bytes.is_empty() || bytes.len() > inheriti_workspace::MAX_INPUT_BYTES
    {
        return Err("unsupported preview input".into());
    }
    ensure_preview_available()?;
    let (broker, _) = sidecars()?;
    let mut child = ReapChild(
        Command::new(broker)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "sandbox unavailable")?,
    );
    let mut stdin = child.0.stdin.take().ok_or("sandbox input unavailable")?;
    let mut stdout = child.0.stdout.take().ok_or("sandbox output unavailable")?;
    let mut input = bytes.to_vec();
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let result = stdin.write_all(&input).and_then(|_| stdin.flush());
        input.fill(0);
        drop(stdin);
        let _ = sender.send(result.is_ok());
    });
    let (output_sender, output_receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut output = Vec::new();
        let result = stdout
            .take((MAX_OUTPUT + 1) as u64)
            .read_to_end(&mut output);
        let _ = output_sender.send(result.map(|_| output));
    });

    let deadline = Instant::now() + DEADLINE;
    let status = loop {
        if let Some(status) = child.0.try_wait().map_err(|_| "sandbox wait failed")? {
            break status;
        }
        if Instant::now() >= deadline {
            return Err("sandbox timed out".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    let remaining = deadline.saturating_duration_since(Instant::now());
    if !receiver.recv_timeout(remaining).unwrap_or(false) {
        return Err("sandbox input failed".into());
    }
    let output = output_receiver
        .recv_timeout(remaining)
        .map_err(|_| "sandbox output failed")?
        .map_err(|_| "sandbox output failed")?;
    if !status.success() || output.len() > MAX_OUTPUT {
        return Err("sandbox rejected preview".into());
    }
    String::from_utf8(output).map_err(|_| "invalid sandbox output".into())
}
