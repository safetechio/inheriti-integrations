use super::{run_bounded, run_bounded_with_limit, runtime_libraries, sandbox_args};
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    process::Command,
};

pub(crate) const MAX_PDF_BYTES: usize = 1024 * 1024;
pub(crate) const MAX_PDF_PAGES: u32 = 200;
pub(crate) const MAX_FIT_PX: u32 = 1600;
const MAX_PIXELS: usize = 2_560_000;

fn poppler_command(program: &Path) -> Result<Command, String> {
    if !program.is_file() {
        return Err("isolated PDF preview unavailable".into());
    }
    let helper = std::env::current_exe()
        .map_err(|_| "viewer executable unavailable")?
        .with_file_name("preview-helper");
    #[cfg(test)]
    let helper = if !helper.is_file() {
        helper
            .parent()
            .and_then(Path::parent)
            .ok_or("preview helper unavailable")?
            .join("preview-helper")
    } else {
        helper
    };
    let mut libraries: BTreeSet<PathBuf> = runtime_libraries(&helper)?;
    libraries.extend(runtime_libraries(program)?);
    let mut args = sandbox_args(&helper, &libraries)?;
    args.pop();
    let mount_at = args
        .iter()
        .position(|arg| arg == "--proc")
        .ok_or("invalid sandbox")?;
    args.splice(
        mount_at..mount_at,
        ["--dir", "/usr/bin", "--dir", "/usr/share", "--dir", "/etc"].map(str::to_owned),
    );
    for path in [
        Path::new("/usr/share/poppler"),
        Path::new("/usr/share/fonts"),
        Path::new("/etc/fonts"),
    ] {
        if path.is_dir() {
            args.extend([
                "--ro-bind".into(),
                path.display().to_string(),
                path.display().to_string(),
            ]);
        }
    }
    args.extend([
        "--ro-bind".into(),
        program.display().to_string(),
        program.display().to_string(),
    ]);
    args.push(program.display().to_string());
    let mut command = Command::new("bwrap");
    command.args(args);
    Ok(command)
}

fn page_count(bytes: &[u8]) -> Result<u32, String> {
    let mut command = poppler_command(Path::new("/usr/bin/pdfinfo"))?;
    command.arg("-");
    let (status, output) = run_bounded(command, Some(bytes))?;
    if !status.success() {
        return Err("sandbox rejected PDF".into());
    }
    let listing = std::str::from_utf8(&output).map_err(|_| "invalid PDF metadata")?;
    let pages = listing
        .lines()
        .find_map(|line| {
            line.strip_prefix("Pages:")
                .and_then(|value| value.trim().parse::<u32>().ok())
        })
        .ok_or("invalid PDF metadata")?;
    if pages == 0 || pages > MAX_PDF_PAGES {
        return Err("unsupported PDF page count".into());
    }
    Ok(pages)
}

fn raster_page(bytes: &[u8], page: u32, fit_px: u32) -> Result<(u32, u32, Vec<u8>), String> {
    let mut command = poppler_command(Path::new("/usr/bin/pdftoppm"))?;
    command.args([
        "-f",
        &page.to_string(),
        "-l",
        &page.to_string(),
        "-singlefile",
        "-scale-to",
        &fit_px.to_string(),
        "-",
    ]);
    let (status, output) = run_bounded_with_limit(command, Some(bytes), MAX_PIXELS * 3 + 64)?;
    if !status.success() {
        return Err("sandbox rejected PDF".into());
    }
    parse_ppm(&output)
}

fn parse_ppm(output: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    // pdftoppm emits a fixed P6 header; reject any unexpected layout.
    let mut fields = output.splitn(4, |byte| *byte == b'\n');
    if fields.next() != Some(b"P6".as_slice()) {
        return Err("invalid PDF raster".into());
    }
    let dimensions = fields.next().ok_or("invalid PDF raster")?;
    let dimensions = std::str::from_utf8(dimensions).map_err(|_| "invalid PDF raster")?;
    let mut numbers = dimensions.split(' ');
    let width = numbers
        .next()
        .and_then(|v| v.parse::<u32>().ok())
        .ok_or("invalid PDF raster")?;
    let height = numbers
        .next()
        .and_then(|v| v.parse::<u32>().ok())
        .ok_or("invalid PDF raster")?;
    if numbers.next().is_some() || fields.next() != Some(b"255".as_slice()) {
        return Err("invalid PDF raster".into());
    }
    let rgb = fields.next().ok_or("invalid PDF raster")?;
    let pixels = (width as usize)
        .checked_mul(height as usize)
        .ok_or("invalid PDF raster")?;
    if width == 0 || height == 0 || pixels > MAX_PIXELS || rgb.len() != pixels * 3 {
        return Err("invalid PDF raster".into());
    }
    let mut rgba = Vec::with_capacity(pixels * 4);
    for pixel in rgb.chunks_exact(3) {
        rgba.extend_from_slice(pixel);
        rgba.push(255);
    }
    Ok((width, height, rgba))
}

pub(crate) fn preview_pdf_linux(
    bytes: &[u8],
    page: u32,
    fit_px: u32,
) -> Result<(u32, u32, u32, Vec<u8>), String> {
    if bytes.len() < 8
        || bytes.len() > MAX_PDF_BYTES
        || !bytes.starts_with(b"%PDF-")
        || !(1..=MAX_FIT_PX).contains(&fit_px)
    {
        return Err("unsupported PDF input".into());
    }
    let pages = page_count(bytes)?;
    if page == 0 || page > pages {
        return Err("invalid PDF page".into());
    }
    let (width, height, rgba) = raster_page(bytes, page, fit_px)?;
    Ok((pages, width, height, rgba))
}

fn synthetic_pdf() -> Vec<u8> {
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents 5 0 R >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 10] /Contents 5 0 R >>",
        "<< /Length 0 >>\nstream\n\nendstream",
    ];
    let mut pdf = b"%PDF-1.4\n".to_vec();
    let mut offsets = vec![0];
    for (index, object) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", index + 1, object).as_bytes());
    }
    let xref = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 6\n0000000000 65535 f \n").as_bytes());
    for offset in offsets.iter().skip(1) {
        pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(
        format!("trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n").as_bytes(),
    );
    pdf
}

pub(crate) fn preview_synthetic_pdf_linux() -> Result<(), String> {
    // Exercise both Poppler tools and the actual sandbox mounts before key release.
    let mut pdf = synthetic_pdf();
    let result = preview_pdf_linux(&pdf, 1, 16);
    pdf.fill(0);
    match result {
        Ok((2, width, height, _)) if width > 0 && height > 0 => Ok(()),
        Err(error) => Err(error),
        _ => Err("isolated PDF preview unavailable".into()),
    }
}

#[cfg(test)]
#[path = "../../../../tests/preview-unit/pdf_tests.rs"]
mod tests;
