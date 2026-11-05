# SkillVortex Extension

Extensao independente do VS Code para organizar Markdown em um cofre portatil.
Esta e a **etapa 1 da migracao** do SkillVortex desktop. O aplicativo antigo
permanece intacto em sua pasta e repositorio.

## Funcionalidades implementadas

- Dashboard React + Ant Design em Webview, tema escuro, busca, filtros de status,
  categoria e agente, e cards responsivos de skills.
- Criacao e abertura de cofres locais, com validacao de metadados.
- Importacao explicita do banco SQLite do desktop para um **cofre novo**.
- Preservacao de IDs, categorias, tags, agentes, status e vinculos dos projetos.
- Criacao e importacao de skills Markdown para o cofre.
- Associacao de pastas locais aos projetos e varredura das pastas `skills` dos
  agentes com selecao previa dos Markdown encontrados.
- Editor integrado com Monaco local, titulo, descricao, categoria, tags, agentes,
  governanca, conteudo Markdown, pre-visualizacao GFM e projetos vinculados.
- Criacao de categorias, associacao automatica de projetos, selecao do projeto ativo e gerenciamento
  dos vinculos por skill.
- Inclusao opcional dos oito cards da captura de dashboard, com metadados e
  Markdown editaveis; IDs, caminhos e conteudo Markdown existentes sao preservados.
- Desvinculacao do catalogo preservando o arquivo ou exclusao fisica confirmada.
- Gravacao validada dos metadados e do Markdown no cofre.
- Criacao de backups locais completos e restauracao confirmada, com ponto de
  recuperacao automatico do estado anterior.
- Tela inicial com acesso direto para criar/abrir o cofre, resumo dos recursos e
  capturas de referencia das telas desktop de dashboard e editor.
- Indice SQLite local reconstruido ao abrir/atualizar a biblioteca.
- Repositorio Git local independente, sem commit ou publicacao automatica.

```text
MeuCofre/
├── skills/
│   └── <nome-legivel-da-skill>.md
└── .skillvortex/
    ├── catalogo.json
    ├── projetos.json
    └── backups/
```

Os JSON e Markdown sao a fonte de verdade. Os caminhos dos Markdown sao
relativos ao cofre. Novos nomes de arquivo e pastas publicadas derivam do titulo
da skill em kebab-case; um sufixo numerico evita colisoes. Os IDs internos
permanecem nos metadados, e cofres antigos continuam sendo lidos.

O SQLite fica em `globalStorageUri`, fora do cofre. Utilizamos **sql.js / WASM**
para nao depender de bindings nativos ou do `node:sqlite` do Electron.
O indice e descartavel e pode ser reconstruido. `globalState` guarda somente
a localizacao do cofre, nao os dados da biblioteca.

## Executar

Requisitos: Node.js 22.12 ou superior e VS Code 1.95 ou superior.

```sh
npm ci
npm run typecheck
npm test
npm run build
```

`npm run test:host` executa um smoke test em um perfil isolado do VS Code:
ativacao, comandos, aba Webview, importacao de um banco de teste e indice WASM.
Nao instala a extensao no perfil pessoal nem importa seus dados. Usa o VS Code
instalado no macOS quando disponivel; em outros ambientes pode baixar um host
de teste. `VSCODE_EXECUTABLE_PATH` permite selecionar um executavel existente.

Abra esta pasta no VS Code e pressione **F5**, selecionando
**SkillVortex Extension**. Na janela Extension Development Host, abra a paleta
e execute **SkillVortex: Abrir biblioteca**.

Depois de instalada, clique em **$(book) SkillVortex** na barra de status
inferior do VS Code para abrir as telas. Na tela inicial, **Criar cofre** abre
o seletor de local e nome; **Abrir cofre** carrega um existente. A tela tambem
mostra as funcionalidades e capturas de referencia do dashboard e editor. O
comando da Paleta de Comandos continua disponivel como alternativa.

