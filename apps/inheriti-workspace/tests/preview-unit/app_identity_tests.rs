#[test]
fn app_identity_matches_deployment() {
    let context: tauri::Context<tauri::Wry> = tauri::generate_context!();
    assert_eq!(
        context.config().identifier,
        format!(
            "com.safetech.inheriti.workspace.{}",
            env!("INHERITI_WORKSPACE_DEPLOYMENT")
        )
    );
}
