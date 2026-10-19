//! Linux guest transport. The guest image must run an agent on the named virtio port.
//! No host file path, filesystem, network, or clipboard is exposed to the guest.

use super::qemu_spec::{
    DisplayMode, GuestArch, HostPlatform, QemuSpec, SignedApplicationAttestation,
};
use crate::session::{safe_basename, GuestRuntime, MAX_FILE_BYTES};
use std::os::unix::net::UnixStream;
use std::{
    fs,
    io::{self, Read, Write},
    os::{
        unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt},
        unix::process::CommandExt,
    },
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant},
};

const READY: u8 = b'R';
const ACK: u8 = 0x06;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const READY_TIMEOUT: Duration = Duration::from_secs(30);
const IO_TIMEOUT: Duration = Duration::from_secs(30);
static SESSION_ID: AtomicU64 = AtomicU64::new(0);

/// All paths are local trusted installation/configuration paths, never file inputs.
#[derive(Clone, Debug)]
pub struct LinuxQemuConfig {
    pub qemu: PathBuf,
    pub kernel: PathBuf,
    pub initramfs: PathBuf,
    pub application_image: Option<PathBuf>,
    pub application_attestation: Option<SignedApplicationAttestation>,
    pub arch: GuestArch,
    /// Existing private (0700) directory owned by this user.
    pub socket_directory: PathBuf,
    pub memory_mib: u16,
    pub display: DisplayMode,
}

impl LinuxQemuConfig {
    fn validate(&self) -> io::Result<()> {
        for path in [&self.qemu, &self.kernel, &self.initramfs] {
            if !path.is_absolute() || !path.metadata()?.is_file() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "invalid guest component path",
                ));
            }
        }
        if let Some(path) = &self.application_image {
            super::platform::validate_application_image(path)?;
        }
        let metadata = fs::symlink_metadata(&self.socket_directory)?;
        if !self.socket_directory.is_absolute()
            || !metadata.is_dir()
            || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.permissions().mode() & 0o077 != 0
            || self.socket_directory.as_os_str().len() > 64
            || self.socket_directory.to_string_lossy().contains(',')
            || !(128..=4096).contains(&self.memory_mib)
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid guest configuration",
            ));
        }
        Ok(())
    }

    fn command(&self, socket: &std::path::Path) -> io::Result<Command> {
        let spec = QemuSpec {
            host: HostPlatform::Linux,
            arch: self.arch,
            executable: self.qemu.clone(),
            kernel: self.kernel.clone(),
            initramfs: self.initramfs.clone(),
            application_image: self.application_image.clone(),
            application_attestation: self.application_attestation.clone(),
            endpoint: socket
                .to_str()
                .ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidInput, "invalid guest socket path")
                })?
                .to_owned(),
            memory_mib: self.memory_mib,
            display: self.display,
        };
        let spec = spec
            .command()
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid guest command"))?;
        let mut command = Command::new(spec.executable);
        command.args(spec.args);
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        Ok(command)
    }
}

pub struct LinuxQemuRuntime {
    config: LinuxQemuConfig,
    child: Option<Child>,
    stream: Option<UnixStream>,
    session_directory: Option<PathBuf>,
}

impl LinuxQemuRuntime {
    pub fn new(config: LinuxQemuConfig) -> Self {
        Self {
            config,
            child: None,
            stream: None,
            session_directory: None,
        }
    }

    fn frame(&mut self, opcode: u8, name: &str, bytes: &[u8]) -> io::Result<()> {
        self.frame_with_deadline(opcode, name, bytes, Instant::now() + IO_TIMEOUT)
    }

    fn frame_with_deadline(
        &mut self,
        opcode: u8,
        name: &str,
        bytes: &[u8],
        deadline: Instant,
    ) -> io::Result<()> {
        if !safe_basename(name) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid file name",
            ));
        }
        let name_len = u16::try_from(name.len())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "name too long"))?;
        let data_len = u32::try_from(bytes.len())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "file too large"))?;
        let stream = self
            .stream
            .as_mut()
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotConnected, "guest unavailable"))?;
        // v1: opcode (1 ingress, 2 launch), name length BE u16, payload length BE u32,
        // UTF-8 name, payload; guest replies with exactly one ACK byte on success.
        let result = send_frame(stream, opcode, name, bytes, name_len, data_len, deadline);
        if result.is_err() {
            // A partial frame or late reply leaves the protocol position unknown.
            self.stream.take();
        }
        result
    }
}

