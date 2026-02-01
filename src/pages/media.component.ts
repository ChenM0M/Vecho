import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../components/icons';
import { ConfigService } from '../services/config.service';
import { StateService } from '../services/state.service';
import { ConfirmService } from '../services/confirm.service';
import type { Collection, MediaItem, ProcessingJob, ViewMode } from '../types';

@Component({
  selector: 'app-media',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, IconComponent],
  template: `
    <div class="flex h-full w-full bg-white dark:bg-[#0c0c0e] text-zinc-900 dark:text-zinc-100 relative flex-col" (click)="closeContextMenu()">
      <!-- Toolbar -->
      <div class="h-14 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-6 bg-white/80 dark:bg-[#0c0c0e]/80 backdrop-blur-sm z-10 shrink-0">
        <div class="flex items-center gap-2 text-sm font-medium">
          <button
            (click)="selectCollection(null)"
            (dragenter)="onLibraryDragEnter($event)"
            (dragover)="onLibraryDragOver($event)"
            (dragleave)="onLibraryDragLeave($event)"
            (drop)="onLibraryDrop($event)"
            class="hover:bg-zinc-100 dark:hover:bg-zinc-800 px-2 py-1 rounded-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors flex items-center gap-2"
          >
            <app-icon name="layout-grid" [size]="16"></app-icon>
            <span>媒体库</span>
            @if (libraryDropActive()) {
              <span class="inline-flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-300">
                <app-icon name="plus" [size]="14"></app-icon>
              </span>
            }
          </button>

          @for (crumb of breadcrumbs(); track crumb.id) {
            <app-icon name="chevron-right" [size]="14" class="text-zinc-300 dark:text-zinc-600"></app-icon>
            <button
              (click)="selectCollection(crumb.id)"
              (dragover)="onDragOver($event)"
              (drop)="onDropToCollection($event, crumb.id)"
              class="hover:bg-zinc-100 dark:hover:bg-zinc-800 px-2 py-1 rounded-sm text-zinc-900 dark:text-zinc-100 font-semibold transition-colors flex items-center gap-2"
            >
              <app-icon name="folder-open" [size]="16" class="text-zinc-400"></app-icon>
              {{ crumb.name }}
            </button>
          }
        </div>

        <div class="flex items-center gap-3">
          <button
            (click)="createNewCollection()"
            class="hidden md:flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black rounded-sm text-xs font-medium hover:opacity-90 transition-opacity btn-press"
          >
            <app-icon name="plus" [size]="14"></app-icon>
            <span>新建收藏夹</span>
          </button>

          <div class="h-4 w-px bg-zinc-200 dark:bg-zinc-800"></div>

          <div class="flex items-center bg-zinc-100 dark:bg-zinc-900 rounded-sm p-0.5 border border-zinc-200 dark:border-zinc-800">
            <button
              (click)="setViewMode('grid')"
              class="p-1.5 rounded-sm transition-all text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              [class.bg-white]="viewMode() === 'grid'"
              [class.dark:bg-zinc-800]="viewMode() === 'grid'"
              [class.shadow-sm]="viewMode() === 'grid'"
            >
              <app-icon name="layout-grid" [size]="16"></app-icon>
            </button>
            <button
              (click)="setViewMode('list')"
              class="p-1.5 rounded-sm transition-all text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              [class.bg-white]="viewMode() === 'list'"
              [class.dark:bg-zinc-800]="viewMode() === 'list'"
              [class.shadow-sm]="viewMode() === 'list'"
            >
              <app-icon name="layout-list" [size]="16"></app-icon>
            </button>
          </div>
        </div>
      </div>

      <!-- Main -->
      <div class="flex-1 overflow-y-auto p-6" (contextmenu)="onGlobalContextMenu($event)" (dragover)="onDragOver($event)" (drop)="onGlobalDrop($event)">
        @if (subCollections().length > 0) {
          <div class="mb-6">
            <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              @for (col of subCollections(); track col.id) {
                <div
                  (click)="selectCollection(col.id)"
                  (dblclick)="selectCollection(col.id)"
                  (dragover)="onDragOver($event)"
                  (drop)="onDropToCollection($event, col.id)"
                  (contextmenu)="onCollectionContextMenu($event, col)"
                  class="group flex items-center gap-3 p-3 bg-zinc-50/50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-sm hover:bg-white dark:hover:bg-zinc-800 hover:shadow-md hover:border-zinc-300 dark:hover:border-zinc-600 transition-all cursor-pointer select-none"
                >
                  <div class="text-zinc-400 dark:text-zinc-600">
                    <app-icon name="folder" [size]="22" class="fill-current opacity-80"></app-icon>
                  </div>

                  <div class="flex-1 min-w-0">
                    @if (editingCollectionId === col.id) {
                      <input
                        type="text"
                        [(ngModel)]="editingName"
                        (blur)="saveCollectionName(col.id)"
                        (keydown.enter)="saveCollectionName(col.id)"
                        (click)="$event.stopPropagation()"
                        class="w-full bg-transparent border-b border-blue-500 outline-none text-sm font-medium"
                        autofocus
                      />
                    } @else {
                      <p class="text-sm font-medium text-zinc-700 dark:text-zinc-200 truncate">{{ col.name }}</p>
                      <p class="text-[10px] text-zinc-400">{{ collectionMediaCount(col.id) }} 项</p>
                    }
                  </div>
                </div>
              }
            </div>
          </div>
        }

        @if (items().length === 0 && subCollections().length === 0) {
          <div class="h-[60vh] flex flex-col items-center justify-center text-zinc-400">
            <div class="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-sm flex items-center justify-center mb-4">
              <app-icon name="folder-open" [size]="24" class="opacity-50"></app-icon>
            </div>
            <p class="text-sm font-medium text-zinc-600 dark:text-zinc-400">此文件夹为空</p>
            <p class="text-xs text-zinc-500 mt-1">拖入文件或创建新收藏夹</p>
            <button (click)="createNewCollection()" class="mt-4 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-sm text-xs font-medium transition-colors">
              创建文件夹
            </button>
          </div>
        }

        @if (items().length > 0) {
          @if (viewMode() === 'grid') {
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              @for (item of items(); track item.id) {
                 <div
                   draggable="true"
                   (click)="openMedia(item.id)"
                   (dragstart)="onDragStart($event, item)"
                   (dragend)="onDragEnd()"
                   (contextmenu)="onMediaContextMenu($event, item)"
                   class="group bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-sm overflow-hidden hover:shadow-lg hover:border-zinc-300 dark:hover:border-zinc-700 transition-all cursor-grab active:cursor-grabbing relative card-hover select-none"
                 >
                    <div class="aspect-video bg-zinc-100 dark:bg-zinc-800 relative group-hover:opacity-90 transition-opacity">
                      @if (item.thumbnail) {
                       <img [src]="item.thumbnail" class="w-full h-full object-cover pointer-events-none select-none" draggable="false" />
                       } @else {
                       <div class="w-full h-full flex items-center justify-center text-zinc-300 dark:text-zinc-700 pointer-events-none">
                         <app-icon [name]="item.type === 'video' ? 'video' : 'music'" [size]="32"></app-icon>
                       </div>
                       }

                     @if (activeJobForMedia(item.id); as j) {
                       <div class="absolute top-2 right-2 w-9 h-9 rounded-full bg-black/45 backdrop-blur-sm flex items-center justify-center pointer-events-none">
                         <div class="w-7 h-7 rounded-full" [style.background]="progressRingBackground(jobDisplayProgress(j))" style="padding:2px;">
                           <div class="w-full h-full rounded-full bg-black/55 flex items-center justify-center">
                             <app-icon [name]="jobIconName(j.type)" [size]="12" class="text-white/90"></app-icon>
                           </div>
                         </div>
                       </div>
                     }

                     <div class="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/70 text-white text-[10px] font-medium rounded-sm backdrop-blur-sm pointer-events-none">
                       {{ formatDuration(item.duration) }}
                     </div>
                     <div class="absolute top-2 left-2 px-1.5 py-0.5 bg-zinc-900/70 text-white text-[10px] font-bold uppercase rounded-sm backdrop-blur-sm tracking-wider pointer-events-none">
                       {{ item.type }}
                     </div>
                   </div>
                   <div class="p-4">
                     @if (editingMediaId === item.id) {
                       <input
                         type="text"
                         [(ngModel)]="editingMediaName"
                         (blur)="saveMediaName(item.id)"
                         (keydown.enter)="saveMediaName(item.id)"
                         (keydown.escape)="cancelMediaEdit()"
                         (click)="$event.stopPropagation()"
                         class="w-full bg-transparent border-b border-blue-500 outline-none text-sm font-medium text-zinc-900 dark:text-zinc-100"
                         autofocus
                       />
                      } @else {
                        <h3 class="font-medium text-sm text-zinc-900 dark:text-zinc-100 vecho-clamp-1 mb-1" (dblclick)="startEditMedia(item.id, item.name); $event.stopPropagation()">{{ item.name }}</h3>
                      }

                      @if ((item.tags || []).length > 0) {
                        <div class="mt-2 flex flex-wrap gap-1">
                          @for (tag of (item.tags || []).slice(0, 3); track tag) {
                            <span class="px-1.5 py-0.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-[10px] font-semibold text-zinc-600 dark:text-zinc-300">{{ tag }}</span>
                          }
                          @if ((item.tags || []).length > 3) {
                            <span class="px-1.5 py-0.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-[10px] font-semibold text-zinc-500">+{{ (item.tags || []).length - 3 }}</span>
                          }
                        </div>
                      }
                      <div class="flex items-center justify-between mt-2">
                        <span class="text-[10px] text-zinc-500">{{ formatDate(item.createdAt) }}</span>
                        <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button class="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-sm text-zinc-400 hover:text-blue-500" [title]="config.t().common.play" (click)="$event.stopPropagation()">
                            <app-icon name="play-circle" [size]="14"></app-icon>
                          </button>
                        </div>
                      </div>
                   </div>
                </div>
              }
            </div>
          } @else {
            <div class="flex flex-col gap-1">
              @for (item of items(); track item.id) {
                <div
                  draggable="true"
                  (click)="openMedia(item.id)"
                  (dragstart)="onDragStart($event, item)"
                  (dragend)="onDragEnd()"
                  (contextmenu)="onMediaContextMenu($event, item)"
                  class="group flex items-center gap-4 p-3 rounded-sm border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors cursor-grab active:cursor-grabbing relative select-none"
                >
                   <div class="w-16 h-10 rounded-sm bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0 text-zinc-400 overflow-hidden border border-zinc-200 dark:border-zinc-800 relative">
                     @if (item.thumbnail) {
                       <img [src]="item.thumbnail" class="w-full h-full object-cover pointer-events-none select-none" draggable="false" />
                     } @else {
                       <app-icon [name]="item.type === 'video' ? 'video' : 'music'" [size]="16"></app-icon>
                     }
                     @if (activeJobForMedia(item.id); as j) {
                       <div class="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/45 backdrop-blur-sm flex items-center justify-center pointer-events-none">
                         <div class="w-5 h-5 rounded-full" [style.background]="progressRingBackground(jobDisplayProgress(j))" style="padding:2px;">
                           <div class="w-full h-full rounded-full bg-black/55 flex items-center justify-center">
                             <app-icon [name]="jobIconName(j.type)" [size]="10" class="text-white/90"></app-icon>
                           </div>
                         </div>
                       </div>
                     }
                   </div>
                   <div class="flex-1 min-w-0">
                     @if (editingMediaId === item.id) {
                       <input
                         type="text"
                         [(ngModel)]="editingMediaName"
                         (blur)="saveMediaName(item.id)"
                         (keydown.enter)="saveMediaName(item.id)"
                         (keydown.escape)="cancelMediaEdit()"
                         (click)="$event.stopPropagation()"
                         class="w-full bg-transparent border-b border-blue-500 outline-none text-sm font-medium text-zinc-900 dark:text-zinc-100"
                         autofocus
                       />
                     } @else {
                       <h3 class="font-medium text-sm text-zinc-900 dark:text-zinc-100 truncate" (dblclick)="startEditMedia(item.id, item.name); $event.stopPropagation()">{{ item.name }}</h3>
                     }
                      <div class="flex items-center gap-2 text-[10px] text-zinc-500 mt-0.5">
                        <span>{{ formatDuration(item.duration) }}</span>
                        <span>•</span>
                        <span>{{ formatDate(item.createdAt) }}</span>
                      </div>

                      @if ((item.tags || []).length > 0) {
                        <div class="mt-1 flex flex-wrap gap-1">
                          @for (tag of (item.tags || []).slice(0, 4); track tag) {
                            <span class="px-1.5 py-0.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-[10px] font-semibold text-zinc-600 dark:text-zinc-300">{{ tag }}</span>
                          }
                          @if ((item.tags || []).length > 4) {
                            <span class="px-1.5 py-0.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-[10px] font-semibold text-zinc-500">+{{ (item.tags || []).length - 4 }}</span>
                          }
                        </div>
                      }
                   </div>
                  <div class="opacity-0 group-hover:opacity-100 flex items-center gap-1">
                    <button class="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-sm text-zinc-400 hover:text-zinc-900" [title]="config.t().common.edit" (click)="$event.stopPropagation()">
                      <app-icon name="edit-3" [size]="14"></app-icon>
                    </button>
                  </div>
                </div>
              }
            </div>
          }
        }

        <!-- Context Menu -->
        @if (contextMenu.visible) {
          <div class="fixed z-50 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-sm shadow-lg py-1 min-w-[160px]"
            [style.top.px]="contextMenu.y" [style.left.px]="contextMenu.x">

            @if (contextMenu.type === 'media') {
              <button (click)="menuAction('play')" class="w-full text-left px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300">播放</button>
              <button (click)="menuAction('rename')" class="w-full text-left px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300">重命名</button>
              <div class="h-px bg-zinc-100 dark:bg-zinc-800 my-1"></div>
              @if (currentCollectionId()) {
                <button (click)="menuAction('removeFromCollection')" class="w-full text-left px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 text-red-600">移出收藏夹</button>
              }
              <button (click)="menuAction('delete')" class="w-full text-left px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 text-red-600">删除</button>
            }

            @if (contextMenu.type === 'collection') {
              <button (click)="startEditCollection(contextMenu.data.id, contextMenu.data.name)" class="w-full text-left px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300">重命名</button>
              <div class="h-px bg-zinc-100 dark:bg-zinc-800 my-1"></div>
              <button (click)="menuAction('deleteCollection')" class="w-full text-left px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 text-red-600">删除</button>
            }

            @if (contextMenu.type === 'global') {
              <button (click)="createNewCollection()" class="w-full text-left px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300">新建收藏夹</button>
              <button (click)="router.navigate(['/apps'])" class="w-full text-left px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300">导入工具</button>
            }
          </div>
          <div class="fixed inset-0 z-40" (click)="closeContextMenu()"></div>
        }
      </div>
    </div>
  `,
  styles: [`
    .card-hover:hover { transform: translateY(-2px); box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05); }
    .btn-press:active { transform: scale(0.96); }
  `]
})
export class MediaComponent {
  config = inject(ConfigService);
  state = inject(StateService);
  confirm = inject(ConfirmService);
  router = inject(Router);
  route = inject(ActivatedRoute);

