# Render Event Log / 渲染事件日志 Schema v0.4

## 1. 用途

`Render Event Log` 用于描述目标章节中：

- 发生什么；
- 按什么顺序发生；
- 每个事件进入时必须满足什么状态；
- 每个事件必须渲染哪些动作、对白、物件、信息或情绪变化；
- 每个事件禁止出现哪些漂移、压缩、越权、泄密或错误解决；
- 每个事件如何自然衔接到下一个事件；
- 每个事件引用哪些 Entity Cards、World Mechanics 和 Author Fingerprint 约束；
- 后续 Auditor 应该检查什么。

它是给 Renderer 使用的 **事件级渲染蓝图**。


本文件不是 Entity Cards。
本文件不是 Worldbuilding / World Mechanics。
本文件不是 Author Fingerprint。


---

## 2. 通用性原则

Schema 必须保持项目无关。

本文件中不得包含：

- 具体书名；
- 具体角色名；
- 具体章节剧情；
- 具体项目路径；
- 某次 benchmark 的答案；
- 某个目标章真实正文内容；
- 某个测试实例中的专有术语；
- 真实续写时不该提前知道的信息。

允许出现：

- 占位符；
- 泛化示例；
- 字段定义；
- 校验规则；
- 类型枚举；
- 通用模板；
- 不绑定具体作品的说明。

具体项目内容必须放入 instance 文件，而不是 schema 文件。

推荐区分：

```text
render_event_log_schema.md
  -> 通用 schema，只定义结构和规则

render_event_log_<target_chapter>_planned.md
  -> 某目标章节的真实续写事件日志 instance

render_event_log_<target_chapter>_benchmark_reference.md
  -> benchmark / 回放测试 instance，不用于真实续写

render_event_log_schema_test_report_<target_chapter>.md
  -> schema fit 测试报告
```

---

## 3. 真实续写原则

真实续写场景中，Render Event Log 不应依赖：

- 目标章节真实正文；
- 目标章节真实 trace；
- 后续章节正文；
- benchmark reference；
- 回放答案；
- 外部 LLM 已经生成的目标章正文。

真实续写可使用：

- 目标章节之前的 truth/state files；
- 已确认的 story bible / book rules；
- 已确认的 outline / human plan；
- 用户或作者手工指定的目标章事件计划；
- clean Active Entity Cards；
- Worldbuilding / World Mechanics；
- Author Fingerprint；
- 人工写作意图和章节目标；
- 明确标记为假设的模型推断。

因此，本 schema 默认服务：

```text
real continuation / production continuation / planned continuation
```

而不是答案回放或 benchmark 对照。

---

## 4. 层级边界

### 4.1 Render Event Log 负责

Render Event Log 可以包含：

- 事件顺序；
- 单事件目标；
- 单事件入口条件；
- 单事件核心动作；
- 单事件内部小 beat；
- 单事件必须渲染内容；
- 单事件禁止漂移；
- 单事件转场钩子；
- 单事件目标长度；
- 单事件张力变化；
- 单事件笑点功能；
- 单事件机制释放方式；
- 单事件正文可见性；
- 单事件引用的 Entity Cards；
- 单事件引用的 World Mechanics；
- 单事件引用的 Author Fingerprint；
- event-level audit questions。

### 4.2 Render Event Log 不负责

Render Event Log 不应承担：

- 完整实体状态；
- 人物长期关系；
- 世界规则百科；
- 枪械、魔法、科技、经济等机制完整解释；
- 作者风格统计；
- 句长、段长、对白比例；
- 最终小说正文；
- clean truth files 的回写；
- validator 或完整写作管线的执行。

职责划分：

```text
Active Entity Cards
  -> 谁/什么存在，当前状态，关系，禁止漂移

Worldbuilding / World Mechanics
  -> 世界、装置、经济、科技、魔法、战术约束如何运作

Render Event Log
  -> 发生什么，按什么顺序发生，每个 event 有哪些渲染约束

Author Fingerprint
  -> 正文听起来、流动起来应该像什么

Auditor
  -> 检查 render 是否遵守所有层，并避免未来信息 / internal-only 信息泄漏
```

---

## 5. Source Boundary / 来源边界

每份 Render Event Log 文件必须声明来源边界。

```yaml
target_chapter: "<目标章节>"
input_scope: "<来源章节或来源文件范围>"
source_mode: "production_clean | planned | manual | hybrid_planned | model_hypothesis | benchmark_reference"
continuation_safe: true | false
source_label: "canon_confirmed | inferred | human_planned | human_override | model_hypothesis | benchmark_reference"
forbidden_sources:
  - "<禁止读取或引用的章节 / 文件>"
purpose: "<本 event log 的用途>"
```

---

## 6. source_mode 定义

### `production_clean`

只使用目标章节之前已经可用的 truth/state/rules 信息。

