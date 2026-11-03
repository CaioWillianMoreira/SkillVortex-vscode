# SkillVortex Extension

Extensao independente do VS Code para organizar Markdown em um cofre portatil.
Esta e a **etapa 1 da migracao** do SkillVortex desktop. O aplicativo antigo
permanece intacto em sua pasta e repositorio.

## Implementado nesta etapa

- Biblioteca React + Ant Design em Webview, tema escuro e busca textual.
- Criacao e abertura de cofres locais, com validacao de metadados.
- Importacao explicita do banco SQLite do desktop para um **cofre novo**.
- Preservacao de IDs, categorias, tags, agentes, status e vinculos dos projetos.
- Abertura de Markdown no editor nativo do VS Code.
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

## Criar ou abrir um cofre

Use os botoes da Webview ou os comandos:

- **SkillVortex: Criar cofre**: selecione uma pasta pai e um nome novo.
- **SkillVortex: Abrir cofre**: selecione uma pasta com os dois JSON validos.
- **Atualizar**: releia os metadados e reconstrua o indice.
- **Editar Markdown**: abre o arquivo no editor nativo; salve com Ctrl+S/Cmd+S.

Nesta etapa nao ha cadastro manual ou edicao de metadados pela Webview:
um cofre novo comeca vazio. Use a importacao do desktop para trazer a biblioteca.
Projetos importados sao preservados nos JSON, mas ainda nao ha seletor ou
edicao de vinculos na tela.

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

1. CRUD de skills, categorias e projetos; filtros e vinculos.
2. Gravacao serializada, journal e recuperacao das alteracoes do cofre.
3. Backup/restauracao versionados com previa de conflitos e criptografia opcional.
4. Monitoramento de arquivos e remapeamento de projetos.
5. Sincronizacao com agentes, com previa e protecao contra sobrescrita.

A extensao exige ambiente local e confiavel. Remoto, VS Code Web e workspaces
virtuais nao sao suportados nesta primeira etapa.
