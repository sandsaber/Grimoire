# Grimoire

<p align="center">
  <img src="../../assets/readme/grimoire-logo.png" alt="Grimoire-Logo" width="240">
</p>

<p align="center">
  <strong>Local-first AI-Agents für deinen Obsidian vault.</strong>
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="Lizenz: MIT">
  <img src="https://img.shields.io/github/v/release/sandsaber/Grimoire?label=release" alt="Aktuelles Release">
  <img src="https://img.shields.io/badge/Obsidian-1.13.0%2B-7c3aed" alt="Obsidian 1.13.0+">
  <img src="https://img.shields.io/badge/platform-desktop-lightgrey" alt="Nur Desktop">
</p>

<p align="center">
  <img src="../../assets/readme/chat-workspace.png" alt="Grimoire-Seitenleiste neben einer Obsidian-Notiz" width="100%">
</p>

<p align="center">
  <sub>Arbeite mit lokalen CLI-Agents im selben Obsidian workspace, in dem deine Notizen leben.</sub>
</p>

> **Hinweis: 2.0 ist in Arbeit.** Das nächste Hauptrelease stellt Grimoire auf eine providerbasierte Ausführungsarchitektur um, in der ein Kernel jede CLI steuert und pro Zug genau ein Ergebnis festhält, und bringt ein Redesign, das dem Theme und der Akzentfarbe deines Vaults folgt. Die Arbeit findet im Branch `providers-migration` statt und ist noch in keinem veröffentlichten Release enthalten. Unterhaltungen, Einstellungen und Provider-Dateien bleiben unverändert erhalten.

Grimoire bringt agentic CLI-Assistenten direkt nach Obsidian. Claude Code, Codex, Antigravity CLI, Gemini CLI (Legacy), OpenCode, MiMoCode, Kimi Code, Grok Build und Qwen Code laufen in einer gemeinsamen Seitenleiste: Sie lesen Notizen, bearbeiten Dateien, führen Befehle aus, rufen Tools auf und behalten session history im Kontext deines echten vault. Nichts läuft über einen Grimoire-Server. Es gibt keine telemetry, kein hosted backend und keinen proxy zwischen dir und deinem provider.

Grimoire ist für Menschen gebaut, die bereits in Obsidian arbeiten und AI-Hilfe wollen, die sich wie ein Teil des vault anfühlt: lokaler context, lokale files, bewusst gewählte provider und sichtbare usage/cost direkt im UI.

> Das englische [README](../../README.md) ist das canonical document des Projekts. Diese Übersetzung wird mit den aktuellen Produktdokumenten gepflegt.

## Warum Grimoire

- Nutze die CLI-Agents, denen du bereits vertraust, direkt in deinen Notizen.
- Wechsle provider im composer. Claude Code, Codex, Antigravity CLI, Gemini CLI (Legacy), OpenCode, MiMoCode, Kimi Code, Grok Build und Qwen Code teilen sich einen model picker.
- Grounde jeden turn in deinem vault. Erwähne Notizen, Ordner und MCP tools, statt paths per Hand zu kopieren.
- Sieh cost und limits direkt neben der model-Auswahl.
- Bleib local-first. Grimoire sammelt keine telemetry, proxyed keine prompts und betreibt kein backend.

## Was die provider können

| Capability | Claude Code | Codex | OpenCode | Grok Build | MiMoCode | Kimi Code | Antigravity CLI | Gemini CLI (Legacy) | Qwen Code |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Local persistent runtime | Ja | Ja | Ja | Ja | Ja | Ja | Nein | Ja | Ja |
| Native history hydration | Ja | Ja | Ja | Ja | Ja | Ja | Nein | Ja | Nein |
| Plan mode | Ja | Ja | Ja | Ja | Ja | Ja | Nein | Ja | Ja |
| Image attachments | Ja | Ja | Ja | Ja | Ja | Ja | Nein | Ja | Ja |
| Instruction mode | Ja | Ja | Ja | Ja | Ja | Ja | Nein | Ja | Ja |
| Reasoning effort controls | Ja | Ja | Ja | Ja | Ja | Ja | Ja | Ja | Ja |
| Rewind | Ja | Nein | Nein | Ja | Nein | Nein | Nein | Nein | Nein |
| Fork | Ja | Ja | Nein | Ja | Nein | Nein | Nein | Nein | Nein |
| Provider slash commands | Ja | Nein | Ja | Ja | Ja | Ja | Nein | Ja | Ja |
| Grimoire-managed MCP UI | Ja | Nein | Ja | Ja | Ja | Ja | Nein | Ja | Ja |

