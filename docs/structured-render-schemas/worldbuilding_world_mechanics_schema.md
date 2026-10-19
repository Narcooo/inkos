# Worldbuilding / World Mechanics Schema v0.3 中文主版

## 1. 用途

`Worldbuilding / World Mechanics` 用于描述目标章节渲染时必须遵守的世界规则、机制边界、社会规则、经济规则、技术规则、魔法规则、战术规则和设定限制。

它只回答一个问题：

> Writer 在渲染目标章节时，世界如何运作？哪些事情可行、昂贵、稀缺、有风险、受权限限制，或者不能被新装备、新魔法、新机械、新情报直接解决？

本文件不是 Entity Cards schema。
实体当前状态、人物关系、装备归属、秘密边界属于 `Active Entity Cards`。

本文件不是 Render Event Log schema。
事件顺序、章节 beat、转场链、目标字数、event-level must render 属于 `Render Event Log`。

本文件不是 Author Fingerprint schema。
句长、段长、对白节奏、角色声音、作者味属于 `Author Fingerprint`。

本文件不是某本书、某一章或某个项目的专用 instance。
具体作品、具体角色、具体章节事件、具体测试答案应放入 instance 文件或 test output，不应写入 schema。

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
- 某个测试 instance 中的专有术语；
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
worldbuilding_world_mechanics_schema.md
  -> 通用 schema，只定义结构和规则

worldbuilding_world_mechanics_<target_chapter>_from_boundary.md
  -> 某目标章节的 production-clean / continuation-safe instance

worldbuilding_world_mechanics_<target_chapter>_planned.md
  -> 某目标章节的 planned instance

worldbuilding_world_mechanics_<target_chapter>_benchmark_reference.md
  -> benchmark / 回放测试 instance，不用于真实续写

worldbuilding_world_mechanics_schema_test_report_<target_chapter>.md
  -> schema fit 测试报告
```

---

## 3. 核心边界

Worldbuilding / World Mechanics 可以包含：

- 世界类型；
- 社会规则；
- 金钱 / 赏金 / 交易规则；
- 技术机制；
- 武器机制；
- 魔法机制；
- 科技与魔法的交互边界；
- 施法者、工程师、发明家、特殊职业等群体的生态规则；
- 幻象、侦测、感知、识别、权限等机制；
- 机械装置、特殊设备、权限系统；
- 由世界规则制造出来的战术矛盾；
- 由机制直接推出的渲染禁止项；
- 哪些机制 clean 支持不足，需要 planned / manual / benchmark 来源补强。

Worldbuilding / World Mechanics 不应包含：

- 完整实体状态；
- 角色库存清单，除非是解释世界机制所需；
- 事件顺序；
- 目标章节 beat sequence；
- 目标字数；
- 文风、句式、角色声音；
- 最终小说正文；
- 未标记的未来章节信息；
- 未标记的 benchmark / 回放答案；
- 未标记的目标章节真实正文信息。

---

## 4. Source Mode / 来源模式

每个 pack 和每条 mechanic 都必须声明来源模式，避免真实续写被未来信息、benchmark reference 或目标章真实正文污染。

合法 `source_mode`：

```yaml
source_mode: production_clean | planned | manual | hybrid_planned | model_hypothesis | benchmark_reference
```

也可保留旧字段：

```yaml
render_mode: clean | hybrid | benchmark_reference
```

推荐真实续写使用：

```yaml
source_mode: production_clean
continuation_safe: true
```

或：

```yaml
source_mode: planned
continuation_safe: true
```

---

## 5. source_mode 定义

### `production_clean`

只使用目标章节之前已经可用的 truth/state/rules/outline 信息。

适合真实续写。

```yaml
source_mode: production_clean
clean_forward_safe: true
continuation_safe: true
```

---

### `planned`

使用目标章节之前的信息，加上用户、作者或人工写作计划指定的目标章机制需求。

适合真实续写。

```yaml
source_mode: planned
clean_forward_safe: true
continuation_safe: true
```

注意：`planned` 可以包含“作者打算让本章出现的机制”，但不能伪装成 pre-target canon。

---

### `manual`

主要由人工指定机制结构。

适合真实续写、人工控制测试或编辑流程。

```yaml
source_mode: manual
continuation_safe: true
```

---

### `hybrid_planned`

clean 信息、人工计划、少量模型推断混合，但不使用目标章真实正文或后续章节。

适合真实续写，但需要更强审计。

```yaml
source_mode: hybrid_planned
continuation_safe: true
```

---

### `model_hypothesis`

模型推断的机制结构，尚未确认。

适合探索，不应直接作为最终写作依据。

```yaml
source_mode: model_hypothesis
continuation_safe: true
```

前提：模型推断没有使用目标章真实正文、后续章节、benchmark reference 或外部 LLM 已生成目标章正文。

---

### `benchmark_reference`

仅用于测试 schema 表达能力、回放对照、评估上限或分析真实目标章。

不得用于真实续写生产路径。

```yaml
source_mode: benchmark_reference
clean_forward_safe: false
continuation_safe: false
```

---

## 6. continuation_safe / clean_forward_safe 规则

真实续写可用的 World Mechanics pack 应写：

```yaml
continuation_safe: true
```

如果该 pack 完全来自目标章之前的 clean 来源，也应写：

```yaml
clean_forward_safe: true
```

出现以下情况必须写：

```yaml
continuation_safe: false
clean_forward_safe: false
```

- 使用目标章节真实正文；
- 使用目标章节真实 trace；
- 使用后续章节；
- 使用 benchmark reference；
- 使用回放答案；
- 使用外部 LLM 已经生成的目标章正文；
- 使用任何会让真实续写“偷看答案”的材料。

---

## 7. support_status / 支持状态

v0.3 新增 `support_status`，用于区分某条机制是否能由 clean 来源稳定支持。

合法值：

```yaml
support_status: clean_supported | low_confidence | not_clean_supported | requires_planned_source
```

含义：

- `clean_supported`：目标章之前的来源足以支持该机制。
- `low_confidence`：有部分 clean 支持，但不足以展开细节。
- `not_clean_supported`：clean 来源不支持，不应写入 production-clean instance。
- `requires_planned_source`：需要作者计划、manual notes、Render Event Log 或其他 planned 来源才能进入真实续写。

规则：

- production-clean instance 中可以包含 `clean_supported` 和少量 `low_confidence`。
- production-clean instance 不应把 `not_clean_supported` 当成可渲染规则。
- `requires_planned_source` 只能作为 gap / open question 或 planned instance 内容，不能伪装成 canon。

---

## 8. mechanic_scope / 机制作用域

v0.3 新增 `mechanic_scope`。

合法值：

```yaml
mechanic_scope: global | chapter_relevant | unresolved_gap
```

含义：

- `global`：全书或世界长期有效机制。
- `chapter_relevant`：本目标章节需要特别注意的机制。
- `unresolved_gap`：当前 clean 来源不足，需要后续 planned/manual/benchmark source 补强的机制缺口。

示例：

```yaml
mechanic_scope: global
```

```yaml
mechanic_scope: chapter_relevant
```

```yaml
mechanic_scope: unresolved_gap
```

---

## 9. source_label / provenance 字段

每条 mechanic 必须标注来源可靠性。

允许值：

```yaml
source_label: canon_confirmed | inferred | human_planned | human_override | model_hypothesis | benchmark_reference
```

含义：

- `canon_confirmed`：由目标章之前的 canon/truth files 直接支持。
- `inferred`：从目标章之前的 canon/truth files 推断。
- `human_planned`：来自用户、作者或人工写作计划。
- `human_override`：人工覆盖或修正。
- `model_hypothesis`：模型推断，尚未确认。
- `benchmark_reference`：来自答案回放、目标章真实正文或对照测试；真实续写中不得使用。

旧版中的 `benchmark_reference` 不推荐用于真实续写 schema。
如果历史 instance 中存在 `benchmark_reference`，应迁移为：

```yaml
source_label: benchmark_reference
continuation_safe: false
```

---

## 10. 顶层对象：`WorldbuildingMechanicsPack`

```yaml
schema_version: "worldbuilding_world_mechanics.v0.3"
pack_id: "worldbuilding_world_mechanics_<target_chapter>_<source_mode>"
target_chapter: "<target_chapter>"

