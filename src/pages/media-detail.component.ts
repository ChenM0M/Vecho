import { Component, inject, signal, computed, OnInit, OnDestroy, effect, viewChild, ElementRef, HostListener, DestroyRef } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../components/icons';
import { MarkdownRendererComponent } from '../components/markdown-renderer.component';
import { VditorNoteEditorComponent } from '../components/vditor-note-editor.component';
import { ConfigService } from '../services/config.service';
import { StateService } from '../services/state.service';
import { TauriService } from '../services/tauri.service';
import { BackendService } from '../services/backend.service';
import type { SubtitlesFile, SubtitleTrack, SubtitleSegment } from '../services/backend.service';
import { ToastService } from '../services/toast.service';
import { ConfirmService } from '../services/confirm.service';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import type { MediaItem, MediaNote, Bookmark, AIConversation, AIMessage, ProcessingJob, AppSettings } from '../types';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

type TabId = 'transcript' | 'notes' | 'bookmarks' | 'summary' | 'chat';

@Component({
   selector: 'app-media-detail',
   standalone: true,
   imports: [IconComponent, RouterLink, FormsModule, MarkdownRendererComponent, VditorNoteEditorComponent],
   template: `
    <div class="flex flex-col h-full bg-white dark:bg-[#09090b] transition-colors duration-300">
      
      @if (media(); as m) {
        @if (transcriptionDialogOpen()) {
          <div class="fixed inset-0 z-50 flex items-center justify-center p-4" (click)="closeTranscriptionDialog()">
            <div class="absolute inset-0 bg-black/40"></div>
             <div class="relative w-full max-w-lg rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 shadow-2xl" (click)="$event.stopPropagation()">
                <div class="p-5 border-b border-zinc-100 dark:border-zinc-800">
                  <div class="text-sm font-bold text-zinc-900 dark:text-zinc-100">开始转写</div>
                  <div class="mt-1 text-xs text-zinc-500">每次开始前确认语言/加速/线程/ITN</div>
                </div>

                <div class="p-5 space-y-4">
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                   <div class="space-y-2">
                     <div class="text-[11px] font-semibold text-zinc-500">语言</div>
                    <select
                      class="w-full h-10 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                      [ngModel]="transcriptionDraft().language"
                      (ngModelChange)="patchTranscriptionDraft({ language: $event })"
                    >
                      <option value="auto">auto（自动识别）</option>
                       <option value="zh">zh（中文）</option>
                       <option value="en">en（英文）</option>
                       <option value="ja">ja（日语）</option>
                       <option value="ko">ko（韩语）</option>
                       <option value="yue">yue（粤语）</option>
                     </select>
                   </div>

                   <div class="space-y-2">
                     <div class="text-[11px] font-semibold text-zinc-500">标点/数字（ITN）</div>
                     <div class="flex items-center justify-between">
                       <div class="text-xs font-semibold text-zinc-900 dark:text-zinc-100">启用 ITN</div>
                       <button
                         class="h-8 px-3 rounded-lg border text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                         [disabled]="state.settings().transcription.engine !== 'local_sherpa_onnx'"
                         [class]="transcriptionDraft().useItn ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-black dark:border-white' : 'bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800'"
                         (click)="patchTranscriptionDraft({ useItn: !transcriptionDraft().useItn })"
                       >
                         {{ transcriptionDraft().useItn ? '已开启' : '已关闭' }}
                       </button>
                     </div>
                     <div class="text-[11px] text-zinc-500">开启后更容易输出中文标点与数字。</div>
                   </div>
                 </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div class="space-y-2">
                    <div class="text-[11px] font-semibold text-zinc-500">本地加速</div>
                    <select
                      class="w-full h-10 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                      [ngModel]="transcriptionDraft().localAccelerator"
                      (ngModelChange)="patchTranscriptionDraft({ localAccelerator: $event })"
                    >
                      <option value="auto">自动</option>
                      <option value="cuda">CUDA（NVIDIA）</option>
                      <option value="cpu">仅 CPU</option>
                    </select>
                     <div class="text-[11px] text-zinc-500">选择 CUDA 可能会下载运行库（一次性）。</div>
                   </div>

                   <div class="space-y-2">
                     <div class="text-[11px] font-semibold text-zinc-500">线程数</div>
                     <input
                       class="w-full h-10 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                       type="number"
                       min="0"
                       max="64"
                       [ngModel]="transcriptionDraft().numThreads"
                       (ngModelChange)="patchTranscriptionDraft({ numThreads: +$event || 0 })"
                       placeholder="0"
                     />
                     <div class="text-[11px] text-zinc-500">0 表示自动（推荐）。</div>
                   </div>
                 </div>
               </div>

              <div class="p-5 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-end gap-2">
                <button
                  class="h-9 px-4 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  (click)="closeTranscriptionDialog()"
                >
                  取消
                </button>
                 <button
                   class="h-9 px-4 rounded-lg text-xs font-semibold bg-zinc-900 text-white dark:bg-white dark:text-black hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                   (click)="startTranscriptionFromDialog()"
                   [disabled]="transcribing() || transcriptionRunning()"
                 >
                   开始转写
                 </button>
              </div>
            </div>
          </div>
        }

        @if (!pseudoFullscreen()) {
        <!-- Top Bar: Clean & Functional -->
         <div class="min-h-10 py-1 flex items-start justify-between px-5 bg-white dark:bg-[#09090b] border-b border-zinc-100 dark:border-zinc-800 shrink-0 z-10">
          <div class="flex items-start gap-4 min-w-0">
            <a routerLink="/media" class="group flex items-center justify-center w-8 h-8 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
              <app-icon name="arrow-left" [size]="20" class="transition-transform group-hover:-translate-x-0.5"></app-icon>
            </a>
            <div class="h-6 w-px bg-zinc-200 dark:bg-zinc-800 hidden sm:block"></div>
              <div class="flex flex-col justify-center min-w-0">
                  <h1 class="text-[14px] font-bold text-zinc-900 dark:text-zinc-100 tracking-tight leading-snug mb-0 vecho-clamp-1 max-w-[62vw]">{{ m.name }}</h1>
                 <div class="flex items-center gap-2 text-xs text-zinc-500 font-medium">
                   @if (m.source.type === 'online') {
                     <a
                       class="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                       [href]="m.source.url"
                       target="_blank"
                       rel="noreferrer"
                       (click)="openExternalUrl(m.source.url, $event)"
                       title="打开原始链接"
                     >
                       <app-icon name="link" [size]="10"></app-icon> {{ m.source.platform }}
                     </a>
                     <span class="text-zinc-300">•</span>
                   }
                   <span>{{ formatTime(currentTime()) }} / {{ formatTime(duration()) }}</span>
                </div>

                    <div class="mt-0 flex items-center gap-1.5 overflow-x-auto whitespace-nowrap pb-0.5">
                    @for (tag of (m.tags || []); track tag) {
                      <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-[11px] font-semibold text-zinc-700 dark:text-zinc-200 shrink-0">
                        {{ tag }}
                        <button class="ml-0.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100" (click)="removeTag(tag, $event)" title="移除">
                          <app-icon name="x" [size]="12"></app-icon>
                        </button>
                      </span>
                    }

                   @if (tagEditing()) {
                      <input
                        class="h-6 w-32 sm:w-40 px-2 rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[11px] text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                       placeholder="添加标签"
                       [ngModel]="tagDraft()"
                       (ngModelChange)="tagDraft.set($event)"
                       (keydown.enter)="addTagFromDraft($event)"
                     />
                      <button class="h-6 px-2 rounded-full text-[11px] font-bold bg-zinc-900 text-white dark:bg-white dark:text-black" (click)="addTagFromDraft($event)">OK</button>
                      <button class="h-6 px-2 rounded-full text-[11px] font-semibold border border-zinc-200 dark:border-zinc-800" (click)="cancelTagEdit($event)">取消</button>
                   } @else {
                      <button class="h-6 px-2 rounded-full text-[11px] font-semibold border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors" (click)="startTagEdit($event)">
                        <span class="inline-flex items-center gap-1"><app-icon name="plus" [size]="12"></app-icon> 标签</span>
                      </button>
                   }
                 </div>
             </div>
           </div>
          
            <div class="flex items-center gap-2 shrink-0">
              <!-- Primary Actions -->
              <button
                class="h-8 px-3 flex items-center gap-2 bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-md text-xs font-semibold transition-colors border border-zinc-200 dark:border-zinc-800 btn-press"
                (click)="exportMedia(); $event.stopPropagation()"
                [disabled]="exporting()"
              >
                 <app-icon name="download" [size]="14"></app-icon>
                 <span class="hidden sm:inline">导出</span>
              </button>

              <div class="relative" (click)="$event.stopPropagation()">
                <button
                  class="h-8 w-8 flex items-center justify-center rounded-md text-zinc-500 transition-colors btn-press"
                  [class.bg-zinc-100]="moreMenuOpen()"
                  [class.dark:bg-zinc-800]="moreMenuOpen()"
                  [class.hover:bg-zinc-100]="!moreMenuOpen()"
                  [class.dark:hover:bg-zinc-800]="!moreMenuOpen()"
                  (click)="toggleMoreMenu($event)"
                >
                   <app-icon name="more-horizontal" [size]="18"></app-icon>
                </button>

                @if (moreMenuOpen()) {
                  <div class="absolute right-0 mt-2 w-44 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl py-1 z-30">
                    <button class="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200" (click)="exportMedia(); moreMenuOpen.set(false)">导出…</button>
                    <button class="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200" (click)="openStorageLocation(); moreMenuOpen.set(false)">打开存储位置</button>
                    <button class="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200" (click)="config.settingsOpen.set(true); moreMenuOpen.set(false)">设置</button>
                    <div class="h-px bg-zinc-100 dark:bg-zinc-800 my-1"></div>
                    <button class="w-full text-left px-3 py-2 text-sm hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400" (click)="deleteMedia(); moreMenuOpen.set(false)">删除</button>
                  </div>
                }
              </div>
           </div>
        </div>
        }

        <!-- Main Workspace -->
        <div class="flex-1 flex overflow-hidden">
          
          <!-- Left: Player & Visualization Stage -->
           <div class="flex-1 flex flex-col bg-[#fafafa] dark:bg-[#0c0c0e] overflow-hidden relative" [class.p-6]="!pseudoFullscreen()" [class.p-0]="pseudoFullscreen()">

             @if (activeJobBanner(); as jb) {
               <div class="absolute top-4 left-4 right-4 z-40 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900/80 backdrop-blur-md p-3">
                 <div class="flex items-center justify-between gap-3">
                   <div class="min-w-0">
                     <div class="text-[10px] font-bold uppercase tracking-widest text-zinc-400">processing</div>
                     <div class="text-xs font-semibold text-zinc-800 dark:text-zinc-100 truncate">
                        {{
                          jb.type === 'transcription' ? '转写'
                          : jb.type === 'optimize' ? '转写优化'
                          : jb.type === 'summary' ? 'AI 总结'
                           : jb.type === 'download' ? '下载'
                           : jb.type === 'export' ? '导出'
                           : jb.type === 'import' ? '导入'
                           : jb.type === 'subtitle' ? '字幕'
                           : '任务'
                         }}：{{ jb.message || '处理中…' }}
                      </div>
                   </div>
                   <div class="text-xs font-mono text-zinc-500 tabular-nums">{{ jb.progress }}%</div>
                 </div>
                 <div class="mt-2 h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                   <div class="h-full bg-zinc-900 dark:bg-white transition-all duration-300" [style.width.%]="jb.progress"></div>
                 </div>
               </div>
             }
            
            <div class="flex-1 flex flex-col min-h-0 w-full h-full">
              
              @if (m.type === 'video') {
                <!-- Video Player: Immersive with subtle border -->
                    <div
                      #playerContainer
                      class="vecho-player-surface flex-1 w-full bg-black rounded-xl shadow-sm overflow-hidden relative group ring-1 ring-zinc-200 dark:ring-zinc-800 flex items-center justify-center"
                      (click)="onPlayerStageClick($event)"
                      (mousemove)="onPlayerMouseMove()"
                      (mouseleave)="onPlayerMouseLeave()"
                      [class.cursor-none]="isPlaying() && !playerControlsVisible()"
                      [class.vecho-pseudo-fullscreen]="pseudoFullscreen()"
                      [class.rounded-none]="isFullscreen()"
                      [class.ring-0]="isFullscreen()"
                    >
                     @if (playerSrc(); as src) {
                        <video
                          #videoEl
                          class="absolute inset-0 w-full h-full bg-black pointer-events-none"
                          [class.object-contain]="!isFullscreen()"
                          [class.object-cover]="isFullscreen()"
                          [src]="src"
                          [attr.poster]="m.thumbnail || null"
                         preload="metadata"
                         playsinline
                         (timeupdate)="onTimeUpdate($event)"
                         (loadedmetadata)="onLoadedMetadata($event)"
                         (loadeddata)="onLoadedData($event)"
                         (play)="onPlay()"
                         (pause)="onPause()"
                         (ended)="onEnded()"
                         (error)="onMediaError($event)"
                       ></video>
                      } @else {
                        @if (m.thumbnail) {
                          <img [src]="m.thumbnail" class="absolute inset-0 w-full h-full object-cover opacity-40 grayscale" alt="Cover" draggable="false" />
                        } @else {
                          <div class="absolute inset-0 w-full h-full flex items-center justify-center bg-black/40">
                            <app-icon name="video" [size]="56" class="text-white/30"></app-icon>
                          </div>
                        }
                      }

                      @if (ccDisplayText(); as cc) {
                        <div
                          class="absolute px-4 select-none"
                          [ngStyle]="ccOverlayStyle()"
                          [style.pointerEvents]="ccSettingsOpen() ? 'auto' : 'none'"
                          style="left: var(--cc-x); top: var(--cc-y); transform: translate(-50%, -50%);"
                        >
                          <div
                            class="max-w-4xl text-center font-medium drop-shadow-[0_2px_10px_rgba(0,0,0,0.65)] backdrop-blur-sm rounded-lg px-4 py-2 relative"
                            [class.cursor-move]="ccSettingsOpen()"
                            [style.outline]="ccSettingsOpen() ? '2px dashed rgba(255,255,255,0.35)' : null"
                            [style.outlineOffset.px]="ccSettingsOpen() ? 2 : null"
                            style="font-size: var(--cc-font-size); color: var(--cc-color); background-color: rgba(0,0,0,var(--cc-bg));"
                            (mousedown)="ccDragStart($event)"
                          >
                            <span class="whitespace-pre-line">{{ cc }}</span>
                            @if (ccSettingsOpen()) {
                              <div
                                class="absolute -bottom-2 -right-2 w-5 h-5 rounded bg-white/20 border border-white/30 cursor-nwse-resize"
                                title="拖动缩放"
                                (mousedown)="ccResizeStart($event)"
                              ></div>
                            }
                          </div>
                        </div>
                      }
                      
                      @if (!isPlaying()) {
                      <div class="z-10 text-center pointer-events-none">
                          <div
                            class="w-16 h-16 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center mx-auto mb-4 scale-95 group-hover:scale-100 transition-transform cursor-pointer pointer-events-auto hover:bg-white/20"
                            (click)="togglePlayback($event)"
                            [class.opacity-50]="!playerSrc()"
                            [class.cursor-not-allowed]="!playerSrc()"
                          >
                              @if (isPlaying()) {
                                <app-icon name="pause" [size]="28" class="text-white fill-white"></app-icon>
                              } @else {
                                <app-icon name="play" [size]="28" class="text-white fill-white ml-1"></app-icon>
                              }
                          </div>
                          @if (!isPlaying()) {
                            <h2 class="text-white/80 font-medium tracking-wide text-lg">{{ m.name }}</h2>
                          }
                          @if (playerHint(); as hint) {
                            <div class="mt-2 inline-flex items-center gap-2 text-xs text-white/60">
                              @if (playerResolving() || playerLoading()) {
                                <app-icon name="rotate-cw" [size]="14" class="animate-spin"></app-icon>
                              }
                              <span>{{ hint }}</span>
                            </div>
                          }
                     </div>
                     }

                   <!-- Bottom Controls Overlay -->
                    <div
                      class="vecho-player-controls absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 via-black/40 to-transparent transition-opacity duration-200"
                      [class.opacity-0]="!playerControlsVisible()"
                      [class.pointer-events-none]="!playerControlsVisible()"
                    >
                      <div class="flex items-center gap-4 mb-2">
                          <span class="text-xs font-mono text-zinc-300">{{ formatTime(currentTime()) }}</span>
                           <div class="flex-1 h-1 bg-white/20 rounded-full cursor-pointer relative group/scrubber hover:h-1.5 transition-[height]" (click)="onSeek($event, duration())">
                              <div class="absolute h-full bg-white rounded-full" [style.width.%]="progressPct()"></div>
                           </div>
                           <span class="text-xs font-mono text-zinc-300">{{ formatTime(duration()) }}</span>
                      </div>
                      
                      <div class="flex items-center justify-between text-white">
                         <div class="flex items-center gap-4">
                             <button class="hover:text-zinc-200" (click)="togglePlayback($event)">
                               @if (isPlaying()) {
                                 <app-icon name="pause" [size]="20" class="fill-current"></app-icon>
                               } @else {
                                 <app-icon name="play" [size]="20" class="fill-current"></app-icon>
                               }
                             </button>
                             <button class="hover:text-zinc-200" (click)="toggleMute($event)">
                               <app-icon [name]="isMuted() ? 'volume-x' : 'volume-2'" [size]="18"></app-icon>
                             </button>
                         </div>
                          <div class="flex items-center gap-3">
                              <button (click)="addQuickBookmark()" class="bg-white/10 hover:bg-white/20 p-1.5 rounded text-white transition-colors" [title]="config.t().common.bookmark">
                                 <app-icon name="bookmark" [size]="16"></app-icon>
                              </button>
                               <button (click)="addNote()" class="bg-white/10 hover:bg-white/20 p-1.5 rounded text-white transition-colors" [title]="config.t().common.note">
                                  <app-icon name="file-text" [size]="16"></app-icon>
                               </button>
                               <button (click)="toggleCcMenu($event)" class="bg-white/10 hover:bg-white/20 px-2 py-1.5 rounded text-white transition-colors text-[11px] font-black tracking-wider" [class.opacity-80]="ccEnabled()" title="字幕/CC">
                                  CC
                               </button>
                               <button (click)="togglePiP($event)" class="bg-white/10 hover:bg-white/20 p-1.5 rounded text-white transition-colors"
                                 [class.opacity-40]="!pipAvailable()" [class.cursor-not-allowed]="!pipAvailable()" title="画中画">
                                  <app-icon name="pip" [size]="16"></app-icon>
                               </button>
                              <button (click)="toggleFullscreen($event)" class="bg-white/10 hover:bg-white/20 p-1.5 rounded text-white transition-colors" title="全屏">
                                 <app-icon name="maximize" [size]="16"></app-icon>
                              </button>
                    </div>

                    @if (ccMenuOpen()) {
                      <div class="absolute bottom-[90px] right-6 z-30" (click)="$event.stopPropagation()">
                        <div class="w-56 rounded-lg border border-white/10 bg-black/70 backdrop-blur-md shadow-2xl overflow-hidden">
                          <button class="w-full text-left px-3 py-2 text-[12px] font-semibold text-white/90 hover:bg-white/10" (click)="setCcTrack('off', $event)">关闭字幕</button>
                          <div class="h-px bg-white/10"></div>
                          @for (tr of availableSubtitleTracks(); track tr.id) {
                            <button
                              class="w-full text-left px-3 py-2 text-[12px] text-white/90 hover:bg-white/10 flex items-center justify-between"
                              (click)="setCcTrack(tr.id, $event)"
                            >
                              <span class="truncate">{{ tr.label || tr.id }}</span>
                              @if (subtitleTrackId() === tr.id && ccEnabled()) {
                                <span class="text-[10px] font-black tracking-wider text-white/70">ON</span>
                              }
                            </button>
                          }
                          <div class="h-px bg-white/10"></div>
                          <button class="w-full text-left px-3 py-2 text-[12px] text-white/90 hover:bg-white/10" (click)="ccSettingsOpen.set(true); ccMenuOpen.set(false)">字幕样式…</button>
                          <button class="w-full text-left px-3 py-2 text-[12px] text-white/90 hover:bg-white/10" (click)="translateSubtitlesToZh(); ccMenuOpen.set(false)">一键翻译中文</button>
                        </div>
                      </div>
                    }

                    @if (ccSettingsOpen()) {
                      <div class="absolute inset-0 z-40 pointer-events-none">
                        <div class="absolute inset-0 bg-black/30"></div>
                        <div class="absolute right-6 bottom-[90px] w-80 rounded-xl border border-white/10 bg-black/75 backdrop-blur-md shadow-2xl p-4 pointer-events-auto">
                          <div class="flex items-center justify-between">
                            <div class="text-sm font-bold text-white/90">字幕样式（可在画面中拖动/缩放）</div>
                            <button class="p-1 rounded hover:bg-white/10 text-white/70" (click)="ccSettingsOpen.set(false)"><app-icon name="x" [size]="14"></app-icon></button>
                          </div>

                          <div class="mt-3 space-y-3 text-white/80">
                            <div>
                              <div class="flex items-center justify-between text-[11px] font-semibold"><span>字体大小</span><span class="font-mono">{{ ccStyle().fontSize }}px</span></div>
                              <input type="range" min="12" max="72" [ngModel]="ccStyle().fontSize" (ngModelChange)="ccStyle.set({ ...ccStyle(), fontSize: +$event })" class="w-full" />
                            </div>

                            <div class="grid grid-cols-2 gap-3">
                              <div>
                                <div class="flex items-center justify-between text-[11px] font-semibold"><span>水平位置</span><span class="font-mono">{{ Math.round((ccStyle().x || 0.5) * 100) }}%</span></div>
                                <input type="range" min="5" max="95" [ngModel]="Math.round((ccStyle().x || 0.5) * 100)" (ngModelChange)="ccStyle.set({ ...ccStyle(), x: (+$event) / 100 })" class="w-full" />
                              </div>
                              <div>
                                <div class="flex items-center justify-between text-[11px] font-semibold"><span>垂直位置</span><span class="font-mono">{{ Math.round((ccStyle().y || 0.85) * 100) }}%</span></div>
                                <input type="range" min="5" max="95" [ngModel]="Math.round((ccStyle().y || 0.85) * 100)" (ngModelChange)="ccStyle.set({ ...ccStyle(), y: (+$event) / 100 })" class="w-full" />
                              </div>
                            </div>

                            <div>
                              <div class="flex items-center justify-between text-[11px] font-semibold"><span>背景透明</span><span class="font-mono">{{ ccStyle().bgOpacity }}</span></div>
                              <input type="range" min="0" max="0.85" step="0.05" [ngModel]="ccStyle().bgOpacity" (ngModelChange)="ccStyle.set({ ...ccStyle(), bgOpacity: +$event })" class="w-full" />
                            </div>

                            <div>
                              <div class="flex items-center justify-between text-[11px] font-semibold"><span>文字颜色</span></div>
                              <div class="mt-1 flex items-center gap-2">
                                <button class="px-2 py-1 rounded bg-white/10 hover:bg-white/15 text-[11px]" (click)="ccStyle.set({ ...ccStyle(), color: '#ffffff' })">白</button>
                                <button class="px-2 py-1 rounded bg-white/10 hover:bg-white/15 text-[11px]" (click)="ccStyle.set({ ...ccStyle(), color: '#ffe08a' })">黄</button>
                                <button class="px-2 py-1 rounded bg-white/10 hover:bg-white/15 text-[11px]" (click)="ccStyle.set({ ...ccStyle(), color: '#a7f3d0' })">绿</button>
                                <input type="color" class="w-9 h-8 bg-transparent" [ngModel]="ccStyle().color" (ngModelChange)="ccStyle.set({ ...ccStyle(), color: $event })" />
                              </div>
                            </div>

                            <div class="flex items-center justify-end gap-2 pt-1">
                              <button class="h-8 px-3 rounded-md text-[11px] font-semibold bg-white/10 hover:bg-white/15" (click)="resetCcStyle()">重置</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    }
                 </div>
                   </div>
                </div>
              } @else {
                <!-- Audio Player: Compact Card Layout -->
                 <div class="w-full h-full flex items-center justify-center">
                     <div class="w-full max-w-4xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm p-8 flex flex-col gap-8">
                        @if (playerSrc(); as src) {
                          <audio
                            #audioEl
                            class="hidden"
                            [src]="src"
                            preload="metadata"
                            (timeupdate)="onTimeUpdate($event)"
                            (loadedmetadata)="onLoadedMetadata($event)"
                            (loadeddata)="onLoadedData($event)"
                            (play)="onPlay()"
                            (pause)="onPause()"
                            (ended)="onEnded()"
                            (error)="onMediaError($event)"
                          ></audio>
                        }
                         
                        <!-- Header Info -->
                       <div class="flex items-center gap-6">
                           <div class="w-20 h-20 bg-zinc-100 dark:bg-zinc-800 rounded-xl flex items-center justify-center shrink-0 border border-zinc-200 dark:border-zinc-700">
                               <app-icon name="music" [size]="32" class="text-zinc-400"></app-icon>
                           </div>
                            <div>
                                <h1 class="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-1">{{ m.name }}</h1>
                                <div class="flex items-center gap-3 text-xs text-zinc-500 font-mono">
                                    <span class="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">MP3</span>
                                    <span>{{ formatTime(duration()) }}</span>
                                    <span>•</span>
                                    <span>44.1kHz / 320kbps</span>
                                </div>
                                @if (playerHint(); as hint) {
                                  <div class="mt-2 inline-flex items-center gap-2 text-xs text-zinc-500">
                                    @if (playerResolving() || playerLoading()) {
                                      <app-icon name="rotate-cw" [size]="14" class="animate-spin"></app-icon>
                                    }
                                    <span>{{ hint }}</span>
                                  </div>
                                }
                            </div>
                        </div>

                       <!-- Waveform -->
                       <div class="relative h-32 w-full flex items-center justify-center gap-[3px] group cursor-pointer" 
                             (click)="onSeek($event, duration())"
                            #waveformContainer>
                          
                          <!-- Hover Line -->
                          <div class="absolute top-0 bottom-0 w-px bg-zinc-400 dark:bg-zinc-600 z-20 pointer-events-none hidden group-hover:block transition-all" [style.left.px]="hoverX"></div>
                          
                          <!-- Current Time Line -->
                           <div class="absolute top-0 bottom-0 w-[2px] bg-red-500 z-20 pointer-events-none shadow-[0_0_8px_rgba(239,68,68,0.4)]"
                                [style.left.%]="progressPct()">
                             <div class="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-red-500 rounded-full"></div>
                          </div>

                          <!-- Generated Wave Bars -->
                          @for (bar of waveformBars; track $index) {
                             <div class="w-full rounded-full transition-all duration-300 pointer-events-none"
                                  [style.height.%]="bar.height"
                                   [class]="($index / waveformBars.length) < progressRatio() 
                                     ? 'bg-zinc-800 dark:bg-zinc-100' 
                                     : 'bg-zinc-200 dark:bg-zinc-800'">
                             </div>
                          }
                       </div>

                       <!-- Controls -->
                       <div class="flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800 pt-6">
                           <div class="font-mono text-sm font-bold text-zinc-900 dark:text-zinc-100 tabular-nums w-20">
                               {{ formatTime(currentTime()) }}
                           </div>

                           <div class="flex items-center gap-6">
                               <button class="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"><app-icon name="skip-back" [size]="24"></app-icon></button>
                                <button class="w-14 h-14 bg-black dark:bg-white text-white dark:text-black rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg" (click)="togglePlayback($event)">
                                    @if (isPlaying()) {
                                      <app-icon name="pause" [size]="24" class="fill-current"></app-icon>
                                    } @else {
                                      <app-icon name="play" [size]="24" class="fill-current ml-1"></app-icon>
                                    }
                                </button>
                               <button class="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"><app-icon name="skip-forward" [size]="24"></app-icon></button>
                           </div>

                           <div class="flex items-center gap-2">
                               <button (click)="addQuickBookmark()" class="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                                   <app-icon name="bookmark" [size]="14"></app-icon> 标记
                               </button>
                               <button (click)="addNote()" class="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                                   <app-icon name="file-text" [size]="14"></app-icon> 笔记
                               </button>
                           </div>
                       </div>
                    </div>
                </div>
              }
            </div>
          </div>

          <!-- Right: Professional Tab Panel -->
          <div class="w-[420px] border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0e] flex flex-col shrink-0" [class.hidden]="pseudoFullscreen()">
            
            <!-- Tab Headers: Clean Underline -->
            <div class="flex items-center px-6 border-b border-zinc-100 dark:border-zinc-800">
               <!-- Main Tabs -->
               <div class="flex gap-6">
                 @for (tab of tabs; track tab.id) {
                   <button 
                     (click)="activeTab.set(tab.id)"
                     class="py-4 relative text-xs font-semibold tracking-wide transition-colors focus:outline-none"
                     [class]="activeTab() === tab.id 
                       ? 'text-zinc-900 dark:text-zinc-100' 
                       : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'">
                     {{ tab.label }}
                     @if (activeTab() === tab.id) {
                        <div class="absolute bottom-0 left-0 right-0 h-[2px] bg-zinc-900 dark:bg-zinc-100"></div>
                     }
                   </button>
                 }
               </div>
            </div>

            <!-- Content Area -->
            <div class="flex-1 overflow-y-auto bg-zinc-50/30 dark:bg-black/20">
               
                <!-- Notes Tab (Timeline Stream) -->
                @if (activeTab() === 'notes') {
                   <div class="p-6 space-y-4">
                      @if (noteDockedOpen() && noteEditorId()) {
                        <div class="flex items-center justify-between">
                          <button class="h-8 px-3 rounded-md text-xs font-semibold border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                                  (click)="closeDockedNoteEditor()">
                            <span class="inline-flex items-center gap-1"><app-icon name="arrow-left" [size]="14"></app-icon> 返回</span>
                          </button>
                          <div class="flex items-center gap-2">
                            <div class="text-[11px] text-zinc-500">{{ noteAutosaveLabel() }}</div>
                            <button class="h-8 px-3 rounded-md text-xs font-semibold border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                                    (click)="detachNoteEditor()">
                              分离
                            </button>
                          </div>
                        </div>

                        <div class="space-y-3">
                          <input
                            class="w-full h-10 px-3 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                            [ngModel]="noteEditorTitle()"
                            (ngModelChange)="noteEditorTitle.set($event)"
                            placeholder="标题"
                          />

                          <div class="flex items-center justify-between gap-2">
                            <div class="h-9 px-3 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 flex items-center gap-2">
                              <span class="text-sm font-mono text-zinc-700 dark:text-zinc-200">{{ noteEditorTimestamp() !== null ? formatTime(noteEditorTimestamp()!) : '-' }}</span>
                              <button
                                class="h-7 px-2 rounded-md text-xs font-semibold border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                                (click)="applyCurrentTimeToNote()"
                              >
                                绑定当前
                              </button>
                            </div>
                          </div>

                          <app-vditor-note-editor
                            [value]="noteEditorContent()"
                            (valueChange)="noteEditorContent.set($event)"
                          ></app-vditor-note-editor>

                          <button
                            class="h-9 w-full rounded-md text-xs font-semibold border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-300 bg-white dark:bg-zinc-900 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            (click)="deleteNoteFromEditor()"
                          >
                            删除这条笔记
                          </button>
                        </div>
                      } @else {
                        @if (m.notes.length > 0) {
                           @for (note of m.notes; track note.id) {
                              <div class="relative group pl-6">
                                 <!-- Timeline Line -->
                                 <div class="absolute left-0 top-0 bottom-[-24px] w-px bg-zinc-200 dark:bg-zinc-800 group-last:bottom-0"></div>
                                 <!-- Timeline Dot -->
                                  <div class="absolute left-[-4px] top-4 w-[9px] h-[9px] rounded-full bg-white dark:bg-zinc-900 border-2 border-zinc-300 dark:border-zinc-600 group-hover:border-blue-500 group-hover:scale-110 transition-all cursor-pointer" 
                                       (click)="note.timestamp !== undefined && note.timestamp !== null && seekTo(note.timestamp)"></div>
   
                                 <div class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 hover:shadow-md hover:border-zinc-300 dark:hover:border-zinc-700 transition-all cursor-pointer" (click)="openNoteEditor(note.id, $event)">
                                    <div class="flex items-center justify-between mb-2">
                                       <div class="flex items-center gap-2">
                                           <span class="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-500 cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700" 
                                               (click)="note.timestamp !== undefined && note.timestamp !== null && seekTo(note.timestamp); $event.stopPropagation()">
                                              {{ (note.timestamp !== undefined && note.timestamp !== null) ? formatTime(note.timestamp) : '0:00' }}
                                           </span>
                                          <span class="text-xs font-medium text-zinc-400">用户笔记</span>
                                       </div>
                                        <div class="opacity-0 group-hover:opacity-100 flex items-center gap-1">
                                          <button class="h-7 w-7 flex items-center justify-center rounded-md text-zinc-300 hover:text-zinc-700 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" (click)="openNoteEditor(note.id, $event)" title="编辑">
                                            <app-icon name="edit-2" [size]="14"></app-icon>
                                          </button>
                                          <button class="h-7 w-7 flex items-center justify-center rounded-md text-zinc-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" (click)="deleteNote(note.id, $event)" title="删除">
                                            <app-icon name="trash" [size]="14"></app-icon>
                                          </button>
                                        </div>
                                    </div>
                                    <h3 class="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-1">{{ note.title }}</h3>
                                    <p class="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed vecho-clamp-2">{{ notePreview(note.content) }}</p>
                                 </div>
                              </div>
                           }
                        } @else {
                           <div class="text-center py-20">
                              <p class="text-sm text-zinc-400">在播放时点击 <app-icon name="file-text" [size]="12" class="inline"></app-icon> 即可添加笔记</p>
                           </div>
                        }
                      }
                   </div>
                }

                <!-- Bookmarks Tab (Card Stream) -->
                @if (activeTab() === 'bookmarks') {
                   <div class="p-6 space-y-3">
                      @if (m.bookmarks.length > 0) {
                         @for (bm of m.bookmarks; track bm.id) {
                            <div
                              class="group bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-sm transition-all cursor-pointer"
                              (click)="bookmarkEditingId() ? null : seekTo(bm.timestamp)"
                            >
                              <div class="flex items-start gap-3">
                                <div class="shrink-0 mt-0.5">
                                  <div class="px-2 py-0.5 rounded-md bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 text-[11px] font-mono font-bold tabular-nums">
                                    {{ formatTime(bm.timestamp) }}
                                  </div>
                                </div>

                                <div class="flex-1 min-w-0">
                                  <div class="flex items-center justify-between gap-2">
                                    @if (bookmarkEditingId() === bm.id) {
                                      <input
                                        data-bookmark-edit="1"
                                        class="flex-1 h-9 px-3 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                                        [ngModel]="bookmarkDraft()"
                                        (ngModelChange)="bookmarkDraft.set($event)"
                                        (click)="$event.stopPropagation()"
                                        (keydown.enter)="commitEditBookmark(bm, $event)"
                                        (keydown.escape)="cancelEditBookmark($event)"
                                      />
                                      <div class="flex items-center gap-1 shrink-0">
                                        <button class="h-9 px-3 rounded-md text-xs font-semibold bg-zinc-900 text-white dark:bg-white dark:text-black" (click)="commitEditBookmark(bm, $event)">保存</button>
                                        <button class="h-9 px-3 rounded-md text-xs font-semibold border border-zinc-200 dark:border-zinc-800" (click)="cancelEditBookmark($event)">取消</button>
                                      </div>
                                    } @else {
                                      <div class="min-w-0">
                                        <div class="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">{{ bm.label }}</div>
                                        @if (bookmarkSnippet(bm.timestamp); as snip) {
                                          <div class="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400 vecho-clamp-2">{{ snip }}</div>
                                        }
                                      </div>
                                      <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                        <button
                                          class="h-8 w-8 flex items-center justify-center rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-500"
                                          title="重命名"
                                          (click)="beginEditBookmark(bm, $event)"
                                        >
                                          <app-icon name="edit-2" [size]="14"></app-icon>
                                        </button>
                                        <button
                                          class="h-8 w-8 flex items-center justify-center rounded-md border border-red-200 dark:border-red-900/40 bg-white dark:bg-zinc-900 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600"
                                          title="删除"
                                          (click)="deleteBookmark(bm.id); $event.stopPropagation()"
                                        >
                                          <app-icon name="trash" [size]="14"></app-icon>
                                        </button>
                                      </div>
                                    }
                                  </div>
                                </div>
                              </div>
                            </div>
                         }
                      } @else {
                         <div class="text-center py-20">
                            <p class="text-sm text-zinc-400">点击波形图下方工具栏的 <app-icon name="bookmark" [size]="12" class="inline"></app-icon> 添加书签</p>
                         </div>
                      }
                   </div>
                }
               
                <!-- Transcript Tab -->
                @if (activeTab() === 'transcript') {
                   <div class="p-6">
                    <div class="flex items-center justify-between mb-4">
                    <div class="text-xs font-bold text-zinc-700 dark:text-zinc-200">转写 / 字幕</div>
                    <div class="flex items-center gap-2">
                           <select
                             class="h-8 px-2 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-200"
                             [ngModel]="subtitleTrackId()"
                             (ngModelChange)="subtitleTrackId.set($event)"
                             [disabled]="availableSubtitleTracks().length === 0"
                             title="选择字幕轨"
                           >
                             @for (tr of availableSubtitleTracks(); track tr.id) {
                               <option [value]="tr.id">{{ tr.label || tr.id }}</option>
                             }
                           </select>
                           <button
                             class="h-8 px-3 rounded-md text-xs font-semibold border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                             (click)="translateSubtitlesToZh()"
                             [disabled]="translatingSubtitles() || subtitleRunning() || !m.transcription || !tauri.isTauri()"
                             title="一次调用 AI 翻译为中文轨（生成 subtitles.json）"
                           >
                             @if (translatingSubtitles()) { 翻译中… } @else { 翻译中文 }
                           </button>
                           <button
                             class="h-8 px-3 rounded-md text-xs font-semibold border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                             (click)="config.settingsOpen.set(true)"
                           >
                             设置
                           </button>
                          <button
                            class="h-8 px-3 rounded-md text-xs font-semibold border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            (click)="runOptimizeTranscription()"
                            [disabled]="!m.transcription || optimizing() || optimizeRunning() || transcriptionRunning() || !tauri.isTauri()"
                            title="用 AI 修正常见误识别/专有名词"
                          >
                            @if (optimizing() || optimizeRunning()) { 优化中… } @else { AI 优化 }
                          </button>
                          <button
                             class="h-8 px-3 rounded-md text-xs font-semibold bg-zinc-900 text-white dark:bg-white dark:text-black hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                             (click)="openTranscriptionDialog()"
                             [disabled]="transcribing() || transcriptionRunning() || !tauri.isTauri()"
                          >
                             @if (transcribing() || transcriptionRunning()) { 生成中… } @else { {{ m.transcription ? '重新生成' : '生成转写' }} }
                          </button>
                    </div>
                  </div>

                 @if (m.transcription) {
                   <div class="mb-3 text-[11px] text-zinc-500 flex flex-wrap items-center gap-2">
                     <span class="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 font-mono">lang: {{ m.transcription.language || 'auto' }}</span>
                     @if (m.transcription.model) {
                       <span class="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 font-mono">{{ m.transcription.model }}</span>
                     }
                     <span>生成于 {{ formatDateTime(m.transcription.generatedAt) }}</span>
                   </div>
                 }

                      @if (transcriptionJob(); as j) {
                        @if (j.status === 'pending' || j.status === 'processing') {
                          <div class="mb-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                            <div class="flex items-center justify-between gap-3">
                              <div class="flex items-center gap-2 min-w-0">
                                <app-icon name="mic" [size]="14" class="text-zinc-400 shrink-0"></app-icon>
                                <div class="text-xs font-semibold text-zinc-700 dark:text-zinc-200 truncate">
                                  {{ j.message || '处理中…' }}
                                </div>
                              </div>
                              <div class="text-xs font-mono text-zinc-500 tabular-nums">{{ j.progress }}%</div>
                            </div>
                            <div class="mt-3 h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                              <div class="h-full bg-zinc-900 dark:bg-white transition-all duration-300" [style.width.%]="j.progress"></div>
                            </div>
                          </div>
                        }

                        @if (j.status === 'failed') {
                          <div class="mb-4 rounded-lg border border-red-200 dark:border-red-900/40 bg-white dark:bg-zinc-900 p-4">
                            <div class="text-sm font-semibold text-red-700 dark:text-red-300">转写失败</div>
                            <div class="mt-1 text-xs text-red-600 dark:text-red-300/80 whitespace-pre-wrap">{{ j.error || j.message || '转写失败' }}</div>
                            <div class="mt-3">
                              <button
                                class="h-8 px-3 rounded-md text-xs font-semibold bg-zinc-900 text-white dark:bg-white dark:text-black hover:opacity-90 transition-opacity"
                                (click)="openTranscriptionDialog()"
                              >
                                重试
                              </button>
                            </div>
                          </div>
                        }
                      }

                      @if (subtitleJob(); as sj) {
                        @if (sj.status === 'pending' || sj.status === 'processing') {
                          <div class="mb-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                            <div class="flex items-center justify-between gap-3">
                              <div class="flex items-center gap-2 min-w-0">
                                <app-icon name="languages" [size]="14" class="text-zinc-400 shrink-0"></app-icon>
                                <div class="text-xs font-semibold text-zinc-700 dark:text-zinc-200 truncate">
                                  {{ sj.message || '字幕翻译中…' }}
                                </div>
                              </div>
                              <div class="text-xs font-mono text-zinc-500 tabular-nums">{{ sj.progress }}%</div>
                            </div>
                            <div class="mt-3 h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                              <div class="h-full bg-zinc-900 dark:bg-white transition-all duration-300" [style.width.%]="sj.progress"></div>
                            </div>
                          </div>
                        }

                        @if (sj.status === 'failed') {
                          <div class="mb-4 rounded-lg border border-red-200 dark:border-red-900/40 bg-white dark:bg-zinc-900 p-4">
                            <div class="text-sm font-semibold text-red-700 dark:text-red-300">字幕翻译失败</div>
                            <div class="mt-1 text-xs text-red-600 dark:text-red-300/80 whitespace-pre-wrap">{{ sj.error || sj.message || '字幕翻译失败' }}</div>
                          </div>
                        }
                      }

                      @if (!tauri.isTauri()) {
                        <div class="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 text-sm text-zinc-500">
                          Web 预览模式不支持本地转写；请在桌面端运行。
                        </div>
                      } @else {
                        @if (!m.transcription) {
                          <div class="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                            <div class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">还没有转写</div>
                               <div class="mt-1 text-xs text-zinc-500">
                                当前引擎：{{
                                  state.settings().transcription.engine === 'local_sherpa_onnx' ? '本地 SenseVoice（sherpa-onnx）'
                                  : state.settings().transcription.engine === 'local_whisper_cpp' ? '本地 Whisper（whisper.cpp）'
                                  : 'OpenAI 兼容云端'
                                }}
                               </div>
                          </div>
                        } @else {
                           <div class="space-y-1">
                             @for (seg of transcriptSegments(); track seg.id) {
                               <div class="flex gap-4 p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors group" (click)="seekTo(seg.start)">
                                 <span class="text-xs font-mono text-zinc-400 shrink-0 w-10 pt-0.5">{{ formatTime(seg.start) }}</span>
                                 <p class="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed group-hover:text-zinc-900 dark:group-hover:text-zinc-100">{{ seg.text }}</p>
                               </div>
                             }
                           </div>
                        }
                      }
                   </div>
                }

                <!-- AI Summary -->
                @if (activeTab() === 'summary') {
                   <div class="p-8">
                       <div class="flex items-center justify-between mb-4">
                         <div class="text-xs font-bold text-zinc-700 dark:text-zinc-200">AI 总结</div>
                          <div class="flex items-center gap-2">
                            <select
                              class="h-8 px-2 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-200"
                              [ngModel]="summaryPromptId()"
                              (ngModelChange)="summaryPromptId.set($event)"
                              [disabled]="summarizing() || summaryRunning() || summaryRegenerating() || !tauri.isTauri()"
                              title="选择总结 Prompt"
                            >
                             @for (p of state.settings().ai.summaryPrompts; track p.id) {
                               <option [value]="p.id">{{ p.name }}</option>
                             }
                           </select>
                            <button
                              class="h-8 px-3 rounded-md text-xs font-semibold bg-zinc-900 text-white dark:bg-white dark:text-black hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                              (click)="runSummary()"
                              [disabled]="summarizing() || summaryRunning() || summaryRegenerating() || !tauri.isTauri() || !m.transcription"
                            >
                              @if (summarizing() || summaryRunning()) { 生成中… } @else { {{ m.summary ? '重新生成' : '生成总结' }} }
                            </button>

                            @if (m.summary) {
                              <button
                                class="h-8 px-3 rounded-md text-xs font-semibold border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                (click)="regenerateSummaryDiagram('timeline')"
                                [disabled]="summarizing() || summaryRunning() || !!summaryRegenerating() || !tauri.isTauri() || !m.transcription"
                                title="仅重生成第一个 mermaid 图（时间轴）"
                              >
                                @if (summaryRegenerating() === 'timeline') { 重生成中… } @else { 时间轴 }
                              </button>
                              <button
                                class="h-8 px-3 rounded-md text-xs font-semibold border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                (click)="regenerateSummaryDiagram('mindmap')"
                                [disabled]="summarizing() || summaryRunning() || !!summaryRegenerating() || !tauri.isTauri() || !m.transcription"
                                title="仅重生成第二个 mermaid 图（思维导图）"
                              >
                                @if (summaryRegenerating() === 'mindmap') { 重生成中… } @else { 思维导图 }
                              </button>
                            }
                          </div>
                        </div>

                      @if (summaryJob(); as sj) {
                        @if (sj.status === 'pending' || sj.status === 'processing') {
                          <div class="mb-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                            <div class="flex items-center justify-between gap-3">
                              <div class="flex items-center gap-2 min-w-0">
                                <app-icon name="file-text" [size]="14" class="text-zinc-400 shrink-0"></app-icon>
                                <div class="text-xs font-semibold text-zinc-700 dark:text-zinc-200 truncate">
                                  {{ sj.message || '处理中…' }}
                                </div>
                              </div>
                              <div class="text-xs font-mono text-zinc-500 tabular-nums">{{ sj.progress }}%</div>
                            </div>
                            <div class="mt-3 h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                              <div class="h-full bg-zinc-900 dark:bg-white transition-all duration-300" [style.width.%]="sj.progress"></div>
                            </div>
                          </div>
                        }

                        @if (sj.status === 'failed') {
                          <div class="mb-4 rounded-lg border border-red-200 dark:border-red-900/40 bg-white dark:bg-zinc-900 p-4">
                            <div class="text-sm font-semibold text-red-700 dark:text-red-300">AI 总结失败</div>
                            <div class="mt-1 text-xs text-red-600 dark:text-red-300/80 whitespace-pre-wrap">{{ sj.error || sj.message || 'AI 总结失败' }}</div>
                            <div class="mt-3">
                              <button
                                class="h-8 px-3 rounded-md text-xs font-semibold bg-zinc-900 text-white dark:bg-white dark:text-black hover:opacity-90 transition-opacity"
                                (click)="runSummary()"
                              >
                                重试
                              </button>
                            </div>
                          </div>
                        }
                      }

                      @if (!m.transcription) {
                        <div class="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                          <div class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">需要先生成转写</div>
                          <div class="mt-2">
                            <button
                              class="h-8 px-3 rounded-md text-xs font-semibold border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                              (click)="activeTab.set('transcript')"
                            >
                              去转写
                            </button>
                          </div>
                        </div>
                      } @else {
                        @if (m.summary) {
                          <div class="space-y-5">
                            <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
                              <div class="text-xs font-bold text-zinc-700 dark:text-zinc-200 mb-3">✨ AI 核心摘要</div>
                              <app-markdown [content]="m.summary.content" [title]="m.name"></app-markdown>
                            </div>

                            @if (m.summary.keyPoints?.length) {
                              <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
                                <div class="text-xs font-bold text-zinc-700 dark:text-zinc-200 mb-3">要点</div>
                                <ul class="list-disc pl-5 space-y-1 text-sm text-zinc-700 dark:text-zinc-200">
                                  @for (kp of m.summary.keyPoints; track kp) {
                                    <li>{{ kp }}</li>
                                  }
                                </ul>
                              </div>
                            }

                            @if (m.summary.chapters?.length) {
                              <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
                                <div class="text-xs font-bold text-zinc-700 dark:text-zinc-200 mb-3">章节 / 时间轴</div>
                                <div class="space-y-2">
                                  @for (ch of m.summary.chapters; track ch.timestamp) {
                                    <div class="group flex items-start gap-3 p-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer" (click)="seekTo(ch.timestamp)">
                                      <span class="text-xs font-mono text-zinc-500 w-14 shrink-0 pt-0.5">{{ formatTime(ch.timestamp) }}</span>
                                      <div class="min-w-0">
                                        <div class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{{ ch.title }}</div>
                                        @if (ch.summary) {
                                          <div class="text-xs text-zinc-500 dark:text-zinc-300 mt-0.5 whitespace-pre-wrap">{{ ch.summary }}</div>
                                        }
                                      </div>
                                    </div>
                                  }
                                </div>
                              </div>
                            }
                          </div>
                        } @else {
                          <div class="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 text-sm text-zinc-500">
                            还没有总结；点击右上角生成。
                          </div>
                        }
                      }
                   </div>
                }

                <!-- AI Chat -->
                @if (activeTab() === 'chat') {
                  <div class="h-full flex flex-col">
                    <div class="p-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                      <div class="text-xs font-bold text-zinc-700 dark:text-zinc-200">AI 对话</div>
                      <button
                        class="h-8 px-3 rounded-md text-xs font-semibold border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                        (click)="newChat()"
                        [disabled]="!tauri.isTauri()"
                      >
                        新建
                      </button>
                    </div>

                    @if (!tauri.isTauri()) {
                      <div class="p-6 text-sm text-zinc-500">Web 预览模式不支持本地 AI 对话；请在桌面端运行。</div>
                    } @else {
                      <div class="p-4 border-b border-zinc-100 dark:border-zinc-800 bg-white dark:bg-[#0c0c0e]">
                        @if (activeConversation(); as chat) {
                          @if (chatEditingId() === chat.id) {
                            <div class="flex items-center gap-2">
                              <input
                                class="flex-1 h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                                [ngModel]="chatTitleDraft()"
                                (ngModelChange)="chatTitleDraft.set($event)"
                                (keydown.enter)="commitRenameChat(chat.id, $event)"
                              />
                              <button class="h-9 px-3 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-zinc-800" (click)="cancelRenameChat($event)">取消</button>
                              <button class="h-9 px-3 rounded-lg text-xs font-semibold bg-zinc-900 text-white dark:bg-white dark:text-black" (click)="commitRenameChat(chat.id, $event)">保存</button>
                            </div>
                          } @else {
                            <div class="flex items-center gap-2">
                              <select
                                class="flex-1 h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                                [ngModel]="chat.id"
                                (ngModelChange)="selectChat($event)"
                              >
                                @for (c of m.aiChats; track c.id) {
                                  <option [value]="c.id">{{ c.title }}</option>
                                }
                              </select>
                              <button class="h-9 w-9 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-500 inline-flex items-center justify-center leading-none" title="重命名" (click)="beginRenameChat(chat.id, $event)">
                                <app-icon name="edit-2" [size]="16"></app-icon>
                              </button>
                              <button class="h-9 w-9 rounded-lg border border-red-200 dark:border-red-900/40 bg-white dark:bg-zinc-900 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 inline-flex items-center justify-center leading-none" title="删除" (click)="deleteChat(chat.id, $event)">
                                <app-icon name="trash" [size]="16"></app-icon>
                              </button>
                            </div>
                             <div class="mt-2 flex items-center gap-3 text-[11px] text-zinc-500">
                               <label class="inline-flex items-center gap-1 cursor-pointer select-none">
                                 <input type="checkbox" class="accent-zinc-900" [checked]="chatIncludeTranscription()" (change)="chatIncludeTranscription.set($any($event.target).checked)" />
                                 <span>包含转写</span>
                               </label>
                               <label class="inline-flex items-center gap-1 cursor-pointer select-none">
                                 <input type="checkbox" class="accent-zinc-900" [checked]="chatIncludeSummary()" (change)="chatIncludeSummary.set($any($event.target).checked)" />
                                 <span>包含总结</span>
                               </label>
                               <span class="text-zinc-400">• 默认用 {{ config.lang() === 'zh' ? '中文' : 'English' }} 回复</span>
                             </div>
                           }
                        } @else {
                          <div class="text-sm text-zinc-500">暂无对话；点击上方“新建”。</div>
                        }
                      </div>

                       <div class="flex-1 overflow-y-auto p-4 space-y-3">
                         @if (activeConversation(); as chat) {
                           @if (chat.messages.length === 0) {
                             <div class="text-sm text-zinc-500">输入问题开始对话。</div>
                           }
                           @for (msg of chat.messages; track msg.id) {
                             <div class="flex" [class.justify-end]="msg.role === 'user'">
                              <div
                                class="max-w-[90%] rounded-2xl px-4 py-2"
                                [class]="msg.role === 'user'
                                  ? 'bg-zinc-900 text-white dark:bg-white dark:text-black'
                                  : 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-100'"
                              >
                                @if (msg.role === 'assistant' && (msg.content || '').length > 700) {
                                  <div class="flex items-center justify-between mb-1">
                                    <span class="text-[10px] font-bold text-zinc-500">AI</span>
                                    <button class="text-[10px] font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" (click)="toggleChatMsgCollapse(msg.id, $event)">
                                      {{ isChatMsgCollapsed(msg.id) ? '展开' : '收起' }}
                                    </button>
                                  </div>
                                  <app-markdown variant="compact" [content]="isChatMsgCollapsed(msg.id) ? chatMsgPreview(msg.content) : msg.content" [title]="m.name"></app-markdown>
                                } @else {
                                  <app-markdown variant="compact" [content]="msg.content" [title]="m.name"></app-markdown>
                                }
                              </div>
                            </div>
                           }

                           @if (chatSending()) {
                             <div class="flex">
                               <div class="max-w-[90%] rounded-2xl px-4 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-100">
                                 <div class="flex items-center gap-1.5">
                                   <span class="vecho-typing-dot w-1.5 h-1.5 rounded-full bg-zinc-400"></span>
                                   <span class="vecho-typing-dot w-1.5 h-1.5 rounded-full bg-zinc-400"></span>
                                   <span class="vecho-typing-dot w-1.5 h-1.5 rounded-full bg-zinc-400"></span>
                                 </div>
                               </div>
                             </div>
                           }
                         }
                       </div>

                      <div class="p-4 border-t border-zinc-100 dark:border-zinc-800 bg-white dark:bg-[#0c0c0e]">
                        <div class="flex gap-2 items-end">
                          <textarea
                            class="flex-1 min-h-[44px] max-h-32 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                            placeholder="问点什么…"
                            [ngModel]="chatDraft()"
                            (ngModelChange)="chatDraft.set($event)"
                            (keydown.enter)="onChatEnter($event)"
                          ></textarea>
                          <button
                            class="h-11 px-4 rounded-xl text-xs font-bold bg-zinc-900 text-white dark:bg-white dark:text-black hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                            (click)="sendChat()"
                            [disabled]="chatSending() || !chatDraft().trim() || !activeConversation()"
                          >
                            @if (chatSending()) { 发送中… } @else { 发送 }
                          </button>
                        </div>
                      </div>
                    }
                  </div>
                }

            </div>
          </div>
        </div>
          @if (noteEditorOpen()) {
            <div class="fixed inset-0 z-[170] pointer-events-none">
              <div
                #noteEditorBox
                class="absolute rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0e] shadow-2xl overflow-hidden pointer-events-auto"
                style="resize: both"
                [style.width.px]="noteEditorW()"
                [style.height.px]="noteEditorH()"
                [style.left.px]="noteEditorX()"
                [style.top.px]="noteEditorY()"
              >
               <div
                 class="h-10 px-3 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950/40 cursor-move select-none"
                 (mousedown)="noteEditorDragStart($event)"
               >
                  <div class="min-w-0 flex items-center gap-3">
                    <div class="text-xs font-bold text-zinc-700 dark:text-zinc-200 truncate">笔记</div>
                    <div class="text-[11px] font-mono text-zinc-500 truncate">{{ noteEditorHint() }}</div>
                  </div>
                  <div class="flex items-center gap-2">
                    <div class="text-[11px] text-zinc-500">{{ noteAutosaveLabel() }}</div>
                    <button
                      class="h-8 px-3 rounded-md text-xs font-semibold border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                      (click)="dockNoteEditor()"
                    >
                      停靠
                    </button>
                    @if (noteEditorId()) {
                      <button
                        class="h-8 px-3 rounded-md text-xs font-semibold border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-300 bg-white dark:bg-zinc-900 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        (click)="deleteNoteFromEditor()"
                      >
                        删除
                      </button>
                    }
                   <button class="h-8 w-8 flex items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors" (click)="closeNoteEditor()">
                      <app-icon name="x" [size]="18"></app-icon>
                    </button>
                 </div>
               </div>

                  <div class="h-[calc(100%-40px)] flex flex-col">
                 <div class="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-3">
                    <input
                      class="flex-1 h-9 px-3 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                      [ngModel]="noteEditorTitle()"
                      (ngModelChange)="noteEditorTitle.set($event)"
                      placeholder="标题"
                    />
                    <div class="h-9 px-3 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 flex items-center gap-2">
                     <span class="text-sm font-mono text-zinc-700 dark:text-zinc-200">{{ noteEditorTimestamp() !== null ? formatTime(noteEditorTimestamp()!) : '-' }}</span>
                     <button
                        class="h-7 px-2 rounded-md text-xs font-semibold border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                        (click)="applyCurrentTimeToNote()"
                      >
                        绑定当前
                      </button>
                    </div>
                  </div>

                  <div class="flex-1 min-h-0 overflow-auto p-3 bg-zinc-50/40 dark:bg-black/20">
                    <app-vditor-note-editor
                      [value]="noteEditorContent()"
                      (valueChange)="noteEditorContent.set($event)"
                    ></app-vditor-note-editor>
                  </div>
                  </div>

                  <!-- Resize handle (visual) -->
                  <div class="absolute bottom-0 right-0 w-6 h-6 pointer-events-none opacity-60"
                       style="background: linear-gradient(135deg, transparent 50%, rgba(120,120,120,0.35) 50%), linear-gradient(135deg, transparent 65%, rgba(120,120,120,0.25) 65%), linear-gradient(135deg, transparent 80%, rgba(120,120,120,0.18) 80%);"></div>
                </div>
              </div>
         }

       }
    </div>
  `
})
export class MediaDetailComponent implements OnInit, OnDestroy {
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private destroyRef = inject(DestroyRef);
    public config = inject(ConfigService);
    public state = inject(StateService);
    public tauri = inject(TauriService);
    private backend = inject(BackendService);
    private toast = inject(ToastService);
    private confirm = inject(ConfirmService);
    private sanitizer = inject(DomSanitizer);

