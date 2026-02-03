use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use base64::Engine;
use futures_util::StreamExt;
use tauri::{Emitter, Manager, State};

use vecho_studio::portable;
use vecho_studio::types::{JobProgressEvent, JobStatus, JobType, EVENT_JOB_PROGRESS};

const SIDECAR_ENV_DIR: &str = "VECHO_SIDECAR_DIR";

struct AppState {
  data_root: tokio::sync::OnceCell<std::path::PathBuf>,
  state_io_lock: tokio::sync::Mutex<()>,
  tools_lock: tokio::sync::Mutex<()>,
  uploads: tokio::sync::Mutex<HashMap<String, UploadSession>>,
}

impl Default for AppState {
  fn default() -> Self {
    Self {
      data_root: tokio::sync::OnceCell::new(),
      state_io_lock: tokio::sync::Mutex::new(()),
      tools_lock: tokio::sync::Mutex::new(()),
      uploads: tokio::sync::Mutex::new(HashMap::new()),
    }
  }
}

fn state_file_path(data_root: &std::path::Path) -> std::path::PathBuf {
  data_root.join("db").join("state.json")
}

fn atomic_write_bytes(dest: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
  use std::io::Write;

  let dir = dest
    .parent()
    .ok_or_else(|| "invalid state file path".to_string())?;
  std::fs::create_dir_all(dir).map_err(|e| format!("create state dir failed: {e}"))?;

  let file_name = dest
    .file_name()
    .and_then(|s| s.to_str())
    .ok_or_else(|| "invalid state file name".to_string())?;

  let tmp_name = format!(".{file_name}.tmp-{}", nanoid());
  let tmp_path = dir.join(tmp_name);
  let bak_path = dir.join(format!(".{file_name}.bak"));

  {
    let mut f = std::fs::File::create(&tmp_path)
      .map_err(|e| format!("create temp state file failed: {e}"))?;
    f.write_all(bytes)
      .map_err(|e| format!("write temp state file failed: {e}"))?;
    f.sync_all()
      .map_err(|e| format!("sync temp state file failed: {e}"))?;
  }

  // Best-effort atomic-ish replace across platforms.
  // Windows cannot rename over an existing file, so we swap via a backup.
  let mut has_backup = false;
  if dest.is_file() {
    let _ = std::fs::remove_file(&bak_path);
    std::fs::rename(dest, &bak_path)
      .map_err(|e| format!("backup existing state file failed: {e}"))?;
    has_backup = true;
  }

  match std::fs::rename(&tmp_path, dest) {
    Ok(()) => {
      if has_backup {
        let _ = std::fs::remove_file(&bak_path);
      }
      Ok(())
    }
    Err(e) => {
      // Attempt rollback.
      if has_backup {
        let _ = std::fs::rename(&bak_path, dest);
      }
      let _ = std::fs::remove_file(&tmp_path);
      Err(format!("commit state file failed: {e}"))
    }
  }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveStateArgs {
  state: serde_json::Value,
}

#[tauri::command]
async fn load_state(app: tauri::AppHandle, state: State<'_, Arc<AppState>>) -> Result<Option<serde_json::Value>, String> {
  let dir = state
    .data_root
    .get_or_try_init(|| async { portable::resolve_data_root(&app) })
    .await?;

  let path = state_file_path(dir);
  if !path.is_file() {
    return Ok(None);
  }

  let bytes = tokio::fs::read(&path)
    .await
    .map_err(|e| format!("read state file failed: {e}"))?;

  let parsed = serde_json::from_slice::<serde_json::Value>(&bytes)
    .map_err(|e| format!("parse state file failed: {e}"))?;
  Ok(Some(parsed))
}

#[tauri::command]
async fn save_state(app: tauri::AppHandle, state: State<'_, Arc<AppState>>, args: SaveStateArgs) -> Result<(), String> {
  let _guard = state.state_io_lock.lock().await;

  let dir = state
    .data_root
    .get_or_try_init(|| async { portable::resolve_data_root(&app) })
    .await?;

  let path = state_file_path(dir);
  let bytes = serde_json::to_vec_pretty(&args.state)
    .map_err(|e| format!("serialize state failed: {e}"))?;

  tokio::task::spawn_blocking(move || atomic_write_bytes(&path, &bytes))
    .await
    .map_err(|e| format!("join state write task failed: {e}"))??;

  Ok(())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportUrlArgs {
  url: String,
  media_id: Option<String>,
  #[serde(default)]
  quality: Option<String>,
}

#[derive(Debug, Clone)]
struct UploadSession {
  media_id: String,
  job_id: String,
  file_name: String,
  mime: Option<String>,
  total_size: u64,
  received: u64,
  tmp_path: std::path::PathBuf,
  final_path: std::path::PathBuf,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadBeginArgs {
  media_id: Option<String>,
  name: String,
  size: u64,
  mime: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadChunkArgs {
  upload_id: String,
  offset: u64,
  bytes: Vec<u8>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadFinishArgs {
  upload_id: String,
}

#[tauri::command]
async fn get_data_root(app: tauri::AppHandle, state: State<'_, Arc<AppState>>) -> Result<String, String> {
  let dir = state
    .data_root
    .get_or_try_init(|| async { portable::resolve_data_root(&app) })
    .await?;
  Ok(dir.to_string_lossy().to_string())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaDirArgs {
  media_id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct StageExternalFileArgs {
  media_id: String,
  abs_path: String,
}

#[tauri::command]
async fn stage_external_file(
  app: tauri::AppHandle,
  args: StageExternalFileArgs,
  state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
  let dir = state
    .data_root
    .get_or_try_init(|| async { portable::resolve_data_root(&app) })
    .await?;

  let media_id = args.media_id.trim().to_string();
  validate_media_id(&media_id)?;

  let src = std::path::PathBuf::from(args.abs_path.trim());
  if !src.is_file() {
    return Err("source file not found".to_string());
  }

  let media_dir = dir.join("media").join(&media_id);
  tokio::fs::create_dir_all(&media_dir)
    .await
    .map_err(|e| format!("create media dir failed: {e}"))?;

  // Remove previous source.* if any
  if let Ok(p) = find_source_file(&media_dir) {
    let _ = tokio::fs::remove_file(&p).await;
  }

  let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
  let final_name = if ext.trim().is_empty() {
    "source".to_string()
  } else {
    format!("source.{ext}")
  };
  let dst = media_dir.join(&final_name);

  tokio::fs::copy(&src, &dst)
    .await
    .map_err(|e| format!("copy file failed: {e}"))?;

  let stored_rel = dst
    .strip_prefix(&dir)
    .ok()
    .map(|p| p.to_string_lossy().replace('\\', "/"));

  let file_size = std::fs::metadata(&dst).map(|m| m.len()).unwrap_or(0);

  Ok(serde_json::json!({
    "media_id": media_id,
    "stored_path": dst.to_string_lossy().to_string(),
    "stored_rel": stored_rel,
    "file_size": file_size,
  }))
}

#[tauri::command]
async fn delete_media_storage(
  app: tauri::AppHandle,
  args: MediaDirArgs,
  state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
  let dir = state
    .data_root
    .get_or_try_init(|| async { portable::resolve_data_root(&app) })
    .await?;

  let media_id = args.media_id.trim().to_string();
  validate_media_id(&media_id)?;

  let media_dir = dir.join("media").join(&media_id);
  if !media_dir.exists() {
    return Ok(());
  }

  tokio::fs::remove_dir_all(&media_dir)
    .await
    .map_err(|e| format!("delete media dir failed: {e}"))?;
  Ok(())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranslateSubtitlesArgs {
  media_id: String,
  ai: AiSettings,
  target_lang: String,
}

fn subtitles_file_path(media_dir: &Path) -> PathBuf {
  media_dir.join("subtitles.json")
}

fn build_subtitles_from_transcription(media_id: &str, transcription: &serde_json::Value) -> serde_json::Value {
  let lang = transcription
    .get("language")
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .trim()
    .to_string();

  let mut segs: Vec<serde_json::Value> = Vec::new();
  if let Some(arr) = transcription.get("segments").and_then(|v| v.as_array()) {
    for s in arr {
      let id = s.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
      let start = s.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
      let end = s.get("end").and_then(|v| v.as_f64()).unwrap_or(start);
      let text = s.get("text").and_then(|v| v.as_str()).unwrap_or("").trim();
      if text.is_empty() {
        continue;
      }
      segs.push(serde_json::json!({
        "id": if !id.is_empty() { id.to_string() } else { format!("seg-{}", nanoid()) },
        "start": start,
        "end": end.max(start),
        "text": text,
      }));
    }
  }

  serde_json::json!({
    "version": 1,
    "mediaId": media_id,
    "generatedAt": now_iso(),
    "tracks": [
      {
        "id": "original",
        "label": "Original",
        "language": lang,
        "kind": "transcription",
        "segments": segs,
      }
    ]
  })
}

fn get_track_mut<'a>(subs: &'a mut serde_json::Value, track_id: &str) -> Option<&'a mut serde_json::Value> {
  let arr = subs.get_mut("tracks")?.as_array_mut()?;
  for t in arr.iter_mut() {
    if t.get("id").and_then(|v| v.as_str()) == Some(track_id) {
      return Some(t);
    }
  }
  None
}

fn upsert_track(subs: &mut serde_json::Value, track: serde_json::Value) {
  let id = track.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
  if id.trim().is_empty() {
    return;
  }
  if let Some(existing) = get_track_mut(subs, &id) {
    *existing = track;
    return;
  }
  if let Some(arr) = subs.get_mut("tracks").and_then(|v| v.as_array_mut()) {
    arr.push(track);
  } else {
    subs["tracks"] = serde_json::Value::Array(vec![track]);
  }
}

fn parse_translation_pairs(raw: &str) -> Result<Vec<(String, String)>, String> {
  fn try_parse_translation_json_lenient(text: &str) -> Option<serde_json::Value> {
    if let Some(v) = try_parse_json_value(text) {
      return Some(v);
    }

    let t = text.trim();
    if t.is_empty() {
      return None;
    }

    // Salvage a common truncation pattern: a partial JSON object/array that contains
    // multiple complete items but is missing closing brackets.
    let first = t.chars().find(|c| !c.is_whitespace())?;
    let last_obj_end = t.rfind('}')?;
    let prefix = t[..=last_obj_end].trim_end();

    if first == '{' {
      // Most frequent: {"segments":[{...},{...}, ... <truncated>
      // Close as: <lastCompleteObject>\n]}.
      if prefix.contains('[') {
        let cand = format!("{prefix}\n  ]\n}}");
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&cand) {
          return Some(v);
        }
      }

      // Fallback: maybe the outer object is otherwise complete.
      let cand = format!("{prefix}\n}}");
      if let Ok(v) = serde_json::from_str::<serde_json::Value>(&cand) {
        return Some(v);
      }
    }

    if first == '[' {
      let cand = format!("{prefix}\n]");
      if let Ok(v) = serde_json::from_str::<serde_json::Value>(&cand) {
        return Some(v);
      }
    }
    None
  }

  fn parse_translation_pairs_jsonl(raw: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let mut t = raw.trim().to_string();
    if t.starts_with("```") {
      let mut lines = t.lines();
      let _ = lines.next();
      let mut body = lines.collect::<Vec<_>>().join("\n");
      if let Some(idx) = body.rfind("```") {
        body.truncate(idx);
      }
      t = body.trim().to_string();
    }

    for line in t.lines() {
      let s = line.trim();
      if s.is_empty() {
        continue;
      }
      let mut try_parse_line = |cand: &str| {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(cand) {
          if let Some(a) = v.as_array() {
            if a.len() >= 2 {
              let id = a.get(0).and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
              let text = a.get(1).and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
              if !id.is_empty() && !text.is_empty() {
                out.push((id, text));
              }
            }
            return;
          }
          let id = v.get("id").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
          let text = v.get("text")
            .or_else(|| v.get("translation"))
            .or_else(|| v.get("translated"))
            .or_else(|| v.get("translatedText"))
            .or_else(|| v.get("translated_text"))
            .or_else(|| v.get("output"))
            .or_else(|| v.get("result"))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
          if !id.is_empty() && !text.is_empty() {
            out.push((id, text));
          }
        }
      };

      // Accept plain JSON per line, or a substring containing {..}.
      if s.starts_with('{') || s.starts_with('[') {
        try_parse_line(s);
      } else if let (Some(a), Some(b)) = (s.find('{'), s.rfind('}')) {
        if b > a {
          try_parse_line(&s[a..=b]);
        }
      }
    }
    out
  }

  let Some(v) = try_parse_translation_json_lenient(raw) else {
    // Fallback: allow JSONL / line-by-line parsing even when the whole text isn't valid JSON.
    let jsonl = parse_translation_pairs_jsonl(raw);
    if !jsonl.is_empty() {
      return Ok(jsonl);
    }
    let preview = raw.trim().chars().take(400).collect::<String>();
    return Err(format!("translate output missing JSON\nraw (first 400 chars):\n{preview}"));
  };

  // Support multiple root structures: array, {segments:[...]}, {translations:[...]}, {results:[...]}, {s:[...]}
  let arr_opt = if v.is_array() {
    v.as_array().cloned()
  } else {
    v.get("segments")
      .or_else(|| v.get("translations"))
      .or_else(|| v.get("results"))
      .or_else(|| v.get("s"))
      .and_then(|x| x.as_array())
      .cloned()
  };
  let Some(arr) = arr_opt else {
    let jsonl = parse_translation_pairs_jsonl(raw);
    if !jsonl.is_empty() {
      return Ok(jsonl);
    }
    return Err("translate output missing segments array".to_string());
  };

  let mut out: Vec<(String, String)> = Vec::new();
  for it in arr {
    // Accept either object items or tuple-like arrays.
    if let Some(a) = it.as_array() {
      if a.len() >= 2 {
        let id = a.get(0).and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
        let text = a.get(1).and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
        if !id.is_empty() && !text.is_empty() {
          out.push((id, text));
        }
      }
      continue;
    }

    let id = it.get("id").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
    // Support multiple text field names.
    let mut text = it.get("text")
      .or_else(|| it.get("translation"))
      .or_else(|| it.get("translated"))
      .or_else(|| it.get("translatedText"))
      .or_else(|| it.get("translated_text"))
      .or_else(|| it.get("output"))
      .or_else(|| it.get("result"))
      .and_then(|x| x.as_str())
      .unwrap_or("")
      .trim()
      .to_string();

    // Fallback: pick the first non-empty string field that isn't the id.
    if text.is_empty() {
      if let Some(obj) = it.as_object() {
        for (k, v) in obj {
          if k == "id" || k == "start" || k == "end" || k == "language" {
            continue;
          }
          if let Some(s) = v.as_str() {
            let s = s.trim();
            if !s.is_empty() {
              text = s.to_string();
              break;
            }
          }
        }
      }
    }
    if id.is_empty() || text.is_empty() {
      continue;
    }
    out.push((id, text));
  }
  if out.is_empty() {
    let jsonl = parse_translation_pairs_jsonl(raw);
    if !jsonl.is_empty() {
      return Ok(jsonl);
    }
    return Err("translate output had no usable segments".to_string());
  }
  Ok(out)
}

async fn translate_subtitle_pairs_with_ai(
  ai: &AiSettings,
  target_lang: &str,
  payload_json: &str,
) -> Result<Vec<(String, String)>, String> {
  let lang = target_lang.trim().to_lowercase();
  let payload = payload_json.trim();
  if lang.trim().is_empty() {
    return Err("target_lang is empty".to_string());
  }
  if payload.is_empty() {
    return Err("translate payload is empty".to_string());
  }

  let want_zh = lang.starts_with("zh");
  let lang_label = if want_zh { "Simplified Chinese" } else { lang.as_str() };
  let expected_len: usize = serde_json::from_str::<serde_json::Value>(payload)
    .ok()
    .and_then(|v| v.as_array().map(|a| a.len()))
    .unwrap_or(0);

  // Multi-step retry with formats that survive truncation.
  // 1) JSONL (NDJSON): one JSON object per line
  // 2) Compact array-of-pairs
  // 3) Object with segments array
  let prompt1 = format!(
    "You are a translation engine. Translate each item to {lang_label}.\n\
Output format: JSONL (one JSON object per line).\n\
Each line MUST be: {{\"id\":\"...\",\"text\":\"...\"}}\n\
Rules:\n\
- Output ONLY JSONL lines. No markdown, no extra text.\n\
- Keep ids unchanged. Do NOT add/remove items.\n\
- Translate naturally.\n\n\
Input JSON array:\n{payload}\n",
    lang_label = lang_label,
    payload = payload
  );
  let prompt2 = format!(
    "Translate to {lang_label}. Output ONLY JSON. No markdown.\n\
Format: [[\"id\",\"text\"], ...] (array of 2-item arrays).\n\
Keep ids unchanged. Do NOT add/remove items.\n\n\
Input:\n{payload}\n",
    lang_label = lang_label,
    payload = payload
  );
  let prompt3 = format!(
    "Translate to {lang_label}. Output ONLY JSON object (no markdown).\n\
Schema: {{\"segments\":[{{\"id\":string,\"text\":string}}]}}\n\
Keep ids unchanged. Do NOT add/remove items.\n\n\
Input:\n{payload}\n",
    lang_label = lang_label,
    payload = payload
  );

  let prompts = [prompt1, prompt2, prompt3];
  let mut last_err: Option<String> = None;
  let max_opts: [u32; 4] = [8192, 4096, 2048, 1024];

  async fn retryable<F, Fut>(mut f: F) -> Result<String, String>
  where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<String, String>>,
  {
    let delays_ms: [u64; 3] = [350, 900, 1700];
    let mut last: Option<String> = None;
    for (i, d) in delays_ms.iter().enumerate() {
      match f().await {
        Ok(v) => return Ok(v),
        Err(e) => {
          let low = e.to_lowercase();
          let is_retry = low.contains("http 429")
            || low.contains("rate limit")
            || low.contains("http 503")
            || low.contains("http 502")
            || low.contains("http 504")
            || low.contains("timeout")
            || low.contains("temporarily")
            || low.contains("try again");
          last = Some(e);
          if !is_retry || i == delays_ms.len() - 1 {
            break;
          }
          tokio::time::sleep(std::time::Duration::from_millis(*d)).await;
        }
      }
    }
    Err(last.unwrap_or_else(|| "request failed".to_string()))
  }

  for p in prompts {
    let raw = match ai.provider {
      AiProvider::OpenaiCompatible => {
        let base = normalize_base_url(&ai.openai.base_url);
        if base.is_empty() {
          return Err("openai baseUrl is empty".to_string());
        }
        let model = ai.openai.chat_model.trim();
        if model.is_empty() {
          return Err("openai model is empty".to_string());
        }
        let messages = vec![
          serde_json::json!({ "role": "system", "content": format!("You are a translation engine. Translate to {lang_label}. Output ONLY JSON.", lang_label = lang_label) }),
          serde_json::json!({ "role": "user", "content": p }),
        ];

        let mut last_req_err: Option<String> = None;
        let mut out: Option<String> = None;

        let looks_like_unknown_param = |e: &str| {
          let s = e.to_lowercase();
          (s.contains("unknown") || s.contains("unrecognized") || s.contains("unexpected"))
            && (s.contains("max_tokens") || s.contains("max_completion_tokens"))
        };

        // Try max_tokens first (widely supported), then max_completion_tokens (newer APIs),
        // then no token limit field at all for strict gateways.
        for mt in max_opts {
          let body = serde_json::json!({
            "model": model,
            "messages": messages,
            "temperature": 0.0,
            "stream": false,
            "max_tokens": mt,
          });
          let r = retryable(|| openai_chat_completion_with_body(&base, &ai.openai.api_key, body.clone())).await;
          match r {
            Ok(s) => {
              out = Some(s);
              break;
            }
            Err(e) => {
              if looks_like_unknown_param(&e) {
                last_req_err = Some(e);
                break;
              }
              last_req_err = Some(e);
              continue;
            }
          }
        }

        if out.is_none() {
          for mt in max_opts {
            let body = serde_json::json!({
              "model": model,
              "messages": messages,
              "temperature": 0.0,
              "stream": false,
              "max_completion_tokens": mt,
            });
          let r = retryable(|| openai_chat_completion_with_body(&base, &ai.openai.api_key, body.clone())).await;
          match r {
            Ok(s) => {
              out = Some(s);
              break;
            }
            Err(e) => {
                if looks_like_unknown_param(&e) {
                  last_req_err = Some(e);
                  break;
                }
                last_req_err = Some(e);
                continue;
              }
            }
          }
        }

        if out.is_none() {
          let body = serde_json::json!({
            "model": model,
            "messages": messages,
            "temperature": 0.0,
            "stream": false,
          });
          let r = retryable(|| openai_chat_completion_with_body(&base, &ai.openai.api_key, body.clone())).await;
          match r {
            Ok(s) => out = Some(s),
            Err(e) => last_req_err = Some(e),
          }
        }

        out.ok_or_else(|| last_req_err.unwrap_or_else(|| "openai translate request failed".to_string()))?
      }
      AiProvider::Gemini => {
        retryable(|| {
          gemini_generate_content_with_config(
            &ai.gemini.base_url,
            &ai.gemini.api_key,
            &ai.gemini.model,
            &p,
            Some(8192),
          )
        })
        .await?
      }
    };

    match parse_translation_pairs(&raw) {
      Ok(pairs) => {
        if pairs.is_empty() {
          last_err = Some("translate output had no usable segments".to_string());
          continue;
        }

        if want_zh && expected_len >= 3 {
          let mut han_chars = 0usize;
          for (_id, t) in &pairs {
            for c in t.chars() {
              if c >= '\u{4E00}' && c <= '\u{9FFF}' {
                han_chars += 1;
              }
              if han_chars >= 2 {
                break;
              }
            }
            if han_chars >= 2 {
              break;
            }
          }
          if han_chars == 0 {
            last_err = Some("translate output does not look like Chinese".to_string());
            continue;
          }
        }
        return Ok(pairs);
      }
      Err(e) => {
        last_err = Some(e);
        continue;
      }
    }
  }

  Err(last_err.unwrap_or_else(|| "translate failed".to_string()))
}

fn should_split_translation_error(err: &str) -> bool {
  let e = err.to_lowercase();
  e.contains("translate output missing json")
    || e.contains("missing segments array")
    || e.contains("had no usable segments")
    || e.contains("translate output too few items")
    || e.contains("does not look like chinese")
    || e.contains("openai response missing content")
    || e.contains("event-stream returned no content")
}

async fn translate_ids_with_auto_split(
  app: &tauri::AppHandle,
  job_id: &str,
  media_id: &str,
  ai: &AiSettings,
  target_lang: &str,
  ids: &[String],
  id_to_meta: &std::collections::HashMap<String, (f64, f64, String)>,
  out_map: &mut std::collections::HashMap<String, String>,
  label: &str,
) -> Option<String> {
  use std::collections::VecDeque;

  let total = ids.len().max(1);
  let mut q: VecDeque<(usize, usize)> = VecDeque::new();
  q.push_back((0, ids.len()));
  let mut last_err: Option<String> = None;
  let mut split_count = 0usize;
  let mut iter_count = 0usize;

  while let Some((start, end)) = q.pop_front() {
    iter_count += 1;
    if iter_count > 2048 {
      break;
    }
    if start >= end || start >= ids.len() {
      continue;
    }
    let end = end.min(ids.len());

    // Build payload for ids not yet translated.
    let mut list: Vec<serde_json::Value> = Vec::new();
    let mut pending_count = 0usize;
    for id in &ids[start..end] {
      if out_map.contains_key(id) {
        continue;
      }
      if let Some((_s, _e, text)) = id_to_meta.get(id) {
        pending_count += 1;
        list.push(serde_json::json!({ "id": id, "text": text }));
      }
    }
    if list.is_empty() {
      continue;
    }

    let done = out_map.len().min(total);
    let prog = ((done as f32) / (total as f32)).clamp(0.0, 0.95);
    let _ = emit_job(app, JobProgressEvent {
      job_id: job_id.to_string(),
      media_id: media_id.to_string(),
      job_type: JobType::Subtitle,
      status: JobStatus::Running,
      progress: (0.10 + 0.80 * prog).clamp(0.0, 0.95),
      message: Some(format!("{label} {done}/{total}")),
    });

    let payload = serde_json::to_string(&list).unwrap_or_else(|_| "[]".to_string());
    match translate_subtitle_pairs_with_ai(ai, target_lang, &payload).await {
      Ok(pairs) => {
        for (id, text) in pairs {
          out_map.insert(id, text);
        }

        // If we didn't translate everything in this range (e.g. truncated output),
        // keep splitting the remaining portion until done.
        let mut remaining = 0usize;
        for id in &ids[start..end] {
          if out_map.contains_key(id) {
            continue;
          }
          if id_to_meta.contains_key(id) {
            remaining += 1;
          }
        }
        if remaining > 0 && pending_count > 1 && split_count < 512 {
          split_count += 1;
          let mid = start + (end - start) / 2;
          if mid > start && mid < end {
            q.push_front((mid, end));
            q.push_front((start, mid));
          }
        }
      }
      Err(e) => {
        last_err = Some(e.clone());

        // If the model output is truncated / malformed, split and retry.
        if pending_count > 1 && should_split_translation_error(&e) && split_count < 512 {
          split_count += 1;
          let mid = start + (end - start) / 2;
          if mid > start && mid < end {
            // Process smaller parts first.
            q.push_front((mid, end));
            q.push_front((start, mid));
            continue;
          }
        }
      }
    }
  }

  last_err
}

async fn load_subtitles_json(media_dir: &Path) -> Option<serde_json::Value> {
  try_load_json(&subtitles_file_path(media_dir)).await
}

#[tauri::command]
async fn load_subtitles(
  app: tauri::AppHandle,
  args: MediaDirArgs,
  state: State<'_, Arc<AppState>>,
) -> Result<Option<serde_json::Value>, String> {
  let dir = state
    .data_root
    .get_or_try_init(|| async { portable::resolve_data_root(&app) })
    .await?;
  let media_id = args.media_id.trim().to_string();
  validate_media_id(&media_id)?;

  let media_dir = dir.join("media").join(&media_id);
  if !media_dir.is_dir() {
    return Err("media not found".to_string());
  }
  Ok(load_subtitles_json(&media_dir).await)
}

#[tauri::command]
async fn ensure_subtitles(
  app: tauri::AppHandle,
  args: MediaDirArgs,
  state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
  let dir = state
    .data_root
    .get_or_try_init(|| async { portable::resolve_data_root(&app) })
    .await?;
  let media_id = args.media_id.trim().to_string();
  validate_media_id(&media_id)?;

  let media_dir = dir.join("media").join(&media_id);
  if !media_dir.is_dir() {
    return Err("media not found".to_string());
  }

  if let Some(existing) = load_subtitles_json(&media_dir).await {
    return Ok(existing);
  }

  let transcription_path = media_dir.join("transcription.json");
  if !transcription_path.is_file() {
    return Err("no transcription found".to_string());
  }
  let transcription: serde_json::Value = serde_json::from_slice(
    &tokio::fs::read(&transcription_path)
      .await
      .map_err(|e| format!("read transcription failed: {e}"))?,
  )
  .map_err(|e| format!("parse transcription failed: {e}"))?;

  let subs = build_subtitles_from_transcription(&media_id, &transcription);
  write_json_atomic(&subtitles_file_path(&media_dir), &subs)?;
  Ok(subs)
}

#[tauri::command]
async fn translate_subtitles(
  app: tauri::AppHandle,
  args: TranslateSubtitlesArgs,
  state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
  let dir = state
    .data_root
    .get_or_try_init(|| async { portable::resolve_data_root(&app) })
    .await?;
  let media_id = args.media_id.trim().to_string();
  validate_media_id(&media_id)?;

  let target_lang = args.target_lang.trim().to_lowercase();
  if target_lang.is_empty() {
    return Err("target_lang is empty".to_string());
  }

  let media_dir = dir.join("media").join(&media_id);
  if !media_dir.is_dir() {
    return Err("media not found".to_string());
  }

  let mut subs = if let Some(v) = load_subtitles_json(&media_dir).await {
    v
  } else {
    ensure_subtitles(app.clone(), MediaDirArgs { media_id: media_id.clone() }, state).await?
  };

  let job_id = format!("job-{}", nanoid());
  let _ = emit_job(&app, JobProgressEvent {
    job_id: job_id.clone(),
    media_id: media_id.clone(),
    job_type: JobType::Subtitle,
    status: JobStatus::Running,
    progress: 0.0,
    message: Some("translating subtitles".to_string()),
  });

  let result: Result<serde_json::Value, String> = async {

  // Get original track data (clone so we can mutate `subs` later).
  let orig_track = subs
    .get("tracks")
    .and_then(|v| v.as_array())
    .and_then(|arr| {
      arr.iter()
        .find(|t| t.get("id").and_then(|v| v.as_str()) == Some("original"))
    })
    .cloned()
    .ok_or_else(|| "missing original subtitle track".to_string())?;

  let orig_lang = orig_track
    .get("language")
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .trim()
    .to_string();

  let orig_segs = orig_track
    .get("segments")
    .and_then(|v| v.as_array())
    .cloned()
    .unwrap_or_default();
  if orig_segs.is_empty() {
    return Err("original subtitle track is empty".to_string());
  }

  // Translate in chunks.
  let mut id_order: Vec<String> = Vec::with_capacity(orig_segs.len());
  let mut id_to_meta: std::collections::HashMap<String, (f64, f64, String)> = std::collections::HashMap::new();
  for s in &orig_segs {
    let id = s.get("id").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let text = s.get("text").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    if id.is_empty() || text.is_empty() {
      continue;
    }
    let start = s.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let end = s.get("end").and_then(|v| v.as_f64()).unwrap_or(start);
    id_order.push(id.clone());
    id_to_meta.insert(id, (start, end.max(start), text));
  }
  if id_order.is_empty() {
    return Err("original track has no usable segments".to_string());
  }

  let mut out_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
  let concurrency = 4usize;
  let strategy = format!("parallel_auto_split:c{}", concurrency);
  let mut last_translate_err: Option<String> = None;

  // Parallel translation with auto-splitting (robust to output truncation).
  {
    use futures_util::stream::{FuturesUnordered, StreamExt};

    let max_items = 140usize;
    let max_chars = 14_000usize;
    let mut chunks: Vec<Vec<String>> = Vec::new();
    let mut cur: Vec<String> = Vec::new();
    let mut cur_chars = 0usize;
    for id in &id_order {
      let Some((_s, _e, text)) = id_to_meta.get(id) else { continue; };
      let add = text.len().saturating_add(32);
      if !cur.is_empty() && (cur.len() >= max_items || cur_chars.saturating_add(add) > max_chars) {
        chunks.push(cur);
        cur = Vec::new();
        cur_chars = 0;
      }
      cur.push(id.clone());
      cur_chars = cur_chars.saturating_add(add);
    }
    if !cur.is_empty() {
      chunks.push(cur);
    }

    let total_chunks = chunks.len().max(1);
    let _ = emit_job(&app, JobProgressEvent {
      job_id: job_id.clone(),
      media_id: media_id.clone(),
      job_type: JobType::Subtitle,
      status: JobStatus::Running,
      progress: 0.05,
      message: Some(format!("translating (chunks={})", total_chunks)),
    });

    let sem = std::sync::Arc::new(tokio::sync::Semaphore::new(concurrency));
    let meta = std::sync::Arc::new(id_to_meta.clone());
    let ai2 = args.ai.clone();
    let tl = target_lang.clone();

    let mut futs: FuturesUnordered<_> = FuturesUnordered::new();
    for (i, ids_chunk) in chunks.into_iter().enumerate() {
      let sem = sem.clone();
      let app2 = app.clone();
      let job_id2 = job_id.clone();
      let media_id2 = media_id.clone();
      let ai3 = ai2.clone();
      let tl2 = tl.clone();
      let meta2 = meta.clone();
      let label = format!("chunk {}/{}", i + 1, total_chunks);
      futs.push(async move {
        let _permit = sem.acquire_owned().await.map_err(|e| e.to_string())?;
        let mut local: std::collections::HashMap<String, String> = std::collections::HashMap::new();
        let err = translate_ids_with_auto_split(
          &app2,
          &job_id2,
          &media_id2,
          &ai3,
          &tl2,
          &ids_chunk,
          &meta2,
          &mut local,
          &label,
        )
        .await;
        Ok::<_, String>((local, err))
      });
    }

    while let Some(res) = futs.next().await {
      match res {
        Ok((m, err)) => {
          for (k, v) in m {
            out_map.insert(k, v);
          }
          if err.is_some() {
            last_translate_err = err;
          }
        }
        Err(e) => {
          last_translate_err = Some(e);
        }
      }
    }
  }

  // 3) Repair pass: translate any missing ids (best-effort, also auto-split).
  {
    let missing_ids: Vec<String> = id_order
      .iter()
      .filter(|id| !out_map.contains_key(*id))
      .cloned()
      .collect();
    let total = id_order.len().max(1);
    let missing_count = missing_ids.len();
    if missing_count > 0 {
      let _ = emit_job(&app, JobProgressEvent {
        job_id: job_id.clone(),
        media_id: media_id.clone(),
        job_type: JobType::Subtitle,
        status: JobStatus::Running,
        progress: 0.92,
        message: Some(format!("repairing missing translations ({}/{})", missing_count, total)),
      });

      let err = translate_ids_with_auto_split(
        &app,
        &job_id,
        &media_id,
        &args.ai,
        &target_lang,
        &missing_ids,
        &id_to_meta,
        &mut out_map,
        "repairing",
      )
      .await;
      if err.is_some() {
        last_translate_err = err;
      }
    }
  }

  let total = id_order.len().max(1);
  let translated_unique = out_map.len();
  if translated_unique == 0 {
    let hint = last_translate_err
      .as_deref()
      .map(|s| s.trim())
      .filter(|s| !s.is_empty())
      .map(|s| {
        let preview = s.chars().take(380).collect::<String>();
        preview
      })
      .unwrap_or_else(|| "unknown error".to_string());
    return Err(format!("translation produced no segments\n\nlast error (first 380 chars):\n{hint}"));
  }

  // Build translated track.
  let translated_id = if target_lang.starts_with("zh") { "zh".to_string() } else { target_lang.clone() };
  let translated_label = if translated_id == "zh" { "中文".to_string() } else { translated_id.clone() };

  let mut translated_segs: Vec<serde_json::Value> = Vec::new();
  let mut bilingual_segs: Vec<serde_json::Value> = Vec::new();

  for id in &id_order {
    let Some((start, end, orig_text)) = id_to_meta.get(id) else { continue; };
    let tr_text = out_map.get(id).cloned().unwrap_or_else(|| orig_text.clone());

    translated_segs.push(serde_json::json!({
      "id": id,
      "start": start,
      "end": end,
      "text": tr_text.clone(),
    }));

    bilingual_segs.push(serde_json::json!({
      "id": id,
      "start": start,
      "end": end,
      "text": format!("{}\n{}", orig_text, tr_text),
    }));
  }

  upsert_track(
    &mut subs,
    serde_json::json!({
      "id": translated_id,
      "label": translated_label,
      "language": target_lang,
      "kind": "ai_translate",
      "generatedAt": now_iso(),
      "segments": translated_segs,
    }),
  );

  upsert_track(
    &mut subs,
    serde_json::json!({
      "id": "bilingual",
      "label": "双语",
      "language": format!("{}+{}", orig_lang, target_lang),
      "kind": "derived",
      "generatedAt": now_iso(),
      "segments": bilingual_segs,
    }),
  );

  subs["generatedAt"] = serde_json::Value::String(now_iso());

  // Add translation metadata for UI (coverage reporting).
  let coverage = (translated_unique as f64) / (total as f64);
  subs["translation"] = serde_json::json!({
    "targetLang": target_lang,
    "strategy": strategy,
    "totalSegments": total,
    "translatedSegments": translated_unique,
    "coverage": coverage,
    "generatedAt": now_iso(),
  });

  write_json_atomic(&subtitles_file_path(&media_dir), &subs)?;
  Ok(subs)
  }
  .await;

  match result {
    Ok(v) => {
      let _ = emit_job(&app, JobProgressEvent {
        job_id: job_id.clone(),
        media_id: media_id.clone(),
        job_type: JobType::Subtitle,
        status: JobStatus::Succeeded,
        progress: 1.0,
        message: Some("subtitle translation finished".to_string()),
      });
      Ok(v)
    }
    Err(e) => {
      let _ = emit_job(&app, JobProgressEvent {
        job_id: job_id.clone(),
        media_id: media_id.clone(),
        job_type: JobType::Subtitle,
        status: JobStatus::Failed,
        progress: 1.0,
        message: Some(e.clone()),
      });
      Err(e)
    }
  }
}

#[tauri::command]
async fn get_media_storage_info(
  app: tauri::AppHandle,
  args: MediaDirArgs,
  state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
  let dir = state
    .data_root
    .get_or_try_init(|| async { portable::resolve_data_root(&app) })
    .await?;

  let media_id = args.media_id.trim().to_string();
  validate_media_id(&media_id)?;

  let media_dir = dir.join("media").join(&media_id);
  if !media_dir.is_dir() {
    return Err("media not found".to_string());
  }

  let mut files: Vec<String> = Vec::new();
  if let Ok(rd) = std::fs::read_dir(&media_dir) {
    for e in rd.flatten() {
      let p = e.path();
      if p.is_file() {
        files.push(p.to_string_lossy().to_string());
      }
    }
  }
  files.sort();

  Ok(serde_json::json!({
    "media_id": media_id,
    "data_root": dir.to_string_lossy().to_string(),
    "media_dir": media_dir.to_string_lossy().to_string(),
    "files": files,
  }))
}

#[tauri::command]
async fn reveal_media_dir(
  app: tauri::AppHandle,
  args: MediaDirArgs,
  state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
  let dir = state
    .data_root
    .get_or_try_init(|| async { portable::resolve_data_root(&app) })
    .await?;

  let media_id = args.media_id.trim().to_string();
  validate_media_id(&media_id)?;

  let media_dir = dir.join("media").join(&media_id);
  if !media_dir.is_dir() {
    return Err("media not found".to_string());
  }

  #[cfg(target_os = "windows")]
  {
    std::process::Command::new("explorer")
      .arg(media_dir)
      .spawn()
      .map_err(|e| format!("failed to open explorer: {e}"))?;
    return Ok(());
  }

  #[cfg(target_os = "macos")]
  {
    std::process::Command::new("open")
      .arg(media_dir)
      .spawn()
      .map_err(|e| format!("failed to open folder: {e}"))?;
    return Ok(());
  }

  #[cfg(not(any(target_os = "windows", target_os = "macos")))]
  {
    std::process::Command::new("xdg-open")
      .arg(media_dir)
      .spawn()
      .map_err(|e| format!("failed to open folder: {e}"))?;
    return Ok(());
  }
}

#[tauri::command]
async fn import_url(app: tauri::AppHandle, args: ImportUrlArgs, state: State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
  let ImportUrlArgs { url, media_id, quality } = args;

  let url = if url.starts_with("http://") || url.starts_with("https://") {
    url
  } else if let Some(extracted) = extract_first_http_url(&url) {
    extracted
  } else {
    return Err("only http(s) URLs are supported".to_string());
  };

  let dir = state
    .data_root
    .get_or_try_init(|| async { portable::resolve_data_root(&app) })
    .await?;

  let media_id = media_id.unwrap_or_else(|| format!("media-{}", nanoid()));
  validate_media_id(&media_id)?;
  let job_id = format!("job-{}", nanoid());

  let media_dir = dir.join("media").join(&media_id);
  tokio::fs::create_dir_all(&media_dir)
    .await
    .map_err(|e| format!("create media dir failed: {e}"))?;

  let output_template = media_dir.join("source.%(ext)s");

  // Prepare tools (first run may need to download them).
  let _ = emit_job(&app, JobProgressEvent {
    job_id: job_id.clone(),
    media_id: media_id.clone(),
    job_type: JobType::Download,
    status: JobStatus::Running,
    progress: 0.0,
    message: Some("preparing download tools".to_string()),
  });

  let ytdlp = ensure_ytdlp(&app, state.inner(), dir).await?;
  let (ffmpeg_dir, has_ffmpeg) = match ensure_ffmpeg_bundle(&app, state.inner(), dir).await {
    Ok((ffmpeg, _ffprobe)) => (ffmpeg.parent().map(|p| p.to_path_buf()), true),
    Err(_) => (None, false),
  };

  // Optional cookies file for restricted content.
  // Priority: explicit env var > data_root/db/cookies.txt
  let cookies_path = std::env::var("VECHO_YTDLP_COOKIES")
    .ok()
    .map(PathBuf::from)
    .or_else(|| {
      let p = dir.join("db").join("cookies.txt");
      if p.is_file() { Some(p) } else { None }
    });

  let _ = emit_job(&app, JobProgressEvent {
    job_id: job_id.clone(),
    media_id: media_id.clone(),
    job_type: JobType::Download,
    status: JobStatus::Running,
    progress: 0.01,
    message: Some("starting download".to_string()),
  });

  let is_youtube = looks_like_youtube_url(&url);

  // yt-dlp may need a JS runtime for YouTube extraction (varies by version/site behavior).
  let js_runtime = if is_youtube {
    if is_exe_available("deno") {
      Some("deno".to_string())
    } else if is_exe_available("node") {
      Some("node".to_string())
    } else {
      None
    }
  } else {
    None
  };

  let insecure = std::env::var("VECHO_YTDLP_INSECURE")
    .ok()
    .map(|v| {
      let s = v.trim().to_lowercase();
      s == "1" || s == "true" || s == "yes"
    })
    .unwrap_or(false);

  let mut opts = YtDlpRunOpts {
    has_ffmpeg,
    ffmpeg_dir: ffmpeg_dir.clone(),
    cookies_path: cookies_path.clone(),
    retries: if is_youtube { 20 } else { 10 },
    fragment_retries: if is_youtube { 20 } else { 10 },
    extractor_retries: 3,
    socket_timeout: if is_youtube { 30 } else { 20 },
    concurrent_fragments: if is_youtube { 2 } else { 4 },
    force_ipv4: false,
    youtube_compat: is_youtube,
    js_runtime,
    insecure,
    format: select_ytdlp_format(has_ffmpeg, quality.as_deref()),
  };

  match run_ytdlp_download(&app, &job_id, &media_id, &ytdlp, &url, &output_template, &opts).await {
    Ok(()) => {}
    Err(mut tail) => {
      // Retry once with safer options for common flaky TLS/fragment issues.
      if is_youtube && is_retryable_ytdlp_failure(&tail) {
        let _ = emit_job(&app, JobProgressEvent {
          job_id: job_id.clone(),
          media_id: media_id.clone(),
          job_type: JobType::Download,
          status: JobStatus::Running,
          progress: 0.02,
          message: Some("download hiccup detected; retrying with safer settings (IPv4, fewer fragments)".to_string()),
        });

        opts.force_ipv4 = true;
        opts.concurrent_fragments = 1;
        opts.retries = 30;
        opts.fragment_retries = 30;
        opts.socket_timeout = 45;

        match run_ytdlp_download(&app, &job_id, &media_id, &ytdlp, &url, &output_template, &opts).await {
          Ok(()) => {
            tail.clear();
          }
          Err(tail2) => {
            tail = tail2;
          }
        }
      }

      if !tail.trim().is_empty() {
        let _ = emit_job(&app, JobProgressEvent {
          job_id: job_id.clone(),
          media_id: media_id.clone(),
          job_type: JobType::Download,
          status: JobStatus::Failed,
          progress: 0.0,
          message: Some("download failed".to_string()),
        });
        return Err(format!("yt-dlp failed\n{tail}"));
      }
    }
  }

  let _ = emit_job(&app, JobProgressEvent {
    job_id: job_id.clone(),
    media_id: media_id.clone(),
    job_type: JobType::Download,
    status: JobStatus::Running,
    progress: 0.92,
    message: Some("analyzing media".to_string()),
  });

  let stored_path = find_source_file(&media_dir)?;
  let file_size = std::fs::metadata(&stored_path)
    .map(|m| m.len())
    .unwrap_or(0);
  let stored_rel = stored_path
    .strip_prefix(dir)
    .ok()
    .map(|p| p.to_string_lossy().replace('\\', "/"));

  let mut title: Option<String> = None;
  let mut uploader: Option<String> = None;
  let mut upload_date: Option<String> = None;

  let mut duration: Option<f64> = None;
  let mut meta: Option<serde_json::Value> = None;
  let mut thumbnail: Option<String> = None;
  let mut warning: Option<String> = None;

  if let Some(info_path) = find_info_json(&media_dir) {
    match std::fs::read(&info_path)
      .map_err(|e| format!("read info json failed: {e}"))
      .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).map_err(|e| format!("parse info json failed: {e}")))
    {
      Ok(info) => {
        title = info.get("title").and_then(|v| v.as_str()).map(|s| s.to_string());
        uploader = info
          .get("uploader")
          .or_else(|| info.get("channel"))
          .or_else(|| info.get("uploader_id"))
          .and_then(|v| v.as_str())
          .map(|s| s.to_string());
        upload_date = info
          .get("upload_date")
          .and_then(|v| v.as_str())
          .and_then(ytdlp_upload_date_to_iso);
      }
      Err(e) => {
        if warning.is_none() {
          warning = Some(e);
        }
      }
    }
  }

  match ffprobe_analyze(&app, &stored_path).await {
    Ok((d, m, is_video)) => {
      duration = d;
      meta = m;
      if is_video {
        let seek = d.map(|sec| (sec * 0.1).max(1.0).min(10.0));
        match ffmpeg_thumbnail_data_url(&app, &stored_path, seek).await {
          Ok(t) => thumbnail = Some(t),
          Err(e) => {
            if warning.is_none() {
              warning = Some(e);
            }
          }
        }
      }
    }
    Err(e) => {
      if warning.is_none() {
        warning = Some(e);
      }
    }
  }

  let _ = emit_job(&app, JobProgressEvent {
    job_id: job_id.clone(),
    media_id: media_id.clone(),
    job_type: JobType::Download,
    status: JobStatus::Succeeded,
    progress: 1.0,
    message: None,
  });

  Ok(serde_json::json!({
    "media_id": media_id,
    "job_id": job_id,
    "stored_path": stored_path.to_string_lossy(),
    "stored_rel": stored_rel,
    "file_size": file_size,
    "duration": duration,
    "meta": meta,
    "thumbnail": thumbnail,
    "title": title,
    "uploader": uploader,
    "upload_date": upload_date,
    "warning": warning
  }))
}

#[tauri::command]
async fn upload_begin(app: tauri::AppHandle, args: UploadBeginArgs, state: State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
  let dir = state
    .data_root
    .get_or_try_init(|| async { portable::resolve_data_root(&app) })
    .await?;

  let upload_id = format!("upl-{}", nanoid());
  let media_id = args
    .media_id
    .unwrap_or_else(|| format!("media-{}", nanoid()));
  validate_media_id(&media_id)?;
  let job_id = format!("job-{}", nanoid());

  let file_name = std::path::Path::new(&args.name)
    .file_name()
    .and_then(|s| s.to_str())
    .unwrap_or("file")
    .to_string();

  let ext = std::path::Path::new(&file_name)
    .extension()
    .and_then(|e| e.to_str())
    .unwrap_or("");
  let final_name = if ext.is_empty() {
    "source".to_string()
  } else {
    format!("source.{ext}")
  };

  let media_dir = dir.join("media").join(&media_id);
  let tmp_path = media_dir.join(format!(".upload-{upload_id}.tmp"));
  let final_path = media_dir.join(final_name);

  tokio::task::spawn_blocking({
    let media_dir = media_dir.clone();
    let tmp_path = tmp_path.clone();
    move || -> Result<(), String> {
      std::fs::create_dir_all(&media_dir).map_err(|e| format!("create media dir failed: {e}"))?;
      std::fs::File::create(&tmp_path).map_err(|e| format!("create upload temp file failed: {e}"))?;
      Ok(())
    }
  })
  .await
  .map_err(|e| format!("join upload_begin task failed: {e}"))??;

  {
    let mut uploads = state.uploads.lock().await;
    uploads.insert(
      upload_id.clone(),
      UploadSession {
        media_id: media_id.clone(),
        job_id: job_id.clone(),
        file_name: file_name.clone(),
        mime: args.mime.clone(),
        total_size: args.size,
        received: 0,
        tmp_path: tmp_path.clone(),
        final_path: final_path.clone(),
      },
    );
  }

  let _ = emit_job(&app, JobProgressEvent {
    job_id: job_id.clone(),
    media_id: media_id.clone(),
    job_type: JobType::Import,
    status: JobStatus::Running,
    progress: 0.0,
    message: Some(format!("uploading {file_name}")),
  });

  Ok(serde_json::json!({
    "upload_id": upload_id,
    "media_id": media_id,
    "job_id": job_id
  }))
}

#[tauri::command]
async fn upload_chunk(app: tauri::AppHandle, args: UploadChunkArgs, state: State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
  let UploadChunkArgs {
    upload_id,
    offset,
    bytes,
  } = args;

  let (tmp_path, media_id, job_id, total_size, expected_offset, file_name) = {
    let uploads = state.uploads.lock().await;
    let session = uploads
      .get(&upload_id)
      .ok_or_else(|| "upload not found".to_string())?;
    (
      session.tmp_path.clone(),
      session.media_id.clone(),
      session.job_id.clone(),
      session.total_size,
      session.received,
      session.file_name.clone(),
    )
  };

  if offset != expected_offset {
    return Err(format!("unexpected upload offset: expected {expected_offset}, got {offset}"));
  }

  let len = bytes.len() as u64;
  tokio::task::spawn_blocking({
    let tmp_path = tmp_path.clone();
    let bytes = bytes;
    move || -> Result<(), String> {
      use std::io::Write;
      let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&tmp_path)
        .map_err(|e| format!("open upload temp file failed: {e}"))?;
      f.write_all(&bytes)
        .map_err(|e| format!("write upload chunk failed: {e}"))?;
      Ok(())
    }
  })
  .await
  .map_err(|e| format!("join upload_chunk task failed: {e}"))??;

  let received = {
    let mut uploads = state.uploads.lock().await;
    let session = uploads
      .get_mut(&upload_id)
      .ok_or_else(|| "upload not found".to_string())?;
    if session.received != expected_offset {
      return Err("concurrent upload detected".to_string());
    }
    session.received += len;
    session.received
  };

  // Reserve the last 10% for finalize + metadata extraction.
  let progress = if total_size == 0 {
    0.0
  } else {
    ((received as f32 / total_size as f32).clamp(0.0, 1.0)) * 0.9
  };

  let _ = emit_job(&app, JobProgressEvent {
    job_id,
    media_id,
    job_type: JobType::Import,
    status: JobStatus::Running,
    progress,
    message: Some(format!("uploading {file_name}")),
  });

  Ok(serde_json::json!({
    "received": received
  }))
}

#[tauri::command]
async fn upload_finish(app: tauri::AppHandle, args: UploadFinishArgs, state: State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
  let dir = state
    .data_root
    .get_or_try_init(|| async { portable::resolve_data_root(&app) })
    .await?;

  let UploadFinishArgs { upload_id } = args;
  let session = {
    let mut uploads = state.uploads.lock().await;
    uploads
      .remove(&upload_id)
      .ok_or_else(|| "upload not found".to_string())?
  };

  tokio::task::spawn_blocking({
    let tmp_path = session.tmp_path.clone();
    let final_path = session.final_path.clone();
    move || -> Result<(), String> {
      if final_path.is_file() {
        let _ = std::fs::remove_file(&final_path);
      }
      std::fs::rename(&tmp_path, &final_path)
        .map_err(|e| format!("finalize upload failed: {e}"))?;
      Ok(())
    }
  })
  .await
  .map_err(|e| format!("join upload_finish task failed: {e}"))??;

  let _ = emit_job(&app, JobProgressEvent {
    job_id: session.job_id.clone(),
    media_id: session.media_id.clone(),
    job_type: JobType::Import,
    status: JobStatus::Running,
    progress: 0.905,
    message: Some("preparing media tools".to_string()),
  });

  let mut duration: Option<f64> = None;
  let mut meta: Option<serde_json::Value> = None;
  let mut thumbnail: Option<String> = None;
  let mut warning: Option<String> = None;

  // Ensure ffmpeg/ffprobe are available (download on first run).
  let tools_ready = ensure_ffmpeg_bundle_with_job(
    &app,
    state.inner(),
    dir,
    Some((&session.job_id, &session.media_id, JobType::Import, 0.905, 0.015)),
  )
  .await
  .is_ok();
  if !tools_ready {
    warning = Some("ffmpeg/ffprobe unavailable (install sidecars or check network)".to_string());
  }

  let _ = emit_job(&app, JobProgressEvent {
    job_id: session.job_id.clone(),
    media_id: session.media_id.clone(),
    job_type: JobType::Import,
    status: JobStatus::Running,
    progress: 0.92,
    message: Some(if tools_ready { "analyzing media" } else { "media tools unavailable" }.to_string()),
  });

  if tools_ready {
    match ffprobe_analyze(&app, &session.final_path).await {
      Ok((d, m, is_video)) => {
        duration = d;
        meta = m;
        if is_video {
          let seek = duration.map(|sec| (sec * 0.1).max(1.0).min(10.0));
          match ffmpeg_thumbnail_data_url(&app, &session.final_path, seek).await {
            Ok(t) => thumbnail = Some(t),
            Err(e) => warning = Some(e),
          }
        }
      }
      Err(e) => warning = Some(e),
    }
  }

  let _ = emit_job(&app, JobProgressEvent {
    job_id: session.job_id.clone(),
    media_id: session.media_id.clone(),
    job_type: JobType::Import,
    status: JobStatus::Succeeded,
    progress: 1.0,
    message: None,
  });

  Ok(serde_json::json!({
    "media_id": session.media_id,
    "stored_path": session.final_path.to_string_lossy(),
    "stored_rel": session
      .final_path
      .strip_prefix(dir)
      .ok()
      .map(|p| p.to_string_lossy().replace('\\', "/")),
    "duration": duration,
    "meta": meta,
    "thumbnail": thumbnail,
    "warning": warning
  }))
}

#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
enum TranscriptionEngine {
  LocalSherpaOnnx,
  LocalWhisperCpp,
  OpenaiCompatible,
}

#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OpenAiTranscriptionConfig {
  base_url: String,
  api_key: String,
  model: String,
}

#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TranscriptionConfig {
  engine: TranscriptionEngine,
  language: String,
  #[serde(default)]
  local_accelerator: Option<String>,
  #[serde(default)]
  num_threads: Option<u32>,
  #[serde(default)]
  use_itn: Option<bool>,
  openai: OpenAiTranscriptionConfig,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranscribeMediaArgs {
  media_id: String,
  config: TranscriptionConfig,
}

#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
enum AiProvider {
  OpenaiCompatible,
  Gemini,
}

#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OpenAiAiConfig {
  base_url: String,
  api_key: String,
  chat_model: String,
  summary_model: String,
}