source_mode: production_clean
render_mode: clean
clean_forward_safe: true
continuation_safe: true

source_boundary:
  allowed_sources:
    - "<pre-target truth/state/rules source>"
    - "<story bible or book rules>"
    - "<pre-target chapter summaries>"
    - "<clean Active Entity Cards>"
  excluded_sources:
    - "<target chapter real manuscript>"
    - "<target chapter real trace>"
    - "<later chapter prose>"
    - "<benchmark reference>"
    - "<external LLM target-chapter prose>"
    - "<uncertain generated artifacts>"
  contamination_note: "Production-clean pack compiled only from pre-target sources."

scope:
  includes:
    - world mechanics
    - social rules
    - economy and trade constraints
    - technology constraints
    - weapon constraints
    - magic constraints
    - special profession ecology
    - detection / perception / permission mechanics
    - tactical implications
    - clean gaps and support status
  excludes:
    - full entity state
    - event order
    - author style
    - final prose
    - target-chapter transient entities not clean-supported

global_world_type:
  id: "WM-C001"
  title: "<世界类型标题>"
  category: world_type
  support_status: clean_supported
  mechanic_scope: global
  rule_statement: "<本世界的基础类型和主要机制并存方式。>"
  narrative_function: "<这条世界类型规则在渲染中的作用。>"
  allowed_rendering:
    - "<允许如何在正文中体现世界类型。>"
  forbidden_rendering:
    - "<禁止把世界写偏的方式。>"
  required_render_signals:
    - "<正文中可审计的世界类型信号。>"
  escalation_limits:
    - "<该规则不能被扩展到哪里。>"
  target_chapter_relevance: "<为什么目标章节需要这条机制。>"
  dependencies:
    entity_cards:
      - "<EC-ID>"
    truth_files:
      - "<truth file or section>"
    raw_chapters:
      - "<pre-target chapter range>"
    event_log_candidates:
      - "<optional planned event id>"
  source_label: canon_confirmed
  compiled_from: mixed
  evidence_granularity: state_summary + chapter_summary + world_rules
  source_coverage:
    evidence_count: null
    source_types:
      - truth_state
      - chapter_summary
      - book_rules
  source_basis:
    - "<人类可审计来源摘要>"
  excluded_sources:
    - "<excluded source>"
  clean_forward_safe: true
  continuation_safe: true
  contamination_note: "No target-chapter or future-source evidence used."
  confidence: high
  validation_flags:
    must_check:
      - "<审计问题>"

mechanics:
  - id: "WM-C002"
    title: "<机制标题>"
    category: "<category>"
    support_status: clean_supported
    mechanic_scope: chapter_relevant
    rule_statement: "<机制规则>"
    narrative_function: "<叙事功能>"
    allowed_rendering:
      - "<允许渲染>"
    forbidden_rendering:
      - "<禁止渲染>"
    required_render_signals:
      - "<可审计信号>"
    escalation_limits:
      - "<升级限制>"
    target_chapter_relevance: "<目标章相关性>"
    dependencies:
      entity_cards: []
      truth_files: []
      raw_chapters: []
      event_log_candidates: []
    source_label: canon_confirmed
    compiled_from: mixed
    evidence_granularity: state_summary + chapter_summary
    source_coverage:
      evidence_count: null
      source_types:
        - truth_state
        - chapter_summary
    source_basis:
      - "<来源摘要>"
    excluded_sources:
      - "<排除来源>"
    clean_forward_safe: true
    continuation_safe: true
    contamination_note: "No target-chapter or future-source evidence used."
    confidence: high
    validation_flags:
      must_check:
        - "<审计问题>"