  viewMode = this.state.viewMode;
  currentCollectionId = signal<string | null>(null);

  // Breadcrumb drop hint ("drop back to library")
  libraryDropActive = signal(false);

  // Track current drag payload (more reliable than reading dataTransfer during dragover)
  draggingMediaId = signal<string | null>(null);

  private setGlobalDragPayload(payload: any) {
    (window as any).__vechoDragPayload = payload;
    // Back-compat: some drop targets still read this.
    (window as any).__vechoDraggedMediaId = payload?.kind === 'media' ? payload.id : null;
  }

  private clearGlobalDragPayload() {
    (window as any).__vechoDragPayload = null;
    (window as any).__vechoDraggedMediaId = null;
  }

  constructor() {
    this.route.queryParams.subscribe(params => {
      const colId = params['collection'];
      this.currentCollectionId.set(colId || null);
    });
  }

  breadcrumbs = computed(() => {
    const id = this.currentCollectionId();
    if (!id) return [] as { id: string; name: string }[];
    const col = this.state.collections().find(c => c.id === id);
    return col ? [{ id: col.id, name: col.name }] : [];
  });

  subCollections = computed(() => {
    const currentId = this.currentCollectionId();
    if (currentId) return [];
    return [...this.state.collections()].sort((a, b) => a.sortOrder - b.sortOrder);
  });

