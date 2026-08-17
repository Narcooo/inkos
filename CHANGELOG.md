# Changelog

[English](CHANGELOG.en.md) | 中文

## v1.8.0

### Release Focus

统一 Pi Agent Harness 与专业创作内核：Studio Chat、TUI、外部 Agent 和各类作品生产 worker 现在共享同一套 pi-agent 工具循环、结构化 action/result、Skill 绑定、检索与运行观测。Pipeline 保留为确定性生产能力，不再与 Agent 形成平行的自然语言决策系统。

### Agent Harness And Skills

- 新增统一 production harness，长篇、短篇、剧本、分镜、互动影游、Play 和翻译共用运行快照、观测、取消、恢复与原子提交语义
- 内置 15 个标准 `SKILL.md` 专业能力包，覆盖长篇写作 / 审稿、商业短篇、Play、剧本、分镜、互动影游、翻译、拆稿、市场研究、导入、封面和语义去 AI 味
- Production worker 在 pi-agent harness 内按作品类型绑定专用 Skill；复用 Skill 架构和执行底座，不把长篇提示词机械复用到其他作品类型
- Agent 调用轨迹新增标准化 run / tool / model 元数据，便于观测 kkaiapi 等模型调用、工具结果和真实完成状态

### Context, Retrieval, And Persistence

- 新增统一 SQLite FTS5 / BM25 本地检索内核，故事记忆、材料库和 Skill 参考资料共享可重建索引，原始文件继续作为权威来源
- 新增书籍参考资料绑定：材料可按用途绑定到具体书籍，在 Planner / Composer / Writer 等任务中按需检索相关段落
- 新增安全章节工作区和原子文件集提交；正文、状态、伏笔和运行快照校验通过后一起落盘，避免状态已消费但正文未保存
- 加强过期章节状态恢复、长篇上下文编排和 inactive stream 处理，减少旧状态、旧工具结果或无界等待污染当前生产

### Production And Workbench

- 多章写作作为一个后台任务顺序执行，保留取消、进度和失败恢复，不通过并发写入绕过单书锁
- Short、剧本、分镜、互动影游、Play 与翻译补齐统一 Skill、字数观测、状态快照和长输出完成策略
- Studio 新增安全章节重写工作区，展示候选文本、审稿问题与是否落盘；宽屏章节预览、外部母本导入和动态模型目录同步完善
- 新增 LM Studio 本地模型服务；支持持久化用户发现 / 添加的模型 ID、自定义封面 Base URL 和更可靠的流式首 Token / 空闲超时
- TUI 新增明确的 `/new`、`/short`、`/play`、`/cover`、`/write` 入口，结构化 `/confirm` / `/cancel`，会话级 `/model` 与终端明暗背景自适应；自由文本继续交给 Agent 理解
- 项目最低运行时提升到 Node.js 22，CI / Release 矩阵同步为 Node 22 / 24

## v1.7.2

### Release Focus

Agent Skills 兼容与单一 Skill 内核更新：InkOS 现在直接读取标准 `SKILL.md` 能力包，Chat Agent 可以根据用户意图自主调用，也可以由用户通过输入框 `+` 按钮或 `@skill-id` 强制启用。旧的 InkOS 私有 Skill 协议、关键词触发器和并行上下文规划器已被完整替换，不再叠加两套实现。

### Agent Skills

- 新增基于 pi-agent 工具循环的 `use_skill`：模型先读取可用 Skill 的名称与描述，再通过结构化工具调用激活所需专业能力
- Studio 支持导入包含 `SKILL.md` 的完整文件夹，静态参考资料会一并保存到项目 `.agents/skills/`；外部脚本不会被自动执行
- 支持项目 `skills/`、`.agents/skills/`，以及用户级 `~/.agents/skills/`、`~/.openclaw/skills/` 等标准位置
- 用户可在 Chat 输入区选择并强制启用 Skill；一次性意图激活不会永久污染后续会话或切换书籍后的上下文
- Studio 项目设置统一展示 Skill 来源，并支持删除项目导入的 Skill；删除后立即从 Agent 与选择列表中移除

### Compatibility

- 删除旧 `.inkos/skills` 私有加载路径，以及 `whenToUse`、`promptPacks`、`toolHints`、`contextNeeds` 等 InkOS 专用字段
- 提示词包继续由 Studio“项目设置 → 提示词”独立管理，不再伪装成 Skill 能力
- 旧 Skill 请迁移为标准目录：保留 `SKILL.md` 与静态参考资料，通过 Studio 重新导入或放入 `.agents/skills/`

## v1.7.1

### Release Focus

剧情多线推演与不中断的 Studio 协作更新：长篇作者可以在落笔前生成、横向比较并核验多条非正史未来分支；选择分支只保存候选计划，不改正文、大纲或正史。同时，写章等生产任务进入后台任务系统，用户可以继续聊天、刷新恢复进度、重试失败消息，并获得更可靠的任务与数据边界。

### Major Features