open_questions:
  - id: "WM-GAP-001"
    title: "<clean 来源不足的机制>"
    support_status: requires_planned_source
    mechanic_scope: unresolved_gap
    note: "<说明为什么 production-clean 不足以填充>"
    allowed_next_sources:
      - human_plan
      - manual_note
      - planned_render_event_log
      - benchmark_reference_for_test_only

audit:
  required_questions:
    - "使用了哪些来源？"
    - "明确排除了哪些来源？"
    - "每条 mechanic 是否 continuation_safe？"
    - "是否有 target-chapter transient 被误写入 clean instance？"
    - "是否越权承担 Entity Cards / Render Event Log / Author Fingerprint 职责？"
    - "哪些机制是 clean_supported，哪些是 low_confidence 或 requires_planned_source？"
```

---

## 11. 顶层字段说明

### `schema_version`

类型：string
必填：是

推荐值：

```yaml
schema_version: "worldbuilding_world_mechanics.v0.3"
```

---

### `pack_id`

类型：string
必填：是

示例：

```yaml
pack_id: "worldbuilding_world_mechanics_<target_chapter>_production_clean"
```

用途：给当前 World Mechanics pack 一个稳定 ID。

---

### `target_chapter`

类型：string
必填：是

示例：

```yaml
target_chapter: "<target_chapter>"
```

---

### `source_mode`

类型：enum
必填：推荐

允许值：

```yaml
production_clean
planned
manual
hybrid_planned
model_hypothesis
benchmark_reference
```

---

### `render_mode`

类型：enum
必填：兼容旧版，推荐保留

允许值：

```yaml
clean
hybrid
benchmark_reference
```

说明：

- `source_mode` 更适合真实续写。
- `render_mode` 保留用于兼容旧 schema 和旧 instance。

---

### `clean_forward_safe`

类型：boolean
必填：是

规则：

- 完全由目标章节之前的来源支持时为 `true`。
- 使用目标章真实正文、真实 trace、后续章节、benchmark reference 时为 `false`。

---

### `continuation_safe`

类型：boolean
必填：是

规则：

- 可用于真实续写时为 `true`。
- 只适合 benchmark / 回放 / 答案分析时为 `false`。

---

### `source_boundary`

类型：object
必填：是

结构：

```yaml
source_boundary:
  allowed_sources:
    - string
  excluded_sources:
    - string
  contamination_note: string
```

用途：显式声明来源边界。

规则：

- production-clean pack 必须排除目标章正文、目标章真实 trace、后续章节、benchmark reference、外部 LLM 目标章正文、不确定生成产物。
- benchmark_reference pack 可以使用目标章真实信息，但必须明确 `continuation_safe: false`。
- 不得把 benchmark_reference 伪装成 production_clean。

---

### `scope`

类型：object
必填：是

结构：

```yaml
scope:
  includes:
    - string
  excludes:
    - string
```

用途：防止 Worldbuilding schema 吃掉其他 structured render 层。

推荐 `excludes`：

```yaml
excludes:
  - full entity state
  - event order
  - author style
  - final prose
  - target-chapter transient entities not clean-supported
```

---

### `global_world_type`

类型：`WorldMechanic` 简化对象
必填：推荐

用途：描述基础世界类型和大设定混合方式。

示例：

```yaml
global_world_type:
  id: "WM-C001"
  title: "<世界类型标题>"
  category: world_type
  rule_statement: "<世界类型规则。>"
```

---

## 12. 对象：`WorldMechanic`

每条 `mechanics` 下的机制建议使用以下结构：

```yaml
id: string
title: string
category: world_type | social_rules | economy | weapons | technology | magic | profession_ecology | detection | perception | permission | inventor_mechanics | tactical_resolution | logistics | legal_order | geography | other

support_status: clean_supported | low_confidence | not_clean_supported | requires_planned_source
mechanic_scope: global | chapter_relevant | unresolved_gap

rule_statement: string
narrative_function: string

allowed_rendering:
  - string

forbidden_rendering:
  - string

required_render_signals:
  - string

escalation_limits:
  - string

target_chapter_relevance: string

dependencies:
  entity_cards:
    - string
  truth_files:
    - string
  raw_chapters:
    - string
  event_log_candidates:
    - string

source_label: canon_confirmed | inferred | human_planned | human_override | model_hypothesis | benchmark_reference
compiled_from: truth_state | raw_chapters | event_log | human_override | human_plan | benchmark_reference | mixed
evidence_granularity: state_summary | chapter_summary | raw_line | manual_note | world_rules | trace_summary | mixed

source_coverage:
  evidence_count: number | null
  source_types:
    - truth_state
    - chapter_summary
    - raw_chapters
    - book_rules
    - story_bible
    - human_plan
    - manual_note
    - benchmark_reference

source_basis:
  - string

excluded_sources:
  - string

clean_forward_safe: boolean
continuation_safe: boolean
contamination_note: string

confidence: high | medium | low

validation_flags:
  must_check:
    - string
