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
  <img src="../../assets/readme/chat-workspace.png" alt="Ocean Atlas en Obsidian junto a un chat Codex Astra High sobre capas oceánicas, corrientes y vida marina" width="100%">
</p>

<p align="center">
  <sub>Una nota real y una conversación basada en sus enlaces.</sub>
</p>

Grimoire lleva asistentes CLI agentic a Obsidian. Codex, Claude Code, Antigravity CLI, Gemini CLI (Legacy), OpenCode, MiMoCode, Kimi Code, Grok Build, Qwen Code, Devin, Pi, Reasonix y Command Code viven en un solo panel lateral: leen tus notas, editan archivos, ejecutan comandos, llaman tools y conservan session history contra tu vault real. Nada pasa por un servidor de Grimoire. No hay telemetry, hosted backend ni proxy entre tú y tu provider.

Está diseñado para quienes ya trabajan en Obsidian y quieren ayuda de IA que se sienta como parte del vault: contexto local, archivos locales, un provider elegido a propósito y usage/cost visibles dentro de la interfaz.

> El [README](../../README.md) en inglés es el canonical document del proyecto. Esta traducción se mantiene junto con la documentación actual del producto.

## Por qué Grimoire

- Usa los CLI agents en los que ya confías, directamente dentro de tus notas.
- Cambia de provider desde el composer. Codex, Claude Code, Antigravity CLI, Gemini CLI (Legacy), OpenCode, MiMoCode, Kimi Code, Grok Build, Qwen Code, Devin, Pi, Reasonix y Command Code comparten un model picker.
- Ancla cada turn en tu vault. Menciona notas, carpetas y MCP tools sin pegar paths a mano.
- Ve cost y limits junto al selector de modelo, justo donde tomas la decisión.
- Mantén un flujo local-first. Grimoire no recopila telemetry, no proxifica prompts y no ejecuta un backend.

## Qué puede hacer cada provider

| Función | Codex | Claude Code | OpenCode | Grok Build | MiMoCode | Kimi Code | Antigravity CLI | Gemini CLI (Legacy) | Qwen Code | Devin | Reasonix | Command Code | Pi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Entorno local persistente | Sí | Sí | Sí | Sí | Sí | Sí | No | Sí | Sí | Sí | Sí | No | Sí |
| Restauración del historial nativo | Sí | Sí | Sí | Sí | Sí | Sí | No | Sí | No | No | No | No | Sí |
| Modo de planificación | Sí | Sí | Sí | Sí | Sí | Sí | No | Sí | Sí | Sí | Sí | No | No |
| Imágenes adjuntas | Sí | Sí | Sí | No | Sí | Sí | Archivos | Sí | Sí | Sí | Archivos (opcional) | Archivos (opcional) | Sí |
| Modo de instrucciones | Sí | Sí | Sí | Sí | Sí | Sí | No | Sí | Sí | Sí | Sí | No | No |
| Control del esfuerzo de razonamiento | Sí | Sí | Sí | Sí | Sí | Sí | Sí | Sí | Sí | No | Sí | Sí (según el modelo) | Sí (según el modelo) |
| Retroceso | No | Sí | No | Sí | No | No | No | No | No | No | No | No | No |
| Bifurcación | Sí | Sí | No | Sí | No | No | No | No | No | No | No | No | No |
| Comandos slash del proveedor | No | Sí | Sí | Sí | Sí | Sí | No | Sí | Sí | Sí | Sí | No | Sí |
| Gestión de MCP en Grimoire | No | Sí | Sí | Sí | Sí | Sí | No | Sí | Sí | Sí | Sí | No | No |

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

Para la mejor experiencia en Grimoire, empieza con Codex, Claude Code, OpenCode, MiMoCode, Kimi Code, Grok Build o Qwen Code. Estos providers exponen hoy los runtime surfaces más sólidos para trabajo vault-native: persistent sessions, plan-oriented workflows, tool activity y model controls ricos.

Antigravity CLI y Gemini CLI (Legacy) siguen disponibles para Google accounts y casos de compatibility, pero hoy no se recomiendan como providers principales de Grimoire. Grimoire los soporta en modo best-effort y ya implementamos los fallbacks que sus CLIs actuales permiten, pero sus ACP y runtime surfaces tienen limitaciones técnicas: sessions, approvals, streaming, tool/edit metadata, model discovery y usage reporting son incompletos o poco fiables comparados con los providers recomendados.

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

