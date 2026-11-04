# Componentes de terceiros

O DocX inclui os componentes abaixo, cada um sob a sua própria licença.

## draw.io (diagramas)

- Projeto: https://github.com/jgraph/drawio (versão 32.4.1, `draw.war` oficial)
- Copyright © JGraph Ltd
- Licença: Apache License 2.0, https://www.apache.org/licenses/LICENSE-2.0
- Uso no DocX: o webapp é incluído sem modificações no código, apenas sem os arquivos não usados
  (servidor, conectores de nuvem, fontes de desenvolvimento, idiomas além de português e inglês,
  matemática). As licenças das bibliotecas de formas, modelos e imagens seguem nas pastas
  `templates/`, `stencils/`, `shapes/` e `img/` dentro de `vendor/drawio`.
- "draw.io" é marca da JGraph Ltd. O DocX não é afiliado nem endossado pela JGraph.

## Excalidraw (desenhos)

- Projeto: https://github.com/excalidraw/excalidraw (`@excalidraw/excalidraw` 0.18.1)
- Copyright © 2020 Excalidraw
- Licença: MIT
- As licenças das dependências incluídas no pacote estão em
  `vendor/excalidraw/excalidraw.js.LEGAL.txt`.

## three.js (grafo em 3D)

- Projeto: https://github.com/mrdoob/three.js (`three` 0.186.0)
- Copyright © 2010-2026 three.js authors
- Licença: MIT
- Incluído em `vendor/graph3d/graph3d.js`, carregado só quando o grafo é aberto em 3D.

## Demais bibliotecas

React e React DOM (MIT), CodeMirror (MIT), marked (MIT), DOMPurify (Apache-2.0 / MPL-2.0),
KaTeX (MIT), Mermaid (MIT), d3-force-3d (MIT), Lucide (ISC) e Electron (MIT).