  private collectionMediaCountMap = computed(() => {
    return new Map(this.state.collections().map(c => [c.id, c.mediaIds.length] as const));
  });

  collectionMediaCount(id: string): number {
    return this.collectionMediaCountMap().get(id) || 0;
  }

  items = computed(() => {
    const all = this.state.mediaItems();
    const colId = this.currentCollectionId();

    if (!colId) {
      // In root: show ONLY uncollected items
      const collectedIds = new Set<string>();
      this.state.collections().forEach(c => c.mediaIds.forEach(id => collectedIds.add(id)));
      return all.filter(item => !collectedIds.has(item.id));
    }

    const col = this.state.collections().find(c => c.id === colId);
    if (!col) return [];
    return all.filter(item => col.mediaIds.includes(item.id));
  });

  setViewMode(mode: ViewMode) {
    this.state.viewMode.set(mode);
  }

  formatDuration(sec: number) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  formatDate(iso: string) {
    return new Date(iso).toLocaleDateString();
  }

  activeJobForMedia(mediaId: string): ProcessingJob | null {
    return this.state.processingJobs().find(j =>
      j.mediaId === mediaId && (j.status === 'pending' || j.status === 'processing')
    ) || null;
  }

  jobDisplayProgress(job: ProcessingJob): number {
    const base = Math.max(0, Math.min(100, Number(job.progress) || 0));
    return base;
  }