Um cofre novo comeca vazio: instalar a extensao nao importa seus Markdown nem
adiciona exemplos automaticamente. Depois de criar ou abrir o cofre, clique em
**Carregar exemplos** para adicionar os oito cards da captura de referencia.
Os exemplos sao editaveis e nao constituem validacao automatica de qualidade.

Alternativamente:

```sh
code --extensionDevelopmentPath=/caminho/SkillVortex-vscode
```

Para gerar e instalar um VSIX:

```sh
npm run package
```

O comando compila o codigo atual e gera o VSIX em `builds/`, com o nome e a
versao do `package.json`. Use **Extensions: Install from VSIX...** e selecione o
arquivo recem-gerado. Recarregue a janela do VS Code apos instalar. Nao ha
Electron ou instalador desktop proprio na nova versao.

## Biblioteca, projetos e editor

Crie ou abra um cofre pelos botoes da Webview ou pelos comandos:

- **SkillVortex: Criar cofre**: selecione uma pasta pai e um nome novo.
- **SkillVortex: Abrir cofre**: selecione uma pasta com os dois JSON validos.
- **Nova Skill**: cria um Markdown no cofre e abre o editor integrado.
- **Cor do card**: no editor de uma skill nova ou existente, escolha uma das 10
  cores no seletor e clique em **Salvar**. A opcao **Automatica (categoria)**
  usa a cor da categoria, como nas skills existentes sem uma cor escolhida.
- **Descricao obrigatoria**: toda skill precisa de uma descricao para ser salva.
  O nome legivel da skill determina o nome do arquivo e da pasta publicada,
  convertendo acentos e espacos para kebab-case; por exemplo,
  `Verifica consistencia do HTML` usa `skills/verifica-consistencia-do-html.md`.
- **Importar .md**: copia arquivos Markdown selecionados para o cofre; arquivos
  acima de 2 MB sao recusados.
- **Nova Categoria**: adiciona uma categoria ao catalogo. Os projetos sao
  cadastrados automaticamente ao ativar **Usar no Projeto** para uma pasta,
  sem formulario de criacao manual. O projeto ativo controla os switches dos cards.
- Cards ativos no projeto ficam com o fundo um pouco mais claro, preservando
  a cor escolhida. Ao passar o cursor, os cards aumentam levemente com uma
  transicao suave; o efeito respeita a preferencia por movimento reduzido.
- **Usar no Projeto**: o botao existente publica a skill como
  `.github/skills/<nome-legivel>/SKILL.md`, com frontmatter para o GitHub
  Copilot. Sem projeto ativo ou pasta associada, usa a unica pasta local aberta
  no VS Code ou solicita uma pasta; cria o cadastro do projeto quando necessario.
  **Executar** abre o chat do Copilot com o comando `/<nome-legivel>`
  preenchido para a skill ativa; revise o pedido e envie no chat. A pasta
  associada precisa estar aberta como pasta do workspace no VS Code.
  Ao desativar, move o Markdown para `.skillvortex/disabled-skills/` no cofre,
  preservando inclusive edicoes feitas no projeto. Reativar restaura esse arquivo.
  A pasta publicada tambem e removida quando nao contem arquivos adicionais;
  pastas com outros arquivos ficam registradas para a exclusao confirmada do card.
  O cofre deve ficar fora da pasta do projeto. Arquivos existentes e links
  simbolicos nao sao sobrescritos. Pastas criadas pelo SkillVortex recebem uma
  identificacao oculta para permitir a exclusao segura posterior.
- **Acoes do card**: **Executar** fica habilitado somente quando a skill esta
  ativa no projeto selecionado. **Editar**, **Desvincular** e **Excluir** ficam
  desabilitados enquanto a skill estiver ativa em qualquer projeto. Desative-a
  em todos eles antes de usar essas acoes. Ao salvar o editor com projetos
  selecionados, a skill e ativada e o dashboard e exibido.
