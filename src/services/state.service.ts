import { Injectable, signal, computed } from '@angular/core';
import type {
    MediaItem,
    MediaNote,
    Bookmark,
    AIConversation,
    AISummary,
    Transcription,
    Collection,
    Workflow,
    DeletedItem,
    UserProfile,
    ConnectedAccount,
    AppSettings,
    ProcessingJob,
    ActivityItem,
    MediaFilter,
    ViewMode,
    SortBy,
    SortOrder
} from '../types';
import { StorageService } from './storage.service';
import { BackendService } from './backend.service';
import type { BackendJobProgressEvent } from './backend.service';
import type { PersistedAppState } from '../types';

function createDefaultSettings(): AppSettings {
    const detectLang = (): 'en' | 'zh' => {
        try {
            const l = (typeof navigator !== 'undefined' ? (navigator.language || '') : '').toLowerCase();
            return l.startsWith('zh') ? 'zh' : 'en';
        } catch {
            return 'zh';
        }
    };
    const language = detectLang();

    const defaultSummaryTemplate = language === 'zh'
        ? (
            '你正在为一个媒体转写内容生成【最终总结】。\n\n'
            + '只返回 JSON（不要代码块）。\n'
            + 'Schema:\n'
            + '{\n'
            + '  "content": string (markdown),\n'
            + '  "keyPoints": string[] (optional),\n'
            + '  "chapters": [{"timestamp": number, "title": string, "summary": string?}] (optional)\n'
            + '}\n\n'
            + '规则：\n'
            + '- "content" 必须是 markdown。\n'
            + '- 引用事实时请带上时间戳 [MM:SS]。\n'
            + '- 在 markdown 中包含两个 mermaid 图（用 fenced code block）：\n'
            + '  1) 时间线（叙事驱动）flowchart LR（不要 gantt）\n'
            + '  2) 逻辑思维导图 mindmap\n'
            + '- mermaid 语法尽量简单稳健，节点 ID 避免奇怪字符，把可读文字放 label。\n\n'
            + '输入（{{inputType}}）：\n\n'
            + '{{input}}\n'
        )
        : (
            'You are creating the FINAL summary for a media transcript.\n\n'
            + 'Return ONLY JSON (no code fences).\n'
            + 'Schema:\n'
            + '{\n'
            + '  "content": string (markdown),\n'
            + '  "keyPoints": string[] (optional),\n'
            + '  "chapters": [{"timestamp": number, "title": string, "summary": string?}] (optional)\n'
            + '}\n\n'
            + 'Rules:\n'
            + '- Your "content" MUST be markdown.\n'
            + '- When referencing facts, include timestamps like [MM:SS].\n'
            + '- Include TWO mermaid diagrams inside the markdown as fenced code blocks:\n'
            + '  1) Narrative Timeline (time-driven) as a flowchart (NOT gantt). Start with: flowchart LR\n'
            + '  2) Logic Mind Map (logic-driven). Start with: mindmap\n'
            + '- Keep mermaid syntax simple and robust. Avoid exotic characters in node IDs; put human text in labels.\n\n'
            + 'Input ({{inputType}}):\n\n'
            + '{{input}}\n'
        );

    return {
        appearance: {
            theme: 'light',
            language,
            sidebarCollapsed: false
        },
        workspace: {
            autoSave: true,
            defaultLocation: '/workspace'
        },
        transcription: {
            engine: 'local_sherpa_onnx',
            localAccelerator: 'auto',
            language: 'auto',
            numThreads: 0,
            useItn: true,
            openai: {
                baseUrl: 'https://api.openai.com/v1',
                apiKey: '',
                model: 'whisper-1'
            }
        },
        ai: {
            provider: 'openai_compatible',
            openai: {
                baseUrl: 'https://api.openai.com/v1',
                apiKey: '',
                chatModel: 'gpt-4o-mini',
                summaryModel: 'gpt-4o-mini'
            },
            gemini: {
                baseUrl: 'https://generativelanguage.googleapis.com',
                apiKey: '',
                model: 'gemini-1.5-flash'
            },
             summaryPrompts: [
                  {
                      id: 'sum-default',
                      name: '默认（时间轴 + 脑图）',
                      template: defaultSummaryTemplate
                  }
              ],
            defaultSummaryPromptId: 'sum-default'
        },
        plugins: {
            enabled: []
        }
    };
}

/**
 * StateService - 以媒体为核心的状态管理
 * 
 * 数据模型设计：
 * - MediaItem 是一等公民，所有内容（笔记、书签、AI对话）都挂载在其下
 * - 独立存储 Folders 用于组织
 * - Workflows 保持独立（处理管线）
 */
@Injectable({ providedIn: 'root' })
export class StateService {
    // ==================== 媒体库（核心） ====================
    readonly mediaItems = signal<MediaItem[]>([]);
    readonly activeMediaItem = signal<MediaItem | null>(null);
    readonly collections = signal<Collection[]>([]);

    // ==================== UI 状态 ====================
    readonly viewMode = signal<ViewMode>('grid');
    readonly sortBy = signal<SortBy>('date');
    readonly sortOrder = signal<SortOrder>('desc');
    readonly currentFilter = signal<MediaFilter>({});
    readonly searchQuery = signal<string>('');

    // ==================== 工作流（保持独立） ====================
    readonly workflows = signal<Workflow[]>([]);
    readonly activeWorkflow = signal<Workflow | null>(null);

    // ==================== 回收站 ====================
    readonly deletedItems = signal<DeletedItem[]>([]);

    // ==================== 处理任务 ====================
    readonly processingJobs = signal<ProcessingJob[]>([]);

    private readonly backendSaveDebounceMs = 600;
    private backendAvailable = false;
    private persistenceReady = false;
    private pendingSaveBeforeReady = false;
    private backendSaveTimer: any = null;
    private backendSaveInFlight = false;
    private backendSaveQueued = false;

