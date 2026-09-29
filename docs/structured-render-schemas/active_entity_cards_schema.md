# Active Entity Cards / 活跃实体卡 Schema 与模板 v0.2

## 1. 用途

`Active Entity Cards` 用于描述目标章节开始前，当前故事世界中有哪些正在起作用的实体，以及这些实体的状态、边界和叙事功能。

它回答的问题是：

- 当前有哪些可操作实体？
- 每个实体在目标章节开始前是什么状态？
- 目标章节中允许这个实体发生什么变化？
- 不允许发生什么变化？
- 这个实体承担什么叙事功能？
- 它和其他实体有什么约束关系？
- 哪些实体信息只能给 Renderer 看，不能显性写进正文？


本文件不是章节大纲。
事件顺序属于 `Render Event Log`。

本文件不是世界观百科。
通用世界规则属于 `Worldbuilding / World Mechanics`。

本文件不是作者风格指南。
写法、节奏和角色声音属于 `Author Fingerprint`。

---

## 2. Source Boundary / 来源边界

每个实体卡文件必须声明来源边界，避免模型把未来章节、推断内容或 benchmark_reference 信息误当成 canon。

建议字段：

```yaml
target_chapter: "<目标章节>"
input_chapters: "<作为来源的章节范围>"
source_mode: "clean | benchmark_reference | hybrid | manual | model_hypothesis"
forbidden_sources:
  - "<禁止读取或引用的章节 / 文件>"
notes: "<简短说明>"
```

### 示例

```yaml
target_chapter: "<target_chapter>"
input_chapters: "<pre_target_chapters>"
source_mode: "hybrid"
forbidden_sources:
  - "ch0012+"
notes: "主实体卡来自 <pre_target_chapters> clean 抽取；目标章临时实体如果使用 benchmark_reference 信息，必须单独标记。"
```

### source_mode 定义

- `clean`：只使用目标章节之前的文本。
- `benchmark_reference`：使用真实目标章节作为参考。
- `hybrid`：同时包含 clean 信息和 benchmark-reference 临时信息。
- `manual`：包含人工指定或人工覆盖。
- `model_hypothesis`：模型推断，尚未确认。

禁止把 clean 信息和 benchmark_reference 信息混在一起却不标注来源。

---

## 3. 推荐文件结构

```markdown
# 01 Active Entity Cards for <target_chapter>

## Source Boundary
...

## Global Entity Rules / 全局实体规则
...

## Active Entity Cards / 活跃实体卡
- EC-001
- EC-002
- ...

## Target-Chapter Transient Entities / 目标章临时实体
- EC-T001
- EC-T002
- ...

## Global Forbidden Drift / 全局禁止漂移
...

## Validation Checklist / 校验清单
...
```

---

## 4. 实体 ID 规则

普通活跃实体建议使用稳定编号：

```text
EC-001
EC-002
EC-003
...
```

目标章节临时实体建议使用单独前缀：

```text
EC-T001
EC-T002
...
```

如果是 benchmark-reference 临时实体，也可以使用：

```text
EC-O001
EC-O002
...
```

规则：

- 不要把同一个 ID 用给不同实体。
- 如果实体类型发生变化，优先更新原卡，不要重复创建新卡。
- 如果某实体只在目标章节中短暂出现，用 `Target-Chapter Transient Entities`，不要混入主实体卡。

---

## 5. entity_type / 实体类型

实体不只包括人物。

允许的实体类型包括：

```text
character
equipment
location
organization
threat
resource
social_rule
world_rule
magic_rule
mechanical_rule
knowledge_asset
task_pressure
relationship_state
secret
mystery
tactical_problem
chapter_closing_mechanism
internal_constraint
```

可以使用复合标签：

```yaml
entity_type: "equipment / magic_weapon / price_constraint"
entity_type: "world_rule / tactical_ecology"
entity_type: "character / ally / technical_support"
entity_type: "tactical_problem / chapter_closing_mechanism"
```

