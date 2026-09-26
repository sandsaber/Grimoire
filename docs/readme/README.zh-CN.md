# Grimoire · 魔导书

<p align="center">
  <img src="../../assets/readme/grimoire-logo.png" alt="Grimoire 标志" width="240">
</p>

<p align="center">
  <strong>面向 Obsidian 仓库的本地优先 AI 代理。</strong>
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="许可证：MIT">
  <img src="https://img.shields.io/github/v/release/sandsaber/Grimoire?label=release" alt="最新版本">
  <img src="https://img.shields.io/badge/Obsidian-1.13.0%2B-7c3aed" alt="Obsidian 1.13.0+">
  <img src="https://img.shields.io/badge/platform-desktop-lightgrey" alt="仅桌面端">
</p>

<p align="center">
  <img src="../../assets/readme/chat-workspace.png" alt="Obsidian 中的 Ocean Atlas 旁边，Codex Astra High 正在讨论海洋分层、洋流与海洋生物的联系" width="100%">
</p>

<p align="center">
  <sub>真实笔记与基于笔记链接的对话。</sub>
</p>

Grimoire 将智能体 CLI 助手带入 Obsidian。Codex、Claude Code、Antigravity CLI、Gemini CLI（旧版）、OpenCode、MiMoCode、Kimi Code、Grok Build、Qwen Code、Devin、Pi、Reasonix 和 Command Code 都位于同一个侧边栏中；它们可以读取笔记、编辑文件、执行命令、调用工具，并将会话历史保存在你的真实仓库中。任何内容都不会经由 Grimoire 服务器传输：没有遥测、没有托管后端，也没有处在中间的代理服务器。

Grimoire 面向已经使用 Obsidian 工作，并希望 AI 助手像仓库的一部分那样运作的用户：上下文留在本地、文件留在本地、供应商由你明确选择，用量也真正可见。

## 为什么选择 Grimoire

- 在笔记里直接使用你已经信任的 CLI 代理。
- 直接从输入区切换供应商。Codex、Claude Code、Antigravity CLI、Gemini CLI（旧版）、OpenCode、MiMoCode、Kimi Code、Grok Build、Qwen Code、Devin、Pi、Reasonix 和 Command Code 共用一个模型选择器。
- 让每轮对话都以你的仓库为依据。可以提及笔记、文件夹和 MCP 工具，无需手动粘贴路径。
- 在模型选择器旁查看费用和限制——也就是你作出模型选择的位置。
- 坚持本地优先。Grimoire 不收集遥测数据、不代理转发提示词，也不运行后端服务。

## 各供应商支持的功能

| 功能 | Codex | Claude Code | OpenCode | Grok Build | MiMoCode | Kimi Code | Antigravity CLI | Gemini CLI (Legacy) | Qwen Code | Devin | Reasonix | Command Code | Pi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 本地持久运行环境 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 | 不支持 | 支持 | 支持 | 支持 | 支持 | 不支持 | 支持 |
| 原生历史恢复 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 | 不支持 | 支持 | 不支持 | 不支持 | 不支持 | 不支持 | 支持 |
| 计划模式 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 | 不支持 | 支持 | 支持 | 支持 | 支持 | 不支持 | 不支持 |
| 图片附件 | 支持 | 支持 | 支持 | 不支持 | 支持 | 支持 | 文件 | 支持 | 支持 | 支持 | 文件（需启用） | 文件（需启用） | 支持 |
| 指令模式 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 | 不支持 | 支持 | 支持 | 支持 | 支持 | 不支持 | 不支持 |
| 推理强度控制 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 | 不支持 | 支持 | 是（取决于模型） | 是（取决于模型） |
| 回退 | 不支持 | 支持 | 不支持 | 支持 | 不支持 | 不支持 | 不支持 | 不支持 | 不支持 | 不支持 | 不支持 | 不支持 | 不支持 |
| 分支 | 支持 | 支持 | 不支持 | 支持 | 不支持 | 不支持 | 不支持 | 不支持 | 不支持 | 不支持 | 不支持 | 不支持 | 不支持 |
| 供应商斜杠命令 | 不支持 | 支持 | 支持 | 支持 | 支持 | 支持 | 不支持 | 支持 | 支持 | 支持 | 支持 | 不支持 | 支持 |
| Grimoire 管理的 MCP 界面 | 不支持 | 支持 | 支持 | 支持 | 支持 | 支持 | 不支持 | 支持 | 支持 | 支持 | 支持 | 不支持 | 不支持 |

## 安装

Grimoire 是桌面端插件。它会在本机调用各供应商的 CLI，因此不提供移动端版本。

### 使用社区插件市场（推荐）

请从 Obsidian 社区插件市场安装 Grimoire：

1. 打开“设置 → 第三方插件”，如有需要先关闭受限模式。
2. 点击“浏览”，搜索 Grimoire 并安装。
3. 启用 Grimoire，然后通过左侧功能区或命令面板打开聊天面板。

### 使用 GitHub Releases

如果无法使用社区插件市场，可以手动安装当前版本：

