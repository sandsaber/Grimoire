# Grimoire · 魔導書

<p align="center">
  <img src="../../assets/readme/grimoire-logo.png" alt="Grimoire 標誌" width="240">
</p>

<p align="center">
  <strong>面向 Obsidian vault 的 local-first AI 代理。</strong>
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="授權：MIT">
  <img src="https://img.shields.io/github/v/release/sandsaber/Grimoire?label=release" alt="最新版本">
  <img src="https://img.shields.io/badge/Obsidian-1.13.0%2B-7c3aed" alt="Obsidian 1.13.0+">
  <img src="https://img.shields.io/badge/platform-desktop-lightgrey" alt="僅桌面端">
</p>

<p align="center">
  <img src="../../assets/readme/chat-workspace.png" alt="Grimoire 側邊欄與 Obsidian 筆記並排執行" width="100%">
</p>

<p align="center">
  <sub>在筆記所在的同一個 Obsidian workspace 中，與本地 CLI 代理對話。</sub>
</p>

> **提示：2.0 正在開發中。** 下一個主要版本會把 Grimoire 遷移到以提供者為基礎的執行架構：由一個核心驅動每個 CLI，並為每一輪精確記錄一個結果；同時帶來跟隨儲存庫主題與強調色的全新設計。相關工作在 `providers-migration` 分支進行，尚未納入任何已發布版本。對話、設定與提供者檔案將原樣保留。

Grimoire 將 agentic CLI 助手帶入 Obsidian。Claude Code、Codex、Antigravity CLI、Gemini CLI (Legacy)、OpenCode、MiMoCode、Kimi Code、Grok Build 和 Qwen Code 都在同一個側邊欄中執行：讀取筆記、編輯檔案、執行命令、呼叫工具，並把 session history 保存在真實的 vault context 中。Grimoire 不經過自家伺服器：沒有 telemetry、沒有 hosted backend，也沒有夾在你和 provider 之間的 proxy。

它面向已經在 Obsidian 中工作的人：你可以使用本地 context、本地檔案、明確選擇的 provider，並在介面中直接看到 usage 和 cost。

> 英文 [README](../../README.md) 是專案的 canonical 文件。此翻譯會隨目前產品文件維護。

## 為什麼選擇 Grimoire

- 在筆記中直接使用你已經信任的 CLI 代理。
- 從 composer 切換 provider。Claude Code、Codex、Antigravity CLI、Gemini CLI (Legacy)、OpenCode、MiMoCode、Kimi Code、Grok Build 和 Qwen Code 共用一個 model picker。
- 讓每一次 turn 都基於 vault context。可以 mention 筆記、資料夾和 MCP tools，不需要手動複製路徑。
- 在選擇模型的位置直接看到 cost 和 limits。
- 保持 local-first。Grimoire 不收集 telemetry，不 proxy prompts，也不執行 backend。

## 各 provider 能做什麼

| 能力 | Claude Code | Codex | OpenCode | Grok Build | MiMoCode | Kimi Code | Antigravity CLI | Gemini CLI (Legacy) | Qwen Code |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 本地 persistent runtime | 是 | 是 | 是 | 是 | 是 | 是 | 否 | 是 | 是 |
| 原生 history hydration | 是 | 是 | 是 | 是 | 是 | 是 | 否 | 是 | 否 |
| Plan mode | 是 | 是 | 是 | 是 | 是 | 是 | 否 | 是 | 是 |
| Image attachments | 是 | 是 | 是 | 是 | 是 | 是 | 否 | 是 | 是 |
| Instruction mode | 是 | 是 | 是 | 是 | 是 | 是 | 否 | 是 | 是 |
| Reasoning effort controls | 是 | 是 | 是 | 是 | 是 | 是 | 是 | 是 | 是 |
| Rewind | 是 | 否 | 否 | 是 | 否 | 否 | 否 | 否 | 否 |
| Fork | 是 | 是 | 否 | 是 | 否 | 否 | 否 | 否 | 否 |
| Provider slash commands | 是 | 否 | 是 | 是 | 是 | 是 | 否 | 是 | 是 |
| Grimoire-managed MCP UI | 是 | 否 | 是 | 是 | 是 | 是 | 否 | 是 | 是 |

