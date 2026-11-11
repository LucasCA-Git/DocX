# Site do DocX (branch `site`)

Esta branch é **órfã**: tem só o site estático (HTML, CSS e JS, sem build), sem nenhum arquivo do
código do app. O GitHub Pages publica esta branch.

```
index.html         página inicial (recursos com vídeos, sincronização, download, FAQ)
apoie.html         doações: Pix (QR gerado no navegador), GitHub Sponsors, Ko-fi
privacidade.html   política de privacidade e cookies (exigida pelo AdSense e pela LGPD)
404.html           página de erro
assets/js/config.js  ← ÚNICO arquivo de configuração
assets/js/site.js    download por sistema, versão mais recente, vídeos, céu estrelado
assets/js/ads.js     anúncios com consentimento
assets/js/pix.js     Pix copia e cola (BR Code do Banco Central) + QR
assets/vendor/       qrcode-generator 1.4.4 (MIT, Kazuhiko Arase)
assets/videos/       demonstrações gravadas do app com um vault fictício
```

Para ver localmente: `python3 -m http.server 8080` nesta pasta e abra <http://localhost:8080>.

## 1. Publicar no GitHub Pages

Repo `DocX` › **Settings › Pages** › *Deploy from a branch* › branch **`site`**, pasta **`/ (root)`**.

Os botões de download apontam para `github.com/<repo>/releases/latest/download/...` (`repo` em
`config.js`, hoje `LucasCA-Git/DocX`, público). Se um dia o código ficar privado, o Pages deixa de
ser grátis e as Releases deixam de ser baixáveis: aí publique os instaladores num repo público só
de Releases (variável `PUBLIC_RELEASE_REPO` no workflow, ver `docs/PUBLICACAO.md` na `main`) e
troque `repo` em `config.js`.

Instalador dentro desta branch não dá: o Git recusa arquivos acima de 100 MB (o `.exe` tem
~165 MB) e o Pages não serve arquivos do Git LFS.

## 2. Domínio próprio

1. Compre o domínio (ex.: registro.br para `.com.br`).
2. No DNS do domínio, crie:
   - para o domínio raiz (`docx.com.br`): registros **A** para `185.199.108.153`,
     `185.199.109.153`, `185.199.110.153` e `185.199.111.153` (e **AAAA** `2606:50c0:8000::153`,
     `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`);
   - para `www`: **CNAME** para `lucasca-git.github.io`.
3. Settings › Pages › **Custom domain**: digite o domínio e salve (o GitHub cria o arquivo `CNAME`
   nesta branch). Depois marque **Enforce HTTPS**.
4. Verifique o domínio na sua conta (Settings da conta › Pages › *Add a domain*) para ninguém
   conseguir sequestrá-lo.
5. Troque `https://lucasca-git.github.io/DocX/` pelo novo endereço em: `config.js` (`siteUrl`),
   `og:image` das páginas, `robots.txt` e `sitemap.xml`. No `404.html`, troque `/DocX/` por `/`.

## 3. Doações

Em `assets/js/config.js`:

- `githubSponsors`: ative em <https://github.com/sponsors> (a aprovação leva alguns dias; o GitHub
  não cobra taxa de contas pessoais). Para receber no Brasil o GitHub pede conta bancária e dados
  fiscais.
- `kofi`: crie a conta em <https://ko-fi.com> e cole o link.
- `pix`: no app do banco, crie uma **chave aleatória** e preencha `key`, `name` (como aparece no
  banco, sem acento) e `city`. Nunca use CPF, telefone ou e-mail pessoal como chave: ela fica pública
  no site. Depois de publicar, **teste pagando R$ 1 a partir de outro banco**.
- `contact`: um e-mail só para o projeto (aparece na página de privacidade).

Opções sem link configurado somem sozinhas do site.

## 4. Anúncios limpos (Google AdSense)

1. Crie a conta em <https://adsense.google.com> com o **domínio próprio** (o AdSense não aprova
   subpastas como `lucasca-git.github.io/DocX`).
2. O AdSense pede um `ads.txt` na raiz do domínio: crie `ads.txt` nesta branch com a linha que ele
   mostrar (`google.com, pub-XXXXXXXX, DIRECT, f08c47fec0942fa0`).
3. Após a aprovação, crie blocos de anúncio "Display" e preencha em `config.js`:
   `adsenseClient` (`ca-pub-…`) e os IDs em `slots.home`, `slots.download` e `slots.apoie`.
4. **Deixe os anúncios limpos** em *Brand safety › Content › Blocking controls*:
   - **Sensitive categories:** bloqueie todas as que puder, principalmente *Dating*, *Gambling &
     betting*, *Get rich quick*, *Weight loss*, *Cosmetic procedures & body modification*,
     *Sexual & reproductive health*, *Astrology & esoteric*, *Drugs & supplements*, *Alcohol*,
     *Politics* e *Religion*. (Conteúdo adulto já é proibido na rede do AdSense.)
   - **Ad review center:** revise os anúncios que aparecerem nas primeiras semanas e bloqueie
     anunciantes ruins.
   - Desligue **Auto ads** (o site usa só os 3 espaços fixos, para não poluir a página).
5. Consentimento: o próprio site pergunta na primeira visita (personalizados ou não
   personalizados). Se for ter público da Europa, ative também *Privacy & messaging › GDPR* no
   AdSense, que usa um banner certificado pelo Google.

Enquanto o AdSense não estiver configurado, **nenhum script de anúncio é carregado** e os espaços
mostram um convite para apoiar o projeto.

## Segurança

- Tudo nesta branch é público. **Nunca** coloque aqui senha, token, chave de API secreta, `.env`
  ou dados de doadores. O ID do AdSense e a chave Pix aleatória são públicos por natureza.
- CSP nas páginas: só scripts do próprio site e, quando ativos, do Google AdSense. Sem
  `unsafe-inline` em scripts, sem Google Fonts e sem analytics.
- O botão de download é um link direto para a Release: não carrega nada antes do clique. A única
  chamada externa sem anúncios é a API pública do GitHub, para mostrar o número da versão (se ela
  falhar, o site funciona igual).
- Os vídeos foram gravados com um vault fictício e conferidos quadro a quadro: não mostram nomes,
  e-mails, caminhos ou repositórios reais.
