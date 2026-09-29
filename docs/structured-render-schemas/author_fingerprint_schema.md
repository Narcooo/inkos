# Author Fingerprint Schema v0.3 中文主版

## 1. 用途

`Author Fingerprint` 用于描述目标章节渲染时应遵守的作者风格、叙事节奏、角色声音、说明方式、转场方式、笑点功能和禁止漂移。

它只回答一个问题：

> Renderer 应该如何把结构化事件、实体状态和世界机制渲染成接近目标作者风格的自然小说正文？

本文件不是 Entity Cards schema。
实体当前状态、人物关系、装备归属、秘密边界属于 `Active Entity Cards`。

本文件不是 Worldbuilding / World Mechanics schema。
世界规则、技术规则、魔法规则、经济规则、战术机制属于 `Worldbuilding / World Mechanics`。

本文件不是 Render Event Log schema。
事件顺序、章节 beat、转场链、目标字数、event-level must render 属于 `Render Event Log`。

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
author_fingerprint_schema.md
  -> 通用 schema，只定义结构和规则

author_fingerprint_<target_chapter>_from_<source_range>.md
  -> 某目标章节的 production-clean / continuation-safe instance

author_fingerprint_<target_chapter>_planned.md
  -> 某目标章节的 planned instance

author_fingerprint_<target_chapter>_benchmark_reference.md
  -> benchmark / 回放测试 instance，不用于真实续写

author_fingerprint_schema_test_report_<target_chapter>.md
  -> schema fit 测试报告
```

---

## 3. 核心边界

Author Fingerprint 可以包含：

- InkOS 原生 style profile 统计；
- 句长、段长、词汇多样性等统计；
- 对白比例、叙述比例等样本计算统计；
- 标点使用画像；
- 高频句首模式；
- 修辞特征；
- 作者叙事机制；
- Renderer 可执行风格规则；
- 节奏约束；
- 转场模式；
- 角色声音 profile；
- 禁止文风漂移；
- 审计检查项。

Author Fingerprint 不应包含：

- 完整实体状态；
- 人物长期关系；
- 世界规则百科；
- 事件顺序；
- 章节 beat sequence；
- 目标章真实正文；
- 后续章节信息；
- benchmark reference；
- 目标章 benchmark_reference / benchmark 事件内容；
- 最终小说正文。

---

## 4. Source Mode / 来源模式

每个 Author Fingerprint pack 必须声明来源模式。

合法 `source_mode`：

```yaml
source_mode: production_clean | planned | manual | hybrid_planned | model_hypothesis | benchmark_reference
```

推荐真实续写使用：

```yaml
source_mode: production_clean
clean_forward_safe: true
continuation_safe: true
```

或：

```yaml
source_mode: planned
clean_forward_safe: true
continuation_safe: true
```

---

## 5. source_mode 定义

### `production_clean`

只使用目标章节之前已经可用的 style profile、style guide、样本文本、truth/state/rules 信息。

适合真实续写。

```yaml
source_mode: production_clean
clean_forward_safe: true
continuation_safe: true
```

---

### `planned`

使用目标章节之前的信息，加上用户、作者或人工写作计划提供的风格目标。

适合真实续写。

```yaml
source_mode: planned
clean_forward_safe: true
continuation_safe: true
```

注意：`planned` 可以包含“作者希望本章采用的风格策略”，但不能伪装成已观测作者统计。

---

### `manual`

主要由人工指定风格规则。

适合真实续写、人工控制测试或编辑流程。

```yaml
source_mode: manual
continuation_safe: true
```

---

### `hybrid_planned`

production-clean 信息、人工计划、少量模型推断混合，但不使用目标章真实正文或后续章节。

适合真实续写，但需要更强审计。

```yaml
source_mode: hybrid_planned
continuation_safe: true
```

---

### `model_hypothesis`

模型推断的风格规则，尚未确认。

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

真实续写可用的 Author Fingerprint pack 应写：

```yaml
continuation_safe: true
```

如果该 pack 完全来自目标章节之前的 clean 来源，也应写：

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

## 7. LLM-native but validator-gated 原则

Author Fingerprint 可以由 LLM 生成 draft，但不能直接把裸 LLM 输出当成可信作者指纹。

推荐原则：

```text
LLM may draft, validators must gate.
LLM may interpret metrics, but must not invent metrics.
LLM may infer style rules, but provenance must label inference.
LLM may propose character voices, but sample_count and source range must be exposed.
Renderer input must be accepted packet, not raw LLM draft.
```

中文原则：

```text
LLM 可以生成草稿，但 validator 决定是否放行。
LLM 可以解释统计，但不能伪造统计。
LLM 可以推断风格规则，但必须标明推断来源。
LLM 可以提出角色声音，但必须暴露样本数量和样本来源范围。
Renderer 只能吃通过校验的 packet，不能直接吃裸 LLM 输出。
```

---

## 8. 顶层对象：`AuthorFingerprintPack`

```yaml
schema_version: "author_fingerprint.v0.3"
pack_id: "author_fingerprint_<target_chapter>_<source_range>"
target_chapter: "<target_chapter>"

source_mode: production_clean
clean_forward_safe: true
continuation_safe: true