中文说明可以写在值里，但建议保留一部分英文分类，方便后续程序处理。

---


## 6. source_label / provenance 字段

### 6.1 source_label

允许值：

```text
canon_confirmed
inferred
benchmark_reference
human_override
model_hypothesis
```

定义：

- `canon_confirmed`：由允许来源直接支持。
- `inferred`：由允许来源推断，但不是直接明说。
- `benchmark_reference`：来自真实目标章、目标章 trace、后续章节或反推信息。
- `human_override`：人工指定或覆盖。
- `model_hypothesis`：模型猜测，尚未确认。

clean mode 下主实体卡不得出现 `benchmark_reference`。
若出现 `benchmark_reference`，pack 的 `source_mode` 不得为纯 `clean`。

### 6.2 推荐可选 provenance 字段

以下字段为 v0.2 新增的向后兼容字段，建议 compiler 输出。

```yaml
confidence: "high | medium | low"
compiled_from: "truth_state | story_frame | hooks | chapter_summaries | emotional_arcs | book_rules | raw_chapters | event_log | benchmark_reference | human_override | mixed"
evidence_granularity: "state_json | state_markdown | hook_json | chapter_summary | emotional_arc_summary | world_rules | raw_line | manual_note | mixed"
```

用途：

- `confidence`：标记该实体卡整体可靠度。
- `compiled_from`：标记编译来源类型。
- `evidence_granularity`：标记证据粒度，便于 audit。
- 这些字段不替代 `source_basis`；`source_basis` 仍必须保留。

---

## 7. render_visibility / 渲染可见性字段

有些实体或规则可以给 Renderer 看，但不能显性写进正文。例如主角秘密、金手指、内部反馈机制、作者为防漂移加入的内部约束。

这类实体必须使用 `render_visibility`。

```yaml
render_visibility:
  prompt_visible: true
  prose_visible: false
  allowed_surface_form:
    - "<允许在正文中间接表现的形式>"
  forbidden_surface_form:
    - "<正文中绝对不能出现的词、句式、解释或机制外显>"
  notes: "<可选说明>"
```

字段含义：

- `prompt_visible`: 是否允许写入给 Renderer 的结构化输入。
- `prose_visible`: 是否允许以明示形式出现在小说正文。
- `allowed_surface_form`: 允许的间接表现方式。
- `forbidden_surface_form`: 禁止正文出现的显性形式。
- `notes`: 给审计器或 compiler 的补充说明。

### 示例：内部秘密机制

```yaml
entity_id: "EC-007"
entity_name: "秘密反馈机制 / 金手指"
entity_type: "secret / internal_constraint / protagonist-bound"
source_label: "canon_confirmed"
confidence: "high"
compiled_from: "hooks / truth_state / story_frame"
evidence_granularity: "hook_json + state_json + story_frame"

render_visibility:
  prompt_visible: true
  prose_visible: false
  allowed_surface_form:
    - "<protagonist>含混的内心压力"
    - "<protagonist>对姿态、胆量、实战动作的执念"
    - "<protagonist>对纯打靶无效的模糊经验判断"
  forbidden_surface_form:
    - "系统"
    - "金手指"
    - "进度条"
    - "面板"
    - "反馈机制"
    - "刷经验"
  notes: "只作为 Renderer 内部约束；不得被 NPC 发现、命名、讨论或利用。"
```

规则：

- 任何 `entity_type` 含 `secret`、`internal_constraint`、`protagonist-bound hidden rule` 的实体，建议显式填写 `render_visibility`。
- 如果 `prose_visible: false`，正文中不得出现该实体名、机制名或解释性标签。
- 允许用行为、犹豫、执念、误判、内心含混压力间接表现。
- 审计时必须检查 forbidden_surface_form 是否泄漏进正文。

---

## 8. 主实体卡完整 Schema

重要实体使用完整实体卡。

