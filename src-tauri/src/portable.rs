use std::path::{Path, PathBuf};

use tauri::Manager;

/// Portable mode rules (cross-platform, minimal surprises):
/// - If `VECHO_PORTABLE=1`, portable mode is enabled.
/// - Else, if a `portable.flag` exists next to the executable (or next to AppImage path), portable mode is enabled.
///
/// Data root:
/// - Portable: `<base>/data` where base is exe dir (or AppImage file dir)
/// - Default: platform app_data_dir
pub fn resolve_data_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if is_portable_mode() {
        let base = portable_base_dir()
            .ok_or_else(|| "Unable to determine portable base directory".to_string())?;
        let dir = base.join("data");
        std::fs::create_dir_all(&dir).map_err(|e| format!("create data dir failed: {e}"))?;
        return Ok(dir);
    }

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir failed: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create app data dir failed: {e}"))?;
    Ok(dir)
}

fn is_portable_mode() -> bool {
    if std::env::var("VECHO_PORTABLE").ok().as_deref() == Some("1") {
        return true;
    }

    // AppImage: use the original AppImage path directory if available.
    if let Some(appimage) = std::env::var_os("APPIMAGE") {
        let p = PathBuf::from(appimage);
        if has_portable_flag(p.parent()) {
            return true;
        }
    }

    let exe = std::env::current_exe().ok();
    let exe_dir = exe.as_ref().and_then(|p| p.parent());
    if has_portable_flag(exe_dir) {
        return true;
    }

    // macOS: allow placing portable.flag next to the .app bundle
    // (so we don't need to modify the signed app bundle).
    #[cfg(target_os = "macos")]
    {
        if let Some(base) = macos_bundle_parent_dir(exe.as_deref()) {
            if has_portable_flag(Some(base.as_path())) {
                return true;
            }
        }
    }

    false
}

fn portable_base_dir() -> Option<PathBuf> {
    if let Some(appimage) = std::env::var_os("APPIMAGE") {
        let p = PathBuf::from(appimage);
        return p.parent().map(|d| d.to_path_buf());
    }

    let exe = std::env::current_exe().ok()?;

    #[cfg(target_os = "macos")]
    {
        if let Some(dir) = macos_bundle_parent_dir(Some(&exe)) {
            return Some(dir);
        }
    }

    exe.parent().map(|d| d.to_path_buf())
}

#[cfg(target_os = "macos")]
fn macos_bundle_parent_dir(exe: Option<&std::path::Path>) -> Option<PathBuf> {
    let exe = exe?;
    let exe_dir = exe.parent()?;
    if exe_dir.file_name().and_then(|s| s.to_str()) != Some("MacOS") {
        return None;
    }
    let contents_dir = exe_dir.parent()?;
    if contents_dir.file_name().and_then(|s| s.to_str()) != Some("Contents") {
        return None;
    }
    let app_dir = contents_dir.parent()?;
    // Normally ends with .app but don't hard-require.
    app_dir.parent().map(|p| p.to_path_buf())
}

fn has_portable_flag(dir: Option<&Path>) -> bool {
    let Some(dir) = dir else {
        return false;
    };
    dir.join("portable.flag").is_file()
}
