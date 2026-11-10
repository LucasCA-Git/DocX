// Configuração do site. É o ÚNICO arquivo que você precisa editar.
// Tudo aqui é PÚBLICO (qualquer visitante pode ler): nunca coloque senha, token ou chave secreta.

window.DOCX_SITE = {
  // Repositório com as Releases (instaladores). Precisa ser PÚBLICO para o download funcionar.
  repo: 'LucasCA-Git/DocX',

  // E-mail de contato mostrado na página de privacidade (público). Deixe '' para esconder.
  // Sugestão: um e-mail só para o projeto, não o pessoal.
  contact: '',

  // Endereço final do site (troque quando o domínio próprio estiver no ar).
  siteUrl: 'https://lucasca-git.github.io/DocX/',

  // Doação. Deixe '' para esconder a opção.
  donate: {
    githubSponsors: '', // ex.: 'https://github.com/sponsors/LucasCA-Git'
    kofi: '',           // ex.: 'https://ko-fi.com/seu-usuario'
    // Pix: use uma CHAVE ALEATÓRIA (nunca CPF ou telefone). O QR code é gerado no navegador.
    pix: {
      key: '',          // ex.: '123e4567-e89b-12d3-a456-426614174000'
      name: '',         // nome do recebedor como aparece no banco (até 25 letras, sem acento)
      city: '',         // cidade do recebedor (até 15 letras, sem acento)
    },
  },

  // Anúncios. Enquanto `adsenseClient` estiver vazio, nenhum script de anúncio é carregado e os
  // espaços mostram um convite para apoiar o projeto.
  ads: {
    adsenseClient: '',  // ex.: 'ca-pub-1234567890123456'
    slots: {
      home: '',         // ID do bloco de anúncio da página inicial
      download: '',     // ID do bloco perto do download
      apoie: '',        // ID do bloco na página Apoie
    },
  },
};
