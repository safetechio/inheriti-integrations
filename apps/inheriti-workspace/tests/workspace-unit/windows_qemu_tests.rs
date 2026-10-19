use super::*;

#[test]
fn command_line_quotes_windows_paths_and_quotes() {
    let args = vec![r"C:\Program Files\qemu\".into(), r#"a"b"#.into()];
    let encoded = encode_command_line(&args);
    let line = String::from_utf16(&encoded[..encoded.len() - 1]).unwrap();
    assert_eq!(line, r#"qemu "C:\Program Files\qemu\\" "a\"b""#);
}

#[test]
fn zeroize_clears_entire_owned_buffer() {
    let mut bytes = vec![0x5a; IO_CHUNK + 1];
    zeroize(&mut bytes);
    assert!(bytes.iter().all(|byte| *byte == 0));
}
