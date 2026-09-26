# Grimoire · 魔導書

<p align="center">
  <img src="../../assets/readme/grimoire-logo.png" alt="Grimoire ロゴ" width="240">
</p>

<p align="center">
  <strong>Obsidian vault のための local-first AI エージェント。</strong>
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="ライセンス: MIT">
  <img src="https://img.shields.io/github/v/release/sandsaber/Grimoire?label=release" alt="最新リリース">
  <img src="https://img.shields.io/badge/Obsidian-1.13.0%2B-7c3aed" alt="Obsidian 1.13.0+">
  <img src="https://img.shields.io/badge/platform-desktop-lightgrey" alt="デスクトップのみ">
</p>

<p align="center">
  <img src="../../assets/readme/chat-workspace.png" alt="Obsidian の Ocean Atlas と、海の層・海流・海洋生物を結び付ける Codex Astra High のチャット" width="100%">
</p>

<p align="center">
  <sub>実際のノートと、そのリンクに基づく会話です。</sub>
</p>

Grimoire は agentic CLI アシスタントを Obsidian に組み込みます。Codex、Claude Code、Antigravity CLI、Gemini CLI (Legacy)、OpenCode、MiMoCode、Kimi Code、Grok Build、Qwen Code、Devin、Pi、Reasonix、Command Code がひとつのサイドパネルに入り、ノートを読み、ファイルを編集し、コマンドを実行し、ツールを呼び出し、実際の vault に紐づいた session history を保持します。Grimoire のサーバーは介在しません。Telemetry も hosted backend も、あなたと provider の間に入る proxy もありません。

Grimoire は、すでに Obsidian で作業している人のために作られています。ローカル context、ローカル files、意図して選ぶ provider、そして UI 上で確認できる usage と cost を重視しています。

> 英語版 [README](../../README.md) がプロジェクトの canonical document です。この翻訳は現在の製品ドキュメントに合わせて更新されます。

## Grimoire を使う理由

- すでに信頼している CLI エージェントを、ノートの中で直接使えます。
- Composer から provider を切り替えられます。Codex、Claude Code、Antigravity CLI、Gemini CLI (Legacy)、OpenCode、MiMoCode、Kimi Code、Grok Build、Qwen Code、Devin、Pi、Reasonix、Command Code は同じ model picker を共有します。
- すべての turn を vault context に grounded できます。ノート、フォルダ、MCP tools を mention でき、手で path を貼る必要がありません。
- Model selector のすぐ横で cost と limits を確認できます。
- Local-first のまま使えます。Grimoire は telemetry を集めず、prompts を proxy せず、backend を実行しません。

## 各 provider ができること

| 機能 | Codex | Claude Code | OpenCode | Grok Build | MiMoCode | Kimi Code | Antigravity CLI | Gemini CLI (Legacy) | Qwen Code | Devin | Reasonix | Command Code | Pi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ローカルの永続実行環境 | 対応 | 対応 | 対応 | 対応 | 対応 | 対応 | 非対応 | 対応 | 対応 | 対応 | 対応 | 非対応 | 対応 |
| ネイティブ履歴の復元 | 対応 | 対応 | 対応 | 対応 | 対応 | 対応 | 非対応 | 対応 | 非対応 | 非対応 | 非対応 | 非対応 | 対応 |
| 計画モード | 対応 | 対応 | 対応 | 対応 | 対応 | 対応 | 非対応 | 対応 | 対応 | 対応 | 対応 | 非対応 | 非対応 |
| 画像添付 | 対応 | 対応 | 対応 | 非対応 | 対応 | 対応 | ファイル | 対応 | 対応 | 対応 | ファイル（任意で有効化） | ファイル（任意で有効化） | 対応 |
| 指示モード | 対応 | 対応 | 対応 | 対応 | 対応 | 対応 | 非対応 | 対応 | 対応 | 対応 | 対応 | 非対応 | 非対応 |
| 推論の強度設定 | 対応 | 対応 | 対応 | 対応 | 対応 | 対応 | 対応 | 対応 | 対応 | 非対応 | 対応 | 対応（モデルによる） | 対応（モデルによる） |
| 巻き戻し | 非対応 | 対応 | 非対応 | 対応 | 非対応 | 非対応 | 非対応 | 非対応 | 非対応 | 非対応 | 非対応 | 非対応 | 非対応 |
| 分岐 | 対応 | 対応 | 非対応 | 対応 | 非対応 | 非対応 | 非対応 | 非対応 | 非対応 | 非対応 | 非対応 | 非対応 | 非対応 |
| プロバイダーのスラッシュコマンド | 非対応 | 対応 | 対応 | 対応 | 対応 | 対応 | 非対応 | 対応 | 対応 | 対応 | 対応 | 非対応 | 対応 |
| Grimoire による MCP 管理 | 非対応 | 対応 | 対応 | 対応 | 対応 | 対応 | 非対応 | 対応 | 対応 | 対応 | 対応 | 非対応 | 非対応 |

## インストール

Grimoire は desktop plugin です。Provider CLIs をローカルで実行するため、mobile build はありません。

### Community plugins からインストール（推奨）

Obsidian community plugin directory から Grimoire をインストールしてください。

