fn main() {
    // No webview command surface: only Rust can dispatch to this native plugin.
    tauri_plugin::Builder::new(&[])
        .android_path("android")
        .build();
}
