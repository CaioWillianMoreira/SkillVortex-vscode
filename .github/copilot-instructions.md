# Instalacao da extensao

- Quando o usuario solicitar a instalacao ou reinstalacao desta extensao, execute
  `npm run package` para compilar o codigo atual e gerar um novo VSIX em `builds/`.
- Instale o VSIX recem-gerado, correspondente ao nome e a versao em
  `package.json`. Se o build ou o empacotamento falhar, informe o erro e nao
  instale um pacote anterior.
- Confirme a instalacao e oriente o usuario a recarregar a janela do VS Code.
