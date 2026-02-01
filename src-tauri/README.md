# Tauri backend (MVP scaffold)

## Portable mode

Create a `portable.flag` next to the executable (or set `VECHO_PORTABLE=1`).

Data will be stored in `./data/` (relative to the executable or AppImage file).

Otherwise, the default platform app data directory is used.

## Commands

- `get_data_root` -> returns resolved data root path.
- `load_state` -> loads persisted app state JSON (or null).
- `save_state({ state })` -> persists app state JSON.
- `import_url({ url, mediaId? })` -> downloads the media (yt-dlp sidecar), emits `job_progress`.
- `upload_begin({ mediaId?, name, size, mime? })` -> starts a local file upload.
- `upload_chunk({ uploadId, offset, bytes })` -> streams file bytes to the backend.
- `upload_finish({ uploadId })` -> finalizes upload, tries ffprobe/ffmpeg metadata + thumbnail.

## Events

- `job_progress`: see `src/types.rs`.