    private formatError(err: unknown): string {
      if (err instanceof Error) return err.message;
      if (typeof err === 'string') return err;
      if (!err) return '未知错误';
      const anyErr = err as any;
      if (typeof anyErr?.message === 'string') return anyErr.message;
      if (typeof anyErr?.error === 'string') return anyErr.error;
      try {
        return JSON.stringify(err);
      } catch {
        return String(err);
      }
    }

    private readonly mediaId = signal<string | null>(null);

    media = computed(() => {
       const id = this.mediaId();
       if (!id) return null;
       return this.state.mediaItems().find(m => m.id === id) || null;
    });

   videoEl = viewChild<ElementRef<HTMLVideoElement>>('videoEl');
   audioEl = viewChild<ElementRef<HTMLAudioElement>>('audioEl');
   playerContainer = viewChild<ElementRef<HTMLElement>>('playerContainer');
   noteEditorBox = viewChild<ElementRef<HTMLElement>>('noteEditorBox');

   playerSrc = signal<SafeResourceUrl | null>(null);
   playerResolving = signal(false);
   playerLoading = signal(false);
   playerError = signal<string | null>(null);
   isPlaying = signal(false);
   isMuted = signal(false);
   domFullscreen = signal(false);
   windowFullscreen = signal(false);
   isFullscreen = computed(() => this.domFullscreen() || this.windowFullscreen());
   pseudoFullscreen = computed(() => this.windowFullscreen() && !this.domFullscreen());
   isPiP = signal(false);
   playerControlsVisible = signal(true);
   private playerControlsHideTimer: any = null;
   private playerDuration = signal<number | null>(null);

