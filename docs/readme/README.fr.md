# Grimoire

<p align="center">
  <img src="../../assets/readme/grimoire-logo.png" alt="Logo Grimoire" width="240">
</p>

<p align="center">
  <strong>Agents IA local-first pour votre vault Obsidian.</strong>
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="Licence : MIT">
  <img src="https://img.shields.io/github/v/release/sandsaber/Grimoire?label=release" alt="Dernière release">
  <img src="https://img.shields.io/badge/Obsidian-1.13.0%2B-7c3aed" alt="Obsidian 1.13.0+">
  <img src="https://img.shields.io/badge/platform-desktop-lightgrey" alt="Desktop uniquement">
</p>

<p align="center">
  <img src="../../assets/readme/chat-workspace.png" alt="Ocean Atlas dans Obsidian, à côté d’un échange Codex Astra High sur les couches océaniques, les courants et la vie marine" width="100%">
</p>

<p align="center">
  <sub>Une vraie note et une conversation fondée sur ses liens.</sub>
</p>

Grimoire amène les assistants CLI agentiques dans Obsidian. Codex, Claude Code, Antigravity CLI, Gemini CLI (Legacy), OpenCode, MiMoCode, Kimi Code, Grok Build, Qwen Code, Devin, Pi, Reasonix et Command Code vivent dans un même panneau latéral : ils lisent vos notes, modifient des fichiers, lancent des commandes, appellent des tools et gardent l'historique des sessions contre votre vrai vault. Rien ne passe par un serveur Grimoire. Il n'y a pas de telemetry, pas de hosted backend et pas de proxy entre vous et votre provider.

Grimoire est conçu pour les personnes qui travaillent déjà dans Obsidian et veulent une aide IA qui ressemble à une partie du vault : contexte local, fichiers locaux, provider choisi volontairement, et usage/cost visibles dans l'interface.

> Le [README](../../README.md) anglais reste le document canonical du projet. Cette traduction est tenue à jour avec la documentation produit actuelle.

## Pourquoi Grimoire

- Utilisez les CLI agents auxquels vous faites déjà confiance, directement dans vos notes.
- Changez de provider depuis le composer. Codex, Claude Code, Antigravity CLI, Gemini CLI (Legacy), OpenCode, MiMoCode, Kimi Code, Grok Build, Qwen Code, Devin, Pi, Reasonix et Command Code partagent un model picker.
- Ancrez chaque turn dans votre vault. Mentionnez des notes, des dossiers et des MCP tools au lieu de coller des chemins à la main.
- Voyez cost et limits à côté du sélecteur de modèle, là où vous prenez la décision.
- Restez local-first. Grimoire ne collecte pas de telemetry, ne proxy pas vos prompts et ne lance pas de backend.

## Ce que chaque provider peut faire

| Fonctionnalité | Codex | Claude Code | OpenCode | Grok Build | MiMoCode | Kimi Code | Antigravity CLI | Gemini CLI (Legacy) | Qwen Code | Devin | Reasonix | Command Code | Pi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Exécution locale persistante | Oui | Oui | Oui | Oui | Oui | Oui | Non | Oui | Oui | Oui | Oui | Non | Oui |
| Restauration de l’historique natif | Oui | Oui | Oui | Oui | Oui | Oui | Non | Oui | Non | Non | Non | Non | Oui |
| Mode planification | Oui | Oui | Oui | Oui | Oui | Oui | Non | Oui | Oui | Oui | Oui | Non | Non |
| Pièces jointes image | Oui | Oui | Oui | Non | Oui | Oui | Fichiers | Oui | Oui | Oui | Fichiers (sur activation) | Fichiers (sur activation) | Oui |
| Mode instructions | Oui | Oui | Oui | Oui | Oui | Oui | Non | Oui | Oui | Oui | Oui | Non | Non |
| Réglage de l’effort de raisonnement | Oui | Oui | Oui | Oui | Oui | Oui | Oui | Oui | Oui | Non | Oui | Oui (selon le modèle) | Oui (selon le modèle) |
| Retour en arrière | Non | Oui | Non | Oui | Non | Non | Non | Non | Non | Non | Non | Non | Non |
| Bifurcation | Oui | Oui | Non | Oui | Non | Non | Non | Non | Non | Non | Non | Non | Non |
| Commandes slash du fournisseur | Non | Oui | Oui | Oui | Oui | Oui | Non | Oui | Oui | Oui | Oui | Non | Oui |
| Gestion MCP par Grimoire | Non | Oui | Oui | Oui | Oui | Oui | Non | Oui | Oui | Oui | Oui | Non | Non |

## Installation

Grimoire est un plugin desktop. Il pilote vos provider CLIs localement, donc il n'y a pas de mobile build.

### Depuis Community plugins (recommandé)

Installez Grimoire depuis l'annuaire des community plugins Obsidian :

1. Ouvrez Settings, allez dans Community plugins et désactivez Restricted mode s'il est actif.
2. Cliquez Browse, cherchez Grimoire et installez-le.
3. Activez Grimoire, puis ouvrez son panneau depuis le ribbon ou la command palette.

### Depuis GitHub Releases

Si vous ne pouvez pas utiliser Community plugins, installez la release actuelle manuellement :