### Claude Code

Elige Claude Code si quieres su native project memory, slash commands, MCP configuration, plans, rewind/fork y trabajo respaldado por tu Claude subscription o API key.

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude
```

Autentícate con Claude Code y luego actívalo en Grimoire. El antiguo npm package está deprecated; usa el native installer anterior, Homebrew (`brew install --cask claude-code`), WinGet u otras opciones del official quickstart.

- [Claude Code quickstart](https://code.claude.com/docs/en/quickstart)

Dentro de Grimoire, Claude Code lee y conserva tus archivos `.claude/`, corre sobre Claude Code SDK y soporta slash commands, MCP settings, agents, skills, plans, rewind y fork. Cuando Claude reporta ambos datos, verás quota windows y API spend lado a lado.

**Respetar la configuración de Claude Code** está activado de forma predeterminada. Grimoire lee `model` y `env` de la configuración de usuario (`~/.claude/settings.json`) y de la bóveda (`.claude/settings.json`) y los aplica al selector de modelos Claude y al entorno de ejecución. Esto permite usar modelos personalizados de Claude Code, incluidas pasarelas compatibles con Anthropic como MiniMax y Z.ai. La configuración del proyecto prevalece sobre la del usuario, y las variables de entorno definidas explícitamente en Grimoire prevalecen sobre ambas.

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

Antigravity CLI es el reemplazo de Google para el uso consumer de Gemini CLI y puede acceder a Gemini, Claude, GPT-OSS y otras familias de modelos disponibles para tu Antigravity account. Dentro de Grimoire, trátalo como compatibility provider, no como el default recomendado.

```bash
agy
```

Instala la Antigravity CLI oficial de Google, autentícala localmente y luego activa Antigravity en Grimoire. Grimoire detecta `agy` automáticamente desde PATH, o puedes definir un custom CLI path en provider settings.

- [Antigravity CLI](https://antigravity.google/product/antigravity-cli)
- [Gemini CLI migration guide](https://goo.gle/gemini-cli-migration)

Dentro de Grimoire, Antigravity corre mediante `agy --print`, con model selection opcional desde `agy models`. Es una integración best-effort porque `agy` todavía no expone a Grimoire un runtime ACP-compatible sólido. Persistent sessions, native history, plan mode, streaming, approval-safe file edits, reliable usage reporting y auxiliary workflows permanecen desactivados o limitados hasta que Antigravity exponga runtime surfaces estables. Las imágenes se pasan como archivos temporales y deben adjuntarse de nuevo en los mensajes posteriores.

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

- [Documentación de Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/)
- [Autenticación de Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/)
- [Qwen Code repository](https://github.com/QwenLM/qwen-code)

Si Qwen no inicia o no aparecen modelos, ejecuta `/doctor` dentro de Qwen Code, completa `/auth`, verifica `qwen --version` y comprueba la ruta del CLI de Qwen en los settings de Grimoire.

### Devin

Devin CLI (Cognition) es un provider ACP opcional. Grimoire ejecuta `devin acp`, descubre los models y modes que ofrece tu cuenta desde la session en vivo, transmite mensajes, razonamiento y tool activity, pregunta antes de ejecutar shell commands y de escribir archivos, y reanuda sessions de forma nativa. La lista de models depende de la cuenta con la que inicies sesión; eso lo decide Devin, no Grimoire.

```bash
# macOS, Linux, WSL
curl -fsSL https://cli.devin.ai/install.sh | bash

# Homebrew
brew install --cask devin-cli