#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GeminiAiConfig {
  base_url: String,
  api_key: String,
  model: String,
}

#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AiSettings {
  provider: AiProvider,
  openai: OpenAiAiConfig,
  gemini: GeminiAiConfig,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SummarizeMediaArgs {
  media_id: String,
  ai: AiSettings,
  #[serde(default)]
  prompt_id: Option<String>,
  #[serde(default)]
  prompt_template: Option<String>,
  #[serde(default)]
  user_lang: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptimizeTranscriptionArgs {
  media_id: String,
  ai: AiSettings,
  #[serde(default)]
  glossary: Option<String>,
}

#[derive(serde::Deserialize, Clone, serde::Serialize)]
#[serde(rename_all = "lowercase")]
enum ChatRole {
  User,
  Assistant,
  System,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatMessageIn {
  role: ChatRole,
  content: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatMediaArgs {
  media_id: String,
  ai: AiSettings,
  messages: Vec<ChatMessageIn>,
  #[serde(default = "default_true")]
  include_transcription: bool,
  #[serde(default)]
  include_summary: bool,
  #[serde(default)]
  user_lang: Option<String>,
}

fn default_true() -> bool {
  true
}

#[tauri::command]
async fn transcribe_media(
  app: tauri::AppHandle,
  args: TranscribeMediaArgs,
  state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
  let dir = state
    .data_root
    .get_or_try_init(|| async { portable::resolve_data_root(&app) })
    .await?;

  let media_id = args.media_id.trim().to_string();
  validate_media_id(&media_id)?;

  let job_id = format!("job-{}", nanoid());
  let media_dir = dir.join("media").join(&media_id);
  if !media_dir.is_dir() {
    return Err("media not found".to_string());
  }

  let _ = emit_job(&app, JobProgressEvent {
    job_id: job_id.clone(),
    media_id: media_id.clone(),
    job_type: JobType::Transcribe,
    status: JobStatus::Running,
    progress: 0.0,
    message: Some("preparing transcription".to_string()),
  });

  let result: Result<serde_json::Value, String> = async {
    // Locate source file.
    let source_path = find_source_file(&media_dir)?;

    // Ensure ffmpeg exists and extract a stable mono 16k WAV.
    ensure_ffmpeg_bundle_with_job(
      &app,
      state.inner(),
      dir,
      Some((&job_id, &media_id, JobType::Transcribe, 0.0, 0.04)),
    )
    .await
    .map_err(|e| format!("ffmpeg unavailable: {e}"))?;
    let ffmpeg = resolve_sidecar(&app, "ffmpeg")?;
    let wav_path = media_dir.join("audio.16k.wav");

    let _ = emit_job(&app, JobProgressEvent {
      job_id: job_id.clone(),
      media_id: media_id.clone(),
      job_type: JobType::Transcribe,
      status: JobStatus::Running,
      progress: 0.05,
      message: Some("extracting audio".to_string()),
    });

    ffmpeg_extract_audio_wav(&ffmpeg, &source_path, &wav_path)
      .await
      .map_err(|e| format!("audio extract failed: {e}"))?;

    let _ = emit_job(&app, JobProgressEvent {
      job_id: job_id.clone(),
      media_id: media_id.clone(),
      job_type: JobType::Transcribe,
      status: JobStatus::Running,
      progress: 0.12,
      message: Some("preparing transcription engine".to_string()),
    });

    let transcription = match args.config.engine {
      TranscriptionEngine::LocalSherpaOnnx => {
        let accel_raw = args
          .config
          .local_accelerator
          .as_deref()
          .unwrap_or("auto")
          .trim()
          .to_lowercase();
        let allow_cuda = accel_raw != "cpu";
        let require_cuda = accel_raw == "cuda";

        let mut lang = args.config.language.trim().to_lowercase();
        if lang.is_empty() {
          lang = "auto".to_string();
        }

        let use_itn = args.config.use_itn.unwrap_or(true);
        let num_threads = args.config.num_threads.unwrap_or(0);

        let sherpa = ensure_sherpa_onnx_offline(
          &app,
          state.inner(),
          dir,
          &job_id,
          &media_id,
          allow_cuda,
          require_cuda,
        )
        .await?;

        let (sense_model, sense_tokens) = ensure_sense_voice_model(
          &app,
          state.inner(),
          dir,
          &job_id,
          &media_id,
        )
        .await?;

        // SenseVoice offline inference can OOM on long audio if we feed the whole file at once.
        // Split into overlapped chunks to avoid boundary word drops.
        const CHUNK_SECONDS: u32 = 45;
        // Large overlap is intentional: it ensures every moment of audio is decoded
        // at least once away from chunk edges, which reduces boundary deletions.
        const OVERLAP_MS: i64 = 8000;
        let chunks_dir = media_dir.join("_sensevoice_chunks");
        let _ = emit_job(&app, JobProgressEvent {
          job_id: job_id.clone(),
          media_id: media_id.clone(),
          job_type: JobType::Transcribe,
          status: JobStatus::Running,
          progress: 0.27,
          message: Some(format!("切分音频（每段 {CHUNK_SECONDS}s，重叠 {}ms）", OVERLAP_MS)),
        });

        let chunks = ffmpeg_split_wav_segments_with_overlap(&app, &ffmpeg, &wav_path, &chunks_dir, CHUNK_SECONDS, OVERLAP_MS)
          .await
          .map_err(|e| format!("audio chunking failed: {e}"))?;

        let mut chunk_paths: Vec<PathBuf> = Vec::with_capacity(chunks.len());
        for ch in &chunks {
          chunk_paths.push(ch.path.clone());
        }

        let _ = emit_job(&app, JobProgressEvent {
          job_id: job_id.clone(),
          media_id: media_id.clone(),
          job_type: JobType::Transcribe,
          status: JobStatus::Running,
          progress: 0.28,
          message: Some(format!("recognizing (SenseVoice, chunks={})", chunk_paths.len())),
        });

        let requested_auto = lang == "auto";

        let res_list_res = run_sherpa_onnx_sense_voice(
          &app,
          &sherpa,
          &sense_tokens,
          &sense_model,
          &chunk_paths,
          &lang,
          use_itn,
          num_threads,
          &job_id,
          &media_id,
        )
        .await;

        let mut res_list = res_list_res?;

        // Smart auto: if one language is clearly dominant, rerun with an explicit language.
        // This reduces deletions (especially English) and makes output more stable.
        let mut locked_lang: Option<String> = None;
        if requested_auto {
          if let Some(dom) = pick_dominant_language_from_results(&res_list) {
            locked_lang = Some(dom);
          }
        }
        if let Some(lock) = locked_lang.as_deref() {
          let _ = emit_job(&app, JobProgressEvent {
            job_id: job_id.clone(),
            media_id: media_id.clone(),
            job_type: JobType::Transcribe,
            status: JobStatus::Running,
            progress: 0.31,
            message: Some(format!("auto 检测到主要语言={lock}，将以该语言重新识别以减少漏词")),
          });

          res_list = run_sherpa_onnx_sense_voice(
            &app,
            &sherpa,
            &sense_tokens,
            &sense_model,
            &chunk_paths,
            lock,
            use_itn,
            num_threads,
            &job_id,
            &media_id,
          )
          .await?;
        }

        let lang_hint = locked_lang
          .as_deref()
          .or_else(|| if requested_auto { None } else { Some(lang.as_str()) });

        let segs = merge_sense_voice_chunks(&res_list, &chunks, lang_hint);

        // Cleanup chunk wav files.
        let _ = tokio::fs::remove_dir_all(&chunks_dir).await;
        if segs.is_empty() {
          return Err("SenseVoice 没有识别到任何文本".to_string());
        }

        let overall_lang = if let Some(lock) = locked_lang.as_deref() {
          lock.to_string()
        } else if lang == "auto" {
          res_list
            .iter()
            .map(|r| r.language.trim())
            .find(|l| !l.is_empty() && *l != "auto")
            .unwrap_or("auto")
            .to_string()
        } else {
          lang.clone()
        };

        let model_label = "sherpa-onnx:sensevoice-small-float";
        let t = build_transcription(&media_id, Some(&overall_lang), model_label, segs);
        write_json_atomic(&media_dir.join("transcription.json"), &t)?;
        t
      }
      TranscriptionEngine::LocalWhisperCpp => {
        let accel_raw = args
          .config
          .local_accelerator
          .as_deref()
          .unwrap_or("auto")
          .trim()
          .to_lowercase();
        let allow_cuda = accel_raw != "cpu";
        let require_cuda = accel_raw == "cuda";

        let mut lang = args.config.language.trim().to_lowercase();
        if lang.is_empty() {
          lang = "auto".to_string();
        }
        // whisper.cpp language list might not include yue; map to zh as a safe default.
        if lang == "yue" {
          lang = "zh".to_string();
        }

        let num_threads = args.config.num_threads.unwrap_or(0);

        let whisper = ensure_whisper_cpp(
          &app,
          state.inner(),
          dir,
          &job_id,
          &media_id,
          allow_cuda,
          require_cuda,
        )
        .await?;

        let model_path = ensure_whisper_cpp_model(&app, state.inner(), dir, &job_id, &media_id).await?;

        let _ = emit_job(&app, JobProgressEvent {
          job_id: job_id.clone(),
          media_id: media_id.clone(),
          job_type: JobType::Transcribe,
          status: JobStatus::Running,
          progress: 0.28,
          message: Some(format!(
            "recognizing (whisper.cpp, provider={}, threads={})",
            whisper.provider,
            if num_threads > 0 { num_threads } else { 0 }
          )),
        });

        let (detected_lang, segs) = run_whisper_cpp(
          &app,
          &whisper,
          &model_path,
          &wav_path,
          &lang,
          num_threads,
          &job_id,
          &media_id,
        )
        .await?;

        if segs.is_empty() {
          return Err("whisper.cpp returned no text".to_string());
        }

        let overall_lang = detected_lang.unwrap_or_else(|| lang.clone());
        let model_label = "whisper.cpp:large-v3-turbo-q5_0";
        let t = build_transcription(&media_id, Some(&overall_lang), model_label, segs);
        write_json_atomic(&media_dir.join("transcription.json"), &t)?;
        t
      }
      TranscriptionEngine::OpenaiCompatible => {
        let _ = emit_job(&app, JobProgressEvent {
          job_id: job_id.clone(),
          media_id: media_id.clone(),
          job_type: JobType::Transcribe,
          status: JobStatus::Running,
          progress: 0.12,
          message: Some("sending audio to provider".to_string()),
        });

        let cfg = args.config.openai.clone();
        let t = openai_transcribe(&media_id, &wav_path, &args.config.language, &cfg).await?;
        write_json_atomic(&media_dir.join("transcription.json"), &t)?;
        t
      }
    };

    let _ = emit_job(&app, JobProgressEvent {
      job_id: job_id.clone(),
      media_id: media_id.clone(),
      job_type: JobType::Transcribe,
      status: JobStatus::Running,
      progress: 0.96,
      message: Some("finalizing".to_string()),
    });

    Ok(transcription)
  }
  .await;

  match result {
    Ok(transcription) => {
      let _ = emit_job(&app, JobProgressEvent {
        job_id: job_id.clone(),
        media_id: media_id.clone(),
        job_type: JobType::Transcribe,
        status: JobStatus::Succeeded,
        progress: 1.0,
        message: None,
      });

      Ok(serde_json::json!({
        "media_id": media_id,
        "job_id": job_id,
        "transcription": transcription,
      }))
    }
    Err(e) => {
      let _ = emit_job(&app, JobProgressEvent {
        job_id: job_id.clone(),
        media_id: media_id.clone(),
        job_type: JobType::Transcribe,
        status: JobStatus::Failed,
        progress: 1.0,
        message: Some(e.clone()),
      });
      Err(e)
    }
  }
}

#[tauri::command]
async fn summarize_media(
  app: tauri::AppHandle,
  args: SummarizeMediaArgs,
  state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
  let dir = state
    .data_root
    .get_or_try_init(|| async { portable::resolve_data_root(&app) })
    .await?;

  let media_id = args.media_id.trim().to_string();
  validate_media_id(&media_id)?;

  let media_dir = dir.join("media").join(&media_id);
  if !media_dir.is_dir() {
    return Err("media not found".to_string());
  }

  let transcription_path = media_dir.join("transcription.json");
  if !transcription_path.is_file() {
    return Err("no transcription found; generate transcription first".to_string());
  }
  let transcription: serde_json::Value = serde_json::from_slice(
    &tokio::fs::read(&transcription_path)
      .await
      .map_err(|e| format!("read transcription failed: {e}"))?,
  )
  .map_err(|e| format!("parse transcription failed: {e}"))?;

  let job_id = format!("job-{}", nanoid());
  let _ = emit_job(&app, JobProgressEvent {
    job_id: job_id.clone(),
    media_id: media_id.clone(),
    job_type: JobType::Summary,
    status: JobStatus::Running,
    progress: 0.0,
    message: Some("summarizing".to_string()),
  });

  let result: Result<serde_json::Value, String> = async {
    let summary = summarize_from_transcription(
      &media_id,
      &args.ai,
      &transcription,
      &job_id,
      &app,
      args.user_lang.as_deref(),
      args.prompt_id.as_deref(),
      args.prompt_template.as_deref(),
    )
    .await?;
    write_json_atomic(&media_dir.join("summary.json"), &summary)?;
    if let Some(content) = summary.get("content").and_then(|v| v.as_str()) {
      let _ = tokio::fs::write(media_dir.join("summary.md"), content).await;
    }
    Ok(summary)
  }
  .await;

  match result {
    Ok(summary) => {
      let _ = emit_job(&app, JobProgressEvent {
        job_id: job_id.clone(),
        media_id: media_id.clone(),
        job_type: JobType::Summary,
        status: JobStatus::Succeeded,
        progress: 1.0,
        message: None,
      });

      Ok(serde_json::json!({
        "media_id": media_id,
        "job_id": job_id,
        "summary": summary,
      }))
    }
    Err(e) => {
      let _ = emit_job(&app, JobProgressEvent {
        job_id: job_id.clone(),
        media_id: media_id.clone(),
        job_type: JobType::Summary,
        status: JobStatus::Failed,
        progress: 1.0,
        message: Some(e.clone()),
      });
      Err(e)
    }
  }
}

#[tauri::command]
async fn optimize_transcription(
  app: tauri::AppHandle,
  args: OptimizeTranscriptionArgs,
  state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
  let dir = state
    .data_root
    .get_or_try_init(|| async { portable::resolve_data_root(&app) })
    .await?;

  let media_id = args.media_id.trim().to_string();
  validate_media_id(&media_id)?;

  let media_dir = dir.join("media").join(&media_id);
  if !media_dir.is_dir() {
    return Err("media not found".to_string());
  }

  let transcription_path = media_dir.join("transcription.json");
  if !transcription_path.is_file() {
    return Err("no transcription found; generate transcription first".to_string());
  }

  let transcription: serde_json::Value = serde_json::from_slice(
    &tokio::fs::read(&transcription_path)
      .await
      .map_err(|e| format!("read transcription failed: {e}"))?,
  )
  .map_err(|e| format!("parse transcription failed: {e}"))?;

  let job_id = format!("job-{}", nanoid());
  let _ = emit_job(&app, JobProgressEvent {
    job_id: job_id.clone(),
    media_id: media_id.clone(),
    job_type: JobType::Optimize,
    status: JobStatus::Running,
    progress: 0.0,
    message: Some("optimizing transcription".to_string()),
  });

  let result: Result<serde_json::Value, String> = async {
    let optimized = optimize_transcription_with_ai(
      &media_id,
      &args.ai,
      &transcription,
      args.glossary.as_deref(),
      &job_id,
      &app,
    )
    .await?;

    // Backup the original transcription once.
    let backup_path = media_dir.join("transcription.original.json");
    if !backup_path.is_file() {
      let _ = tokio::fs::copy(&transcription_path, &backup_path).await;
    }

    write_json_atomic(&media_dir.join("transcription.optimized.json"), &optimized)?;
    write_json_atomic(&media_dir.join("transcription.json"), &optimized)?;
    Ok(optimized)
  }
  .await;

  match result {
    Ok(transcription) => {
      let _ = emit_job(&app, JobProgressEvent {
        job_id: job_id.clone(),
        media_id: media_id.clone(),
        job_type: JobType::Optimize,
        status: JobStatus::Succeeded,
        progress: 1.0,
        message: None,
      });

      Ok(serde_json::json!({
        "media_id": media_id,
        "job_id": job_id,
        "transcription": transcription,
      }))
    }
    Err(e) => {
      let _ = emit_job(&app, JobProgressEvent {
        job_id: job_id.clone(),
        media_id: media_id.clone(),
        job_type: JobType::Optimize,
        status: JobStatus::Failed,
        progress: 1.0,
        message: Some(e.clone()),
      });
      Err(e)
    }
  }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportMediaArgs {
  media_id: String,
  #[serde(default)]
  export_dir: Option<String>,
}

fn format_mmss(seconds: f64) -> String {
  let s = if seconds.is_finite() { seconds.max(0.0) } else { 0.0 };
  let total = s.floor() as u64;
  let m = total / 60;
  let sec = total % 60;
  format!("{}:{:02}", m, sec)
}

fn format_srt_time(seconds: f64) -> String {
  let s = if seconds.is_finite() { seconds.max(0.0) } else { 0.0 };
  let ms_total = (s * 1000.0).round() as u64;
  let ms = ms_total % 1000;
  let total_sec = ms_total / 1000;
  let sec = total_sec % 60;
  let total_min = total_sec / 60;
  let min = total_min % 60;
  let hour = total_min / 60;
  format!("{:02}:{:02}:{:02},{:03}", hour, min, sec, ms)
}

fn format_vtt_time(seconds: f64) -> String {
  let s = if seconds.is_finite() { seconds.max(0.0) } else { 0.0 };
  let ms_total = (s * 1000.0).round() as u64;
  let ms = ms_total % 1000;
  let total_sec = ms_total / 1000;
  let sec = total_sec % 60;
  let total_min = total_sec / 60;
  let min = total_min % 60;
  let hour = total_min / 60;
  format!("{:02}:{:02}:{:02}.{:03}", hour, min, sec, ms)
}

fn extract_transcript_segments(t: &serde_json::Value) -> Vec<(f64, f64, String)> {
  let mut out = Vec::new();
  let arr = t.get("segments").and_then(|v| v.as_array());
  if arr.is_none() {
    return out;
  }
  for seg in arr.unwrap() {
    let start = seg.get("start").and_then(|n| n.as_f64()).unwrap_or(0.0);
    let end = seg.get("end").and_then(|n| n.as_f64()).unwrap_or(start);
    let text = seg.get("text").and_then(|s| s.as_str()).unwrap_or("").trim().to_string();
    if text.is_empty() {
      continue;
    }
    out.push((start, end.max(start), text));
  }
  out
}

async fn try_load_json(path: &Path) -> Option<serde_json::Value> {
  if !path.is_file() {
    return None;
  }
  let bytes = tokio::fs::read(path).await.ok()?;
  serde_json::from_slice::<serde_json::Value>(&bytes).ok()
}

#[tauri::command]
async fn export_media(
  app: tauri::AppHandle,
  args: ExportMediaArgs,
  state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
  let dir = state
    .data_root
    .get_or_try_init(|| async { portable::resolve_data_root(&app) })
    .await?;

  let media_id = args.media_id.trim().to_string();
  validate_media_id(&media_id)?;

  let job_id = format!("job-{}", nanoid());
  let _ = emit_job(&app, JobProgressEvent {
    job_id: job_id.clone(),
    media_id: media_id.clone(),
    job_type: JobType::Export,
    status: JobStatus::Running,
    progress: 0.0,
    message: Some("exporting".to_string()),
  });

  let result: Result<serde_json::Value, String> = async {
    let state_path = state_file_path(dir);
    let media_dir = dir.join("media").join(&media_id);

    let mut media_name = media_id.clone();
    let mut media_item: Option<serde_json::Value> = None;

    if let Some(s) = try_load_json(&state_path).await {
      if let Some(items) = s
        .get("data")
        .and_then(|d| d.get("mediaItems"))
        .and_then(|v| v.as_array())
      {
        for it in items {
          if it.get("id").and_then(|v| v.as_str()) == Some(&media_id) {
            media_item = Some(it.clone());
            if let Some(n) = it.get("name").and_then(|v| v.as_str()) {
              if !n.trim().is_empty() {
                media_name = n.trim().to_string();
              }
            }
            break;
          }
        }
      }
    }

    // Gather data (prefer in-state values, fallback to on-disk per-media files).
    let transcription = if let Some(t) = media_item.as_ref().and_then(|m| m.get("transcription").cloned()) {
      Some(t)
    } else {
      try_load_json(&media_dir.join("transcription.json")).await
    };

    let summary = if let Some(s) = media_item.as_ref().and_then(|m| m.get("summary").cloned()) {
      Some(s)
    } else {
      try_load_json(&media_dir.join("summary.json")).await
    };

    let subtitles = try_load_json(&media_dir.join("subtitles.json")).await;

    let notes = media_item
      .as_ref()
      .and_then(|m| m.get("notes").cloned())
      .unwrap_or_else(|| serde_json::json!([]));
    let bookmarks = media_item
      .as_ref()
      .and_then(|m| m.get("bookmarks").cloned())
      .unwrap_or_else(|| serde_json::json!([]));

    let safe_name = sanitize_filename_component(&media_name);
    let export_dir = if let Some(base) = args.export_dir.as_ref().map(|s| s.trim().to_string()) {
      let base = base.trim();
      if base.is_empty() {
        dir.join("exports").join(format!("{}_{}", safe_name, now_compact()))
      } else {
        std::path::PathBuf::from(base).join(format!("{}_{}", safe_name, now_compact()))
      }
    } else {
      dir.join("exports").join(format!("{}_{}", safe_name, now_compact()))
    };

    tokio::fs::create_dir_all(&export_dir)
      .await
      .map_err(|e| format!("create export dir failed: {e}"))?;

    // Determine steps so progress feels real.
    let mut planned: Vec<(String, bool)> = Vec::new();
    planned.push(("notes.json".to_string(), true));
    planned.push(("bookmarks.json".to_string(), true));
    planned.push(("transcription.json".to_string(), transcription.is_some()));
    planned.push(("transcript.txt".to_string(), transcription.is_some()));
    planned.push(("transcript.srt".to_string(), transcription.is_some()));
    planned.push(("transcript.vtt".to_string(), transcription.is_some()));
    planned.push(("summary.json".to_string(), summary.is_some()));
    planned.push((
      "summary.md".to_string(),
      summary
        .as_ref()
        .and_then(|s| s.get("content"))
        .and_then(|v| v.as_str())
        .is_some(),
    ));

    if let Some(subs) = subtitles.as_ref() {
      if let Some(tracks) = subs.get("tracks").and_then(|v| v.as_array()) {
        for tr in tracks {
          let id = tr.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
          if id.is_empty() {
            continue;
          }
          let segs_ok = tr.get("segments").and_then(|v| v.as_array()).map(|a| !a.is_empty()).unwrap_or(false);
          if !segs_ok {
            continue;
          }
          let safe_id = sanitize_filename_component(id);
          planned.push((format!("subtitles.{safe_id}.srt"), true));
          planned.push((format!("subtitles.{safe_id}.vtt"), true));
        }
      }
    }

    let total_steps = planned.iter().filter(|(_, ok)| *ok).count().max(1) as f32;
    let mut done_steps: f32 = 0.0;

    let mut files: Vec<String> = Vec::new();
    let step = |name: &str, msg: &str, job_id: &str, media_id: &str, app: &tauri::AppHandle, done: &mut f32| {
      *done += 1.0;
      let p = (*done / total_steps).clamp(0.0, 1.0);
      let _ = emit_job(app, JobProgressEvent {
        job_id: job_id.to_string(),
        media_id: media_id.to_string(),
        job_type: JobType::Export,
        status: JobStatus::Running,
        progress: p,
        message: Some(msg.to_string()),
      });
      let _ = name;
    };

    // Notes & bookmarks always exported (even if empty).
    tokio::fs::write(export_dir.join("notes.json"), serde_json::to_vec_pretty(&notes).unwrap_or_default())
      .await
      .map_err(|e| format!("write notes failed: {e}"))?;
    files.push(export_dir.join("notes.json").to_string_lossy().to_string());
    step("notes.json", "wrote notes.json", &job_id, &media_id, &app, &mut done_steps);

    tokio::fs::write(export_dir.join("bookmarks.json"), serde_json::to_vec_pretty(&bookmarks).unwrap_or_default())
      .await
      .map_err(|e| format!("write bookmarks failed: {e}"))?;
    files.push(export_dir.join("bookmarks.json").to_string_lossy().to_string());
    step("bookmarks.json", "wrote bookmarks.json", &job_id, &media_id, &app, &mut done_steps);

    if let Some(t) = transcription {
      tokio::fs::write(export_dir.join("transcription.json"), serde_json::to_vec_pretty(&t).unwrap_or_default())
        .await
        .map_err(|e| format!("write transcription.json failed: {e}"))?;
      files.push(export_dir.join("transcription.json").to_string_lossy().to_string());
      step("transcription.json", "wrote transcription.json", &job_id, &media_id, &app, &mut done_steps);

      let segments = extract_transcript_segments(&t);
      let mut txt = String::new();
      for (start, _end, text) in &segments {
        txt.push_str(&format!("[{}] {}\n", format_mmss(*start), text));
      }
      tokio::fs::write(export_dir.join("transcript.txt"), txt)
        .await
        .map_err(|e| format!("write transcript.txt failed: {e}"))?;
      files.push(export_dir.join("transcript.txt").to_string_lossy().to_string());
      step("transcript.txt", "wrote transcript.txt", &job_id, &media_id, &app, &mut done_steps);

      let mut srt = String::new();
      for (i, (start, end, text)) in segments.iter().enumerate() {
        srt.push_str(&format!("{}\n{} --> {}\n{}\n\n", i + 1, format_srt_time(*start), format_srt_time(*end), text));
      }
      tokio::fs::write(export_dir.join("transcript.srt"), srt)
        .await
        .map_err(|e| format!("write transcript.srt failed: {e}"))?;
      files.push(export_dir.join("transcript.srt").to_string_lossy().to_string());
      step("transcript.srt", "wrote transcript.srt", &job_id, &media_id, &app, &mut done_steps);

      let mut vtt = String::new();
      vtt.push_str("WEBVTT\n\n");
      for (start, end, text) in segments {
        vtt.push_str(&format!("{} --> {}\n{}\n\n", format_vtt_time(start), format_vtt_time(end), text));
      }
      tokio::fs::write(export_dir.join("transcript.vtt"), vtt)
        .await
        .map_err(|e| format!("write transcript.vtt failed: {e}"))?;
      files.push(export_dir.join("transcript.vtt").to_string_lossy().to_string());
      step("transcript.vtt", "wrote transcript.vtt", &job_id, &media_id, &app, &mut done_steps);
    }

    if let Some(s) = summary {
      tokio::fs::write(export_dir.join("summary.json"), serde_json::to_vec_pretty(&s).unwrap_or_default())
        .await
        .map_err(|e| format!("write summary.json failed: {e}"))?;
      files.push(export_dir.join("summary.json").to_string_lossy().to_string());
      step("summary.json", "wrote summary.json", &job_id, &media_id, &app, &mut done_steps);

      if let Some(content) = s.get("content").and_then(|v| v.as_str()) {
        tokio::fs::write(export_dir.join("summary.md"), content)
          .await
          .map_err(|e| format!("write summary.md failed: {e}"))?;
        files.push(export_dir.join("summary.md").to_string_lossy().to_string());
        step("summary.md", "wrote summary.md", &job_id, &media_id, &app, &mut done_steps);
      }
    }

    // Export subtitle tracks if present.
    if let Some(subs) = subtitles {
      if let Some(tracks) = subs.get("tracks").and_then(|v| v.as_array()) {
        for tr in tracks {
          let id = tr.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
          if id.is_empty() {
            continue;
          }
          let segments = extract_transcript_segments(tr);
          if segments.is_empty() {
            continue;
          }

          let safe_id = sanitize_filename_component(id);

          let mut srt = String::new();
          for (i, (start, end, text)) in segments.iter().enumerate() {
            srt.push_str(&format!("{}\n{} --> {}\n{}\n\n", i + 1, format_srt_time(*start), format_srt_time(*end), text));
          }
          let srt_name = format!("subtitles.{safe_id}.srt");
          tokio::fs::write(export_dir.join(&srt_name), srt)
            .await
            .map_err(|e| format!("write {srt_name} failed: {e}"))?;
          files.push(export_dir.join(&srt_name).to_string_lossy().to_string());
          step(&srt_name, &format!("wrote {srt_name}"), &job_id, &media_id, &app, &mut done_steps);

          let mut vtt = String::new();
          vtt.push_str("WEBVTT\n\n");
          for (start, end, text) in segments {
            vtt.push_str(&format!("{} --> {}\n{}\n\n", format_vtt_time(start), format_vtt_time(end), text));
          }
          let vtt_name = format!("subtitles.{safe_id}.vtt");
          tokio::fs::write(export_dir.join(&vtt_name), vtt)
            .await
            .map_err(|e| format!("write {vtt_name} failed: {e}"))?;
          files.push(export_dir.join(&vtt_name).to_string_lossy().to_string());
          step(&vtt_name, &format!("wrote {vtt_name}"), &job_id, &media_id, &app, &mut done_steps);
        }
      }
    }

    Ok(serde_json::json!({
      "media_id": media_id,
      "job_id": job_id,
      "export_dir": export_dir.to_string_lossy().to_string(),
      "files": files,
    }))
  }
  .await;

  match result {
    Ok(payload) => {
      let _ = emit_job(&app, JobProgressEvent {
        job_id: job_id.clone(),
        media_id: media_id.clone(),
        job_type: JobType::Export,
        status: JobStatus::Succeeded,
        progress: 1.0,
        message: None,
      });
      Ok(payload)
    }
    Err(e) => {
      let _ = emit_job(&app, JobProgressEvent {
        job_id: job_id.clone(),
        media_id: media_id.clone(),
        job_type: JobType::Export,
        status: JobStatus::Failed,
        progress: 1.0,
        message: Some(e.clone()),
      });
      Err(e)
    }
  }
}

#[tauri::command]
async fn chat_media(
  app: tauri::AppHandle,
  args: ChatMediaArgs,
  state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
  let dir = state
    .data_root
    .get_or_try_init(|| async { portable::resolve_data_root(&app) })
    .await?;

  let media_id = args.media_id.trim().to_string();
  validate_media_id(&media_id)?;

  let media_dir = dir.join("media").join(&media_id);
  if !media_dir.is_dir() {
    return Err("media not found".to_string());
  }

  // Fallback: some older states may have summary/transcription persisted in state.json
  // but not written to per-media files.
  let media_item: Option<serde_json::Value> = try_load_json(&state_file_path(dir)).await.and_then(|s| {
    s.get("data")
      .and_then(|d| d.get("mediaItems"))
      .and_then(|v| v.as_array())
      .and_then(|arr| {
        arr.iter()
          .find(|it| it.get("id").and_then(|v| v.as_str()) == Some(&media_id))
          .cloned()
      })
  });

  let transcription_path = media_dir.join("transcription.json");
  let transcription = if args.include_transcription {
    if transcription_path.is_file() {
      serde_json::from_slice::<serde_json::Value>(
        &tokio::fs::read(&transcription_path)
          .await
          .map_err(|e| format!("read transcription failed: {e}"))?,
      )
      .ok()
    } else {
      media_item.as_ref().and_then(|m| m.get("transcription").cloned())
    }
  } else {
    None
  };

  let summary_md: Option<String> = if args.include_summary {
    let p = media_dir.join("summary.json");
    if p.is_file() {
      if let Ok(v) = serde_json::from_slice::<serde_json::Value>(
        &tokio::fs::read(&p)
          .await
          .map_err(|e| format!("read summary failed: {e}"))?,
      ) {
        v.get("content").and_then(|c| c.as_str()).map(|s| s.to_string())
      } else {
        None
      }
    } else {
      media_item
        .as_ref()
        .and_then(|m| m.get("summary"))
        .and_then(|s| s.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.to_string())
    }
  } else {
    None
  };

  // Remove mermaid blocks from summary to reduce noise for chat.
  let summary_md = summary_md.map(|s| strip_mermaid_code_blocks(&s));

  let reply = chat_with_media_context(
    &media_id,
    transcription.as_ref(),
    summary_md.as_deref(),
    args.user_lang.as_deref(),
    &args.ai,
    &args.messages,
  )
  .await?;

  Ok(serde_json::json!({
    "message": {
      "id": format!("msg-{}", nanoid()),
      "role": "assistant",
      "content": reply,
      "timestamp": now_iso(),
    }
  }))
}

fn emit_job(app: &tauri::AppHandle, payload: JobProgressEvent) -> Result<(), String> {
  app.emit(EVENT_JOB_PROGRESS, payload).map_err(|e| e.to_string())
}

fn nanoid() -> String {
  // No extra dependency: just good-enough for MVP.
  // This is NOT cryptographically secure.
  let t = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis();
  format!("{}-{}", t, (t % 10_000) as u32)
}

fn validate_media_id(id: &str) -> Result<(), String> {
  let s = id.trim();
  if s.is_empty() {
    return Err("media_id is empty".to_string());
  }
  if !s.starts_with("media-") {
    return Err("invalid media_id".to_string());
  }
  if s.len() > 128 {
    return Err("media_id too long".to_string());
  }
  if !s
    .chars()
    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
  {
    return Err("invalid media_id characters".to_string());
  }
  Ok(())
}

fn extract_first_http_url(raw: &str) -> Option<String> {
  let s = raw.trim();
  if s.is_empty() {
    return None;
  }

  let idx = s
    .find("https://")
    .or_else(|| s.find("http://"))?;

  let tail = &s[idx..];
  let end = tail
    .find(char::is_whitespace)
    .unwrap_or_else(|| tail.len());

  let mut url = tail[..end].trim().to_string();
  while let Some(last) = url.chars().last() {
    if matches!(last, ']' | '】' | ')' | '）' | '>' | ',' | '，' | '。' | ';' | '；' | '!' | '！' | '?' | '？' | '"' | '\'' | '“' | '”' | '‘' | '’') {
      url.pop();
      continue;
    }
    break;
  }

  if url.starts_with("http://") || url.starts_with("https://") {
    Some(url)
  } else {
    None
  }
}

fn looks_like_youtube_url(url: &str) -> bool {
  let u = url.trim().to_lowercase();
  u.contains("youtube.com") || u.contains("youtu.be")
}

fn is_exe_available(name: &str) -> bool {
  let n = name.trim();
  if n.is_empty() {
    return false;
  }

  // If user passed an explicit path.
  let p = PathBuf::from(n);
  if p.is_file() {
    return true;
  }

  // PATH lookup.
  let Some(path_os) = std::env::var_os("PATH") else {
    return false;
  };
  for dir in std::env::split_paths(&path_os) {
    let cand = dir.join(n);
    if cand.is_file() {
      return true;
    }
    if cfg!(windows) {
      let cand_exe = dir.join(format!("{n}.exe"));
      if cand_exe.is_file() {
        return true;
      }
    }
  }
  false
}

fn parse_ytdlp_percent(line: &str) -> Option<f64> {
  // Typical line: "[download]  12.3% of ..."
  let pct_idx = line.find('%')?;
  let bytes = line.as_bytes();

  let mut start = pct_idx;
  while start > 0 {
    let b = bytes[start - 1];
    if (b as char).is_ascii_digit() || b == b'.' {
      start -= 1;
      continue;
    }
    break;
  }

  if start == pct_idx {
    return None;
  }

  let num = &line[start..pct_idx];
  num.trim().parse::<f64>().ok()
}

fn maybe_emit_ytdlp_progress(
  app: &tauri::AppHandle,
  job_id: &str,
  media_id: &str,
  line: &str,
  state: &Arc<std::sync::Mutex<(i32, std::time::Instant)>>,
) {
  let now = std::time::Instant::now();

  let mut guard = state.lock().unwrap_or_else(|e| e.into_inner());
  let (last_pct, last_emit) = &mut *guard;

  if let Some(pct) = parse_ytdlp_percent(line) {
    let pct_i = pct.round() as i32;

    if pct_i == *last_pct {
      return;
    }
    if pct_i != 100 && now.duration_since(*last_emit) <= std::time::Duration::from_millis(350) {
      return;
    }

    *last_pct = pct_i;
    *last_emit = now;

    // Reserve the last 10% for analyze + thumbnail.
    let p = ((pct / 100.0) as f32).clamp(0.0, 1.0) * 0.9;
    let _ = emit_job(
      app,
      JobProgressEvent {
        job_id: job_id.to_string(),
        media_id: media_id.to_string(),
        job_type: JobType::Download,
        status: JobStatus::Running,
        progress: p,
        message: Some(format!("downloading {pct_i}%")),
      },
    );
    return;
  }

  // Also surface non-percent status/warnings so the UI doesn't look frozen.
  let t = line.trim();
  if t.is_empty() {
    return;
  }
  let lower = t.to_lowercase();
  let looks_useful = lower.starts_with("[download]")
    || lower.starts_with("[youtube]")
    || lower.contains("warning")
    || lower.contains("error")
    || lower.contains("retry")
    || lower.contains("extract")
    || lower.contains("merg")
    || lower.contains("frag")
    || lower.contains("destin");
  if !looks_useful {
    return;
  }
  if now.duration_since(*last_emit) <= std::time::Duration::from_millis(700) {
    return;
  }
  *last_emit = now;

  let mut msg = t.to_string();
  const MAX: usize = 180;
  if msg.chars().count() > MAX {
    msg = msg.chars().take(MAX).collect::<String>();
  }

  let p = if *last_pct >= 0 {
    ((*last_pct as f32) / 100.0).clamp(0.0, 1.0) * 0.9
  } else {
    0.02
  };

  let _ = emit_job(
    app,
    JobProgressEvent {
      job_id: job_id.to_string(),
      media_id: media_id.to_string(),
      job_type: JobType::Download,
      status: JobStatus::Running,
      progress: p,
      message: Some(msg),
    },
  );
}

#[derive(Clone, Debug)]
struct YtDlpRunOpts {
  has_ffmpeg: bool,
  ffmpeg_dir: Option<PathBuf>,
  cookies_path: Option<PathBuf>,

  format: String,

  retries: u32,
  fragment_retries: u32,
  extractor_retries: u32,
  socket_timeout: u32,
  concurrent_fragments: u32,

  force_ipv4: bool,
  youtube_compat: bool,
  js_runtime: Option<String>,
  insecure: bool,
}

fn select_ytdlp_format(has_ffmpeg: bool, quality: Option<&str>) -> String {
  // Default: keep compatibility (mp4 merge when possible), allow a simple height cap.
  let q = quality.unwrap_or("best").trim().to_lowercase();
  let height: Option<u32> = match q.as_str() {
    "1080p" | "1080" => Some(1080),
    "720p" | "720" => Some(720),
    "480p" | "480" => Some(480),
    "360p" | "360" => Some(360),
    "best" | "auto" | "" => None,
    _ => None,
  };

  if has_ffmpeg {
    if let Some(h) = height {
      // Prefer mp4+h264-ish sources when available, fallback to any container.
      return format!(
        "bestvideo[height<={h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<={h}]+bestaudio/best[height<={h}][ext=mp4]/best[height<={h}]/best",
        h = h
      );
    }
    return "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best".to_string();
  }

  if let Some(h) = height {
    return format!("best[height<={h}][ext=mp4]/best[height<={h}]/best", h = h);
  }
  "best".to_string()
}

fn is_retryable_ytdlp_failure(stderr_tail: &str) -> bool {
  let s = stderr_tail.to_lowercase();
  s.contains("eof occurred in violation of protocol")
    || s.contains("_ssl.c")
    || s.contains("tls")
    || s.contains("ssl")
    || s.contains("connection reset")
    || s.contains("timed out")
    || s.contains("temporary failure")
}

async fn run_ytdlp_download(
  app: &tauri::AppHandle,
  job_id: &str,
  media_id: &str,
  ytdlp: &Path,
  url: &str,
  output_template: &Path,
  opts: &YtDlpRunOpts,
) -> Result<(), String> {
  let mut cmd = tokio::process::Command::new(ytdlp);
  cmd
    .arg("--no-playlist")
    .arg("--newline")
    .arg("--write-info-json")
    .arg("--retries")
    .arg(opts.retries.to_string())
    .arg("--fragment-retries")
    .arg(opts.fragment_retries.to_string())
    .arg("--extractor-retries")
    .arg(opts.extractor_retries.to_string())
    .arg("--socket-timeout")
    .arg(opts.socket_timeout.to_string())
    .arg("--concurrent-fragments")
    .arg(opts.concurrent_fragments.to_string())
    .arg("-f")
    .arg(opts.format.as_str());

  if opts.has_ffmpeg {
    cmd.arg("--merge-output-format").arg("mp4");
  }
  if opts.force_ipv4 {
    cmd.arg("--force-ipv4");
  }
  if opts.insecure {
    cmd.arg("--no-check-certificate");
  }

  if opts.youtube_compat {
    cmd.arg("--extractor-args").arg("youtube:player_client=android");
  }
  if let Some(rt) = opts.js_runtime.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
    cmd.arg("--js-runtimes").arg(rt);
  }

  if let Some(dir) = opts.ffmpeg_dir.as_ref() {
    cmd.arg("--ffmpeg-location").arg(dir);
  }
  if let Some(cookies) = opts.cookies_path.as_ref() {
    cmd.arg("--cookies").arg(cookies);
  }

  cmd
    .arg("-o")
    .arg(output_template)
    .arg(url)
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped());

  let mut child = cmd.spawn().map_err(|e| format!("spawn yt-dlp failed: {e}"))?;
  let stdout = child.stdout.take().ok_or_else(|| "yt-dlp stdout unavailable".to_string())?;
  let stderr = child.stderr.take().ok_or_else(|| "yt-dlp stderr unavailable".to_string())?;

  let stderr_tail = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
  let progress_state = Arc::new(std::sync::Mutex::new((
    -1i32,
    std::time::Instant::now() - std::time::Duration::from_secs(10),
  )));

  let stderr_tail_task = {
    let stderr_tail = stderr_tail.clone();
    let progress_state = progress_state.clone();
    let job_id = job_id.to_string();
    let media_id = media_id.to_string();
    let app_handle = app.clone();
    tokio::spawn(async move {
      use tokio::io::AsyncBufReadExt;
      let mut lines = tokio::io::BufReader::new(stderr).lines();
      while let Ok(Some(line)) = lines.next_line().await {
        maybe_emit_ytdlp_progress(&app_handle, &job_id, &media_id, line.trim(), &progress_state);
        let mut buf = stderr_tail.lock().unwrap_or_else(|e| e.into_inner());
        buf.push(line);
        if buf.len() > 30 {
          buf.remove(0);
        }
      }
    })
  };

  use tokio::io::AsyncBufReadExt;
  let mut out_lines = tokio::io::BufReader::new(stdout).lines();
  while let Ok(Some(line)) = out_lines.next_line().await {
    maybe_emit_ytdlp_progress(app, job_id, media_id, line.trim(), &progress_state);
  }

  let status = child
    .wait()
    .await
    .map_err(|e| format!("wait yt-dlp failed: {e}"))?;
  let _ = stderr_tail_task.await;

  if !status.success() {
    let tail = stderr_tail
      .lock()
      .unwrap_or_else(|e| e.into_inner())
      .join("\n");
    return Err(tail);
  }
  Ok(())
}

fn find_source_file(media_dir: &Path) -> Result<PathBuf, String> {
  let mut best: Option<(PathBuf, u64, std::time::SystemTime)> = None;

  let rd = std::fs::read_dir(media_dir)
    .map_err(|e| format!("read media dir failed: {e}"))?;
  for entry in rd {
    let entry = entry.map_err(|e| format!("read media dir entry failed: {e}"))?;
    let path = entry.path();
    if !path.is_file() {
      continue;
    }

    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
    if !name.starts_with("source.") {
      continue;
    }
    if name.ends_with(".part") {
      continue;
    }

    let meta = entry
      .metadata()
      .map_err(|e| format!("read media file metadata failed: {e}"))?;
    let size = meta.len();
    let modified = meta.modified().unwrap_or(std::time::UNIX_EPOCH);

    match &best {
      None => best = Some((path, size, modified)),
      Some((_, best_size, best_mod)) => {
        if modified > *best_mod || (modified == *best_mod && size > *best_size) {
          best = Some((path, size, modified));
        }
      }
    }
  }

  best
    .map(|(p, _, _)| p)
    .ok_or_else(|| "downloaded media file not found".to_string())
}

fn find_info_json(media_dir: &Path) -> Option<PathBuf> {
  let mut best: Option<(PathBuf, std::time::SystemTime)> = None;
  let rd = std::fs::read_dir(media_dir).ok()?;
  for entry in rd.flatten() {
    let path = entry.path();
    if !path.is_file() {
      continue;
    }
    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
    if !name.ends_with(".info.json") {
      continue;
    }
    let modified = entry.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
    match &best {
      None => best = Some((path, modified)),
      Some((_, best_mod)) => {
        if modified > *best_mod {
          best = Some((path, modified));
        }
      }
    }
  }
  best.map(|(p, _)| p)
}

fn ytdlp_upload_date_to_iso(d: &str) -> Option<String> {
  let s = d.trim();
  if s.len() != 8 {
    return None;
  }
  let (y, rest) = s.split_at(4);
  let (m, day) = rest.split_at(2);
  if y.chars().all(|c| c.is_ascii_digit())
    && m.chars().all(|c| c.is_ascii_digit())
    && day.chars().all(|c| c.is_ascii_digit())
  {
    return Some(format!("{y}-{m}-{day}"));
  }
  None
}

fn sidecar_basename(name: &str) -> String {
  if cfg!(windows) {
    format!("{name}.exe")
  } else {
    name.to_string()
  }
}

fn is_probably_stub_binary(path: &Path) -> bool {
  let meta = match std::fs::metadata(path) {
    Ok(m) => m,
    Err(_) => return true,
  };

  let len = meta.len();
  if len == 0 {
    return true;
  }

  // Real ffmpeg/ffprobe/yt-dlp are always multi-MB. Avoid touching large files.
  if len > 2 * 1024 * 1024 {
    return false;
  }

  // Very tiny executables are almost certainly invalid/stubs.
  if len < 16 * 1024 {
    return true;
  }

  // Our stubs print a distinctive marker.
  if let Ok(bytes) = std::fs::read(path) {
    let s = String::from_utf8_lossy(&bytes);
    if s.contains("[vecho] sidecar") && s.contains("is a stub") {
      return true;
    }
  }

  false
}

fn resolve_sidecar(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
  let file_name = sidecar_basename(name);

  if let Ok(dir) = std::env::var(SIDECAR_ENV_DIR) {
    let p = PathBuf::from(dir).join(&file_name);
    if p.is_file() && !is_probably_stub_binary(&p) {
      return Ok(p);
    }
  }

  // Prefer per-user/per-workspace installed sidecars under the app data root.
  if let Some(state) = app.try_state::<Arc<AppState>>() {
    if let Some(root) = state.data_root.get() {
      let p = root.join("bin").join(&file_name);
      if p.is_file() && !is_probably_stub_binary(&p) {
        return Ok(p);
      }
    }
  }

  // First try Tauri resource dir.
  if let Ok(res_dir) = app.path().resource_dir() {
    let p = res_dir.join(&file_name);
    if p.is_file() && !is_probably_stub_binary(&p) {
      return Ok(p);
    }

    // macOS bundles: sidecars are often next to the executable under Contents/MacOS.
    if res_dir.file_name().and_then(|s| s.to_str()) == Some("Resources") {
      if let Some(contents_dir) = res_dir.parent() {
        let p = contents_dir.join("MacOS").join(&file_name);
        if p.is_file() && !is_probably_stub_binary(&p) {
          return Ok(p);
        }
      }
    }
  }

  // Dev mode (and Windows): sidecars are copied next to the executable.
  if let Ok(exe) = std::env::current_exe() {
    if let Some(dir) = exe.parent() {
      let p = dir.join(&file_name);
      if p.is_file() && !is_probably_stub_binary(&p) {
        return Ok(p);
      }
    }
  }

  Err(format!(
    "sidecar '{name}' not found. Provide binaries under src-tauri/bin or set {SIDECAR_ENV_DIR}."
  ))
}

fn tools_bin_dir(data_root: &Path) -> PathBuf {
  data_root.join("bin")
}

#[cfg(unix)]
fn set_executable(path: &Path) -> Result<(), String> {
  use std::os::unix::fs::PermissionsExt;
  let perm = std::fs::Permissions::from_mode(0o755);
  std::fs::set_permissions(path, perm).map_err(|e| format!("set executable failed: {e}"))
}

#[cfg(not(unix))]
fn set_executable(_: &Path) -> Result<(), String> {
  Ok(())
}

async fn http_download_to_file(url: &str, dest: &Path) -> Result<(), String> {
  http_download_to_file_with_progress(url, dest, |_done, _total| {}).await
}

async fn http_download_to_file_with_progress<F>(url: &str, dest: &Path, mut on_progress: F) -> Result<(), String>
where
  F: FnMut(u64, Option<u64>) + Send,
{
  use tokio::io::AsyncWriteExt;
  use tokio::time::{sleep, timeout, Duration, Instant};
  use reqwest::StatusCode;

  // GitHub release downloads (esp. large archives) can pause for a while depending on network.
  // Keep a stall guard, but allow several automatic resume attempts.
  const STALL_TIMEOUT_SECS: u64 = 300;
  const MAX_CONSECUTIVE_RETRIES_WITHOUT_PROGRESS: usize = 6;
  const RETRY_BACKOFF_SECS: u64 = 2;

  let dir = dest
    .parent()
    .ok_or_else(|| "invalid destination path".to_string())?;
  tokio::fs::create_dir_all(dir)
    .await
    .map_err(|e| format!("create dir failed: {e}"))?;

  let tmp = dest.with_extension("part");

  let client = reqwest::Client::new();
  let mut consecutive_retries_without_progress = 0usize;
  let mut last_progress_downloaded: u64 = tokio::fs::metadata(&tmp)
    .await
    .map(|m| m.len())
    .unwrap_or(0);

  loop {
    let (resp, mut resume_from): (reqwest::Response, u64) = {
      let mut restarted = false;
      loop {
        let resume_from: u64 = tokio::fs::metadata(&tmp)
          .await
          .map(|m| m.len())
          .unwrap_or(0);

        let mut req = client.get(url).header("User-Agent", "vecho-studio");
        if resume_from > 0 {
          req = req.header("Range", format!("bytes={resume_from}-"));
        }

        let resp = match req.send().await {
          Ok(r) => r,
          Err(e) => {
            consecutive_retries_without_progress = consecutive_retries_without_progress.saturating_add(1);
            if consecutive_retries_without_progress > MAX_CONSECUTIVE_RETRIES_WITHOUT_PROGRESS {
              return Err(format!("download failed ({url}): {e}"));
            }
            sleep(Duration::from_secs(RETRY_BACKOFF_SECS)).await;
            continue;
          }
        };

        let status = resp.status();
        if status == StatusCode::RANGE_NOT_SATISFIABLE && resume_from > 0 {
          let _ = tokio::fs::remove_file(&tmp).await;
          if restarted {
            return Err("download failed: range not satisfiable".to_string());
          }
          restarted = true;
          continue;
        }
        break (resp, resume_from);
      }
    };

    let status = resp.status();
    if !(status.is_success() || status == StatusCode::PARTIAL_CONTENT) {
      return Err(format!("download failed ({url}): http {}", status));
    }

    // If server ignored our Range request, restart from scratch.
    let resuming = resume_from > 0 && status == StatusCode::PARTIAL_CONTENT;
    if resume_from > 0 && !resuming {
      let _ = tokio::fs::remove_file(&tmp).await;
      resume_from = 0;
    }

    // Determine total size.
    let mut total: Option<u64> = None;
    if status == StatusCode::PARTIAL_CONTENT {
      if let Some(v) = resp.headers().get("Content-Range").and_then(|h| h.to_str().ok()) {
        // Example: "bytes 100-999/1000"
        if let Some(total_str) = v.split('/').nth(1) {
          if let Ok(t) = total_str.trim().parse::<u64>() {
            total = Some(t);
          }
        }
      }
    }
    if total.is_none() {
      // For 200 OK or if Content-Range is missing.
      total = if status == StatusCode::PARTIAL_CONTENT {
        resp.content_length().map(|t| t.saturating_add(resume_from))
      } else {
        resp.content_length()
      };
    }

    // Open destination temp file.
    let mut downloaded: u64 = resume_from;
    let mut file = if resuming {
      tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&tmp)
        .await
        .map_err(|e| format!("open temp file failed: {e}"))?
    } else {
      downloaded = 0;
      tokio::fs::File::create(&tmp)
        .await
        .map_err(|e| format!("create temp file failed: {e}"))?
    };

    // Emit initial progress (useful for resume).
    on_progress(downloaded, total);
    let mut last_emit_at = Instant::now();
    let mut last_emit_downloaded: u64 = downloaded;

    let mut stream = resp.bytes_stream();
    let mut restart = false;

    let mut stall_secs: u64 = 0;
    loop {
      // Use a short timeout so we can emit periodic progress updates.
      // This avoids the UI looking frozen during long network pauses.
      let next = timeout(Duration::from_secs(1), stream.next()).await;
      let next = match next {
        Ok(v) => {
          stall_secs = 0;
          v
        }
        Err(_) => {
          stall_secs = stall_secs.saturating_add(1);
          if last_emit_at.elapsed() >= Duration::from_secs(1) {
            on_progress(downloaded, total);
            last_emit_at = Instant::now();
            last_emit_downloaded = downloaded;
          }
          if stall_secs >= STALL_TIMEOUT_SECS {
            // Stalled; try to resume by restarting the request.
            consecutive_retries_without_progress = consecutive_retries_without_progress.saturating_add(1);
            if consecutive_retries_without_progress > MAX_CONSECUTIVE_RETRIES_WITHOUT_PROGRESS {
              return Err(format!("download stalled (no data for {STALL_TIMEOUT_SECS}s): {url}"));
            }
            restart = true;
            break;
          }
          continue;
        }
      };

      let Some(chunk) = next else { break; };

      let chunk = match chunk {
        Ok(c) => c,
        Err(e) => {
          consecutive_retries_without_progress = consecutive_retries_without_progress.saturating_add(1);
          if consecutive_retries_without_progress > MAX_CONSECUTIVE_RETRIES_WITHOUT_PROGRESS {
            return Err(format!("download stream error ({url}): {e}"));
          }
          restart = true;
          break;
        }
      };

      downloaded = downloaded.saturating_add(chunk.len() as u64);

      // Throttle progress emissions (emitting on every chunk can be too chatty).
      if downloaded > last_emit_downloaded
        && (downloaded.saturating_sub(last_emit_downloaded) >= 256 * 1024
          || last_emit_at.elapsed() >= Duration::from_millis(250))
      {
        on_progress(downloaded, total);
        last_emit_at = Instant::now();
        last_emit_downloaded = downloaded;
      }
      file
        .write_all(&chunk)
        .await
        .map_err(|e| format!("write temp file failed: {e}"))?;

      if downloaded > last_progress_downloaded {
        last_progress_downloaded = downloaded;
        consecutive_retries_without_progress = 0;
      }
    }

    file.flush().await.ok();

    if restart {
      sleep(Duration::from_secs(RETRY_BACKOFF_SECS)).await;
      continue;
    }

    // Finished download; finalize atomically.
    if dest.is_file() {
      let _ = tokio::fs::remove_file(dest).await;
    }
    tokio::fs::rename(&tmp, dest)
      .await
      .map_err(|e| format!("finalize download failed: {e}"))?;
    return Ok(());
  }
}

fn human_bytes(bytes: u64) -> String {
  const KB: f64 = 1024.0;
  const MB: f64 = KB * 1024.0;
  const GB: f64 = MB * 1024.0;

  let b = bytes as f64;
  if b < KB {
    return format!("{bytes} B");
  }
  if b < MB {
    return format!("{:.1} KB", b / KB);
  }
  if b < GB {
    return format!("{:.1} MB", b / MB);
  }
  format!("{:.2} GB", b / GB)
}

async fn ensure_ytdlp(app: &tauri::AppHandle, state: &Arc<AppState>, data_root: &Path) -> Result<PathBuf, String> {
  let _guard = state.tools_lock.lock().await;

  let bin_dir = tools_bin_dir(data_root);
  tokio::fs::create_dir_all(&bin_dir)
    .await
    .map_err(|e| format!("create bin dir failed: {e}"))?;

  let dest = bin_dir.join(sidecar_basename("yt-dlp"));
  if dest.is_file() && !is_probably_stub_binary(&dest) {
    return Ok(dest);
  }

  // Prefer a bundled sidecar (no first-run download).
  if let Ok(p) = resolve_sidecar(app, "yt-dlp") {
    return Ok(p);
  }

  let url = if cfg!(windows) {
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe".to_string()
  } else if cfg!(target_os = "macos") {
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos".to_string()
  } else {
    match std::env::consts::ARCH {
      "aarch64" => "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64".to_string(),
      _ => "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux".to_string(),
    }
  };

  http_download_to_file(&url, &dest).await?;
  set_executable(&dest)?;

  // Prefer this directory for future sidecar resolution.
  std::env::set_var(SIDECAR_ENV_DIR, &bin_dir);

  // Basic sanity: if it's still tiny, treat as failure.
  if is_probably_stub_binary(&dest) {
    return Err("downloaded yt-dlp looks invalid".to_string());
  }

  Ok(dest)
}

#[derive(Debug, Clone)]
struct SherpaOnnxRuntime {
  exe: PathBuf,
  provider: String,
}

#[derive(Debug, Clone)]
struct WhisperCppRuntime {
  exe: PathBuf,
  provider: String,
}

fn has_nvidia_cuda_driver() -> bool {
  if !cfg!(windows) {
    return false;
  }
  let windir = std::env::var_os("WINDIR")
    .map(PathBuf::from)
    .unwrap_or_else(|| PathBuf::from("C:\\Windows"));
  windir.join("System32").join("nvcuda.dll").is_file()
}

async fn verify_sherpa_exec(path: &Path) -> Result<(), String> {
  let mut cmd = tokio::process::Command::new(path);
  if let Some(dir) = path.parent() {
    cmd.current_dir(dir);
  }
  let status = cmd
    .arg("--help")
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::null())
    .status()
    .await
    .map_err(|e| format!("failed to start sherpa-onnx-offline: {e}"))?;
  if status.success() {
    Ok(())
  } else {
    Err("sherpa-onnx-offline --help returned non-zero".to_string())
  }
}

