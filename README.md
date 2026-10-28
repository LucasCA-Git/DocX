<p align="center">
  <img src="build/icons/128x128.png" width="96" height="96" alt="Ícone do DocX">
</p>

<h1 align="center">DocX</h1>

<p align="center">
  Notas em Markdown com links entre notas, grafo, canvas, desenhos, diagramas e sincronização pelo <b>seu próprio repositório Git</b>.<br>
  Windows · Ubuntu/Debian · Linux (AppImage)
</p>

<p align="center">
  <a href="https://github.com/LucasCA-Git/DocX/releases/latest/download/DocX-Setup.exe"><img src="https://img.shields.io/badge/Baixar_para-Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Baixar para Windows"></a>
  <a href="https://github.com/LucasCA-Git/DocX/releases/latest/download/DocX-linux-amd64.deb"><img src="https://img.shields.io/badge/Baixar_para-Ubuntu_/_Debian-E95420?style=for-the-badge&logo=ubuntu&logoColor=white" alt="Baixar para Ubuntu/Debian"></a>
  <a href="https://github.com/LucasCA-Git/DocX/releases/latest/download/DocX-x86_64.AppImage"><img src="https://img.shields.io/badge/Baixar_para-Linux_(AppImage)-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Baixar AppImage para Linux"></a>
</p>

<p align="center">
  <a href="https://github.com/LucasCA-Git/DocX/releases/latest"><img src="https://img.shields.io/github/v/release/LucasCA-Git/DocX?label=vers%C3%A3o&style=flat-square" alt="Última versão"></a>
  <a href="https://github.com/LucasCA-Git/DocX/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/LucasCA-Git/DocX/release.yml?label=build&style=flat-square" alt="Build"></a>
  <a href="https://github.com/LucasCA-Git/DocX/releases"><img src="https://img.shields.io/github/downloads/LucasCA-Git/DocX/total?label=downloads&style=flat-square" alt="Downloads"></a>
</p>

---

O DocX é um aplicativo desktop para escrever e organizar conhecimento em Markdown. As notas são
arquivos `.md` comuns numa pasta do seu computador (o **vault**). Funcionam offline e podem ser
abertas por qualquer editor. A cópia online fica num repositório Git que é **seu**, por exemplo um
repositório privado no GitHub: nenhum servidor de terceiros guarda as suas notas, e cada nota ganha
histórico de versões.

## Sumário