## Installation

Grimoire ist ein Desktop-Plugin. Es steuert deine provider CLIs lokal, daher gibt es keinen mobile build.

### Über Community plugins (empfohlen)

Installiere Grimoire aus dem Obsidian community plugin directory:

1. Öffne Settings, gehe zu Community plugins und deaktiviere Restricted mode, falls er aktiv ist.
2. Klicke Browse, suche Grimoire und installiere es.
3. Aktiviere Grimoire und öffne das Panel über ribbon oder command palette.

### Aus GitHub Releases

Wenn du Community plugins nicht nutzen kannst, kannst du das aktuelle Release manuell installieren:

1. Lade `main.js`, `manifest.json` und `styles.css` aus dem neuesten [Grimoire release](https://github.com/sandsaber/Grimoire/releases/latest) herunter.
2. Erstelle `/path/to/your/vault/.obsidian/plugins/grimoire`.
3. Lege alle drei Dateien in diesen Ordner.
4. Aktiviere Grimoire in Settings, Community plugins.

### Mit BRAT

BRAT kann Grimoire aus GitHub Releases installieren, wenn du tagged builds außerhalb des community directory verfolgen möchtest:

1. Installiere das Plugin "Obsidian42 - BRAT".
2. Füge in BRAT ein beta plugin aus `sandsaber/Grimoire` hinzu.
3. Aktiviere Grimoire.

### Aus dem Source

Baue das release bundle und lege es in deinen vault:

```bash
npm install
npm run build:release

mkdir -p /path/to/your/vault/.obsidian/plugins/grimoire
cp dist/grimoire/main.js dist/grimoire/manifest.json dist/grimoire/styles.css \
  /path/to/your/vault/.obsidian/plugins/grimoire/
```

Aktiviere danach Grimoire in Settings, Community plugins.

Egal welchen Weg du wählst: Installiere zuerst mindestens einen CLI provider. Grimoire umhüllt provider CLIs, ersetzt aber nicht deren account setup, model access, quotas oder terms.

## Provider einrichten

Aktiviere die gewünschten providers unter Settings, Grimoire, Providers. Danach erscheinen sie im model selector. Codex ist beim ersten Start aktiviert; alle anderen providers sind opt-in.

### Empfohlene Provider

Für die beste Grimoire-Erfahrung beginne mit Claude Code, Codex, OpenCode, MiMoCode, Kimi Code, Grok Build oder Qwen Code. Diese provider bieten aktuell die stärksten runtime surfaces für vault-native Arbeit: persistent sessions, plan-oriented workflows, tool activity und umfangreiche model controls.

Antigravity CLI und Gemini CLI (Legacy) bleiben für Google accounts und compatibility-Fälle verfügbar, werden heute aber nicht als primäre Grimoire-Provider empfohlen. Grimoire unterstützt sie best-effort und wir haben die Fallbacks implementiert, die ihre aktuellen CLIs erlauben, aber ihre ACP und runtime surfaces sind technisch begrenzt: sessions, approvals, streaming, tool/edit metadata, model discovery und usage reporting sind im Vergleich zu den empfohlenen Providern unvollständig oder unzuverlässig.

### Claude Code

Wähle Claude Code, wenn du native project memory, slash commands, MCP configuration, plans, rewind/fork und Arbeit über Claude subscription oder API key möchtest.

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude
```

Authentifiziere dich über Claude Code und aktiviere es danach in Grimoire. Das alte npm package ist deprecated; nutze den native installer oben, Homebrew (`brew install --cask claude-code`), WinGet oder die anderen Optionen im official quickstart.

- [Claude Code quickstart](https://code.claude.com/docs/en/quickstart)

In Grimoire liest und bewahrt Claude Code deine `.claude/` files, läuft auf dem Claude Code SDK und unterstützt slash commands, MCP settings, agents, skills, plans, rewind und fork. Wenn Claude beides meldet, siehst du quota windows und API spend nebeneinander.

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

Codex ist beim ersten Start der default provider. Wähle ihn für OpenAI Codex in einem lokalen CLI, angemeldet über deinen ChatGPT plan oder einen API key.

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex
```

Starte Codex einmal, melde dich an und aktiviere es dann in Grimoire. Der standalone installer ist jetzt der primary install path; Windows, Homebrew und fallback package-manager options stehen in der offiziellen Codex CLI Dokumentation.

- [Codex CLI setup](https://developers.openai.com/codex/cli)
- [OpenAI code generation guide](https://developers.openai.com/api/docs/guides/code-generation)

In Grimoire läuft Codex über sein app-server protocol mit native history, fork, plan mode, image input und reasoning effort controls. Plan usage erscheint, wenn Codex rate-limit metadata meldet.

### Antigravity CLI

Antigravity CLI ist Googles Ersatz für Consumer-Nutzung von Gemini CLI und kann auf Gemini, Claude, GPT-OSS und weitere Modellfamilien zugreifen, die dein Antigravity account bereitstellt. In Grimoire solltest du es als compatibility provider behandeln, nicht als empfohlenen Standard.

```bash
agy
```

Installiere die offizielle Antigravity CLI von Google, authentifiziere sie lokal und aktiviere danach Antigravity in Grimoire. Grimoire erkennt `agy` automatisch aus PATH, oder du setzt einen custom CLI path in den provider settings.

- [Antigravity CLI](https://antigravity.google/product/antigravity-cli)
- [Gemini CLI migration guide](https://goo.gle/gemini-cli-migration)

In Grimoire läuft Antigravity über `agy --print`, mit optionaler model selection aus `agy models`. Das ist eine best-effort integration, weil `agy` Grimoire derzeit keinen starken ACP-compatible runtime bereitstellt. Persistent sessions, native history, images, plan mode, streaming, approval-safe file edits, reliable usage reporting und auxiliary workflows bleiben deaktiviert oder eingeschränkt, bis Antigravity stabile runtime surfaces bereitstellt.

### Gemini CLI (Legacy)

Gemini CLI bleibt ein legacy compatibility provider fuer Gemini Code Assist Standard, Enterprise, Google Cloud und paid API-key users, wenn Google Gemini CLI requests weiter bedient. Für neue Grimoire setups wird es nicht empfohlen, weil sein ACP support schwach ist und mehrere Grimoire workflows darauf nicht zuverlässig umgesetzt werden können. Consumer Google AI Pro, Ultra und free-tier accounts sollten nach June 18, 2026 Antigravity verwenden und die oben genannten Antigravity-Limits beachten.

```bash
gemini
```

Aktiviere Gemini CLI nur, wenn dein account tier weiterhin unterstuetzt wird und du genau diesen legacy Google path brauchst. Grimoire startet es ueber `gemini --acp`, fuegt active note, editor/browser/canvas selection, vault search und project workspace context in den ACP prompt ein und markiert es als legacy, damit es nicht wie ein empfohlener provider wirkt. Nutze nach Möglichkeit Codex, Claude Code, OpenCode, MiMoCode, Kimi Code, Grok Build oder Qwen Code.

### Qwen Code

Qwen Code ist ein opt-in ACP-provider mit provider-nativen persistenten Sessions, Resume und model context sowie live model- und mode-discovery. Es streamt Nachrichten, Tool- und Plan-Aktivität und unterstützt image input, provider commands und file approvals. Grimoire hydriert keine provider-native message history.

```bash
# macOS und Linux
curl -fsSL https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.sh | bash

# Windows (PowerShell)
irm https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.ps1 | iex

# Alternativen: npm benötigt Node.js 22 oder neuer; Homebrew
npm install -g @qwen-code/qwen-code@latest
brew install qwen-code

qwen --version
qwen
```

Starte `qwen`, wähle in `/auth` **Alibaba ModelStudio**, **Third-party Providers** oder **Custom Provider** und aktiviere Qwen Code anschließend in Grimoire. Es gibt keinen OAuth-Anmeldeweg. Grimoire startet den opt-in provider mit `qwen --acp`.

Safe, Auto-approve und Plan werden auf Qwen `default`, `yolo` und `plan` abgebildet; andere oder unbekannte Qwen modes werden in der shared toolbar konservativ als Safe gezeigt. Reasoning effort unterstützt Low, Medium, High, XHigh und Max; High ist der Standard. `/effort <tier>` wird vor dem normalen turn gesetzt, pro Session gecacht und hängt vom effektiven model ab. ACP permission metadata für single-select, multi-select und freeform questions wird in derselben shared inline UI angezeigt.

Qwen verwaltet seine credentials und native Konfiguration weiterhin in `~/.qwen/settings.json`. Grimoire verwaltet eine isolierte Projekt-MCP-Liste in `.grimoire/mcp/qwen.json` und übergibt sie an ACP-Sessions, ohne Qwens native Konfiguration zu überschreiben. Usage wird nur angezeigt, wenn Qwen ACP token- oder cost-metadata meldet. Rewind und fork werden nicht unterstützt.

- [Qwen Code documentation](https://qwenlm.github.io/qwen-code-docs/en/)
- [Qwen Code authentication](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/)
- [Qwen Code repository](https://github.com/QwenLM/qwen-code)

Wenn Qwen nicht startet oder keine models erscheinen, führe `/doctor` in Qwen Code aus, schließe `/auth` ab, prüfe `qwen --version` und kontrolliere den Qwen CLI path in den Grimoire settings.

### OpenCode

Wähle OpenCode, wenn du einen model-agnostic agent mit eigener provider configuration möchtest.

```bash
curl -fsSL https://opencode.ai/install | bash
opencode
```

Homebrew, npm, bun und package-manager installs funktionieren ebenfalls. Konfiguriere deine provider credentials in OpenCode und aktiviere es danach in Grimoire.

- [OpenCode download](https://opencode.ai/download)
- [OpenCode provider docs](https://opencode.ai/docs/providers)
- [OpenCode config docs](https://opencode.ai/docs/config)

In Grimoire läuft OpenCode über ACP mit Grimoire-managed launch artifacts sowie persistent runtime, native history, plan mode, image input, provider commands und reasoning effort. Monthly spend wird angezeigt, wenn cost metadata verfügbar ist.

### MiMoCode

MiMoCode (Xiaomi) ist ein Fork von OpenCode mit persistenter Speicherung, intelligentem Kontextmanagement und Subagent-Orchestrierung.

```bash
curl -fsSL https://mimo.xiaomi.com/install | bash
mimo
```

Homebrew, npm, bun und package-manager installs funktionieren ebenfalls. Konfiguriere deine provider credentials in MiMoCode und aktiviere es danach in Grimoire.

- [MiMoCode GitHub](https://github.com/XiaomiMiMo/MiMo-Code)

In Grimoire läuft MiMoCode über ACP mit persistent runtime, native history, plan mode, image input, provider commands und reasoning effort.

### Kimi Code

Kimi Code CLI (MoonshotAI) ist ein Multi-Provider-Terminal-Agent, der Kimi-, OpenAI-, Anthropic-, Gemini- und Vertex-Modelle unterstützt.

```bash
curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash
kimi
```

Konfiguriere deine provider credentials in Kimi Code und aktiviere es danach in Grimoire.

- [Kimi Code GitHub](https://github.com/MoonshotAI/kimi-code)

In Grimoire läuft Kimi Code über ACP mit persistent runtime, native history, plan mode, image input, provider commands und reasoning effort.

### Grok Build

Wähle Grok Build für xAIs agentic CLI in Obsidian. Melde dich über Grok OAuth an oder verwende einen xAI API-Key.

```bash
grok
```

Installiere die Grok CLI von xAI, authentifiziere dich über grok.com OAuth oder konfiguriere API keys, und aktiviere dann Grok Build in Grimoire.

- [Grok-Build-Dokumentation](https://docs.x.ai/build/overview)
- [Grok 4.5](https://docs.x.ai/developers/grok-4-5)
- [Nutzung und Limits](https://docs.x.ai/grok/faq)

Grok 4.5 ist derzeit das Standardmodell hinter Grok Build. Grimoire liest den verfügbaren Modellkatalog aus dem authentifizierten Grok CLI statt aus einer statischen Liste; daher kann er je nach Konto und CLI-Version variieren und sich automatisch aktualisieren.

In Grimoire läuft Grok Build über ACP via `grok agent stdio` mit Grimoire-managed launch artifacts unter `.grimoire/grok/`, persistent runtime, native JSONL history hydration, plan mode, image input, provider commands, reasoning effort auf native models, rewind und fork. Bei OAuth-Authentifizierung zeigt Grimoire die gemeinsame wöchentliche Grok-Nutzung, den Reset-Zeitpunkt und verfügbare Extra Usage Credits an; API spend wird aus session cost metadata aggregiert, wenn gemeldet.

## Dein erster Chat

1. Wähle provider und model im composer.
2. Setze reasoning effort und wähle Safe, Auto-approve oder Plan im permission control.
3. Erwähne notes, folders oder context, die im scope sein sollen.
4. Sende den turn.
5. Beobachte tool calls, usage und output im panel.

## Features

### Chat workspace

Eine fokussierte Seitenleiste mit mehreren tabs. Jeder tab behält eigenen draft, provider, model, context und runtime. Wenn du Obsidian schließt und wieder öffnest, kommen deine sessions zurück; provider, model und reasoning effort bleiben bei jeder response erhalten. Rewind und fork erscheinen, wenn der aktive provider sie unterstützt. Auto-scroll hält an, sobald du selbst zurückscrollst, um etwas zu lesen. Nach 10 Sekunden ohne sichtbare Ausgabe zeigt ein gemeinsamer wait indicator den aktiven provider und die Wartezeit; bei Fragen oder permissions pausiert er.

### Tab-, Verlauf- und Navigationssteuerung

Per Rechtsklick kannst du einen tab umbenennen, duplizieren, schließen, andere tabs schließen oder tabs rechts davon schließen. Ein Mittelklick schließt einen tab; Undo stellt ihn zeitlich begrenzt mit draft und Position wieder her. Öffne gespeicherte Gespräche aus der chat history per Aktion, Modifier-Klick oder Mittelklick in einem neuen tab. Lange Gespräche haben einen Navigator für Anfang, vorherigen prompt, Gesprächsverzeichnis, nächsten prompt und Ende. Fertige Nachrichten zeigen neben der copy action einen lokalisierten completion timestamp.

<p align="center">
  <img src="../../assets/readme/conversation-history.png" alt="Grimoire-Unterhaltungsverlauf und Tab-Navigation" width="100%">
</p>

### Parallel workers, settings und composer

Die approval card **Parallel workers** zeigt das geerbte model und startet nur die ausgewählten vorgeschlagenen Aufgaben. Settings verwenden die native Obsidian-Suche und haben einen permanenten What's New-Eintrag. Provider settings und composer bieten providerübergreifend eine einheitliche Oberfläche, ohne provider-eigene controls oder Konfiguration zu verschieben.

### Tastenkürzel

| Tastenkürzel | Aktion |
| --- | --- |
| `Enter` | Sendet den aktuellen turn. Deaktiviert, wenn **Send only with button** eingeschaltet ist. |
| `Shift+Enter` | Fügt im composer eine neue Zeile ein. |
| `Shift+Tab` | Wechselt permission modes im Kreis: `Safe -> Auto-approve -> Plan -> Safe`. Provider ohne Plan mode wechseln zwischen Safe und Auto-approve. |
| `Escape` | Stoppt die aktive response oder schließt die geöffnete chat history. |

### Model selector

Ein picker, gruppiert nach provider und nach label sortiert: Antigravity, Claude Code, Codex, Gemini CLI (Legacy), Grok Build, Kimi Code, MiMoCode, OpenCode und Qwen Code. Search läuft über labels, descriptions, groups und model IDs. Catalogs laden lazily und merken sich collapsed groups. In settings kannst du custom aliases und context-window overrides hinzufügen. Claude 1M variants sind zusätzliche options, keine Ersetzungen für base models.

### Usage und cost

Ein badge neben dem model selector hält die usage des aktiven provider sichtbar. Im model menu gibt es ausführlichere readouts: quota windows, wenn der provider sie anbietet, und spend, wenn nur cost verfügbar ist. Während refresh läuft oder fehlschlägt, bleibt der letzte gute Wert stehen, sodass der meter nicht plötzlich verschwindet. Wenn du ein ruhigeres UI willst, kannst du alles in settings abschalten.

| Provider | Woher usage kommt |
| --- | --- |
| Claude Code | SDK rate-limit events, optional `.grimoire/claude/statusline-usage.json` und SDK result cost metadata |
| Codex | Account rate-limit notifications und `account/rateLimits/read`, wenn verfügbar |
| Antigravity CLI | Noch nicht zuverlässig über `agy --print` verfügbar |
| Gemini CLI (Legacy) | ACP cost metadata, wenn Gemini CLI sie meldet; nur legacy provider |
| Qwen Code | ACP token- und cost-metadata, wenn Qwen Code sie meldet |
| OpenCode | Monthly spend aggregiert aus ACP und session cost metadata |
| MiMoCode | Monthly spend aggregiert aus ACP und session cost metadata |
| Kimi Code | Monthly spend aggregiert aus ACP und session cost metadata |
| Grok Build | Gemeinsame wöchentliche Grok-Nutzung, Reset-Zeitpunkt und Extra Usage Credits über OAuth; monthly API spend aus session cost metadata |

### Plan mode

Wenn der aktive provider Plan mode unterstützt, kannst du ihn auf zwei Arten einschalten:

- Klicke auf das permission control im composer, bis es zu Plan wechselt: `Safe -> Auto-approve -> Plan`.
- Drücke `Shift+Tab`, um den vollständigen Zyklus zu durchlaufen: `Safe -> Auto-approve -> Plan -> Safe`.

Plan mode bittet den provider, zuerst zu planen, bevor Änderungen starten. Im composer nutzt er dasselbe permission control wie Safe und Auto-approve, sodass der aktive Modus während der Arbeit sichtbar bleibt.

Wenn ein provider die Planung abschließt, zeigt Grimoire eine einklappbare Plan complete-Karte mit gerendertem Plan, angefragten permissions und tastaturfreundlichen Zeilen. Approve fährt in derselben session fort; feedback hält Plan mode aktiv, damit der provider den Plan überarbeiten kann.

### Context und mentions

Erwähne vault notes und folders direkt aus dem composer, ziehe current oder linked note heran und füge persistent external context paths in settings hinzu. Füge Bilder per paste oder drop hinzu, wenn der provider image input unterstützt. MCP servers lassen sich dort mentionen, wo die provider integration es unterstützt. Der Context tab zeigt die gebundene note, model, permission mode, angepinnte files, launch artifacts wie `.grimoire/grok/system.md` und files, die der agent während der session geladen hat.

### Inline editing

Führe "Grimoire: Inline edit" auf einer Auswahl aus. Neben dem Text öffnet sich ein prompt, die Änderung kommt als diff zurück, den du accept oder reject kannst, und sie läuft über den provider-backed inline edit service. Es unterstützt sowohl das Ersetzen einer selection als auch das Einfügen neuen Texts.

### Clarifying questions

Wenn ein provider structured user input anfordert, pausiert Grimoire den turn und rendert die Frage über dem composer. Claude Code stellt das als `AskUserQuestion` bereit; Codex app-server stellt eine experimentelle `request_user_input` / `requestUserInput` Oberfläche bereit; Qwen Code liefert ACP permission metadata. Grimoire normalisiert diese provider-specific Mechanismen in dieselbe inline question UI. Single-select, multi-select und freeform answers gehen zurück in den provider run, damit der agent ohne separate chat message fortfahren kann.

### Commands

Built-in commands decken Grimoire workflows wie image generation und resume ab. Providers, die eigene commands anbieten, etwa Claude Code slash commands sowie OpenCode-, Grok-Build- und Qwen-Code-runtime commands, zeigen sie über provider-owned catalogs. Nicht genutzte commands kannst du in settings ausblenden.

### Image generation

Füge Bilder per paste oder drop als attachments hinzu. Der built-in command `/image [prompt]` ruft selbst keine image API auf. Er sendet einen normalen turn an den aktiven provider mit der Anweisung, deine konfigurierte image generation zu nutzen: provider-native tooling, MCP tools oder local command. Der agent speichert das Ergebnis in deinem vault und gibt ein embed wie `![[path/to/image.png]]` zurück. Wenn image generation nicht eingerichtet ist, bekommst du eine normale Antwort, die erklärt, was fehlt.

### Safety und permissions

Permission modes gehören zum provider. Grimoire zeigt sie daher über shared composer controls, statt sie neu zu erfinden. Das permission control und `Shift+Tab` wechseln beide zwischen Safe, Auto-approve und Plan, wenn der active provider plan mode unterstützt. Safe mode und permission prompts bleiben während der Arbeit sichtbar. Bang-bash mode erscheint nur, wenn ein enabled provider ihn anbietet. Behandle configured MCP servers, shell access und API keys als sensitive, denn sie sind es.

### Debug logging

Standardmäßig aus. Wenn aktiviert, schreibt Grimoire sanitized JSONL nach `.grimoire/logs/YYYY-MM-DD.jsonl`; prompts, answers, note contents, paths, environment values und secrets werden redacted. Das ist für Diagnose von provider/runtime issues gedacht, nicht als transcript.

### Settings

General settings decken auto-scroll, title generation, usage indicators, debug logging, locale, tabs und den provider ab, der die settings view besitzt. Per-provider tabs kümmern sich um CLI paths, model behavior, commands, agents, skills und provider-owned config, sofern vorhanden. Du kannst auch project workspace environment variables setzen, scoped per provider.

<p align="center">
  <img src="../../assets/readme/settings-general.png" alt="Allgemeine Grimoire-Einstellungen" width="100%">
</p>

## Wo Grimoire Daten speichert

| Path | Inhalt |
| --- | --- |
| `.grimoire/grimoire-settings.json` | App settings plus provider configuration |
| `.grimoire/sessions/*.meta.json` | Session metadata |
| `.grimoire/logs/YYYY-MM-DD.jsonl` | Opt-in sanitized debug logs |
| `.grimoire/claude/statusline-usage.json` | Claude usage snapshot für den plan meter |
| `.grimoire/grok/` | Grok Build launch artifacts, managed config und session pointers |

Provider-native files unter `.claude/`, `.codex/`, `.opencode/` und `.grimoire/grok/` werden direkt gelesen und geschrieben, sodass dein provider setup außerhalb von Grimoire portabel bleibt.

## Privacy

Grimoire läuft in Obsidian, auf deinem Rechner. Es hat kein backend, fügt keine telemetry hinzu und lädt keine prompts, answers, notes, files, tool output, API keys oder usage logs zu einem Grimoire service hoch. Die einzigen logs sind die optionalen sanitized debug logs oben, und sie bleiben in deinem vault.

Was Grimoire nicht verstecken kann, ist der provider selbst. Das CLI, das du aktivierst, erhält prompt, gewählten context und die files, images, tool output und commands, die ein request braucht. Dieses CLI kann mit Anthropic, OpenAI, Google, deinen konfigurierten OpenCode vendors, MCP servers oder anderen eingerichteten Zielen sprechen. Terms, retention, billing, rate limits und privacy policies gehören zum provider, nicht zu Grimoire. Grimoire macht diese Grenze in Obsidian sichtbar und kontrollierbar.

Für eine Obsidian-policy-orientierte Zusammenfassung von Netzwerknutzung, Account-Anforderungen, externem Dateizugriff, Logging und Telemetry siehe [DISCLOSURES.md](../../DISCLOSURES.md).

## Development

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run test
npm run build
npm run build:release
```

Vor dem Veröffentlichen oder Pushen wichtiger UI/provider changes solltest du das vollständige local gate ausführen:

```bash
npm run test -- --selectProjects unit
npm run typecheck
npm run lint
npm run build:release
```

`npm run build:release` aktualisiert generated `main.js`, root `styles.css` und `dist/grimoire`.

npm ist der canonical package manager für development, CI und releases. Halte `package-lock.json` aktuell, wenn dependencies geändert werden; secondary package-manager lockfiles werden absichtlich nicht committed.

Beiträge sind willkommen. Lies vor einem Pull Request [CONTRIBUTING.md](../../CONTRIBUTING.md); sie beschreibt Architektur-, Sicherheits-, Test- und Review-Erwartungen.

## Releases

Grimoire releases werden aus semver tags wie `1.0.0` veröffentlicht. Der release workflow führt das local gate aus, baut das Obsidian bundle, prüft, dass der tag zu `package.json` und `manifest.json` passt, und hängt `main.js`, `manifest.json` und `styles.css` an das GitHub Release.

Obsidian Community plugins sind der empfohlene Installationsweg für Nutzer. GitHub Releases enthalten weiterhin die bundle assets für manuelle Installationen und BRAT. Verwende `main` für releasable development und veröffentliche dann per tag, der zur manifest version passt.

## Roadmap

Aktuell wird Grimoire mit Claude Code, Codex, Antigravity CLI, Gemini CLI (Legacy), OpenCode, MiMoCode, Kimi Code, Grok Build und Qwen Code ausgeliefert.

Als Nächstes: GitHub Copilot CLI, weitere ACP-compatible providers und local model CLIs, sobald deren runtime stabil genug ist, um in Obsidian eingebettet zu werden. Implementation notes stehen in [docs/provider-roadmap.md](../provider-roadmap.md).

## Lizenz

MIT. Siehe [LICENSE](../../LICENSE).
