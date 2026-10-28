// Manual do sistema: capítulos com passo a passo detalhado, na ordem em que o trabalho acontece.
export type Passo = { titulo: string; texto: string };
export type Capitulo = {
  id: string;
  titulo: string;
  icone: string;
  resumo: string;
  link?: { para: string; rotulo: string };
  passos: Passo[];
  dicas?: string[];
  atencao?: string[];
};

export const MANUAL: Capitulo[] = [
  {
    id: 'primeiros-passos', titulo: 'Primeiros passos', icone: 'inicio',
    resumo: 'Entrar no sistema, instalar no celular e conhecer a tela principal.',
    passos: [
      { titulo: 'Entre com seu e-mail e senha', texto: 'Abra o endereço do sistema no navegador. Na primeira vez, ou se esquecer a senha, toque em “Primeiro acesso ou esqueci a senha” na tela de entrada e siga o link que chega por e-mail.' },
      { titulo: 'Instale como aplicativo no celular', texto: 'No Android (Chrome): abra o sistema, toque nos três pontos e em “Instalar aplicativo” ou “Adicionar à tela inicial”. No iPhone (Safari): toque em Compartilhar e em “Adicionar à Tela de Início”. O ícone da ROSAE aparece junto dos outros aplicativos e abre em tela cheia.' },
      { titulo: 'Conheça o menu', texto: 'No computador, o menu fica à esquerda, dividido em Gestão, Financeiro e Sistema. No celular, as áreas de uso diário ficam na barra de baixo e o resto em “Mais”.' },
      { titulo: 'Use a busca rápida', texto: 'Aperte Ctrl + K (no Mac, ⌘ + K) ou toque na lupa para ir direto a qualquer tela, obra, cliente ou proposta digitando o nome.' },
      { titulo: 'Deixe com a sua cara', texto: 'Em Sistema → Aparência você escolhe a cor principal, o estilo do menu, o fundo, os cantos e o tamanho do texto. A escolha vale no celular e no computador.' },
    ],
    dicas: ['Os pontos de interrogação ao lado dos campos explicam cada número e cada regra.', 'Cada número do Início é clicável e abre os registros que o explicam.'],
  },
  {
    id: 'inicio', titulo: 'Início (painel de indicadores)', icone: 'grafico', link: { para: '/', rotulo: 'Abrir o Início' },
    resumo: 'A situação da empresa num relance: vendas, recebimentos, contas, caixa e pendências.',
    passos: [
      { titulo: 'Escolha o período', texto: 'No alto, troque entre Mês, Semestre e Ano e use as setas ‹ › para voltar ou avançar. Todos os indicadores e gráficos acompanham o período escolhido.' },
      { titulo: 'Leia os indicadores principais', texto: 'Recebido (dinheiro que entrou), Vendido (propostas aprovadas), A receber, A pagar e Resultado de caixa. A seta verde ou vermelha compara com o período anterior.' },
      { titulo: 'Explore os gráficos', texto: 'Passe o mouse (ou o dedo) sobre as barras para ver os valores. Clique num mês do fluxo de caixa para ver o detalhe e os atalhos para os lançamentos. Na legenda, toque numa série para escondê-la ou mostrá-la.' },
      { titulo: 'Veja como tabela', texto: 'Nos gráficos com o botão “Tabela”, os mesmos números aparecem em linhas e colunas, bons para conferir ou copiar.' },
      { titulo: 'Acompanhe as metas', texto: 'As barras de meta aparecem quando há meta definida em Configurações → Metas.' },
    ],
    atencao: ['Vendido não é dinheiro em caixa, e resultado de caixa não é lucro contábil: são números diferentes e aparecem separados de propósito.'],
  },
  {
    id: 'comercial', titulo: 'Comercial: contatos e funil', icone: 'comercial', link: { para: '/comercial', rotulo: 'Abrir o Comercial' },
    resumo: 'Registrar cada contato que chega e acompanhar até virar proposta aprovada.',
    passos: [
      { titulo: 'Cadastre o contato', texto: 'Toque em “Novo contato”. Escolha um cliente já cadastrado ou crie um novo, descreva o pedido e de onde veio (indicação, Instagram, site).' },
      { titulo: 'Defina a próxima ação', texto: 'Toda oportunidade deve ter uma próxima ação com data (ligar, visitar, enviar proposta). As atrasadas aparecem em vermelho e na central de Pendências.' },
      { titulo: 'Mova pelo funil', texto: 'Alterne entre as visões Quadro e Lista. Dentro da oportunidade, troque a etapa conforme a conversa avança. Clique numa etapa do funil no alto para ver só as oportunidades dela.' },
      { titulo: 'Registre o histórico', texto: 'Dentro da oportunidade, anote cada conversa no Histórico. Assim você sabe exatamente o que foi combinado.' },
      { titulo: 'Perdeu? Registre o motivo', texto: 'Ao arquivar como perdida, escolha o motivo (preço, prazo, desistência). Com o tempo isso mostra onde ajustar.' },
    ],
    dicas: ['O botão “Formulário do site” mostra o formulário pronto para colocar no site da ROSAE: cada envio vira contato aqui automaticamente.'],
  },
  {
    id: 'orcamento', titulo: 'Novo orçamento automático', icone: 'varinha', link: { para: '/orcamento', rotulo: 'Fazer um orçamento' },
    resumo: 'Responder poucas perguntas e receber o orçamento calculado, com três pacotes e a apresentação pronta.',
    passos: [
      { titulo: 'Escolha o tipo de serviço', texto: 'Projeto estrutural, reforço, reforma, construção, gestão de obra ou perícia. Cada tipo tem perguntas próprias.' },
      { titulo: 'Informe o cliente', texto: 'Escolha “Já cadastrado” ou “Novo cliente”. Se vier de uma oportunidade do Comercial, o cliente já vem preenchido.' },
      { titulo: 'Responda as perguntas', texto: 'Área, complexidade, número de pavimentos, prazo desejado e o que o cliente pediu. O valor é recalculado na hora a cada resposta.' },
      { titulo: 'Compare os pacotes', texto: 'O sistema monta três opções (por exemplo Essencial, Completo e Premium) com o que cada uma inclui e não inclui. Confira a margem estimada antes de seguir.' },
      { titulo: 'Gere a proposta', texto: 'Toque em “Gerar proposta”. Ela é criada como rascunho, com escopo, exclusões, responsabilidades e pagamento. Revise a apresentação e emita quando estiver pronta.' },
      { titulo: 'Ajuste seus preços', texto: 'Em “Tabela de preços do orçamento” (pela busca ou em Mais), revise valores por m², mínimos, hora técnica, BDI e taxa de ART. Os próximos orçamentos usam a tabela nova.' },
    ],
    atencao: ['Os preços que vieram de fábrica são referências iniciais. Revise a tabela com os seus valores antes de enviar orçamentos reais.'],
  },
  {
    id: 'propostas', titulo: 'Propostas: editar, emitir e enviar', icone: 'documento', link: { para: '/propostas', rotulo: 'Abrir as propostas' },
    resumo: 'Transformar o orçamento numa apresentação de alto padrão e mandar ao cliente com aceite pelo link.',
    passos: [
      { titulo: 'Revise as abas na ordem', texto: 'As abas numeradas guiam a montagem: dados gerais, escopo por ambiente e serviço, condições, pagamento e custos internos (que nunca aparecem para o cliente).' },
      { titulo: 'Confira a prévia', texto: 'Use a prévia para ver exatamente o documento que o cliente vai receber, página por página.' },
      { titulo: 'Emita a versão', texto: 'Toque em “Emitir versão”. Ela fica congelada com código de verificação. Precisa mudar algo? Crie uma nova versão: a anterior fica guardada e dá para comparar.' },
      { titulo: 'Envie o link', texto: 'Toque em “Enviar por WhatsApp” ou “Enviar por e-mail”. O aplicativo abre com a mensagem e o link seguro prontos.' },
      { titulo: 'Acompanhe o aceite', texto: 'O cliente abre no celular, lê e toca em Aceitar ou pede ajuste. O aceite fica registrado com nome, data e a versão exata, e a proposta passa a Aprovada.' },
      { titulo: 'Converta em obra', texto: 'Na proposta aprovada, toque em “Converter em obra”. Serviços, etapas, materiais e recebimentos são criados sem redigitar.' },
    ],
    dicas: ['“Duplicar” cria uma proposta nova a partir de outra parecida.', 'Para imprimir ou salvar em PDF, abra a prévia e use Imprimir.'],
  },
  {
    id: 'obras', titulo: 'Obras: do contrato à entrega', icone: 'obras', link: { para: '/obras', rotulo: 'Abrir as obras' },
    resumo: 'Contrato, cronograma, materiais, diário com fotos, fichas de campo e financeiro de cada obra.',
    passos: [
      { titulo: 'Gere o contrato', texto: 'Na aba Contrato, confira os dados que faltam (documento, endereço), revise as cláusulas e emita. Depois toque em “Liberar obra”.' },
      { titulo: 'Colha a assinatura pelo link', texto: 'Com o contrato emitido, toque em “Gerar link de assinatura” e envie pelo WhatsApp. O cliente lê no celular e assina com nome completo e CPF/CNPJ. O contrato passa sozinho a “Assinado”, com data, hora e código da versão. Se ele assinar fora (papel ou gov.br), use “Registrar assinatura”.' },
      { titulo: 'Monte o cronograma', texto: 'Na aba Cronograma, ajuste etapas, pesos e durações, use “Programar datas” e, quando combinar com o cliente, “Guardar linha de base”. A Curva S compara o previsto com o realizado.' },
      { titulo: 'Controle os materiais', texto: 'Na aba Materiais, cadastre o que é necessário e registre compra, entrega na obra, devolução ou cancelamento. O sistema mostra o que falta comprar e entregar.' },
      { titulo: 'Registre o dia a dia', texto: 'No Diário e fotos, toque em Registrar, escolha o tipo (execução, visita, ocorrência, condição existente) e anexe fotos de antes, durante e depois.' },
      { titulo: 'Use as fichas de campo', texto: 'Na aba Fichas, gere a ficha do serviço para a equipe ou parceiro usar no canteiro, com o que fazer e o que conferir.' },
      { titulo: 'Faça as medições', texto: 'Na aba Medições, atualize antes o percentual das etapas no Cronograma e toque em “Gerar medição” com a data de corte. Confira o rascunho e toque em “Enviar ao cliente”: ele aprova ou contesta pelo portal, sem ver valores. Aprovada, toque em “Lançar cobrança” (ou ligue a uma parcela existente).' },
      { titulo: 'Acompanhe o financeiro da obra', texto: 'Na aba Financeiro, veja o vendido, recebido, gasto e o resultado por serviço. Lance contas a pagar e a receber da obra direto daqui.' },
      { titulo: 'Gere os relatórios', texto: 'No topo da obra, toque em Relatório para abrir o relatório administrativo (uso interno) e use “Imprimir ou salvar PDF”. O relatório do cliente, sem valores, também fica disponível no portal.' },
    ],
    atencao: ['O percentual da obra só sobe com execução registrada, nunca com compra ou pagamento.', 'Medição contestada não se edita: converse com o cliente, ajuste o cronograma, cancele a medição e gere outra.'],
  },
  {
    id: 'portal', titulo: 'Portal do cliente', icone: 'olho', link: { para: '/obras', rotulo: 'Escolher uma obra' },
    resumo: 'Um link pessoal para o cliente acompanhar a obra sem ver valores internos.',
    passos: [
      { titulo: 'Gere o link de acesso', texto: 'Na obra, aba Portal do cliente, gere um link para cada pessoa (por exemplo marido e esposa, cada um com o seu). Você pode desativar quando quiser.' },
      { titulo: 'Publique o que o cliente deve ver', texto: 'Em “Publicar no portal”, escolha os registros, fotos e etapas e toque em Publicar. Só aparece o que você publicar.' },
      { titulo: 'Confira como cliente', texto: 'Use “Ver como cliente” para ver exatamente a tela dele antes de avisar.' },
      { titulo: 'Responda e colha ciência', texto: 'O cliente pode mandar mensagens e dar ciência nas decisões. Tudo fica registrado com data.' },
      { titulo: 'Medições para aprovar', texto: 'Quando você envia uma medição, ela aparece em destaque no início do portal e numa aba própria. O cliente vê etapa por etapa, aprova ou diz o que não confere. A resposta aparece na aba Medições da obra e na central de pendências.' },
    ],
  },
  {
    id: 'financeiro', titulo: 'Financeiro: contas a pagar e a receber', icone: 'financeiro', link: { para: '/financeiro', rotulo: 'Abrir o financeiro' },
    resumo: 'Lançar o que entra e o que sai, dar baixa nos pagamentos e manter o caixa em dia.',
    passos: [
      { titulo: 'Lance uma conta', texto: 'Toque em “Nova conta a receber” ou “Nova conta a pagar”. Informe descrição, pessoa, categoria, se é da obra ou da empresa, valor e as parcelas.' },
      { titulo: 'Divida em parcelas', texto: 'Escolha entrada + parcelas, por etapa ou mensal. As datas e valores podem ser ajustados um a um antes de salvar.' },
      { titulo: 'Dê baixa quando o dinheiro movimentar', texto: 'Abra o lançamento e toque em “Registrar recebimento” (ou pagamento) na parcela. Informe data, valor, conta bancária e anexe o comprovante.' },
      { titulo: 'Errou? Estorne', texto: 'Use “Estornar” no movimento. O original fica guardado e o estorno aparece ao lado, para a história bater.' },
      { titulo: 'Filtre e encontre', texto: 'Filtre por A receber / A pagar, situação (abertas, vencidas, pagas), obra e período. Cada linha abre o lançamento completo.' },
    ],
    atencao: ['Pró-labore e retiradas ficam separados das despesas da empresa, para não confundir o resultado da empresa com o seu ganho.'],
  },
  {
    id: 'contas', titulo: 'Contas bancárias, notas e planejador', icone: 'contas', link: { para: '/contas', rotulo: 'Abrir as contas' },
    resumo: 'Saldos por conta, transferências, importação de notas fiscais e destino do dinheiro.',
    passos: [
      { titulo: 'Cadastre suas contas', texto: 'Em Configurações → Contas bancárias, cadastre conta corrente, poupança e cofrinhos com o saldo inicial.' },
      { titulo: 'Transfira entre contas', texto: 'Em Contas, toque em “Transferir entre contas”. Transferência não conta como receita nem despesa.' },
      { titulo: 'Importe notas fiscais', texto: 'Em Notas fiscais, toque em Importar XML, confira emitente e itens, classifique e toque em “Confirmar e lançar”. A conta a pagar e as compras de material são criadas sozinhas, sem duplicar.' },
      { titulo: 'Planeje a destinação', texto: 'No Planejador, veja quanto do dinheiro que entrou deve ir para impostos, reserva, reinvestimento e pró-labore, conforme os percentuais definidos em Configurações.' },
    ],
    dicas: ['Notas em foto ou PDF: lance como conta a pagar comum e anexe o arquivo.'],
  },
  {
    id: 'agenda', titulo: 'Agenda e pendências', icone: 'calendario', link: { para: '/pendencias', rotulo: 'Ver pendências' },
    resumo: 'Tudo que tem data num só lugar e a lista do que precisa de ação.',
    passos: [
      { titulo: 'Veja a agenda', texto: 'A Agenda junta etapas de obra, materiais com data, contas a receber e a pagar, propostas e ações do comercial, de todas as obras e em ordem. Escolha 7, 30 ou 60 dias e filtre por área.' },
      { titulo: 'Resolva as pendências', texto: 'A central de Pendências lista, da mais urgente para a menos, contas vencidas, ações atrasadas, propostas sem resposta e obras paradas. Cada item leva direto à tela para resolver.' },
      { titulo: 'Adie ou dispense', texto: 'Se algo pode esperar, adie por 3 ou 7 dias, ou dispense. A dispensa vale só para você.' },
    ],
  },
  {
    id: 'cadastros', titulo: 'Cadastros e biblioteca de serviços', icone: 'pessoas', link: { para: '/pessoas', rotulo: 'Abrir os cadastros' },
    resumo: 'Clientes, fornecedores e parceiros num cadastro único, e os serviços que você vende.',
    passos: [
      { titulo: 'Cadastre a pessoa uma vez só', texto: 'Toque em “Nova pessoa” e marque os papéis: cliente, fornecedor, parceiro. A mesma pessoa pode ter mais de um papel. O sistema avisa se já existe alguém com o mesmo telefone, e-mail ou documento.' },
      { titulo: 'Monte a biblioteca', texto: 'Em Biblioteca de serviços, cadastre cada serviço com unidade, preço, o que inclui, o que não inclui e as etapas. As propostas e o escopo automático usam essa biblioteca.' },
    ],
  },
  {
    id: 'configuracoes', titulo: 'Configurações e usuários', icone: 'config', link: { para: '/configuracoes', rotulo: 'Abrir as configurações' },
    resumo: 'Dados da empresa, metas, contas, categorias, usuários, backup e histórico.',
    passos: [
      { titulo: 'Complete os dados da empresa', texto: 'Na aba Empresa, confira razão social, CNPJ, CREA, endereço e contatos. Eles saem nas propostas, contratos e relatórios.' },
      { titulo: 'Defina as metas', texto: 'Na aba Metas, informe a meta mensal de vendas e de recebimentos. O Início mostra o quanto já foi alcançado.' },
      { titulo: 'Convide usuários', texto: 'Na aba Usuários, convide pessoas e escolha o papel: Administrativo (com ou sem acesso ao financeiro) ou Campo. Cada um vê só o que o papel permite.' },
      { titulo: 'Faça backup', texto: 'Na aba Exportar e backup, baixe todos os dados em planilha (CSV) ou JSON. Há também backup automático.' },
      { titulo: 'Consulte o histórico', texto: 'A aba Histórico mostra quem alterou o quê e quando.' },
    ],
  },
  {
    id: 'celular', titulo: 'Usando no celular', icone: 'menu',
    resumo: 'O sistema foi feito para funcionar bem na obra, com uma mão só.',
    passos: [
      { titulo: 'Barra de baixo', texto: 'Início, Comercial, Obras e Financeiro ficam sempre à mão. O restante está em “Mais”, organizado por área, junto com o botão Sair.' },
      { titulo: 'Fotos direto da câmera', texto: 'No Diário e fotos, toque em anexar e escolha a câmera. As fotos são reduzidas no próprio celular para enviar rápido mesmo com sinal fraco.' },
      { titulo: 'Listas em cartões', texto: 'No celular, as tabelas viram cartões fáceis de tocar. Gire o celular para ver os gráficos maiores.' },
      { titulo: 'Modo escuro', texto: 'No ícone de sol/lua no topo você troca entre claro, escuro e automático. Bom para usar à noite.' },
    ],
  },
];
