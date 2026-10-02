<p align="center">
  <img src="assets/logo.svg" width="120" height="120" alt="InkOS Logo">
  <img src="assets/inkos-text.svg" width="240" height="65" alt="InkOS">
</p>

<h1 align="center">Story Creation AI Agent<br><sub>面向长短篇小说、剧本剧作、互动影游、IP 内容与多语言翻译的创作智能体系统</sub></h1>

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

<p align="center">
  <strong>InkOS 网页版上线！</strong>
  <a href="https://huohuaapi.com/apps">立刻体验</a>
</p>

---

InkOS 是一个面向故事创作与多语言翻译的 AI Agent 系统：长篇连载、独立短篇、剧本剧作、同人番外、仿写续写、互动影游、开放世界和长文翻译，都可以从同一个工作台开始。支持 Studio、TUI、CLI 交互形式，把创意、设定、角色、记忆、审稿、修订、封面、互动状态和跨语言交付交给智能体统一管理。

<p align="left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://kimi-file.moonshot.cn/prod-chat-kimi/kfs/4/1/2026-06-05/1d8h69mt3v89kkekg24gg">
    <img alt="Kimi Open Source Friends" width="420" src="https://kimi-file.moonshot.cn/prod-chat-kimi/kfs/4/1/2026-06-05/1d8h69fudcmosb3pipls0">
  </picture>
  <br>
  🎉🎉 InkOS 入选首批 KIMI 开源合作伙伴 🎉🎉
</p>

<p align="center">
  <a href="https://www.kimi.com/code/?aff=inkos"><img src="https://gcdn.moonshot.cn/growth-cdn/sponsor/kimi-zh.png" width="900" alt="Kimi 赞助 InkOS"></a>
</p>