   duration = computed(() => {
      const d = this.playerDuration();
      if (typeof d === 'number' && isFinite(d) && d > 0) return d;
      const m = this.media();
      return m?.duration || 0;
   });

   progressPct = computed(() => {
      const dur = this.duration();
      if (!dur || dur <= 0) return 0;
      const pct = (this.currentTime() / dur) * 100;
      return Math.max(0, Math.min(100, pct));
   });

   progressRatio = computed(() => this.progressPct() / 100);

   playerHint = computed(() => {
      const m = this.media();
      if (!m) return null;
      if (this.playerError()) return '播放器加载失败（请检查文件是否存在）';
      if (this.playerResolving()) return '正在准备播放器...';
      if (this.playerLoading()) return '正在解析媒体...';
      if (this.playerSrc()) return null;
      if (!this.tauri.isTauri()) return 'Web 预览模式暂不支持本地播放';

      if (m.source.type === 'online') {
         return (m.source as any).cachedPath
            ? null
            : '此在线资源尚未下载到本地';
      }

      if (m.source.type === 'local') {
         return m.source.path ? null : '文件尚未导入到本地';
      }

      return null;
   });

   activeTab = signal<TabId>('notes');
   currentTime = signal(0);

   subtitles = signal<SubtitlesFile | null>(null);
   subtitlesLoading = signal(false);
   subtitleTrackId = signal<string>('original');
   ccEnabled = signal(false);
   ccMenuOpen = signal(false);
   ccSettingsOpen = signal(false);
   ccStyle = signal({
     fontSize: 18,
     x: 0.5,
     y: 0.85,
     color: '#ffffff',
     bgOpacity: 0.35,
   });
   translatingSubtitles = signal(false);