  progressRingBackground(pct: number): string {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    return `conic-gradient(rgba(255,255,255,0.95) 0 ${p}%, rgba(255,255,255,0.20) ${p}% 100%)`;
  }

  jobIconName(type: ProcessingJob['type']): string {
    switch (type) {
      case 'import': return 'upload-cloud';
      case 'download': return 'download';
      case 'transcription': return 'mic';
      case 'optimize': return 'wand-2';
      case 'summary': return 'file-text';
      case 'export': return 'upload-cloud';
      default: return 'cpu';
    }
  }

  selectCollection(id: string | null) {
    if (id) {
      this.router.navigate([], { queryParams: { collection: id } });
    } else {
      this.router.navigate([], { queryParams: {} });
    }
  }

  openMedia(id: string) {
    this.router.navigate(['/media', id]);
  }

  createNewCollection() {
    this.closeContextMenu();
    const newCol = this.state.addCollection({ name: '新建收藏夹' });
    setTimeout(() => this.startEditCollection(newCol.id, newCol.name), 100);
  }

  editingCollectionId: string | null = null;
  editingName = '';

  editingMediaId: string | null = null;
  editingMediaName = '';

  startEditCollection(id: string, name: string) {
    this.closeContextMenu();
    this.editingCollectionId = id;
    this.editingName = name;
  }