- 新增长篇剧情多线推演：基于当前正史生成 2-5 条隔离分支，比较未来章节节拍、人物决定、预计变化、风险、作者意图匹配度和不确定项
- Studio Chat 新增横向分支比较卡，可采用候选、重新核验过期推演；采用后只写入 `selected-branch-plan.md`，不会修改正文、设定、大纲或运行时正史
- CLI 新增 `inkos forecast create / show / select`，与 Core 的推演 schema、存储、上下文指纹、agent 和 runner 共用同一套非正史边界
- 新增整书备份 / 恢复与最新章节安全删除；删除章节时同步回滚章节状态，避免正文和运行时状态错位

### Collaboration And Task Reliability

- `write_next` 接入 Studio 后台任务系统；生产任务运行时仍可继续对话，不再用一个长请求占住整个 Chat
- 任务进度按 execution id 归属并持久化，刷新后可恢复正确任务卡；终态快照不会提前关闭仍在流式输出的聊天
- 新增失败消息重试、会话删除时中止对应生产任务、服务重启后清理僵尸任务快照等恢复路径
- 单任务槽改为原子预留；生产期间阻止冲突的书籍写操作，同时允许只读工具和剧情推演继续工作
- 修复直接调用终态工具后，刷新会话可能丢失工具卡的问题；完成态继续以真实 tool result 为准

### Data Safety And Compatibility

- 章节局部修改会同步维护章节索引字数，避免正文已变而统计仍停留在旧值
- 修复短篇确认与 runner 的长度校验不一致，并让短篇输出语言服从用户本轮要求
- 修复切换或回放任务快照时复活旧 Play 选项、删除会话后继续追加 transcript 等边界问题
- 更新 Xiaomi MiMo API 端点，并改进 Studio 事件归类，避免无 task id 或会话压缩事件污染后台任务卡

## v1.7.0

### Release Focus

多语言创作与长任务可靠性大版本：新增完整的长文翻译 / 本地化工作流，并把英文能力扩展到短篇、剧本、分镜、互动影游、Studio 与 CLI。与此同时，Chat 导入已有小说、可配置审稿修订、写锁自动恢复和中断信号传递，让长篇协作与跨平台运行更稳定。

### Major Features

- 新增翻译 / 本地化工作流：支持导入 EPUB、文本型 PDF、TXT 和 Markdown，按章节与语义段翻译，维护术语表并执行章节审校，可导出 TXT、Markdown 或 EPUB
- Studio 新增翻译工作台：可使用自然语言填写任意源语言 / 目标语言，创建项目、运行翻译、在网页内对照查看原文与译文、阅读审校报告并导出完整文件
- CLI 新增 `inkos translate init / run / export`；Studio Chat 也可通过确认动作创建翻译项目，不要求用户记忆 `zh`、`en` 等语言缩写
- 短篇、剧本、分镜和互动影游管线新增英文提示词分支；Studio 动态界面与 CLI 环境语言回退同步补齐，英文不再只是外层 UI 翻译
- Chat 新增 `import_chapters` 工具：可把本地文件 / 目录及对话附件中的已有小说导入为真实章节，自动逆向生成设定并重放章节状态；与只保存参考资料的 `ingest_material` 明确分工（#324）

### Collaboration And Control

- 修订判断标准新增 `writing.revisionGate`：支持 strict、lenient、always 三档，并可按项目或单本书覆盖；未落盘时返回前后审稿指标和具体剩余问题（#326）
- CLI 遵守单本书的 `writing.reviewMode`；新增 `inkos auto [book-id] <目标章号>` 连续写作到指定章节（#307）
- 通知渠道支持纯文本格式；`write next / write rewrite / auto / revise / audit` 支持通过 `--notify` 发送完成或失败通知（#308）
- Studio 可默认展开操作详情，read / grep 等工具结果也能直接查看，降低“做了但看不到结果”的不透明感（#306）

### Reliability And Compatibility

- 写锁升级为带所有权、心跳和租约的跨进程锁：同进程遗留锁、进程已退出的锁和过期锁会自动恢复；活跃冲突返回 `BOOK_BUSY`，不再要求用户手工删除 `.write.lock`（#337）
- Studio 中止操作会沿 pi-agent、写作管线和模型请求向下传播，避免界面已停止但后台仍继续写盘
- OpenRouter、NewAPI、kkaiapi、PPIO、硅基流动等动态模型服务不再用静态白名单拦截用户模型；OpenRouter 探测改用长期存在的 `openrouter/auto`（#300）
- MiniMax 默认启用 reasoning 分离，并统一剥离响应开头完整的 think 块，避免思考内容混入章节或聊天正文（#329）
- 上传附件和翻译源文件统一返回 POSIX 项目相对路径，修复 Windows 与其他平台之间的路径不一致

## v1.6.3

### Hotfix

- 修复 `@actalk/inkos@1.6.2` / `@actalk/inkos-studio@1.6.2` 发布到 npm 时 registry manifest 泄漏 `workspace:*` 的问题；Windows / npm 全局升级请直接安装 `1.6.3` 或更新到 `latest`
- 发布校验现在会拒绝 publishable manifest 中的 `workspace:` 依赖，避免同类安装错误复发
- MiniMax 官方 OpenAI-compatible 接入新增 `MiniMax-M3` 模型卡，并对 `MiniMax-M3*` 默认发送 `thinking: { "type": "disabled" }`，减少接口默认返回 thinking 内容的问题

## v1.6.2

