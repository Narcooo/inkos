<p align="center">
  <img src="assets/logo.svg" width="120" height="120" alt="InkOS Logo">
  <img src="assets/inkos-text.svg" width="240" height="65" alt="InkOS">
</p>

<h1 align="center">자율 소설 작성 AI 에이전트</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@actalk/inkos"><img src="https://img.shields.io/npm/v/@actalk/inkos.svg?color=cb3837&logo=npm" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg" alt="License: AGPL-3.0"></a>
  <a href="https://github.com/Narcooo/inkos/stargazers"><img src="https://img.shields.io/github/stars/Narcooo/inkos?style=flat&logo=github&color=yellow" alt="GitHub stars"></a>
  <a href="https://www.npmjs.com/package/@actalk/inkos"><img src="https://img.shields.io/npm/dm/@actalk/inkos?color=cb3837&logo=npm&label=downloads" alt="npm downloads"></a>
  <a href="https://clawhub.ai/narcooo/inkos"><img src="https://img.shields.io/badge/🦞%20ClawHub-Skill-FF6B35?labelColor=1a1a1a" alt="ClawHub Skill"></a>
</p>

<p align="center">
  <a href="README.md">中文</a> | <a href="README.en.md">English</a> | <a href="README.ja.md">日本語</a> | 한국어
</p>

---

InkOS는 소설의 초안 작성, 검토, 수정 과정을 AI 에이전트가 자동으로 수행하도록 돕는 오픈소스 소설 작성 도구입니다. Studio 웹 작업대, CLI, TUI, 에이전트 실행 경로를 함께 제공하며, 사람이 검토하고 승인하는 흐름을 유지할 수 있습니다.

**한국어 fork 변경점** — 이 fork는 한국어(`ko`) 소설 작성 흐름을 위해 Studio와 core 파이프라인 전반을 보강합니다. 한국어 장르 템플릿, 한국어 UI와 실행 로그, 한국어 기반 작품/설정 생성, 사용자 지정 모델 선택 고정, truth/foundation Markdown 렌더링 개선이 포함되어 있습니다. 이 fork의 한국어 보강 작업은 Codex로 수행되었습니다.

## 빠른 시작

### 설치

```bash
npm i -g @actalk/inkos
```

### 프로젝트 시작

```bash
inkos init my-novel
cd my-novel
inkos
```

Studio가 열리면 모델 설정에서 사용할 서비스와 모델을 지정하고, 새 작품 만들기에서 언어를 한국어로 선택하세요.

### 한국어 설정 예시

```bash
inkos config set-global \
  --lang ko \
  --provider custom \
  --base-url <API 주소> \
  --api-key <API Key> \
  --model <모델명>
```

프로젝트별로 설정하려면 `.env` 또는 Studio의 모델 설정을 사용할 수 있습니다.

```bash
INKOS_LLM_PROVIDER=custom
INKOS_LLM_BASE_URL=<API 주소>
INKOS_LLM_API_KEY=<API Key>
INKOS_LLM_MODEL=<모델명>
INKOS_DEFAULT_LANGUAGE=ko
```

## 이 fork에서 보강된 부분

- 한국어(`ko`) 장르 템플릿과 장르 편집 지원
- 한국어 선택 시 Studio 메뉴, 실행 로그, 생성 문서가 한국어로 표시되도록 처리
- 사용자 지정 서비스에서 선택한 모델만 사용하도록 모델 fallback 동작 제한
- 새 작품 생성과 초안 업데이트가 한국어 장르/소개/핵심 설정을 폼에 반영하도록 개선
- truth/foundation Markdown 문서의 렌더링 개선
- 검토 버튼의 `sub_agent` 인자 검증 오류 수정

## 주요 명령

```bash
inkos book create --title "마법사의 작은 정원" --genre ko-cozy
inkos write next "마법사의 작은 정원"
inkos status
inkos review list "마법사의 작은 정원"
inkos export "마법사의 작은 정원" --format epub
```

## 라이선스

InkOS는 AGPL-3.0-only 라이선스를 따릅니다. 이 fork의 변경 사항도 동일한 라이선스 조건을 따릅니다.
