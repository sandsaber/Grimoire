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
  <img src="../../assets/readme/chat-workspace.png" alt="Obsidian 中的 Ocean Atlas 旁，Codex Astra High 正在討論海洋分層、洋流與海洋生物的關係" width="100%">
</p>

<p align="center">
  <sub>真實筆記與根據筆記連結展開的對話。</sub>
</p>

Grimoire 將 agentic CLI 助手帶入 Obsidian。Codex、Claude Code、Antigravity CLI、Gemini CLI (Legacy)、OpenCode、MiMoCode、Kimi Code、Grok Build、Qwen Code、Devin、Pi、Reasonix 和 Command Code 都在同一個側邊欄中執行：讀取筆記、編輯檔案、執行命令、呼叫工具，並把 session history 保存在真實的 vault context 中。Grimoire 不經過自家伺服器：沒有 telemetry、沒有 hosted backend，也沒有夾在你和 provider 之間的 proxy。

它面向已經在 Obsidian 中工作的人：你可以使用本地 context、本地檔案、明確選擇的 provider，並在介面中直接看到 usage 和 cost。

> 英文 [README](../../README.md) 是專案的 canonical 文件。此翻譯會隨目前產品文件維護。

## 為什麼選擇 Grimoire

- 在筆記中直接使用你已經信任的 CLI 代理。
- 從 composer 切換 provider。Codex、Claude Code、Antigravity CLI、Gemini CLI (Legacy)、OpenCode、MiMoCode、Kimi Code、Grok Build、Qwen Code、Devin、Pi、Reasonix 和 Command Code 共用一個 model picker。
- 讓每一次 turn 都基於 vault context。可以 mention 筆記、資料夾和 MCP tools，不需要手動複製路徑。
- 在選擇模型的位置直接看到 cost 和 limits。
- 保持 local-first。Grimoire 不收集 telemetry，不 proxy prompts，也不執行 backend。

## 各 provider 能做什麼

| 功能 | Codex | Claude Code | OpenCode | Grok Build | MiMoCode | Kimi Code | Antigravity CLI | Gemini CLI (Legacy) | Qwen Code | Devin | Reasonix | Command Code | Pi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 本地持續執行環境 | 支援 | 支援 | 支援 | 支援 | 支援 | 支援 | 不支援 | 支援 | 支援 | 支援 | 支援 | 不支援 | 支援 |
| 原生歷史恢復 | 支援 | 支援 | 支援 | 支援 | 支援 | 支援 | 不支援 | 支援 | 不支援 | 不支援 | 不支援 | 不支援 | 支援 |
| 計畫模式 | 支援 | 支援 | 支援 | 支援 | 支援 | 支援 | 不支援 | 支援 | 支援 | 支援 | 支援 | 不支援 | 不支援 |
| 圖片附件 | 支援 | 支援 | 支援 | 不支援 | 支援 | 支援 | 檔案 | 支援 | 支援 | 支援 | 檔案（需啟用） | 檔案（需啟用） | 支援 |
| 指令模式 | 支援 | 支援 | 支援 | 支援 | 支援 | 支援 | 不支援 | 支援 | 支援 | 支援 | 支援 | 不支援 | 不支援 |
| 推理強度控制 | 支援 | 支援 | 支援 | 支援 | 支援 | 支援 | 支援 | 支援 | 支援 | 不支援 | 支援 | 是（依模型而定） | 是（依模型而定） |
| 回溯 | 不支援 | 支援 | 不支援 | 支援 | 不支援 | 不支援 | 不支援 | 不支援 | 不支援 | 不支援 | 不支援 | 不支援 | 不支援 |
| 分支 | 支援 | 支援 | 不支援 | 支援 | 不支援 | 不支援 | 不支援 | 不支援 | 不支援 | 不支援 | 不支援 | 不支援 | 不支援 |
| 提供者斜線命令 | 不支援 | 支援 | 支援 | 支援 | 支援 | 支援 | 不支援 | 支援 | 支援 | 支援 | 支援 | 不支援 | 支援 |
| Grimoire 管理的 MCP 介面 | 不支援 | 支援 | 支援 | 支援 | 支援 | 支援 | 不支援 | 支援 | 支援 | 支援 | 支援 | 不支援 | 不支援 |

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