```

---

## 13. `WorldMechanic` 字段规则

### `id`

类型：string
必填：是

规则：

- 使用稳定 ID。
- 推荐使用 `WM-C001`、`WM-P001`、`WM-GAP-001` 或 snake_case。
- 不要把同一个 ID 用给不同机制。

示例：

```yaml
id: "WM-C001"
id: "world_type_hybrid_setting"
id: "weapon_is_object_not_stat_block"
```

---

### `title`

类型：string
必填：推荐

人类可读短标题。

示例：

```yaml
title: "武器是物件，不是属性菜单"
```

---

### `category`

类型：enum
必填：是

推荐值：

```yaml
world_type
social_rules
economy
weapons
technology
magic
profession_ecology
detection
perception
permission
inventor_mechanics
tactical_resolution
logistics
legal_order
geography
other
```

说明：

- `weapons` 用于枪械、冷兵器、载具武器、未来武器等泛武器机制。
- `technology` 用于工程、机械、电子、蒸汽、赛博、生物技术等。
- `magic` 用于法术、超自然、神术、灵能等。
- `profession_ecology` 用于施法者、骑士、工程师、赏金猎人、军官等群体生态。
- `detection` / `perception` 用于识别、侦测、幻象、感知、扫描等机制。
- `permission` 用于资格、权限、绑定、血统、接口、许可证等机制。
- `inventor_mechanics` 保留给发明家、工匠、特殊制造者相关机制。
- `other` 只在没有更合适分类时使用。

---

### `support_status`

类型：enum
必填：推荐

允许值：

```yaml
clean_supported
low_confidence
not_clean_supported
requires_planned_source
```

规则：

- clean instance 中主要使用 `clean_supported`。
- clean 支持不足但值得提醒的机制写 `low_confidence`。
- 不应把 `not_clean_supported` 写成可渲染机制。
- 需要作者计划才能出现的机制写 `requires_planned_source`。

---

### `mechanic_scope`

类型：enum
必填：推荐

允许值：

```yaml
global
chapter_relevant
unresolved_gap
```

规则：

- 长期世界规则写 `global`。
- 和目标章有关的机制写 `chapter_relevant`。
- clean 缺口写 `unresolved_gap`。

---

### `rule_statement`

类型：string
必填：是

说明这条世界机制本身是什么。

好例子：

```yaml
rule_statement: "某类技术装置需要特定材料、权限或操作者技能，不能被任何角色随手使用。"
```

坏例子：

```yaml
rule_statement: "这一段要写得酷。"
```

---

### `narrative_function`

类型：string
必填：是

说明这条机制为什么对渲染有用。

示例：

```yaml
narrative_function: "防止新设备成为万能解法，并为角色选择制造成本和权限压力。"
```

---

### `allowed_rendering`

类型：list[string]
必填：是

写 Writer 可以如何渲染这条机制。

示例：

```yaml
allowed_rendering:
  - "可以通过价格、材料、权限、损耗或使用者失误体现限制。"
  - "可以让角色误以为该机制能解决问题，再被现实条件压回。"
```

---

### `forbidden_rendering`

类型：list[string]
必填：是

写 Writer 不能如何渲染这条机制。

示例：

```yaml
forbidden_rendering:
  - "不要让新设备没有成本地解决所有问题。"
  - "不要让未具备权限的角色突然使用专属机制。"
```

---

### `required_render_signals`

类型：list[string]
必填：推荐

用于审计“这条机制是否真的进入正文”的小信号。

示例：

```yaml
required_render_signals:
  - "出现价格、权限、材料、风险或技能限制。"
  - "机制限制通过动作、对话、失败或取舍表现，而非纯旁白说明。"
```

---

### `escalation_limits`

类型：list[string]
必填：推荐

防止机制被写过头。

示例：

```yaml
escalation_limits:
  - "该机制只能解释为什么方案受限，不能自动规定事件顺序。"
  - "不得扩展成完整世界百科。"
```

---

### `target_chapter_relevance`

类型：string
必填：是

说明这条机制为什么和目标章节有关。

示例：

```yaml
target_chapter_relevance: "目标章节涉及准备、交易、试用或战术选择，因此需要明确该机制的成本和限制。"
```

---

### `dependencies`

类型：object
必填：推荐

v0.3 推荐稳定结构：

```yaml
dependencies:
  entity_cards:
    - string
  truth_files:
    - string
  raw_chapters:
    - string
  event_log_candidates:
    - string
```

用途：将 world mechanic 和其他 structured render 层建立弱连接，但不替代那些层。

规则：

- `entity_cards` 只引用实体卡，不复制实体状态。
- `truth_files` 只列来源文件或概念来源。
- `raw_chapters` 只列 pre-target chapter 范围或样本来源。
- `event_log_candidates` 只提示可能关联的 Event Log，不规定事件顺序。

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

规则：

- 真实续写中不得使用 `benchmark_reference`。
- benchmark/reference 来源必须 `continuation_safe: false`。
- 模型推断不得伪装成 canon。

---

### `compiled_from`

类型：enum
必填：是

允许值：

```yaml
truth_state
raw_chapters
event_log
human_override
human_plan
benchmark_reference
mixed
```

规则：

- production-clean 通常使用 `truth_state`、`raw_chapters`、`mixed`。
- planned instance 可使用 `human_plan`。
- benchmark 测试可使用 `benchmark_reference`，但不得用于真实续写。

---

### `evidence_granularity`

类型：enum/string
必填：是

允许值：

```yaml
state_summary
chapter_summary
raw_line
manual_note
world_rules
trace_summary
mixed
```

也可用组合形式：

```yaml
evidence_granularity: state_summary + chapter_summary + world_rules
```

用途：说明证据粒度。

---

### `source_coverage`

类型：object
必填：推荐

v0.3 新增。

结构：

```yaml
source_coverage:
  evidence_count: number | null
  source_types:
    - truth_state
    - chapter_summary
    - raw_chapters
    - book_rules
    - story_bible
    - human_plan
    - manual_note
    - benchmark_reference