1. Settings を開き、Community plugins に移動し、必要なら Restricted mode をオフにします。
2. Browse をクリックし、Grimoire を検索してインストールします。
3. Grimoire を有効化し、ribbon または command palette からパネルを開きます。

### GitHub Releases からインストール

Community plugins を使えない場合は、現在の release を手動でインストールできます。

1. 最新の [Grimoire release](https://github.com/sandsaber/Grimoire/releases/latest) から `main.js`、`manifest.json`、`styles.css` をダウンロードします。
2. `/path/to/your/vault/.obsidian/plugins/grimoire` を作成します。
3. 3 つのファイルをそのフォルダに入れます。
4. Settings, Community plugins から Grimoire を有効化します。

### BRAT でインストール

Community directory の外で tagged builds を追跡したい場合、BRAT は GitHub Releases から Grimoire をインストールできます。

1. "Obsidian42 - BRAT" plugin をインストールします。
2. BRAT で `sandsaber/Grimoire` から beta plugin を追加します。
3. Grimoire を有効化します。

### ソースからインストール

Release bundle を build して vault に配置します。

```bash
npm install
npm run build:release

mkdir -p /path/to/your/vault/.obsidian/plugins/grimoire
cp dist/grimoire/main.js dist/grimoire/manifest.json dist/grimoire/styles.css \
  /path/to/your/vault/.obsidian/plugins/grimoire/
```

その後、Settings, Community plugins から Grimoire を有効化します。

どの方法を選んでも、開始前に少なくとも 1 つの CLI provider をインストールしてください。Grimoire は provider CLIs を包みますが、account setup、model access、quotas、terms を置き換えるものではありません。

## Provider の設定

Settings, Grimoire, Providers で使いたい providers を有効化すると、model selector に表示されます。Codex は初回起動時に有効です。他の providers は opt-in です。

### 推奨 providers

Grimoire で最高の体験を得るには、まず Codex、Claude Code、OpenCode、MiMoCode、Kimi Code、Grok Build、Qwen Code から始めるのがおすすめです。これらの providers は現在、vault-native な作業に必要な runtime surface が最も強く、persistent sessions、plan-oriented workflows、tool activity、豊富な model controls を扱えます。

Antigravity CLI と Gemini CLI (Legacy) も Google accounts や compatibility cases 向けに引き続き利用できますが、現時点では Grimoire の primary provider としては推奨していません。Grimoire は best-effort でこれらをサポートし、現在の CLI が許す fallback は実装していますが、ACP と runtime surfaces には技術的な制限があります。sessions、approvals、streaming、tool/edit metadata、model discovery、usage reporting は、推奨 providers と比べて不完全または不安定です。

### Codex

Codex は初回起動時の default provider です。ChatGPT plan または API key で認証した local CLI 上の OpenAI Codex を使う場合に選びます。

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex
```

Codex を一度実行して sign in し、その後 Grimoire で有効化します。Standalone installer が現在の primary install path です。Windows、Homebrew、fallback package-manager options は公式 Codex CLI docs を参照してください。

- [Codex CLI setup](https://developers.openai.com/codex/cli)
- [OpenAI code generation guide](https://developers.openai.com/api/docs/guides/code-generation)

Grimoire 内では、Codex は app-server protocol で動作し、native history、fork、plan mode、image input、reasoning effort controls をサポートします。Codex が rate-limit metadata を報告すると、plan usage が表示されます。

### Claude Code

Native project memory、slash commands、MCP configuration、plans、rewind/fork を使いたい場合や、Claude subscription または API key で作業したい場合は Claude Code を選びます。

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude
```

Claude Code で認証してから、Grimoire で有効化します。古い npm package は deprecated です。上記の native installer、Homebrew (`brew install --cask claude-code`)、WinGet、または official quickstart の他の options を使ってください。

- [Claude Code quickstart](https://code.claude.com/docs/en/quickstart)

Grimoire 内では、Claude Code は `.claude/` files を読み取り、保持し、Claude Code SDK 上で動作します。Slash commands、MCP settings、agents、skills、plans、rewind、fork をサポートします。Claude が quota と cost の両方を報告する場合、quota windows と API spend が並んで表示されます。

**Claude Code の設定を尊重**は既定で有効です。Grimoire はユーザー設定（`~/.claude/settings.json`）と保管庫設定（`.claude/settings.json`）から `model` と `env` を読み込み、Claude のモデル選択と実行環境に適用します。これにより MiniMax、Z.ai などの Anthropic 互換ゲートウェイを含む Claude Code のカスタムモデルも使えます。プロジェクト設定はユーザー設定より優先され、Grimoire に明示した環境設定は両方より優先されます。

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

Antigravity CLI は consumer Gemini CLI 向けの Google の後継で、あなたの Antigravity account で利用できる Gemini、Claude、GPT-OSS、その他の model families を扱えます。Grimoire 内では、推奨 default ではなく compatibility provider として扱ってください。

```bash
agy
```

Google 公式の Antigravity CLI をインストールし、ローカルで認証してから Grimoire で Antigravity を有効化します。Grimoire は PATH から `agy` を自動検出しますが、provider settings で custom CLI path を指定することもできます。

- [Antigravity CLI](https://antigravity.google/product/antigravity-cli)
- [Gemini CLI migration guide](https://goo.gle/gemini-cli-migration)

Grimoire 内では、Antigravity は `agy --print` で実行され、`agy models` から model selection もできます。これは best-effort integration です。`agy` は現時点で Grimoire に十分強い ACP-compatible runtime を公開していません。Antigravity が安定した runtime surfaces を公開するまで、persistent sessions、native history、plan mode、streaming、approval-safe file edits、reliable usage reporting、auxiliary workflows は無効または制限されたままです。 画像は一時ファイルとして渡されます。後続のメッセージでは再添付が必要です。

Windows note: current Windows `agy` builds can finish successfully while returning empty stdout for `agy models` and `agy --print`. Grimoire uses best-effort recovery from Antigravity logs, transcripts, settings, and a seeded Pro AI model list, but Windows Antigravity support may be less reliable than macOS or Linux. If your account shows additional models in Antigravity, add their exact labels under Antigravity settings > Custom models.

### Gemini CLI (Legacy)

Gemini CLI は、Google が Gemini CLI requests を継続提供する Gemini Code Assist Standard、Enterprise、Google Cloud、paid API-key users 向けの legacy compatibility provider として残ります。ACP support が弱く、いくつかの Grimoire workflows をその上で信頼性高く実装できないため、新しい Grimoire setup では推奨しません。Consumer Google AI Pro、Ultra、free-tier accounts は June 18, 2026 以降、上記の Antigravity 制限を理解したうえで Antigravity を使ってください。

```bash
gemini
```

Gemini CLI は、account tier がまだサポートされていて、その legacy Google path が必要な場合だけ有効化してください。Grimoire は `gemini --acp` で起動し、active note、editor/browser/canvas selection、vault search、project workspace context を ACP prompt に追加し、推奨 provider に見えないよう legacy と表示します。可能なら Codex、Claude Code、OpenCode、MiMoCode、Kimi Code、Grok Build、Qwen Code を優先してください。

### Qwen Code

Qwen Code は opt-in の ACP provider です。provider-native persistent sessions、resume、model context、live の model/mode discovery を提供します。messages と tool/plan activity を streaming し、image input、provider commands、file approvals をサポートします。Grimoire は provider-native message history を hydrate しません。

```bash
# macOS と Linux
curl -fsSL https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.sh | bash

# Windows (PowerShell)
irm https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.ps1 | iex

# npm は Node.js 22 以降が必要。Homebrew も利用可能
npm install -g @qwen-code/qwen-code@latest
brew install qwen-code

qwen --version
qwen
```

`qwen` を起動し、`/auth` で **Alibaba ModelStudio**、**Third-party Providers**、**Custom Provider** のいずれかを選択してから、Grimoire で Qwen Code を有効化します。OAuth のログイン経路はありません。Grimoire は opt-in provider を `qwen --acp` で起動します。

Safe、Auto-approve、Plan は Qwen の `default`、`yolo`、`plan` に対応します。その他または不明な Qwen modes は shared toolbar で保守的に Safe と表示されます。Reasoning effort は Low、Medium、High、XHigh、Max をサポートし、デフォルトは High です。`/effort <tier>` は通常の turn の前に適用され、session ごとに cache され、effective model に依存します。single-select、multi-select、freeform questions の ACP permission metadata は shared inline UI に表示されます。

Qwen の credentials と native configuration は引き続き `~/.qwen/settings.json` で Qwen が管理します。Grimoire は `.grimoire/mcp/qwen.json` に分離された project MCP list を管理し、Qwen の native configuration を書き換えずに ACP sessions へ渡します。Usage は Qwen が ACP の token または cost metadata を報告した場合だけ表示されます。Rewind と fork はサポートしません。

- [Qwen Code ドキュメント](https://qwenlm.github.io/qwen-code-docs/en/)
- [Qwen Code の認証](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/)
- [Qwen Code repository](https://github.com/QwenLM/qwen-code)

Qwen が起動しない、または model が表示されない場合は、Qwen Code 内で `/doctor` を実行し、`/auth` を完了して `qwen --version` を確認し、Grimoire settings の Qwen CLI path を確認してください。

### Devin

Devin CLI (Cognition) はオプトインの ACP provider です。Grimoire は `devin acp` を起動し、稼働中の session から利用可能な models と modes を取得し、メッセージ・思考・tool activity をストリームし、shell command とファイル書き込みの前に確認し、session をネイティブに再開します。提示される model の一覧はサインインしている account によって変わります。これは Devin 側の仕様で、Grimoire の制限ではありません。

```bash
# macOS, Linux, WSL
curl -fsSL https://cli.devin.ai/install.sh | bash

# Homebrew
brew install --cask devin-cli

devin auth login
devin --version
```

`devin auth login`（ブラウザ経由）でサインインしてから、Grimoire で Devin を有効にしてください。Safe、Auto-approve、Plan はそれぞれ Devin の `accept-edits`、`bypass`、`plan` に対応します。Devin の `smart` と `ask` は共有ツールバーでは Safe として表示されます。

- [Devin CLI ドキュメント](https://docs.devin.ai/cli)
- [Devin ACP ドキュメント](https://docs.devin.ai/desktop/acp)

Safe モードについて知っておくべき点があります。Devin はどの shell command が読み取り専用かを自分で判断し、それらは確認なしで実行します。`echo` はファイルへリダイレクトしていても読み取り専用として扱われます。Grimoire はプロトコル経由の書き込みをすべて承認対象にしますが、agent が自分の shell 経由で行う書き込みはそこをすり抜けることがあります。書き込みを一切させたくない session では Plan を使ってください。

Devin の認証情報は `~/.local/share/devin/` にあり、Devin が所有します。Vault skills は `.devin/skills` と `.agents/skills` から読み込まれ、skill がそのまま Devin の slash command になります。Grimoire は `.grimoire/mcp/devin.json` に独自の MCP リストを保持し、ACP session に注入します。Usage は Devin が報告したときに表示されます。reasoning effort のコントロールはありません。effort が model id の一部だからです。Grimoire の fork と rewind には対応していません。


### Reasonix

Reasonix はオープンソースのマルチモデル coding agent で、ここでは opt-in の ACP provider です。Grimoire は `reasonix acp` を起動し、稼働中の session から models と modes を読み取り、メッセージ・思考・tool activity・plan を stream し、permission 対象の tool とファイル書き込みの前に確認し、session をネイティブに再開します。session が提供する models は Reasonix の設定にある provider ブロック次第で、これは Reasonix の仕様であり Grimoire の制限ではありません。

```bash
# npm
npm i -g reasonix

# Homebrew
brew install esengine/reasonix/reasonix

reasonix setup
reasonix --version
```

`reasonix setup` を実行して model provider と認証情報を設定し、Grimoire で Reasonix を有効にしてください。Reasonix は他の provider が 1 つ持つ設定を 2 つ持ちます。session mode（`normal`、`plan`、`goal`）と、別立ての tool 承認姿勢（`ask`、`auto`、`yolo`）です。Grimoire のツールバーは両方を操作します。Safe は確認する `normal`、Plan は確認する `plan`、Auto-approve は `yolo` の `normal` です。`goal` は Reasonix 固有で、Safe として表示されます。 Safe と Auto-approve を分けているのは姿勢だけなので、それを設定できなかった turn は、緩いほうで黙って走るのではなく拒否されます。

Reasonix は許可だけでなく質問もします。`ask` tool は同じチャネルで届き、説明が質問、番号付きの選択肢が回答というカードとして描かれます。番号で選んでください。回答が複数あるカードでは `Enter` は何もしないので、習慣的なキー操作があなたの代わりに選ぶことはありません。

reasoning effort は固定リストではなく、session から供給される picker です。どの段階を model が受け取るかは、それを提供する provider ブロックが決めます。`supported_efforts` を宣言したブロックは Disabled、Low、High、Max を、宣言しないブロックはその種類の組み込みセットを提供します。Grimoire は開いている session が提示したものを読み、先頭に Auto を置きます。Auto は判断を Reasonix に委ねる値です。session が提示しなかった段階は決して送られません。CLI が model に対してそれを拒否するからです。

- [Reasonix ドキュメント](https://reasonix.io/docs/)
- [GitHub 上の Reasonix](https://github.com/esengine/DeepSeek-Reasonix)

Safe モードについて 1 つ。`ask` が守るのは Reasonix が permission 対象と判断した tool であって、すべての tool ではありません。read-only と判断された shell command は確認なしで走ります。Grimoire は Reasonix がプロトコル経由で行うファイル書き込みをすべて承認対象にします。それが vault を確認の後ろに置いている仕組みです。まったく書き込ませたくない session には Plan を使ってください。

Reasonix は設定を `~/.reasonix/config.toml` に持ち、API キーはそのファイルが指定する名前で環境から読み取ります。Vault の skills は `.reasonix/skills` と `.agents/skills` から読まれます。Grimoire は `.grimoire/mcp/reasonix.json` に独立した project MCP リストを管理し、ACP session に注入します。使用量は Reasonix 自身の status notification から得られ、cost は model provider に価格がある場合のみ表示されます。fork、rewind には対応していません。

**Image attachments as files** を有効にすると、画像を `.grimoire/attachments/` のファイルとして渡します。画像対応モデルとファイル読み取りツールが必要で、読み取りには追加のツール呼び出しが発生します。ファイルがない場合や書き込めない場合は送信が失敗します。既定では無効です。

### Pi

両方のツールを個別にインストールしてください。アダプターには **Node.js 22+** と **Pi 0.80.4+** が必要です。

1. [公式手順](https://pi.dev/docs/latest)に従って Pi をインストールします。macOS と Linux：

   ```bash
   curl -fsSL https://pi.dev/install.sh | sh
   ```

   npm を使う方法もあります：

   ```bash
   npm install -g --ignore-scripts @earendil-works/pi-coding-agent
   ```

2. [グローバルインストールの手順](https://github.com/svkozak/pi-acp#global-install)に従ってアダプターをインストールします：

   ```bash
   npm install -g pi-acp
   ```

3. ターミナルで Pi のセットアップを開き、モデルプロバイダーや API キーを設定します：

   ```bash
   pi-acp --terminal-login
   ```

4. Obsidian を再起動し、**設定 → Grimoire → プロバイダー**で **Pi** を有効にして **Refresh all models** を押します。`pi` と `pi-acp` が `PATH` から利用できる必要があります。検出できない場合は **Adapter path** に `pi-acp` の絶対パスを指定し、必要に応じて Pi の **Environment variables** に `PI_ACP_PI_COMMAND=/absolute/path/to/pi` を追加してください。

Grimoire がアダプターを起動するため、Zed の設定や別のアダプターサーバーは不要です。

両方の実行ファイルは外部依存のままです。Grimoire は Pi からモデルと推論強度を取得し、回答とツールの動作を逐次表示し、画像をネイティブに送信して保存済みセッションを再開します。共通のモデル選択欄は更新時も選択と別名を保持します。

**推論強度の制限（pi-acp 0.0.33）：** メニューには、アダプターが選択モデルに実際に適用できる段階だけを表示します。例えば Pi は GLM-5.3 で `low`、`high`、`max` に対応しますが、アダプターは `max` を拒否するため、Grimoire では `low`、`high`、**Pi default** を選べます。`xhigh` は `max` の代わりにはなりません。上流の [PR #73](https://github.com/svkozak/pi-acp/pull/73) は `max` の追加を、[PR #125](https://github.com/svkozak/pi-acp/pull/125) は選択モデルの実際の段階の取得を提案しています。2026-09-21 時点で両方とも未マージのまま公開されており、提案された修正は検証済みのアダプター版には含まれていません。

ツールの権限は Pi が管理し、確認なしで読み取り、書き込み、コマンド実行が可能です。Grimoire は拡張機能からの権限要求を表示しますが、Safe や Plan モードは提供しません。MCP、スキル、プロンプトテンプレートは Pi で設定します。ファイルはディスクから読み取られ、アダプターはエディターの未保存テキスト、アカウントの利用枠、コンテキスト使用量を提供しません。Pi 0.86.1 と pi-acp 0.0.33 で検証済みです。

### Command Code

Command Code は任意に有効化できます。ターミナルでインストールと認証を行い、設定 → Grimoire → プロバイダーで有効にしてください。

```bash
npm i -g command-code
command-code login
```

推論の強度は、インストール済み CLI から選択モデルに応じて取得します。選択肢はモデルが対応する段階と CLI の既定値のみで、強度を調整できないモデルには選択欄を表示しません。明示的な選択はネイティブのセッション変更 API を通じて現在の実行に適用され、CLI の全体設定は変更しません。CLI の既定値を選ぶと、再開するセッションに保存された強度も含め、ネイティブの動作を維持します。

Grimoire は CLI のヘッドレス JSON 出力から回答とツールの動作を逐次表示し、`--list-models` でモデルを取得します。ネイティブのセッション ID を保存し、再読み込み後に明示的に再開します。認証、設定、スキル、MCP、会話記録は Command Code が管理します。コンテキスト使用量は報告された入力トークン数を推定またはユーザー指定の上限と比較した値で、アカウントの利用枠や料金は推測しません。

**Image attachments as files** を有効にすると、画像を `.grimoire/attachments/` のファイルとして渡します。画像対応モデルとファイル読み取りツールが必要で、読み取りには追加のツール呼び出しが発生します。ファイルがない場合や書き込めない場合は送信が失敗します。既定では無効です。

**Safe** は編集、コマンド、その他の読み取り専用ではないツールを一時停止し、Grimoire で1回限りの承認を求めます。拒否、キャンセル、承認接続の切断時には実行しません。現在の Safe は検証済みの Command Code 1.53.0 / 1.66.0 の npm インストールを必要とし、独立した処理ループがこの承認機構を使えないため、ネイティブのサブエージェントを無効にします。**Auto-approve** は Grimoire の確認なしで動作しますが、ネイティブの拒否・確認ルールは両モードで有効です。この連携では対話式質問、計画操作、スラッシュコマンド、管理対象の MCP・スキル・エージェント、補助タスク、分岐、巻き戻し、ネイティブ履歴の取り込みは提供しません。

- [Command Code のヘッドレス実行ドキュメント](https://commandcode.ai/docs/headless)

### OpenCode

独自の provider configuration を持つ model-agnostic agent を使いたい場合は OpenCode を選びます。

```bash
curl -fsSL https://opencode.ai/install | bash
opencode
```

Homebrew、npm、bun、package-manager installs も使えます。OpenCode 側で provider credentials を設定し、その後 Grimoire で有効化します。

- [OpenCode のダウンロード](https://opencode.ai/download)
- [OpenCode のプロバイダードキュメント](https://opencode.ai/docs/providers)
- [OpenCode config docs](https://opencode.ai/docs/config)

Grimoire 内では、OpenCode は ACP で動作し、Grimoire-managed launch artifacts、persistent runtime、native history、plan mode、image input、provider commands、reasoning effort をサポートします。Cost metadata が利用できる場合は monthly spend を表示します。

### MiMoCode

MiMoCode（小米）はOpenCodeのフォークで、永続メモリ、インテリジェントなコンテキスト管理、サブエージェントオーケストレーションを備えています。

```bash
curl -fsSL https://mimo.xiaomi.com/install | bash
mimo
```

Homebrew、npm、bun、package-manager installs も使えます。MiMoCode 側で provider credentials を設定し、その後 Grimoire で有効化します。

- [MiMoCode GitHub](https://github.com/XiaomiMiMo/MiMo-Code)

Grimoire 内では、MiMoCode は ACP で動作し、persistent runtime、native history、plan mode、image input、provider commands、reasoning effort をサポートします。

### Kimi Code

Kimi Code CLI（MoonshotAI）は、Kimi、OpenAI、Anthropic、Gemini、Vertex AIモデルをサポートするマルチプロバイダー端末エージェントです。

```bash
curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash
kimi
```

Kimi Code 側で provider credentials を設定し、その後 Grimoire で有効化します。

- [Kimi Code GitHub](https://github.com/MoonshotAI/kimi-code)

Grimoire 内では、Kimi Code は ACP で動作し、persistent runtime、native history、plan mode、image input、provider commands、reasoning effort をサポートします。

### Grok Build

Obsidian で xAI の agentic CLI を使う場合は Grok Build を選びます。Grok OAuth でサインインするか、xAI API キーを使用します。

```bash
grok
```

xAI の Grok CLI をインストールし、grok.com OAuth で認証するか API keys を設定してから、Grimoire で Grok Build を有効化します。

- [Grok Build ドキュメント](https://docs.x.ai/build/overview)
- [Grok 4.5](https://docs.x.ai/developers/grok-4-5)
- [使用量と制限](https://docs.x.ai/grok/faq)

Grok 4.5 は現在、Grok Build を支えるデフォルトモデルです。Grimoire は静的リストを保持するのではなく、認証済み Grok CLI アカウントから利用可能なモデルカタログを取得するため、モデルの提供状況はアカウントや CLI バージョンによって異なり、自動的に更新される場合があります。

Grimoire 内では、Grok Build は `grok agent stdio` 経由の ACP で動作し、`.grimoire/grok/` 配下の Grimoire-managed launch artifacts、persistent runtime、native JSONL history hydration、plan mode、image input、provider commands、native models 向け reasoning effort、rewind、fork をサポートします。OAuth 認証時には、共有の週間 Grok 使用枠、リセット時刻、利用可能な Extra Usage Credits を表示します。API spend は session cost metadata が報告されたときに集計されます。

## 最初のチャット

1. Composer で provider と model を選びます。
2. Reasoning effort を設定し、permission control で Safe、Auto-approve、Plan のいずれかを選びます。
3. Scope に入れたい notes、folders、context を mention します。
4. Turn を送信します。
5. Panel に表示される tool calls、usage、output を確認します。

## 機能

### チャットの作業領域

複数 tabs を持つ集中型サイドパネルです。各 tab は独自の draft、provider、model、context、runtime を保持します。Obsidian を閉じて再度開いても sessions は復元され、各 response に provider、model、reasoning effort が保持されます。Rewind と fork は、active provider がサポートする場合に表示されます。履歴を読むために手動で scroll すると、auto-scroll は自動的に控えます。表示出力が 10 秒ないと、shared wait indicator が active provider と経過時間を表示し、質問や permission を待つ間は停止します。

### タブ、履歴、ナビゲーション

タブの操作メニューまたは右クリックから、名前変更、複製、タブを閉じる操作ができます。中クリックでタブを閉じ、元に戻す操作で下書きと位置を復元できます。履歴ポップオーバーで過去のチャットを検索し、新しいタブで開けます。手動で付けたタイトルと自動生成されたタイトルは区別して表示されます。会話ツールバーには移動ボタンと目次があり、完了した回答には完了時刻が表示されます。

<p align="center">
  <img src="../../assets/readme/conversation-history.png" alt="Ocean Atlas の会話を3件表示した履歴検索。モデルとタイトルの生成元も表示" width="100%">
</p>

### 並列エージェント、設定、入力欄

**Parallel workers** approval card は inherited model を表示し、起動する提案タスクだけを選択できます。Settings は Obsidian の native search を使い、永続的な What's New を保持します。Provider settings と composer は provider 間で一貫した surface を使いつつ、provider-owned controls と設定はそのまま保持します。

### キーボードショートカット

| ショートカット | 操作 |
| --- | --- |
| `Enter` | 現在の turn を送信します。**Send only with button** が有効な場合は無効です。 |
| `Shift+Enter` | Composer に改行を挿入します。 |
| `Shift+Tab` | Permission mode を `Safe -> Auto-approve -> Plan -> Safe` の順に切り替えます。Plan mode 非対応の provider では Safe と Auto-approve を切り替えます。 |
| `Escape` | 実行中の回答を停止するか、履歴ポップオーバーを閉じます。 |

### モデル選択

ひとつの picker が provider ごとに grouped され、label 順に並びます：Antigravity、Claude Code、Codex、Command Code、Devin、Gemini CLI (Legacy)、Grok Build、Kimi Code、MiMoCode、OpenCode、Pi、Qwen Code、Reasonix。Search は labels、descriptions、groups、model IDs を横断します。Catalogs は lazily に load され、collapse した groups を記憶します。Settings で custom aliases と context-window overrides を追加できます。Claude の 1M variants は base models の置き換えではなく、追加 options です。

OpenCode、MiMoCode、Kimi Code、Grok Build、Command Code、Pi は設定で共通のモデル選択 UI を使います。エイリアス付きの選択済み行、検索可能なカタログ、**Refresh all models** を備え、更新後も選択とエイリアスを保持します。CLI が提供元の名前を返す場合は提供元フィルターも表示します。

### 使用量と料金

Model selector の横の badge が active provider の usage を表示します。Model menu にはより詳しい readouts があり、provider が quota windows を公開する場合は quota を、cost だけが利用できる場合は spend を表示します。Refresh 中や失敗時も最後に取得できた値を保つため、meter が急に消えることはありません。静かな UI が好みなら settings で全体をオフにできます。

| Provider | Usage の取得元 |
| --- | --- |
| Codex | Account rate-limit notifications、利用可能な場合は `account/rateLimits/read` |
| Claude Code | SDK rate-limit events、任意の `.grimoire/claude/statusline-usage.json`、SDK result cost metadata |
| Antigravity CLI | `agy --print` からはまだ信頼性高く取得不可 |
| Gemini CLI (Legacy) | Gemini CLI が返す場合の ACP cost metadata。legacy provider のみ |
| Qwen Code | Qwen Code が返す場合の ACP token と cost metadata |
| Devin | ACP が報告する session の credit 合計を月次の spend として |
| Reasonix | 独自の status notification が報告する turn ごとの cost（設定した model provider に価格がある場合） |
| Pi | pi-acp アダプターから報告されません |
| OpenCode | ACP と session cost metadata から集計した monthly spend |
| MiMoCode | ACP と session cost metadata から集計した monthly spend |
| Kimi Code | ACP と session cost metadata から集計した monthly spend |
| Grok Build | OAuth 認証による共有の週間 Grok 使用枠、リセット時刻、Extra Usage Credits；session cost metadata からの monthly API spend |

### 計画モード

Active provider が Plan mode をサポートしている場合、次の 2 通りで有効にできます。

- Composer の permission control をクリックし、Plan まで切り替えます: `Safe -> Auto-approve -> Plan`。
- `Shift+Tab` を押すと、`Safe -> Auto-approve -> Plan -> Safe` の完全なサイクルを切り替えます。

Plan mode では、provider が変更を始める前にまず計画します。Composer では Safe と Auto-approve と同じ permission control を使うため、作業中も active mode が見えたままになります。

Provider の計画が完了すると、Grimoire はレンダリング済みの計画、要求された permissions、キーボードで扱いやすい行を備えた折りたたみ可能な Plan complete カードを表示します。Approve は同じ session で続行し、feedback を入力すると provider が計画を見直せるように Plan mode を維持します。

### コンテキストとメンション

Composer から vault notes と folders を直接 mention できます。Current note や linked note を取り込み、settings で persistent external context paths を追加できます。Provider が image input を受け付ける場合は、画像を貼り付けたり drop したりできます。Provider integration が対応する場合は MCP servers も mention できます。Context tab には、bound note、model、permission mode、pinned files、`.grimoire/grok/system.md` のような launch artifacts、および session 中に agent が読み込んだ files が表示されます。

### ノート内での編集

選択範囲に対して "Grimoire: Inline edit" を実行します。Prompt がテキストの横に開き、edit は accept/reject できる diff として返り、provider-backed inline edit service を通じて実行されます。Selection の置換と新しい text の挿入の両方に対応しています。

### 確認の質問

Provider が structured user input を求めると、Grimoire は turn を一時停止し、composer の上に質問を表示します。Claude Code ではこれを `AskUserQuestion` として公開し、Codex app-server では experimental な `request_user_input` / `requestUserInput` surface として公開し、Qwen Code は ACP permission metadata を提供します。Grimoire はこれらの provider-specific mechanisms を同じ inline question UI に normalize します。Single-select、multi-select、freeform answers は provider run に戻されるため、agent は別の chat message なしで続行できます。

### コマンド

Built-in commands は image generation や resume などの Grimoire workflows をカバーします。Claude Code slash commands、OpenCode、Grok Build、Qwen Code runtime commands のように provider が独自 commands を公開する場合は、provider-owned catalogs 経由で表示されます。使わない commands は settings で隠せます。

### 画像生成

画像を貼り付けるか drop すると attachment として追加できます。Built-in `/image [prompt]` command は image API を直接呼びません。Active provider に通常の turn を送り、あなたが設定した image generation 手段を使うよう指示します：provider-native tooling、MCP tools、または local command。Agent は結果を vault に保存し、`![[path/to/image.png]]` のような embed を返します。Image generation が設定されていない場合は、何が不足しているかを説明する通常の回答が返ります。

### 安全性と権限

Permission modes は provider に属するため、Grimoire はそれらを再実装せず、shared composer controls として表示します。Active provider が plan mode をサポートする場合、permission control と `Shift+Tab` はどちらも Safe、Auto-approve、Plan を順に切り替えます。Safe mode と permission prompts は作業中も見える状態を保ちます。Bang-bash mode は、enabled provider が提供する場合にのみ表示されます。Configured MCP servers、shell access、API keys は sensitive data として扱ってください。実際に sensitive だからです。

### デバッグログ

Default ではオフです。有効にすると、Grimoire は sanitized JSONL を `.grimoire/logs/YYYY-MM-DD.jsonl` に書き込みます。Prompts、answers、note contents、paths、environment values、secrets は redact されます。これは provider と runtime issues を診断するためのもので、transcript を保存するためのものではありません。

### 設定

設定は4つのタブに分かれています。**一般**では言語、チャットの位置、タブ、表示を、**プロバイダー**では CLI の有効化とモデルを、**詳細**ではコンテキスト、会話、ツール、診断を、**情報**ではバージョンと更新内容を扱います。Obsidian 標準の設定検索にも対応しています。

プロバイダー一覧には CLI の検出状況と有効化スイッチが表示され、その下に選択したプロバイダーの設定が並びます。

<p align="center">
  <img src="../../assets/readme/settings-providers.png" alt="Grimoire の12種類の CLI 連携と Codex モデル設定の一覧" width="100%">
</p>

<details>
<summary>一般設定</summary>

<p align="center">
  <img src="../../assets/readme/settings-general.png" alt="言語、パネル位置、タブ、ラベル、スクロール、会話タイトルの一般設定" width="100%">
</p>

</details>

## Grimoire がデータを置く場所

| Path | 内容 |
| --- | --- |
| `.grimoire/grimoire-settings.json` | アプリ設定とプロバイダー設定 |
| `.grimoire/sessions/*.meta.json` | セッションのメタデータ |
| `.grimoire/logs/YYYY-MM-DD.jsonl` | 任意で有効にする、機密情報を除去したデバッグログ |
| `.grimoire/claude/statusline-usage.json` | Plan meter 用の Claude usage snapshot |
| `.grimoire/grok/` | Grok Build launch artifacts、managed config、session pointers |

Provider-native files under `.claude/`, `.codex/`, `.opencode/`, and `.grimoire/grok/` はその場で読み書きされるため、provider setup は Grimoire の外でも portable なままです。

## プライバシー

Grimoire は Obsidian の中で、あなたのマシン上で動作します。Backend はなく、telemetry を追加せず、prompts、answers、notes、files、tool output、API keys、usage logs を Grimoire service にアップロードしません。書き込む logs は上記の optional sanitized debug logs だけで、それも vault 内に残ります。

Grimoire が隠せないものは provider 自体です。有効化した CLI は prompt、選択した context、request に必要な files、images、tool output、commands を受け取ります。その CLI は Anthropic、OpenAI、Google、設定済みの OpenCode vendors、MCP servers、またはあなたが設定した他の接続先と通信する可能性があります。Terms、retention、billing、rate limits、privacy policies は provider のものであり、Grimoire のものではありません。Grimoire の役割は、その境界を Obsidian の中で見えるようにし、あなたが制御できるようにすることです。

Obsidian のポリシーに基づいたネットワーク利用、アカウント要件、外部ファイルアクセス、ログ、telemetry の概要については、[DISCLOSURES.md](../../DISCLOSURES.md) を参照してください。

## 開発

Contributions を歓迎します。Pull Request を開く前に [CONTRIBUTING.md](../../CONTRIBUTING.md) を読んでください。architecture、security、tests、review の期待事項を説明しています。

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run test
npm run build
npm run build:release
```

Meaningful な UI/provider changes を publish または push する前に、full local gate を実行してください。

```bash
npm run test -- --selectProjects unit
npm run typecheck
npm run lint
npm run build:release
```

`npm run build:release` は generated `main.js`、root `styles.css`、`dist/grimoire` を更新します。

npm は development、CI、releases の canonical package manager です。dependencies を変更したら `package-lock.json` を最新に保ってください。secondary package-manager lockfiles は意図的に commit しません。

## リリース

Grimoire releases は `1.0.0` のような semver tags から publish されます。Release workflow は local gate を実行し、Obsidian bundle を build し、tag が `package.json` と `manifest.json` に一致することを検証し、`main.js`、`manifest.json`、`styles.css` を GitHub Release に attach します。

Obsidian Community plugins が推奨されるユーザー向けインストール方法です。GitHub Releases には、manual install と BRAT 向けの bundle assets を引き続き添付します。`main` を releasable development に使い、manifest version と一致する tag で publish します。

## 開発計画

現在 Grimoire は Codex、Claude Code、Antigravity CLI、Gemini CLI (Legacy)、OpenCode、MiMoCode、Kimi Code、Grok Build、Qwen Code、Devin、Pi、Reasonix、Command Code とともに ship されています。

次の候補は GitHub Copilot CLI、その他の ACP-compatible providers、そして runtime が Obsidian に embed できるほど安定した local model CLIs です。Implementation notes は [docs/provider-roadmap.md](../provider-roadmap.md) にあります。

## ライセンス

MIT。詳しくは [LICENSE](../../LICENSE) を参照してください。
