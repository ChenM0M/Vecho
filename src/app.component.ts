import { Component, inject, computed, signal, HostListener } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Location, NgClass, CommonModule } from '@angular/common';
import { IconComponent } from './components/icons';
import { ConfigService } from './services/config.service';
import { LayoutService } from './services/layout.service';
import { StateService } from './services/state.service';
import { SettingsComponent } from './pages/settings.component';
import { ToastContainerComponent } from './components/toast.component';
import { ConfirmDialogComponent } from './components/confirm-dialog.component';
import { ConfirmService } from './services/confirm.service';
import { LightboxComponent } from './components/lightbox.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, IconComponent, SettingsComponent, ToastContainerComponent, ConfirmDialogComponent, LightboxComponent, NgClass, FormsModule],
  templateUrl: './app.component.html',
  styles: [`
    .sidebar-item {
      display: flex;
      align-items: center;
      padding: 4px 12px;
      margin-bottom: 1px;
      border-radius: 4px;
      font-size: 14px;
      font-weight: 500;
      color: #787774;
      transition: background-color 0.1s, color 0.1s;
      cursor: pointer;
      user-select: none;
      min-height: 28px;
      text-decoration: none;
    }
    .sidebar-item:hover {
      background-color: #e6e6e4; /* Notion hover light */
      color: #37352f;
    }
    :host-context(.dark) .sidebar-item {
      color: #9b9b9b;
    }
    :host-context(.dark) .sidebar-item:hover {
      background-color: #333; /* Notion hover dark */
      color: #d4d4d4;
    }
    .no-scrollbar::-webkit-scrollbar {
        display: none;
    }
    /* Simple Animation for modals */
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes slideUp { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    .animate-fade-in { animation: fadeIn 0.2s ease-out; }
    .animate-modal-enter { animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
  `]
})
export class AppComponent {
  private router = inject(Router);
  public config = inject(ConfigService);
  public layout = inject(LayoutService);
  public state = inject(StateService);
  public location = inject(Location);
  private confirm = inject(ConfirmService);

  // --- Desktop (Tauri) window controls ---
  isTauri = signal(false);
  isMacOS = signal(false);

  constructor() {
    void this.initDesktopBridge();
  }

  private async initDesktopBridge() {
    const w = window as any;
    let tauri = false;
    try {
      const core = await import('@tauri-apps/api/core');
      // Be tolerant across Tauri versions / bundlers.
      tauri = !!(core as any).isTauri?.() || !!w.__TAURI_INTERNALS__ || !!w.__TAURI__;
    } catch {
      tauri = !!w.__TAURI_INTERNALS__ || !!w.__TAURI__;
    }
    if (!tauri) return;
    this.isTauri.set(true);

    // Fast heuristic (avoid importing an API module that may not exist)
    const platform = (navigator.platform || '').toLowerCase();
    const ua = (navigator.userAgent || '').toLowerCase();
    this.isMacOS.set(platform.includes('mac') || ua.includes('mac os'));
  }

  async winMinimize() {
    if (!this.isTauri()) return;
    const win = await import('@tauri-apps/api/window');
    await win.getCurrentWindow().minimize();
  }

  async winToggleMaximize() {
    if (!this.isTauri()) return;
    const win = await import('@tauri-apps/api/window');
    const w = win.getCurrentWindow();
    const isMax = await w.isMaximized();
    if (isMax) await w.unmaximize();
    else await w.maximize();
  }

  async winClose() {
    if (!this.isTauri()) return;
    const win = await import('@tauri-apps/api/window');
    await win.getCurrentWindow().close();
  }

  async winStartDragging(event?: any) {
    if (!this.isTauri() || this.isMacOS()) return;
    // Only react to primary button.
    if (event && typeof event.button === 'number' && event.button !== 0) return;

    // Prevent the browser from starting a DOM drag operation (shows no-drop cursor).
    try { event?.preventDefault?.(); } catch {}
    try { event?.stopPropagation?.(); } catch {}
    try {
      const win = await import('@tauri-apps/api/window');
      await win.getCurrentWindow().startDragging();
    } catch (e) {
      // If permissions are missing, this will throw.
      console.error('startDragging failed', e);
    }
  }

