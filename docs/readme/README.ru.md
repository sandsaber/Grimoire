# Grimoire · Гримуар

<p align="center">
  <img src="../../assets/readme/grimoire-logo.png" alt="Логотип Grimoire" width="240">
</p>

<p align="center">
  <strong>Локальные AI-агенты для вашего Obsidian vault.</strong>
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="Лицензия: MIT">
  <img src="https://img.shields.io/github/v/release/sandsaber/Grimoire?label=release" alt="Последний релиз">
  <img src="https://img.shields.io/badge/Obsidian-1.13.0%2B-7c3aed" alt="Obsidian 1.13.0+">
  <img src="https://img.shields.io/badge/platform-desktop-lightgrey" alt="Только desktop">
</p>

<p align="center">
  <img src="../../assets/readme/chat-workspace.png" alt="Ocean Atlas в Obsidian рядом с чатом Codex Astra High о слоях океана, течениях и морской жизни" width="100%">
</p>

<p align="center">
  <sub>Настоящая заметка и диалог, опирающийся на её ссылки.</sub>
</p>

Grimoire встраивает agentic CLI-ассистентов в Obsidian. Codex, Claude Code, Antigravity CLI, Gemini CLI (Legacy), OpenCode, MiMoCode, Kimi Code, Grok Build, Qwen Code, Devin, Pi, Reasonix и Command Code живут в одной боковой панели: читают заметки, редактируют файлы, запускают команды, вызывают инструменты и сохраняют историю сессий рядом с вашим настоящим vault. Всё работает без сервера Grimoire: нет telemetry, hosted backend и proxy между вами и провайдером.

Grimoire сделан для тех, кто уже работает в Obsidian и хочет, чтобы AI-помощник ощущался частью vault: локальный контекст, локальные файлы, осознанный выбор провайдера и usage/cost прямо в интерфейсе.

> Английский [README](../../README.md) остаётся canonical-документом проекта. Этот перевод поддерживается вместе с актуальной документацией продукта.

## Зачем Grimoire

- Используйте CLI-агентов, которым уже доверяете, прямо внутри заметок.
- Переключайте провайдеров из composer. Codex, Claude Code, Antigravity CLI, Gemini CLI (Legacy), OpenCode, MiMoCode, Kimi Code, Grok Build, Qwen Code, Devin, Pi, Reasonix и Command Code используют один model picker.
- Привязывайте каждый turn к vault-контексту. Упоминайте заметки, папки и MCP tools без ручного копирования путей.
- Видьте cost и limits рядом с выбором модели, именно там, где принимается решение.
- Оставайтесь local-first. Grimoire не собирает telemetry, не проксирует prompts и не запускает backend.

## Что умеют провайдеры

| Возможность | Codex | Claude Code | OpenCode | Grok Build | MiMoCode | Kimi Code | Antigravity CLI | Gemini CLI (Legacy) | Qwen Code | Devin | Reasonix | Command Code | Pi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Локальная постоянная среда выполнения | Да | Да | Да | Да | Да | Да | Нет | Да | Да | Да | Да | Нет | Да |
| Восстановление нативной истории | Да | Да | Да | Да | Да | Да | Нет | Да | Нет | Нет | Нет | Нет | Да |
| Режим планирования | Да | Да | Да | Да | Да | Да | Нет | Да | Да | Да | Да | Нет | Нет |
| Вложения изображений | Да | Да | Да | Нет | Да | Да | Файлы | Да | Да | Да | Файлы (по выбору) | Файлы (по выбору) | Да |
| Режим инструкций | Да | Да | Да | Да | Да | Да | Нет | Да | Да | Да | Да | Нет | Нет |
| Настройка глубины рассуждений | Да | Да | Да | Да | Да | Да | Да | Да | Да | Нет | Да | Да (зависит от модели) | Да (зависит от модели) |
| Откат | Нет | Да | Нет | Да | Нет | Нет | Нет | Нет | Нет | Нет | Нет | Нет | Нет |
| Ветвление | Да | Да | Нет | Да | Нет | Нет | Нет | Нет | Нет | Нет | Нет | Нет | Нет |
| Slash-команды провайдера | Нет | Да | Да | Да | Да | Да | Нет | Да | Да | Да | Да | Нет | Да |
| Управление MCP через Grimoire | Нет | Да | Да | Да | Да | Да | Нет | Да | Да | Да | Да | Нет | Нет |

## Установка

Grimoire — desktop plugin. Он запускает provider CLIs локально, поэтому mobile build нет.

### Через Community plugins (рекомендуется)

Установите Grimoire из каталога community plugins Obsidian:

1. Откройте Settings, перейдите в Community plugins и выключите Restricted mode, если он включён.
2. Нажмите Browse, найдите Grimoire и установите его.
3. Включите Grimoire, затем откройте панель через ribbon или command palette.

### Через GitHub Releases

Если Community plugins недоступны, установите текущий релиз вручную:

