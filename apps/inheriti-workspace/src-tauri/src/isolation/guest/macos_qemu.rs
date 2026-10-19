//! macOS HVF guest transport. The supervisor owns QEMU until it has reaped it.
use super::qemu_spec::{
    DisplayMode, GuestArch, HostPlatform, QemuSpec, SignedApplicationAttestation,
};
use crate::session::{safe_basename, GuestRuntime, MAX_FILE_BYTES};
use std::{
    fs,
    io::{self, Read, Write},
    os::unix::{
        fs::{DirBuilderExt, FileTypeExt, MetadataExt, PermissionsExt},
        io::AsRawFd,
        net::UnixStream,
    },
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant},
};

const READY: u8 = b'R';
const ACK: u8 = 0x06;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const READY_TIMEOUT: Duration = Duration::from_secs(30);
const IO_TIMEOUT: Duration = Duration::from_secs(30);
const STOP_TIMEOUT: Duration = Duration::from_secs(10);
static SESSION_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug)]
pub struct MacOsQemuConfig {
    pub qemu: PathBuf,
    pub kernel: PathBuf,
    pub initramfs: PathBuf,
    pub application_image: Option<PathBuf>,
    pub application_attestation: Option<SignedApplicationAttestation>,
    pub arch: GuestArch,
    pub memory_mib: u16,
    pub display: DisplayMode,
}

impl MacOsQemuConfig {
    fn spec(&self, endpoint: String) -> QemuSpec {
        QemuSpec {
            host: HostPlatform::MacOs,
            arch: self.arch,
            executable: self.qemu.clone(),
            kernel: self.kernel.clone(),
            initramfs: self.initramfs.clone(),
            application_image: self.application_image.clone(),
            application_attestation: self.application_attestation.clone(),
            endpoint,
            memory_mib: self.memory_mib,
            display: self.display,
        }
    }
    fn validate(&self) -> io::Result<()> {
        for path in [&self.qemu, &self.kernel, &self.initramfs] {
            if !path.is_absolute() || !path.metadata()?.is_file() {
                return Err(invalid("invalid guest component path"));
            }
        }
        if let Some(path) = &self.application_image {
            super::platform::validate_application_image(path)?;
        }
        Ok(())
    }
}

pub struct MacOsQemuRuntime {
    config: MacOsQemuConfig,
    supervisor: Option<Child>,
    control: Option<ChildStdin>,
    stream: Option<UnixStream>,
    directory: Option<PathBuf>,
}

impl MacOsQemuRuntime {
    pub fn new(config: MacOsQemuConfig) -> Self {
        Self {
            config,
            supervisor: None,
            control: None,
            stream: None,
            directory: None,
        }
    }

    fn send_frame(&mut self, opcode: u8, name: &str, bytes: &[u8]) -> io::Result<()> {
        let result = self.send_frame_inner(opcode, name, bytes);
        if result.is_err() {
            self.stream.take();
        }
        result
    }

    fn send_frame_inner(&mut self, opcode: u8, name: &str, bytes: &[u8]) -> io::Result<()> {
        if !safe_basename(name) {
            return Err(invalid("invalid file name"));
        }
        let stream = self
            .stream
            .as_mut()
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotConnected, "guest unavailable"))?;
        let name_len = u16::try_from(name.len()).map_err(|_| invalid("name too long"))?;
        let data_len = u32::try_from(bytes.len()).map_err(|_| invalid("file too large"))?;
        let deadline = Instant::now() + IO_TIMEOUT;
        for part in [
            &[opcode][..],
            &name_len.to_be_bytes(),
            &data_len.to_be_bytes(),
            name.as_bytes(),
            bytes,
        ] {
            write_all_deadline(stream, part, deadline)?;
        }
        if read_one_deadline(stream, deadline)? != ACK {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "guest rejected request",
            ));
        }
        Ok(())
    }
}

