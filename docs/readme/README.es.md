# Grimoire · Grimorio

<p align="center">
  <img src="../../assets/readme/grimoire-logo.png" alt="Logotipo de Grimoire" width="240">
</p>

<p align="center">
  <strong>Agentes de IA local-first para tu vault de Obsidian.</strong>
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="Licencia: MIT">
  <img src="https://img.shields.io/github/v/release/sandsaber/Grimoire?label=release" alt="Último release">
  <img src="https://img.shields.io/badge/Obsidian-1.13.0%2B-7c3aed" alt="Obsidian 1.13.0+">
  <img src="https://img.shields.io/badge/platform-desktop-lightgrey" alt="Solo desktop">
</p>

<p align="center">
  <img src="../../assets/readme/chat-workspace.png" alt="Panel lateral de Grimoire junto a una nota de Obsidian" width="100%">
</p>

<p align="center">
  <sub>Habla con agentes CLI locales en el mismo workspace de Obsidian donde viven tus notas.</sub>
</p>

> **Aviso: la 2.0 está en marcha.** La próxima versión mayor lleva Grimoire a una arquitectura de ejecución basada en proveedores, donde un único núcleo dirige cada CLI y registra exactamente un resultado por turno, y trae un rediseño que sigue el tema y el color de acento de tu bóveda. Ya está fusionada en `main` y todavía no forma parte de ninguna versión publicada. La versión actual sigue siendo la 1.3.2. Las conversaciones, los ajustes y los archivos de los proveedores se conservan sin cambios.

Grimoire lleva asistentes CLI agentic a Obsidian. Claude Code, Codex, Antigravity CLI, Gemini CLI (Legacy), OpenCode, MiMoCode, Kimi Code, Grok Build y Qwen Code viven en un solo panel lateral: leen tus notas, editan archivos, ejecutan comandos, llaman tools y conservan session history contra tu vault real. Nada pasa por un servidor de Grimoire. No hay telemetry, hosted backend ni proxy entre tú y tu provider.

Está diseñado para quienes ya trabajan en Obsidian y quieren ayuda de IA que se sienta como parte del vault: contexto local, archivos locales, un provider elegido a propósito y usage/cost visibles dentro de la interfaz.

> El [README](../../README.md) en inglés es el canonical document del proyecto. Esta traducción se mantiene junto con la documentación actual del producto.

## Por qué Grimoire

- Usa los CLI agents en los que ya confías, directamente dentro de tus notas.
- Cambia de provider desde el composer. Claude Code, Codex, Antigravity CLI, Gemini CLI (Legacy), OpenCode, MiMoCode, Kimi Code, Grok Build y Qwen Code comparten un model picker.
- Ancla cada turn en tu vault. Menciona notas, carpetas y MCP tools sin pegar paths a mano.
- Ve cost y limits junto al selector de modelo, justo donde tomas la decisión.
- Mantén un flujo local-first. Grimoire no recopila telemetry, no proxifica prompts y no ejecuta un backend.

## Qué puede hacer cada provider

| Capability | Claude Code | Codex | OpenCode | Grok Build | MiMoCode | Kimi Code | Antigravity CLI | Gemini CLI (Legacy) | Qwen Code |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Local persistent runtime | Sí | Sí | Sí | Sí | Sí | Sí | No | Sí | Sí |
| Native history hydration | Sí | Sí | Sí | Sí | Sí | Sí | No | Sí | No |
| Plan mode | Sí | Sí | Sí | Sí | Sí | Sí | No | Sí | Sí |
| Image attachments | Sí | Sí | Sí | Sí | Sí | Sí | No | Sí | Sí |
| Instruction mode | Sí | Sí | Sí | Sí | Sí | Sí | No | Sí | Sí |
| Reasoning effort controls | Sí | Sí | Sí | Sí | Sí | Sí | Sí | Sí | Sí |
| Rewind | Sí | No | No | Sí | No | No | No | No | No |
| Fork | Sí | Sí | No | Sí | No | No | No | No | No |
| Provider slash commands | Sí | No | Sí | Sí | Sí | Sí | No | Sí | Sí |
| Grimoire-managed MCP UI | Sí | No | Sí | Sí | Sí | Sí | No | Sí | Sí |