    // ==================== 用户 & 设置 ====================
    readonly userProfile = signal<UserProfile>({
        id: 'user-1',
        name: 'User Name',
        email: 'user@vecho.ai',
        bio: '',
        location: ''
    });

    readonly connectedAccounts = signal<ConnectedAccount[]>([
        {
            id: 'acc-1',
            provider: 'google',
            email: 'user@gmail.com',
            connected: true,
            connectedAt: new Date().toISOString()
        },
        {
            id: 'acc-2',
            provider: 'github',
            email: '',
            connected: false
        }
    ]);

    readonly settings = signal<AppSettings>(createDefaultSettings());

    updateSettings(updater: (prev: AppSettings) => AppSettings): void {
        let changed = false;
        this.settings.update((prev) => {
            const next = updater(prev);
            changed = next !== prev;
            return next;
        });
        if (changed) this.saveToStorage();
    }

    setSettings(next: AppSettings): void {
        this.settings.set(next);
        this.saveToStorage();
    }

    // ==================== 活动日志 ====================
    readonly activities = signal<ActivityItem[]>([]);

    // ==================== Computed Stats ====================
    readonly stats = computed(() => ({
        totalMedia: this.mediaItems().length,
        totalVideos: this.mediaItems().filter(m => m.type === 'video').length,
        totalAudios: this.mediaItems().filter(m => m.type === 'audio').length,
        totalDuration: this.formatDuration(
            this.mediaItems().reduce((sum, m) => sum + m.duration, 0)
        ),
        storageUsed: this.calculateStorageUsage(),
        transcribedCount: this.mediaItems().filter(m => m.transcription).length,
        totalNotes: this.mediaItems().reduce((sum, m) => sum + m.notes.length, 0),
        totalBookmarks: this.mediaItems().reduce((sum, m) => sum + m.bookmarks.length, 0)
    }));

    // 过滤后的媒体列表
    readonly filteredMediaItems = computed(() => {
        let items = [...this.mediaItems()];
        const filter = this.currentFilter();
        const query = this.searchQuery().toLowerCase();

        // 类型过滤
        if (filter.type && filter.type !== 'all') {
            items = items.filter(m => m.type === filter.type);
        }

        // 收藏夹过滤
        if (filter.folderId) {
            const targetCollection = this.collections().find(c => c.id === filter.folderId);
            if (targetCollection) {
                items = items.filter(m => targetCollection.mediaIds.includes(m.id));
            }
        }

        // 标签过滤
        if (filter.tags && filter.tags.length > 0) {
            items = items.filter(m =>
                filter.tags!.some(tag => m.tags.includes(tag))
            );
        }

        // 搜索过滤
        if (query) {
            items = items.filter(m =>
                m.name.toLowerCase().includes(query) ||
                m.tags.some(t => t.toLowerCase().includes(query)) ||
                m.notes.some(n =>
                    n.title.toLowerCase().includes(query) ||
                    n.content.toLowerCase().includes(query)
                )
            );
        }

        // 排序
        const sortBy = this.sortBy();
        const sortOrder = this.sortOrder();
        items.sort((a, b) => {
            let cmp = 0;
            switch (sortBy) {
                case 'name':
                    cmp = a.name.localeCompare(b.name);
                    break;
                case 'date':
                    cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
                    break;
                case 'duration':
                    cmp = a.duration - b.duration;
                    break;
                case 'size':
                    const sizeA = a.source.type === 'local' ? a.source.fileSize : 0;
                    const sizeB = b.source.type === 'local' ? b.source.fileSize : 0;
                    cmp = sizeA - sizeB;
                    break;
            }
            return sortOrder === 'asc' ? cmp : -cmp;
        });

        return items;
    });

    constructor(private storage: StorageService, private backend: BackendService) {
        void this.bootstrapPersistence();
    }

    private async bootstrapPersistence(): Promise<void> {
        this.backendAvailable = await this.backend.isAvailable();

        if (this.backendAvailable) {
            const persisted = await this.backend.loadState();
            if (persisted && persisted.version === 1 && persisted.data) {
                this.applyPersistedData(persisted.data);
            } else {
                // Migration path: if a user ran the web build before, pull from localStorage once.
                const migrated = this.loadFromStorage();
                if (migrated) {
                    void this.backend.saveState(this.exportPersistedState());
                }
                // In desktop mode, default to an empty workspace (no auto mock data).
            }

            // Listen for backend job events.
            await this.backend.listenJobProgress((evt) => this.onBackendJobProgress(evt));
        } else {
            this.loadFromStorage();
            this.initializeMockData();
        }

        this.persistenceReady = true;
        if (this.pendingSaveBeforeReady) {
            this.pendingSaveBeforeReady = false;
            this.saveToStorage();
        }
    }

    private exportPersistedState(): PersistedAppState {
        return {
            version: 1,
            savedAt: new Date().toISOString(),
            data: {
                mediaItems: this.mediaItems(),
                collections: this.collections(),
                workflows: this.workflows(),
                deletedItems: this.deletedItems(),
                settings: this.settings(),
                userProfile: this.userProfile(),
                activities: this.activities(),
            }
        };
    }

    private applyPersistedData(data: PersistedAppState['data']): void {
        this.mediaItems.set(data.mediaItems || []);
        this.collections.set(this.normalizeCollections(data.collections || []));
        this.workflows.set(data.workflows || []);
        this.deletedItems.set(data.deletedItems || []);
        if (data.settings) this.settings.set(this.normalizeSettings(data.settings));
        if (data.userProfile) this.userProfile.set(data.userProfile);
        this.activities.set(data.activities || []);
    }

