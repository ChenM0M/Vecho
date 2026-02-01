export const translations = {
  en: {
    common: {
      close: 'Close',
      newTab: 'New Tab',
      import: 'Import',
      theme: 'Theme',
      language: 'Language',
      play: 'Play',
      edit: 'Edit',
      bookmark: 'Bookmark',
      note: 'Note',
      expandSidebar: 'Expand Sidebar',
      collapseSidebar: 'Collapse Sidebar'
    },
    nav: {
      dashboard: 'Dashboard',
      workflow: 'Workflow',
      library: 'Library',
      notes: 'Notes',
      toolbox: 'Toolbox',
      trash: 'Trash',
      settings: 'Settings',
      collections: 'Collections',
      projects: 'Projects 2024',
      podcasts: 'Podcasts 2023',
    },
    user: {
      name: 'user@vecho.ai',
      plan: 'Pro Workspace'
    },
    home: {
      greeting: 'Good Morning, Creator.',
      headerDesc: "Here's what's happening in your workspace.",
      searchPlaceholder: 'Paste a URL from YouTube, Podcast, or Web...',
      hero: {
        tag: 'Update 2.0',
        title: 'Generative Video Workflow',
        desc: 'Generate storyboard animatics directly from your scripts. Now supporting multi-modal input and frame-by-frame editing.',
        start: 'Start Creating',
        learn: 'Learn more'
      },
      stats: {
        voice: 'Voice Minutes',
        storage: 'Storage',
        projects: 'Projects',
        exports: 'Exports'
      },
      activity: {
        title: 'Recent Activity',
        viewAll: 'View Full History',
        item1: { title: 'Interface Design.mkv', desc: 'Exported successfully to local drive', time: '10 mins ago' },
        item2: { title: 'Podcast Ep. 42', desc: 'Transcription failed due to network error', time: '2 hours ago' },
        item3: { title: 'New Asset Pack', desc: 'Imported 24 files to "Projects 2024"', time: 'Yesterday' }
      },
      tts: 'Text to Speech',
      inbox: {
        title: 'Inbox',
        desc: 'Import files or links, then process them with workflows.',
        openLibrary: 'Open Library',
        newWorkflow: 'New Workflow',
        importTitle: 'Import',
        importHint: 'Drop files, or paste a Bilibili/YouTube link.',
        importLocal: 'Import Files',
        importLink: 'Import Link',
        dropTitle: 'Drop files here',
        dropNow: 'Drop files now',
        dropDesc: 'Video/Audio files are supported. Batch import is OK.',
        linkPlaceholder: 'Paste Bilibili / YouTube link…',
        linkHint: 'Enter to import',
        recentMedia: 'Recent Media',
        viewAll: 'View All',
        emptyTitle: 'Nothing yet',
        emptyDesc: 'Start by importing a file or pasting a link.',
        noRecentFiles: 'No recent files',
        queueTitle: 'Queue',
        queueEmpty: 'No running jobs.',
        queueSummaryEmpty: '0 jobs',
        queueSummary: (active: number, failed: number) => `${active} active · ${failed} failed`,
        queueSummaryNoFail: (active: number) => `${active} active`,
        activityTitle: 'Activity',
        jobTypes: {
          import: 'Import',
          download: 'Download',
          transcription: 'Transcription',
          summary: 'Summary',
          export: 'Export'
        },
        jobStatus: {
          pending: 'Pending',
          processing: 'Processing',
          completed: 'Completed',
          failed: 'Failed',
          cancelled: 'Cancelled'
        }
      }
    },
    workflow: {
        title: 'Node Graph',
        desc: 'Visualise and edit your generation pipeline.',
        back: 'Back to List',
        list: {
          title: 'Workflows',
          create: 'New Pipeline',
          search: 'Search workflows...',
          columns: { name: 'Name', status: 'Status', modified: 'Last Modified', runs: 'Runs' },
          status: { active: 'Active', draft: 'Draft', archiving: 'Archived' }
        },
        nodes: {
            input: 'Input Source',
            process: 'AI Processing',
            output: 'Final Render'
        }
    },
    media: {
      filter: {
        all: 'All',
        video: 'Video',
        audio: 'Audio',
        search: 'Filter...'
      },
      fileList: {
        items: 'items',
        total: 'total',
        item1: { title: 'Interface_Design.mkv', meta: '124 MB • 2 hours ago' },
        item2: { title: 'Podcast_Ep42.mp3', meta: '45 MB • Yesterday' },
        item3: { title: 'Drone_Footage_Raw.mp4', meta: '2.1 GB • 3 days ago' }
      },
      preview: {
        label: 'PREVIEW'
      },
      props: {
        title: 'Properties',
        dimensions: 'Dimensions',
        framerate: 'Frame Rate',
        codec: 'Codec',
        actions: 'Actions',
        exportFrame: 'Export Frame',
        shareLink: 'Share Link'
      }
      ,
      detail: {
        quickMark: (time: string) => `Mark ${time}`,
        newNoteTitle: 'New Note',
        newNoteContent: 'Thinking about...'
      }
    },
    notes: {
      search: 'Search notes...',
      lastModified: 'Last Modified',
      emptyTitle: 'Your collection is empty',
      create: 'Create a new note'
    },
    apps: {
      tools: 'Audio Tools',
      stem: 'Stem Separation',
      stemTitle: 'Audio Stem Separation',
      stemDesc: 'Isolate vocals, drums, bass, and other instruments using our advanced AI model.',
      selectFile: 'Select Audio File',
      dragDrop: 'Drag & Drop supported • MP3, WAV, FLAC, M4A',
      denoise: 'Denoise Audio',
      tts: 'Text to Speech',
      systemStatus: 'System Status',
      gpuHelper: 'GPU Helper',
      idle: 'Idle',
      modelCache: 'Model Cache',
      dropTitle: 'Click to upload or drag files here',
      dropDesc: 'Supports MP3, WAV, FLAC, M4A up to 200MB. Batch processing supported.',
      recentJobs: 'Recent Jobs',
      clearHistory: 'Clear History',
      processing: 'Processing...',
      completed: 'Completed',
      openFolder: 'Open Folder',
      download: 'Download',
      separated: 'Separated:'
    },
    recycle: {
      title: 'Recycle Bin',
      desc: 'Items are permanently deleted after 30 days.',
      search: 'Search deleted files...',
      restoreAll: 'Restore All',
      empty: 'Empty Trash',
      emptyStateTitle: 'Trash is empty',
      emptyStateDesc: 'Deleted items will appear here.',
      groups: { today: 'Today', earlier: 'Earlier' },
      daysLeft: (days: number) => `${days} Days Left`,
      deletedAgo: (days: number) => `Deleted ${days} days ago`,
      actions: { restore: 'Restore', deleteForever: 'Delete Forever' },
      misc: { items: 'items', img: 'IMG' },
      table: { preview: 'Preview', name: 'Name', deleted: 'Deleted' },
      originalPath: 'Original path'
    },
    settings: {
      title: 'Settings',
      config: 'Configuration',
      appearance: 'Appearance',
      menu: {
        general: 'General',
        workspace: 'Workspace',
        models: 'Models',
        plugins: 'Plugins'
      },
      general: {
        light: 'Light Mode',
        lightDesc: 'Default clarity',
        dark: 'Dark Mode',
        darkDesc: 'Easier on eyes',
      },
      placeholder: 'Panel configuration active'
    }
  },
  zh: {
    common: {
      close: '关闭',
      newTab: '新建标签页',
      import: '导入',
      theme: '主题',
      language: '语言',
      play: '播放',
      edit: '编辑',
      bookmark: '书签',
      note: '笔记',
      expandSidebar: '展开侧边栏',
      collapseSidebar: '收起侧边栏'
    },
    nav: {
      dashboard: '仪表盘',
      workflow: '工作流',
      library: '媒体库',
      notes: '笔记',
      toolbox: '工具箱',
      trash: '回收站',
      settings: '设置',
      collections: '收藏夹',
      projects: '2024 项目集',
      podcasts: '播客 2023',
    },
    user: {
      name: 'user@vecho.ai',
      plan: '专业工作区'
    },
    home: {
      greeting: '早上好，创作者。',
      headerDesc: '您的工作区最新动态。',
      searchPlaceholder: '粘贴 YouTube、播客或网页链接...',
      hero: {
        tag: '更新 2.0',
        title: '生成式视频工作流',
        desc: '直接从脚本生成故事板动态预览。现已支持多模态输入和逐帧编辑功能。',
        start: '开始创作',
        learn: '了解更多'
      },
      stats: {
        voice: '语音时长',
        storage: '存储空间',
        projects: '项目数量',
        exports: '导出次数'
      },
      activity: {
        title: '最近活动',
        viewAll: '查看全部历史',
        item1: { title: '界面设计.mkv', desc: '已成功导出到本地磁盘', time: '10 分钟前' },
        item2: { title: '播客 Ep. 42', desc: '转写失败：网络连接错误', time: '2 小时前' },
        item3: { title: '新资产包', desc: '已导入 24 个文件到 "2024 项目集"', time: '昨天' }
      },
      tts: '文字转语音',
      inbox: {
        title: '收件箱',
        desc: '把内容先导入进来，再用工作流批处理成可检索的知识资产。',
        openLibrary: '打开媒体库',
        newWorkflow: '新建工作流',
        importTitle: '导入',
        importHint: '拖入文件，或粘贴 B 站 / YouTube 链接。',
        importLocal: '导入文件',
        importLink: '导入链接',
        dropTitle: '拖拽文件到此处',
        dropNow: '松开即可导入',
        dropDesc: '支持视频/音频；可批量导入。',
        linkPlaceholder: '粘贴 B 站 / YouTube 链接…',
        linkHint: '回车也可导入',
        recentMedia: '最近导入',
        viewAll: '查看全部',
        emptyTitle: '还没有内容',
        emptyDesc: '从导入文件或粘贴链接开始。',
        noRecentFiles: '暂无最近文件',
        queueTitle: '任务队列',
        queueEmpty: '当前没有任务。',
        queueSummaryEmpty: '0 个任务',
        queueSummary: (active: number, failed: number) => `${active} 个进行中 · ${failed} 个失败`,
        queueSummaryNoFail: (active: number) => `${active} 个进行中`,
        activityTitle: '动态',
        jobTypes: {
          import: '导入',
          download: '下载',
          transcription: '转写',
          summary: '总结',
          export: '导出'
        },
        jobStatus: {
          pending: '等待',
          processing: '处理中',
          completed: '完成',
          failed: '失败',
          cancelled: '已取消'
        }
      }
    },
    workflow: {
        title: '节点图',
        desc: '可视化编辑您的生成管线。',
        back: '返回列表',
        list: {
          title: '工作流',
          create: '新建管线',
          search: '搜索工作流...',
          columns: { name: '名称', status: '状态', modified: '最后修改', runs: '运行次数' },
          status: { active: '活跃', draft: '草稿', archiving: '归档' }
        },
        nodes: {
            input: '输入源',
            process: 'AI 处理',
            output: '最终渲染'
        }
    },
    media: {
      filter: {
        all: '全部',
        video: '视频',
        audio: '音频',
        search: '筛选...'
      },
      fileList: {
        items: '项',
        total: '总计',
        item1: { title: '界面设计_Final.mkv', meta: '124 MB • 2 小时前' },
        item2: { title: '播客_Ep42.mp3', meta: '45 MB • 昨天' },
        item3: { title: '无人机航拍_Raw.mp4', meta: '2.1 GB • 3 天前' }
      },
      preview: {
        label: '预览'
      },
      props: {
        title: '属性',
        dimensions: '分辨率',
        framerate: '帧率',
        codec: '编码格式',
        actions: '操作',
        exportFrame: '导出帧',
        shareLink: '分享链接'
      }
      ,
      detail: {
        quickMark: (time: string) => `标记 ${time}`,
        newNoteTitle: '新笔记',
        newNoteContent: '写点想法...'
      }
    },
    notes: {
      search: '搜索笔记...',
      lastModified: '最近修改',
      emptyTitle: '您的收藏为空',
      create: '新建笔记'
    },
    apps: {
      tools: '音频工具',
      stem: '人声分离',
      stemTitle: '音频人声分离',
      stemDesc: '使用我们先进的 AI 模型分离人声、鼓点、贝斯和其他乐器。',
      selectFile: '选择音频文件',
      dragDrop: '支持拖拽 • MP3, WAV, FLAC, M4A',
      denoise: '音频降噪',
      tts: '文字转语音',
      systemStatus: '系统状态',
      gpuHelper: 'GPU 助手',
      idle: '空闲',
      modelCache: '模型缓存',
      dropTitle: '点击上传或拖入文件',
      dropDesc: '支持 MP3, WAV, FLAC, M4A，最大 200MB。支持批量处理。',
      recentJobs: '最近任务',
      clearHistory: '清空历史',
      processing: '处理中...',
      completed: '已完成',
      openFolder: '打开文件夹',
      download: '下载',
      separated: '分离结果：'
    },
    recycle: {
      title: '回收站',
      desc: '项目将在 30 天后永久删除。',
      search: '搜索已删除文件...',
      restoreAll: '全部还原',
      empty: '清空回收站',
      emptyStateTitle: '回收站为空',
      emptyStateDesc: '删除的项目会出现在这里。',
      groups: { today: '今天', earlier: '更早' },
      daysLeft: (days: number) => `剩余 ${days} 天`,
      deletedAgo: (days: number) => `${days} 天前删除`,
      actions: { restore: '还原', deleteForever: '永久删除' },
      misc: { items: '项', img: '图' },
      table: { preview: '预览', name: '名称', deleted: '删除时间' },
      originalPath: '原始路径'
    },
    settings: {
      title: '设置',
      config: '配置',
      appearance: '外观',
      menu: {
        general: '常规',
        workspace: '工作区',
        models: '模型',
        plugins: '插件'
      },
      general: {
        light: '浅色模式',
        lightDesc: '默认清晰度',
        dark: '深色模式',
        darkDesc: '护眼模式',
      },
      placeholder: '面板配置已激活'
    }
  }
};