```

用途：

- 辅助判断 confidence；
- 说明该机制由多少种来源支撑；
- 避免把弱推断当成强 canon。

---

### `source_basis`

类型：list[string]
必填：是

人类可审计的来源摘要。

示例：

```yaml
source_basis:
  - "<story bible>: confirms technology and magic coexist."
  - "<pre-target chapter summaries>: repeated weapon/resource limitations."
  - "<clean Active Entity Cards>: confirms entity has skill gap."
```

规则：

- 不要粘贴大量原文。
- production-clean 机制不得引用目标章真实正文、后续章节或 benchmark reference。
- benchmark 机制必须明确标记。

---

### `excluded_sources`

类型：list[string]
必填：推荐

用途：记录这条机制明确没有使用哪些来源。

production-clean 机制建议写：

```yaml
excluded_sources:
  - "<target chapter real manuscript>"
  - "<target chapter real trace>"
  - "<later chapter prose>"
  - "<benchmark reference>"
  - "<external LLM target-chapter prose>"
  - "<uncertain generated artifacts>"
```

---

### `clean_forward_safe`

类型：boolean
必填：是

规则：

- 该机制可用于 clean forward test 时为 `true`。
- 如果受到目标章真实正文、真实 trace、后续章节或 benchmark reference 影响，必须为 `false`。

---

### `continuation_safe`

类型：boolean
必填：是

规则：

- 该机制可用于真实续写时为 `true`。
- 只适合 benchmark / 回放 / 答案分析时为 `false`。

---

### `contamination_note`

类型：string
必填：是

示例：

```yaml
contamination_note: "No target-chapter or future-source evidence used."
```

```yaml
contamination_note: "Benchmark reference only; not safe for production continuation."
```

---

### `confidence`

类型：enum
必填：是

允许值：

```yaml
high
medium
low
```

含义：

- `high`：直接支持或高度确定。
- `medium`：合理推断。
- `low`：弱推断或 clean 支持不足，使用前应审计。

建议：

- `support_status: clean_supported` 可为 `high` 或 `medium`。
- `support_status: low_confidence` 通常为 `low`。
- `source_label: model_hypothesis` 通常不能高于 `medium`。
- `source_label: benchmark_reference` 可以 high，但不 continuation-safe。

---

### `validation_flags`

类型：object
必填：推荐

结构：

```yaml
validation_flags:
  must_check:
    - string
```

用途：给 Auditor 明确检查问题。

示例：

```yaml
validation_flags:
  must_check:
    - "正文是否让该机制变成万能解法？"
    - "正文是否把 low-confidence clean gap 当成已确认 canon？"
```

---

## 14. 推荐机制分类

### 14.1 `world_type`

用于基础世界类型。

例：

- 多机制混合世界；
- 科技与魔法并存；
- 边境社会；
- 帝国/都市/废土/太空殖民等基础世界结构。

---

### 14.2 `social_rules`

用于偏见、阶层、种族、声望、身份、地方权威、职业地位、社会承认方式。

例：

- 社会偏见仍存在；
- 声望可改变局部待遇；
- 某些身份会影响交易、执法或公共空间互动。

---

### 14.3 `economy`

用于金钱、赏金、信用、票据、稀缺性、价格、库存、资源取舍。

例：

- 有报酬不等于无限预算；
- 高级装备或服务昂贵且稀缺；
- 普通资源可获得，高端资源需要计划或代价。

---

### 14.4 `weapons`

用于武器操作、维护、弹药、耐久、携带、精度、训练、使用者技能。

例：

- 武器是物件，不是属性菜单；
- 新武器改善可靠性，但不自动提升使用者能力；
- 近战/远程/重武器/轻武器各有取舍。

---

### 14.5 `technology`

用于机械、工程、电子、蒸汽、赛博、生物技术、AI、载具、能源等。

例：

- 技术装置需要材料、维护、权限或操作者；
- 技术可辅助观察/行动，但不能自动解决冲突；
- 新技术暴露新限制。

---

### 14.6 `magic`

用于法术、魔法物品、超自然力量、神术、灵能、诅咒等。

例：

- 魔法存在但不能按需成为解法；
- 高级魔法昂贵、稀缺或受权限限制；
- 低阶魔法也可能有战术价值，但不能变万能。

---

### 14.7 `profession_ecology`

用于特定职业或群体在世界中的生态位置。

例：

- 施法者生态；
- 工程师/发明家生态；
- 佣兵/赏金猎人生态；
- 贵族/军官/神职人员生态。

---

### 14.8 `detection`

用于侦测、扫描、看穿、识别、追踪、验真等机制。

例：

- 看见和理解是两回事；
- 识别目标不等于击中目标；
- 侦测工具不能自动共享给所有人。

---

### 14.9 `perception`

用于感官、视野、误判、幻象、信息差、认知限制。

例：

- 角色只能根据可见信息判断；
- 感知优势必须受角度、距离、噪声或误导影响。

---

### 14.10 `permission`

用于权限、绑定、资质、血统、接口、许可证、职业资格等。

例：

- 某工具只有特定角色或权限者可用；
- 可识别不等于可操作；
- 可拥有不等于可安全使用。

---

### 14.11 `inventor_mechanics`

用于发明家、工匠、维修者、特殊制造者、装置维护者等机制。

例：

- 发明能力有载体和边界；
- 维护能力不等于战斗万能；
- 工具可解决小问题，同时暴露新问题。

---

### 14.12 `tactical_resolution`

用于章节级机制矛盾和战术边界。

例：

- 准备不等于胜利；
- 新工具改善一个问题，但留下另一个问题；
- 目标章可以建立行动压力，但不得提前解决未来敌人。

---

### 14.13 `logistics`

用于运输、补给、时间、距离、天气、可携带性、维护资源。

---

### 14.14 `legal_order`

用于法律、执法、许可证、通缉、契约、债务、地方权力。

---

### 14.15 `geography`

用于地形、距离、城镇结构、边境、道路、关卡、环境压力。

---

## 15. Clean Gap / Open Question 规则

如果某机制对目标章可能重要，但 production-clean 来源不足，不要强行写成 confirmed mechanic。

应该放入：

```yaml
open_questions:
  - id: "WM-GAP-001"
    title: "<机制缺口>"
    support_status: requires_planned_source
    mechanic_scope: unresolved_gap
    note: "<clean 来源为什么不足>"
    allowed_next_sources:
      - human_plan
      - manual_note
      - planned_render_event_log
      - benchmark_reference_for_test_only