impl GuestRuntime for MacOsQemuRuntime {
    type Error = io::Error;
    fn start(&mut self) -> io::Result<()> {
        if self.supervisor.is_some() || self.directory.is_some() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "guest already active",
            ));
        }
        self.config.validate()?;
        let directory = make_session_directory()?;
        self.directory = Some(directory.clone());
        let socket = directory.join("guest.sock");
        let endpoint = socket
            .to_str()
            .ok_or_else(|| invalid("invalid socket path"))?
            .to_owned();
        // macOS sockaddr_un.sun_path is 104 bytes including the NUL terminator.
        if endpoint.len() >= 104 {
            return Err(invalid("socket path too long"));
        }
        let command = self
            .config
            .spec(endpoint)
            .command()
            .map_err(|_| invalid("invalid guest configuration"))?;
        let supervisor_path = std::env::current_exe()?.with_file_name("workspace-supervisor");
        let supervisor_meta = fs::symlink_metadata(&supervisor_path)?;
        if !supervisor_meta.file_type().is_file()
            || (supervisor_meta.uid() != 0 && supervisor_meta.uid() != unsafe { libc::geteuid() })
            || supervisor_meta.permissions().mode() & 0o022 != 0
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "untrusted workspace supervisor",
            ));
        }
        let mut child = Command::new(supervisor_path)
            .arg("--")
            .arg(command.executable)
            .args(command.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let output = child.stdout.take().ok_or_else(|| {
            io::Error::new(io::ErrorKind::BrokenPipe, "supervisor handshake missing")
        })?;
        self.control = child.stdin.take();
        self.supervisor = Some(child);
        let _guest_pid = read_guest_pid(output, Instant::now() + CONNECT_TIMEOUT)?;
        self.control
            .as_mut()
            .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "supervisor control missing"))?
            .write_all(&[1])?;
        let connect_deadline = Instant::now() + CONNECT_TIMEOUT;
        let mut stream = loop {
            if self.supervisor.as_mut().unwrap().try_wait()?.is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "supervisor exited before guest connection",
                ));
            }
            match UnixStream::connect(&socket) {
                Ok(stream) => break stream,
                Err(error)
                    if matches!(
                        error.kind(),
                        io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused
                    ) =>
                {
                    if Instant::now() >= connect_deadline {
                        return Err(io::Error::new(
                            io::ErrorKind::TimedOut,
                            "guest socket deadline",
                        ));
                    }
                    thread::sleep(Duration::from_millis(20));
                }
                Err(error) => return Err(error),
            }
        };
        let metadata = fs::symlink_metadata(&socket)?;
        if !metadata.file_type().is_socket() || metadata.uid() != unsafe { libc::geteuid() } {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "unexpected guest socket",
            ));
        }
        stream.set_read_timeout(Some(READY_TIMEOUT))?;
        if read_one_deadline(&mut stream, Instant::now() + READY_TIMEOUT)? != READY {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "guest not ready",
            ));
        }
        self.stream = Some(stream);
        Ok(())
    }
    fn ingress(&mut self, name: &str, bytes: &[u8]) -> io::Result<()> {
        if bytes.is_empty() || bytes.len() > MAX_FILE_BYTES {
            return Err(invalid("invalid file size"));
        }
        self.send_frame(1, name, bytes)
    }
    fn launch(&mut self, name: &str) -> io::Result<()> {
        self.send_frame(2, name, &[])
    }
    fn teardown(&mut self) -> io::Result<()> {
        self.stream.take();
        self.control.take(); // EOF tells the supervisor to kill and reap QEMU.
        if self.supervisor.is_some() {
            let deadline = Instant::now() + STOP_TIMEOUT;
            loop {
                let status = self.supervisor.as_mut().unwrap().try_wait()?;
                if let Some(status) = status {
                    if !status.success() {
                        // The supervisor may have failed before reaping QEMU. Keep
                        // ownership state and the socket path for recovery.
                        return Err(cleanup_unknown());
                    }
                    break;
                }
                if Instant::now() >= deadline {
                    return Err(cleanup_unknown());
                }
                thread::sleep(Duration::from_millis(20));
            }
        }
        if let Some(directory) = self.directory.as_ref() {
            match fs::remove_file(directory.join("guest.sock")) {
                Ok(()) => (),
                Err(error) if error.kind() == io::ErrorKind::NotFound => (),
                Err(error) => return Err(error),
            }
            if let Err(error) = fs::remove_dir(directory) {
                return Err(error);
            }
        }
        self.directory.take();
        self.supervisor.take();
        Ok(())
    }
}