  async winMaybeStartDragging(event?: any) {
    if (!this.isTauri() || this.isMacOS()) return;
    // Only react to primary button.
    if (event && typeof event.button === 'number' && event.button !== 0) return;

    const isBlockedNode = (node: any): boolean => {
      if (!node) return false;
      // Covers HTMLElement + SVGElement.
      if (typeof (node as any).matches === 'function') {
        try {
          if ((node as any).matches('[data-no-drag],button,a,input,textarea,select,option,label,[role="button"],[contenteditable="true"]')) {
            return true;
          }
        } catch {
          // ignore
        }
      }
      return false;
    };

    // Prefer composedPath (more reliable across SVG/shadow DOM).
    const path: any[] | undefined = typeof event?.composedPath === 'function' ? event.composedPath() : undefined;
    if (Array.isArray(path)) {
      for (const n of path) {
        if (isBlockedNode(n)) return;
      }
    }

    const target = event?.target as any;
    if (target && typeof target.closest === 'function') {
      try {
        const blocked = target.closest('[data-no-drag],button,a,input,textarea,select,option,label,[role="button"],[contenteditable="true"]');
        if (blocked) return;
      } catch {
        // ignore
      }
    }

    await this.winStartDragging(event);
  }

  // Make Back/Forward work for the active tab (Browser history style)
  goBack() { this.location.back(); }
  goForward() { this.location.forward(); }

  // Breadcrumbs helper
  get breadcrumbs(): { label: string, url: string }[] {
    const url = this.router.url;
    const parts = url.split('/').filter(p => p);
    const crumbs = [{ label: 'Workspace', url: '/' }];

    let currentUrl = '';
    for (const part of parts) {
      currentUrl += `/${part}`;
      // Simple mapping
      let label = part.charAt(0).toUpperCase() + part.slice(1);
      if (part === 'media') label = 'Library';
      if (part === 'apps') label = 'Toolbox';
      // If it looks like an ID, truncate it
      if (part.length > 10) label = 'Item';

      crumbs.push({ label, url: currentUrl });
    }
    return crumbs;
  }

  // Notion-style Nav Items (Tree-like)
  navItems = [
    { id: 'dashboard', icon: 'layout-grid', label: 'Dashboard', route: '/' },
    { id: 'library', icon: 'play-circle', label: 'Library', route: '/media' },
    { id: 'workflow', icon: 'git-merge', label: 'Workflows', route: '/workflow' },
    { id: 'toolbox', icon: 'box', label: 'Toolbox', route: '/apps' },
    { id: 'trash', icon: 'trash', label: 'Trash', route: '/recycle-bin' },
  ];

  // 编辑状态
  editingCollectionId: string | null = null;
  editingName = '';

  openSettings() {
    this.config.settingsOpen.set(true);
  }

  toggleLanguage() {
    this.config.setLang(this.config.lang() === 'en' ? 'zh' : 'en');
  }

  getLabel(id: string): string {
    const t = this.config.t();
    if (id === 'settings') return (t as any).nav?.settings || '设置';
    const nav = (t as any).nav;
    return nav ? (nav[id] || id) : id;
  }

  // --- Tab Drag & Drop ---
  draggingTabId: string | null = null;

  // --- Drag to Trash (from media library) ---
  trashDropActive = signal(false);
  libraryDropActive = signal(false);