感谢 [Kimi](https://www.kimi.com/code/?aff=inkos) 赞助本项目！[Kimi K3](https://www.kimi.com/blog/kimi-k3) 是 Moonshot AI 迄今能力最强的模型，也是全球首个开源 3T 级模型，拥有原生视觉能力与 100 万 Token 上下文。搭配 InkOS，K3 可以参与长短篇小说、剧本、互动影游与多语言内容的规划、写作、审稿和修订；InkOS 则持续管理角色、设定、伏笔与故事状态，让长篇创作更连贯、更可控。

**InkOS Studio 已支持 Moonshot（Kimi）。前往 Kimi 开放平台（[中文站](https://platform.kimi.com/?aff=inkos)｜[Global](https://platform.kimi.ai/?aff=inkos)）获取 API Key，即可开始创作。**

<p align="center">
  <a href="https://www.volcengine.com/activity/ai618?utm_source=OWO&utm_medium=devrel-1&utm_campaign=hw&utm_term=inkos&utm_content=hw"><img src="assets/volcengine-agent-coding-plan.png" width="840" alt="火山方舟 Agent Plan 与 Coding Plan 赞助 InkOS"></a>
</p>

感谢 [字节火山引擎](https://www.volcengine.com/activity/ai618?utm_source=OWO&utm_medium=devrel-1&utm_campaign=hw&utm_term=inkos&utm_content=hw) 赞助本项目！火山方舟 Agent/Coding Plan 国模套餐首购 ¥9.9 起，支持 GLM-5.3、Kimi-K3、DeepSeek、MiniMax、Doubao 等模型；注册免费领取 2500 万 Token，统一 API，适配编码与智能体开发。[立即前往 →](https://www.volcengine.com/activity/ai618?utm_source=OWO&utm_medium=devrel-1&utm_campaign=hw&utm_term=inkos&utm_content=hw)

> 💡 **写小说，先给 Agent 接一层专业数据** —— 写小说不只缺模型，更缺素材。推荐搭配 [**火花数据API（huohuaapi）**](https://huohuaapi.com/)：按调用计费的小说 / 网文创作数据，让 Agent 动笔前先查小说正文、章节结构、人物设定、文风和创作方法等带来源素材，而不是只靠 Prompt 硬凑一份“剧情提纲”。

## v2.0.0 - 统一 Pi Agent Harness 与专业创作内核

本分支为 2.0 开发版本，使用本地构建进行验证。旧项目先运行 `inkos work migrate --json` 查看升级清单，再运行 `inkos work migrate --apply` 导入统一创作库；原目录与早期版本清单备份会保留，冲突不会覆盖已有作品。

迁移会转换 1.x 的书籍默认配置、规则和状态快照，保留正文、原始目录及未填写的历史信息。旧写作控制字段保留在原件中，2.0 使用 Profile 的操作策略。缺少运行时状态的项目以草稿进入创作库，需完成状态重建后再继续生产。

本地开发与真实生产验收统一使用 kkaiapi（`https://api.kkaiapi.com/v1`）：文字按 DeepSeek V4 Flash / Pro 分工，封面使用 `gpt-image-2`。在项目 `llm.cover` 中配置服务和模型，CLI 与 Studio 读取同一配置，封面可复用 kkaiapi 服务密钥。

已有短篇可以在作品对话中要求按审稿意见整篇修订，或运行 `inkos short revise <story-id> --instruction "修复审稿指出的时间线与证据链问题"`。系统会更新相关章节、大纲和销售包，再次审稿，并保留原稿版本。

InkOS 2.0 把“Chat Agent 调工具”和“各类作品管线”收敛成一套围绕 pi-agent 的生产 harness。模型负责理解、提议和调用能力；InkOS 负责确认、上下文、状态、原子落盘和产物真实性。长篇、短篇、剧本、分镜、互动影游、Play 与翻译继续保留各自的专业方法，但共享同一套执行、检索、观测和恢复基础设施。

- **模型配置**：Studio 内置多服务配置、模型路由和封面服务配置；支持 [kkaiapi](https://kkaiapi.com/) / OpenRouter 等全球主流模型聚合入口，以及自定义 OpenAI Chat Completions、OpenAI Responses 和 Anthropic Messages 服务。
- **单一生产 Harness**：Studio Chat、TUI、`inkos interact` 与生产 worker 共用 pi-agent 工具循环和结构化 action/result；既有 pipeline 降为可直接调用、可中断、可观测的确定性能力，不再维护平行的自然语言决策内核。
- **20 个内置专业 Skills**：长篇写作 / 审稿、商业短篇、Play、剧本、分镜、互动影游、翻译、拆稿、市场研究、导入、封面与去 AI 味都拥有独立 `SKILL.md`；各作品类型复用 Skill 架构，不复用不适合自己的长篇提示词。
- **统一本地检索**：故事记忆、材料库和 Skill 参考资料共用 SQLite FTS5 / BM25 检索投影；原始文件仍是权威来源，索引可重建，检索结果保留来源与位置。
- **书籍参考资料绑定**：导入材料可以显式绑定到某本书并声明用途，写作时按当前任务检索相关段落，而不是把所有文件全文塞进上下文。
- **安全章节工作区**：正文、状态、伏笔和运行快照先在章节工作区内校验，再原子提交；失败不会出现“状态已推进、正文未落盘”。Studio 可查看改写工作区和真实审稿问题。
- **跨作品生产一致性**：Short、剧本、分镜、互动影游、Play 与翻译接入统一 run snapshot、Skill 绑定、字数观测、取消信号和失败恢复，同时保留各自的状态模型与创作规则。
- **长任务与模型调用更稳**：多章写作按一个可恢复任务顺序执行；首 Token / 流式空闲超时、过期状态修复和原子文件集降低被动卡住或半完成的概率。
- **TUI 对齐 Studio**：新增 `/new`、`/short`、`/play`、`/cover`、`/write` 明确入口，结构化 `/confirm` / `/cancel`，会话级 `/model` 切换和明暗终端自适应配色；普通自由文本仍交给 Agent 理解。
- **模型与工作台补齐**：新增 LM Studio 本地服务，动态模型目录和外部母本导入可持久化；Studio 支持自定义封面 Base URL、宽屏章节预览和安全章节重写。

<p align="center">
  <img src="assets/interactive-film-e2e.png" width="440" alt="InkOS 互动影游剧情树实测截图">
  <img src="assets/studio-play-1-5.png" width="440" alt="InkOS Play Studio 开放世界界面">
</p>

### 主要创作形态

**长篇小说** — 从创作简报建书，生成世界观、角色、卷纲和章节意图；写作、审稿、修订、状态结算都是可独立调用、可追溯的 Harness action。上下文按 protected / compressible 分层组织，避免长书越写越乱。

**剧情多线推演** — 在写下一章前，基于当前正史生成 2-5 条彼此隔离的未来分支，并在 Studio Chat 中横向比较章节节拍、人物决定、预计变化、风险和作者意图匹配度。采用分支只会保存 `selected-branch-plan.md` 候选计划，不会修改正文、大纲或正史状态；正史变化后旧推演会标记为过期。

**InkOS Short** — Studio Chat 和 CLI 可以直接产出独立短篇：完整正文、大纲记录、审稿记录、简介卖点、封面提示词，并在配置封面服务后生成封面图。

**InkOS Play** — 新增开放世界与分支互动。你可以用自然语言指定世界契约、时间推进方式、角色 agent、物品 / 证据 / 关系规则和视觉风格；系统维护世界状态、可点击选择、自由动作、HUD 和自动配图。

**Studio Chat** — 普通聊天、建书、短篇、封面、互动世界都走同一套 action surface。重动作先确认，生成物可预览，可通过聊天修改章节、封面提示词、世界状态和持久化文本产物。

**Native English novel writing now supported！** Set `--lang en` to write in English. See [English README](README.en.md) for details.

## 欢迎交流

> 当前更新相对频繁，后续会持续新增功能与优化写作效果。
> 欢迎加群反馈问题、提出需求，也欢迎关注项目动态 — 我们的目标是做最强的基于小说的内容生态创作 AI Agent。

<p align="center">
  <img src="assets/wechat-group-v23.jpg" width="300" alt="微信交流群">
</p>

## 快速开始

### 安装

需要 **Node.js 22.16 或更高版本**。

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

这条入口直接走和项目 TUI 相同的交互执行内核，因此 OpenClaw、TUI、Studio 共用同一套控制脑。当前 JSON 输出包含 assistant 文本回复和 interaction session 信息；真正的执行结果以工具结果和落盘文件为准，不从模型口头声明推断完成。

底层规划、上下文组装、写作和审稿由同一 Harness action 调度，不再作为平行入口暴露。也可以在 [ClawHub](https://clawhub.ai) 搜索 `inkos` 在线查看。

### Agent Skills

InkOS 直接使用标准 `SKILL.md` 作为专业能力扩展，不再维护一套 InkOS 私有 Skill 协议。Skill 只向 Chat Agent 提供专业说明和静态参考资料，不会增加执行权限；创建、写入、编辑和生成图片仍然由 InkOS 工具与确认闸门控制。

可用方式：

- 放到标准目录：项目 `skills/`、`.agents/skills/`，或用户目录 `~/.agents/skills/`、`~/.openclaw/skills/`。Studio 也可以导入包含 `SKILL.md` 的完整文件夹和静态参考资料；项目导入统一保存到 `.agents/skills/`。
- 或设置 `INKOS_SKILL_DIRS=/abs/path/to/skills`，可指向单个 skill 目录，也可指向包含多个 skill 子目录的目录。多个目录按系统分隔符分隔。
- 在 Chat 里用 `@skill-id` 强制本轮使用，例如：`@detective-play 做一个证据链驱动的开放世界`。
- 不写 `@skill-id` 时，Chat Agent 根据用户当前意图决定是否调用 `use_skill`；不再通过 session 类型、关键词或字符串包含匹配机械启用。
- 外部 Skill 只提供指令和静态参考资料，InkOS 不会自动执行其中的脚本；它也不会绕过现有工具权限与确认闸门。

专业创作方法统一由 Skill 提供。要调整内置方法，可在 Studio 导入同 ID 的项目 Skill 作为覆盖；Agent 文件只保留动态任务、上下文和工具协议。

最小 `SKILL.md` 示例：

```md
---
name: Detective Play
description: Detective evidence and suspect-board play.
---
Use evidence chains; do not turn clues into generic atmosphere.
```

### 配置

当前 InkOS 将 LLM 配置分成两条清晰路径：**Studio 用可视化服务配置**，**CLI / daemon / 部署环境支持 env 覆盖**。两者不会互相污染。

#### 方式一：Studio 服务配置（推荐）

适合本地写作、Web 工作台和可视化管理。

```bash
inkos init my-novel
cd my-novel
inkos
```

请从启动日志显示的本机地址打开 Studio。默认本地服务只接受同源浏览器请求；自定义嵌入或反向代理可通过服务启动参数 `allowedOrigins` 明确配置可信来源。

打开 Studio 后进入「模型配置」：

1. 选择服务商，例如 Google Gemini、Moonshot、MiniMax、智谱、百炼或自定义端点。
2. 选择协议类型：OpenAI Chat Completions、OpenAI Responses 或 Anthropic Messages；自定义端点应按上游实际协议选择。
3. 粘贴 API Key，点击「测试连接」。
4. 选择可用模型，保存配置。
5. 回到书籍页面开始写作。

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
| `environment`    | CLI / daemon 直接使用当前环境配置                         |


如果服务测试失败，优先检查服务商、模型和协议是否匹配。Google Gemini 的 AI Studio API Key 可用于 Gemini OpenAI-compatible endpoint；InkOS 会自动禁用 Google 不支持的 OpenAI `store` 参数。MiniMax 默认走官方 OpenAI-compatible `/v1/chat/completions`，并优先使用可工作的非流式 transport，避免流式返回 usage 但无正文的问题；`MiniMax-M3*` 会默认关闭 thinking 返回，M2.x thinking 由上游限制无法关闭。

### LLM 配置更新

- **Studio / CLI 配置隔离**：Studio 固定使用服务页配置和 `.inkos/secrets.json`；CLI、daemon、部署环境支持 env 覆盖和一次性命令参数。
- **Provider bank 能力表**：内置 Google Gemini、Moonshot、MiniMax、智谱、百炼、DeepSeek、硅基流动、火山、腾讯混元、文心、讯飞星火、OpenRouter、kkaiapi、Ollama、CodingPlan 等服务的 baseUrl、协议、模型和兼容策略。
- **模型归属校验**：`--service google --model kimi-k2.5` 这类错配会直接报错，避免把请求发到错误服务商。
- **Google Gemini 兼容修复**：AI Studio API Key 可直接用于 Gemini OpenAI-compatible endpoint，InkOS 会自动禁用 Google 不支持的 OpenAI `store` 参数。
- **MiniMax transport 探测**：MiniMax / MiniMax CodingPlan 使用官方 OpenAI-compatible `/v1` 入口，并自动使用可工作的非流式 transport，规避流式 usage 正常但正文为空的问题。
- **环境配置**：CLI 可使用 `INKOS_LLM_BASE_URL + INKOS_LLM_MODEL + INKOS_LLM_API_KEY`；没有 `INKOS_LLM_SERVICE` 时从当前 baseUrl 识别服务。

### 当前交互入口

**Studio Chat + CLI + TUI 共用同一套执行面**

- **Studio Chat**：讨论、建书、短篇、封面、Play、编辑持久化文件都从同一个对话入口发起；重动作会先展示确认卡。
- **开始创作入口**：长篇小说、短篇小说、同人创作、番外创作、仿写创作、续写创作、分支互动、开放世界都可以从 Studio 顶部入口进入。
- **TUI 仪表盘**：`inkos tui` 进入终端全屏交互；支持 `/new`、`/short`、`/play`、`/cover`、`/write`、`/confirm`、`/cancel` 和会话级 `/model <模型名>`。
- **外部 Agent 入口**：`inkos interact --json --message "..."` 仍是 OpenClaw / 其他 agent 的结构化入口。
- **明确命令**：`write next`、`revise`、`review`、导入和导出仍可直接调用；内部规划与上下文阶段由 Harness 统一编排。

### 写第一本书

```bash
inkos book create --title "吞天魔帝" --genre xuanhuan  # 创建新书
inkos write next 吞天魔帝      # 写下一章并记录审稿 observation
inkos status                   # 查看状态
inkos review 吞天魔帝          # 查看已记录的审稿 observation
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



### 启动开放世界 / 分支互动

在 Studio Chat 里选择「开放世界」或「分支互动」，直接用自然语言描述你想玩的世界：

```text
做一个魔兽风格的边境哨塔开放世界。时间不是固定回合，巡逻是一小时，练功可以跨几天。装备有稀有度，但不要数值面板，用材质和光泽体现。
```

系统会生成世界、角色、物品、证据、关系、当前场景和可选动作。开放世界支持自由输入动作；分支互动会给出可点击选项。配置封面 / 图片服务后，角色、物品、证据、场景都可以生成图，并在对话流里滚动显示。

---

## 核心特性

### Studio Chat + Action Surface

Studio Chat 不再只是问答框。它可以创建长篇、跑短篇、生成封面、启动 Play、编辑持久化文本文件，并在需要执行重动作前给出确认。普通讨论会直接回答；明确创作动作才进入工具执行。

### InkOS Play：开放世界与分支互动

Play 维护一个可持续推进的世界状态：角色、地点、物品、证据、关系、时间、场景和 HUD。它不是固定 RPG 模板，你可以用自然语言定义世界契约：修仙装备可以有稀有感，恋爱本可以有心动层级，侦探本可以有证据生命周期。系统把这些规则写进世界状态，再用于后续叙事和配图。

### 定性审稿 + 去 AI 味

连续性审查会从角色记忆、物资连续性、伏笔回收、大纲偏离、叙事节奏和情感弧线等维度记录具体 observation。内置 AI 痕迹检测会标出高频词、句式单调和过度总结等可修订位置。observation 是可追溯的创作反馈，不会把章节改写成“通过/失败”状态；用户或 Agent 可据此显式发起修订。

去 AI 味由可替换的 `inkos-story-deslop` Skill 提供语义方法；需要时显式调用 `revise --mode anti-detect`，不会由隐藏词表自动改稿。

### 文风仿写

`inkos style analyze` 按激活的分析与仿写 Skill，把参考文本编译为有证据的可执行文风指南；`inkos style import` 将指南绑定到指定作品，供后续写作与修订按需使用。

### 创作简报

`inkos book create --brief my-ideas.md` 传入你的脑洞、世界观设定或人设文档。Architect 基于简报生成 `outline/story_frame.md`、`outline/volume_map.md`、角色卡和 `book_rules.md/json`，并把长期方向保存到 `story/author_intent.md`。

### 输入治理控制面

每本书现在都有两份长期可编辑的 Markdown 控制文档：

- `story/author_intent.md`：这本书长期想成为什么
- `story/current_focus.md`：最近 1-3 章要把注意力拉回哪里

用户可直接在 Studio Chat、TUI 或 `inkos agent` 中调整方向。Planner 先通过语义选择得到本章工作集，再生成 `story/runtime/chapter-XXXX.intent.md`；Composer 持久化 `context.json` 与 `trace.json`，记录真正进入模型的来源、保护层级、检索结果和压缩情况。

### 字数治理

`write next` 与 `revise` 共享同一套字数遥测：

- `--words` 指定的是目标字数，系统会自动推导一个允许区间，不承诺逐字精确命中
- 中文默认按 `zh_chars` 计数，英文默认按 `en_words` 计数
- 系统不会截断正文，也不会因长度偏差把章节标成失败
- 超出 hard range 时仍保存正文，并在 chapter index 与 ActionResult 中记录结构化遥测和 observation

### 续写已有作品

`inkos import chapters` 从已有小说文本导入章节，自动重建结构化状态、章节摘要、伏笔、角色关系和可读 Markdown 投影，支持 `第X章` 和自定义分割模式、断点续导。导入后 `inkos write next` 可继续创作。

### 同人创作

`inkos fanfic init --from source.txt --mode canon` 从原作素材创建同人书。支持四种模式：canon（正典延续）、au（架空世界）、ooc（性格重塑）、cp（CP 向）。由类型化正典导入器与同人 Skill 保留原作事实与信息边界。

### 多模型路由

不同 Agent 可以走不同模型和 Provider。写手用 Claude（创意强），审计用 GPT-4o（便宜快速），雷达用本地模型（零成本）。`inkos config set-model` 按 agent 粒度配置，未配置的自动回退全局模型。

### 守护进程 + 通知推送

`inkos up` 启动后台循环自动写章。管线会自动推进可处理的非关键问题；需要人工判断的问题会暂停并留下可审结果。通知推送支持 Telegram、飞书、企业微信、Webhook（HMAC-SHA256 签名 + 事件过滤）。日志写入 `inkos.log`（JSON Lines），`-q` 静默模式。

### 本地模型兼容

支持 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 和自定义兼容端点。服务测试会验证协议与流式能力；结构化输出缺失、流中断或输出上限都会明确报错或触发完整续写，不会把残缺文本当成功结果。

### 可靠性保障

每章自动创建状态快照，正文、索引和结构化状态以原子文件集提交。文件锁与 Action 队列防止并发写入；中断会留下 Episode 事件和可恢复状态。审稿只记录有证据的 observation，修订由用户或 Agent 显式发起。

伏笔系统使用 Zod schema 校验——`lastAdvancedChapter` 必须是整数，`status` 只能是 open/progressing/deferred/resolved。LLM 输出的 JSON delta 在写入前经过 `applyRuntimeStateDelta` 做 immutable 更新 + `validateRuntimeState` 结构校验。坏数据直接拒绝，不会滚雪球。

模型输出上限由 provider bank 的模型卡管理；`llm.extra` / `INKOS_LLM_EXTRA_*` 中的保留键（max_tokens、temperature、model、messages、stream 等）会被自动过滤，防止意外覆盖核心请求参数。

---

## 工作原理

InkOS 以 pi-agent harness 作为统一认知与工具调用内核：Agent 理解用户意图并产生结构化 action，宿主执行确定性工具、确认权限、管理状态并以真实文件和 tool result 判定完成。长篇、短篇、剧本、分镜、互动影游、Play 和翻译复用这套架构，但保留各自的专业 Skill、状态模型与生产步骤。

<p align="center">
  <img src="assets/arch-system.svg" width="900" alt="InkOS 整体系统架构">
</p>

长篇每一章按“语义工作集 → 规划 → 写作 → 状态投影 → observation → 原子提交”运行；修订是独立 Action：

<p align="center">
  <img src="assets/arch-pipeline.svg" width="900" alt="InkOS 章节生产管线">
</p>


| Agent               | 职责                                                                |
| ------------------- | ----------------------------------------------------------------- |
| **雷达 Radar**        | 扫描平台趋势和读者偏好，指导故事方向（可插拔，可跳过）                                       |
| **规划师 Planner**     | 读取作者意图 + 当前焦点 + 记忆检索结果，产出本章意图（must-keep / must-avoid）             |
| **编排师 Composer**    | 从结构化状态、控制文档和材料中按任务选择上下文，记录保护层级、检索和语义压缩 trace                    |
| **建筑师 Architect**   | 建书、导入或番外初始化时生成基础设定：故事框架、规则、角色与长期控制文件                              |
| **写手 Writer**       | 基于编排后的精简上下文生成正文（字数治理 + 对话引导）                                      |
| **状态结算 Settler**    | 通过 typed tool 提交正文有证据的增量 state delta，由宿主校验并应用                                 |
| **审稿 Agent**  | 对照用户意图、正典、状态、章节计划和审稿 Skill，返回有证据的定性观察                                 |
| **修订者 Reviser**     | 接受用户、Agent 或审查 observation 给出的明确修改目标，生成并原子落盘新版本                         |


章节正文和故事状态作为同一组产物原子落盘；审稿意见作为 observation 保存在章节记录中，不改变正文完成态。修订是独立的显式动作，完成后生成新的 observation 与可追溯版本。

### 长期记忆

每本书的权威记忆与检索投影分开：


| 层                    | 用途                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `story/state/*.json` | 权威结构化状态：当前状态、伏笔、章节摘要等，经过 Zod schema 校验                                                      |
| `story/*.md`         | 人类可读投影：`current_state.md`、`pending_hooks.md`、`chapter_summaries.md`、`character_matrix.md` 等 |
| `story/memory.db`    | 可重建的 SQLite FTS5/BM25 检索投影；不作为故事事实权威                                                        |


连续性审计员对照这些状态检查每一章草稿。如果角色"记起"了从未亲眼见过的事，或者拿出了两章前已经丢失的武器，审计员会捕捉到。

Settler 通过 typed tool 输出完整增量 delta，代码层做 immutable apply 和结构校验。Markdown 只是人类可读投影；检索时从 canonical JSON 重建索引，再由 LLM 对 BM25 候选做语义选择。

<p align="center">
  <img src="assets/arch-memory.svg" width="900" alt="InkOS 长期记忆与状态">
</p>

### 控制面与运行时产物

除了运行时状态，InkOS 还把“护栏”和“自定义”拆成可审阅的控制层：

- `story/author_intent.md`：长期作者意图
- `story/current_focus.md`：当前阶段的关注点
- `story/runtime/chapter-XXXX.intent.md`：本章目标、保留项、避免项、冲突处理
- `story/runtime/chapter-XXXX.context.json`：本章实际选入的上下文
- `story/runtime/chapter-XXXX.trace.json`：本章输入编译轨迹

这样 `brief`、卷纲、书级规则、当前任务不再混成一坨 prompt，而是先编译，再写作。

### 创作规则体系

专业创作方法由 Work Profile 绑定的 Skill 提供，可由项目中同 ID 的 `SKILL.md` 覆盖。Agent 代码只保留任务、输入权威和 typed tool 协议；每本作品仍有独立的 `book_rules.md/json`、`outline/story_frame.md`、`outline/volume_map.md`、`author_intent.md` 和 `current_focus.md`。

## 使用模式

InkOS 提供 Studio Chat、TUI、CLI Agent 和明确命令，底层共享同一 Harness：

### 1. 完整管线（一键式）

```bash
inkos write next 吞天魔帝          # 规划 → 编排 → 写作 → 审查记录 → 原子落盘
inkos write next 吞天魔帝 --count 5 # 连续写 5 章
```

`write next` 使用唯一的 `plan -> compose -> write -> review -> commit` 创作链路。审查产生 observation；技术校验决定能否原子落盘，语义反馈不会被转换成章节失败状态。

### 2. 明确能力命令

```bash
inkos write next 吞天魔帝 --count 3
inkos revise 吞天魔帝 31 --json
inkos review 吞天魔帝 --json
inkos export 吞天魔帝 --format epub
```

这些命令表达已经确定的用户动作；自然语言意图仍进入 pi-agent Harness，由当前 Work Profile 的 capability surface 决策。

### 3. 自然语言 Agent 模式

```bash
inkos agent "帮我写一本都市修仙，主角是个程序员"
inkos agent "写下一章，重点写师徒矛盾"
inkos agent "先扫描市场趋势，然后根据结果创建一本新书"
```

Agent 模式只暴露当前 Work Profile 允许的 capability。模型可按意图加载 Skill、读取 Work、提出新作品确认、写作、审稿或修订；完成态只来自 ActionResult 和真实 artifact revision。

### 4. Studio Play 模式

Studio 里的「开放世界」和「分支互动」是交互式创作入口。它们不要求你先建书，也不要求写死 RPG 数值。你可以描述“世界怎样运行、时间怎样推进、角色是否自主行动、物品和证据怎样影响故事”，系统会生成可继续玩的世界，并把每回合状态写回本地。

## Studio 实测截图与生成结果

<p align="center">
  <img src="assets/studio-dashboard.png" width="760" alt="InkOS Studio 开始创作入口">
</p>

<p align="center">
  <strong>InkOS Short 手机封面</strong><br>
  <img src="assets/inkos-short-demo-cover.png" width="260" alt="短篇封面">
</p>

<p align="center">
  <strong>InkOS Play 恋爱互动</strong><br>
  <img src="assets/play-openworld-romance.png" width="560" alt="恋爱互动">
</p>

<p align="center">
  <strong>InkOS Play 侦探互动</strong><br>
  <img src="assets/play-openworld-detective.png" width="560" alt="侦探互动">
</p>

<p align="center">
  <strong>InkOS Play 物品配图</strong><br>
  <img src="assets/play-item-warcraft.png" width="560" alt="物品配图">
</p>

第一张是当前 Studio 的本地实测截图。后面四张来自 InkOS Short 和 InkOS Play 的真实本地生成结果：短篇封面用于手机端缩略图点击，Play 图用于展示开放世界、侦探证据、互动场景和物品视觉能力。

## 命令参考


| 命令                                          | 说明                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `inkos init [name]`                         | 初始化项目（省略 name 在当前目录初始化）                                                                    |
| `inkos book create`                         | 创建新书（`--genre`、`--platform`、`--chapter-words`、`--target-chapters`、`--brief <file>` 传入创作简报） |
| `inkos book update [id]`                    | 修改书设置（`--chapter-words`、`--target-chapters`、`--status`）                                    |
| `inkos book list`                           | 列出所有书籍                                                                                     |
| `inkos book delete <id>`                    | 删除书籍及全部数据（`--force` 跳过确认）                                                                  |
| `inkos write next [id]`                     | 完整管线写下一章（`--words` 覆盖字数，`--count` 连写，`-q` 静默模式）                                            |
| `inkos write rewrite [id] <n>`              | 重写第 N 章（恢复状态快照，`--force` 跳过确认，`--words` 覆盖字数）                                              |
| `inkos revise [id] [n]`                     | 修订指定章节                                                                                     |
| `inkos agent <instruction>`                 | 自然语言 Agent 模式                                                                              |
| `inkos review [id]`                         | 查看已持久化的审稿 observation                                                                     |
| `inkos status [id]`                         | 项目状态                                                                                       |
| `inkos export [id]`                         | 导出书籍（`--format txt/md/epub`、`--output <path>`）                                               |
| `inkos radar scan`                          | 扫描平台趋势                                                                                     |
| `inkos fanfic init`                         | 从原作素材创建同人书（`--from`、`--mode canon/au/ooc/cp`）                                              |
| `inkos short run`                           | 生成独立短篇包（正文、简介卖点、封面提示词、可选封面图）                                                               |
| `inkos forecast create/show/select`          | 生成、核验并选择长篇的非正史剧情分支；选择只保存候选计划，不修改正史                                                        |
| `inkos interact`                            | 外部 agent / CLI 自然语言入口（`--json`、`--message`、`--book`）                                       |
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
| `inkos analytics [id]` / `inkos stats [id]` | 书籍数据分析（observation、章节长度、token 用量）                                                           |
| `inkos update`                              | 更新到最新版本                                                                                    |
| `inkos studio` / `inkos`                    | 启动 Web 工作台（`-p` 指定端口，默认 4567；Studio 使用服务页配置，不使用 env 覆盖）                                    |
| `inkos tui`                                 | 启动终端全屏 TUI                                                                                 |
| `inkos up / down`                           | 启动/停止守护进程（`-q` 静默模式，自动写入 `inkos.log`）                                                      |


`[id]` 参数在项目只有一本书时可省略。`write next` 支持 `--context` 传入创作指导，`--words` 覆盖每章目标字数；`book create` 支持 `--brief <file>` 传入创作简报。内部 Planner/Composer 产生的 intent、context 和 trace 可在 Studio 中查看。

CLI 运行时还支持一次性 LLM 覆盖参数：`--service`、`--model`、`--api-key-env`、`--base-url`、`--api-format <chat|responses|anthropic>`、`--stream`、`--no-stream`。`anthropic` 对应 Anthropic Messages 协议。例如：

```bash
inkos write next --service google --model gemini-2.5-flash
inkos up --service moonshot --model kimi-k2.5 --api-key-env MOONSHOT_API_KEY
```

## 路线图

- ~~`packages/studio` Web UI 工作台（Vite + React + Hono）~~ — 已发布，`inkos` 或 `inkos studio` 启动
- ~~互动小说 / 开放世界（分支叙事 + 自由动作 + 自动配图）~~ — Studio Play 已落地
- 局部干预（重写半章 + 级联更新后续 truth 文件）
- 自定义 agent 插件系统
- 平台格式导出（起点、番茄等）

## 参与贡献

欢迎贡献代码。提 issue 或 PR。

```bash
pnpm install
pnpm dev          # 监听模式
pnpm test         # 运行测试
pnpm typecheck    # 类型检查
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

![Repobeats analytics image](https://repobeats.axiom.co/api/embed/024114415c1505a8c27fb121e3b392524e48f583.svg)

## Contributors

<a href="https://github.com/Narcooo/inkos/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Narcooo/inkos" alt="Contributors" />
</a>

## 致谢

InkOS 的 agent 运行时构建在 [pi](https://github.com/badlogic/pi-mono)（`@mariozechner/pi-ai` 与 `@mariozechner/pi-agent-core`，作者 Mario Zechner）之上。感谢 pi 提供的扎实底座。

本开源项目已链接并认可 [LINUX DO](https://linux.do/) 社区，感谢社区成员的反馈、测试与讨论。

## 许可证

[AGPL-3.0](LICENSE)
