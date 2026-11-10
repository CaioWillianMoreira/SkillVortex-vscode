# SkillVortex Extension

Extensao independente do VS Code para organizar Markdown em uma biblioteca de skills portatil.
Esta e a **etapa 1 da migracao** do SkillVortex desktop. O aplicativo antigo
permanece intacto em sua pasta e repositorio.

## Funcionalidades implementadas

- Dashboard React + Ant Design em Webview, tema escuro, busca, filtros de status,
  categoria e colecao, e cards de skills em uma grade fixa de tres colunas.
  Linhas com um ou dois cards preservam as posicoes vazias, sem expandir os cards.
- Criacao e abertura de cofres locais, com validacao de metadados.
- Importacao explicita do banco SQLite do desktop para um **cofre novo**.
- Preservacao de IDs, categorias, tags, agentes, status e vinculos dos projetos.
- Criacao e importacao de skills Markdown para o cofre.
- Associacao de pastas locais aos projetos e varredura das pastas `skills` dos
  agentes com selecao previa dos Markdown encontrados.
- Editor integrado com Monaco local, titulo, descricao, categoria, tags, agentes,
  governanca, conteudo Markdown, pre-visualizacao GFM e projetos vinculados.
- Criacao e exclusao de categorias vazias, associacao automatica de projetos, selecao do projeto ativo e gerenciamento
  dos vinculos por skill.
- Inclusao opcional de quatro cards de conjuntos (1, 4, 2 e 0 skills), com metadados e
  Markdown editaveis; IDs, caminhos e conteudo Markdown existentes sao preservados.
- Desvinculacao do catalogo preservando o arquivo ou exclusao fisica confirmada.
- Gravacao validada dos metadados e do Markdown no cofre.
- Criacao de backups locais completos e restauracao confirmada, com ponto de
  recuperacao automatico do estado anterior.
- Tela inicial com acesso direto para criar/abrir o cofre, resumo dos recursos e
  capturas completas das telas atuais da extensao: dashboard e editor, com dados de exemplo.
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

`npm test` executa a regressao de criacao, abertura, recriacao e portabilidade
de bibliotecas; cadastros, cancelamentos, etiquetas e agentes; importacao com
rollback; publicacao isolada; backups e restauracao; edicao externa, conflitos,
merge manual, snapshots e limites de 2 MB. A matriz de sincronizacao cobre
as tres origens (biblioteca, Copilot e Antigravity), um ou dois projetos e
conteudo LF, CRLF e Unicode.

`npm run test:host` valida em um perfil isolado do VS Code:
ativacao, comandos, aba Webview, botoes, formularios, filtros, switches e colagem;
edicao e salvamento no editor real, comparacao, merge manual, sincronizacao em
dois projetos, recuperacao, exclusao e recriacao de biblioteca; importacao de
um banco de teste e indice WASM.
Nao instala a extensao no perfil pessoal nem importa seus dados. Usa o VS Code
instalado no macOS quando disponivel; em outros ambientes pode baixar um host
de teste. `VSCODE_EXECUTABLE_PATH` permite selecionar um executavel existente.
Os seletores nativos e as confirmacoes sao simulados nos testes dos handlers;
as interacoes da Webview sao automatizadas em paineis de teste. Isso nao equivale
a testar todas as combinacoes de sistema operacional, permissoes, falhas de disco
ou respostas dos agentes externos.

Abra esta pasta no VS Code e pressione **F5**, selecionando
**SkillVortex Extension**. Na janela Extension Development Host, abra a paleta
e execute **SkillVortex: Abrir biblioteca**.

Depois de instalada, clique em **$(book) SkillVortex** na barra de status
inferior do VS Code para abrir as telas. Na tela inicial, **Criar biblioteca** abre
o seletor de local e nome; **Abrir biblioteca** carrega uma existente. A tela tambem
mostra as funcionalidades e capturas de referencia do dashboard e editor. O
comando da Paleta de Comandos continua disponivel como alternativa.