### Release Focus

Chat 协作与可调提示词热更新：在 v1.6.0 的互动影游 / Skill 系统基础上，补齐用户上传文件、图片附件、长任务中断、材料归档检索和 Studio 提示词包编辑。核心目标是让 Chat 更像真实创作工作台：能看用户给的材料，能停下长任务，能把外部资料沉淀为可检索参考，也能让用户直接调整关键提示词。

### Improvements

- Studio Chat 支持上传文本 / Markdown / 图片附件；文本材料会进入 LLM 上下文，图片会作为多模态输入传给支持视觉的模型
- 新增长任务中断能力，用户可在 Chat 中主动停止当前 agent turn，避免长任务卡死后只能刷新
- 新增材料归档与检索工具：外部材料可保存到项目材料库，并在后续写作 / 讨论中用 evidence trace 检索引用
- 新增 Studio 提示词包编辑器：在“项目设置 → 提示词”集中查看和调整 longform、Play、互动影游等内置 prompt pack；修改保存为项目级覆盖文件，不改内置默认值
- Runtime Skill 可继续提供 prompt pack、上下文需求和专业规则；提示词包编辑器让这些规则能被人直接检查和微调
- 修复 Studio Chat 旧章修订时丢失本轮对话要求的问题：`sub_agent(reviser)` 现在会把用户本轮“重写 / 重修 / 调整方向”的话作为一次性修订 brief 传入长篇管线
- 修订未落盘时返回更具体的判定信息：展示修订前后 blocking / critical / AI-tell 指标、应用标准和剩余问题，不再只返回笼统的 “kept original chapter”
- 调整疑似章节正文未落盘兜底：不再默认引导“写下一章”，并避免把“第 N 章修改指令 / 重写方案”误判成正文

### Verification Notes

- 真实模型验收：`kkaiapi / deepseek-v4-flash` 能在回答中返回上传 Markdown 的唯一暗号，证明文档内容进入 LLM 上下文
- 真实模型验收：`kkaiapi / gpt-5.5` 能识别上传 PNG 的主体颜色，证明图片附件进入多模态输入链路

## v1.6.0

### Release Focus

互动影游与 Skill 系统大版本：把 InkOS 的创作入口从“小说 + Play”继续扩展到互动影游、剧本、分镜和可插拔专业能力。Studio Chat 现在可以按用户意图调用外部 / 内置 skills，也能在需要真实资料时生成可追溯研究报告，同时修复几类影响长任务继续推进和用户协作编辑的稳定性问题。

### Major Features

- 新增互动影游创作与工作台能力：支持分支剧情、变量 / 旗标、角色关系、结局、节点图片和可导出的交互项目包
- 新增 runtime Skill 系统：内置 / 外部 skill 可被自动匹配或用户强制指定，用于给 Chat / 创作入口注入专业规则、提示词包和上下文需求
- 新增联网研究工具 `research_web`：可用于世界观、年代、职业、地域、市场和事实核查，输出带 sources / queryLog / unknowns / confidence 的 Markdown 参考报告
- Studio Skill UI 支持选择、强制使用和添加外部 skill，让专业能力不再只能写死在系统提示词里
- 剧本、分镜、互动影游入口与 Chat action surface 对齐，重动作继续走确认卡，生成结果可在 Studio 内查看和导出

### Reliability And Fixes

- 修复 `patch_chapter_text` 只能精确命中文本的问题；现在轻微改写的目标段落可用高置信段落定位兜底，仍无法确认时继续明确失败，避免误改
- 修复审计 / 多章操作失败时可能把 `chapters/index.json` 写成空数组的问题；保存层会从磁盘章节文件重建索引，防止已有章节在 UI 中消失
- 修复多渠道同模型切换后会话丢失 bookId 的回归风险，并补充测试锁定 session-bound bookId 传递
- 研究报告保存为 `.inkos/research/` 下的参考材料，不直接污染 story truth、角色卡或正文

## v1.5.0

### Release Focus

InkOS Play 与创作工作台大版本：把 InkOS 从“自动写下一章”的管线工具推进到更完整的 Story Creation AI Agent。长篇、短篇、同人、番外、仿写、续写、封面和开放世界互动开始共享同一套 Studio Chat / CLI / TUI 交互内核，并围绕指令遵循、上下文管理和可视化体验做了系统性整理。

### Major Features

- 新增 **InkOS Play** 开放世界 / 分支互动入口：支持自由动作、可点击选择、世界契约、非固定时间推进、角色 agent、物品 / 证据 / 关系状态、HUD 和自动配图
- Studio 创作入口重组为一等入口：长篇小说、短篇小说、同人创作、番外创作、仿写创作、续写创作、分支互动、开放世界都可从工作台直接启动
- Play 世界状态可视化升级：侧边 HUD 展示世界时间、当前位置、面对对象、持有物、关系和配图；生成图进入对话流，可滚动回看
- 新增 / 完善番外、仿写、续写等创作链路，让已有 IP、设定和文风可以继续派生新内容
- Studio Chat、TUI 和 CLI 统一到 action surface：普通讨论、确认建书、短篇、封面、Play、长篇写章和重写续写不再依赖散落关键词抢跑

### Context And Reliability