  saveCollectionName(id: string) {
    if (this.editingName.trim()) {
      this.state.updateCollection(id, { name: this.editingName.trim() });
    }
    this.editingCollectionId = null;
  }

  startEditMedia(id: string, name: string) {
    this.closeContextMenu();
    this.editingMediaId = id;
    this.editingMediaName = name;
  }

  saveMediaName(id: string) {
    const next = this.editingMediaName.trim();
    if (next) {
      this.state.updateMediaItem(id, { name: next });
    }
    this.editingMediaId = null;
    this.editingMediaName = '';
  }

  cancelMediaEdit() {
    this.editingMediaId = null;
    this.editingMediaName = '';
  }

  onDragStart(event: DragEvent, item: MediaItem) {
    // Use a consistent, typed payload so all drop targets can recognize it.
    // Keep text/plain for broad compatibility.
    const payload = { kind: 'media', id: item.id, fromCollectionId: this.currentCollectionId() };

    const dt = event.dataTransfer;
    if (dt) {
      // Keep text/plain for broad compatibility.
      // WebView implementations can be picky about formats, so set both.
      try { dt.setData('text/plain', `media-${item.id}`); } catch {}
      try { dt.setData('text', `media-${item.id}`); } catch {}
      try { dt.setData('application/x-vecho', JSON.stringify(payload)); } catch {}
      try { dt.effectAllowed = 'move'; } catch {}
    }
    this.draggingMediaId.set(item.id);

    // Fallback for environments where dataTransfer is unreliable.
    this.setGlobalDragPayload(payload);
  }

