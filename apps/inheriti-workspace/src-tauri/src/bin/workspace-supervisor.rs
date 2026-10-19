#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("workspace supervisor requires macOS");
    std::process::exit(1);
}

#[cfg(target_os = "macos")]
mod macos {
    //! The supervisor owns the guest and observes parent pipe EOF. A gated
    //! bootstrap prevents QEMU from starting before its process ID is reported.
    use std::{
        env,
        ffi::OsString,
        io::{self, Read, Write},
        os::unix::process::CommandExt,
        process::{Child, Command, Stdio},
        sync::mpsc,
        thread,
        time::Duration,
    };

    pub(super) fn main() {
        if let Err(error) = run() {
            eprintln!("workspace supervisor: {error}");
            std::process::exit(1);
        }
    }
    fn run() -> io::Result<()> {
        let mut args = env::args_os();
        let _ = args.next();
        match args.next().as_deref() {
            Some(mode) if mode == "--" => supervise_guest(args.collect()),
            Some(mode) if mode == "--guest" => bootstrap_guest(args.collect()),
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid supervisor mode",
            )),
        }
    }
    fn executable(args: &[OsString]) -> io::Result<&OsString> {
        let path = args
            .first()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing QEMU path"))?;
        if !std::path::Path::new(path).is_absolute() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "QEMU path must be absolute",
            ));
        }
        Ok(path)
    }
    fn bootstrap_guest(args: Vec<OsString>) -> io::Result<()> {
        let path = executable(&args)?;
        if unsafe { libc::setsid() } < 0 {
            return Err(io::Error::last_os_error());
        }
        let limit = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        if unsafe { libc::setrlimit(libc::RLIMIT_CORE, &limit) } != 0 {
            return Err(io::Error::last_os_error());
        }
        let mut gate = [0u8; 1];
        io::stdin().read_exact(&mut gate)?;
        if gate[0] != 1 {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "guest gate rejected",
            ));
        }
        let error = Command::new(path)
            .args(&args[1..])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .exec();
        Err(error)
    }
    fn supervise_guest(args: Vec<OsString>) -> io::Result<()> {
        executable(&args)?;
        let mut child = Command::new(env::current_exe()?)
            .arg("--guest")
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        // If reporting fails, dropping the gate makes the bootstrap exit.
        writeln!(io::stdout(), "{}", child.id())?;
        io::stdout().flush()?;
        // Parent registers a process-exit watch before acknowledging. If it
        // disappears now, the bootstrap's gate pipe closes before QEMU exec.
        let mut ack = [0u8; 1];
        io::stdin().read_exact(&mut ack)?;
        if ack[0] != 1 {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "parent handshake rejected",
            ));
        }
        child
            .stdin
            .take()
            .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "guest gate missing"))?
            .write_all(&[1])?;
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let mut byte = [0u8; 1];
            let result = io::stdin().read(&mut byte);
            let _ = tx.send(result);
        });
        loop {
            if child.try_wait()?.is_some() {
                return Ok(());
            }
            match rx.recv_timeout(Duration::from_millis(20)) {
                Ok(_) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                    terminate_group(&mut child)?;
                    return Ok(());
                }
                Err(mpsc::RecvTimeoutError::Timeout) => (),
            }
        }
    }
    fn terminate_group(child: &mut Child) -> io::Result<()> {
        if child.try_wait()?.is_some() {
            return Ok(());
        }
        let pid = i32::try_from(child.id())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid guest pid"))?;
        // Bootstrap calls setsid before the gate opens; kill the whole group.
        if unsafe { libc::kill(-pid, libc::SIGKILL) } != 0 {
            // If it had not reached setsid yet, kill the bootstrap directly.
            if unsafe { libc::kill(pid, libc::SIGKILL) } != 0 && child.try_wait()?.is_none() {
                return Err(io::Error::last_os_error());
            }
        }
        child.wait()?;
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn main() {
    macos::main();
}