- [Recursos](#recursos)
- [Instalação](#instalação)
- [Desenhos e diagramas](#desenhos-e-diagramas)
- [Primeiros passos](#primeiros-passos)
- [Sincronização com Git](#sincronização-com-git-padrão)
- [Escrevendo notas](#escrevendo-notas)
- [Atalhos de teclado](#atalhos-de-teclado)
- [Onde ficam os dados](#onde-ficam-os-dados)
- [Privacidade e segurança](#privacidade-e-segurança)
- [Desinstalar](#desinstalar)
- [Desenvolvimento](#desenvolvimento)

## Recursos

**Escrita**
- Editor com **Live Preview** (o Markdown vira formatação enquanto você escreve), modo de leitura e
  alternância com `Ctrl+E`.
- Links entre notas `[[nota]]`, `[[nota|apelido]]`, `[[nota#título]]` e `[[nota#^bloco]]`, com
  autocompletar ao digitar `[[`.
- Transclusão: `![[nota]]` e `![[nota#título]]` mostram o conteúdo de outra nota dentro da atual.
- Prévia ao passar o mouse sobre um link.
- Callouts (`> [!nota]`), `==destaque==`, `%%comentários%%`, tabelas, notas de rodapé, checklists
  clicáveis, realce de código, fórmulas matemáticas (KaTeX) e diagramas Mermaid.
- Propriedades (front matter YAML) em tabela, tags `#tag` e aliases.
- Atalhos de formatação, buscar e substituir, dobrar títulos, modo Vim opcional e corretor
  ortográfico em pt-BR/en-US.
- Imagens, PDFs, áudio e vídeo: cole ou arraste para dentro da nota.

**Organização**
- Explorador de arquivos com pastas, ordenação, arrastar e soltar. Renomear ou mover uma nota
  **atualiza todos os links** para ela.
- Painel direito com backlinks, menções não ligadas (com o botão "Ligar"), links de saída, estrutura
  (outline), tags e grafo local.
- **Grafo** de todas as notas em estilo **constelação**: céu estrelado, notas como estrelas que
  brilham e linhas de constelação. Com a **gravidade** ligada, as notas orbitam devagar o centro e
  flutuam, e arrastar uma estrela puxa as vizinhas. Também tem grupos coloridos, tags como nós,
  setas, filtros e forças ajustáveis (as duas opções podem ser desligadas no painel do grafo).
- **Galáxias**: no grafo, cada pasta é uma galáxia (com o número de arquivos). Clique numa galáxia
  para entrar nela: aparece só o que está dentro da pasta. O **arquivo raiz** da pasta vira o **sol**
  (a nota com o mesmo nome da pasta, senão `README`/`index`, senão a nota mais linkada) e os outros
  documentos e subpastas **orbitam** em volta dele. Para voltar, use a trilha no topo
  (`Cofre › Pasta`) ou dê um duplo clique no espaço vazio. Dá para desligar em Exibição.
- Links feitos dentro de **canvas, desenhos e diagramas** (cartões de nota, `[[Nota]]` em textos,
  links de elementos) entram no grafo e nos backlinks, como os de qualquer nota.
- **Canvas** (`.canvas`, formato aberto JSON Canvas): cartões de texto, nota, imagem e link, com
  conexões, grupos e cores.
- Busca no vault com operadores: `tag:`, `path:`, `file:`, `"frase exata"`, `-excluir`, `OR` e
  `/regex/`.
- Notas diárias, modelos (`{{title}}`, `{{date}}`, `{{time}}`), e favoritos.
- Paleta de comandos (`Ctrl+P`), troca rápida (`Ctrl+O`) e atalhos configuráveis.
- Painéis divididos (direita/abaixo), abas fixas e navegação voltar/avançar.

**Desenhos e diagramas**
- **Desenho** (`.excalidraw`): o editor do [Excalidraw](https://excalidraw.com) dentro do DocX, com
  traço "à mão", retângulo, losango, elipse, seta, linha, lápis, texto, imagem, borracha, frames,
  bibliotecas, cores, preenchimentos, camadas, agrupar/alinhar, desfazer/refazer e exportação para
  PNG/SVG. O arquivo é o JSON padrão e também abre no excalidraw.com.
- **Diagrama** (`.drawio.svg`): o editor do [draw.io](https://www.drawio.com) dentro do DocX, no
  estilo Lucidchart, com bibliotecas de formas (fluxograma, UML, ER, BPMN, rede, AWS, Azure, GCP,
  Kubernetes…), conectores com roteamento automático, swimlanes, camadas, várias páginas, modelos e
  guias de alinhamento. O arquivo é um SVG com o diagrama dentro: aparece como imagem nas notas e
  no GitHub, e continua editável. Arquivos `.drawio` também abrem.
- Os dois funcionam offline, salvam sozinhos e sincronizam pelo Git como qualquer nota.
- Na nota, `![[Desenho.excalidraw]]` e `![[Fluxo.drawio.svg]]` mostram a imagem.

**Aparência e saída**
- Tema escuro, claro ou do sistema, cor de destaque, tamanho de fonte e fontes de texto e código.
- Exportar nota para PDF.

**Sincronização**
- **Git** (padrão): commit, envio e recebimento automáticos, histórico de versões por nota, cópia
  de conflito em vez de sobrescrever e funcionamento offline.

## Instalação

Baixe o instalador na página de **[Releases](https://github.com/LucasCA-Git/DocX/releases/latest)**
(ou gere localmente, ver [Desenvolvimento](#desenvolvimento)).

| Sistema | Download direto | Como instalar |
|---|---|---|
| Windows 10/11 (64 bits) | [DocX-Setup.exe](https://github.com/LucasCA-Git/DocX/releases/latest/download/DocX-Setup.exe) | Assistente de instalação |
| Ubuntu / Debian (64 bits) | [DocX-linux-amd64.deb](https://github.com/LucasCA-Git/DocX/releases/latest/download/DocX-linux-amd64.deb) | `apt` ou Central de Aplicativos |
| Qualquer Linux (64 bits) | [DocX-x86_64.AppImage](https://github.com/LucasCA-Git/DocX/releases/latest/download/DocX-x86_64.AppImage) | Executável portátil, sem instalar |

Os links acima sempre baixam a **versão mais recente**. Pelo terminal:

```powershell
# Windows (PowerShell): baixa e abre o instalador
Invoke-WebRequest https://github.com/LucasCA-Git/DocX/releases/latest/download/DocX-Setup.exe -OutFile "$env:TEMP\DocX-Setup.exe"; Start-Process "$env:TEMP\DocX-Setup.exe"
```

```bash
# Ubuntu / Debian: baixa e instala
wget -O /tmp/DocX.deb https://github.com/LucasCA-Git/DocX/releases/latest/download/DocX-linux-amd64.deb && sudo apt install /tmp/DocX.deb

# Qualquer Linux: AppImage
wget -O ~/DocX.AppImage https://github.com/LucasCA-Git/DocX/releases/latest/download/DocX-x86_64.AppImage && chmod +x ~/DocX.AppImage && ~/DocX.AppImage
```

### Windows

1. Execute `DocX-Setup.exe`.
2. Na primeira vez, o Windows pode mostrar **"O Windows protegeu o computador"**, porque o instalador
   ainda não tem assinatura digital. Clique em **Mais informações › Executar assim mesmo**.
3. Siga o assistente: **Avançar**, escolha a pasta de instalação (opcional) e **Instalar**.
4. Pronto: o DocX ganha **atalho na Área de Trabalho e no Menu Iniciar** e abre ao terminar.

A instalação é por usuário (não pede senha de administrador, a menos que você escolha uma pasta do
sistema, como `C:\Program Files`).

**Requisito para sincronizar com Git:** [Git for Windows](https://git-scm.com/download/win). Ele
já traz o Git Credential Manager, que faz o login no GitHub/GitLab.

### Ubuntu / Debian

```bash
sudo apt install ./DocX-linux-amd64.deb
```

O `apt` instala junto as dependências, inclusive o `git`. O DocX aparece no menu de aplicativos,
com ícone. Para abrir pelo terminal, use `docx`.

### Linux (AppImage)

```bash
chmod +x DocX-x86_64.AppImage
./DocX-x86_64.AppImage
```

Não precisa instalar. Para sincronizar com Git, tenha o `git` instalado (`sudo apt install git`,
`sudo dnf install git` etc.). Em distribuições sem FUSE, rode com `--appimage-extract-and-run`.

## Desenhos e diagramas

Crie pelo ribbon à esquerda (ícones de caneta e de fluxo), pela paleta (`Ctrl+P` › "Novo desenho" /
"Novo diagrama") ou com o botão direito numa pasta do explorador.

| | Desenho | Diagrama |
|---|---|---|
| Para | Esboços, quadros brancos, mapas mentais, wireframes | Fluxogramas, UML, arquitetura, redes, BPMN, organogramas |
| Editor | Excalidraw | draw.io (estilo Lucidchart) |
| Arquivo | `Nome.excalidraw` (JSON) | `Nome.drawio.svg` (SVG editável) |
| Abre também em | excalidraw.com | app.diagrams.net e draw.io desktop |

Dicas:
- No desenho, um link `[[Nota]]` num elemento abre a nota. Links da web abrem no navegador.
- A biblioteca de formas do Excalidraw fica salva no seu computador.
- No diagrama, "Mais formas" (no fim da barra lateral) liga as bibliotecas de UML, rede, nuvem etc.
- Os editores rodam isolados e não acessam a internet: bibliotecas online do Excalidraw e
  integrações de nuvem do draw.io ficam desligadas.

## Primeiros passos

1. Abra o DocX e vá em **⚙ Configurações › Vault e sincronização**.
2. Em **Pasta das notas**, escolha uma pasta (nova ou com arquivos `.md` que você já tenha).
3. Escolha como sincronizar: **Git** (recomendado) ou **nenhum** (só local).
4. Crie a primeira nota com `Ctrl+N`, ou abra a troca rápida com `Ctrl+O` e digite um nome.

## Sincronização com Git (padrão)

### Configurar

1. Crie um repositório **privado e vazio** no GitHub (ou GitLab, Gitea, Bitbucket…). Não marque
   "Add README" nem `.gitignore`.
2. No DocX, em **⚙ Configurações › Vault e sincronização**, escolha **Git** e preencha:
   - **URL:** `https://github.com/seu-usuario/notas.git` ou `git@github.com:seu-usuario/notas.git`
   - **Branch:** `main`
3. Na primeira sincronização, o Git Credential Manager abre a janela de login. Se você já usa Git
   nessa máquina com a mesma conta, ele reaproveita o login salvo e nada aparece.

O DocX nunca vê nem guarda a sua senha ou token. Uma URL com credencial embutida
(`https://usuario:token@...`) é recusada.

### Como funciona

- A pasta das notas vira um repositório Git (pasta `.git` dentro dela).
- A cada edição, e também a cada 30 segundos, o DocX faz **commit → busca no remoto → junta →
  envia**. Você não precisa digitar nenhum comando.
- **Vários computadores:** aponte o DocX de cada um para o mesmo repositório. As mudanças de um
  aparecem no outro.
- **Conflitos:** se a mesma nota mudou em dois lugares, a sua versão fica e a versão remota é salva
  ao lado como `nota (conflito AAAA-MM-DD HHMMSS).md`. Nada é perdido.
- **Offline:** os commits ficam locais e sobem quando a conexão voltar.
- **Histórico:** no menu **⋮** da nota, **Histórico de versões** mostra cada versão, a diferença
  para a atual e permite restaurar qualquer uma.
- A barra de status mostra o estado (sincronizado, sincronizando, sem conexão, erro) e tem
  **Sincronizar agora**.
- Arquivos e pastas que começam com `.` (por exemplo `.trash`) não vão para o Git.

Como é um repositório Git comum, você também pode usar `git log`, outros clientes Git ou outros
editores de Markdown na mesma pasta.

## Escrevendo notas

| Escreva | Para obter |
|---|---|
| `[[Outra nota]]` | Link para outra nota |
| `[[Outra nota\|texto]]` | Link com outro texto |
| `[[Outra nota#Título]]` / `[[Outra nota#^id]]` | Link para um título / bloco |
| `![[Outra nota]]` | Conteúdo da outra nota embutido |
| `![[imagem.png\|300]]` | Imagem com 300 px de largura |
| `![[Desenho.excalidraw]]` / `![[Fluxo.drawio.svg]]` | Desenho / diagrama como imagem |
| `#projeto/docx` | Tag (com hierarquia) |
| `==texto==` | Destaque |
| `%%oculto%%` | Comentário (não aparece na leitura) |
| `$E = mc^2$` / `$$...$$` | Fórmula na linha / em bloco |
| `> [!tip] Título` | Callout (`note`, `tip`, `warning`, `danger`, `info`, `todo`…) |
| ```` ```mermaid ```` | Diagrama Mermaid |
| `- [ ] tarefa` | Checklist |
| `texto[^1]` + `[^1]: nota` | Nota de rodapé |

Propriedades ficam no início da nota, em YAML:

```yaml
---
tags: [estudo, git]
aliases: [Controle de versão]
status: em andamento
---
```

## Atalhos de teclado

Todos os comandos estão na paleta (`Ctrl+P`). Os atalhos podem ser mudados em **⚙ Configurações ›
Atalhos de teclado**.

| Atalho | Ação |
|---|---|
| `Ctrl+P` | Paleta de comandos |
| `Ctrl+O` | Troca rápida (abrir ou criar nota) |
| `Ctrl+N` | Nova nota |
| `Alt+D` | Nota diária de hoje |
| `Alt+T` | Inserir modelo |
| `Ctrl+Shift+F` | Buscar no vault |
| `Ctrl+G` | Grafo |
| `Ctrl+Shift+B` | Barra lateral direita |
| `Ctrl+E` | Alternar edição e leitura |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+K` | Negrito / itálico / link |
| `Ctrl+L` | Alternar caixa de seleção |
| `Ctrl+H` | Buscar e substituir na nota |
| `Ctrl+T` / `Ctrl+W` | Nova aba / fechar aba |
| `Alt+←` / `Alt+→` | Voltar / avançar |
| `Ctrl+,` | Configurações |
| `Ctrl+clique` | Seguir link / abrir em nova aba |

## Onde ficam os dados

| O quê | Onde |
|---|---|
| Suas notas | Na pasta escolhida como vault (arquivos `.md` comuns) |
| Configurações do app | Windows: `%APPDATA%\DocX` · Linux: `~/.config/DocX` |
| Lixeira | `.trash/` dentro do vault |

As configurações nunca vão para o Git. Quem usava a versão anterior (chamada "Docs")
tem as configurações copiadas automaticamente na primeira abertura do DocX.

## Privacidade e segurança

- Sem servidor próprio, sem conta e sem telemetria: as notas vão apenas para o repositório que você
  configurou.
- Login do Git fica com o Git Credential Manager ou com a sua chave SSH. O DocX não lê nem guarda
  senhas ou tokens.
- O DocX ignora hooks e configurações perigosas de repositórios Git, e só aceita remotos `https` e
  `ssh`.
- O conteúdo das notas é sanitizado antes de ser exibido. Links externos abrem no navegador, e
  arquivos locais só são lidos de dentro do vault.
- Plugins de terceiros não são suportados, por segurança.
- O editor de diagramas roda num iframe com origem própria (`docx-drawio://`), sem acesso às notas
  nem ao app, e conversa com o DocX apenas por mensagens. Desenhos incorporados em notas são
  mostrados como imagem.

## Desinstalar

- **Windows:** Configurações › Aplicativos › DocX › Desinstalar.
- **Ubuntu/Debian:** `sudo apt remove docx-notes`.
- **AppImage:** apague o arquivo.

As notas e as configurações não são apagadas.

## Desenvolvimento

Requisitos: Node.js 20+ e Git.

```bash
npm install
npm start            # compila o renderer e abre o app
npm test             # testes (node --test)
```

No Windows, rode `npm install` no próprio Windows (PowerShell), não no WSL: o Electron e o esbuild
são baixados para a plataforma onde o comando roda.

### Gerar os instaladores

```bash
npm run dist:win     # no Windows  → release/DocX-Setup.exe
npm run dist:linux   # no Linux/WSL → release/DocX-linux-amd64.deb e DocX-x86_64.AppImage
```

O empacotamento usa o [electron-builder](https://www.electron.build).

**Automático (GitHub Actions):** `.github/workflows/release.yml` roda os testes e gera os três
instaladores no Windows e no Ubuntu do GitHub a cada push na `main`. Eles ficam como artefatos do
workflow (aba Actions, por 30 dias). Para publicar uma versão:

```bash
# atualize "version" no package.json, faça o commit e então:
git tag v1.0.1
git push origin v1.0.1
```

A tag dispara o mesmo build e cria a Release com os instaladores anexados.

**Local:** O instalador do Windows
(NSIS) precisa ser gerado no Windows, e os pacotes Linux no Linux (o WSL serve). O ícone original fica
em `build/icon-source.png`, com as versões recortadas em `build/icon.png` e `build/icons/`.

### Estrutura

```
src/
  main/       processo principal: janela, vault, configurações, sync Git (sync/git-sync.js)
  preload/    ponte segura entre o main e a interface
  renderer/   interface: editor, explorador, grafo, canvas, painéis, configurações
  shared/     lógica pura (links, Markdown, busca, grafo, canvas, modelos…), coberta por testes
test/         testes unitários e de integração (incluem repositórios Git locais)
scripts/      build do renderer
build/        ícones e recursos dos instaladores
```

## Licença

© 2026 Lucas Cardoso Alecrim. Todos os direitos reservados.

O DocX inclui o Excalidraw (MIT) e o draw.io (Apache-2.0), entre outros componentes de código
aberto. Veja [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