   subtitleTracks = computed<SubtitleTrack[]>(() => {
     const subs = this.subtitles();
     return subs?.tracks || [];
   });

   private transcriptionAsTrack(m: MediaItem | null): SubtitleTrack | null {
     if (!m?.transcription?.segments?.length) return null;
     const segs: SubtitleSegment[] = m.transcription.segments
       .filter(s => (s.text || '').trim())
       .map(s => ({
         id: s.id,
         start: Number(s.start) || 0,
         end: Number(s.end) || Number(s.start) || 0,
         text: (s.text || '').toString(),
       }));
     return {
       id: 'original',
       label: 'Original',
       language: m.transcription.language,
       kind: 'transcription',
       segments: segs,
     };
   }

   availableSubtitleTracks = computed<SubtitleTrack[]>(() => {
     const subs = this.subtitles();
     if (subs?.tracks?.length) {
       return subs.tracks.filter(t => (t.segments || []).length > 0);
     }
     const m = this.media();
     const t = this.transcriptionAsTrack(m);
     return t ? [t] : [];
   });

   selectedSubtitleTrack = computed<SubtitleTrack | null>(() => {
     const id = (this.subtitleTrackId() || '').trim();
     if (!id) return null;
     const tracks = this.availableSubtitleTracks();
     return tracks.find(t => t.id === id) || tracks[0] || null;
   });

