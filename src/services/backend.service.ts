import { Injectable, inject } from '@angular/core';
import { TauriService } from './tauri.service';
import type { UnlistenFn } from './tauri.service';
import type { PersistedAppState, Transcription, AISummary, AppSettings, AIMessage } from '../types';

export interface ImportUrlResult {
  media_id: string;
  job_id: string;
  stored_path?: string;
  stored_rel?: string;
  file_size?: number;
  duration?: number | null;
  meta?: any;
  thumbnail?: string | null;
  title?: string | null;
  uploader?: string | null;
  upload_date?: string | null;
  warning?: string | null;
}

export interface MediaStorageInfoResult {
  media_id: string;
  data_root: string;
  media_dir: string;
  files: string[];
}

export interface StageExternalFileResult {
  media_id: string;
  stored_path: string;
  stored_rel?: string;
  file_size?: number;
}

export interface SubtitleSegment {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface SubtitleTrack {
  id: string;
  label?: string;
  language?: string;
  kind?: string;
  generatedAt?: string;
  segments: SubtitleSegment[];
}

export interface SubtitlesFile {
  version: number;
  mediaId: string;
  generatedAt?: string;
  tracks: SubtitleTrack[];
}

export interface UploadBeginResult {
  upload_id: string;
  media_id: string;
  job_id: string;
}

export interface UploadChunkResult {
  received: number;
}

export interface UploadFinishResult {
  media_id: string;
  stored_path: string;
  stored_rel?: string;
  duration?: number | null;
  meta?: any;
  thumbnail?: string | null;
  warning?: string | null;
}

export type BackendJobType = 'import' | 'download' | 'transcribe' | 'optimize' | 'summary' | 'export' | 'subtitle';
export type BackendJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface BackendJobProgressEvent {
  job_id: string;
  media_id: string;
  job_type: BackendJobType;
  status: BackendJobStatus;
  progress: number;
  message?: string | null;
}

export interface TranscribeMediaResult {
  media_id: string;
  job_id: string;
  transcription: Transcription;
}

export interface OptimizeTranscriptionResult {
  media_id: string;
  job_id: string;
  transcription: Transcription;
}

export interface SummarizeMediaResult {
  media_id: string;
  job_id: string;
  summary: AISummary;
}

export interface SummarizeMediaOptions {
  promptId?: string;
  promptTemplate?: string;
}

export interface ChatMediaResult {
  message: AIMessage;
}

export interface ExportMediaResult {
  media_id: string;
  job_id: string;
  export_dir: string;
  files: string[];
}

@Injectable({ providedIn: 'root' })
export class BackendService {
  private readonly tauri = inject(TauriService);

  async isAvailable(): Promise<boolean> {
    await this.tauri.ready();
    return this.tauri.isTauri();
  }

  async loadState(): Promise<PersistedAppState | null> {
    if (!(await this.isAvailable())) return null;
    return this.tauri.invoke<PersistedAppState | null>('load_state');
  }

  async saveState(state: PersistedAppState): Promise<void> {
    if (!(await this.isAvailable())) return;
    await this.tauri.invoke<void>('save_state', { args: { state } });
  }

  async importUrl(url: string, mediaId?: string, quality?: string): Promise<ImportUrlResult> {
    if (!(await this.isAvailable())) {
      throw new Error('backend not available');
    }
    return this.tauri.invoke<ImportUrlResult>('import_url', { args: { url, mediaId, quality } });
  }

  async getMediaStorageInfo(mediaId: string): Promise<MediaStorageInfoResult> {
    if (!(await this.isAvailable())) {
      throw new Error('backend not available');
    }
    return this.tauri.invoke<MediaStorageInfoResult>('get_media_storage_info', { args: { mediaId } });
  }

