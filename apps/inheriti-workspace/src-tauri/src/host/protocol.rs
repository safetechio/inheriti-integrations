use super::MAX_RESPONSE;
use serde::{Deserialize, Serialize};
use std::{
    io::Read,
    time::{Duration, Instant},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct HostRequest<'a> {
    pub(super) id: &'a str,
    pub(super) op: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) organization_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) copy_id: Option<&'a str>,
}

#[derive(Deserialize)]
pub(super) struct HostResponse<T> {
    pub(super) id: String,
    pub(super) ok: bool,
    pub(super) result: Option<T>,
    pub(super) code: Option<String>,
}

pub(super) fn valid_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
        && (b'1'..=b'8').contains(&value.as_bytes()[14])
        && b"89abAB".contains(&value.as_bytes()[19])
}

pub(super) fn read_host_line(stdout: &mut impl Read, deadline: Instant) -> Result<Vec<u8>, String> {
    let mut line = Vec::new();
    let mut buffer = [0_u8; 1];

    loop {
        match stdout.read(&mut buffer) {
            Ok(0) => return Err("host unavailable".into()),
            Ok(count) => {
                if buffer[0] == b'\n' {
                    return Ok(line);
                }
                if line.len() + count > MAX_RESPONSE {
                    return Err("host response too large".into());
                }
                line.extend_from_slice(&buffer[..count]);
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err("host timed out".into());
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(_) => return Err("host unavailable".into()),
        }
        if Instant::now() >= deadline {
            return Err("host timed out".into());
        }
    }
}