   transcriptSegments = computed<Array<Pick<SubtitleSegment, 'id' | 'start' | 'end' | 'text'>>>(() => {
     const t = this.selectedSubtitleTrack();
     if (!t) {
       const m = this.media();
       return (m?.transcription?.segments || []).map(s => ({ id: s.id, start: s.start, end: s.end, text: s.text }));
     }
     return (t.segments || []).map(s => ({ id: s.id, start: s.start, end: s.end, text: s.text }));
   });

   activeSubtitleText = computed<string | null>(() => {
      if (!this.ccEnabled()) return null;
      const t = this.selectedSubtitleTrack();
      if (!t) return null;
     const segs = t.segments || [];
     if (!segs.length) return null;
     const cur = Number(this.currentTime()) || 0;

     // Binary search by start time.
     let lo = 0;
     let hi = segs.length - 1;
     let best = -1;
     while (lo <= hi) {
       const mid = (lo + hi) >> 1;
       const s = Number(segs[mid].start) || 0;
       if (s <= cur) {
         best = mid;
         lo = mid + 1;
       } else {
         hi = mid - 1;
       }
     }
     if (best < 0) return null;
     const seg = segs[best];
     const end = Number(seg.end) || Number(seg.start) || 0;
     if (cur < (Number(seg.start) || 0) || cur >= end) return null;
      const text = (seg.text || '').toString().trim();
      return text || null;
   });

   ccDisplayText = computed<string | null>(() => {
     const live = this.activeSubtitleText();
     if (live) return live;
     if (this.ccSettingsOpen()) return '字幕预览\nDrag / Resize';
     return null;
   });

   ccOverlayStyle = computed(() => {
     const s: any = this.ccStyle();
     const x = Number(s.x);
     const y = Number(s.y);
     return {
       '--cc-font-size': `${Math.max(10, Math.min(72, Number(s.fontSize) || 18))}px`,
       '--cc-x': `${Math.max(0.05, Math.min(0.95, isFinite(x) ? x : 0.5)) * 100}%`,
       '--cc-y': `${Math.max(0.05, Math.min(0.95, isFinite(y) ? y : 0.85)) * 100}%`,
       '--cc-color': (s.color || '#ffffff'),
       '--cc-bg': `${Math.max(0, Math.min(0.9, Number(s.bgOpacity) || 0))}`,
     } as any;
   });

   moreMenuOpen = signal(false);

    exporting = signal(false);

    transcriptionDialogOpen = signal(false);
    transcriptionDraft = signal<Pick<AppSettings['transcription'], 'language' | 'localAccelerator' | 'numThreads' | 'useItn'>>({
       language: 'auto',
       localAccelerator: 'auto',
       numThreads: 0,
       useItn: true,
    });

    patchTranscriptionDraft(patch: Partial<AppSettings['transcription']>): void {
       this.transcriptionDraft.update((prev) => {
         const next = { ...prev, ...patch } as any;
         if (typeof next.numThreads === 'number') {
           next.numThreads = Math.max(0, Math.min(64, Math.floor(next.numThreads || 0)));
         }
         return next;
       });
    }

   // Waveform Mock Data
   waveformBars: { height: number }[] = [];
   hoverX = 0;

   tabs = [
      { id: 'notes' as TabId, label: '笔记' },
      { id: 'bookmarks' as TabId, label: '书签' },
      { id: 'transcript' as TabId, label: '转写' },
      { id: 'summary' as TabId, label: 'AI 总结' },
      { id: 'chat' as TabId, label: 'AI 对话' },
   ];

   private latestJob(type: ProcessingJob['type']): ProcessingJob | null {
      const m = this.media();
      if (!m) return null;
      return this.state.processingJobs().find(j => j.mediaId === m.id && j.type === type) || null;
   }

   transcriptionJob = computed(() => this.latestJob('transcription'));
   optimizeJob = computed(() => this.latestJob('optimize'));
   summaryJob = computed(() => this.latestJob('summary'));
   subtitleJob = computed(() => this.latestJob('subtitle'));

   activeJobBanner = computed<ProcessingJob | null>(() => {
      const m = this.media();
      if (!m) return null;
      return this.state.processingJobs().find(j =>
        j.mediaId === m.id && (j.status === 'pending' || j.status === 'processing')
      ) || null;
   });

   transcriptionRunning = computed(() => {
      const j = this.transcriptionJob();
      return !!j && (j.status === 'pending' || j.status === 'processing');
   });

   optimizeRunning = computed(() => {
     const j = this.optimizeJob();
     return !!j && (j.status === 'pending' || j.status === 'processing');
   });

   summaryRunning = computed(() => {
      const j = this.summaryJob();
      return !!j && (j.status === 'pending' || j.status === 'processing');
   });

   subtitleRunning = computed(() => {
     const j = this.subtitleJob();
     return !!j && (j.status === 'pending' || j.status === 'processing');
   });

   transcribing = signal(false);
   optimizing = signal(false);
   summarizing = signal(false);
   summaryRegenerating = signal<'timeline' | 'mindmap' | null>(null);
   summaryPromptId = signal<string>('');
   chatSending = signal(false);
   chatDraft = signal('');
   activeChatId = signal<string | null>(null);
   chatEditingId = signal<string | null>(null);
   chatTitleDraft = signal('');

   chatIncludeTranscription = signal(true);
   chatIncludeSummary = signal(false);

   chatCollapsed = signal<Record<string, boolean>>({});

   isChatMsgCollapsed(id: string): boolean {
     const v = this.chatCollapsed()[id];
     // Default collapsed for long assistant outputs.
     return v === undefined ? true : !!v;
   }

   toggleChatMsgCollapse(id: string, evt?: Event): void {
     evt?.preventDefault();
     evt?.stopPropagation();
     const cur = this.chatCollapsed();
     const next = { ...cur, [id]: !cur[id] };
     this.chatCollapsed.set(next);
   }

   chatMsgPreview(content: string): string {
     const s = (content || '').trim();
     if (!s) return '';
     const lines = s.split(/\r?\n/);
     if (lines.length <= 10) return s;
     return lines.slice(0, 10).join('\n') + '\n…';
   }

   tagEditing = signal(false);
   tagDraft = signal('');


   // Note editor (floating panel)
   noteDockedOpen = signal(false);
   noteEditorOpen = signal(false);
   noteEditorId = signal<string | null>(null);
   noteEditorTitle = signal('');
   noteEditorContent = signal('');
   noteEditorTimestamp = signal<number | null>(null);
   noteEditorW = signal(720);
   noteEditorH = signal(520);
   noteEditorX = signal(0);
   noteEditorY = signal(0);
   noteAutosaving = signal(false);
   noteAutosavedAt = signal<number | null>(null);
   noteAutosaveLabel = computed(() => {
     if (this.noteAutosaving()) return '保存中…';
     const t = this.noteAutosavedAt();
     if (t && Date.now() - t < 2500) return '已保存';
     return '自动保存';
   });
   noteEditorHint = computed(() => {
     const id = this.noteEditorId();
     const ts = this.noteEditorTimestamp();
     const t = ts !== null ? this.formatTime(ts) : '-';
     return `${id ? id : 'new'} • ${t} • 自动保存`;
   });

    private noteDragActive = false;
    private noteDragOffsetX = 0;
    private noteDragOffsetY = 0;
   private noteResizeObserver: ResizeObserver | null = null;
   private noteAutosaveTimer: any = null;
   private noteLoading = false;

    notePreview(raw: string): string {
      const s = (raw || '').toString();
      if (!s.trim()) return '';
      // Drop code fences quickly.
      const noFences = s.replace(/```[\s\S]*?```/g, ' ');
      // Strip some common markdown tokens.
      const stripped = noFences
        .replace(/(^|\n)\s{0,3}#{1,6}\s+/g, ' ')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/(^|\n)\s*>\s?/g, ' ')
        .replace(/\[[^\]]+\]\([^\)]+\)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return stripped;
    }

    activeConversation = computed<AIConversation | null>(() => {
      const m = this.media();
      if (!m) return null;
      if (m.aiChats.length === 0) return null;
      const wanted = this.activeChatId();
      if (wanted) {
         return m.aiChats.find(c => c.id === wanted) || m.aiChats[m.aiChats.length - 1] || null;
      }
      return m.aiChats[m.aiChats.length - 1] || null;
    });

    beginRenameChat(chatId: string, event?: Event): void {
      event?.preventDefault();
      event?.stopPropagation();
      const m = this.media();
      if (!m) return;
      const chat = m.aiChats.find(c => c.id === chatId);
      if (!chat) return;
      this.chatEditingId.set(chatId);
      this.chatTitleDraft.set(chat.title || '');
    }

    commitRenameChat(chatId: string, event?: Event): void {
      event?.preventDefault();
      event?.stopPropagation();
      const m = this.media();
      if (!m) return;
      const title = this.chatTitleDraft().trim();
      if (!title) {
        this.chatEditingId.set(null);
        return;
      }
      this.state.renameAIConversation(m.id, chatId, title);
      this.chatEditingId.set(null);
      this.chatTitleDraft.set('');
    }

    cancelRenameChat(event?: Event): void {
      event?.preventDefault();
      event?.stopPropagation();
      this.chatEditingId.set(null);
      this.chatTitleDraft.set('');
    }

    async deleteChat(chatId: string, event?: Event): Promise<void> {
      event?.preventDefault();
      event?.stopPropagation();
      const m = this.media();
      if (!m) return;
      const chat = m.aiChats.find(c => c.id === chatId);
      const ok = await this.confirm.confirm({
        title: '删除对话',
        message: `确定要删除 “${chat?.title || '对话'}” 吗？`,
        confirmText: '删除',
        cancelText: '取消',
        danger: true,
      });
      if (!ok) return;
      this.state.deleteAIConversation(m.id, chatId);
      // if deleting active, fall back
      if (this.activeChatId() === chatId) {
        const next = m.aiChats.filter(c => c.id !== chatId);
        this.activeChatId.set(next.length ? next[next.length - 1].id : null);
      }
    }

    selectChat(chatId: string): void {
      this.activeChatId.set(chatId);
      this.activeTab.set('chat');
    }

    private playerSrcSeq = 0;
    private lastPlayerKey: string | null = null;

    private subtitlesSeq = 0;
    private lastSubtitlesMediaId: string | null = null;

    constructor() {
       // Make route params reactive even when the component instance is reused.
       this.mediaId.set(this.route.snapshot.paramMap.get('id'));
       this.route.paramMap
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((pm) => {
             const nextId = pm.get('id');
             if (nextId === this.mediaId()) return;
             this.mediaId.set(nextId);
             if (nextId) {
                this.state.setActiveMediaItem(nextId);
                this.generateWaveform();
             }
          });

       effect(() => {
          const m = this.media();
          void this.refreshPlayerSource(m);
          void this.refreshSubtitles(m);
       });

       effect(() => {
         const ai = this.state.settings().ai;
         const list = ai.summaryPrompts || [];
         const current = this.summaryPromptId();
         const fallback = ai.defaultSummaryPromptId || (list[0]?.id || '');
         if (!current) {
           this.summaryPromptId.set(fallback);
           return;
         }
         if (list.length && !list.some(p => p.id === current)) {
           this.summaryPromptId.set(fallback);
         }
       });

       effect(() => {
         // Autosave note edits (debounced)
         const id = this.noteEditorId();
         const open = this.noteDockedOpen() || this.noteEditorOpen();
         const _t = this.noteEditorTitle();
         const _c = this.noteEditorContent();
         const _ts = this.noteEditorTimestamp();
         if (!id || !open) return;
         this.scheduleNoteAutosave();
       });

       effect(() => {
         // Track detached note editor resizes
         const open = this.noteEditorOpen();
         const box = this.noteEditorBox()?.nativeElement;
         if (!open || !box) {
           if (this.noteResizeObserver) {
             this.noteResizeObserver.disconnect();
             this.noteResizeObserver = null;
           }
           return;
         }

         if (this.noteResizeObserver) return;
         this.noteResizeObserver = new ResizeObserver(() => {
           const el = this.noteEditorBox()?.nativeElement;
           if (!el) return;
           const r = el.getBoundingClientRect();
           const w = Math.max(420, Math.min(window.innerWidth - 16, Math.round(r.width)));
           const h = Math.max(320, Math.min(window.innerHeight - 16, Math.round(r.height)));
           if (Math.abs(w - this.noteEditorW()) > 1) this.noteEditorW.set(w);
           if (Math.abs(h - this.noteEditorH()) > 1) this.noteEditorH.set(h);
         });
         this.noteResizeObserver.observe(box);
       });
    }

    ngOnInit(): void {
       const id = this.mediaId();
       if (id) {
          this.state.setActiveMediaItem(id);
          this.generateWaveform();
       }

       void this.refreshFullscreenState();
    }