## Instalación

Grimoire es un plugin desktop. Controla tus provider CLIs localmente, así que no hay mobile build.

### Desde Community plugins (recomendado)

Instala Grimoire desde el directorio de community plugins de Obsidian:

1. Abre Settings, ve a Community plugins y desactiva Restricted mode si está activo.
2. Haz clic en Browse, busca Grimoire e instálalo.
3. Activa Grimoire y abre el panel desde el ribbon o la command palette.

### Desde GitHub Releases

Si no puedes usar Community plugins, instala el release actual manualmente:

1. Descarga `main.js`, `manifest.json` y `styles.css` desde el último [Grimoire release](https://github.com/sandsaber/Grimoire/releases/latest).
2. Crea `/path/to/your/vault/.obsidian/plugins/grimoire`.
3. Coloca los tres archivos en esa carpeta.
4. Activa Grimoire desde Settings, Community plugins.

### Con BRAT

BRAT puede instalar Grimoire desde GitHub Releases si quieres seguir tagged builds fuera del directorio community plugins:

1. Instala el plugin "Obsidian42 - BRAT".
2. En BRAT, añade un beta plugin desde `sandsaber/Grimoire`.
3. Activa Grimoire.

### Desde el código fuente

Construye el release bundle y colócalo en tu vault:

```bash
npm install
npm run build:release

mkdir -p /path/to/your/vault/.obsidian/plugins/grimoire
cp dist/grimoire/main.js dist/grimoire/manifest.json dist/grimoire/styles.css \
  /path/to/your/vault/.obsidian/plugins/grimoire/
```

Después activa Grimoire desde Settings, Community plugins.

Elijas el camino que elijas, instala al menos un CLI provider antes de empezar. Grimoire envuelve provider CLIs, pero no reemplaza su account setup, model access, quotas ni terms.

## Configurar un provider

Activa los providers que quieras en Settings, Grimoire, Providers, y aparecerán en el model selector. Codex está activado en el primer inicio; los demás providers son opt-in.

### Providers recomendados

Para la mejor experiencia en Grimoire, empieza con Claude Code, Codex, OpenCode, MiMoCode, Kimi Code, Grok Build o Qwen Code. Estos providers exponen hoy los runtime surfaces más sólidos para trabajo vault-native: persistent sessions, plan-oriented workflows, tool activity y model controls ricos.

Antigravity CLI y Gemini CLI (Legacy) siguen disponibles para Google accounts y casos de compatibility, pero hoy no se recomiendan como providers principales de Grimoire. Grimoire los soporta en modo best-effort y ya implementamos los fallbacks que sus CLIs actuales permiten, pero sus ACP y runtime surfaces tienen limitaciones técnicas: sessions, approvals, streaming, tool/edit metadata, model discovery y usage reporting son incompletos o poco fiables comparados con los providers recomendados.

### Claude Code

Elige Claude Code si quieres su native project memory, slash commands, MCP configuration, plans, rewind/fork y trabajo respaldado por tu Claude subscription o API key.

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude
```

Autentícate con Claude Code y luego actívalo en Grimoire. El antiguo npm package está deprecated; usa el native installer anterior, Homebrew (`brew install --cask claude-code`), WinGet u otras opciones del official quickstart.

- [Claude Code quickstart](https://code.claude.com/docs/en/quickstart)

Dentro de Grimoire, Claude Code lee y conserva tus archivos `.claude/`, corre sobre Claude Code SDK y soporta slash commands, MCP settings, agents, skills, plans, rewind y fork. Cuando Claude reporta ambos datos, verás quota windows y API spend lado a lado.

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

Codex es el provider por defecto en el primer inicio. Elígelo para OpenAI Codex en un CLI local, autenticado con tu ChatGPT plan o una API key.

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex
```

Ejecuta Codex una vez, inicia sesión y luego actívalo en Grimoire. El standalone installer es ahora el primary install path; Windows, Homebrew y fallback package-manager options están en la documentación oficial de Codex CLI.

- [Codex CLI setup](https://developers.openai.com/codex/cli)
- [OpenAI code generation guide](https://developers.openai.com/api/docs/guides/code-generation)

Dentro de Grimoire, Codex corre sobre su app-server protocol con native history, fork, plan mode, image input y reasoning effort controls. Plan usage aparece cuando Codex reporta rate-limit metadata.

### Antigravity CLI

Antigravity CLI es el reemplazo de Google para el uso consumer de Gemini CLI y puede acceder a Gemini, Claude, GPT-OSS y otras familias de modelos disponibles para tu Antigravity account. Dentro de Grimoire, trátalo como compatibility provider, no como el default recomendado.

```bash
agy
```

Instala la Antigravity CLI oficial de Google, autentícala localmente y luego activa Antigravity en Grimoire. Grimoire detecta `agy` automáticamente desde PATH, o puedes definir un custom CLI path en provider settings.

- [Antigravity CLI](https://antigravity.google/product/antigravity-cli)
- [Gemini CLI migration guide](https://goo.gle/gemini-cli-migration)

Dentro de Grimoire, Antigravity corre mediante `agy --print`, con model selection opcional desde `agy models`. Es una integración best-effort porque `agy` todavía no expone a Grimoire un runtime ACP-compatible sólido. Persistent sessions, native history, images, plan mode, streaming, approval-safe file edits, reliable usage reporting y auxiliary workflows permanecen desactivados o limitados hasta que Antigravity exponga runtime surfaces estables.

### Gemini CLI (Legacy)

Gemini CLI queda como legacy compatibility provider para Gemini Code Assist Standard, Enterprise, Google Cloud y paid API-key users donde Google sigue sirviendo Gemini CLI requests. No se recomienda para setups nuevos de Grimoire porque su ACP support es débil y varios Grimoire workflows no pueden implementarse con fiabilidad encima de él. Las cuentas consumer Google AI Pro, Ultra y free-tier deben usar Antigravity despues del June 18, 2026, teniendo presentes las limitaciones de Antigravity descritas arriba.

```bash
gemini
```

Activa Gemini CLI solo si tu account tier sigue soportado y necesitas específicamente ese legacy Google path. Grimoire lo ejecuta mediante `gemini --acp`, agrega active note, editor/browser/canvas selection, vault search y project workspace context al ACP prompt, y lo etiqueta como legacy para que no parezca un provider recomendado. Prefiere Codex, Claude Code, OpenCode, MiMoCode, Kimi Code, Grok Build o Qwen Code cuando sea posible.

### Qwen Code

Qwen Code es un provider ACP opt-in con sesiones persistentes provider-native, resume y contexto de modelo, y descubrimiento en vivo de modelos y modos. Transmite mensajes y actividad de tools y planes; admite image input, commands del provider y file approvals. Grimoire no hidrata el historial de mensajes provider-native.

```bash
# macOS y Linux
curl -fsSL https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.sh | bash

# Windows (PowerShell)
irm https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.ps1 | iex

# Alternativas: npm requiere Node.js 22 o posterior; Homebrew
npm install -g @qwen-code/qwen-code@latest
brew install qwen-code

qwen --version
qwen
```

Inicia `qwen`, elige en `/auth` **Alibaba ModelStudio**, **Third-party Providers** o **Custom Provider**, y luego activa Qwen Code en Grimoire. No hay ruta de inicio de sesión OAuth. Grimoire lanza el provider opt-in con `qwen --acp`.

Safe, Auto-approve y Plan se asignan a `default`, `yolo` y `plan` de Qwen; otros modos de Qwen, incluidos los desconocidos, se muestran conservadoramente como Safe en la shared toolbar. Reasoning effort admite Low, Medium, High, XHigh y Max; High es el valor predeterminado. `/effort <tier>` se aplica antes de un turn normal, se guarda en caché por sesión y depende del modelo efectivo. Los metadatos de permisos ACP para preguntas single-select, multi-select y freeform se muestran en la misma UI inline compartida.

Qwen conserva la propiedad de sus credentials y configuración nativa en `~/.qwen/settings.json`. Grimoire gestiona una lista MCP de proyecto aislada en `.grimoire/mcp/qwen.json` y la inyecta en las sesiones ACP sin reescribir la configuración nativa de Qwen. El usage aparece solo cuando Qwen informa metadata ACP de tokens o coste. Rewind y fork no están disponibles.

- [Qwen Code documentation](https://qwenlm.github.io/qwen-code-docs/en/)
- [Qwen Code authentication](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/)
- [Qwen Code repository](https://github.com/QwenLM/qwen-code)

Si Qwen no inicia o no aparecen modelos, ejecuta `/doctor` dentro de Qwen Code, completa `/auth`, verifica `qwen --version` y comprueba la ruta del CLI de Qwen en los settings de Grimoire.

### OpenCode

Elige OpenCode para un agent model-agnostic con su propia provider configuration.

```bash
curl -fsSL https://opencode.ai/install | bash
opencode
```

Homebrew, npm, bun y package-manager installs también funcionan. Configura tus provider credentials en OpenCode y luego actívalo en Grimoire.

- [OpenCode download](https://opencode.ai/download)
- [OpenCode provider docs](https://opencode.ai/docs/providers)
- [OpenCode config docs](https://opencode.ai/docs/config)

Dentro de Grimoire, OpenCode corre sobre ACP con Grimoire-managed launch artifacts, además de persistent runtime, native history, plan mode, image input, provider commands y reasoning effort. Muestra monthly spend cuando hay cost metadata disponible.

### MiMoCode

MiMoCode (Xiaomi) es un fork de OpenCode con memoria persistente, gestión inteligente de contexto y orquestación de subagentes.

```bash
curl -fsSL https://mimo.xiaomi.com/install | bash
mimo
```

Homebrew, npm, bun y package-manager installs también funcionan. Configura tus provider credentials en MiMoCode y luego actívalo en Grimoire.

- [MiMoCode GitHub](https://github.com/XiaomiMiMo/MiMo-Code)

Dentro de Grimoire, MiMoCode corre sobre ACP con persistent runtime, native history, plan mode, image input, provider commands y reasoning effort.

### Kimi Code

Kimi Code CLI (MoonshotAI) es un agente terminal multi-proveedor que soporta modelos Kimi, OpenAI, Anthropic, Gemini y Vertex AI.

```bash
curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash
kimi
```

Configura tus provider credentials en Kimi Code y luego actívalo en Grimoire.

- [Kimi Code GitHub](https://github.com/MoonshotAI/kimi-code)

Dentro de Grimoire, Kimi Code corre sobre ACP con persistent runtime, native history, plan mode, image input, provider commands y reasoning effort.

### Grok Build

Elige Grok Build para el agentic CLI de xAI en Obsidian. Inicia sesión con OAuth de Grok o usa una clave de API de xAI.

```bash
grok
```

Instala la Grok CLI de xAI, autentícate con grok.com OAuth o configura API keys, y luego activa Grok Build en Grimoire.

- [Documentación de Grok Build](https://docs.x.ai/build/overview)
- [Grok 4.5](https://docs.x.ai/developers/grok-4-5)
- [Uso y límites](https://docs.x.ai/grok/faq)

Grok 4.5 es actualmente el modelo predeterminado de Grok Build. Grimoire obtiene el catálogo de modelos disponible desde la cuenta autenticada del CLI de Grok en lugar de mantener una lista estática, por lo que la disponibilidad puede variar según la cuenta y la versión del CLI y actualizarse automáticamente.

Dentro de Grimoire, Grok Build corre sobre ACP via `grok agent stdio` con Grimoire-managed launch artifacts bajo `.grimoire/grok/`, persistent runtime, native JSONL history hydration, plan mode, image input, provider commands, reasoning effort en native models, rewind y fork. Con OAuth, Grimoire muestra el límite semanal compartido de Grok, la hora de reinicio y los Extra Usage Credits disponibles; API spend se agrega desde session cost metadata cuando se reporta.

## Tu primer chat

1. Elige un provider y un model en el composer.
2. Configura reasoning effort y elige Safe, Auto-approve o Plan en el permission control.
3. Menciona las notas, carpetas o context que quieras incluir en scope.
4. Envía el turn.
5. Observa tool calls, usage y output en el panel.

## Features

### Chat workspace

Un panel lateral enfocado con múltiples tabs. Cada tab conserva su propio draft, provider, model, context y runtime. Cierra y vuelve a abrir Obsidian y tus sessions regresan, con provider, model y reasoning effort preservados en cada response. Rewind y fork aparecen cuando el provider activo los soporta. Auto-scroll se aparta en cuanto haces scroll para leer. Tras 10 segundos sin salida visible, un wait indicator compartido muestra el provider activo y el tiempo transcurrido; se pausa mientras espera una pregunta o permission.

### Controles de tabs, historial y navegación

Haz clic derecho en un tab para renombrarlo, duplicarlo, cerrarlo, cerrar los demás o cerrar los tabs a su derecha. El clic central cierra un tab y la acción Undo temporal lo restaura con su draft y posición. Abre una conversación guardada en un tab nuevo desde el historial mediante su acción, modifier-click o clic central. Las conversaciones largas incluyen un navegador de cinco direcciones: inicio, prompt anterior, directorio de conversación, prompt siguiente y final. Los mensajes completados muestran un completion timestamp localizado junto a la copy action.

<p align="center">
  <img src="../../assets/readme/conversation-history.png" alt="Historial de conversaciones y navegación por pestañas de Grimoire" width="100%">
</p>

### Parallel workers, settings y composer

La tarjeta de aprobación **Parallel workers** muestra el model heredado y permite elegir solo las tareas propuestas que se iniciarán. Settings usa la búsqueda nativa de Obsidian y conserva una entrada permanente What's New. Provider settings y composer ofrecen una superficie coherente entre providers, manteniendo donde corresponde los controls y la configuración propios de cada provider.

### Atajos de teclado

| Atajo | Acción |
| --- | --- |
| `Enter` | Envía el turn actual. Se desactiva cuando **Send only with button** está activado. |
| `Shift+Enter` | Inserta una nueva línea en el composer. |
| `Shift+Tab` | Recorre los permission modes: `Safe -> Auto-approve -> Plan -> Safe`. Los providers sin Plan mode alternan entre Safe y Auto-approve. |
| `Escape` | Detiene la response activa o cierra el panel de chat history abierto. |

### Model selector

Un solo picker, agrupado por provider y ordenado por label: Antigravity, Claude Code, Codex, Gemini CLI (Legacy), Grok Build, Kimi Code, MiMoCode, OpenCode y Qwen Code. Search funciona sobre labels, descriptions, groups y model IDs. Catalogs carga lazily y recuerda qué groups colapsaste. Añade custom aliases y context-window overrides en settings. Los variants 1M de Claude son opciones extra, no reemplazos de los base models.

### Usage y cost

Un badge junto al model selector mantiene visible el usage del provider activo. Dentro del model menu hay readouts completos: quota windows cuando el provider los expone, spend cuando solo hay cost disponible. Los últimos valores buenos se mantienen durante un refresh o un fallo, así que el meter no se borra de golpe. Puedes apagar todo en settings si quieres un UI más silencioso.

| Provider | De dónde viene usage |
| --- | --- |
| Claude Code | SDK rate-limit events, `.grimoire/claude/statusline-usage.json` opcional y SDK result cost metadata |
| Codex | Account rate-limit notifications y `account/rateLimits/read` cuando está disponible |
| Antigravity CLI | Aún no disponible de forma fiable desde `agy --print` |
| Gemini CLI (Legacy) | ACP cost metadata cuando Gemini CLI lo informa; solo legacy provider |
| Qwen Code | ACP token y cost metadata cuando Qwen Code lo informa |
| OpenCode | Monthly spend agregado desde ACP y session cost metadata |
| MiMoCode | Monthly spend agregado desde ACP y session cost metadata |
| Kimi Code | Monthly spend agregado desde ACP y session cost metadata |
| Grok Build | Límite semanal compartido de Grok, hora de reinicio y Extra Usage Credits mediante OAuth; monthly API spend desde session cost metadata |

### Plan mode

Cuando el provider activo soporta Plan mode, puedes activarlo de dos formas:

- Haz clic en el permission control del composer hasta que cambie a Plan: `Safe -> Auto-approve -> Plan`.
- Pulsa `Shift+Tab` para recorrer el ciclo completo: `Safe -> Auto-approve -> Plan -> Safe`.

Plan mode pide al provider que planifique antes de empezar a hacer cambios. En el composer usa el mismo permission control que Safe y Auto-approve, así que el modo activo sigue visible mientras trabajas.

Cuando un provider termina de planificar, Grimoire muestra una tarjeta Plan complete plegable con el plan renderizado, las permissions solicitadas y filas cómodas para teclado. Approve continúa en la misma session; feedback mantiene Plan mode activo para que el provider pueda revisar el plan.

### Context y mentions

Menciona vault notes y folders directamente desde el composer, trae la current o linked note y añade persistent external context paths en settings. Pega o arrastra imágenes cuando el provider acepta image input. Menciona MCP servers donde la provider integration lo soporte. La pestaña Context muestra la nota vinculada, model, permission mode, archivos fijados, launch artifacts como `.grimoire/grok/system.md` y archivos que el agent cargó durante la session.

### Inline editing

Ejecuta "Grimoire: Inline edit" sobre una selección. Un prompt se abre junto al texto, el edit vuelve como diff para accept o reject, y pasa por el provider-backed inline edit service. Maneja reemplazo de una selection e inserción de nuevo texto.

### Clarifying questions

Cuando un provider pide structured user input, Grimoire pausa el turn y muestra la pregunta sobre el composer. Claude Code expone esto como `AskUserQuestion`; Codex app-server expone una superficie experimental `request_user_input` / `requestUserInput`; Qwen Code entrega metadata de permisos ACP. Grimoire normaliza esos mecanismos provider-specific en el mismo inline question UI. Las respuestas single-select, multi-select y freeform vuelven al provider run para que el agent continúe sin otro chat message.

### Commands

Built-in commands cubren workflows de Grimoire como image generation y resume. Providers que exponen sus propios commands, como Claude Code slash commands, OpenCode, Grok Build y Qwen Code runtime commands, los muestran mediante provider-owned catalogs. Oculta los que no uses desde settings.

### Image generation

Pega o arrastra imágenes para adjuntarlas. El command built-in `/image [prompt]` no llama ninguna image API por sí mismo. Envía un turn normal al provider activo con instrucciones para usar lo que hayas configurado para image generation: provider-native tooling, MCP tools o local command. El agent guarda el resultado en tu vault y devuelve un embed como `![[path/to/image.png]]`. Si no hay image generation configurado, recibes una respuesta simple explicando qué falta.

### Safety y permissions

Permission modes pertenecen al provider, así que Grimoire los muestra mediante shared composer controls en vez de reinventarlos. El permission control y `Shift+Tab` recorren Safe, Auto-approve y Plan cuando el active provider soporta plan mode. Safe mode y permission prompts permanecen visibles mientras trabajas. Bang-bash mode solo aparece cuando un enabled provider lo ofrece. Trata configured MCP servers, shell access y API keys como sensitive, porque lo son.

### Debug logging

Apagado por defecto. Si lo activas, Grimoire escribe JSONL sanitized en `.grimoire/logs/YYYY-MM-DD.jsonl`, con prompts, answers, note contents, paths, environment values y secrets redacted. Sirve para diagnosticar provider/runtime issues, no para conservar un transcript.

### Settings

General settings cubre auto-scroll, title generation, usage indicators, debug logging, locale, tabs y qué provider controla la settings view. Per-provider tabs gestionan CLI paths, model behavior, commands, agents, skills y provider-owned config cuando existe. También puedes definir project workspace environment variables, scoped per provider.

<p align="center">
  <img src="../../assets/readme/settings-general.png" alt="Configuración general de Grimoire" width="100%">
</p>

## Dónde guarda datos Grimoire

| Path | Qué contiene |
| --- | --- |
| `.grimoire/grimoire-settings.json` | App settings plus provider configuration |
| `.grimoire/sessions/*.meta.json` | Session metadata |
| `.grimoire/logs/YYYY-MM-DD.jsonl` | Opt-in sanitized debug logs |
| `.grimoire/claude/statusline-usage.json` | Claude usage snapshot para el plan meter |
| `.grimoire/grok/` | Grok Build launch artifacts, managed config y session pointers |

Provider-native files bajo `.claude/`, `.codex/`, `.opencode/` y `.grimoire/grok/` se leen y escriben en su lugar, así que tu provider setup sigue siendo portable fuera de Grimoire.

## Privacy

Grimoire corre dentro de Obsidian, en tu máquina. No tiene backend, no añade telemetry y nunca sube tus prompts, answers, notes, files, tool output, API keys o usage logs a ningún Grimoire service. Los únicos logs que escribe son los optional sanitized debug logs de arriba, y se quedan en tu vault.

Lo que Grimoire no puede ocultar es el provider en sí. El CLI que actives recibe el prompt, el context seleccionado y los files, images, tool output y commands que necesita una request. Ese CLI puede hablar con Anthropic, OpenAI, Google, tus OpenCode vendors configurados, MCP servers o cualquier otro destino configurado. Terms, retention, billing, rate limits y privacy policies pertenecen al provider, no a Grimoire. El trabajo de Grimoire es hacer visible ese límite y mantenerlo bajo tu control dentro de Obsidian.

Para un resumen orientado a la política de Obsidian sobre el uso de red, requisitos de cuenta, acceso a archivos externos, registro y telemetry, consulta [DISCLOSURES.md](../../DISCLOSURES.md).

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

Antes de publicar o hacer push de cambios UI/provider significativos, ejecuta el full local gate:

```bash
npm run test -- --selectProjects unit
npm run typecheck
npm run lint
npm run build:release
```

`npm run build:release` actualiza generated `main.js`, root `styles.css` y `dist/grimoire`.

npm es el canonical package manager para development, CI y releases. Mantén `package-lock.json` actualizado cuando cambien las dependencies; los secondary package-manager lockfiles no se committean intencionalmente.

Las contribuciones son bienvenidas. Lee [CONTRIBUTING.md](../../CONTRIBUTING.md) antes de abrir un pull request: explica las expectativas de arquitectura, seguridad, pruebas y revisión.

## Releases

Grimoire releases se publican desde semver tags como `1.0.0`. El release workflow ejecuta el local gate, construye el Obsidian bundle, verifica que el tag coincida con `package.json` y `manifest.json`, y adjunta `main.js`, `manifest.json` y `styles.css` al GitHub Release.

Obsidian Community plugins es la ruta de instalación recomendada para usuarios. GitHub Releases sigue incluyendo los bundle assets para instalación manual y BRAT. Usa `main` para releasable development y publica con un tag que coincida con la manifest version.

## Roadmap

Hoy Grimoire se entrega con Claude Code, Codex, Antigravity CLI, Gemini CLI (Legacy), OpenCode, MiMoCode, Kimi Code, Grok Build y Qwen Code.

Lo siguiente: GitHub Copilot CLI, otros ACP-compatible providers y local model CLIs cuando su runtime sea lo bastante estable para integrarse en Obsidian. Las implementation notes viven en [docs/provider-roadmap.md](../provider-roadmap.md).

## Licencia

MIT. Consulta [LICENSE](../../LICENSE).
