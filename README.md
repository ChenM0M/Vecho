# Vecho Studio

Vecho Studio is a Tauri + Angular desktop app for organizing media, generating transcripts, and producing AI-assisted summaries/notes.

## Development

Prerequisites:

- Node.js 22+
- Rust (stable)
- Platform dependencies for Tauri (see Tauri prerequisites for your OS)

Install dependencies:

```bash
npm ci
```

Run (desktop):

```bash
npm run tauri:dev
```

Run (web-only):

```bash
npm run dev
```

Build (desktop bundles):

```bash
npm run tauri:build
```

## Sidecars

The app can download real `ffmpeg`/`ffprobe`/`yt-dlp` on first run. If you want to bundle the real binaries instead, put them under `sidecars/<target-triple>/` and run:

```bash
npm run sidecars:sync
```

## CI / Releases

- Pushes and PRs run a GitHub Actions build check.
- Pushing a version tag (e.g. `v0.1.0`) builds installers for Windows/macOS/Linux and publishes a GitHub Release.
- Release notes are auto-generated from commits.

Tag & release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Portable mode

Create a `portable.flag` next to the executable (or set `VECHO_PORTABLE=1`) to store data in `./data/`.