    ngOnDestroy(): void {
        this.endHold();
        this.flushNoteAutosave();
        if (this.playerControlsHideTimer) {
          clearTimeout(this.playerControlsHideTimer);
          this.playerControlsHideTimer = null;
        }
        if (this.noteAutosaveTimer) {
          clearTimeout(this.noteAutosaveTimer);
          this.noteAutosaveTimer = null;
        }
       if (this.noteResizeObserver) {
         this.noteResizeObserver.disconnect();
         this.noteResizeObserver = null;
       }
       this.pause();
       const m = this.media();
       if (m) {
          this.state.updateMediaItem(m.id, {
             lastPosition: this.currentTime()
          });
       }
   }

   generateWaveform() {
      // Generate 100 bars with random heights to simulate audio
      this.waveformBars = Array.from({ length: 80 }, () => ({
         height: Math.max(20, Math.random() * 100)
      }));
   }

   formatTime(seconds: number | undefined | null): string {
      if (seconds === undefined || seconds === null || isNaN(seconds)) return '0:00';
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
   }

   seekTo(timestamp: number): void {
      const dur = this.duration();
      const next = Math.max(0, Math.min(dur || timestamp, timestamp));
      this.currentTime.set(next);
      const el = this.activeMediaEl();
      if (el) {
         try {
            el.currentTime = next;
         } catch {
            // ignore
         }
      }
   }

   onSeek(event: MouseEvent, duration: number) {
      const element = event.currentTarget as HTMLElement;
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const percentage = x / rect.width;
      const dur = duration || this.duration();
      const newTime = percentage * (dur || 0);
      this.seekTo(newTime);
   }

   onTimeUpdate(event: Event): void {
      const el = event.target as HTMLMediaElement | null;
      if (!el) return;
      this.currentTime.set(el.currentTime || 0);
   }

   onLoadedMetadata(event: Event): void {
      const el = event.target as HTMLMediaElement | null;
      const m = this.media();
      if (!el || !m) return;

      this.playerLoading.set(false);

      this.isMuted.set(!!el.muted);

      const dur = Number(el.duration);
      if (isFinite(dur) && dur > 0) {
         this.playerDuration.set(dur);
         if (!m.duration || Math.abs(m.duration - dur) > 0.5) {
            this.state.updateMediaItem(m.id, { duration: dur });
         }
      }

      const resume = Number(m.lastPosition || 0);
      if (resume > 0 && isFinite(resume) && dur > 0 && resume < dur - 0.25) {
         // Only auto-seek if we're still at the beginning.
         if ((el.currentTime || 0) < 0.25) {
            try {
               el.currentTime = resume;
               this.currentTime.set(resume);
            } catch {
               // ignore
            }
         }
      }
   }

   onLoadedData(_: Event): void {
      // First frame (video) / first data (audio) is ready.
      this.playerLoading.set(false);
   }

   onMediaError(_: Event): void {
      this.playerError.set('media load error');
      this.playerLoading.set(false);
   }

    private showPlayerControls(autoHide: boolean = true): void {
      this.playerControlsVisible.set(true);
      if (this.playerControlsHideTimer) {
        clearTimeout(this.playerControlsHideTimer);
        this.playerControlsHideTimer = null;
      }
      if (!autoHide) return;
      if (!this.isPlaying()) return;

      this.playerControlsHideTimer = setTimeout(() => {
        // Hide only while playing.
        if (this.isPlaying()) {
          this.playerControlsVisible.set(false);
        }
      }, 1800);
    }

    onPlayerMouseMove(): void {
      this.showPlayerControls(true);
    }

    onPlayerMouseLeave(): void {
      if (this.isPlaying()) {
        this.playerControlsVisible.set(false);
      }
    }

   onPlay(): void {
      this.isPlaying.set(true);
      this.showPlayerControls(true);
   }

   onPause(): void {
      this.isPlaying.set(false);
      this.showPlayerControls(false);
   }

   onEnded(): void {
      this.isPlaying.set(false);
      this.showPlayerControls(false);
   }

    onPlayerStageClick(event: MouseEvent): void {
      const t = event.target as HTMLElement | null;
      if (!t) {
        this.togglePlayback(event);
        return;
      }
      // Ignore clicks inside controls (scrubber/buttons).
      if (t.closest('.vecho-player-controls')) return;
      this.togglePlayback(event);
    }

    togglePlayback(event?: Event): void {
      event?.preventDefault();
      event?.stopPropagation();

      this.showPlayerControls(true);

      const el = this.activeMediaEl();
      if (!el) return;

      if (el.paused) {
         const p = el.play();
         if (p && typeof (p as any).catch === 'function') {
            (p as Promise<void>).catch((err) => {
               console.error('play failed', err);
               this.playerError.set('play failed');
            });
         }
      } else {
         el.pause();
      }
   }

   toggleMute(event?: Event): void {
      event?.preventDefault();
      event?.stopPropagation();

      const el = this.activeMediaEl();
      if (!el) return;
      el.muted = !el.muted;
      this.isMuted.set(!!el.muted);
   }

   pipAvailable(): boolean {
      const docAny = document as any;
      const el = this.videoEl()?.nativeElement as any;
      return !!el && !!docAny.pictureInPictureEnabled && typeof el.requestPictureInPicture === 'function';
   }

   async togglePiP(event?: Event): Promise<void> {
      event?.preventDefault();
      event?.stopPropagation();

      const docAny = document as any;
      const el = this.videoEl()?.nativeElement as any;
      if (!el || !this.pipAvailable()) return;

      try {
         if (docAny.pictureInPictureElement) {
            await docAny.exitPictureInPicture();
            this.isPiP.set(false);
         } else {
            await el.requestPictureInPicture();
            this.isPiP.set(true);
         }
      } catch (err) {
         console.error('togglePiP failed', err);
      }
   }

   async toggleFullscreen(event?: Event): Promise<void> {
      event?.preventDefault();
      event?.stopPropagation();

      // If we're in Tauri window fullscreen (not DOM fullscreen), toggle it off.
      if (!document.fullscreenElement && this.windowFullscreen()) {
        await this.tauri.ready();
        if (this.tauri.isTauri()) {
          try {
            const win = await import('@tauri-apps/api/window');
            await win.getCurrentWindow().setFullscreen(false);
            this.windowFullscreen.set(false);
            this.domFullscreen.set(false);
            return;
          } catch (err) {
            console.error('toggle fullscreen (tauri exit) failed', err);
          }
        }
      }

      // Prefer true DOM fullscreen on the player container.
      try {
         if (document.fullscreenElement) {
            await document.exitFullscreen();
            this.domFullscreen.set(false);
            this.windowFullscreen.set(false);
            return;
         }
         const target = (this.playerContainer()?.nativeElement || this.videoEl()?.nativeElement) as any;
         if (target?.requestFullscreen) {
            await target.requestFullscreen();
            this.domFullscreen.set(true);
            this.windowFullscreen.set(false);
            return;
         }
      } catch (err) {
         console.error('toggle fullscreen failed', err);
      }

      // Fallback: Tauri window fullscreen if DOM fullscreen is not available.
      await this.tauri.ready();
      if (this.tauri.isTauri()) {
         try {
            const win = await import('@tauri-apps/api/window');
            const w = win.getCurrentWindow();
            const fs = await w.isFullscreen();
            await w.setFullscreen(!fs);
            this.windowFullscreen.set(!fs);
            this.domFullscreen.set(false);
         } catch (err) {
            console.error('toggle fullscreen (tauri) failed', err);
         }
      }
   }

   @HostListener('document:fullscreenchange')
   onFullscreenChange(): void {
      const dom = !!document.fullscreenElement;
      this.domFullscreen.set(dom);
      if (dom) {
        this.windowFullscreen.set(false);
      }
   }

    @HostListener('document:click')
    onDocumentClick(): void {
       if (this.moreMenuOpen()) this.moreMenuOpen.set(false);
       if (this.ccMenuOpen()) this.ccMenuOpen.set(false);
    }

   @HostListener('document:keydown.escape')
    onDocumentEsc(): void {
      if (this.noteEditorOpen()) {
        this.closeNoteEditor();
        return;
      }
      if (this.noteDockedOpen()) {
        this.closeDockedNoteEditor();
        return;
      }
       if (this.moreMenuOpen()) this.moreMenuOpen.set(false);
       if (this.ccMenuOpen()) this.ccMenuOpen.set(false);
    }

    private holdTimer: any = null;
    private scrubTimer: any = null;
    private holding: 'left' | 'right' | null = null;
    private wasPlayingBeforeHold = false;
    private savedPlaybackRate = 1;

    @HostListener('document:keydown', ['$event'])
    onKeyDown(evt: KeyboardEvent): void {
      const key = evt.key;

      // Space toggles play/pause.
      if (key === ' ' || key === 'Spacebar' || key === 'Space') {
        const target = evt.target as HTMLElement | null;
        if (target) {
          const tag = (target.tagName || '').toLowerCase();
          const isEditable = tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
          if (isEditable) return;
        }
        evt.preventDefault();
        this.togglePlayPause();
        return;
      }

      // Note editor shortcut.
      if ((evt.ctrlKey || evt.metaKey) && key.toLowerCase() === 's' && (this.noteDockedOpen() || this.noteEditorOpen())) {
        evt.preventDefault();
        this.flushNoteAutosave();
        return;
      }

      if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;

      const target = evt.target as HTMLElement | null;
      if (target) {
        const tag = (target.tagName || '').toLowerCase();
        const isEditable = tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
        if (isEditable) return;
      }

      // Prevent the page from scrolling.
      evt.preventDefault();

      // Ignore OS key repeat; we implement our own hold behavior.
      if (evt.repeat) return;

      const isLeft = key === 'ArrowLeft';
      const jump = evt.shiftKey ? 15 : 5;
      this.seekBy(isLeft ? -jump : jump);

      // Start hold behavior after a short delay.
      this.clearHoldTimers();
      this.holding = isLeft ? 'left' : 'right';
      this.holdTimer = setTimeout(() => {
        if (this.holding !== (isLeft ? 'left' : 'right')) return;
        this.beginHold(isLeft ? 'left' : 'right');
      }, 260);
    }

    @HostListener('document:keyup', ['$event'])
    onKeyUp(evt: KeyboardEvent): void {
      const key = evt.key;
      if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
      this.endHold();
    }

    private clearHoldTimers(): void {
      if (this.holdTimer) {
        clearTimeout(this.holdTimer);
        this.holdTimer = null;
      }
      if (this.scrubTimer) {
        clearInterval(this.scrubTimer);
        this.scrubTimer = null;
      }
    }

    private beginHold(dir: 'left' | 'right'): void {
      const el = this.activeMediaEl();
      if (!el) return;

      this.wasPlayingBeforeHold = !el.paused;
      this.savedPlaybackRate = el.playbackRate || 1;

      // Hold right: if playing, use playbackRate=3 for smooth forward.
      if (dir === 'right' && this.wasPlayingBeforeHold) {
        try { el.playbackRate = 3; } catch {}
        return;
      }

      // Hold left, or hold right while paused: scrub by seeking.
      if (this.wasPlayingBeforeHold) {
        try { el.pause(); } catch {}
      }

      const step = 0.5;      // seconds per tick
      const interval = 150;  // ms per tick (~3.3x)
      this.scrubTimer = setInterval(() => {
        this.seekBy(dir === 'left' ? -step : step);
      }, interval);
    }

    private endHold(): void {
      const el = this.activeMediaEl();
      const dir = this.holding;
      this.holding = null;
      this.clearHoldTimers();
      if (!el) return;

      // Restore playbackRate if we boosted it.
      if (dir === 'right' && this.wasPlayingBeforeHold) {
        try { el.playbackRate = this.savedPlaybackRate || 1; } catch {}
      }

      // If we paused for scrubbing, resume.
      if (this.wasPlayingBeforeHold && dir === 'left') {
        try { void el.play(); } catch {}
      }

      this.wasPlayingBeforeHold = false;
      this.savedPlaybackRate = 1;
    }

    private seekBy(deltaSeconds: number): void {
      const el = this.activeMediaEl();
      if (!el) return;
      const cur = Number(el.currentTime) || 0;
      const dur = Number.isFinite(el.duration) ? el.duration : this.duration();
      const next = cur + deltaSeconds;
      const clamped = dur && dur > 0 ? Math.max(0, Math.min(dur - 0.01, next)) : Math.max(0, next);
      try {
        el.currentTime = clamped;
      } catch {
        // ignore
      }
      this.currentTime.set(clamped);
    }

    private togglePlayPause(): void {
      const el = this.activeMediaEl();
      if (!el) return;
      if (el.paused) {
        try { void el.play(); } catch {}
      } else {
        try { el.pause(); } catch {}
      }
    }

   private async refreshFullscreenState(): Promise<void> {
      await this.tauri.ready();
      if (!this.tauri.isTauri()) return;
      try {
         const win = await import('@tauri-apps/api/window');
         const fs = await win.getCurrentWindow().isFullscreen();
         this.windowFullscreen.set(fs);
      } catch {
         // ignore
      }
   }

   pause(): void {
      const el = this.activeMediaEl();
      if (el && !el.paused) {
         el.pause();
      }
   }

   private activeMediaEl(): HTMLMediaElement | null {
      const m = this.media();
      if (!m) return null;
      const ref = m.type === 'video' ? this.videoEl() : this.audioEl();
      return ref?.nativeElement || null;
   }

   private playableFilePath(m: MediaItem): string | null {
      if (m.source.type === 'local') {
         return m.source.path || null;
      }
      if (m.source.type === 'online') {
         const cached = (m.source as any).cachedPath;
         return typeof cached === 'string' ? cached : null;
      }
      return null;
   }

   private isAbsolutePath(p: string): boolean {
      const s = (p || '').trim();
      if (!s) return false;
      if (s.startsWith('/') || s.startsWith('\\')) return true;
      // Windows drive letter.
      return /^[a-zA-Z]:[\\/]/.test(s);
   }

    private async refreshPlayerSource(m: MediaItem | null): Promise<void> {
      // Only rebuild the player when the playable source changes.
      const key = m ? `${m.type}|${this.playableFilePath(m) || ''}` : null;
      if (key && key === this.lastPlayerKey && this.playerSrc()) {
         return;
      }
      this.lastPlayerKey = key;

      const seq = ++this.playerSrcSeq;

      this.playerError.set(null);
      this.playerSrc.set(null);
      this.playerLoading.set(false);
      this.playerDuration.set(null);
      this.isPlaying.set(false);

      if (!m) return;
      const path = this.playableFilePath(m);
      if (!path) return;

      this.playerResolving.set(true);
      await this.tauri.ready();

      if (seq !== this.playerSrcSeq) return;
      if (!this.tauri.isTauri()) {
         this.playerResolving.set(false);
         return;
      }

      try {
         const root = await this.tauri.getDataRoot();
         let absPath = path;
         const p = await import('@tauri-apps/api/path');

         if (!this.isAbsolutePath(path)) {
            absPath = await p.join(root, path);
         } else {
            // If the file is outside allowed asset scope, stage it into data_root/media/<id>/.
            const normRoot = (root || '').replace(/\\/g, '/').toLowerCase();
            const normAbs = absPath.replace(/\\/g, '/').toLowerCase();
            if (!normAbs.startsWith(normRoot)) {
               try {
                  const res = await this.backend.stageExternalFile(m.id, absPath);
                  const rel = (res.stored_rel || '').trim();
                  if (rel) {
                     // Update persisted media source path to the staged relative path.
                     const nextSource: any = { ...(m as any).source };
                     if (nextSource.type === 'local') {
                        nextSource.path = rel;
                        if (typeof res.file_size === 'number') nextSource.fileSize = res.file_size;
                     } else if (nextSource.type === 'online') {
                        nextSource.cachedPath = rel;
                        if (typeof res.file_size === 'number') nextSource.fileSize = res.file_size;
                     }
                     this.state.updateMediaItem(m.id, { source: nextSource });
                     absPath = await p.join(root, rel);
                  }
               } catch (e) {
                  console.error('stageExternalFile failed', e);
               }
            }
         }

         const url = await this.tauri.convertFileSrc(absPath);
         if (seq !== this.playerSrcSeq) return;
         this.playerSrc.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
         this.playerLoading.set(true);
      } catch (err) {
         if (seq !== this.playerSrcSeq) return;
         console.error('convertFileSrc failed', err);
         this.playerError.set('convertFileSrc failed');
      } finally {
         if (seq === this.playerSrcSeq) {
            this.playerResolving.set(false);
         }
      }
   }

