/**
 * Full writing methodology for style_guide.md injection.
 * This is the complete reference material (with examples) that the
 * compact "craft card" in the system prompt summarizes.
 *
 * Injected once during initBook/generateStyleGuide, then read by
 * writer on every chapter as part of the style_guide context.
 */
export function buildWritingMethodologySection(language: "zh" | "en" | "ko"): string {
  if (language === "ko") {
    return buildKoreanMethodology();
  }
  if (language === "en") {
    return buildEnglishMethodology();
  }
  return buildChineseMethodology();
}

function buildKoreanMethodology(): string {
  return `---

# 집필 방법론 참고 자료

이 문서는 장면을 쓸 때 계속 참고하는 품질 기준입니다.

## 1. AI 티 줄이기

### 감정
| 피해야 할 문장 | 더 나은 방향 | 핵심 |
|---|---|---|
| 그는 매우 화가 났다. | 그는 컵을 쥔 손에 힘을 줬다. 뜨거운 물이 손가락 사이로 흘렀지만 눈도 깜박이지 않았다. | 감정은 행동과 신체 반응으로 드러낸다 |
| 그녀는 슬퍼서 눈물이 났다. | 그녀는 휴대폰을 너무 세게 쥐어 손마디가 하얗게 질렸다. 화면의 글자가 번졌다. | 감정 이름보다 구체적 감각을 쓴다 |

### 전환
| 피해야 할 문장 | 더 나은 방향 | 핵심 |
|---|---|---|
| 그러나 상황은 단순하지 않았다. | 그렇게 쉽게 끝날 리 없었다. | 설명 대신 인물의 판단으로 넘긴다 |
| 그래서 그는 행동하기로 했다. | 그는 자리에서 일어나 의자를 밀어냈다. | 결심 설명보다 행동을 먼저 놓는다 |

## 2. 인물 심리 6단계

중요한 행동은 다음 순서로 점검합니다.

1. 현재 처지: 지금 무엇을 마주하고 있는가?
2. 핵심 욕망: 가장 원하는 것과 가장 두려워하는 것은 무엇인가?
3. 정보 경계: 무엇을 알고, 무엇을 모르는가?
4. 성격 필터: 이 인물이라면 같은 상황에서 어떻게 반응하는가?
5. 행동 선택: 그래서 실제로 무엇을 선택하는가?
6. 감정 외화: 그 감정은 표정, 말투, 몸짓으로 어떻게 드러나는가?

## 3. 조연 설계

- 조연도 자기 목적과 이해관계를 가진다.
- 주인공은 멍청한 상대를 이겨서 강해지는 것이 아니라, 자기 논리를 가진 상대와 부딪히며 선명해진다.
- 인물 설명은 외모 나열보다 사건 속 선택으로 보여준다.
- 대화는 인물마다 단어, 길이, 리듬이 달라야 한다.
- 군중 반응은 "모두가 놀랐다"보다 구체적인 한두 사람의 반응으로 쓴다.

## 4. 몰입의 기둥

1. 정체성: 한 문장 안에 인물의 위치와 태도가 드러난다.
2. 구체성: 독자가 머릿속에 그릴 수 있는 물건, 냄새, 소리, 온도를 쓴다.
3. 익숙함: 일상적 감각이 장면의 바닥을 만든다.
4. 공감: 억울함, 과소평가, 상실, 책임 같은 보편 감정을 붙잡는다.
5. 욕망 엔진: 기대와 결핍을 만들고, 해소는 기대보다 크게 준다.
6. 오감: 시각에만 기대지 말고 소리, 냄새, 촉감, 맛을 섞는다.

## 5. 장면 점검표

1. 이 장면이 현재 목표를 실제로 전진시키는가?
2. 갈등을 시작한 사람이 누구이며 왜 지금이어야 하는가?
3. 인물의 정보 경계가 지켜지는가?
4. 사건의 결과로 관계, 상태, 자원 중 하나가 변하는가?
5. 마지막 문단에 다음 장을 읽게 할 감정적 빈칸이 있는가?
`;
}