source_boundary:
  allowed_sources:
    - "<style_profile.json>"
    - "<style_guide.md>"
    - "<author_intent.md>"
    - "<pre-target chapter samples>"
    - "<pre-target truth/state files>"
    - "<clean Active Entity Cards>"
  excluded_sources:
    - "<target chapter real manuscript>"
    - "<target chapter real trace>"
    - "<later chapter prose>"
    - "<benchmark reference>"
    - "<external LLM target-chapter prose>"
    - "<uncertain generated artifacts>"
  contamination_note: "Production-clean pack compiled only from pre-target style/statistical sources."

inkos_style_profile:
  metrics_status: partial
  source_files:
    - "<style_profile.json>"
    - "<style_guide.md>"
  quantitative_metrics: {}
  sentence_opening_patterns: []
  punctuation_profile: {}
  rhetorical_features: []
  character_dialogue_fingerprints: []

creative_mechanics_profile:
  source_file: "<style guide or author mechanics file>"
  source_status: original | equivalent_summary | missing
  source_note: "<说明机制来源>"
  sample_count: null
  category_coverage: []
  emergent_rules: []
  mechanism_rules: []

render_execution_rules: []

rhythm_constraints: {}

transition_patterns: []

character_voice_profiles: []

chapter_specific_style_constraints: []

forbidden_style_drifts: []

audit:
  required_checks: []
```

---

## 9. 顶层字段说明

### `schema_version`

类型：string
必填：是

推荐值：

```yaml
schema_version: "author_fingerprint.v0.3"
```

---

### `pack_id`

类型：string
必填：是

示例：

```yaml
pack_id: "author_fingerprint_<target_chapter>_from_<source_range>"
```

用途：给当前 Author Fingerprint pack 一个稳定 ID。

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
必填：是

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

规则：

- production-clean pack 必须排除目标章正文、目标章真实 trace、后续章节、benchmark reference、外部 LLM 目标章正文、不确定生成产物。
- benchmark_reference pack 可以使用目标章真实信息，但必须明确 `continuation_safe: false`。
- 不得把 benchmark_reference 伪装成 production_clean。

---

## 10. `inkos_style_profile`

该部分用于承接 InkOS 原生作者指纹统计和本地可复现样本统计。

结构：

```yaml
inkos_style_profile:
  metrics_status: complete | partial | missing | unknown

  source_files:
    - string

  quantitative_metrics:
    avg_sentence_length:
      value: number | null
      unit: chars | words | tokens | sentences | percent | fraction | unknown
      source_label: inkos_style_profile | computed_from_chapters | computed_sample | manual_estimate | unknown
      confidence: high | medium | low | unknown

    sentence_length_stddev:
      value: number | null
      unit: chars | words | tokens | unknown
      source_label: inkos_style_profile | computed_from_chapters | computed_sample | manual_estimate | unknown
      confidence: high | medium | low | unknown

    avg_paragraph_length:
      value: number | null
      unit: chars | words | tokens | sentences | unknown
      source_label: inkos_style_profile | computed_from_chapters | computed_sample | manual_estimate | unknown
      confidence: high | medium | low | unknown

    paragraph_length_range:
      min: number | null
      max: number | null
      unit: chars | words | tokens | sentences | unknown
      source_label: inkos_style_profile | computed_from_chapters | computed_sample | manual_estimate | unknown
      confidence: high | medium | low | unknown

    dialogue_ratio:
      value: number | null
      unit: percent | fraction | unknown
      source_label: inkos_style_profile | computed_from_chapters | computed_sample | manual_estimate | unknown
      confidence: high | medium | low | unknown

    narration_ratio:
      value: number | null
      unit: percent | fraction | unknown
      source_label: inkos_style_profile | computed_from_chapters | computed_sample | manual_estimate | unknown
      confidence: high | medium | low | unknown

    type_token_ratio:
      value: number | null
      unit: ratio | unknown
      source_label: inkos_style_profile | computed_from_chapters | computed_sample | manual_estimate | unknown
      confidence: high | medium | low | unknown
```

---

## 11. 数值统计规则

### 11.1 不得伪造统计

如果某项 InkOS 原生统计不存在，不要猜数字。

必须写：

```yaml
value: null
unit: unknown
source_label: unknown
confidence: unknown
```

---

### 11.2 样本计算必须标注

如果某项来自本地章节样本计算，而不是 InkOS 原生统计，必须明确标注：

```yaml
source_label: computed_from_chapters
confidence: medium
```

或：

```yaml
source_label: computed_sample
confidence: medium
```

---

### 11.3 单位不明不得强解释

如果 InkOS 原生统计存在但未声明单位，应写：

```yaml
unit: unknown
confidence: medium
```

Renderer / Assembly 不得把 `unit: unknown` 的数值当成强硬字数规则。

错误用法：

```text
avg_paragraph_length: 1600，因此每段必须写 1600 字。
```

正确用法：

```text
该数值只作为节奏诊断，不作为硬性段落长度。
```

---

### 11.4 LLM 不得发明 metrics

LLM 可以解释统计含义，但不能创造不存在的统计。

允许：

```text
根据 avg_sentence_length 和 qualitative fallback，建议避免长篇连续说明。
```

禁止：

```text
模型自行估算 dialogue_ratio 为 43%。
```

---

## 12. `sentence_opening_patterns`

用于记录高频句首模式。

结构：

```yaml
sentence_opening_patterns:
  - pattern: string
    frequency: number | null
    source_label: inkos_style_profile | computed_from_chapters | computed_sample | manual_estimate | unknown
    usage_note: string
