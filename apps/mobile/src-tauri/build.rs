fn main() {
    #[cfg(feature = "shell")]
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "mobile_pair",
            "mobile_sessions",
            "mobile_timeline",
            "mobile_disconnect",
        ]),
    ))
    .expect("failed to build mobile shell");
}
