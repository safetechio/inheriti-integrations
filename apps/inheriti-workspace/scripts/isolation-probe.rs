use std::{env, fs, net::TcpStream, process};

fn main() {
    let mut args = env::args().skip(1);
    let (Some(canary), Some(port), Some(host_ipc), None) =
        (args.next(), args.next(), args.next(), args.next())
    else {
        eprintln!("expected canary path, local listener port and host IPC namespace");
        process::exit(2);
    };
    let Ok(port) = port.parse::<u16>() else {
        process::exit(2);
    };
    let file_blocked = fs::read(&canary).is_err();
    let network_blocked = TcpStream::connect(("127.0.0.1", port)).is_err();
    let ipc_isolated = fs::read_link("/proc/self/ns/ipc")
        .map(|namespace| namespace.to_string_lossy() != host_ipc)
        .unwrap_or(false);
    println!("canary_blocked={file_blocked} network_blocked={network_blocked} ipc_isolated={ipc_isolated}");
    if !(file_blocked && network_blocked && ipc_isolated) {
        process::exit(1);
    }
}
