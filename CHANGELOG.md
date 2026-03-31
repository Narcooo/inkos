# Changelog

## v1.0.2

### Bug Fixes

- **#127** — 修复 Studio Web 创建书籍时的误报失败：后台仍在异步创建时，前端延长等待窗口，不再过早提示 `Book not found`
- 段落碎片检测忽略纯对话行，减少误报

---

## v1.0.0

InkOS Studio + 稳定性加固。从 CLI 工具升级为 CLI + Web 工作台。

### InkOS Studio

- `inkos studio` 启动本地 Web 工作台（Vite + React + Hono，默认端口 4567）
- 书籍管理：创建、删除、导出（TXT/MD/EPUB）、配置
- 章节审阅与编辑：批准/拒绝、行内编辑、多模式修订（polish/spot-fix/rewrite/anti-detect）
- 实时写作进度：SSE 推送生成状态
- 市场雷达：AI 驱动的平台/题材趋势分析
- 数据分析：字数统计、审计通过率、章节排名、token 用量
- AI 检测：扫描章节 AI 生成痕迹
- 文风分析与导入：分析参考文本、注入写作风格
- 题材管理：创建/自定义题材（疲劳词、节奏规则、审计维度）
- 守护进程控制：启停后台写作、查看事件日志
- 真相文件编辑器：按书查看和编辑知识库
- 配置编辑器：LLM 提供商、模型路由、通知

### Bug Fixes

- unknown hook 在 resolve/defer 时不再抛异常，改为跳过
- Studio 创建书后等待完成再路由跳转
- Studio 异步创建失败时错误暴露给用户
- validator false positive：只在硬矛盾时 fail，减少误报

### Chore

- 清理 studio 合并带入的无关文件（.playwright-cli/、.superpowers/、推广文档）
- untrack docs/ 和 autoresearch/，加入 .gitignore
- SKILL.md 升级到 v2.2.0，新增 Studio workflow section
- 三语 README 更新 Studio 发布公告和路线图

---

## v0.6.3

### Bug Fixes

- **#113/#109** — StateValidator JSON 解析从贪婪正则改为平衡括号解析器，LLM 追加 markdown 不再导致解析失败
- **#114** — status 命令章节数改为数实际文件，不再受 poisoned runtime state 影响
- **#110** — book creation 改为原子操作（临时目录 → rename），失败不留半成品
- **#92/#93** — agent 执行层硬限制：write_draft 校验顺序写入、revise_chapter 校验目标章存在、write_truth_file 拦截进度篡改、import_chapters 要求 ≥2 章
- **#90** — 段落形态检测移到落盘前（覆盖 normalize + auto revise 后的最终内容）
- **#94** — 标题去重：writer prompt 加约束 + post-write validator 检测 + 自动改名

### Improvements

- **#111** — SKILL.md 补齐 13 个缺失命令（eval, consolidate, write rewrite, book update/delete, plan/compose, studio, fanfic show/refresh, genre create/copy）
- **#95** — doctor 命令新增版本迁移检测（识别 pre-v0.6 旧格式书籍）
- **#103** — 补充 rewrite 端到端回归测试（rewrite 2 → next 应为 3）
- 新增 `inkos eval` 命令 — 结构化质量评估报告
- SKILL.md 版本升级到 2.1.0

## v0.6.2

### Bug Fixes