   addQuickBookmark(): void {
      const m = this.media();
      if (!m) return;
      const t = this.config.t();
      this.state.addBookmark(m.id, {
         timestamp: this.currentTime(),
         label: (t as any).media?.detail?.quickMark
            ? (t as any).media.detail.quickMark(this.formatTime(this.currentTime()))
            : `Mark ${this.formatTime(this.currentTime())}`,
         color: 'gray'
      });
      this.activeTab.set('bookmarks');
   }

    addNote(): void {
       const m = this.media();
       if (!m) return;
       const t = this.config.t();

      const ts = Number(this.currentTime());
      const timestamp = Number.isFinite(ts) && ts >= 0 ? ts : undefined;

      const created = this.state.addNoteToMedia(m.id, {
         timestamp,
         title: (t as any).media?.detail?.newNoteTitle || '新笔记',
         content: (t as any).media?.detail?.newNoteContent || '写点想法...',
         isPinned: false
       });
       this.activeTab.set('notes');

      if (created) {
        this.openNoteEditor(created.id);
      }
    }

    private async refreshSubtitles(m: MediaItem | null): Promise<void> {
      const seq = ++this.subtitlesSeq;

      if (!m) {
        this.subtitles.set(null);
        this.lastSubtitlesMediaId = null;
        return;
      }

      if (this.lastSubtitlesMediaId === m.id && this.subtitles()) {
        return;
      }

      this.lastSubtitlesMediaId = m.id;
      this.subtitlesLoading.set(true);
      try {
        await this.tauri.ready();
        if (seq !== this.subtitlesSeq) return;
        if (!this.tauri.isTauri()) {
          this.subtitles.set(null);
          return;
        }

        let subs = await this.backend.loadSubtitles(m.id);
        if (!subs && m.transcription) {
          subs = await this.backend.ensureSubtitles(m.id);
        }
        if (seq !== this.subtitlesSeq) return;
        this.subtitles.set(subs);

        // Normalize selection.
        const tracks = this.availableSubtitleTracks();
        const wanted = this.subtitleTrackId();
        if (tracks.length && !tracks.some(t => t.id === wanted)) {
          this.subtitleTrackId.set(tracks[0].id);
        }
      } catch {
        if (seq !== this.subtitlesSeq) return;
        this.subtitles.set(null);
      } finally {
        if (seq === this.subtitlesSeq) {
          this.subtitlesLoading.set(false);
        }
      }
    }

    toggleCcMenu(event: MouseEvent): void {
      event.preventDefault();
      event.stopPropagation();
      this.ccMenuOpen.update(v => !v);
    }

    setCcTrack(trackId: string | null, event?: MouseEvent): void {
      event?.preventDefault();
      event?.stopPropagation();

      if (!trackId || trackId === 'off') {
        this.ccEnabled.set(false);
        this.ccMenuOpen.set(false);
        return;
      }

      this.subtitleTrackId.set(trackId);
      this.ccEnabled.set(true);
      this.ccMenuOpen.set(false);
    }

    resetCcStyle(): void {
      this.ccStyle.set({
        fontSize: 18,
        x: 0.5,
        y: 0.85,
        color: '#ffffff',
        bgOpacity: 0.35,
      });
    }

    private ccDragActive = false;
    private ccResizeActive = false;
    private ccStartClientX = 0;
    private ccStartClientY = 0;
    private ccStartX = 0.5;
    private ccStartY = 0.85;
    private ccStartFontSize = 18;

    private playerRect(): DOMRect | null {
      const el = this.playerContainer()?.nativeElement;
      if (!el) return null;
      try {
        return el.getBoundingClientRect();
      } catch {
        return null;
      }
    }

    ccDragStart(evt: MouseEvent): void {
      if (!this.ccSettingsOpen()) return;
      if (evt.button !== 0) return;
      evt.preventDefault();
      evt.stopPropagation();

      const s: any = this.ccStyle();
      this.ccDragActive = true;
      this.ccResizeActive = false;
      this.ccStartClientX = evt.clientX;
      this.ccStartClientY = evt.clientY;
      this.ccStartX = Number(s.x) || 0.5;
      this.ccStartY = Number(s.y) || 0.85;
    }

    ccResizeStart(evt: MouseEvent): void {
      if (!this.ccSettingsOpen()) return;
      if (evt.button !== 0) return;
      evt.preventDefault();
      evt.stopPropagation();

      const s: any = this.ccStyle();
      this.ccResizeActive = true;
      this.ccDragActive = false;
      this.ccStartClientX = evt.clientX;
      this.ccStartClientY = evt.clientY;
      this.ccStartFontSize = Number(s.fontSize) || 18;
    }

    @HostListener('document:mousemove', ['$event'])
    onCcDragMove(evt: MouseEvent): void {
      if (!this.ccSettingsOpen()) {
        this.ccDragActive = false;
        this.ccResizeActive = false;
        return;
      }

      const rect = this.playerRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return;

      if (this.ccDragActive) {
        const dx = evt.clientX - this.ccStartClientX;
        const dy = evt.clientY - this.ccStartClientY;
        const nextX = this.ccStartX + dx / rect.width;
        const nextY = this.ccStartY + dy / rect.height;
        this.ccStyle.set({
          ...this.ccStyle(),
          x: Math.max(0.05, Math.min(0.95, nextX)),
          y: Math.max(0.05, Math.min(0.95, nextY)),
        } as any);
        return;
      }

      if (this.ccResizeActive) {
        const dx = evt.clientX - this.ccStartClientX;
        const dy = evt.clientY - this.ccStartClientY;
        const delta = (dx - dy) / 12;
        const next = Math.round(this.ccStartFontSize + delta);
        this.ccStyle.set({
          ...this.ccStyle(),
          fontSize: Math.max(12, Math.min(72, next)),
        } as any);
      }
    }

    @HostListener('document:mouseup')
    onCcDragEnd(): void {
      this.ccDragActive = false;
      this.ccResizeActive = false;
    }

    async translateSubtitlesToZh(): Promise<void> {
      const m = this.media();
      if (!m) return;

      await this.tauri.ready();
      if (!this.tauri.isTauri()) {
        this.toast.warning('Web 预览模式暂不支持字幕翻译');
        return;
      }
      if (!m.transcription) {
        this.toast.warning('请先生成转写');
        return;
      }
      if (this.translatingSubtitles()) return;

      this.translatingSubtitles.set(true);
      try {
        const res = await this.backend.translateSubtitles(m.id, this.state.settings().ai, 'zh');
        this.subtitles.set(res);
        this.subtitleTrackId.set('zh');
        this.ccEnabled.set(true);
        this.toast.success('已生成中文字幕');
      } catch (err: any) {
        console.error('translateSubtitles failed', err);
        this.toast.error(this.formatError(err) || '字幕翻译失败');
      } finally {
        this.translatingSubtitles.set(false);
      }
    }

    openNoteEditor(noteId: string, event?: Event): void {
      event?.preventDefault();
      event?.stopPropagation();
      const m = this.media();
      if (!m) return;
      const note = m.notes.find(n => n.id === noteId);
      if (!note) return;

      this.loadNoteIntoEditor(note);
      this.noteDockedOpen.set(true);
      this.noteEditorOpen.set(false);
    }

    detachNoteEditor(): void {
      if (!this.noteEditorId()) return;
      this.noteDockedOpen.set(false);
      this.noteEditorOpen.set(true);

      // Initialize position if needed.
      if (this.noteEditorX() === 0 && this.noteEditorY() === 0) {
        const vw = window.innerWidth || 1200;
        const vh = window.innerHeight || 800;
        const w = Math.max(520, Math.min(this.noteEditorW(), Math.floor(vw * 0.8)));
        const h = Math.max(380, Math.min(this.noteEditorH(), Math.floor(vh * 0.7)));
        this.noteEditorW.set(w);
        this.noteEditorH.set(h);
        const x = Math.max(12, Math.floor(vw - w - 24));
        const y = Math.max(12, Math.floor(vh - h - 24));
        this.noteEditorX.set(x);
        this.noteEditorY.set(y);
      }
    }

    dockNoteEditor(): void {
      if (!this.noteEditorId()) return;
      this.noteEditorOpen.set(false);
      this.noteDockedOpen.set(true);
      this.activeTab.set('notes');
    }

    closeDockedNoteEditor(): void {
      this.flushNoteAutosave();
      this.noteDockedOpen.set(false);
      this.noteEditorId.set(null);
    }

    closeNoteEditor(event?: Event): void {
      event?.preventDefault();
      this.flushNoteAutosave();
      this.noteEditorOpen.set(false);
      this.noteDragActive = false;
    }

    private scheduleNoteAutosave(): void {
      if (this.noteLoading) return;
      const id = this.noteEditorId();
      if (!id) return;
      if (!(this.noteDockedOpen() || this.noteEditorOpen())) return;

      if (this.noteAutosaveTimer) {
        clearTimeout(this.noteAutosaveTimer);
        this.noteAutosaveTimer = null;
      }
      this.noteAutosaving.set(true);
      this.noteAutosaveTimer = setTimeout(() => {
        this.noteAutosaveTimer = null;
        this.flushNoteAutosave();
      }, 450);
    }

    flushNoteAutosave(): void {
      if (this.noteAutosaveTimer) {
        clearTimeout(this.noteAutosaveTimer);
        this.noteAutosaveTimer = null;
      }
      const m = this.media();
      if (!m) return;
      const noteId = this.noteEditorId();
      if (!noteId) return;
      if (this.noteLoading) return;
      if (!(this.noteDockedOpen() || this.noteEditorOpen())) return;

      const title = (this.noteEditorTitle() || '').trim() || '新笔记';
      const content = (this.noteEditorContent() || '').toString();
      const ts = this.noteEditorTimestamp();

      this.state.updateNote(m.id, noteId, {
        title,
        content,
        timestamp: ts === null ? undefined : ts,
      });
      this.noteAutosaving.set(false);
      this.noteAutosavedAt.set(Date.now());
    }

    private loadNoteIntoEditor(note: MediaNote): void {
      this.noteLoading = true;
      this.noteEditorId.set(note.id);
      this.noteEditorTitle.set(note.title || '');
      this.noteEditorContent.set(note.content || '');
      this.noteEditorTimestamp.set(typeof note.timestamp === 'number' ? note.timestamp : null);
      this.noteAutosaving.set(false);
      this.noteAutosavedAt.set(Date.now());
      setTimeout(() => {
        this.noteLoading = false;
      }, 0);
    }

    async deleteNoteFromEditor(): Promise<void> {
      const m = this.media();
      if (!m) return;
      const noteId = this.noteEditorId();
      if (!noteId) return;
      const note = m.notes.find(n => n.id === noteId);
      const ok = await this.confirm.confirm({
        title: '删除笔记',
        message: `确定要删除 “${note?.title || '笔记'}” 吗？`,
        confirmText: '删除',
        cancelText: '取消',
        danger: true,
      });
      if (!ok) return;
      this.state.deleteNote(m.id, noteId);
      this.toast.success('已删除');
      this.noteDockedOpen.set(false);
      this.noteEditorOpen.set(false);
      this.noteEditorId.set(null);
    }

    applyCurrentTimeToNote(): void {
      const ts = Number(this.currentTime());
      if (Number.isFinite(ts) && ts >= 0) {
        this.noteEditorTimestamp.set(ts);
      }
    }

    noteEditorDragStart(evt: MouseEvent): void {
      if (evt.button !== 0) return;
      this.noteDragActive = true;
      this.noteDragOffsetX = evt.clientX - this.noteEditorX();
      this.noteDragOffsetY = evt.clientY - this.noteEditorY();
    }

    @HostListener('document:mousemove', ['$event'])
    onNoteEditorDragMove(evt: MouseEvent): void {
      if (!this.noteEditorOpen() || !this.noteDragActive) return;
      const vw = window.innerWidth || 1200;
      const vh = window.innerHeight || 800;

      const x = evt.clientX - this.noteDragOffsetX;
      const y = evt.clientY - this.noteDragOffsetY;

      const w = this.noteEditorW();
      const h = this.noteEditorH();
      const clampedX = Math.max(8, Math.min(vw - Math.max(80, w) - 8, x));
      const clampedY = Math.max(8, Math.min(vh - Math.max(80, h) - 8, y));
      this.noteEditorX.set(clampedX);
      this.noteEditorY.set(clampedY);
    }

    @HostListener('document:mouseup')
    onNoteEditorDragEnd(): void {
      this.noteDragActive = false;

      // Persist size after manual resize.
      if (this.noteEditorOpen()) {
        const el = this.noteEditorBox()?.nativeElement;
        if (el) {
          const r = el.getBoundingClientRect();
          const w = Math.max(420, Math.min(window.innerWidth - 16, Math.round(r.width)));
          const h = Math.max(320, Math.min(window.innerHeight - 16, Math.round(r.height)));
          this.noteEditorW.set(w);
          this.noteEditorH.set(h);
        }
      }
    }

   startTagEdit(event?: Event): void {
      event?.preventDefault();
      event?.stopPropagation();
      this.tagEditing.set(true);
    }

   cancelTagEdit(event?: Event): void {
      event?.preventDefault();
      event?.stopPropagation();
      this.tagDraft.set('');
      this.tagEditing.set(false);
   }


   addTagFromDraft(event?: Event): void {
      event?.preventDefault();
      event?.stopPropagation();
      const m = this.media();
      if (!m) return;

      const raw = (this.tagDraft() || '').trim();
      if (!raw) return;

      // Allow comma/Chinese comma separated input.
      const parts = raw
        .split(/[,，\n]/g)
        .map(s => s.trim())
        .filter(s => !!s);

      if (parts.length === 0) return;

      const existing = Array.isArray(m.tags) ? m.tags : [];
      const next: string[] = [];
      for (const t of existing) {
        const x = (t || '').trim();
        if (x && !next.includes(x)) next.push(x);
      }
      for (const t of parts) {
        if (!next.includes(t)) next.push(t);
      }

      this.state.updateMediaItem(m.id, { tags: next });
      this.tagDraft.set('');
      this.tagEditing.set(false);
   }

    removeTag(tag: string, event?: Event): void {
       event?.preventDefault();
       event?.stopPropagation();
       const m = this.media();
       if (!m) return;
       const next = (m.tags || []).filter(t => t !== tag);
       this.state.updateMediaItem(m.id, { tags: next });
    }

    bookmarkEditingId = signal<string | null>(null);
    bookmarkDraft = signal('');

    beginEditBookmark(bm: Bookmark, event?: Event): void {
      event?.preventDefault();
      event?.stopPropagation();
      const id = (bm?.id || '').trim();
      if (!id) return;
      this.bookmarkEditingId.set(id);
      this.bookmarkDraft.set((bm.label || '').trim());
      setTimeout(() => {
        try {
          const el = document.querySelector<HTMLInputElement>('input[data-bookmark-edit="1"]');
          el?.focus();
          el?.select();
        } catch {}
      }, 0);
    }

