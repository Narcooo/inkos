<p align="center">
  <img src="assets/logo.svg" width="120" height="120" alt="InkOS Logo">
  <img src="assets/inkos-text.svg" width="240" height="65" alt="InkOS">
</p>

<h1 align="center">Autonomous Novel Writing Cli AI Agent<br><sub>自动化小说写作 Cli AI Agent</sub></h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@actalk/inkos"><img src="https://img.shields.io/npm/v/@actalk/inkos.svg?color=cb3837&logo=npm" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg" alt="Node.js"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.x-3178C6.svg?logo=typescript&logoColor=white" alt="TypeScript"></a>
</p>

<p align="center">
  <a href="README.en.md">English</a> | 中文
</p>

---

Agent 写小说。写、审、改，全程接管。覆盖玄幻、仙侠、都市、科幻等多种风格，支持续写、番外、同人、仿写等创作形式。

**Native English novel writing now supported！** Set `--lang en` to write in English. See [English README](README.en.md) for details.

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

安装后，Claw 可通过 `exec` 调用 InkOS 的原子命令和控制面操作（`plan chapter`/`compose chapter`/`draft`/`audit`/`revise`/`write next`），`--json` 输出结构化数据供 Claw 解析决策。推荐流程是先更新 `author_intent.md` 或 `current_focus.md`，再 `plan` / `compose`，最后决定是否 `draft` 或完整 `write next`。也可以在 [ClawHub](https://clawhub.ai) 搜索 `inkos` 在线查看。

### 配置

**方式一：全局配置（推荐，只需一次）**

```bash
inkos config set-global \
  --provider <openai|anthropic|custom> \
  --base-url <API 地址> \
  --api-key <你的 API Key> \
  --model <模型名>

# provider: openai / anthropic / custom（兼容 OpenAI 格式的中转站选 custom）
# base-url: 你的 API 提供商地址
# api-key: 你的 API Key
# model: 你的模型名称
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
# INKOS_LLM_TEMPERATURE=0.7                       # 温度
# INKOS_LLM_MAX_TOKENS=8192                        # 最大输出 token
# INKOS_LLM_THINKING_BUDGET=0                      # Anthropic 扩展思考预算
```

项目 `.env` 会覆盖全局配置。不需要覆盖时可以不写。

**方式三：多模型路由（可选）**

给不同 Agent 分配不同模型，按需平衡质量与成本：

```bash
# 给不同 agent 配不同模型/提供商
inkos config set-model writer <model> --provider <provider> --base-url <url> --api-key-env <ENV_VAR>
inkos config set-model auditor <model> --provider <provider>
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

## 核心特性

### 多维度审计 + 去 AI 味

连续性审计员从 33 个维度检查每一章草稿：角色记忆、物资连续性、伏笔回收、大纲偏离、叙事节奏、情感弧线等。内置 AI 痕迹检测维度，自动识别"LLM 味"表达（高频词、句式单调、过度总结），审计不通过自动进入修订循环。

去 AI 味规则内置于写手 agent 的 prompt 层——词汇疲劳词表、禁用句式、文风指纹注入，从源头减少 AI 生成痕迹。`revise --mode anti-detect` 可对已有章节做专门的反检测改写。

### 文风仿写

`inkos style analyze` 分析参考文本，提取统计指纹（句长分布、词频特征、节奏模式）和 LLM 风格指南。`inkos style import` 将指纹注入指定书籍，后续所有章节自动采用该风格，修订者也会用风格标准做审计。

### 创作简报

`inkos book create --brief my-ideas.md` 传入你的脑洞、世界观设定、人设文档。建筑师 agent 会基于简报生成故事设定（`story_bible.md`）和创作规则（`book_rules.md`），而非凭空创作；同时把简报落盘到 `story/author_intent.md`，让这本书的长期创作意图不会只在建书时生效一次。

### 输入治理控制面

每本书现在都有两份长期可编辑的 Markdown 控制文档：

- `story/author_intent.md`：这本书长期想成为什么
- `story/current_focus.md`：最近 1-3 章要把注意力拉回哪里

写作前可以先跑：

```bash
inkos plan chapter 吞天魔帝 --context "本章先把注意力拉回师徒矛盾"
inkos compose chapter 吞天魔帝
```

这会生成 `story/runtime/chapter-XXXX.intent.md`、`context.json`、`rule-stack.yaml`、`trace.json`。其中 `intent.md` 给人看，其他文件给系统执行和调试。`plan` / `compose` 只编译本地文档和状态，不依赖在线 LLM，可在没配好 API Key 前先验证控制输入。

### 字数治理

`draft`、`write next`、`revise` 现在共享同一套保守型字数治理：

- `--words` 指定的是目标字数，系统会自动推导一个允许区间，不承诺逐字精确命中
- 中文默认按 `zh_chars` 计数，英文默认按 `en_words` 计数
- 如果正文超出允许区间，InkOS 最多只会追加 1 次纠偏归一化（压缩或补足），不会直接硬截断正文
- 如果 1 次纠偏后仍然超出 hard range，章节照常保存，但会在结果和 chapter index 里留下长度 warning / telemetry

### 续写已有作品

`inkos import chapters` 从已有小说文本导入章节，自动逆向工程 7 个真相文件（世界状态、角色矩阵、资源账本、伏笔钩子等），支持 `第X章` 和自定义分割模式、断点续导。导入后 `inkos write next` 无缝接续创作。

### 同人创作

`inkos fanfic init --from source.txt --mode canon` 从原作素材创建同人书。支持四种模式：canon（正典延续）、au（架空世界）、ooc（性格重塑）、cp（CP 向）。内置正典导入器、同人专属审计维度和信息边界管控——确保设定不矛盾。

### 多模型路由

不同 Agent 可以走不同模型和 Provider。写手用 Claude（创意强），审计用 GPT-4o（便宜快速），雷达用本地模型（零成本）。`inkos config set-model` 按 agent 粒度配置，未配置的自动回退全局模型。

### 守护进程 + 通知推送

`inkos up` 启动后台循环自动写章。管线对非关键问题全自动运行，关键问题暂停等人工审核。通知推送支持 Telegram、飞书、企业微信、Webhook（HMAC-SHA256 签名 + 事件过滤）。日志写入 `inkos.log`（JSON Lines），`-q` 静默模式。

### 本地模型兼容

支持任何 OpenAI 兼容接口（`--provider custom`）。Stream 自动降级——中转站不支持 SSE 时自动回退 sync。Fallback 解析器处理小模型不规范输出，流中断时自动恢复部分内容。

### 可靠性保障

每章自动创建状态快照，`inkos write rewrite` 可回滚任意章节。写手动笔前输出自检表（上下文、资源、伏笔、风险），写完输出结算表，审计员交叉验证。文件锁防止并发写入。写后验证器含跨章重复检测和 11 条硬规则自动 spot-fix。

伏笔系统使用 Zod schema 校验——`lastAdvancedChapter` 必须是整数，`status` 只能是 open/progressing/deferred/resolved。LLM 输出的 JSON delta 在写入前经过 `applyRuntimeStateDelta` 做 immutable 更新 + `validateRuntimeState` 结构校验。坏数据直接拒绝，不会滚雪球。

用户设置的 `INKOS_LLM_MAX_TOKENS` 作为全局上限生效，`llm.extra` 中的保留键（max_tokens、temperature 等）被自动过滤，防止意外覆盖。

---

## 工作原理

每一章由多个 Agent 接力完成，全程零人工干预：

<p align="center">
  <img src="assets/screenshot-pipeline.png" width="800" alt="管线流程图">
</p>

| Agent | 职责 |
|-------|------|
| **雷达 Radar** | 扫描平台趋势和读者偏好，指导故事方向（可插拔，可跳过） |
| **规划师 Planner** | 读取作者意图 + 当前焦点 + 记忆检索结果，产出本章意图（must-keep / must-avoid） |
| **编排师 Composer** | 从全量真相文件中按相关性选择上下文，编译规则栈和运行时产物 |
| **建筑师 Architect** | 规划章节结构：大纲、场景节拍、节奏控制 |
| **写手 Writer** | 基于编排后的精简上下文生成正文（字数治理 + 对话引导） |
| **观察者 Observer** | 从正文中过度提取 9 类事实（角色、位置、资源、关系、情感、信息、伏笔、时间、物理状态） |
| **反射器 Reflector** | 输出 JSON delta（而非全量 markdown），由代码层做 Zod schema 校验后 immutable 写入 |
| **归一化器 Normalizer** | 单 pass 压缩/扩展，将章节字数拉入允许区间 |
| **连续性审计员 Auditor** | 对照 7 个真相文件验证草稿，33 维度检查 |
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

连续性审计员对照这些文件检查每一章草稿。如果角色"记起"了从未亲眼见过的事，或者拿出了两章前已经丢失的武器，审计员会捕捉到。

从 0.6.0 起，真相文件的权威来源从 markdown 迁移到 `story/state/*.json`（Zod schema 校验）。Settler 不再输出完整 markdown 文件，而是输出 JSON delta，由代码层做 immutable apply + 结构校验后写入。markdown 文件仍然保留作为人类可读的投影。旧书首次运行时自动从 markdown 迁移到结构化 JSON，零人工操作。

Node 22+ 环境下自动启用 SQLite 时序记忆数据库（`story/memory.db`），支持按相关性检索历史事实、伏笔和章节摘要，避免全量注入导致的上下文膨胀。

<p align="center">
  <img src="assets/screenshot-state.png" width="800" alt="长期记忆快照">
</p>

### 控制面与运行时产物

除了 7 个真相文件，InkOS 还把“护栏”和“自定义”拆成可审阅的控制层：

- `story/author_intent.md`：长期作者意图
- `story/current_focus.md`：当前阶段的关注点
- `story/runtime/chapter-XXXX.intent.md`：本章目标、保留项、避免项、冲突处理
- `story/runtime/chapter-XXXX.context.json`：本章实际选入的上下文
- `story/runtime/chapter-XXXX.rule-stack.yaml`：本章的优先级层和覆盖关系
- `story/runtime/chapter-XXXX.trace.json`：本章输入编译轨迹

这样 `brief`、卷纲、书级规则、当前任务不再混成一坨 prompt，而是先编译，再写作。

### 创作规则体系

写手 agent 内置 ~25 条通用创作规则（人物塑造、叙事技法、逻辑自洽、语言约束、去 AI 味），适用于所有题材。

在此基础上，每个题材有专属规则（禁忌、语言约束、节奏、审计维度），每本书有独立的 `book_rules.md`（主角人设、数值上限、自定义禁令）、`story_bible.md`（世界观设定）、`author_intent.md`（长期方向）和 `current_focus.md`（近期关注点）。`volume_outline.md` 仍然是默认规划，但在 v2 输入治理模式下不再天然压过当前任务意图。

## 使用模式

InkOS 提供三种交互方式，底层共享同一组原子操作：

### 1. 完整管线（一键式）

```bash
inkos write next 吞天魔帝          # 写草稿 → 审计 → 自动修订，一步到位
inkos write next 吞天魔帝 --count 5 # 连续写 5 章
```

`write next` 现在默认走 `plan -> compose -> write` 的输入治理链路。若你需要回退到旧的 prompt 拼装路径，可在 `inkos.json` 中显式设置：

```json
{
  "inputGovernanceMode": "legacy"
}
```

默认值为 `v2`。`legacy` 仅作为显式 fallback 保留。

### 2. 原子命令（可组合，适合外部 Agent 调用）

```bash
inkos plan chapter 吞天魔帝 --context "本章重点写师徒矛盾" --json
inkos compose chapter 吞天魔帝 --json
inkos draft 吞天魔帝 --context "本章重点写师徒矛盾" --json
inkos audit 吞天魔帝 31 --json
inkos revise 吞天魔帝 31 --json
```

每个命令独立执行单一操作，`--json` 输出结构化数据。`plan` / `compose` 负责控制输入，`draft` / `audit` / `revise` 负责正文与质量链路。可被外部 AI Agent 通过 `exec` 调用，也可用于脚本编排。

### 3. 自然语言 Agent 模式

```bash
inkos agent "帮我写一本都市修仙，主角是个程序员"
inkos agent "写下一章，重点写师徒矛盾"
inkos agent "先扫描市场趋势，然后根据结果创建一本新书"
```

内置 18 个工具（write_draft、plan_chapter、compose_chapter、audit_chapter、revise_chapter、scan_market、create_book、update_author_intent、update_current_focus、get_book_status、read_truth_files、list_books、write_full_pipeline、web_fetch、import_style、import_canon、import_chapters、write_truth_file），LLM 通过 tool-use 决定调用顺序。推荐的 Agent 工作流是：先调整控制面，再 `plan` / `compose`，最后决定写草稿还是跑完整管线。

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

## 命令参考

| 命令 | 说明 |
|------|------|
| `inkos init [name]` | 初始化项目（省略 name 在当前目录初始化） |
| `inkos book create` | 创建新书（`--genre`、`--platform`、`--chapter-words`、`--target-chapters`、`--brief <file>` 传入创作简报） |
| `inkos book update [id]` | 修改书设置（`--chapter-words`、`--target-chapters`、`--status`） |
| `inkos book list` | 列出所有书籍 |
| `inkos book delete <id>` | 删除书籍及全部数据（`--force` 跳过确认） |
| `inkos genre list/show/copy/create` | 查看、复制、创建题材 |
| `inkos plan chapter [id]` | 生成下一章的 `intent.md`（`--context` / `--context-file` 传入当前指令） |
| `inkos compose chapter [id]` | 生成下一章的 `context.json`、`rule-stack.yaml`、`trace.json` |
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
| `inkos fanfic init` | 从原作素材创建同人书（`--from`、`--mode canon/au/ooc/cp`） |
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
| `inkos up / down` | 启动/停止守护进程（`-q` 静默模式，自动写入 `inkos.log`） |

`[id]` 参数在项目只有一本书时可省略，自动检测。所有命令支持 `--json` 输出结构化数据。`draft` / `write next` / `plan chapter` / `compose chapter` 支持 `--context` 传入创作指导，`--words` 覆盖每章目标字数。`book create` 支持 `--brief <file>` 传入创作简报（你的脑洞/设定文档），Architect 会基于此生成设定而非凭空创作。`plan chapter` / `compose chapter` 不要求在线 LLM，可在配置 API Key 之前先检查输入治理结果。

## 更新日志

### v0.6

**结构化状态 + 伏笔治理 + 字数治理**

重点解决三个长篇写作的系统性问题：**20+ 章后上下文膨胀导致写作变慢甚至 400 报错**（Settler 全量注入 → JSON delta + 选择性检索）、**伏笔只加不收、回收率接近 0%**（Planner 排班 + Settler 盲区修补 + 审计追债）、**字数偏差 50%+ 且 normalizer 可能毁章**（LengthSpec + 安全网）。

- 管线升级为 10-agent：新增 Planner、Composer、Observer、Reflector、Normalizer
- 真相文件迁移到 `story/state/*.json`（Zod 校验），Settler 输出 JSON delta 而非全量 markdown，旧书自动迁移
- Node 22+ 启用 SQLite 时序记忆数据库，按相关性检索历史事实
- Planner 生成 `hookAgenda` 排班伏笔推进与回收，Settler working set 扩展覆盖 dormant debt
- hookOps 新增 `mention` 语义防止假推进，`analyzeHookHealth` 审计伏笔债务，`evaluateHookAdmission` 拦截重复伏笔
- 字数治理：`LengthSpec` + Normalizer 单 pass 修正，安全网防止归一化毁章
- 用户 `INKOS_LLM_MAX_TOKENS` 作为全局上限生效，`llm.extra` 保留键自动过滤
- 跨章重复检测、对话驱动引导、English variance brief、多角色场景阻力要求
- 章节摘要去重、ESM node:sqlite 修复、consolidate 全角括号兼容
- 双语 CLI 输出和日志

## 路线图

- [ ] `packages/studio` Web UI 审阅编辑界面（Vite + React + Hono）
- [ ] 局部干预（重写半章 + 级联更新后续 truth 文件）
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