```

规则：

- 高频句首只能作为诊断信号，不应强迫 Renderer 重复特定词。
- 如果 pattern 是具体角色名，在通用 schema 中用占位符；具体角色名只应出现在 instance 文件中。
- 不要为了模仿风格而机械复读 top pattern。

示例：

```yaml
sentence_opening_patterns:
  - pattern: "<high-frequency opening pattern>"
    frequency: null
    source_label: inkos_style_profile
    usage_note: "Use as rhythm signal, not as phrase to force into prose."
```

---

## 13. `punctuation_profile`

用于描述标点节奏。

结构：

```yaml
punctuation_profile:
  question_mark_usage: low | medium | high | unknown
  exclamation_usage: low | medium | high | unknown
  dash_usage: low | medium | high | unknown
  ellipsis_usage: low | medium | high | unknown
  quote_density: low | medium | high | unknown
  notes:
    - string
```

规则：

- 如果标点画像来自样本计算，notes 中应说明 `source_label: computed_from_chapters` 或等价说明。
- 标点画像用于节奏控制，不用于强迫机械插入标点。
- 不要把破折号、感叹号、省略号用于过度戏剧化。

---

## 14. `rhetorical_features`

用于记录修辞特征和作者常见表达机制。

结构：

```yaml
rhetorical_features:
  - feature: string
    observed_strength: weak | medium | strong | unknown
    usage_note: string
    source_label: inkos_style_profile | style_guide | computed_from_chapters | manual_note | model_hypothesis | unknown
```

规则：

- `inkos_style_profile` 来源用于原生统计或分析结果。
- `style_guide` 来源用于 InkOS 风格指南。
- `computed_from_chapters` 来源用于脚本从样本计算或抽取的特征。
- `model_hypothesis` 必须谨慎，不能伪装成观测事实。

---

## 15. `character_dialogue_fingerprints`

用于记录角色对白统计，不替代完整角色声音 profile。

结构：

```yaml
character_dialogue_fingerprints:
  - character_id: string
    source_status: extracted | manual | mixed | missing | unknown
    sample_count: number | null
    sample_source_range: string | null
    average_line_length:
      value: number | null
      unit: chars | words | tokens | unknown
      source_label: computed_from_chapters | computed_sample | inkos_style_profile | manual_estimate | unknown
      confidence: high | medium | low | unknown
    diction_traits:
      - string
    rhythm_traits:
      - string
    taboo_drifts:
      - string
```

规则：

- `sample_count` 必须说明样本数量。
- `sample_source_range` 必须说明样本来源范围。
- 样本少的角色应降低 confidence 或在 notes 中说明。
- 该部分只记录统计摘要；可执行角色声音规则应写入 `character_voice_profiles`。

---

## 16. `creative_mechanics_profile`

该部分用于承接作者创作机制、风格机制、叙事习惯和等价机制摘要。

结构：

```yaml
creative_mechanics_profile:
  source_file: string | null
  source_status: original | equivalent_summary | missing
  source_note: string
  sample_count: number | null

  category_coverage:
    - category_id: string
      category_name: string
      evidence_count: number | null
      strength: weak | medium | strong | unknown
      render_use: string

  emergent_rules:
    - rule_id: string
      title: string
      description: string
      coverage: weak | medium | strong | universal | unknown
      render_implication: string

  mechanism_rules:
    - rule_id: string
      title: string
      pattern:
        - string
      allowed_use:
        - string
      forbidden_use:
        - string
      example_function:
        - string
      confidence: high | medium | low | unknown
```

---

## 17. creative_mechanics_profile.source_status

合法值：

```yaml
source_status: original | equivalent_summary | missing
```

含义：

- `original`：找到原始 author creative mechanics 文件。
- `equivalent_summary`：未找到原始文件，但使用 style guide、style profile、作者意图或等价摘要。
- `missing`：没有找到可用机制文件或摘要。

规则：

- 不得把 `_quarantine` 或不确定生成产物伪装成原始机制文件。
- 如果只使用等价摘要，必须写：

  ```yaml
  source_status: equivalent_summary
  ```
- 如果缺失，不要伪造机制文件路径。

---

## 18. `render_execution_rules`

该部分是 Author Fingerprint 最关键的可执行层。
它把统计和风格观察转成 Renderer 可遵守的写作规则。

结构：

```yaml
render_execution_rules:
  - rule_id: string
    priority: critical | high | medium | low
    rule_statement: string
    applies_to:
      - string
    allowed_rendering:
      - string
    forbidden_rendering:
      - string
    audit_question: string
    source_label: inkos_mechanic | style_guide | computed_from_chapters | manual_style_rule | model_hypothesis | benchmark_reference
    confidence: high | medium | low | unknown
```

推荐至少覆盖：

```yaml
recommended_render_execution_rules:
  - event_not_outline
  - object_triggered_exposition
  - exposition_with_friction
  - novelty_limited
  - multi_function_event
  - comedy_with_function
  - concrete_closure
  - character_voice_separation
  - no_prompt_language_leak
```

---

## 19. 推荐 render_execution_rules

### 19.1 event_not_outline

```yaml
rule_id: style_rule_event_not_outline
priority: critical
rule_statement: "不要把 Event Log 渲染成 checklist；每个重要 event 必须变成可见动作、物件、对白或场景移动。"
applies_to:
  - prose_rendering
  - event_transition
allowed_rendering:
  - "Use object handling, dialogue interruption, physical movement, or consequence to move between events."
forbidden_rendering:
  - "Do not write 'they discussed X' as a substitute for scene."
  - "Do not expose event IDs or schema terms."
