use super::*;
#[test]
fn rejects_invalid_input_and_raster_bounds() {
    assert!(preview_pdf_linux(b"bad", 1, 512).is_err());
    assert!(preview_pdf_linux(&vec![b'x'; MAX_PDF_BYTES + 1], 1, 512).is_err());
    assert!(preview_pdf_linux(b"%PDF-1.4", 1, 0).is_err());
    assert!(parse_ppm(b"P6\n2 1\n255\nabc").is_err());
    assert_eq!(
        parse_ppm(b"P6\n1 1\n255\nabc"),
        Ok((1, 1, vec![b'a', b'b', b'c', 255]))
    );
}
#[test]
fn synthetic_pdf_runs_inside_sandbox() {
    preview_synthetic_pdf_linux().unwrap();
}
#[test]
fn multipage_pdf_renders_and_rejects_out_of_range_pages() {
    let fixture = synthetic_pdf();
    let (pages, width, height, rgba) = preview_pdf_linux(&fixture, 2, 512).unwrap();
    assert_eq!(pages, 2);
    assert!(width > 0 && height > 0 && width <= 512 && height <= 512);
    assert_eq!(rgba.len(), width as usize * height as usize * 4);
    assert!(preview_pdf_linux(&fixture, 3, 512).is_err());
}