## 安裝

Grimoire 是桌面端 plugin。它會在本地驅動你的 provider CLIs，因此沒有 mobile build。

### 使用 Community plugins（推薦）

請從 Obsidian community plugin directory 安裝 Grimoire：

1. 開啟 Settings，進入 Community plugins，如有需要先關閉 Restricted mode。
2. 點擊 Browse，搜尋 Grimoire 並安裝。
3. 啟用 Grimoire，然後透過 ribbon 或 command palette 開啟面板。

### 使用 GitHub Releases

如果無法使用 Community plugins，可以手動安裝目前 release：

1. 從最新的 [Grimoire release](https://github.com/sandsaber/Grimoire/releases/latest) 下載 `main.js`、`manifest.json` 和 `styles.css`。
2. 建立 `/path/to/your/vault/.obsidian/plugins/grimoire`。
3. 將三個檔案都放入該資料夾。
4. 在 Settings, Community plugins 中啟用 Grimoire。

### 使用 BRAT

如果你想在 community directory 之外追蹤 tagged builds，BRAT 可以從 GitHub Releases 安裝 Grimoire：

1. 安裝 "Obsidian42 - BRAT" plugin。
2. 在 BRAT 中新增來自 `sandsaber/Grimoire` 的 beta plugin。
3. 啟用 Grimoire。

### 從原始碼安裝

建構 release bundle，並放入你的 vault：

```bash
npm install
npm run build:release

mkdir -p /path/to/your/vault/.obsidian/plugins/grimoire
cp dist/grimoire/main.js dist/grimoire/manifest.json dist/grimoire/styles.css \
  /path/to/your/vault/.obsidian/plugins/grimoire/
```

然後在 Settings, Community plugins 中啟用 Grimoire。

無論使用哪種安裝方式，請先安裝至少一個 CLI provider。Grimoire 包裝 provider CLIs，但不會取代它們的 account setup、model access、quotas 或 terms。

## 設定 provider

在 Settings, Grimoire, Providers 中啟用你需要的 providers，它們會出現在 model selector 中。Codex 在首次啟動時預設啟用；其他 providers 是 opt-in。

### 推薦 providers

為了獲得最好的 Grimoire 體驗，建議先從 Claude Code、Codex、OpenCode、MiMoCode、Kimi Code、Grok Build 或 Qwen Code 開始。這些 providers 目前為 vault-native 工作提供最強的 runtime surface：persistent sessions、plan-oriented workflows、tool activity，以及更豐富的 model controls。

Antigravity CLI 和 Gemini CLI (Legacy) 仍然可用於 Google accounts 和 compatibility 場景，但目前不建議作為 Grimoire 的主要 provider。Grimoire 以 best-effort 方式支援它們，並已實作目前 CLI 能提供的 fallback，但它們的 ACP 和 runtime surfaces 有技術限制：sessions、approvals、streaming、tool/edit metadata、model discovery 和 usage reporting 相比推薦 providers 並不完整，也不夠可靠。

### Claude Code

如果你需要 Claude 的 native project memory、slash commands、MCP configuration、plans、rewind/fork，並希望透過 Claude subscription 或 API key 工作，可以選擇 Claude Code。

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude
```

先透過 Claude Code 完成認證，然後在 Grimoire 中啟用它。舊的 npm package 已 deprecated；請使用上面的 native installer、Homebrew (`brew install --cask claude-code`)、WinGet，或 official quickstart 中的其他選項。

- [Claude Code quickstart](https://code.claude.com/docs/en/quickstart)

在 Grimoire 中，Claude Code 會讀取並保留你的 `.claude/` 檔案，執行在 Claude Code SDK 上，並支援 slash commands、MCP settings、agents、skills、plans、rewind 和 fork。當 Claude 同時回報 quota 和 cost 時，你會並排看到 quota windows 和 API spend。

**Respect Claude Code settings** is enabled by default. Grimoire reads Claude Code user settings (`~/.claude/settings.json`) and vault settings (`.claude/settings.json`) for `model` and `env`, then uses those values in the Claude model selector and runtime environment. This lets Claude Code custom models work in Grimoire too, including Anthropic-compatible gateways such as MiniMax, Z.ai, and others. Project settings override user settings, and explicit Grimoire environment settings override both.

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

Codex 是首次啟動時的預設 provider。選擇它可以在本地 CLI 中使用 OpenAI Codex，並透過 ChatGPT plan 或 API key 登入。

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex
```

先執行一次 Codex 並登入，然後在 Grimoire 中啟用。Standalone installer 現在是 primary install path；Windows、Homebrew 和 fallback package-manager options 請參考官方 Codex CLI 文件。

- [Codex CLI setup](https://developers.openai.com/codex/cli)
- [OpenAI code generation guide](https://developers.openai.com/api/docs/guides/code-generation)

在 Grimoire 中，Codex 透過 app-server protocol 執行，支援 native history、fork、plan mode、image input 和 reasoning effort controls。當 Codex 回報 rate-limit metadata 時，plan usage 會顯示出來。

### Antigravity CLI

Antigravity CLI 是 Google 面向 consumer Gemini CLI 場景的替代工具，可存取你的 Antigravity account 中可用的 Gemini、Claude、GPT-OSS 和其他模型系列。在 Grimoire 中，請把它視為 compatibility provider，而不是推薦預設選擇。

```bash
agy
```

從 Google 安裝官方 Antigravity CLI，在本機完成認證，然後在 Grimoire 中啟用 Antigravity。Grimoire 會從 PATH 自動偵測 `agy`，你也可以在 provider settings 中設定 custom CLI path。

- [Antigravity CLI](https://antigravity.google/product/antigravity-cli)
- [Gemini CLI migration guide](https://goo.gle/gemini-cli-migration)

在 Grimoire 中，Antigravity 透過 `agy --print` 執行，並可從 `agy models` 選擇模型。這是 best-effort integration，因為 `agy` 目前沒有向 Grimoire 暴露足夠強的 ACP-compatible runtime。在 Antigravity 提供穩定 runtime surfaces 之前，persistent sessions、native history、images、plan mode、streaming、approval-safe file edits、reliable usage reporting 和 auxiliary workflows 都會保持關閉或受限。

Windows note: current Windows `agy` builds can finish successfully while returning empty stdout for `agy models` and `agy --print`. Grimoire uses best-effort recovery from Antigravity logs, transcripts, settings, and a seeded Pro AI model list, but Windows Antigravity support may be less reliable than macOS or Linux. If your account shows additional models in Antigravity, add their exact labels under Antigravity settings > Custom models.

### Gemini CLI (Legacy)

Gemini CLI 作為 legacy compatibility provider 保留給 Gemini Code Assist Standard、Enterprise、Google Cloud 和 paid API-key users，前提是 Google 仍繼續服務 Gemini CLI requests。不建議在新的 Grimoire setup 中使用它，因為它的 ACP support 較弱，許多 Grimoire workflows 無法可靠地基於它實作。Consumer Google AI Pro、Ultra 和 free-tier accounts 在 June 18, 2026 之後應使用 Antigravity，並注意上面的 Antigravity 限制。

```bash
gemini
```

只有當你的 account tier 仍受支援，且你確實需要這個 legacy Google path 時，才啟用 Gemini CLI。Grimoire 透過 `gemini --acp` 執行它，將 active note、editor/browser/canvas selection、vault search 和 project workspace context 加入 ACP prompt，並標記為 legacy，避免看起來像推薦 provider。盡量優先使用 Codex、Claude Code、OpenCode、MiMoCode、Kimi Code、Grok Build 或 Qwen Code。

### Qwen Code

Qwen Code 是 opt-in ACP provider，支援 provider-native persistent sessions、resume 和 model context、live model/mode discovery、streaming messages/tools/plans、image input、provider commands 和 file approvals。Grimoire 不會 hydrate provider-native message history。

```bash
# Linux 與 macOS：建議的 standalone 安裝
curl -fsSL https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.sh | bash

# Windows PowerShell
irm https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.ps1 | iex

# 其他安裝方式
brew install qwen-code
npm install -g @qwen-code/qwen-code@latest # 需要 Node.js 22+
qwen --version
qwen
```

在互動式 CLI 使用 `/auth`，選擇 Alibaba ModelStudio、Third-party Providers 或 Custom Provider；Qwen OAuth 已停止。然後在 Grimoire 啟用 Qwen Code，它會啟動 `qwen --acp`。Safe、Auto-approve 和 Plan 對應 Qwen 的 `default`、`yolo` 和 `plan`；其他 automatic modes 在 shared toolbar 中會保守顯示為 Safe。模型和 modes 來自 live ACP session。

- [Qwen Code documentation](https://qwenlm.github.io/qwen-code-docs/en/)
- [Qwen Code authentication](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/)
- [Qwen Code repository](https://github.com/QwenLM/qwen-code)

如果 Qwen 無法啟動或沒有顯示模型，請在 Qwen Code 中執行 `/doctor`、完成 `/auth`、檢查 `qwen --version`，並確認 Grimoire settings 中的 Qwen CLI path。

Reasoning effort 有 Low、Medium、High、XHigh、Max，預設 High。每個 normal turn 前，Grimoire 會執行真正的 Qwen `/effort <tier>` 並按 session 快取；effective tier 仍取決於所選 model/provider。Structured `AskUserQuestion` 透過 ACP permission metadata 到達，並在 shared inline question UI 中支援 single-select、multi-select 和 freeform answers。

Credentials 和 native config 仍由 Qwen 在 `~/.qwen/settings.json` 中管理。Grimoire 管理 `.grimoire/mcp/qwen.json` 中隔離的 project MCP list，並在不重寫 Qwen native config 的情況下傳入 ACP sessions。只有 Qwen 傳送 ACP token/cost metadata 時才顯示 usage；Qwen 目前不支援 Grimoire fork 或 rewind。

### OpenCode

如果你想使用自帶 provider configuration 的 model-agnostic agent，可以選擇 OpenCode。

```bash
curl -fsSL https://opencode.ai/install | bash
opencode
```

Homebrew、npm、bun 和 package-manager installs 也可以。先在 OpenCode 中設定 provider credentials，然後在 Grimoire 中啟用。

- [OpenCode download](https://opencode.ai/download)
- [OpenCode provider docs](https://opencode.ai/docs/providers)
- [OpenCode config docs](https://opencode.ai/docs/config)

在 Grimoire 中，OpenCode 透過 ACP 執行，使用 Grimoire-managed launch artifacts，並支援 persistent runtime、native history、plan mode、image input、provider commands 和 reasoning effort。當 cost metadata 可用時，它會顯示 monthly spend。

### MiMoCode

MiMoCode（小米）是 OpenCode 的分支，具有持久記憶、智慧上下文管理和子代理編排功能。

```bash
curl -fsSL https://mimo.xiaomi.com/install | bash
mimo
```

- [MiMoCode GitHub](https://github.com/XiaomiMiMo/MiMo-Code)

### Kimi Code

Kimi Code CLI（月之暗面）是一個多模型終端代理，支援 Kimi、OpenAI、Anthropic、Gemini 和 Vertex AI 模型。

```bash
curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash
kimi
```

- [Kimi Code GitHub](https://github.com/MoonshotAI/kimi-code)

### Grok Build

若要在 Obsidian 中使用 xAI 的 agentic CLI，可選擇 Grok Build。透過 Grok OAuth 登入，或使用 xAI API 金鑰。

```bash
grok
```

安裝 xAI 的 Grok CLI，透過 grok.com OAuth 認證或設定 API keys，然後在 Grimoire 中啟用 Grok Build。

- [Grok Build 文件](https://docs.x.ai/build/overview)
- [Grok 4.5](https://docs.x.ai/developers/grok-4-5)
- [使用量與限制](https://docs.x.ai/grok/faq)

Grok 4.5 目前是 Grok Build 的預設模型。Grimoire 從已驗證的 Grok CLI 帳戶取得可用模型目錄，而不是維護靜態清單，因此模型可用性可能會因帳戶和 CLI 版本而異，並自動更新。

在 Grimoire 中，Grok Build 透過 `grok agent stdio` 以 ACP 執行，使用 `.grimoire/grok/` 下的 Grimoire-managed launch artifacts，並支援 persistent runtime、native JSONL history hydration、plan mode、image input、provider commands、native models 上的 reasoning effort、rewind 和 fork。使用 OAuth 時，Grimoire 會顯示共用的每週 Grok 使用額度、重設時間以及可用的 Extra Usage Credits；API spend 會在 session cost metadata 回報時聚合顯示。

## 第一次聊天

1. 在 composer 中選擇 provider 和 model。
2. 設定 reasoning effort，並在 permission control 中選擇 Safe、Auto-approve 或 Plan。
3. Mention 你希望納入 scope 的筆記、資料夾或 context。
4. 傳送 turn。
5. 在面板裡查看 tool calls、usage 和輸出。

## 功能

### Chat workspace

一個專注的側邊欄，支援多個 tabs。每個 tab 都保留自己的 draft、provider、model、context 和 runtime。關閉再開啟 Obsidian 後，sessions 會恢復，並且每個 response 都保留 provider、model 和 reasoning effort。Rewind 和 fork 會在目前 provider 支援時出現。你一旦手動捲動去閱讀歷史，auto-scroll 會自動讓位。10 秒沒有可見輸出後，shared wait indicator 會顯示 active provider 和已等待時間；等待問題或 permission 時會暫停。

### Tab、歷史與導覽控制

右鍵點擊 tab 可重新命名、複製、關閉、關閉其他 tabs 或關閉右側 tabs；middle-click 會關閉 tab，而限時 Undo 會還原其 draft 和位置。可從 chat history 透過 action、modifier-click 或 middle-click 在新 tab 開啟儲存的對話。長對話提供五向 navigator：頂端、上一個 prompt、對話目錄、下一個 prompt 和底端。完成的 message 會在 copy action 旁顯示本地化 completion timestamp。

<p align="center">
  <img src="../../assets/readme/conversation-history.png" alt="Grimoire 對話歷史與分頁導覽" width="100%">
</p>

### Parallel workers、settings 與 composer

**Parallel workers** approval card 會顯示 inherited model，並只啟動你選取的建議任務。Settings 使用 Obsidian native search，並保留永久的 What's New 項目。Provider settings 和 composer 在各 provider 間使用一致的 surface，同時保留 provider-owned controls 和 configuration。

### 鍵盤快捷鍵

| 快捷鍵 | 操作 |
| --- | --- |
| `Enter` | 傳送目前的 turn。啟用 **Send only with button** 時此快捷鍵不可用。 |
| `Shift+Enter` | 在 composer 中插入新行。 |
| `Shift+Tab` | 循環切換 permission modes：`Safe -> Auto-approve -> Plan -> Safe`。不支援 Plan mode 的 providers 會在 Safe 和 Auto-approve 之間切換。 |
| `Escape` | 停止目前的 response，或關閉已開啟的 chat history 面板。 |

### Model selector

一個 picker，按 provider 分組，並按 label 排序：Antigravity、Claude Code、Codex、Gemini CLI (Legacy)、Grok Build、Kimi Code、MiMoCode、OpenCode 和 Qwen Code。Search 會匹配 labels、descriptions、groups 和 model IDs。Catalogs 會 lazy load，並記住你摺疊過的 groups。你可以在 settings 中新增 custom aliases 和 context-window overrides。Claude 的 1M variants 是額外 options，不會替代 base models。

### Usage 和 cost

Model selector 旁邊的 badge 會持續顯示目前 provider 的 usage；model menu 中有更完整的 readouts：如果 provider 暴露 quota windows 就顯示 quota，如果只有 cost 可用就顯示 spend。Refresh 進行中或失敗時，最後一次成功的數值會保留，因此 meter 不會突然清空。如果你想要更安靜的 UI，可以在 settings 中關閉整個 usage/cost 顯示。

| Provider | Usage 來源 |
| --- | --- |
| Claude Code | SDK rate-limit events、可選的 `.grimoire/claude/statusline-usage.json` 和 SDK result cost metadata |
| Codex | Account rate-limit notifications，以及可用時的 `account/rateLimits/read` |
| Antigravity CLI | `agy --print` 目前尚無法可靠提供 |
| Gemini CLI (Legacy) | Gemini CLI 回傳時的 ACP cost metadata；僅 legacy provider |
| Qwen Code | 僅在 Qwen Code 回傳時的 ACP token 和 cost metadata |
| OpenCode | 從 ACP 和 session cost metadata 聚合的 monthly spend |
| MiMoCode | 從 ACP 和 session cost metadata 聚合的 monthly spend |
| Kimi Code | 從 ACP 和 session cost metadata 聚合的 monthly spend |
| Grok Build | 透過 OAuth 顯示共用的每週 Grok 使用額度、重設時間和 Extra Usage Credits；來自 session cost metadata 的 monthly API spend |

### Plan mode

當 active provider 支援 Plan mode 時，可以用兩種方式開啟：

- 點擊 composer 裡的 permission control，直到它切換到 Plan：`Safe -> Auto-approve -> Plan`。
- 按 `Shift+Tab` 循環切換完整序列：`Safe -> Auto-approve -> Plan -> Safe`。

Plan mode 會要求 provider 先制定計畫，再開始進行變更。在 composer 中，它使用與 Safe 和 Auto-approve 相同的 permission control，因此工作時 active mode 會一直可見。

當 provider 完成計畫後，Grimoire 會顯示可折疊的 Plan complete 卡片，其中包含渲染後的計畫、要求的 permissions，以及適合鍵盤操作的列。Approve 會在同一個 session 中繼續；輸入 feedback 會保持 Plan mode，讓 provider 可以修改計畫。

### Context 和 mentions

可以直接在 composer 中 mention vault notes 和 folders，拉入 current 或 linked note，並在 settings 中新增 persistent external context paths。Provider 支援 image input 時，可以貼上或拖放圖片。支援的 provider integrations 中也可以 mention MCP servers。Context 分頁會顯示綁定的筆記、model、permission mode、固定檔案、`.grimoire/grok/system.md` 等 launch artifacts，以及 agent 在 session 期間載入的檔案。

### Inline editing

對選取文字執行 "Grimoire: Inline edit"。Prompt 會在文字旁開啟，edit 會以 diff 回傳，你可以 accept 或 reject，並且會透過 provider-backed inline edit service 執行。它既支援替換 selection，也支援插入新文字。

### Clarifying questions

當 provider 要求 structured user input 時，Grimoire 會暫停 turn，並在 composer 上方顯示問題。Claude Code 將它暴露為 `AskUserQuestion`；Codex app-server 將它暴露為實驗性的 `request_user_input` / `requestUserInput` surface；Qwen Code 透過 ACP permission metadata 傳遞 `AskUserQuestion`。Grimoire 會把這些 provider-specific mechanisms 正規化到同一個 inline question UI。Single-select、multi-select 和 freeform answers 會回傳給 provider run，讓 agent 不需要另一條 chat message 就能繼續。

### Commands

Built-in commands 覆蓋 Grimoire workflows，例如 image generation 和 resume。Provider 暴露的自有 commands，例如 Claude Code slash commands、OpenCode、Grok Build 和 Qwen Code runtime commands，會透過 provider-owned catalogs 顯示。你可以在 settings 中隱藏不使用的 commands。

### Image generation

貼上或拖放圖片即可附加到 turn。Built-in `/image [prompt]` command 本身不會呼叫任何 image API。它會向目前 provider 傳送一個普通 turn，指示 provider 使用你已設定的 image generation 能力：provider-native tooling、MCP tools 或 local command。Agent 會把結果保存到 vault，並回傳類似 `![[path/to/image.png]]` 的 embed。如果沒有設定 image generation，你會得到一條普通回覆，說明缺少什麼。

### Safety 和 permissions

Permission modes 屬於 provider，因此 Grimoire 透過 shared composer controls 顯示它們，而不是重新實作一套。當 active provider 支援 plan mode 時，permission control 和 `Shift+Tab` 都會在 Safe、Auto-approve 和 Plan 之間循環。Safe mode 和 permission prompts 在工作時保持可見。Bang-bash mode 只會在 enabled provider 提供時顯示。Configured MCP servers、shell access 和 API keys 都應該被視為 sensitive，因為它們確實 sensitive。

### Debug logging

預設關閉。啟用後，Grimoire 會將 sanitized JSONL 寫入 `.grimoire/logs/YYYY-MM-DD.jsonl`，其中 prompts、answers、note contents、paths、environment values 和 secrets 都會被 redact。它用於診斷 provider 和 runtime issues，而不是保存 transcript。

### Settings

General settings 覆蓋 auto-scroll、title generation、usage indicators、debug logging、locale、tabs，以及哪個 provider 擁有 settings view。Per-provider tabs 處理 CLI paths、model behavior、commands、agents、skills 和 provider-owned config。你還可以設定 project workspace environment variables，並按 provider scoped。

<p align="center">
  <img src="../../assets/readme/settings-general.png" alt="Grimoire 一般設定" width="100%">
</p>

## Grimoire 將資料存放在哪裡

| Path | 內容 |
| --- | --- |
| `.grimoire/grimoire-settings.json` | App settings 和 provider configuration |
| `.grimoire/sessions/*.meta.json` | Session metadata |
| `.grimoire/logs/YYYY-MM-DD.jsonl` | Opt-in sanitized debug logs |
| `.grimoire/claude/statusline-usage.json` | 用於 plan meter 的 Claude usage snapshot |
| `.grimoire/grok/` | Grok Build launch artifacts、managed config 和 session pointers |

Provider-native files under `.claude/`, `.codex/`, `.opencode/`, and `.grimoire/grok/` 會被原地讀取和寫入，因此你的 provider setup 在 Grimoire 之外仍然可攜。

## 隱私

Grimoire 執行在 Obsidian 內部、你的電腦上。它沒有 backend，不新增 telemetry，也不會把 prompts、answers、notes、files、tool output、API keys 或 usage logs 上傳到任何 Grimoire service。它唯一會寫入的 logs 是上面提到的 optional sanitized debug logs，並且這些 logs 留在你的 vault 中。

它無法隱藏的是 provider 本身。你啟用的 CLI 會收到 prompt、你選擇的 context，以及 request 所需的 files、images、tool output 和 commands。該 CLI 可能會存取 Anthropic、OpenAI、Google、你設定的 OpenCode vendors、MCP servers，或者任何你設定過的其他目標。Terms、retention、billing、rate limits 和 privacy policies 屬於 provider，而不是 Grimoire。Grimoire 的職責是在 Obsidian 中讓這條邊界清楚可見，並由你控制。

如需了解面向 Obsidian policy 的網路使用、帳戶需求、外部檔案存取、logging 和 telemetry 的摘要，請參閱 [DISCLOSURES.md](../../DISCLOSURES.md)。

## Development

歡迎 contributions。開啟 pull request 前請閱讀 [CONTRIBUTING.md](../../CONTRIBUTING.md)，其中說明 architecture、security、tests 和 review 的要求。

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run test
npm run build
npm run build:release
```

在發布或 push 重要 UI/provider changes 之前，請執行完整 local gate：

```bash
npm run test -- --selectProjects unit
npm run typecheck
npm run lint
npm run build:release
```

`npm run build:release` 會刷新 generated `main.js`、root `styles.css` 和 `dist/grimoire`。

npm 是 development、CI 和 releases 的 canonical package manager。dependencies 變更時，請保持 `package-lock.json` 最新；secondary package-manager lockfiles 有意不提交。

## Releases

Grimoire releases 透過 semver tags 發布，例如 `1.0.0`。Release workflow 會執行 local gate，建構 Obsidian bundle，驗證 tag 與 `package.json` 和 `manifest.json` 匹配，然後將 `main.js`、`manifest.json` 和 `styles.css` 附加到 GitHub Release。

Obsidian Community plugins 是推薦的使用者安裝方式。GitHub Releases 仍然提供用於手動安裝和 BRAT 的 bundle assets。使用 `main` 做 releasable development，然後透過與 manifest version 匹配的 tag 發布。

## Roadmap

目前 Grimoire 隨 Claude Code、Codex、Antigravity CLI、Gemini CLI (Legacy)、OpenCode、MiMoCode、Kimi Code、Grok Build 和 Qwen Code 一起發布。

下一步計畫：GitHub Copilot CLI、其他 ACP-compatible providers，以及當 runtime 足夠穩定可嵌入 Obsidian 時的 local model CLIs。Implementation notes 位於 [docs/provider-roadmap.md](../provider-roadmap.md)。

## 授權

MIT。參見 [LICENSE](../../LICENSE)。
