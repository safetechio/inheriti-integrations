fn main() {
    println!("cargo:rerun-if-env-changed=INHERITI_BUILD_DEPLOYMENT");
    let deployment = std::env::var("INHERITI_BUILD_DEPLOYMENT").unwrap_or_else(|_| "local".into());
    assert!(
        matches!(deployment.as_str(), "local" | "dev" | "stg" | "prod"),
        "INHERITI_BUILD_DEPLOYMENT must be local, dev, stg, or prod"
    );
    println!("cargo:rustc-env=INHERITI_WORKSPACE_DEPLOYMENT={deployment}");
    if std::env::var_os("TAURI_CONFIG").is_none() {
        let config = format!("{{\"identifier\":\"com.safetech.inheriti.workspace.{deployment}\"}}");
        std::env::set_var("TAURI_CONFIG", &config);
        println!("cargo:rustc-env=TAURI_CONFIG={config}");
    }
    tauri_build::build()
}