适合真实续写。

```yaml
source_mode: "production_clean"
continuation_safe: true
```

---

### `planned`

使用目标章节之前的信息，加上用户、作者或人工计划指定的目标章事件计划。

适合真实续写。

```yaml
source_mode: "planned"
continuation_safe: true
```

---

### `manual`

主要由人工指定事件结构。

适合真实续写或人工控制测试。

```yaml
source_mode: "manual"
continuation_safe: true
```

---

### `hybrid_planned`

clean 信息、人工计划和少量模型推断混合，但不使用目标章真实正文或后续章节。

适合真实续写，但需要审计模型推断部分。

```yaml
source_mode: "hybrid_planned"
continuation_safe: true
```

---

### `model_hypothesis`

模型推断事件结构，尚未确认。

适合探索，不应直接作为最终写作依据。

```yaml
source_mode: "model_hypothesis"
continuation_safe: true
```

前提：模型推断没有使用目标章真实正文、后续章节或 benchmark reference。

---

### `benchmark_reference`

仅用于测试 schema 表达能力、回放对照、评估上限或分析真实目标章。

不得用于真实续写生产路径。

```yaml
source_mode: "benchmark_reference"
continuation_safe: false
```

---

## 7. continuation_safe 规则

真实续写可用的 Event Log 应写：

```yaml
continuation_safe: true
```

出现以下情况必须写：

```yaml
continuation_safe: false
```

- 使用目标章节真实正文；
- 使用目标章节真实 trace；
- 使用后续章节；
- 使用 benchmark reference；
- 使用回放答案；
- 使用外部 LLM 已经生成的目标章正文；
- 使用任何会让真实续写“偷看答案”的材料。

---

## 8. source_label 定义

允许值：

```yaml
canon_confirmed
inferred
human_planned
human_override
model_hypothesis
benchmark_reference
```

含义：

- `canon_confirmed`：由目标章之前的 canon/truth files 直接支持。
- `inferred`：由目标章之前的 canon/truth files 推断。
- `human_planned`：来自用户、作者或人工写作计划。
- `human_override`：人工覆盖或修正。
- `model_hypothesis`：模型推断，尚未确认。
- `benchmark_reference`：来自答案回放、真实目标章或对照测试；真实续写中不得使用。

---

## 9. 推荐文件结构

```markdown
# Render Event Log for <target_chapter>

## Source Boundary
...

## Metadata
...

## Global Rendering Requirements
...

## Global Must Render Summary
...

## Global Must Not Render Summary
...

## Events
### REL-E001 — <事件标题>
...
### REL-E002 — <事件标题>
...

## Audit Plan
...

## Validation Checklist
...
```

---

## 10. Event ID 规则

普通事件建议使用稳定编号：

```text
REL-E001
REL-E002
REL-E003
...
```

可选分类前缀：

```text
REL-C001   # production clean event
REL-P001   # planned event
REL-M001   # manual event
REL-H001   # hybrid planned event
REL-B001   # benchmark reference event, not for production continuation
```

规则：

- 同一份 Event Log 中 `event_id` 必须唯一。
- 不要复用已经代表其他事件的 ID。
- 如果只是修正事件内容，不要随意改 event_id。
- 如果事件被拆分，应保留原事件关系说明。
- 如果事件被合并，应在 audit 中标记。
- structured render 测试阶段通常不建议合并核心事件。

---

## 11. 顶层对象：`RenderEventLog`

```yaml
schema_version: "render_event_log.v0.4"
log_id: "render_event_log_<target_chapter>_planned"
target_chapter: "<target_chapter>"

source_boundary:
  target_chapter: "<target_chapter>"
  input_scope: "<pre-target truth/state files + human target-chapter plan>"
  source_mode: "planned"
  continuation_safe: true
  source_label: "human_planned"
  forbidden_sources:
    - "<target chapter real manuscript>"
    - "<target chapter real trace>"
    - "<later chapter prose>"
    - "<benchmark reference>"
    - "<external LLM target-chapter prose>"
  purpose: "真实续写用事件级渲染蓝图。"

metadata:
  event_count: 0
  granularity: "coarse | medium | fine"
  target_total_length_cn: "<约 xxxx-xxxx 字>"
  rendering_mode: "prose_rendering_from_event_skeleton"
  intended_renderer: "model_agnostic"
  allow_event_merge: false
  allow_event_reorder: false

global_rendering_requirements:
  - "不要合并、压缩或跳过核心 event。"
  - "每个 event 至少要在正文中形成可识别的具体场景、动作、对白或物件锚点。"
  - "不得把 Event Log 的字段名、event_id 或 audit question 写进正文。"

global_must_render:
  - "<全局必须渲染的章节骨架>"

global_must_not_render:
  - "<全局禁止漂移>"

events:
  - event_id: "REL-E001"
    writing_order: 1
    event_title: "<事件标题>"
    ...

audit_plan:
  event_level_audit_required: true
  allow_event_merge: false
  allow_event_reorder: false
  terminology_lock_required: true
  ending_landing_check_required: true
  future_source_leak_check_required: true
  internal_only_leak_check_required: true
```

