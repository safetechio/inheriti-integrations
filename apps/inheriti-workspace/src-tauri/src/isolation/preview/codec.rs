//! Bounded decoding for the narrow legacy preview helper.
//!
//! These limits are preview policy, not member authorization or arbitrary
//! file isolation. The disposable guest is implemented separately.

use std::io::Read;

pub const MAX_INPUT_BYTES: usize = 64 * 1024;
pub const MAX_WEBP_INPUT_BYTES: usize = 1024 * 1024;
pub const MAX_WEBP_PIXELS: usize = 4_194_304;
pub const MAX_WEBP_OUTPUT_BYTES: usize = MAX_WEBP_PIXELS * 4 + 8;

pub fn preview_webp<R: Read>(reader: &mut R) -> Result<Vec<u8>, &'static str> {
    let mut bytes = Vec::new();
    reader
        .take((MAX_WEBP_INPUT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "input read failed")?;
    if bytes.is_empty() || bytes.len() > MAX_WEBP_INPUT_BYTES {
        return Err("unsupported preview input");
    }
    let mut decoder =
        image_webp::WebPDecoder::new(std::io::Cursor::new(bytes)).map_err(|_| "invalid WebP")?;
    let (width, height) = decoder.dimensions();
    let pixels = (width as usize)
        .checked_mul(height as usize)
        .ok_or("image too large")?;
    if width == 0 || height == 0 || pixels > MAX_WEBP_PIXELS || decoder.is_animated() {
        return Err("unsupported WebP");
    }
    let mut decoded = vec![0; decoder.output_buffer_size().ok_or("image too large")?];
    decoder
        .read_image(&mut decoded)
        .map_err(|_| "invalid WebP")?;
    let mut output = Vec::with_capacity(pixels * 4 + 8);
    output.extend_from_slice(&width.to_le_bytes());
    output.extend_from_slice(&height.to_le_bytes());
    if decoder.has_alpha() {
        output.extend_from_slice(&decoded);
    } else {
        for rgb in decoded.chunks_exact(3) {
            output.extend_from_slice(rgb);
            output.push(255);
        }
    }
    Ok(output)
}

/// This is a feasibility-only allowlist, not a malware detector or a .inheriti parser.
pub fn preview<R: Read>(reader: &mut R) -> Result<String, &'static str> {
    let mut bytes = Vec::new();
    reader
        .take((MAX_INPUT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "input read failed")?;
    if bytes.len() > MAX_INPUT_BYTES {
        return Err("input too large");
    }
    let content = std::str::from_utf8(&bytes).map_err(|_| "binary or invalid UTF-8")?;
    if content.is_empty()
        || content
            .chars()
            .any(|ch| ch.is_control() && ch != '\n' && ch != '\r' && ch != '\t')
        || content.contains('\u{1b}')
        || content.starts_with("#!")
        || content.starts_with("MZ")
        || content.starts_with("\u{7f}ELF")
        || matches!(content.trim_start().chars().next(), Some('<' | '{' | '['))
    {
        return Err("unsupported or active content");
    }
    Ok(content.to_owned())
}

#[cfg(test)]
#[path = "../../../../tests/preview-unit/lib_tests.rs"]
mod tests;