```

规则：

- clean gap 可以提醒 assembly，但不得直接驱动 Renderer 展开细节。
- planned/manual 来源可以补强 clean gap。
- benchmark_reference 只能用于测试，不得用于真实续写。
- 如果后续补强，应生成 planned instance，不要回写 production-clean instance。

---

## 16. 最小验证规则

生成的 worldbuilding pack 至少需要通过以下检查：

1. 声明 `schema_version`。
2. 声明 `target_chapter`。
3. 声明 `source_mode`。
4. 声明 `clean_forward_safe`。
5. 声明 `continuation_safe`。
6. 声明 `source_boundary`。
7. 声明 `scope`。
8. 每条 mechanic 都有：
   - `id`
   - `title`
   - `category`
   - `support_status`
   - `mechanic_scope`
   - `rule_statement`
   - `narrative_function`
   - `allowed_rendering`
   - `forbidden_rendering`
   - `required_render_signals`
   - `escalation_limits`
   - `target_chapter_relevance`
   - `dependencies`
   - `source_label`
   - `compiled_from`
   - `evidence_granularity`
   - `source_coverage`
   - `source_basis`
   - `excluded_sources`
   - `clean_forward_safe`
   - `continuation_safe`
   - `contamination_note`
   - `confidence`
   - `validation_flags`
9. continuation-safe pack 不得使用 `benchmark_reference` 作为可渲染机制来源。
10. production-clean pack 不得引用目标章真实正文、真实 trace、后续章节或 benchmark reference。
11. mechanic 不得包含事件顺序。
12. mechanic 不得包含文风指令。
13. mechanic 不得替代 Entity Cards。
14. mechanic 不得替代 Render Event Log。
15. mechanic 不得替代 Author Fingerprint。
16. mechanic 不得要求 Writer 暴露未来信息，除非 `source_mode: benchmark_reference` 且 `continuation_safe: false`。

---

## 17. Auditor Checklist

用于审计生成正文或 structured render packet 是否遵守 Worldbuilding / World Mechanics。

```yaml
worldbuilding_audit:
  source_boundary:
    checked: true
    issue: null

  continuation_safety:
    checked: true
    issue: null

  benchmark_contamination:
    checked: true
    issue: null

  future_source_leak:
    checked: true
    issue: null

  mechanic_coverage:
    checked: true
    missing_mechanics:
      - string

  clean_gap_handling:
    checked: true
    unresolved_gaps:
      - string
    incorrectly_promoted_gaps:
      - string

  overreach:
    checked: true
    issues:
      - string

  forbidden_rendering_violations:
    checked: true
    violations:
      - mechanic_id: string
        issue: string

  event_log_leakage:
    checked: true
    issue: null

  entity_card_leakage:
    checked: true
    issue: null

  author_fingerprint_leakage:
    checked: true
    issue: null

  final_judgment:
    pass: true
    notes:
      - string
```

审计重点：

- 机制是否被写成事件顺序？
- 世界规则是否被写成百科？
- 新装备/新技术/新魔法/新情报是否变成万能解法？
- benchmark / future source 是否被伪装成 clean？
- low-confidence gap 是否被当成 confirmed canon？
- 是否把实体状态塞进了 world mechanics？
- 是否把 prose style 塞进了 world mechanics？
- 是否把 Event Log 的事件顺序塞进了 world mechanics？

---

## 18. TypeScript 参考接口

字段名保留英文，便于后续程序使用；注释和文档以中文为主。

```ts
export type SourceMode =
  | "production_clean"
  | "planned"
  | "manual"
  | "hybrid_planned"
  | "model_hypothesis"
  | "benchmark_reference";

export type RenderMode =
  | "clean"
  | "hybrid"
  | "benchmark_reference";

export type WorldMechanicCategory =
  | "world_type"
  | "social_rules"
  | "economy"
  | "weapons"
  | "technology"
  | "magic"
  | "profession_ecology"
  | "detection"
  | "perception"
  | "permission"
  | "inventor_mechanics"
  | "tactical_resolution"
  | "logistics"
  | "legal_order"
  | "geography"
  | "other";

export type SupportStatus =
  | "clean_supported"
  | "low_confidence"
  | "not_clean_supported"
  | "requires_planned_source";

export type MechanicScope =
  | "global"
  | "chapter_relevant"
  | "unresolved_gap";

export type SourceLabel =
  | "canon_confirmed"
  | "inferred"
  | "human_planned"
  | "human_override"
  | "model_hypothesis"
  | "benchmark_reference";

export type CompiledFrom =
  | "truth_state"
  | "raw_chapters"
  | "event_log"
  | "human_override"
  | "human_plan"
  | "benchmark_reference"
  | "mixed";

export type EvidenceGranularity =
  | "state_summary"
  | "chapter_summary"
  | "raw_line"
  | "manual_note"
  | "world_rules"
  | "trace_summary"
  | "mixed"
  | string;

export type Confidence = "high" | "medium" | "low";