---

## 12. 顶层字段说明

### `schema_version`

类型：string
必填：是

推荐值：

```yaml
schema_version: "render_event_log.v0.4"
```

---

### `log_id`

类型：string
必填：推荐

示例：

```yaml
log_id: "render_event_log_<target_chapter>_planned"
```

用途：给当前 Event Log 一个稳定 ID。

---

### `target_chapter`

类型：string
必填：是

示例：

```yaml
target_chapter: "<target_chapter>"
```

---

### `source_boundary`

类型：object
必填：是

必须包含：

```yaml
source_boundary:
  target_chapter: "<target_chapter>"
  input_scope: "..."
  source_mode: "production_clean | planned | manual | hybrid_planned | model_hypothesis | benchmark_reference"
  continuation_safe: true | false
  source_label: "canon_confirmed | inferred | human_planned | human_override | model_hypothesis | benchmark_reference"
  forbidden_sources:
    - string
  purpose: string
```

---

### `metadata`

类型：object
必填：推荐

建议字段：

```yaml
metadata:
  event_count: number
  granularity: "coarse | medium | fine"
  target_total_length_cn: string
  rendering_mode: string
  intended_renderer: string
  allow_event_merge: boolean
  allow_event_reorder: boolean
```

说明：

- `granularity: coarse` 适合粗略章节规划。
- `granularity: medium` 适合普通 structured render。
- `granularity: fine` 适合高约束 structured render。
- `allow_event_merge: false` 用于测试 event 覆盖能力。
- `allow_event_reorder: false` 用于保持章节顺序。

---

### `global_rendering_requirements`

类型：list[string]
必填：推荐

用途：给所有事件的全局渲染要求。

示例：

```yaml
global_rendering_requirements:
  - "不要合并、压缩或跳过核心 event。"
  - "每个 event 至少要形成可识别的动作、对白、物件或场景锚点。"
  - "不得把 event_id 或 schema 字段写进正文。"
```

---

### `global_must_render`

类型：list[string]
必填：推荐

用途：列出整章必须保留的核心事件链。

---

### `global_must_not_render`

类型：list[string]
必填：推荐

用途：列出整章禁止漂移。

---

## 13. 单事件对象：`RenderEvent`

每个 event 建议使用以下结构：

```yaml
event_id: "REL-E001"
writing_order: 1
event_title: "<事件标题>"

source_label: "canon_confirmed | inferred | human_planned | human_override | model_hypothesis | benchmark_reference"
source_basis:
  - "<event-level 来源>"
event_confidence: "high | medium | low"
continuation_safe: true | false

relative_time: "<相对时间或章节顺序>"
location: "<具体地点>"

event_purpose: "<事件的结构目的>"
entry_condition: "<事件开始时必须成立的状态>"
core_event: "<事件核心动作，不写成小说正文>"
event_summary: "<事件摘要，可以与 core_event 接近，但更偏审计摘要>"

sub_beats:
  - "<可选：事件内部小 beat>"

dialogue_intent: "<本事件中的对白功能，不写具体长对白>"

must_render:
  - "<必须渲染的动作、对白、物件、信息或情绪转折>"

must_not_render:
  - "<禁止漂移、禁止解决、禁止泄密、禁止替换术语>"

render_priority: "blocking | high | medium | low"
target_length_cn: "约 xxx-xxx 字"

prose_visibility: "explicit_scene | light_touch | internal_only | transition_only | audit_only"

tension_delta:
  from: "light | neutral | tense | danger | unresolved"
  to: "light | neutral | tense | danger | unresolved"
  note: "<张力变化说明>"

comedy_function:
  type: "none | relief | misdirection | character_voice | setting_delivery | backpressure | transition"
  note: "<笑点结构功能>"

mechanism_reveal:
  type: "none | introduce | clarify | test | limit | reverse | unresolved"
  mechanic_ids:
    - "<world mechanic id>"
  note: "<机制释放方式>"

entity_refs:
  - "EC-C001"
  - "EC-C002"

transient_entity_refs:
  - "planned_transient:<临时实体名>"

world_mechanic_refs:
  - "WM-xxx"

author_fingerprint_refs:
  - "AF-xxx"

transition:
  in: "<进入该 event 的自然钩子>"
  out: "<离开该 event 的自然钩子>"
  hook_to_next: "<接到下一 event 的具体物件、动作、问题或对白>"

render_constraints:
  - "<给 Renderer 的事件级限制>"

audit_questions:
  - "<Auditor 检查问题>"
```

---

