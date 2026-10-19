//! Windows WHPX guest transport. QEMU owns the named pipe; no host file is mounted.

use super::qemu_spec::{
    DisplayMode, GuestArch, HostPlatform, QemuSpec, SignedApplicationAttestation,
};
use crate::session::{safe_basename, GuestRuntime, MAX_FILE_BYTES};
use std::{
    ffi::OsStr,
    io,
    mem::size_of,
    os::windows::ffi::OsStrExt,
    path::PathBuf,
    ptr::{null, null_mut},
    sync::atomic::{compiler_fence, AtomicU64, Ordering},
    thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::{
        CloseHandle, GetLastError, ERROR_FILE_NOT_FOUND, ERROR_IO_PENDING, ERROR_PIPE_BUSY,
        GENERIC_READ, GENERIC_WRITE, HANDLE, INVALID_HANDLE_VALUE, WAIT_FAILED, WAIT_OBJECT_0,
        WAIT_TIMEOUT,
    },
    Storage::FileSystem::{
        CreateFileW, ReadFile, WriteFile, FILE_FLAG_OVERLAPPED, OPEN_EXISTING,
        SECURITY_IDENTIFICATION, SECURITY_SQOS_PRESENT,
    },
    System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
        Pipes::{GetNamedPipeServerProcessId, WaitNamedPipeW},
        Threading::{
            CreateEventW, CreateProcessW, ResumeThread, TerminateProcess, WaitForSingleObject,
            CREATE_NO_WINDOW, CREATE_SUSPENDED, PROCESS_INFORMATION, STARTUPINFOW,
        },
        IO::{CancelIoEx, GetOverlappedResultEx, OVERLAPPED},
    },
};

const READY: u8 = b'R';
const ACK: u8 = 0x06;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const READY_TIMEOUT: Duration = Duration::from_secs(30);
const IO_TIMEOUT: Duration = Duration::from_secs(30);
const IO_CHUNK: usize = 64 * 1024;
static SESSION_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug)]
pub struct WindowsQemuConfig {
    pub qemu: PathBuf,
    pub kernel: PathBuf,
    pub initramfs: PathBuf,
    pub application_image: Option<PathBuf>,
    pub application_attestation: Option<SignedApplicationAttestation>,
    pub arch: GuestArch,
    pub memory_mib: u16,
    pub display: DisplayMode,
}

impl WindowsQemuConfig {
    fn spec(&self, endpoint: String) -> QemuSpec {
        QemuSpec {
            host: HostPlatform::Windows,
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

    fn validate_files(&self) -> io::Result<()> {
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

struct OwnedHandle(HANDLE);

impl OwnedHandle {
    fn new(raw: HANDLE) -> io::Result<Self> {
        if raw.is_null() || raw == INVALID_HANDLE_VALUE {
            Err(io::Error::last_os_error())
        } else {
            Ok(Self(raw))
        }
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

struct PendingIo {
    overlapped: OVERLAPPED,
    event: OwnedHandle,
    buffer: Vec<u8>,
}

impl PendingIo {
    fn new(mut buffer: Vec<u8>) -> io::Result<Box<Self>> {
        let event = match OwnedHandle::new(unsafe { CreateEventW(null(), 1, 0, null()) }) {
            Ok(event) => event,
            Err(error) => {
                zeroize(&mut buffer);
                return Err(error);
            }
        };
        let mut pending = Box::new(Self {
            overlapped: OVERLAPPED::default(),
            event,
            buffer,
        });
        pending.overlapped.hEvent = pending.event.0;
        Ok(pending)
    }
}

impl Drop for PendingIo {
    fn drop(&mut self) {
        zeroize(&mut self.buffer);
    }
}

// Volatile writes keep the erase observable even when the buffer is dropped
// immediately afterward. The fence prevents compiler reordering around it.
fn zeroize(bytes: &mut [u8]) {
    for byte in bytes {
        unsafe { std::ptr::write_volatile(byte, 0) };
    }
    compiler_fence(Ordering::SeqCst);
}

pub struct WindowsQemuRuntime {
    config: WindowsQemuConfig,
    process: Option<OwnedHandle>,
    job: Option<OwnedHandle>,
    pipe: Option<OwnedHandle>,
    pid: Option<u32>,
}

impl WindowsQemuRuntime {
    pub fn new(config: WindowsQemuConfig) -> Self {
        Self {
            config,
            process: None,
            job: None,
            pipe: None,
            pid: None,
        }
    }

    fn checked_pipe(&self) -> io::Result<HANDLE> {
        let pipe = self
            .pipe
            .as_ref()
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotConnected, "guest unavailable"))?;
        let mut server = 0;
        if unsafe { GetNamedPipeServerProcessId(pipe.0, &mut server) } == 0 {
            return Err(io::Error::last_os_error());
        }
        if Some(server) != self.pid {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "unexpected pipe server",
            ));
        }
        Ok(pipe.0)
    }

    fn frame(&mut self, opcode: u8, name: &str, bytes: &[u8]) -> io::Result<()> {
        let result = self.send_frame(opcode, name, bytes);
        if result.is_err() {
            self.pipe.take();
        }
        result
    }

    fn send_frame(&self, opcode: u8, name: &str, bytes: &[u8]) -> io::Result<()> {
        if !safe_basename(name) {
            return Err(invalid("invalid file name"));
        }
        let pipe = self.checked_pipe()?;
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
            write_all(pipe, part, deadline)?;
        }
        if read_one(pipe, deadline)? != ACK {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "guest rejected request",
            ));
        }
        Ok(())
    }
}