export interface SourceBoundary {
  allowed_sources: string[];
  excluded_sources: string[];
  contamination_note: string;
}

export interface ScopeBoundary {
  includes: string[];
  excludes: string[];
}

export interface MechanicDependencies {
  entity_cards?: string[];
  truth_files?: string[];
  raw_chapters?: string[];
  event_log_candidates?: string[];
}

export interface SourceCoverage {
  evidence_count: number | null;
  source_types: Array<
    | "truth_state"
    | "chapter_summary"
    | "raw_chapters"
    | "book_rules"
    | "story_bible"
    | "human_plan"
    | "manual_note"
    | "benchmark_reference"
    | string
  >;
}

export interface ValidationFlags {
  must_check: string[];
}

export interface WorldMechanic {
  id: string;
  title: string;
  category: WorldMechanicCategory;

  support_status: SupportStatus;
  mechanic_scope: MechanicScope;

  rule_statement: string;
  narrative_function: string;

  allowed_rendering: string[];
  forbidden_rendering: string[];
  required_render_signals: string[];
  escalation_limits: string[];

  target_chapter_relevance: string;

  dependencies: MechanicDependencies;

  source_label: SourceLabel;
  compiled_from: CompiledFrom;
  evidence_granularity: EvidenceGranularity;

  source_coverage: SourceCoverage;
  source_basis: string[];
  excluded_sources: string[];

  clean_forward_safe: boolean;
  continuation_safe: boolean;
  contamination_note: string;

  confidence: Confidence;

  validation_flags: ValidationFlags;
}

export interface OpenQuestion {
  id: string;
  title: string;
  support_status: "requires_planned_source" | "not_clean_supported" | "low_confidence";
  mechanic_scope: "unresolved_gap";
  note: string;
  allowed_next_sources: string[];
}

export interface WorldbuildingMechanicsPack {
  schema_version: "worldbuilding_world_mechanics.v0.3";
  pack_id: string;
  target_chapter: string;

  source_mode: SourceMode;
  render_mode?: RenderMode;

  clean_forward_safe: boolean;
  continuation_safe: boolean;

  source_boundary: SourceBoundary;
  scope: ScopeBoundary;

  global_world_type?: Partial<WorldMechanic>;
  mechanics: WorldMechanic[];

  open_questions?: OpenQuestion[];

  audit?: {
    required_questions: string[];
  };
}
```

---

## 19. Production-clean instance 最小模板

```yaml
schema_version: "worldbuilding_world_mechanics.v0.3"
pack_id: "worldbuilding_world_mechanics_<target_chapter>_production_clean"
target_chapter: "<target_chapter>"

source_mode: production_clean
render_mode: clean
clean_forward_safe: true
continuation_safe: true

source_boundary:
  allowed_sources:
    - "<pre-target truth/state file>"
    - "<story bible>"
    - "<book rules>"
    - "<pre-target chapter summaries>"
    - "<clean Active Entity Cards>"
  excluded_sources:
    - "<target chapter real manuscript>"
    - "<target chapter real trace>"
    - "<later chapter prose>"
    - "<benchmark reference>"
    - "<external LLM target-chapter prose>"
    - "<uncertain generated artifacts>"
  contamination_note: "Production-clean pack compiled only from pre-target sources."

scope:
  includes:
    - world mechanics
    - social rules
    - economy and trade constraints
    - technology constraints
    - weapon constraints
    - magic constraints
    - profession ecology support status
    - tactical implications
  excludes:
    - full entity state
    - event order
    - author style
    - final prose
    - target-chapter transient entities not clean-supported

global_world_type:
  id: "WM-C001"
  title: "<世界类型标题>"
  category: world_type
  support_status: clean_supported
  mechanic_scope: global
  rule_statement: "<pre-target 来源确认的基础世界类型。>"
  narrative_function: "<防止世界类型漂移。>"
  allowed_rendering:
    - "<允许如何体现世界类型。>"
  forbidden_rendering:
    - "<禁止如何写偏。>"
  required_render_signals:
    - "<可审计信号。>"
  escalation_limits:
    - "<不得升级到哪里。>"
  target_chapter_relevance: "<目标章为什么需要这条机制。>"
  dependencies:
    entity_cards: []
    truth_files: []
    raw_chapters: []
    event_log_candidates: []
  source_label: canon_confirmed
  compiled_from: mixed
  evidence_granularity: state_summary + chapter_summary + world_rules
  source_coverage:
    evidence_count: null
    source_types:
      - truth_state
      - chapter_summary
      - book_rules
  source_basis:
    - "<来源摘要>"
  excluded_sources:
    - "<target chapter real manuscript>"
    - "<later chapter prose>"
    - "<benchmark reference>"
  clean_forward_safe: true
  continuation_safe: true
  contamination_note: "No target-chapter or future-source evidence used."
  confidence: high
  validation_flags:
    must_check:
      - "<审计问题>"

mechanics:
  - id: "WM-C002"
    title: "<机制标题>"
    category: "<category>"
    support_status: clean_supported
    mechanic_scope: chapter_relevant
    rule_statement: "<机制规则。>"
    narrative_function: "<叙事功能。>"
    allowed_rendering:
      - "<允许渲染。>"
    forbidden_rendering:
      - "<禁止渲染。>"
    required_render_signals:
      - "<可审计信号。>"
    escalation_limits:
      - "<升级限制。>"
    target_chapter_relevance: "<目标章相关性。>"
    dependencies:
      entity_cards:
        - "<EC-ID>"
      truth_files:
        - "<truth source>"
      raw_chapters:
        - "<pre-target chapter range>"
      event_log_candidates:
        - "<optional planned event id>"
    source_label: canon_confirmed
    compiled_from: mixed
    evidence_granularity: state_summary + chapter_summary
    source_coverage:
      evidence_count: null
      source_types:
        - truth_state
        - chapter_summary
    source_basis:
      - "<来源摘要。>"
    excluded_sources:
      - "<target chapter real manuscript>"
      - "<later chapter prose>"
      - "<benchmark reference>"
    clean_forward_safe: true
    continuation_safe: true
    contamination_note: "No target-chapter or future-source evidence used."
    confidence: high
    validation_flags:
      must_check:
        - "<审计问题>"