## 14. 单事件字段说明

### `event_id`

类型：string
必填：是

示例：

```yaml
event_id: "REL-E001"
```

规则：

- 稳定、唯一。
- 不要在正文中出现。
- 后续 audit、validator、assembly 都应通过 event_id 定位事件。

---

### `writing_order`

类型：number
必填：是

用途：强约束事件顺序。

规则：

- 从 1 开始递增。
- 不应跳号。
- 不应让 Renderer 自行重排，除非 metadata 明确允许。

---

### `event_title`

类型：string
必填：是

用途：人类可读的事件标题。

示例：

```yaml
event_title: "<事件标题>"
```

---

### `source_label`

类型：enum
必填：是

允许值：

```yaml
canon_confirmed
inferred
human_planned
human_override
model_hypothesis
benchmark_reference
```

含义：

- `canon_confirmed`：由允许来源直接支持。
- `inferred`：由允许来源推断。
- `human_planned`：由用户、作者或人工计划指定。
- `human_override`：人工覆盖或修正。
- `model_hypothesis`：模型猜测，尚未确认。
- `benchmark_reference`：答案回放/测试来源；真实续写中不得使用。

---

### `source_basis`

类型：list[string]
必填：是

用途：记录 event-level 来源。

示例：

```yaml
source_basis:
  - "<pre-target truth file>#<section>"
  - "<active entity cards file>#<entity_id>"
  - "<human plan file>#<event_id>"
```

规则：

- 不要粘贴大量原文。
- 真实续写 event 不得引用目标章真实正文或后续章节。
- 人工计划必须标记为 `human_planned` 或 `human_override`。
- benchmark / 回放来源必须标记为 `benchmark_reference` 且 `continuation_safe: false`。

---

### `event_confidence`

类型：enum
必填：推荐

允许值：

```yaml
high
medium
low
```

用途：标记该 event 的可靠度。

建议：

- 人工明确指定的 planned event 通常为 `high`。
- clean 推断 event 可为 `medium` 或 `low`。
- model_hypothesis 通常不能高于 `medium`。
- benchmark_reference 可为 `high`，但不得用于真实续写。

---

### `continuation_safe`

类型：boolean
必填：推荐

规则：

- 真实续写可用 event 为 `true`。
- 使用 benchmark reference、目标章真实正文、真实 trace 或后续章节时必须为 `false`。

---

### `relative_time`

类型：string
必填：推荐

用途：描述事件相对位置。

示例：

```yaml
relative_time: "<target_chapter> writing order 001"
```

---

### `location`

类型：string
必填：推荐

用途：标记事件发生地点。

建议写具体地点，不要过泛。

好例子：

```yaml
location: "<具体地点 A>"
location: "<具体地点 B>"
location: "<具体地点 C>"
```

不推荐：

```yaml
location: "<地点 A / 地点 B / 地点 C>"
```

除非该 event 确实跨越多个地点。

---

### `event_purpose`

类型：string
必填：是

说明这个 event 的结构功能。

示例：

```yaml
event_purpose: "把上一个场景留下的物件或问题转化为当前行动。"
```

---

### `entry_condition`

类型：string
必填：是

说明进入该 event 前必须已经成立的状态。

示例：

```yaml
entry_condition: "上一事件已经留下某个未解决问题，角色必须在本事件中采取下一步行动。"
```

---

### `core_event`

类型：string
必填：是

说明这个 event 的核心动作链。
它不是正文，不应写成小说段落。

好例子：

```yaml
core_event: "角色 A 处理上一个事件留下的问题，并把行动推进到下一个具体选择。"
```

坏例子：

```yaml
core_event: "风穿过窗缝，角色 A 的手指微微颤抖，仿佛命运的齿轮终于开始转动……"
```

原因：这是正文风格，不是 event skeleton。

---

### `event_summary`

类型：string
必填：推荐

用途：给 audit 和快速阅读使用。
可以和 `core_event` 接近，但应更偏摘要。

---

### `sub_beats`

类型：list[string]
必填：可选

用于拆解 event 内部小动作。

示例：

```yaml
sub_beats:
  - "角色 A 做出具体动作。"
  - "角色 B 通过短对白回应。"
  - "某个物件、信息或限制把事件推向下一步。"
```

如果不需要，可写：

```yaml
sub_beats: []
```

不要写 `none` 字符串，建议用空数组。

---

### `dialogue_intent`

类型：string
必填：推荐

说明对白承担什么功能，不写具体长对白。

示例：

```yaml
dialogue_intent: "用短对白揭示误解、限制或下一步行动，不写成长篇说明。"
```

---

### `must_render`

类型：list[string]
必填：是

列出正文中必须出现的内容。

示例：

```yaml
must_render:
  - "必须出现一个具体动作。"
  - "必须出现一个可审计的物件、对白或信息锚点。"
  - "必须把事件推进到下一选择。"
```

