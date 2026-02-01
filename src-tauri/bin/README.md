# Sidecar binaries

This directory holds **target-specific** sidecar binaries that are bundled with the app.

Tauri will look for files following the pattern:

`<name>-<target-triple><.exe on windows>`

Examples:

- `ffmpeg-x86_64-pc-windows-msvc.exe`
- `ffmpeg-x86_64-apple-darwin`
- `ffmpeg-aarch64-apple-darwin`
- `ffmpeg-x86_64-unknown-linux-gnu`

The same applies to `ffprobe` and `yt-dlp`.

Notes:

- This repo generates small **stub** sidecars automatically when missing (so dev builds don't hard fail).
- For production builds you should replace the stubs with the real binaries.