1. Téléchargez `main.js`, `manifest.json` et `styles.css` depuis la dernière [release Grimoire](https://github.com/sandsaber/Grimoire/releases/latest).
2. Créez `/path/to/your/vault/.obsidian/plugins/grimoire`.
3. Placez les trois fichiers dans ce dossier.
4. Activez Grimoire dans Settings, Community plugins.

### Avec BRAT

BRAT peut installer Grimoire depuis GitHub Releases si vous souhaitez suivre les tagged builds hors de l'annuaire community plugins :

1. Installez le plugin "Obsidian42 - BRAT".
2. Dans BRAT, ajoutez un beta plugin depuis `sandsaber/Grimoire`.
3. Activez Grimoire.

### Depuis les sources

Construisez le release bundle et placez-le dans votre vault :

```bash
npm install
npm run build:release

mkdir -p /path/to/your/vault/.obsidian/plugins/grimoire
cp dist/grimoire/main.js dist/grimoire/manifest.json dist/grimoire/styles.css \
  /path/to/your/vault/.obsidian/plugins/grimoire/
```

Activez ensuite Grimoire depuis Settings, Community plugins.

Quel que soit le chemin choisi, installez au moins un CLI provider avant de commencer. Grimoire enveloppe les provider CLIs ; il ne remplace pas leur account setup, model access, quotas ou terms.

## Configurer un provider

Activez les providers voulus dans Settings, Grimoire, Providers, et ils apparaîtront dans le model selector. Codex est activé au premier lancement ; les autres providers sont opt-in.

### Providers recommandés

Pour la meilleure expérience Grimoire, commencez avec Codex, Claude Code, OpenCode, MiMoCode, Kimi Code, Grok Build ou Qwen Code. Ces providers exposent aujourd'hui les runtime surfaces les plus solides pour le travail vault-native : persistent sessions, plan-oriented workflows, tool activity et model controls riches.

Antigravity CLI et Gemini CLI (Legacy) restent disponibles pour les Google accounts et les cas de compatibility, mais ils ne sont pas recommandés comme providers principaux de Grimoire aujourd'hui. Grimoire les prend en charge en best-effort et nous avons implémenté les fallbacks que leurs CLIs actuels permettent, mais leurs ACP et runtime surfaces ont des limites techniques : sessions, approvals, streaming, tool/edit metadata, model discovery et usage reporting sont incomplets ou peu fiables par rapport aux providers recommandés.

### Codex

Codex est le provider par défaut au premier lancement. Choisissez-le pour OpenAI Codex dans un CLI local, connecté avec votre ChatGPT plan ou une API key.

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex
```

Lancez Codex une fois, connectez-vous, puis activez-le dans Grimoire. Le standalone installer est maintenant le primary install path; Windows, Homebrew et les fallback package-manager options sont dans la documentation officielle Codex CLI.

- [Codex CLI setup](https://developers.openai.com/codex/cli)
- [OpenAI code generation guide](https://developers.openai.com/api/docs/guides/code-generation)

Dans Grimoire, Codex tourne sur son app-server protocol avec native history, fork, plan mode, image input et reasoning effort controls. Plan usage apparaît quand Codex rapporte rate-limit metadata.

### Claude Code

Choisissez Claude Code si vous voulez sa native project memory, ses slash commands, sa MCP configuration, ses plans, rewind/fork, avec votre Claude subscription ou API key.

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude
```

Authentifiez-vous via Claude Code, puis activez-le dans Grimoire. L'ancien npm package est deprecated; utilisez le native installer ci-dessus, Homebrew (`brew install --cask claude-code`), WinGet ou les autres options du official quickstart.

- [Claude Code quickstart](https://code.claude.com/docs/en/quickstart)

Dans Grimoire, Claude Code lit et préserve vos fichiers `.claude/`, tourne sur le Claude Code SDK et prend en charge slash commands, MCP settings, agents, skills, plans, rewind et fork. Quand Claude rapporte les deux, vous verrez les quota windows et l'API spend côte à côte.

**Respecter les paramètres de Claude Code** est activé par défaut. Grimoire lit `model` et `env` dans les paramètres utilisateur (`~/.claude/settings.json`) et ceux du coffre (`.claude/settings.json`), puis les applique au sélecteur de modèles Claude et à l’environnement d’exécution. Les modèles personnalisés de Claude Code fonctionnent ainsi dans Grimoire, notamment via des passerelles compatibles Anthropic comme MiniMax et Z.ai. Les paramètres du projet priment sur ceux de l’utilisateur ; les variables d’environnement explicitement définies dans Grimoire priment sur les deux.

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

Antigravity CLI est le remplacement de Gemini CLI par Google pour les usages consumer, avec accès à Gemini, Claude, GPT-OSS et aux autres familles de modèles disponibles sur votre Antigravity account. Dans Grimoire, traitez-le comme un compatibility provider plutôt que comme le choix recommandé par défaut.

```bash
agy
```

Installez la CLI Antigravity officielle de Google, authentifiez-la localement, puis activez Antigravity dans Grimoire. Grimoire détecte automatiquement `agy` depuis PATH, ou vous pouvez définir un custom CLI path dans les provider settings.

- [Antigravity CLI](https://antigravity.google/product/antigravity-cli)
- [Gemini CLI migration guide](https://goo.gle/gemini-cli-migration)

Dans Grimoire, Antigravity fonctionne via `agy --print`, avec une model selection optionnelle depuis `agy models`. C'est une intégration best-effort parce que `agy` n'expose pas encore à Grimoire un runtime ACP-compatible solide. Persistent sessions, native history, plan mode, streaming, approval-safe file edits, reliable usage reporting et auxiliary workflows restent désactivés ou limités jusqu'à ce qu'Antigravity expose des runtime surfaces stables. Les images sont transmises sous forme de fichiers temporaires et doivent être jointes à nouveau dans les messages suivants.

Windows note: current Windows `agy` builds can finish successfully while returning empty stdout for `agy models` and `agy --print`. Grimoire uses best-effort recovery from Antigravity logs, transcripts, settings, and a seeded Pro AI model list, but Windows Antigravity support may be less reliable than macOS or Linux. If your account shows additional models in Antigravity, add their exact labels under Antigravity settings > Custom models.

### Gemini CLI (Legacy)

Gemini CLI reste un legacy compatibility provider pour Gemini Code Assist Standard, Enterprise, Google Cloud et les paid API-key users lorsque Google continue de servir Gemini CLI requests. Il n'est pas recommandé pour les nouveaux setups Grimoire parce que son ACP support est faible et que plusieurs Grimoire workflows ne peuvent pas être implémentés de manière fiable au-dessus de lui. Les comptes consumer Google AI Pro, Ultra et free-tier doivent utiliser Antigravity apres le June 18, 2026, en gardant en tête les limites Antigravity ci-dessus.

```bash
gemini
```

Activez Gemini CLI uniquement si votre account tier est encore pris en charge et que vous avez spécifiquement besoin de ce legacy Google path. Grimoire le lance via `gemini --acp`, ajoute active note, editor/browser/canvas selection, vault search et project workspace context au ACP prompt, et le marque comme legacy pour qu'il ne ressemble pas à un provider recommandé. Préférez Codex, Claude Code, OpenCode, MiMoCode, Kimi Code, Grok Build ou Qwen Code lorsque c'est possible.

### Qwen Code

Qwen Code est un provider ACP opt-in avec sessions persistantes provider-native, resume et contexte de modèle, ainsi que découverte live des modèles et modes. Il streame les messages et l'activité des tools et plans, et prend en charge image input, provider commands et file approvals. Grimoire n'hydrate pas l'historique des messages provider-native.

```bash
# macOS et Linux
curl -fsSL https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.sh | bash

# Windows (PowerShell)
irm https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.ps1 | iex

# Alternatives : npm requiert Node.js 22 ou plus récent ; Homebrew
npm install -g @qwen-code/qwen-code@latest
brew install qwen-code

qwen --version
qwen
```

Lancez `qwen`, choisissez dans `/auth` **Alibaba ModelStudio**, **Third-party Providers** ou **Custom Provider**, puis activez Qwen Code dans Grimoire. Il n'existe pas de connexion OAuth. Grimoire lance ce provider opt-in avec `qwen --acp`.

Safe, Auto-approve et Plan correspondent à `default`, `yolo` et `plan` de Qwen ; les autres modes Qwen, y compris inconnus, sont affichés prudemment comme Safe dans la shared toolbar. Reasoning effort prend en charge Low, Medium, High, XHigh et Max ; High est la valeur par défaut. `/effort <tier>` est appliqué avant un turn normal, mis en cache par session et dépend du modèle effectif. Les ACP permission metadata pour les questions single-select, multi-select et freeform utilisent la même inline UI partagée.

Qwen reste propriétaire de ses credentials et de sa configuration native dans `~/.qwen/settings.json`. Grimoire gère une liste MCP de projet isolée dans `.grimoire/mcp/qwen.json` et l'injecte dans les sessions ACP sans réécrire la configuration native de Qwen. L'usage apparaît seulement lorsque Qwen rapporte des ACP token ou cost metadata. Rewind et fork ne sont pas pris en charge.

- [Documentation de Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/)
- [Authentification de Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/)
- [Qwen Code repository](https://github.com/QwenLM/qwen-code)

Si Qwen ne démarre pas ou si aucun modèle n'apparaît, exécutez `/doctor` dans Qwen Code, terminez `/auth`, vérifiez `qwen --version` et contrôlez le chemin du CLI Qwen dans les settings Grimoire.

### Devin

Devin CLI (Cognition) est un provider ACP optionnel. Grimoire lance `devin acp`, découvre les models et les modes que votre compte propose depuis la session en cours, diffuse les messages, le raisonnement et la tool activity, demande avant chaque shell command et chaque écriture de fichier, et reprend les sessions nativement. La liste des models dépend du compte connecté : cela vient de Devin, pas de Grimoire.

```bash
# macOS, Linux, WSL
curl -fsSL https://cli.devin.ai/install.sh | bash

# Homebrew
brew install --cask devin-cli

devin auth login
devin --version
```

Connectez-vous avec `devin auth login` (via le navigateur), puis activez Devin dans Grimoire. Safe, Auto-approve et Plan correspondent aux modes `accept-edits`, `bypass` et `plan` de Devin ; ses modes `smart` et `ask` s'affichent comme Safe dans la barre partagée.

- [Documentation Devin CLI](https://docs.devin.ai/cli)
- [Documentation ACP de Devin](https://docs.devin.ai/desktop/acp)

Une chose à savoir sur le mode Safe : Devin décide lui-même quelles shell commands sont en lecture seule et les exécute sans demander, et `echo` en fait partie même lorsqu'il redirige vers un fichier. Grimoire approuve chaque écriture que Devin effectue via le protocole, mais une écriture passée par sa propre shell peut y échapper. Pour une session qui ne doit rien écrire, utilisez Plan.

Devin gère ses identifiants dans `~/.local/share/devin/`. Les skills du vault sont lues depuis `.devin/skills` et `.agents/skills`, et une skill est la slash command de Devin. Grimoire tient une liste MCP dédiée dans `.grimoire/mcp/devin.json` et l'injecte dans la session ACP. L'usage apparaît lorsque Devin le rapporte ; il n'y a pas de contrôle de reasoning effort, car l'effort fait partie de l'id du model. Devin ne prend en charge ni fork ni rewind dans Grimoire.


### Reasonix

Reasonix est un agent de codage open source et multi-modèles, et ici un provider ACP optionnel. Grimoire lance `reasonix acp`, lit les modèles et les modes depuis la session vivante, diffuse messages, réflexion, activité des tools et plans, demande avant les tools soumis à permission et les écritures de fichiers, et reprend les sessions nativement. Les modèles proposés par une session dépendent des blocs provider de votre configuration Reasonix ; cela appartient à Reasonix, pas à Grimoire.

```bash
# npm
npm i -g reasonix

# Homebrew
brew install esengine/reasonix/reasonix

reasonix setup
reasonix --version
```

Lancez `reasonix setup` pour configurer un fournisseur de modèles et ses identifiants, puis activez Reasonix dans Grimoire. Reasonix garde deux réglages là où d'autres providers en gardent un : le mode de session (`normal`, `plan`, `goal`) et une posture d'approbation des tools distincte (`ask`, `auto`, `yolo`). La barre d'outils de Grimoire pilote les deux. Safe, c'est `normal` qui demande, Plan c'est `plan` qui demande, et Auto-approve c'est `normal` en `yolo` ; `goal` appartient à Reasonix et s'affiche comme Safe. Comme la posture est la seule chose qui sépare Safe d'Auto-approve, un tour qui ne peut pas la fixer est refusé plutôt qu'exécuté en silence dans la plus permissive.

Reasonix pose aussi des questions, pas seulement des demandes de permission : son tool `ask` arrive par le même canal et s'affiche comme une carte dont la description est la question et dont les options numérotées sont les réponses. Choisissez par le numéro ; `Entrée` ne fait rien sur une carte à plusieurs réponses, pour qu'une frappe machinale ne choisisse pas à votre place.

L'effort de raisonnement est un sélecteur alimenté par la session, pas une liste figée. Quels niveaux un modèle accepte est décidé par le bloc provider qui le sert : un bloc déclarant `supported_efforts` offre Disabled, Low, High et Max ; un bloc sans reçoit le jeu intégré de son type. Grimoire lit ce que la session ouverte propose et place Auto en tête, ce qui laisse le choix à Reasonix. Un niveau que la session n'a jamais proposé n'est jamais envoyé, car la CLI le refuse face au modèle.

- [Documentation Reasonix](https://reasonix.io/docs/)
- [Reasonix sur GitHub](https://github.com/esengine/DeepSeek-Reasonix)

Une chose à savoir sur Safe : `ask` protège les tools que Reasonix classe comme soumis à permission, pas tous, donc une commande shell qu'il juge en lecture seule peut s'exécuter sans question. Grimoire approuve chaque écriture de fichier que Reasonix effectue via le protocole, et c'est ce qui garde le vault derrière une question. Pour une session qui ne doit rien écrire, utilisez Plan.

Reasonix garde sa configuration dans `~/.reasonix/config.toml` et lit les clés d'API dans l'environnement sous les noms que ce fichier indique. Les skills du vault sont lues depuis `.reasonix/skills` et `.agents/skills`. Grimoire gère une liste MCP de projet isolée dans `.grimoire/mcp/reasonix.json` et l'injecte dans les sessions ACP. L'usage vient des notifications de statut de Reasonix, et un coût n'apparaît que si votre fournisseur de modèles a un prix. Fork et rewind ne sont pas pris en charge.

Activez **Image attachments as files** pour transmettre les images via des fichiers dans `.grimoire/attachments/`. Un modèle compatible avec les images et un outil de lecture de fichiers sont nécessaires ; la lecture exige un appel supplémentaire. Un fichier absent ou impossible à écrire fait échouer la requête. Cette option est désactivée par défaut.

### Pi

Installez les deux outils séparément. L’adaptateur exige **Node.js 22+** et **Pi 0.80.4+**.

1. Installez Pi en suivant les [instructions officielles](https://pi.dev/docs/latest). Sur macOS et Linux :

   ```bash
   curl -fsSL https://pi.dev/install.sh | sh
   ```

   Autre possibilité, avec npm :

   ```bash
   npm install -g --ignore-scripts @earendil-works/pi-coding-agent
   ```

2. Installez l’adaptateur selon les [instructions d’installation globale](https://github.com/svkozak/pi-acp#global-install) :

   ```bash
   npm install -g pi-acp
   ```

3. Ouvrez la configuration de Pi dans le terminal et configurez votre fournisseur de modèles ou vos clés API :

   ```bash
   pi-acp --terminal-login
   ```

4. Redémarrez Obsidian, activez **Pi** dans **Paramètres → Grimoire → Fournisseurs**, puis cliquez sur **Refresh all models**. `pi` et `pi-acp` doivent être accessibles dans le `PATH`. Si la détection échoue, indiquez le chemin absolu de `pi-acp` dans **Adapter path** ; ajoutez au besoin `PI_ACP_PI_COMMAND=/absolute/path/to/pi` dans **Environment variables** des paramètres Pi.

Grimoire lance lui-même l’adaptateur ; aucune configuration Zed ni aucun serveur d’adaptateur séparé ne sont nécessaires.

Les deux exécutables restent des dépendances externes. Grimoire découvre les modèles et niveaux de raisonnement depuis Pi, diffuse les réponses et l’activité des outils, transmet les images nativement et reprend les sessions enregistrées. Le sélecteur commun conserve votre sélection et vos alias lors de l’actualisation.

**Limitation des niveaux de raisonnement (pi-acp 0.0.33) :** le menu ne propose que les niveaux que l’adaptateur peut réellement appliquer au modèle choisi. Pi prend par exemple en charge `low`, `high` et `max` pour GLM-5.3, mais l’adaptateur refuse `max` ; Grimoire propose donc `low`, `high` et **Pi default**. `xhigh` ne remplace pas `max`. En amont, la [PR #73](https://github.com/svkozak/pi-acp/pull/73) propose d’ajouter `max` et la [PR #125](https://github.com/svkozak/pi-acp/pull/125) de découvrir les niveaux réels du modèle sélectionné. Au 2026-09-21, les deux PR étaient ouvertes et non fusionnées ; leurs corrections ne font pas partie de la version testée de l’adaptateur.

Pi gère les autorisations des outils : il peut lire, écrire et exécuter des commandes sans demander. Grimoire affiche les demandes des extensions, mais ne propose pas de mode Safe ou Plan. MCP, compétences et modèles de prompts se configurent dans Pi. Les fichiers sont lus sur disque ; l’adaptateur ne fournit ni texte non enregistré de l’éditeur, ni quotas du compte, ni occupation du contexte. Testé avec Pi 0.86.1 et pi-acp 0.0.33.

### Command Code

Command Code s’active à la demande. Installez-le et authentifiez-vous dans un terminal, puis activez-le dans Paramètres → Grimoire → Fournisseurs :

```bash
npm i -g command-code
command-code login
```

La CLI installée fournit les niveaux d’effort de raisonnement du modèle sélectionné. Le sélecteur ne propose que les niveaux pris en charge et le choix par défaut de la CLI ; il est absent pour les modèles sans réglage d’effort. Un choix explicite s’applique à l’exécution courante via l’API native de modification de session, sans changer les paramètres globaux de la CLI. Le choix par défaut conserve le comportement natif, y compris un effort déjà enregistré dans une session reprise.

Grimoire diffuse les réponses et l’activité des outils depuis la sortie JSON sans interface de la CLI, découvre les modèles avec `--list-models` et conserve l’identifiant natif de session pour une reprise explicite après rechargement. L’authentification, la configuration, les compétences, MCP et les transcriptions restent gérés par Command Code. L’utilisation du contexte compare les jetons d’entrée signalés à une limite estimée ou définie par l’utilisateur ; les quotas du compte et les tarifs ne sont pas déduits.

Activez **Image attachments as files** pour transmettre les images via des fichiers dans `.grimoire/attachments/`. Un modèle compatible avec les images et un outil de lecture de fichiers sont nécessaires ; la lecture exige un appel supplémentaire. Un fichier absent ou impossible à écrire fait échouer la requête. Cette option est désactivée par défaut.

**Safe** suspend les modifications, commandes et autres outils qui ne se limitent pas à la lecture jusqu’à une autorisation ponctuelle dans Grimoire. Un refus, une annulation ou la perte de connexion au mécanisme d’autorisation empêche l’exécution. Safe exige actuellement l’installation npm vérifiée de Command Code 1.53.0 / 1.66.0 et désactive les sous-agents natifs, dont les boucles distinctes ne peuvent pas utiliser ce mécanisme. **Auto-approve** fonctionne sans demandes de Grimoire ; les règles natives de refus et de confirmation restent actives dans les deux modes. L’intégration ne propose pas de questions interactives, commandes de planification, commandes slash, MCP/compétences/agents gérés, tâches auxiliaires, bifurcations, retours en arrière ou import de l’historique natif.

- [Documentation du mode sans interface de Command Code](https://commandcode.ai/docs/headless)

### OpenCode

Choisissez OpenCode pour un agent model-agnostic avec sa propre provider configuration.

```bash
curl -fsSL https://opencode.ai/install | bash
opencode
```

Homebrew, npm, bun et package-manager installs fonctionnent aussi. Configurez vos provider credentials dans OpenCode, puis activez-le dans Grimoire.

- [Télécharger OpenCode](https://opencode.ai/download)
- [Documentation des fournisseurs OpenCode](https://opencode.ai/docs/providers)
- [OpenCode config docs](https://opencode.ai/docs/config)

Dans Grimoire, OpenCode tourne via ACP avec des Grimoire-managed launch artifacts, plus persistent runtime, native history, plan mode, image input, provider commands et reasoning effort. Il rapporte monthly spend lorsque cost metadata est disponible.

### MiMoCode

MiMoCode (Xiaomi) est un fork d'OpenCode avec mémoire persistante, gestion intelligente du contexte et orchestration de sous-agents.

```bash
curl -fsSL https://mimo.xiaomi.com/install | bash
mimo
```

Homebrew, npm, bun et package-manager installs fonctionnent aussi. Configurez vos provider credentials dans MiMoCode, puis activez-le dans Grimoire.

- [MiMoCode GitHub](https://github.com/XiaomiMiMo/MiMo-Code)

Dans Grimoire, MiMoCode tourne via ACP avec persistent runtime, native history, plan mode, image input, provider commands et reasoning effort.

### Kimi Code

Kimi Code CLI (MoonshotAI) est un agent terminal multi-fournisseur prenant en charge les modèles Kimi, OpenAI, Anthropic, Gemini et Vertex AI.

```bash
curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash
kimi
```

Configurez vos provider credentials dans Kimi Code, puis activez-le dans Grimoire.

- [Kimi Code GitHub](https://github.com/MoonshotAI/kimi-code)

Dans Grimoire, Kimi Code tourne via ACP avec persistent runtime, native history, plan mode, image input, provider commands et reasoning effort.

### Grok Build

Choisissez Grok Build pour le CLI agentique de xAI dans Obsidian. Connectez-vous avec Grok OAuth ou utilisez une clé API xAI.

```bash
grok
```

Installez la Grok CLI de xAI, authentifiez-vous via grok.com OAuth ou configurez des API keys, puis activez Grok Build dans Grimoire.

- [Documentation de Grok Build](https://docs.x.ai/build/overview)
- [Grok 4.5](https://docs.x.ai/developers/grok-4-5)
- [Utilisation et limites](https://docs.x.ai/grok/faq)

Grok 4.5 est actuellement le modèle par défaut de Grok Build. Grimoire récupère le catalogue de modèles disponible depuis le CLI Grok authentifié au lieu de maintenir une liste statique ; la disponibilité peut donc varier selon le compte et la version du CLI et se mettre à jour automatiquement.

Dans Grimoire, Grok Build tourne via ACP avec `grok agent stdio` et des Grimoire-managed launch artifacts sous `.grimoire/grok/`, plus persistent runtime, native JSONL history hydration, plan mode, image input, provider commands, reasoning effort sur les native models, rewind et fork. Avec OAuth, Grimoire affiche la limite hebdomadaire partagée de Grok, l'heure de réinitialisation et les Extra Usage Credits disponibles ; API spend est agrégé depuis session cost metadata lorsqu'il est rapporté.

## Votre premier chat

1. Choisissez un provider et un model dans le composer.
2. Réglez reasoning effort et choisissez Safe, Auto-approve ou Plan dans le permission control.
3. Mentionnez les notes, dossiers ou context que vous voulez inclure dans le scope.
4. Envoyez le turn.
5. Regardez les tool calls, usage et output arriver dans le panneau.

## Fonctionnalités

### Espace de conversation

Un panneau latéral concentré avec plusieurs tabs. Chaque tab garde son draft, provider, model, context et runtime. Fermez et rouvrez Obsidian : vos sessions reviennent, avec provider, model et reasoning effort préservés sur chaque response. Rewind et fork apparaissent quand le provider actif les prend en charge. Auto-scroll se retire dès que vous scrollez pour lire. Après 10 secondes sans sortie visible, un wait indicator partagé affiche le provider actif et le temps écoulé ; il se met en pause pendant une question ou permission.

### Onglets, historique et navigation

Ouvrez le menu d’actions d’un onglet ou faites un clic droit pour renommer, dupliquer ou fermer des onglets. Un clic central ferme l’onglet ; Annuler restaure son brouillon et sa position. Recherchez les anciens échanges dans la fenêtre contextuelle d’historique et rouvrez une conversation dans un nouvel onglet. L’historique distingue les titres saisis manuellement des titres générés. La barre de conversation propose des raccourcis de navigation et un sommaire ; les réponses terminées affichent leur heure de fin.

<p align="center">
  <img src="../../assets/readme/conversation-history.png" alt="Recherche dans l’historique montrant trois conversations Ocean Atlas, leurs modèles et l’origine de leurs titres" width="100%">
</p>

### Agents parallèles, paramètres et zone de saisie

La carte d'approbation **Parallel workers** affiche le model hérité et permet de sélectionner uniquement les tâches proposées à lancer. Settings utilise la recherche native d'Obsidian et conserve une entrée What's New permanente. Provider settings et composer ont une surface cohérente pour tous les providers, tout en gardant leurs controls et configuration propriétaires à leur place.

### Raccourcis clavier

| Raccourci | Action |
| --- | --- |
| `Enter` | Envoie le turn actuel. Désactivé lorsque **Send only with button** est activé. |
| `Shift+Enter` | Insère une nouvelle ligne dans le composer. |
| `Shift+Tab` | Parcourt les permission modes : `Safe -> Auto-approve -> Plan -> Safe`. Les providers sans Plan mode alternent entre Safe et Auto-approve. |
| `Escape` | Arrête la réponse en cours ou ferme la fenêtre contextuelle d’historique. |

### Sélecteur de modèles

Un picker unique, groupé par provider et trié par label : Antigravity, Claude Code, Codex, Command Code, Devin, Gemini CLI (Legacy), Grok Build, Kimi Code, MiMoCode, OpenCode, Pi, Qwen Code et Reasonix. Search traverse labels, descriptions, groups et model IDs. Les catalogs chargent lazily et mémorisent les groups que vous avez repliés. Ajoutez custom aliases et context-window overrides dans settings. Les variants 1M de Claude sont des options supplémentaires, pas des remplacements des base models.

OpenCode, MiMoCode, Kimi Code, Grok Build, Command Code et Pi partagent le même sélecteur dans les paramètres : lignes sélectionnées avec alias, catalogue consultable et **Refresh all models**. Le rafraîchissement conserve la sélection et les alias ; les filtres par fournisseur apparaissent si la CLI fournit leurs noms.

### Utilisation et coût

Un badge près du model selector garde l'usage du provider actif visible. Le model menu contient des readouts plus complets : quota windows quand un provider les expose, spend quand seul cost est disponible. Les dernières bonnes valeurs restent affichées pendant un refresh ou un échec, donc le meter ne disparaît pas brusquement. Vous pouvez tout désactiver dans settings si vous voulez une interface plus silencieuse.

| Provider | Source de l'usage |
| --- | --- |
| Codex | Account rate-limit notifications et `account/rateLimits/read` quand disponible |
| Claude Code | SDK rate-limit events, `.grimoire/claude/statusline-usage.json` optionnel et SDK result cost metadata |
| Antigravity CLI | Pas encore disponible de manière fiable depuis `agy --print` |
| Gemini CLI (Legacy) | ACP cost metadata quand Gemini CLI le signale ; legacy provider uniquement |
| Qwen Code | ACP token et cost metadata quand Qwen Code les signale |
| Devin | Total de crédits de la session rapporté via ACP, en dépense mensuelle |
| Reasonix | Coût par tour issu de ses propres notifications de statut, quand le fournisseur de modèles configuré a un prix |
| Pi | Non communiqué par l’adaptateur pi-acp |
| OpenCode | Monthly spend agrégé depuis ACP et session cost metadata |
| MiMoCode | Monthly spend agrégé depuis ACP et session cost metadata |
| Kimi Code | Monthly spend agrégé depuis ACP et session cost metadata |
| Grok Build | Limite hebdomadaire partagée de Grok, heure de réinitialisation et Extra Usage Credits via OAuth ; monthly API spend depuis session cost metadata |

### Mode planification

Quand le provider actif prend en charge Plan mode, vous pouvez l'activer de deux façons :

- Cliquez sur le permission control dans le composer jusqu'à ce qu'il passe à Plan : `Safe -> Auto-approve -> Plan`.
- Appuyez sur `Shift+Tab` pour parcourir le cycle complet : `Safe -> Auto-approve -> Plan -> Safe`.

Plan mode demande au provider de planifier avant de commencer les changements. Dans le composer, il utilise le même permission control que Safe et Auto-approve, donc le mode actif reste visible pendant le travail.

Quand un provider termine la planification, Grimoire affiche une carte Plan complete repliable avec le plan rendu, les permissions demandées et des lignes faciles à piloter au clavier. Approve continue dans la même session ; feedback garde Plan mode actif pour que le provider puisse revoir le plan.

### Contexte et mentions

Mentionnez des vault notes et folders directement depuis le composer, ajoutez la current ou linked note, et configurez des persistent external context paths dans settings. Collez ou déposez des images quand le provider accepte image input. Mentionnez des MCP servers là où l'integration provider le permet. L'onglet Context affiche la note liée, le model, le permission mode, les fichiers épinglés, les launch artifacts comme `.grimoire/grok/system.md`, et les fichiers que l'agent a chargés pendant la session.

### Modification dans la note

Lancez "Grimoire: Inline edit" sur une sélection. Un prompt s'ouvre près du texte, l'edit revient sous forme de diff à accept ou reject, et passe par le provider-backed inline edit service. Il gère le remplacement d'une sélection et l'insertion de nouveau texte.

### Questions de clarification

Quand un provider demande du structured user input, Grimoire met le turn en pause et affiche la question au-dessus du composer. Claude Code expose cela sous le nom `AskUserQuestion` ; Codex app-server expose une surface expérimentale `request_user_input` / `requestUserInput` ; Qwen Code fournit des ACP permission metadata. Grimoire normalise ces mécanismes provider-specific dans le même inline question UI. Les réponses single-select, multi-select et freeform sont renvoyées au provider run, pour que l'agent continue sans message de chat séparé.

### Commandes

Les built-in commands couvrent les workflows Grimoire comme image generation et resume. Les providers qui exposent leurs propres commands, comme Claude Code slash commands, OpenCode, Grok Build et Qwen Code runtime commands, les affichent via provider-owned catalogs. Masquez celles que vous n'utilisez pas dans settings.

### Génération d’images

Collez ou déposez des images pour les attacher. La command built-in `/image [prompt]` n'appelle aucune image API directement. Elle envoie un turn normal au provider actif avec l'instruction d'utiliser ce que vous avez configuré pour image generation : provider-native tooling, MCP tools ou local command. L'agent sauvegarde le résultat dans votre vault et renvoie un embed comme `![[path/to/image.png]]`. Si rien n'est configuré, vous obtenez une réponse simple expliquant ce qui manque.

### Sécurité et autorisations

Permission modes appartiennent au provider, donc Grimoire les expose via shared composer controls au lieu de les réinventer. Le permission control et `Shift+Tab` parcourent Safe, Auto-approve et Plan quand le active provider prend en charge plan mode. Safe mode et permission prompts restent visibles pendant le travail. Bang-bash mode n'apparaît que si un provider enabled le propose. Traitez configured MCP servers, shell access et API keys comme sensitive, parce qu'ils le sont.

### Journaux de diagnostic

Désactivé par défaut. Si vous l'activez, Grimoire écrit du JSONL sanitized dans `.grimoire/logs/YYYY-MM-DD.jsonl`, avec prompts, answers, note contents, paths, environment values et secrets redacted. C'est destiné à diagnostiquer provider/runtime issues, pas à conserver un transcript.

### Paramètres

Quatre onglets organisent les paramètres : **Général** pour la langue, l’emplacement du chat, les onglets et l’affichage ; **Fournisseurs** pour activer les CLI et configurer leurs modèles ; **Avancé** pour le contexte, les conversations, les outils et le diagnostic ; **À propos** pour la version et les nouveautés. Les paramètres sont accessibles depuis la recherche native d’Obsidian.

La vue des fournisseurs indique les CLI détectées et leurs interrupteurs d’activation. Les paramètres du fournisseur sélectionné apparaissent en dessous.

<p align="center">
  <img src="../../assets/readme/settings-providers.png" alt="Vue des douze intégrations CLI de Grimoire et paramètres des modèles Codex" width="100%">
</p>

<details>
<summary>Paramètres généraux</summary>

<p align="center">
  <img src="../../assets/readme/settings-general.png" alt="Paramètres de langue, d’emplacement du panneau, d’onglets, de libellés, de défilement et de titres des conversations" width="100%">
</p>

</details>

## Où Grimoire garde vos données

| Path | Contenu |
| --- | --- |
| `.grimoire/grimoire-settings.json` | Paramètres de l’application et configuration des fournisseurs |
| `.grimoire/sessions/*.meta.json` | Métadonnées des sessions |
| `.grimoire/logs/YYYY-MM-DD.jsonl` | Journaux de diagnostic expurgés, activés à la demande |
| `.grimoire/claude/statusline-usage.json` | Claude usage snapshot pour le plan meter |
| `.grimoire/grok/` | Grok Build launch artifacts, managed config et session pointers |

Les provider-native files sous `.claude/`, `.codex/`, `.opencode/` et `.grimoire/grok/` sont lus et écrits sur place, donc votre provider setup reste portable hors de Grimoire.

## Confidentialité

Grimoire tourne dans Obsidian, sur votre machine. Il n'a pas de backend, n'ajoute pas de telemetry et n'upload jamais vos prompts, answers, notes, files, tool output, API keys ou usage logs vers un service Grimoire. Les seuls logs qu'il écrit sont les optional sanitized debug logs ci-dessus, et ils restent dans votre vault.

Ce que Grimoire ne peut pas cacher, c'est le provider lui-même. Le CLI que vous activez reçoit le prompt, le context sélectionné, ainsi que les files, images, tool output et commands nécessaires à une request. Ce CLI peut ensuite parler à Anthropic, OpenAI, Google, vos OpenCode vendors configurés, MCP servers ou tout autre endpoint que vous avez configuré. Terms, retention, billing, rate limits et privacy policies sont ceux du provider, pas ceux de Grimoire. Le rôle de Grimoire est de rendre cette frontière visible et contrôlable dans Obsidian.

Pour un résumé orienté politique Obsidian de l'utilisation réseau, des exigences de compte, de l'accès aux fichiers externes, du logging et de la telemetry, consultez [DISCLOSURES.md](../../DISCLOSURES.md).

## Développement

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run test
npm run build
npm run build:release
```

Avant de publier ou de push des changements UI/provider significatifs, lancez le full local gate :

```bash
npm run test -- --selectProjects unit
npm run typecheck
npm run lint
npm run build:release
```

`npm run build:release` rafraîchit le generated `main.js`, le root `styles.css` et `dist/grimoire`.

npm est le canonical package manager pour development, CI et releases. Gardez `package-lock.json` à jour lorsque les dependencies changent ; les secondary package-manager lockfiles ne sont volontairement pas commit.

Les contributions sont les bienvenues. Lisez [CONTRIBUTING.md](../../CONTRIBUTING.md) avant d'ouvrir une pull request : ce guide décrit les attentes d'architecture, de sécurité, de tests et de review.

## Versions publiées

Les releases Grimoire sont publiées depuis des semver tags comme `1.0.0`. Le release workflow lance le local gate, build l'Obsidian bundle, vérifie que le tag correspond à `package.json` et `manifest.json`, puis attache `main.js`, `manifest.json` et `styles.css` à la GitHub Release.

Obsidian Community plugins est le chemin d'installation recommandé pour les utilisateurs. GitHub Releases contient toujours les bundle assets pour l'installation manuelle et BRAT. Utilisez `main` pour le releasable development, puis publiez avec un tag qui correspond à la version du manifest.

## Feuille de route

Aujourd'hui, Grimoire est livré avec Codex, Claude Code, Antigravity CLI, Gemini CLI (Legacy), OpenCode, MiMoCode, Kimi Code, Grok Build, Qwen Code, Devin, Pi, Reasonix et Command Code.

Prochainement : GitHub Copilot CLI, d'autres ACP-compatible providers et des local model CLIs dès que leur runtime sera assez stable pour être intégré dans Obsidian. Les implementation notes vivent dans [docs/provider-roadmap.md](../provider-roadmap.md).

## Licence

MIT. Voir [LICENSE](../../LICENSE).