Um cofre novo comeca vazio: instalar a extensao nao importa seus Markdown nem
adiciona exemplos automaticamente. Depois de criar ou abrir o cofre, clique em
**Carregar exemplos** para adicionar quatro cards com 1, 4, 2 e 0 skills.
Os exemplos sao editaveis e nao constituem validacao automatica de qualidade.

Titulos sao unicos em toda a biblioteca: skills e cards nao podem compartilhar
o mesmo titulo, ignorando maiusculas/minusculas e espacos nas pontas.
Criacao, edicao, importacao e validacao do catalogo rejeitam duplicacoes sem
sobrescrever arquivos. Rascunhos usam nomes disponiveis, como **Nova Skill 2**.
Bibliotecas antigas com titulos duplicados precisam ter esses titulos corrigidos
antes de serem abertas; nenhum registro e renomeado automaticamente.

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

- **SkillVortex: Criar biblioteca**: selecione uma pasta pai e um nome novo.
- **SkillVortex: Abrir biblioteca**: selecione uma pasta com os dois JSON validos.
- **Novo > Nova Skill**: abre um rascunho no editor. O cadastro, o Markdown e a
  associacao a um conjunto so sao gravados ao clicar em **Salvar**.
  Voltar e confirmar o descarte nao cria cards nem arquivos.
- **Cor do card**: no editor de uma skill nova ou existente, escolha uma das 10
  cores no seletor e clique em **Salvar**. A opcao **Automatica (categoria)**
  usa a cor da categoria, como nas skills existentes sem uma cor escolhida.
- **Campos obrigatorios**: ao salvar uma skill, informe titulo, categoria,
  pelo menos uma etiqueta, status, descricao e conteudo
  Markdown. Cor automatica e vinculos com projetos continuam opcionais.
  O nome legivel da skill determina o nome do arquivo e da pasta publicada,
  convertendo acentos e espacos para kebab-case; por exemplo,
  `Verifica consistencia do HTML` usa `skills/verifica-consistencia-do-html.md`.
- **Importar .md**: copia arquivos Markdown selecionados para o cofre; arquivos
  acima de 2 MB sao recusados.
- **Categorias**: abre uma janela para criar categorias ou excluir as vazias.
  Os projetos sao
  cadastrados automaticamente ao ativar **Usar no Projeto** para uma pasta,
  sem formulario de criacao manual. O campo **Projeto** e somente leitura e
  exibe o projeto ativo, que controla os switches dos cards.
- **Excluir categoria**: abra **Categorias** e use a lixeira ao lado do nome.
  Categorias vazias sao removidas apos confirmacao. Se houver skills, mova
  todas para outra categoria pelo editor antes de excluir. Nenhuma skill e
  excluida nessa operacao; o filtro volta para todas as categorias apos a remocao.
- Cards ativos no projeto ficam com o fundo um pouco mais claro, preservando
  a cor escolhida. Ao passar o cursor, os cards aumentam levemente com uma
  transicao suave; o efeito respeita a preferencia por movimento reduzido.
- Os botoes gerais mantem os icones e o padrao vermelho com bordas.
  Novo (verde claro), Salvar e Criar backup (verde escuro),
  Restaurar backup (laranja), Importar .md e Voltar ao Dashboard (azul claro) recebem destaque diferente.
  Carregar exemplos so e permitido quando nao existe nenhum card na biblioteca,
  independentemente dos filtros ou de Markdown ainda existentes nos projetos.
  As acoes dos cards nao possuem bordas: Usar no chat em verde, Editar em azul
  e Excluir em vermelho. Conjuntos tambem possuem **Adicionar skill**.
  As acoes dos cards ficam alinhadas em uma unica linha; em cards
  estreitos, os icones preservam os nomes acessiveis e dicas de cada acao.
  Acoes indisponiveis permanecem visualmente desabilitadas.
- **Skill independente do agente**: cada skill tem um unico Markdown, mesmo
  quando usada por varios agentes. Cada skill pertence a no maximo um card. Os agentes selecionados no card
  definem os destinos controlados pelo switch. Selecione GitHub Copilot ou
  Antigravity para habilitar a ativacao; labels personalizadas apenas organizam a visualizacao.
  Edicoes exigem desativar a skill em todos os projetos e agentes.