- 长篇上下文进入 protected / compressible 分层：作者意图、当前焦点、活跃伏笔等高优先级内容不被静默压掉，旧历史和低相关背景只在超限时做语义压缩
- Composer 增加 outline 段级选择，避免整本设定文件直接撑爆上下文窗口
- 会话恢复改为摘要 + 最近对话，降低旧工具结果和历史消息淹没当前指令的问题
- provider / Studio 主 Chat 出网边界补齐上下文窗口守卫，超限时明确报错而不是等上游 400
- 弱模型格式鲁棒性增强：Planner / Architect 的模型输出协议从脆弱 YAML 前置转向更宽容的 Markdown / 宿主抽取，减少 MiniMax 等模型因格式偏差直接中断
- 审稿、修订和失败态更倾向于暴露真实问题，不再把模型口头声明当成完成结果

### Studio UX

- Studio 左侧导航、Play 对话区、查看世界面板、配图按钮、生成物预览和字体尺寸做了整体整理
- Play 配图支持角色、物品、证据、时刻等对象，图像显示在对话上下文里，不再只作为固定面板预览
- 模型配置、封面服务、聚合 API 入口和错误提示进一步区分：InkOS 执行错误、模型供应商错误和图片生成错误不再混在一起
- README 和 Skill 文档同步更新为 Story Creation AI Agent 定位，并展示 v1.5.0 Studio Play 实测截图

### Bug Fixes

- 修复 TUI / Studio / Chat 多处自然语言入口各自解释用户意图导致的执行不一致问题
- 修复建书不完整时可能被下游当作成功创建的问题，完成态以真实产物和工具结果为准
- 修复 Play HUD 持有物、关系边、状态值本地化、图片展示和选择按钮重复显示等问题
- 修复长篇 writer / reviewer / reviser 在格式解析失败时可能把解析错误误当成正文问题继续改稿的问题
- 修复多个 UI 截图、README 架构图、Kimi 合作展示和 1.5.0 发布图在 GitHub README 中渲染错位的问题

## v1.4.1

### Release Focus

Windows / provider 热修与长篇写作提速配置化：修复 MiniMax 默认端点不通的问题，保留长篇默认一轮自动修稿的速度收益，同时允许项目把自动修稿轮数配置回 3。

### Improvements

- 长篇章节写作的自动审稿修稿轮数新增 `writing.reviewRetries` 项目配置，默认仍为 1；需要更强修稿时可执行 `inkos config set writing.reviewRetries 3`
- Studio 写章链路会读取同一项目配置，CLI 和 Studio 行为保持一致
- README / 开发说明同步 v1.4.1 的 MiniMax 与长篇写作配置变化

### Bug Fixes

- 修复 MiniMax 默认 provider 仍指向已不可用的 Anthropic 端点，导致 Windows 原生环境测试连接失败的问题
- 修复 MiniMax endpoint 元数据覆盖逻辑过宽，可能影响其他服务商路由判断的问题

## v1.4.0

### Release Focus

短篇写作与 Studio Chat 协作大版本：新增公开短篇生产链路、封面制作工具、普通聊天持久化会话和生成物预览，并修复长篇长度归一化可能被输出上限截断的问题。

### Improvements

- 新增独立短篇写作链路：Studio Chat 和 CLI 可生成完整短篇正文、大纲记录、审稿记录、简介卖点和封面提示词
- 新增封面制作能力：支持单独生成 / 重做封面，并在 Studio 消息中直接预览生成后的封面图
- Studio 普通聊天支持项目级持久化 session，刷新或重启后可继续查看、切换、改名和删除会话
- Chat 可直接编辑项目内生成文本产物，适合调整章节、封面提示词、简介等文件后再继续使用 InkOS 写作链路
- 服务配置页新增封面生成配置区，封面文本模型和图片模型分工更清晰

### Bug Fixes

- 修复短篇 / 封面工具执行结果中的图片路径只显示文本、不渲染预览的问题
- 修复 Studio 工具调用详情在消息恢复后丢失的问题
- 修复 `LengthNormalizerAgent` 显式设置 `maxTokens` 可能导致长章节压缩 / 扩写输出被截断的问题

## v1.3.12

### Release Focus

Studio 服务配置体验小版本：把聚合服务入口放到更顺手的位置，补充官网 / 文档 / 模型页快捷访问，并把服务分组文案统一为“聚合 API”。

### Improvements

- Studio 服务列表和服务详情页为重点聚合服务补充外部快捷入口，配置前可直接打开官网、文档和模型列表
- 聚合服务分组标题统一为“聚合 API”，避免误导性表达

## v1.3.11

### Release Focus

Studio 服务与聚合模型接入更新：新增 kkaiapi 服务选项，修复自定义/本地 OpenAI-compatible 服务测试误用兜底模型、API Key 中文字符导致连接崩溃、服务配置删除缺失等问题，并补齐雷达历史、题材管理刷新和长篇多线比例落地。

### Improvements

- 新增 kkaiapi 聚合模型服务选项，Studio / CLI 服务配置可以直接选择并测试
- Studio 新建书籍改走共享对话交互内核，避免建书入口和真实创作链路行为分叉
- 雷达扫描结果持久化为历史记录，Studio 可浏览既有 scan 结果
- 长篇大纲 / 章纲会更明确承接用户设定的多线比例，减少“比例写了但结构里没体现”的情况

