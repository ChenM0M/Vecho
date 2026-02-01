import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IconComponent } from '../components/icons';
import { ConfigService } from '../services/config.service';
import { StateService } from '../services/state.service';
import { BackendService } from '../services/backend.service';
import { ToastService } from '../services/toast.service';
import { ProcessingJob, MediaItem } from '../types';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="h-full w-full overflow-y-auto bg-white dark:bg-[#0c0c0e] text-zinc-900 dark:text-zinc-100 p-8 md:p-12 transition-colors duration-300">
      <input #fileInput class="hidden" type="file" multiple accept="video/*,audio/*" (change)="onFileSelected($event)">

      <div class="max-w-7xl mx-auto flex flex-col gap-10">
        
        <!-- Hero Section -->
        <div class="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
             <h1 class="text-3xl font-bold tracking-tighter text-zinc-900 dark:text-white mb-2">{{ getGreeting() }}</h1>
             <p class="text-zinc-500 dark:text-zinc-400 font-medium">{{ currentDateStr() }}</p>
          </div>
          
          <div class="flex items-center gap-3">
            <button (click)="router.navigate(['/media'])" class="flex items-center gap-2 px-4 py-2.5 rounded-md bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-all font-medium text-xs">
               <app-icon name="layout-grid" [size]="16"></app-icon>
               <span>{{ config.t().home.inbox.openLibrary }}</span>
            </button>
              <button (click)="router.navigate(['/workflow'])" class="flex items-center gap-2 px-4 py-2.5 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black hover:opacity-90 transition-opacity font-medium text-xs shadow-lg shadow-zinc-500/10">
                <app-icon name="plus" [size]="16"></app-icon>
                <span>{{ config.t().home.inbox.newWorkflow }}</span>
             </button>
          </div>
        </div>

        <div class="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-12 lg:gap-16 items-start">
          
          <!-- LEFT COLUMN -->
          <div class="flex flex-col gap-10 min-w-0">
            
            <!-- Quick Import -->
             <div 
                class="group relative rounded-lg border border-dashed border-zinc-300 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 p-8 flex flex-col items-center justify-center text-center transition-all hover:bg-white dark:hover:bg-zinc-900 hover:border-zinc-400 dark:hover:border-zinc-600 hover:shadow-sm cursor-pointer"
                (click)="fileInput.click()"
                (dragover)="onDragOver($event)"
                (dragleave)="onDragLeave($event)"
                (drop)="onDropFiles($event)"
                [class.ring-2]="isDragging()"
                [class.ring-zinc-900]="isDragging()"
                [class.dark:ring-zinc-100]="isDragging()"
             >
                <div class="mb-4 p-3 bg-white dark:bg-zinc-800 rounded-md shadow-sm group-hover:scale-110 transition-transform text-zinc-400 group-hover:text-blue-500">
                    <app-icon name="upload-cloud" [size]="24"></app-icon>
                </div>
                <h3 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
                    {{ isDragging() ? config.t().home.inbox.dropNow : config.t().home.inbox.dropTitle }}
                </h3>
                <p class="text-xs text-zinc-500 max-w-xs mx-auto mb-6 leading-relaxed">
                   {{ config.t().home.inbox.dropDesc }}
                </p>

                <!-- Input Link Option -->
                <div class="w-full max-w-md relative z-10" (click)="$event.stopPropagation()">
                   <div class="flex items-center gap-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-md px-3 py-2.5 shadow-sm focus-within:ring-2 focus-within:ring-zinc-200 dark:focus-within:ring-zinc-800 transition-all">
                       <app-icon name="link" [size]="14" class="text-zinc-400"></app-icon>
                       <input [(ngModel)]="importUrlValue" (ngModelChange)="importUrl.set($event)" (keydown.enter)="importFromUrl()" 
                              type="text" [placeholder]="config.t().home.inbox.linkPlaceholder" 
                              class="bg-transparent border-none outline-none text-xs flex-1 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400">
                        <button *ngIf="importUrl().trim()" (click)="importFromUrl()" class="text-[10px] font-bold bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-2 py-0.5 rounded-sm">
                            {{ config.t().common.import }}
                        </button>
                   </div>
                </div>
             </div>

             <!-- Recent Media Grid -->
             <div>
                <div class="flex items-center justify-between mb-5">
                    <h2 class="text-lg font-bold tracking-tight flex items-center gap-2">
                        <app-icon name="clock" [size]="18" class="text-zinc-400"></app-icon>
                        {{ config.t().home.inbox.recentMedia }}
                    </h2>
                     <button (click)="router.navigate(['/media'])" class="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
                        {{ config.t().home.inbox.viewAll }}
                     </button>
                </div>

                @if (recentMedia().length === 0) {
                    <div class="text-center py-10 text-zinc-400 text-sm italic">
                        {{ config.t().home.inbox.noRecentFiles }}
                    </div>
                } @else {
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                        @for (item of recentMedia(); track item.id) {
                            <div (click)="openMedia(item.id)" 
                                 class="group bg-white dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800/50 rounded-lg p-3 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-lg transition-all cursor-pointer relative card-hover">
                                
                                 <div class="aspect-video bg-zinc-100 dark:bg-zinc-800 rounded-md overflow-hidden relative mb-3">
                                     @if (item.thumbnail) {
                                         <img [src]="item.thumbnail" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
                                     } @else {
                                         <div class="w-full h-full flex items-center justify-center text-zinc-300 dark:text-zinc-700">
                                             <app-icon [name]="item.type === 'video' ? 'video' : 'music'" [size]="28"></app-icon>
                                         </div>
                                     }

                                     @if (activeJobForMedia(item.id); as j) {
                                       <div class="absolute top-2 right-2 w-9 h-9 rounded-full bg-black/45 backdrop-blur-sm flex items-center justify-center">
                                         <div class="w-7 h-7 rounded-full" [style.background]="progressRingBackground(jobDisplayProgress(j))" style="padding:2px;">
                                           <div class="w-full h-full rounded-full bg-black/55 flex items-center justify-center">
                                             <app-icon [name]="jobIcon(j.type)" [size]="12" class="text-white/90"></app-icon>
                                           </div>
                                         </div>
                                       </div>
                                     }

                                     <div class="absolute top-2 left-2 px-1.5 py-0.5 bg-zinc-900/60 backdrop-blur-sm text-white text-[9px] font-bold uppercase rounded-sm tracking-wider">
                                         {{ item.type }}
                                     </div>
                                     <div class="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/60 backdrop-blur-sm text-white text-[9px] font-mono rounded-sm">
                                         {{ formatDuration(item.duration) }}
                                     </div>
                                 </div>

                                 <h3 class="font-semibold text-sm text-zinc-900 dark:text-zinc-100 vecho-clamp-1 mb-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{{ item.name }}</h3>
                                <div class="flex items-center justify-between text-[10px] text-zinc-500">
                                    <span>{{ formatDate(item.updatedAt) }}</span>
                                    <span>{{ getMediaSecondary(item) }}</span>
                                </div>
                            </div>
                        }
                    </div>
                }
             </div>

          </div>

          <!-- RIGHT SIDEBAR (Flat) -->
          <div class="flex flex-col gap-8 pl-0 xl:pl-8 xl:border-l border-zinc-100 dark:border-zinc-800/50">
             
             <!-- Tab Switcher (Minimal Text) -->
             <div class="flex items-center gap-6 border-b border-zinc-100 dark:border-zinc-800 pb-1">
                <button (click)="rightPanel.set('queue')" class="pb-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors"
                    [class.border-zinc-900]="rightPanel() === 'queue'" [class.text-zinc-900]="rightPanel() === 'queue'"
                    [class.dark:border-zinc-100]="rightPanel() === 'queue'" [class.dark:text-zinc-100]="rightPanel() === 'queue'"
                    [class.border-transparent]="rightPanel() !== 'queue'" [class.text-zinc-400]="rightPanel() !== 'queue'">
                    {{ config.t().home.inbox.queueTitle }}
                </button>
                 <button (click)="rightPanel.set('activity')" class="pb-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors"
                    [class.border-zinc-900]="rightPanel() === 'activity'" [class.text-zinc-900]="rightPanel() === 'activity'"
                    [class.dark:border-zinc-100]="rightPanel() === 'activity'" [class.dark:text-zinc-100]="rightPanel() === 'activity'"
                    [class.border-transparent]="rightPanel() !== 'activity'" [class.text-zinc-400]="rightPanel() !== 'activity'">
                    {{ config.t().home.inbox.activityTitle }}
                </button>
             </div>

             <!-- Content List -->
             @if (rightPanel() === 'queue') {
                <div class="flex flex-col gap-4">
                   @if (recentJobs().length === 0) {
                      <div class="text-zinc-400 text-xs py-4">{{ config.t().home.inbox.queueEmpty }}</div>
                   }
                   @for (job of recentJobs(); track job.id) {
                      <div class="flex items-start gap-3 group">
                         <div class="mt-0.5 text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-200 transition-colors">
                            <app-icon [name]="jobIcon(job.type)" [size]="14"></app-icon>
                         </div>
                         <div class="flex-1 min-w-0">
                            <div class="flex items-center justify-between mb-1">
                                <span class="text-xs font-medium text-zinc-900 dark:text-zinc-100">{{ jobLabel(job.type) }}</span>
                                <span class="text-[9px] font-mono text-zinc-400 uppercase">{{ jobStatusLabel(job.status) }}</span>
                            </div>
                            <!-- Progress Bar -->
                             <div class="h-1 w-full bg-zinc-100 dark:bg-zinc-800 rounded-sm overflow-hidden">
                                 <div class="h-full bg-zinc-900 dark:bg-zinc-100 rounded-sm transition-all duration-300" [style.width.%]="jobDisplayProgress(job)"></div>
                             </div>
                             <div class="text-[10px] text-zinc-500 mt-1 truncate opacity-80">{{ jobMediaName(job.mediaId) }}</div>
                             @if (job.message) {
                               <div class="text-[10px] text-zinc-400 mt-0.5 truncate">{{ job.message }}</div>
                             }
                          </div>
                       </div>
                    }
                </div>
             } @else {
                <div class="relative pl-2 border-l border-zinc-100 dark:border-zinc-800 space-y-6">
                   @for (act of recentActivities(); track act.id) {
                      <div class="relative pl-4">
                          <!-- Dot -->
                          <div class="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full border-2 border-white dark:border-[#0c0c0e] bg-zinc-300 dark:bg-zinc-700"></div>
                          
                          <div class="text-xs font-medium text-zinc-900 dark:text-zinc-100">{{ act.title }}</div>
                           <div class="text-[10px] text-zinc-500 mt-0.5 vecho-clamp-2">{{ act.desc }}</div>
                          <div class="text-[9px] text-zinc-300 dark:text-zinc-600 mt-1 font-mono">{{ act.time }}</div>
                      </div>
                   }
                </div>
             }

          </div>

        </div>

      </div>
    </div>
   `,
  styles: [`
    .card-hover:hover { transform: translateY(-3px); }
   `]
})
export class HomeComponent {
  config = inject(ConfigService);
  state = inject(StateService);
  router = inject(Router);
  backend = inject(BackendService);
  toast = inject(ToastService);

  isDragging = signal(false);
  importUrl = signal('');
  importUrlValue = '';

  rightPanel = signal<'queue' | 'activity'>('queue');

  currentDateStr = signal('');

  constructor() {
    this.updateDate();
    setInterval(() => this.updateDate(), 60000);
  }

  updateDate() {
    const d = new Date();
    const options: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    this.currentDateStr.set(d.toLocaleDateString(this.config.lang() === 'en' ? 'en-US' : 'zh-CN', options));
  }

  getGreeting() {
    const hour = new Date().getHours();
    const isZh = this.config.lang() === 'zh';
    if (hour < 12) return isZh ? '早上好' : 'Good Morning';
    if (hour < 18) return isZh ? '下午好' : 'Good Afternoon';
    return isZh ? '晚上好' : 'Good Evening';
  }

  recentMedia = computed(() => {
    const items = [...this.state.mediaItems()];
    items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return items.slice(0, 6);
  });

  recentJobs = computed(() => {
    const jobs = [...this.state.processingJobs()];
    jobs.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
    return jobs.slice(0, 6);
  });

  recentActivities = computed(() => this.state.activities().slice(0, 6));

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    this.isDragging.set(false);
  }

  async onDropFiles(event: DragEvent) {
    event.preventDefault();
    this.isDragging.set(false);

    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length === 0) return;
    await this.importLocalFiles(files);
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement | null;
    const files = Array.from(input?.files || []);
    if (files.length === 0) return;
    await this.importLocalFiles(files);
    if (input) input.value = '';
  }

  async importFromUrl() {
    const raw = this.importUrl().trim();
    if (!raw) return;
    this.importUrl.set('');
    this.importUrlValue = '';

    const parsed = this.parseShareText(raw);
    if (!parsed.url) {
      this.toast.error('未检测到可导入的链接');
      return;
    }

    const url = parsed.url;

    const lower = url.toLowerCase();
    const platform = lower.includes('bilibili.com') ? 'bilibili'
      : (lower.includes('youtube.com') || lower.includes('youtu.be')) ? 'youtube'
        : 'other';

    const item = this.state.addMediaItem({
      type: 'video',
      name: parsed.title || url,
      source: { type: 'online', platform, url },
      duration: 0,
      meta: { kind: 'video', width: 0, height: 0, framerate: 0, codec: 'unknown' },
      thumbnail: undefined,
      tags: [],
      status: 'importing'
    });

    // Desktop (Tauri): let the backend drive job progress.
    if (await this.backend.isAvailable()) {
      try {
        const res = await this.backend.importUrl(url, item.id);
        if (res.warning) {
          console.warn('import_url warning', res.warning);
        }

        const cachedPath = typeof res.stored_rel === 'string' && res.stored_rel.trim()
          ? res.stored_rel.trim()
          : (typeof res.stored_path === 'string' ? res.stored_path : undefined);
        const fileSize = typeof res.file_size === 'number' ? res.file_size : undefined;
        const title = typeof res.title === 'string' && res.title.trim() ? res.title.trim() : undefined;
        const uploader = typeof res.uploader === 'string' && res.uploader.trim() ? res.uploader.trim() : undefined;
        const uploadDate = typeof res.upload_date === 'string' && res.upload_date.trim() ? res.upload_date.trim() : undefined;
        const detectedType = res.meta?.kind === 'audio' ? 'audio' : 'video';

        this.state.updateMediaItem(item.id, {
          name: title ?? item.name,
          type: detectedType,
          status: 'ready',
          duration: typeof res.duration === 'number' ? res.duration : 0,
          thumbnail: typeof res.thumbnail === 'string' ? res.thumbnail : undefined,
          meta: res.meta ? res.meta : item.meta,
          source: {
            ...item.source,
            originalTitle: title,
            uploader,
            uploadDate,
            cachedPath,
            fileSize
          } as any
        });
      } catch (e) {
        console.error('import_url failed', e);
        const msg = String((e as any)?.message ?? e ?? '');
        const shouldDiscard =
          msg.includes('invalid args') ||
          msg.includes('only http') ||
          msg.includes('sidecar') ||
          msg.includes('downloaded yt-dlp looks invalid') ||
          msg.includes('no suitable ffmpeg') ||
          msg.includes('failed to locate ffmpeg') ||
          msg.includes('yt-dlp') ||
          msg.includes('ffmpeg');

        if (msg.includes('invalid args')) {
          this.toast.error('导入失败：客户端与后端版本不匹配，请重启应用');
        } else if (msg.includes('github api request failed') || msg.includes('download failed')) {
          this.toast.error('导入失败：无法自动准备下载器，请检查网络连接');
        } else if (msg.includes('sidecar') || msg.includes('ffmpeg') || msg.includes('yt-dlp')) {
          this.toast.error('导入失败：下载器不可用（yt-dlp/ffmpeg）');
        } else {
          this.toast.error('导入失败：请检查链接或 cookies 配置');
        }

        if (shouldDiscard) {
          // Tooling/config errors: don't pollute the library.
          this.state.discardMediaItem(item.id);
        } else {
          // Keep failed downloads for retry.
          this.state.updateMediaItem(item.id, { status: 'error' });
        }
      }
      return;
    }

    // Web fallback (mock).
    this.state.addProcessingJob(item.id, 'download');
  }

  private parseShareText(raw: string): { url: string | null; title: string | null } {
    const text = (raw || '').trim();
    if (!text) return { url: null, title: null };

    const bracketTitle = text.match(/[\[【(（]\s*([^\]】)）]+)\s*[\]】)）]/)?.[1]?.trim();

    // 1) Prefer explicit URL.
    const urlMatch = text.match(/https?:\/\/[^\s]+/i);
    if (urlMatch) {
      const cleaned = this.cleanUrl(urlMatch[0]);
      const title = bracketTitle || this.extractTitleBeforeUrl(text, urlMatch.index ?? 0);
      return { url: cleaned, title };
    }

    // 2) BV / av forms.
    const bv = text.match(/BV[0-9A-Za-z]{10}/)?.[0];
    if (bv) {
      return { url: `https://www.bilibili.com/video/${bv}`, title: bracketTitle };
    }
    const av = text.match(/\bav\d+\b/i)?.[0];
    if (av) {
      return { url: `https://www.bilibili.com/video/${av}`, title: bracketTitle };
    }

    // 3) "www." links without scheme.
    const www = text.match(/\bwww\.[^\s]+/i)?.[0];
    if (www) {
      const cleaned = this.cleanUrl(`https://${www}`);
      const title = bracketTitle || this.extractTitleBeforeUrl(text, text.indexOf(www));
      return { url: cleaned, title };
    }

    return { url: null, title: bracketTitle || null };
  }

  private extractTitleBeforeUrl(text: string, urlIndex: number): string | null {
    if (!text) return null;
    const before = text.slice(0, Math.max(0, urlIndex)).trim();
    if (!before) return null;
    const t = before.replace(/^[\[【(（]\s*|\s*[\]】)）]$/g, '').trim();
    return t || null;
  }

  private cleanUrl(url: string): string {
    let s = (url || '').trim();
    // Strip trailing punctuation copied along with the URL.
    s = s.replace(/[\]】)）>,.，。;；!！?？"'“”‘’]+$/g, '');
    return s;
  }

  private async importLocalFiles(files: File[]) {
    const useBackend = await this.backend.isAvailable();
    const chunkSize = 2 * 1024 * 1024;

    for (const file of files) {
      const isAudio = file.type.startsWith('audio/');
      const type = isAudio ? 'audio' : 'video';
      const meta = isAudio
        ? { kind: 'audio' as const, sampleRate: 0, channels: 0, codec: 'unknown' }
        : { kind: 'video' as const, width: 0, height: 0, framerate: 0, codec: 'unknown' };

      const item = this.state.addMediaItem({
        type,
        name: file.name,
        source: { type: 'local', path: file.name, fileSize: file.size },
        duration: 0,
        meta,
        thumbnail: undefined,
        tags: [],
        status: 'importing'
      });

      if (!useBackend) {
        // Web fallback (mock).
        this.state.addProcessingJob(item.id, 'transcription');
        continue;
      }

      try {
        const begin = await this.backend.uploadBegin({
          mediaId: item.id,
          name: file.name,
          size: file.size,
          mime: file.type || null,
        });

        let offset = 0;
        while (offset < file.size) {
          const slice = file.slice(offset, offset + chunkSize);
          const buf = await slice.arrayBuffer();
          const bytes = new Uint8Array(buf);
          await this.backend.uploadChunk(begin.upload_id, offset, bytes);
          offset += bytes.byteLength;
        }

        const finish = await this.backend.uploadFinish(begin.upload_id);
        if (finish.warning) {
          console.warn('upload_finish warning', finish.warning);
        }

        const detectedType = finish.meta?.kind === 'audio'
          ? 'audio'
          : finish.meta?.kind === 'video'
            ? 'video'
            : type;

        const storedPath = typeof finish.stored_rel === 'string' && finish.stored_rel.trim()
          ? finish.stored_rel.trim()
          : finish.stored_path;

        this.state.updateMediaItem(item.id, {
          type: detectedType,
          source: { type: 'local', path: storedPath, fileSize: file.size },
          status: 'ready',
          duration: typeof finish.duration === 'number' ? finish.duration : 0,
          thumbnail: typeof finish.thumbnail === 'string' ? finish.thumbnail : undefined,
          meta: finish.meta ? finish.meta : meta
        });
      } catch (e) {
        console.error('upload failed', e);
        this.state.updateMediaItem(item.id, { status: 'error' });
      }
    }
  }

  openMedia(id: string) {
    this.router.navigate(['/media', id]);
  }

  formatDate(iso: string) {
    return new Date(iso).toLocaleDateString();
  }

  formatDuration(sec: number) {
    if (!sec) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  getMediaSecondary(item: MediaItem): string {
    if (item.source.type === 'online') {
      return item.source.platform === 'bilibili' ? 'Bilibili' : item.source.platform === 'youtube' ? 'YouTube' : 'Online';
    }
    return this.formatBytes(item.source.fileSize);
  }

  private formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(1)} GB`;
  }

  jobMediaName(mediaId: string): string {
    return this.state.mediaItems().find(m => m.id === mediaId)?.name || mediaId;
  }

  activeJobForMedia(mediaId: string): ProcessingJob | null {
    return this.state.processingJobs().find(j =>
      j.mediaId === mediaId && (j.status === 'pending' || j.status === 'processing')
    ) || null;
  }

  progressRingBackground(pct: number): string {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    // Light ring on dark overlay.
    return `conic-gradient(rgba(255,255,255,0.95) 0 ${p}%, rgba(255,255,255,0.20) ${p}% 100%)`;
  }

  jobDisplayProgress(job: ProcessingJob): number {
    const base = Math.max(0, Math.min(100, Number(job.progress) || 0));
    return base;
  }

  jobIcon(type: ProcessingJob['type']): string {
    switch (type) {
      case 'import': return 'upload-cloud';
      case 'download': return 'download';
      case 'transcription': return 'mic';
      case 'summary': return 'file-text';
      case 'export': return 'upload-cloud';
      default: return 'cpu';
    }
  }

  jobLabel(type: ProcessingJob['type']): string {
    const t = this.config.t();
    return ((t.home.inbox.jobTypes as any)[type] || type) as string;
  }

  jobStatusLabel(status: ProcessingJob['status']): string {
    const t = this.config.t();
    return ((t.home.inbox.jobStatus as any)[status] || status) as string;
  }
}