- **Cards de conjuntos**: cada card possui titulo, categoria, descricao,
  etiquetas, compatibilidade, status e cor, contendo de zero a varias skills
  com Markdown independentes. **Novo > Novo card** cria um conjunto vazio; **Editar**
  permite selecionar skills existentes e **Adicionar skill** cria uma skill
  dentro dele. Clique no nome de uma skill para editar seu Markdown.
  Skills antigas/importadas sem conjunto aparecem em cards individuais.
  **Ativar colecao** e **Desativar colecao** aplicam a
  acao ao conjunto no projeto em uma transacao: falhas restauram os arquivos.
  Uma skill nao pode participar de varios cards. O seletor desabilita skills
  ja associadas a outro card; para mover, remova o vinculo anterior primeiro.
  Excluir um card remove tambem suas skills exclusivas,
  incluindo Markdown, publicacoes identificadas e arquivos desativados, apos
  confirmacao dos caminhos. Skills de outros cards sao preservadas.
  Nenhum card individual e criado como efeito da exclusao.
  Desative os membros em todos os projetos antes de excluir.
  Cards vazios nao podem ser ativados ou executados.
  Cada skill tem um **checkbox** ao lado do nome no card e no seletor lateral
  de **Editar card**. Todas comecam habilitadas; desmarcar nao exclui o Markdown.
  A lista de titulos reserva altura fixa para tres skills, mesmo com um ou dois
  membros. A barra de rolagem fica visivel; da quarta skill em diante, role a lista
  sem aumentar o bloco.
  Os cards usam espacamentos internos compactos e distancia uniforme entre linhas
  e colunas. O trilho da rolagem permanece visivel mesmo sem exceder tres skills.
  Com o card ativo, mudar um checkbox publica ou desativa somente essa skill
  no projeto atual e nos agentes exibidos, preservando outros projetos/agentes.
  Com o card desligado, muda somente a selecao, sem publicar arquivos.
  Desligar o card desativa todos os seus membros nos destinos exibidos, mas
  preserva a selecao; religar publica apenas os marcados. Mesmo sem nenhuma skill
  marcada, o card mantem seu switch ligado ate ser desativado explicitamente.
  A selecao pertence ao card e sera usada nas proximas ativacoes em qualquer projeto;
  alteracoes imediatas nao sao propagadas para destinos que nao estao exibidos.
- **Usar no Projeto**: controla somente os agentes exibidos no card.
  GitHub Copilot publica em `.github/skills/<nome-legivel>/SKILL.md`;
  Antigravity publica em `.agents/skills/<nome-legivel>/SKILL.md`.
  Com ambos exibidos, a acao controla os dois destinos numa transacao.
  Ao filtrar por um agente, apenas sua label aparece e apenas sua publicacao muda;
  o estado do outro agente e preservado. O switch reflete os destinos visiveis,
  nao apenas a existencia de alguma publicacao.
  A biblioteca continua contendo uma unica skill, com o mesmo Markdown para ambos.
  Em conjuntos, as labels do card valem para todos os membros.
  Nao ha sincronizacao continua entre edicoes manuais dessas copias:
  arquivos ou arquivos desativados divergentes geram conflito explicito.
  Agentes que leem os dois locais podem descobrir duas entradas com o mesmo nome;
  confira a origem no gerenciador de customizacoes do agente.
  Publicacoes antigas em `.github/skills` e `.agent/skills` nao sao movidas ao
  abrir a biblioteca. Ative os agentes desejados usando o switch nas respectivas visualizacoes.
  Desativar arquiva as publicacoes selecionadas; reativar restaura o conteudo nos destinos selecionados.
  Copias arquivadas divergentes bloqueiam a restauracao com
  erro explicito, sem descartar edicoes. Revise as copias antes de reativar.
  Sem projeto ativo ou pasta associada, usa a unica pasta local aberta
  no VS Code ou solicita uma pasta; cria o cadastro do projeto quando necessario.
  Se o `SKILL.md` ja existir e for a origem importada ou tiver conteudo identico
  ao da skill, ativa o vinculo sem sobrescrever o arquivo. Arquivos diferentes
  e conflitos com copias desativadas sao preservados e informados para revisao.
  **Usar no chat** abre o chat do GitHub Copilot com o comando `/<nome-legivel>`
  preenchido para a skill ativa; revise o pedido e envie no chat. A pasta
  associada precisa estar aberta como pasta do workspace no VS Code.
  Ao desativar, move o Markdown para `.skillvortex/disabled-skills/` no cofre,
  preservando inclusive edicoes feitas no projeto. Reativar restaura esse arquivo.
  Isso tambem se aplica quando o proprio `SKILL.md` foi a origem importada:
  o caminho de origem continua registrado como referencia, o conteudo e arquivado
  e a pasta vazia e removida. Origens de outras skills continuam protegidas.
  A pasta publicada tambem e removida quando nao contem arquivos adicionais;
  pastas com outros arquivos ficam registradas para a exclusao confirmada do card.
  O cofre deve ficar fora da pasta do projeto. Arquivos existentes e links
  simbolicos nao sao sobrescritos. A propriedade das pastas e registrada no
  cofre, sem criar arquivos de identificacao no projeto.
