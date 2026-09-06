# Grimoire

<p align="center">
  <img src="../../assets/readme/grimoire-logo.png" alt="Grimoire 로고" width="240">
</p>

<p align="center">
  <strong>Obsidian 볼트를 위한 로컬 우선 AI 에이전트.</strong>
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="라이선스: MIT">
  <img src="https://img.shields.io/github/v/release/sandsaber/Grimoire?label=release" alt="최신 릴리스">
  <img src="https://img.shields.io/badge/Obsidian-1.13.0%2B-7c3aed" alt="Obsidian 1.13.0+">
  <img src="https://img.shields.io/badge/platform-desktop-lightgrey" alt="데스크톱 전용">
</p>

<p align="center">
  <img src="../../assets/readme/chat-workspace.png" alt="Obsidian 노트 옆에서 실행되는 Grimoire 사이드 패널" width="100%">
</p>

<p align="center">
  <sub>노트가 있는 같은 Obsidian 작업 공간에서 로컬 CLI 에이전트와 대화하세요.</sub>
</p>

> **안내: 2.0을 개발 중입니다.** 다음 메이저 릴리스에서 Grimoire는 프로바이더 기반 실행 아키텍처로 전환됩니다. 하나의 커널이 각 CLI를 구동하고 턴마다 정확히 하나의 결과를 기록하며, 보관소의 테마와 강조 색상을 따르는 새 디자인이 적용됩니다. 작업은 이미 `main`에 병합되었지만 아직 공개 릴리스에는 포함되지 않았습니다. 현재 공개 릴리스는 여전히 1.3.2입니다. 대화, 설정, 프로바이더 파일은 그대로 유지됩니다.

Grimoire는 에이전트형 CLI 어시스턴트를 Obsidian 안으로 가져옵니다. 하나의 사이드 패널에서 Claude Code, Codex, Antigravity CLI, Gemini CLI (Legacy), OpenCode, MiMoCode, Kimi Code, Grok Build, Qwen Code를 사용해 노트를 읽고, 파일을 편집하고, 명령과 도구를 실행하며 실제 볼트의 세션 기록을 유지합니다. Grimoire 서버, 텔레메트리, 호스팅 백엔드, 프록시는 없습니다.

이미 Obsidian에서 작업하며 볼트의 일부처럼 작동하는 AI 도움을 원하는 사람을 위해 만들었습니다. 로컬 컨텍스트와 파일, 신중하게 선택한 제공자, 확인 가능한 사용량을 제공합니다.

> 영어 [README](../../README.md)가 정식 제품 문서입니다. 이 한국어 번역은 현재 제품 문서와 함께 관리됩니다.

## Grimoire를 선택하는 이유

- 이미 신뢰하는 CLI 에이전트를 노트 안에서 바로 사용하세요.
- 작성기에서 제공자를 전환하세요. Claude Code, Codex, Antigravity CLI, 레거시 Gemini CLI, OpenCode, MiMoCode, Kimi Code, Grok Build, Qwen Code는 하나의 모델 선택기를 공유합니다.
- 모든 대화를 볼트에 기반하게 하세요. 경로를 직접 붙여 넣는 대신 노트, 폴더, MCP 도구를 멘션하세요.
- 어차피 선택하는 자리인 모델 선택기 옆에서 비용과 한도를 확인하세요.
- 로컬 우선으로 유지하세요. Grimoire는 텔레메트리를 수집하거나 프롬프트를 프록시하지 않으며, 백엔드를 운영하지 않습니다.

## 제공자별 기능

| 기능 | Claude Code | Codex | OpenCode | Grok Build | MiMoCode | Kimi Code | Antigravity CLI | Gemini CLI (Legacy) | Qwen Code |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 로컬 영속 런타임 | 예 | 예 | 예 | 예 | 예 | 예 | 아니요 | 예 | 예 |
| 네이티브 기록 복원 | 예 | 예 | 예 | 예 | 예 | 예 | 아니요 | 예 | 아니요 |
| 계획 모드 | 예 | 예 | 예 | 예 | 예 | 예 | 아니요 | 예 | 예 |
| 이미지 첨부 | 예 | 예 | 예 | 예 | 예 | 예 | 아니요 | 예 | 예 |
| 지시 모드 | 예 | 예 | 예 | 예 | 예 | 예 | 아니요 | 예 | 예 |
| 추론 강도 제어 | 예 | 예 | 예 | 예 | 예 | 예 | 예 | 예 | 예 |
| 되돌리기 | 예 | 아니요 | 아니요 | 예 | 아니요 | 아니요 | 아니요 | 아니요 | 아니요 |
| 포크 | 예 | 예 | 아니요 | 예 | 아니요 | 아니요 | 아니요 | 아니요 | 아니요 |
| 제공자 슬래시 명령 | 예 | 아니요 | 예 | 예 | 예 | 예 | 아니요 | 예 | 예 |
| Grimoire 관리 MCP UI | 예 | 아니요 | 예 | 예 | 예 | 예 | 아니요 | 예 | 예 |