audit_question: "Can the reader see the event happening rather than being told it happened?"
source_label: style_guide
confidence: high
```

---

### 19.2 object_triggered_exposition

```yaml
rule_id: style_rule_object_triggered_exposition
priority: high
rule_statement: "设定应从物件、动作、交易、试用、误解、价格或风险中冒出。"
applies_to:
  - world_mechanic_release
  - dialogue
allowed_rendering:
  - "Let concrete objects, physical action, price, failure, risk, or character reaction trigger explanation."
forbidden_rendering:
  - "Do not paste a detached worldbuilding paragraph into narration."
audit_question: "Does the rule emerge from something visible?"
source_label: style_guide
confidence: high
```

---

### 19.3 exposition_with_friction

```yaml
rule_id: style_rule_exposition_with_friction
priority: high
rule_statement: "说明必须有摩擦：动作打断、吐槽、成本、权限、危险、误会或现实反压。"
applies_to:
  - mechanism_explanation
allowed_rendering:
  - "Break explanations with action, testing, correction, price, awkwardness, danger, or role-specific reaction."
forbidden_rendering:
  - "Do not allow uninterrupted lecture blocks when a scene action can carry the same information."
audit_question: "Is exposition resisted by scene pressure?"
source_label: style_guide
confidence: high
```

---

### 19.4 novelty_limited

```yaml
rule_id: style_rule_novelty_limited
priority: high
rule_statement: "新奇素材必须立刻带限制。"
applies_to:
  - new_weapon
  - magic
  - machine
  - technology
  - new_information
allowed_rendering:
  - "Attach price, rarity, skill, permission, risk, uncertainty, or tactical cost to every cool option."
forbidden_rendering:
  - "Do not let a new tool, spell, machine, or idea solve the chapter by itself."
audit_question: "Does every cool thing meet a limit quickly?"
source_label: style_guide
confidence: high
```

---

### 19.5 multi_function_event

```yaml
rule_id: style_rule_multi_function_event
priority: medium
rule_statement: "每个重要 event 尽量承担两个以上功能。"
applies_to:
  - scene_building
allowed_rendering:
  - "Combine plot movement with joke, relationship, mechanism, cost, danger, or transition."
forbidden_rendering:
  - "Avoid single-purpose summary paragraphs."
audit_question: "Does the event do more than one job?"
source_label: style_guide
confidence: high
```

---

### 19.6 comedy_with_function

```yaml
rule_id: style_rule_comedy_with_function
priority: medium
rule_statement: "笑点必须有结构功能。"
applies_to:
  - comedy
  - banter
allowed_rendering:
  - "Use jokes to reveal character voice, social pressure, equipment limits, danger, embarrassment, or transition."
forbidden_rendering:
  - "Do not insert detachable gag lines that stall the scene."
audit_question: "Does the joke reveal or move something?"
source_label: style_guide
confidence: high
```

---

### 19.7 concrete_closure

```yaml
rule_id: style_rule_concrete_closure
priority: high
rule_statement: "场景收束落在物件、动作、对白、沉默或反差上，不要抽象总结。"
applies_to:
  - scene_closure
  - chapter_ending
allowed_rendering:
  - "End on a physical object, action, deadpan line, embarrassed reaction, silence, or unresolved practical problem."
forbidden_rendering:
  - "Do not end with abstract growth, destiny, theme, or moral summary."
audit_question: "Does the ending land on something concrete?"
source_label: style_guide
confidence: high
```

---

## 20. `rhythm_constraints`

用于把统计和 qualitative fallback 合并成节奏约束。

结构：

```yaml
rhythm_constraints:
  source_status: metric_backed | qualitative_only | mixed | unknown

  sentence_length:
    metric:
      avg_sentence_length: number | null
      sentence_length_stddev: number | null
      unit: chars | words | tokens | unknown
    qualitative_fallback:
      - string

  paragraph_length:
    metric:
      avg_paragraph_length: number | null
      paragraph_length_range:
        min: number | null
        max: number | null
      unit: chars | words | tokens | sentences | unknown
    qualitative_fallback:
      - string

  dialogue_narration_balance:
    metric:
      dialogue_ratio: number | null
      narration_ratio: number | null
      unit: percent | fraction | unknown
    qualitative_fallback:
      - string

  punctuation_rhythm:
    metric_status: complete | partial | missing | unknown
    qualitative_fallback:
      - string
```

规则：

- 统计单位不明时，不得作为硬性长度规则。
- fallback 应告诉 Renderer 如何控制节奏，而不是写泛泛“写得好”。
- 避免长篇连续说明。
- 对话和叙述应交错，避免纯对白清单或纯说明段落。

---

## 21. `transition_patterns`

用于描述作者常见或推荐转场模式。

结构：

```yaml
transition_patterns:
  - pattern_id: string
    pattern_steps:
      - string
    use_when:
      - string
    avoid_when:
      - string
    audit_question: string
```

推荐至少包含：

```yaml
transition_patterns:
  - pattern_id: object_to_problem_to_next_action
    pattern_steps:
      - "object/action appears or is handled"
      - "character jokes, misunderstands, asks, tests, or corrects"
      - "rule/cost/permission/danger emerges"
      - "limitation forces next action"
    use_when:
      - "moving between equipment, test, social pressure, mechanism release, and task risk"
    avoid_when:
      - "external interruption should carry the transition"
    audit_question: "Did the transition arise from scene pressure rather than 'then'?"