- **Acoes da skill individual**: **Usar no chat** exige publicacao no projeto selecionado.
  **Excluir** exige desativar em todos os projetos e remove o
  Markdown do cofre, suas pastas publicadas identificadas e arquivos arquivados;
  a confirmacao lista o que sera apagado. A exclusao remove o membro das colecoes,
  sem excluir os conjuntos. Salvar com projetos selecionados publica a skill
  nos destinos definidos pelos agentes do seu unico card.
- **Carregar exemplos**: disponivel somente com a biblioteca sem cards, inclusive
  sem cards vazios. Apos confirmacao, cria exatamente quatro conjuntos com 1,
  4, 2 e 0 skills (sete Markdown com frontmatter `name`/`description`).
  Usa somente categorias ja cadastradas, sem criar categorias extras.
  Todos os metadados dos exemplos sao preenchidos; o card vazio nao tem Markdown
  ficticio. Nao busca arquivos na pasta do projeto nem exige um projeto ativo.
  **Usar no chat** em conjuntos com varias skills permite escolher qual usar.
- **Associar pasta** vincula uma pasta local ao projeto ativo. **Buscar skills
  no projeto** procura Markdown nas pastas `skills` dos agentes e mostra os
  encontrados antes de importar os selecionados.
- **Gerenciador de Skills**: pesquise por texto e filtre por status, categoria
  e conjunto numa unica barra.
  Quando nao houver cards, os botoes **Criar primeiro card**, **Carregar exemplos**
  e **Importar .md** ficam disponiveis diretamente. Cards precisam de ao menos
  um destino compativel (GitHub Copilot ou Antigravity) para habilitar o switch;
  labels personalizadas servem apenas para organizar a visualizacao.
  A visualizacao **Todos os agentes** permite filtrar pelas labels de agentes
  ja declaradas no card, incluindo labels personalizadas. Cards com duas labels
  aparecem nas duas visualizacoes; sem labels, aparecem somente em Todos os agentes.
  Trocar o filtro nao modifica arquivos, mas define quais agentes ficam exibidos
  e serao controlados ao clicar no switch. Editar continua alterando a mesma skill
  da biblioteca em qualquer visualizacao. A label generica Agent Skills nao aparece nos cards.
  O destino controla os arquivos gerenciados, nao a exclusividade de descoberta:
  o Copilot tambem pode reconhecer skills em `.agents/skills`.
  As acoes de conjuntos ficam nos proprios cards, sem botoes duplicados de editar/excluir/ativar acima da grade.
  O menu **Projeto** concentra alteracao de pasta e busca de skills.
  O menu **Biblioteca**, com icone de livros e destaque violeta, concentra
  atualizacao, backups e importacao do desktop. **Adicionar skill** recebe destaque amarelo.
  A pasta organizada da biblioteca, tambem chamada de cofre nesta documentacao,
  mantem o mesmo formato e local dos dados existentes.
  Cards usam largura minima de 360 px quando ha espaco, altura minima de 440 px
  e altura uniforme na grade. Em telas menores, adaptam a largura sem rolagem horizontal.
  Dicas nos icones de informacao aparecem por foco ou hover e fecham ao sair
  ou pressionar Escape. A opcao **Desvincular** nao aparece na interface.
  Seletores mais largos, menus descritivos e campos alinhados facilitam a leitura.
  O formulario de cards usa duas colunas em telas maiores e uma em telas pequenas.