    cancelEditBookmark(event?: Event): void {
      event?.preventDefault();
      event?.stopPropagation();
      this.bookmarkEditingId.set(null);
      this.bookmarkDraft.set('');
    }

    commitEditBookmark(bm: Bookmark, event?: Event): void {
      event?.preventDefault();
      event?.stopPropagation();
      const m = this.media();
      if (!m) return;
      const id = (bm?.id || '').trim();
      if (!id) return;
      const next = (this.bookmarkDraft() || '').trim();
      if (!next) {
        this.toast.warning('书签标题不能为空');
        return;
      }
      this.state.updateBookmark(m.id, id, { label: next });
      this.bookmarkEditingId.set(null);
      this.bookmarkDraft.set('');
    }

    bookmarkSnippet(timestamp: number): string {
      const m = this.media();
      const segs = m?.transcription?.segments || [];
      if (!segs.length) return '';
      const ts = Number(timestamp);
      if (!Number.isFinite(ts)) return '';

      // Prefer the segment that contains ts; otherwise pick the closest by start time.
      let best = segs[0];
      let bestScore = Number.POSITIVE_INFINITY;
      for (const s of segs) {
        const st = Number(s.start);
        const en = Number(s.end);
        if (!Number.isFinite(st) || !Number.isFinite(en)) continue;
        if (st <= ts && ts <= en) {
          best = s;
          bestScore = -1;
          break;
        }
        const d = Math.abs(st - ts);
        if (d < bestScore) {
          best = s;
          bestScore = d;
        }
      }
      const text = (best?.text || '').trim();
      if (!text) return '';
      return text.length > 90 ? text.slice(0, 90) + '…' : text;
    }

   async deleteNote(noteId: string, event?: Event): Promise<void> {
      event?.preventDefault();
      event?.stopPropagation();
      const m = this.media();
      if (!m) return;
      const ok = await this.confirm.confirm({
        title: '删除笔记',
        message: '确定要删除这条笔记吗？',
        confirmText: '删除',
        cancelText: '取消',
        danger: true,
      });
      if (!ok) return;
      this.state.deleteNote(m.id, noteId);
   }
 
   deleteBookmark(id: string) {
      const m = this.media();
      if (m) this.state.deleteBookmark(m.id, id);
   }

   toggleMoreMenu(event: MouseEvent): void {
      event.preventDefault();
      event.stopPropagation();
      this.moreMenuOpen.update(v => !v);
   }

   async deleteMedia(): Promise<void> {
      const m = this.media();
      if (!m) return;

      const ok = await this.confirm.confirm({
         title: '移入回收站',
         message: `确定要删除 "${m.name}" 吗？`,
         confirmText: '删除',
         cancelText: '取消',
         danger: true,
      });
      if (!ok) return;

      this.state.deleteMediaItem(m.id);
      this.toast.success('已移入回收站');
      void this.router.navigate(['/media']);
   }

   async exportMedia(): Promise<void> {
      const m = this.media();
      if (!m) return;

      if (this.exporting()) return;
      this.exporting.set(true);
      try {
         await this.tauri.ready();
         if (!this.tauri.isTauri()) {
            this.toast.warning('Web 预览模式暂不支持导出');
            return;
         }

         let exportBase: string | undefined = undefined;
         try {
           const dialog = await import('@tauri-apps/plugin-dialog');
           const picked = await dialog.open({ directory: true, multiple: false, title: '选择导出目录' } as any);
           if (!picked) {
             return;
           }
           exportBase = Array.isArray(picked) ? (picked[0] as any) : (picked as any);
         } catch {
           // dialog not available; fallback to default export location
         }

         const res = await this.backend.exportMedia(m.id, exportBase);
         this.toast.success(`已导出到：${res.export_dir}`);
      } catch (err: any) {
         console.error('exportMedia failed', err);
         this.toast.error(this.formatError(err) || '导出失败');
      } finally {
         this.exporting.set(false);
      }
     }

    async openStorageLocation(): Promise<void> {
       const m = this.media();
       if (!m) return;

       try {
         await this.tauri.ready();
         if (!this.tauri.isTauri()) {
           this.toast.warning('Web 预览模式暂不支持打开存储位置');
           return;
         }

         await this.backend.revealMediaDir(m.id);
       } catch (err: any) {
         console.error('openStorageLocation failed', err);
         const msg = this.formatError(err) || '打开存储位置失败';
         this.toast.error(msg);
         try {
           const info = await this.backend.getMediaStorageInfo(m.id);
           if (info?.media_dir) {
             this.toast.info(`存储目录：${info.media_dir}`);
           }
         } catch {
           // ignore
         }
       }
     }

    openTranscriptionDialog(): void {
      const t = this.state.settings().transcription;
      this.transcriptionDraft.set({
         language: t.language,
         localAccelerator: t.localAccelerator,
         numThreads: t.numThreads,
         useItn: t.useItn,
      });
      this.transcriptionDialogOpen.set(true);
    }

     async openExternalUrl(url: string, evt?: Event): Promise<void> {
       evt?.preventDefault();
       evt?.stopPropagation();
       const u = (url || '').trim();
       if (!u) return;

       await this.tauri.ready();
       if (!this.tauri.isTauri()) {
         window.open(u, '_blank', 'noopener,noreferrer');
         return;
       }

       // Desktop: try shell plugin, fallback to window.open
       try {
         const shell = await import('@tauri-apps/plugin-shell');
         await shell.open(u as any);
       } catch {
         window.open(u, '_blank', 'noopener,noreferrer');
       }
     }

    formatDateTime(iso: string | undefined | null): string {
      if (!iso) return '';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleString();
    }

    closeTranscriptionDialog(): void {
      this.transcriptionDialogOpen.set(false);
    }

    async startTranscriptionFromDialog(): Promise<void> {
      const draft = this.transcriptionDraft();
      this.transcriptionDialogOpen.set(false);
      await this.runTranscription(draft);
    }

    async runTranscription(override?: Partial<AppSettings['transcription']>): Promise<void> {
      const m = this.media();
      if (!m) return;
      await this.tauri.ready();
      if (!this.tauri.isTauri()) {
        this.toast.warning('Web 预览模式暂不支持转写');
        return;
      }
      if (this.transcribing()) return;

      const cfg: AppSettings['transcription'] = {
         ...this.state.settings().transcription,
         ...(override || {}),
      };

      this.transcribing.set(true);
      this.state.updateMediaItem(m.id, { status: 'transcribing' });
      try {
         const res = await this.backend.transcribeMedia(m.id, cfg);
         this.state.setTranscription(m.id, res.transcription);
         this.state.updateMediaItem(m.id, { status: 'ready' });
         this.toast.success('转写完成');
      } catch (err: any) {
         console.error('transcribeMedia failed', err);
         this.state.updateMediaItem(m.id, { status: 'error' });
         this.toast.error(this.formatError(err) || '转写失败');
      } finally {
         this.transcribing.set(false);
      }
    }

    async runSummary(): Promise<void> {
      const m = this.media();
      if (!m) return;
      if (!m.transcription) {
         this.toast.warning('请先生成转写');
         this.activeTab.set('transcript');
         return;
      }
      await this.tauri.ready();
      if (!this.tauri.isTauri()) {
        this.toast.warning('Web 预览模式暂不支持 AI 总结');
        return;
      }
      if (this.summarizing()) return;

       this.summarizing.set(true);
       this.state.updateMediaItem(m.id, { status: 'processing' });
       try {
         const ai = this.state.settings().ai;
         const pid = this.summaryPromptId();
         const tpl = (ai.summaryPrompts || []).find(p => p.id === pid)?.template || '';
         const res = await this.backend.summarizeMedia(m.id, ai, { promptId: pid, promptTemplate: tpl });
         this.state.setAISummary(m.id, res.summary);
         this.state.updateMediaItem(m.id, { status: 'ready' });
         this.toast.success('AI 总结生成完成');
       } catch (err: any) {
         console.error('summarizeMedia failed', err);
         this.state.updateMediaItem(m.id, { status: 'error' });
         this.toast.error(this.formatError(err) || 'AI 总结失败');
      } finally {
         this.summarizing.set(false);
     }
    }

    private extractMermaidBlocks(markdown: string): Array<{ start: number; end: number; code: string }> {
      const md = (markdown || '').toString();
      const re = /```mermaid\s*\n([\s\S]*?)```/g;
      const out: Array<{ start: number; end: number; code: string }> = [];
      for (const m of md.matchAll(re) as any) {
        const full = m[0] as string;
        const code = (m[1] as string) || '';
        const idx = (m.index as number) || 0;
        out.push({ start: idx, end: idx + full.length, code: code.trim() });
      }
      return out;
    }

    private replaceMermaidBlockAtIndex(markdown: string, index: number, newCode: string): string {
      const md = (markdown || '').toString();
      const blocks = this.extractMermaidBlocks(md);
      if (index < 0 || index >= blocks.length) return md;
      const b = blocks[index];
      const fenced = `\n\n\`\`\`mermaid\n${(newCode || '').trim()}\n\`\`\`\n\n`;
      return md.slice(0, b.start) + fenced + md.slice(b.end);
    }

    async regenerateSummaryDiagram(kind: 'timeline' | 'mindmap'): Promise<void> {
      const m = this.media();
      if (!m) return;
      if (!m.transcription) {
        this.toast.warning('请先生成转写');
        this.activeTab.set('transcript');
        return;
      }
      if (!m.summary) {
        this.toast.warning('请先生成总结');
        return;
      }

      await this.tauri.ready();
      if (!this.tauri.isTauri()) {
        this.toast.warning('Web 预览模式暂不支持 AI 总结');
        return;
      }
      if (this.summarizing() || this.summaryRunning() || this.summaryRegenerating()) return;

      this.summaryRegenerating.set(kind);
      try {
        const ai = this.state.settings().ai;
        const diagramSpec = kind === 'timeline'
          ? "Narrative Timeline (time-driven). Use mermaid flowchart. MUST start with: flowchart LR. Do NOT use gantt."
          : "Logic Mind Map (logic-driven). Use mermaid mindmap. MUST start with: mindmap.";

        const basePrompt = `You are regenerating ONE mermaid diagram for a media transcript summary.\n\n\
Return ONLY JSON (no code fences).\n\
Schema: { \\\"content\\\": string (markdown) }\n\n\
Rules:\n\
- Your content MUST be markdown.\n\
- Output EXACTLY ONE mermaid diagram inside a fenced code block.\n\
- Diagram type: ${diagramSpec}\n\
- Keep mermaid syntax simple and robust. Avoid exotic characters in node IDs; put human text in labels.\n\
- If using timestamps in labels, use [MM:SS].\n\n\
Input (transcript):\n\n{{input}}\n`;

        const pid = this.summaryPromptId();
        const res = await this.backend.summarizeMedia(m.id, ai, { promptId: pid, promptTemplate: basePrompt });
        const newMd = res?.summary?.content || '';
        const newBlocks = this.extractMermaidBlocks(newMd);
        if (newBlocks.length < 1) {
          this.toast.error('重生成失败：未返回 mermaid 代码块');
          return;
        }

        const targetIdx = kind === 'timeline' ? 0 : 1;
        const cur = m.summary.content || '';
        const curBlocks = this.extractMermaidBlocks(cur);

        let patched = cur;
        if (curBlocks.length >= 2) {
          patched = this.replaceMermaidBlockAtIndex(cur, targetIdx, newBlocks[0].code);
        } else {
          const heading = kind === 'timeline' ? '### Narrative Timeline' : '### Logic Mind Map';
          patched = `${cur.trim()}\n\n${heading}\n\n\`\`\`mermaid\n${newBlocks[0].code}\n\`\`\`\n`;
        }

        const updated = {
          ...m.summary,
          content: patched,
          generatedAt: new Date().toISOString(),
          promptUsed: `${m.summary.promptUsed || ''}|regen:${kind}`.replace(/^\|+/, ''),
        };
        this.state.setAISummary(m.id, updated);
        this.toast.success(kind === 'timeline' ? '时间轴已重生成' : '思维导图已重生成');
      } catch (err: any) {
        console.error('regenerateSummaryDiagram failed', err);
        this.toast.error(this.formatError(err) || '重生成失败');
      } finally {
        this.summaryRegenerating.set(null);
      }
    }

    async runOptimizeTranscription(): Promise<void> {
      const m = this.media();
      if (!m) return;
      if (!m.transcription) {
        this.toast.warning('请先生成转写');
        this.activeTab.set('transcript');
        return;
      }
      await this.tauri.ready();
      if (!this.tauri.isTauri()) {
        this.toast.warning('Web 预览模式暂不支持 AI 优化');
        return;
      }
      if (this.optimizing()) return;

      this.optimizing.set(true);
      this.state.updateMediaItem(m.id, { status: 'processing' });
      try {
        const res = await this.backend.optimizeTranscription(m.id, this.state.settings().ai);
        this.state.setTranscription(m.id, res.transcription);
        this.state.updateMediaItem(m.id, { status: 'ready' });
        this.toast.success('转写已优化');
      } catch (err: any) {
        console.error('optimizeTranscription failed', err);
        this.state.updateMediaItem(m.id, { status: 'error' });
        this.toast.error(this.formatError(err) || '转写优化失败');
      } finally {
        this.optimizing.set(false);
      }
    }

   newChat(): void {
      const m = this.media();
      if (!m) return;
      const chat = this.state.startAIConversation(m.id);
      if (chat) {
         this.activeChatId.set(chat.id);
         this.activeTab.set('chat');
      }
   }

   onChatEnter(evt: KeyboardEvent): void {
      // Enter to send; Shift+Enter for newline.
      if (evt.key !== 'Enter') return;
      if (evt.shiftKey) return;
      evt.preventDefault();
      void this.sendChat();
   }

   async sendChat(): Promise<void> {
      const m = this.media();
      if (!m) return;
      const content = this.chatDraft().trim();
      if (!content) return;

      await this.tauri.ready();
      if (!this.tauri.isTauri()) {
         this.toast.warning('Web 预览模式暂不支持 AI 对话');
         return;
      }
      if (this.chatSending()) return;

      let chat = this.activeConversation();
      if (!chat) {
         chat = this.state.startAIConversation(m.id) as AIConversation | null;
         if (!chat) return;
         this.activeChatId.set(chat.id);
      }

      // Persist user message first.
      this.state.addMessageToConversation(m.id, chat.id, { role: 'user', content });
      this.chatDraft.set('');

      this.chatSending.set(true);
      try {
         const updated = this.state.mediaItems().find(x => x.id === m.id)?.aiChats.find(c => c.id === chat!.id) || chat;
         const payload = (updated?.messages || []).slice(-12).map(msg => ({ role: msg.role, content: msg.content }));
          const res = await this.backend.chatMedia(m.id, this.state.settings().ai, payload, {
            includeTranscription: this.chatIncludeTranscription(),
            includeSummary: this.chatIncludeSummary(),
            userLang: this.config.lang(),
          });
         this.state.addMessageToConversation(m.id, chat.id, {
            role: res.message.role,
            content: res.message.content,
            referencedSegments: res.message.referencedSegments,
         });
      } catch (err: any) {
         console.error('chatMedia failed', err);
         this.toast.error(this.formatError(err) || '发送失败');
      } finally {
         this.chatSending.set(false);
      }
    }
}