    private onBackendJobProgress(event: BackendJobProgressEvent): void {
        const type: ProcessingJob['type'] = event.job_type === 'import'
            ? 'import'
            : event.job_type === 'download'
                ? 'download'
                : event.job_type === 'optimize'
                    ? 'optimize'
                : event.job_type === 'summary'
                    ? 'summary'
                    : event.job_type === 'export'
                        ? 'export'
                        : event.job_type === 'subtitle'
                            ? 'subtitle'
                            : 'transcription';

        const status: ProcessingJob['status'] = event.status === 'queued'
            ? 'pending'
            : event.status === 'running'
                ? 'processing'
                : event.status === 'succeeded'
                    ? 'completed'
                    : event.status === 'failed'
                        ? 'failed'
                        : 'cancelled';

        const pct = Math.max(0, Math.min(100, Math.round((Number(event.progress) || 0) * 100)));
        const now = new Date().toISOString();

        this.processingJobs.update(jobs => {
            const idx = jobs.findIndex(j => j.id === event.job_id);
            if (idx === -1) {
                const job: ProcessingJob = {
                    id: event.job_id,
                    mediaId: event.media_id,
                    type,
                    status,
                    progress: pct,
                    message: event.message || undefined,
                    startedAt: now,
                    completedAt: (status === 'completed' || status === 'failed' || status === 'cancelled') ? now : undefined,
                    error: status === 'failed' ? (event.message || 'Job failed') : undefined,
                };
                return [job, ...jobs].slice(0, 100);
            }

            const existing = jobs[idx];
            const updated: ProcessingJob = {
                ...existing,
                type,
                status,
                progress: pct,
                message: event.message || existing.message,
                startedAt: existing.startedAt || now,
                completedAt: (status === 'completed' || status === 'failed' || status === 'cancelled')
                    ? (existing.completedAt || now)
                    : undefined,
                error: status === 'failed' ? (event.message || existing.error) : undefined,
            };

            const next = [...jobs];
            next[idx] = updated;
            return next;
        });
    }

    // ==================== CRUD: Media Items ====================