- **Carregar exemplos**: apos confirmacao, cria no cofre os cards ausentes e sincroniza titulo,
  categoria, descricao, etiquetas, agentes e status dos exemplos que ja existem
  para corresponder a captura (acessibilidade, REST, arquitetura, seguranca,
  Git, SEO, CI e Vitest). Preserva IDs, caminhos e conteudo Markdown existentes.
  Skills bloqueadas sao desvinculadas dos projetos. Nao busca arquivos na pasta
  do projeto nem exige um projeto ativo.
- **Associar pasta** vincula uma pasta local ao projeto ativo. **Buscar skills
  no projeto** procura Markdown nas pastas `skills` dos agentes e mostra os
  encontrados antes de importar os selecionados.
- **Biblioteca**: pesquise por texto e filtre por status, categoria e agente.
- **Editor**: altere metadados e Markdown, confira a pre-visualizacao e ajuste
  os projetos vinculados. Monaco fornece realce Markdown e permite colar texto
  com `Ctrl+V` / `Cmd+V`; `Ctrl+S` / `Cmd+S` ou **Salvar** grava as alteracoes
  no cofre.
- **Bloqueada**: ao salvar, remove os vinculos dessa skill em todos os projetos.
- **Desvincular**: remove a skill do catalogo, preservando seus arquivos.
  **Excluir** remove o cadastro e, apos confirmacao, apaga o Markdown do cofre,
  as copias desativadas e as pastas publicadas identificadas em todos os projetos,
  inclusive outros arquivos dentro dessas pastas. O arquivo original importado
  e preservado; se ele estiver dentro de uma pasta a excluir, a operacao e
  recusada. Pastas preexistentes ou sem identificacao confiavel nao sao apagadas.
  Quando uma dessas pastas existir, a exclusao e bloqueada ate que ela seja
  preservada ou removida manualmente. Em cofres antigos, se uma skill ja havia
  sido desativada sem registrar a pasta, preserve ou remova a pasta antiga
  manualmente e ative e desative a skill novamente para registrar uma nova pasta.

O editor Monaco e seus workers sao empacotados localmente; a extensao nao baixa
o editor de um CDN. A pre-visualizacao suporta GitHub Flavored Markdown sem
permitir HTML embutido. Skills ativadas sao publicadas para descoberta automatica
do GitHub Copilot; os nomes de agentes no catalogo continuam sendo metadados.
Desativar, bloquear ou desvincular uma skill retira o `SKILL.md` do projeto e
preserva seu conteudo no cofre. Isso nao remove instrucoes ja carregadas numa
conversa nem impede um agente de ler explicitamente arquivos acessiveis.
Vinculos antigos sem pasta associada precisam de **Associar pasta** antes de
serem publicados. A restauracao de backups tambem sincroniza os arquivos ativos;
as copias desativadas permanecem no cofre, mas nao fazem parte do snapshot dos
Markdown da biblioteca.

