use super::{preview, preview_webp, MAX_INPUT_BYTES, MAX_WEBP_INPUT_BYTES};

#[test]
fn allows_bounded_plain_text() {
    assert_eq!(
        preview(&mut "Safe text\n".as_bytes()),
        Ok("Safe text\n".into())
    );
}

#[test]
fn rejects_unknown_active_binary_and_oversized_inputs() {
    for mut fixture in [
        b"#!/bin/sh\necho hi".as_slice(),
        b"<script>alert(1)</script>",
        b"{\"html\":\"active\"}",
        b"MZfake executable",
        b"\x7fELFfake executable",
        b"\x1b[31mterminal escape",
        b"\x00binary",
        b"\xffinvalid utf8",
        b"",
    ] {
        assert!(
            preview(&mut fixture).is_err(),
            "accepted fixture: {fixture:?}"
        );
    }
    assert_eq!(
        preview(&mut vec![b'a'; MAX_INPUT_BYTES + 1].as_slice()),
        Err("input too large")
    );
}

#[test]
fn decodes_bounded_webp_to_rgba_and_rejects_bad_input() {
    let mut synthetic = Vec::new();
    image_webp::WebPEncoder::new(&mut synthetic)
        .encode(&[1, 2, 3, 255], 1, 1, image_webp::ColorType::Rgba8)
        .unwrap();
    let output = preview_webp(&mut synthetic.as_slice()).unwrap();
    assert_eq!(&output[..8], &[1, 0, 0, 0, 1, 0, 0, 0]);
    assert_eq!(&output[8..], &[1, 2, 3, 255]);
    assert!(preview_webp(&mut b"bad image".as_slice()).is_err());
    assert!(preview_webp(&mut vec![0; MAX_WEBP_INPUT_BYTES + 1].as_slice()).is_err());
}