---

### `must_not_render`

类型：list[string]
必填：是

列出正文中不能出现的漂移。

示例：

```yaml
must_not_render:
  - "不得跳过上一个事件留下的问题。"
  - "不得让新信息直接解决所有冲突。"
  - "不得暴露 internal-only 信息。"
```

---

### `render_priority`

类型：enum
必填：推荐

允许值：

```yaml
blocking
high
medium
low
```

含义：

- `blocking`：如果漏掉，该章结构失败。
- `high`：强烈建议保留，漏掉会明显削弱章节。
- `medium`：可压缩但不应完全消失。
- `low`：轻量辅助。

示例：

```yaml
render_priority: "blocking"
```

适合 blocking 的内容：

- 章末核心问题；
- 关键威胁揭示；
- 关键机制限制；
- 关键转场；
- 决定性物件动作；
- 主线选择。

---

### `target_length_cn`

类型：string
必填：推荐

示例：

```yaml
target_length_cn: "约 180-260 字"
```

用途：

- 防止 event 被压成摘要；
- 防止普通 event 过度扩写；
- 给 assembly prompt 分配篇幅。

---

### `prose_visibility`

类型：enum
必填：推荐

允许值：

```yaml
explicit_scene
light_touch
internal_only
transition_only
audit_only
```

含义：

- `explicit_scene`：必须显性渲染成可见场景。
- `light_touch`：轻触即可，不能扩写。
- `internal_only`：只允许作为内部约束，正文不能显性写出。
- `transition_only`：只服务转场。
- `audit_only`：只用于审计，不给正文直接渲染。

示例：

```yaml
prose_visibility: "explicit_scene"
```

内部秘密、系统类约束如果出现在 event 中，应使用：

```yaml
prose_visibility: "internal_only"
```

并在 `must_not_render` 中列出禁止词。

---

### `tension_delta`

类型：object
必填：推荐

结构：

```yaml
tension_delta:
  from: "light | neutral | tense | danger | unresolved"
  to: "light | neutral | tense | danger | unresolved"
  note: "<张力变化说明>"
```

用途：标记事件如何改变章节压力。

示例：

```yaml
tension_delta:
  from: "neutral"
  to: "tense"
  note: "本事件将轻松互动转为现实压力。"
```

---

### `comedy_function`

类型：object
必填：推荐

结构：

```yaml
comedy_function:
  type: "none | relief | misdirection | character_voice | setting_delivery | backpressure | transition"
  note: "<笑点结构功能>"
```

含义：

- `none`：无笑点功能。
- `relief`：缓解说明密度或危险压力。
- `misdirection`：先轻松再反压。
- `character_voice`：强化角色声音。
- `setting_delivery`：用笑点承载设定。
- `backpressure`：用笑点后立刻现实反压。
- `transition`：用笑点转到下一事件。

示例：

```yaml
comedy_function:
  type: "backpressure"
  note: "笑点之后立刻让现实限制重新压回场景。"
```

---

### `mechanism_reveal`

类型：object
必填：推荐

结构：

```yaml
mechanism_reveal:
  type: "none | introduce | clarify | test | limit | reverse | unresolved"
  mechanic_ids:
    - "<world mechanic id>"
  note: "<机制释放方式>"
```

含义：

- `introduce`：首次引入机制。
- `clarify`：澄清机制。
- `test`：通过行动验证机制。
- `limit`：揭示机制限制。
- `reverse`：反转之前的理解。
- `unresolved`：留下未解决机制矛盾。
- `none`：本 event 不承担机制释放。

示例：

```yaml
mechanism_reveal:
  type: "limit"
  mechanic_ids:
    - "<world_mechanic_id>"
  note: "本事件揭示某个方案只能解决一部分问题。"
```

---

### `entity_refs`

类型：list[string]
必填：推荐

引用 Active Entity Cards。

示例：

```yaml
entity_refs:
  - "EC-C001"
  - "EC-C002"
```

规则：

- 只引用实体 ID。
- 不复制完整实体状态。
- 不把 transient entity 混入 clean Active Entity Cards。

---

### `transient_entity_refs`

类型：list[string]
必填：可选

用于引用目标章临时实体。

示例：

```yaml
transient_entity_refs:
  - "planned_transient:<临时实体名>"
```

规则：

- planned transient 必须明确标记。
- 不得回写 clean Active Entity Cards。
- 若后续建立 Target-Chapter Transient Entities，可替换为 `EC-Txxx`。
- benchmark/reference transient 不得用于真实续写生产路径。

---

### `world_mechanic_refs`

类型：list[string]
必填：推荐

引用 Worldbuilding / World Mechanics 中的机制 ID。

示例：

```yaml
world_mechanic_refs:
  - "<world_mechanic_id>"
```

规则：