### Bug Fixes

- 修复自定义服务连接测试误用全局兜底模型或错误协议，导致 llama.cpp / 本地 OpenAI-compatible 服务被误判不可用的问题
- 修复 API Key 或请求头含中文等非 ASCII 字符时触发 ByteString 转换异常的问题
- 修复 Studio 缺少删除自定义服务 / 模型配置入口的问题
- 修复题材管理保存后文件已生成但 Studio 列表不刷新的问题
- 修复 `hooks.json` 里 hook id 可能出现重复横线或异常标点的问题

## v1.3.10

### Release Focus

建书 platform 热修：修复 `sub_agent.platform` 参数在网页和命令行建书时可能因中文/别名输入触发 schema 校验失败的问题，并把新书创建链路统一收口到合法平台值。

### Bug Fixes

- 修复建书过程中工具调用报 `Validation failed for tool "sub_agent": - platform: must be equal to constant`，导致无法生成书籍文件的问题
- 统一 Studio、CLI、TUI、agent create-book 链路的平台别名归一化，`番茄` / `fanqie` / `番茄小说` 等输入会落到合法枚举
- 对未知平台值降级为 `other`，避免错误平台 id 写入书籍配置后继续影响后续流程
- 更新 README 微信交流群二维码为 13 群

## v1.3.9

### Release Focus

Studio 建书与书籍设置热修：修复新建书籍链路被已有书籍 session 劫持的问题，并恢复可见的书籍设置页入口。

### Bug Fixes

- 修复 Studio 新建书籍 `/new`、`/create` 没有绑定独立 orphan session，导致建书请求可能被当前书籍工作台 session 接管的问题
- 修复建书完成后无法可靠跳转到新书 Chat 工作台的问题
- 恢复书籍设置页路由：`#/book/:id` 继续作为 Chat 工作台，`#/book/:id/settings` 用于修改书籍配置
- 修复 Dashboard 书籍菜单里的“书籍设置”实际打开 Chat 工作台的问题

## v1.3.8

### Release Focus

本地模型热修：修复 1.3.7 后 Ollama / 本地 OpenAI-compatible 端点在建书与续写链路里的配置回归，确保 Studio 与 CLI 都能继续使用无 API key 的本地模型。

### Bug Fixes

- 修复 Studio 服务测试、模型列表与建书链路强制要求 API key，导致 Ollama / 本地端点不可用的问题
- 修复 Studio 新建书籍页面实际 `/agent` 建书路径没有正确传递空 key 本地模型 client 的问题
- 修复 CLI / Studio 使用 Ollama 动态模型名时被内置模型表误拦的问题
- 修复 `write next --context` 没有真正进入章节规划和正文写作提示词的问题

## v1.3.7

### Release Focus

长篇写作质量收紧：把近期验证过的网文写法规则落到 Writer、Planner、Architect 与后置校验中，重点改善开篇抓人、章节密度、伏笔兑现、段落节奏和架构稿完整性。

### Improvements

- **网文写作规则入链路**：Writer prompt 新增看点密度、移动端段落、开篇第一屏、章节断章和人物行动动机等写作约束，让模型更少写空转铺垫和报告式正文
- **Planner / Architect 对齐写作目标**：章节规划和书籍架构稿更明确地承接黄金开篇、章节目标、hook 账和段落式 foundation 输出要求
- **Hook 兑现更具体**：hook ledger 要求 advance / resolve 项在正文里有可定位的动作、物件、对话或事件兑现，减少“账本里有、正文里没有”的断层
- **段落密度规则收紧**：强调密度来自语义和场景推进，不是把正文切成电报体；连续短段会被后置规则识别

### Bug Fixes

- 修复 Architect 在扩展输出时可能漏掉 5 个 foundation SECTION 块的问题
- 修复 hook ledger payoff 检查过于宽松，导致侧面暗示也可能被误判为兑现的问题
- 修复写作 prompt 对段落尺寸描述不够明确，模型容易在“1-3 点密度”规则下过度碎段的问题

## v1.3.6

### Release Focus

v13 书籍创建流程迁移：建书输出升级为段落式架构稿、卷级地图与一人一卡角色目录，并补齐旧书升级路径。

### Improvements

- **段落式架构稿**：Architect 生成 `outline/story_frame.md`、`outline/volume_map.md` 与 `roles/` 角色卡，保留 legacy shim 兼容旧读取路径
- **旧书升级路径**：agent architect 支持 `revise=true`，可把旧条目式架构稿转换为 Phase 5 布局；升级前会备份原架构稿，升级时不重置运行时状态文件
- **真相文件注入**：Agent 会把当前书籍 truth files 注入上下文；旧布局书会提示可升级到段落式架构稿
- **基础设定输出预算修复**：分离 `maxTokens` fallback 与 `maxTokensCap` 硬上限，避免 Architect 大输出被默认配置误裁
- **README 统计**：补充 Skills Download History 图表，并同步中文、英文、日文 README

### Bug Fixes