1. Скачайте `main.js`, `manifest.json` и `styles.css` из последнего [релиза Grimoire](https://github.com/sandsaber/Grimoire/releases/latest).
2. Создайте папку `/path/to/your/vault/.obsidian/plugins/grimoire`.
3. Положите все три файла в эту папку.
4. Включите Grimoire в Settings, Community plugins.

### Через BRAT

BRAT может установить Grimoire из GitHub Releases, если вы хотите отслеживать tagged builds вне каталога community plugins:

1. Установите плагин "Obsidian42 - BRAT".
2. В BRAT добавьте beta plugin из `sandsaber/Grimoire`.
3. Включите Grimoire.

### Из исходников

Соберите release bundle и положите его в ваш vault:

```bash
npm install
npm run build:release

mkdir -p /path/to/your/vault/.obsidian/plugins/grimoire
cp dist/grimoire/main.js dist/grimoire/manifest.json dist/grimoire/styles.css \
  /path/to/your/vault/.obsidian/plugins/grimoire/
```

После этого включите Grimoire в Settings, Community plugins.

Какой бы способ установки вы ни выбрали, сначала установите хотя бы один CLI provider. Grimoire оборачивает provider CLIs, но не заменяет их account setup, model access, quotas или terms.

## Настройка провайдера

Включите нужных провайдеров в Settings, Grimoire, Providers, и они появятся в model selector. Codex включён при первом запуске; остальные провайдеры opt-in.

### Рекомендуемые провайдеры

Для лучшего опыта в Grimoire начните с Codex, Claude Code, OpenCode, MiMoCode, Kimi Code, Grok Build или Qwen Code. Сейчас эти провайдеры дают самый сильный runtime surface для vault-native работы: persistent sessions, plan-oriented workflows, tool activity и богатые model controls.

Antigravity CLI и Gemini CLI (Legacy) остаются доступными для Google accounts и compatibility-сценариев, но сегодня мы не рекомендуем их как основные провайдеры Grimoire. Grimoire поддерживает их в режиме best-effort, и мы реализовали все fallback'и, которые позволяют текущие CLI, но их ACP и runtime surfaces технически ограничены: sessions, approvals, streaming, tool/edit metadata, model discovery и usage reporting неполные или ненадежные по сравнению с рекомендуемыми провайдерами.

### Codex

Codex — provider по умолчанию при первом запуске. Выбирайте его для OpenAI Codex в локальном CLI, авторизованном через ChatGPT plan или API key.

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex
```

Запустите Codex один раз, войдите в аккаунт, затем включите в Grimoire. Standalone installer теперь основной путь установки; Windows, Homebrew и fallback package-manager options описаны в официальной Codex CLI документации.

- [Codex CLI setup](https://developers.openai.com/codex/cli)
- [OpenAI code generation guide](https://developers.openai.com/api/docs/guides/code-generation)

Внутри Grimoire Codex работает по app-server protocol с native history, fork, plan mode, image input и reasoning effort controls. Plan usage появляется, когда Codex сообщает rate-limit metadata.

### Claude Code

Выбирайте Claude Code, если вам нужны native project memory, slash commands, MCP configuration, plans, rewind/fork и работа через Claude subscription или API key.

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude
```

Авторизуйтесь через Claude Code, затем включите его в Grimoire. Старый npm package deprecated; используйте native installer выше, Homebrew (`brew install --cask claude-code`), WinGet или другие варианты из official quickstart.

- [Claude Code quickstart](https://code.claude.com/docs/en/quickstart)

Внутри Grimoire Claude Code читает и сохраняет ваши `.claude/` файлы, работает на Claude Code SDK и поддерживает slash commands, MCP settings, agents, skills, plans, rewind и fork. Если Claude отдаёт оба типа данных, вы увидите quota windows и API spend рядом.

**Respect Claude Code settings** включён по умолчанию. Grimoire читает Claude Code user settings (`~/.claude/settings.json`) и vault settings (`.claude/settings.json`) для `model` и `env`, а затем использует эти значения в Claude model selector и runtime environment. Это позволяет использовать в Grimoire кастомные Claude Code модели через Anthropic-compatible gateways, например MiniMax, Z.ai и другие. Project settings перекрывают user settings, а явные Grimoire environment settings перекрывают оба источника.

Если в эффективном Claude environment есть `ANTHROPIC_API_KEY`, Grimoire может обновить Anthropic model catalog и добавить найденные модели в picker. Без API key или при неудачном refresh picker продолжает работать через Claude Code aliases вроде `Best`, `Fable 5`, `Opus Plan` и 1M variants, плюс модели из `.claude` и custom Grimoire settings.

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

Antigravity CLI — замена Google для consumer-сценариев Gemini CLI, с доступом к Gemini, Claude, GPT-OSS и другим семействам моделей вашего Antigravity account. Внутри Grimoire относитесь к нему как к compatibility provider, а не как к рекомендуемому варианту по умолчанию.

```bash
agy
```

Установите официальный Antigravity CLI от Google, авторизуйтесь локально, затем включите Antigravity в Grimoire. Grimoire автоматически находит `agy` в PATH, но в provider settings можно указать custom CLI path.

- [Antigravity CLI](https://antigravity.google/product/antigravity-cli)
- [Gemini CLI migration guide](https://goo.gle/gemini-cli-migration)

Внутри Grimoire Antigravity работает через `agy --print`, с optional model selection из `agy models`; Grimoire добавляет в print prompt активную заметку, editor/browser/canvas context, vault search и project workspace context. Это best-effort integration, потому что `agy` пока не предоставляет Grimoire сильный ACP-compatible runtime. Persistent sessions, native history, plan mode, streaming, approval-safe file edits, reliable usage reporting и auxiliary workflows остаются выключенными или ограниченными, пока Antigravity не предоставит стабильные runtime surfaces. Изображения передаются как временные файлы; в последующих сообщениях их нужно прикреплять заново.

`agy --print` не предоставляет Grimoire hooks для подтверждения file edits. Поэтому ради безопасности Antigravity в общем Safe/normal mode заблокирован в Grimoire; переключайте Antigravity toolbar в Auto-approve только если готовы, что AGY может редактировать файлы без Grimoire prompts.

Windows note: current Windows `agy` builds can finish successfully while returning empty stdout for `agy models` and `agy --print`. Grimoire uses best-effort recovery from Antigravity logs, transcripts, settings, and a seeded Pro AI model list, but Windows Antigravity support may be less reliable than macOS or Linux. If your account shows additional models in Antigravity, add their exact labels under Antigravity settings > Custom models.

### Gemini CLI (Legacy)

Gemini CLI остается legacy compatibility provider для Gemini Code Assist Standard, Enterprise, Google Cloud и paid API-key users, где Google продолжает обслуживать Gemini CLI requests. Мы не рекомендуем его для новых Grimoire setups: его ACP support слабый, и несколько Grimoire workflows нельзя надежно реализовать поверх него. Consumer Google AI Pro, Ultra и free-tier accounts после June 18, 2026 должны использовать Antigravity, учитывая ограничения Antigravity выше.

```bash
gemini
```

Включайте Gemini CLI только если ваш account tier еще поддерживается и вам нужен именно этот legacy Google path. Grimoire запускает его через `gemini --acp`, добавляет в ACP prompt активную заметку, editor/browser/canvas selection, vault search и project workspace context, и помечает как legacy, чтобы он не выглядел рекомендуемым provider. По возможности используйте Codex, Claude Code, OpenCode, MiMoCode, Kimi Code, Grok Build или Qwen Code.

### Qwen Code

Qwen Code — opt-in ACP provider с provider-native persistent sessions, resume и model context, live model/mode discovery, streaming messages, tools и plans, image input, provider commands и file approvals. Grimoire не восстанавливает provider-native message history.

```bash
# Linux и macOS: рекомендуемый standalone installer
curl -fsSL https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.sh | bash

# Windows PowerShell
irm https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.ps1 | iex

# Альтернативы
brew install qwen-code
npm install -g @qwen-code/qwen-code@latest # Node.js 22+
qwen --version
qwen
```

В интерактивном CLI выполните `/auth` и выберите Alibaba ModelStudio, Third-party Providers или Custom Provider; Qwen OAuth прекращён. Затем включите Qwen Code в Grimoire: он запускает `qwen --acp`. Safe, Auto-approve и Plan соответствуют Qwen `default`, `yolo` и `plan`; другие automatic modes в shared toolbar консервативно показаны как Safe. Модели и modes приходят из live ACP session.

- [Документация Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/)
- [Авторизация Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/)
- [Qwen Code repository](https://github.com/QwenLM/qwen-code)

Если Qwen не запускается или модели не появились, выполните `/doctor` внутри Qwen Code, завершите `/auth`, проверьте `qwen --version` и путь к Qwen CLI в настройках Grimoire.

Доступны reasoning effort Low, Medium, High, XHigh и Max; по умолчанию High. Перед normal turn Grimoire посылает реальную команду Qwen `/effort <tier>` и кэширует применённый tier в session; effective tier зависит от выбранной model/provider. Structured `AskUserQuestion` приходит через ACP permission metadata и открывается в shared inline question UI с single-select, multi-select и freeform answers.

Credentials и нативный config принадлежат Qwen: используйте CLI, `~/.qwen/settings.json` или Qwen-owned `.env`/environment. Grimoire управляет отдельным project MCP-списком в `.grimoire/mcp/qwen.json` и передаёт его в ACP sessions, не перезаписывая нативный config Qwen. Usage появляется только если Qwen отдаёт ACP token/cost metadata. Qwen пока не поддерживает Grimoire fork и rewind.

### Devin

Devin CLI (Cognition) — opt-in ACP-провайдер. Grimoire запускает `devin acp`, узнаёт доступные модели и режимы из живой сессии, стримит сообщения, размышления и работу инструментов, спрашивает перед shell-командами и записью файлов и возобновляет сессии нативно. Список моделей зависит от аккаунта, под которым вы вошли: так устроен Devin, это не ограничение Grimoire.

```bash
# macOS, Linux, WSL
curl -fsSL https://cli.devin.ai/install.sh | bash

# Homebrew
brew install --cask devin-cli

devin auth login
devin --version
```

Войдите через `devin auth login` (открывается браузер) и включите Devin в настройках Grimoire. Safe, Auto-approve и Plan соответствуют режимам Devin `accept-edits`, `bypass` и `plan`; режимы `smart` и `ask` показываются в общем тулбаре как Safe.

- [Документация Devin CLI](https://docs.devin.ai/cli)
- [Документация Devin ACP](https://docs.devin.ai/desktop/acp)

Про режим Safe стоит знать одно. Devin сам решает, какие shell-команды считать read-only, и такие запускает без вопроса, а `echo` считается read-only даже с перенаправлением в файл. Grimoire спрашивает про каждую запись файла, которую Devin делает по протоколу, но запись, которую агент провёл через собственный shell, может пройти мимо этой проверки. Если сессия не должна писать вообще ничего, используйте Plan.

Devin хранит свои учётные данные в `~/.local/share/devin/`. Навыки vault читаются из `.devin/skills` и `.agents/skills`, и навык у Devin и есть слеш-команда. Grimoire ведёт отдельный список MCP в `.grimoire/mcp/devin.json` и передаёт его в ACP-сессию. Расход показывается, когда Devin его сообщает. Управления reasoning effort нет: усилие входит в идентификатор модели. Fork и rewind Grimoire для Devin не поддерживает.


### Reasonix

Reasonix — открытый мультимодельный агент программирования и здесь opt-in ACP-провайдер. Grimoire запускает `reasonix acp`, читает модели и режимы из живой сессии, стримит сообщения, размышления, работу инструментов и планы, спрашивает перед инструментами, требующими разрешения, и записью файлов и возобновляет сессии нативно. Какие модели предлагает сессия, зависит от provider-блоков в вашей конфигурации Reasonix: так устроен Reasonix, это не ограничение Grimoire.

```bash
# npm
npm i -g reasonix

# Homebrew
brew install esengine/reasonix/reasonix

reasonix setup
reasonix --version
```

Выполните `reasonix setup`, чтобы настроить провайдера моделей и его учётные данные, и включите Reasonix в настройках Grimoire. Reasonix хранит две настройки там, где у других провайдеров одна: режим сессии (`normal`, `plan`, `goal`) и отдельную позицию по одобрению инструментов (`ask`, `auto`, `yolo`). Тулбар Grimoire управляет обеими. Safe — это `normal` со спросом, Plan — это `plan` со спросом, Auto-approve — это `normal` в режиме `yolo`; `goal` принадлежит самому Reasonix и показывается как Safe. Поскольку Safe от Auto-approve отделяет только позиция одобрения, ход, который не смог её установить, отклоняется, а не выполняется молча в более свободной.

Reasonix ещё и задаёт вопросы, а не только просит разрешений: инструмент `ask` приходит по тому же каналу и рисуется карточкой, где описание это вопрос, а пронумерованные варианты это ответы. Выбирайте по номеру: `Enter` на карточке с несколькими ответами не делает ничего, чтобы привычное нажатие не выбрало за вас.

Reasoning effort это не фиксированный список, а пикер, который наполняет сессия. Какие уровни принимает модель, решает обслуживающий её блок провайдера: объявивший `supported_efforts` даёт Disabled, Low, High и Max, а блок без него получает встроенный набор для своего вида. Grimoire читает то, что предложила открытая сессия, и ставит в голову Auto, который оставляет выбор самому Reasonix. Уровень, которого сессия не предлагала, не отправляется никогда: CLI отклонит его на соответствии модели.

- [Документация Reasonix](https://reasonix.io/docs/)
- [Reasonix на GitHub](https://github.com/esengine/DeepSeek-Reasonix)

Про режим Safe стоит знать одно. `ask` закрывает те инструменты, которые Reasonix относит к требующим разрешения, а не все: shell-команда, признанная read-only, выполняется без вопроса. Grimoire спрашивает про каждую запись файла, которую Reasonix делает по протоколу, и именно это держит vault за вопросом. Если сессия не должна писать вообще ничего, используйте Plan.

Reasonix хранит конфигурацию в `~/.reasonix/config.toml` и читает API-ключи из окружения под именами, которые указаны в этом файле. Навыки vault читаются из `.reasonix/skills` и `.agents/skills`. Grimoire ведёт отдельный список MCP в `.grimoire/mcp/reasonix.json` и передаёт его в ACP-сессию. Расход берётся из собственных status-уведомлений Reasonix, а стоимость появляется, только если у вашего провайдера моделей есть цена. Fork и rewind не поддерживаются.

Включите **Image attachments as files**, чтобы передавать изображения через файлы в `.grimoire/attachments/`. Нужны модель с поддержкой изображений и инструмент чтения файлов; чтение требует дополнительного вызова инструмента. Если файл отсутствует или его нельзя записать, отправка завершается ошибкой. По умолчанию эта возможность выключена.

### Pi

Установите оба инструмента отдельно. Адаптеру нужны **Node.js 22+** и **Pi 0.80.4+**.

1. Установите Pi по [официальной инструкции](https://pi.dev/docs/latest). Для macOS и Linux:

   ```bash
   curl -fsSL https://pi.dev/install.sh | sh
   ```

   Другой способ — через npm:

   ```bash
   npm install -g --ignore-scripts @earendil-works/pi-coding-agent
   ```

2. Установите адаптер по [инструкции глобальной установки](https://github.com/svkozak/pi-acp#global-install):

   ```bash
   npm install -g pi-acp
   ```

3. Откройте настройку Pi в терминале и настройте провайдера моделей или API-ключи:

   ```bash
   pi-acp --terminal-login
   ```

4. Перезапустите Obsidian, включите **Pi** в **Настройки → Grimoire → Провайдеры** и нажмите **Refresh all models**. Команды `pi` и `pi-acp` должны быть доступны в `PATH`. Если они не обнаружены, укажите абсолютный путь к `pi-acp` в **Adapter path**, а при необходимости добавьте `PI_ACP_PI_COMMAND=/absolute/path/to/pi` в **Environment variables** настроек Pi.

Grimoire сам запускает адаптер; настройка Zed или отдельный сервер адаптера не нужны.

Оба исполняемых файла остаются внешними зависимостями. Grimoire получает модели и уровни рассуждений из Pi, отображает поток ответов и действий инструментов, передаёт изображения нативно и возобновляет сохранённые сессии. Общий список моделей сохраняет выбранные модели и их псевдонимы при обновлении.

**Ограничение уровней рассуждений (pi-acp 0.0.33):** меню предлагает только уровни, которые адаптер действительно применяет к выбранной модели. Например, Pi поддерживает `low`, `high` и `max` для GLM-5.3, но адаптер отклоняет `max`, поэтому в Grimoire доступны `low`, `high` и **Pi default**. `xhigh` не заменяет `max`. В upstream [PR #73](https://github.com/svkozak/pi-acp/pull/73) предлагается добавить `max`, а [PR #125](https://github.com/svkozak/pi-acp/pull/125) — получать реальные уровни выбранной модели. На 2026-09-21 оба PR открыты и не слиты; предложенные исправления не входят в проверенный релиз адаптера.

Разрешениями инструментов управляет Pi: он может читать, записывать файлы и выполнять команды без запроса. Grimoire показывает запросы разрешений от расширений, но не предлагает режимы Safe или Plan. MCP, навыки и шаблоны запросов настраиваются в Pi. Файлы читаются с диска; адаптер не предоставляет несохранённый текст редактора, квоты аккаунта и заполнение контекста. Проверено с Pi 0.86.1 и pi-acp 0.0.33.

### Command Code

Command Code включается отдельно. Установите его и войдите в аккаунт через терминал, затем включите в Настройки → Grimoire → Провайдеры:

```bash
npm i -g command-code
command-code login
```

Уровни reasoning effort определяются установленным CLI для выбранной модели. Список содержит только поддерживаемые уровни и вариант по умолчанию CLI; у моделей без такой настройки список отсутствует. Явный выбор применяется к текущему запуску через нативный API изменения сессии, не меняя глобальные настройки CLI. Вариант по умолчанию сохраняет нативное поведение, включая уровень, уже записанный в возобновляемой сессии.

Grimoire отображает поток ответов и действий инструментов из JSON-вывода CLI без интерфейса, получает модели через `--list-models` и сохраняет нативный ID сессии для явного возобновления после перезагрузки. Авторизация, конфигурация, навыки, MCP и журналы диалогов остаются у Command Code. Заполнение контекста рассчитывается по сообщённым входным токенам относительно оценочного или заданного пользователем лимита; квоты аккаунта и цены не вычисляются предположительно.

Включите **Image attachments as files**, чтобы передавать изображения через файлы в `.grimoire/attachments/`. Нужны модель с поддержкой изображений и инструмент чтения файлов; чтение требует дополнительного вызова инструмента. Если файл отсутствует или его нельзя записать, отправка завершается ошибкой. По умолчанию эта возможность выключена.

**Safe** приостанавливает правки, команды и другие инструменты, не ограниченные чтением, до разового разрешения в Grimoire. Отказ, отмена или потеря соединения с механизмом разрешений предотвращают выполнение. Сейчас Safe требует проверенную npm-установку Command Code 1.53.0 / 1.66.0 и отключает нативных субагентов: их отдельные циклы не могут использовать этот механизм. **Auto-approve** работает без запросов Grimoire; нативные правила запрета и подтверждения действуют в обоих режимах. Интеграция не предоставляет интерактивные вопросы, управление планом, slash-команды, управляемые MCP/навыки/агентов, вспомогательные задачи, ветвление, откат и импорт нативной истории.

- [Документация Command Code о режиме без интерфейса](https://commandcode.ai/docs/headless)

### OpenCode

Выбирайте OpenCode, если нужен model-agnostic agent со своей provider configuration.

```bash
curl -fsSL https://opencode.ai/install | bash
opencode
```

Homebrew, npm, bun и package-manager installs тоже подходят. Настройте provider credentials в OpenCode, затем включите его в Grimoire.

- [Скачать OpenCode](https://opencode.ai/download)
- [Провайдеры OpenCode](https://opencode.ai/docs/providers)
- [OpenCode config docs](https://opencode.ai/docs/config)

Внутри Grimoire OpenCode работает через ACP с Grimoire-managed launch artifacts, persistent runtime, native history, plan mode, image input, provider commands и reasoning effort. Он показывает monthly spend, когда cost metadata доступна.

### MiMoCode

MiMoCode (Xiaomi) — форк OpenCode с персистентной памятью, интеллектуальным управлением контекстом и оркестрацией субагентов.

```bash
curl -fsSL https://mimo.xiaomi.com/install | bash
mimo
```

Homebrew, npm, bun и package-manager installs тоже подходят. Настройте provider credentials в MiMoCode, затем включите его в Grimoire.

- [MiMoCode GitHub](https://github.com/XiaomiMiMo/MiMo-Code)

Внутри Grimoire MiMoCode работает через ACP с persistent runtime, native history, plan mode, image input, provider commands и reasoning effort.

### Kimi Code

Kimi Code CLI (MoonshotAI) — мульти-провайдерный терминальный агент, поддерживающий модели Kimi, OpenAI, Anthropic, Gemini и Vertex AI.

```bash
curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash
kimi
```

Настройте provider credentials в Kimi Code, затем включите его в Grimoire.

- [Kimi Code GitHub](https://github.com/MoonshotAI/kimi-code)

Внутри Grimoire Kimi Code работает через ACP с persistent runtime, native history, plan mode, image input, provider commands и reasoning effort.

### Grok Build

Выбирайте Grok Build для agentic CLI от xAI в Obsidian. Авторизуйтесь через Grok OAuth или используйте API-ключ xAI.

```bash
grok
```

Установите Grok CLI от xAI, авторизуйтесь через grok.com OAuth или настройте API keys, затем включите Grok Build в Grimoire.

- [Документация Grok Build](https://docs.x.ai/build/overview)
- [Grok 4.5](https://docs.x.ai/developers/grok-4-5)
- [Использование и лимиты](https://docs.x.ai/grok/faq)

Сейчас Grok 4.5 — модель по умолчанию, на которой работает Grok Build. Grimoire получает доступный каталог моделей из авторизованного Grok CLI, а не из статического списка, поэтому набор моделей может зависеть от аккаунта и версии CLI и обновляться автоматически.

Внутри Grimoire Grok Build работает через ACP via `grok agent stdio` с Grimoire-managed launch artifacts в `.grimoire/grok/`, persistent runtime, native JSONL history hydration, plan mode, image input, provider commands, reasoning effort на native models, rewind и fork. При OAuth-авторизации Grimoire показывает общий недельный лимит Grok, время сброса и Extra Usage Credits, когда они доступны; API spend агрегируется из session cost metadata, когда доступна.

## Первый чат

1. Выберите provider и model в composer.
2. Настройте reasoning effort и выберите Safe, Auto-approve или Plan в permission control.
3. Упомяните заметки, папки или другой context, который должен быть в scope.
4. Отправьте turn.
5. Следите за tool calls, usage и ответом прямо в панели.

## Возможности

### Рабочая область чата

Фокусная боковая панель с несколькими tabs. У каждой tab свой draft, provider, model, context и runtime. Закройте и снова откройте Obsidian — сессии восстановятся, а provider, model и reasoning effort сохранятся на каждом ответе. Rewind и fork появляются, когда активный provider их поддерживает. Auto-scroll останавливается, когда вы прокручиваете историю вручную. Через 10 секунд без видимого вывода shared wait indicator показывает активный provider и время ожидания; на вопросах и permissions он приостанавливается.

### Вкладки, история и навигация

Откройте меню действий вкладки или щёлкните по ней правой кнопкой, чтобы переименовать, дублировать или закрыть вкладки. Средняя кнопка закрывает вкладку, а отмена восстанавливает её черновик и позицию. Ищите прошлые чаты во всплывающей истории и открывайте диалоги в новых вкладках. История отмечает названия, заданные вручную и сгенерированные моделью. Панель диалога содержит кнопки перехода и оглавление; у завершённых ответов указано время завершения.

<p align="center">
  <img src="../../assets/readme/conversation-history.png" alt="Поиск по истории: три диалога Ocean Atlas, их модели и отметки происхождения названий" width="100%">
</p>

### Параллельные агенты, настройки и поле ввода

Карточка подтверждения **Parallel workers** показывает inherited model и позволяет выбрать только те предложенные задачи, которые будут запущены. Settings использует native search Obsidian и содержит постоянный пункт What's New. Provider settings и composer используют единый интерфейс для всех providers, сохраняя provider-owned controls и configuration на их месте.

### Горячие клавиши

| Сочетание | Действие |
| --- | --- |
| `Enter` | Отправить текущий turn. Не работает, если включено **Send only with button**. |
| `Shift+Enter` | Вставить новую строку в composer. |
| `Shift+Tab` | Переключить permission mode по кругу: `Safe -> Auto-approve -> Plan -> Safe`. У providers без Plan mode переключает Safe и Auto-approve. |
| `Escape` | Остановить активный ответ или закрыть всплывающую историю. |

### Выбор модели

Один picker, сгруппированный по провайдерам и отсортированный по label: Antigravity, Claude Code, Codex, Command Code, Devin, Gemini CLI (Legacy), Grok Build, Kimi Code, MiMoCode, OpenCode, Pi, Qwen Code и Reasonix. Search работает по labels, descriptions, groups и model IDs. Catalogs загружаются lazily и запоминают, какие groups вы свернули. В settings можно добавить custom aliases и context-window overrides. Claude 1M variants — дополнительные options, а не замена базовых моделей.

OpenCode, MiMoCode, Kimi Code, Grok Build, Command Code и Pi используют общий выбор моделей в настройках: выбранные строки с псевдонимами, поиск по каталогу и **Refresh all models**. Обновление сохраняет выбор и псевдонимы; фильтр провайдеров появляется, когда CLI сообщает названия поставщиков.

### Использование и стоимость

Badge рядом с model selector показывает usage активного provider; подробный readout находится внутри model menu: quota windows, если provider их отдаёт, и spend, если доступна только стоимость. Последние хорошие значения остаются на месте, пока refresh идёт или падает, поэтому meter не исчезает внезапно. Всё это можно выключить в settings, если хочется более тихий UI.

| Provider | Откуда берётся usage |
| --- | --- |
| Codex | Account rate-limit notifications и `account/rateLimits/read`, когда доступно |
| Claude Code | SDK rate-limit events, optional `.grimoire/claude/statusline-usage.json` и SDK result cost metadata |
| Antigravity CLI | Пока ненадежно доступно из `agy --print` |
| Gemini CLI (Legacy) | ACP cost metadata, если Gemini CLI её отдаёт; только legacy provider |
| Qwen Code | ACP token и cost metadata, только когда Qwen Code их отдаёт |
| Devin | Сумма кредитов сессии из ACP, как расход за месяц |
| Reasonix | Стоимость хода из собственных status-уведомлений, если у настроенного провайдера моделей есть цена |
| Pi | Не сообщается адаптером pi-acp |
| OpenCode | Monthly spend, агрегированный из ACP и session cost metadata |
| MiMoCode | Monthly spend, агрегированный из ACP и session cost metadata |
| Kimi Code | Monthly spend, агрегированный из ACP и session cost metadata |
| Grok Build | Общий недельный лимит Grok, время сброса и Extra Usage Credits при OAuth-авторизации; monthly API spend из session cost metadata |

### Режим планирования

Когда active provider поддерживает Plan mode, его можно включить двумя способами:

- Нажимайте permission control в composer, пока он не переключится на Plan: `Safe -> Auto-approve -> Plan`.
- Нажимайте `Shift+Tab`, чтобы переключать полный цикл: `Safe -> Auto-approve -> Plan -> Safe`.

Plan mode просит provider сначала составить план, прежде чем начинать изменения. В composer он использует тот же permission control, что Safe и Auto-approve, поэтому active mode остаётся видимым во время работы.

Когда provider завершает планирование, Grimoire показывает сворачиваемую карточку Plan complete с отрендеренным планом, запрошенными permissions и keyboard-friendly строками. Approve продолжает работу в той же session; feedback оставляет Plan mode активным, чтобы provider мог пересобрать план.

### Контекст и упоминания

Упоминайте vault notes и folders прямо из composer, подтягивайте current или linked note, добавляйте persistent external context paths в settings. Вставляйте или перетаскивайте изображения, если provider поддерживает image input. Упоминайте MCP servers там, где provider integration это поддерживает. Вкладка Context показывает привязанную заметку, model, permission mode, закреплённые файлы, launch artifacts вроде `.grimoire/grok/system.md` и файлы, которые agent загрузил во время session.

### Редактирование в заметке

Запустите "Grimoire: Inline edit" на выделенном тексте. Рядом с текстом откроется prompt, edit вернётся как diff, который можно accept или reject, а сама операция пойдёт через provider-backed inline edit service. Работает и для замены выделения, и для вставки нового текста.

### Уточняющие вопросы

Когда provider запрашивает structured user input, Grimoire ставит turn на паузу и показывает вопрос над composer. Claude Code называет это `AskUserQuestion`; Codex app-server отдаёт экспериментальную поверхность `request_user_input` / `requestUserInput`; Qwen Code передаёт `AskUserQuestion` через ACP permission metadata. Grimoire нормализует эти provider-specific механизмы в один inline question UI. Single-select, multi-select и freeform answers возвращаются в provider run, чтобы agent продолжил без отдельного chat message.

Если вопрос перекрывает текст чата, который нужно перечитать, нажмите chevron в header вопроса: панель свернётся в компактную полоску. Выбранные и freeform answers сохраняются до разворачивания или отправки вопроса.

### Команды

Built-in commands покрывают workflows Grimoire, включая image generation и resume. Providers, которые отдают свои commands, например Claude Code slash commands, OpenCode, Grok Build и Qwen Code runtime commands, показывают их через provider-owned catalogs. Ненужные команды можно скрыть в settings.

### Генерация изображений

Вставляйте или перетаскивайте изображения, чтобы прикрепить их к turn. Built-in command `/image [prompt]` сам не вызывает image API. Он отправляет обычный turn активному provider с инструкцией использовать то, что вы настроили для image generation: provider-native tooling, MCP tools или local command. Agent сохраняет результат в vault и возвращает embed вроде `![[path/to/image.png]]`. Если image generation не настроена, вы получите обычный ответ с объяснением, чего не хватает.

### Безопасность и разрешения

Permission modes принадлежат provider, поэтому Grimoire показывает их через shared composer controls, а не переизобретает. Permission control и `Shift+Tab` переключают Safe, Auto-approve и Plan по одному циклу, когда active provider поддерживает plan mode. Safe mode и permission prompts остаются видимыми во время работы. Bang-bash mode появляется только если enabled provider его поддерживает. Относитесь к configured MCP servers, shell access и API keys как к sensitive данным, потому что они sensitive.

### Отладочные журналы

По умолчанию выключен. Если включить, Grimoire пишет sanitized JSONL в `.grimoire/logs/YYYY-MM-DD.jsonl`: prompts, answers, note contents, paths, environment values и secrets редактируются. Это инструмент диагностики provider/runtime issues, а не transcript.

### Настройки

Четыре вкладки разделяют настройки: **Общие** — язык, расположение чата, вкладки и отображение; **Провайдеры** — включение CLI и настройка моделей; **Расширенные** — контекст, диалоги, инструменты и диагностика; **О плагине** — версия и список изменений. Настройки доступны через встроенный поиск Obsidian.

Обзор провайдеров показывает обнаруженные CLI и переключатели включения. Ниже расположены настройки выбранного провайдера.

<p align="center">
  <img src="../../assets/readme/settings-providers.png" alt="Обзор двенадцати CLI-провайдеров Grimoire и настройки моделей Codex" width="100%">
</p>

<details>
<summary>Общие настройки</summary>

<p align="center">
  <img src="../../assets/readme/settings-general.png" alt="Общие настройки языка, расположения панели, вкладок, подписей, прокрутки и названий диалогов" width="100%">
</p>

</details>

## Где Grimoire хранит данные

| Path | Что там |
| --- | --- |
| `.grimoire/grimoire-settings.json` | Настройки приложения и провайдеров |
| `.grimoire/sessions/*.meta.json` | Метаданные сессий |
| `.grimoire/logs/YYYY-MM-DD.jsonl` | Очищенные от чувствительных данных отладочные журналы; включаются отдельно |
| `.grimoire/claude/statusline-usage.json` | Claude usage snapshot для plan meter |
| `.grimoire/grok/` | Grok Build launch artifacts, managed config и session pointers |

Provider-native файлы под `.claude/`, `.codex/`, `.opencode/` и `.grimoire/grok/` читаются и записываются на месте, поэтому ваша provider setup остаётся переносимой за пределы Grimoire.

## Конфиденциальность

Grimoire работает внутри Obsidian, на вашем компьютере. У него нет backend, telemetry и механизма загрузки prompts, answers, notes, files, tool output, API keys или usage logs в сервис Grimoire. Единственные logs, которые он пишет, — optional sanitized debug logs выше, и они остаются в вашем vault.

Что Grimoire не может скрыть — это сам provider. CLI, который вы включаете, получает prompt, выбранный context и files, images, tool output и commands, нужные для request. Этот CLI может обращаться к Anthropic, OpenAI, Google, configured OpenCode vendors, MCP servers или чему-то ещё, что вы настроили. Terms, retention, billing, rate limits и privacy policies принадлежат provider, а не Grimoire. Задача Grimoire — сделать эту границу видимой и управляемой внутри Obsidian.

Для ориентированного на политику Obsidian summary по использованию сети, требованиям к аккаунту, доступу к внешним файлам, логированию и telemetry см. [DISCLOSURES.md](../../DISCLOSURES.md).

## Разработка

Мы приветствуем contributions. Перед открытием pull request прочитайте [CONTRIBUTING.md](../../CONTRIBUTING.md): в нём описаны требования к architecture, security, tests и review.

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run test
npm run build
npm run build:release
```

Перед публикацией или push значимых UI/provider изменений запускайте полный local gate:

```bash
npm run test -- --selectProjects unit
npm run typecheck
npm run lint
npm run build:release
```

`npm run build:release` обновляет generated `main.js`, root `styles.css` и `dist/grimoire`.

npm — canonical package manager для development, CI и releases. При изменении dependencies поддерживайте `package-lock.json` в актуальном состоянии; secondary package-manager lockfiles намеренно не коммитятся.

## Релизы

Релизы Grimoire публикуются из semver tags вроде `1.0.0`. Release workflow запускает local gate, собирает Obsidian bundle, проверяет, что tag совпадает с `package.json` и `manifest.json`, затем прикрепляет `main.js`, `manifest.json` и `styles.css` к GitHub Release.

Obsidian Community plugins — рекомендуемый способ установки для пользователей. GitHub Releases по-прежнему содержат bundle assets для ручной установки и BRAT. Используйте `main` для releasable development, затем публикуйте релиз тегом, совпадающим с версией manifest.

## Планы развития

Сейчас Grimoire поставляется с Codex, Claude Code, Antigravity CLI, Gemini CLI (Legacy), OpenCode, MiMoCode, Kimi Code, Grok Build, Qwen Code, Devin, Pi, Reasonix и Command Code.

Следующие в списке: GitHub Copilot CLI, другие ACP-compatible providers и local model CLIs, когда их runtime станет достаточно стабильным для embedding в Obsidian. Implementation notes находятся в [docs/provider-roadmap.md](../provider-roadmap.md).

## Лицензия

MIT. См. [LICENSE](../../LICENSE).
