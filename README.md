# 此为enderboy的版本

***

### 更新日志

1. 添加了自动模型切换（主要是为了 model scope 的免费额度）
2. 自定义 agent 提示词
3. 添加了去ai味功能（来自[去 AI 味](https://github.com/LifelongLazyLearner/qu-ai-wei)）

***

<p align="center"> <img src="assets/logo.svg" width="120" height="120" alt="InkOS Logo"> <img src="assets/inkos-text.svg" width="240" height="65" alt="InkOS">

</p>

<h1 align="center">Autonomous Novel Writing AI Agent<br><sub>自动化小说写作 AI Agent</sub></h1>
<p align="center">
  <a href="https://www.npmjs.com/package/@actalk/inkos"><img src="https://img.shields.io/npm/v/@actalk/inkos.svg?color=cb3837&logo=npm" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg" alt="License: AGPL-3.0"></a>
  <a href="https://github.com/Narcooo/inkos/stargazers"><img src="https://img.shields.io/github/stars/Narcooo/inkos?style=flat&logo=github&color=yellow" alt="GitHub stars"></a>
  <a href="https://www.npmjs.com/package/@actalk/inkos"><img src="https://img.shields.io/npm/dm/@actalk/inkos?color=cb3837&logo=npm&label=downloads" alt="npm downloads"></a>
  <a href="https://clawhub.ai/narcooo/inkos"><img src="https://img.shields.io/badge/🦞%20ClawHub-Skill-FF6B35?labelColor=1a1a1a" alt="ClawHub Skill"></a>
</p>

<p align="center">
  <a href="README.en.md">English</a> | 中文 | <a href="README.ja.md">日本語</a>
</p>

***

AI Agent 自主写小说——写、审、改，全程接管。覆盖玄幻、仙侠、都市、科幻等多种风格，支持续写、番外、同人、仿写等创作形式。人工审核门控确保你始终掌控全局。已发布为 [OpenClaw](https://clawhub.ai/narcooo/inkos) skill。



**v1.4.0 短篇写作与 Studio Chat 协作更新** — Studio Chat 和 CLI 现在可以生成独立短篇、简介卖点和封面提示词 / 封面图；普通聊天支持持久化 session，生成物可直接预览和编辑；Studio 模型配置内置 [kkaiapi](https://kkaiapi.com/) ，方便接入全球主流模型聚合服务。

**InkOS Studio 2.0 正式发布！** — 直接运行 `inkos` 启动本地 Web 工作台。书籍管理、章节审阅编辑、实时写作进度、市场雷达、数据分析、AI 检测、文风分析、题材管理、守护进程控制、真相文件编辑——CLI 能做的，Studio 全部可视化。

**InkOS TUI 正式发布！** — 运行 `inkos tui` 进入全屏交互仪表盘。对话式创作、自然语言操作书籍、slash 命令补全、主题动效——TUI、Studio、OpenClaw 共享同一套交互内核。

**InkOS Short** — Studio 对话和 CLI 现在可以直接产出独立短篇：完整正文、大纲记录、审稿记录、简介卖点、封面提示词，并在配置封面服务后生成封面图。

> 短篇开篇示例：宋词三个多月没坐过这辆车了。蓝牙自动连上她的手机，屏幕弹出“子账号登录中”。她点进常用地址统计：新城花园 187 次，妇幼医院 38 次，月子中心 9 次。后备箱传来闷响，徐晋安放完东西坐进来，冲她笑笑：“今晚加班，你自己打车回去？”她抬头看他，也笑了。

<p align="center">
  <img src="assets/inkos-short-demo-cover.png" width="320" alt="InkOS Short 短篇封面示例">
</p>

**Native English novel writing now supported！** Set `--lang en` to write in English. See [English README](README.en.md) for details.

## 欢迎交流

> 当前更新相对频繁，后续会持续新增功能与优化写作效果。
> 欢迎加群反馈问题、提出需求，也欢迎关注项目动态 — 我们的目标是做最强的基于小说的内容生态创作 AI Agent。

<p align="center">
  <img src="assets/4e50013fc562bdccb579eda0b77fd1a2.jpg" width="300" alt="微信交流群">
</p>

## 快速开始

### 安装

```bash
npm i -g @actalk/inkos
```

### 通过 OpenClaw 使用 🦞

InkOS 已发布为 [OpenClaw](https://clawhub.ai/narcooo/inkos) Skill，可被任何兼容 Agent（Claude Code、OpenClaw 等）直接调用：

```bash
clawhub install inkos          # 从 ClawHub 安装 InkOS Skill
```

通过 npm 安装或克隆本项目时，`skills/SKILL.md` 已包含在内，🦞 可直接读取——无需额外从 ClawHub 安装。

安装后，Claw 应优先通过共享交互入口调用 InkOS：

```bash
inkos interact --json --message "继续当前书，但把节奏再收紧一点"
```

这条入口直接走和项目 TUI 相同的交互执行内核，因此 OpenClaw、TUI、Studio 共用同一套控制脑。返回的 JSON 包含：

- 解析后的 request
- assistant 文本回复
- 更新后的 interaction session
- execution state
- pending decision
- recent events

`plan chapter` / `compose chapter` / `draft` / `audit` / `revise` / `write next` 这些原子命令仍然保留，但更适合作为底层工具，而不是 OpenClaw 的首选入口。也可以在 [ClawHub](https://clawhub.ai) 搜索 `inkos` 在线查看。

### 配置

InkOS 2.0 将 LLM 配置分成两条清晰路径：**Studio 用可视化服务配置**，**CLI / daemon / 部署环境支持 env 覆盖**。两者不会互相污染。

#### 方式一：Studio 服务配置（推荐）

适合本地写作、Web 工作台和可视化管理。

```bash
inkos init my-novel
cd my-novel
inkos
```

打开 Studio 后进入「模型配置」：

1. 选择服务商，例如 Google Gemini、Moonshot、MiniMax、智谱、百炼或自定义端点。
2. 粘贴 API Key，点击「测试连接」。
3. 选择可用模型，保存配置。
4. 回到书籍页面开始写作。

Studio 运行时只使用：

```text
provider bank 默认值
→ inkos.json 里的 services / 当前 service / defaultModel
→ .inkos/secrets.json 里的 service API Key
```

即使检测到 `~/.inkos/.env` 或项目 `.env`，Studio 也只会展示提示，不会用 env 覆盖 service、model、baseUrl 或 API Key。API Key 存在项目内的 `.inkos/secrets.json`，不会写进 `inkos.json`。

#### 方式二：CLI / daemon / 部署环境的 env 配置

适合终端批处理、服务器部署、CI、Docker、守护进程和一次性切模型。

全局 env：

```bash
inkos config set-global \
  --provider <openai|anthropic|custom> \
  --base-url <API 地址> \
  --api-key <你的 API Key> \
  --model <模型名>
```

也可以手动写 `~/.inkos/.env` 或项目 `.env`：

```bash
INKOS_LLM_PROVIDER=custom
INKOS_LLM_BASE_URL=https://api.moonshot.cn/v1
INKOS_LLM_API_KEY=sk-...
INKOS_LLM_MODEL=kimi-k2.5

# 可选
INKOS_LLM_SERVICE=moonshot                         # 推荐写；不写时会尽量从 baseUrl 自动识别
INKOS_LLM_TEMPERATURE=0.7
INKOS_LLM_THINKING_BUDGET=0
INKOS_DEFAULT_LANGUAGE=zh
INKOS_LLM_EXTRA_top_p=0.9
```

CLI 合成顺序：

```text
Studio/project service 配置
→ .inkos/secrets.json service key
→ global ~/.inkos/.env
→ project .env
→ 当前进程环境变量
→ CLI 参数
```

也就是说，CLI 默认可以复用 Studio 配好的服务和密钥；如果 env 里声明了 `INKOS_LLM_SERVICE`、`INKOS_LLM_MODEL`、`INKOS_LLM_BASE_URL` 或 `INKOS_LLM_API_KEY`，则作为覆盖层生效。旧 env 只写 `baseUrl + model + apiKey` 也能继续用，InkOS 会尽量从 baseUrl 反推 service。

一次性指定服务或模型：

```bash
inkos write next --service google --model gemini-2.5-flash
inkos write next --service moonshot --model kimi-k2.5 --no-stream
inkos agent "继续写下一章" --api-key-env MOONSHOT_API_KEY
inkos doctor --service minimaxCodingPlan --model MiniMax-M2.7
```

`--service` 会从 provider bank 自动推导 baseUrl、协议和兼容策略；`--model` 必须属于最终 service，否则会直接报错，避免把 Kimi 模型发到 Gemini 这类错配问题。

#### 方式三：多模型路由（可选）

给不同 Agent 分配不同模型，按需平衡质量与成本：

```bash
# 给不同 agent 配不同模型/提供商
inkos config set-model writer <model> --provider <provider> --base-url <url> --api-key-env <ENV_VAR>
inkos config set-model auditor <model> --provider <provider>
inkos config show-models        # 查看当前路由
```

未单独配置的 Agent 自动使用全局模型。

#### 配置排查

```bash
inkos doctor
```

`doctor` 会显示当前 effective config mode、service/model/API Key 来源，并尝试 API 连通性。常见模式：

| 模式               | 含义                                        |
| ---------------- | ----------------------------------------- |
| `studio-project` | Studio 运行时：只使用 Studio/project 配置和 secrets |
| `cli-project`    | CLI 运行时：以 Studio 配置为基础，再叠加 env 和 CLI 参数   |
| `legacy-env`     | 旧 env 模式：兼容老项目的纯 `.env` 配置                |

如果服务测试失败，优先检查服务商、模型和协议是否匹配。Google Gemini 的 AI Studio API Key 可用于 Gemini OpenAI-compatible endpoint；InkOS 会自动禁用 Google 不支持的 OpenAI `store` 参数。MiniMax / MiniMax CodingPlan 默认走官方 OpenAI-compatible `/v1/chat/completions`，并优先使用可工作的非流式 transport，避免流式返回 usage 但无正文的问题。

### v2.0 LLM 配置更新

- **Studio / CLI 配置隔离**：Studio 固定使用服务页配置和 `.inkos/secrets.json`；CLI、daemon、部署环境支持 env 覆盖和一次性命令参数。
- **Provider bank 能力表**：内置 Google Gemini、Moonshot、MiniMax、智谱、百炼、DeepSeek、硅基流动、PPIO、OpenRouter、Ollama、CodingPlan 等服务的 baseUrl、协议、模型和兼容策略。
- **模型归属校验**：`--service google --model kimi-k2.5` 这类错配会直接报错，避免把请求发到错误服务商。
- **Google Gemini 兼容修复**：AI Studio API Key 可直接用于 Gemini OpenAI-compatible endpoint，InkOS 会自动禁用 Google 不支持的 OpenAI `store` 参数。
- **MiniMax transport 探测**：MiniMax / MiniMax CodingPlan 使用官方 OpenAI-compatible `/v1` 入口，并自动使用可工作的非流式 transport，规避流式 usage 正常但正文为空的问题。
- **旧 env 兼容**：老的 `INKOS_LLM_BASE_URL + INKOS_LLM_MODEL + INKOS_LLM_API_KEY` 仍可用于 CLI；没有 `INKOS_LLM_SERVICE` 时会尝试从 baseUrl 反推服务商。

### v1.2 更新

**统一交互内核 + TUI 仪表盘 + Studio 助手**

- **共享交互运行时**：TUI、Studio、`inkos interact`、OpenClaw Skill 共用同一套自然语言理解 + 执行内核，支持 15+ 种意图（写作、修订、重写、改名、导出、切换书籍等）
- **Ink TUI 仪表盘**：`inkos` 直接进入全屏交互式仪表盘（Ink + React），对话式创作体验，slash 命令自动补全，主题动效，i18n 双语
- **Studio 助手面板**：右侧 AI 助手面板接入共享交互内核，支持自然语言操作书籍——改名、写章、审计、导出等，实时显示执行状态
- **对话式建书**：通过自然语言对话逐步构思书籍设定，草稿就绪后一键创建
- **全书实体改名**：`把林烬改成张三` 或 `/rename 林烬 => 张三`，全量扫描章节 + 真相文件，一次替换
- **`inkos interact`**：共享交互 JSON 入口，OpenClaw / 外部 Agent 可直接调用
- **Thinking 模型温度夹制**：kimi-k2.5 等 thinking 模型自动强制 temperature=1，兼容 per-call 温度调参
- **Studio 死代码清理**：移除未使用的 shadcn 组件和依赖，-2800 行

### 写第一本书

```bash
inkos book create --title "吞天魔帝" --genre xuanhuan  # 创建新书
inkos write next 吞天魔帝      # 写下一章（草稿 → 审计 → 按配置修订）
inkos status                   # 查看状态
inkos review list 吞天魔帝     # 审阅草稿
inkos review approve-all 吞天魔帝  # 批量通过
inkos export 吞天魔帝          # 导出全书
inkos export 吞天魔帝 --format epub  # 导出 EPUB（手机/Kindle 阅读）
```

### 写完整短篇

想直接生成一篇完整短篇，可以在 Studio 对话里说：

```text
写一篇 12 章短篇，方向是：都市婚姻反转，女主拿到账本证据后反杀。
```

也可以走 CLI：

```bash
inkos short run \
  --direction "都市短篇 婚姻反转 女主证据反杀" \
  --chapters 12 \
  --chars 1000
```

生成物会落在 `shorts/<故事名>/final/`，包含 `full.md`、`sales-package.md`、`cover-prompt.md`，配置封面服务后还会生成 `cover.png`。

### 单独制作封面

如果只想给已有标题或简介做封面，不需要重跑短篇正文，在 Studio 对话里直接说：

```text
给《她签下离婚协议那天，他悔疯了》生成一张短篇封面，偏现代都市、强反转。
```

封面工具会独立生成 `covers/<标题>/cover-prompt.md` 和 `covers/<标题>/cover.png`。如果还没有配置封面服务，先在 Studio 的模型配置里设置封面服务和 API Key。

生成后也可以继续通过 chat 改封面提示词，例如“把人物拉近一点、标题字更大、表情更冷笑”。系统会用新的 `coverPrompt` 重写 `cover-prompt.md` 并重生成封面，不需要重新写短篇。

<p align="center">
  <img src="assets/screenshot-terminal.png" width="700" alt="终端截图">
</p>

***

## 核心特性

### 多维度审计 + 去 AI 味

连续性审计员从 33 个维度检查每一章草稿：角色记忆、物资连续性、伏笔回收、大纲偏离、叙事节奏、情感弧线等。内置 AI 痕迹检测维度，自动识别"LLM 味"表达（高频词、句式单调、过度总结）。默认长篇写作链路最多自动修订一次；如果你更看重自动闭环，可以通过 `writing.reviewRetries` 调整修订轮数。

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

这会生成 `story/runtime/chapter-XXXX.intent.md`、`context.json`、`rule-stack.yaml`、`trace.json`。其中 `intent.md` 给人看，其他文件给系统执行和调试。`plan` 会调用 LLM 生成章节意图；`compose` 只编译本地文档和状态，可在没配好 API Key 前先验证控制输入。

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

支持任何 OpenAI 兼容接口（Studio 里新增自定义服务，或 CLI 使用 `--provider custom` / `INKOS_LLM_PROVIDER=custom`）。服务测试会尝试不同协议和流式开关组合，并保存或提示可用 transport。Fallback 解析器处理小模型不规范输出，流中断时自动恢复部分内容。

### 可靠性保障

每章自动创建状态快照，`inkos write rewrite` 可回滚任意章节。写手动笔前输出自检表（上下文、资源、伏笔、风险），写完输出结算表，审计员交叉验证。文件锁防止并发写入。写后验证器含跨章重复检测和 11 条硬规则自动 spot-fix。

伏笔系统使用 Zod schema 校验——`lastAdvancedChapter` 必须是整数，`status` 只能是 open/progressing/deferred/resolved。LLM 输出的 JSON delta 在写入前经过 `applyRuntimeStateDelta` 做 immutable 更新 + `validateRuntimeState` 结构校验。坏数据直接拒绝，不会滚雪球。

模型输出上限由 provider bank 的模型卡管理；`llm.extra` / `INKOS_LLM_EXTRA_*` 中的保留键（max\_tokens、temperature、model、messages、stream 等）会被自动过滤，防止意外覆盖核心请求参数。

***

## 工作原理

每一章由多个 Agent 接力完成，默认按“规划 → 编排 → 写作 → 审计 → 必要修订 → 状态同步”运行：

<p align="center">
  <img src="assets/screenshot-pipeline.png" width="800" alt="管线流程图">
</p>

| Agent               | 职责                                                                |
| ------------------- | ----------------------------------------------------------------- |
| **雷达 Radar**        | 扫描平台趋势和读者偏好，指导故事方向（可插拔，可跳过）                                       |
| **规划师 Planner**     | 读取作者意图 + 当前焦点 + 记忆检索结果，产出本章意图（must-keep / must-avoid）             |
| **编排师 Composer**    | 从全量真相文件中按相关性选择上下文，编译规则栈和运行时产物                                     |
| **建筑师 Architect**   | 建书、导入或番外初始化时生成基础设定：故事框架、规则、角色与长期控制文件                              |
| **写手 Writer**       | 基于编排后的精简上下文生成正文（字数治理 + 对话引导）                                      |
| **观察者 Observer**    | 从正文中过度提取 9 类事实（角色、位置、资源、关系、情感、信息、伏笔、时间、物理状态）                      |
| **反射器 Reflector**   | 输出 JSON delta（而非全量 markdown），由代码层做 Zod schema 校验后 immutable 写入    |
| **归一化器 Normalizer** | 仅在正文明显偏离 hard range 时单 pass 压缩/扩展                                 |
| **连续性审计员 Auditor**  | 对照 7 个真相文件验证草稿，33 维度检查                                            |
| **修订者 Reviser**     | 修复审计发现的关键问题；默认最多自动修订一次，可通过 `writing.reviewRetries` 调整，其他问题标记给人工审核 |

如果审计不通过，默认管线只做一次"修订 → 再审计"；仍未解决的问题会保留在结果和状态里，交给人工或后续命令继续处理。需要更强自动闭环时，可以运行 `inkos config set writing.reviewRetries 3` 把修订轮数调高。

### 长期记忆

每本书维护 7 个真相文件作为唯一事实来源：

| 文件                     | 用途                       |
| ---------------------- | ------------------------ |
| `current_state.md`     | 世界状态：角色位置、关系网络、已知信息、情感弧线 |
| `particle_ledger.md`   | 资源账本：物品、金钱、物资数量及衰减追踪     |
| `pending_hooks.md`     | 未闭合伏笔：铺垫、对读者的承诺、未解决冲突    |
| `chapter_summaries.md` | 各章摘要：出场人物、关键事件、状态变化、伏笔动态 |
| `subplot_board.md`     | 支线进度板：A/B/C 线状态、停滞检测     |
| `emotional_arcs.md`    | 情感弧线：按角色追踪情绪变化和成长        |
| `character_matrix.md`  | 角色交互矩阵：相遇记录、信息边界         |

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

写手 agent 内置 \~25 条通用创作规则（人物塑造、叙事技法、逻辑自洽、语言约束、去 AI 味），适用于所有题材。

在此基础上，每个题材有专属规则（禁忌、语言约束、节奏、审计维度），每本书有独立的 `book_rules.md`（主角人设、数值上限、自定义禁令）、`story_bible.md`（世界观设定）、`author_intent.md`（长期方向）和 `current_focus.md`（近期关注点）。`volume_outline.md` 仍然是默认规划，但在 v2 输入治理模式下不再天然压过当前任务意图。

## 使用模式

InkOS 提供三种交互方式，底层共享同一组原子操作：

### 1. 完整管线（一键式）

```bash
inkos write next 吞天魔帝          # 写草稿 → 审计 → 按配置自动修订
inkos write next 吞天魔帝 --count 5 # 连续写 5 章
```

`write next` 现在默认走 `plan -> compose -> write` 的输入治理链路，审计后的自动修订轮数默认是 1。若你需要回退到旧的 prompt 拼装路径，可在 `inkos.json` 中显式设置：

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

内置 18 个工具（write\_draft、plan\_chapter、compose\_chapter、audit\_chapter、revise\_chapter、scan\_market、create\_book、update\_author\_intent、update\_current\_focus、get\_book\_status、read\_truth\_files、list\_books、write\_full\_pipeline、web\_fetch、import\_style、import\_canon、import\_chapters、write\_truth\_file），LLM 通过 tool-use 决定调用顺序。推荐的 Agent 工作流是：先调整控制面，再 `plan` / `compose`，最后决定写草稿还是跑完整管线。

## 实测数据

用 InkOS 全自动跑了一本玄幻题材的《吞天魔帝》：

<p align="center">
  <img src="assets/screenshot-chapters.png" width="800" alt="生产数据">
</p>

| 指标    | 数据         |
| ----- | ---------- |
| 已完成章节 | 31 章       |
| 总字数   | 452,191 字  |
| 平均章字数 | \~14,500 字 |
| 审计通过率 | 100%       |
| 资源追踪项 | 48 个       |
| 活跃伏笔  | 20 条       |
| 已回收伏笔 | 10 条       |

## 命令参考

| 命令                                          | 说明                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `inkos init [name]`                         | 初始化项目（省略 name 在当前目录初始化）                                                                    |
| `inkos book create`                         | 创建新书（`--genre`、`--platform`、`--chapter-words`、`--target-chapters`、`--brief <file>` 传入创作简报） |
| `inkos book update [id]`                    | 修改书设置（`--chapter-words`、`--target-chapters`、`--status`）                                    |
| `inkos book list`                           | 列出所有书籍                                                                                     |
| `inkos book delete <id>`                    | 删除书籍及全部数据（`--force` 跳过确认）                                                                  |
| `inkos genre list/show/copy/create`         | 查看、复制、创建题材                                                                                 |
| `inkos plan chapter [id]`                   | 生成下一章的 `intent.md`（`--context` / `--context-file` 传入当前指令）                                  |
| `inkos compose chapter [id]`                | 生成下一章的 `context.json`、`rule-stack.yaml`、`trace.json`                                       |
| `inkos write next [id]`                     | 完整管线写下一章（`--words` 覆盖字数，`--count` 连写，`-q` 静默模式）                                            |
| `inkos write rewrite [id] <n>`              | 重写第 N 章（恢复状态快照，`--force` 跳过确认，`--words` 覆盖字数）                                              |
| `inkos draft [id]`                          | 只写草稿（`--words` 覆盖字数，`-q` 静默模式）                                                             |
| `inkos audit [id] [n]`                      | 审计指定章节                                                                                     |
| `inkos revise [id] [n]`                     | 修订指定章节                                                                                     |
| `inkos agent <instruction>`                 | 自然语言 Agent 模式                                                                              |
| `inkos review list [id]`                    | 审阅草稿                                                                                       |
| `inkos review approve-all [id]`             | 批量通过                                                                                       |
| `inkos status [id]`                         | 项目状态                                                                                       |
| `inkos export [id]`                         | 导出书籍（`--format txt/md/epub`、`--output <path>`、`--approved-only`）                           |
| `inkos radar scan`                          | 扫描平台趋势                                                                                     |
| `inkos fanfic init`                         | 从原作素材创建同人书（`--from`、`--mode canon/au/ooc/cp`）                                              |
| `inkos config set-global`                   | 设置 CLI / daemon / 部署环境的全局 LLM env（`~/.inkos/.env`）                                         |
| `inkos config show-global`                  | 查看全局配置                                                                                     |
| `inkos config set/show`                     | 查看/更新项目配置                                                                                  |
| `inkos config set-model <agent> <model>`    | 为指定 agent 设置模型覆盖（`--base-url`、`--provider`、`--api-key-env` 支持多 Provider 路由）                |
| `inkos config remove-model <agent>`         | 移除 agent 模型覆盖（回退到默认）                                                                       |
| `inkos config show-models`                  | 查看当前模型路由                                                                                   |
| `inkos doctor`                              | 诊断配置问题（显示 effective config mode、来源、API 连通性和提供商兼容性提示）                                       |
| `inkos detect [id] [n]`                     | AIGC 检测（`--all` 全部章节，`--stats` 统计）                                                         |
| `inkos style analyze <file>`                | 分析参考文本提取文风指纹                                                                               |
| `inkos style import <file> [id]`            | 导入文风指纹到指定书                                                                                 |
| `inkos import canon [id] --from <parent>`   | 导入正传正典到番外书                                                                                 |
| `inkos import chapters [id] --from <path>`  | 导入已有章节续写（`--split`、`--resume-from`）                                                        |
| `inkos analytics [id]` / `inkos stats [id]` | 书籍数据分析（审计通过率、高频问题、章节排名、token 用量）                                                           |
| `inkos update`                              | 更新到最新版本                                                                                    |
| `inkos studio` / `inkos`                    | 启动 Web 工作台（`-p` 指定端口，默认 4567；Studio 使用服务页配置，不使用 env 覆盖）                                    |
| `inkos up / down`                           | 启动/停止守护进程（`-q` 静默模式，自动写入 `inkos.log`）                                                      |

`[id]` 参数在项目只有一本书时可省略，自动检测。所有命令支持 `--json` 输出结构化数据。`draft` / `write next` / `plan chapter` / `compose chapter` 支持 `--context` 传入创作指导，`--words` 覆盖每章目标字数。`book create` 支持 `--brief <file>` 传入创作简报（你的脑洞/设定文档），Architect 会基于此生成设定而非凭空创作。`plan chapter` 会调用 LLM 生成章节意图；`compose chapter` 不要求在线 LLM，可在配置 API Key 之前先检查输入治理结果。

CLI 运行时还支持一次性 LLM 覆盖参数：`--service`、`--model`、`--api-key-env`、`--base-url`、`--api-format <chat|responses>`、`--stream`、`--no-stream`。例如：

```bash
inkos write next --service google --model gemini-2.5-flash
inkos up --service moonshot --model kimi-k2.5 --api-key-env MOONSHOT_API_KEY
```

## 路线图

- [ ] 互动小说（分支叙事 + 读者选择）
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

## 从零开始：开发者使用指南

如果你想从源码运行和开发 InkOS（而不是通过 `npm install -g` 安装），请按以下步骤操作：

### 环境要求

- Node.js >= 20
- pnpm >= 9

### 第一步：安装依赖

```bash
cd inkos                     # 进入本项目根目录
pnpm install                 # 安装所有依赖
pnpm build                   # 编译 core、cli、studio
```

### 第二步：创建小说项目

InkOS Studio 需要一个小说项目目录（包含 `inkos.json`）才能运行。在仓库外任意位置创建：

```bash
# 在仓库外创建项目（例如 D:\my-novel 或 ~/my-novel）
mkdir my-novel
cd my-novel

# 用 CLI 初始化项目（如果已全局安装 inkos）
inkos init

# 或者手动创建最简 inkos.json：
```

`my-novel/inkos.json` 最简内容：

```json
{
  "name": "my-novel",
  "version": "0.1.0",
  "language": "zh",
  "llm": {
    "provider": "openai",
    "service": "custom",
    "configSource": "studio",
    "baseUrl": "",
    "model": "",
    "apiFormat": "chat",
    "stream": true
  },
  "notify": [],
  "inputGovernanceMode": "v2",
  "daemon": {
    "schedule": {
      "radarCron": "0 */6 * * *",
      "writeCron": "*/15 * * * *"
    },
    "maxConcurrentBooks": 3
  }
}
```

项目目录结构：

```
my-novel/
├── inkos.json       # 项目配置
├── .env             # 可选，LLM 环境变量
├── books/           # 书籍数据
└── radar/           # 市场雷达扫描结果
```

### 第三步：配置 Studio 指向你的项目

编辑 `packages/studio/scripts/dev.js`，将 `INKOS_PROJECT_ROOT` 改为你的项目路径：

```js
INKOS_PROJECT_ROOT: "D:\\my-novel",  // Windows
// 或
INKOS_PROJECT_ROOT: "/home/user/my-novel",  // macOS/Linux
```

### 第四步：启动 Studio

```bash
# 回到项目根目录
cd inkos

# 启动 Studio（前端 + 后端）
pnpm dev
# 或仅启动 studio 包
pnpm --filter @actalk/inkos-studio dev
```

- 前端：<http://localhost:4567>
- 后端 API：<http://localhost:4569>

### 第五步：配置 LLM 服务

打开浏览器访问 <http://localhost:4567，进入「模型配置」页面：>

1. 选择服务商（Google Gemini、Moonshot、MiniMax、智谱、百炼或自定义端点）
2. 粘贴 API Key，点击「测试连接」
3. 选择可用模型，保存配置

### 第六步：创建并开始写作

在 Studio 中点击「创建新书」，或使用 CLI：

```bash
# 进入你的小说项目目录
cd my-novel

# 使用全局安装的 CLI（如果装了）
inkos book create --title "我的小说" --genre xuanhuan
```

也可以直接在 Studio 界面完成建书、写作、审阅全流程。

### 常用开发命令

```bash
pnpm dev                      # 所有包监听模式
pnpm build                    # 全部编译
pnpm test                     # 运行所有测试
pnpm typecheck                # 类型检查

pnpm --filter @actalk/inkos-core dev     # 仅 core
pnpm --filter @actalk/inkos dev          # 仅 cli
pnpm --filter @actalk/inkos-studio dev   # 仅 studio

pnpm --filter @actalk/inkos-core test    # 仅 core 测试
pnpm --filter @actalk/inkos test         # 仅 cli 测试
```

## Star History

<a href="https://www.star-history.com/#Narcooo/inkos&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Narcooo/inkos&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Narcooo/inkos&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Narcooo/inkos&type=date&legend=top-left" />
 </picture>
</a>

## Skills Download History

<div align="center">

<a href="https://skill-history.com/narcooo/inkos">
  <img alt="Skills Download History" src="https://skill-history.com/chart/narcooo/inkos.svg" />
</a>

</div>

## Repobeats

![Alt](https://repobeats.axiom.co/api/embed/024114415c1505a8c27fb121e3b392524e48f583.svg "Repobeats analytics image")

## Contributors

<a href="https://github.com/Narcooo/inkos/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Narcooo/inkos" />
</a>

## 许可证

[AGPL-3.0](LICENSE)
