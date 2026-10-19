use std::{process::ChildStdout, time::Instant};

#[cfg(unix)]
pub(super) fn read_host_line(
    stdout: &mut ChildStdout,
    deadline: Instant,
) -> Result<Vec<u8>, String> {
    use std::os::fd::AsRawFd;
    let fd = stdout.as_raw_fd();
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err("host unavailable".into());
    }
    super::protocol::read_host_line(stdout, deadline)
}

#[cfg(windows)]
pub(super) fn read_host_line(
    stdout: &mut ChildStdout,
    deadline: Instant,
) -> Result<Vec<u8>, String> {
    use std::{
        io::{self, Read},
        os::windows::io::AsRawHandle,
    };

    // Anonymous Windows pipes have no nonblocking flag; check availability before every read.
    struct PolledPipe<'a>(&'a mut ChildStdout);
    impl Read for PolledPipe<'_> {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            #[link(name = "kernel32")]
            extern "system" {
                fn PeekNamedPipe(
                    handle: *mut std::ffi::c_void,
                    buffer: *mut std::ffi::c_void,
                    buffer_size: u32,
                    bytes_read: *mut u32,
                    bytes_available: *mut u32,
                    bytes_left: *mut u32,
                ) -> i32;
            }
            let mut available = 0;
            let ok = unsafe {
                PeekNamedPipe(
                    self.0.as_raw_handle() as *mut _,
                    std::ptr::null_mut(),
                    0,
                    std::ptr::null_mut(),
                    &mut available,
                    std::ptr::null_mut(),
                )
            };
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            if available == 0 {
                return Err(io::Error::from(io::ErrorKind::WouldBlock));
            }
            let count = buf.len().min(available as usize);
            self.0.read(&mut buf[..count])
        }
    }
    super::protocol::read_host_line(&mut PolledPipe(stdout), deadline)
}

#[cfg(target_os = "linux")]
pub(super) fn ensure_preview_available() -> Result<(), String> {
    match crate::isolation::preview::preview_synthetic_linux()?.as_str() {
        "Synthetic safe text\n" => crate::isolation::preview::preview_synthetic_pdf_linux(),
        _ => Err("isolated preview unavailable".into()),
    }
}

#[cfg(target_os = "macos")]
pub(super) fn ensure_preview_available() -> Result<(), String> {
    crate::isolation::preview::macos::ensure_preview_available()
}

#[cfg(windows)]
pub(super) fn ensure_preview_available() -> Result<(), String> {
    crate::isolation::preview::windows::ensure_preview_available()
}

#[cfg(target_os = "linux")]
pub(super) fn preview_text(bytes: &[u8], mime: &str) -> Result<String, String> {
    crate::isolation::preview::preview_text_linux(bytes, mime)
}

#[cfg(target_os = "linux")]
pub(super) fn preview_webp(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    crate::isolation::preview::preview_webp_linux(bytes)
}

#[cfg(target_os = "linux")]
pub(super) fn preview_pdf(
    bytes: &[u8],
    page: u32,
    fit_px: u32,
) -> Result<(u32, u32, u32, Vec<u8>), String> {
    crate::isolation::preview::preview_pdf_linux(bytes, page, fit_px)
}

#[cfg(target_os = "macos")]
pub(super) fn preview_text(bytes: &[u8], mime: &str) -> Result<String, String> {
    crate::isolation::preview::macos::preview_text(bytes, mime)
}

#[cfg(windows)]
pub(super) fn preview_text(bytes: &[u8], mime: &str) -> Result<String, String> {
    crate::isolation::preview::windows::preview_text(bytes, mime)
}

#[cfg(unix)]
pub(super) fn cancel_child(pid: i32) {
    if pid > 0 {
        let _ = unsafe { libc::kill(pid, libc::SIGTERM) };
    }
}

#[cfg(windows)]
pub(super) fn cancel_child(pid: i32) {
    if pid <= 0 {
        return;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut std::ffi::c_void;
        fn TerminateProcess(handle: *mut std::ffi::c_void, exit_code: u32) -> i32;
        fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
    }
    const PROCESS_TERMINATE: u32 = 0x0001;
    let handle = unsafe { OpenProcess(PROCESS_TERMINATE, 0, pid as u32) };
    if !handle.is_null() {
        unsafe {
            TerminateProcess(handle, 1);
            CloseHandle(handle);
        }
    }
}
