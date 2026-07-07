# Vammo — Atualização de Hierarquia de Cor (2026)

Após mini-rebranding interno, a hierarquia de cor da marca mudou. Este arquivo
documenta a mudança para refletir no Design System oficial
(`Vammo DS — Brand · Figma · Código`, projeto `ad1077c9-…`).

## O que mudou

### Antes (Brandbook 2023)
- **Primárias:** preto + branco
- **Secundárias:** 4 neons (azul `#2EC2FF`, amarelo `#DFFF00`, rosa `#FF6ED8`, laranja `#FF8032`)

### Depois (2026)
- **Primárias:** preto + branco + **azul `#2EC2FF`**
- **Secundárias:** amarelo `#DFFF00`, rosa `#FF6ED8`, laranja `#FF8032`
- **Uso restrito** dos neons amarelo/rosa/laranja — agora só em:
  - alertas semânticos (warning, erro, callout pontual)
  - composições brand de alto destaque (poster, OOH)
  - chips/status onde a cor carrega significado (não decorativo)

## Regras práticas

1. **Default accent = azul.** Eyebrows, links, ícones ativos, CTAs neon,
   destaques tipográficos, bordas de cards de destaque.
2. **Rule of one neon per view** continua valendo — mas o "um neon" passa a ser
   o azul por padrão. Se aparecer outro, é porque há razão semântica.
3. **Diferenciação por categoria** (ex: 3 fornecedores, 3 setores) **não** usa
   3 neons. Use azul para o item principal e tons de cinza/branco para
   secundários, ou diferencie por estrutura (borda, fundo, ícone) — não cor.
4. Amarelo/rosa/laranja **continuam no token set** (Zimmzag amarelo, alerta
   pink/orange, etc) — só perdem o uso decorativo livre.

## Atualizações sugeridas no DS oficial

### `README.md`
- Seção **§06 · Colors** → reescrever:
  - "Primary: Black `#000000` · White `#FFFFFF` · **Neon Blue `#2EC2FF`**"
  - "Secondary (3 neons): Yellow / Pink / Orange — uso restrito a alertas e
    momentos brand de alto destaque"
- Atualizar a tabela de territórios/personalidade se houver referência ao "blue
  como secundária".

### `colors_and_type.css`
- Tokens **mantém os hex** (não muda HEX do azul nem dos outros).
- Considerar renomear/alias:
  - `--brand-primary` → ainda `#000`
  - **Novo:** `--brand-accent` → `#2EC2FF` (azul como accent primário)
  - Os tokens `--brand-neon-yellow/pink/orange` continuam mas com docstring
    indicando "uso restrito".

### Exemplos / kits
- `slides/index.html` → revisar: o template atual usa `--neon-yellow` no
  `.s-stat .num` e em alguns destaques. Trocar por `--neon-blue` no default.
- `ui_kits/rider-app` e `ui_kits/backoffice` → varrer onde aparecem
  yellow/pink/orange decorativos (não-semânticos) e migrar para azul.

### Logo "Blue lockup"
- Já existia em `assets/logo/Vammo_Logo_Blue.svg` mas estava marcado como
  divergente do Brandbook (§15 da doc). **Agora deixa de ser divergência** —
  o logo azul vira lockup oficial em superfícies que precisem do accent.

## Como aplicamos isso no slide deck

Em `Telefonia Voice - Comparativo.html`:
- Eyebrows, bullets "+" em escopo, badge "?" das decisões, headers de coluna
  do fornecedor principal (55PBX), bordas de pros, doc card → **azul**
- Diferenciação dos 3 fornecedores nas tabelas: 55PBX = azul, GoTo = branco,
  Agitel = cinza claro
- **Laranja preservado** apenas no alert "Agitel é uma camada diferente"
  (uso semântico de warning) — único neon não-azul no deck inteiro

---
*Documentado em 22/maio/2026. Reportar à equipe de Brand antes de fechar
revisão no DS oficial.*