- **Editor**: os paineis **Markdown** e **Texto** ficam lado a lado, ambos editaveis
  e sincronizados no mesmo `.md`. Em telas estreitas, ficam empilhados.
  **Projetos** e **Governanca** ficam acima do editor, sem pre-visualizacao separada.
  **Texto** e o painel ativo por padrao, com uma unica barra de icones agrupada por
  historico, formatacao, titulos, listas e insercoes. Os botoes indicam a formatacao
  ativa e desabilitam acoes indisponiveis. Edite visualmente com negrito,
  italico, riscado, titulos, listas, tarefas, citacoes, links e codigo; ou **Markdown**
  para editar a sintaxe no Monaco. Clique em um painel ou em seu titulo para
  direcionar a barra a ele; o painel ativo fica destacado. A barra formata a selecao
  do painel ativo, sem salvar automaticamente, e destaca os estilos na posicao
  do cursor em ambos os paineis, incluindo titulos, listas, links e formatacoes
  combinadas no Markdown. Uma selecao que ultrapassa um trecho formatado nao
  destaca esse estilo.
  Titulos continuam destacados com o cursor no final da linha ou com a quebra
  de linha incluida na selecao.
  A edicao visual pode normalizar a sintaxe Markdown. O cabecalho YAML
  e preservado e nao aparece no texto visual. No painel Markdown, ele fica separado
  em **Cabecalho YAML protegido (somente leitura)**: selecionar tudo, apagar,
  colar e formatar afetam apenas o corpo. Esta protecao vale para o editor integrado,
  nao para edicoes externas do arquivo. Monaco fornece realce Markdown e permite colar texto
  com `Ctrl+V` / `Cmd+V`; `Ctrl+S` / `Cmd+S` ou **Salvar** grava as alteracoes
  no cofre. Existe somente um botao **Salvar**, ao lado de **Voltar ao Dashboard**,
  na linha do titulo **Editando**. Em telas pequenas, as acoes ficam abaixo do titulo.
  Abrir uma skill para editar ou voltar sem salvar nao altera os dados.
  Arquivos com HTML devem ser editados no modo Markdown para preservar as estruturas.
  A barra inclui titulos H1 a H6, limpar formatacao, recuos em listas e insercao
  de tabelas em ambos os paineis. No painel Texto, dentro de uma tabela, aparecem controles para adicionar ou remover
  linhas e colunas e excluir a tabela. As ferramentas usam recursos Markdown/GFM;
  cores de fonte, alinhamento e tamanho arbitrario nao sao adicionados ao arquivo.
- **Liberada / Bloqueada**: sao os unicos estados de skills e cards.
  Liberada permite ativar, mas nao indica revisao ou teste de qualidade.
  Bloqueada impede novas ativacoes; uma skill bloqueada nao pode ser usada no chat.
  O switch **Usar no Projeto** indica separadamente se esta ativa ou inativa.
  Os estados antigos `pending` e `validated` sao lidos como `allowed` (Liberada)
  sem alterar Markdown ou publicacoes; o proximo salvamento persiste o novo estado.
  Bibliotecas antigas com uma skill em varios cards sao rejeitadas com erro
  explicito; os vinculos devem ser corrigidos, sem remocao automatica de conteudo.