devin auth login
devin --version
```

Inicia sesión con `devin auth login` (se abre el navegador) y luego activa Devin en Grimoire. Safe, Auto-approve y Plan corresponden a `accept-edits`, `bypass` y `plan` de Devin; sus modos `smart` y `ask` se muestran como Safe en la barra compartida.

- [Documentación de Devin CLI](https://docs.devin.ai/cli)
- [Documentación ACP de Devin](https://docs.devin.ai/desktop/acp)

Algo que conviene saber sobre el modo Safe: Devin decide por su cuenta qué shell commands son de solo lectura y los ejecuta sin preguntar, y `echo` cuenta como tal aunque redirija a un archivo. Grimoire aprueba cada escritura que Devin hace por el protocolo, pero una escritura que el agente enruta por su propia shell puede escaparse. Para una session que no debe escribir, usa Plan.

Devin gestiona sus credenciales en `~/.local/share/devin/`. Las skills del vault se leen de `.devin/skills` y `.agents/skills`, y una skill es el slash command de Devin. Grimoire mantiene una lista MCP propia en `.grimoire/mcp/devin.json` y la inyecta en la session ACP. El uso aparece cuando Devin lo informa; no hay control de reasoning effort porque el effort forma parte del id del model. Devin no admite fork ni rewind en Grimoire.


### Reasonix

Reasonix es un agente de programación de código abierto y multimodelo, y aquí un proveedor ACP opcional. Grimoire lanza `reasonix acp`, lee los modelos y modos de la sesión viva, transmite mensajes, razonamiento, actividad de herramientas y planes, pregunta antes de las herramientas con permiso y de las escrituras de archivos, y reanuda sesiones de forma nativa. Qué modelos ofrece una sesión depende de los bloques de proveedor de tu configuración de Reasonix; eso es de Reasonix, no de Grimoire.

```bash
# npm
npm i -g reasonix

# Homebrew
brew install esengine/reasonix/reasonix

