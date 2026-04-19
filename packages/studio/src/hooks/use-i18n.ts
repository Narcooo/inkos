import { useApi } from "./use-api";

type Lang = "zh" | "en";

const strings = {
  // Header
  "nav.books": { zh: "书籍", en: "Books" },
  "nav.newBook": { zh: "新建书籍", en: "New Book" },
  "nav.config": { zh: "模型配置", en: "Model Config" },
  "nav.connected": { zh: "已连接", en: "Connected" },
  "nav.disconnected": { zh: "未连接", en: "Disconnected" },

  // Dashboard
  "dash.title": { zh: "书籍列表", en: "Books" },
  "dash.noBooks": { zh: "还没有书", en: "No books yet" },
  "dash.createFirst": { zh: "创建第一本书开始写作", en: "Create your first book to get started" },
  "dash.writeNext": { zh: "写下一章", en: "Write Next" },
  "dash.writing": { zh: "写作中...", en: "Writing..." },
  "dash.stats": { zh: "统计", en: "Stats" },
  "dash.chapters": { zh: "章", en: "chapters" },
  "dash.recentEvents": { zh: "最近事件", en: "Recent Events" },
  "dash.writingProgress": { zh: "写作进度", en: "Writing Progress" },

  // Book Detail
  "book.writeNext": { zh: "写下一章", en: "Write Next" },
  "book.draftOnly": { zh: "仅草稿", en: "Draft Only" },
  "book.approveAll": { zh: "全部通过", en: "Approve All" },
  "book.analytics": { zh: "数据分析", en: "Analytics" },
  "book.noChapters": { zh: "暂无章节，点击「写下一章」开始", en: 'No chapters yet. Click "Write Next" to start.' },
  "book.approve": { zh: "通过", en: "Approve" },
  "book.reject": { zh: "驳回", en: "Reject" },
  "book.words": { zh: "字", en: "words" },

  // Chapter Reader
  "reader.backToList": { zh: "返回列表", en: "Back to List" },
  "reader.approve": { zh: "通过", en: "Approve" },
  "reader.reject": { zh: "驳回", en: "Reject" },
  "reader.chapterList": { zh: "章节列表", en: "Chapter List" },
  "reader.characters": { zh: "字符", en: "characters" },
  "reader.edit": { zh: "编辑", en: "Edit" },
  "reader.preview": { zh: "预览", en: "Preview" },

  // Book Create
  "create.title": { zh: "创建书籍", en: "Create Book" },
  "create.bookTitle": { zh: "书名", en: "Title" },
  "create.language": { zh: "语言", en: "Language" },
  "create.genre": { zh: "题材", en: "Genre" },
  "create.wordsPerChapter": { zh: "每章字数", en: "Words / Chapter" },
  "create.targetChapters": { zh: "目标章数", en: "Target Chapters" },
  "create.creating": { zh: "创建中...", en: "Creating..." },
  "create.submit": { zh: "创建书籍", en: "Create Book" },
  "create.titleRequired": { zh: "请输入书名", en: "Title is required" },
  "create.genreRequired": { zh: "请选择题材", en: "Genre is required" },
  "create.placeholder": { zh: "请输入书名...", en: "Book title..." },

  // Analytics
  "analytics.title": { zh: "数据分析", en: "Analytics" },
  "analytics.totalChapters": { zh: "总章数", en: "Total Chapters" },
  "analytics.totalWords": { zh: "总字数", en: "Total Words" },
  "analytics.avgWords": { zh: "平均字数/章", en: "Avg Words/Chapter" },
  "analytics.statusDist": { zh: "状态分布", en: "Status Distribution" },

  // Breadcrumb
  "bread.books": { zh: "书籍", en: "Books" },
  "bread.newBook": { zh: "新建书籍", en: "New Book" },
  "bread.config": { zh: "配置", en: "Config" },
  "bread.home": { zh: "首页", en: "Home" },
  "bread.chapter": { zh: "第{n}章", en: "Chapter {n}" },

  // Config
  "config.title": { zh: "项目配置", en: "Project Config" },
  "config.project": { zh: "项目名", en: "Project" },
  "config.language": { zh: "语言", en: "Language" },
  "config.provider": { zh: "提供方", en: "Provider" },
  "config.model": { zh: "模型", en: "Model" },
  "config.editHint": { zh: "通过 CLI 编辑配置：", en: "Edit via CLI:" },

  // Sidebar
  "nav.system": { zh: "系统", en: "System" },
  "nav.daemon": { zh: "守护进程", en: "Daemon" },
  "nav.logs": { zh: "日志", en: "Logs" },
  "nav.running": { zh: "运行中", en: "Running" },
  "nav.agentOnline": { zh: "代理在线", en: "Agent Online" },
  "nav.agentOffline": { zh: "代理离线", en: "Agent Offline" },
  "nav.tools": { zh: "工具", en: "Tools" },
  "nav.style": { zh: "文风", en: "Style" },
  "nav.import": { zh: "导入", en: "Import" },
  "nav.radar": { zh: "市场雷达", en: "Radar" },
  "nav.doctor": { zh: "环境诊断", en: "Doctor" },

  // Book Detail extras
  "book.deleteBook": { zh: "删除书籍", en: "Delete Book" },
  "book.confirmDelete": { zh: "确认删除此书及所有章节？", en: "Delete this book and all chapters?" },
  "book.settings": { zh: "书籍设置", en: "Book Settings" },
  "book.status": { zh: "状态", en: "Status" },
  "book.drafting": { zh: "草稿中...", en: "Drafting..." },
  "book.pipelineWriting": { zh: "后台正在写作，本页会在完成后自动刷新。", en: "Background writing is running. This page will refresh automatically when it finishes." },
  "book.pipelineDrafting": { zh: "后台正在生成草稿，本页会在完成后自动刷新。", en: "Background drafting is running. This page will refresh automatically when it finishes." },
  "book.pipelineFailed": { zh: "后台任务失败", en: "Background job failed" },
  "book.save": { zh: "保存", en: "Save" },
  "book.saving": { zh: "保存中...", en: "Saving..." },
  "book.rewrite": { zh: "重写", en: "Rewrite" },
  "book.audit": { zh: "审计", en: "Audit" },
  "book.export": { zh: "导出", en: "Export" },
  "book.approvedOnly": { zh: "仅已通过", en: "Approved Only" },
  "book.manuscriptTitle": { zh: "章节标题", en: "Manuscript Title" },
  "book.curate": { zh: "操作", en: "Actions" },
  "book.spotFix": { zh: "精修", en: "Spot Fix" },
  "book.polish": { zh: "打磨", en: "Polish" },
  "book.rework": { zh: "重作", en: "Rework" },
  "book.antiDetect": { zh: "反检测", en: "Anti-Detect" },
  "book.statusActive": { zh: "进行中", en: "Active" },
  "book.statusPaused": { zh: "已暂停", en: "Paused" },
  "book.statusOutlining": { zh: "大纲中", en: "Outlining" },
  "book.statusCompleted": { zh: "已完成", en: "Completed" },
  "book.statusDropped": { zh: "已放弃", en: "Dropped" },
  "book.truthFiles": { zh: "真相文件", en: "Truth Files" },

  // Style
  "style.title": { zh: "文风分析", en: "Style Analyzer" },
  "style.sourceName": { zh: "来源名称", en: "Source Name" },
  "style.sourceExample": { zh: "如：参考小说", en: "e.g. Reference Novel" },
  "style.textSample": { zh: "文本样本", en: "Text Sample" },
  "style.pasteHint": { zh: "粘贴参考文本进行文风分析...", en: "Paste reference text for style analysis..." },
  "style.analyze": { zh: "分析", en: "Analyze" },
  "style.analyzing": { zh: "分析中...", en: "Analyzing..." },
  "style.results": { zh: "分析结果", en: "Analysis Results" },
  "style.avgSentence": { zh: "平均句长", en: "Avg Sentence Length" },
  "style.vocabDiversity": { zh: "词汇多样性", en: "Vocabulary Diversity" },
  "style.avgParagraph": { zh: "平均段落长度", en: "Avg Paragraph Length" },
  "style.sentenceStdDev": { zh: "句长标准差", en: "Sentence StdDev" },
  "style.topPatterns": { zh: "主要模式", en: "Top Patterns" },
  "style.rhetoricalFeatures": { zh: "修辞特征", en: "Rhetorical Features" },
  "style.importToBook": { zh: "导入到书籍", en: "Import to Book" },
  "style.selectBook": { zh: "选择书籍...", en: "Select book..." },
  "style.importGuide": { zh: "导入文风指南", en: "Import Style Guide" },
  "style.emptyHint": { zh: "粘贴文本并点击分析查看文风档案", en: "Paste text and click Analyze to see style profile" },

  // Import
  "import.title": { zh: "导入工具", en: "Import Tools" },
  "import.chapters": { zh: "导入章节", en: "Import Chapters" },
  "import.canon": { zh: "导入母本", en: "Import Canon" },
  "import.fanfic": { zh: "同人创作", en: "Fanfic" },
  "import.selectTarget": { zh: "选择目标书籍...", en: "Select target book..." },
  "import.splitRegex": { zh: "分割正则（可选）", en: "Split regex (optional)" },
  "import.pasteChapters": { zh: "粘贴章节文本...", en: "Paste chapter text..." },
  "import.selectSource": { zh: "选择源（母本）...", en: "Select source (parent)..." },
  "import.selectDerivative": { zh: "选择目标（衍生）...", en: "Select target (derivative)..." },
  "import.fanficTitle": { zh: "同人小说标题", en: "Fanfic title" },
  "import.pasteMaterial": { zh: "粘贴原作文本/设定/角色资料...", en: "Paste source material..." },
  "import.importing": { zh: "导入中...", en: "Importing..." },
  "import.creating": { zh: "创建中...", en: "Creating..." },

  // Radar
  "radar.title": { zh: "市场雷达", en: "Market Radar" },
  "radar.scan": { zh: "扫描市场", en: "Scan Market" },
  "radar.scanning": { zh: "扫描中...", en: "Scanning..." },
  "radar.summary": { zh: "市场概要", en: "Market Summary" },
  "radar.emptyHint": { zh: "点击「扫描市场」分析当前趋势和机会", en: "Click \"Scan Market\" to analyze trends and opportunities" },

  // Doctor
  "doctor.title": { zh: "环境诊断", en: "Environment Check" },
  "doctor.recheck": { zh: "重新检查", en: "Re-check" },
  "doctor.inkosJson": { zh: "inkos.json 配置", en: "inkos.json configuration" },
  "doctor.projectEnv": { zh: "项目 .env 文件", en: "Project .env file" },
  "doctor.globalEnv": { zh: "全局 ~/.inkos/.env", en: "Global ~/.inkos/.env" },
  "doctor.booksDir": { zh: "书籍目录", en: "Books directory" },
  "doctor.llmApi": { zh: "LLM API 连接", en: "LLM API connectivity" },
  "doctor.connected": { zh: "已连接", en: "Connected" },
  "doctor.failed": { zh: "失败", en: "Failed" },
  "doctor.allPassed": { zh: "所有检查通过 — 环境健康", en: "All checks passed — environment is healthy" },
  "doctor.someFailed": { zh: "部分检查失败 — 请查看配置", en: "Some checks failed — review configuration" },

  // Genre extras
  "genre.createNew": { zh: "创建新题材", en: "Create New Genre" },
  "genre.editGenre": { zh: "编辑", en: "Edit" },
  "genre.deleteGenre": { zh: "删除", en: "Delete" },
  "genre.confirmDelete": { zh: "确认删除此题材？", en: "Delete this genre?" },
  "genre.chapterTypes": { zh: "章节类型", en: "Chapter Types" },
  "genre.fatigueWords": { zh: "疲劳词", en: "Fatigue Words" },
  "genre.numericalSystem": { zh: "数值系统", en: "Numerical System" },
  "genre.powerScaling": { zh: "力量等级", en: "Power Scaling" },
  "genre.eraResearch": { zh: "时代研究", en: "Era Research" },
  "genre.pacingRule": { zh: "节奏规则", en: "Pacing Rule" },
  "genre.rules": { zh: "规则", en: "Rules" },
  "genre.saveChanges": { zh: "保存更改", en: "Save Changes" },
  "genre.cancel": { zh: "取消", en: "Cancel" },
  "genre.copyToProject": { zh: "复制到项目", en: "Copy to Project" },
  "genre.selectHint": { zh: "选择题材查看详情", en: "Select a genre to view details" },
  "genre.commaSeparated": { zh: "逗号分隔", en: "comma-separated" },
  "genre.rulesMd": { zh: "规则（Markdown）", en: "Rules (Markdown)" },

  // Config extras
  "config.modelRouting": { zh: "模型路由", en: "Model Routing" },
  "config.agent": { zh: "代理", en: "Agent" },
  "config.baseUrl": { zh: "基础 URL", en: "Base URL" },
  "config.default": { zh: "默认", en: "default" },
  "config.optional": { zh: "可选", en: "optional" },
  "config.saveOverrides": { zh: "保存路由", en: "Save Overrides" },
  "config.save": { zh: "保存", en: "Save" },
  "config.saving": { zh: "保存中...", en: "Saving..." },
  "config.cancel": { zh: "取消", en: "Cancel" },
  "config.edit": { zh: "编辑", en: "Edit" },
  "config.enabled": { zh: "启用", en: "Enabled" },
  "config.disabled": { zh: "禁用", en: "Disabled" },

  // Truth Files extras
  "truth.title": { zh: "真相文件", en: "Truth Files" },
  "truth.edit": { zh: "编辑", en: "Edit" },
  "truth.chars": { zh: "字", en: "chars" },
  "truth.save": { zh: "保存", en: "Save" },
  "truth.saving": { zh: "保存中...", en: "Saving..." },
  "truth.cancel": { zh: "取消", en: "Cancel" },
  "truth.empty": { zh: "暂无文件", en: "No truth files" },
  "truth.noFiles": { zh: "暂无文件", en: "No truth files" },
  "truth.notFound": { zh: "文件未找到", en: "File not found" },
  "truth.selectFile": { zh: "选择文件查看内容", en: "Select a file to view" },
  "truth.selectHint": { zh: "选择文件查看内容", en: "Select a file to view" },

  // Dashboard
  "dash.subtitle": { zh: "管理你的文学宇宙和 AI 辅助草稿。", en: "Manage your literary universe and AI-assisted drafts." },

  // Chapter Reader extras
  "reader.openingManuscript": { zh: "打开书稿中...", en: "Opening manuscript..." },
  "reader.manuscriptPage": { zh: "书稿页", en: "Manuscript Page" },
  "reader.minRead": { zh: "分钟阅读", en: "min read" },
  "reader.endOfChapter": { zh: "本章完", en: "End of Chapter" },

  // Daemon Control
  "daemon.title": { zh: "守护进程控制", en: "Daemon Control" },
  "daemon.running": { zh: "运行中", en: "Running" },
  "daemon.stopped": { zh: "已停止", en: "Stopped" },
  "daemon.start": { zh: "启动", en: "Start" },
  "daemon.stop": { zh: "停止", en: "Stop" },
  "daemon.starting": { zh: "启动中...", en: "Starting..." },
  "daemon.stopping": { zh: "停止中...", en: "Stopping..." },
  "daemon.waitingEvents": { zh: "等待事件...", en: "Waiting for events..." },
  "daemon.startHint": { zh: "启动守护进程查看事件", en: "Start the daemon to see events" },
  "daemon.eventLog": { zh: "事件日志", en: "Event Log" },

  // Config extras (labels)
  "config.temperature": { zh: "温度", en: "Temperature" },
  "config.maxTokens": { zh: "最大令牌数", en: "Max Tokens" },
  "config.stream": { zh: "流式输出", en: "Stream" },
  "config.chinese": { zh: "中文", en: "Chinese" },
  "config.english": { zh: "英文", en: "English" },

  // BookCreate extras
  "create.platform": { zh: "平台", en: "Platform" },

  // Common
  "common.save": { zh: "保存", en: "Save" },
  "common.cancel": { zh: "取消", en: "Cancel" },
  "common.delete": { zh: "删除", en: "Delete" },
  "common.edit": { zh: "编辑", en: "Edit" },
  "common.error": { zh: "错误", en: "Error" },
  "common.loading": { zh: "加载中...", en: "Loading..." },
  "common.refresh": { zh: "刷新", en: "Refresh" },
  "common.enterCommand": { zh: "输入指令...", en: "Enter command..." },
  "chapter.readyForReview": { zh: "待审核", en: "Ready for Review" },
  "chapter.approved": { zh: "已通过", en: "Approved" },
  "chapter.drafted": { zh: "草稿", en: "Drafted" },
  "chapter.needsRevision": { zh: "需修订", en: "Needs Revision" },
  "chapter.imported": { zh: "已导入", en: "Imported" },
  "chapter.auditFailed": { zh: "审计失败", en: "Audit Failed" },
  "chapter.label": { zh: "第{n}章", en: "Chapter {n}" },
  "common.exportSuccess": { zh: "已导出到项目目录", en: "Exported to project directory" },
  "common.exportFormat": { zh: "导出格式", en: "Export format" },
  "logs.title": { zh: "日志", en: "Logs" },
  "logs.empty": { zh: "暂无日志", en: "No log entries yet" },
  "logs.showingRecent": { zh: "当前展示最近日志记录。", en: "Showing recent log entries." },
} as const;

export type StringKey = keyof typeof strings;
export type TFunction = (key: StringKey) => string;

export function useI18n() {
  const { data } = useApi<{ language: string }>("/project");
  const lang: Lang = data?.language === "en" ? "en" : "zh";

  function t(key: StringKey): string {
    return strings[key][lang];
  }

  return { t, lang };
}