```yaml
entity_id: "EC-001"
entity_name: "<实体名称>"
entity_type: "<类别 / 角色 / 子类型>"

source_label: "canon_confirmed | inferred | benchmark_reference | human_override | model_hypothesis"
source_basis:
  - "<支持该实体状态的章节、场景、文件或备注>"

confidence: "high | medium | low"
compiled_from: "<来源类型，可用 / 连接多个来源>"
evidence_granularity: "<证据粒度，可用 + 连接多个粒度>"

current_state_at_context_boundary: >
  <目标章节开始前，该实体当前的具体状态。>

known_history_relevant_to_target: >
  <只写和目标章节有关的历史，不要复述完整传记。>

allowed_changes_in_target_chapter:
  - "<目标章节中允许发生的变化或用途>"
  - "<目标章节中允许发生的变化或用途>"

forbidden_changes_in_target_chapter:
  - "<禁止发生的漂移、矛盾、升级、暴露或误用>"
  - "<禁止发生的漂移、矛盾、升级、暴露或误用>"

narrative_functions:
  - "<该实体在目标章节中的结构功能>"
  - "<例如：压力源、降压角色、技术解释者、战术限制、交易摩擦>"

relationships_to_other_entities:
  - entity_id: "<相关实体 ID>"
    relationship: "<关系或约束>"

rendering_notes:
  - "<给正文渲染模型的具体提醒>"
  - "<该实体在正文中应该如何出现或避免如何出现>"

render_visibility:
  prompt_visible: true
  prose_visible: true
  allowed_surface_form:
    - "<可选：允许正文表现形式>"
  forbidden_surface_form:
    - "<可选：禁止正文显性形式>"
  notes: "<可选：内部可见性说明>"

uncertainty_or_missing_info:
  - "<当前未知的信息，模型不得擅自补全>"
  - "<开放问题或待确认信息>"
```

说明：

- `confidence`、`compiled_from`、`evidence_granularity` 是推荐字段。
- `render_visibility` 是条件字段；涉及秘密、内部机制、不可明示设定时必须写。
- 普通人物、装备、地点如果可以正常出现在正文中，可省略 `render_visibility`，或写 `prose_visible: true`。

---

## 9. 目标章临时实体最小 Schema

目标章临时实体用于控制目标章节中新出现的道具、地点、机制、威胁或战术问题。

它们不是完整实体卡，只负责防止正文渲染时漂移。

```yaml
entity_id: "EC-T001"
entity_name: "<临时实体名称>"
entity_type: "<类别 / 功能>"
source_label: "benchmark_reference | inferred | human_override | model_hypothesis"
source_basis:
  - "<支持该临时实体的 Event Log、人工备注或 benchmark_reference reference>"
confidence: "high | medium | low"
compiled_from: "event_log | benchmark_reference | human_override | model_hypothesis | mixed"
evidence_granularity: "event_summary | manual_note | benchmark_reference | mixed"
render_boundary: >
  <渲染正文时，该临时实体必须保持的边界。>
related_events:
  - "<关联 event id>"
  - "<关联 event id>"
```

可选字段：

```yaml
must_render:
  - "<必须在正文中出现的内容>"

must_not_render:
  - "<正文中不得发生的漂移或误用>"
```

规则：

- clean compiler 不应自动生成目标章临时实体。
- benchmark_reference/manual Event Log 引入的临时实体必须与主实体卡分开。
- 临时实体不得覆盖已确认 canon。
- 临时实体不得代替 World Mechanics 或 Render Event Log。

---

## 10. 字段填写规则

### 8.1 current_state_at_context_boundary

该字段必须描述目标章节开始前的具体状态。

好例子：

```yaml
current_state_at_context_boundary: >
  主角刚离开裁缝铺，披着新买的披风，正被同伴带向<equipment_shop>更换不可靠的旧左轮。
```

坏例子：