async fn verify_whisper_exec(path: &Path) -> Result<(), String> {
  let mut cmd = tokio::process::Command::new(path);
  if let Some(dir) = path.parent() {
    cmd.current_dir(dir);
  }
  let status = cmd
    .arg("-h")
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::null())
    .status()
    .await
    .map_err(|e| format!("failed to start whisper-cli: {e}"))?;
  if status.success() {
    Ok(())
  } else {
    Err("whisper-cli -h returned non-zero".to_string())
  }
}

async fn install_sherpa_bundle(
  app: &tauri::AppHandle,
  root: &Path,
  url: &str,
  archive_file: &str,
  job_id: &str,
  media_id: &str,
  progress_base: f32,
  progress_span: f32,
  label: &str,
) -> Result<PathBuf, String> {
  tokio::fs::create_dir_all(root)
    .await
    .map_err(|e| format!("create sherpa dir failed: {e}"))?;

  let archive_path = root.join(archive_file);

  let job_id_s = job_id.to_string();
  let media_id_s = media_id.to_string();
  let archive_label = archive_file.to_string();

  http_download_to_file_with_progress(url, &archive_path, move |done, total| {
    let p = match total {
      Some(t) if t > 0 => {
        let frac = (done as f32 / t as f32).clamp(0.0, 1.0);
        progress_base + frac * progress_span
      }
      _ => progress_base,
    };
    let msg = match total {
      Some(t) => format!(
        "downloading {label} ({archive_label}) {} / {}",
        human_bytes(done),
        human_bytes(t)
      ),
      None => format!("downloading {label} ({archive_label}, {})", human_bytes(done)),
    };
    let _ = emit_job(app, JobProgressEvent {
      job_id: job_id_s.clone(),
      media_id: media_id_s.clone(),
      job_type: JobType::Transcribe,
      status: JobStatus::Running,
      progress: p,
      message: Some(msg),
    });
  })
  .await?;

  let _ = emit_job(app, JobProgressEvent {
    job_id: job_id.to_string(),
    media_id: media_id.to_string(),
    job_type: JobType::Transcribe,
    status: JobStatus::Running,
    progress: progress_base + progress_span,
    message: Some(format!("extracting {label}")),
  });

  let tmp_extract = root.join(".extract");
  let _ = tokio::fs::remove_dir_all(&tmp_extract).await;
  tokio::fs::create_dir_all(&tmp_extract)
    .await
    .map_err(|e| format!("create extract dir failed: {e}"))?;

  let archive_path_clone = archive_path.clone();
  let tmp_extract_clone = tmp_extract.clone();
  tokio::task::spawn_blocking(move || extract_tar_bz2_to_dir(&archive_path_clone, &tmp_extract_clone))
    .await
    .map_err(|e| format!("join extract task failed: {e}"))??;

  let exe_name = sidecar_basename("sherpa-onnx-offline");
  let found = find_file_recursive(&tmp_extract, &exe_name)
    .ok_or_else(|| format!("{label} missing {exe_name} after extraction"))?;
  let Some(bin_dir) = found.parent() else {
    return Err(format!("invalid {label} layout"));
  };

  // Move the bin dir into a stable location so DLL lookup works.
  let release_dir = root.join("Release");
  let _ = tokio::fs::remove_dir_all(&release_dir).await;
  tokio::fs::create_dir_all(&release_dir)
    .await
    .map_err(|e| format!("create Release dir failed: {e}"))?;

  // Try fast path: rename the whole bin dir.
  if tokio::fs::rename(bin_dir, &release_dir).await.is_err() {
    // Fallback: copy files.
    let mut rd = tokio::fs::read_dir(bin_dir)
      .await
      .map_err(|e| format!("read extracted bin dir failed: {e}"))?;
    while let Some(ent) = rd.next_entry().await.map_err(|e| format!("read dir entry failed: {e}"))? {
      let p = ent.path();
      if !p.is_file() {
        continue;
      }
      if let Some(name) = p.file_name() {
        let _ = tokio::fs::copy(&p, release_dir.join(name)).await;
      }
    }
  }

  let _ = tokio::fs::remove_dir_all(&tmp_extract).await;
  let _ = tokio::fs::remove_file(&archive_path).await;

  let exe = release_dir.join(exe_name);
  if !exe.is_file() {
    return Err(format!("{label} install failed: executable missing"));
  }
  verify_sherpa_exec(&exe).await?;
  Ok(exe)
}