fn send_frame(
    stream: &mut UnixStream,
    opcode: u8,
    name: &str,
    bytes: &[u8],
    name_len: u16,
    data_len: u32,
    deadline: Instant,
) -> io::Result<()> {
    for part in [
        &[opcode][..],
        &name_len.to_be_bytes(),
        &data_len.to_be_bytes(),
        name.as_bytes(),
        bytes,
    ] {
        write_until(stream, part, deadline)?;
    }
    let mut ack = [0];
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        return Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "guest ACK deadline",
        ));
    }
    stream.set_read_timeout(Some(remaining))?;
    stream.read_exact(&mut ack).map_err(|error| {
        if matches!(
            error.kind(),
            io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
        ) {
            io::Error::new(io::ErrorKind::TimedOut, "guest ACK deadline")
        } else {
            error
        }
    })?;
    if ack != [ACK] {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "guest rejected request",
        ));
    }
    Ok(())
}

fn write_until(stream: &mut UnixStream, mut bytes: &[u8], deadline: Instant) -> io::Result<()> {
    while !bytes.is_empty() {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "guest write deadline",
            ));
        }
        stream.set_write_timeout(Some(remaining))?;
        match stream.write(bytes) {
            Ok(0) => {
                return Err(io::Error::new(
                    io::ErrorKind::WriteZero,
                    "guest closed transport",
                ))
            }
            Ok(n) => bytes = &bytes[n..],
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) =>
            {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "guest write deadline",
                ));
            }
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

fn await_guest_ready(stream: &mut UnixStream) -> io::Result<()> {
    stream.set_read_timeout(Some(READY_TIMEOUT))?;
    let mut ready = [0];
    stream.read_exact(&mut ready)?;
    if ready != [READY] {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "guest not ready",
        ));
    }
    stream.set_read_timeout(Some(IO_TIMEOUT))?;
    Ok(())
}

impl GuestRuntime for LinuxQemuRuntime {
    type Error = io::Error;

    fn start(&mut self) -> io::Result<()> {
        if self.child.is_some() || self.session_directory.is_some() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "guest already active",
            ));
        }
        self.config.validate()?;
        let session = self.config.socket_directory.join(format!(
            "workspace-{}-{}",
            std::process::id(),
            SESSION_ID.fetch_add(1, Ordering::Relaxed)
        ));
        let mut builder = fs::DirBuilder::new();
        builder.mode(0o700).create(&session)?;
        self.session_directory = Some(session.clone());
        let socket = session.join("guest.sock");
        let mut command = self.config.command(&socket)?;
        let parent = unsafe { libc::getpid() };
        // Linux ties PDEATHSIG to the thread that forks, so the session owner
        // must remain alive for the full guest lifetime.
        // SAFETY: pre_exec only calls async-signal-safe libc functions; no allocation.
        unsafe {
            command.pre_exec(move || {
                let no_core = libc::rlimit {
                    rlim_cur: 0,
                    rlim_max: 0,
                };
                if libc::setrlimit(libc::RLIMIT_CORE, &no_core) != 0 {
                    return Err(io::Error::last_os_error());
                }
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) != 0 {
                    return Err(io::Error::last_os_error());
                }
                if libc::getppid() != parent {
                    return Err(io::Error::from_raw_os_error(libc::ECHILD));
                }
                Ok(())
            });
        }
        self.child = Some(command.spawn()?);
        let deadline = Instant::now() + CONNECT_TIMEOUT;
        loop {
            if self.child.as_mut().unwrap().try_wait()?.is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "guest exited before connection",
                ));
            }
            match UnixStream::connect(&socket) {
                Ok(mut stream) => {
                    stream.set_write_timeout(Some(IO_TIMEOUT))?;
                    // QEMU creates the host socket before the guest agent boots.
                    // Never send file bytes until the agent explicitly signals readiness.
                    await_guest_ready(&mut stream)?;
                    self.stream = Some(stream);
                    return Ok(());
                }
                Err(error)
                    if Instant::now() < deadline
                        && matches!(
                            error.kind(),
                            io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused
                        ) =>
                {
                    thread::sleep(Duration::from_millis(20));
                }
                Err(error) => return Err(error),
            }
        }
    }

    fn ingress(&mut self, name: &str, bytes: &[u8]) -> io::Result<()> {
        if bytes.is_empty() || bytes.len() > MAX_FILE_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid file size",
            ));
        }
        self.frame(1, name, bytes)
    }

    fn launch(&mut self, name: &str) -> io::Result<()> {
        self.frame(2, name, &[])
    }

    fn teardown(&mut self) -> io::Result<()> {
        self.stream.take();
        if let Some(child) = self.child.as_mut() {
            match child.kill() {
                Ok(()) => (),
                Err(error) if error.kind() == io::ErrorKind::InvalidInput => (),
                Err(error) => return Err(error),
            }
            child.wait()?;
            self.child = None;
        }
        if let Some(directory) = self.session_directory.as_ref() {
            fs::remove_dir_all(directory)?;
            self.session_directory = None;
        }
        Ok(())
    }
}

impl Drop for LinuxQemuRuntime {
    fn drop(&mut self) {
        let _ = self.teardown();
    }
}

#[cfg(test)]
#[path = "../../../../tests/workspace-unit/linux_qemu_tests.rs"]
mod tests;