reasonix setup
reasonix --version
```

Ejecuta `reasonix setup` para configurar un proveedor de modelos y sus credenciales, y luego activa Reasonix en Grimoire. Reasonix guarda dos ajustes donde otros proveedores guardan uno: el modo de sesión (`normal`, `plan`, `goal`) y una postura de aprobación de herramientas aparte (`ask`, `auto`, `yolo`). La barra de Grimoire controla ambos. Safe es `normal` preguntando, Plan es `plan` preguntando y Auto-approve es `normal` en `yolo`; `goal` es propio de Reasonix y se muestra como Safe. Como la postura es lo único que separa Safe de Auto-approve, un turno que no pueda fijarla se rechaza en lugar de ejecutarse en silencio en la más laxa.

Reasonix también hace preguntas, no solo pide permisos: su herramienta `ask` llega por el mismo canal y se dibuja como una tarjeta cuya descripción es la pregunta y cuyas opciones numeradas son las respuestas. Elige una por su número; `Enter` no hace nada en una tarjeta con varias respuestas, así que una pulsación por costumbre no decide por ti.

El esfuerzo de razonamiento es un selector alimentado por la sesión, no una lista fija. Qué niveles acepta un modelo lo decide el bloque de proveedor que lo sirve: uno que declara `supported_efforts` ofrece Disabled, Low, High y Max; uno sin él recibe el conjunto integrado de su tipo. Grimoire lee lo que ofrece la sesión abierta y pone Auto al frente, lo que deja la elección a Reasonix. Un nivel que la sesión nunca ofreció no se envía nunca, porque la CLI lo rechaza contra el modelo.

- [Documentación de Reasonix](https://reasonix.io/docs/)
- [Reasonix en GitHub](https://github.com/esengine/DeepSeek-Reasonix)

Algo que conviene saber sobre Safe: `ask` protege las herramientas que Reasonix clasifica como sujetas a permiso, no todas, así que un comando de shell que juzga de solo lectura puede ejecutarse sin preguntar. Grimoire aprueba cada escritura de archivo que Reasonix hace por el protocolo, y eso es lo que mantiene el vault detrás de una pregunta. Para una sesión que no debe escribir, usa Plan.

Reasonix mantiene su configuración en `~/.reasonix/config.toml` y lee las claves de API del entorno con los nombres que ese archivo indica. Las habilidades del vault se leen de `.reasonix/skills` y `.agents/skills`. Grimoire gestiona una lista MCP de proyecto aislada en `.grimoire/mcp/reasonix.json` y la inyecta en las sesiones ACP. El uso viene de las notificaciones de estado de Reasonix, y el coste aparece solo si tu proveedor de modelos tiene precio. No se admiten fork ni rewind.

Activa **Image attachments as files** para enviar imágenes mediante archivos en `.grimoire/attachments/`. Se necesitan un modelo compatible con imágenes y una herramienta de lectura de archivos; leerlos requiere una llamada adicional. Si falta un archivo o no se puede escribir, el envío falla. La opción está desactivada por defecto.

### Pi

Instala ambas herramientas por separado. El adaptador requiere **Node.js 22+** y **Pi 0.80.4+**.

1. Instala Pi siguiendo las [instrucciones oficiales](https://pi.dev/docs/latest). En macOS y Linux:

   ```bash
   curl -fsSL https://pi.dev/install.sh | sh
   ```

   Como alternativa, con npm:

   ```bash
   npm install -g --ignore-scripts @earendil-works/pi-coding-agent
   ```

2. Instala el adaptador siguiendo sus [instrucciones de instalación global](https://github.com/svkozak/pi-acp#global-install):

   ```bash
   npm install -g pi-acp
   ```

3. Abre la configuración de Pi en el terminal y configura tu proveedor de modelos o las claves API:

   ```bash
   pi-acp --terminal-login
   ```

4. Reinicia Obsidian, activa **Pi** en **Configuración → Grimoire → Proveedores** y pulsa **Refresh all models**. `pi` y `pi-acp` deben estar disponibles en el `PATH`. Si falla la detección, introduce la ruta absoluta de `pi-acp` en **Adapter path**; si hace falta, añade `PI_ACP_PI_COMMAND=/absolute/path/to/pi` en **Environment variables** de Pi.

Grimoire inicia el adaptador; no necesitas configurar Zed ni ejecutar un servidor de adaptador separado.

Ambos ejecutables siguen siendo dependencias externas. Grimoire descubre los modelos y niveles de razonamiento de Pi, transmite respuestas y actividad de herramientas, envía imágenes de forma nativa y reanuda sesiones guardadas. El selector compartido conserva la selección y los alias al actualizar.

**Limitación de los niveles de razonamiento (pi-acp 0.0.33):** el menú solo ofrece niveles que el adaptador puede aplicar al modelo elegido. Por ejemplo, Pi admite `low`, `high` y `max` para GLM-5.3, pero el adaptador rechaza `max`, por lo que Grimoire ofrece `low`, `high` y **Pi default**. `xhigh` no sustituye a `max`. La [PR #73](https://github.com/svkozak/pi-acp/pull/73) propone añadir `max`; la [PR #125](https://github.com/svkozak/pi-acp/pull/125) propone descubrir los niveles reales del modelo seleccionado. A fecha de 2026-09-21, ambas seguían abiertas y sin fusionar; las correcciones propuestas no forman parte de la versión probada del adaptador.

Pi gestiona los permisos de herramientas: puede leer, escribir y ejecutar comandos sin preguntar. Grimoire muestra las solicitudes de las extensiones, pero no ofrece modos Safe ni Plan. MCP, habilidades y plantillas de prompts se configuran en Pi. Los archivos se leen del disco; el adaptador no proporciona texto sin guardar del editor, cuotas de cuenta ni ocupación del contexto. Probado con Pi 0.86.1 y pi-acp 0.0.33.

### Command Code

Command Code se activa de forma opcional. Instálalo e inicia sesión desde un terminal y actívalo en Configuración → Grimoire → Proveedores:

```bash
npm i -g command-code
command-code login
```

La CLI instalada proporciona los niveles de esfuerzo de razonamiento del modelo seleccionado. El selector solo ofrece los niveles compatibles y la opción predeterminada de la CLI; los modelos sin esfuerzo ajustable no muestran selector. Las elecciones explícitas se aplican a la ejecución actual mediante la API nativa de modificación de sesión, sin cambiar la configuración global de la CLI. La opción predeterminada conserva el comportamiento nativo, incluido el esfuerzo guardado en una sesión reanudada.

Grimoire transmite respuestas y actividad de herramientas desde la salida JSON de la CLI sin interfaz, descubre modelos con `--list-models` y guarda el ID nativo de sesión para reanudarla explícitamente tras una recarga. La autenticación, configuración, habilidades, MCP y transcripciones permanecen en Command Code. El uso del contexto compara los tokens de entrada comunicados con un límite estimado o definido por el usuario; no se deducen cuotas de cuenta ni precios.

Activa **Image attachments as files** para enviar imágenes mediante archivos en `.grimoire/attachments/`. Se necesitan un modelo compatible con imágenes y una herramienta de lectura de archivos; leerlos requiere una llamada adicional. Si falta un archivo o no se puede escribir, el envío falla. La opción está desactivada por defecto.

**Safe** pausa ediciones, comandos y otras herramientas que no sean de solo lectura hasta recibir una aprobación puntual en Grimoire. Un rechazo, cancelación o pérdida de conexión con el mecanismo de aprobación impide la ejecución. Safe requiere actualmente la instalación npm verificada de Command Code 1.53.0 / 1.66.0 y desactiva los subagentes nativos, cuyos bucles independientes no pueden usar este mecanismo. **Auto-approve** funciona sin solicitudes de Grimoire; las reglas nativas de denegación y confirmación siguen vigentes en ambos modos. Esta integración no ofrece preguntas interactivas, controles de planificación, comandos slash, MCP/habilidades/agentes administrados, tareas auxiliares, bifurcación, retroceso ni importación del historial nativo.

- [Documentación del modo sin interfaz de Command Code](https://commandcode.ai/docs/headless)

### OpenCode

Elige OpenCode para un agent model-agnostic con su propia provider configuration.

```bash
curl -fsSL https://opencode.ai/install | bash
opencode
```

Homebrew, npm, bun y package-manager installs también funcionan. Configura tus provider credentials en OpenCode y luego actívalo en Grimoire.

- [Descargar OpenCode](https://opencode.ai/download)
- [Documentación de proveedores de OpenCode](https://opencode.ai/docs/providers)
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

## Funciones

### Espacio de trabajo del chat

Un panel lateral enfocado con múltiples tabs. Cada tab conserva su propio draft, provider, model, context y runtime. Cierra y vuelve a abrir Obsidian y tus sessions regresan, con provider, model y reasoning effort preservados en cada response. Rewind y fork aparecen cuando el provider activo los soporta. Auto-scroll se aparta en cuanto haces scroll para leer. Tras 10 segundos sin salida visible, un wait indicator compartido muestra el provider activo y el tiempo transcurrido; se pausa mientras espera una pregunta o permission.

### Pestañas, historial y navegación

Abre el menú de acciones de una pestaña o haz clic derecho para renombrar, duplicar o cerrar pestañas. El clic central cierra una pestaña; Deshacer recupera su borrador y posición. Busca chats anteriores en el historial emergente y abre conversaciones en pestañas nuevas. El historial distingue los títulos manuales de los generados. La barra de conversación ofrece controles de navegación y un índice; las respuestas terminadas muestran su hora de finalización.

<p align="center">
  <img src="../../assets/readme/conversation-history.png" alt="Búsqueda del historial con tres conversaciones Ocean Atlas, sus modelos y el origen de sus títulos" width="100%">
</p>

### Agentes en paralelo, configuración y editor de mensajes

La tarjeta de aprobación **Parallel workers** muestra el model heredado y permite elegir solo las tareas propuestas que se iniciarán. Settings usa la búsqueda nativa de Obsidian y conserva una entrada permanente What's New. Provider settings y composer ofrecen una superficie coherente entre providers, manteniendo donde corresponde los controls y la configuración propios de cada provider.

### Atajos de teclado

| Atajo | Acción |
| --- | --- |
| `Enter` | Envía el turn actual. Se desactiva cuando **Send only with button** está activado. |
| `Shift+Enter` | Inserta una nueva línea en el composer. |
| `Shift+Tab` | Recorre los permission modes: `Safe -> Auto-approve -> Plan -> Safe`. Los providers sin Plan mode alternan entre Safe y Auto-approve. |
| `Escape` | Detiene la respuesta activa o cierra el historial emergente. |

### Selector de modelos

Un solo picker, agrupado por provider y ordenado por label: Antigravity, Claude Code, Codex, Command Code, Devin, Gemini CLI (Legacy), Grok Build, Kimi Code, MiMoCode, OpenCode, Pi, Qwen Code y Reasonix. Search funciona sobre labels, descriptions, groups y model IDs. Catalogs carga lazily y recuerda qué groups colapsaste. Añade custom aliases y context-window overrides en settings. Los variants 1M de Claude son opciones extra, no reemplazos de los base models.

OpenCode, MiMoCode, Kimi Code, Grok Build, Command Code y Pi comparten el selector de modelos en los ajustes: filas seleccionadas con alias, catálogo con búsqueda y **Refresh all models**. La actualización conserva la selección y los alias; los filtros de proveedor aparecen cuando la CLI facilita sus nombres.

### Uso y coste

Un badge junto al model selector mantiene visible el usage del provider activo. Dentro del model menu hay readouts completos: quota windows cuando el provider los expone, spend cuando solo hay cost disponible. Los últimos valores buenos se mantienen durante un refresh o un fallo, así que el meter no se borra de golpe. Puedes apagar todo en settings si quieres un UI más silencioso.

| Provider | De dónde viene usage |
| --- | --- |
| Codex | Account rate-limit notifications y `account/rateLimits/read` cuando está disponible |
| Claude Code | SDK rate-limit events, `.grimoire/claude/statusline-usage.json` opcional y SDK result cost metadata |
| Antigravity CLI | Aún no disponible de forma fiable desde `agy --print` |
| Gemini CLI (Legacy) | ACP cost metadata cuando Gemini CLI lo informa; solo legacy provider |
| Qwen Code | ACP token y cost metadata cuando Qwen Code lo informa |
| Devin | Total de créditos de la sesión informado por ACP, como gasto mensual |
| Reasonix | Coste por turno desde sus propias notificaciones de estado, cuando el proveedor de modelos configurado tiene precio |
| Pi | El adaptador pi-acp no lo informa |
| OpenCode | Monthly spend agregado desde ACP y session cost metadata |
| MiMoCode | Monthly spend agregado desde ACP y session cost metadata |
| Kimi Code | Monthly spend agregado desde ACP y session cost metadata |
| Grok Build | Límite semanal compartido de Grok, hora de reinicio y Extra Usage Credits mediante OAuth; monthly API spend desde session cost metadata |

### Modo de planificación

Cuando el provider activo soporta Plan mode, puedes activarlo de dos formas:

- Haz clic en el permission control del composer hasta que cambie a Plan: `Safe -> Auto-approve -> Plan`.
- Pulsa `Shift+Tab` para recorrer el ciclo completo: `Safe -> Auto-approve -> Plan -> Safe`.

Plan mode pide al provider que planifique antes de empezar a hacer cambios. En el composer usa el mismo permission control que Safe y Auto-approve, así que el modo activo sigue visible mientras trabajas.

Cuando un provider termina de planificar, Grimoire muestra una tarjeta Plan complete plegable con el plan renderizado, las permissions solicitadas y filas cómodas para teclado. Approve continúa en la misma session; feedback mantiene Plan mode activo para que el provider pueda revisar el plan.

### Contexto y menciones

Menciona vault notes y folders directamente desde el composer, trae la current o linked note y añade persistent external context paths en settings. Pega o arrastra imágenes cuando el provider acepta image input. Menciona MCP servers donde la provider integration lo soporte. La pestaña Context muestra la nota vinculada, model, permission mode, archivos fijados, launch artifacts como `.grimoire/grok/system.md` y archivos que el agent cargó durante la session.

### Edición en la nota

Ejecuta "Grimoire: Inline edit" sobre una selección. Un prompt se abre junto al texto, el edit vuelve como diff para accept o reject, y pasa por el provider-backed inline edit service. Maneja reemplazo de una selection e inserción de nuevo texto.

### Preguntas aclaratorias

Cuando un provider pide structured user input, Grimoire pausa el turn y muestra la pregunta sobre el composer. Claude Code expone esto como `AskUserQuestion`; Codex app-server expone una superficie experimental `request_user_input` / `requestUserInput`; Qwen Code entrega metadata de permisos ACP. Grimoire normaliza esos mecanismos provider-specific en el mismo inline question UI. Las respuestas single-select, multi-select y freeform vuelven al provider run para que el agent continúe sin otro chat message.

### Comandos

Built-in commands cubren workflows de Grimoire como image generation y resume. Providers que exponen sus propios commands, como Claude Code slash commands, OpenCode, Grok Build y Qwen Code runtime commands, los muestran mediante provider-owned catalogs. Oculta los que no uses desde settings.

### Generación de imágenes

Pega o arrastra imágenes para adjuntarlas. El command built-in `/image [prompt]` no llama ninguna image API por sí mismo. Envía un turn normal al provider activo con instrucciones para usar lo que hayas configurado para image generation: provider-native tooling, MCP tools o local command. El agent guarda el resultado en tu vault y devuelve un embed como `![[path/to/image.png]]`. Si no hay image generation configurado, recibes una respuesta simple explicando qué falta.

### Seguridad y permisos

Permission modes pertenecen al provider, así que Grimoire los muestra mediante shared composer controls en vez de reinventarlos. El permission control y `Shift+Tab` recorren Safe, Auto-approve y Plan cuando el active provider soporta plan mode. Safe mode y permission prompts permanecen visibles mientras trabajas. Bang-bash mode solo aparece cuando un enabled provider lo ofrece. Trata configured MCP servers, shell access y API keys como sensitive, porque lo son.

### Registros de depuración

Apagado por defecto. Si lo activas, Grimoire escribe JSONL sanitized en `.grimoire/logs/YYYY-MM-DD.jsonl`, con prompts, answers, note contents, paths, environment values y secrets redacted. Sirve para diagnosticar provider/runtime issues, no para conservar un transcript.

### Configuración

Cuatro pestañas organizan la configuración: **General** para idioma, ubicación del chat, pestañas y visualización; **Proveedores** para activar las CLI y configurar sus modelos; **Avanzado** para contexto, conversaciones, herramientas y diagnóstico; y **Acerca de** para la versión y las novedades. La configuración aparece en la búsqueda nativa de Obsidian.

La vista de proveedores muestra las CLI detectadas y sus interruptores de activación. Debajo aparecen los ajustes del proveedor seleccionado.

<p align="center">
  <img src="../../assets/readme/settings-providers.png" alt="Vista de las doce integraciones CLI de Grimoire y la configuración de modelos Codex" width="100%">
</p>

<details>
<summary>Configuración general</summary>

<p align="center">
  <img src="../../assets/readme/settings-general.png" alt="Configuración de idioma, ubicación del panel, pestañas, etiquetas, desplazamiento y títulos de conversaciones" width="100%">
</p>

</details>

## Dónde guarda datos Grimoire

| Path | Qué contiene |
| --- | --- |
| `.grimoire/grimoire-settings.json` | Configuración de la aplicación y los proveedores |
| `.grimoire/sessions/*.meta.json` | Metadatos de sesiones |
| `.grimoire/logs/YYYY-MM-DD.jsonl` | Registros de depuración depurados y activados de forma opcional |
| `.grimoire/claude/statusline-usage.json` | Claude usage snapshot para el plan meter |
| `.grimoire/grok/` | Grok Build launch artifacts, managed config y session pointers |

Provider-native files bajo `.claude/`, `.codex/`, `.opencode/` y `.grimoire/grok/` se leen y escriben en su lugar, así que tu provider setup sigue siendo portable fuera de Grimoire.

## Privacidad

Grimoire corre dentro de Obsidian, en tu máquina. No tiene backend, no añade telemetry y nunca sube tus prompts, answers, notes, files, tool output, API keys o usage logs a ningún Grimoire service. Los únicos logs que escribe son los optional sanitized debug logs de arriba, y se quedan en tu vault.

Lo que Grimoire no puede ocultar es el provider en sí. El CLI que actives recibe el prompt, el context seleccionado y los files, images, tool output y commands que necesita una request. Ese CLI puede hablar con Anthropic, OpenAI, Google, tus OpenCode vendors configurados, MCP servers o cualquier otro destino configurado. Terms, retention, billing, rate limits y privacy policies pertenecen al provider, no a Grimoire. El trabajo de Grimoire es hacer visible ese límite y mantenerlo bajo tu control dentro de Obsidian.

Para un resumen orientado a la política de Obsidian sobre el uso de red, requisitos de cuenta, acceso a archivos externos, registro y telemetry, consulta [DISCLOSURES.md](../../DISCLOSURES.md).

## Desarrollo

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

## Versiones publicadas

Grimoire releases se publican desde semver tags como `1.0.0`. El release workflow ejecuta el local gate, construye el Obsidian bundle, verifica que el tag coincida con `package.json` y `manifest.json`, y adjunta `main.js`, `manifest.json` y `styles.css` al GitHub Release.

Obsidian Community plugins es la ruta de instalación recomendada para usuarios. GitHub Releases sigue incluyendo los bundle assets para instalación manual y BRAT. Usa `main` para releasable development y publica con un tag que coincida con la manifest version.

## Hoja de ruta

Hoy Grimoire se entrega con Codex, Claude Code, Antigravity CLI, Gemini CLI (Legacy), OpenCode, MiMoCode, Kimi Code, Grok Build, Qwen Code, Devin, Pi, Reasonix y Command Code.

Lo siguiente: GitHub Copilot CLI, otros ACP-compatible providers y local model CLIs cuando su runtime sea lo bastante estable para integrarse en Obsidian. Las implementation notes viven en [docs/provider-roadmap.md](../provider-roadmap.md).

## Licencia

MIT. Consulta [LICENSE](../../LICENSE).