  async revealMediaDir(mediaId: string): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new Error('backend not available');
    }
    await this.tauri.invoke<void>('reveal_media_dir', { args: { mediaId } });
  }

  async deleteMediaStorage(mediaId: string): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new Error('backend not available');
    }
    await this.tauri.invoke<void>('delete_media_storage', { args: { mediaId } });
  }

  async stageExternalFile(mediaId: string, absPath: string): Promise<StageExternalFileResult> {
    if (!(await this.isAvailable())) {
      throw new Error('backend not available');
    }
    return this.tauri.invoke<StageExternalFileResult>('stage_external_file', { args: { mediaId, absPath } });
  }

  async uploadBegin(args: { mediaId?: string; name: string; size: number; mime?: string | null }): Promise<UploadBeginResult> {
    if (!(await this.isAvailable())) {
      throw new Error('backend not available');
    }
    return this.tauri.invoke<UploadBeginResult>('upload_begin', {
      args: {
        mediaId: args.mediaId,
        name: args.name,
        size: args.size,
        mime: args.mime ?? undefined,
      }
    });
  }

  async uploadChunk(uploadId: string, offset: number, bytes: Uint8Array): Promise<UploadChunkResult> {
    if (!(await this.isAvailable())) {
      throw new Error('backend not available');
    }
    return this.tauri.invoke<UploadChunkResult>('upload_chunk', { args: { uploadId, offset, bytes } });
  }

  async uploadFinish(uploadId: string): Promise<UploadFinishResult> {
    if (!(await this.isAvailable())) {
      throw new Error('backend not available');
    }
    return this.tauri.invoke<UploadFinishResult>('upload_finish', { args: { uploadId } });
  }

  async listenJobProgress(handler: (event: BackendJobProgressEvent) => void): Promise<UnlistenFn | null> {
    if (!(await this.isAvailable())) return null;
    return this.tauri.listen<BackendJobProgressEvent>('job_progress', handler);
  }

  async transcribeMedia(mediaId: string, config: AppSettings['transcription']): Promise<TranscribeMediaResult> {
    if (!(await this.isAvailable())) {
      throw new Error('backend not available');
    }
    return this.tauri.invoke<TranscribeMediaResult>('transcribe_media', { args: { mediaId, config } });
  }

  async optimizeTranscription(mediaId: string, ai: AppSettings['ai'], args?: { glossary?: string }): Promise<OptimizeTranscriptionResult> {
    if (!(await this.isAvailable())) {
      throw new Error('backend not available');
    }
    return this.tauri.invoke<OptimizeTranscriptionResult>('optimize_transcription', {
      args: {
        mediaId,
        ai,
        glossary: args?.glossary,
      }
    });
  }

  async summarizeMedia(mediaId: string, ai: AppSettings['ai'], options?: SummarizeMediaOptions): Promise<SummarizeMediaResult> {
    if (!(await this.isAvailable())) {
      throw new Error('backend not available');
    }
    return this.tauri.invoke<SummarizeMediaResult>('summarize_media', {
      args: {
        mediaId,
        ai,
        promptId: options?.promptId,
        promptTemplate: options?.promptTemplate,
      }
    });
  }

  async chatMedia(
    mediaId: string,
    ai: AppSettings['ai'],
    messages: Array<Pick<AIMessage, 'role' | 'content'>>,
    options?: { includeTranscription?: boolean; includeSummary?: boolean; userLang?: 'en' | 'zh' }
  ): Promise<ChatMediaResult> {
    if (!(await this.isAvailable())) {
      throw new Error('backend not available');
    }
    return this.tauri.invoke<ChatMediaResult>('chat_media', {
      args: {
        mediaId,
        ai,
        messages,
        includeTranscription: options?.includeTranscription ?? true,
        includeSummary: options?.includeSummary ?? false,
        userLang: options?.userLang,
      }
    });
  }

  async exportMedia(mediaId: string, exportDir?: string): Promise<ExportMediaResult> {
    if (!(await this.isAvailable())) {
      throw new Error('backend not available');
    }
    return this.tauri.invoke<ExportMediaResult>('export_media', { args: { mediaId, exportDir } });
  }

  async loadSubtitles(mediaId: string): Promise<SubtitlesFile | null> {
    if (!(await this.isAvailable())) {
      throw new Error('backend not available');
    }
    return this.tauri.invoke<SubtitlesFile | null>('load_subtitles', { args: { mediaId } });
  }

  async ensureSubtitles(mediaId: string): Promise<SubtitlesFile> {
    if (!(await this.isAvailable())) {
      throw new Error('backend not available');
    }
    return this.tauri.invoke<SubtitlesFile>('ensure_subtitles', { args: { mediaId } });
  }

  async translateSubtitles(mediaId: string, ai: AppSettings['ai'], targetLang: string): Promise<SubtitlesFile> {
    if (!(await this.isAvailable())) {
      throw new Error('backend not available');
    }
    return this.tauri.invoke<SubtitlesFile>('translate_subtitles', { args: { mediaId, ai, targetLang } });
  }
}