```

---

## 22. `character_voice_profiles`

用于描述角色声音、句式、用词、风格功能和禁止漂移。

结构：

```yaml
character_voice_profiles:
  - character_id: string
    display_name: string

    source_status: inkos_dialogue_fingerprint | extracted | manual_profile | mixed | missing | unknown
    sample_count: number | null
    sample_source_range: string | null

    core_voice:
      - string

    sentence_shape:
      average_line_length:
        value: number | null
        unit: chars | words | tokens | unknown
        source_label: computed_from_chapters | computed_sample | inkos_style_profile | manual_estimate | unknown
        confidence: high | medium | low | unknown
      rhythm_note: string

    diction:
      preferred:
        - string
      avoid:
        - string

    functional_role_in_style:
      - string

    allowed_moves:
      - string

    forbidden_drifts:
      - string

    audit_questions:
      - string

    source_label: canon_confirmed | inferred | human_planned | human_override | model_hypothesis | benchmark_reference
    confidence: high | medium | low | unknown
```

规则：

- 每个主要角色应有单独 profile。
- `sample_count` 和 `sample_source_range` 必须暴露。
- 样本少时应降低 confidence，或在 `source_status` 中写 `mixed` / `manual_profile`。
- 角色声音只控制写法，不新增剧情事实。
- 不要让所有角色共享同一种中性说明腔。
- 不要让角色突然知道不该知道的信息。
- 不要让角色声音 profile 取代 Entity Cards。

---

## 23. `chapter_specific_style_constraints`

用于目标章节的局部风格约束。

结构：

```yaml
chapter_specific_style_constraints:
  - constraint_id: string
    target_chapter: string
    rule_statement: string
    allowed_rendering:
      - string
    forbidden_rendering:
      - string
    source_label: canon_confirmed | inferred | human_planned | human_override | model_hypothesis | benchmark_reference
    clean_forward_safe: boolean
    continuation_safe: boolean
    confidence: high | medium | low | unknown
```

规则：

- 只能约束“怎么写”，不能规定“发生什么”。
- 不得包含目标章真实正文或 benchmark reference。
- 如果来自人工计划，应标 `human_planned`。
- 如果来自模型假设，应标 `model_hypothesis`。
- 如果来自 benchmark/reference，必须 `continuation_safe: false`。

可接受示例：

```yaml
rule_statement: "测试、交易、机制释放类段落必须通过物件、动作、对白或反应可见化；不要压成摘要。"
```

不可接受示例：

```yaml
rule_statement: "第七个事件必须发生某具体剧情反转。"
```

原因：这是 Render Event Log，不是 Author Fingerprint。

---

## 24. `forbidden_style_drifts`

用于全局禁止文风漂移。

结构：

```yaml
forbidden_style_drifts:
  - drift_id: string
    description: string
    examples:
      - string
    audit_question: string
    severity: low | medium | high | critical
```

推荐至少包含：

```yaml
recommended_forbidden_style_drifts:
  - checklist_expansion
  - encyclopedia_exposition
  - all_characters_same_voice
  - new_cool_thing_without_limitation
  - abstract_conceptual_ending
  - prompt_or_schema_language_leak
  - event_id_leak
  - internal_only_leak
  - future_source_contamination
```

---

## 25. `audit.required_checks`

用于给 Auditor 提供检查项。

结构：

```yaml
audit:
  required_checks:
    - check_id: string
      question: string
      severity: low | medium | high | critical
```

推荐检查项：

```yaml
audit:
  required_checks:
    - check_id: metrics_used_or_marked_unknown
      question: "Were metrics filled from real data or explicitly marked as sample-computed/unknown?"
      severity: high

    - check_id: event_log_hidden
      question: "Does the prose hide the Event Log skeleton?"
      severity: critical

    - check_id: exposition_has_friction
      question: "Does mechanism explanation meet resistance through action, joke, misunderstanding, cost, permission, danger, or interruption?"
      severity: high

    - check_id: multi_function_events
      question: "Do major events perform at least two functions where possible?"
      severity: medium

    - check_id: character_voices_separated
      question: "Do character lines sound differentiated?"
      severity: high

    - check_id: concrete_closure
      question: "Do scene endings land on object/action/dialogue/silence/reversal rather than concept summary?"
      severity: high

    - check_id: no_new_plot_from_style
      question: "Did Author Fingerprint avoid inventing event content?"
      severity: critical

    - check_id: no_future_source_contamination
      question: "Did the render avoid target-chapter real prose, runtime trace, later chapters, benchmark reference, generated benchmark_reference render, and quarantine-derived style leakage?"
      severity: critical
```

---

## 26. 最小验证规则

生成的 Author Fingerprint pack 至少需要通过以下检查：

1. 声明 `schema_version`。
2. 声明 `target_chapter`。
3. 声明 `source_mode`。
4. 声明 `clean_forward_safe`。
5. 声明 `continuation_safe`。
6. 声明 `source_boundary`。
7. 有 `inkos_style_profile`。
8. 有 `creative_mechanics_profile`。
9. 有 `render_execution_rules`。
10. 有 `rhythm_constraints`。
11. 有 `transition_patterns`。
12. 主要角色有 `character_voice_profiles`。
13. 有 `forbidden_style_drifts`。
14. 有 `audit.required_checks`。
15. InkOS 原生缺失统计不得伪造。
16. 本地样本计算统计必须标 `computed_from_chapters` 或 `computed_sample`。
17. 单位不明的数值必须标 `unit: unknown`。
18. 角色 voice profile 必须包含 `sample_count` 和 `sample_source_range`。
19. 不得包含目标章真实正文。
20. 不得包含后续章节信息。
21. 不得包含 benchmark reference，除非 `source_mode: benchmark_reference` 且 `continuation_safe: false`。
22. 不得替代 Entity Cards。
23. 不得替代 World Mechanics。
24. 不得替代 Render Event Log。
25. 不得生成小说正文。

---

## 27. Production-clean instance 最小模板

```yaml
schema_version: "author_fingerprint.v0.3"
pack_id: "author_fingerprint_<target_chapter>_from_<source_range>"
target_chapter: "<target_chapter>"

