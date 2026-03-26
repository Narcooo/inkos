<p align="center">
  <img src="assets/logo.svg" width="120" height="120" alt="InkOS Logo">
  <img src="assets/inkos-text.svg" width="240" height="65" alt="InkOS">
</p>

<h1 align="center">自动化小说写作 CLI Agent</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@actalk/inkos"><img src="https://img.shields.io/npm/v/@actalk/inkos.svg?color=cb3837&logo=npm" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg" alt="Node.js"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.x-3178C6.svg?logo=typescript&logoColor=white" alt="TypeScript"></a>
</p>

<p align="center">
  中文 | <a href="README.en.md">English</a>
</p>

---

Agent 写小说。写、审、改，全程接管。

## 快速开始

### 安装

```bash
npm i -g @actalk/inkos
```

### 通过 OpenClaw 使用 🦞

InkOS 已发布为 [OpenClaw](https://clawhub.ai) Skill，可被任何兼容 Agent（Claude Code、OpenClaw 等）直接调用：

```bash
clawhub install inkos          # 从 ClawHub 安装 InkOS Skill
```

通过 npm 安装或克隆本项目时，`skills/SKILL.md` 已包含在内，🦞 可直接读取——无需额外从 ClawHub 安装。

安装后，Claw 可通过 `exec` 调用 InkOS 的所有原子命令（`draft`/`audit`/`revise`/`write next`），`--json` 输出结构化数据供 Claw 解析决策。也可以在 [ClawHub](https://clawhub.ai) 搜索 `inkos` 在线查看。

### 配置

**方式一：全局配置（推荐，只需一次）**

```bash
inkos config set-global \
  --provider <openai|anthropic|custom> \
  --base-url <API 地址> \
  --api-key <你的 API Key> \
  --model <模型名>

# 示例：OpenAI
# inkos config set-global --provider openai --base-url https://api.openai.com/v1 --api-key sk-xxx --model gpt-4o
# 示例：国内中转站 / 兼容接口
# inkos config set-global --provider custom --base-url https://your-proxy.com/v1 --api-key sk-xxx --model gpt-4o
# 示例：Anthropic
# inkos config set-global --provider anthropic --base-url https://api.anthropic.com --api-key sk-ant-xxx --model claude-sonnet-4-20250514
```

配置保存在 `~/.inkos/.env`，所有项目共享。之后新建项目不用再配。

**方式二：项目级 `.env`**

```bash
inkos init my-novel     # 初始化项目
# 编辑 my-novel/.env
```

```bash
# 必填
INKOS_LLM_PROVIDER=                               # openai / anthropic / custom（兼容 OpenAI 接口的都选 custom）
INKOS_LLM_BASE_URL=                               # API 地址（支持中转站、智谱、Gemini 等）
INKOS_LLM_API_KEY=                                 # API Key
INKOS_LLM_MODEL=                                   # 模型名

# 可选
# INKOS_LLM_TEMPERATURE=0.7                       # 默认温度（Writer 会按章节类型自动调节 0.6-0.85）
# INKOS_LLM_MAX_TOKENS=8192                        # 最大输出 token
# INKOS_LLM_THINKING_BUDGET=0                      # Anthropic 扩展思考预算
```

项目 `.env` 会覆盖全局配置。不需要覆盖时可以不写。

**方式三：多模型路由（可选）**

给不同 Agent 分配不同模型，按需平衡质量与成本：

```bash
# Writer 用 Claude（创意强），Auditor 用 GPT-4o（便宜快速）
inkos config set-model writer claude-sonnet-4-20250514 --provider anthropic --base-url https://api.anthropic.com --api-key-env ANTHROPIC_API_KEY
inkos config set-model auditor gpt-4o --provider openai
inkos config show-models        # 查看当前路由
```

未单独配置的 Agent 自动使用全局模型。

### 写第一本书

```bash
inkos book create --title "吞天魔帝" --genre xuanhuan  # 创建新书
inkos write next 吞天魔帝      # 写下一章（完整管线：草稿 → 审计 → 修订）
inkos status                   # 查看状态
inkos review list 吞天魔帝     # 审阅草稿
inkos review approve-all 吞天魔帝  # 批量通过
inkos export 吞天魔帝          # 导出全书
inkos export 吞天魔帝 --format epub  # 导出 EPUB（手机/Kindle 阅读）
```

<p align="center">
  <img src="assets/screenshot-terminal.png" width="700" alt="终端截图">
</p>

---

## 为什么需要 InkOS？

用 AI 写小说不是简单的"提示词 + 复制粘贴"。长篇小说很快就会崩：角色记忆混乱、物品凭空出现、同样的形容词每段都在重复、伏笔悄无声息地断掉。InkOS 把这些当工程问题来解决。

- **长期记忆** — 追踪世界的真实状态，而非 LLM 的幻觉
- **反信息泄漏** — 确保角色只知道他们亲眼见证过的事
- **资源衰减** — 物资会消耗、物品会损坏，没有无限背包
- **词汇疲劳检测** — 在读者发现之前就捕捉过度使用的词语
- **自动修订** — 在人工审核之前修复数值错误和连续性断裂

## 工作原理

每一章由五个 Agent 接力完成：

<p align="center">
  <img src="assets/screenshot-pipeline.png" width="800" alt="管线流程图">
</p>

| Agent | 职责 |
|-------|------|
| **雷达 Radar** | 扫描平台趋势和读者偏好，指导故事方向（可插拔，可跳过） |
| **建筑师 Architect** | 规划章节结构：大纲、场景节拍、节奏控制 |
| **写手 Writer** | 根据大纲 + 当前世界状态生成正文 |
| **连续性审计员 Auditor** | 对照长期记忆验证草稿 |
| **修订者 Reviser** | 修复审计发现的问题 — 关键问题自动修复，其他标记给人工审核 |

如果审计不通过，管线自动进入"修订 → 再审计"循环，直到所有关键问题清零。

### 长期记忆

每本书维护 7 个真相文件作为唯一事实来源：

| 文件 | 用途 |
|------|------|
| `current_state.md` | 世界状态：角色位置、关系网络、已知信息、情感弧线 |
| `particle_ledger.md` | 资源账本：物品、金钱、物资数量及衰减追踪 |
| `pending_hooks.md` | 未闭合伏笔：铺垫、对读者的承诺、未解决冲突 |
| `chapter_summaries.md` | 各章摘要：出场人物、关键事件、状态变化、伏笔动态 |
| `subplot_board.md` | 支线进度板：A/B/C 线状态、停滞检测 |
| `emotional_arcs.md` | 情感弧线：按角色追踪情绪变化和成长 |
| `character_matrix.md` | 角色交互矩阵：相遇记录、信息边界 |

连续性审计员对照这些文件检查每一章草稿。如果角色"记起"了从未亲眼见过的事，或者拿出了两章前已经丢失的武器，审计员会捕捉到。旧书无新真相文件时自动兼容。

<p align="center">
  <img src="assets/screenshot-state.png" width="800" alt="长期记忆快照">
</p>

### 创作规则体系

写手 agent 内置 ~25 条通用创作规则（人物塑造、叙事技法、逻辑自洽、语言约束、去 AI 味），适用于所有题材。

在此基础上，每个题材有专属规则（禁忌、语言铁律、节奏、审计维度），每本书有独立的 `book_rules.md`（主角人设、数值上限、自定义禁令）和 `story_bible.md`（世界观设定），由建筑师 agent 创建书籍时自动生成。

详见 [CHANGELOG](CHANGELOG.md)。

## 三种使用模式

InkOS 提供三种交互方式，底层共享同一组原子操作：

### 1. 完整管线（一键式）

```bash
inkos write next 吞天魔帝          # 写草稿 → 审计 → 自动修订，一步到位
inkos write next 吞天魔帝 --count 5 # 连续写 5 章
```

### 2. 原子命令（可组合，适合外部 Agent 调用）

```bash
inkos draft 吞天魔帝 --context "本章重点写师徒矛盾" --json
inkos audit 吞天魔帝 31 --json
inkos revise 吞天魔帝 31 --json
```

每个命令独立执行单一操作，`--json` 输出结构化数据。可被外部 AI Agent 通过 `exec` 调用，也可用于脚本编排。

### 3. 自然语言 Agent 模式

```bash
inkos agent "帮我写一本都市修仙，主角是个程序员"
inkos agent "写下一章，重点写师徒矛盾"
inkos agent "先扫描市场趋势，然后根据结果创建一本新书"
```

内置 13 个工具（write_draft、audit_chapter、revise_chapter、scan_market、create_book、get_book_status、read_truth_files、list_books、write_full_pipeline、web_fetch、import_style、import_canon、import_chapters），LLM 通过 tool-use 决定调用顺序。

## 命令参考

| 命令 | 说明 |
|------|------|
| `inkos init [name]` | 初始化项目（省略 name 在当前目录初始化） |
| `inkos book create` | 创建新书（`--genre`、`--platform`、`--chapter-words`、`--target-chapters`、`--brief <file>` 传入创作简报） |
| `inkos book update [id]` | 修改书设置（`--chapter-words`、`--target-chapters`、`--status`） |
| `inkos book list` | 列出所有书籍 |
| `inkos genre list/show/copy/create` | 查看、复制、创建题材 |
| `inkos write next [id]` | 完整管线写下一章（`--words` 覆盖字数，`--count` 连写，`-q` 静默模式） |
| `inkos write rewrite [id] <n>` | 重写第 N 章（恢复状态快照，`--force` 跳过确认，`--words` 覆盖字数） |
| `inkos draft [id]` | 只写草稿（`--words` 覆盖字数，`-q` 静默模式） |
| `inkos audit [id] [n]` | 审计指定章节 |
| `inkos revise [id] [n]` | 修订指定章节 |
| `inkos agent <instruction>` | 自然语言 Agent 模式 |
| `inkos review list [id]` | 审阅草稿 |
| `inkos review approve-all [id]` | 批量通过 |
| `inkos status [id]` | 项目状态 |
| `inkos export [id]` | 导出书籍（`--format txt/md/epub`、`--output <path>`、`--approved-only`） |
| `inkos radar scan` | 扫描平台趋势 |
| `inkos config set-global` | 设置全局 LLM 配置（~/.inkos/.env） |
| `inkos config show-global` | 查看全局配置 |
| `inkos config set/show` | 查看/更新项目配置 |
| `inkos config set-model <agent> <model>` | 为指定 agent 设置模型覆盖（`--base-url`、`--provider`、`--api-key-env` 支持多 Provider 路由） |
| `inkos config remove-model <agent>` | 移除 agent 模型覆盖（回退到默认） |
| `inkos config show-models` | 查看当前模型路由 |
| `inkos doctor` | 诊断配置问题（含 API 连通性测试 + 提供商兼容性提示） |
| `inkos detect [id] [n]` | AIGC 检测（`--all` 全部章节，`--stats` 统计） |
| `inkos style analyze <file>` | 分析参考文本提取文风指纹 |
| `inkos style import <file> [id]` | 导入文风指纹到指定书 |
| `inkos import canon [id] --from <parent>` | 导入正传正典到番外书 |
| `inkos import chapters [id] --from <path>` | 导入已有章节续写（`--split`、`--resume-from`） |
| `inkos analytics [id]` / `inkos stats [id]` | 书籍数据分析（审计通过率、高频问题、章节排名、token 用量） |
| `inkos update` | 更新到最新版本 |
| `inkos revise-light [id] [n]` | 轻量修订（只用章节文本 + 指令，不加载真相文件）。`--context` 或 `--context-file` 传入修改指令 |
| `inkos settle [id] [n]` | 事后真相文件同步。从已确认章节内容反向更新状态卡/伏笔/账本等 |
| `inkos up / down` | 启动/停止守护进程（`-q` 静默模式，自动写入 `inkos.log`） |

`[id]` 参数在项目只有一本书时可省略，自动检测。所有命令支持 `--json` 输出结构化数据。`draft`/`write next` 支持 `--context` 传入创作指导，`--words` 覆盖每章字数。`book create` 支持 `--brief <file>` 传入创作简报（你的脑洞/设定文档），Architect 会基于此生成设定而非凭空创作。

## 实测数据

用 InkOS 全自动跑了一本玄幻题材的《吞天魔帝》：

<p align="center">
  <img src="assets/screenshot-chapters.png" width="800" alt="生产数据">
</p>

| 指标 | 数据 |
|------|------|
| 已完成章节 | 31 章 |
| 总字数 | 452,191 字 |
| 平均章字数 | ~14,500 字 |
| 审计通过率 | 100% |
| 资源追踪项 | 48 个 |
| 活跃伏笔 | 20 条 |
| 已回收伏笔 | 10 条 |

## 核心特性

### 状态快照 + 章节重写

每章自动创建状态快照。使用 `inkos write rewrite <id> <n>` 可以回滚并重新生成任意章节 — 世界状态、资源账本、伏笔钩子全部恢复到该章写入前的状态。

### 写入锁

基于文件的锁机制防止对同一本书的并发写入。

### 写前自检 + 写后结算

写手 agent 在动笔前必须输出自检表（上下文范围、当前资源、待回收伏笔、冲突概述、风险扫描），写完后输出结算表（资源变动、伏笔变动）。审计员对照结算表和正文内容做交叉验证。

### 可插拔雷达

雷达数据源通过 `RadarSource` 接口实现可插拔。内置番茄小说和起点中文网两个数据源，也可以传入自定义数据源或直接跳过雷达。用户自己提供题材时，agent 模式会自动跳过市场扫描。

### 守护进程模式

`inkos up` 启动后台循环，按计划写章。管线对非关键问题全自动运行，当审计员标记无法自动修复的问题时暂停等待人工审核。所有日志自动写入项目根目录 `inkos.log`（JSON Lines 格式），`-q` 静默模式关闭 stderr 只保留文件日志。

### 通知推送

支持 Telegram、飞书、企业微信、Webhook。守护进程模式下，写完一章或审计不通过都会推通知到手机。Webhook 支持 HMAC-SHA256 签名和事件过滤。

### 外部 Agent 集成

原子命令 + `--json` 输出让 InkOS 可以被外部 AI Agent（如 OpenClaw、Claude Code 等）调用。Agent 通过 `exec` 执行 `inkos draft`/`audit`/`revise`，读取 JSON 结果决定下一步操作。

## 项目结构

```
inkos/
├── packages/
│   ├── core/              # Agent 运行时、管线、状态管理
│   │   ├── agents/        # architect, writer, continuity, reviser, radar, ai-tells, post-write-validator, sensitive-words, detector, style-analyzer
│   │   ├── pipeline/      # runner, agent (tool-use), scheduler, detection-runner
│   │   ├── state/         # 基于文件的状态管理器（7+ 真相文件 + 快照）
│   │   ├── llm/           # OpenAI + Anthropic 双 SDK 接口 (流式)
│   │   ├── notify/        # Telegram, 飞书, 企业微信, Webhook
│   │   └── models/        # Zod schema 校验
│   └── cli/               # Commander.js 命令行 (22 条命令)
│       └── commands/      # init, book, write, draft, audit, revise, agent, review, detect, style...
└── (规划中) studio/        # 网页审阅编辑界面
```

TypeScript 单仓库，pnpm workspaces 管理。

## 路线图

- [x] 完整管线（雷达 → 建筑师 → 写手 → 审计 → 修订）
- [x] 长期记忆 + 连续性审计
- [x] 内置创作规则体系
- [x] CLI 全套命令（20 条）
- [x] 状态快照 + 章节重写
- [x] 守护进程模式
- [x] 通知推送（Telegram / 飞书 / 企微）
- [x] 原子命令 + JSON 输出（draft / audit / revise）
- [x] 自然语言 Agent 模式（tool-use 编排）
- [x] 可插拔雷达（RadarSource 接口）
- [x] 外部 Agent 集成（OpenClaw 等）
- [x] 题材自定义 + 单本书规则（genre CLI + book_rules.md）
- [x] 33 维度连续性审计（含 AI 痕迹检测 + 番外维度 + 大纲偏离检测）
- [x] 去 AI 味铁律 + 文风指纹注入
- [x] 多 LLM provider（OpenAI + Anthropic + 兼容接口）
- [x] AIGC 检测 + 反检测改写管线
- [x] Webhook 通知 + 智能调度（质量门控）
- [x] 跨章节连贯性（章节摘要 + 支线/情感/角色矩阵）
- [x] 番外写作（正典导入 + 4 维度审计 + 信息边界管控）
- [x] 文风仿写（统计指纹 + LLM 风格指南 + 写手注入）
- [x] 写后验证器（11 条硬规则 + 自动 spot-fix）
- [x] 审计-修订闭环加固（AI 标记守卫 + 温度锁）
- [x] 续写已有作品（import chapters + 自动逆向真相文件 + 断点续导）
- [x] 多 Provider 路由（不同 agent 走不同 API 地址和 Key，`inkos config set-model --base-url --provider`）
- [x] 数据分析（`inkos analytics`：审计通过率、高频问题、章节排名、token 用量统计）
- [x] EPUB 导出（`inkos export --format epub`，手机/Kindle 阅读）
- [x] 结构化日志系统（ANSI 颜色、JSON Lines 文件日志、静默模式、LLM 流式心跳）
- [x] Stream 自动降级（中转站不支持 SSE 时自动回退 sync，兼容智谱/Gemini 等）
- [x] 本地小模型兼容（fallback 解析 + 流中断部分内容恢复）
- [x] 创作简报（`book create --brief` 传入你的脑洞，基于此生成设定）
- [x] 轻量修订 + 事后结算（`revise-light` + `settle`，拆分修订与状态同步）
- [x] 动态 Temperature（按章节类型自动调节 0.6-0.85，高潮→高温，对话→低温）
- [x] 章节感知 Word Count（高潮章 +20%，过渡章 -15%，自动调节每章目标字数）
- [x] Pipeline Dry Run（零 LLM 消耗验证配置、预估 token 用量、检查预算决策）
- [x] Truth File 读取缓存（同一章管线内 4 次读取 → 1 次，减少 IO）
- [x] Writer Prompt 压缩（~18% 令牌节省，合并方法论 + 紧凑表格）
- [ ] `packages/studio` Web UI 审阅编辑界面（Vite + React + Hono）
- [ ] 局部干预（重写半章 + 级联更新后续 truth 文件）
- [ ] 英文小说全面适配（English genre profiles, prompts, audit rules, post-write validator）
- [ ] 自定义 agent 插件系统
- [ ] 平台格式导出（起点、番茄等）

## 参与贡献

欢迎贡献代码。提 issue 或 PR。

```bash
pnpm install
pnpm dev          # 监听模式
pnpm test         # 运行测试
pnpm typecheck    # 类型检查
```

## 许可证

[MIT](LICENSE)