async fn install_whisper_cpp_bundle(
  app: &tauri::AppHandle,
  root: &Path,
  url: &str,
  archive_file: &str,
  job_id: &str,
  media_id: &str,
  progress_base: f32,
  progress_span: f32,
  label: &str,
) -> Result<PathBuf, String> {
  tokio::fs::create_dir_all(root)
    .await
    .map_err(|e| format!("create whisper.cpp dir failed: {e}"))?;

  let archive_path = root.join(archive_file);
  let job_id_s = job_id.to_string();
  let media_id_s = media_id.to_string();
  let archive_label = archive_file.to_string();

  http_download_to_file_with_progress(url, &archive_path, move |done, total| {
    let p = match total {
      Some(t) if t > 0 => {
        let frac = (done as f32 / t as f32).clamp(0.0, 1.0);
        progress_base + frac * progress_span
      }
      _ => progress_base,
    };
    let msg = match total {
      Some(t) => format!(
        "downloading {label} ({archive_label}) {} / {}",
        human_bytes(done),
        human_bytes(t)
      ),
      None => format!("downloading {label} ({archive_label}, {})", human_bytes(done)),
    };
    let _ = emit_job(app, JobProgressEvent {
      job_id: job_id_s.clone(),
      media_id: media_id_s.clone(),
      job_type: JobType::Transcribe,
      status: JobStatus::Running,
      progress: p,
      message: Some(msg),
    });
  })
  .await?;

  let _ = emit_job(app, JobProgressEvent {
    job_id: job_id.to_string(),
    media_id: media_id.to_string(),
    job_type: JobType::Transcribe,
    status: JobStatus::Running,
    progress: progress_base + progress_span,
    message: Some(format!("extracting {label}")),
  });

  let tmp_extract = root.join(".extract");
  let _ = tokio::fs::remove_dir_all(&tmp_extract).await;
  tokio::fs::create_dir_all(&tmp_extract)
    .await
    .map_err(|e| format!("create extract dir failed: {e}"))?;

  let archive_path_clone = archive_path.clone();
  let tmp_extract_clone = tmp_extract.clone();
  tokio::task::spawn_blocking(move || extract_zip_to_dir(&archive_path_clone, &tmp_extract_clone))
    .await
    .map_err(|e| format!("join extract task failed: {e}"))??;

  let exe_name = sidecar_basename("whisper-cli");
  let found = find_file_recursive(&tmp_extract, &exe_name)
    .ok_or_else(|| format!("{label} missing {exe_name} after extraction"))?;
  let Some(bin_dir) = found.parent() else {
    return Err(format!("invalid {label} layout"));
  };

  // Move the whole directory next to the executable into a stable location so DLL lookup works.
  let release_dir = root.join("Release");
  let _ = tokio::fs::remove_dir_all(&release_dir).await;
  tokio::fs::create_dir_all(&release_dir)
    .await
    .map_err(|e| format!("create Release dir failed: {e}"))?;

  if tokio::fs::rename(bin_dir, &release_dir).await.is_err() {
    copy_dir_files_flat(bin_dir, &release_dir).await?;
  }

  let _ = tokio::fs::remove_dir_all(&tmp_extract).await;
  let _ = tokio::fs::remove_file(&archive_path).await;

  let exe = release_dir.join(exe_name);
  if !exe.is_file() {
    return Err(format!("{label} install failed: executable missing"));
  }
  verify_whisper_exec(&exe).await?;
  Ok(exe)
}

async fn copy_dir_files_flat(src_dir: &Path, dest_dir: &Path) -> Result<(), String> {
  let mut rd = tokio::fs::read_dir(src_dir)
    .await
    .map_err(|e| format!("read extracted dir failed: {e}"))?;
  while let Some(ent) = rd
    .next_entry()
    .await
    .map_err(|e| format!("read dir entry failed: {e}"))?
  {
    let p = ent.path();
    if !p.is_file() {
      continue;
    }
    if let Some(name) = p.file_name() {
      tokio::fs::copy(&p, dest_dir.join(name))
        .await
        .map_err(|e| format!("copy file failed: {e}"))?;
    }
  }
  Ok(())
}

async fn ensure_sherpa_onnx_offline(
  app: &tauri::AppHandle,
  state: &Arc<AppState>,
  data_root: &Path,
  job_id: &str,
  media_id: &str,
  allow_cuda: bool,
  require_cuda: bool,
) -> Result<SherpaOnnxRuntime, String> {
  let _guard = state.tools_lock.lock().await;

  if cfg!(windows) && std::env::consts::ARCH != "x86_64" {
    return Err("sherpa-onnx local transcription currently supports Windows x64 only".to_string());
  }

  let base_root = tools_bin_dir(data_root).join("sherpa_onnx");
  tokio::fs::create_dir_all(&base_root)
    .await
    .map_err(|e| format!("create sherpa root dir failed: {e}"))?;

  let has_cuda = allow_cuda && has_nvidia_cuda_driver();
  if require_cuda && !has_cuda {
    return Err("CUDA requested, but NVIDIA driver (nvcuda.dll) not found. Set localAccelerator=cpu/auto or install NVIDIA driver.".to_string());
  }

  const VER: &str = "v1.12.23";
  const WIN_X64_CPU: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.23/sherpa-onnx-v1.12.23-win-x64-shared.tar.bz2";
  const WIN_X64_CUDA: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.23/sherpa-onnx-v1.12.23-cuda-12.x-cudnn-9.x-win-x64-cuda.tar.bz2";

  let exe_name = sidecar_basename("sherpa-onnx-offline");

  let cuda_root = base_root.join("cuda").join(VER);
  let cuda_exe = cuda_root.join("Release").join(&exe_name);
  let cpu_root = base_root.join("cpu").join(VER);
  let cpu_exe = cpu_root.join("Release").join(&exe_name);

  // Resolution strategy:
  // - If NVIDIA driver exists and user did not force CPU: auto-download CUDA runtime and use it.
  // - Otherwise: use/install CPU.
  if has_cuda {
    if cuda_exe.is_file() && verify_sherpa_exec(&cuda_exe).await.is_ok() {
      let _ = emit_job(app, JobProgressEvent {
        job_id: job_id.to_string(),
        media_id: media_id.to_string(),
        job_type: JobType::Transcribe,
        status: JobStatus::Running,
        progress: 0.18,
        message: Some("using sherpa-onnx (CUDA)".to_string()),
      });
      return Ok(SherpaOnnxRuntime { exe: cuda_exe, provider: "cuda".to_string() });
    }

    // Auto mode (or explicit CUDA): install CUDA bundle.
    let exe = install_sherpa_bundle(
      app,
      &cuda_root,
      WIN_X64_CUDA,
      "sherpa-onnx-cuda.tar.bz2",
      job_id,
      media_id,
      0.12,
      0.06,
      "sherpa-onnx runtime (CUDA)",
    )
    .await?;
    let _ = emit_job(app, JobProgressEvent {
      job_id: job_id.to_string(),
      media_id: media_id.to_string(),
      job_type: JobType::Transcribe,
      status: JobStatus::Running,
      progress: 0.18,
      message: Some("using sherpa-onnx (CUDA)".to_string()),
    });
    return Ok(SherpaOnnxRuntime { exe, provider: "cuda".to_string() });
  }

  if cpu_exe.is_file() && verify_sherpa_exec(&cpu_exe).await.is_ok() {
    return Ok(SherpaOnnxRuntime { exe: cpu_exe, provider: "cpu".to_string() });
  }

  let exe = install_sherpa_bundle(
    app,
    &cpu_root,
    WIN_X64_CPU,
    "sherpa-onnx-cpu.tar.bz2",
    job_id,
    media_id,
    0.12,
    0.06,
    "sherpa-onnx runtime",
  )
  .await?;
  Ok(SherpaOnnxRuntime { exe, provider: "cpu".to_string() })
}

