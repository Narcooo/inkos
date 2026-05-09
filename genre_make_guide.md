# Genre Make Guide

InkOS genre profiles are Markdown files with YAML frontmatter.

## Where To Put Genre Files

Use one of these locations:

- Project-only genre: `test-project/genres/{genre-id}.md`
- Built-in genre: `packages/core/genres/{genre-id}.md`

Project genres override built-in genres with the same id.

Lookup order:

1. `{projectRoot}/genres/{genre-id}.md`
2. `packages/core/genres/{genre-id}.md`
3. `packages/core/genres/other.md`

For normal personal use, prefer `test-project/genres/`.

## File Name And Id

Keep the file name and frontmatter `id` the same.

Example:

- File: `test-project/genres/ko-cozy-mystery.md`
- Frontmatter: `id: ko-cozy-mystery`

For Korean genres, use:

```yaml
language: ko
```

Korean UI filters by language, so a Korean genre should set `language: ko`.

## Required Shape

Every genre file must start with frontmatter:

```md
---
name: 장르 표시 이름
id: ko-example
language: ko
chapterTypes: ["도입", "전개", "전환", "회수"]
fatigueWords: ["반복되면 피곤한 표현"]
numericalSystem: false
powerScaling: false
eraResearch: false
pacingRule: "장르에 맞는 페이싱 규칙"
satisfactionTypes: ["성취감", "관계 진전"]
auditDimensions: [1,2,3,6,7,8,9,10,13,14,15,16,17,18,19]
---

## 장르 금기

- 피해야 할 전개를 적습니다.

## 서사 지침

장르의 분위기, 사건 전개, 인물 운용 방식을 적습니다.
```

## Field Notes

- `name`: Studio에 표시되는 장르 이름입니다.
- `id`: 내부 장르 id입니다. 파일명과 맞추세요.
- `language`: `ko`, `en`, `zh` 중 하나입니다.
- `chapterTypes`: 장을 분류할 때 쓰는 장 타입입니다.
- `fatigueWords`: 반복 사용을 경계할 표현입니다.
- `numericalSystem`: 레벨, 수치, 스탯 같은 체계를 강하게 쓰면 `true`.
- `powerScaling`: 전투력, 경지, 성장 단계가 중요하면 `true`.
- `eraResearch`: 실제 시대, 역사, 특정 연도 고증이 중요하면 `true`.
- `pacingRule`: 장르에 맞는 전개 속도 규칙입니다.
- `satisfactionTypes`: 독자가 얻어야 할 만족감의 종류입니다.
- `auditDimensions`: 감사/검토 기준 번호입니다. 새 장르가 특별하지 않다면 기존 한국어 장르 값을 복사해도 됩니다.

## Korean Genre Template

```md
---
name: 한국어 장르 이름
id: ko-new-genre
language: ko
chapterTypes: ["도입", "관계", "갈등", "전환", "회수"]
fatigueWords: ["무심코", "어느새", "믿을 수 없었다"]
numericalSystem: false
powerScaling: false
eraResearch: false
pacingRule: "매 장마다 인물의 선택, 관계 변화, 사건 단서 중 하나를 전진시킨다."
satisfactionTypes: ["관계 진전", "비밀 발견", "선택의 대가", "작은 성취"]
auditDimensions: [1,2,3,6,7,8,9,10,13,14,15,16,17,18,19]
---

## 장르 금기

- 장르 약속과 어긋나는 전개를 피한다.
- 갈등을 우연이나 설명만으로 해결하지 않는다.
- 인물의 선택 없이 사건만 굴러가게 하지 않는다.

## 서사 지침

- 주인공의 욕망, 결핍, 선택이 장면을 움직이게 한다.
- 세계관 정보는 설명으로 몰아넣지 말고 행동, 대화, 충돌 속에서 드러낸다.
- 각 장은 사건 진행, 관계 변화, 단서 회수, 정서 변화 중 하나를 반드시 수행한다.
- 장르의 핵심 감각을 반복 가능한 장면 장치로 만든다.
```

## After Adding A Genre

1. Save the file as `genres/{id}.md`.
2. Refresh Studio.
3. If it does not appear, restart Studio.
4. In Korean UI, confirm that `language: ko` is present.

## Useful Commands

List available genres:

```sh
pnpm --filter @actalk/inkos-cli inkos genre list
```

Copy a built-in genre into the project for editing:

```sh
pnpm --filter @actalk/inkos-cli inkos genre copy ko-cozy
```

Create a scaffold genre file:

```sh
pnpm --filter @actalk/inkos-cli inkos genre create ko-new-genre --name "새 장르"
```
