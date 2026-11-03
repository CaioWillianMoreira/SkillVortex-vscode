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
- Editor integrado com titulo, descricao, categoria, tags, agentes, governanca,
  conteudo Markdown, pre-visualizacao e selecao dos projetos vinculados.
- Criacao de categorias e projetos, selecao do projeto ativo e gerenciamento
  dos vinculos por skill.
- Desvinculacao do catalogo preservando o arquivo ou exclusao fisica confirmada.
- Gravacao validada dos metadados e do Markdown no cofre.
- Indice SQLite local reconstruido ao abrir/atualizar a biblioteca.
- Repositorio Git local independente, sem commit ou publicacao automatica.

```text
MeuCofre/
├── skills/
│   └── <identificador-unico>.md
└── .skillvortex/
    ├── catalogo.json
    ├── projetos.json
    └── backups/
```

Os JSON e Markdown sao a fonte de verdade. Os caminhos dos Markdown sao
relativos ao cofre. Nomes de arquivo usam identificadores seguros para evitar
colisoes e preservar os IDs originais nos metadados.

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

Alternativamente:

```sh
code --extensionDevelopmentPath=/caminho/SkillVortex-vscode
```

Para gerar e instalar um VSIX:

```sh
npm run package
```

Use **Extensions: Install from VSIX...** com
`release/skillvortex-extension-0.1.0.vsix`. Nao ha Electron ou instalador desktop
proprio na nova versao.

## Biblioteca, projetos e editor

Crie ou abra um cofre pelos botoes da Webview ou pelos comandos:

- **SkillVortex: Criar cofre**: selecione uma pasta pai e um nome novo.
- **SkillVortex: Abrir cofre**: selecione uma pasta com os dois JSON validos.
- **Nova Skill**: cria um Markdown no cofre e abre o editor integrado.
- **Importar .md**: copia arquivos Markdown selecionados para o cofre; arquivos
  acima de 2 MB sao recusados.
- **Nova Categoria** e **Novo Projeto**: adicionam metadados ao catalogo. O
  projeto ativo controla os switches **Usar no Projeto** dos cards.
- **Biblioteca**: pesquise por texto e filtre por status, categoria e agente.
- **Editor**: altere metadados e Markdown, confira a pre-visualizacao e ajuste
  os projetos vinculados. Salve para gravar no cofre.
- **Bloqueada**: ao salvar, remove os vinculos dessa skill em todos os projetos.
- **Desvincular**: remove a skill do catalogo e dos projetos, preservando o
  Markdown. **Excluir** remove o cadastro e, apos confirmacao, apaga o arquivo.

O editor integrado renderiza a pre-visualizacao sem permitir HTML embutido no
Markdown. A extensao nao injeta nem sincroniza instrucoes com agentes. Os
vinculos e agentes sao metadados de organizacao.

Esta etapa ainda nao tem varredura recursiva de uma pasta de projeto, selecao
de varios Markdown encontrados automaticamente, associacao/reatribuicao de
caminhos de projeto, backup/restauracao, monitoramento de alteracoes externas
ou sincronizacao com agentes. Esses fluxos nao sao implicados pela criacao de
projetos nem pela importacao manual de arquivos.

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
- A pasta `backups/` esta preparada, mas exportacao/restauracao automatica e
  criptografia ainda nao foram implementadas.
- Cofre significa pasta organizada; nao significa dados criptografados.
- Credenciais futuras devem usar `SecretStorage`, nunca catalogo ou projetos.
  Nesta etapa nao ha integracao que solicite tokens, portanto nao ha cofre de
  credenciais ou exportacao de segredos implementados.

## Proximas etapas

1. Varredura recursiva de Markdown em pastas de projeto, com limites e selecao
   previa dos arquivos antes da importacao em lote.
2. Associacao e reatribuicao de pastas para projetos, com remapeamento seguro.
3. Journal e recuperacao de operacoes interrompidas, alem do backup/restauracao
   versionados com previa de conflitos.
4. Monitoramento de alteracoes externas e sincronizacao opcional com agentes,
   sempre com previa e protecao contra sobrescrita.

A extensao exige ambiente local e confiavel. Remoto, VS Code Web e workspaces
virtuais nao sao suportados nesta primeira etapa.