    addMediaItem(item: Omit<MediaItem, 'id' | 'createdAt' | 'updatedAt' | 'notes' | 'bookmarks' | 'aiChats' | 'playCount'>): MediaItem {
        const newItem: MediaItem = {
            ...item,
            id: this.generateId('media'),
            notes: [],
            bookmarks: [],
            aiChats: [],
            playCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        this.mediaItems.update(items => [...items, newItem]);
        this.addActivity({
            type: 'import',
            title: newItem.name,
            desc: `已导入${newItem.type === 'video' ? '视频' : '音频'}`,
            time: '刚刚',
            mediaId: newItem.id,
            status: 'success'
        });
        this.saveToStorage();
        return newItem;
    }

    updateMediaItem(id: string, updates: Partial<MediaItem>): void {
        this.mediaItems.update(items =>
            items.map(item => item.id === id ? {
                ...item,
                ...updates,
                updatedAt: new Date().toISOString()
            } : item)
        );
        // 如果更新的是当前活跃项，同步更新
        const active = this.activeMediaItem();
        if (active?.id === id) {
            const updated = this.mediaItems().find(m => m.id === id);
            if (updated) this.activeMediaItem.set(updated);
        }
        this.saveToStorage();
    }

    deleteMediaItem(id: string): void {
        const item = this.mediaItems().find(m => m.id === id);
        if (item) {
            this.moveToTrash('media', item);
            this.mediaItems.update(items => items.filter(m => m.id !== id));

            // Also detach from any collections to avoid dangling references/counts.
            this.collections.update(cols =>
                cols.map(c => c.mediaIds.includes(id)
                    ? { ...c, mediaIds: c.mediaIds.filter(mid => mid !== id) }
                    : c
                )
            );

            if (this.activeMediaItem()?.id === id) {
                this.activeMediaItem.set(null);
            }
            this.saveToStorage();
        }
    }

    /**
     * Removes a media item without moving it to trash.
     * Intended for failed imports / aborted operations.
     */
    discardMediaItem(id: string): void {
        this.mediaItems.update(items => items.filter(m => m.id !== id));

        // Detach from collections to avoid dangling references/counts.
        this.collections.update(cols =>
            cols.map(c => c.mediaIds.includes(id)
                ? { ...c, mediaIds: c.mediaIds.filter(mid => mid !== id) }
                : c
            )
        );

        if (this.activeMediaItem()?.id === id) {
            this.activeMediaItem.set(null);
        }

        this.saveToStorage();
    }

    setActiveMediaItem(id: string | null): void {
        if (id === null) {
            this.activeMediaItem.set(null);
            return;
        }
        const item = this.mediaItems().find(m => m.id === id);
        if (item) {
            this.activeMediaItem.set(item);
            // 更新播放记录
            this.updateMediaItem(id, {
                lastPlayedAt: new Date().toISOString(),
                playCount: item.playCount + 1
            });
        }
    }

    // ==================== CRUD: Notes (挂载在 MediaItem 下) ====================

    addNoteToMedia(mediaId: string, note: Omit<MediaNote, 'id' | 'mediaId' | 'createdAt' | 'updatedAt'>): MediaNote | null {
        const media = this.mediaItems().find(m => m.id === mediaId);
        if (!media) return null;

        const newNote: MediaNote = {
            ...note,
            id: this.generateId('note'),
            mediaId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this.updateMediaItem(mediaId, {
            notes: [...media.notes, newNote]
        });

        this.addActivity({
            type: 'note',
            title: newNote.title || '新笔记',
            desc: `添加到 "${media.name}"`,
            time: '刚刚',
            mediaId,
            status: 'success'
        });

        return newNote;
    }

    updateNote(mediaId: string, noteId: string, updates: Partial<MediaNote>): void {
        const media = this.mediaItems().find(m => m.id === mediaId);
        if (!media) return;

        const updatedNotes = media.notes.map(n =>
            n.id === noteId ? { ...n, ...updates, updatedAt: new Date().toISOString() } : n
        );

        this.updateMediaItem(mediaId, { notes: updatedNotes });
    }

    deleteNote(mediaId: string, noteId: string): void {
        const media = this.mediaItems().find(m => m.id === mediaId);
        if (!media) return;

        this.updateMediaItem(mediaId, {
            notes: media.notes.filter(n => n.id !== noteId)
        });
    }

    // ==================== CRUD: Bookmarks ====================

    addBookmark(mediaId: string, bookmark: Omit<Bookmark, 'id' | 'mediaId' | 'createdAt'>): Bookmark | null {
        const media = this.mediaItems().find(m => m.id === mediaId);
        if (!media) return null;

        const newBookmark: Bookmark = {
            ...bookmark,
            id: this.generateId('bm'),
            mediaId,
            createdAt: new Date().toISOString()
        };

        this.updateMediaItem(mediaId, {
            bookmarks: [...media.bookmarks, newBookmark].sort((a, b) => a.timestamp - b.timestamp)
        });

        this.addActivity({
            type: 'bookmark',
            title: newBookmark.label,
            desc: `在 ${this.formatTimestamp(newBookmark.timestamp)} 添加书签`,
            time: '刚刚',
            mediaId,
            status: 'success'
        });

        return newBookmark;
    }

    updateBookmark(mediaId: string, bookmarkId: string, updates: Partial<Bookmark>): void {
        const media = this.mediaItems().find(m => m.id === mediaId);
        if (!media) return;
        const bid = (bookmarkId || '').trim();
        if (!bid) return;

        const next = media.bookmarks.map(b => b.id === bid ? { ...b, ...updates } : b);
        this.updateMediaItem(mediaId, { bookmarks: next.sort((a, b) => a.timestamp - b.timestamp) });
    }

    deleteBookmark(mediaId: string, bookmarkId: string): void {
        const media = this.mediaItems().find(m => m.id === mediaId);
        if (!media) return;

        this.updateMediaItem(mediaId, {
            bookmarks: media.bookmarks.filter(b => b.id !== bookmarkId)
        });
    }

    // ==================== Transcription ====================

    setTranscription(mediaId: string, transcription: Transcription): void {
        this.updateMediaItem(mediaId, { transcription });
        const media = this.mediaItems().find(m => m.id === mediaId);
        this.addActivity({
            type: 'transcription',
            title: media?.name || '媒体文件',
            desc: `转写完成，共 ${transcription.segments.length} 段`,
            time: '刚刚',
            mediaId,
            status: 'success'
        });
    }

    // ==================== AI Summary ====================

    setAISummary(mediaId: string, summary: AISummary): void {
        this.updateMediaItem(mediaId, { summary });
        const media = this.mediaItems().find(m => m.id === mediaId);
        this.addActivity({
            type: 'summary',
            title: media?.name || '媒体文件',
            desc: 'AI 总结生成完成',
            time: '刚刚',
            mediaId,
            status: 'success'
        });
    }

    // ==================== AI Conversations ====================

    startAIConversation(mediaId: string, title?: string): AIConversation | null {
        const media = this.mediaItems().find(m => m.id === mediaId);
        if (!media) return null;

        const newChat: AIConversation = {
            id: this.generateId('chat'),
            mediaId,
            title: title || `对话 ${media.aiChats.length + 1}`,
            messages: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this.updateMediaItem(mediaId, {
            aiChats: [...media.aiChats, newChat]
        });

        return newChat;
    }

    renameAIConversation(mediaId: string, chatId: string, title: string): void {
        const t = (title || '').trim();
        if (!t) return;
        const media = this.mediaItems().find(m => m.id === mediaId);
        if (!media) return;
        const nextChats = media.aiChats.map(c => c.id === chatId
            ? { ...c, title: t, updatedAt: new Date().toISOString() }
            : c
        );
        this.updateMediaItem(mediaId, { aiChats: nextChats });
    }

    deleteAIConversation(mediaId: string, chatId: string): void {
        const media = this.mediaItems().find(m => m.id === mediaId);
        if (!media) return;
        const next = media.aiChats.filter(c => c.id !== chatId);
        this.updateMediaItem(mediaId, { aiChats: next });
    }

    addMessageToConversation(mediaId: string, chatId: string, message: Omit<AIConversation['messages'][0], 'id' | 'timestamp'>): void {
        const media = this.mediaItems().find(m => m.id === mediaId);
        if (!media) return;

        const updatedChats = media.aiChats.map(chat => {
            if (chat.id !== chatId) return chat;
            return {
                ...chat,
                messages: [...chat.messages, {
                    ...message,
                    id: this.generateId('msg'),
                    timestamp: new Date().toISOString()
                }],
                updatedAt: new Date().toISOString()
            };
        });

        this.updateMediaItem(mediaId, { aiChats: updatedChats });
    }

    // ==================== Collections (收藏夹) ====================

    addCollection(collection: Omit<Collection, 'id' | 'createdAt' | 'updatedAt' | 'sortOrder' | 'mediaIds'>): Collection {
        const now = new Date().toISOString();
        const newCollection: Collection = {
            ...collection,
            id: this.generateId('col'),
            mediaIds: [],
            sortOrder: this.collections().length,
            createdAt: now,
            updatedAt: now
        };
        this.collections.update(cols => [...cols, newCollection]);
        this.saveToStorage();
        return newCollection;
    }

    updateCollection(id: string, updates: Partial<Collection>): void {
        this.collections.update(cols =>
            cols.map(c => c.id === id ? {
                ...c,
                ...updates,
                updatedAt: new Date().toISOString()
            } : c)
        );
        this.saveToStorage();
    }

    deleteCollection(id: string): void {
        this.collections.update(cols => cols.filter(c => c.id !== id));
        this.saveToStorage();
    }

    // 添加媒体到收藏夹
    addMediaToCollection(collectionId: string, mediaId: string): void {
        this.collections.update(cols =>
            cols.map(c => {
                if (c.id !== collectionId) return c;
                if (c.mediaIds.includes(mediaId)) return c;
                return {
                    ...c,
                    mediaIds: [...c.mediaIds, mediaId],
                    updatedAt: new Date().toISOString()
                };
            })
        );
        this.saveToStorage();
    }

    // 从收藏夹移除媒体
    removeMediaFromCollection(collectionId: string, mediaId: string): void {
        this.collections.update(cols =>
            cols.map(c => {
                if (c.id !== collectionId) return c;
                return {
                    ...c,
                    mediaIds: c.mediaIds.filter(id => id !== mediaId),
                    updatedAt: new Date().toISOString()
                };
            })
        );
        this.saveToStorage();
    }

    // 收藏夹排序
    reorderCollections(fromIndex: number, toIndex: number): void {
        const cols = [...this.collections()].sort((a, b) => a.sortOrder - b.sortOrder);
        const [moved] = cols.splice(fromIndex, 1);
        cols.splice(toIndex, 0, moved);
        // 更新 sortOrder
        cols.forEach((c, i) => c.sortOrder = i);
        this.collections.set(cols);
        this.saveToStorage();
    }

    // ==================== Workflows (保持兼容) ====================

    addWorkflow(workflow: Omit<Workflow, 'id' | 'createdAt' | 'modified'>): Workflow {
        const newWorkflow: Workflow = {
            ...workflow,
            id: this.generateId('wf'),
            createdAt: new Date().toISOString(),
            modified: new Date().toISOString()
        };
        this.workflows.update(wfs => [...wfs, newWorkflow]);
        this.saveToStorage();
        return newWorkflow;
    }

    updateWorkflow(id: string, updates: Partial<Workflow>): void {
        this.workflows.update(wfs =>
            wfs.map(wf => wf.id === id ? {
                ...wf,
                ...updates,
                modified: new Date().toISOString()
            } : wf)
        );
        this.saveToStorage();
    }

    deleteWorkflow(id: string): void {
        const workflow = this.workflows().find(wf => wf.id === id);
        if (workflow) {
            this.moveToTrash('workflow', workflow);
            this.workflows.update(wfs => wfs.filter(wf => wf.id !== id));
            this.saveToStorage();
        }
    }

    // ==================== Trash Management ====================

    private moveToTrash(type: DeletedItem['type'], data: any): void {
        const deletedItem: DeletedItem = {
            id: this.generateId('del'),
            originalId: data.id,
            type,
            name: data.name || data.title || 'Unnamed Item',
            preview: data.thumbnail,
            deletedAt: new Date().toISOString(),
            data
        };
        this.deletedItems.update(items => [...items, deletedItem]);
        this.saveToStorage();
    }

    restoreFromTrash(id: string): void {
        const item = this.deletedItems().find(i => i.id === id);
        if (!item) return;

        switch (item.type) {
            case 'media':
                this.mediaItems.update(items => [...items, item.data as MediaItem]);
                break;
            case 'workflow':
                this.workflows.update(wfs => [...wfs, item.data as Workflow]);
                break;
            case 'folder':
                this.collections.update(cols => [...cols, item.data as Collection]);
                break;
        }

        this.deletedItems.update(items => items.filter(i => i.id !== id));
        this.saveToStorage();
    }

    permanentlyDelete(id: string): void {
        this.deletedItems.update(items => items.filter(i => i.id !== id));
        this.saveToStorage();
    }

    emptyTrash(): void {
        this.deletedItems.set([]);
        this.saveToStorage();
    }

    // ==================== Processing Jobs ====================

    addProcessingJob(mediaId: string, type: ProcessingJob['type']): ProcessingJob {
        const job: ProcessingJob = {
            id: this.generateId('job'),
            mediaId,
            type,
            status: 'pending',
            progress: 0,
            startedAt: new Date().toISOString()
        };
        this.processingJobs.update(jobs => [...jobs, job]);
        return job;
    }

    updateJobProgress(id: string, progress: number, status?: ProcessingJob['status']): void {
        this.processingJobs.update(jobs =>
            jobs.map(j => j.id === id ? {
                ...j,
                progress,
                status: status || j.status,
                completedAt: status === 'completed' ? new Date().toISOString() : j.completedAt
            } : j)
        );
    }

    // ==================== Activity ====================

    addActivity(activity: Omit<ActivityItem, 'id'>): void {
        const newActivity: ActivityItem = {
            ...activity,
            id: this.generateId('act')
        };
        this.activities.update(acts => [newActivity, ...acts].slice(0, 100)); // Keep last 100
    }

    // ==================== Storage Sync ====================

    private loadFromStorage(): boolean {
        const mediaItems = this.storage.get<MediaItem[]>('mediaItems');
        const collections = this.storage.get<Collection[]>('collections');
        const workflows = this.storage.get<Workflow[]>('workflows');
        const deletedItems = this.storage.get<DeletedItem[]>('deletedItems');
        const settings = this.storage.get<AppSettings>('settings');
        const userProfile = this.storage.get<UserProfile>('userProfile');
        const activities = this.storage.get<ActivityItem[]>('activities');

        const hasAny = !!(mediaItems || collections || workflows || deletedItems || settings || userProfile || activities);
        if (mediaItems) this.mediaItems.set(mediaItems);
        if (collections) this.collections.set(this.normalizeCollections(collections));
        if (workflows) this.workflows.set(workflows);
        if (deletedItems) this.deletedItems.set(deletedItems);
        if (settings) this.settings.set(this.normalizeSettings(settings));
        if (userProfile) this.userProfile.set(userProfile);
        if (activities) this.activities.set(activities);

        return hasAny;
    }

    private saveToStorage(): void {
        if (!this.persistenceReady) {
            this.pendingSaveBeforeReady = true;
            return;
        }

        if (this.backendAvailable) {
            this.scheduleBackendSave();
            return;
        }

        this.storage.set('mediaItems', this.mediaItems());
        this.storage.set('collections', this.collections());
        this.storage.set('workflows', this.workflows());
        this.storage.set('deletedItems', this.deletedItems());
        this.storage.set('settings', this.settings());
        this.storage.set('userProfile', this.userProfile());
        this.storage.set('activities', this.activities());
    }

    private scheduleBackendSave(): void {
        if (this.backendSaveTimer) {
            clearTimeout(this.backendSaveTimer);
        }
        this.backendSaveTimer = setTimeout(() => {
            this.backendSaveTimer = null;
            void this.flushBackendSave();
        }, this.backendSaveDebounceMs);
    }

    private async flushBackendSave(): Promise<void> {
        if (!this.backendAvailable) return;

        if (this.backendSaveInFlight) {
            this.backendSaveQueued = true;
            return;
        }

        this.backendSaveInFlight = true;
        try {
            await this.backend.saveState(this.exportPersistedState());
        } catch (err) {
            console.error('save_state failed', err);
        } finally {
            this.backendSaveInFlight = false;
        }

        if (this.backendSaveQueued) {
            this.backendSaveQueued = false;
            this.scheduleBackendSave();
        }
    }

    // ==================== Utilities ====================

    private generateId(prefix: string): string {
        return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    private calculateStorageUsage(): string {
        const total = this.mediaItems().reduce((sum, m) => {
            if (m.source.type === 'local') {
                return sum + m.source.fileSize;
            }
            return sum;
        }, 0);
        if (total < 1024 * 1024) {
            return `${(total / 1024).toFixed(1)} KB`;
        } else if (total < 1024 * 1024 * 1024) {
            return `${(total / (1024 * 1024)).toFixed(1)} MB`;
        } else {
            return `${(total / (1024 * 1024 * 1024)).toFixed(1)} GB`;
        }
    }

    private formatDuration(seconds: number): string {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }

    private formatTimestamp(seconds: number): string {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    private normalizeSettings(raw: any): AppSettings {
        const d = createDefaultSettings();
        const s = (raw && typeof raw === 'object') ? raw : {};

        const appearanceRaw = (s as any).appearance || {};
        const workspaceRaw = (s as any).workspace || {};
        const transcriptionRaw = (s as any).transcription || {};
        const aiRaw = (s as any).ai || {};
        const pluginsRaw = (s as any).plugins || {};

        const appearance: AppSettings['appearance'] = {
            theme: appearanceRaw.theme === 'dark' ? 'dark' : 'light',
            language: appearanceRaw.language === 'en' ? 'en' : 'zh',
            sidebarCollapsed: typeof appearanceRaw.sidebarCollapsed === 'boolean'
                ? appearanceRaw.sidebarCollapsed
                : d.appearance.sidebarCollapsed,
        };

        const workspace: AppSettings['workspace'] = {
            autoSave: typeof workspaceRaw.autoSave === 'boolean' ? workspaceRaw.autoSave : d.workspace.autoSave,
            defaultLocation: typeof workspaceRaw.defaultLocation === 'string' && workspaceRaw.defaultLocation.trim()
                ? workspaceRaw.defaultLocation
                : d.workspace.defaultLocation,
        };

        const allowedAccel = new Set(['auto', 'cpu', 'cuda']);
        const localAccelerator = allowedAccel.has(transcriptionRaw.localAccelerator)
            ? transcriptionRaw.localAccelerator
            : d.transcription.localAccelerator;

        const allowedTranscriptionLang = new Set(['auto', 'en', 'zh', 'ja', 'ko', 'yue']);
        const transcriptionLang = allowedTranscriptionLang.has(transcriptionRaw.language)
            ? transcriptionRaw.language
            : d.transcription.language;

        const numThreads = (typeof transcriptionRaw.numThreads === 'number' && Number.isFinite(transcriptionRaw.numThreads))
            ? Math.max(0, Math.floor(transcriptionRaw.numThreads))
            : d.transcription.numThreads;

        const useItn = (typeof transcriptionRaw.useItn === 'boolean')
            ? transcriptionRaw.useItn
            : d.transcription.useItn;

        let transcriptionEngine: AppSettings['transcription']['engine'] = d.transcription.engine;
        if (transcriptionRaw.engine === 'local_sherpa_onnx'
            || transcriptionRaw.engine === 'local_whisper_cpp'
            || transcriptionRaw.engine === 'openai_compatible') {
            transcriptionEngine = transcriptionRaw.engine;
        }

        // Back-compat: some older configs might have used "local" / "cloud".
        if (transcriptionRaw.engine === 'local') transcriptionEngine = 'local_sherpa_onnx';
        if (transcriptionRaw.engine === 'local_whispercpp') transcriptionEngine = 'local_whisper_cpp';
        if (transcriptionRaw.engine === 'cloud') transcriptionEngine = 'openai_compatible';

        // Back-compat (v0): ai.{apiEndpoint/apiKey/defaultModel}
        const legacyAiEndpoint = typeof aiRaw.apiEndpoint === 'string' ? aiRaw.apiEndpoint : null;
        const legacyAiKey = typeof aiRaw.apiKey === 'string' ? aiRaw.apiKey : null;
        const legacyAiModel = typeof aiRaw.defaultModel === 'string' ? aiRaw.defaultModel : null;

        const transcriptionOpenaiRaw = transcriptionRaw.openai || {};
        const transcriptionOpenai: AppSettings['transcription']['openai'] = {
            baseUrl: (typeof transcriptionOpenaiRaw.baseUrl === 'string' && transcriptionOpenaiRaw.baseUrl.trim())
                ? transcriptionOpenaiRaw.baseUrl
                : (legacyAiEndpoint && legacyAiEndpoint.trim() ? legacyAiEndpoint : d.transcription.openai.baseUrl),
            apiKey: typeof transcriptionOpenaiRaw.apiKey === 'string'
                ? transcriptionOpenaiRaw.apiKey
                : (legacyAiKey ?? d.transcription.openai.apiKey),
            model: (typeof transcriptionOpenaiRaw.model === 'string' && transcriptionOpenaiRaw.model.trim())
                ? transcriptionOpenaiRaw.model
                : d.transcription.openai.model,
        };

        let provider: AppSettings['ai']['provider'] = d.ai.provider;
        const providerRaw = aiRaw.provider;
        if (providerRaw === 'openai_compatible' || providerRaw === 'gemini') {
            provider = providerRaw;
        } else if (providerRaw === 'openai' || providerRaw === 'local' || providerRaw === 'custom') {
            provider = 'openai_compatible';
        }

        const openaiRaw = aiRaw.openai || {};
        const openai: AppSettings['ai']['openai'] = {
            baseUrl: (typeof openaiRaw.baseUrl === 'string' && openaiRaw.baseUrl.trim())
                ? openaiRaw.baseUrl
                : (legacyAiEndpoint && legacyAiEndpoint.trim() ? legacyAiEndpoint : d.ai.openai.baseUrl),
            apiKey: typeof openaiRaw.apiKey === 'string'
                ? openaiRaw.apiKey
                : (legacyAiKey ?? d.ai.openai.apiKey),
            chatModel: (typeof openaiRaw.chatModel === 'string' && openaiRaw.chatModel.trim())
                ? openaiRaw.chatModel
                : (legacyAiModel && legacyAiModel.trim() ? legacyAiModel : d.ai.openai.chatModel),
            summaryModel: (typeof openaiRaw.summaryModel === 'string' && openaiRaw.summaryModel.trim())
                ? openaiRaw.summaryModel
                : d.ai.openai.summaryModel,
        };

        const geminiRaw = aiRaw.gemini || {};
        const gemini: AppSettings['ai']['gemini'] = {
            baseUrl: (typeof geminiRaw.baseUrl === 'string' && geminiRaw.baseUrl.trim())
                ? geminiRaw.baseUrl
                : d.ai.gemini.baseUrl,
            apiKey: typeof geminiRaw.apiKey === 'string'
                ? geminiRaw.apiKey
                : d.ai.gemini.apiKey,
            model: (typeof geminiRaw.model === 'string' && geminiRaw.model.trim())
                ? geminiRaw.model
                : d.ai.gemini.model,
        };

        // Summary prompt templates
        const promptsRaw = (aiRaw as any).summaryPrompts;
        let summaryPrompts: AppSettings['ai']['summaryPrompts'] = Array.isArray(promptsRaw)
            ? promptsRaw
                .filter((x: any) => x && typeof x === 'object')
                .map((p: any) => ({
                    id: typeof p.id === 'string' && p.id.trim() ? p.id.trim() : this.generateId('sum'),
                    name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : '自定义模板',
                    template: typeof p.template === 'string' ? p.template : '',
                }))
            : d.ai.summaryPrompts;
        if (!summaryPrompts.length) summaryPrompts = d.ai.summaryPrompts;

        let defaultSummaryPromptId = (typeof (aiRaw as any).defaultSummaryPromptId === 'string')
            ? (aiRaw as any).defaultSummaryPromptId
            : d.ai.defaultSummaryPromptId;
        if (!summaryPrompts.some(p => p.id === defaultSummaryPromptId)) {
            defaultSummaryPromptId = summaryPrompts[0].id;
        }

        const plugins: AppSettings['plugins'] = {
            enabled: Array.isArray(pluginsRaw.enabled)
                ? pluginsRaw.enabled.filter((x: any) => typeof x === 'string' && x.trim())
                : d.plugins.enabled,
        };

        return {
            appearance,
            workspace,
            transcription: {
                engine: transcriptionEngine,
                localAccelerator,
                language: transcriptionLang,
                numThreads,
                useItn,
                openai: transcriptionOpenai,
            },
            ai: {
                provider,
                openai,
                gemini,
                summaryPrompts,
                defaultSummaryPromptId,
            },
            plugins,
        };
    }

    private normalizeCollections(raw: any): Collection[] {
        if (!Array.isArray(raw)) return [];
        const now = new Date().toISOString();

        const cols: Collection[] = raw
            .filter((x) => x && typeof x === 'object')
            .map((c: any, idx: number) => {
                const id = (typeof c.id === 'string' && c.id.trim()) ? c.id : this.generateId('col');
                const name = (typeof c.name === 'string' && c.name.trim()) ? c.name : '收藏夹';
                const mediaIds = Array.isArray(c.mediaIds)
                    ? c.mediaIds.filter((x: any) => typeof x === 'string' && x.trim())
                    : [];
                const sortOrder = (typeof c.sortOrder === 'number' && Number.isFinite(c.sortOrder)) ? c.sortOrder : idx;
                const createdAt = (typeof c.createdAt === 'string' && c.createdAt.trim()) ? c.createdAt : now;
                const updatedAt = (typeof c.updatedAt === 'string' && c.updatedAt.trim()) ? c.updatedAt : createdAt;
                const color = (typeof c.color === 'string' && c.color.trim()) ? c.color : undefined;
                const icon = (typeof c.icon === 'string' && c.icon.trim()) ? c.icon : undefined;
                return { id, name, color, icon, mediaIds, sortOrder, createdAt, updatedAt };
            });

        cols.sort((a, b) => a.sortOrder - b.sortOrder);
        cols.forEach((c, i) => c.sortOrder = i);
        return cols;
    }

    // ==================== Mock Data (开发阶段) ====================

    private initializeMockData(): void {
        // 仅在没有数据时初始化 mock 数据
        if (this.mediaItems().length === 0) {
            const mockItems: MediaItem[] = [
                {
                    id: 'media-1',
                    type: 'video',
                    name: '游戏设计分析 - EP.12 关卡设计',
                    source: {
                        type: 'online',
                        platform: 'bilibili',
                        url: 'https://www.bilibili.com/video/BV1example',
                        originalTitle: '【游戏提灯】第12期：关卡设计',
                        uploader: '游戏提灯'
                    },
                    thumbnail: undefined,
                    duration: 1245,
                    meta: { kind: 'video', width: 1920, height: 1080, framerate: 30, codec: 'H.264' },
                    notes: [
                        {
                            id: 'note-1',
                            mediaId: 'media-1',
                            timestamp: 120,
                            title: '关卡节奏分析',
                            content: '视频提到的"紧张-放松"节奏设计非常有参考价值...',
                            isPinned: true,
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString()
                        }
                    ],
                    bookmarks: [
                        {
                            id: 'bm-1',
                            mediaId: 'media-1',
                            timestamp: 300,
                            label: '核心观点',
                            color: 'blue',
                            createdAt: new Date().toISOString()
                        },
                        {
                            id: 'bm-2',
                            mediaId: 'media-1',
                            timestamp: 890,
                            label: '案例分析',
                            color: 'green',
                            createdAt: new Date().toISOString()
                        }
                    ],
                    aiChats: [],
                    tags: ['游戏设计', '关卡设计', '教程'],
                    playCount: 3,
                    lastPlayedAt: new Date().toISOString(),
                    lastPosition: 450,
                    status: 'ready',
                    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
                    updatedAt: new Date().toISOString()
                },
                {
                    id: 'media-2',
                    type: 'audio',
                    name: '播客：独立游戏开发心得',
                    source: {
                        type: 'local',
                        path: 'D:/Podcasts/indie_game_dev_ep42.mp3',
                        fileSize: 45 * 1024 * 1024
                    },
                    thumbnail: undefined,
                    duration: 3600,
                    meta: { kind: 'audio', sampleRate: 44100, channels: 2, codec: 'MP3' },
                    transcription: {
                        id: 'trans-1',
                        mediaId: 'media-2',
                        language: 'zh',
                        segments: [
                            { id: 'seg-1', start: 0, end: 5, text: '欢迎收听本期播客...' },
                            { id: 'seg-2', start: 5, end: 12, text: '今天我们聊聊独立游戏开发的心路历程...' }
                        ],
                        wordCount: 12500,
                        generatedAt: new Date().toISOString(),
                        model: 'sherpa-onnx:sensevoice-small-float'
                    },
                    notes: [],
                    bookmarks: [],
                    aiChats: [],
                    tags: ['播客', '独立游戏', '开发'],
                    playCount: 1,
                    status: 'ready',
                    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
                    updatedAt: new Date(Date.now() - 86400000 * 3).toISOString()
                },
                {
                    id: 'media-3',
                    type: 'video',
                    name: 'Interface Design Tutorial',
                    source: {
                        type: 'local',
                        path: 'D:/Videos/tutorials/interface_design.mkv',
                        fileSize: 124 * 1024 * 1024
                    },
                    thumbnail: undefined,
                    duration: 1950,
                    meta: { kind: 'video', width: 1920, height: 1080, framerate: 60, codec: 'H.264' },
                    notes: [],
                    bookmarks: [],
                    aiChats: [],
                    tags: ['设计', 'UI', '教程'],
                    playCount: 0,
                    status: 'ready',
                    createdAt: new Date(Date.now() - 86400000).toISOString(),
                    updatedAt: new Date(Date.now() - 86400000).toISOString()
                }
            ];

            this.mediaItems.set(mockItems);

            // 初始化收藏夹
            this.collections.set([
                {
                    id: 'col-1',
                    name: '游戏设计学习',
                    color: 'blue',
                    mediaIds: ['media-1'],
                    sortOrder: 0,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                },
                {
                    id: 'col-2',
                    name: '播客收藏',
                    color: 'purple',
                    mediaIds: ['media-2'],
                    sortOrder: 1,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                },
                {
                    id: 'col-3',
                    name: '教程视频',
                    color: 'green',
                    mediaIds: ['media-3'],
                    sortOrder: 2,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }
            ]);

            // 初始化活动日志
            this.activities.set([
                {
                    id: 'act-1',
                    type: 'import',
                    title: 'Interface Design Tutorial',
                    desc: '已导入视频',
                    time: '1 天前',
                    mediaId: 'media-3',
                    status: 'success',
                    color: 'blue'
                },
                {
                    id: 'act-2',
                    type: 'transcription',
                    title: '播客：独立游戏开发心得',
                    desc: '转写完成，共 156 段',
                    time: '3 天前',
                    mediaId: 'media-2',
                    status: 'success',
                    color: 'emerald'
                }
            ]);
        }

        if (this.workflows().length === 0) {
            this.workflows.set([
                {
                    id: 'wf-1',
                    name: '视频转写工作流',
                    desc: '导入 → Whisper 转写 → AI 总结',
                    status: 'active',
                    runs: 24,
                    modified: '2 小时前',
                    createdAt: new Date().toISOString(),
                    nodes: [],
                    connections: []
                },
                {
                    id: 'wf-2',
                    name: '音频降噪分离',
                    desc: 'Demucs 人声分离 + 降噪处理',
                    status: 'draft',
                    runs: 0,
                    modified: '昨天',
                    createdAt: new Date().toISOString(),
                    nodes: [],
                    connections: []
                }
            ]);
        }
    }
}