source_mode: production_clean
clean_forward_safe: true
continuation_safe: true

source_boundary:
  allowed_sources:
    - "<style_profile.json>"
    - "<style_guide.md>"
    - "<author_intent.md>"
    - "<pre-target chapter samples>"
    - "<pre-target truth/state files>"
    - "<clean Active Entity Cards>"
  excluded_sources:
    - "<target chapter real manuscript>"
    - "<target chapter real trace>"
    - "<later chapter prose>"
    - "<benchmark reference>"
    - "<external LLM target-chapter prose>"
    - "<uncertain generated artifacts>"
  contamination_note: "No target-chapter real prose, real trace, later chapter, benchmark reference, external LLM target-chapter prose, or uncertain generated artifact was read."

inkos_style_profile:
  metrics_status: partial
  source_files:
    - "<style_profile.json>"
    - "<style_guide.md>"

  quantitative_metrics:
    avg_sentence_length:
      value: null
      unit: unknown
      source_label: unknown
      confidence: unknown
    sentence_length_stddev:
      value: null
      unit: unknown
      source_label: unknown
      confidence: unknown
    avg_paragraph_length:
      value: null
      unit: unknown
      source_label: unknown
      confidence: unknown
    paragraph_length_range:
      min: null
      max: null
      unit: unknown
      source_label: unknown
      confidence: unknown
    dialogue_ratio:
      value: null
      unit: unknown
      source_label: unknown
      confidence: unknown
    narration_ratio:
      value: null
      unit: unknown
      source_label: unknown
      confidence: unknown
    type_token_ratio:
      value: null
      unit: unknown
      source_label: unknown
      confidence: unknown

  sentence_opening_patterns: []

  punctuation_profile:
    question_mark_usage: unknown
    exclamation_usage: unknown
    dash_usage: unknown
    ellipsis_usage: unknown
    quote_density: unknown
    notes: []

  rhetorical_features: []

  character_dialogue_fingerprints: []

creative_mechanics_profile:
  source_file: "<style guide or author mechanics file>"
  source_status: original | equivalent_summary | missing
  source_note: "<说明机制来源。>"
  sample_count: null
  category_coverage: []
  emergent_rules: []
  mechanism_rules: []

render_execution_rules:
  - rule_id: style_rule_event_not_outline
    priority: critical
    rule_statement: "不要把 Event Log 渲染成 checklist；每个重要 event 必须变成可见动作、物件、对白或场景移动。"
    applies_to:
      - prose_rendering
      - event_transition
    allowed_rendering:
      - "Use object handling, dialogue interruption, physical movement, or consequence to move between events."
    forbidden_rendering:
      - "Do not write 'they discussed X' as a substitute for scene."
      - "Do not expose event IDs or schema terms."
    audit_question: "Can the reader see the event happening rather than being told it happened?"
    source_label: style_guide
    confidence: high

  - rule_id: style_rule_object_triggered_exposition
    priority: high
    rule_statement: "设定应从物件、动作、交易、试用、误解、价格或风险中冒出。"
    applies_to:
      - world_mechanic_release
      - dialogue
    allowed_rendering:
      - "Let concrete objects, physical action, price, failure, risk, or character reaction trigger explanation."
    forbidden_rendering:
      - "Do not paste a detached worldbuilding paragraph into narration."
    audit_question: "Does the rule emerge from something visible?"
    source_label: style_guide
    confidence: high

  - rule_id: style_rule_exposition_with_friction
    priority: high
    rule_statement: "说明必须有摩擦：动作打断、吐槽、成本、权限、危险、误会或现实反压。"
    applies_to:
      - mechanism_explanation
    allowed_rendering:
      - "Break explanations with action, testing, correction, price, awkwardness, danger, or role-specific reaction."
    forbidden_rendering:
      - "Do not allow uninterrupted lecture blocks when a scene action can carry the same information."
    audit_question: "Is exposition resisted by scene pressure?"
    source_label: style_guide
    confidence: high

  - rule_id: style_rule_novelty_limited
    priority: high
    rule_statement: "新奇素材必须立刻带限制。"
    applies_to:
      - new_weapon
      - magic
      - machine
      - technology
      - new_information
    allowed_rendering:
      - "Attach price, rarity, skill, permission, risk, uncertainty, or tactical cost to every cool option."
    forbidden_rendering:
      - "Do not let a new tool, spell, machine, or idea solve the chapter by itself."
    audit_question: "Does every cool thing meet a limit quickly?"
    source_label: style_guide
    confidence: high

  - rule_id: style_rule_multi_function_event
    priority: medium
    rule_statement: "每个重要 event 尽量承担两个以上功能。"
    applies_to:
      - scene_building
    allowed_rendering:
      - "Combine plot movement with joke, relationship, mechanism, cost, danger, or transition."
    forbidden_rendering:
      - "Avoid single-purpose summary paragraphs."
    audit_question: "Does the event do more than one job?"
    source_label: style_guide
    confidence: high

  - rule_id: style_rule_comedy_with_function
    priority: medium
    rule_statement: "笑点必须有结构功能。"
    applies_to:
      - comedy
      - banter
    allowed_rendering:
      - "Use jokes to reveal character voice, social pressure, equipment limits, danger, embarrassment, or transition."
    forbidden_rendering:
      - "Do not insert detachable gag lines that stall the scene."
    audit_question: "Does the joke reveal or move something?"
    source_label: style_guide
    confidence: high

  - rule_id: style_rule_concrete_closure
    priority: high
    rule_statement: "场景收束落在物件、动作、对白、沉默或反差上，不要抽象总结。"
    applies_to:
      - scene_closure
      - chapter_ending
    allowed_rendering:
      - "End on a physical object, action, deadpan line, embarrassed reaction, silence, or unresolved practical problem."
    forbidden_rendering:
      - "Do not end with abstract growth, destiny, theme, or moral summary."
    audit_question: "Does the ending land on something concrete?"
    source_label: style_guide
    confidence: high