- 只引用机制 ID。
- 不把世界观百科复制进 event。
- event 中只保留与当前事件相关的简短约束。

---

### `author_fingerprint_refs`

类型：list[string]
必填：推荐

引用 Author Fingerprint 中的规则 ID。

示例：

```yaml
author_fingerprint_refs:
  - "<author_fingerprint_rule_id>"
```

规则：

- 只引用作者风格目标。
- 不在 Event Log 里重写完整作者风格指南。

---

### `transition`

类型：object
必填：推荐

统一替代旧字段：

- `transition_in`
- `transition_out`
- `transition_hook_to_next_event`

推荐结构：

```yaml
transition:
  in: "<进入该 event 的自然钩子>"
  out: "<离开该 event 的自然钩子>"
  hook_to_next: "<接到下一 event 的具体物件、动作、问题或对白>"
```

示例：

```yaml
transition:
  in: "上一事件留下的物件或问题触发本事件。"
  out: "本事件的新限制或新选择推动下一事件。"
  hook_to_next: "具体物件、动作、问题或对白作为下一事件钩子。"
```

向后兼容规则：

- 旧字段 `transition_in` / `transition_out` / `transition_hook_to_next_event` 可继续读取。
- 新输出建议统一写入 `transition` 对象。
- 不建议同时输出两套，避免冗余。

---

### `render_constraints`

类型：list[string]
必填：推荐

给 Renderer 的 event-level 限制。

示例：

```yaml
render_constraints:
  - "不要写成长篇心理总结。"
  - "不要出现 event_id 或 schema 术语。"
```

---

### `audit_questions`

类型：list[string]
必填：是

给 Auditor 的 event-level 检查问题。

示例：

```yaml
audit_questions:
  - "正文是否能识别出该 event？"
  - "must_render 是否被覆盖？"
  - "must_not_render 是否被违反？"
```

向后兼容：

- 旧字段 `audit_checks` 可继续读取。
- 新输出建议统一写 `audit_questions`。
- 不建议同时输出 `audit_checks` 和 `audit_questions`。

---

## 15. 推荐枚举值

### 15.1 source_mode

```yaml
production_clean
planned
manual
hybrid_planned
model_hypothesis
benchmark_reference
```

---

### 15.2 source_label

```yaml
canon_confirmed
inferred
human_planned
human_override
model_hypothesis
benchmark_reference
```

---

### 15.3 event_confidence

```yaml
high
medium
low
```

---

### 15.4 render_priority

```yaml
blocking
high
medium
low
```

---

### 15.5 prose_visibility

```yaml
explicit_scene
light_touch
internal_only
transition_only
audit_only
```

---

### 15.6 tension_delta.from / tension_delta.to

```yaml
light
neutral
tense
danger
unresolved
```

---

### 15.7 comedy_function.type

```yaml
none
relief
misdirection
character_voice
setting_delivery
backpressure
transition
```

---

### 15.8 mechanism_reveal.type

```yaml
none
introduce
clarify
test
limit
reverse
unresolved
```

---

## 16. 完整事件模板

```yaml
event_id: "REL-E001"
writing_order: 1
event_title: "<事件标题>"

source_label: "human_planned"
source_basis:
  - "<event-level 来源>"
event_confidence: "high"
continuation_safe: true

relative_time: "<target_chapter> writing order 001"
location: "<具体地点>"

event_purpose: >
  <该事件的结构目的。>

entry_condition: >
  <进入该事件前必须成立的状态。>

core_event: >
  <事件核心动作链。不是小说正文。>

event_summary: >
  <给 audit 使用的事件摘要。>

sub_beats:
  - "<可选：事件内部小 beat>"

dialogue_intent: >
  <该事件中的对白功能。>

must_render:
  - "<必须渲染内容>"

must_not_render:
  - "<禁止漂移内容>"

render_priority: "blocking"
target_length_cn: "约 180-260 字"
prose_visibility: "explicit_scene"

tension_delta:
  from: "neutral"
  to: "tense"
  note: "<张力变化说明>"

comedy_function:
  type: "none"
  note: ""

mechanism_reveal:
  type: "none"
  mechanic_ids: []
  note: ""

entity_refs:
  - "EC-C001"

transient_entity_refs: []

world_mechanic_refs:
  - "<world mechanic id>"

author_fingerprint_refs:
  - "<author fingerprint rule id>"

transition:
  in: "<进入该 event 的自然钩子>"
  out: "<离开该 event 的自然钩子>"
  hook_to_next: "<接到下一 event 的具体钩子>"

render_constraints:
  - "<事件级渲染限制>"

audit_questions:
  - "<审计问题>"
```

---

## 17. 顶层模板