async fn ensure_whisper_cpp(
  app: &tauri::AppHandle,
  state: &Arc<AppState>,
  data_root: &Path,
  job_id: &str,
  media_id: &str,
  allow_cuda: bool,
  require_cuda: bool,
) -> Result<WhisperCppRuntime, String> {
  let _guard = state.tools_lock.lock().await;

  if !cfg!(windows) {
    return Err("whisper.cpp local transcription currently supports Windows only".to_string());
  }
  if std::env::consts::ARCH != "x86_64" {
    return Err("whisper.cpp local transcription currently supports Windows x64 only".to_string());
  }

  let base_root = tools_bin_dir(data_root).join("whisper_cpp");
  tokio::fs::create_dir_all(&base_root)
    .await
    .map_err(|e| format!("create whisper root dir failed: {e}"))?;

  let has_cuda = allow_cuda && has_nvidia_cuda_driver();
  if require_cuda && !has_cuda {
    return Err("CUDA requested, but NVIDIA driver (nvcuda.dll) not found. Set localAccelerator=cpu/auto or install NVIDIA driver.".to_string());
  }

  const VER: &str = "v1.8.3";
  const WIN_X64_CPU: &str = "https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/whisper-blas-bin-x64.zip";
  const WIN_X64_CUDA_12_4: &str = "https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/whisper-cublas-12.4.0-bin-x64.zip";
  const WIN_X64_CUDA_11_8: &str = "https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/whisper-cublas-11.8.0-bin-x64.zip";

  let exe_name = sidecar_basename("whisper-cli");

  let cuda_root = base_root.join("cuda").join(VER);
  let cuda_exe = cuda_root.join("Release").join(&exe_name);
  let cpu_root = base_root.join("cpu").join(VER);
  let cpu_exe = cpu_root.join("Release").join(&exe_name);

  if has_cuda {
    if cuda_exe.is_file() && verify_whisper_exec(&cuda_exe).await.is_ok() {
      let _ = emit_job(app, JobProgressEvent {
        job_id: job_id.to_string(),
        media_id: media_id.to_string(),
        job_type: JobType::Transcribe,
        status: JobStatus::Running,
        progress: 0.18,
        message: Some("using whisper.cpp (CUDA)".to_string()),
      });
      return Ok(WhisperCppRuntime { exe: cuda_exe, provider: "cuda".to_string() });
    }

    // Auto mode (or explicit CUDA): try CUDA 12.4 first, then 11.8.
    let exe = match install_whisper_cpp_bundle(
      app,
      &cuda_root,
      WIN_X64_CUDA_12_4,
      "whisper-cublas-12.4.0-bin-x64.zip",
      job_id,
      media_id,
      0.12,
      0.06,
      "whisper.cpp runtime (CUDA 12.4)",
    )
    .await
    {
      Ok(exe) => Ok(exe),
      Err(e12) => {
        if require_cuda {
          Err(e12)
        } else {
          install_whisper_cpp_bundle(
            app,
            &cuda_root,
            WIN_X64_CUDA_11_8,
            "whisper-cublas-11.8.0-bin-x64.zip",
            job_id,
            media_id,
            0.12,
            0.06,
            "whisper.cpp runtime (CUDA 11.8)",
          )
          .await
        }
      }
    }?;

    let _ = emit_job(app, JobProgressEvent {
      job_id: job_id.to_string(),
      media_id: media_id.to_string(),
      job_type: JobType::Transcribe,
      status: JobStatus::Running,
      progress: 0.18,
      message: Some("using whisper.cpp (CUDA)".to_string()),
    });
    return Ok(WhisperCppRuntime { exe, provider: "cuda".to_string() });
  }

  if cpu_exe.is_file() && verify_whisper_exec(&cpu_exe).await.is_ok() {
    return Ok(WhisperCppRuntime { exe: cpu_exe, provider: "cpu".to_string() });
  }

  let exe = install_whisper_cpp_bundle(
    app,
    &cpu_root,
    WIN_X64_CPU,
    "whisper-blas-bin-x64.zip",
    job_id,
    media_id,
    0.12,
    0.06,
    "whisper.cpp runtime",
  )
  .await?;
  Ok(WhisperCppRuntime { exe, provider: "cpu".to_string() })
}

async fn ensure_whisper_cpp_model(
  app: &tauri::AppHandle,
  state: &Arc<AppState>,
  data_root: &Path,
  job_id: &str,
  media_id: &str,
) -> Result<PathBuf, String> {
  let _guard = state.tools_lock.lock().await;

  // Prefer the quantized large-v3-turbo model for a good accuracy/size trade-off.
  const MODEL_FILE: &str = "ggml-large-v3-turbo-q5_0.bin";
  const URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin";

  let model_dir = data_root.join("models").join("whispercpp");
  tokio::fs::create_dir_all(&model_dir)
    .await
    .map_err(|e| format!("create whispercpp model dir failed: {e}"))?;

  let model_path = model_dir.join(MODEL_FILE);
  if model_path.is_file()
    && tokio::fs::metadata(&model_path)
      .await
      .map(|m| m.len() > 300 * 1024 * 1024)
      .unwrap_or(false)
  {
    return Ok(model_path);
  }

  let job_id_s = job_id.to_string();
  let media_id_s = media_id.to_string();
  http_download_to_file_with_progress(URL, &model_path, move |done, total| {
    let p = match total {
      Some(t) if t > 0 => {
        let frac = (done as f32 / t as f32).clamp(0.0, 1.0);
        0.18 + frac * 0.08
      }
      _ => 0.18,
    };
    let msg = match total {
      Some(t) => format!("downloading Whisper model {} / {}", human_bytes(done), human_bytes(t)),
      None => format!("downloading Whisper model ({})", human_bytes(done)),
    };
    let _ = emit_job(app, JobProgressEvent {
      job_id: job_id_s.clone(),
      media_id: media_id_s.clone(),
      job_type: JobType::Transcribe,
      status: JobStatus::Running,
      progress: p,
      message: Some(msg),
    });
  })
  .await?;

  Ok(model_path)
}

fn parse_whisper_cpp_json(v: &serde_json::Value) -> (Option<String>, Vec<(i64, i64, String)>) {
  let lang = v
    .get("result")
    .and_then(|r| r.get("language"))
    .and_then(|x| x.as_str())
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty());

  let mut segs: Vec<(i64, i64, String)> = Vec::new();
  let items = v.get("transcription").and_then(|t| t.as_array()).cloned().unwrap_or_default();
  for item in items {
    let text = item.get("text").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
    if text.is_empty() {
      continue;
    }
    let from_ms = item
      .get("offsets")
      .and_then(|o| o.get("from"))
      .and_then(|x| x.as_i64())
      .unwrap_or(0);
    let to_ms = item
      .get("offsets")
      .and_then(|o| o.get("to"))
      .and_then(|x| x.as_i64())
      .unwrap_or(from_ms);
    segs.push((from_ms.max(0), to_ms.max(from_ms), text));
  }

  (lang, segs)
}

fn sanitize_json_unicode_surrogates(input: &[u8]) -> Vec<u8> {
  fn hex_nibble(b: u8) -> Option<u8> {
    match b {
      b'0'..=b'9' => Some(b - b'0'),
      b'a'..=b'f' => Some(b - b'a' + 10),
      b'A'..=b'F' => Some(b - b'A' + 10),
      _ => None,
    }
  }

  fn parse_u4(slice: &[u8]) -> Option<u16> {
    if slice.len() < 4 {
      return None;
    }
    let mut v: u16 = 0;
    for &b in &slice[..4] {
      let n = hex_nibble(b)? as u16;
      v = (v << 4) | n;
    }
    Some(v)
  }

  fn push_replacement(out: &mut Vec<u8>) {
    // U+FFFD in UTF-8
    out.extend_from_slice(&[0xEF, 0xBF, 0xBD]);
  }

  let mut out: Vec<u8> = Vec::with_capacity(input.len());
  let mut i: usize = 0;
  let mut in_str = false;

  while i < input.len() {
    let b = input[i];

    if !in_str {
      out.push(b);
      if b == b'"' {
        in_str = true;
      }
      i += 1;
      continue;
    }

    // in string
    if b == b'"' {
      out.push(b);
      in_str = false;
      i += 1;
      continue;
    }

    if b != b'\\' {
      out.push(b);
      i += 1;
      continue;
    }

    // escape sequence
    if i + 1 >= input.len() {
      out.push(b'\\');
      break;
    }

    let next = input[i + 1];
    if next != b'u' {
      // keep as-is
      out.push(b'\\');
      out.push(next);
      i += 2;
      continue;
    }

    // unicode escape: \uXXXX
    if i + 6 > input.len() {
      // incomplete escape, keep as-is
      out.extend_from_slice(&input[i..]);
      break;
    }

    let Some(cp) = parse_u4(&input[(i + 2)..(i + 6)]) else {
      // invalid escape, keep as-is
      out.extend_from_slice(&input[i..(i + 6)]);
      i += 6;
      continue;
    };

    // Surrogate handling: serde_json rejects lone surrogates.
    if (0xD800..=0xDBFF).contains(&cp) {
      // high surrogate; try to pair with following \uYYYY
      if i + 12 <= input.len() && input[i + 6] == b'\\' && input[i + 7] == b'u' {
        if let Some(low) = parse_u4(&input[(i + 8)..(i + 12)]) {
          if (0xDC00..=0xDFFF).contains(&low) {
            let hi = (cp as u32) - 0xD800;
            let lo = (low as u32) - 0xDC00;
            let code = 0x10000 + ((hi << 10) | lo);
            if let Some(ch) = char::from_u32(code) {
              let mut buf = [0u8; 4];
              let s = ch.encode_utf8(&mut buf);
              out.extend_from_slice(s.as_bytes());
              i += 12;
              continue;
            }
          }
        }
      }

      // unpaired high surrogate
      push_replacement(&mut out);
      i += 6;
      continue;
    }

    if (0xDC00..=0xDFFF).contains(&cp) {
      // unpaired low surrogate
      push_replacement(&mut out);
      i += 6;
      continue;
    }

    // keep other escapes as-is
    out.extend_from_slice(&input[i..(i + 6)]);
    i += 6;
  }

  out
}

async fn run_whisper_cpp(
  app: &tauri::AppHandle,
  runtime: &WhisperCppRuntime,
  model_path: &Path,
  wav_path: &Path,
  language: &str,
  num_threads: u32,
  job_id: &str,
  media_id: &str,
) -> Result<(Option<String>, Vec<(i64, i64, String)>), String> {
  use tokio::io::{AsyncBufReadExt, BufReader};

  let out_base = wav_path
    .parent()
    .unwrap_or_else(|| Path::new("."))
    .join("_whispercpp");
  let json_path = out_base.with_extension("json");
  let _ = tokio::fs::remove_file(&json_path).await;

  let mut cmd = tokio::process::Command::new(&runtime.exe);
  if let Some(dir) = runtime.exe.parent() {
    cmd.current_dir(dir);
  }

  cmd
    .arg("--model")
    .arg(model_path)
    .arg("--file")
    .arg(wav_path)
    .arg("--output-json")
    .arg("--output-file")
    .arg(&out_base)
    .arg("--no-prints")
    .arg("--print-progress");

  let lang = language.trim();
  if !lang.is_empty() {
    cmd.arg("--language").arg(lang);
  }
  if num_threads > 0 {
    cmd.arg("--threads").arg(num_threads.to_string());
  }
  if runtime.provider == "cpu" {
    cmd.arg("--no-gpu");
  }

  cmd.stdout(std::process::Stdio::null());
  cmd.stderr(std::process::Stdio::piped());

  let mut child = cmd
    .spawn()
    .map_err(|e| format!("spawn whisper-cli failed: {e}"))?;

  let mut stderr_lines = {
    let stderr = child
      .stderr
      .take()
      .ok_or_else(|| "failed to capture whisper-cli stderr".to_string())?;
    BufReader::new(stderr).lines()
  };

  // Map whisper progress 0-100 -> job progress 0.28-0.72.
  let base_p: f32 = 0.28;
  let span_p: f32 = 0.44;

  let mut last_emit: Option<i32> = None;
  let mut stderr_tail: std::collections::VecDeque<String> = std::collections::VecDeque::with_capacity(120);

  while let Some(line) = stderr_lines
    .next_line()
    .await
    .map_err(|e| format!("read whisper-cli stderr failed: {e}"))?
  {
    if stderr_tail.len() >= 120 {
      stderr_tail.pop_front();
    }
    stderr_tail.push_back(line.clone());

    // Example line: "whisper_print_progress_callback: progress =  35%"
    if let Some(idx) = line.find("progress") {
      let tail = &line[idx..];
      if let Some(eq) = tail.find('=') {
        let after = tail[(eq + 1)..].trim();
        let digits = after
          .chars()
          .skip_while(|c| !c.is_ascii_digit())
          .take_while(|c| c.is_ascii_digit())
          .collect::<String>();
        if let Ok(pct) = digits.parse::<i32>() {
          let pct = pct.clamp(0, 100);
          // avoid spamming UI
          if last_emit.map(|x| x == pct).unwrap_or(false) {
            continue;
          }
          last_emit = Some(pct);

          let p = base_p + (pct as f32 / 100.0) * span_p;
          let _ = emit_job(app, JobProgressEvent {
            job_id: job_id.to_string(),
            media_id: media_id.to_string(),
            job_type: JobType::Transcribe,
            status: JobStatus::Running,
            progress: p,
            message: Some(format!(
              "recognizing (whisper.cpp, provider={}, {}%)",
              runtime.provider, pct
            )),
          });
        }
      }
    }
  }

  let status = child
    .wait()
    .await
    .map_err(|e| format!("wait whisper-cli failed: {e}"))?;

  let _ = emit_job(app, JobProgressEvent {
    job_id: job_id.to_string(),
    media_id: media_id.to_string(),
    job_type: JobType::Transcribe,
    status: JobStatus::Running,
    progress: 0.74,
    message: Some("parsing whisper.cpp result".to_string()),
  });

  if !status.success() {
    let tail = stderr_tail
      .into_iter()
      .rev()
      .take(80)
      .collect::<Vec<_>>()
      .into_iter()
      .rev()
      .collect::<Vec<_>>()
      .join("\n");
    if tail.trim().is_empty() {
      return Err("whisper-cli failed".to_string());
    }
    return Err(format!("whisper-cli failed. tail:\n{tail}"));
  }

  if !json_path.is_file() {
    return Err("whisper-cli did not produce .json output".to_string());
  }

  let bytes = tokio::fs::read(&json_path)
    .await
    .map_err(|e| format!("read whisper json failed: {e}"))?;
  let v: serde_json::Value = match serde_json::from_slice(&bytes) {
    Ok(v) => v,
    Err(e1) => {
      // whisper.cpp JSON output may contain UTF-16 surrogate escapes (e.g. emoji as \uD83D\uDE00),
      // which serde_json rejects. Sanitize and retry.
      let sanitized1 = sanitize_json_unicode_surrogates(&bytes);
      match serde_json::from_slice(&sanitized1) {
        Ok(v) => v,
        Err(e2) => {
          // Some whisper outputs can include invalid UTF-8 byte sequences in segment text.
          // Decode lossily to make the JSON valid UTF-8, then sanitize surrogates again.
          let lossy = String::from_utf8_lossy(&bytes).into_owned().into_bytes();
          let sanitized2 = sanitize_json_unicode_surrogates(&lossy);
          serde_json::from_slice(&sanitized2)
            .map_err(|e3| format!("parse whisper json failed: {e3} (original: {e1}; sanitized: {e2})"))?
        }
      }
    }
  };

  let (lang_out, segs) = parse_whisper_cpp_json(&v);
  Ok((lang_out, segs))
}

async fn ensure_sense_voice_model(
  app: &tauri::AppHandle,
  state: &Arc<AppState>,
  data_root: &Path,
  job_id: &str,
  media_id: &str,
) -> Result<(PathBuf, PathBuf), String> {
  let _guard = state.tools_lock.lock().await;

  const DIR_NAME: &str = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17";
  const URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2";

  let models_root = data_root.join("models").join("sensevoice");
  tokio::fs::create_dir_all(&models_root)
    .await
    .map_err(|e| format!("create sensevoice model dir failed: {e}"))?;

  let model_dir = models_root.join(DIR_NAME);
  let model_path = model_dir.join("model.onnx");
  let tokens_path = model_dir.join("tokens.txt");

  if model_path.is_file()
    && tokens_path.is_file()
    && tokio::fs::metadata(&model_path).await.map(|m| m.len() > 128 * 1024 * 1024).unwrap_or(false)
    && tokio::fs::metadata(&tokens_path).await.map(|m| m.len() > 64 * 1024).unwrap_or(false)
  {
    return Ok((model_path, tokens_path));
  }

  let archive_path = models_root.join("sensevoice.tar.bz2");
  let job_id_s = job_id.to_string();
  let media_id_s = media_id.to_string();

  http_download_to_file_with_progress(URL, &archive_path, move |done, total| {
    let p = match total {
      Some(t) if t > 0 => {
        let frac = (done as f32 / t as f32).clamp(0.0, 1.0);
        0.18 + frac * 0.08
      }
      _ => 0.18,
    };
    let msg = match total {
      Some(t) => format!(
        "downloading SenseVoice model {} / {}",
        human_bytes(done),
        human_bytes(t)
      ),
      None => format!("downloading SenseVoice model ({})", human_bytes(done)),
    };
    let _ = emit_job(app, JobProgressEvent {
      job_id: job_id_s.clone(),
      media_id: media_id_s.clone(),
      job_type: JobType::Transcribe,
      status: JobStatus::Running,
      progress: p,
      message: Some(msg),
    });
  })
  .await?;

  let _ = emit_job(app, JobProgressEvent {
    job_id: job_id.to_string(),
    media_id: media_id.to_string(),
    job_type: JobType::Transcribe,
    status: JobStatus::Running,
    progress: 0.26,
    message: Some("extracting SenseVoice model".to_string()),
  });

  // Remove old extracted directory to avoid mixing versions.
  let _ = tokio::fs::remove_dir_all(&model_dir).await;

  let archive_path_clone = archive_path.clone();
  let models_root_clone = models_root.clone();
  tokio::task::spawn_blocking(move || extract_tar_bz2_to_dir(&archive_path_clone, &models_root_clone))
    .await
    .map_err(|e| format!("join sensevoice extract task failed: {e}"))??;

  let _ = tokio::fs::remove_file(&archive_path).await;

  if !model_path.is_file() {
    return Err("SenseVoice model.onnx missing after extraction".to_string());
  }
  if !tokens_path.is_file() {
    return Err("SenseVoice tokens.txt missing after extraction".to_string());
  }
  Ok((model_path, tokens_path))
}

#[derive(Debug, Clone)]
struct SenseVoiceResult {
  language: String,
  text: String,
  tokens: Vec<String>,
  timestamps: Vec<f64>,
}

#[derive(Debug, Clone)]
struct AudioChunk {
  path: PathBuf,
  start_ms: i64,
  duration_ms: i64,
}

fn parse_sense_voice_results(output: &str) -> Vec<SenseVoiceResult> {
  let mut out: Vec<SenseVoiceResult> = Vec::new();

  for line in output.lines() {
    let t = line.trim();
    if !(t.starts_with('{') && t.ends_with('}')) {
      continue;
    }

    let Ok(v) = serde_json::from_str::<serde_json::Value>(t) else {
      continue;
    };

    // Heuristic: ignore unrelated JSON objects.
    let looks_like_result = v.get("text").is_some()
      || v.get("tokens").is_some()
      || v.get("timestamps").is_some()
      || v.get("lang").is_some();
    if !looks_like_result {
      continue;
    }

    let text = v.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string();
    let lang_raw = v
      .get("lang")
      .or_else(|| v.get("language"))
      .and_then(|t| t.as_str())
      .unwrap_or("");
    let language = lang_raw
      .trim()
      .trim_start_matches("<|")
      .trim_end_matches("|>")
      .trim()
      .to_string();

    let tokens = v
      .get("tokens")
      .and_then(|t| t.as_array())
      .map(|arr| {
        arr
          .iter()
          .filter_map(|x| x.as_str().map(|s| s.to_string()))
          .collect::<Vec<_>>()
      })
      .unwrap_or_default();

    let timestamps = v
      .get("timestamps")
      .and_then(|t| t.as_array())
      .map(|arr| {
        arr
          .iter()
          .filter_map(|x| {
            x.as_f64()
              .or_else(|| x.as_i64().map(|n| n as f64))
              .or_else(|| x.as_str().and_then(|s| s.trim().parse::<f64>().ok()))
          })
          .collect::<Vec<_>>()
      })
      .unwrap_or_default();

    let language = if language.is_empty() { "auto".to_string() } else { language };
    out.push(SenseVoiceResult { language, text, tokens, timestamps });
  }

  out
}

fn parse_sense_voice_results_strict(output: &str, expected: usize) -> Result<Vec<SenseVoiceResult>, String> {
  let results = parse_sense_voice_results(output);
  if results.is_empty() {
    let tail = output
      .lines()
      .rev()
      .take(80)
      .collect::<Vec<_>>()
      .into_iter()
      .rev()
      .collect::<Vec<_>>()
      .join("\n");
    return Err(format!(
      "sherpa-onnx output missing JSON result (expected {expected}). tail:\n{tail}"
    ));
  }
  Ok(results)
}

fn normalize_sense_token(tok: &str) -> Option<String> {
  let t = tok;
  let trimmed = t.trim();
  if trimmed.is_empty() {
    return None;
  }
  // Drop special control tokens (e.g. language markers).
  if trimmed.starts_with("<|") && trimmed.ends_with("|>") {
    return None;
  }
  Some(t.to_string())
}

fn tokens_with_estimated_timestamps_ms(res: &SenseVoiceResult) -> Vec<(i64, String)> {
  if res.tokens.is_empty() {
    return Vec::new();
  }

  let mut out: Vec<(i64, String)> = Vec::with_capacity(res.tokens.len());
  let mut prev_ms: i64 = 0;
  let last_ts = res.timestamps.last().copied().unwrap_or(0.0);
  let base_ms = (last_ts * 1000.0).round() as i64;

  for (i, tok) in res.tokens.iter().enumerate() {
    let Some(tok) = normalize_sense_token(tok) else {
      continue;
    };

    let ts_s = if i < res.timestamps.len() {
      res.timestamps[i]
    } else {
      // Fallback: if timestamps are shorter than tokens (happens on some outputs),
      // keep the tokens and estimate monotonic timestamps so we don't drop text.
      let extra = (i.saturating_sub(res.timestamps.len()) + 1) as i64;
      (base_ms.saturating_add(extra.saturating_mul(50)) as f64) / 1000.0
    };
    let mut ts_ms = (ts_s * 1000.0).round() as i64;
    if ts_ms < prev_ms {
      ts_ms = prev_ms;
    }
    prev_ms = ts_ms;
    out.push((ts_ms.max(0), tok));
  }
  out
}

fn segments_from_merged_tokens_with_lang(tokens: &[(i64, String)], lang_hint: Option<&str>) -> Vec<(i64, i64, String)> {
  if tokens.is_empty() {
    return Vec::new();
  }

  // English tends to suffer more from deletions at boundaries and long unpunctuated runs.
  // Split a bit more aggressively when we know it's English.
  let is_en = matches!(lang_hint.unwrap_or("").trim(), "en" | "EN");

  let punct: [&str; 10] = ["。", "！", "？", ".", "!", "?", "；", ";", "…", "……"];
  let mut out: Vec<(i64, i64, String)> = Vec::new();
  let mut cur = String::new();
  let mut start_ms: Option<i64> = None;

  for i in 0..tokens.len() {
    let (ts_ms, tok) = &tokens[i];
    if start_ms.is_none() {
      start_ms = Some(*ts_ms);
    }
    cur.push_str(tok);

    let trimmed_tok = tok.trim();
    let is_eos = punct.iter().any(|p| *p == trimmed_tok);
    let next_gap_ms = if i + 1 < tokens.len() {
      tokens[i + 1].0.saturating_sub(*ts_ms)
    } else {
      0
    };

    let cur_len = cur.chars().count();
    let gap_th = if is_en { 700 } else { 1200 };
    let max_len = if is_en { 110 } else { 140 };
    let should_split = is_eos || (next_gap_ms > gap_th && cur_len >= 16) || cur_len >= max_len;
    if should_split {
      let txt = cur.trim();
      if !txt.is_empty() {
        out.push((start_ms.unwrap_or(*ts_ms), *ts_ms, txt.to_string()));
      }
      cur.clear();
      start_ms = None;
    }
  }

  if !cur.trim().is_empty() {
    let last_ms = tokens.last().map(|t| t.0).unwrap_or(0);
    out.push((start_ms.unwrap_or(last_ms), last_ms, cur.trim().to_string()));
  }
  out
}

fn merge_sense_voice_chunks(res_list: &[SenseVoiceResult], chunks: &[AudioChunk], lang_hint: Option<&str>) -> Vec<(i64, i64, String)> {
  #[derive(Clone)]
  struct TokenRec {
    ts_ms: i64,
    token: String,
    margin_ms: i64,
  }

  // Drop tokens too close to chunk edges. Those are much more likely to suffer
  // deletion errors (missing leading/trailing phonemes, e.g. "oh my gosh" -> "my go").
  // We keep full edges for the first/last chunk so we don't lose the beginning/end.
  const EDGE_GUARD_MS: i64 = 2500;

  let total_chunks = chunks.len();
  let mut all: Vec<TokenRec> = Vec::new();
  for (idx, res) in res_list.iter().enumerate() {
    let Some(ch) = chunks.get(idx) else {
      continue;
    };

    let rel = tokens_with_estimated_timestamps_ms(res);
    let keep_left = if idx == 0 { 0 } else { EDGE_GUARD_MS };
    let keep_right = if idx + 1 >= total_chunks {
      ch.duration_ms
    } else {
      ch.duration_ms.saturating_sub(EDGE_GUARD_MS)
    };
    let use_guard = ch.duration_ms > 0 && keep_right > keep_left + 500;

    for (rel_ms, tok) in rel {
      let rel_ms = rel_ms.max(0);
      let mut rel_ms = rel_ms;
      if ch.duration_ms > 0 {
        rel_ms = rel_ms.min(ch.duration_ms);
      }

      if use_guard {
        if rel_ms < keep_left || rel_ms > keep_right {
          continue;
        }
      }

      let global_ms = ch.start_ms.saturating_add(rel_ms);
      let margin = if ch.duration_ms > 0 {
        let left = rel_ms;
        let right = ch.duration_ms.saturating_sub(rel_ms);
        left.min(right)
      } else {
        0
      };
      all.push(TokenRec { ts_ms: global_ms, token: tok, margin_ms: margin });
    }
  }

  // If token stream is unusable, fall back to per-chunk text.
  if all.is_empty() {
    let mut segs: Vec<(i64, i64, String)> = Vec::new();
    for (idx, res) in res_list.iter().enumerate() {
      let Some(ch) = chunks.get(idx) else { continue; };
      let t = res.text.trim();
      if t.is_empty() { continue; }
      segs.push((ch.start_ms, ch.start_ms.saturating_add(ch.duration_ms.max(0)), t.to_string()));
    }
    return segs;
  }

  all.sort_by(|a, b| {
    a.ts_ms
      .cmp(&b.ts_ms)
      .then_with(|| b.margin_ms.cmp(&a.margin_ms))
  });

  // Dedup near-identical tokens at nearly the same timestamp.
  const DEDUP_MS: i64 = 120;
  let mut merged: Vec<(i64, String)> = Vec::new();
  let mut last_ts: Option<i64> = None;
  let mut last_tok: Option<String> = None;

  for rec in all {
    if let (Some(lt), Some(lk)) = (last_ts, last_tok.as_ref()) {
      if (rec.ts_ms - lt).abs() <= DEDUP_MS && rec.token == *lk {
        continue;
      }
      if (rec.ts_ms - lt).abs() <= DEDUP_MS && rec.token.trim().is_empty() && lk.trim().is_empty() {
        continue;
      }
    }
    last_ts = Some(rec.ts_ms);
    last_tok = Some(rec.token.clone());
    merged.push((rec.ts_ms, rec.token));
  }

  segments_from_merged_tokens_with_lang(&merged, lang_hint)
}

fn pick_dominant_language_from_results(res_list: &[SenseVoiceResult]) -> Option<String> {
  use std::collections::HashMap;

  let mut weights: HashMap<String, u64> = HashMap::new();
  let mut total: u64 = 0;
  for r in res_list {
    let lang = r.language.trim();
    if lang.is_empty() || lang == "auto" {
      continue;
    }
    // Weight by non-whitespace characters; helps reduce noisy micro-chunks.
    let w = r
      .text
      .chars()
      .filter(|c| !c.is_whitespace())
      .count()
      .max(1) as u64;
    *weights.entry(lang.to_string()).or_insert(0) += w;
    total = total.saturating_add(w);
  }

  if total < 80 {
    return None;
  }

  let mut best: Option<(String, u64)> = None;
  for (k, v) in weights {
    match &best {
      None => best = Some((k, v)),
      Some((_, bv)) if v > *bv => best = Some((k, v)),
      _ => {}
    }
  }
  let Some((lang, w)) = best else {
    return None;
  };

  // Sweet spot: only lock when it's clearly dominant.
  let frac = (w as f64) / (total as f64);
  if frac >= 0.80 {
    Some(lang)
  } else {
    None
  }
}

