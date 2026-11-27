fn main() {
    // oboe-sys が C++ 標準ライブラリをリンクしないため、Android では c++_static / c++abi を明示リンクする。
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-lib=c++_static");
        println!("cargo:rustc-link-lib=c++abi");
    }
    tauri_build::build()
}