- **伏笔崩溃** (#99/#101/#104) — duplicate active hook family 不再崩溃，改为自动吸收合并；新增 hook 仲裁机制降低重复频率
- **本地 LLM** (#100) — 本地/self-hosted OpenAI-compatible 端点（Ollama 等）不再要求 API key
- **0 字章节** (#105) — truth rebuild 不再覆盖最终章节内容
- **章号错误** (#108/#98) — poisoned manifest 在 bootstrap 时自动归一化到真实进度
- **坏章节写入** (#88) — state validator 空响应直接报错，章节文件保存移到校验通过之后
- **Provider 400** (#91) — streaming provider fallback 错误提示优化

### Improvements

- **段落质量** (#90) — 新增短段落检测和段落密度漂移 warning
- **Agent 工具约束** (#92/#93) — agent 工具描述加强边界约束，system prompt 新增禁止性规则
- Windows 兼容：tar 命令加 --force-local
- README 描述更新，OpenClaw 链接指向 skill 页面

## v0.6.1

- 修复 emphasized hook id 标准化
- 修复 poisoned runtime state 恢复

## v0.6

结构化状态 + 伏笔治理 + 字数治理。

重点解决三个长篇写作的系统性问题：**20+ 章后上下文膨胀导致写作变慢甚至 400 报错**、**伏笔只加不收、回收率接近 0%**、**字数偏差 50%+ 且 normalizer 可能毁章**。

### 架构

- 管线升级为 10-agent：新增 Planner、Composer、Observer、Reflector、Normalizer
- 真相文件迁移到 `story/state/*.json`（Zod 校验），Settler 输出 JSON delta 而非全量 markdown，旧书自动迁移
- Node 22+ 启用 SQLite 时序记忆数据库（`story/memory.db`），按相关性检索历史事实
- `createRequire` 修复 ESM 下 node:sqlite 加载

### 伏笔治理

- Planner 生成 `hookAgenda`（mustAdvance / eligibleResolve / staleDebt），排班伏笔推进与回收
- Settler working set 扩展为 `selected ∪ recent ∪ agenda ∪ dormant debt`，堵住检索盲区
- hookOps 新增 `mention` 语义——"只是被提到"不再更新 `lastAdvancedChapter`，防止假推进
- `analyzeHookHealth`：active 超上限 / 连续无推进 / stale 未处置 / 新开不回收 → 审计 warning
- `evaluateHookAdmission`：重复 hook 家族自动拦截，防止伏笔膨胀

### 字数治理

- `LengthSpec`（target / softMin-softMax / hardMin-hardMax）+ `countingMode`（zh_chars / en_words）
- 审计前 + 修订后各一次归一化机会，不暴力截断
- 安全网：归一化结果 <25% 原文直接拒绝，`stripCommonWrappers` 删超 50% 回退原文

### 质量

- 跨章重复检测（中文 6 字 ngram / 英文 3 词短语）
- 对话驱动引导（互动场景优先对话交锋）
- English variance brief（反重复短语/开头/结尾注入）
- 多角色场景阻力要求（至少一轮带阻力的直接交锋）

### Bug 修复

- 用户 `INKOS_LLM_MAX_TOKENS` 作为全局上限生效（#87）
- `stripReservedKeys` 防止 `llm.extra` 覆盖 max_tokens / temperature
- 章节摘要去重：append 前去重 + bootstrap 加载时去重 + JSON 自动修复
- `consolidate` 正则支持全角括号卷边界格式
- 双语 CLI 输出和日志
- Runtime state 中毒恢复

---

## v0.5.0

英文原生写作 + 系统稳定性修复。

### 英文小说写作

- 10 个英文题材（LitRPG、Progression Fantasy、Isekai、Romantasy、Sci-Fi、Cozy Fantasy、Tower Climber、Dungeon Core、System Apocalypse、Cultivation）
- `--lang en` 贯穿全管道：Architect 生成英文设定、Writer 英文创作、Settler 英文 truth files、Auditor 英文审计、Reviser 英文修订
- 英文写后验证器：AI-tell 词检测（delve/tapestry/testament 等）、段落长度、疲劳词
- 章节标题自动切换：`Chapter X:` vs `第X章`
- EPUB 导出 lang 标签适配

### 系统稳定性

- 原子写入锁：`acquireBookLock` 从 stat+write 改为 `open("wx")` 排他创建，消除竞态
- 调度器防重入：上一轮写作/雷达未完成时跳过新 tick
- 修订一致性：revision 链使用 `finalContent` 而非原始内容，spot-fix 不再丢失
- Agent override 客户端隔离：不同 API key 的 agent 不再共用连接
- Daemon pid 清理：启动失败时自动删除残留 pid 文件
- Studio 启动修复：构建后的 JS 用 node 而非 tsx 启动
- Import resume 计数修正：`--resume-from` 正确报告实际处理数

### CLI 增强

- `inkos book delete <id>`：删除书籍及全部数据（`--force` 跳过确认）
- `inkos status --chapters`：显示每章状态和 failed 章节的 critical issues
- 审计 JSON 解析容错（#51）
- `write_truth_file` agent 工具（#53）
- 审计漂移纠偏自动注入状态卡（#52）

---

## v0.4.6

日志系统 + 流式兼容性 + 本地模型容错 + CLI 增强。

### 结构化日志

- 新增 Logger 模块：ANSI 颜色输出（INFO=cyan, WARN=yellow, ERROR=red），JSON Lines 文件日志
- `inkos up` 自动写入 `inkos.log`，守护进程重启后可追溯
- `write next`、`draft`、`up` 支持 `-q, --quiet` 静默模式
- LLM 流式心跳：模型思考期间每 30 秒汇报进度（已接收字符数、中文字数）
- 管线内 17 处 `process.stderr.write` 替换为结构化 logger

### 流式兼容性

- Stream 自动降级：streaming 失败时自动用 sync 重试，中转站不支持 SSE 也能用
- 流中断部分内容恢复：已接收 ≥500 字符时返回截断内容而非报错（#21）
- 错误诊断增强：400/401/403/429/Connection error 附带 baseUrl、model 上下文和排查建议
- `inkos doctor` 失败时给出针对性 hints（检查 baseUrl、试 stream:false、检查 API Key）

### Bug 修复

- `rewrite` 快照恢复：`particle_ledger.md` 从必需改为可选，非数值题材不再报错（#37）
- `rewrite` 第 1 章：`initBook` 末尾生成 snapshot-0，chapter 1 可正确恢复（#34）
- 本地小模型空章节：`parseCreativeOutput` 增加 3 级 fallback（markdown heading → 正文标签 → 最长散文块），Qwen/Ollama 不再返回空内容（#13）

### CLI 增强

- `book create --brief <file>`：传入创作简报，Architect 基于你的脑洞生成设定（#43）
- `write rewrite` 第 1 章时正确恢复到 snapshot-0（之前跳过恢复）

---

## v0.4 (v0.4.0 – v0.4.5)

续写 + 番外写作 + 文风仿写 + 多 Provider 路由 + 写后验证器 + 审计闭环加固。

### 续写已有作品

把已有的小说（单文件或章节目录）导入 InkOS，系统自动拆章、逆向工程生成全套真相文件（世界状态、伏笔、角色矩阵等），之后直接 `write next` 续写。

```bash
inkos import chapters 我的小说 --from 已有章节/        # 从目录导入
inkos import chapters 我的小说 --from 全书.txt          # 从单文件导入（自动按"第X章"拆分）
inkos import chapters 我的小说 --from 全书.txt --split "Chapter\\s+\\d+"  # 自定义分章正则
inkos write next 我的小说                               # 无缝续写
```

单文件模式自动按 `第X章` 分章，也支持 `--split <regex>` 自定义。导入中断可用 `--resume-from <n>` 断点续导。

### 番外写作（Spinoff）

基于已有书创建前传、后传、外传或 if 线。番外和正传共享世界观和角色，但有独立剧情线。

```bash
inkos import canon 烈焰前传 --from 吞天魔帝   # 导入正传正典到番外
inkos write next 烈焰前传                     # 写手自动读取正典约束
```

导入后生成 `story/parent_canon.md`，包含正传的世界规则、角色快照（含信息边界）、关键事件时间线、伏笔状态。写手在动笔前参照正典，审计员自动激活 4 个番外专属维度：

| 维度 | 审查内容 |
|------|----------|
| 正传事件冲突 | 番外事件是否与正典约束表矛盾 |
| 未来信息泄露 | 角色是否引用了分歧点之后才揭示的信息 |
| 世界规则跨书一致性 | 番外是否违反正传世界规则（力量体系、地理、阵营） |
| 番外伏笔隔离 | 番外是否越权回收正传伏笔 |

检测到 `parent_canon.md` 自动激活，无需额外配置。

### 文风仿写

喂入真人小说片段，系统提取统计指纹 + 生成风格指南，后续每章自动注入写手 prompt。

```bash
inkos style analyze 参考小说.txt                     # 分析：句长、TTR、修辞特征
inkos style import 参考小说.txt 吞天魔帝 --name 某作者  # 导入文风到书
```

产出两个文件：
- `style_profile.json` — 统计指纹（句长分布、段落长度、词汇多样性、修辞密度）
- `style_guide.md` — LLM 生成的定性风格指南（节奏、语气、用词偏好、禁忌）

写手每章读取风格指南，审计员在文风维度对照检查。

### 写后验证器

11 条确定性规则，零 LLM 成本，每章写完立刻触发：

| 规则 | 说明 |
|------|------|
| 禁止句式 | 「不是……而是……」 |
| 禁止破折号 | 「——」 |
| 转折词密度 | 仿佛/忽然/竟然等，每 3000 字 ≤ 1 次 |
| 高疲劳词 | 题材疲劳词单章每词 ≤ 1 次 |
| 元叙事 | 编剧旁白式表述 |
| 报告术语 | 分析框架术语不入正文 |
| 作者说教 | 显然/不言而喻等 |
| 集体反应 | 「全场震惊」类套话 |
| 连续了字 | ≥ 6 句连续含「了」 |
| 段落过长 | ≥ 2 个段落超 300 字 |
| 本书禁忌 | book_rules.md 中的禁令 |

验证器发现 error 级违规时，自动触发 `spot-fix` 模式定点修复，不等 LLM 审计。

### 审计-修订闭环加固

实测发现 `rewrite` 模式引入 6 倍 AI 标记词，现在：

- 自动修订模式从 `rewrite` 改为 `spot-fix`（只改问题句，不碰其余正文）
- 修订后对比 AI 标记数，如果修订反而增多 AI 痕迹，丢弃修订保留原文
- 再审温度锁 0（消除审计随机性，同一章不再出现 0-6 个 critical 的波动）
- `polish` 模式加固边界（禁止增删段落、改人名、加新情节）

### 多 Provider 路由

不同 agent 可以走不同 API 提供商——不只是换模型名，是完全不同的 API 地址和 Key。例如写手用便宜模型高速出稿，审计员用强模型精审：

```bash
inkos config set-model writer gpt-4o-mini                                    # 简单模型覆盖
inkos config set-model auditor gemini-2.5-flash \
  --base-url https://generativelanguage.googleapis.com/v1beta/openai \
  --provider openai \
  --api-key-env GEMINI_API_KEY                                                # 走 Gemini API
inkos config set-model reviser claude-sonnet-4-20250514 \
  --base-url https://api.anthropic.com \
  --provider anthropic \
  --api-key-env ANTHROPIC_API_KEY                                             # 走 Anthropic API
inkos config show-models                                                      # 查看路由全景
```

每个 agent 独立配置 `--base-url`、`--provider`、`--api-key-env`、`--no-stream`。未覆盖的 agent 使用项目默认模型。

### 数据分析

```bash
inkos analytics 吞天魔帝          # 审计通过率、高频问题类别、问题最多的章节
inkos analytics 吞天魔帝 --json   # 结构化输出
```

### 其他 v0.4 变更

- 审计维度从 26 扩展到 33（+4 番外维度 + dim 27 敏感词 + dim 32 读者期待管理 + dim 33 大纲偏离检测）
- 审计员联网搜索：年代考据题材可联网核实真实事件/人物/地理（原生搜索能力）
- 调度器重写：AI 节奏（默认 15 分钟一轮）、并行书处理、立即重试、每日上限
- 修订者新增 `spot-fix` 模式（定点修复）
- `book_rules.md` 的 `additionalAuditDimensions` 支持中文名称匹配
- 全部 5 个题材激活 dim 24-26（支线停滞/弧线平坦/节奏单调）
- `inkos export` 支持 `--format md`、`--output <path>`、`--approved-only`
- 写后验证器「连续了字」阈值从 4 句上调至 6 句（减少中文叙事误报）
- 安全加固：`init`/`book create`/`import chapters` 防覆盖检查、`config set` 类型推断 + key 校验、`update` 防降级、`doctor` 项目外可测 API、状态显示一致性、`genre show` 拒绝无效 ID

---

## v0.3

创作规则三层分离 + 跨章记忆 + AIGC 检测 + Webhook。

### 跨章记忆与写作质量

Writer 每章自动生成摘要、更新支线/情感/角色矩阵，全部追加到真相文件。后续章节加载全量上下文，长线伏笔不再丢失。

| 真相文件 | 用途 |
|----------|------|
| `chapter_summaries.md` | 各章摘要：出场人物、关键事件、状态变化、伏笔动态 |
| `subplot_board.md` | 支线进度板：A/B/C 线状态追踪 |
| `emotional_arcs.md` | 情感弧线：按角色追踪情绪、触发事件、弧线方向 |
| `character_matrix.md` | 角色交互矩阵：相遇记录、信息边界 |

### AIGC 检测

| 功能 | 说明 |
|------|------|
| AI 痕迹审计 | 纯规则检测（不走 LLM）：段落等长、套话密度、公式化转折、列表式结构，自动合并到审计结果 |
| AIGC 检测 API | 外部 API 集成（GPTZero / Originality / 自定义端点），`inkos detect` 命令 |
| 文风指纹学习 | 从参考文本提取 StyleProfile（句长、TTR、修辞特征），注入 Writer prompt |
| 反检测改写 | ReviserAgent `anti-detect` 模式，检测→改写→重检测循环 |
| 检测反馈闭环 | `detection_history.json` 记录每次检测/改写结果，`inkos detect --stats` 查看统计 |

```bash
inkos style analyze reference.txt         # 分析参考文本文风
inkos style import reference.txt 吞天魔帝  # 导入文风到书
inkos detect 吞天魔帝 --all               # 全书 AIGC 检测
inkos detect --stats                      # 检测统计
```

### Webhook + 智能调度

管线事件 POST JSON 到配置 URL（HMAC-SHA256 签名），支持事件过滤（`chapter-complete`、`audit-failed`、`pipeline-error` 等）。守护进程增加质量门控：审计失败自动重试（调高 temperature）、连续失败暂停书籍。

### 题材自定义

内置 5 个题材，每个题材带一套完整的创作规则：章节类型、禁忌清单、疲劳词、语言铁律、审计维度。

| 题材 | 自带规则 |
|------|----------|
| 玄幻 | 数值系统、战力体系、同质吞噬衰减公式、打脸/升级/收益兑现节奏 |
| 仙侠 | 修炼/悟道节奏、法宝体系、天道规则 |
| 都市 | 年代考据、商战/社交驱动、法律术语年代匹配、无数值系统 |
| 恐怖 | 氛围递进、恐惧层级、克制叙事、无战力审计 |
| 通用 | 最小化兜底 |

创建书时指定题材，对应规则自动生效：

```bash
inkos book create --title "吞天魔帝" --genre xuanhuan
```

题材规则可以查看、复制到项目中修改、或从零创建：

```bash
inkos genre list                      # 查看所有题材
inkos genre show xuanhuan             # 查看玄幻的完整规则
inkos genre copy xuanhuan             # 复制到项目中，随意改
inkos genre create wuxia --name 武侠   # 从零创建新题材
```

复制到项目后，增删禁忌、调整疲劳词、修改节奏规则、自定义语言铁律——改完下次写章自动生效。

每个题材有专属语言铁律（带 ✗→✓ 示例），写手和审计员同时执行：

- **玄幻**：✗ "火元从12缕增加到24缕" → ✓ "手臂比先前有力了，握拳时指骨发紧"
- **都市**：✗ "迅速分析了当前的债务状况" → ✓ "把那叠皱巴巴的白条翻了三遍"
- **恐怖**：✗ "感到一阵恐惧" → ✓ "后颈的汗毛一根根立起来"

### 单本书规则

每本书有独立的 `book_rules.md`，建筑师 agent 创建书时自动生成，也可以随时手改。写在这里的规则注入每一章的 prompt：

```yaml
protagonist:
  name: 林烬
  personalityLock: ["强势冷静", "能忍能杀", "有脑子不是疯狗"]
  behavioralConstraints: ["不圣母不留手", "对盟友有温度但不煽情"]
numericalSystemOverrides:
  hardCap: 840000000
  resourceTypes: ["微粒", "血脉浓度", "灵石"]
prohibitions:
  - 主角关键时刻心软
  - 无意义后宫暧昧拖剧情
  - 配角戏份喧宾夺主
fatigueWordsOverride: ["瞳孔骤缩", "不可置信"]   # 覆盖题材默认
```

主角人设锁定、数值上限、自定义禁令、疲劳词覆盖——每本书的规则独立调整，不影响题材模板。

### 33 维度审计

审计细化为 33 个维度，按题材自动启用对应的子集：

OOC检查、时间线、设定冲突、战力崩坏、数值检查、伏笔、节奏、文风、信息越界、词汇疲劳、利益链断裂、年代考据、配角降智、配角工具人化、爽点虚化、台词失真、流水账、知识库污染、视角一致性、段落等长、套话密度、公式化转折、列表式结构、支线停滞、弧线平坦、节奏单调、敏感词检查、正传事件冲突、未来信息泄露、世界规则跨书一致性、番外伏笔隔离、读者期待管理、大纲偏离检测

dim 20-23（AI 痕迹）+ dim 27（敏感词）由纯规则引擎检测，不消耗 LLM 调用。dim 28-31（番外维度）检测到 `parent_canon.md` 自动激活。dim 32（读者期待管理）、dim 33（大纲偏离检测）始终开启。

### 去 AI 味

5 条通用规则 + 每个题材的专属语言规则，控制 AI 标记词密度和叙述习惯：

- AI 标记词限频：仿佛/忽然/竟然/不禁/宛如/猛地，每 3000 字 ≤ 1 次
- 叙述者不替读者下结论，只写动作
- 禁止分析报告式语言（"核心动机""信息落差"不入正文）
- 同一意象渲染不超过两轮
- 方法论术语不入正文

词汇疲劳审计 + AI 痕迹审计（dim 20-23）双重检测。文风指纹注入进一步降低 AI 文本特征。

### 其他 v0.3 变更

- 支持 OpenAI + Anthropic 原生 + 所有 OpenAI 兼容接口
- 修订者支持 polish / rewrite / rework / anti-detect / spot-fix 五种模式
- 无数值系统的题材不生成资源账本
- 所有命令支持 `--json` 结构化输出，OpenClaw / 外部 Agent 可直接解析
- book-id 自动检测：项目只有一本书时省略 book-id
- `inkos update` 一键更新、`inkos init` 支持当前目录初始化
- API 错误附带中文诊断提示，`inkos doctor` 含 API 连通性测试