```markdown
# Render Event Log for <target_chapter>

## Source Boundary

```yaml
target_chapter: "<target_chapter>"
input_scope: "<pre-target truth/state files + human target-chapter plan>"
source_mode: "planned"
continuation_safe: true
source_label: "human_planned"
forbidden_sources:
  - "<target chapter real manuscript>"
  - "<target chapter real trace>"
  - "<later chapter prose>"
  - "<benchmark reference>"
  - "<external LLM target-chapter prose>"
purpose: "真实续写用事件级渲染蓝图。"
```

## Metadata

```yaml
schema_version: "render_event_log.v0.4"
log_id: "render_event_log_<target_chapter>_planned"
target_chapter: "<target_chapter>"
event_count: 0
granularity: "medium"
target_total_length_cn: "约 xxxx-xxxx 字"
rendering_mode: "prose_rendering_from_event_skeleton"
intended_renderer: "model_agnostic"
allow_event_merge: false
allow_event_reorder: false
```

## Global Rendering Requirements

- 不要合并、压缩或跳过核心 event。
- 每个 event 至少要在正文中形成可识别的具体场景、动作、对白或物件锚点。
- 不得把 Event Log 的字段名、event_id、audit question 或 schema 术语写进正文。
- 不得把 Event Log 写成章节小标题列表。
- 不得把 Event Log 原句机械改写成正文。
- 不得替换 terminology lock 中的关键术语。
- 结尾必须落在具体问题、对白、物件或角色反应上，不得抽象总结。

## Global Must Render Summary

- <必须保留的核心事件链 1>
- <必须保留的核心事件链 2>
- <必须保留的核心事件链 3>

## Global Must Not Render Summary

- 不得生成小说正文或把此文件当正文。
- 不得让新信息、新道具、新能力或新机制变成万能解法。
- 不得让任何角色知道 internal-only 信息。
- 不得读取、引用或暗示目标章真实正文、真实 trace、后续章节或 benchmark reference。
- 不得把作者风格、世界规则或实体状态百科塞进 Event Log。
- 不得把 event_id、字段名或 audit question 写进正文。

## Events

### REL-E001 — <事件标题>

```yaml
event_id: "REL-E001"
writing_order: 1
event_title: "<事件标题>"

source_label: "human_planned"
source_basis:
  - "<event-level 来源>"
event_confidence: "high"
continuation_safe: true

relative_time: "<target_chapter> writing order 001"
location: "<具体地点>"

event_purpose: >
  <该事件的结构目的。>

entry_condition: >
  <进入该事件前必须成立的状态。>

core_event: >
  <事件核心动作链。不是小说正文。>

event_summary: >
  <给 audit 使用的事件摘要。>

sub_beats:
  - "<可选：事件内部小 beat>"

dialogue_intent: >
  <该事件中的对白功能。>

must_render:
  - "<必须渲染内容>"

must_not_render:
  - "<禁止漂移内容>"

render_priority: "blocking"
target_length_cn: "约 180-260 字"
prose_visibility: "explicit_scene"

tension_delta:
  from: "neutral"
  to: "tense"
  note: "<张力变化说明>"

comedy_function:
  type: "none"
  note: ""

mechanism_reveal:
  type: "none"
  mechanic_ids: []
  note: ""

entity_refs:
  - "EC-C001"

transient_entity_refs: []

world_mechanic_refs:
  - "<world mechanic id>"

author_fingerprint_refs:
  - "<author fingerprint rule id>"

transition:
  in: "<进入该 event 的自然钩子>"
  out: "<离开该 event 的自然钩子>"
  hook_to_next: "<接到下一 event 的具体钩子>"

render_constraints:
  - "<事件级渲染限制>"

audit_questions:
  - "<审计问题>"
```

## Audit Plan

```yaml
audit_plan:
  event_level_audit_required: true
  audit_output_schema: "RenderEventAudit"
  allow_event_merge: false
  allow_event_reorder: false
  terminology_lock_required: true
  ending_landing_check_required: true
  future_source_leak_check_required: true
  internal_only_leak_check_required: true
  source_boundary_check_required: true
```

```

---

## 18. RenderEventAudit 建议结构

```yaml
event_id: "REL-E001"
event_title: "<事件标题>"

coverage:
  event_present: true
  must_render_covered:
    - item: "<must_render item>"
      covered: true
      evidence_note: "<简短说明>"
  missing_must_render:
    - "<缺失项>"

forbidden_drift:
  violations:
    - "<违反 must_not_render 的内容>"
  pass: true

transition_quality:
  transition_in_natural: true
  transition_out_natural: true
  issue: null

entity_alignment:
  checked_entity_refs:
    - "EC-C001"
  violations:
    - "<实体状态冲突>"
  pass: true

world_mechanics_alignment:
  checked_world_mechanics:
    - "<world mechanic id>"
  violations:
    - "<世界机制冲突>"
  pass: true

author_fingerprint_alignment:
  checked_author_refs:
    - "<author fingerprint rule id>"
  violations:
    - "<写法冲突>"
  pass: true

source_boundary:
  future_source_leak: false
  benchmark_reference_leak: false
  internal_only_leak: false
  forbidden_source_leak: false

event_judgment:
  pass: true
  severity: "none | low | medium | high | critical"
  notes:
    - "<审计备注>"
```

