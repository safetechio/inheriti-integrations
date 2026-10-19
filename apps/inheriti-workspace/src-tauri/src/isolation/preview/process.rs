use std::{
    io::{Read, Write},
    os::{fd::AsRawFd, unix::process::CommandExt},
    process::{Child, Command, ExitStatus, Stdio},
    time::{Duration, Instant},
};

struct ReapChild(Child);

impl Drop for ReapChild {
    fn drop(&mut self) {
        // Kill descendants that inherited the child's process group, including on timeout.
        let _ = unsafe { libc::kill(-(self.0.id() as i32), libc::SIGKILL) };
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

pub(super) fn run_bounded(
    command: Command,
    input: Option<&[u8]>,
) -> Result<(ExitStatus, Vec<u8>), String> {
    run_bounded_with_limit(command, input, 64 * 1024)
}

pub(super) fn run_bounded_with_limit(
    mut command: Command,
    input: Option<&[u8]>,
    max_output: usize,
) -> Result<(ExitStatus, Vec<u8>), String> {
    let deadline = Instant::now() + Duration::from_secs(5);
    command.process_group(0);
    command.stdout(Stdio::piped()).stderr(Stdio::null());
    if input.is_some() {
        command.stdin(Stdio::piped());
    }
    let mut child = ReapChild(command.spawn().map_err(|_| "process unavailable")?);
    let mut stdout = child.0.stdout.take().ok_or("process stdout unavailable")?;
    set_nonblocking(stdout.as_raw_fd())?;
    let mut stdin = child.0.stdin.take();
    if let Some(stdin) = stdin.as_ref() {
        set_nonblocking(stdin.as_raw_fd())?;
    }
    let mut input_offset = 0;
    let mut status = None;
    let mut output = Vec::new();
    let mut output_done = false;
    loop {
        if let (Some(bytes), Some(pipe)) = (input, stdin.as_mut()) {
            if input_offset < bytes.len() {
                match pipe.write(&bytes[input_offset..]) {
                    Ok(0) => return Err("process input failed".into()),
                    Ok(count) => input_offset += count,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(_) => return Err("process input failed".into()),
                }
            }
            if input_offset == bytes.len() {
                stdin.take(); // EOF tells the helper that the request is complete.
            }
        }
        if status.is_none() {
            status = child.0.try_wait().map_err(|_| "process wait failed")?;
        }
        if !output_done {
            let mut buffer = [0_u8; 8192];
            let remaining = (max_output + 1 - output.len()).min(buffer.len());
            match stdout.read(&mut buffer[..remaining]) {
                Ok(0) => output_done = true,
                Ok(count) => output.extend_from_slice(&buffer[..count]),
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(_) => return Err("process output failed".into()),
            }
            if output.len() > max_output {
                return Err("process output too large".into());
            }
        }
        if let (Some(status), true, true) = (status, output_done, stdin.is_none()) {
            return Ok((status, output));
        }
        if Instant::now() >= deadline {
            return Err("process timed out".into());
        }
        std::thread::sleep(Duration::from_millis(1));
    }
}

pub(crate) fn set_nonblocking(fd: std::os::fd::RawFd) -> Result<(), String> {
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err("process pipe unavailable".into());
    }
    Ok(())
}
