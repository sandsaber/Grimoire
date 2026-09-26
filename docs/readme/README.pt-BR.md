# Grimoire

<p align="center">
  <img src="../../assets/readme/grimoire-logo.png" alt="Logotipo do Grimoire" width="240">
</p>

<p align="center">
  <strong>Agentes de IA local-first para seu vault do Obsidian.</strong>
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="Licença: MIT">
  <img src="https://img.shields.io/github/v/release/sandsaber/Grimoire?label=release" alt="Versão mais recente">
  <img src="https://img.shields.io/badge/Obsidian-1.13.0%2B-7c3aed" alt="Obsidian 1.13.0+">
  <img src="https://img.shields.io/badge/platform-desktop-lightgrey" alt="Apenas desktop">
</p>

<p align="center">
  <img src="../../assets/readme/chat-workspace.png" alt="Ocean Atlas no Obsidian ao lado de um chat Codex Astra High sobre camadas oceânicas, correntes e vida marinha" width="100%">
</p>

<p align="center">
  <sub>Uma nota real e uma conversa baseada nos seus links.</sub>
</p>

O Grimoire traz assistentes de CLI agênticos para o Obsidian. Codex, Claude Code, Antigravity CLI, Gemini CLI (Legacy), OpenCode, MiMoCode, Kimi Code, Grok Build, Qwen Code, Devin, Pi, Reasonix e Command Code vivem em um único painel lateral, onde leem suas notas, editam arquivos, executam comandos, chamam ferramentas e mantêm o histórico da sessão no seu vault real. Nada passa por um servidor do Grimoire. Não há telemetria, backend hospedado nem proxy no meio do caminho.

Ele foi feito para quem já trabalha no Obsidian e quer uma ajuda de IA que se comporte como parte do vault: contexto local, arquivos locais, um provedor escolhido de propósito e uso que você realmente consegue acompanhar.

> O [README](../../README.md) em inglês é o documento canônico do produto. Esta tradução em português é mantida junto com a documentação atual do produto.

## Por que usar o Grimoire

- Use os agentes de CLI nos quais você já confia, dentro das suas notas.
- Alterne provedores pelo compositor. Codex, Claude Code, Antigravity CLI, Gemini CLI legado, OpenCode, MiMoCode, Kimi Code, Grok Build, Qwen Code, Devin, Pi, Reasonix e Command Code compartilham um seletor de modelos.
- Fundamente cada turno no seu vault. Mencione notas, pastas e ferramentas MCP em vez de colar caminhos manualmente.
- Veja custos e limites ao lado do seletor de modelo, onde você toma essa decisão de qualquer forma.
- Continue local-first. O Grimoire não coleta telemetria, não faz proxy de prompts nem executa um backend.

## O que cada provedor pode fazer

| Recurso | Codex | Claude Code | OpenCode | Grok Build | MiMoCode | Kimi Code | Antigravity CLI | Gemini CLI (Legacy) | Qwen Code | Devin | Reasonix | Command Code | Pi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Execução local persistente | Sim | Sim | Sim | Sim | Sim | Sim | Não | Sim | Sim | Sim | Sim | Não | Sim |
| Restauração do histórico nativo | Sim | Sim | Sim | Sim | Sim | Sim | Não | Sim | Não | Não | Não | Não | Sim |
| Modo de planejamento | Sim | Sim | Sim | Sim | Sim | Sim | Não | Sim | Sim | Sim | Sim | Não | Não |
| Imagens anexadas | Sim | Sim | Sim | Não | Sim | Sim | Arquivos | Sim | Sim | Sim | Arquivos (opcional) | Arquivos (opcional) | Sim |
| Modo de instruções | Sim | Sim | Sim | Sim | Sim | Sim | Não | Sim | Sim | Sim | Sim | Não | Não |
| Controle do esforço de raciocínio | Sim | Sim | Sim | Sim | Sim | Sim | Sim | Sim | Sim | Não | Sim | Sim (por modelo) | Sim (por modelo) |
| Retrocesso | Não | Sim | Não | Sim | Não | Não | Não | Não | Não | Não | Não | Não | Não |
| Ramificação | Sim | Sim | Não | Sim | Não | Não | Não | Não | Não | Não | Não | Não | Não |
| Comandos slash do provedor | Não | Sim | Sim | Sim | Sim | Sim | Não | Sim | Sim | Sim | Sim | Não | Sim |
| Gestão de MCP pelo Grimoire | Não | Sim | Sim | Sim | Sim | Sim | Não | Sim | Sim | Sim | Sim | Não | Não |

## Instalação

O Grimoire é um plugin para desktop. Ele executa as CLIs dos seus provedores localmente, portanto não há versão para dispositivos móveis.

### Pelos plugins da comunidade (recomendado)

Instale o Grimoire pelo diretório de plugins da comunidade do Obsidian:

1. Abra Configurações, acesse Plugins da comunidade e desative o Modo restrito, caso esteja ativado.
2. Clique em Procurar, pesquise por Grimoire e instale-o.
3. Ative o Grimoire e abra o painel pela faixa de ícones ou pela paleta de comandos.

### Pelos GitHub Releases

Instale a versão atual manualmente se não puder usar os plugins da comunidade:

1. Baixe `main.js`, `manifest.json` e `styles.css` da [versão mais recente do Grimoire](https://github.com/sandsaber/Grimoire/releases/latest).
2. Crie `/path/to/your/vault/.obsidian/plugins/grimoire`.
3. Coloque os três arquivos nessa pasta.
4. Ative o Grimoire em Configurações, Plugins da comunidade.

### Com o BRAT

O BRAT pode instalar o Grimoire pelos GitHub Releases caso você queira acompanhar builds com tags fora do diretório da comunidade:

1. Instale o plugin "Obsidian42 - BRAT".
2. No BRAT, adicione um plugin beta a partir de `sandsaber/Grimoire`.
3. Ative o Grimoire.

### Pelo código-fonte (desenvolvedores)

Compile o pacote de lançamento e coloque-o no seu vault:

```bash
npm install
npm run build:release

mkdir -p /path/to/your/vault/.obsidian/plugins/grimoire
cp dist/grimoire/main.js dist/grimoire/manifest.json dist/grimoire/styles.css \
  /path/to/your/vault/.obsidian/plugins/grimoire/
```

Depois, ative o Grimoire em Configurações, Plugins da comunidade.

Independentemente do caminho escolhido, instale pelo menos um provedor de CLI antes de começar. O Grimoire envolve as CLIs dos provedores; ele não substitui a configuração de conta, o acesso a modelos, as cotas nem os termos deles.

## Configurar um provedor

Ative os provedores desejados em Configurações, Grimoire, Provedores; eles aparecerão no seletor de modelo. Codex fica ativado no primeiro início; os demais são opcionais.

### Provedores recomendados

Para a melhor experiência com o Grimoire, comece com Codex, Claude Code, OpenCode, MiMoCode, Kimi Code, Grok Build ou Qwen Code. Atualmente, esses provedores oferecem as superfícies de runtime mais robustas para trabalho nativo do vault: sessões persistentes, fluxos de trabalho orientados a planos, atividade de ferramentas e controles avançados de modelo.

Antigravity CLI e Gemini CLI (Legacy) continuam disponíveis para contas Google e casos de compatibilidade, mas hoje não são recomendados como provedores principais do Grimoire. O Grimoire os oferece na base de melhor esforço e implementamos os recursos alternativos que as CLIs atuais permitem, mas suas superfícies ACP e de runtime são tecnicamente limitadas: sessões, aprovações, streaming, metadados de ferramentas/edições, descoberta de modelos e relatórios de uso são incompletos ou pouco confiáveis em comparação com os provedores recomendados.

### Codex

Codex é o provedor padrão no primeiro início. Escolha-o para usar o OpenAI Codex em uma CLI local, autenticado com seu plano ChatGPT ou uma chave de API.

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex
```

Execute-o uma vez, faça login e então ative-o no Grimoire. O instalador independente é agora o caminho principal de instalação; consulte a documentação oficial da CLI do Codex para Windows, Homebrew e opções alternativas de gerenciadores de pacotes.

- [Configuração da CLI do Codex](https://developers.openai.com/codex/cli)
- [Guia de geração de código da OpenAI](https://developers.openai.com/api/docs/guides/code-generation)

No Grimoire, o Codex usa seu protocolo app-server com histórico nativo, bifurcação, modo de plano, entrada de imagem e controles de esforço de raciocínio. O uso do plano aparece quando o Codex informa metadados de limite de taxa.

### Claude Code

Escolha Claude Code quando quiser sua memória de projeto nativa, comandos de barra, configuração MCP, planos e recursos de retroceder/bifurcar, respaldados pela sua assinatura Claude ou chave de API.

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude
```

Autentique-se pelo Claude Code e depois ative-o no Grimoire. O pacote npm antigo está descontinuado; use o instalador nativo acima, Homebrew (`brew install --cask claude-code`), WinGet ou as outras opções do guia rápido oficial.

- [Guia rápido do Claude Code](https://code.claude.com/docs/en/quickstart)

No Grimoire, o Claude Code lê e preserva seus arquivos `.claude/`, executa no SDK do Claude Code e oferece comandos de barra, configurações MCP, agentes, habilidades, planos, retroceder e bifurcar. Quando o Claude informa ambos, você verá janelas de cota e gasto de API lado a lado.

**Respeitar as configurações do Claude Code** vem ativado por padrão. O Grimoire lê as configurações de usuário do Claude Code (`~/.claude/settings.json`) e do vault (`.claude/settings.json`) para `model` e `env`, usando esses valores no seletor de modelos e no ambiente de runtime do Claude. Isso também permite usar no Grimoire modelos personalizados do Claude Code, inclusive gateways compatíveis com Anthropic como MiniMax, Z.ai e outros. As configurações do projeto têm precedência sobre as do usuário, e as configurações explícitas de ambiente do Grimoire têm precedência sobre ambas.

Se o ambiente efetivo do Claude incluir `ANTHROPIC_API_KEY`, o Grimoire poderá atualizar o catálogo de modelos da Anthropic e mesclar os modelos descobertos ao seletor. Sem chave de API, ou se a atualização falhar, o seletor continuará funcionando com aliases do Claude Code, como `Best`, `Fable 5`, `Opus Plan` e variantes 1M, além dos seus modelos `.claude` e modelos personalizados do Grimoire.

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

Antigravity CLI é a substituta do Google para o uso da Gemini CLI por consumidores e pode acessar Gemini, Claude, GPT-OSS e outras famílias de modelos disponíveis na sua conta Antigravity. No Grimoire, trate-a como um provedor de compatibilidade, e não como a opção padrão recomendada.

```bash
agy
```

Instale a Antigravity CLI oficial do Google, autentique-a localmente e então ative Antigravity no Grimoire. O Grimoire detecta `agy` automaticamente no PATH, ou você pode definir um caminho de CLI personalizado nas configurações do provedor.

- [Antigravity CLI](https://antigravity.google/product/antigravity-cli)
- [Guia de migração da Gemini CLI](https://goo.gle/gemini-cli-migration)

No Grimoire, Antigravity executa por `agy --print` com seleção opcional de modelo em `agy models`, e o Grimoire reúne o contexto da nota ativa, do editor, do navegador, do canvas, da busca no vault e do espaço de trabalho do projeto nesse prompt de impressão. Esta é uma integração de melhor esforço porque `agy` atualmente não expõe ao Grimoire um runtime forte compatível com ACP. Sessões persistentes, histórico nativo, modo de plano, streaming, edições de arquivos seguras por aprovação, relatórios de uso confiáveis e fluxos auxiliares permanecem desativados ou limitados até que Antigravity exponha superfícies de runtime estáveis. As imagens são enviadas como arquivos temporários e precisam ser anexadas novamente nas mensagens seguintes.

Limitação conhecida no Windows: as builds atuais de `agy` no Windows podem ser concluídas com sucesso, mas retornar stdout vazio para `agy models` e `agy --print`. O Grimoire usa recuperação de melhor esforço a partir de logs, transcrições e configurações do Antigravity, além de uma lista inicial de modelos Pro AI, mas o suporte ao Antigravity no Windows pode ser menos confiável que no macOS ou Linux até que a CLI upstream exponha saída estável. Se sua conta exibir modelos adicionais no Antigravity, adicione seus rótulos exatos em Configurações do Antigravity > Modelos personalizados.

`agy --print` não expõe os hooks de aprovação de edição de arquivos do Grimoire. Por segurança, o modo compartilhado Safe/normal do Antigravity é bloqueado no Grimoire; alterne o controle da barra de ferramentas do Antigravity para Auto-approve somente se você aceitar que o AGY edite arquivos sem prompts do Grimoire.

### Gemini CLI (Legacy)

Gemini CLI continua disponível como provedor legado de compatibilidade para usuários do Gemini Code Assist Standard, Enterprise, Google Cloud e de chaves de API pagas enquanto o Google continuar atendendo solicitações da Gemini CLI. Ela não é recomendada para novas configurações do Grimoire porque seu suporte a ACP é fraco e vários fluxos de trabalho do Grimoire não podem ser implementados de forma confiável sobre ela. Contas de consumidor Google AI Pro, Ultra e de nível gratuito devem usar Antigravity depois da transição do Google em 18 de junho de 2026, levando em conta as limitações do Antigravity acima.

```bash
gemini
```

Ative a Gemini CLI somente se sua categoria de conta ainda for compatível e se você precisar especificamente desse caminho legado do Google. O Grimoire a executa por `gemini --acp`, inclui o contexto da nota ativa, do editor, do navegador, do canvas, da busca no vault e do espaço de trabalho do projeto no prompt ACP, mantém a descoberta de modelos e modos pertencente ao provedor e a identifica como legada para que não pareça um provedor recomendado. Quando possível, prefira Codex, Claude Code, OpenCode, MiMoCode, Kimi Code, Grok Build ou Qwen Code.

### Qwen Code

Qwen Code é um provedor ACP opcional. Ele preserva sessões persistentes nativas do provedor, retomada e contexto de modelo; descobre modelos e modos pela sessão ACP ao vivo; transmite mensagens, atividade de ferramentas e planos; e oferece entrada de imagem, comandos do provedor e aprovações de arquivos. O Grimoire não hidrata o histórico de mensagens nativo do provedor.

```bash
# Linux and macOS (recommended standalone install)
curl -fsSL https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.sh | bash

# Windows PowerShell
irm https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.ps1 | iex

# Alternative installs
brew install qwen-code
npm install -g @qwen-code/qwen-code@latest # Node.js 22+

qwen --version
qwen
```

Na CLI interativa, use `/auth` e escolha Alibaba ModelStudio, Provedores de terceiros ou Provedor personalizado. O OAuth do Qwen foi descontinuado. Em seguida, ative Qwen Code no Grimoire; ele inicia `qwen --acp`. Safe, Auto-approve e Plan correspondem aos modos `default`, `yolo` e `plan` do Qwen. Os demais modos automáticos do Qwen são mostrados de forma conservadora como Safe na barra de ferramentas compartilhada.

- [Documentação do Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/)
- [Autenticação do Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/)
- [Repositório do Qwen Code](https://github.com/QwenLM/qwen-code)

Se o Qwen não iniciar ou nenhum modelo aparecer, execute `/doctor` dentro do Qwen Code, conclua `/auth`, verifique `qwen --version` e confira o caminho da CLI do Qwen nas configurações do Grimoire.

Escolha esforço de raciocínio Low, Medium, High, XHigh ou Max (High é o padrão). Antes de um turno normal, o Grimoire aplica o comando real `/effort <tier>` do Qwen e o armazena em cache para a sessão; o nível efetivo ainda depende do modelo selecionado e do provedor. As solicitações estruturadas `AskUserQuestion` do Qwen chegam por metadados de permissão ACP e usam a UI de perguntas embutida compartilhada do Grimoire, incluindo respostas de seleção única, seleção múltipla e texto livre.

O Qwen continua responsável pelas próprias credenciais e pela configuração nativa em `~/.qwen/settings.json`. O Grimoire gerencia uma lista MCP de projeto isolada em `.grimoire/mcp/qwen.json` e a injeta nas sessões ACP sem reescrever a configuração nativa do Qwen. O uso aparece somente quando o Qwen emite metadados ACP de token ou custo. Atualmente, o Qwen não oferece controles de bifurcar nem retroceder do Grimoire.

### Devin

A Devin CLI (Cognition) é um provedor ACP opcional. O Grimoire executa `devin acp`, descobre os modelos e modos que sua conta oferece a partir da sessão ativa, transmite mensagens, raciocínio e atividade de ferramentas, pergunta antes de comandos de shell e de gravações de arquivo, e retoma sessões de forma nativa. A lista de modelos depende da conta conectada; isso é da Devin, não do Grimoire.

```bash
# macOS, Linux, WSL
curl -fsSL https://cli.devin.ai/install.sh | bash

# Homebrew
brew install --cask devin-cli

devin auth login
devin --version
```

Entre com `devin auth login` (fluxo pelo navegador) e depois ative a Devin no Grimoire. Safe, Auto-approve e Plan correspondem aos modos `accept-edits`, `bypass` e `plan` da Devin; os modos `smart` e `ask` aparecem como Safe na barra compartilhada.

- [Documentação da Devin CLI](https://docs.devin.ai/cli)
- [Documentação ACP da Devin](https://docs.devin.ai/desktop/acp)

Vale saber uma coisa sobre o modo Safe: a Devin decide sozinha quais comandos de shell são somente leitura e executa esses sem perguntar, e `echo` entra nessa conta mesmo quando redireciona para um arquivo. O Grimoire aprova toda gravação que a Devin faz pelo protocolo, mas uma gravação que o agente encaminha pela própria shell pode escapar disso. Para uma sessão que não deve gravar nada, use Plan.

A Devin cuida das próprias credenciais em `~/.local/share/devin/`. As skills do vault são lidas de `.devin/skills` e `.agents/skills`, e uma skill é o comando de barra da Devin. O Grimoire mantém uma lista MCP própria em `.grimoire/mcp/devin.json` e a injeta na sessão ACP. O uso aparece quando a Devin o informa; não há controle de esforço de raciocínio, porque o esforço faz parte do id do modelo. A Devin não oferece bifurcação nem retrocesso no Grimoire.


### Reasonix

O Reasonix é um agente de programação de código aberto e multimodelo, e aqui um provedor ACP opcional. O Grimoire inicia `reasonix acp`, lê os modelos e modos da sessão viva, transmite mensagens, raciocínio, atividade de ferramentas e planos, pergunta antes das ferramentas sujeitas a permissão e das gravações de arquivo, e retoma sessões nativamente. Quais modelos uma sessão oferece depende dos blocos de provedor na sua configuração do Reasonix; isso é do Reasonix, não do Grimoire.

```bash
# npm
npm i -g reasonix

# Homebrew
brew install esengine/reasonix/reasonix

reasonix setup
reasonix --version
```

Execute `reasonix setup` para configurar um provedor de modelos e suas credenciais e então ative o Reasonix no Grimoire. O Reasonix mantém dois ajustes onde outros provedores mantêm um: o modo da sessão (`normal`, `plan`, `goal`) e uma postura de aprovação de ferramentas separada (`ask`, `auto`, `yolo`). A barra do Grimoire controla os dois. Safe é `normal` perguntando, Plan é `plan` perguntando e Auto-approve é `normal` em `yolo`; `goal` é do próprio Reasonix e aparece como Safe. Como a postura é a única coisa que separa Safe de Auto-approve, um turno que não consegue defini-la é recusado em vez de rodar silenciosamente na mais frouxa.

O Reasonix também faz perguntas, não só pedidos de permissão: sua ferramenta `ask` chega pelo mesmo canal e é desenhada como um cartão cuja descrição é a pergunta e cujas opções numeradas são as respostas. Escolha pelo número; `Enter` não faz nada num cartão com várias respostas, para que uma tecla apertada por hábito não escolha por você.

O esforço de raciocínio é um seletor alimentado pela sessão, não uma lista fixa. Quais níveis um modelo aceita é decidido pelo bloco de provedor que o serve: um que declara `supported_efforts` oferece Disabled, Low, High e Max; um sem ele recebe o conjunto embutido do seu tipo. O Grimoire lê o que a sessão aberta oferece e põe Auto à frente, o que deixa a escolha para o Reasonix. Um nível que a sessão nunca ofereceu nunca é enviado, porque a CLI o recusa contra o modelo.

- [Documentação do Reasonix](https://reasonix.io/docs/)
- [Reasonix no GitHub](https://github.com/esengine/DeepSeek-Reasonix)

Uma coisa a saber sobre o Safe: `ask` protege as ferramentas que o Reasonix classifica como sujeitas a permissão, não todas, então um comando de shell que ele julga somente leitura pode rodar sem perguntar. O Grimoire aprova cada gravação de arquivo que o Reasonix faz pelo protocolo, e é isso que mantém o vault atrás de uma pergunta. Para uma sessão que não pode escrever, use o Plan.

O Reasonix mantém a configuração em `~/.reasonix/config.toml` e lê as chaves de API do ambiente com os nomes que esse arquivo indica. As habilidades do vault são lidas de `.reasonix/skills` e `.agents/skills`. O Grimoire gerencia uma lista MCP de projeto isolada em `.grimoire/mcp/reasonix.json` e a injeta nas sessões ACP. O uso vem das próprias notificações de status do Reasonix, e o custo aparece só quando seu provedor de modelos tem preço. Fork e rewind não são suportados.

Ative **Image attachments as files** para enviar imagens por arquivos em `.grimoire/attachments/`. São necessários um modelo compatível com imagens e uma ferramenta de leitura de arquivos; a leitura exige uma chamada adicional. Arquivos ausentes ou que não podem ser gravados fazem o envio falhar. A opção vem desativada.

### Pi

Instale as duas ferramentas separadamente. O adaptador requer **Node.js 22+** e **Pi 0.80.4+**.

1. Instale o Pi seguindo as [instruções oficiais](https://pi.dev/docs/latest). No macOS e Linux:

   ```bash
   curl -fsSL https://pi.dev/install.sh | sh
   ```

   Como alternativa, com npm:

   ```bash
   npm install -g --ignore-scripts @earendil-works/pi-coding-agent
   ```

2. Instale o adaptador seguindo as [instruções de instalação global](https://github.com/svkozak/pi-acp#global-install):

   ```bash
   npm install -g pi-acp
   ```

3. Abra a configuração do Pi no terminal e configure seu provedor de modelos ou suas chaves de API:

   ```bash
   pi-acp --terminal-login
   ```

4. Reinicie o Obsidian, ative **Pi** em **Configurações → Grimoire → Provedores** e clique em **Refresh all models**. `pi` e `pi-acp` precisam estar disponíveis no `PATH`. Se a detecção falhar, informe o caminho absoluto de `pi-acp` em **Adapter path**; se necessário, adicione `PI_ACP_PI_COMMAND=/absolute/path/to/pi` em **Environment variables** nas configurações do Pi.

O Grimoire inicia o adaptador; não é necessário configurar o Zed nem executar um servidor de adaptador separado.

Os dois executáveis continuam sendo dependências externas. O Grimoire descobre modelos e níveis de raciocínio do Pi, transmite respostas e atividade das ferramentas, envia imagens nativamente e retoma sessões salvas. O seletor compartilhado preserva sua seleção e seus aliases ao atualizar.

**Limitação dos níveis de raciocínio (pi-acp 0.0.33):** o menu oferece apenas níveis que o adaptador consegue aplicar ao modelo escolhido. Por exemplo, o Pi oferece `low`, `high` e `max` para GLM-5.3, mas o adaptador rejeita `max`; por isso, o Grimoire oferece `low`, `high` e **Pi default**. `xhigh` não substitui `max`. O [PR #73](https://github.com/svkozak/pi-acp/pull/73) propõe adicionar `max`; o [PR #125](https://github.com/svkozak/pi-acp/pull/125) propõe descobrir os níveis reais do modelo selecionado. Em 2026-09-21, ambos estavam abertos e ainda não integrados; as correções propostas não fazem parte da versão testada do adaptador.

O Pi gerencia as permissões das ferramentas: pode ler, gravar e executar comandos sem perguntar. O Grimoire mostra solicitações das extensões, mas não oferece os modos Safe ou Plan. MCP, habilidades e modelos de prompts são configurados no Pi. Os arquivos são lidos do disco; o adaptador não fornece texto não salvo do editor, cotas da conta ou ocupação do contexto. Testado com Pi 0.86.1 e pi-acp 0.0.33.

### Command Code

Command Code é opcional. Instale e autentique pelo terminal e depois ative em Configurações → Grimoire → Provedores:

```bash
npm i -g command-code
command-code login
```

A CLI instalada informa os níveis de esforço de raciocínio do modelo selecionado. O seletor oferece apenas os níveis compatíveis e a opção padrão da CLI; modelos sem esforço ajustável não têm seletor. Escolhas explícitas se aplicam à execução atual pela API nativa de alteração de sessão, sem mudar as configurações globais da CLI. A opção padrão mantém o comportamento nativo, inclusive um esforço já salvo na sessão retomada.

Grimoire transmite respostas e atividade das ferramentas pela saída JSON da CLI sem interface, descobre modelos com `--list-models` e salva o ID nativo da sessão para retomada explícita após recarregar. Autenticação, configuração, habilidades, MCP e transcrições continuam sob responsabilidade do Command Code. O uso de contexto compara os tokens de entrada informados com um limite estimado ou definido pelo usuário; cotas da conta e preços não são presumidos.

Ative **Image attachments as files** para enviar imagens por arquivos em `.grimoire/attachments/`. São necessários um modelo compatível com imagens e uma ferramenta de leitura de arquivos; a leitura exige uma chamada adicional. Arquivos ausentes ou que não podem ser gravados fazem o envio falhar. A opção vem desativada.

**Safe** pausa edições, comandos e outras ferramentas que não sejam somente de leitura até uma aprovação pontual no Grimoire. Negar, cancelar ou perder a conexão de aprovação impede a execução. Atualmente, Safe exige a instalação npm verificada do Command Code 1.53.0 / 1.66.0 e desativa subagentes nativos, cujos ciclos separados não podem usar esse mecanismo. **Auto-approve** funciona sem solicitações do Grimoire; as regras nativas de negação e confirmação continuam valendo nos dois modos. A integração não oferece perguntas interativas, controles de planejamento, comandos slash, MCP/habilidades/agentes gerenciados, tarefas auxiliares, ramificação, retrocesso nem importação do histórico nativo.

- [Documentação do modo sem interface do Command Code](https://commandcode.ai/docs/headless)

### OpenCode

Escolha OpenCode para um agente independente de modelo que traz sua própria configuração de provedor.

```bash
curl -fsSL https://opencode.ai/install | bash
opencode
```

Instalações por Homebrew, npm, bun e outros gerenciadores de pacotes também funcionam. Configure as credenciais do seu provedor no OpenCode e depois ative-o no Grimoire.

- [Download do OpenCode](https://opencode.ai/download)
- [Documentação de provedores do OpenCode](https://opencode.ai/docs/providers)
- [Documentação de configuração do OpenCode](https://opencode.ai/docs/config)

No Grimoire, o OpenCode é executado sobre ACP com artefatos de inicialização gerenciados pelo Grimoire, além de runtime persistente, histórico nativo, modo de plano, entrada de imagem, comandos do provedor e esforço de raciocínio. Ele informa o gasto mensal quando há metadados de custo disponíveis.

### MiMoCode

MiMoCode (Xiaomi) é uma bifurcação do OpenCode com memória persistente, gerenciamento inteligente de contexto e orquestração de subagentes.

```bash
curl -fsSL https://mimo.xiaomi.com/install | bash
mimo
```

- [MiMoCode no GitHub](https://github.com/XiaomiMiMo/MiMo-Code)

### Kimi Code

Kimi Code CLI (MoonshotAI) é um agente de terminal multiprovedor compatível com modelos Kimi, OpenAI, Anthropic, Gemini e Vertex AI.

```bash
curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash
kimi
```

- [Kimi Code no GitHub](https://github.com/MoonshotAI/kimi-code)

### Grok Build

Escolha Grok Build para a CLI agêntica da xAI no Obsidian. Faça login com Grok OAuth ou use uma chave de API da xAI.

```bash
grok
```

Instale a CLI Grok da xAI, autentique-se com OAuth do grok.com ou configure chaves de API e depois ative Grok Build no Grimoire.

- [Documentação do Grok Build](https://docs.x.ai/build/overview)
- [Grok 4.5](https://docs.x.ai/developers/grok-4-5)
- [Uso e limites](https://docs.x.ai/grok/faq)

Grok 4.5 é atualmente o modelo padrão do Grok Build. O Grimoire descobre o catálogo de modelos disponível pela conta autenticada da CLI Grok, em vez de manter uma lista estática, portanto a disponibilidade pode variar conforme a conta e a versão da CLI e é atualizada automaticamente.

No Grimoire, Grok Build é executado sobre ACP por `grok agent stdio` com artefatos de inicialização gerenciados pelo Grimoire em `.grimoire/grok/`, runtime persistente, hidratação nativa de histórico JSONL, modo de plano, entrada de imagem, comandos do provedor, esforço de raciocínio em modelos nativos, retroceder e bifurcar. Com OAuth, o Grimoire mostra a franquia semanal compartilhada de uso do Grok, o horário de redefinição e Extra Usage Credits quando disponíveis; o gasto de API é agregado a partir dos metadados de custo da sessão quando informado.

## Sua primeira conversa

1. Escolha um provedor e um modelo no compositor.
2. Defina o esforço de raciocínio e escolha Safe, Auto-approve ou Plan no controle de permissão.
3. Mencione notas, pastas ou qualquer contexto que queira incluir.
4. Envie o turno.
5. Acompanhe as chamadas de ferramentas, o uso e a saída aparecerem no painel.

## Recursos

### Espaço de trabalho do chat

Um painel lateral focado, com várias abas. Cada aba mantém seu próprio rascunho, provedor, modelo, contexto e runtime. Feche e reabra o Obsidian, e suas sessões voltarão, com o provedor, o modelo e o esforço de raciocínio preservados em cada resposta. Retroceder e bifurcar aparecem quando o provedor ativo os oferece. A rolagem automática recua no momento em que você rola para ler algo. Após 10 segundos sem saída visível, um indicador compartilhado de espera mostra o provedor ativo e o tempo decorrido; ele pausa enquanto uma pergunta ou permissão estiver aguardando.

### Abas, histórico e navegação

Abra o menu de ações da aba ou clique nela com o botão direito para renomear, duplicar ou fechar abas. O clique do meio fecha uma aba; Desfazer restaura seu rascunho e posição. Pesquise chats anteriores no histórico flutuante e abra conversas em novas abas. O histórico distingue títulos definidos manualmente e gerados pelo modelo. A barra da conversa oferece controles de navegação e um índice; respostas concluídas mostram o horário de conclusão.

<p align="center">
  <img src="../../assets/readme/conversation-history.png" alt="Pesquisa no histórico com três conversas Ocean Atlas, seus modelos e a origem dos títulos" width="100%">
</p>

### Agentes em paralelo, configurações e editor de mensagens

O cartão de aprovação **Trabalhadores paralelos** mostra o modelo herdado e permite selecionar apenas as tarefas propostas a iniciar. As configurações usam a busca nativa do Obsidian e mantêm uma entrada permanente de Novidades. As configurações do provedor e o compositor usam uma superfície consistente entre os provedores, mantendo controles e configurações pertencentes ao provedor onde devem estar.

### Atalhos de teclado

| Atalho | Ação |
| --- | --- |
| `Enter` | Envia o turno atual. Desativado quando **Enviar somente com o botão** está ativado. |
| `Shift+Enter` | Insere uma nova linha no compositor. |
| `Shift+Tab` | Alterna os modos de permissão: `Safe -> Auto-approve -> Plan -> Safe`. Provedores sem modo de plano alternam entre Safe e Auto-approve. |
| `Escape` | Interrompe a resposta ativa ou fecha o histórico flutuante. |

### Seletor de modelos

Um único seletor, agrupado por provedor e ordenado por rótulo: Antigravity, Claude Code, Codex, Command Code, Devin, Gemini CLI (Legacy), Grok Build, Kimi Code, MiMoCode, OpenCode, Pi, Qwen Code e Reasonix. A busca percorre rótulos, descrições, grupos e IDs de modelos sem redimensionar o menu enquanto você filtra. Os catálogos carregam de forma preguiçosa e lembram os grupos que você recolheu. Adicione aliases personalizados e substituições de janela de contexto nas configurações. As variantes 1M do Claude são opções extras, não substitutas dos modelos básicos.

OpenCode, MiMoCode, Kimi Code, Grok Build, Command Code e Pi compartilham o seletor de modelos nas configurações: linhas selecionadas com aliases, catálogo pesquisável e **Refresh all models**. A atualização preserva a seleção e os aliases; os filtros de provedor aparecem quando a CLI informa seus nomes.

### Uso e custo

Um selo ao lado do seletor de modelo mantém à vista o uso do provedor ativo, com leituras mais completas dentro do menu de modelos: janelas de cota quando um provedor as expõe, e gasto quando há apenas custo disponível. Números desatualizados permanecem no lugar enquanto uma atualização está em andamento ou falha, para que o medidor nunca fique em branco. Desative tudo nas configurações se preferir uma UI mais discreta.

| Provedor | Origem dos dados de uso |
| --- | --- |
| Codex | Notificações de limite de taxa da conta e `account/rateLimits/read`, quando disponível |
| Claude Code | Eventos de limite de taxa do SDK, `.grimoire/claude/statusline-usage.json` opcional e metadados de custo do resultado do SDK |
| Antigravity CLI | Ainda não disponível de forma confiável em `agy --print` |
| Gemini CLI (Legacy) | Metadados de custo ACP quando a Gemini CLI os informa; somente provedor legado |
| Qwen Code | Metadados ACP de token e custo quando Qwen Code os informa |
| Devin | Total de créditos da sessão informado via ACP, como gasto mensal |
| Reasonix | Custo por turno vindo das próprias notificações de status, quando o provedor de modelos configurado tem preço |
| Pi | Não informado pelo adaptador pi-acp |
| OpenCode | Gasto mensal agregado a partir de ACP e metadados de custo da sessão |
| MiMoCode | Gasto mensal agregado a partir de ACP e metadados de custo da sessão |
| Kimi Code | Gasto mensal agregado a partir de ACP e metadados de custo da sessão |
| Grok Build | Uso semanal compartilhado do Grok, horário de redefinição e Extra Usage Credits via OAuth; gasto mensal de API a partir dos metadados de custo da sessão |

### Modo de planejamento

Quando o provedor ativo oferece modo de plano, você pode ativá-lo de duas formas:

- Clique no controle de permissão do compositor até chegar a Plan: `Safe -> Auto-approve -> Plan`.
- Pressione `Shift+Tab` para percorrer a sequência completa: `Safe -> Auto-approve -> Plan -> Safe`.

O modo de plano solicita que o provedor planeje antes de começar a fazer alterações. No compositor, ele usa o mesmo controle de permissão de Safe e Auto-approve, para que o modo ativo permaneça visível enquanto você trabalha.

Quando um provedor termina o planejamento, o Grimoire mostra um cartão recolhível de plano concluído com o plano renderizado, as permissões solicitadas e linhas fáceis de usar com o teclado. Ao aprovar, você continua na mesma sessão; ao fornecer feedback, o modo de plano permanece ativo para que o provedor possa revisar o plano.

### Contexto e menções

Mencione notas e pastas do vault diretamente no compositor, inclua a nota atual ou vinculada e adicione caminhos persistentes de contexto externo nas configurações. Cole ou solte imagens quando o provedor aceitar entrada de imagem. Mencione servidores MCP quando a integração do provedor oferecer suporte. A aba Contexto mostra a nota vinculada, o modelo, o modo de permissão, arquivos fixados, artefatos de inicialização como `.grimoire/grok/system.md` e arquivos que o agente carregou durante a sessão.

### Edição na nota

Execute "Grimoire: Inline edit" sobre uma seleção. Um prompt é aberto ao lado do texto, a edição retorna como um diff que você aceita ou rejeita, e o fluxo passa pelo serviço de edição em linha apoiado pelo provedor. Ele lida tanto com a substituição de uma seleção quanto com a inserção de novo texto.

### Perguntas de esclarecimento

Quando um provedor solicita entrada estruturada do usuário, o Grimoire pausa o turno e renderiza a pergunta sobre o compositor. Claude Code expõe isso como `AskUserQuestion`; o app-server do Codex expõe uma superfície experimental `request_user_input` / `requestUserInput`; Qwen Code entrega `AskUserQuestion` por metadados de permissão ACP. O Grimoire normaliza esses mecanismos específicos de cada provedor na mesma UI de pergunta em linha. Respostas de seleção única, seleção múltipla e texto livre retornam à execução do provedor para que o agente possa continuar sem uma mensagem de chat separada.

Se a pergunta cobrir um texto de chat que você precisa reler, use a divisa no cabeçalho da pergunta para recolhê-la em uma barra compacta. Suas respostas selecionadas e em texto livre permanecerão no lugar até você expandir ou enviar a pergunta.

### Comandos

Os comandos integrados abrangem fluxos de trabalho do Grimoire, como geração de imagens e retomada. Provedores que expõem seus próprios comandos, como comandos de barra do Claude Code e comandos de runtime do OpenCode, Grok Build ou Qwen Code, os disponibilizam em catálogos pertencentes ao provedor. Oculte nas configurações aqueles que você não usa no menu suspenso.

### Geração de imagens

Cole ou solte imagens para anexá-las. O comando integrado `/image [prompt]` não chama nenhuma API de imagem por conta própria. Ele entrega um turno normal ao provedor ativo, com instruções para usar a geração de imagens que você configurou: ferramentas nativas do provedor, ferramentas MCP ou um comando local. O agente salva o resultado no seu vault e retorna uma incorporação como `![[path/to/image.png]]`. Se não houver nada configurado para gerar imagens, você receberá uma resposta simples explicando o que está faltando.

### Segurança e permissões

Os modos de permissão pertencem ao provedor; por isso, o Grimoire os apresenta em controles compartilhados do compositor, em vez de reinventá-los. O controle de permissão e `Shift+Tab` percorrem Safe, Auto-approve e Plan quando o provedor ativo oferece modo de plano. O modo Safe e os prompts de permissão ficam visíveis enquanto você trabalha. O modo bang-bash só aparece quando um provedor ativado o oferece. Trate servidores MCP configurados, acesso ao shell e chaves de API como itens sensíveis, pois eles são.

### Registros de depuração

Desativado por padrão. Ao ativá-lo, o Grimoire grava JSONL sanitizado em `.grimoire/logs/YYYY-MM-DD.jsonl`, com prompts, respostas, conteúdo de notas, caminhos, valores de ambiente e segredos ocultados. Ele serve para diagnosticar problemas de provedor e runtime, não para manter uma transcrição.

### Configurações

Quatro abas organizam as configurações: **Geral** para idioma, posição do chat, abas e exibição; **Provedores** para ativar CLIs e configurar seus modelos; **Avançado** para contexto, conversas, ferramentas e diagnóstico; e **Sobre** para versão e novidades. As configurações aparecem na pesquisa nativa do Obsidian.

A visão geral dos provedores mostra as CLIs detectadas e os controles de ativação. As configurações do provedor selecionado aparecem abaixo.

<p align="center">
  <img src="../../assets/readme/settings-providers.png" alt="Visão das doze integrações CLI do Grimoire e das configurações de modelos Codex" width="100%">
</p>

<details>
<summary>Configurações gerais</summary>

<p align="center">
  <img src="../../assets/readme/settings-general.png" alt="Configurações de idioma, posição do painel, abas, rótulos, rolagem e títulos das conversas" width="100%">
</p>

</details>

## Onde o Grimoire mantém seus dados

| Caminho | Conteúdo |
| --- | --- |
| `.grimoire/grimoire-settings.json` | Configurações do aplicativo e dos provedores |
| `.grimoire/sessions/*.meta.json` | Metadados das sessões |
| `.grimoire/logs/YYYY-MM-DD.jsonl` | Registros de depuração sanitizados, ativados opcionalmente |
| `.grimoire/claude/statusline-usage.json` | Instantâneo do uso do Claude para o medidor de plano |
| `.grimoire/grok/` | Artefatos de inicialização do Grok Build, configuração gerenciada e ponteiros de sessão |

Arquivos nativos de provedores em `.claude/`, `.codex/`, `.opencode/` e `.grimoire/grok/` são lidos e gravados no local, portanto a configuração do seu provedor continua portátil fora do Grimoire.

## Privacidade

O Grimoire é executado dentro do Obsidian, na sua máquina. Ele não tem backend, não adiciona telemetria e jamais envia seus prompts, respostas, notas, arquivos, saída de ferramentas, chaves de API ou logs de uso para qualquer serviço do Grimoire. Os únicos logs gravados são os registros de depuração opcionais e sanitizados acima, que permanecem no seu vault.

O que ele não pode ocultar é o próprio provedor. Qualquer CLI que você ativar recebe o prompt, o contexto selecionado e os arquivos, imagens, saída de ferramentas e comandos necessários para uma solicitação. Essa CLI pode então se comunicar com Anthropic, OpenAI, Google, seus fornecedores OpenCode configurados, servidores MCP ou qualquer outra coisa que ela esteja configurada para acessar. Termos, retenção, cobrança, limites de taxa e políticas de privacidade são do provedor, não do Grimoire. A função do Grimoire é tornar esse limite visível e mantê-lo sob seu controle dentro do Obsidian.

Para um resumo voltado às políticas do Obsidian sobre uso de rede, requisitos de conta, acesso a arquivos externos, registros e telemetria, consulte [DISCLOSURES.md](../../DISCLOSURES.md).

## Desenvolvimento

Contribuições são bem-vindas. Leia [CONTRIBUTING.md](../../CONTRIBUTING.md) antes de abrir uma pull request; ele aborda responsabilidade de provedores, limites de segurança, testes, artefatos gerados e as expectativas de revisão do repositório.

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run test
npm run build
npm run build:release
```

Antes de publicar ou enviar mudanças relevantes de UI ou provedores, execute a verificação local completa:

```bash
npm run test -- --selectProjects unit
npm run typecheck
npm run lint
npm run build:release
```

`npm run build:release` atualiza o `main.js` gerado, o `styles.css` na raiz e `dist/grimoire`.

npm é o gerenciador de pacotes canônico para desenvolvimento, CI e lançamentos. Mantenha `package-lock.json` atualizado quando as dependências mudarem; arquivos de bloqueio de gerenciadores de pacotes secundários não são incluídos intencionalmente no repositório.

## Versões publicadas

Os lançamentos do Grimoire são publicados a partir de tags semver, como `1.0.0`. O fluxo de lançamento executa a verificação local, cria o pacote do Obsidian, verifica se a tag corresponde a `package.json` e `manifest.json` e depois anexa `main.js`, `manifest.json` e `styles.css` ao GitHub Release.

Os plugins da comunidade do Obsidian são o caminho recomendado de instalação para usuários. Os GitHub Releases continuam trazendo os ativos do pacote para instalações manuais e BRAT. Use `main` para o desenvolvimento que pode ser lançado e depois publique criando uma tag da versão que corresponde ao manifesto.

## Roteiro de desenvolvimento

Hoje, o Grimoire inclui Codex, Claude Code, Antigravity CLI, Gemini CLI (Legacy), OpenCode, MiMoCode, Kimi Code, Grok Build, Qwen Code, Devin, Pi, Reasonix e Command Code.

Os próximos da lista são GitHub Copilot CLI, outros provedores compatíveis com ACP e CLIs de modelos locais assim que seus runtimes estiverem estáveis o suficiente para serem incorporados ao Obsidian. As notas de implementação estão em [docs/provider-roadmap.md](../provider-roadmap.md).

## Licença

MIT. Consulte [LICENSE](../../LICENSE).