function buildChineseMethodology(): string {
  return `---

# 写作方法论参考（完整版）

以下方法论是写作质量的完整参考。写作时应内化这些原则。

## 一、去AI味：正反例对照

### 情绪描写
| 反例（AI味） | 正例（人味） | 要点 |
|---|---|---|
| 他感到非常愤怒。 | 他捏碎了手中的茶杯，滚烫的茶水流过指缝，但他像没感觉一样。 | 用动作外化情绪 |
| 她心里很悲伤，眼泪流了下来。 | 她攥紧手机，指节发白，屏幕上的聊天记录模糊成一片。 | 用身体细节替代直白标签 |
| 他感到一阵恐惧。 | 他后背的汗毛竖了起来，脚底像踩在了冰上。 | 五感传递恐惧 |

### 转折与衔接
| 反例 | 正例 | 要点 |
|---|---|---|
| 虽然他很强，但是他还是输了。 | 他确实强，可对面那个老东西更脏。 | 口语化转折 |
| 然而，事情并没有那么简单。 | 哪有那么便宜的事。 | 角色内心吐槽替代"然而" |
| 因此，他决定采取行动。 | 他站起来，把凳子踢到一边。 | 删掉因果连词，直接写动作 |

### "了"字控制
| 反例 | 正例 |
|---|---|
| 他走了过去，拿了杯子，喝了一口水。 | 他走过去，端起杯子，灌了一口。 |
| 她笑了笑，转身离开了房间。 | 她嘴角一扬，转身出门。 |

## 二、六步走人物心理分析

每个重要角色在关键场景中的行为，必须经过以下六步推导：

1. **当前处境**：角色此刻面临什么局面？手上有什么牌？
2. **核心动机**：角色最想要什么？最害怕什么？
3. **信息边界**：角色知道什么？不知道什么？对局势有什么误判？
4. **性格过滤**：同样的局面，这个角色的性格会怎么反应？
5. **行为选择**：基于以上四点，角色会做出什么选择？
6. **情绪外化**：这个选择伴随什么情绪？用什么身体语言、表情、语气表达？

禁止跳过步骤直接写行为。

## 三、配角设计方法论

- 配角必须有反击，有自己的算盘。主角的强大在于压服聪明人，而不是碾压傻子。
- 每个配角的行为动机必须与主线产生关联。
- 核心标签 + 反差细节 = 活人（表面冷硬的角色偷偷照顾流浪动物）。
- 通过事件立人设，禁止通过外貌和形容词堆砌。
- 不同角色的说话方式必须有辨识度。
- 群戏中不写"众人齐声惊呼"，挑1-2个角色写具体反应。

## 四、代入感六大支柱

1. **基础信息交代**：一句话能交代身份、性格、地位——"小爷我乃镇南府世子林峰"
2. **具体化/可视化**：描写具体到读者脑海能浮现——"搪瓷缸白汽直冒""冰镇汽水嘶嘶响"
3. **熟悉感**：接地气的场景自带代入感——"高考后小树林的分手""医院走廊的消毒水味"
4. **共鸣**：主角的困境必须有普遍性——被欺压、不公待遇、被低估
5. **欲望驱动**：
   - 基础欲望（被动）：不劳而获、高人一等、扬眉吐气
   - 主动欲望（期待感）：作者刻意制造的情绪缺口→读者期待释放→释放超过预期
6. **五感描写**：视觉、听觉、嗅觉、触觉、味觉——"潮湿的短袖黏在后背上"

## 五、强情绪升级法（避免流水账）

流水账的修法不是删掉日常，而是给日常加"料"：

1. **加入前因后果**：下班回家→加上"催债电话刚打来"→日常有了紧迫感
2. **情绪递进**：坏事叠坏事——被骂→赶不上公交→手机掉了→直播课结束了→包子噎住了。每层比上一层过分
3. **日常必须为主线服务**：万物皆为"饵"。日常段要么埋伏笔，要么推关系，要么建立反差

## 六、写前自检清单

1. 本章对应卷纲中的哪个节点？是否推进了该节点？
2. 主角此刻利益最大化的选择是什么？
3. 冲突是谁先动手，为什么非做不可？
4. 配角/反派是否有明确诉求和反制？
5. 反派当前掌握了哪些信息？有无信息越界？
6. 章尾是否留了钩子？
7. 有没有流水账？如有，加前因后果或强情绪
8. 本章是否推进了主线目标？`;
}

