use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

fn main() {
    ensure_sidecars();
    tauri_build::build()
}

fn ensure_sidecars() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let target = env::var("TARGET").expect("TARGET");
    let is_windows = target.contains("windows");
    let ext = if is_windows { ".exe" } else { "" };

    let bin_dir = manifest_dir.join("bin");
    let _ = fs::create_dir_all(&bin_dir);

    for name in ["ffmpeg", "ffprobe", "yt-dlp"] {
        let rel = format!("bin/{name}-{target}{ext}");
        let path = manifest_dir.join(Path::new(&rel));
        if path.is_file() {
            continue;
        }

        if is_windows {
            write_stub_exe(&path, &target, name);
        } else {
            write_stub_script(&path, name);
        }
    }
}

fn write_stub_exe(out_path: &Path, target: &str, name: &str) {
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let src = out_dir.join(format!("sidecar-stub-{name}.rs"));

    let _ = fs::create_dir_all(out_path.parent().expect("bin dir"));
    fs::write(
        &src,
        format!(
            r#"fn main() {{
  eprintln!("[vecho] sidecar '{name}' is a stub. Provide the real binary under src-tauri/bin and rebuild.");
  std::process::exit(127);
}}"#
        ),
    )
    .expect("write stub source");

    let rustc = env::var("RUSTC").unwrap_or_else(|_| "rustc".to_string());
    let status = Command::new(rustc)
        .arg(&src)
        .arg("--target")
        .arg(target)
        .arg("-C")
        .arg("opt-level=s")
        .arg("-C")
        .arg("debuginfo=0")
        .arg("-C")
        .arg("strip=symbols")
        .arg("-o")
        .arg(out_path)
        .status()
        .expect("spawn rustc to build stub sidecar");
    if !status.success() {
        panic!("failed to build stub sidecar: {name}");
    }
}

fn write_stub_script(out_path: &Path, name: &str) {
    let _ = fs::create_dir_all(out_path.parent().expect("bin dir"));
    fs::write(
        out_path,
        format!(
            "#!/usr/bin/env sh\n\
echo \"[vecho] sidecar '{name}' is a stub. Provide the real binary under src-tauri/bin and rebuild.\" 1>&2\n\
exit 127\n"
        ),
    )
    .expect("write stub script");

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perm = fs::Permissions::from_mode(0o755);
        let _ = fs::set_permissions(out_path, perm);
    }
}