async fn run_sherpa_onnx_sense_voice(
  app: &tauri::AppHandle,
  runtime: &SherpaOnnxRuntime,
  tokens: &Path,
  model: &Path,
  wavs: &[PathBuf],
  language: &str,
  use_itn: bool,
  num_threads: u32,
  job_id: &str,
  media_id: &str,
) -> Result<Vec<SenseVoiceResult>, String> {
  fn is_cuda_dependency_missing(stderr: &str, stdout: &str) -> bool {
    let s = format!("{stderr}\n{stdout}").to_lowercase();
    // Typical Windows error when CUDA provider cannot load due to missing cuDNN.
    if s.contains("cudnn64_") && s.contains("missing") {
      return true;
    }
    if s.contains("onnxruntime_providers_cuda.dll")
      && (s.contains("missing") || s.contains("error 126") || s.contains("error loading") || s.contains("fail"))
    {
      return true;
    }
    false
  }

  let lang = match language.trim() {
    "zh" | "en" | "ja" | "ko" | "yue" | "auto" => language.trim(),
    _ => "auto",
  };

  let threads = if num_threads > 0 {
    num_threads
  } else {
    std::thread::available_parallelism()
      .map(|n| n.get() as u32)
      .unwrap_or(4)
      .clamp(1, 32)
  };

  if wavs.is_empty() {
    return Err("no input wav files".to_string());
  }

  async fn run_once(
    exe: &Path,
    provider: &str,
    threads: u32,
    tokens: &Path,
    model: &Path,
    wavs: &[PathBuf],
    lang: &str,
    use_itn: bool,
  ) -> Result<(std::process::ExitStatus, String, String), String> {
    let mut cmd = tokio::process::Command::new(exe);
    if let Some(dir) = exe.parent() {
      cmd.current_dir(dir);
    }
    cmd
      .arg("--model-type=sense_voice")
      .arg(format!("--provider={provider}"))
      .arg(format!("--num-threads={threads}"))
      .arg(format!("--tokens={}", tokens.to_string_lossy()))
      .arg(format!("--sense-voice-model={}", model.to_string_lossy()))
      .arg(format!("--sense-voice-language={lang}"))
      .arg(format!("--sense-voice-use-itn={}", if use_itn { 1 } else { 0 }))
      .arg("--debug=false")
      .args(wavs)
      .stdout(std::process::Stdio::piped())
      .stderr(std::process::Stdio::piped());

    let out = cmd
      .output()
      .await
      .map_err(|e| format!("spawn sherpa-onnx-offline failed: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    Ok((out.status, stdout, stderr))
  }

  static CUDA_PROVIDER_DISABLED: std::sync::OnceLock<std::sync::Mutex<bool>> = std::sync::OnceLock::new();
  let cuda_disabled = CUDA_PROVIDER_DISABLED.get_or_init(|| std::sync::Mutex::new(false));

  let mut provider = runtime.provider.as_str();
  if provider == "cuda" {
    let disabled = cuda_disabled.lock().unwrap_or_else(|e| e.into_inner());
    if *disabled {
      provider = "cpu";
    }
  }

  for attempt in 0..2 {
    let _ = emit_job(app, JobProgressEvent {
      job_id: job_id.to_string(),
      media_id: media_id.to_string(),
      job_type: JobType::Transcribe,
      status: JobStatus::Running,
      progress: 0.28,
      message: Some(format!("运行 SenseVoice（provider={provider}, threads={threads}，输入={}段）", wavs.len())),
    });

    let (status, stdout, stderr) = run_once(&runtime.exe, provider, threads, tokens, model, wavs, lang, use_itn).await?;

    if status.success() {
      let combined = format!("{stdout}\n{stderr}");
      let results = parse_sense_voice_results_strict(&combined, wavs.len())?;
      if results.len() != wavs.len() {
        let tail = combined
          .lines()
          .rev()
          .take(80)
          .collect::<Vec<_>>()
          .into_iter()
          .rev()
          .collect::<Vec<_>>()
          .join("\n");
        return Err(format!(
          "sherpa-onnx returned unexpected number of results: got {}, expected {}\n{tail}",
          results.len(),
          wavs.len()
        ));
      }
      return Ok(results);
    }

    // If CUDA provider is selected but cuDNN is missing, fall back to CPU provider.
    if attempt == 0 && provider == "cuda" && is_cuda_dependency_missing(&stderr, &stdout) {
      // Avoid retrying CUDA for the rest of this backend process.
      {
        let mut disabled = cuda_disabled.lock().unwrap_or_else(|e| e.into_inner());
        *disabled = true;
      }
      provider = "cpu";
      let _ = emit_job(app, JobProgressEvent {
        job_id: job_id.to_string(),
        media_id: media_id.to_string(),
        job_type: JobType::Transcribe,
        status: JobStatus::Running,
        progress: 0.28,
        message: Some("CUDA 运行时不可用（缺少 cuDNN / cudnn64_9.dll），已自动切换到 CPU".to_string()),
      });
      continue;
    }

    let mut reason = "sherpa-onnx-offline failed".to_string();
    if !stderr.trim().is_empty() {
      reason.push_str("\n");
      reason.push_str(stderr.trim());
    }
    if !stdout.trim().is_empty() {
      reason.push_str("\n");
      reason.push_str(stdout.trim());
    }
    return Err(reason);
  }

  Err("sherpa-onnx-offline failed".to_string())
}

#[derive(Clone, Debug)]
struct GithubAsset {
  name: String,
  url: String,
}

async fn github_latest_assets(owner: &str, repo: &str) -> Result<Vec<GithubAsset>, String> {
  let api = format!("https://api.github.com/repos/{owner}/{repo}/releases/latest");
  let client = reqwest::Client::new();
  let resp = client
    .get(api)
    .header("User-Agent", "vecho-studio")
    .send()
    .await
    .map_err(|e| format!("github api request failed: {e}"))?;
  if !resp.status().is_success() {
    return Err(format!("github api request failed: http {}", resp.status()));
  }

  let v: serde_json::Value = resp
    .json()
    .await
    .map_err(|e| format!("parse github api json failed: {e}"))?;

  let assets = v
    .get("assets")
    .and_then(|a| a.as_array())
    .ok_or_else(|| "github api response missing assets".to_string())?;

  let mut out = Vec::new();
  for a in assets {
    let name = a.get("name").and_then(|s| s.as_str());
    let url = a.get("browser_download_url").and_then(|s| s.as_str());
    if let (Some(name), Some(url)) = (name, url) {
      out.push(GithubAsset { name: name.to_string(), url: url.to_string() });
    }
  }
  Ok(out)
}

fn pick_ffmpeg_asset(assets: &[GithubAsset]) -> Option<GithubAsset> {
  let os = if cfg!(windows) {
    "windows"
  } else if cfg!(target_os = "macos") {
    "macos"
  } else {
    "linux"
  };
  let arch = std::env::consts::ARCH;
  let prefer_ext = if cfg!(windows) { ".zip" } else { ".tar.xz" };

  let mut best: Option<(i32, GithubAsset)> = None;
  for a in assets {
    let name_lc = a.name.to_lowercase();

    // Must be some ffmpeg build archive.
    if !name_lc.contains("ffmpeg") {
      continue;
    }
    if !(name_lc.ends_with(".zip") || name_lc.ends_with(".tar.xz") || name_lc.ends_with(".tar.gz")) {
      continue;
    }

    let mut score = 0i32;

    // OS match.
    match os {
      "windows" => {
        if name_lc.contains("win") { score += 50; }
        if name_lc.contains("win64") || name_lc.contains("windows64") { score += 20; }
      }
      "macos" => {
        if name_lc.contains("mac") { score += 50; }
        if name_lc.contains("macos") { score += 20; }
      }
      "linux" => {
        if name_lc.contains("linux") { score += 50; }
      }
      _ => {}
    }

    // Arch match.
    match arch {
      "x86_64" => {
        if name_lc.contains("x86_64") || name_lc.contains("amd64") || name_lc.contains("64") {
          score += 15;
        }
        if name_lc.contains("arm") { score -= 20; }
      }
      "aarch64" => {
        if name_lc.contains("aarch64") || name_lc.contains("arm64") {
          score += 25;
        }
      }
      _ => {}
    }

    // Prefer archive type.
    if name_lc.ends_with(prefer_ext) { score += 10; }
    if cfg!(windows) && name_lc.ends_with(".zip") { score += 5; }
    if !cfg!(windows) && name_lc.ends_with(".tar.xz") { score += 5; }

    // Prefer LGPL if present.
    if name_lc.contains("lgpl") { score += 6; }
    if name_lc.contains("gpl") { score += 4; }

    // Avoid shared builds.
    if name_lc.contains("shared") { score -= 50; }

    match &best {
      None => best = Some((score, a.clone())),
      Some((best_score, _)) if score > *best_score => best = Some((score, a.clone())),
      _ => {}
    }
  }

  best.map(|(_, a)| a)
}

fn extract_ffmpeg_from_zip(archive_path: &Path, bin_dir: &Path) -> Result<(PathBuf, PathBuf), String> {
  use std::io::Read;

  let f = std::fs::File::open(archive_path)
    .map_err(|e| format!("open zip failed: {e}"))?;
  let mut zip = zip::ZipArchive::new(f)
    .map_err(|e| format!("parse zip failed: {e}"))?;

  let ffmpeg_name = sidecar_basename("ffmpeg");
  let ffprobe_name = sidecar_basename("ffprobe");
  let ffmpeg_out = bin_dir.join(&ffmpeg_name);
  let ffprobe_out = bin_dir.join(&ffprobe_name);

  let mut found_ffmpeg = false;
  let mut found_ffprobe = false;

  for i in 0..zip.len() {
    let mut file = zip.by_index(i)
      .map_err(|e| format!("read zip entry failed: {e}"))?;
    if file.is_dir() {
      continue;
    }
    let name = file.name().replace('\\', "/");
    let lower = name.to_lowercase();

    if lower.ends_with(&format!("/{ffmpeg_name}")) || lower == ffmpeg_name.to_lowercase() {
      let mut buf = Vec::new();
      file.read_to_end(&mut buf)
        .map_err(|e| format!("read ffmpeg from zip failed: {e}"))?;
      std::fs::write(&ffmpeg_out, buf)
        .map_err(|e| format!("write ffmpeg failed: {e}"))?;
      found_ffmpeg = true;
    }
    if lower.ends_with(&format!("/{ffprobe_name}")) || lower == ffprobe_name.to_lowercase() {
      let mut buf = Vec::new();
      file.read_to_end(&mut buf)
        .map_err(|e| format!("read ffprobe from zip failed: {e}"))?;
      std::fs::write(&ffprobe_out, buf)
        .map_err(|e| format!("write ffprobe failed: {e}"))?;
      found_ffprobe = true;
    }

    if found_ffmpeg && found_ffprobe {
      break;
    }
  }

  if !found_ffmpeg || !found_ffprobe {
    return Err("ffmpeg/ffprobe not found in archive".to_string());
  }

  Ok((ffmpeg_out, ffprobe_out))
}

fn extract_ffmpeg_from_tar_xz(archive_path: &Path, bin_dir: &Path) -> Result<(PathBuf, PathBuf), String> {
  use std::io::Read;

  let ffmpeg_name = sidecar_basename("ffmpeg");
  let ffprobe_name = sidecar_basename("ffprobe");
  let ffmpeg_out = bin_dir.join(&ffmpeg_name);
  let ffprobe_out = bin_dir.join(&ffprobe_name);

  let f = std::fs::File::open(archive_path)
    .map_err(|e| format!("open tar.xz failed: {e}"))?;
  let dec = xz2::read::XzDecoder::new(f);
  let mut ar = tar::Archive::new(dec);

  let mut found_ffmpeg = false;
  let mut found_ffprobe = false;

  for entry in ar.entries().map_err(|e| format!("read tar entries failed: {e}"))? {
    let mut entry = entry.map_err(|e| format!("read tar entry failed: {e}"))?;
    let path = entry.path().map_err(|e| format!("read tar path failed: {e}"))?;
    let name = path.to_string_lossy().replace('\\', "/");
    let lower = name.to_lowercase();

    if lower.ends_with(&format!("/{ffmpeg_name}")) || lower == ffmpeg_name.to_lowercase() {
      let mut buf = Vec::new();
      entry.read_to_end(&mut buf)
        .map_err(|e| format!("read ffmpeg from tar failed: {e}"))?;
      std::fs::write(&ffmpeg_out, buf)
        .map_err(|e| format!("write ffmpeg failed: {e}"))?;
      found_ffmpeg = true;
    }
    if lower.ends_with(&format!("/{ffprobe_name}")) || lower == ffprobe_name.to_lowercase() {
      let mut buf = Vec::new();
      entry.read_to_end(&mut buf)
        .map_err(|e| format!("read ffprobe from tar failed: {e}"))?;
      std::fs::write(&ffprobe_out, buf)
        .map_err(|e| format!("write ffprobe failed: {e}"))?;
      found_ffprobe = true;
    }

    if found_ffmpeg && found_ffprobe {
      break;
    }
  }

  if !found_ffmpeg || !found_ffprobe {
    return Err("ffmpeg/ffprobe not found in archive".to_string());
  }

  Ok((ffmpeg_out, ffprobe_out))
}

fn extract_ffmpeg_from_tar_gz(archive_path: &Path, bin_dir: &Path) -> Result<(PathBuf, PathBuf), String> {
  use std::io::Read;

  let ffmpeg_name = sidecar_basename("ffmpeg");
  let ffprobe_name = sidecar_basename("ffprobe");
  let ffmpeg_out = bin_dir.join(&ffmpeg_name);
  let ffprobe_out = bin_dir.join(&ffprobe_name);

  let f = std::fs::File::open(archive_path)
    .map_err(|e| format!("open tar.gz failed: {e}"))?;
  let dec = flate2::read::GzDecoder::new(f);
  let mut ar = tar::Archive::new(dec);

  let mut found_ffmpeg = false;
  let mut found_ffprobe = false;

  for entry in ar.entries().map_err(|e| format!("read tar entries failed: {e}"))? {
    let mut entry = entry.map_err(|e| format!("read tar entry failed: {e}"))?;
    let path = entry.path().map_err(|e| format!("read tar path failed: {e}"))?;
    let name = path.to_string_lossy().replace('\\', "/");
    let lower = name.to_lowercase();

    if lower.ends_with(&format!("/{ffmpeg_name}")) || lower == ffmpeg_name.to_lowercase() {
      let mut buf = Vec::new();
      entry.read_to_end(&mut buf)
        .map_err(|e| format!("read ffmpeg from tar failed: {e}"))?;
      std::fs::write(&ffmpeg_out, buf)
        .map_err(|e| format!("write ffmpeg failed: {e}"))?;
      found_ffmpeg = true;
    }
    if lower.ends_with(&format!("/{ffprobe_name}")) || lower == ffprobe_name.to_lowercase() {
      let mut buf = Vec::new();
      entry.read_to_end(&mut buf)
        .map_err(|e| format!("read ffprobe from tar failed: {e}"))?;
      std::fs::write(&ffprobe_out, buf)
        .map_err(|e| format!("write ffprobe failed: {e}"))?;
      found_ffprobe = true;
    }

    if found_ffmpeg && found_ffprobe {
      break;
    }
  }

  if !found_ffmpeg || !found_ffprobe {
    return Err("ffmpeg/ffprobe not found in archive".to_string());
  }

  Ok((ffmpeg_out, ffprobe_out))
}

fn extract_zip_to_dir(archive_path: &Path, dest_dir: &Path) -> Result<(), String> {
  use std::fs::File;
  use std::io::{copy, Write};

  std::fs::create_dir_all(dest_dir)
    .map_err(|e| format!("create dest dir failed: {e}"))?;

  let f = File::open(archive_path)
    .map_err(|e| format!("open zip failed: {e}"))?;
  let mut zip = zip::ZipArchive::new(f)
    .map_err(|e| format!("parse zip failed: {e}"))?;

  for i in 0..zip.len() {
    let mut file = zip
      .by_index(i)
      .map_err(|e| format!("read zip entry failed: {e}"))?;
    let name = file.name().replace('\\', "/");
    if name.is_empty() || name.starts_with('/') {
      continue;
    }
    let parts: Vec<&str> = name.split('/').filter(|p| !p.is_empty()).collect();
    if parts.iter().any(|p| *p == "..") {
      continue;
    }

    let mut out_path = dest_dir.to_path_buf();
    for p in parts {
      out_path.push(p);
    }

    if file.is_dir() {
      std::fs::create_dir_all(&out_path)
        .map_err(|e| format!("create zip dir failed: {e}"))?;
      continue;
    }

    if let Some(parent) = out_path.parent() {
      std::fs::create_dir_all(parent)
        .map_err(|e| format!("create zip parent dir failed: {e}"))?;
    }

    let mut out = File::create(&out_path)
      .map_err(|e| format!("create zip file failed: {e}"))?;
    copy(&mut file, &mut out)
      .map_err(|e| format!("extract zip file failed: {e}"))?;
    out.flush().ok();
  }

  Ok(())
}

fn extract_tar_bz2_to_dir(archive_path: &Path, dest_dir: &Path) -> Result<(), String> {
  use std::fs::File;

  let f = File::open(archive_path)
    .map_err(|e| format!("open tar.bz2 failed: {e}"))?;
  let dec = bzip2::read::BzDecoder::new(f);
  let mut ar = tar::Archive::new(dec);

  std::fs::create_dir_all(dest_dir)
    .map_err(|e| format!("create dest dir failed: {e}"))?;

  for entry in ar.entries().map_err(|e| format!("read tar entries failed: {e}"))? {
    let mut entry = entry.map_err(|e| format!("read tar entry failed: {e}"))?;
    let path = entry.path().map_err(|e| format!("read tar path failed: {e}"))?;
    let raw = path.to_string_lossy().replace('\\', "/");
    if raw.is_empty() || raw.starts_with('/') {
      continue;
    }
    let parts: Vec<&str> = raw.split('/').filter(|p| !p.is_empty()).collect();
    if parts.iter().any(|p| *p == "..") {
      continue;
    }

    let mut out_path = dest_dir.to_path_buf();
    for p in parts {
      out_path.push(p);
    }

    // Skip links for safety.
    let ty = entry.header().entry_type();
    if ty.is_symlink() || ty.is_hard_link() {
      continue;
    }

    if let Some(parent) = out_path.parent() {
      std::fs::create_dir_all(parent)
        .map_err(|e| format!("create tar parent dir failed: {e}"))?;
    }

    entry
      .unpack(&out_path)
      .map_err(|e| format!("unpack tar entry failed: {e}"))?;
  }

  Ok(())
}

fn find_file_recursive(dir: &Path, file_name: &str) -> Option<PathBuf> {
  let rd = std::fs::read_dir(dir).ok()?;
  for entry in rd.flatten() {
    let p = entry.path();
    if p.is_dir() {
      if let Some(found) = find_file_recursive(&p, file_name) {
        return Some(found);
      }
      continue;
    }
    if p.file_name().and_then(|s| s.to_str()) == Some(file_name) {
      return Some(p);
    }
  }
  None
}

async fn ensure_ffmpeg_bundle(app: &tauri::AppHandle, state: &Arc<AppState>, data_root: &Path) -> Result<(PathBuf, PathBuf), String> {
  ensure_ffmpeg_bundle_with_job(app, state, data_root, None).await
}

async fn ensure_ffmpeg_bundle_with_job(
  app: &tauri::AppHandle,
  state: &Arc<AppState>,
  data_root: &Path,
  job: Option<(&str, &str, JobType, f32, f32)>,
) -> Result<(PathBuf, PathBuf), String> {
  let _guard = state.tools_lock.lock().await;

  let bin_dir = tools_bin_dir(data_root);
  tokio::fs::create_dir_all(&bin_dir)
    .await
    .map_err(|e| format!("create bin dir failed: {e}"))?;

  let ffmpeg_path = bin_dir.join(sidecar_basename("ffmpeg"));
  let ffprobe_path = bin_dir.join(sidecar_basename("ffprobe"));
  if ffmpeg_path.is_file() && ffprobe_path.is_file() && !is_probably_stub_binary(&ffmpeg_path) && !is_probably_stub_binary(&ffprobe_path) {
    return Ok((ffmpeg_path, ffprobe_path));
  }

  // Prefer bundled sidecars when available (no first-run download).
  if let (Ok(ffmpeg), Ok(ffprobe)) = (resolve_sidecar(app, "ffmpeg"), resolve_sidecar(app, "ffprobe")) {
    if ffmpeg.is_file() && ffprobe.is_file() && !is_probably_stub_binary(&ffmpeg) && !is_probably_stub_binary(&ffprobe) {
      return Ok((ffmpeg, ffprobe));
    }
  }

  // Fetch latest ffmpeg build archive from yt-dlp maintained builds.
  // Prefer GitHub API (more robust selection), but fall back to direct known filenames
  // in case the API is blocked.
  let asset: GithubAsset = match github_latest_assets("yt-dlp", "FFmpeg-Builds").await {
    Ok(assets) => pick_ffmpeg_asset(&assets)
      .ok_or_else(|| "no suitable ffmpeg build asset found".to_string())?,
    Err(_) => {
      let base = "https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/";
      let candidates: Vec<&str> = if cfg!(windows) {
        vec![
          "ffmpeg-master-latest-win64-lgpl.zip",
          "ffmpeg-master-latest-win64-gpl.zip",
          "ffmpeg-master-latest-win64.zip",
        ]
      } else if cfg!(target_os = "macos") {
        match std::env::consts::ARCH {
          "aarch64" => vec![
            "ffmpeg-master-latest-macosarm64-lgpl.zip",
            "ffmpeg-master-latest-macosarm64-gpl.zip",
            "ffmpeg-master-latest-macos64-lgpl.zip",
            "ffmpeg-master-latest-macos64-gpl.zip",
            "ffmpeg-master-latest-macos64.tar.xz",
          ],
          _ => vec![
            "ffmpeg-master-latest-macos64-lgpl.zip",
            "ffmpeg-master-latest-macos64-gpl.zip",
            "ffmpeg-master-latest-macos64.tar.xz",
          ],
        }
      } else {
        match std::env::consts::ARCH {
          "aarch64" => vec![
            "ffmpeg-master-latest-linuxarm64-lgpl.tar.xz",
            "ffmpeg-master-latest-linuxarm64-gpl.tar.xz",
            "ffmpeg-master-latest-linuxarm64.tar.xz",
          ],
          _ => vec![
            "ffmpeg-master-latest-linux64-lgpl.tar.xz",
            "ffmpeg-master-latest-linux64-gpl.tar.xz",
            "ffmpeg-master-latest-linux64.tar.xz",
          ],
        }
      };

      let mut picked: Option<GithubAsset> = None;
      let client = reqwest::Client::new();
      for name in candidates {
        let url = format!("{base}{name}");
        let ok = client
          .head(&url)
          .header("User-Agent", "vecho-studio")
          .send()
          .await
          .map(|r| r.status().is_success())
          .unwrap_or(false);
        if ok {
          picked = Some(GithubAsset { name: name.to_string(), url });
          break;
        }
      }

      picked.ok_or_else(|| "failed to locate ffmpeg build asset".to_string())?
    }
  };

  let archive_path = bin_dir.join(format!(".ffmpeg-{}.download", nanoid()));

  if let Some((job_id, media_id, job_type, base, span)) = job {
    // Download progress updates.
    let mut last_emit = std::time::Instant::now() - std::time::Duration::from_secs(10);
    let mut last_pct: i32 = -1;

    let job_id_s = job_id.to_string();
    let media_id_s = media_id.to_string();
    let job_type_cb = job_type.clone();
    let job_type_after = job_type.clone();
    http_download_to_file_with_progress(&asset.url, &archive_path, move |done, total| {
      let now = std::time::Instant::now();
      let min_interval = std::time::Duration::from_secs(2);

      let pct = total
        .and_then(|t| {
          if t == 0 { None } else { Some(((done as f64 / t as f64) * 100.0).floor() as i32) }
        })
        .unwrap_or(-1);
      if pct == last_pct && now.duration_since(last_emit) < min_interval {
        return;
      }
      last_emit = now;
      last_pct = pct;

      let p = match total {
        Some(t) if t > 0 => {
          let frac = (done as f32 / t as f32).clamp(0.0, 1.0);
          (base + frac * span).clamp(0.0, 1.0)
        }
        _ => base.clamp(0.0, 1.0),
      };
      let msg = match total {
        Some(t) => format!(
          "downloading ffmpeg {}% ({} / {})",
          pct.max(0),
          human_bytes(done),
          human_bytes(t)
        ),
        None => format!("downloading ffmpeg ({})", human_bytes(done)),
      };
      let _ = emit_job(app, JobProgressEvent {
        job_id: job_id_s.clone(),
        media_id: media_id_s.clone(),
        job_type: job_type_cb.clone(),
        status: JobStatus::Running,
        progress: p,
        message: Some(msg),
      });
    })
    .await?;

    let _ = emit_job(app, JobProgressEvent {
      job_id: job_id.to_string(),
      media_id: media_id.to_string(),
      job_type: job_type_after,
      status: JobStatus::Running,
      progress: (base + span).clamp(0.0, 1.0),
      message: Some("extracting ffmpeg".to_string()),
    });
  } else {
    http_download_to_file(&asset.url, &archive_path).await?;
  }

  let bin_dir_clone = bin_dir.clone();
  let archive_path_clone = archive_path.clone();
  let extracted = tokio::task::spawn_blocking(move || {
    if asset.name.to_lowercase().ends_with(".zip") {
      extract_ffmpeg_from_zip(&archive_path_clone, &bin_dir_clone)
    } else if asset.name.to_lowercase().ends_with(".tar.xz") {
      extract_ffmpeg_from_tar_xz(&archive_path_clone, &bin_dir_clone)
    } else if asset.name.to_lowercase().ends_with(".tar.gz") {
      extract_ffmpeg_from_tar_gz(&archive_path_clone, &bin_dir_clone)
    } else {
      Err("unsupported ffmpeg archive format".to_string())
    }
  })
  .await
  .map_err(|e| format!("join ffmpeg extract task failed: {e}"))??;

  let _ = tokio::fs::remove_file(&archive_path).await;

  set_executable(&extracted.0)?;
  set_executable(&extracted.1)?;

  std::env::set_var(SIDECAR_ENV_DIR, &bin_dir);
  Ok(extracted)
}

#[derive(Debug, serde::Deserialize)]
struct FfprobeOutput {
  #[serde(default)]
  streams: Vec<FfprobeStream>,
  format: Option<FfprobeFormat>,
}

#[derive(Debug, serde::Deserialize)]
struct FfprobeFormat {
  duration: Option<String>,
  bit_rate: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct FfprobeStream {
  codec_type: Option<String>,
  codec_name: Option<String>,
  width: Option<u32>,
  height: Option<u32>,
  r_frame_rate: Option<String>,
  avg_frame_rate: Option<String>,
  sample_rate: Option<String>,
  channels: Option<u32>,
  bit_rate: Option<String>,
}

fn parse_f64(s: &str) -> Option<f64> {
  s.trim().parse::<f64>().ok()
}

fn parse_u32(s: &str) -> Option<u32> {
  s.trim().parse::<u32>().ok()
}

fn parse_rate(rate: &str) -> Option<f32> {
  let r = rate.trim();
  if r.is_empty() {
    return None;
  }
  if let Some((a, b)) = r.split_once('/') {
    let n = a.trim().parse::<f32>().ok()?;
    let d = b.trim().parse::<f32>().ok()?;
    if d == 0.0 {
      return None;
    }
    return Some(n / d);
  }
  r.parse::<f32>().ok()
}

async fn ffprobe_analyze(app: &tauri::AppHandle, media_path: &Path) -> Result<(Option<f64>, Option<serde_json::Value>, bool), String> {
  let ffprobe = resolve_sidecar(app, "ffprobe")?;

  let out = tokio::process::Command::new(ffprobe)
    .arg("-v")
    .arg("error")
    .arg("-print_format")
    .arg("json")
    .arg("-show_format")
    .arg("-show_streams")
    .arg(media_path)
    .output()
    .await
    .map_err(|e| format!("spawn ffprobe failed: {e}"))?;

  if !out.status.success() {
    let stderr = String::from_utf8_lossy(&out.stderr);
    return Err(format!("ffprobe failed: {stderr}"));
  }

  let parsed: FfprobeOutput = serde_json::from_slice(&out.stdout)
    .map_err(|e| format!("parse ffprobe json failed: {e}"))?;

  let duration = parsed
    .format
    .as_ref()
    .and_then(|f| f.duration.as_deref())
    .and_then(parse_f64);

  let video = parsed
    .streams
    .iter()
    .find(|s| s.codec_type.as_deref() == Some("video"));
  let audio = parsed
    .streams
    .iter()
    .find(|s| s.codec_type.as_deref() == Some("audio"));

  if let Some(v) = video {
    let fr = v
      .avg_frame_rate
      .as_deref()
      .and_then(parse_rate)
      .or_else(|| v.r_frame_rate.as_deref().and_then(parse_rate))
      .unwrap_or(0.0);

    let codec = v.codec_name.clone().unwrap_or_else(|| "unknown".to_string());

    let meta = serde_json::json!({
      "kind": "video",
      "width": v.width.unwrap_or(0),
      "height": v.height.unwrap_or(0),
      "framerate": fr,
      "codec": codec,
      "bitrate": v.bit_rate.as_deref().and_then(parse_u32)
    });

    return Ok((duration, Some(meta), true));
  }

  if let Some(a) = audio {
    let codec = a.codec_name.clone().unwrap_or_else(|| "unknown".to_string());
    let meta = serde_json::json!({
      "kind": "audio",
      "sampleRate": a.sample_rate.as_deref().and_then(parse_u32).unwrap_or(0),
      "channels": a.channels.unwrap_or(0),
      "codec": codec,
      "bitrate": a.bit_rate.as_deref().and_then(parse_u32)
    });
    return Ok((duration, Some(meta), false));
  }

  Ok((duration, None, false))
}

async fn ffmpeg_thumbnail_data_url(
  app: &tauri::AppHandle,
  media_path: &Path,
  seek_sec: Option<f64>,
) -> Result<String, String> {
  let ffmpeg = resolve_sidecar(app, "ffmpeg")?;
  let parent = media_path
    .parent()
    .ok_or_else(|| "invalid media path".to_string())?;
  let out_path = parent.join("thumb.jpg");

  let seek = seek_sec.unwrap_or(1.0);
  let seek = if seek.is_finite() { seek.max(0.0).min(30.0) } else { 1.0 };
  let seek_arg = format!("{seek:.2}");

  // Try to capture a representative frame (not too early).
  let status = tokio::process::Command::new(ffmpeg)
    .arg("-y")
    .arg("-hide_banner")
    .arg("-loglevel")
    .arg("error")
    .arg("-ss")
    .arg(seek_arg)
    .arg("-i")
    .arg(media_path)
    .arg("-frames:v")
    .arg("1")
    .arg("-vf")
    .arg("scale=640:-1")
    .arg(&out_path)
    .status()
    .await
    .map_err(|e| format!("spawn ffmpeg failed: {e}"))?;

  if !status.success() {
    return Err("ffmpeg thumbnail generation failed".to_string());
  }

  let bytes = tokio::fs::read(&out_path)
    .await
    .map_err(|e| format!("read thumbnail failed: {e}"))?;
  let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
  Ok(format!("data:image/jpeg;base64,{b64}"))
}

fn now_iso() -> String {
  use time::format_description::well_known::Rfc3339;
  time::OffsetDateTime::now_utc()
    .format(&Rfc3339)
    .unwrap_or_else(|_| String::new())
}

fn now_compact() -> String {
  // Windows-safe timestamp for file/folder names.
  // Example: 20260127-142233
  let fmt = time::format_description::parse("[year][month][day]-[hour][minute][second]")
    .unwrap_or_else(|_| vec![]);
  time::OffsetDateTime::now_utc()
    .format(&fmt)
    .unwrap_or_else(|_| nanoid())
}

fn sanitize_filename_component(raw: &str) -> String {
  let mut out = String::new();
  for ch in raw.trim().chars() {
    // Keep ASCII alphanumerics and a small safe set.
    if ch.is_ascii_alphanumeric() || matches!(ch, ' ' | '-' | '_' | '.') {
      out.push(ch);
      continue;
    }

    // For non-ASCII (e.g. Chinese), keep as-is (Windows supports it).
    if !ch.is_ascii() {
      out.push(ch);
      continue;
    }

    out.push('_');
  }

  let s = out.trim().to_string();
  if s.is_empty() {
    return "media".to_string();
  }

  // Avoid extremely long names.
  const MAX: usize = 60;
  if s.chars().count() <= MAX {
    return s;
  }
  s.chars().take(MAX).collect::<String>().trim().to_string()
}

fn write_json_atomic(path: &Path, value: &serde_json::Value) -> Result<(), String> {
  let bytes = serde_json::to_vec_pretty(value)
    .map_err(|e| format!("serialize json failed: {e}"))?;
  atomic_write_bytes(path, &bytes)
}

async fn ffmpeg_extract_audio_wav(ffmpeg: &Path, input: &Path, out_wav: &Path) -> Result<(), String> {
  if let Some(dir) = out_wav.parent() {
    tokio::fs::create_dir_all(dir)
      .await
      .map_err(|e| format!("create wav dir failed: {e}"))?;
  }

  // 16kHz mono PCM S16LE is a safe default for local ASR and most STT endpoints.
  let status = tokio::process::Command::new(ffmpeg)
    .arg("-y")
    .arg("-hide_banner")
    .arg("-loglevel")
    .arg("error")
    .arg("-i")
    .arg(input)
    .arg("-ar")
    .arg("16000")
    .arg("-ac")
    .arg("1")
    .arg("-c:a")
    .arg("pcm_s16le")
    .arg(out_wav)
    .status()
    .await
    .map_err(|e| format!("spawn ffmpeg failed: {e}"))?;

  if !status.success() {
    return Err("ffmpeg audio extraction failed".to_string());
  }
  Ok(())
}

async fn ffmpeg_split_wav_segments_with_overlap(
  app: &tauri::AppHandle,
  ffmpeg: &Path,
  input_wav: &Path,
  out_dir: &Path,
  chunk_seconds: u32,
  overlap_ms: i64,
) -> Result<Vec<AudioChunk>, String> {
  if chunk_seconds == 0 {
    return Err("invalid chunk_seconds".to_string());
  }
  let overlap_ms = overlap_ms.max(0);
  let chunk_ms = (chunk_seconds as i64).saturating_mul(1000);
  if chunk_ms <= 0 {
    return Err("invalid chunk size".to_string());
  }

  let step_ms = chunk_ms.saturating_sub(overlap_ms).max(1000);

  let _ = tokio::fs::remove_dir_all(out_dir).await;
  tokio::fs::create_dir_all(out_dir)
    .await
    .map_err(|e| format!("create chunks dir failed: {e}"))?;

  let (dur_opt, _, _) = ffprobe_analyze(app, input_wav).await?;
  let dur_s = dur_opt.unwrap_or(0.0);
  let dur_ms = (dur_s * 1000.0).round() as i64;
  if dur_ms <= 0 {
    // Fallback: still produce a single chunk.
    let out_path = out_dir.join("chunk-00000.wav");
    let status = tokio::process::Command::new(ffmpeg)
      .arg("-y")
      .arg("-hide_banner")
      .arg("-loglevel")
      .arg("error")
      .arg("-i")
      .arg(input_wav)
      .arg("-c")
      .arg("copy")
      .arg(&out_path)
      .status()
      .await
      .map_err(|e| format!("spawn ffmpeg failed: {e}"))?;
    if !status.success() {
      return Err("ffmpeg chunking failed".to_string());
    }
    return Ok(vec![AudioChunk { path: out_path, start_ms: 0, duration_ms: chunk_ms }]);
  }

  let mut out: Vec<AudioChunk> = Vec::new();
  let mut start_ms: i64 = 0;
  let mut idx: usize = 0;
  while start_ms < dur_ms {
    let remaining = dur_ms.saturating_sub(start_ms).max(0);
    let this_len = remaining.min(chunk_ms).max(1);

    let out_path = out_dir.join(format!("chunk-{idx:05}.wav"));
    let ss = format!("{:.3}", (start_ms as f64) / 1000.0);
    let tt = format!("{:.3}", (this_len as f64) / 1000.0);

    let status = tokio::process::Command::new(ffmpeg)
      .arg("-y")
      .arg("-hide_banner")
      .arg("-loglevel")
      .arg("error")
      .arg("-i")
      .arg(input_wav)
      .arg("-ss")
      .arg(ss)
      .arg("-t")
      .arg(tt)
      .arg("-c")
      .arg("copy")
      .arg(&out_path)
      .status()
      .await
      .map_err(|e| format!("spawn ffmpeg failed: {e}"))?;

    if !status.success() {
      return Err("ffmpeg chunking failed".to_string());
    }

    out.push(AudioChunk { path: out_path, start_ms, duration_ms: this_len });
    idx = idx.saturating_add(1);
    start_ms = start_ms.saturating_add(step_ms);
  }

  if out.is_empty() {
    return Err("ffmpeg chunking produced no wav files".to_string());
  }
  Ok(out)
}

fn build_transcription(
  media_id: &str,
  language: Option<&str>,
  model: &str,
  segments_ms: Vec<(i64, i64, String)>,
) -> serde_json::Value {
  let mut segs = Vec::new();
  let mut word_count = 0usize;
  let mut char_count = 0usize;

  for (idx, (from_ms, to_ms, text)) in segments_ms.into_iter().enumerate() {
    word_count += text.split_whitespace().count();
    char_count += text.chars().filter(|c| !c.is_whitespace()).count();

    segs.push(serde_json::json!({
      "id": format!("seg-{}", idx + 1),
      "start": (from_ms as f64) / 1000.0,
      "end": (to_ms as f64) / 1000.0,
      "text": text,
    }));
  }

  let wc = if word_count > 0 { word_count } else { char_count };
  serde_json::json!({
    "id": format!("trans-{}", nanoid()),
    "mediaId": media_id,
    "language": language.unwrap_or("auto"),
    "segments": segs,
    "wordCount": wc as u64,
    "generatedAt": now_iso(),
    "model": model,
  })
}

fn normalize_base_url(url: &str) -> String {
  url.trim().trim_end_matches('/').to_string()
}

async fn openai_transcribe(
  media_id: &str,
  wav_path: &Path,
  language: &str,
  cfg: &OpenAiTranscriptionConfig,
) -> Result<serde_json::Value, String> {
  let base = normalize_base_url(&cfg.base_url);
  if base.is_empty() {
    return Err("openai baseUrl is empty".to_string());
  }
  let url = format!("{base}/audio/transcriptions");

  let bytes = tokio::fs::read(wav_path)
    .await
    .map_err(|e| format!("read wav failed: {e}"))?;

  let part = reqwest::multipart::Part::bytes(bytes)
    .file_name("audio.wav")
    .mime_str("audio/wav")
    .map_err(|e| format!("invalid wav mime: {e}"))?;

  let mut form = reqwest::multipart::Form::new()
    .part("file", part)
    .text("model", cfg.model.clone())
    .text("response_format", "verbose_json");

  let lang = language.trim();
  if !lang.is_empty() && lang != "auto" {
    form = form.text("language", lang.to_string());
  }

  // Many OpenAI-compatible providers accept this extension.
  form = form.text("timestamp_granularities[]", "segment");

  let client = reqwest::Client::new();
  let mut req = client.post(url).multipart(form);
  let key = cfg.api_key.trim();
  if !key.is_empty() {
    req = req.bearer_auth(key);
  }

  let resp = req
    .send()
    .await
    .map_err(|e| format!("openai transcribe request failed: {e}"))?;
  let status = resp.status();
  let body = resp
    .text()
    .await
    .map_err(|e| format!("read openai transcribe response failed: {e}"))?;

  if !status.is_success() {
    return Err(format!("openai transcribe failed: http {status}\n{body}"));
  }

  let v = serde_json::from_str::<serde_json::Value>(&body)
    .map_err(|e| format!("parse openai transcribe json failed: {e}"))?;

  let lang = v
    .get("language")
    .and_then(|s| s.as_str())
    .map(|s| s.to_string());

  let mut segs = Vec::new();
  if let Some(arr) = v.get("segments").and_then(|s| s.as_array()) {
    for seg in arr {
      let start = seg.get("start").and_then(|n| n.as_f64()).unwrap_or(0.0);
      let end = seg.get("end").and_then(|n| n.as_f64()).unwrap_or(start);
      let text = seg.get("text").and_then(|t| t.as_str()).unwrap_or("").trim().to_string();
      if text.is_empty() {
        continue;
      }
      segs.push(((start * 1000.0) as i64, (end * 1000.0) as i64, text));
    }
  } else if let Some(text) = v.get("text").and_then(|t| t.as_str()) {
    let t = text.trim().to_string();
    if !t.is_empty() {
      segs.push((0, 0, t));
    }
  }

  if segs.is_empty() {
    return Err("openai transcription returned no text".to_string());
  }

  let model_label = format!("openai:{}", cfg.model);
  Ok(build_transcription(media_id, lang.as_deref(), &model_label, segs))
}

fn seconds_to_timestamp(sec: f64) -> String {
  let s = if sec.is_finite() && sec > 0.0 { sec } else { 0.0 };
  let total = s.floor() as i64;
  let h = total / 3600;
  let m = (total % 3600) / 60;
  let ss = total % 60;
  if h > 0 {
    format!("{h:02}:{m:02}:{ss:02}")
  } else {
    format!("{m:02}:{ss:02}")
  }
}

fn build_transcript_text(transcription: &serde_json::Value, max_chars: usize) -> String {
  let segs = transcription.get("segments").and_then(|s| s.as_array()).cloned().unwrap_or_default();
  let mut out = String::new();

  for seg in segs {
    let start = seg.get("start").and_then(|n| n.as_f64()).unwrap_or(0.0);
    let text = seg.get("text").and_then(|t| t.as_str()).unwrap_or("").trim();
    if text.is_empty() {
      continue;
    }
    let line = format!("[{}] {}\n", seconds_to_timestamp(start), text);
    if out.len() + line.len() > max_chars {
      break;
    }
    out.push_str(&line);
  }

  out
}

fn split_text_chunks(text: &str, max_chars: usize) -> Vec<String> {
  if max_chars == 0 {
    return vec![text.to_string()];
  }
  if text.len() <= max_chars {
    return vec![text.to_string()];
  }

  let mut out: Vec<String> = Vec::new();
  let mut cur = String::new();
  for line in text.lines() {
    let next = if line.is_empty() { "\n".to_string() } else { format!("{line}\n") };
    if !cur.is_empty() && cur.len() + next.len() > max_chars {
      out.push(cur);
      cur = String::new();
    }
    cur.push_str(&next);
  }
  if !cur.is_empty() {
    out.push(cur);
  }
  out
}

fn extract_openai_chat_delta_parts(v: &serde_json::Value) -> (Option<String>, Option<String>) {
  let Some(choice0) = v.get("choices").and_then(|x| x.as_array()).and_then(|a| a.first()) else {
    return (None, None);
  };

  // Streaming: choices[0].delta.{content,reasoning_content,text}
  if let Some(delta) = choice0.get("delta") {
    // Prefer normal content for user-visible output.
    if let Some(s) = delta.get("content").and_then(|x| x.as_str()) {
      if !s.is_empty() {
        return (Some(s.to_string()), None);
      }
    }
    if let Some(s) = delta.get("text").and_then(|x| x.as_str()) {
      if !s.is_empty() {
        return (Some(s.to_string()), None);
      }
    }

    // Some gateways stream content as an array of parts.
    if let Some(arr) = delta.get("content").and_then(|x| x.as_array()) {
      let mut out = String::new();
      for p in arr {
        if let Some(s) = p.as_str() {
          out.push_str(s);
          continue;
        }
        if let Some(s) = p.get("text").and_then(|t| t.as_str()) {
          out.push_str(s);
        }
      }
      if !out.is_empty() {
        return (Some(out), None);
      }
    }

    // Keep reasoning separate; do NOT mix it into content (breaks JSON-only flows).
    if let Some(s) = delta.get("reasoning_content").and_then(|x| x.as_str()) {
      if !s.is_empty() {
        return (None, Some(s.to_string()));
      }
    }
    return (None, None);
  }

  // Non-streaming: choices[0].message.content
  let content = choice0
    .get("message")
    .and_then(|m| m.get("content"))
    .and_then(|c| c.as_str())
    .unwrap_or("")
    .to_string();
  if content.trim().is_empty() {
    (None, None)
  } else {
    (Some(content), None)
  }
}

fn parse_openai_sse_text(text: &str) -> Result<String, String> {
  let mut content_out = String::new();
  let mut reasoning_out = String::new();
  for line in text.lines() {
    let t = line.trim();
    if t.is_empty() {
      continue;
    }
    let Some(data) = t.strip_prefix("data:") else {
      continue;
    };
    let payload = data.trim();
    if payload == "[DONE]" {
      break;
    }
    if !(payload.starts_with('{') && payload.ends_with('}')) {
      continue;
    }
    let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) else {
      continue;
    };
    let (c, r) = extract_openai_chat_delta_parts(&v);
    if let Some(s) = c {
      content_out.push_str(&s);
    }
    if let Some(s) = r {
      reasoning_out.push_str(&s);
    }
  }

  if !content_out.trim().is_empty() {
    return Ok(content_out);
  }
  if !reasoning_out.trim().is_empty() {
    // Fallback for providers that only stream reasoning_content.
    return Ok(reasoning_out);
  }
  Err("openai event-stream returned no content".to_string())
}

async fn read_openai_event_stream(resp: reqwest::Response) -> Result<String, String> {
  use tokio::time::{timeout, Duration};
  let mut stream = resp.bytes_stream();
  let mut buf = String::new();
  let mut content_out = String::new();
  let mut reasoning_out = String::new();

  loop {
    let next = timeout(Duration::from_secs(60), stream.next())
      .await
      .map_err(|_| "openai stream stalled".to_string())?;
    let Some(chunk) = next else {
      break;
    };
    let chunk = chunk.map_err(|e| format!("openai stream error: {e}"))?;
    buf.push_str(&String::from_utf8_lossy(&chunk));

    while let Some(pos) = buf.find('\n') {
      let mut line = buf[..pos].to_string();
      buf.drain(..=pos);
      if line.ends_with('\r') {
        line.pop();
      }
      let t = line.trim();
      if t.is_empty() {
        continue;
      }
      let Some(data) = t.strip_prefix("data:") else {
        continue;
      };
      let payload = data.trim();
      if payload == "[DONE]" {
        return if !content_out.trim().is_empty() {
          Ok(content_out)
        } else if !reasoning_out.trim().is_empty() {
          Ok(reasoning_out)
        } else {
          Err("openai event-stream returned no content".to_string())
        };
      }
      if !(payload.starts_with('{') && payload.ends_with('}')) {
        continue;
      }
      let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) else {
        continue;
      };
      let (c, r) = extract_openai_chat_delta_parts(&v);
      if let Some(s) = c {
        content_out.push_str(&s);
      }
      if let Some(s) = r {
        reasoning_out.push_str(&s);
      }
    }
  }

  // Flush remaining buffered lines.
  if !buf.trim().is_empty() {
    for line in buf.lines() {
      let t = line.trim();
      let Some(data) = t.strip_prefix("data:") else {
        continue;
      };
      let payload = data.trim();
      if payload == "[DONE]" {
        break;
      }
      if let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) {
        let (c, r) = extract_openai_chat_delta_parts(&v);
        if let Some(s) = c {
          content_out.push_str(&s);
        }
        if let Some(s) = r {
          reasoning_out.push_str(&s);
        }
      }
    }
  }

  if !content_out.trim().is_empty() {
    return Ok(content_out);
  }
  if !reasoning_out.trim().is_empty() {
    return Ok(reasoning_out);
  }
  Err("openai event-stream returned no content".to_string())
}