1. 从最新的 [Grimoire 版本](https://github.com/sandsaber/Grimoire/releases/latest) 下载 `main.js`、`manifest.json` 和 `styles.css`。
2. 创建 `/path/to/your/vault/.obsidian/plugins/grimoire`。
3. 将三个文件都放入该文件夹。
4. 在“设置 → 第三方插件”中启用 Grimoire。

### 使用 BRAT

如果你希望在社区插件市场之外跟踪带标签的构建版本，BRAT 可以从 GitHub Releases 安装 Grimoire：

1. 安装 "Obsidian42 - BRAT" 插件。
2. 在 BRAT 中添加 `sandsaber/Grimoire` 作为测试版插件。
3. 启用 Grimoire。

### 从源代码安装（开发者）

构建发布包，并放入你的仓库：

```bash
npm install
npm run build:release

mkdir -p /path/to/your/vault/.obsidian/plugins/grimoire
cp dist/grimoire/main.js dist/grimoire/manifest.json dist/grimoire/styles.css \
  /path/to/your/vault/.obsidian/plugins/grimoire/
```

然后在“设置 → 第三方插件”中启用 Grimoire。

无论使用哪种安装方式，请先安装至少一个供应商 CLI。Grimoire 会封装这些供应商 CLI，但不会替代其账户配置、模型权限、额度或服务条款。

## 设置供应商

在“设置 → Grimoire → 供应商”中启用所需供应商，启用后它们会出现在模型选择器中。首次启动时默认启用 Codex，其余供应商需要手动开启。

### 推荐供应商

为了获得最佳 Grimoire 体验，建议先从 Codex、Claude Code、OpenCode、MiMoCode、Kimi Code、Grok Build 或 Qwen Code 开始。这些供应商目前为仓库原生工作提供最强的运行时接口：持久会话、面向规划的工作流、工具活动和丰富的模型控制。

Antigravity CLI 和 Gemini CLI（旧版）仍可用于 Google 账户和兼容性场景，但目前不建议将它们作为 Grimoire 的主要供应商。Grimoire 会在现有条件下尽力支持它们，并已实现当前 CLI 所允许的回退方案；不过，它们的 ACP 与运行时接口在技术上仍有局限：与推荐供应商相比，会话、授权、流式输出、工具/编辑元数据、模型发现和用量报告并不完整，或不够可靠。

### Codex

Codex 是首次启动时的默认供应商。选择它即可在本地 CLI 中使用 OpenAI Codex，并通过 ChatGPT 套餐或 API 密钥登录。

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex
```

先运行一次 Codex 并登录，然后在 Grimoire 中启用。目前主要的安装方式是独立安装程序；Windows、Homebrew 及包管理器备用安装方式请参阅官方 Codex CLI 文档。

- [Codex CLI 设置](https://developers.openai.com/codex/cli)
- [OpenAI 代码生成指南](https://developers.openai.com/api/docs/guides/code-generation)

在 Grimoire 中，Codex 通过 app-server 协议运行，支持原生历史记录、分叉、规划模式、图片输入和推理强度控制。当 Codex 返回速率限制元数据时，界面会显示套餐用量。

### Claude Code

如果你需要 Claude 原生的项目记忆、斜杠命令、MCP 配置、规划、回退与分叉功能，并希望通过 Claude 订阅或 API 密钥使用，可以选择 Claude Code。

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude
```

先在 Claude Code 中完成身份验证，然后在 Grimoire 中启用它。旧版 npm 包已弃用；请使用上面的原生安装程序、Homebrew（`brew install --cask claude-code`）、WinGet，或官方快速入门中列出的其他方式。

- [Claude Code 快速入门](https://code.claude.com/docs/en/quickstart)

在 Grimoire 中，Claude Code 会读取并保留你的 `.claude/` 文件，通过 Claude Code SDK 运行，并支持斜杠命令、MCP 设置、代理、技能、规划、回退和分叉。当 Claude 同时报告额度与费用时，界面会并排显示额度周期和 API 支出。

默认启用**遵循 Claude Code 设置**。Grimoire 会从 Claude Code 用户设置（`~/.claude/settings.json`）和仓库设置（`.claude/settings.json`）中读取 `model` 与 `env`，并将其用于 Claude 模型选择器和运行环境。这样，MiniMax、Z.ai 等兼容 Anthropic 的网关及其自定义模型也能在 Grimoire 中使用。项目设置优先于用户设置，而 Grimoire 中明确配置的环境变量优先级最高。

如果实际生效的 Claude 环境包含 `ANTHROPIC_API_KEY`，Grimoire 可以刷新 Anthropic 的模型目录，并将发现的模型合并到选择器中。没有 API 密钥或刷新失败时，选择器仍会使用 Claude Code 的 `Best`、`Fable 5`、`Opus Plan`、1M 变体等别名，以及 `.claude` 和 Grimoire 中的自定义模型。

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

Antigravity CLI 是 Google 用来替代面向个人用户的 Gemini CLI 的工具，可访问你的 Antigravity 账户中提供的 Gemini、Claude、GPT-OSS 及其他模型系列。在 Grimoire 中，应将它视为兼容性供应商，而不是推荐的默认选择。

```bash
agy
```

从 Google 安装官方 Antigravity CLI，在本机完成身份验证，然后在 Grimoire 中启用 Antigravity。Grimoire 会从 PATH 自动检测 `agy`；也可以在供应商设置的**Antigravity CLI 路径**中指定本机命令路径。

- [Antigravity CLI](https://antigravity.google/product/antigravity-cli)
- [Gemini CLI 迁移指南](https://goo.gle/gemini-cli-migration)

在 Grimoire 中，Antigravity 通过 `agy --print` 运行，并可选择使用 `agy models` 中的模型；Grimoire 会将当前笔记，以及编辑器、浏览器、画布、仓库搜索和项目工作区上下文合并到这条 `--print` 提示词中。由于 `agy` 目前没有向 Grimoire 提供能力完备、兼容 ACP 的运行时，本集成只能在现有条件下尽力工作。在 Antigravity 提供稳定的运行时接口之前，持久会话、原生历史记录、规划模式、流式输出、具备安全授权的文件编辑、可靠的用量报告和辅助工作流都会保持关闭或受到限制。 图片以临时文件传递，后续消息需要重新附加。

**已知的 Windows 限制：**当前 Windows 版 `agy` 可能在命令成功结束时，仍为 `agy models` 和 `agy --print` 返回空的标准输出。Grimoire 会尽力从 Antigravity 的日志、会话记录、设置和预置的 Pro AI 模型列表中恢复结果；在上游 CLI 提供稳定输出之前，Antigravity 在 Windows 上的可靠性可能低于 macOS 或 Linux。如果你的账户在 Antigravity 中显示了其他模型，请将其准确标签添加到“Antigravity 设置 → 自定义模型”。

`agy --print` 不会向 Grimoire 提供文件编辑授权钩子。为确保安全，Grimoire 会禁用 Antigravity 共用的“安全”/普通模式；只有当你愿意让 AGY 在不经 Grimoire 提示的情况下编辑文件时，才应将 Antigravity 工具栏开关切换为“自动批准”。

### Gemini CLI（旧版）

Gemini CLI 仍作为旧版兼容供应商保留，适用于 Google 继续为其提供 Gemini CLI 请求服务的 Gemini Code Assist 标准版、企业版、Google Cloud 和付费 API 密钥用户。由于其 ACP 支持较弱，多个 Grimoire 工作流无法在其基础上可靠实现，因此不建议用于新的 Grimoire 配置。在 Google 于 2026 年 6 月 18 日进行过渡后，Google AI Pro、Ultra 和免费层级的个人账户应改用 Antigravity，同时留意上文所述的 Antigravity 限制。

```bash
gemini
```

仅当你的账户层级仍受支持，并且确实需要这条旧版 Google 接入路径时，才启用 Gemini CLI。Grimoire 通过 `gemini --acp` 运行它，将当前笔记，以及编辑器、浏览器、画布、仓库搜索和项目工作区上下文合并到 ACP 提示词中；模型与模式发现仍由供应商自身负责。界面会将其标记为旧版，以免它看起来像推荐供应商。条件允许时，请优先使用 Codex、Claude Code、OpenCode、MiMoCode、Kimi Code、Grok Build 或 Qwen Code。

### Qwen Code

Qwen Code 是需要手动启用的 ACP 供应商。它保留供应商原生的持久会话、会话恢复和模型上下文；从当前 ACP 会话发现模型与模式；以流式方式呈现消息、工具活动和规划；并支持图片输入、供应商命令和文件授权。Grimoire 不会恢复供应商原生的消息历史。

```bash
# Linux 和 macOS：推荐的独立安装方式
curl -fsSL https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.sh | bash

# Windows PowerShell
irm https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.ps1 | iex

# 其他安装方式
brew install qwen-code
npm install -g @qwen-code/qwen-code@latest # 需要 Node.js 22+

qwen --version
qwen
```

在交互式 CLI 中运行 `/auth`，选择 `Alibaba ModelStudio`、`Third-party Providers` 或 `Custom Provider`。Qwen OAuth 已停止服务。随后在 Grimoire 中启用 Qwen Code；Grimoire 会启动 `qwen --acp`。“安全”“自动批准”和“规划”分别对应 Qwen 的 `default`、`yolo` 和 `plan` 模式。其他 Qwen 自动模式会在共用工具栏中保守地显示为“安全”。

- [Qwen Code 文档](https://qwenlm.github.io/qwen-code-docs/en/)
- [Qwen Code 身份验证](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/)
- [Qwen Code 代码仓库](https://github.com/QwenLM/qwen-code)

如果 Qwen 无法启动或没有显示模型，请在 Qwen Code 中运行 `/doctor`、完成 `/auth`、检查 `qwen --version`，并确认 Grimoire 设置中的 Qwen CLI 路径。

推理强度可选 Low、Medium、High、XHigh 和 Max，默认为 High。在普通轮次开始前，Grimoire 会实际执行 Qwen 的 `/effort <tier>` 命令，并在该会话中缓存这一设置；实际生效的级别仍取决于所选模型与供应商。Qwen 的结构化 `AskUserQuestion` 请求通过 ACP 权限元数据传入，并使用 Grimoire 共用的内联提问界面，其中包括单选、多选和自由输入。

Qwen 仍在 `~/.qwen/settings.json` 中自行管理凭据和原生配置。Grimoire 管理 `.grimoire/mcp/qwen.json` 中隔离的项目 MCP 列表，并在不改写 Qwen 原生配置的情况下将其注入 ACP 会话。只有当 Qwen 发出 ACP 令牌或费用元数据时，界面才会显示用量。Qwen 目前不支持 Grimoire 的分叉或回退控件。

### Devin

Devin CLI（Cognition）是可选启用的 ACP 供应商。Grimoire 通过 `devin acp` 启动它，从运行中的会话获取你的账户可用的模型与模式，流式呈现消息、思考过程和工具活动，在执行 shell 命令和写入文件前询问，并原生恢复会话。可用模型列表取决于你登录的账户，这由 Devin 决定，而不是 Grimoire 的限制。

```bash
# macOS, Linux, WSL
curl -fsSL https://cli.devin.ai/install.sh | bash

# Homebrew
brew install --cask devin-cli

devin auth login
devin --version
```

先用 `devin auth login`（浏览器登录）完成登录，再在 Grimoire 中启用 Devin。Safe、Auto-approve 和 Plan 分别对应 Devin 的 `accept-edits`、`bypass` 和 `plan`；Devin 的 `smart` 与 `ask` 在共享工具栏中显示为 Safe。

- [Devin CLI 文档](https://docs.devin.ai/cli)
- [Devin ACP 文档](https://docs.devin.ai/desktop/acp)

关于 Safe 模式有一点需要了解：Devin 会自行判断哪些 shell 命令属于只读并直接执行，`echo` 即使重定向写入文件也算在内。Grimoire 会为 Devin 通过协议发起的每一次文件写入征求许可，但代理绕过协议、经由自身 shell 完成的写入可能不受这道关卡约束。如果某个会话绝对不能写入，请使用 Plan。

Devin 的凭据由它自己保存在 `~/.local/share/devin/`。仓库技能从 `.devin/skills` 和 `.agents/skills` 读取，技能就是 Devin 的斜杠命令。Grimoire 在 `.grimoire/mcp/devin.json` 中维护独立的 MCP 列表并注入 ACP 会话。用量会在 Devin 报告时显示；没有推理强度控制，因为强度已包含在模型 id 中。Grimoire 的分叉与回退不适用于 Devin。


### Reasonix

Reasonix 是一个开源的多模型编程智能体，在这里是可选启用的 ACP 供应商。Grimoire 启动 `reasonix acp`，从运行中的会话读取模型与模式，流式呈现消息、思考、工具活动与计划，在需要授权的工具和文件写入前询问，并原生恢复会话。会话提供哪些模型取决于你的 Reasonix 配置中的 provider 区块；这属于 Reasonix，而不是 Grimoire 的限制。

```bash
# npm
npm i -g reasonix

# Homebrew
brew install esengine/reasonix/reasonix

reasonix setup
reasonix --version
```

运行 `reasonix setup` 配置模型供应商及其凭据，然后在 Grimoire 中启用 Reasonix。别的供应商只有一项设置的地方，Reasonix 有两项：会话模式（`normal`、`plan`、`goal`）以及单独的工具批准姿态（`ask`、`auto`、`yolo`）。Grimoire 的工具栏同时驱动两者。Safe 是会询问的 `normal`，Plan 是会询问的 `plan`，Auto-approve 是处于 `yolo` 的 `normal`；`goal` 是 Reasonix 自有的模式，显示为 Safe。 由于区分 Safe 与 Auto-approve 的只有批准姿态，无法设置该姿态的回合会被拒绝，而不是悄悄以更宽松的方式执行。

Reasonix 不只请求权限，也会提问：它的 `ask` 工具经由同一通道到达，绘制为一张卡片，描述是问题，带编号的选项是答案。请按编号选择；在有多个答案的卡片上 `Enter` 不做任何事，习惯性的按键不会替你做决定。

推理强度不是固定列表，而是由会话填充的选择器。模型接受哪些级别由服务它的供应商区块决定：声明了 `supported_efforts` 的区块提供 Disabled、Low、High 和 Max，未声明的则获得其类型的内置集合。Grimoire 读取当前会话提供的内容，并把 Auto 放在最前，它把选择权交还给 Reasonix。会话未提供的级别永远不会被发送，因为 CLI 会对照模型拒绝它。

- [Reasonix 文档](https://reasonix.io/docs/)
- [GitHub 上的 Reasonix](https://github.com/esengine/DeepSeek-Reasonix)

关于 Safe 模式有一点需要知道：`ask` 只拦截 Reasonix 判定为需要授权的工具，而不是全部工具，因此它认为只读的 shell 命令会直接执行而不询问。Grimoire 会对 Reasonix 通过协议进行的每一次文件写入进行确认，这正是让仓库处在一个问题之后的机制。如果某个会话完全不应写入，请使用 Plan。

Reasonix 的配置保存在 `~/.reasonix/config.toml`，API 密钥按该文件给出的名称从环境变量读取。仓库技能从 `.reasonix/skills` 和 `.agents/skills` 读取。Grimoire 在 `.grimoire/mcp/reasonix.json` 中维护独立的项目 MCP 列表，并注入到 ACP 会话。用量来自 Reasonix 自身的状态通知；只有当你的模型供应商有价格时才会显示费用。分叉与回退均不支持。

启用 **Image attachments as files** 后，图片通过 `.grimoire/attachments/` 中的文件传递。需要支持图片的模型和文件读取工具；读取会增加一次工具调用。文件丢失或无法写入时，发送会失败。此选项默认关闭。

### Pi

请分别安装这两个工具。适配器要求 **Node.js 22+** 和 **Pi 0.80.4+**。

1. 按照[官方说明](https://pi.dev/docs/latest)安装 Pi。macOS 和 Linux：

   ```bash
   curl -fsSL https://pi.dev/install.sh | sh
   ```

   也可以使用 npm：

   ```bash
   npm install -g --ignore-scripts @earendil-works/pi-coding-agent
   ```

2. 按照[全局安装说明](https://github.com/svkozak/pi-acp#global-install)安装适配器：

   ```bash
   npm install -g pi-acp
   ```

3. 在终端打开 Pi 设置，配置模型供应商或 API 密钥：

   ```bash
   pi-acp --terminal-login
   ```

4. 重启 Obsidian，在 **设置 → Grimoire → 供应商**中启用 **Pi**，然后点击 **Refresh all models**。`pi` 和 `pi-acp` 必须能通过 `PATH` 找到。如果自动检测失败，请在 **Adapter path** 中填写 `pi-acp` 的绝对路径；必要时在 Pi 的 **Environment variables** 中添加 `PI_ACP_PI_COMMAND=/absolute/path/to/pi`。

Grimoire 会自行启动适配器，无需配置 Zed，也无需单独运行适配器服务器。

这两个可执行文件仍是外部依赖。Grimoire 从 Pi 获取模型和推理强度，流式显示回答及工具活动，原生传递图片，并恢复已保存的会话。共用的模型选择器在刷新后保留已选模型和别名。

**推理强度限制（pi-acp 0.0.33）：** 菜单只提供适配器能实际应用于所选模型的级别。例如 Pi 为 GLM-5.3 提供 `low`、`high` 和 `max`，但适配器拒绝 `max`，因此 Grimoire 提供 `low`、`high` 和 **Pi default**。`xhigh` 不能替代 `max`。上游 [PR #73](https://github.com/svkozak/pi-acp/pull/73) 提议添加 `max`；[PR #125](https://github.com/svkozak/pi-acp/pull/125) 提议获取所选模型实际支持的级别。截至 2026-09-21，两者仍未合并，所提修复不包含在已验证的适配器版本中。

Pi 自行管理工具权限，可以不经询问就读取、写入文件或运行命令。Grimoire 会显示扩展发出的权限请求，但不提供 Safe 或 Plan 模式。MCP、技能和提示词模板在 Pi 中配置。文件从磁盘读取；适配器不提供编辑器中的未保存文本、账户配额或上下文占用率。已使用 Pi 0.86.1 和 pi-acp 0.0.33 验证。

### Command Code

Command Code 可按需启用。在终端安装并登录后，到设置 → Grimoire → 供应商中启用：

```bash
npm i -g command-code
command-code login
```

推理强度根据已安装 CLI 返回的当前模型信息确定。选择器只提供该模型支持的级别及 CLI 默认值；不支持调整强度的模型不会显示选择器。明确选择的级别通过原生会话修改 API 应用于当前运行，不改变 CLI 全局设置。CLI 默认值保留原生行为，包括恢复会话中已保存的推理强度。

Grimoire 从 CLI 的无界面 JSON 输出中流式显示回答和工具活动，通过 `--list-models` 发现模型，并保存原生会话 ID，以便重新加载后明确恢复。认证、原生配置、技能、MCP 和对话记录仍由 Command Code 管理。上下文用量将报告的输入令牌数与估算或用户指定的上下文上限比较，不推测账户配额和价格。

启用 **Image attachments as files** 后，图片通过 `.grimoire/attachments/` 中的文件传递。需要支持图片的模型和文件读取工具；读取会增加一次工具调用。文件丢失或无法写入时，发送会失败。此选项默认关闭。

**Safe** 会暂停编辑、命令及其他非只读工具，等待 Grimoire 中的一次性批准。拒绝、取消或批准连接中断均会阻止执行。目前 Safe 要求经过验证的 Command Code 1.53.0 / 1.66.0 npm 安装，并禁用原生子代理，因为其独立循环无法使用此批准机制。**Auto-approve** 不显示 Grimoire 确认提示；原生拒绝和询问规则在两种模式中仍然生效。此集成不提供交互式提问、计划控制、斜杠命令、托管的 MCP/技能/代理、辅助任务、分支、回退或原生历史导入。

- [Command Code 无界面运行文档](https://commandcode.ai/docs/headless)

### OpenCode

如果你需要一个不绑定特定模型、并自带供应商配置的代理，可以选择 OpenCode。

```bash
curl -fsSL https://opencode.ai/install | bash
opencode
```

也可以使用 Homebrew、npm、bun 或其他包管理器安装。请先在 OpenCode 中配置供应商凭据，然后在 Grimoire 中启用。

- [下载 OpenCode](https://opencode.ai/download)
- [OpenCode 供应商文档](https://opencode.ai/docs/providers)
- [OpenCode 配置文档](https://opencode.ai/docs/config)

在 Grimoire 中，OpenCode 通过 ACP 运行，使用由 Grimoire 管理的启动文件，并支持持久运行时、原生历史记录、规划模式、图片输入、供应商命令和推理强度控制。当费用元数据可用时，界面会显示月度支出。

### MiMoCode

MiMoCode（小米）是 OpenCode 的分支，具有持久记忆、智能上下文管理和子代理编排功能。

```bash
curl -fsSL https://mimo.xiaomi.com/install | bash
mimo
```

- [MiMoCode GitHub](https://github.com/XiaomiMiMo/MiMo-Code)

### Kimi Code

Kimi Code CLI（月之暗面）是一个多供应商终端代理，支持 Kimi、OpenAI、Anthropic、Gemini 和 Vertex AI 模型。

```bash
curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash
kimi
```

- [Kimi Code GitHub](https://github.com/MoonshotAI/kimi-code)

### Grok Build

若要在 Obsidian 中使用 xAI 的代理式 CLI，可选择 Grok Build。可以通过 Grok OAuth 登录，也可以使用 xAI API 密钥。

```bash
grok
```

安装 xAI 的 Grok CLI，通过 grok.com OAuth 完成身份验证或配置 API 密钥，然后在 Grimoire 中启用 Grok Build。

- [Grok Build 文档](https://docs.x.ai/build/overview)
- [Grok 4.5](https://docs.x.ai/developers/grok-4-5)
- [使用量与限制](https://docs.x.ai/grok/faq)

Grok 4.5 目前是驱动 Grok Build 的默认模型。Grimoire 从已认证的 Grok CLI 账户获取可用模型目录，而不是维护静态列表，因此模型的可用情况可能会因账户和 CLI 版本而异，也会自动更新。

在 Grimoire 中，Grok Build 通过 `grok agent stdio` 以 ACP 运行，使用 `.grimoire/grok/` 下由 Grimoire 管理的启动文件，并支持持久运行时、原生 JSONL 历史记录恢复、规划模式、图片输入、供应商命令、原生模型的推理强度、回退和分叉。使用 OAuth 时，Grimoire 会显示共享的每周 Grok 使用额度、重置时间和可用的 Extra Usage Credits；会话返回费用元数据时，还会汇总显示 API 支出。

## 第一次聊天

1. 在输入区中选择供应商和模型。
2. 设置推理强度，并在权限控件中选择“安全”“自动批准”或“规划”。
3. 提及希望纳入范围的笔记、文件夹或其他上下文。
4. 发送当前轮次。
5. 在面板中查看陆续出现的工具调用、用量和输出。

## 功能

### 聊天工作区

这是一个专注于对话的多标签页侧边栏。每个标签页都保留自己的草稿、供应商、模型、上下文和运行时。关闭并重新打开 Obsidian 后，会话会恢复；每条回答都会保留供应商、模型和推理强度信息。当前供应商支持时，界面会显示回退与分叉操作。当你滚离底部阅读内容时，自动滚动会立即停止跟随。连续 10 秒没有可见输出时，共用的等待指示器会显示当前供应商和已等待时间；等待用户回答或授权时则会暂停计时。

### 标签页、历史与导航

打开标签页操作菜单或右键点击标签页，即可重命名、复制或关闭标签页。中键点击可关闭标签页，撤销可恢复其草稿和位置。在历史浮层中搜索旧对话，并在新标签页中打开。历史会区分手动命名和自动生成的标题。对话工具栏提供跳转按钮和目录；已完成的回答显示完成时间。

<p align="center">
  <img src="../../assets/readme/conversation-history.png" alt="历史搜索显示三个 Ocean Atlas 对话、所用模型及标题来源" width="100%">
</p>

### 并行代理、设置与输入区

**Parallel workers** approval card 会显示继承的 model，并且只启动你选择的建议任务。Settings 使用 Obsidian native search，并保留永久的 What's New 入口。Provider settings 与 composer 在各 provider 间使用一致的 surface，同时保留 provider-owned controls 和 configuration。

### 键盘快捷键

| 快捷键 | 操作 |
| --- | --- |
| `Enter` | 发送当前轮次。启用**仅使用按钮发送**时，此快捷键不会发送。 |
| `Shift+Enter` | 在输入区中插入新行。 |
| `Shift+Tab` | 循环切换权限模式：`安全 → 自动批准 → 规划 → 安全`。不支持规划模式的供应商只会在“安全”和“自动批准”之间切换。 |
| `Escape` | 停止当前回答，或关闭历史浮层。 |

### 模型选择器

所有模型共用一个选择器，按供应商分组并按名称排序：Antigravity、Claude Code、Codex、Command Code、Devin、Gemini CLI（旧版）、Grok Build、Kimi Code、MiMoCode、OpenCode、Pi、Qwen Code 和 Reasonix。搜索会匹配名称、描述、分组和模型 ID，并且在筛选时不会改变菜单尺寸。模型目录按需加载，并会记住你折叠过的分组。你可以在设置中添加自定义别名和上下文窗口覆盖值。Claude 的 1M 上下文变体是额外选项，不会替代基础模型。

OpenCode、MiMoCode、Kimi Code、Grok Build、Command Code 和 Pi 在设置中使用同一个模型选择器：带别名的已选行、可搜索的目录和 **Refresh all models**。刷新会保留选择和别名；CLI 提供供应商名称时还会显示供应商筛选器。

### 用量与费用

模型选择器旁的徽标会持续显示当前供应商的用量；模型菜单中会提供更完整的数据：供应商返回额度周期时显示额度，只返回费用时则显示支出。刷新过程中或刷新失败时，界面会保留上一次成功获取的数值，不会让用量指示器突然清空。如果希望界面更简洁，可以在设置中关闭全部用量与费用显示。

| 供应商 | 用量来源 |
| --- | --- |
| Codex | 账户速率限制通知，以及可用时的 `account/rateLimits/read` |
| Claude Code | SDK 速率限制事件、可选的 `.grimoire/claude/statusline-usage.json`，以及 SDK 返回的费用元数据 |
| Antigravity CLI | `agy --print` 目前还不能可靠提供 |
| Gemini CLI（旧版） | Gemini CLI 返回的 ACP 费用元数据；仅用于旧版兼容 |
| Qwen Code | Qwen Code 返回的 ACP 令牌与费用元数据 |
| Devin | ACP 报告的会话积分总额，按月度支出显示 |
| Reasonix | 来自其自有状态通知的单轮费用，前提是所配置的模型供应商有价格 |
| Pi | pi-acp 适配器未提供 |
| OpenCode | 从 ACP 与会话费用元数据汇总的月度支出 |
| MiMoCode | 从 ACP 与会话费用元数据汇总的月度支出 |
| Kimi Code | 从 ACP 与会话费用元数据汇总的月度支出 |
| Grok Build | 通过 OAuth 获取的每周共享额度、重置时间和 Extra Usage Credits；以及从会话费用元数据汇总的月度 API 支出 |

### 计划模式

当前供应商支持规划模式时，可以通过两种方式开启：

- 点击输入区中的权限控件，直到它切换到“规划”：`安全 → 自动批准 → 规划`。
- 按 `Shift+Tab` 循环切换完整序列：`安全 → 自动批准 → 规划 → 安全`。

规划模式会要求供应商先制定计划，再开始进行更改。它与“安全”和“自动批准”共用输入区中的权限控件，因此当前模式始终清晰可见。

供应商完成计划后，Grimoire 会显示可折叠的“计划完成”卡片，其中包含渲染后的计划、请求的权限以及便于键盘操作的选项行。批准后会在同一会话中继续；输入反馈则会保持规划模式，让供应商修改计划。

### 上下文与提及

可以直接在输入区通过 `@` 提及仓库中的笔记和文件夹，引入当前笔记或链接笔记，也可以在设置中添加持久的外部上下文路径。供应商支持图片输入时，可以粘贴或拖放图片；受支持的集成还可以提及 MCP 服务器。“上下文”标签页会显示绑定笔记、模型、权限模式、固定文件、`.grimoire/grok/system.md` 等启动文件，以及代理在会话期间读取的文件。

### 笔记内编辑

对选中文本运行“Grimoire：内联编辑”。提示框会在文本旁打开，修改结果以差异对比形式返回，你可以接受或拒绝。该功能通过由供应商支持的内联编辑服务执行，既能替换选区，也能插入新文本。

### 澄清问题

当供应商请求结构化用户输入时，Grimoire 会暂停当前轮次，并在输入区上方显示问题。Claude Code 使用 `AskUserQuestion`；Codex app-server 使用实验性的 `request_user_input` / `requestUserInput` 接口；Qwen Code 则通过 ACP 权限元数据传递 `AskUserQuestion`。Grimoire 会将这些供应商特有机制统一为同一套内联提问界面。单选、多选和自由输入的答案会返回供应商的当前运行流程，让代理无需另发一条聊天消息即可继续。

如果问题遮住了你需要重新查看的聊天内容，可以使用问题标题中的折叠箭头，将其收起为紧凑栏。你已经选择或自由输入的答案会保留，直到再次展开或提交问题。

### 命令

内置命令用于执行 Grimoire 工作流，例如生成图片和恢复会话。供应商提供的自有命令，例如 Claude Code 斜杠命令，以及 OpenCode、Grok Build 和 Qwen Code 的运行时命令，会通过各供应商自己的命令目录显示。你可以在设置中隐藏不使用的命令，使其不再出现在下拉菜单中。

### 图片生成

粘贴或拖放图片即可将其附加到当前轮次。内置的 `/image [提示词]` 命令本身不会调用图片 API，而是向当前供应商发送一个普通轮次，要求其使用你已经配置的图片生成能力，例如供应商原生工具、MCP 工具或本地命令。代理会将结果保存到仓库，并返回类似 `![[path/to/image.png]]` 的嵌入链接。如果尚未配置图片生成能力，你只会得到一条说明缺少哪些组件的普通回复。

### 安全与权限

权限模式由各供应商定义，Grimoire 只通过共用的输入区控件呈现，不会另行实现一套权限系统。当前供应商支持规划模式时，权限控件和 `Shift+Tab` 都会在“安全”“自动批准”和“规划”之间循环。安全模式和授权提示在工作期间始终可见。只有已启用的供应商支持时，Bang-bash 模式（`!`）才会出现。应将已配置的 MCP 服务器、Shell 访问权限和 API 密钥视为敏感信息，因为它们确实敏感。

### 调试日志

默认关闭。启用后，Grimoire 会将经过清理的 JSONL 日志写入 `.grimoire/logs/YYYY-MM-DD.jsonl`。提示词、回答、笔记内容、路径、环境变量值和密钥都会被遮蔽。该日志只用于诊断供应商和运行时问题，不用于保存对话记录。

### 设置

设置分为四个标签页：**常规**管理语言、聊天位置、标签页和显示；**供应商**用于启用 CLI 和配置模型；**高级设置**管理上下文、对话、工具与诊断；**关于**显示版本及更新内容。设置支持 Obsidian 原生搜索。

供应商概览显示 CLI 检测结果和启用开关，下方展示所选供应商的设置。

<p align="center">
  <img src="../../assets/readme/settings-providers.png" alt="Grimoire 的十二种 CLI 集成概览及 Codex 模型设置" width="100%">
</p>

<details>
<summary>通用设置</summary>

<p align="center">
  <img src="../../assets/readme/settings-general.png" alt="语言、面板位置、聊天标签页、标签、滚动及对话标题的通用设置" width="100%">
</p>

</details>

## Grimoire 将数据存放在哪里

| 路径 | 内容 |
| --- | --- |
| `.grimoire/grimoire-settings.json` | 应用设置与供应商配置 |
| `.grimoire/sessions/*.meta.json` | 会话元数据 |
| `.grimoire/logs/YYYY-MM-DD.jsonl` | 可选启用且经过脱敏的调试日志 |
| `.grimoire/claude/statusline-usage.json` | 用于套餐用量指示器的 Claude 用量快照 |
| `.grimoire/grok/` | Grok Build 启动文件、托管配置和会话指针 |

Grimoire 会原地读写 `.claude/`、`.codex/`、`.opencode/` 和 `.grimoire/grok/` 中的供应商原生文件，因此这些供应商配置在离开 Grimoire 后仍可继续使用。

## 隐私

Grimoire 在你的电脑上、Obsidian 内部运行。它没有后端服务，不添加遥测，也不会把提示词、回答、笔记、文件、工具输出、API 密钥或用量日志上传到任何 Grimoire 服务。它唯一会写入的是上文所述、需要手动启用且经过清理的调试日志，这些日志始终留在你的仓库中。

它无法隐藏的是供应商本身。你启用的 CLI 会收到提示词、所选上下文，以及请求所需的文件、图片、工具输出和命令。该 CLI 可能访问 Anthropic、OpenAI、Google、你配置的 OpenCode 服务商、MCP 服务器，或其他已配置目标。服务条款、数据保留、计费、速率限制和隐私政策均由相应供应商制定，而不是 Grimoire。Grimoire 的职责是在 Obsidian 中明确展示这条边界，并让你掌握控制权。

如需了解面向 Obsidian 政策的网络使用、账户要求、外部文件访问、日志记录和遥测的摘要，请参阅 [DISCLOSURES.md](../../DISCLOSURES.md)。

## 开发

欢迎贡献。提交 Pull Request 之前，请先阅读 [CONTRIBUTING.md](../../CONTRIBUTING.md)；其中说明了供应商职责归属、安全边界、测试、生成产物和仓库的审查要求。

欢迎 contributions。打开 pull request 前请阅读 [CONTRIBUTING.md](../../CONTRIBUTING.md)，其中说明 architecture、security、tests 和 review 的要求。

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run test
npm run build
npm run build:release
```

在发布或推送重要的界面/供应商变更之前，请运行完整的本地检查：

```bash
npm run test -- --selectProjects unit
npm run typecheck
npm run lint
npm run build:release
```

`npm run build:release` 会刷新生成的 `main.js`、根目录下的`styles.css` 和 `dist/grimoire`。

npm 是开发、CI 和发布流程的规范包管理器。依赖发生变化时，请同步更新 `package-lock.json`；次要的包管理器的锁文件特意不提交。

## 发布版本

Grimoire 使用语义化版本标签发布，例如 `1.0.0`。发布流程会运行本地检查、构建 Obsidian 插件包、验证标签与 `package.json` 和 `manifest.json` 一致，然后将 `main.js`、`manifest.json` 和 `styles.css` 附加到 GitHub Release。

Obsidian 社区插件市场是推荐的安装方式。GitHub Releases 仍会提供用于手动安装和 BRAT 的插件文件。可发布的开发工作在 `main` 分支进行，发布标签必须与清单中的版本号一致。

## 开发计划

目前 Grimoire 随 Codex、Claude Code、Antigravity CLI、Gemini CLI（旧版）、OpenCode、MiMoCode、Kimi Code、Grok Build、Qwen Code、Devin、Pi、Reasonix 和 Command Code 一同发布。

下一步计划包括 GitHub Copilot CLI、其他 ACP 兼容供应商，以及运行时足够稳定、可嵌入 Obsidian 的本地模型 CLI。实现说明位于 [provider-roadmap.md](../provider-roadmap.md)。

## 许可证

MIT。参见 [LICENSE](../../LICENSE)。
