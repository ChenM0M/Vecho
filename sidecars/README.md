# Sidecars (Real Binaries)

Put the **real** ffmpeg/ffprobe/yt-dlp binaries here, grouped by Rust target triple.

Example layouts:

Windows (x64):

```
sidecars/x86_64-pc-windows-msvc/
  ffmpeg.exe
  ffprobe.exe
  yt-dlp.exe
```

macOS (Intel):

```
sidecars/x86_64-apple-darwin/
  ffmpeg
  ffprobe
  yt-dlp
```

macOS (Apple Silicon):

```
sidecars/aarch64-apple-darwin/
  ffmpeg
  ffprobe
  yt-dlp
```

Linux (x64):

```
sidecars/x86_64-unknown-linux-gnu/
  ffmpeg
  ffprobe
  yt-dlp
```

Then run:

`npm run sidecars:sync`

It will copy files into `src-tauri/bin/` using Tauri's `bundle.externalBin` naming.