impl GuestRuntime for WindowsQemuRuntime {
    type Error = io::Error;

    fn start(&mut self) -> io::Result<()> {
        if self.process.is_some() || self.job.is_some() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "guest already active",
            ));
        }
        self.config.validate_files()?;
        let name = format!(
            "inheriti_workspace_{}_{}",
            std::process::id(),
            SESSION_ID.fetch_add(1, Ordering::Relaxed)
        );
        let command = self
            .config
            .spec(name.clone())
            .command()
            .map_err(|_| invalid("invalid guest configuration"))?;
        let job = OwnedHandle::new(unsafe { CreateJobObjectW(null(), null()) })?;
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let application = wide(command.executable.as_os_str());
        let mut line = encode_command_line(&command.args);
        let mut startup = STARTUPINFOW::default();
        startup.cb = size_of::<STARTUPINFOW>() as u32;
        let mut info = PROCESS_INFORMATION::default();
        if unsafe {
            CreateProcessW(
                application.as_ptr(),
                line.as_mut_ptr(),
                null(),
                null(),
                0,
                CREATE_SUSPENDED | CREATE_NO_WINDOW,
                null(),
                null(),
                &startup,
                &mut info,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let process = OwnedHandle::new(info.hProcess)?;
        let thread = match OwnedHandle::new(info.hThread) {
            Ok(thread) => thread,
            Err(error) => {
                unsafe {
                    TerminateProcess(process.0, 1);
                }
                return Err(error);
            }
        };
        // The initial thread cannot run until its process is inside the kill-on-close job.
        if unsafe { AssignProcessToJobObject(job.0, process.0) } == 0 {
            let error = io::Error::last_os_error();
            unsafe {
                TerminateProcess(process.0, 1);
            }
            return Err(error);
        }
        self.pid = Some(info.dwProcessId);
        self.process = Some(process);
        self.job = Some(job);
        if unsafe { ResumeThread(thread.0) } == u32::MAX {
            return Err(io::Error::last_os_error());
        }
        drop(thread);

        let path = wide(OsStr::new(&format!(r"\\.\pipe\{name}")));
        let deadline = Instant::now() + CONNECT_TIMEOUT;
        loop {
            let child_status = unsafe { WaitForSingleObject(self.process.as_ref().unwrap().0, 0) };
            if child_status == WAIT_FAILED {
                return Err(io::Error::last_os_error());
            }
            if child_status == WAIT_OBJECT_0 {
                return Err(io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "guest exited before connection",
                ));
            }
            let raw = unsafe {
                CreateFileW(
                    path.as_ptr(),
                    GENERIC_READ | GENERIC_WRITE,
                    0,
                    null(),
                    OPEN_EXISTING,
                    FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION,
                    null_mut(),
                )
            };
            if raw != INVALID_HANDLE_VALUE {
                let pipe = OwnedHandle::new(raw)?;
                let mut server = 0;
                if unsafe { GetNamedPipeServerProcessId(pipe.0, &mut server) } == 0 {
                    return Err(io::Error::last_os_error());
                }
                if Some(server) != self.pid {
                    return Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        "unexpected pipe server",
                    ));
                }
                if read_one(pipe.0, Instant::now() + READY_TIMEOUT)? != READY {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "guest not ready",
                    ));
                }
                self.pipe = Some(pipe);
                return Ok(());
            }
            let code = unsafe { GetLastError() };
            if code != ERROR_FILE_NOT_FOUND && code != ERROR_PIPE_BUSY {
                return Err(io::Error::from_raw_os_error(code as i32));
            }
            if Instant::now() >= deadline {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "guest pipe deadline",
                ));
            }
            // Keep each wait short so child exit and the overall deadline are observed.
            if unsafe { WaitNamedPipeW(path.as_ptr(), 20) } == 0 {
                thread::sleep(Duration::from_millis(20));
            }
        }
    }

    fn ingress(&mut self, name: &str, bytes: &[u8]) -> io::Result<()> {
        if bytes.is_empty() || bytes.len() > MAX_FILE_BYTES {
            return Err(invalid("invalid file size"));
        }
        self.frame(1, name, bytes)
    }

    fn launch(&mut self, name: &str) -> io::Result<()> {
        self.frame(2, name, &[])
    }

    fn teardown(&mut self) -> io::Result<()> {
        self.pipe.take();
        // Closing the last job handle kills QEMU even if the process handle outlives us.
        self.job.take();
        if let Some(process) = self.process.as_ref() {
            if unsafe { WaitForSingleObject(process.0, 5_000) } != WAIT_OBJECT_0 {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "guest termination deadline",
                ));
            }
        }
        self.process.take();
        self.pid = None;
        Ok(())
    }
}