為了獲得最好的 Grimoire 體驗，建議先從 Codex、Claude Code、OpenCode、MiMoCode、Kimi Code、Grok Build 或 Qwen Code 開始。這些 providers 目前為 vault-native 工作提供最強的 runtime surface：persistent sessions、plan-oriented workflows、tool activity，以及更豐富的 model controls。

Antigravity CLI 和 Gemini CLI (Legacy) 仍然可用於 Google accounts 和 compatibility 場景，但目前不建議作為 Grimoire 的主要 provider。Grimoire 以 best-effort 方式支援它們，並已實作目前 CLI 能提供的 fallback，但它們的 ACP 和 runtime surfaces 有技術限制：sessions、approvals、streaming、tool/edit metadata、model discovery 和 usage reporting 相比推薦 providers 並不完整，也不夠可靠。

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

### Claude Code

如果你需要 Claude 的 native project memory、slash commands、MCP configuration、plans、rewind/fork，並希望透過 Claude subscription 或 API key 工作，可以選擇 Claude Code。

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude
```

先透過 Claude Code 完成認證，然後在 Grimoire 中啟用它。舊的 npm package 已 deprecated；請使用上面的 native installer、Homebrew (`brew install --cask claude-code`)、WinGet，或 official quickstart 中的其他選項。

- [Claude Code quickstart](https://code.claude.com/docs/en/quickstart)

在 Grimoire 中，Claude Code 會讀取並保留你的 `.claude/` 檔案，執行在 Claude Code SDK 上，並支援 slash commands、MCP settings、agents、skills、plans、rewind 和 fork。當 Claude 同時回報 quota 和 cost 時，你會並排看到 quota windows 和 API spend。

**遵循 Claude Code 設定**預設為啟用。Grimoire 會從使用者設定（`~/.claude/settings.json`）與儲存庫設定（`.claude/settings.json`）讀取 `model` 和 `env`，並套用到 Claude 模型選擇器與執行環境。因此，Claude Code 自訂模型也能在 Grimoire 使用，包括 MiniMax、Z.ai 等 Anthropic 相容閘道。專案設定優先於使用者設定，而在 Grimoire 明確指定的環境設定優先於兩者。

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic",
    "ANTHROPIC_MODEL": "glm-5.2[1m]",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "glm-4.7-flash"
  }
}
```

### Antigravity CLI

Antigravity CLI 是 Google 面向 consumer Gemini CLI 場景的替代工具，可存取你的 Antigravity account 中可用的 Gemini、Claude、GPT-OSS 和其他模型系列。在 Grimoire 中，請把它視為 compatibility provider，而不是推薦預設選擇。

```bash
agy
```

從 Google 安裝官方 Antigravity CLI，在本機完成認證，然後在 Grimoire 中啟用 Antigravity。Grimoire 會從 PATH 自動偵測 `agy`，你也可以在 provider settings 中設定 custom CLI path。