- **Alteracoes externas**: enquanto o gerenciador esta aberto, alteracoes nos Markdown
  da biblioteca e nos `SKILL.md` publicados geram um aviso, sem sobrescrita automatica
  nem descarte do rascunho aberto. Publicacoes ativas tambem sao verificadas ao atualizar.
  Edicoes de skills inativas sao reconhecidas a partir da primeira leitura na sessao.
  O botao **Sincronizar**, sempre disponivel no dashboard ao lado de **Biblioteca**,
  verifica os arquivos no disco mesmo sem aviso automatico.
  As notificacoes informativas da sincronizacao nao bloqueiam os switches dos cards,
  mesmo enquanto estiverem abertas.
  Para trazer uma edicao do projeto: salve o arquivo, clique em **Sincronizar**,
  escolha a skill, selecione a versao do agente/projeto, escolha **Importar para a biblioteca**
  e confirme **Criar backup e sincronizar**. Isso atualiza o Markdown original
  e as publicacoes ativas; nao e necessario desativar a skill.
  **Revisar alteracoes** permite escolher a skill e a versao de origem:
  - **Comparar versoes** abre snapshots lado a lado, somente leitura.
  - **Mesclar manualmente na biblioteca** cria backup e abre a biblioteca editavel
    ao lado da publicacao. Salve a mesclagem e revise novamente para sincronizar.
  - **Importar para a biblioteca** adota a publicacao escolhida; **Restaurar da biblioteca**
    usa o original. Ambas atualizam todas as publicacoes ativas da skill em todos os
    projetos/agentes, apos confirmacao explicita, preservando as labels e os destinos.
    Os metadados de nome e descricao continuam sendo definidos pelo cadastro.
  Antes de substituir arquivos, um backup da biblioteca e snapshots das publicacoes
  sao gravados em `.skillvortex/backups/<backup>/external-changes/`.
  O `manifest.json` relaciona os caminhos originais aos snapshots numerados.
  Se o original tiver sido removido, e criado um diretorio `external-recovery-*`
  com snapshots e `metadata.json`, para recuperacao manual (nao listado como backup completo).
  Os snapshots de publicacoes sao para recuperacao manual; restaurar um backup completo
  da biblioteca nao restaura automaticamente esses arquivos externos.
  Mudancas posteriores a comparacao bloqueiam a sincronizacao; falhas durante a escrita
  tentam restaurar as versoes anteriores e informam o caminho de recuperacao.
  Um rascunho antigo nao pode sobrescrever um original alterado externamente.
- **Excluir** remove o cadastro e, apos confirmacao, apaga o Markdown do cofre,
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
Desativar ou bloquear uma skill retira o `SKILL.md` do projeto e preserva seu
conteudo no cofre.
Isso nao remove instrucoes ja carregadas numa
conversa nem impede um agente de ler explicitamente arquivos acessiveis.
Vinculos antigos sem pasta associada precisam de **Associar pasta** antes de
serem publicados. A restauracao de backups tambem sincroniza os arquivos ativos;
as copias desativadas permanecem no cofre, mas nao fazem parte do snapshot dos
Markdown da biblioteca.

A varredura procura `.github/skills`, `.agents/skills` e `.agent/skills` na raiz
do projeto associado e em todas as pastas locais abertas como workspace no VS
Code. Assim, encontra as skills mesmo quando a pasta associada esta em outro
caminho ou volume. Inclui Markdown solto diretamente nas pastas `skills` ou
em subpastas, com qualquer nome, como `SKILL.md`,
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
origem; skills publicadas pelo proprio SkillVortex em `.github/skills` ou
`.agents/skills` aparecem desmarcadas. A busca para com erro acima de 50.000
entradas ou 1.000 Markdown.
Importar copia o Markdown para o cofre sem alterar o original. A publicacao
converte Markdown solto para uma pasta com `SKILL.md` e frontmatter YAML
`name`/`description`, preservando outros campos YAML quando existentes.
YAML invalido gera erro explicito. Encontrar um Markdown solto nao significa
que o agente o reconheca como skill. A importacao ainda e de Markdown, nao de
pacotes completos com scripts/assets; recursos externos precisam ser revisados.
Skills sao procedimentos carregados por relevancia, nao instrucoes permanentes
como `AGENTS.md` ou `copilot-instructions.md`; estes continuam fora da busca.
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