rhythm_constraints:
  source_status: mixed
  sentence_length:
    metric:
      avg_sentence_length: null
      sentence_length_stddev: null
      unit: unknown
    qualitative_fallback:
      - "Short sentences are preferred for punchlines, action landings, awkward pauses, and dry retorts."
      - "Medium-long sentences may carry mechanism explanation, but should be broken by action or dialogue."

  paragraph_length:
    metric:
      avg_paragraph_length: null
      paragraph_length_range:
        min: null
        max: null
      unit: unknown
    qualitative_fallback:
      - "Avoid long uninterrupted exposition blocks."
      - "Paragraph endings should land on object, action, dialogue, silence, or reversal more often than abstract summary."

  dialogue_narration_balance:
    metric:
      dialogue_ratio: null
      narration_ratio: null
      unit: unknown
    qualitative_fallback:
      - "Dialogue and narration should interleave."
      - "Avoid pure dialogue checklist and pure expository narration."

  punctuation_rhythm:
    metric_status: missing
    qualitative_fallback:
      - "Question marks and short quoted retorts may support banter and confusion."
      - "Avoid stacked exclamation marks."
      - "Avoid overusing dramatic dashes."

transition_patterns:
  - pattern_id: object_to_problem_to_next_action
    pattern_steps:
      - "object/action appears or is handled"
      - "character jokes, misunderstands, asks, tests, or corrects"
      - "rule/cost/permission/danger emerges"
      - "limitation forces next action"
    use_when:
      - "moving between equipment, test, social pressure, mechanism release, and task risk"
    avoid_when:
      - "external interruption should carry the transition"
    audit_question: "Did the transition arise from scene pressure rather than 'then'?"

character_voice_profiles:
  - character_id: "<character_id>"
    display_name: "<character_display_name>"
    source_status: extracted
    sample_count: null
    sample_source_range: "<pre-target dialogue sample range>"
    core_voice:
      - "<core voice trait>"
    sentence_shape:
      average_line_length:
        value: null
        unit: unknown
        source_label: unknown
        confidence: unknown
      rhythm_note: "<sentence rhythm note>"
    diction:
      preferred:
        - "<preferred diction>"
      avoid:
        - "<diction to avoid>"
    functional_role_in_style:
      - "<style function>"
    allowed_moves:
      - "<allowed voice move>"
    forbidden_drifts:
      - "<forbidden drift>"
    audit_questions:
      - "Does this character's voice remain distinct?"
      - "Does this character voice avoid adding new plot facts?"
    source_label: inferred
    confidence: medium

chapter_specific_style_constraints: []

forbidden_style_drifts:
  - drift_id: checklist_expansion
    description: "Prose visibly follows Event Log bullets instead of becoming a scene."
    examples:
      - "They discussed event A, then event B, then event C."
    audit_question: "Are events rendered as scene actions rather than checklist paraphrase?"
    severity: critical

  - drift_id: encyclopedia_exposition
    description: "World rules are copied as detached explanation instead of emerging from action."
    examples:
      - "A full lecture on the setting with no object, interruption, joke, cost, or scene pressure."
    audit_question: "Does exposition have friction?"
    severity: high

  - drift_id: all_characters_same_voice
    description: "Characters speak in the same neutral explanatory voice."
    examples:
      - "Every character sounds like a rulebook narrator."
    audit_question: "Are character voices separated?"
    severity: high

  - drift_id: new_cool_thing_without_limitation
    description: "A weapon, spell, machine, idea, or new information appears without price, scarcity, skill, permission, uncertainty, or risk."
    examples:
      - "A new tool solves the scene without tradeoff."
    audit_question: "Does each novelty meet a limit?"
    severity: high

  - drift_id: abstract_conceptual_ending
    description: "Scene or chapter closes with abstract lesson rather than concrete anchor."
    examples:
      - "They finally understood the cost of growth."
    audit_question: "Does closure land on object/action/dialogue/silence/reversal?"
    severity: high

  - drift_id: prompt_or_schema_language_leak
    description: "Prompt, schema, event id, field name, audit language, or internal instruction leaks into prose."
    examples:
      - "REL-E001's must_render is..."
    audit_question: "Does the prose hide all schema/prompt language?"
    severity: critical