- [Antigravity CLI](https://antigravity.google/product/antigravity-cli)
- [Gemini CLI migration guide](https://goo.gle/gemini-cli-migration)

在 Grimoire 中，Antigravity 透過 `agy --print` 執行，並可從 `agy models` 選擇模型。這是 best-effort integration，因為 `agy` 目前沒有向 Grimoire 暴露足夠強的 ACP-compatible runtime。在 Antigravity 提供穩定 runtime surfaces 之前，persistent sessions、native history、plan mode、streaming、approval-safe file edits、reliable usage reporting 和 auxiliary workflows 都會保持關閉或受限。 圖片以暫存檔傳遞，後續訊息需要重新附加。

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

- [Qwen Code 文件](https://qwenlm.github.io/qwen-code-docs/en/)
- [Qwen Code 驗證](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/)
- [Qwen Code repository](https://github.com/QwenLM/qwen-code)

如果 Qwen 無法啟動或沒有顯示模型，請在 Qwen Code 中執行 `/doctor`、完成 `/auth`、檢查 `qwen --version`，並確認 Grimoire settings 中的 Qwen CLI path。

Reasoning effort 有 Low、Medium、High、XHigh、Max，預設 High。每個 normal turn 前，Grimoire 會執行真正的 Qwen `/effort <tier>` 並按 session 快取；effective tier 仍取決於所選 model/provider。Structured `AskUserQuestion` 透過 ACP permission metadata 到達，並在 shared inline question UI 中支援 single-select、multi-select 和 freeform answers。

Credentials 和 native config 仍由 Qwen 在 `~/.qwen/settings.json` 中管理。Grimoire 管理 `.grimoire/mcp/qwen.json` 中隔離的 project MCP list，並在不重寫 Qwen native config 的情況下傳入 ACP sessions。只有 Qwen 傳送 ACP token/cost metadata 時才顯示 usage；Qwen 目前不支援 Grimoire fork 或 rewind。

### Devin

Devin CLI（Cognition）是選擇性啟用的 ACP provider。Grimoire 透過 `devin acp` 啟動它，從執行中的 session 取得你的帳號可用的 models 與 modes，串流訊息、思考過程與 tool activity，在 shell command 和寫入檔案前先詢問，並以原生方式恢復 session。可用的 model 清單取決於你登入的帳號，這是 Devin 的行為，而非 Grimoire 的限制。

```bash
# macOS, Linux, WSL
curl -fsSL https://cli.devin.ai/install.sh | bash

# Homebrew
brew install --cask devin-cli

devin auth login
devin --version
```

先用 `devin auth login`（瀏覽器登入）登入，再於 Grimoire 中啟用 Devin。Safe、Auto-approve 與 Plan 分別對應 Devin 的 `accept-edits`、`bypass` 與 `plan`；Devin 的 `smart` 與 `ask` 在共用工具列中顯示為 Safe。

- [Devin CLI 文件](https://docs.devin.ai/cli)
- [Devin ACP 文件](https://docs.devin.ai/desktop/acp)

關於 Safe 模式有一點要知道：Devin 會自行判斷哪些 shell command 屬於唯讀並直接執行，`echo` 即使重新導向寫入檔案也算在內。Grimoire 會為 Devin 透過協定發出的每一次檔案寫入徵求許可，但 agent 改走自己的 shell 完成的寫入可能會繞過這道關卡。如果某個 session 絕對不能寫入，請使用 Plan。

Devin 的憑證由它自己保管在 `~/.local/share/devin/`。Vault skills 從 `.devin/skills` 與 `.agents/skills` 讀取，而 skill 就是 Devin 的 slash command。Grimoire 在 `.grimoire/mcp/devin.json` 維護獨立的 MCP 清單並注入 ACP session。用量會在 Devin 回報時顯示；沒有 reasoning effort 控制，因為 effort 已包含在 model id 中。Grimoire 的 fork 與 rewind 不適用於 Devin。


### Reasonix

Reasonix 是開源的多模型 coding agent，在這裡是可選啟用的 ACP provider。Grimoire 會啟動 `reasonix acp`，從執行中的 session 讀取 models 與 modes，串流訊息、思考、tool activity 與 plan，在需要授權的 tool 和檔案寫入前詢問，並原生恢復 session。session 提供哪些 models 取決於你的 Reasonix 設定中的 provider 區塊；這屬於 Reasonix，而不是 Grimoire 的限制。

```bash
# npm
npm i -g reasonix

# Homebrew
brew install esengine/reasonix/reasonix

reasonix setup
reasonix --version
```

執行 `reasonix setup` 設定 model provider 與憑證，然後在 Grimoire 中啟用 Reasonix。別的 provider 只有一項設定的地方，Reasonix 有兩項：session mode（`normal`、`plan`、`goal`）以及獨立的 tool 批准姿態（`ask`、`auto`、`yolo`）。Grimoire 的工具列同時驅動兩者。Safe 是會詢問的 `normal`，Plan 是會詢問的 `plan`，Auto-approve 是處於 `yolo` 的 `normal`；`goal` 是 Reasonix 自有的模式，顯示為 Safe。 由於區分 Safe 與 Auto-approve 的只有批准姿態，無法設定該姿態的 turn 會被拒絕，而不是悄悄以更寬鬆的方式執行。

Reasonix 不只請求權限，也會提問：它的 `ask` tool 經由同一通道抵達，繪製成一張卡片，描述是問題，帶編號的選項是答案。請按編號選擇；在有多個答案的卡片上 `Enter` 不做任何事，習慣性的按鍵不會替你做決定。

推理強度不是固定清單，而是由 session 填充的 picker。模型接受哪些級別由服務它的 provider 區塊決定：宣告了 `supported_efforts` 的區塊提供 Disabled、Low、High 與 Max，未宣告的則取得其類型的內建集合。Grimoire 讀取目前 session 提供的內容，並把 Auto 放在最前，它把選擇權交還給 Reasonix。session 未提供的級別永遠不會被送出，因為 CLI 會對照模型拒絕它。

- [Reasonix 文件](https://reasonix.io/docs/)
- [GitHub 上的 Reasonix](https://github.com/esengine/DeepSeek-Reasonix)

關於 Safe 模式有一點要知道：`ask` 只擋下 Reasonix 判定為需要授權的 tool，而不是全部 tool，因此它認為 read-only 的 shell command 會直接執行而不詢問。Grimoire 會對 Reasonix 透過協定進行的每一次檔案寫入進行確認，這正是讓 vault 待在一個問題之後的機制。如果某個 session 完全不該寫入，請使用 Plan。

Reasonix 的設定放在 `~/.reasonix/config.toml`，API keys 依該檔案給出的名稱從環境變數讀取。Vault skills 從 `.reasonix/skills` 與 `.agents/skills` 讀取。Grimoire 在 `.grimoire/mcp/reasonix.json` 維護獨立的專案 MCP 清單，並注入 ACP session。用量來自 Reasonix 自身的 status notification；只有當你的 model provider 有價格時才會顯示 cost。fork 與 rewind 都不支援。

啟用 **Image attachments as files** 後，圖片會透過 `.grimoire/attachments/` 中的檔案傳遞。需要支援圖片的模型與檔案讀取工具；讀取會增加一次工具呼叫。檔案遺失或無法寫入時，傳送會失敗。此選項預設關閉。

### Pi

請分別安裝這兩個工具。轉接器需要 **Node.js 22+** 與 **Pi 0.80.4+**。

1. 依照[官方說明](https://pi.dev/docs/latest)安裝 Pi。macOS 和 Linux：

   ```bash
   curl -fsSL https://pi.dev/install.sh | sh
   ```

   也可以使用 npm：

   ```bash
   npm install -g --ignore-scripts @earendil-works/pi-coding-agent
   ```

2. 依照[全域安裝說明](https://github.com/svkozak/pi-acp#global-install)安裝轉接器：

   ```bash
   npm install -g pi-acp
   ```

3. 在終端機開啟 Pi 設定，設定模型供應商或 API 金鑰：

   ```bash
   pi-acp --terminal-login
   ```

4. 重新啟動 Obsidian，在 **設定 → Grimoire → 供應商**中啟用 **Pi**，然後點選 **Refresh all models**。`pi` 和 `pi-acp` 必須能透過 `PATH` 找到。若自動偵測失敗，請在 **Adapter path** 填入 `pi-acp` 的絕對路徑；必要時在 Pi 的 **Environment variables** 加入 `PI_ACP_PI_COMMAND=/absolute/path/to/pi`。

Grimoire 會自行啟動轉接器，無須設定 Zed，也不需要另外執行轉接器伺服器。

這兩個執行檔仍是外部相依項目。Grimoire 從 Pi 取得模型與推理強度，串流顯示回答及工具活動，原生傳遞圖片，並恢復已儲存的工作階段。共用的模型選擇器在重新整理後保留已選模型和別名。

**推理強度限制（pi-acp 0.0.33）：** 選單只提供轉接器能實際套用到所選模型的等級。例如 Pi 為 GLM-5.3 提供 `low`、`high` 和 `max`，但轉接器拒絕 `max`，所以 Grimoire 提供 `low`、`high` 和 **Pi default**。`xhigh` 不能取代 `max`。上游 [PR #73](https://github.com/svkozak/pi-acp/pull/73) 提議新增 `max`；[PR #125](https://github.com/svkozak/pi-acp/pull/125) 提議取得所選模型實際支援的等級。截至 2026-09-21，兩者仍未合併，提出的修正不包含在已驗證的轉接器版本中。

Pi 自行管理工具權限，可以不經詢問就讀取、寫入檔案或執行命令。Grimoire 會顯示擴充功能發出的權限請求，但不提供 Safe 或 Plan 模式。MCP、技能與提示詞範本在 Pi 中設定。檔案從磁碟讀取；轉接器不提供編輯器中的未儲存文字、帳戶配額或上下文使用量。已使用 Pi 0.86.1 與 pi-acp 0.0.33 驗證。

### Command Code

Command Code 可選擇啟用。請在終端機安裝並登入，再到設定 → Grimoire → 供應商啟用：

```bash
npm i -g command-code
command-code login
```

推理強度依已安裝 CLI 回報的所選模型資訊決定。選擇器僅提供該模型支援的等級與 CLI 預設值；不支援調整強度的模型不顯示選擇器。明確選取的等級會透過原生工作階段修改 API 套用到目前執行，不會改動 CLI 全域設定。CLI 預設值保留原生行為，包括恢復工作階段中已儲存的推理強度。

Grimoire 從 CLI 的無介面 JSON 輸出串流顯示回答與工具活動，透過 `--list-models` 探索模型，並儲存原生工作階段 ID，以便重新載入後明確恢復。驗證、原生設定、技能、MCP 與對話記錄仍由 Command Code 管理。上下文用量將回報的輸入 token 數與估計或使用者指定的上限比較，不推測帳戶配額或價格。

啟用 **Image attachments as files** 後，圖片會透過 `.grimoire/attachments/` 中的檔案傳遞。需要支援圖片的模型與檔案讀取工具；讀取會增加一次工具呼叫。檔案遺失或無法寫入時，傳送會失敗。此選項預設關閉。

**Safe** 會暫停編輯、命令及其他非唯讀工具，等待 Grimoire 中的一次性核准。拒絕、取消或核准連線中斷皆會阻止執行。目前 Safe 需要經過驗證的 Command Code 1.53.0 / 1.66.0 npm 安裝，並停用原生子代理，因為它們的獨立迴圈無法使用這個核准機制。**Auto-approve** 不顯示 Grimoire 確認提示；原生拒絕與詢問規則在兩種模式下仍然生效。此整合不提供互動式提問、計畫控制、斜線命令、受管理的 MCP/技能/代理、輔助任務、分支、回溯或原生歷史匯入。

- [Command Code 無介面執行文件](https://commandcode.ai/docs/headless)

### OpenCode

如果你想使用自帶 provider configuration 的 model-agnostic agent，可以選擇 OpenCode。

```bash
curl -fsSL https://opencode.ai/install | bash
opencode
```

Homebrew、npm、bun 和 package-manager installs 也可以。先在 OpenCode 中設定 provider credentials，然後在 Grimoire 中啟用。

- [下載 OpenCode](https://opencode.ai/download)
- [OpenCode 提供者文件](https://opencode.ai/docs/providers)
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

### 聊天工作區

一個專注的側邊欄，支援多個 tabs。每個 tab 都保留自己的 draft、provider、model、context 和 runtime。關閉再開啟 Obsidian 後，sessions 會恢復，並且每個 response 都保留 provider、model 和 reasoning effort。Rewind 和 fork 會在目前 provider 支援時出現。你一旦手動捲動去閱讀歷史，auto-scroll 會自動讓位。10 秒沒有可見輸出後，shared wait indicator 會顯示 active provider 和已等待時間；等待問題或 permission 時會暫停。

### 分頁、歷史與導覽

開啟分頁操作選單或在分頁上按右鍵，即可重新命名、複製或關閉分頁。按滑鼠中鍵可關閉分頁，復原可恢復其草稿與位置。在歷史浮動視窗中搜尋舊對話，並以新分頁開啟。歷史會區分手動命名與自動產生的標題。對話工具列提供跳轉按鈕與目錄；完成的回答會顯示完成時間。

<p align="center">
  <img src="../../assets/readme/conversation-history.png" alt="歷史搜尋顯示三個 Ocean Atlas 對話、使用的模型及標題來源" width="100%">
</p>

### 並行代理、設定與輸入區

**Parallel workers** approval card 會顯示 inherited model，並只啟動你選取的建議任務。Settings 使用 Obsidian native search，並保留永久的 What's New 項目。Provider settings 和 composer 在各 provider 間使用一致的 surface，同時保留 provider-owned controls 和 configuration。

### 鍵盤快捷鍵

| 快捷鍵 | 操作 |
| --- | --- |
| `Enter` | 傳送目前的 turn。啟用 **Send only with button** 時此快捷鍵不可用。 |
| `Shift+Enter` | 在 composer 中插入新行。 |
| `Shift+Tab` | 循環切換 permission modes：`Safe -> Auto-approve -> Plan -> Safe`。不支援 Plan mode 的 providers 會在 Safe 和 Auto-approve 之間切換。 |
| `Escape` | 停止目前的回答，或關閉歷史浮動視窗。 |

### 模型選擇器

一個 picker，按 provider 分組，並按 label 排序：Antigravity、Claude Code、Codex、Command Code、Devin、Gemini CLI (Legacy)、Grok Build、Kimi Code、MiMoCode、OpenCode、Pi、Qwen Code 和 Reasonix。Search 會匹配 labels、descriptions、groups 和 model IDs。Catalogs 會 lazy load，並記住你摺疊過的 groups。你可以在 settings 中新增 custom aliases 和 context-window overrides。Claude 的 1M variants 是額外 options，不會替代 base models。

OpenCode、MiMoCode、Kimi Code、Grok Build、Command Code 和 Pi 在設定中使用同一個模型選擇器：含別名的已選列、可搜尋的目錄與 **Refresh all models**。重新整理會保留選擇與別名；CLI 提供供應商名稱時也會顯示供應商篩選器。

### 用量與費用

Model selector 旁邊的 badge 會持續顯示目前 provider 的 usage；model menu 中有更完整的 readouts：如果 provider 暴露 quota windows 就顯示 quota，如果只有 cost 可用就顯示 spend。Refresh 進行中或失敗時，最後一次成功的數值會保留，因此 meter 不會突然清空。如果你想要更安靜的 UI，可以在 settings 中關閉整個 usage/cost 顯示。

| Provider | Usage 來源 |
| --- | --- |
| Codex | Account rate-limit notifications，以及可用時的 `account/rateLimits/read` |
| Claude Code | SDK rate-limit events、可選的 `.grimoire/claude/statusline-usage.json` 和 SDK result cost metadata |
| Antigravity CLI | `agy --print` 目前尚無法可靠提供 |
| Gemini CLI (Legacy) | Gemini CLI 回傳時的 ACP cost metadata；僅 legacy provider |
| Qwen Code | 僅在 Qwen Code 回傳時的 ACP token 和 cost metadata |
| Devin | ACP 回報的 session credit 總額，換算為每月支出 |
| Reasonix | 來自自有 status notification 的每輪 cost，前提是所設定的 model provider 有價格 |
| Pi | pi-acp 轉接器未提供 |
| OpenCode | 從 ACP 和 session cost metadata 聚合的 monthly spend |
| MiMoCode | 從 ACP 和 session cost metadata 聚合的 monthly spend |
| Kimi Code | 從 ACP 和 session cost metadata 聚合的 monthly spend |
| Grok Build | 透過 OAuth 顯示共用的每週 Grok 使用額度、重設時間和 Extra Usage Credits；來自 session cost metadata 的 monthly API spend |

### 計畫模式

當 active provider 支援 Plan mode 時，可以用兩種方式開啟：

- 點擊 composer 裡的 permission control，直到它切換到 Plan：`Safe -> Auto-approve -> Plan`。
- 按 `Shift+Tab` 循環切換完整序列：`Safe -> Auto-approve -> Plan -> Safe`。

Plan mode 會要求 provider 先制定計畫，再開始進行變更。在 composer 中，它使用與 Safe 和 Auto-approve 相同的 permission control，因此工作時 active mode 會一直可見。

當 provider 完成計畫後，Grimoire 會顯示可折疊的 Plan complete 卡片，其中包含渲染後的計畫、要求的 permissions，以及適合鍵盤操作的列。Approve 會在同一個 session 中繼續；輸入 feedback 會保持 Plan mode，讓 provider 可以修改計畫。

### 上下文與提及

可以直接在 composer 中 mention vault notes 和 folders，拉入 current 或 linked note，並在 settings 中新增 persistent external context paths。Provider 支援 image input 時，可以貼上或拖放圖片。支援的 provider integrations 中也可以 mention MCP servers。Context 分頁會顯示綁定的筆記、model、permission mode、固定檔案、`.grimoire/grok/system.md` 等 launch artifacts，以及 agent 在 session 期間載入的檔案。

### 筆記內編輯

對選取文字執行 "Grimoire: Inline edit"。Prompt 會在文字旁開啟，edit 會以 diff 回傳，你可以 accept 或 reject，並且會透過 provider-backed inline edit service 執行。它既支援替換 selection，也支援插入新文字。

### 釐清問題

當 provider 要求 structured user input 時，Grimoire 會暫停 turn，並在 composer 上方顯示問題。Claude Code 將它暴露為 `AskUserQuestion`；Codex app-server 將它暴露為實驗性的 `request_user_input` / `requestUserInput` surface；Qwen Code 透過 ACP permission metadata 傳遞 `AskUserQuestion`。Grimoire 會把這些 provider-specific mechanisms 正規化到同一個 inline question UI。Single-select、multi-select 和 freeform answers 會回傳給 provider run，讓 agent 不需要另一條 chat message 就能繼續。

### 命令

Built-in commands 覆蓋 Grimoire workflows，例如 image generation 和 resume。Provider 暴露的自有 commands，例如 Claude Code slash commands、OpenCode、Grok Build 和 Qwen Code runtime commands，會透過 provider-owned catalogs 顯示。你可以在 settings 中隱藏不使用的 commands。

### 圖片產生

貼上或拖放圖片即可附加到 turn。Built-in `/image [prompt]` command 本身不會呼叫任何 image API。它會向目前 provider 傳送一個普通 turn，指示 provider 使用你已設定的 image generation 能力：provider-native tooling、MCP tools 或 local command。Agent 會把結果保存到 vault，並回傳類似 `![[path/to/image.png]]` 的 embed。如果沒有設定 image generation，你會得到一條普通回覆，說明缺少什麼。

### 安全與權限

Permission modes 屬於 provider，因此 Grimoire 透過 shared composer controls 顯示它們，而不是重新實作一套。當 active provider 支援 plan mode 時，permission control 和 `Shift+Tab` 都會在 Safe、Auto-approve 和 Plan 之間循環。Safe mode 和 permission prompts 在工作時保持可見。Bang-bash mode 只會在 enabled provider 提供時顯示。Configured MCP servers、shell access 和 API keys 都應該被視為 sensitive，因為它們確實 sensitive。

### 偵錯記錄

預設關閉。啟用後，Grimoire 會將 sanitized JSONL 寫入 `.grimoire/logs/YYYY-MM-DD.jsonl`，其中 prompts、answers、note contents、paths、environment values 和 secrets 都會被 redact。它用於診斷 provider 和 runtime issues，而不是保存 transcript。

### 設定

設定分成四個分頁：**一般**管理語言、聊天位置、分頁與顯示；**供應商**用於啟用 CLI 並設定模型；**進階設定**管理上下文、對話、工具與診斷；**關於**顯示版本及更新內容。設定支援 Obsidian 原生搜尋。

提供者總覽顯示 CLI 偵測結果與啟用開關，下方列出所選提供者的設定。

<p align="center">
  <img src="../../assets/readme/settings-providers.png" alt="Grimoire 的十二種 CLI 整合總覽及 Codex 模型設定" width="100%">
</p>

<details>
<summary>一般設定</summary>

<p align="center">
  <img src="../../assets/readme/settings-general.png" alt="語言、面板位置、聊天分頁、標籤、捲動與對話標題的一般設定" width="100%">
</p>

</details>

## Grimoire 將資料存放在哪裡

| Path | 內容 |
| --- | --- |
| `.grimoire/grimoire-settings.json` | 應用程式設定與提供者設定 |
| `.grimoire/sessions/*.meta.json` | 工作階段中繼資料 |
| `.grimoire/logs/YYYY-MM-DD.jsonl` | 選擇啟用且已移除敏感資訊的偵錯記錄 |
| `.grimoire/claude/statusline-usage.json` | 用於 plan meter 的 Claude usage snapshot |
| `.grimoire/grok/` | Grok Build launch artifacts、managed config 和 session pointers |

Provider-native files under `.claude/`, `.codex/`, `.opencode/`, and `.grimoire/grok/` 會被原地讀取和寫入，因此你的 provider setup 在 Grimoire 之外仍然可攜。

## 隱私

Grimoire 執行在 Obsidian 內部、你的電腦上。它沒有 backend，不新增 telemetry，也不會把 prompts、answers、notes、files、tool output、API keys 或 usage logs 上傳到任何 Grimoire service。它唯一會寫入的 logs 是上面提到的 optional sanitized debug logs，並且這些 logs 留在你的 vault 中。

它無法隱藏的是 provider 本身。你啟用的 CLI 會收到 prompt、你選擇的 context，以及 request 所需的 files、images、tool output 和 commands。該 CLI 可能會存取 Anthropic、OpenAI、Google、你設定的 OpenCode vendors、MCP servers，或者任何你設定過的其他目標。Terms、retention、billing、rate limits 和 privacy policies 屬於 provider，而不是 Grimoire。Grimoire 的職責是在 Obsidian 中讓這條邊界清楚可見，並由你控制。

如需了解面向 Obsidian policy 的網路使用、帳戶需求、外部檔案存取、logging 和 telemetry 的摘要，請參閱 [DISCLOSURES.md](../../DISCLOSURES.md)。

## 開發

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

## 發布版本

Grimoire releases 透過 semver tags 發布，例如 `1.0.0`。Release workflow 會執行 local gate，建構 Obsidian bundle，驗證 tag 與 `package.json` 和 `manifest.json` 匹配，然後將 `main.js`、`manifest.json` 和 `styles.css` 附加到 GitHub Release。

Obsidian Community plugins 是推薦的使用者安裝方式。GitHub Releases 仍然提供用於手動安裝和 BRAT 的 bundle assets。使用 `main` 做 releasable development，然後透過與 manifest version 匹配的 tag 發布。

## 開發計畫

目前 Grimoire 隨 Codex、Claude Code、Antigravity CLI、Gemini CLI (Legacy)、OpenCode、MiMoCode、Kimi Code、Grok Build、Qwen Code、Devin、Pi、Reasonix 和 Command Code 一起發布。

下一步計畫：GitHub Copilot CLI、其他 ACP-compatible providers，以及當 runtime 足夠穩定可嵌入 Obsidian 時的 local model CLIs。Implementation notes 位於 [docs/provider-roadmap.md](../provider-roadmap.md)。

## 授權條款

MIT。參見 [LICENSE](../../LICENSE)。
