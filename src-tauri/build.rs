fn main() {
    // Set by tauri-build in the desktop build; declared for the server-only one.
    println!("cargo::rustc-check-cfg=cfg(mobile)");
    #[cfg(feature = "desktop")]
    tauri_build::build()
}