async fn openai_chat_completion(
  base_url: &str,
  api_key: &str,
  model: &str,
  messages: Vec<serde_json::Value>,
) -> Result<String, String> {
  let base = normalize_base_url(base_url);
  if base.is_empty() {
    return Err("openai baseUrl is empty".to_string());
  }
  if model.trim().is_empty() {
    return Err("openai model is empty".to_string());
  }
  let body = serde_json::json!({
    "model": model,
    "messages": messages,
    "temperature": 0.2,
    "stream": false,
  });
  openai_chat_completion_with_body(&base, api_key, body).await
}

async fn openai_chat_completion_json_object(
  base_url: &str,
  api_key: &str,
  model: &str,
  messages: Vec<serde_json::Value>,
) -> Result<String, String> {
  let base = normalize_base_url(base_url);
  if base.is_empty() {
    return Err("openai baseUrl is empty".to_string());
  }
  if model.trim().is_empty() {
    return Err("openai model is empty".to_string());
  }
  let body = serde_json::json!({
    "model": model,
    "messages": messages,
    "temperature": 0.0,
    "stream": false,
    "response_format": { "type": "json_object" }
  });
  openai_chat_completion_with_body(&base, api_key, body).await
}

async fn openai_chat_completion_with_body(
  base: &str,
  api_key: &str,
  body: serde_json::Value,
) -> Result<String, String> {
  let url = format!("{base}/chat/completions");

  let client = reqwest::Client::new();
  let mut req = client
    .post(url)
    .header("Accept", "application/json, text/event-stream")
    .json(&body);
  let key = api_key.trim();
  if !key.is_empty() {
    req = req.bearer_auth(key);
  }
  let resp = req
    .send()
    .await
    .map_err(|e| format!("openai request failed: {e}"))?;
  let status = resp.status();
  let headers = resp.headers().clone();
  let ct = headers
    .get(reqwest::header::CONTENT_TYPE)
    .and_then(|v| v.to_str().ok())
    .unwrap_or("")
    .to_string();

  if !status.is_success() {
    let text = resp
      .text()
      .await
      .map_err(|e| format!("read openai response failed: {e}"))?;
    return Err(format!("openai request failed: http {status}\n{text}"));
  }

  if ct.to_lowercase().contains("text/event-stream") {
    return read_openai_event_stream(resp).await;
  }

  let text = resp
    .text()
    .await
    .map_err(|e| format!("read openai response failed: {e}"))?;

  let trimmed = text.trim_start();
  if trimmed.starts_with('<') {
    let ct = headers
      .get(reqwest::header::CONTENT_TYPE)
      .and_then(|v| v.to_str().ok())
      .unwrap_or("");
    let preview = trimmed.chars().take(200).collect::<String>();
    return Err(format!(
      "openai response is not JSON (looks like HTML). Check baseUrl (should end with /v1).\ncontent-type: {ct}\nbody (first 200 chars):\n{preview}"
    ));
  }

  // Some OpenAI-compatible providers always respond with SSE regardless of the stream flag.
  if trimmed.starts_with("data:") {
    return parse_openai_sse_text(&text);
  }

  let v = match serde_json::from_str::<serde_json::Value>(&text) {
    Ok(v) => v,
    Err(e) => {
      if let Some(v) = try_parse_json_object(&text) {
        v
      } else {
        let ct = headers
          .get(reqwest::header::CONTENT_TYPE)
          .and_then(|v| v.to_str().ok())
          .unwrap_or("");
        let preview = text.chars().take(400).collect::<String>();
        return Err(format!(
          "parse openai json failed: {e}\ncontent-type: {ct}\nbody (first 400 chars):\n{preview}"
        ));
      }
    }
  };
  let content = v
    .get("choices")
    .and_then(|c| c.as_array())
    .and_then(|arr| arr.first())
    .and_then(|c| c.get("message"))
    .and_then(|m| m.get("content"))
    .and_then(|c| c.as_str())
    .unwrap_or("")
    .to_string();

  if content.trim().is_empty() {
    return Err("openai response missing content".to_string());
  }
  Ok(content)
}

async fn gemini_generate_content(base_url: &str, api_key: &str, model: &str, prompt: &str) -> Result<String, String> {
  let mut base = normalize_base_url(base_url);
  if base.is_empty() {
    base = "https://generativelanguage.googleapis.com".to_string();
  }
  if api_key.trim().is_empty() {
    return Err("gemini apiKey is empty".to_string());
  }
  if model.trim().is_empty() {
    return Err("gemini model is empty".to_string());
  }

  // Allow both:
  // - https://generativelanguage.googleapis.com
  // - https://generativelanguage.googleapis.com/v1beta
  let base = if base.ends_with("/v1beta") || base.ends_with("/v1") {
    base
  } else {
    format!("{base}/v1beta")
  };

  let url = format!("{base}/models/{model}:generateContent?key={}", api_key.trim());
  let body = serde_json::json!({
    "contents": [
      { "role": "user", "parts": [ { "text": prompt } ] }
    ],
    "generationConfig": {
      "temperature": 0.2
    }
  });

  let client = reqwest::Client::new();
  let resp = client
    .post(url)
    .json(&body)
    .send()
    .await
    .map_err(|e| format!("gemini request failed: {e}"))?;
  let status = resp.status();
  let text = resp
    .text()
    .await
    .map_err(|e| format!("read gemini response failed: {e}"))?;
  if !status.is_success() {
    return Err(format!("gemini request failed: http {status}\n{text}"));
  }
  let v = serde_json::from_str::<serde_json::Value>(&text)
    .map_err(|e| format!("parse gemini json failed: {e}"))?;

  let mut out = String::new();
  if let Some(parts) = v
    .get("candidates")
    .and_then(|c| c.as_array())
    .and_then(|arr| arr.first())
    .and_then(|c| c.get("content"))
    .and_then(|c| c.get("parts"))
    .and_then(|p| p.as_array())
  {
    for p in parts {
      if let Some(t) = p.get("text").and_then(|t| t.as_str()) {
        out.push_str(t);
      }
    }
  }

  if out.trim().is_empty() {
    return Err("gemini response missing text".to_string());
  }
  Ok(out)
}

async fn gemini_generate_content_with_config(
  base_url: &str,
  api_key: &str,
  model: &str,
  prompt: &str,
  max_output_tokens: Option<u32>,
) -> Result<String, String> {
  let mut base = normalize_base_url(base_url);
  if base.is_empty() {
    base = "https://generativelanguage.googleapis.com".to_string();
  }
  if api_key.trim().is_empty() {
    return Err("gemini apiKey is empty".to_string());
  }
  if model.trim().is_empty() {
    return Err("gemini model is empty".to_string());
  }

  let base = if base.ends_with("/v1beta") || base.ends_with("/v1") {
    base
  } else {
    format!("{base}/v1beta")
  };

  let url = format!("{base}/models/{model}:generateContent?key={}", api_key.trim());
  let mut gen = serde_json::json!({ "temperature": 0.2 });
  if let Some(m) = max_output_tokens {
    if m > 0 {
      gen["maxOutputTokens"] = serde_json::Value::Number(serde_json::Number::from(m));
    }
  }

  let body = serde_json::json!({
    "contents": [
      { "role": "user", "parts": [ { "text": prompt } ] }
    ],
    "generationConfig": gen
  });

  let client = reqwest::Client::new();
  let resp = client
    .post(url)
    .json(&body)
    .send()
    .await
    .map_err(|e| format!("gemini request failed: {e}"))?;
  let status = resp.status();
  let text = resp
    .text()
    .await
    .map_err(|e| format!("read gemini response failed: {e}"))?;
  if !status.is_success() {
    return Err(format!("gemini request failed: http {status}\n{text}"));
  }
  let v = serde_json::from_str::<serde_json::Value>(&text)
    .map_err(|e| format!("parse gemini json failed: {e}"))?;

  let mut out = String::new();
  if let Some(parts) = v
    .get("candidates")
    .and_then(|c| c.as_array())
    .and_then(|arr| arr.first())
    .and_then(|c| c.get("content"))
    .and_then(|c| c.get("parts"))
    .and_then(|p| p.as_array())
  {
    for p in parts {
      if let Some(t) = p.get("text").and_then(|t| t.as_str()) {
        out.push_str(t);
      }
    }
  }

  if out.trim().is_empty() {
    return Err("gemini response missing text".to_string());
  }
  Ok(out)
}

fn try_parse_json_object(text: &str) -> Option<serde_json::Value> {
  let mut t = text.trim().to_string();

  // Strip markdown code fences if present.
  if t.starts_with("```") {
    let mut lines = t.lines();
    let _ = lines.next();
    let mut body = lines.collect::<Vec<_>>().join("\n");
    if let Some(idx) = body.rfind("```") {
      body.truncate(idx);
    }
    t = body.trim().to_string();
  }

  let t = t.trim();
  if t.starts_with('{') && t.ends_with('}') {
    return serde_json::from_str::<serde_json::Value>(t).ok();
  }
  // Attempt to locate the first JSON object in the output.
  let start = t.find('{')?;
  let end = t.rfind('}')?;
  if end <= start {
    return None;
  }
  serde_json::from_str::<serde_json::Value>(&t[start..=end]).ok()
}

fn try_parse_json_value(text: &str) -> Option<serde_json::Value> {
  let mut t = text.trim().to_string();

  // Strip markdown code fences if present.
  if t.starts_with("```") {
    let mut lines = t.lines();
    let _ = lines.next();
    let mut body = lines.collect::<Vec<_>>().join("\n");
    if let Some(idx) = body.rfind("```") {
      body.truncate(idx);
    }
    t = body.trim().to_string();
  }

  let t = t.trim();
  if t.is_empty() {
    return None;
  }
  if (t.starts_with('{') && t.ends_with('}')) || (t.starts_with('[') && t.ends_with(']')) {
    return serde_json::from_str::<serde_json::Value>(t).ok();
  }

  // Attempt to locate the first JSON value in the output.
  if let (Some(s), Some(e)) = (t.find('{'), t.rfind('}')) {
    if e > s {
      if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t[s..=e]) {
        return Some(v);
      }
    }
  }
  if let (Some(s), Some(e)) = (t.find('['), t.rfind(']')) {
    if e > s {
      if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t[s..=e]) {
        return Some(v);
      }
    }
  }
  None
}

async fn optimize_transcription_with_ai(
  media_id: &str,
  ai: &AiSettings,
  transcription: &serde_json::Value,
  glossary: Option<&str>,
  job_id: &str,
  app: &tauri::AppHandle,
) -> Result<serde_json::Value, String> {
  let segs = transcription
    .get("segments")
    .and_then(|v| v.as_array())
    .cloned()
    .unwrap_or_default();
  if segs.is_empty() {
    return Err("transcription has no segments".to_string());
  }

  let transcript_text = build_transcript_text(transcription, 140_000);
  if transcript_text.trim().is_empty() {
    return Err("transcription is empty".to_string());
  }

  let _ = emit_job(app, JobProgressEvent {
    job_id: job_id.to_string(),
    media_id: media_id.to_string(),
    job_type: JobType::Optimize,
    status: JobStatus::Running,
    progress: 0.18,
    message: Some("analyzing transcript".to_string()),
  });

  let gloss = glossary.unwrap_or("").trim();
  let glossary_block = if gloss.is_empty() {
    "".to_string()
  } else {
    format!(
      "Preferred terms (use these spellings when applicable):\n{gloss}\n\n"
    )
  };

  let prompt = format!(
    "You are improving an existing ASR transcript.\n\n\
Goal: fix obvious, repeated ASR mistakes (especially proper nouns / terms) using a SMALL set of safe string replacements.\n\
Do NOT translate. Do NOT rewrite sentences. Do NOT add new content.\n\n\
Output ONLY JSON (no code fences).\n\
Schema:\n\
{{\n  \"replacements\": [{{\"from\": string, \"to\": string}}]\n}}\n\n\
Rules:\n\
- Provide at most 30 replacements.\n\
- Each \"from\" MUST appear in the transcript.\n\
- Avoid 1-character \"from\" values. Prefer longer, unambiguous phrases.\n\
- Keep replacements minimal (term-level).\n\
- Do not use regex. Plain strings only.\n\n\
{glossary_block}\
Transcript (may be truncated):\n\n{transcript}\n",
    glossary_block = glossary_block,
    transcript = transcript_text
  );

  let raw = match ai.provider {
    AiProvider::OpenaiCompatible => {
      let model = ai.openai.chat_model.trim();
      let messages = vec![
        serde_json::json!({ "role": "system", "content": "You output strict JSON." }),
        serde_json::json!({ "role": "user", "content": prompt }),
      ];
      openai_chat_completion(&ai.openai.base_url, &ai.openai.api_key, model, messages).await?
    }
    AiProvider::Gemini => {
      gemini_generate_content(&ai.gemini.base_url, &ai.gemini.api_key, &ai.gemini.model, &prompt).await?
    }
  };

  let parsed = try_parse_json_value(&raw)
    .ok_or_else(|| "optimize output missing JSON".to_string())?;

  let reps = parsed
    .get("replacements")
    .and_then(|v| v.as_array())
    .cloned()
    .unwrap_or_default();

  let mut rules: Vec<(String, String)> = Vec::new();
  for r in reps {
    let from = r.get("from").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
    let to = r.get("to").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
    if from.len() < 2 || to.is_empty() {
      continue;
    }
    if !transcript_text.contains(&from) {
      continue;
    }
    rules.push((from, to));
  }

  // Apply longer rules first to avoid partial overlap.
  rules.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
  rules.dedup_by(|a, b| a.0 == b.0);

  let _ = emit_job(app, JobProgressEvent {
    job_id: job_id.to_string(),
    media_id: media_id.to_string(),
    job_type: JobType::Optimize,
    status: JobStatus::Running,
    progress: 0.72,
    message: Some(format!("applying fixes (rules={})", rules.len())),
  });

  let mut out = transcription.clone();
  if let Some(arr) = out.get_mut("segments").and_then(|v| v.as_array_mut()) {
    for seg in arr.iter_mut() {
      let old = seg.get("text").and_then(|x| x.as_str()).unwrap_or("");
      if old.trim().is_empty() {
        continue;
      }
      let mut next = old.to_string();
      for (from, to) in &rules {
        if next.contains(from) {
          next = next.replace(from, to);
        }
      }
      if next != old {
        seg["text"] = serde_json::Value::String(next);
      }
    }
  }

  // Update metadata.
  out["id"] = serde_json::Value::String(format!("trans-opt-{}", nanoid()));
  out["mediaId"] = serde_json::Value::String(media_id.to_string());
  out["generatedAt"] = serde_json::Value::String(now_iso());
  let model_label = match ai.provider {
    AiProvider::OpenaiCompatible => format!("ai_opt:openai_compatible:{}", ai.openai.chat_model),
    AiProvider::Gemini => format!("ai_opt:gemini:{}", ai.gemini.model),
  };
  out["model"] = serde_json::Value::String(model_label);

  Ok(out)
}