- 修复 Phase 5 二次升级时读取 shim 导致信息丢失的问题
- 修复 reviseFoundation 会重置 `current_state` / `pending_hooks` / runtime logs 的问题
- 修复角色改名或删除后旧 role 卡残留的问题

## v1.3.5

### Improvements

- **Session / Sidebar 体验重构**：Studio 引入 per-session runtime，`pendingBookArgs` 下沉到 session 级，session SSE 监听从 `App.tsx` 抽离；sidebar 支持按书折叠、草稿会话延迟展示、会话列表不再点击重排
- **会话标题简化**：不再走 LLM 生成标题；第一条用户消息直接成为 session title，并对历史 session 做 lazy migration
- **Draft Session 工作流**：新建会话延迟到第一条消息才持久化，未发送消息的草稿会话不会落盘，也不会在侧边栏出现
- **Session 列表性能提升**：`listBookSessions` 改为并发读取并返回轻量 summary，避免侧边栏一次读取大量完整 session 文件

### Bug Fixes

- **模型列表缓存修复**：`/services/:service/models` 的缓存 key 现在包含 `resolvedBaseUrl`，custom 服务切换端点后不再错误复用旧模型列表
- **会话删除确认弹窗定位**：`ConfirmDialog` 改走 portal，避免被 sidebar 的 containing block 锁在侧栏内
- **测试清理**：移除 `server.test.ts` 里已废弃的 `updateSessionTitle` mock 残留

## v1.3.4

### Bug Fixes

- **依赖版本钉死**：固定 `@mariozechner/pi-ai` / `pi-agent-core` 到 `0.67.1`，降低 npm 镜像滞后导致全局安装失败的概率
- **服务探测与模型列表提速**：`GET /models` 回到快路径，`knownModels` 服务不再走慢 probe；`/models` 不可用时会返回服务自己的 `knownModels`
- **服务验证更可靠**：`/models` 返回 `401/403` 时直接短路；服务详情页保存前先走 `/test` 验 key，页面加载时也会用 `/test` 校验真实连接状态
- **完整模型列表返回**：服务测试接口不再默认裁成 50 个模型

### Improvements

- **agent 通用文件工具面恢复**：`edit` 回归正常工具面，并新增 `write` 工具用于创建/覆盖写文件，路径仍限制在 `books/` 下
- **`sub_agent` 最小控制面扩展**：新增 `writer.chapterWordCount`、`reviser.mode`、`exporter.format`、`exporter.approvedOnly`
- **修订入口统一**：book-mode 下整章修订收敛到 `sub_agent(reviser)`，减少模型在 `revise_chapter` 与 `sub_agent` 之间摇摆

## v1.3.3

### Bug Fixes

- **聊天建书标题显式化**：agent 建书现在要求显式传入 `title`，`initBook` / `book.json` 直接吃结构化标题，不再允许空标题初始化
- **真实 EPUB 导出统一**：CLI、Studio 下载、共享交互层与 agent exporter 统一复用同一套真实 EPUB 实现，不再出现一条真 EPUB、一条假 HTML、一条未实现的分裂状态
- **高风险写作动作收口**：book-mode agent 对改设定、改名、局部修文、章节重写/精修优先使用 deterministic 工具，不再默认退回脆弱的通用 `edit`

### Improvements

- **TUI 普通聊天对齐 agent/session**：TUI 的普通输入改走本地 agent session 形式，保留少量本地控制命令 fast-path，进一步向 Studio 的交互模型靠拢
- **写作控制面更清晰**：agent prompt 明确区分重操作子代理与高风险 deterministic 写作工具，减少“模型理解了，但工具接不住”这类断层

## v1.3.2

### Bug Fixes

- **恢复 `architect` foundation 输出预算**：重新固定 `maxTokens: 16384`，降低本地模型与 LM Studio 在建书阶段因输出截断导致 foundation 缺段的概率
- **恢复旧的 OpenAI-compatible 兼容路径**：`provider=openai + 自定义兼容 baseUrl` 不再被错误送入更激进的 `custom fetch` 路径，Google/Gemma 一类旧兼容场景回归
- **自定义 Anthropic-compatible 原生 transport**：`service=custom` 且 `provider=anthropic` 也改走原生请求链，不再强绑 SDK
- **Windows Studio 启动修复**：`inkos studio` 在 Windows 下不再因绝对路径 loader 被当成非法 ESM URL 而崩溃
- **Bootstrap 项目回退到 env 配置**：空目录 auto-init 后的 Studio 项目，在未配置服务时会回退到全局 `.inkos/.env`，`book create` 不再先死在缺 key
- **统一服务路由真相**：`config-loader`、`service-resolver`、Studio 服务探测、`doctor` 统一从同一份 `service-presets` 读取 provider/api/chatBaseUrl/modelsBaseUrl，减少同一服务在不同链路上各猜一遍的问题

### 改进