impl Drop for WindowsQemuRuntime {
    fn drop(&mut self) {
        let _ = self.teardown();
    }
}

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}
fn wide(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(Some(0)).collect()
}

// Windows command-line quoting follows the CRT backslash/quote rules. QEMU paths
// are supplied as lpApplicationName; only trusted spec arguments are encoded here.
fn encode_command_line(args: &[String]) -> Vec<u16> {
    let mut line = String::from("qemu");
    for arg in args {
        line.push(' ');
        line.push('"');
        let mut slashes = 0;
        for ch in arg.chars() {
            if ch == '\\' {
                slashes += 1;
                continue;
            }
            if ch == '"' {
                line.extend(std::iter::repeat('\\').take(slashes * 2 + 1));
            } else {
                line.extend(std::iter::repeat('\\').take(slashes));
            }
            slashes = 0;
            line.push(ch);
        }
        line.extend(std::iter::repeat('\\').take(slashes * 2));
        line.push('"');
    }
    wide(OsStr::new(&line))
}

struct Transfer {
    count: usize,
    buffer: Vec<u8>,
}

impl Drop for Transfer {
    fn drop(&mut self) {
        zeroize(&mut self.buffer);
    }
}

fn io_once(pipe: HANDLE, buffer: Vec<u8>, write: bool, deadline: Instant) -> io::Result<Transfer> {
    let mut pending = PendingIo::new(buffer)?;
    let mut count = 0;
    let issued = unsafe {
        if write {
            WriteFile(
                pipe,
                pending.buffer.as_ptr(),
                pending.buffer.len() as u32,
                null_mut(),
                &mut pending.overlapped,
            )
        } else {
            ReadFile(
                pipe,
                pending.buffer.as_mut_ptr(),
                pending.buffer.len() as u32,
                null_mut(),
                &mut pending.overlapped,
            )
        }
    };
    if issued == 0 {
        let code = unsafe { GetLastError() };
        if code != ERROR_IO_PENDING {
            return Err(io::Error::from_raw_os_error(code as i32));
        }
    }
    let remaining = deadline
        .saturating_duration_since(Instant::now())
        .as_millis()
        .min(u32::MAX as u128) as u32;
    if unsafe { GetOverlappedResultEx(pipe, &pending.overlapped, &mut count, remaining, 0) } == 0 {
        let error = io::Error::last_os_error();
        unsafe {
            CancelIoEx(pipe, &pending.overlapped);
        }
        // A canceled operation still owns its OVERLAPPED and buffer until the
        // kernel signals completion. Wait briefly, then let a recovery thread
        // erase the buffer after completion without extending this deadline.
        if unsafe { WaitForSingleObject(pending.event.0, 1_000) } != WAIT_OBJECT_0 {
            // Only an operation still pending may retain this context. Its
            // buffer must stay valid until the kernel completes cancellation.
            // Reap it outside the request deadline so plaintext is erased
            // when the completion event eventually arrives.
            // The allocation remains live even if spawning fails. A raw
            // address avoids dropping the context with a failed closure.
            let raw = Box::into_raw(pending) as usize;
            let recovery = thread::Builder::new()
                .name("workspace-pipe-reaper".into())
                .spawn(move || {
                    // SAFETY: this closure is the sole owner after a
                    // successful spawn; on spawn failure raw is leaked.
                    let pending = unsafe { Box::from_raw(raw as *mut PendingIo) };
                    if unsafe { WaitForSingleObject(pending.event.0, u32::MAX) } != WAIT_OBJECT_0 {
                        // Windows may still own OVERLAPPED on wait failure.
                        std::mem::forget(pending);
                    }
                });
            if let Err(error) = recovery {
                // The operation may still be pending; raw intentionally
                // remains allocated instead of risking use after free.
                return Err(io::Error::new(
                    io::ErrorKind::Other,
                    format!("guest I/O recovery failed: {error}"),
                ));
            }
        }
        return Err(if deadline <= Instant::now() {
            io::Error::new(io::ErrorKind::TimedOut, "guest I/O deadline")
        } else {
            error
        });
    }
    if count == 0 {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "guest closed transport",
        ));
    }
    Ok(Transfer {
        count: count as usize,
        buffer: std::mem::take(&mut pending.buffer),
    })
}

fn write_all(pipe: HANDLE, mut bytes: &[u8], deadline: Instant) -> io::Result<()> {
    while !bytes.is_empty() {
        if Instant::now() >= deadline {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "guest write deadline",
            ));
        }
        let transfer = io_once(
            pipe,
            bytes[..bytes.len().min(IO_CHUNK)].to_vec(),
            true,
            deadline,
        )?;
        bytes = &bytes[transfer.count..];
    }
    Ok(())
}

fn read_one(pipe: HANDLE, deadline: Instant) -> io::Result<u8> {
    let transfer = io_once(pipe, vec![0], false, deadline)?;
    let byte = transfer.buffer[0];
    Ok(byte)
}

#[cfg(test)]
#[path = "../../../../tests/workspace-unit/windows_qemu_tests.rs"]
mod tests;