function buildEnglishMethodology(): string {
  return `---

# Writing Methodology Reference (Full Version)

Complete reference material for writing quality. Internalize these principles.

## 1. Anti-AI Pattern Guide

### Emotion
| Bad (AI-like) | Good (Human) | Key |
|---|---|---|
| He felt very angry. | He crushed the teacup in his hand. Scalding water ran through his fingers, but he didn't flinch. | Externalize through action |
| She was very sad and tears fell. | She gripped her phone until her knuckles went white. The chat log blurred. | Body detail replaces label |

### Transitions
| Bad | Good | Key |
|---|---|---|
| Although he was strong, he still lost. | He was strong, sure. But the old bastard across from him fought dirtier. | Colloquial voice |
| However, things were not so simple. | No such luck. | Character thought replaces "however" |
| Therefore, he decided to take action. | He stood up and kicked the chair aside. | Cut causal connectors, show action |

## 2. Six-Step Character Psychology

For every important character action:
1. **Situation**: What's the character facing? What cards do they hold?
2. **Core motivation**: What do they want most? Fear most?
3. **Information boundary**: What do they know? Not know? Misjudge?
4. **Personality filter**: Given the same situation, how would THIS character react?
5. **Behavioral choice**: Based on 1-4, what do they choose?
6. **Emotional expression**: What emotion accompanies this? Body language, expression, tone?

## 3. Supporting Character Design

- Every side character has their own agenda. Protagonist wins by outsmarting smart people.
- Core tag + contrast detail = alive (cold-exterior character secretly feeds strays).
- Establish character through events, not description dumps.
- Different characters speak differently — vocabulary, length, verbal tics.
- In group scenes: never "everyone gasped" — pick 1-2 specific reactions.

## 4. Immersion Pillars

1. **Info delivery**: One line of dialogue can establish identity, status, personality
2. **Concrete/visual**: "The back seat of a taxi stuck in traffic for forty minutes" not "a big city"
3. **Familiarity**: Scenes readers have lived through carry natural immersion
4. **Resonance**: Protagonist's struggle must feel universal — injustice, being underestimated
5. **Desire engine**: Create emotional gap → reader anticipates release → release exceeds expectation
6. **Five senses**: Wet shirt on the back, hospital disinfectant, rain puddles at the bus stop

## 5. Emotional Escalation (Anti-Flowchart)

Fix boring daily scenes by adding fuel:
1. **Add causality**: Coming home → add "debt collector just called" → instant urgency
2. **Progressive escalation**: Stack bad things — scolded → missed bus → phone fell in drain → livestream ended → choked on stale bread. Each layer worse.
3. **Daily serves mainline**: Every quiet scene must plant a hook, advance a relationship, or build contrast.

## 6. Pre-Write Checklist

1. Which outline node does this chapter correspond to?
2. What's the protagonist's optimal move right now?
3. Who starts the conflict and why must they?
4. Do antagonists have clear motives and countermoves?
5. What information does each character have? Any boundary violations?
6. Does the chapter end with a hook?
7. Any flowchart passages? If so, add causality or strong emotion.
8. Does this chapter advance the main plotline?`;
}