- **空目录直接启动**：`inkos` / `inkos studio` 现在会自动初始化最小项目骨架并启动 Studio，不再要求显式先跑 `init`
- **Studio 自动探测 transport**：服务测试会自动尝试候选模型、`chat/responses` 与流式开关组合，尽量自动匹配可用配置
- **`doctor` 增强**：不再只死盯当前单一模型/单一组合，支持多 model、多协议、多流式探测
- **建书聊天 fresh session**：再次进入“创建书籍”时会清空旧对话，不再沿用上一次建书聊天记录
- **聊天模型选择器搜索**：Studio model picker 支持搜索过滤
- **侧栏刷新更克制**：读操作不再触发无意义 sidebar 刷新，只在写操作后刷新
- **服务保存流程更真实**：保存 API Key 后会走真实 `/test` 探测，而不是只靠 `/models`

## v1.3.1

### Bug Fixes

- **MiniMax baseUrl 修正**：从 `api.minimax.chat` 更正为 `api.minimaxi.com`（当前 OpenAI 兼容端点）
- **多服务 baseUrl 隔离**：agent 对话中选择非默认服务时，不再泄漏默认服务的 baseUrl（如 moonshot URL 被错误用于 minimax 请求）
- **resolveServiceModel 始终使用 preset**：不再直接使用 pi-ai 内置 model 对象（可能指向国际端点或错误的 API 格式），始终用 preset 的 baseUrl 和 api 格式构造 model
- **agent 建书后侧边栏刷新**：通过 agent 对话建书后，侧边栏书籍列表自动刷新（之前只有 POST /books/create 才广播 `book:created`）
- **`pnpm dev` 并行启动**：加 `--parallel`，解决 core tsc --watch 阻塞 studio 启动的问题

### 改进

- **MiniMax knownModels**：MiniMax 不支持 `GET /models`，改为硬编码 7 个模型（M2.7/M2.5/M2.1 及其 highspeed 版本 + M2）
- **测试连接不再发消息**：移除 chat completion 测试，只通过 `/models` + fallback 验证，秒回
- **custom 服务 URL 自动补 /v1**：`https://example.com`、`https://example.com/`、`https://example.com/v1` 三种写法等价
- **agent 系统提示词**：禁止 emoji、结构化内容用列表/表格、章节索引管理指引

### 测试

- 新增回归测试：service-presets（MiniMax baseUrl + knownModels）、service-resolver（preset 覆盖 pi-ai）、normalizeBaseUrl

## v1.3.0

### Release Focus

Studio 2.0 正式发布。`inkos` 现在默认直接启动 Studio，本地 Web 工作台成为主入口；TUI 保留为 `inkos tui`。

### 新功能

- **Studio 2.0 默认入口**：`inkos` 直接启动 Studio，首页、服务商管理、写作工作台统一为新的主交互入口
- **自定义 OpenAI-compatible 服务**：Studio 现支持自定义 `baseUrl`、协议类型（`chat` / `responses`）与流式开关，兼容更多中转站和聚合网关
- **配置来源切换**：Studio 新增 `.env` 与 Studio 配置的显式切换，不再只能被目录里的 `INKOS_LLM_*` 被动覆盖
- **原生 custom transport**：对 `custom` 服务新增原生 fetch 请求链，减少对 SDK 路径的单点依赖，提升兼容性

### 改进

- **服务测试更真实**：服务页测试不再只测 `/models`，还会执行最小生成探测，避免“测试连接通过但聊天失败”的假阳性
- **服务保存流程优化**：保存成功后自动返回服务商管理页，顶部首页和返回入口更醒目
- **密钥回填**：服务详情页会重新加载已保存的 key，避免重新打开后误以为 key 丢失
- **错误可见性增强**：Studio 聊天不再用 `Acknowledged.` 掩盖空回复，会直接显示真实上游错误

### Bug Fixes

- 修复 `llm.services + defaultModel + secrets` 与运行时加载契约不一致的问题
- 修复 `custom:*` 服务在测试连接、模型列表与 `/api/v1/agent` 之间链路不一致的问题
- 修复 `inkos` 启动 Studio 时因未设置默认模型而直接抛出 `llm.model` 校验错误
- 修复自定义服务非流式 / SSE 返回被误当作普通 JSON 解析的问题

## v1.2.0

### Release Focus

统一交互内核——TUI、Studio、`inkos interact`、OpenClaw Skill 共享同一套自然语言理解和执行运行时。

### 新功能

- **共享交互运行时**（`packages/core/src/interaction/`）：自然语言路由器（15+ intent）、会话管理、编辑事务控制器、事件追踪、阶段遥测
- **Ink TUI 仪表盘**：`inkos` 直接进入全屏 Ink + React 仪表盘，对话式创作，slash 命令 Tab 补全，主题动效（writing/auditing/revising/planning 各有独立动画），i18n 中英双语
- **Studio 助手面板**：右侧 AI 助手接入共享交互内核，自然语言操作书籍（写章、改名、审计、导出），SSE 实时状态推送，执行阶段图标
- **对话式建书**：通过 Studio 助手自然语言对话逐步构思书籍概念、设定、目标章数，草稿就绪后一键创建
- **全书实体改名**：`把林烬改成张三` / `/rename 林烬 => 张三`，全量扫描章节 + 真相文件一次替换
- **单章文本替换**：`/replace 5 旧文本 => 新文本`，精确修补指定章节
- **`inkos interact --json`**：共享交互 JSON 入口，返回 request / response / session / events，供 OpenClaw 和外部 Agent 直接调用
- **Thinking 模型温度夹制**（PR #174）：kimi-k2.5 等 thinking 模型自动 temperature=1，兼容 per-call 温度调参，每模型只 warn 一次