## 설치

Grimoire는 데스크톱 플러그인입니다. 제공자 CLI를 로컬에서 구동하므로 모바일 빌드는 없습니다.

### 커뮤니티 플러그인에서 설치(권장)

Obsidian 커뮤니티 플러그인 디렉터리에서 Grimoire를 설치하세요.

1. 설정을 열고 커뮤니티 플러그인으로 이동한 뒤, 제한 모드가 켜져 있으면 끕니다.
2. 찾아보기를 클릭하고 Grimoire를 검색하여 설치합니다.
3. Grimoire를 활성화한 다음 리본 또는 명령 팔레트에서 패널을 엽니다.

### GitHub Releases에서 설치

커뮤니티 플러그인을 사용할 수 없다면 현재 릴리스를 수동으로 설치하세요.

1. 최신 [Grimoire 릴리스](https://github.com/sandsaber/Grimoire/releases/latest)에서 `main.js`, `manifest.json`, `styles.css`를 다운로드합니다.
2. `/path/to/your/vault/.obsidian/plugins/grimoire`를 만듭니다.
3. 세 파일을 모두 그 폴더에 넣습니다.
4. 설정의 커뮤니티 플러그인에서 Grimoire를 활성화합니다.

### BRAT 사용

커뮤니티 디렉터리 밖에서 태그된 빌드를 추적하려면 BRAT로 GitHub Releases의 Grimoire를 설치할 수 있습니다.

1. "Obsidian42 - BRAT" 플러그인을 설치합니다.
2. BRAT에서 `sandsaber/Grimoire`의 베타 플러그인을 추가합니다.
3. Grimoire를 활성화합니다.

### 소스에서 설치(개발자)

릴리스 번들을 빌드하여 볼트에 넣습니다.

```bash
npm install
npm run build:release

mkdir -p /path/to/your/vault/.obsidian/plugins/grimoire
cp dist/grimoire/main.js dist/grimoire/manifest.json dist/grimoire/styles.css \
  /path/to/your/vault/.obsidian/plugins/grimoire/
```

그런 다음 설정의 커뮤니티 플러그인에서 Grimoire를 활성화합니다.

어떤 방법을 선택하든 시작하기 전에 CLI 제공자를 하나 이상 설치하세요. Grimoire는 제공자 CLI를 감쌉니다. 계정 설정, 모델 접근 권한, 할당량, 약관을 대체하지는 않습니다.

## 제공자 설정

설정의 Grimoire, 제공자에서 원하는 제공자를 활성화하면 모델 선택기에 표시됩니다. Codex는 처음 실행할 때 활성화되고, 나머지는 선택적으로 활성화할 수 있습니다.

### 권장 제공자

최상의 Grimoire 경험을 위해 Claude Code, Codex, OpenCode, MiMoCode, Kimi Code, Grok Build 또는 Qwen Code부터 사용하세요. 이 제공자들은 현재 볼트 네이티브 작업에 가장 강력한 런타임 기능, 즉 영속 세션, 계획 중심 워크플로, 도구 활동, 풍부한 모델 제어를 제공합니다.

Antigravity CLI와 Gemini CLI (Legacy)는 Google 계정 및 호환성 사례를 위해 계속 제공되지만, 현재 주 Grimoire 제공자로 권장하지는 않습니다. Grimoire는 최선의 노력으로 지원하며 현재 CLI가 가능하게 하는 폴백을 구현했지만, ACP와 런타임 기능에는 기술적 제약이 있습니다. 세션, 승인, 스트리밍, 도구·편집 메타데이터, 모델 검색, 사용량 보고가 권장 제공자와 비교해 불완전하거나 신뢰하기 어렵습니다.

### Claude Code

Claude 구독 또는 API 키를 기반으로 네이티브 프로젝트 메모리, 슬래시 명령, MCP 구성, 계획, 되돌리기·포크가 필요하다면 Claude Code를 선택하세요.

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude
```

Claude Code에서 인증한 다음 Grimoire에서 활성화하세요. 이전 npm 패키지는 더 이상 권장되지 않습니다. 위의 네이티브 설치 관리자, Homebrew(`brew install --cask claude-code`), WinGet 또는 공식 빠른 시작의 다른 방법을 사용하세요.

- [Claude Code quickstart](https://code.claude.com/docs/en/quickstart)

Grimoire에서 Claude Code는 `.claude/` 파일을 읽고 보존하며 Claude Code SDK에서 실행됩니다. 슬래시 명령, MCP 설정, 에이전트, 스킬, 계획, 되돌리기, 포크를 지원합니다. Claude가 둘 다 보고하면 할당량 기간과 API 지출을 나란히 볼 수 있습니다.

**Claude Code 설정 준수**는 기본으로 활성화됩니다. Grimoire는 Claude Code 사용자 설정(`~/.claude/settings.json`)과 볼트 설정(`.claude/settings.json`)에서 `model`과 `env`를 읽고, 그 값을 Claude 모델 선택기와 런타임 환경에 사용합니다. 따라서 MiniMax, Z.ai 등 Anthropic 호환 게이트웨이를 포함한 Claude Code 사용자 지정 모델도 Grimoire에서 작동합니다. 프로젝트 설정은 사용자 설정을, 명시적인 Grimoire 환경 설정은 둘 다 재정의합니다.

유효한 Claude 환경에 `ANTHROPIC_API_KEY`가 있으면 Grimoire는 Anthropic 모델 카탈로그를 새로 고쳐 검색한 모델을 선택기에 합칠 수 있습니다. API 키가 없거나 새로 고침에 실패해도 선택기는 `Best`, `Fable 5`, `Opus Plan`, 1M 변형 같은 Claude Code 별칭과 `.claude` 및 사용자 지정 Grimoire 모델을 기반으로 계속 작동합니다.

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic",
    "ANTHROPIC_MODEL": "glm-5.2[1m]",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "glm-4.7-flash"
  }
}
```

### Codex

Codex는 처음 실행할 때 기본 제공자입니다. ChatGPT 요금제 또는 API 키로 로그인한 로컬 CLI의 OpenAI Codex를 사용하려면 선택하세요.

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex
```

한 번 실행하여 로그인한 다음 Grimoire에서 활성화하세요. 이제 독립형 설치 관리자가 주 설치 경로입니다. Windows, Homebrew, 대체 패키지 관리자 옵션은 공식 Codex CLI 문서를 참고하세요.

- [Codex CLI setup](https://developers.openai.com/codex/cli)
- [OpenAI code generation guide](https://developers.openai.com/api/docs/guides/code-generation)

Grimoire에서 Codex는 app-server 프로토콜로 실행되며 네이티브 기록, 포크, 계획 모드, 이미지 입력, 추론 강도 제어를 제공합니다. Codex가 속도 제한 메타데이터를 보고하면 요금제 사용량이 표시됩니다.

### Antigravity CLI

Antigravity CLI는 소비자용 Gemini CLI 사용을 대체하는 Google 도구이며, Antigravity 계정에서 사용할 수 있는 Gemini, Claude, GPT-OSS 및 기타 모델 계열에 접근할 수 있습니다. Grimoire에서는 권장 기본값이 아닌 호환성 제공자로 취급하세요.

```bash
agy
```

Google의 공식 Antigravity CLI를 설치하고 로컬에서 인증한 다음 Grimoire에서 Antigravity를 활성화하세요. Grimoire는 PATH에서 `agy`를 자동 감지하거나, 제공자 설정에서 사용자 지정 CLI 경로를 지정할 수 있습니다.

- [Antigravity CLI](https://antigravity.google/product/antigravity-cli)
- [Gemini CLI migration guide](https://goo.gle/gemini-cli-migration)

Grimoire에서 Antigravity는 `agy models`의 선택적 모델 선택과 함께 `agy --print`로 실행됩니다. Grimoire는 활성 노트와 편집기, 브라우저, 캔버스, 볼트 검색, 프로젝트 작업 공간 컨텍스트를 이 print 프롬프트에 포함합니다. `agy`가 현재 Grimoire에 강력한 ACP 호환 런타임을 제공하지 않으므로 이는 최선의 노력 기반 통합입니다. Antigravity가 이를 위한 안정적인 런타임 기능을 제공할 때까지 영속 세션, 네이티브 기록, 이미지, 계획 모드, 스트리밍, 승인 안전 파일 편집, 신뢰할 수 있는 사용량 보고, 보조 워크플로는 비활성화되거나 제한됩니다.

알려진 Windows 제한 사항: 현재 Windows `agy` 빌드는 `agy models`와 `agy --print`에 빈 stdout을 반환하면서도 성공적으로 완료될 수 있습니다. Grimoire는 Antigravity 로그, 트랜스크립트, 설정, 미리 채운 Pro AI 모델 목록에서 최선의 노력으로 복구하지만, 업스트림 CLI가 안정적인 출력을 제공할 때까지 Windows의 Antigravity 지원은 macOS나 Linux보다 신뢰성이 낮을 수 있습니다. 계정의 Antigravity에 추가 모델이 표시되면 Antigravity 설정 > 사용자 지정 모델에 정확한 레이블을 추가하세요.

`agy --print`는 Grimoire 파일 편집 승인 훅을 노출하지 않습니다. 안전을 위해 Antigravity의 공유 Safe/일반 모드는 Grimoire에서 차단됩니다. AGY가 Grimoire 프롬프트 없이 파일을 편집해도 괜찮을 때만 Antigravity 도구 모음 토글을 Auto-approve로 바꾸세요.

### Gemini CLI (Legacy)

Gemini CLI는 Google이 Gemini CLI 요청을 계속 제공하는 Gemini Code Assist Standard, Enterprise, Google Cloud 및 유료 API 키 사용자를 위한 레거시 호환성 제공자로 남아 있습니다. ACP 지원이 약하고 여러 Grimoire 워크플로를 그 위에 안정적으로 구현할 수 없으므로 새 Grimoire 설정에는 권장하지 않습니다. 소비자 Google AI Pro, Ultra 및 무료 등급 계정은 위의 Antigravity 제한 사항을 고려하여 Google의 2026년 6월 18일 전환 이후 Antigravity를 사용해야 합니다.

```bash
gemini
```

계정 등급이 아직 지원되고 해당 레거시 Google 경로가 꼭 필요한 경우에만 Gemini CLI를 활성화하세요. Grimoire는 `gemini --acp`로 이를 실행하고 활성 노트와 편집기, 브라우저, 캔버스, 볼트 검색, 프로젝트 작업 공간 컨텍스트를 ACP 프롬프트에 포함합니다. 모델과 모드 검색은 제공자 소유로 유지하고, 권장 제공자로 보이지 않게 레거시로 표시합니다. 가능하면 Codex, Claude Code, OpenCode, MiMoCode, Kimi Code, Grok Build 또는 Qwen Code를 선택하세요.

### Qwen Code

Qwen Code는 선택적으로 활성화하는 ACP 제공자입니다. 제공자 네이티브 영속 세션, 재개, 모델 컨텍스트를 유지하며, 실시간 ACP 세션에서 모델과 모드를 검색하고, 메시지·도구 활동·계획을 스트리밍하며, 이미지 입력·제공자 명령·파일 승인을 지원합니다. Grimoire는 제공자 네이티브 메시지 기록을 복원하지 않습니다.

```bash
# Linux 및 macOS(권장 독립형 설치)
curl -fsSL https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.sh | bash

# Windows PowerShell
irm https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.ps1 | iex

# 대체 설치 방법
brew install qwen-code
npm install -g @qwen-code/qwen-code@latest # Node.js 22+

qwen --version
qwen
```

대화형 CLI에서 `/auth`를 사용하고 Alibaba ModelStudio, Third-party Providers 또는 Custom Provider를 선택하세요. Qwen OAuth는 중단되었습니다. 그런 다음 Grimoire에서 Qwen Code를 활성화하면 `qwen --acp`가 실행됩니다. Safe, Auto-approve, Plan은 Qwen의 `default`, `yolo`, `plan` 모드에 매핑됩니다. 다른 Qwen 자동 모드는 공유 도구 모음에서 보수적으로 Safe로 표시됩니다.

- [Qwen Code documentation](https://qwenlm.github.io/qwen-code-docs/en/)
- [Qwen Code authentication](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/)
- [Qwen Code repository](https://github.com/QwenLM/qwen-code)

Qwen이 시작하지 않거나 모델이 표시되지 않으면 Qwen Code에서 `/doctor`를 실행하고 `/auth`를 완료한 뒤, `qwen --version`을 확인하고 Grimoire 설정의 Qwen CLI 경로를 점검하세요.

Low, Medium, High, XHigh 또는 Max 추론 강도를 선택하세요(기본값은 High). 일반 대화 전에 Grimoire는 Qwen의 실제 `/effort <tier>` 명령을 적용하고 해당 세션에 캐시합니다. 실제 적용되는 등급은 선택한 모델과 제공자에 따라 달라집니다. Qwen의 구조화된 `AskUserQuestion` 요청은 ACP 권한 메타데이터를 통해 도착하며, 단일 선택·다중 선택·자유 형식 답변을 포함한 Grimoire의 공유 인라인 질문 UI를 사용합니다.

Qwen은 자격 증명과 네이티브 구성을 계속 `~/.qwen/settings.json`에서 관리합니다. Grimoire는 `.grimoire/mcp/qwen.json`의 격리된 프로젝트 MCP 목록을 관리하고 Qwen의 네이티브 구성을 덮어쓰지 않은 채 ACP 세션에 주입합니다. Qwen이 ACP 토큰 또는 비용 메타데이터를 내보낼 때만 사용량이 표시됩니다. Qwen은 현재 Grimoire의 포크나 되돌리기 제어를 지원하지 않습니다.

### OpenCode

자체 제공자 구성을 갖춘 모델 불문 에이전트가 필요하면 OpenCode를 선택하세요.

```bash
curl -fsSL https://opencode.ai/install | bash
opencode
```

Homebrew, npm, bun, 패키지 관리자를 통한 설치도 작동합니다. OpenCode에서 제공자 자격 증명을 구성한 다음 Grimoire에서 활성화하세요.

- [OpenCode download](https://opencode.ai/download)
- [OpenCode provider docs](https://opencode.ai/docs/providers)
- [OpenCode config docs](https://opencode.ai/docs/config)

Grimoire에서 OpenCode는 Grimoire 관리 시작 아티팩트와 함께 ACP로 실행되며, 영속 런타임, 네이티브 기록, 계획 모드, 이미지 입력, 제공자 명령, 추론 강도를 제공합니다. 비용 메타데이터가 있으면 월간 지출을 보고합니다.

### MiMoCode

MiMoCode(Xiaomi)는 영속 메모리, 지능형 컨텍스트 관리, 하위 에이전트 오케스트레이션을 갖춘 OpenCode 포크입니다.

```bash
curl -fsSL https://mimo.xiaomi.com/install | bash
mimo
```

- [MiMoCode GitHub](https://github.com/XiaomiMiMo/MiMo-Code)

### Kimi Code

Kimi Code CLI(MoonshotAI)는 Kimi, OpenAI, Anthropic, Gemini, Vertex AI 모델을 지원하는 다중 제공자 터미널 에이전트입니다.

```bash
curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash
kimi
```

- [Kimi Code GitHub](https://github.com/MoonshotAI/kimi-code)

### Grok Build

Obsidian에서 xAI의 에이전트형 CLI를 사용하려면 Grok Build를 선택하세요. Grok OAuth로 로그인하거나 xAI API 키를 사용하세요.

```bash
grok
```

xAI에서 Grok CLI를 설치하고 grok.com OAuth로 인증하거나 API 키를 구성한 다음 Grimoire에서 Grok Build를 활성화하세요.

- [Grok Build documentation](https://docs.x.ai/build/overview)
- [Grok 4.5](https://docs.x.ai/developers/grok-4-5)
- [Usage and limits](https://docs.x.ai/grok/faq)

Grok 4.5는 현재 Grok Build를 구동하는 기본 모델입니다. Grimoire는 정적 목록을 유지하는 대신 인증된 Grok CLI 계정에서 사용 가능한 모델 카탈로그를 검색하므로, 가용성은 계정과 CLI 버전에 따라 달라질 수 있으며 자동으로 업데이트됩니다.

Grimoire에서 Grok Build는 `.grimoire/grok/` 아래의 Grimoire 관리 시작 아티팩트와 함께 `grok agent stdio`를 통해 ACP로 실행됩니다. 영속 런타임, 네이티브 JSONL 기록 복원, 계획 모드, 이미지 입력, 제공자 명령, 네이티브 모델의 추론 강도, 되돌리기, 포크를 제공합니다. OAuth를 사용하면 Grimoire는 공유 주간 Grok 사용 한도, 초기화 시간, 사용 가능한 경우 Extra Usage Credits를 표시합니다. API 지출은 보고될 때 세션 비용 메타데이터에서 집계합니다.

## 첫 대화

1. 작성기에서 제공자와 모델을 선택합니다.
2. 추론 강도를 설정하고 권한 제어에서 Safe, Auto-approve 또는 Plan을 선택합니다.
3. 범위에 포함할 노트, 폴더 또는 컨텍스트를 멘션합니다.
4. 대화를 전송합니다.
5. 패널에 도구 호출, 사용량, 출력이 표시되는지 확인합니다.

## 기능

### 채팅 작업 공간

여러 탭이 있는 집중형 사이드 패널입니다. 각 탭은 자체 초안, 제공자, 모델, 컨텍스트, 런타임을 유지합니다. Obsidian을 닫았다 다시 열어도 세션이 돌아오며 모든 응답에서 제공자, 모델, 추론 강도가 보존됩니다. 활성 제공자가 지원하면 되돌리기와 포크가 표시됩니다. 무언가 읽으려고 스크롤을 벗어나는 즉시 자동 스크롤이 멈춥니다. 표시되는 출력 없이 10초가 지나면 공유 대기 표시기가 활성 제공자와 경과 시간을 보여 주며, 질문이나 권한 승인을 기다리는 동안에는 일시 중지됩니다.

### 탭, 기록, 탐색 제어

탭을 마우스 오른쪽 버튼으로 클릭하여 이름 변경, 복제, 닫기, 다른 탭 닫기, 오른쪽 탭 닫기를 실행할 수 있습니다. 가운데 버튼 클릭은 탭을 닫고, 시간 제한이 있는 실행 취소는 초안과 위치를 복원합니다. 채팅 기록의 동작, 수정 키 클릭, 가운데 버튼 클릭으로 저장된 대화를 새 탭에서 엽니다. 긴 대화에는 맨 위, 이전 프롬프트, 대화 디렉터리, 다음 프롬프트, 맨 아래로 이동하는 5방향 탐색기가 있습니다. 완료된 메시지는 복사 동작 옆에 현지화된 완료 시각을 표시합니다.

<p align="center">
  <img src="../../assets/readme/conversation-history.png" alt="Grimoire 대화 기록 및 탭 탐색" width="100%">
</p>

### 병렬 작업자, 설정, 작성기

**병렬 작업자** 승인 카드는 상속된 모델을 보여 주고 시작할 제안 작업만 선택하게 합니다. 설정은 Obsidian 네이티브 검색과 영구적인 새 소식 항목을 제공합니다. 제공자 설정과 작성기는 일관된 화면을 사용하면서 제공자 소유 제어와 구성은 해당 제공자에 둡니다.

### 키보드 단축키

| 단축키 | 동작 |
| --- | --- |
| `Enter` | 현재 대화를 전송합니다. **버튼으로만 전송**이 활성화되면 사용할 수 없습니다. |
| `Shift+Enter` | 작성기에 새 줄을 삽입합니다. |
| `Shift+Tab` | 권한 모드를 순환합니다: `Safe -> Auto-approve -> Plan -> Safe`. Plan 모드가 없는 제공자는 Safe와 Auto-approve 사이를 순환합니다. |
| `Escape` | 활성 응답을 중지하거나 열린 채팅 기록 시트를 닫습니다. |

### 모델 선택기

하나의 선택기에 제공자별로 그룹화하고 레이블 순으로 정렬합니다. Antigravity, Claude Code, Codex, Gemini CLI (Legacy), Grok Build, Kimi Code, MiMoCode, OpenCode, Qwen Code가 포함됩니다. 필터링 중에도 메뉴 크기를 바꾸지 않고 레이블, 설명, 그룹, 모델 ID 전체에서 검색합니다. 카탈로그는 지연 로드되며 접은 그룹을 기억합니다. 설정에서 사용자 지정 별칭과 컨텍스트 창 재정의를 추가하세요. Claude의 1M 변형은 기본 모델을 대체하는 것이 아니라 추가 옵션입니다.

### 사용량 및 비용

모델 선택기 옆의 배지는 활성 제공자의 사용량을 계속 보여 주며, 모델 메뉴 안에서는 더 자세한 정보를 제공합니다. 제공자가 노출하는 경우 할당량 기간을, 비용만 제공되는 경우 지출을 표시합니다. 새로 고침이 진행 중이거나 실패해도 이전 숫자를 유지하므로 측정기가 비어 있지 않습니다. 더 조용한 UI를 원한다면 설정에서 전체 기능을 끄세요.

| 제공자 | 사용량 출처 |
| --- | --- |
| Claude Code | SDK 속도 제한 이벤트, 선택 사항인 `.grimoire/claude/statusline-usage.json`, SDK 결과 비용 메타데이터 |
| Codex | 계정 속도 제한 알림 및 사용 가능한 경우 `account/rateLimits/read` |
| Antigravity CLI | 아직 `agy --print`에서 신뢰성 있게 제공되지 않음 |
| Gemini CLI (Legacy) | Gemini CLI가 보고할 때의 ACP 비용 메타데이터, 레거시 제공자 전용 |
| Qwen Code | Qwen Code가 보고할 때의 ACP 토큰 및 비용 메타데이터 |
| OpenCode | ACP 및 세션 비용 메타데이터에서 집계한 월간 지출 |
| MiMoCode | ACP 및 세션 비용 메타데이터에서 집계한 월간 지출 |
| Kimi Code | ACP 및 세션 비용 메타데이터에서 집계한 월간 지출 |
| Grok Build | OAuth를 통한 공유 주간 Grok 사용량, 초기화 시간, Extra Usage Credits, 세션 비용 메타데이터의 월간 API 지출 |

### 계획 모드

활성 제공자가 Plan 모드를 지원하면 다음 두 가지 방법 중 하나로 켤 수 있습니다.

- 작성기의 권한 제어를 클릭하여 Plan으로 순환합니다: `Safe -> Auto-approve -> Plan`.
- `Shift+Tab`을 눌러 전체 순서를 순환합니다: `Safe -> Auto-approve -> Plan -> Safe`.

계획 모드는 제공자에게 변경을 시작하기 전에 계획을 세우도록 요청합니다. 작성기에서는 Safe 및 Auto-approve와 같은 권한 제어를 사용하므로 작업 중에도 활성 모드가 표시됩니다.

제공자가 계획을 마치면 Grimoire는 렌더링된 계획, 요청된 권한, 키보드 친화적인 행이 있는 접을 수 있는 계획 완료 카드를 표시합니다. 승인하면 같은 세션에서 계속하고, 피드백을 입력하면 제공자가 계획을 수정할 수 있도록 계획 모드가 활성 상태로 유지됩니다.

### 컨텍스트 및 멘션

작성기에서 바로 볼트 노트와 폴더를 멘션하고, 현재 또는 연결된 노트를 가져오며, 설정에서 영구적인 외부 컨텍스트 경로를 추가하세요. 제공자가 이미지 입력을 받는 경우 이미지를 붙여 넣거나 끌어다 놓을 수 있습니다. 제공자 통합이 지원하는 경우 MCP 서버를 멘션하세요. 컨텍스트 탭에는 연결된 노트, 모델, 권한 모드, 고정된 파일, `.grimoire/grok/system.md` 같은 시작 아티팩트, 에이전트가 세션 중 로드한 파일이 표시됩니다.

### 인라인 편집

선택 영역에서 "Grimoire: Inline edit"을 실행하세요. 텍스트 옆에 프롬프트가 열리고, 편집 내용은 승인하거나 거부할 수 있는 diff로 돌아오며 제공자 기반 인라인 편집 서비스를 거칩니다. 선택 영역 바꾸기와 새 텍스트 삽입을 모두 처리합니다.

### 확인 질문

제공자가 구조화된 사용자 입력을 요청하면 Grimoire는 대화를 일시 중지하고 작성기 위에 질문을 렌더링합니다. Claude Code는 이를 `AskUserQuestion`으로, Codex app-server는 실험적인 `request_user_input` / `requestUserInput` 기능으로 노출하며, Qwen Code는 ACP 권한 메타데이터를 통해 `AskUserQuestion`을 전달합니다. Grimoire는 이 제공자별 메커니즘을 동일한 인라인 질문 UI로 정규화합니다. 단일 선택, 다중 선택, 자유 형식 답변은 제공자 실행으로 되돌아가므로 에이전트는 별도 채팅 메시지 없이 계속할 수 있습니다.

질문이 다시 읽어야 할 채팅 텍스트를 가린다면 질문 헤더의 꺾쇠를 사용해 작은 막대로 접으세요. 선택한 답변과 자유 형식 답변은 질문을 펼치거나 제출할 때까지 유지됩니다.

### 명령

기본 제공 명령은 이미지 생성과 재개 같은 Grimoire 워크플로를 처리합니다. Claude Code 슬래시 명령, OpenCode·Grok Build·Qwen Code 런타임 명령처럼 자체 명령을 노출하는 제공자는 제공자 소유 카탈로그를 통해 이를 표시합니다. 사용하지 않는 항목은 설정에서 드롭다운에서 숨기세요.

### 이미지 생성

이미지를 붙여 넣거나 끌어다 놓아 첨부하세요. 기본 제공 `/image [prompt]` 명령은 자체적으로 이미지 API를 호출하지 않습니다. 제공자 네이티브 도구, MCP 도구, 로컬 명령 등 구성한 이미지 생성 방식을 사용하라는 지시와 함께 일반 대화를 활성 제공자에게 전달합니다. 에이전트는 결과를 볼트에 저장하고 `![[path/to/image.png]]` 같은 임베드를 반환합니다. 이미지 생성을 위해 구성한 것이 없으면 누락된 항목을 설명하는 일반 답변을 받습니다.

### 안전 및 권한

권한 모드는 제공자에 속하므로 Grimoire는 이를 새로 만들지 않고 공유 작성기 제어를 통해 표시합니다. 활성 제공자가 계획 모드를 지원하면 권한 제어와 `Shift+Tab` 모두 Safe, Auto-approve, Plan을 순환합니다. 작업 중에도 Safe 모드와 권한 프롬프트는 계속 표시됩니다. Bang-bash 모드는 활성화된 제공자가 제공할 때만 나타납니다. 구성된 MCP 서버, 셸 접근, API 키는 실제로 민감하므로 민감한 것으로 취급하세요.

### 디버그 로깅

기본값은 꺼짐입니다. 켜면 Grimoire는 프롬프트, 답변, 노트 내용, 경로, 환경 값, 비밀 정보를 삭제한 정제된 JSONL을 `.grimoire/logs/YYYY-MM-DD.jsonl`에 작성합니다. 이는 트랜스크립트 보관이 아니라 제공자 및 런타임 문제 진단을 위한 것입니다.

### 설정

일반 설정은 Obsidian 테마 동작, 자동 스크롤, 제목 생성, 사용량 표시기, 디버그 로깅, 로캘, 탭, 설정 뷰 소유자를 다룹니다. 제공자별 탭은 CLI 경로, 모델 동작, 명령, 에이전트, 스킬, 제공자 소유 구성을 처리합니다. 필요하면 제공자별 범위 지정 프로젝트 작업 공간 환경 변수도 설정할 수 있습니다.

<p align="center">
  <img src="../../assets/readme/settings-general.png" alt="Grimoire 일반 설정" width="100%">
</p>

## Grimoire 데이터 저장 위치

| 경로 | 내용 |
| --- | --- |
| `.grimoire/grimoire-settings.json` | 앱 설정 및 제공자 구성 |
| `.grimoire/sessions/*.meta.json` | 세션 메타데이터 |
| `.grimoire/logs/YYYY-MM-DD.jsonl` | 선택적으로 활성화하는 정제된 디버그 로그 |
| `.grimoire/claude/statusline-usage.json` | 계획 측정기를 위한 Claude 사용량 스냅샷 |
| `.grimoire/grok/` | Grok Build 시작 아티팩트, 관리 구성, 세션 포인터 |

`.claude/`, `.codex/`, `.opencode/`, `.grimoire/grok/` 아래의 제공자 네이티브 파일은 제자리에서 읽고 쓰므로 제공자 설정은 Grimoire 밖에서도 이식성을 유지합니다.

## 개인정보 보호

Grimoire는 사용자의 컴퓨터에서 Obsidian 안에 실행됩니다. 백엔드가 없고 텔레메트리를 추가하지 않으며, 프롬프트, 답변, 노트, 파일, 도구 출력, API 키, 사용량 로그를 Grimoire 서비스에 업로드하지 않습니다. 작성하는 로그는 위의 선택적이고 정제된 디버그 로그뿐이며, 이 로그도 볼트에 남습니다.

숨길 수 없는 것은 제공자 자체입니다. 활성화하는 모든 CLI는 프롬프트, 선택한 컨텍스트, 요청에 필요한 파일·이미지·도구 출력·명령을 받습니다. 해당 CLI는 Anthropic, OpenAI, Google, 구성한 OpenCode 공급업체, MCP 서버 또는 접근하도록 설정된 기타 대상과 통신할 수 있습니다. 약관, 보존, 청구, 속도 제한, 개인정보 처리방침은 Grimoire가 아닌 제공자의 것입니다. Grimoire의 역할은 이 경계를 보이게 하고 Obsidian 안에서 사용자가 통제하도록 돕는 것입니다.

네트워크, 계정, 외부 파일 접근, 로깅, 텔레메트리 경계에 관한 Obsidian 정책 요약은 [DISCLOSURES.md](../../DISCLOSURES.md)를 참고하세요.

## 개발

기여를 환영합니다. 풀 리퀘스트를 열기 전에
[CONTRIBUTING.md](../../CONTRIBUTING.md)를 읽으세요. 제공자 소유권, 보안 경계, 테스트, 생성된
아티팩트, 저장소의 검토 기대 사항을 다룹니다.

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run test
npm run build
npm run build:release
```

의미 있는 UI 또는 제공자 변경을 게시하거나 푸시하기 전에 전체 로컬 검증을 실행하세요.

```bash
npm run test -- --selectProjects unit
npm run typecheck
npm run lint
npm run build:release
```

`npm run build:release`는 생성된 `main.js`, 루트 `styles.css`, `dist/grimoire`를 새로 고칩니다.

npm은 개발, CI, 릴리스의 정식 패키지 관리자입니다. 의존성이 변경되면 `package-lock.json`을 최신으로 유지하세요. 보조 패키지 관리자 잠금 파일은 의도적으로 커밋하지 않습니다.

## 릴리스

Grimoire 릴리스는 `1.0.0` 같은 semver 태그에서 게시됩니다. 릴리스 워크플로는 로컬 검증을 실행하고 Obsidian 번들을 빌드하며, 태그가 `package.json` 및 `manifest.json`과 일치하는지 확인한 후 `main.js`, `manifest.json`, `styles.css`를 GitHub Release에 첨부합니다.

Obsidian 커뮤니티 플러그인은 권장되는 사용자 설치 경로입니다. GitHub Releases에는 수동 설치와 BRAT를 위한 번들 자산도 계속 제공됩니다. 릴리스 가능한 개발에는 `main`을 사용하고, manifest와 일치하는 버전에 태그를 달아 게시하세요.

## 로드맵

현재 Grimoire는 Claude Code, Codex, Antigravity CLI, Gemini CLI (Legacy), OpenCode, MiMoCode, Kimi Code, Grok Build, Qwen Code와 함께 제공됩니다.

다음 후보는 GitHub Copilot CLI, 추가 ACP 호환 제공자, Obsidian에 임베드할 만큼 안정적인 로컬 모델 CLI입니다. 구현 메모는 [제공자 로드맵](../provider-roadmap.md)에 있습니다.

## 라이선스

MIT. [LICENSE](../../LICENSE)를 참고하세요.