audit:
  required_checks:
    - check_id: metrics_used_or_marked_unknown
      question: "Were sentence/paragraph/dialogue metrics filled from real data or explicitly marked as sample-computed/unknown?"
      severity: high
    - check_id: event_log_hidden
      question: "Does the prose hide the Event Log skeleton?"
      severity: critical
    - check_id: exposition_has_friction
      question: "Does mechanism explanation meet resistance through action, joke, misunderstanding, cost, permission, danger, or interruption?"
      severity: high
    - check_id: multi_function_events
      question: "Do major events perform at least two functions where possible?"
      severity: medium
    - check_id: character_voices_separated
      question: "Do character lines sound differentiated?"
      severity: high
    - check_id: concrete_closure
      question: "Do scene endings land on object/action/dialogue/silence/reversal rather than concept summary?"
      severity: high
    - check_id: no_new_plot_from_style
      question: "Did Author Fingerprint avoid inventing event content?"
      severity: critical
    - check_id: no_future_source_contamination
      question: "Did the render avoid target-chapter real prose, runtime trace, later chapters, benchmark reference, generated benchmark_reference render, and quarantine-derived style leakage?"
      severity: critical
```

---

## 28. Benchmark reference 指南

如果某些风格判断来自真实目标章、目标章 trace、后续章节、benchmark reference 或回放答案，应使用：

```yaml
source_mode: benchmark_reference
clean_forward_safe: false
continuation_safe: false
source_label: benchmark_reference
```

规则：

- 只能用于 schema fit test、回放、分析、upper-bound 对照。
- 不得用于真实续写。
- 不得回写 production-clean instance。
- 不得伪装成 pre-target author fingerprint。

---

## 29. 常见失败模式

### 29.1 checklist expansion

错误：

```text
他们做了事件 A。然后做了事件 B。然后讨论了事件 C。
```

问题：正文暴露 Event Log 骨架。

修正：每个 event 必须通过动作、对白、物件、反应或场景变化发生。

---

### 29.2 encyclopedia exposition

错误：

```text
本世界的完整机制如下……
```

问题：设定说明脱离场景。

修正：说明必须由物件、动作、价格、失败、误会、风险或角色反应触发。

---

### 29.3 all characters same voice

错误：

```text
所有角色都用同一种清晰、理性、中性说明腔说话。
```

问题：角色声音丢失。

修正：每个主要角色必须遵守独立 `character_voice_profiles`。

---

### 29.4 novelty without limitation

错误：

```text
新工具、新法术、新技术或新信息出现后立刻解决所有问题。
```

问题：新奇素材外挂化。

修正：新奇素材必须立刻遇到价格、稀缺、技能、权限、风险、误解或信息差。

---

### 29.5 abstract closure

错误：

```text
他们终于明白了成长的意义。
```

问题：抽象感悟收尾。

修正：收束应落在物件、动作、对白、沉默、反差或未解决的具体问题上。

---

### 29.6 prompt/schema language leak

错误：

```text
这个事件的 must_render 是……
```

问题：schema 语言泄漏进正文。

修正：Renderer 不得输出 event id、schema 字段名、audit question、prompt 术语或内部说明。

---

### 29.7 metric hallucination

错误：

```yaml
dialogue_ratio:
  value: 0.42
  source_label: inkos_style_profile
```

但 InkOS 原生 profile 没有该项。

问题：伪造统计。

修正：缺失项写 `null + unknown`；样本计算项写 `computed_from_chapters` 或 `computed_sample`。

---

### 29.8 future-source contamination

错误：

```yaml
source_mode: production_clean
source_basis:
  - "<target chapter real manuscript>"
```

问题：真实续写偷看答案。

修正：使用目标章真实正文或 benchmark reference 时必须 `source_mode: benchmark_reference`，并 `continuation_safe: false`。

---

## 30. PR 定位

本 schema 应定位为：

```text
Author Fingerprint = 作者风格与 Renderer 执行规则包
```

它不替代 InkOS 既有 style profile，也不替代 truth files。

建议管线位置：

```text
InkOS style_profile / style_guide / chapter samples
→ Author Fingerprint
→ Active Entity Cards + Worldbuilding / World Mechanics + Render Event Log
→ Structured Render Assembly
→ Renderer LLM
→ Event-level Auditor
```

---

##  31. v0.3 修改摘要

相对 v0.2，本版做了以下修改：

- 移除具体作品、具体角色、具体章节、具体项目实例。
- 增加 `source_mode`：
  - `production_clean`
  - `planned`
  - `manual`
  - `hybrid_planned`
  - `model_hypothesis`
  - `benchmark_reference`
- 增加 `continuation_safe`。
- 明确真实续写不得使用 benchmark / target real prose / future chapter。
- 增加 metrics `source_label`：
  - `inkos_style_profile`
  - `computed_from_chapters`
  - `computed_sample`
  - `manual_estimate`
  - `unknown`
- 增加 `creative_mechanics_profile.source_status`：
  - `original`
  - `equivalent_summary`
  - `missing`
- 正式加入 `sample_count` 和 `sample_source_range`。
- 明确样本计算统计不能伪装成 InkOS 原生统计。
- 明确单位 unknown 的统计不能当成硬性字数规则。
- 保留 LLM-native but validator-gated 原则。
- 强化 Author Fingerprint 不接管 Entity Cards / World Mechanics / Render Event Log 的边界。
- 保留中文主说明和英文字段名，便于人读和程序处理。
