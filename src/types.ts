// Core TypeScript type definitions for VideoSummary application
// Architecture: Media-Centric (视频/音频为核心的数据模型)

// ==================== 媒体来源类型 ====================

export interface LocalFileSource {
    type: 'local';
    path: string;           // 本地文件路径（Tauri 后端使用）
    fileSize: number;       // 字节数
}

export interface OnlineSource {
    type: 'online';
    platform: 'bilibili' | 'youtube' | 'other';
    url: string;
    originalTitle?: string;  // 原始标题
    uploader?: string;
    uploadDate?: string;

    // When downloaded for offline processing/playback.
    cachedPath?: string;
    fileSize?: number;
}

export type MediaSource = LocalFileSource | OnlineSource;

// ==================== 媒体元数据 ====================

export interface VideoMeta {
    kind: 'video';
    width: number;
    height: number;
    framerate: number;
    codec: string;
    bitrate?: number;
}

export interface AudioMeta {
    kind: 'audio';
    sampleRate: number;
    channels: number;
    codec: string;
    bitrate?: number;
}

export type MediaMeta = VideoMeta | AudioMeta;

// ==================== 核心：媒体项（一等公民） ====================

export interface AppTab {
    id: string;
    title: string;
    url: string;
    icon?: string;
    isActive: boolean;
    isClosable: boolean;
}

export interface MediaItem {
    id: string;
    // ... existing content ...
    type: 'video' | 'audio';

    // 基本信息
    name: string;                    // 用户可编辑的名称
    source: MediaSource;             // 来源（本地/在线）
    thumbnail?: string;              // Base64 或 URL
    duration: number;                // 秒

    // 技术元数据
    meta: MediaMeta;

    // ========== 关联内容（核心设计） ==========
    transcription?: Transcription;   // 转写结果
    notes: MediaNote[];              // 挂载的笔记（可多个）
    summary?: AISummary;             // AI 生成的总结
    bookmarks: Bookmark[];           // 时间戳书签/标记
    aiChats: AIConversation[];       // 与该媒体相关的 AI 对话

    // 分类与组织
    tags: string[];
    folderId?: string;               // 所属文件夹

    // 播放状态
    lastPlayedAt?: string;
    lastPosition?: number;           // 上次播放位置（秒）
    playCount: number;

    // 元信息
    createdAt: string;
    updatedAt: string;
    status: MediaItemStatus;
}

export type MediaItemStatus =
    | 'ready'           // 就绪，可播放
    | 'importing'       // 正在导入/下载
    | 'transcribing'    // 正在转写
    | 'processing'      // 其他处理中
    | 'error';          // 错误状态

// ==================== 转写相关 ====================

export interface Transcription {
    id: string;
    mediaId: string;
    language: string;
    segments: TranscriptionSegment[];
    wordCount: number;
    generatedAt: string;
    model?: string;          // 使用的 Whisper 模型
    confidence?: number;     // 0-1 置信度
}

export interface TranscriptionSegment {
    id: string;
    start: number;           // 秒
    end: number;
    text: string;
    speaker?: string;        // 说话人（Speaker Diarization）
    confidence?: number;
}

// ==================== 笔记（挂载在媒体下） ====================

export interface MediaNote {
    id: string;
    mediaId: string;              // 关联的媒体 ID（必须）
    timestamp?: number;           // 可选：关联的时间点（秒）
    timestampEnd?: number;        // 可选：时间范围结束
    title: string;
    content: string;              // Markdown 内容
    color?: string;               // 标签颜色
    isPinned: boolean;
    createdAt: string;
    updatedAt: string;
}

// ==================== 书签/时间戳标记 ====================

export interface Bookmark {
    id: string;
    mediaId: string;
    timestamp: number;            // 必须有时间戳
    label: string;
    color: BookmarkColor;
    emoji?: string;               // 可选的 emoji 标记
    createdAt: string;
}

export type BookmarkColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'gray';

// ==================== AI 总结 ====================

export interface AISummary {
    id: string;
    mediaId: string;
    content: string;              // Markdown 格式主体内容
    keyPoints?: string[];         // 关键要点列表
    mindmap?: string;             // Mermaid 格式思维导图
    chapters?: ChapterMark[];     // 章节划分
    generatedAt: string;
    promptUsed?: string;          // 使用的 prompt
    model?: string;               // 使用的 LLM 模型
}

export interface ChapterMark {
    timestamp: number;
    title: string;
    summary?: string;
}

// ==================== AI 对话 ====================

export interface AIConversation {
    id: string;
    mediaId: string;
    title: string;                // 对话标题（可自动生成）
    messages: AIMessage[];
    createdAt: string;
    updatedAt: string;
}

export interface AIMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
    referencedSegments?: string[];  // 引用的转写片段 ID
}

// ==================== 收藏夹/文件夹（支持嵌套） ====================

export interface Collection {
    id: string;
    name: string;
    color?: string;               // 显示颜色
    icon?: string;                // 自定义图标
    mediaIds: string[];           // 关联的媒体 ID 列表
    sortOrder: number;            // 排序顺序（用于拖拽排序）
    createdAt: string;
    updatedAt: string;
}

// 兼容性别名
export type MediaFolder = Collection;

// ==================== 工作流（保留原有功能） ====================