  private readDragPayload(event: DragEvent): { kind: 'media' | 'collection'; id: string; fromCollectionId?: string | null } | null {
    const w = window as any;

    // 1) Prefer typed payload from DataTransfer.
    const dt = event.dataTransfer;
    try {
      const raw = dt?.getData('application/x-vecho');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.kind === 'media' || parsed.kind === 'collection') && typeof parsed.id === 'string') {
          return {
            kind: parsed.kind,
            id: parsed.id,
            fromCollectionId: typeof parsed.fromCollectionId === 'string' || parsed.fromCollectionId === null
              ? parsed.fromCollectionId
              : undefined
          };
        }
      }
    } catch {
      // ignore
    }

    // 2) Fallback to text/plain conventions.
    const text = dt?.getData('text/plain') || dt?.getData('text') || '';
    let payload: { kind: 'media' | 'collection'; id: string; fromCollectionId?: string | null } | null = null;
    if (text.startsWith('media-')) payload = { kind: 'media', id: text.slice('media-'.length) };
    else if (text.startsWith('col-')) payload = { kind: 'collection', id: text.slice('col-'.length) };
    else if (text) payload = { kind: 'media', id: text };

    // 3) Final fallback: global payload (for environments where DataTransfer is unreliable).
    const global = w.__vechoDragPayload;
    if (global && (global.kind === 'media' || global.kind === 'collection') && typeof global.id === 'string') {
      if (!payload) return global;
      if (payload.kind === global.kind && payload.id === global.id) {
        return {
          ...payload,
          fromCollectionId: payload.fromCollectionId ?? global.fromCollectionId
        };
      }
      return payload;
    }
    if (payload) return payload;
    if (w.__vechoDraggedMediaId) return { kind: 'media', id: w.__vechoDraggedMediaId };
    return null;
  }

  onTabDragStart(event: DragEvent, tabId: string) {
    this.draggingTabId = tabId;
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', tabId);
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onTabDragOver(event: DragEvent) {
    event.preventDefault(); // Allow drop
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  onTabDrop(event: DragEvent, targetTabId: string) {
    event.preventDefault();
    const sourceId = this.draggingTabId;
    if (sourceId && sourceId !== targetTabId) {
      const tabs = this.layout.tabs();
      const fromIndex = tabs.findIndex(t => t.id === sourceId);
      const toIndex = tabs.findIndex(t => t.id === targetTabId);
      if (fromIndex !== -1 && toIndex !== -1) {
        this.layout.reorderTabs(fromIndex, toIndex);
      }
    }
    this.draggingTabId = null;
  }

  onNavDragOver(event: DragEvent, navId: string) {
    if (navId !== 'trash' && navId !== 'library') return;
    event.preventDefault();

    const payload = this.readDragPayload(event);

    if (navId === 'trash') {
      const canDrop = !!payload && payload.kind === 'media' && !!payload.id;
      this.trashDropActive.set(canDrop);
      this.libraryDropActive.set(false);
      if (event.dataTransfer) event.dataTransfer.dropEffect = canDrop ? 'move' : 'none';
      return;
    }

    // navId === 'library': treat as "drag out of collection"
    const canDrop = !!payload && payload.kind === 'media' && !!payload.id && !!payload.fromCollectionId;
    this.libraryDropActive.set(canDrop);
    this.trashDropActive.set(false);
    if (event.dataTransfer) event.dataTransfer.dropEffect = canDrop ? 'move' : 'none';
  }

  onNavDragLeave(event: DragEvent, navId: string) {
    if (navId !== 'trash' && navId !== 'library') return;
    event.preventDefault();
    if (navId === 'trash') this.trashDropActive.set(false);
    if (navId === 'library') this.libraryDropActive.set(false);
  }

  onNavDrop(event: DragEvent, navId: string) {
    if (navId !== 'trash' && navId !== 'library') return;
    event.preventDefault();
    event.stopPropagation();

    const payload = this.readDragPayload(event);

    if (navId === 'trash') {
      if (payload?.kind === 'media' && payload.id) {
        this.state.deleteMediaItem(payload.id);
      }
      this.trashDropActive.set(false);
      return;
    }

    // navId === 'library'
    if (payload?.kind === 'media' && payload.id && payload.fromCollectionId) {
      this.state.removeMediaFromCollection(payload.fromCollectionId, payload.id);
    }
    this.libraryDropActive.set(false);
  }

  private extractMediaId(data: string): string | null {
    if (!data) return null;
    if (data.startsWith('media-')) return data.slice('media-'.length);
    if (data.startsWith('col-')) return null;
    return data;
  }

  // --- Collection Management ---
  addNewCollection() {
    this.state.addCollection({ name: '新收藏夹' });
  }

  startEditCollection(id: string, currentName: string) {
    this.editingCollectionId = id;
    this.editingName = currentName;
  }

  saveCollectionName(id: string) {
    if (this.editingName.trim()) {
      this.state.updateCollection(id, { name: this.editingName.trim() });
    }
    this.editingCollectionId = null;
    this.editingName = '';
  }

  cancelEdit() {
    this.editingCollectionId = null;
    this.editingName = '';
  }

  async deleteCollection(id: string, event: Event) {
    event.stopPropagation();
    const ok = await this.confirm.confirm({
      title: '删除收藏夹',
      message: '确定要删除此收藏夹及其内容吗？此操作不可撤销。',
      confirmText: '删除',
      cancelText: '取消',
      danger: true,
    });
    if (!ok) return;
    this.state.deleteCollection(id);
  }

  // --- Collections (Flat) ---
  readonly collectionsSorted = computed(() =>
    [...this.state.collections()].sort((a, b) => a.sortOrder - b.sortOrder)
  );

  collectionMediaCount(id: string): number {
    return this.state.collections().find(c => c.id === id)?.mediaIds.length || 0;
  }

  // Collection filter navigation - 使用 query 参数
  filterByCollection(collectionId: string) {
    this.router.navigate(['/media'], { queryParams: { collection: collectionId } });
  }

  // --- Collection Drag & Drop ---
  draggingColId: string | null = null;
  
  // Track which collection is being hovered during drag
  dropTargetColId = signal<string | null>(null);

  onColDragStart(event: DragEvent, colId: string) {
    this.draggingColId = colId;
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', 'col-' + colId);
      event.dataTransfer.effectAllowed = 'move';
    }
    event.stopPropagation();
  }

  onColDragOver(event: DragEvent, colId?: string) {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (colId) {
      this.dropTargetColId.set(colId);
    }
  }

  onColDragEnter(event: DragEvent, colId: string) {
    event.preventDefault();
    event.stopPropagation();
    this.dropTargetColId.set(colId);
  }

  onColDragLeave(event: DragEvent, colId: string) {
    event.preventDefault();
    event.stopPropagation();
    // Only clear if leaving the actual target (not entering a child)
    const relatedTarget = event.relatedTarget as HTMLElement;
    const currentTarget = event.currentTarget as HTMLElement;
    if (!currentTarget.contains(relatedTarget)) {
      if (this.dropTargetColId() === colId) {
        this.dropTargetColId.set(null);
      }
    }
  }

  // Clear drop target when drag ends anywhere
  @HostListener('document:dragend')
  onGlobalDragEnd() {
    this.dropTargetColId.set(null);
    this.trashDropActive.set(false);
    this.libraryDropActive.set(false);
  }

  onColDrop(event: DragEvent, targetColId: string) {
    event.preventDefault();
    event.stopPropagation();
    
    this.dropTargetColId.set(null);
    
    const payload = this.readDragPayload(event);
    if (!payload) {
      this.draggingColId = null;
      return;
    }

    if (payload.kind === 'collection') {
      const sourceId = payload.id;
      if (sourceId === targetColId) {
        this.draggingColId = null;
        return;
      }

      const cols = this.collectionsSorted();
      const fromIndex = cols.findIndex(c => c.id === sourceId);
      const toIndex = cols.findIndex(c => c.id === targetColId);
      if (fromIndex !== -1 && toIndex !== -1) {
        this.state.reorderCollections(fromIndex, toIndex);
      }
    } else {
      // Media drop
      const mediaId = payload.id;
      if (!mediaId) {
        this.draggingColId = null;
        return;
      }

      // If dragged from an existing collection view, treat as a move.
      if (payload.fromCollectionId && payload.fromCollectionId !== targetColId) {
        this.state.removeMediaFromCollection(payload.fromCollectionId, mediaId);
      }
      this.state.addMediaToCollection(targetColId, mediaId);
    }

    this.draggingColId = null;
  }

  onColContainerDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.dropTargetColId.set(null);

    const payload = this.readDragPayload(event);
    if (payload?.kind === 'collection') {
      const cols = this.collectionsSorted();
      const fromIndex = cols.findIndex(c => c.id === payload.id);
      if (fromIndex !== -1 && cols.length > 0) {
        this.state.reorderCollections(fromIndex, cols.length - 1);
      }
    }
  }
}