### 改进

- Studio ChatBar 去重：`executeCommand()` 提取公共逻辑，消除 handleSubmit/handleQuickCommand 80 行重复
- Studio ChatBar SSE effect 用 `loadingRef` 替代 stale closure
- Studio 下拉菜单 z-index 修复：移除 paper-sheet 的 transform（消除 stacking context），菜单打开时 card 提升 z-50
- Studio agent 响应修复：使用 `result.responseText` 而非 `session.messages.at(-1)`
- TUI 主题扩展：语义色（成功/错误/活跃/空闲）+ 角色色（用户/助手/系统）
- TUI 状态徽标：✓ 完成 / ✗ 失败 / ✎ 写作 / ◇ 规划 / ◈ 等待决策
- TUI i18n 修复：`stageLabels` 移入 TuiCopy，消除 hardcoded 状态字符串
- Studio 死代码清理（PR #176）：移除未使用的 shadcn 组件、`dotenv`、`shadcn`、`tw-animate-css`、`class-variance-authority`，-2800 行

### Bug Fixes

- Studio ChatBar 助手回复丢失：session 历史覆盖导致 response 被静默丢弃
- Studio BookMenu 下拉被下层 card 遮挡：fadeIn 动画的 transform 创建 stacking context
- Studio GenreManager 用 `window.confirm` 替换为 `ConfirmDialog`
- Studio BookDetail Nav `toTruth` 类型断言 hack 修复
- Studio ChapterReader/Dashboard approve/reject 缺失错误处理
- ChatBar curly quote 编码导致 esbuild 解析失败

---

## v1.1.1

### Release Focus

- 回退到稳定的 `v6 + bugfix` 主线，替换掉不稳定的 `v8` 最新版本

### Bug Fixes

- **#151** — Architect section 解析支持 `book-rules` / `Book Rules` / 全角冒号等标题漂移，不再因 `book_rules` 区块轻微变形而创建失败
- **#152** — State validator 改为 fail-closed：空响应直接报错，并恢复多行 JSON 平衡提取，避免 `passed` 字段丢失时被误判
- **#154** — 后写规则增加正文章节号指称检测，拦截 `第33章` / `Chapter 33` 一类叙述
- **#155** — `repair-state` 支持对最新 `state-degraded` 章节进行同章重算，不再报 `delta chapter N goes backwards`

### Improvements

- `ai-tells` / `sensitive-words` 增加中英双语规则路径，英文书修订链不再混入中文 issue
- import / continuation / series 的 prompt 与语言传递补齐，foundation reviewer 结果能更稳定回灌
- reviser 修订链重新接入 `hookDebtBlock`，局部修订时能看到 hook 债务证据

---

## v1.1.0

写作管线全面升级。通过 Meta-Harness 方法论驱动的多轮 autoresearch 实验，从零模式质量从 75 分提升至 92 分，同人模式从 39 分提升至 82+ 分。

### 新功能

- **Foundation Reviewer**：建书时新增独立审核 Agent，5 维度百分制打分（原作 DNA 保留、新叙事空间、核心冲突、开篇节奏、节奏可行性），不达 80 分自动驳回并将审核意见反馈给 Architect 重新生成
- **新时空要求**：同人模式（canon/au/ooc/cp）必须设计原创分岔点，不允许复述原作剧情
- **Hook Seed Excerpt**：伏笔回收时，Composer 从 chapter_summaries 提取原始种子场景的原文片段注入 Writer 上下文，替代了复杂的 lifecycle pressure 系统
- **Review Reject 回滚**：`inkos review reject` 回滚 state 到被拒章节之前的快照，丢弃下游章节和记忆索引
- **State Validation Recovery**：state 校验失败自动重试 settler，仍失败则降级保存，支持 `inkos write repair-state` 手动修复
- **Audit Drift 隔离**：审计纠偏写入独立的 `audit_drift.md`，不再追加到 `current_state.md`
- **标题坍缩修复**：检测近期标题主题聚集，从正文提取新关键词重生标题
- **Hook 预算提示**：活跃伏笔 ≥10 时显示预算警告，引导优先回收旧债
- **章节结尾摘要**：提取最近 3 章结尾句注入上下文，防止结构性重复
- **情绪/节奏检测**：mood 单调和标题聚集检测，序列级 warning 不计入修订 blockingCount
- **同人风格提取**：`fanfic init` 和 `import chapters` 自动生成 style_guide.md + style_profile.json
- **Governed 路径补全**：续写/同人的 parent_canon.md 和 fanfic_canon.md 通过 Governed 路径注入 Writer
- **自定义 HTTP Headers**：`INKOS_LLM_HEADERS` 环境变量注入自定义 HTTP 头

### Bug Fixes

- 章节号污染修复：叙事文本中的数字不再被误解析为章节进度
- hook 排序修复：mustAdvance 从降序修正为升序（选最久未推进的）
- Outline 匹配修复：支持章节范围格式，防止 Chapter 1 误匹配 Chapter 10
- approve 不覆盖快照、style 提取 graceful degrade、Studio 热加载 LLM 配置、主题持久化

---

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