```yaml
current_state_at_context_boundary: >
  主角勇敢、聪明、有潜力。
```

原因：
“勇敢、聪明”是性格或作者指纹相关信息，不是当前状态。

---

### 8.2 known_history_relevant_to_target

只写和目标章节有关的历史。

好例子：

```yaml
known_history_relevant_to_target: >
  旧左轮是此前缴获的战利品，有纪念意义，但已经多次表现出精度不可靠。
```

坏例子：

```yaml
known_history_relevant_to_target: >
  从第一章开始完整复述主角经历。
```

---

### 8.3 allowed_changes_in_target_chapter

写目标章节中允许实体发生的变化或被使用的方式。

示例：

```yaml
allowed_changes_in_target_chapter:
  - "可以被试用、替换、折价、保留为纪念物或作为新武器对照。"
  - "可以通过实际使用暴露限制。"
```

---

### 8.4 forbidden_changes_in_target_chapter

写具体禁止事项，防止模型漂移。

示例：

```yaml
forbidden_changes_in_target_chapter:
  - "不能突然变成魔法武器。"
  - "不能让主角立刻变成神枪手。"
  - "不能让 NPC 知道主角隐藏秘密。"
```

不要写空泛禁令。

坏例子：

```yaml
forbidden_changes_in_target_chapter:
  - "不要写坏。"
```

---

### 8.5 narrative_functions

说明该实体为什么在目标章节中重要。

示例：

```yaml
narrative_functions:
  - "装备更新触发器"
  - "身份压力锚点"
  - "战术限制"
  - "世界规则展示物"
  - "带出笑点同时暴露限制的装置"
```

---

### 8.6 relationships_to_other_entities

当实体关系会影响正文渲染时，必须写清楚。

示例：

```yaml
relationships_to_other_entities:
  - entity_id: "EC-003"
    relationship: "该角色可以解释装备的机械限制，但不能解决所有问题。"

  - entity_id: "EC-011"
    relationship: "该未解决威胁推动队伍更新装备。"
```

---

### 8.7 uncertainty_or_missing_info

用于阻止模型擅自补全未知信息。

示例：

```yaml
uncertainty_or_missing_info:
  - "当前剩余现金数量未知；不得写成无限资金。"
  - "敌人身份未知；除非 Event Log 要求，不得提前揭示。"
```

---

## 11. 全局实体规则

每个实体卡文件都应该包含全局漂移约束。

模板：

```markdown
## Global Entity Rules / 全局实体规则

- 除非 Event Log 明确要求，不得揭示秘密。
- 不得把任何实体升级成万能解法。
- 不得在没有因果 beat 的情况下移除既有限制。
- 目标章节临时实体不得覆盖已经确认的 canon。
- 如果 Entity Cards 与 Event Log 冲突，应优先保留已确认 canon，并在审计阶段标记冲突。
- 如果某个细节不在 Entity Cards、World Mechanics 或 Event Log 中，应视为未知，而不是为了方便剧情擅自发明。
- `prose_visible: false` 的实体只能作为内部约束，不得显性进入正文。
```

---

## 12. 通用模板

下面模板可直接复制到新项目或新章节。

```markdown
# 01 Active Entity Cards for <target_chapter>

## Source Boundary

~~~yaml
target_chapter: "<目标章节>"
input_chapters: "<来源章节范围>"
source_mode: "clean"
forbidden_sources:
  - "<未来章节或禁止来源>"
notes: "<简短说明>"
```

---

## Global Entity Rules / 全局实体规则

- 除非 Event Log 明确要求，不得揭示秘密。
- 不得在没有因果 beat 的情况下移除既有限制。
- 不得把任何实体变成万能解法。
- 不得为了方便剧情发明资金、能力、装备或知识。
- 未知信息应保持未知。

---

## Active Entity Cards / 活跃实体卡

### EC-001

