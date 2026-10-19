use std::io::{self, Write};

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--webp") {
        match inheriti_workspace::preview_webp(&mut io::stdin().lock()) {
            Ok(pixels) => {
                let _ = io::stdout().write_all(&pixels);
                return;
            }
            Err(message) => {
                eprintln!("rejected: {message}");
                std::process::exit(2);
            }
        }
    }
    match inheriti_workspace::preview(&mut io::stdin().lock()) {
        Ok(text) => {
            let _ = io::stdout().write_all(text.as_bytes());
        }
        Err(message) => {
            eprintln!("rejected: {message}");
            std::process::exit(2);
        }
    }
}