async fn summarize_from_transcription(
  media_id: &str,
  ai: &AiSettings,
  transcription: &serde_json::Value,
  job_id: &str,
  app: &tauri::AppHandle,
  user_lang: Option<&str>,
  prompt_id: Option<&str>,
  prompt_template: Option<&str>,
) -> Result<serde_json::Value, String> {
  use futures_util::stream::{FuturesUnordered, StreamExt};
  use tokio::sync::Semaphore;

  fn apply_summary_prompt_template(tpl: &str, input_type: &str, input: &str) -> String {
    let t = tpl
      .replace("{{inputType}}", input_type)
      .replace("{{input}}", input);
    if tpl.contains("{{input}}") {
      t
    } else {
      format!("{t}\n\nInput ({input_type}):\n\n{input}\n")
    }
  }

  let transcript_text = build_transcript_text(transcription, 240_000);
  if transcript_text.trim().is_empty() {
    return Err("transcription is empty".to_string());
  }

  let lang_hint = user_lang.unwrap_or("").trim().to_lowercase();
  let prefer_zh = lang_hint.starts_with("zh");
  let prefer_en = lang_hint.starts_with("en");
  let lang_prefix = if prefer_zh {
    "Output language: Simplified Chinese (zh). Use Chinese even if the transcript is English.\n\n"
  } else if prefer_en {
    "Output language: English.\n\n"
  } else {
    ""
  };

  const SINGLE_MAX_CHARS: usize = 60_000;
  const CHUNK_MAX_CHARS: usize = 24_000;
  const CHUNK_CONCURRENCY: usize = 2;

  let (final_out, prompt_used): (String, String) = if transcript_text.len() <= SINGLE_MAX_CHARS {
    let _ = emit_job(app, JobProgressEvent {
      job_id: job_id.to_string(),
      media_id: media_id.to_string(),
      job_type: JobType::Summary,
      status: JobStatus::Running,
      progress: 0.20,
      message: Some("summarizing (single pass)".to_string()),
    });

    let base_prompt = "You are creating the FINAL summary for a media transcript.\n\n\
Return ONLY JSON (no code fences).\n\
Schema:\n\
{\n\
  \"content\": string (markdown),\n\
  \"keyPoints\": string[] (optional),\n\
  \"chapters\": [{\"timestamp\": number, \"title\": string, \"summary\": string?}] (optional),\n\
  \"timeline\": {\n\
    \"title\": string,\n\
    \"lanes\": [{\"label\": string, \"segments\": [{\"start\": number, \"end\": number, \"title\": string}]}]\n\
  },\n\
  \"mindmap\": {\"root\": string, \"children\": [{\"label\": string, \"children\": []}]}\n\
}\n\n\
Rules:\n\
- \"content\" MUST be markdown and MUST NOT include mermaid code blocks (the app will generate diagrams).\n\
- When referencing facts, include timestamps like [MM:SS].\n\
- Chapters timestamps are seconds (number) and must be increasing.\n\
- Timeline: provide 4 lanes (Concepts / Core Appeal / Case Study / Deep Summary). Each segment needs start/end seconds and end > start.\n\
- Mindmap: at least 3 levels deep (prefer 4) with 15+ nodes, keep node text short, avoid ':', ',', arrows, and brackets.\n\n\
Input (transcript):\n\n{{input}}\n";
    let tpl = prompt_template.unwrap_or(base_prompt);
    let final_prompt = format!("{lang_prefix}{}", apply_summary_prompt_template(tpl, "transcript", &transcript_text));

    let out = match ai.provider {
      AiProvider::OpenaiCompatible => {
        let model = if ai.openai.summary_model.trim().is_empty() {
          ai.openai.chat_model.trim()
        } else {
          ai.openai.summary_model.trim()
        };
        let messages = vec![
          serde_json::json!({ "role": "system", "content": "You output strict JSON." }),
          serde_json::json!({ "role": "user", "content": final_prompt }),
        ];
         // Prefer strict JSON object mode; fall back to normal mode if unsupported.
         match openai_chat_completion_json_object(&ai.openai.base_url, &ai.openai.api_key, model, messages.clone()).await {
           Ok(v) => v,
           Err(_) => openai_chat_completion(&ai.openai.base_url, &ai.openai.api_key, model, messages).await?,
         }
      }
      AiProvider::Gemini => {
        gemini_generate_content(&ai.gemini.base_url, &ai.gemini.api_key, &ai.gemini.model, &final_prompt).await?
      }
    };

    let used = if let Some(pid) = prompt_id {
      format!("summary_single_v1|{pid}")
    } else {
      "summary_single_v1".to_string()
    };
    (out, used)
  } else {
    // Chunked mode: summarize chunks in parallel (small concurrency) and then compose final JSON.
    let chunks = split_text_chunks(&transcript_text, CHUNK_MAX_CHARS);
    let total = chunks.len().max(1);

    let _ = emit_job(app, JobProgressEvent {
      job_id: job_id.to_string(),
      media_id: media_id.to_string(),
      job_type: JobType::Summary,
      status: JobStatus::Running,
      progress: 0.08,
      message: Some(format!("summarizing chunks (n={})", total)),
    });

    let sem = std::sync::Arc::new(Semaphore::new(CHUNK_CONCURRENCY));
    let mut futs: FuturesUnordered<_> = FuturesUnordered::new();
    let lang_prefix_chunk = lang_prefix.to_string();

    for (i, chunk) in chunks.iter().enumerate() {
      let sem = sem.clone();
      let ai2 = ai.clone();
      let chunk2 = chunk.clone();
      let lp = lang_prefix_chunk.clone();
      futs.push(async move {
        let _permit = sem.acquire_owned().await.map_err(|e| e.to_string())?;
        let prompt_body = format!(
          "You are summarizing a portion of a media transcript.\n\n\
 Return ONLY markdown. Keep it concise but information-dense.\n\
 Include:\n\
 - Key points (bullets)\n\
 - Notable timestamps (when present like [MM:SS])\n\
 - Terms/proper nouns that seem important (as a short list)\n\n\
 Transcript chunk:\n\n{chunk}\n",
          chunk = chunk2
        );
        let prompt = format!("{lp}{prompt_body}");

        let out = match ai2.provider {
          AiProvider::OpenaiCompatible => {
            let model = if ai2.openai.summary_model.trim().is_empty() {
              ai2.openai.chat_model.trim()
            } else {
              ai2.openai.summary_model.trim()
            };
            let messages = vec![
              serde_json::json!({ "role": "system", "content": "You produce high-quality summaries." }),
              serde_json::json!({ "role": "user", "content": prompt }),
            ];
            openai_chat_completion(&ai2.openai.base_url, &ai2.openai.api_key, model, messages).await?
          }
          AiProvider::Gemini => {
            gemini_generate_content(&ai2.gemini.base_url, &ai2.gemini.api_key, &ai2.gemini.model, &prompt).await?
          }
        };

        Ok::<(usize, String), String>((i, out))
      });
    }

    let mut partials: Vec<String> = vec![String::new(); total];
    let mut done: usize = 0;
    while let Some(res) = futs.next().await {
      let (idx, txt) = res?;
      if idx < partials.len() {
        partials[idx] = txt;
      }
      done = done.saturating_add(1);
      let p = 0.10 + ((done as f32 / total as f32).clamp(0.0, 1.0) * 0.55);
      let _ = emit_job(app, JobProgressEvent {
        job_id: job_id.to_string(),
        media_id: media_id.to_string(),
        job_type: JobType::Summary,
        status: JobStatus::Running,
        progress: p,
        message: Some(format!("summarizing chunks {}/{}", done, total)),
      });
    }

    let _ = emit_job(app, JobProgressEvent {
      job_id: job_id.to_string(),
      media_id: media_id.to_string(),
      job_type: JobType::Summary,
      status: JobStatus::Running,
      progress: 0.72,
      message: Some("composing final summary".to_string()),
    });

    let combined = partials.join("\n\n---\n\n");
     let base_prompt = "You are creating the FINAL summary for a media transcript.\n\n\
Return ONLY JSON (no code fences).\n\
Schema:\n\
{\n\
  \"content\": string (markdown),\n\
  \"keyPoints\": string[] (optional),\n\
  \"chapters\": [{\"timestamp\": number, \"title\": string, \"summary\": string?}] (optional),\n\
  \"timeline\": {\n\
    \"title\": string,\n\
    \"lanes\": [{\"label\": string, \"segments\": [{\"start\": number, \"end\": number, \"title\": string}]}]\n\
  },\n\
  \"mindmap\": {\"root\": string, \"children\": [{\"label\": string, \"children\": []}]}\n\
}\n\n\
Rules:\n\
- \"content\" MUST be markdown and MUST NOT include mermaid code blocks (the app will generate diagrams).\n\
- When referencing facts, include timestamps like [MM:SS].\n\
- Chapters timestamps are seconds (number) and must be increasing.\n\
- Timeline: provide 4 lanes (Concepts / Core Appeal / Case Study / Deep Summary). Each segment needs start/end seconds and end > start.\n\
- Mindmap: at least 3 levels deep (prefer 4) with 15+ nodes, keep node text short, avoid ':', ',', arrows, and brackets.\n\n\
Input (notes):\n\n{{input}}\n";
     let tpl = prompt_template.unwrap_or(base_prompt);
     let final_prompt = format!("{lang_prefix}{}", apply_summary_prompt_template(tpl, "notes", &combined));

    let out = match ai.provider {
      AiProvider::OpenaiCompatible => {
        let model = if ai.openai.summary_model.trim().is_empty() {
          ai.openai.chat_model.trim()
        } else {
          ai.openai.summary_model.trim()
        };
        let messages = vec![
          serde_json::json!({ "role": "system", "content": "You output strict JSON." }),
          serde_json::json!({ "role": "user", "content": final_prompt }),
        ];
         match openai_chat_completion_json_object(&ai.openai.base_url, &ai.openai.api_key, model, messages.clone()).await {
           Ok(v) => v,
           Err(_) => openai_chat_completion(&ai.openai.base_url, &ai.openai.api_key, model, messages).await?,
         }
      }
      AiProvider::Gemini => {
        gemini_generate_content(&ai.gemini.base_url, &ai.gemini.api_key, &ai.gemini.model, &final_prompt).await?
      }
    };

    let used = if let Some(pid) = prompt_id {
      format!("chunked_summary_v2|{pid}")
    } else {
      "chunked_summary_v2".to_string()
    };
    (out, used)
  };

  let parsed = try_parse_json_object(&final_out);

  let mut content = parsed
    .as_ref()
    .and_then(|v| v.get("content"))
    .and_then(|c| c.as_str())
    .map(|s| s.to_string())
    .unwrap_or_else(|| final_out.clone());

  // If the prompt returned structured timeline/mindmap, generate stable mermaid blocks ourselves.
  if let Some(p) = parsed.as_ref() {
    let timeline = p.get("timeline");
    let mindmap = p.get("mindmap");
    if timeline.is_some() || mindmap.is_some() {
      let timeline_mmd = build_summary_timeline_gantt(timeline, prefer_zh);
      let mindmap_mmd = build_summary_mindmap(mindmap, prefer_zh);
      content = strip_mermaid_code_blocks(&content);
      content = append_summary_diagrams(&content, &timeline_mmd, &mindmap_mmd, prefer_zh);
    }
  }

  let key_points = parsed
    .as_ref()
    .and_then(|v| v.get("keyPoints"))
    .and_then(|k| k.as_array())
    .map(|arr| {
      arr.iter()
        .filter_map(|x| x.as_str().map(|s| s.to_string()))
        .collect::<Vec<_>>()
    });

  let chapters = parsed
    .as_ref()
    .and_then(|v| v.get("chapters"))
    .and_then(|c| c.as_array())
    .map(|arr| {
      arr.iter()
        .filter_map(|x| {
          let ts = x.get("timestamp").and_then(|n| n.as_f64()).unwrap_or(0.0);
          let title = x.get("title").and_then(|s| s.as_str()).unwrap_or("").to_string();
          if title.trim().is_empty() {
            return None;
          }
          let summary = x.get("summary").and_then(|s| s.as_str()).map(|s| s.to_string());
          Some(serde_json::json!({
            "timestamp": ts,
            "title": title,
            "summary": summary,
          }))
        })
        .collect::<Vec<_>>()
    });

  let model_label = match ai.provider {
    AiProvider::OpenaiCompatible => {
      let m = if ai.openai.summary_model.trim().is_empty() { &ai.openai.chat_model } else { &ai.openai.summary_model };
      format!("openai_compatible:{m}")
    }
    AiProvider::Gemini => format!("gemini:{}", ai.gemini.model),
  };

  let mut out = serde_json::json!({
    "id": format!("sum-{}", nanoid()),
    "mediaId": media_id,
    "content": content,
    "generatedAt": now_iso(),
    "model": model_label,
    "promptUsed": prompt_used,
  });

  if let Some(kp) = key_points {
    out["keyPoints"] = serde_json::Value::Array(kp.into_iter().map(serde_json::Value::String).collect());
  }
  if let Some(ch) = chapters {
    out["chapters"] = serde_json::Value::Array(ch);
  }

  Ok(out)
}

fn strip_mermaid_code_blocks(markdown: &str) -> String {
  let mut out = String::new();
  let mut rest = markdown.to_string();
  loop {
    let idx = match rest.find("```mermaid") {
      Some(i) => i,
      None => {
        out.push_str(&rest);
        break;
      }
    };
    out.push_str(&rest[..idx]);

    // Skip opening fence (```) and everything until the next closing fence.
    let after_open = &rest[idx + 3..];
    let Some(end) = after_open.find("```") else {
      // Unterminated code fence; drop the remainder.
      break;
    };
    rest = after_open[end + 3..].to_string();
  }
  out
}

fn sanitize_mermaid_label(raw: &str) -> String {
  let mut s = raw.trim().to_string();
  if s.is_empty() {
    return s;
  }
  // Keep Mermaid parsers happy: avoid delimiter punctuation.
  s = s
    .replace("```", "")
    .replace('`', "")
    .replace("\r", " ")
    .replace("\n", " ")
    .replace("\t", " ")
    .replace(':', "：")
    .replace(',', "，")
    .replace(';', "；")
    .replace('(', "（")
    .replace(')', "）")
    .replace('[', "【")
    .replace(']', "】")
    .replace('<', "")
    .replace('>', "");

  // Collapse whitespace.
  let mut out = String::new();
  let mut last_space = false;
  for ch in s.chars() {
    if ch.is_whitespace() {
      if !last_space {
        out.push(' ');
        last_space = true;
      }
    } else {
      out.push(ch);
      last_space = false;
    }
  }
  out.trim().to_string()
}

fn seconds_to_gantt_datetime(sec: f64) -> String {
  let s = if sec.is_finite() && sec > 0.0 { sec } else { 0.0 };
  let total = s.floor() as i64;
  let hh = total / 3600;
  let mm = (total % 3600) / 60;
  let ss = total % 60;
  format!("2020-01-01 {hh:02}:{mm:02}:{ss:02}")
}

fn normalize_lane_key(s: &str) -> String {
  s.chars()
    .filter(|c| !c.is_whitespace() && *c != '-' && *c != '_')
    .flat_map(|c| c.to_lowercase())
    .collect::<String>()
}

fn canonical_summary_timeline_lane_key(label: &str, prefer_zh: bool) -> String {
  let l = label.trim().to_lowercase();
  let concept = if prefer_zh { "概念定义" } else { "Concepts" };
  let core = if prefer_zh { "核心乐趣" } else { "Core Appeal" };
  let case_study = if prefer_zh { "案例拆解" } else { "Case Study" };
  let deep = if prefer_zh { "深度总结" } else { "Deep Summary" };

  let is_concept = l.contains("概念")
    || l.contains("定义")
    || l.contains("背景")
    || l.contains("concept")
    || l.contains("definition")
    || l.contains("background");
  if is_concept {
    return normalize_lane_key(concept);
  }

  let is_core = l.contains("核心")
    || l.contains("乐趣")
    || l.contains("兴趣")
    || l.contains("core")
    || l.contains("appeal")
    || l.contains("fun")
    || l.contains("why");
  if is_core {
    return normalize_lane_key(core);
  }

  let is_case = l.contains("案例")
    || l.contains("拆解")
    || l.contains("对比")
    || l.contains("case")
    || l.contains("study")
    || l.contains("example")
    || l.contains("comparison");
  if is_case {
    return normalize_lane_key(case_study);
  }

  let is_deep = l.contains("总结")
    || l.contains("结论")
    || l.contains("展望")
    || l.contains("deep")
    || l.contains("conclusion")
    || l.contains("takeaway")
    || l.contains("future");
  if is_deep {
    return normalize_lane_key(deep);
  }

  // Fallback: put unknown lanes into the first lane to avoid losing segments.
  normalize_lane_key(concept)
}

fn build_summary_timeline_gantt(timeline: Option<&serde_json::Value>, prefer_zh: bool) -> String {
  use std::collections::HashMap;

  let title = timeline
    .and_then(|t| t.get("title"))
    .and_then(|v| v.as_str())
    .unwrap_or(if prefer_zh { "视频叙事流程" } else { "Narrative Timeline" });

  let default_lanes: Vec<&str> = if prefer_zh {
    vec!["概念定义", "核心乐趣", "案例拆解", "深度总结"]
  } else {
    vec!["Concepts", "Core Appeal", "Case Study", "Deep Summary"]
  };

  let mut lane_map: HashMap<String, Vec<(f64, f64, String)>> = HashMap::new();
  if let Some(lanes) = timeline
    .and_then(|t| t.get("lanes"))
    .and_then(|v| v.as_array())
  {
    for lane in lanes {
      let label = lane
        .get("label")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
      if label.is_empty() {
        continue;
      }
      let mut segs_out: Vec<(f64, f64, String)> = Vec::new();
      if let Some(segs) = lane.get("segments").and_then(|v| v.as_array()) {
        for seg in segs {
          let start = seg.get("start").and_then(|n| n.as_f64()).unwrap_or(0.0);
          let end0 = seg.get("end").and_then(|n| n.as_f64()).unwrap_or(start);
          let end = if end0 > start { end0 } else { start + 1.0 };
          let title = seg.get("title").and_then(|s| s.as_str()).unwrap_or("").trim();
          if title.is_empty() {
            continue;
          }
          segs_out.push((start.max(0.0), end.max(0.0), title.to_string()));
        }
      }
      segs_out.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
      let key = canonical_summary_timeline_lane_key(label, prefer_zh);
      lane_map.entry(key).or_insert_with(Vec::new).extend(segs_out);
    }
  }

  let mut out = String::new();
  // A stable theme for a clean gantt look.
  out.push_str("%%{init: {'theme':'base','themeVariables':{'primaryColor':'#6366f1','primaryTextColor':'#ffffff','primaryBorderColor':'#4f46e5','lineColor':'#94a3b8','fontFamily':'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial'}}}%%\n");
  out.push_str("gantt\n");
  out.push_str(&format!("  title {}\n", sanitize_mermaid_label(title)));
  out.push_str("  dateFormat  YYYY-MM-DD HH:mm:ss\n");
  // Match the screenshot style: show the base date on the axis.
  out.push_str("  axisFormat  %Y-%m-%d\n");
  out.push_str("  todayMarker off\n\n");

  let mut task_id = 0usize;
  for lane_label in &default_lanes {
    out.push_str(&format!("  section {}\n", sanitize_mermaid_label(lane_label)));
    let key = normalize_lane_key(lane_label);
    let segs = lane_map.get(&key).cloned().unwrap_or_default();
    for (start, end, title) in segs {
      task_id += 1;
      let name = sanitize_mermaid_label(&title);
      if name.is_empty() {
        continue;
      }
      let sdt = seconds_to_gantt_datetime(start);
      let edt = seconds_to_gantt_datetime(end);
      out.push_str(&format!("  {} :t{}, {}, {}\n", name, task_id, sdt, edt));
    }
    out.push('\n');
  }

  // Never return an empty gantt (Mermaid may render poorly without tasks).
  if task_id == 0 {
    out.push_str(&format!("  section {}\n", sanitize_mermaid_label(if prefer_zh { "概览" } else { "Overview" })));
    out.push_str("  Start :t1, 2020-01-01 00:00:00, 2020-01-01 00:00:01\n");
  }

  out
}

fn build_summary_mindmap_node(out: &mut String, node: &serde_json::Value, depth: usize) {
  if depth > 6 {
    return;
  }
  let label = if let Some(s) = node.as_str() {
    s.trim().to_string()
  } else {
    node
      .get("label")
      .and_then(|v| v.as_str())
      .unwrap_or("")
      .trim()
      .to_string()
  };
  if label.is_empty() {
    return;
  }
  let indent = "  ".repeat(depth);
  out.push_str(&format!("{indent}{}\n", sanitize_mermaid_label(&label)));

  if let Some(children) = node.get("children").and_then(|v| v.as_array()) {
    for ch in children {
      build_summary_mindmap_node(out, ch, depth + 1);
    }
  }
}

fn build_summary_mindmap(mindmap: Option<&serde_json::Value>, prefer_zh: bool) -> String {
  let root = mindmap
    .and_then(|m| m.get("root"))
    .and_then(|v| v.as_str())
    .unwrap_or(if prefer_zh { "逻辑结构" } else { "Logic Map" });

  let mut out = String::new();
  out.push_str("mindmap\n");
  out.push_str(&format!("  root(({}))\n", sanitize_mermaid_label(root)));

  if let Some(children) = mindmap
    .and_then(|m| m.get("children"))
    .and_then(|v| v.as_array())
  {
    for ch in children {
      build_summary_mindmap_node(&mut out, ch, 2);
    }
  }

  // Fallback minimal branches.
  if out.lines().count() < 4 {
    if prefer_zh {
      out.push_str("    主题\n      观点\n      证据\n      结论\n");
    } else {
      out.push_str("    Topic\n      Claims\n      Evidence\n      Conclusion\n");
    }
  }

  out
}

fn append_summary_diagrams(content: &str, timeline_mmd: &str, mindmap_mmd: &str, prefer_zh: bool) -> String {
  let mut out = content.trim().to_string();
  if !out.is_empty() {
    out.push_str("\n\n");
  }

  let (h1, h2) = if prefer_zh { ("视频叙事流程", "逻辑脑图") } else { ("Narrative Timeline", "Logic Mind Map") };

  out.push_str(&format!("## {h1}\n\n```mermaid\n{}\n```\n\n", timeline_mmd.trim()));
  out.push_str(&format!("## {h2}\n\n```mermaid\n{}\n```\n", mindmap_mmd.trim()));
  out
}

fn extract_query_tokens(query: &str) -> Vec<String> {
  fn is_cjk(ch: char) -> bool {
    // Han
    (ch >= '\u{4E00}' && ch <= '\u{9FFF}')
      // Hiragana/Katakana
      || (ch >= '\u{3040}' && ch <= '\u{30FF}')
      // Hangul
      || (ch >= '\u{AC00}' && ch <= '\u{D7AF}')
  }

  let mut tokens: Vec<String> = Vec::new();
  let mut cur = String::new();
  for ch in query.chars() {
    if ch.is_ascii_alphanumeric() {
      cur.push(ch.to_ascii_lowercase());
      continue;
    }
    if cur.len() >= 3 {
      tokens.push(cur.clone());
    }
    cur.clear();
  }
  if cur.len() >= 3 {
    tokens.push(cur);
  }

  // Also extract simple CJK bigrams to improve recall for Chinese/Japanese/Korean queries.
  let cjk_chars: Vec<char> = query.chars().filter(|c| is_cjk(*c)).collect();
  if cjk_chars.len() >= 2 {
    for i in 0..(cjk_chars.len().saturating_sub(1)) {
      let bg = format!("{}{}", cjk_chars[i], cjk_chars[i + 1]);
      if bg.trim().len() >= 2 {
        tokens.push(bg);
      }
    }
  } else if cjk_chars.len() == 1 {
    tokens.push(cjk_chars[0].to_string());
  }

  tokens.sort();
  tokens.dedup();
  tokens
}

fn build_chat_context(transcription: Option<&serde_json::Value>, query: &str) -> String {
  let Some(t) = transcription else {
    return String::new();
  };
  let segs = t.get("segments").and_then(|s| s.as_array()).cloned().unwrap_or_default();
  if segs.is_empty() {
    return String::new();
  }

  let q = query.trim().to_lowercase();

  // Extract tokens for keyword matching
  let tokens = if !q.is_empty() { extract_query_tokens(&q) } else { Vec::new() };

  let mut scored: Vec<(i32, f64, String)> = Vec::new();
  for seg in &segs {
    let start = seg.get("start").and_then(|n| n.as_f64()).unwrap_or(0.0);
    let text = seg.get("text").and_then(|t| t.as_str()).unwrap_or("");
    let lower = text.to_lowercase();

    let mut score = 0i32;
    if !tokens.is_empty() {
      for tok in &tokens {
        if lower.contains(tok) {
          score += 1;
        }
      }
    } else if !q.is_empty() && lower.contains(&q) {
      score = 1;
    }

    if score <= 0 {
      continue;
    }
    scored.push((score, start, text.trim().to_string()));
  }

  // If no keyword matches, provide uniformly sampled context from the entire transcription
  if scored.is_empty() {
    let step = (segs.len() / 40).max(1);
    for (i, seg) in segs.iter().enumerate() {
      if i % step == 0 {
        let start = seg.get("start").and_then(|n| n.as_f64()).unwrap_or(0.0);
        let text = seg.get("text").and_then(|t| t.as_str()).unwrap_or("");
        if !text.trim().is_empty() {
          scored.push((0, start, text.trim().to_string()));
        }
      }
    }
  }

  if scored.is_empty() {
    return String::new();
  }

  scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal)));
  scored.truncate(40); // Increased from 28 to 40
  scored.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

  let mut out = String::new();
  for (_score, start, text) in scored {
    let line = format!("[{}] {}\n", seconds_to_timestamp(start), text);
    if out.len() + line.len() > 20_000 { // Increased from 12KB to 20KB
      break;
    }
    out.push_str(&line);
  }
  out
}

async fn chat_with_media_context(
  _media_id: &str,
  transcription: Option<&serde_json::Value>,
  summary_md: Option<&str>,
  user_lang: Option<&str>,
  ai: &AiSettings,
  messages: &[ChatMessageIn],
) -> Result<String, String> {
  let last_user = messages.iter().rev().find(|m| matches!(m.role, ChatRole::User));
  let query = last_user.map(|m| m.content.as_str()).unwrap_or("");
  let ctx = build_chat_context(transcription, query);

  let lang_hint = user_lang.unwrap_or("").trim().to_lowercase();
  let prefer_zh = lang_hint.starts_with("zh");
  let prefer_en = lang_hint.starts_with("en");

  match ai.provider {
    AiProvider::OpenaiCompatible => {
      let mut out_msgs: Vec<serde_json::Value> = Vec::new();
      let mut sys = String::from("You are a helpful assistant for a media player. Answer using the user's language. ");
      if prefer_zh {
        sys.push_str("Prefer Chinese. ");
      } else if prefer_en {
        sys.push_str("Prefer English. ");
      }
      sys.push_str("If you reference transcript facts, include timestamps like [MM:SS]. ");
      if !ctx.trim().is_empty() {
        sys.push_str("Use the provided transcript excerpts as the primary source of truth.");
      }
      out_msgs.push(serde_json::json!({ "role": "system", "content": sys }));

      if let Some(s) = summary_md {
        let s = s.trim();
        if !s.is_empty() {
          out_msgs.push(serde_json::json!({
            "role": "user",
            "content": format!("AI summary (may be partial):\n\n{s}"),
          }));
        }
      }

      if !ctx.trim().is_empty() {
        out_msgs.push(serde_json::json!({
          "role": "user",
          "content": format!("Transcript excerpts:\n\n{ctx}"),
        }));
      }

      // Keep only the last few turns.
      let tail = if messages.len() > 10 { &messages[messages.len() - 10..] } else { messages };
      for m in tail {
        let role = match m.role {
          ChatRole::User => "user",
          ChatRole::Assistant => "assistant",
          ChatRole::System => "system",
        };
        out_msgs.push(serde_json::json!({ "role": role, "content": m.content }));
      }

      openai_chat_completion(&ai.openai.base_url, &ai.openai.api_key, &ai.openai.chat_model, out_msgs).await
    }
    AiProvider::Gemini => {
      // Gemini: send a single prompt (keep MVP simple).
      let mut prompt = String::new();
      prompt.push_str("You are a helpful assistant for a media transcript. Answer using the user's language. ");
      if prefer_zh {
        prompt.push_str("Prefer Chinese. ");
      } else if prefer_en {
        prompt.push_str("Prefer English. ");
      }
      prompt.push_str("If you reference transcript facts, include timestamps like [MM:SS].\n\n");

      if let Some(s) = summary_md {
        let s = s.trim();
        if !s.is_empty() {
          prompt.push_str("AI summary (may be partial):\n\n");
          prompt.push_str(s);
          prompt.push_str("\n\n");
        }
      }
      if !ctx.trim().is_empty() {
        prompt.push_str("Transcript excerpts:\n\n");
        prompt.push_str(&ctx);
        prompt.push_str("\n\n");
      }
      prompt.push_str("User question:\n");
      prompt.push_str(query);

      gemini_generate_content(&ai.gemini.base_url, &ai.gemini.api_key, &ai.gemini.model, &prompt).await
    }
  }
}

fn main() {
  let state = Arc::new(AppState::default());

  tauri::Builder::default()
    .manage(state)
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_shell::init())
    .setup(|app| {
      // Resolve data root early so we fail fast on permission issues.
      // We also allow only the media directory for the asset protocol, so
      // downloaded/uploaded files can be played without exposing secrets.
      let handle = app.handle().clone();
      let state = app.state::<Arc<AppState>>().inner().clone();
      let dir = portable::resolve_data_root(&handle)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
      let _ = state.data_root.set(dir.clone());

      let media_dir = dir.join("media");
      std::fs::create_dir_all(&media_dir)?;
      let _ = handle.asset_protocol_scope().allow_directory(&media_dir, true);

      // Window chrome: macOS keeps native traffic lights, others use frameless.
      // The base config uses decorations=false. On macOS we override to true + Overlay.
      #[cfg(target_os = "macos")]
      if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_decorations(true);
        let _ = win.set_title_bar_style(tauri::TitleBarStyle::Overlay);
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_data_root,
      get_media_storage_info,
      reveal_media_dir,
      delete_media_storage,
      stage_external_file,
      load_subtitles,
      ensure_subtitles,
      translate_subtitles,
      load_state,
      save_state,
      import_url,
      upload_begin,
      upload_chunk,
      upload_finish,
      transcribe_media,
      optimize_transcription,
      summarize_media,
      export_media,
      chat_media
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