A varredura procura `.github/skills`, `.agents/skills` e `.agent/skills` na raiz
do projeto associado e em todas as pastas locais abertas como workspace no VS
Code. Assim, encontra as skills mesmo quando a pasta associada esta em outro
caminho ou volume. Inclui Markdown com qualquer nome, como `SKILL.md`,
`1-skill-de-teste.md` ou `ANALISE-SEO.md`, inclusive em subpastas, sem exigir
metadados. Ignora nomes convencionais de documentacao ou configuracao, como
`README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `SECURITY.md` e `CONFIG.md`, e
pastas como `docs`, `references`, `examples`, `assets` e `config`. Tambem ignora
links simbolicos e diretorios gerados como `.git`, `node_modules`, `vendor`,
`dist`, `out`, `build`, `release`, `.next`, `.venv`, `venv` e `coverage`.
Prompts, instrucoes, workflows e arquivos fora das pastas `skills` nao aparecem
na busca. Ela nao percorre todo o disco: considera apenas o projeto associado e
as pastas locais que estao abertas no workspace.

A classificacao usa convencoes: um documento com nome incomum ainda pode
aparecer, e uma skill com nome reservado pode ser omitida. Nesse caso, use
**Importar .md** para seleciona-la manualmente. Cada item mostra o agente de
origem; skills publicadas pelo proprio SkillVortex em `.github/skills` aparecem
desmarcadas. A busca para com erro acima de 50.000 entradas ou 1.000 Markdown.
Arquivos selecionados maiores que 2 MB sao recusados. Arquivos ja importados
aparecem na selecao e sao ignorados ao importar novamente.

O backup cria uma copia completa do catalogo, projetos e Markdown dentro de
`.skillvortex/backups/`. A restauracao substitui os metadados, preserva arquivos
que nao estao no backup e cria antes um ponto de recuperacao do estado atual.
Backups invalidos geram erro explicito. A extensao ainda nao monitora alteracoes
externas.

## Migrar os dados do desktop

1. Feche completamente o desktop e faca backup do seu diretorio de dados.
2. Execute **SkillVortex: Importar banco do desktop**.
3. Selecione o arquivo `skillvortex.sqlite` em `userData` do desktop.
4. Confirme que o desktop esta fechado.
5. Revise a quantidade de skills/projetos e os avisos.
6. Selecione uma pasta pai e um nome de cofre que **ainda nao exista**.

O banco e os arquivos originais sao apenas lidos. O conteudo atual do Markdown
tem prioridade. Se o arquivo nao existir, o conteudo salvo no banco pode ser
recuperado, com aviso na previa. Se nao houver conteudo recuperavel, a importacao
falha explicitamente. Arquivos maiores que 2 MB sao recusados.

Um WAL nao vazio interrompe a importacao para evitar ler um banco incompleto.
Feche o desktop normalmente para consolidar o WAL; **nao apague o WAL**.
A migracao nao mescla nem sobrescreve um cofre existente. A gravacao prepara
os arquivos antes de publicar os metadados; erros desfazem o destino recem-criado.
Uma interrupcao abrupta pode deixar uma pasta parcial, que nao deve ser usada
como cofre: preserve o banco original e escolha outro destino para repetir.

O caminho original de cada skill e preservado como referencia. Caminhos dos
projetos precisam ser reassociados se voce trocar de maquina (interface prevista
para uma proxima etapa). A migracao mantem bloqueios; vinculos invalidos sao
recusados, nao corrigidos silenciosamente.

## Backup, Drive e credenciais

- O cofre pode ser copiado ou colocado em uma pasta sincronizada.
- **Sincronizacao nao e backup** e edicao simultanea nao e suportada nesta etapa.
- Para backup manual, termine as operacoes e copie **toda a pasta do cofre**.
- **Criar backup** guarda uma copia local versionada do cofre. **Restaurar
  backup** permite selecionar uma copia e confirma antes de substituir os
  metadados; o estado atual vira um ponto de recuperacao automatico.
- Os backups ficam dentro do proprio cofre. Copie toda a pasta para ter uma
  copia independente; sincronizacao simultanea nao e suportada.
- Backups nao sao criptografados e ainda nao ha politica automatica de retencao.
- Cofre significa pasta organizada; nao significa dados criptografados.
- Credenciais futuras devem usar `SecretStorage`, nunca catalogo ou projetos.
  Nesta etapa nao ha integracao que solicite tokens, portanto nao ha cofre de
  credenciais ou exportacao de segredos implementados.

## Proximas etapas

1. Journal e recuperacao de operacoes interrompidas.
2. Monitoramento de alteracoes externas e sincronizacao opcional com agentes,
   sempre com previa e protecao contra sobrescrita.

A extensao exige ambiente local e confiavel. Remoto, VS Code Web e workspaces
virtuais nao sao suportados nesta primeira etapa.