  onDragEnd() {
    this.libraryDropActive.set(false);
    this.draggingMediaId.set(null);
    this.clearGlobalDragPayload();
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  onLibraryDragEnter(event: DragEvent) {
    this.onLibraryDragOver(event);
  }

  onLibraryDragLeave(event: DragEvent) {
    event.preventDefault();
    this.libraryDropActive.set(false);
  }

  onLibraryDragOver(event: DragEvent) {
    event.preventDefault();
    // Only show drop target when dragging a media item FROM a collection view.
    const canDropToLibrary = !!this.draggingMediaId() && !!this.currentCollectionId();
    this.libraryDropActive.set(canDropToLibrary);
    if (event.dataTransfer) event.dataTransfer.dropEffect = canDropToLibrary ? 'move' : 'none';
  }

  onLibraryDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();

    const mediaId = this.draggingMediaId() || this.extractMediaId(event.dataTransfer?.getData('text/plain'));
    const fromCollectionId = this.currentCollectionId();

    if (mediaId && fromCollectionId) {
      this.state.removeMediaFromCollection(fromCollectionId, mediaId);
    }

    this.libraryDropActive.set(false);
    this.draggingMediaId.set(null);
  }

  onDropToCollection(event: DragEvent, targetCollectionId: string) {
    event.preventDefault();
    event.stopPropagation();
    const data = event.dataTransfer?.getData('text/plain') || '';

    const mediaId = this.draggingMediaId() || this.extractMediaId(data, event.dataTransfer);
    if (!mediaId) return;
    const fromCollectionId = this.currentCollectionId();
    if (fromCollectionId && fromCollectionId !== targetCollectionId) {
      this.state.removeMediaFromCollection(fromCollectionId, mediaId);
    }
    this.state.addMediaToCollection(targetCollectionId, mediaId);

    this.draggingMediaId.set(null);
  }

  onGlobalDrop(event: DragEvent) {
    event.preventDefault();
    const data = event.dataTransfer?.getData('text/plain') || '';
    if (!data) return;

    const mediaId = this.draggingMediaId() || this.extractMediaId(data, event.dataTransfer);
    const fromCollectionId = this.currentCollectionId();
    if (!fromCollectionId) return;
    this.state.removeMediaFromCollection(fromCollectionId, mediaId);

    this.libraryDropActive.set(false);
    this.draggingMediaId.set(null);
  }

  private extractMediaId(data: string | null | undefined, dt?: DataTransfer | null): string | null {
    // Prefer typed payload when available.
    try {
      const raw = dt?.getData('application/x-vecho');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.kind === 'media' && typeof parsed.id === 'string') return parsed.id;
      }
    } catch {
      // ignore
    }

    if (!data) return null;
    if (data.startsWith('media-')) return data.substring(6);
    return data.startsWith('col-') ? null : data;
  }

  contextMenu = { visible: false, x: 0, y: 0, type: 'global' as 'global' | 'collection' | 'media', data: null as any };

  onMediaContextMenu(event: MouseEvent, item: MediaItem) {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenu = { visible: true, x: event.clientX, y: event.clientY, type: 'media', data: item };
  }

  onCollectionContextMenu(event: MouseEvent, col: Collection) {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenu = { visible: true, x: event.clientX, y: event.clientY, type: 'collection', data: col };
  }

  onGlobalContextMenu(event: MouseEvent) {
    event.preventDefault();
    this.contextMenu = { visible: true, x: event.clientX, y: event.clientY, type: 'global', data: null };
  }

  closeContextMenu() {
    this.contextMenu.visible = false;
  }

  async menuAction(action: string) {
    const data = this.contextMenu.data;
    this.closeContextMenu();

    switch (action) {
      case 'play':
        this.router.navigate(['/media', data.id]);
        break;
      case 'delete':
        if (await this.confirm.confirm({
          title: '移入回收站',
          message: '确定要移入回收站吗？',
          confirmText: '移入',
          cancelText: '取消',
          danger: true,
        })) {
          this.state.deleteMediaItem(data.id);
        }
        break;
      case 'deleteCollection':
        if (await this.confirm.confirm({
          title: '删除收藏夹',
          message: '删除此收藏夹及其内容？此操作不可撤销。',
          confirmText: '删除',
          cancelText: '取消',
          danger: true,
        })) {
          this.state.deleteCollection(data.id);
        }
        break;
      case 'removeFromCollection': {
        const colId = this.currentCollectionId();
        if (colId && data) this.state.removeMediaFromCollection(colId, data.id);
        break;
      }
      case 'rename':
        if (data?.id) {
          this.startEditMedia(data.id, data.name || '');
        }
        break;
    }
  }
}