impl Drop for MacOsQemuRuntime {
    fn drop(&mut self) {
        let _ = self.teardown();
    }
}

fn cleanup_unknown() -> io::Error {
    io::Error::new(
        io::ErrorKind::Other,
        "guest cleanup unknown: supervisor ownership lost or deadline exceeded",
    )
}

fn read_guest_pid(mut output: std::process::ChildStdout, deadline: Instant) -> io::Result<i32> {
    let mut digits = Vec::with_capacity(12);
    loop {
        let remaining_ms = remaining(deadline)?.as_millis().min(i32::MAX as u128) as i32;
        let mut poll = libc::pollfd {
            fd: output.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        };
        let result = unsafe { libc::poll(&mut poll, 1, remaining_ms) };
        if result == 0 {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "supervisor handshake deadline",
            ));
        }
        if result < 0 {
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::Interrupted {
                continue;
            }
            return Err(error);
        }
        let mut byte = [0u8; 1];
        output.read_exact(&mut byte)?;
        if byte[0] == b'\n' {
            break;
        }
        if !byte[0].is_ascii_digit() || digits.len() >= 10 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid supervisor handshake",
            ));
        }
        digits.push(byte[0]);
    }
    let text = std::str::from_utf8(&digits)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid guest pid"))?;
    let pid = text
        .parse::<i32>()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid guest pid"))?;
    if pid <= 1 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid guest pid",
        ));
    }
    Ok(pid)
}

fn make_session_directory() -> io::Result<PathBuf> {
    let base = std::env::temp_dir();
    // Reject unbounded or unusual temp paths before constructing a QEMU endpoint.
    if !base.is_absolute() || base.to_str().is_none() {
        return Err(invalid("invalid temporary directory"));
    }
    for _ in 0..64 {
        let name = format!(
            "iw-{}-{}",
            std::process::id(),
            SESSION_ID.fetch_add(1, Ordering::Relaxed)
        );
        let path = base.join(name);
        let mut builder = fs::DirBuilder::new();
        builder.mode(0o700);
        match builder.create(&path) {
            Ok(()) => {
                let meta = fs::symlink_metadata(&path)?;
                if meta.uid() != unsafe { libc::geteuid() }
                    || meta.permissions().mode() & 0o077 != 0
                {
                    let _ = fs::remove_dir(&path);
                    return Err(invalid("insecure session directory"));
                }
                return Ok(path);
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "session directory collision",
    ))
}

fn write_all_deadline(
    stream: &mut UnixStream,
    mut bytes: &[u8],
    deadline: Instant,
) -> io::Result<()> {
    while !bytes.is_empty() {
        stream.set_write_timeout(Some(remaining(deadline)?))?;
        match stream.write(bytes) {
            Ok(0) => {
                return Err(io::Error::new(
                    io::ErrorKind::WriteZero,
                    "guest closed transport",
                ))
            }
            Ok(n) => bytes = &bytes[n..],
            Err(e) if e.kind() == io::ErrorKind::Interrupted => (),
            Err(e) => return Err(e),
        }
    }
    Ok(())
}
fn read_one_deadline(stream: &mut UnixStream, deadline: Instant) -> io::Result<u8> {
    let mut byte = [0];
    loop {
        stream.set_read_timeout(Some(remaining(deadline)?))?;
        match stream.read_exact(&mut byte) {
            Ok(()) => return Ok(byte[0]),
            Err(e) if e.kind() == io::ErrorKind::Interrupted => (),
            Err(e) => return Err(e),
        }
    }
}
fn remaining(deadline: Instant) -> io::Result<Duration> {
    let left = deadline.saturating_duration_since(Instant::now());
    if left.is_zero() {
        Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "guest I/O deadline",
        ))
    } else {
        Ok(left)
    }
}
fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}