open_questions:
  - id: "WM-GAP-001"
    title: "<clean 支持不足的机制>"
    support_status: requires_planned_source
    mechanic_scope: unresolved_gap
    note: "<说明为什么 clean 来源不足。>"
    allowed_next_sources:
      - human_plan
      - manual_note
      - planned_render_event_log
      - benchmark_reference_for_test_only

audit:
  required_questions:
    - "是否使用了 target/future/benchmark source？"
    - "是否把 clean gap 当成 confirmed mechanic？"
    - "是否越权承担 Entity Cards / Render Event Log / Author Fingerprint 职责？"
```

---

## 20. Planned instance 指南

如果某机制来自作者计划，而不是 pre-target canon，应使用 planned instance：

```yaml
source_mode: planned
clean_forward_safe: true
continuation_safe: true
source_label: human_planned
support_status: requires_planned_source
```

使用场景：

- 作者明确计划目标章出现某种商品、场景、装置、规则；
- Render Event Log 需要某机制支撑，但 clean 来源不足；
- 人工 worldbuilding note 给出了目标章允许使用的机制。

规则：

- planned 信息可以用于真实续写。
- planned 信息不能伪装成 `canon_confirmed`。
- planned 信息不得使用目标章真实正文或后续章节。
- planned 信息应在 `source_basis` 中指向 human plan / manual note。

---

## 21. Benchmark reference 指南

如果某机制来自真实目标章、目标章 trace、后续章节、benchmark reference 或回放答案，应使用：

```yaml
source_mode: benchmark_reference
clean_forward_safe: false
continuation_safe: false
source_label: benchmark_reference
compiled_from: benchmark_reference
```

规则：

- 只能用于 schema fit test、回放、分析、upper-bound 对照。
- 不得用于真实续写。
- 不得回写 production-clean instance。
- 不得伪装成 pre-target canon。

---

## 22. 常见失败模式

### 22.1 世界规则百科化

错误：

```text
本世界的完整设定如下……
```

问题：World Mechanics 被写成百科说明，而不是渲染约束。

修正：mechanic 应写“允许如何渲染 / 禁止如何渲染 / 可审计信号”。

---

### 22.2 越权写事件顺序

错误：

```yaml
rule_statement: "角色先去地点 A，再遇到人物 B，然后发生事件 C。"
```

问题：这是 Render Event Log，不是 World Mechanics。

修正：World Mechanics 只能说明机制如何运作，不规定事件顺序。

---

### 22.3 复制实体状态

错误：

```yaml
rule_statement: "角色 A 当前穿着什么、拿着什么、和谁关系如何……"
```

问题：这是 Active Entity Cards。

修正：World Mechanics 只引用实体卡 ID，不复制完整实体状态。

---

### 22.4 写作者风格

错误：

```yaml
rule_statement: "这段要用短句、吐槽、对白密集。"
```

问题：这是 Author Fingerprint。

修正：World Mechanics 只规定世界机制，不规定句法和文风。

---

### 22.5 把新机制写成万能解法

错误：

```text
新工具一出现就解决所有任务问题。
```

问题：违反机制边界。

修正：每条新机制都应有成本、权限、风险、稀缺、技能或使用条件。

---

### 22.6 clean gap 被当成 canon

错误：

```yaml
support_status: low_confidence
rule_statement: "该机制被当成确定世界规则详细展开。"
```

问题：低置信 gap 被过度确定化。

修正：low-confidence 机制只能提示风险，不能未经 planned/manual 补强就写成详细规则。

---

### 22.7 benchmark 污染真实续写

错误：

```yaml
source_mode: production_clean
source_basis:
  - "<target chapter real manuscript>"
```

问题：真实续写偷看答案。

修正：使用真实目标章或 benchmark reference 时必须 `source_mode: benchmark_reference`，并 `continuation_safe: false`。

---

## 23. PR 定位

本 schema 应定位为：

```text
Worldbuilding / World Mechanics = 世界机制与机制边界包
```

它不替代 InkOS 既有 truth files，也不替代 planner。

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

## 24. v0.3 修改摘要

相对 v0.2，本版做了以下修改：

- 移除具体作品、具体角色、具体章节、具体项目实例。
- 增加 `source_mode`，支持 `production_clean | planned | manual | hybrid_planned | model_hypothesis | benchmark_reference`。
- 增加 `continuation_safe`，与真实续写安全边界对齐。
- 增加 `support_status`：
  - `clean_supported`
  - `low_confidence`
  - `not_clean_supported`
  - `requires_planned_source`
- 增加 `mechanic_scope`：
  - `global`
  - `chapter_relevant`
  - `unresolved_gap`
- 增加 `source_coverage`，用于记录 evidence_count 和 source_types。
- 稳定 `dependencies` 子字段：
  - `entity_cards`
  - `truth_files`
  - `raw_chapters`
  - `event_log_candidates`
- 将历史 `benchmark_reference` 概念迁移为 `benchmark_reference`。
- 明确 benchmark/reference 只能用于测试/回放，不得用于真实续写。
- 强化 clean gap / open question 处理规则。
- 强化 World Mechanics 不接管 Entity Cards / Render Event Log / Author Fingerprint 的边界。
- 保留中文主说明和英文字段名，便于人读和程序处理。