export interface WorkflowNode {
    id: string;
    type: 'input' | 'process' | 'output';
    label: string;
    x: number;
    y: number;
    config?: Record<string, any>;
    inputs?: string[];
    outputs?: string[];
}

export interface WorkflowConnection {
    id: string;
    from: string;
    to: string;
}

export interface Workflow {
    id: string;
    name: string;
    desc: string;
    status: 'active' | 'draft' | 'archiving';
    runs: number;
    modified: string;
    createdAt: string;
    nodes: WorkflowNode[];
    connections: WorkflowConnection[];
}

// ==================== 回收站 ====================

export type DeletedItemType = 'media' | 'workflow' | 'folder';

export interface DeletedItem {
    id: string;
    originalId: string;
    type: DeletedItemType;
    name: string;
    preview?: string;
    deletedAt: string;
    data: MediaItem | Workflow | MediaFolder;
}

// ==================== 用户 & 设置 ====================

export interface UserProfile {
    id: string;
    name: string;
    email: string;
    avatar?: string;
    bio?: string;
    location?: string;
    coverImage?: string;
}

export interface ConnectedAccount {
    id: string;
    provider: 'google' | 'github' | 'twitter';
    email: string;
    connected: boolean;
    connectedAt?: string;
}

export interface AppSettings {
    appearance: {
        theme: 'light' | 'dark';
        language: 'en' | 'zh';
        sidebarCollapsed: boolean;
    };
    workspace: {
        autoSave: boolean;
        defaultLocation: string;
    };
    player: {
        ccStyle: {
            fontSize: number;
            x: number;
            y: number;
            color: string;
            bgOpacity: number;
        };
    };
    transcription: {
        /** Local (sherpa-onnx + SenseVoice) or cloud (OpenAI-compatible) */
        engine: 'local_sherpa_onnx' | 'local_whisper_cpp' | 'openai_compatible';

        /** Transcription language hint */
        language: 'auto' | 'en' | 'zh' | 'ja' | 'ko' | 'yue';

        /** Local acceleration preference (CPU / CUDA). */
        localAccelerator: 'auto' | 'cpu' | 'cuda';

        /** Number of threads for local engine (0 = auto). */
        numThreads: number;

        /** Enable inverse text normalization (punctuation/digits) for SenseVoice. */
        useItn: boolean;

        /** Cloud transcription via OpenAI-compatible endpoint (can be localhost) */
        openai: {
            baseUrl: string;
            apiKey: string;
            model: string;
        };
    };
    ai: {
        /** Cloud LLM provider (BYOK). localhost OpenAI-compatible also works. */
        provider: 'openai_compatible' | 'gemini';

        openai: {
            baseUrl: string;
            apiKey: string;
            chatModel: string;
            summaryModel: string;
        };

        gemini: {
            baseUrl: string;
            apiKey: string;
            model: string;
        };

        /** Summary prompt templates (used by AI summary). */
        summaryPrompts: Array<{
            id: string;
            name: string;
            template: string;
        }>;

        /** Default prompt id for AI summary. */
        defaultSummaryPromptId: string;
    };
    plugins: {
        enabled: string[];
    };
}

// ==================== 任务/处理作业 ====================

export interface ProcessingJob {
    id: string;
    mediaId: string;
    type: 'import' | 'transcription' | 'optimize' | 'summary' | 'download' | 'export' | 'subtitle';
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
    progress: number;        // 0-100
    message?: string;
    startedAt?: string;
    completedAt?: string;
    error?: string;
    result?: any;
}

// ==================== 活动日志 ====================

export interface ActivityItem {
    id: string;
    type: 'import' | 'export' | 'transcription' | 'summary' | 'note' | 'bookmark' | 'other';
    title: string;
    desc: string;
    time: string;
    mediaId?: string;        // 关联的媒体 ID（如果有）
    status?: 'success' | 'failed' | 'pending';
    icon?: string;
    color?: string;
}

// ==================== UI 工具类型 ====================

export type ViewMode = 'grid' | 'list';

export type SortBy = 'name' | 'date' | 'duration' | 'size';
export type SortOrder = 'asc' | 'desc';

export interface Toast {
    id: string;
    type: 'success' | 'error' | 'warning' | 'info';
    message: string;
    duration?: number;
}

export interface ModalConfig {
    title: string;
    content?: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
}

// ==================== 搜索与过滤 ====================

export interface MediaFilter {
    type?: 'video' | 'audio' | 'all';
    folderId?: string;
    tags?: string[];
    hasTranscription?: boolean;
    hasNotes?: boolean;
    dateRange?: {
        start: string;
        end: string;
    };
}

export interface SearchResult {
    type: 'media' | 'note' | 'transcript' | 'bookmark';
    mediaId: string;
    matchText: string;
    timestamp?: number;      // 如果匹配到转写内容
    score: number;           // 相关性分数
}

// ==================== Persistence (Desktop) ====================

export interface PersistedAppState {
    version: 1;
    savedAt: string;
    data: {
        mediaItems: MediaItem[];
        collections: Collection[];
        workflows: Workflow[];
        deletedItems: DeletedItem[];
        settings: AppSettings;
        userProfile: UserProfile;
        activities: ActivityItem[];
    };
}
