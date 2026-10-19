use super::{
    bridge::{pairing_code, HostState},
    commands::{decode_preview, FileAccess, OpenedFile},
    protocol::{read_host_line, valid_uuid},
    startup_file::StartupFile,
};
use std::time::{Duration, Instant};
use std::{fs, sync::atomic::Ordering};

#[cfg(target_os = "linux")]
#[test]
fn pdf_session_expiry_is_bounded_by_file_expiration() {
    use super::commands::pdf_expiration;
    use time::{format_description::well_known::Rfc3339, OffsetDateTime};
    let (ttl, shown) = pdf_expiration(None).unwrap();
    assert!(ttl <= Duration::from_secs(300));
    assert!(
        OffsetDateTime::parse(&shown, &Rfc3339).unwrap()
            <= OffsetDateTime::now_utc() + time::Duration::minutes(5)
    );
    let (ttl, shown) = pdf_expiration(Some("2099-01-01T00:00:00Z")).unwrap();
    assert!(ttl <= Duration::from_secs(300));
    assert!(
        OffsetDateTime::parse(&shown, &Rfc3339).unwrap()
            <= OffsetDateTime::now_utc() + time::Duration::minutes(5)
    );
    let soon = (OffsetDateTime::now_utc() + time::Duration::seconds(30))
        .format(&Rfc3339)
        .unwrap();
    let (ttl, shown) = pdf_expiration(Some(&soon)).unwrap();
    assert!(ttl <= Duration::from_secs(30));
    assert_eq!(shown, soon);
    assert!(pdf_expiration(Some("2000-01-01T00:00:00Z")).is_err());
    assert!(pdf_expiration(Some("invalid")).is_err());
}

#[test]
fn pairing_progress_rejects_untrusted_fields_and_operations() {
    let valid = serde_json::json!({"id":"viewer","event":"pairingCode","code":"abcdef123456"});
    assert_eq!(
        pairing_code(&valid, "openStartupFileFromReveal").unwrap(),
        Some("abcdef123456")
    );
    assert!(pairing_code(&valid, "openStartupFile").is_err());
    assert!(pairing_code(&serde_json::json!({"id":"viewer","event":"pairingCode","code":"abcdef123456","publicKey":"secret"}), "openStartupFileFromReveal").is_err());
    assert!(pairing_code(
        &serde_json::json!({"id":"viewer","event":"pairingCode","code":"../../secret"}),
        "openStartupFileFromReveal"
    )
    .is_err());
}

#[test]
fn preview_bridge_rejects_unexpected_payloads() {
    let mut opened = OpenedFile {
        mime_type: "text/plain".into(),
        content_base64: "aGk=".into(),
        expires_at: None,
    };
    assert_eq!(decode_preview(&opened).unwrap(), b"hi");
    opened.mime_type = "image/webp".into();
    opened.content_base64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        vec![1_u8; 68_892],
    );
    assert_eq!(decode_preview(&opened).unwrap().len(), 68_892);
    opened.mime_type = "application/pdf".into();
    assert_eq!(decode_preview(&opened).unwrap().len(), 68_892);
    opened.content_base64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        vec![0_u8; 1024 * 1024 + 1],
    );
    assert!(decode_preview(&opened).is_err());
    opened.mime_type = "image/webp".into();
    opened.content_base64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        vec![1_u8; inheriti_workspace::MAX_WEBP_INPUT_BYTES + 1],
    );
    assert!(decode_preview(&opened).is_err());
    opened.content_base64 = "aGk=".into();
    opened.mime_type = "text/html".into();
    assert!(decode_preview(&opened).is_err());
    opened.mime_type = "text/plain".into();
    opened.content_base64 = "!!!".into();
    assert!(decode_preview(&opened).is_err());
}
#[test]
fn accepts_only_uuid_shaped_ids() {
    assert!(valid_uuid("ea8ef094-09c5-4f49-962b-4c5a340f51af"));
    assert!(!valid_uuid("../secrets"));
    assert!(!valid_uuid("ea8ef094-09c5-4f49-962b-4c5a340f51af\n"));
}
#[test]
fn rejects_multiple_or_untrusted_startup_paths() {
    assert!(
        StartupFile::from_args(["a.inheriti", "b.inheriti"].into_iter().map(Into::into)).is_err()
    );
    assert!(StartupFile::from_args(["a.txt"].into_iter().map(Into::into)).is_err());
    assert!(StartupFile::from_args(["/missing.inheriti"].into_iter().map(Into::into)).is_err());
}

#[test]
fn secondary_launch_accepts_one_local_file() {
    let cwd = std::env::temp_dir();
    let path = cwd.join(format!("viewer-forwarded-{}.inheriti", std::process::id()));
    fs::write(&path, b"protected").unwrap();
    let args = vec![
        "viewer".to_owned(),
        path.file_name().unwrap().to_string_lossy().into_owned(),
    ];
    let forwarded = StartupFile::from_secondary_args(&args, cwd.to_str().unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(forwarded.as_path(), path);
    assert!(StartupFile::from_secondary_args(
        &["viewer".into(), "bad.txt".into()],
        cwd.to_str().unwrap()
    )
    .is_err());
    assert!(StartupFile::from_secondary_args(
        &["viewer".into(), "a".into(), "b".into()],
        cwd.to_str().unwrap()
    )
    .is_err());
    assert!(
        StartupFile::from_secondary_args(&["viewer".into()], cwd.to_str().unwrap())
            .unwrap()
            .is_none()
    );
    fs::remove_file(path).unwrap();
}

#[test]
fn opened_file_replaces_only_valid_idle_file() {
    let path = std::env::temp_dir().join(format!(
        "viewer-opened-{}-{}.inheriti",
        std::process::id(),
        std::thread::current().name().unwrap_or("test")
    ));
    fs::write(&path, b"protected").unwrap();
    let state = HostState::new();
    assert_eq!(state.opened_file(path.clone()), Ok(true));
    assert_eq!(state.opened_file(path.clone()), Ok(false));
    state.opening_active.store(true, Ordering::Release);
    assert_eq!(
        state.opened_file(path.clone()),
        Err("opening_in_progress".into())
    );
    state.opening_active.store(false, Ordering::Release);
    let invalid = path.with_extension("txt");
    assert_eq!(
        state.opened_file(invalid),
        Err("invalid_startup_file".into())
    );
    assert_eq!(
        state
            .startup_file
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .as_ref()
            .unwrap()
            .as_path(),
        path.as_path()
    );
    fs::remove_file(path).unwrap();
}
#[test]
fn binding_rejects_unexpected_fields() {
    let value = r#"{"copyId":"ea8ef094-09c5-4f49-962b-4c5a340f51af","status":"ACTIVE","deployment":"dev","origin":"INBOX","recipient":"user","expiresAt":null,"allowedUses":1,"token":"secret"}"#;
    assert!(serde_json::from_str::<FileAccess>(value).is_err());
}
#[test]
fn buffered_organization_response_does_not_wait_per_byte() {
    let mut response = vec![b'a'; 3072];
    response.push(b'\n');
    let start = Instant::now();
    let line = read_host_line(
        &mut std::io::Cursor::new(response),
        start + Duration::from_secs(1),
    )
    .unwrap();
    assert_eq!(line.len(), 3072);
    assert!(start.elapsed() < Duration::from_secs(1));
}