```yaml
entity_id: "EC-001"
entity_name: "<实体名称>"
entity_type: "<类别 / 角色 / 子类型>"
source_label: "canon_confirmed"
source_basis:
  - "<来源章节或文件>"

confidence: "high"
compiled_from: "<来源类型>"
evidence_granularity: "<证据粒度>"

current_state_at_context_boundary: >
  <目标章节开始前的当前状态。>

known_history_relevant_to_target: >
  <只写与目标章节有关的历史。>

allowed_changes_in_target_chapter:
  - "<允许变化或用途>"

forbidden_changes_in_target_chapter:
  - "<禁止漂移或误用>"

narrative_functions:
  - "<叙事功能>"

relationships_to_other_entities:
  - entity_id: "<相关实体 ID>"
    relationship: "<关系或约束>"

rendering_notes:
  - "<给正文渲染模型的提醒>"

render_visibility:
  prompt_visible: true
  prose_visible: true
  allowed_surface_form: []
  forbidden_surface_form: []
  notes: ""

uncertainty_or_missing_info:
  - "<未知信息>"
```

### EC-002

```yaml
entity_id: "EC-002"
entity_name: "<实体名称>"
entity_type: "<类别 / 角色 / 子类型>"
source_label: "canon_confirmed | inferred | benchmark_reference | human_override | model_hypothesis"
source_basis:
  - "<来源章节或文件>"

current_state_at_context_boundary: >
  <目标章节开始前的当前状态。>

known_history_relevant_to_target: >
  <只写与目标章节有关的历史。>

allowed_changes_in_target_chapter:
  - "<允许变化或用途>"

forbidden_changes_in_target_chapter:
  - "<禁止漂移或误用>"

narrative_functions:
  - "<叙事功能>"

relationships_to_other_entities:
  - entity_id: "<相关实体 ID>"
    relationship: "<关系或约束>"

rendering_notes:
  - "<给正文渲染模型的提醒>"

uncertainty_or_missing_info:
  - "<未知信息>"
```

---

## Target-Chapter Transient Entities / 目标章临时实体

### EC-T001

```yaml
entity_id: "EC-T001"
entity_name: "<临时实体名称>"
entity_type: "<类别 / 功能>"
source_label: "benchmark_reference | inferred | human_override | model_hypothesis"
render_boundary: >
  <渲染正文时必须保持的边界。>
related_events:
  - "<event id>"
must_render:
  - "<可选：必须渲染内容>"
must_not_render:
  - "<可选：禁止内容>"
```

---

## Validation Checklist / 校验清单

- [ ] 每个主要活跃实体都有稳定的 `entity_id`。
- [ ] 每个实体都有 `entity_type`。
- [ ] 每个实体都有 `source_label`。
- [ ] 每个实体都有 `source_basis`。
- [ ] 每个实体都有 `confidence`、`compiled_from`、`evidence_granularity`。
- [ ] 每个实体都有目标章节开始前的当前状态。
- [ ] 每个主要实体都有 allowed / forbidden 变化。
- [ ] 携带秘密的实体明确写出不得暴露的内容。
- [ ] `secret` / `internal_constraint` 实体有 `render_visibility`。
- [ ] `prose_visible: false` 的实体有 `forbidden_surface_form`。
- [ ] 有能力限制的实体明确写出不能解决什么问题。
- [ ] 目标章节临时实体与 clean 来源实体分开。
- [ ] benchmark-reference 实体已明确标记。
- [ ] clean mode 下没有 `benchmark_reference` 主实体卡。
- [ ] 除非 source_mode 明确允许，否则没有使用未来章节信息。

  ```

  ```

---

## 13. 推荐 JSON 结构

如果 InkOS 后续希望将本文件编译成机器可读状态，可使用类似 JSON 结构：

