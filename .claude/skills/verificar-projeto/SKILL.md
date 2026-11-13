---
name: verificar-projeto
description: Verifica o projeto SkillVortex (typecheck, testes, build e VSIX). Use quando o usuário pedir para testar, validar, compilar ou gerar o pacote da extensão SkillVortex, MindCards ou Product Builder.
---

# Verificar o projeto SkillVortex

Use esta skill para confirmar que as alterações do repositório compilam e passam
nos testes antes de dizer que algo está pronto.

## Requisitos

- Node.js 22.12 ou superior e npm.
- Dependências instaladas. Se `node_modules/` não existir, rode `npm ci` primeiro.

## Ordem de verificação

Execute a partir da raiz do projeto e pare no primeiro erro:

1. `npm run typecheck`: TypeScript do backend, da Webview e dos complementos.
2. `npm test`: testes unitários e de regressão com Jest.
3. `npm run build`: compila extensão, WASM e interface.

Só rode os passos abaixo quando o usuário pedir explicitamente:

- `npm run test:host`: testa em um perfil isolado do VS Code. Pode baixar um host.
- `npm run package`: gera os três VSIX em `builds/`. Não use pacotes antigos como se
  contivessem as alterações atuais.

## Como relatar

- Informe cada comando executado e se passou ou falhou.
- Em caso de falha, mostre a mensagem de erro relevante, não apenas que falhou.
- Se um passo foi pulado, diga qual e por quê.
- Não diga que está tudo funcionando sem ter rodado os comandos.

## Cuidados

- Não altere `builds/` nem `dist/` manualmente; são gerados pelo build.
- Os testes de host não importam a biblioteca pessoal do usuário. Mantenha assim.
- Para o teste real do modelo do Product Builder, use a variante documentada no README
  (`SKILLVORTEX_TEST_LOCAL_AI=1`). Ela baixa cerca de 500 MB; confirme com o usuário antes.