---

## 19. Validator 建议

建议为 Render Event Log 增加 lightweight structural validator。
它只检查结构，不生成小说正文，不调用外部 LLM，不运行完整写作管线。

检查项：

```text
1. 顶层必须有 source_boundary。
2. source_boundary 必须声明 source_mode 和 continuation_safe。
3. 真实续写用 Event Log 不得使用 benchmark_reference 作为 source_label。
4. 真实续写用 Event Log 不得引用目标章真实正文、真实 trace、后续章节或 benchmark reference。
5. 顶层必须有 metadata。
6. 每个 event 必须有 event_id。
7. 每个 event_id 必须唯一。
8. writing_order 必须连续递增。
9. 每个 event 必须有 source_label / source_basis。
10. continuation_safe: true 的 event 不得引用 forbidden_sources。
11. 每个 event 必须有 event_purpose / entry_condition / core_event。
12. 每个 event 必须有 must_render / must_not_render。
13. 每个 event 必须有 entity_refs 或说明为什么不需要。
14. 每个 event 必须有 transition 对象，或至少有 transition.out / hook_to_next。
15. 每个 event 必须有 audit_questions。
16. 不得同时输出大量重复旧字段和新字段。
17. 不得出现最终小说正文。
18. 不得把 Event Log 当 Entity Cards 使用。
19. 不得把 Event Log 当 World Mechanics 使用。
20. 不得把 Event Log 当 Author Fingerprint 使用。
```

---

## 20. 向后兼容规则

v0.4 推荐统一字段，但允许读取旧字段。

### 20.1 字段映射

```yaml
clean_forward_safe -> continuation_safe
active_entities -> entity_refs
world_mechanics_used -> world_mechanic_refs
author_fingerprint_targets -> author_fingerprint_refs
audit_checks -> audit_questions
transition_in -> transition.in
transition_out -> transition.out
transition_hook_to_next_event -> transition.hook_to_next
```

### 20.2 输出建议

新生成文件建议只写 v0.4 字段：

```yaml
continuation_safe:
entity_refs:
world_mechanic_refs:
author_fingerprint_refs:
audit_questions:
transition:
  in:
  out:
  hook_to_next:
```

不建议同时输出旧字段和新字段，否则 assembly prompt 会变臃肿。

---

## 21. 常见失败模式

### 21.1 checklist expansion

错误：

```text
他们做了事件 A。然后他们做了事件 B。然后他们讨论了事件 C。
```

问题：正文暴露 Event Log 骨架。

修正：每个 event 必须通过动作、对白、物件或场景变化发生。

---

### 21.2 event compression

错误：

```text
他们试了几个办法，最终知道该怎么做。
```

问题：跳过关键 event。

修正：关键 event 必须有可审计动作、对白、物件、失败、纠正、再次选择等锚点。

---

### 21.3 worldbuilding overload

错误：

```text
本世界的机制如下……
```

问题：Event Log 被写成世界观百科。

修正：世界机制应由 World Mechanics 提供；Event Log 只规定该机制在哪个事件中释放、通过什么动作或对白释放。

---

### 21.4 entity state overwrite

错误：

```text
某角色忽然获得了 Entity Cards 中明确禁止的新能力。
```

问题：Event Log 越权改写 Entity Cards。

修正：Event Log 可以规定角色参与某个 event，但不得覆盖实体卡中的能力边界。

---

### 21.5 internal-only leak

错误：

```text
正文显性写出了只应该给 Renderer 看的内部机制、系统、进度或隐藏规则。
```

问题：内部约束泄漏进正文。

修正：如果引用 internal-only entity，只能写成含混的内心压力、经验判断或动作执念。

---

### 21.6 future-source contamination

错误：

```text
真实续写 Event Log 引用目标章真实正文、真实 trace、后续章节或 benchmark reference。
```

问题：真实续写变成偷看答案，测试和生产都失效。

修正：真实续写只允许使用 pre-target truth files、人工计划、手工 outline、clean cards、world mechanics、author fingerprint，以及明确标记的模型假设。

---

## 22. PR 定位

本 schema 应定位为：

```text
Render Event Log = 事件级渲染蓝图
```

它不替代 InkOS 既有 planner，也不替代 truth files。

建议管线位置：

```text
InkOS truth files
→ Active Entity Cards
→ Worldbuilding / World Mechanics
→ Author Fingerprint
→ Render Event Log
→ Structured Render Assembly
→ Renderer LLM
→ Event-level Auditor
```

---

#