```json
{
  "target_chapter": "<target_chapter>",
  "input_chapters": "<pre_target_chapters>",
  "source_mode": "hybrid",
  "forbidden_sources": ["ch0012+"],
  "global_entity_rules": [
    "除非 Event Log 明确要求，不得揭示秘密。",
    "不得把任何实体变成万能解法。"
  ],
  "entities": [
    {
      "entity_id": "EC-001",
      "entity_name": "<实体名称>",
      "entity_type": ["character", "protagonist", "secret-holder"],
      "source_label": "canon_confirmed",
      "source_basis": ["ch0001", "ch0002"],
      "current_state_at_context_boundary": "<当前状态>",
      "known_history_relevant_to_target": "<相关历史>",
      "allowed_changes_in_target_chapter": ["<允许变化>"],
      "forbidden_changes_in_target_chapter": ["<禁止变化>"],
      "narrative_functions": ["<叙事功能>"],
      "relationships_to_other_entities": [
        {
          "entity_id": "EC-002",
          "relationship": "<关系>"
        }
      ],
      "rendering_notes": ["<渲染提醒>"],
      "uncertainty_or_missing_info": ["<未知信息>"]
    }
  ],
  "transient_entities": [
    {
      "entity_id": "EC-T001",
      "entity_name": "<临时实体名称>",
      "entity_type": ["equipment", "magic_weapon"],
      "source_label": "benchmark_reference",
      "render_boundary": "<渲染边界>",
      "related_events": ["O-E003", "O-E005"],
      "must_render": ["<必须渲染>"],
      "must_not_render": ["<不得渲染>"]
    }
  ]
}
```

---


## 14. Structural Validator 建议

建议为 Active Entity Cards 增加一个轻量 structural validator。它只检查结构和来源边界，不生成小说正文，不调用外部 LLM。

建议检查项：

```text
1. 每张主实体卡必须有 entity_id / entity_name / entity_type。
2. 每张主实体卡必须有 source_label / source_basis。
3. 每张主实体卡建议有 confidence / compiled_from / evidence_granularity。
4. clean mode 下不得出现 source_label: benchmark_reference。
5. source_basis 不得包含 forbidden_sources 中的路径或章节。
6. clean mode 下不得生成目标章节 transient/benchmark_reference entity。
7. secret / internal_constraint 实体必须有 render_visibility。
8. prose_visible: false 的实体必须有 forbidden_surface_form。
9. forbidden_surface_form 中的词不得出现在最终正文。
10. Target-Chapter Transient Entities 必须有 related_events 或 render_boundary。
11. 不得把 Entity Cards 当成 Event Log 使用；不得出现事件顺序字段如 next_event、previous_event、target_length。
12. 不得把 Entity Cards 当成 World Mechanics 使用；通用世界规则应移入 Worldbuilding / World Mechanics。
```

validator 输出建议：

```text
creative_layer/docs/<local_validation_outputs>/active_entity_cards_validation_<target_chapter>.md
```

---

## 15. PR 定位

本 schema 应定位为：

```text
Active Entity Cards = 渲染时使用的操作性状态包
```

它不替代 InkOS 既有 truth files。

它可以由以下来源编译生成：

```text
current_state
character_matrix
particle_ledger
pending_hooks
chapter_summaries
subplot_board
emotional_arcs
manual overrides
benchmark_reference 或 clean 目标章节规划
```

它在管线中的位置建议为：

```text
InkOS truth files
→ Active Entity Cards
→ Render Event Log + World Mechanics + Author Fingerprint
→ Renderer LLM
→ Event-level Auditor
```


---

## 16. v0.2 修改摘要

相对 v0.1，本版只增加必要字段，不改变 schema 定位：

- 新增 `confidence`。
- 新增 `compiled_from`。
- 新增 `evidence_granularity`。
- 新增 `render_visibility`，用于处理内部秘密和不可显性渲染机制。
- 明确 `secret` / `internal_constraint` 实体必须防止正文泄漏。
- 明确 clean mode 下不得出现 `benchmark_reference` 主实体卡。
- 新增 structural validator 建议。
