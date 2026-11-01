// "Como funciona": guia de cada página, pasta e subpasta. Diz para que serve, mostra o
// passo a passo e, quando há um botão ou área na tela, aponta para ele na demonstração.
export type PassoGuia = {
  titulo: string;
  texto: string;
  /** Texto de um botão, aba ou título que existe na tela, para destacar na demonstração. */
  alvo?: string;
};
export type Guia = { id: string; titulo: string; serve: string; passos: PassoGuia[]; dicas?: string[]; manual?: string };

const G: Guia[] = [
  {
    id: 'inicio', titulo: 'Início', manual: 'inicio',
    serve: 'A situação da ROSAE num relance: quanto entrou, quanto foi vendido, o que vence e o que precisa de você. É a primeira tela do dia.',
    passos: [
      { titulo: 'Escolha o período', texto: 'Troque entre Mês, Semestre e Ano e use as setas para voltar ou avançar. Todos os números acompanham.', alvo: 'Semestre' },
      { titulo: 'Abra um departamento', texto: 'Os quatro cartões levam direto a Comercial, Obras, Financeiro e Empresa, cada um com as suas subpastas.', alvo: 'Gestão de Obras' },
      { titulo: 'Leia os indicadores', texto: 'Recebido é dinheiro que entrou; Vendido é proposta aprovada; Resultado de caixa é entrada menos saída. Toque num número para ver os lançamentos que o formam.', alvo: 'Recebido de clientes' },
      { titulo: 'Explore o fluxo de caixa', texto: 'Passe o dedo ou o mouse nas barras. Toque num mês para ver o detalhe e use “Tabela” para conferir os números em linhas.', alvo: 'Fluxo de caixa' },
    ],
    dicas: ['Vendido não é dinheiro em caixa: os números aparecem separados de propósito.', 'Ctrl + K (ou a lupa) abre a busca rápida de qualquer tela, obra ou cliente.'],
  },
  {
    id: 'dep-comercial', titulo: 'Departamento Comercial e Orçamentos',
    serve: 'Tudo o que acontece antes da obra: o contato que chega, o orçamento, a proposta e o aceite do cliente.',
    passos: [
      { titulo: 'Veja os números do setor', texto: 'No alto ficam as oportunidades abertas, as propostas aguardando resposta e o que foi vendido.' },
      { titulo: 'Escolha uma subpasta', texto: 'Funil de clientes, Novo orçamento, Propostas, Tabela de preços, Biblioteca e Cláusulas. Cada cartão explica o que tem dentro.', alvo: 'Funil de clientes' },
      { titulo: 'Resolva o que está pendente', texto: 'A lista de atenção mostra propostas sem resposta e contatos com ação atrasada.' },
      { titulo: 'Entenda as ligações', texto: 'Proposta aprovada vira obra e as parcelas vão para o Financeiro, sem digitar de novo.' },
    ],
  },
  {
    id: 'dep-obras', titulo: 'Departamento Gestão de Obras',
    serve: 'A execução: cada obra com cronograma, materiais, diário com fotos, medições, contrato e o portal do cliente.',
    passos: [
      { titulo: 'Veja as obras em andamento', texto: 'Os números do setor mostram obras ativas, etapas atrasadas e o que falta comprar.' },
      { titulo: 'Entre numa subpasta', texto: 'Obras, Agenda e Central de pendências.', alvo: 'Obras' },
      { titulo: 'Acompanhe as ligações', texto: 'Medição aprovada gera cobrança no Financeiro; serviço a mais vira aditivo no Comercial.' },
    ],
  },
  {
    id: 'dep-financeiro', titulo: 'Departamento Financeiro',
    serve: 'O dinheiro da empresa e de cada obra: o que entra, o que sai, os saldos e as notas fiscais.',
    passos: [
      { titulo: 'Confira a saúde do caixa', texto: 'Os números do setor mostram a receber, a pagar e o saldo das contas.' },
      { titulo: 'Escolha a subpasta', texto: 'Pagar e receber, Contas bancárias, Notas fiscais e Planejador.', alvo: 'Pagar e receber' },
      { titulo: 'Use as ligações', texto: 'Cada lançamento pode ser de uma obra e de um serviço, e o vendido do mês aparece ao lado do recebido.' },
    ],
  },
  {
    id: 'dep-empresa', titulo: 'Departamento Empresa e Sistema',
    serve: 'O que serve a todos: cadastros, dados da ROSAE, aparência, assistente de IA, manual e ajuda.',
    passos: [
      { titulo: 'Cadastros', texto: 'Clientes, parceiros e fornecedores num só lugar, sem duplicar.', alvo: 'Cadastros' },
      { titulo: 'Aparência', texto: 'Escolha a paleta e o sistema inteiro muda em harmonia, gráficos inclusive.', alvo: 'Aparência' },
      { titulo: 'Assistente IA', texto: 'Pergunte e lance dados conversando, aqui ou pelo WhatsApp.', alvo: 'Assistente IA' },
    ],
  },
  {
    id: 'comercial', titulo: 'Funil de clientes', manual: 'comercial',
    serve: 'Registrar cada pessoa que pediu orçamento e conduzir a conversa até a proposta aprovada, sem esquecer ninguém.',
    passos: [
      { titulo: 'Cadastre o contato', texto: 'Toque em Novo contato, escolha ou crie o cliente, descreva o pedido e de onde ele veio.', alvo: 'Novo contato' },
      { titulo: 'Escolha como ver', texto: 'Quadro mostra as colunas do funil; Lista mostra tudo em linhas, bom para muitos contatos.', alvo: 'Quadro' },
      { titulo: 'Defina a próxima ação', texto: 'Toda oportunidade precisa de uma próxima ação com data. As atrasadas ficam em vermelho e vão para Pendências.' },
      { titulo: 'Avance a etapa', texto: 'Abra a oportunidade e troque a etapa conforme a conversa anda. Dali você já cria a proposta.' },
      { titulo: 'Perdeu? Registre o motivo', texto: 'Arquive como perdida e diga o motivo. Com o tempo isso mostra onde ajustar preço ou prazo.' },
    ],
    dicas: ['“Formulário do site” traz o código pronto para o site: cada envio vira um contato aqui sozinho.'],
  },
  {
    id: 'orcamento', titulo: 'Novo orçamento', manual: 'orcamento',
    serve: 'Responder poucas perguntas e receber o orçamento calculado, em três pacotes, com a apresentação de alto padrão pronta para enviar.',
    passos: [
      { titulo: 'Escolha o serviço', texto: 'Projeto estrutural, reforço, reforma, construção, gestão ou perícia. Cada um tem as suas perguntas.' },
      { titulo: 'Informe o cliente', texto: 'Já cadastrado ou Novo cliente.', alvo: 'Novo cliente' },
      { titulo: 'Responda e veja o preço mudar', texto: 'Área, complexidade, prazo: o valor é recalculado a cada resposta.' },
      { titulo: 'Compare os pacotes', texto: 'Essencial, Completo e Premium, com o que cada um inclui. Confira a margem estimada.' },
      { titulo: 'Defina o seu preço, se quiser', texto: '“Definir meu preço” troca o valor calculado pelo seu, e as parcelas acompanham.' },
      { titulo: 'Gere a proposta', texto: 'Ela abre pronta para editar direto na página e emitir.' },
    ],
  },
  {
    id: 'propostas', titulo: 'Propostas', manual: 'propostas',
    serve: 'Todas as propostas e as suas versões, com quem abriu o link, quando vence e em que pé está cada uma.',
    passos: [
      { titulo: 'Crie uma proposta', texto: 'Pelo Orçamento automático (recomendado) ou em branco.', alvo: 'Orçamento automático' },
      { titulo: 'Filtre e encontre', texto: 'Use os filtros por situação e a busca para achar qualquer proposta.' },
      { titulo: 'Veja quem abriu', texto: 'A linha mostra quantas vezes o cliente abriu o link e quando vence. Ligue primeiro para quem abriu e ainda não respondeu.' },
      { titulo: 'Abra para editar ou enviar', texto: 'Toque numa proposta para editar na página, emitir a versão e mandar o link.' },
    ],
  },
  {
    id: 'proposta', titulo: 'Proposta', manual: 'propostas',
    serve: 'Montar a proposta direto na folha, como o cliente vai ver, emitir a versão e enviar o link para o aceite.',
    passos: [
      { titulo: 'Edite na própria página', texto: 'Clique em qualquer texto ou valor da folha. Enter confirma, Esc desfaz. Mudou um preço? Parcelas e total acompanham.', alvo: 'Editar na página' },
      { titulo: 'Confira a força da proposta', texto: 'A nota de 0 a 10 mostra os gatilhos de decisão que faltam: depoimentos, parcelamento, validade curta e outros, com a dica de cada um.', alvo: 'Força da proposta' },
      { titulo: 'Tire o que não precisa', texto: '“Tirar esta página” some com a página para o cliente. “Mostrar de novo” devolve.', alvo: 'Tirar esta página' },
      { titulo: 'Veja como o cliente vê', texto: 'Alterne para conferir a versão final sem os controles de edição.', alvo: 'Como o cliente vê' },
      { titulo: 'Emita e envie', texto: 'Emitir congela a versão com um código de verificação. Depois envie por e-mail ou WhatsApp.', alvo: 'Emitir versão' },
    ],
    dicas: ['Versão emitida não muda: “Editar orçamento” cria a próxima versão e guarda a anterior.', 'Depoimentos de clientes são o gatilho de confiança mais forte. Adicione na página “Quem já confiou”.'],
  },
  {
    id: 'precos', titulo: 'Tabela de preços', manual: 'orcamento',
    serve: 'Os valores de referência que o orçamento automático usa: preço por m², horas, CUB, BDI, taxas. Ajuste à sua realidade.',
    passos: [
      { titulo: 'Escolha o serviço', texto: 'Cada tipo de serviço tem a sua tabela.' },
      { titulo: 'Mude os valores', texto: 'Digite o novo valor. Só o que você mudou é guardado; o resto segue o padrão.' },
      { titulo: 'Salve ou descarte', texto: 'Salvar vale para os próximos orçamentos. Os já feitos não mudam.', alvo: 'Descartar mudanças' },
    ],
  },
  {
    id: 'biblioteca', titulo: 'Biblioteca de serviços', manual: 'cadastros',
    serve: 'Seus serviços prontos, com o texto ao cliente, inclusões, exclusões, etapas e preço de referência. Cada proposta copia daqui.',
    passos: [
      { titulo: 'Crie um serviço', texto: 'Toque em Novo serviço e escreva como você explica aquele serviço ao cliente.', alvo: 'Novo serviço' },
      { titulo: 'Defina o que entra e o que não entra', texto: 'Inclusões e exclusões claras evitam discussão na obra.' },
      { titulo: 'Use nas propostas', texto: 'Na proposta, a busca de serviços puxa daqui e você ajusta caso a caso.' },
    ],
  },
  {
    id: 'clausulas', titulo: 'Cláusulas de contrato',
    serve: 'Os modelos de cláusula que entram nos contratos. Escreva uma vez e use em todos.',
    passos: [
      { titulo: 'Adicione uma cláusula', texto: 'Toque em Cláusula, dê um título e escreva o texto.', alvo: 'Cláusula' },
      { titulo: 'Organize', texto: 'Edite, reordene ou desative as que não usa mais.' },
      { titulo: 'Gere o contrato', texto: 'Na obra, a aba Contrato junta as cláusulas com os dados do cliente e da proposta.' },
    ],
  },
  {
    id: 'obras', titulo: 'Obras', manual: 'obras',
    serve: 'Cada obra (ou trabalho só de projeto) com tudo dentro: serviços, cronograma, materiais, diário, medições, contrato, financeiro e portal.',
    passos: [
      { titulo: 'Crie a obra', texto: 'O jeito mais rápido é converter a proposta aprovada. Para obra sem proposta, use Nova obra.', alvo: 'Nova obra' },
      { titulo: 'Filtre', texto: 'Em andamento ou Todas.', alvo: 'Em andamento' },
      { titulo: 'Abra uma obra', texto: 'Toque na obra para ver as abas: Visão geral, Cronograma, Materiais, Diário, Medições, Contrato, Financeiro e Portal do cliente.' },
    ],
  },
  {
    id: 'obra', titulo: 'Obra', manual: 'obras',
    serve: 'O centro da execução. Cada aba cuida de uma parte, e tudo se liga: etapa executada sobe o percentual, medição vira cobrança, foto publicada aparece no portal.',
    passos: [
      { titulo: 'Navegue pelas abas', texto: 'Cronograma, Materiais, Diário e fotos, Medições, Contrato, Financeiro e Portal do cliente.', alvo: 'Cronograma' },
      { titulo: 'Planeje o cronograma', texto: 'Ajuste etapas, pesos e durações e use Programar datas para sequenciar.', alvo: 'Programar datas' },
      { titulo: 'Registre o dia a dia', texto: 'No Diário, registre execução, impedimentos e fotos. Antes, durante e depois.', alvo: 'Registrar' },
      { titulo: 'Meça e cobre', texto: 'Na aba Medições, registre o que foi executado; aprovada, ela vira cobrança.' },
      { titulo: 'Mostre ao cliente', texto: 'No Portal do cliente, gere o link e publique o que ele deve ver.', alvo: 'Ver como cliente' },
    ],
    dicas: ['O percentual da obra só sobe com execução, nunca com compra ou pagamento.'],
  },
  {
    id: 'agenda', titulo: 'Agenda', manual: 'agenda',
    serve: 'Tudo o que tem data, de todas as obras e do comercial: etapas, entregas de material, vencimentos e visitas.',
    passos: [
      { titulo: 'Veja a semana', texto: 'Os compromissos aparecem em ordem, com a cor do assunto.' },
      { titulo: 'Toque para abrir', texto: 'Cada item leva à obra, conta ou oportunidade de origem.' },
    ],
  },
  {
    id: 'pendencias', titulo: 'Central de pendências', manual: 'agenda',
    serve: 'O que precisa da sua ação, de todos os departamentos, do mais urgente para o menos. Zerar esta lista é ter o dia sob controle.',
    passos: [
      { titulo: 'Comece pelo topo', texto: 'Os itens mais urgentes ficam primeiro.' },
      { titulo: 'Resolva ou adie', texto: 'Abra o item para resolver, ou use Lembrar em 3 dias para tirar da frente por enquanto.', alvo: 'Lembrar em 3 dias' },
      { titulo: 'Ignore o que não importa', texto: '“Não mostrar mais” esconde avisos que não se aplicam.', alvo: 'Não mostrar mais' },
    ],
  },
  {
    id: 'financeiro', titulo: 'Pagar e receber', manual: 'financeiro',
    serve: 'Contas a receber e a pagar, com parcelas, baixas e comprovantes. Cada pagamento vira um movimento na conta bancária.',
    passos: [
      { titulo: 'Lance uma conta', texto: 'A receber para clientes, A pagar para fornecedores e parceiros.', alvo: 'A receber' },
      { titulo: 'Ligue à obra', texto: 'Escolha a obra e o serviço para o resultado de cada obra ficar certo.' },
      { titulo: 'Dê baixa', texto: 'Abra o lançamento e registre o pagamento, total ou parcial, com o comprovante.' },
      { titulo: 'Errou? Estorne', texto: 'O estorno desfaz mantendo o histórico. Lançamento sem pagamento pode ser cancelado.' },
    ],
  },
  {
    id: 'contas', titulo: 'Contas bancárias', manual: 'contas',
    serve: 'O saldo de cada conta e cofrinho e todo dinheiro que entrou ou saiu, para bater com o extrato do banco.',
    passos: [
      { titulo: 'Cadastre as contas', texto: 'Banco, Pix, caixa, cofrinho: cada uma com saldo inicial.', alvo: 'Nova conta' },
      { titulo: 'Transfira entre contas', texto: 'Mover dinheiro entre contas não é receita nem despesa.', alvo: 'Transferir entre contas' },
      { titulo: 'Confira o extrato', texto: 'Os movimentos aparecem por data, com a origem de cada um.' },
    ],
  },
  {
    id: 'notas', titulo: 'Notas fiscais', manual: 'contas',
    serve: 'Ler a nota (XML, foto ou PDF), distribuir os itens por obra e lançar a conta a pagar uma única vez.',
    passos: [
      { titulo: 'Importe a nota', texto: 'XML da NF-e, ou foto e PDF para a IA ler.', alvo: 'Importar XML' },
      { titulo: 'Confira', texto: 'Os pontos incertos vêm marcados. O sistema avisa se a nota já foi importada.' },
      { titulo: 'Distribua os itens', texto: 'Escolha a obra de cada item ou use Aplicar a todos.', alvo: 'Aplicar a todos' },
      { titulo: 'Confirme e lance', texto: 'A conta a pagar sai rateada entre as obras.' },
    ],
  },
  {
    id: 'planejador', titulo: 'Planejador', manual: 'contas',
    serve: 'Quanto do dinheiro em conta está livre depois dos compromissos, e uma sugestão de destino: reserva, impostos, pró-labore.',
    passos: [
      { titulo: 'Veja o livre', texto: 'Saldo das contas menos o que vence nos próximos dias.' },
      { titulo: 'Siga a sugestão', texto: 'É gerencial: nada é lançado sozinho. Você decide e lança no Financeiro.' },
    ],
  },
  {
    id: 'assistente', titulo: 'Assistente IA',
    serve: 'Perguntar e lançar dados conversando, aqui ou pelo WhatsApp. Nada é gravado sem a sua confirmação.',
    passos: [
      { titulo: 'Pergunte', texto: 'Ex.: “quanto recebi este mês?” ou “o que vence esta semana?”.' },
      { titulo: 'Peça para lançar', texto: 'Ex.: “paguei 450 de cimento da obra Duarte”. O assistente prepara e você confirma.', alvo: 'Confirmar' },
      { titulo: 'Ligue o WhatsApp', texto: 'Gere o código e mande para o número do assistente.', alvo: 'Gerar código' },
    ],
  },
  {
    id: 'pessoas', titulo: 'Cadastros', manual: 'cadastros',
    serve: 'Clientes, parceiros, prestadores e fornecedores num só lugar. Uma pessoa pode ter vários papéis sem duplicar.',
    passos: [
      { titulo: 'Cadastre', texto: 'Nome, telefone e e-mail bastam para começar; documento e endereço quando for gerar contrato.' },
      { titulo: 'Evite duplicados', texto: 'O sistema avisa se já existe alguém parecido. Achou duplicado? Use Mesclar cadastros.', alvo: 'Mesclar cadastros' },
      { titulo: 'Edite ou exclua', texto: 'Abra o cadastro para mudar qualquer dado. Quem tem histórico pode ser anonimizado (LGPD).' },
    ],
  },
  {
    id: 'configuracoes', titulo: 'Configurações', manual: 'configuracoes',
    serve: 'Dados reais da ROSAE (que saem nas propostas e contratos), metas, contas, usuários e permissões.',
    passos: [
      { titulo: 'Confira os dados da empresa', texto: 'Nome, CNPJ, CREA, telefone e e-mail aparecem nos documentos ao cliente.' },
      { titulo: 'Defina metas', texto: 'As metas aparecem como barras no Início.' },
      { titulo: 'Gerencie usuários', texto: 'Convide pessoas e escolha o que cada uma pode ver.' },
    ],
  },
  {
    id: 'lixeira', titulo: 'Lixeira',
    serve: 'Tudo o que foi excluído fica guardado aqui com os dados completos. Restaurar devolve o registro e tudo o que saiu junto, como era.',
    passos: [
      { titulo: 'Exclua de dentro do cadastro', texto: 'Em cada obra, proposta, cliente, lançamento ou nota há o botão Excluir. Antes de confirmar, ele mostra tudo o que vai junto.' },
      { titulo: 'Restaure quando precisar', texto: 'Aqui, toque em Restaurar. Volta tudo de uma vez, com as ligações.' },
      { titulo: 'Veja o histórico', texto: '“Mostrar já restaurados” lista também o que já voltou.', alvo: 'Mostrar já restaurados' },
    ],
  },
  {
    id: 'aparencia', titulo: 'Aparência',
    serve: 'Deixar o sistema com a sua cara. Cada paleta muda tudo em harmonia: botões, menu, cartões de destaque e gráficos.',
    passos: [
      { titulo: 'Escolha a paleta', texto: 'Verdes, Azuis, Neutros e Quentes. Toque e veja o sistema inteiro mudar na hora.', alvo: 'Paleta' },
      { titulo: 'Escolha o menu', texto: 'Claro, escuro (no tom profundo da paleta) ou na cor.', alvo: 'Menu e página' },
      { titulo: 'Ajuste formas e texto', texto: 'Cantos, espaçamento e tamanho da letra.', alvo: 'Formas e texto' },
    ],
    dicas: ['Propostas, contratos e o portal do cliente seguem sempre a identidade da marca ROSAE.'],
  },
  {
    id: 'manual', titulo: 'Manual',
    serve: 'O passo a passo completo de cada parte do sistema, na ordem em que o trabalho acontece.',
    passos: [{ titulo: 'Escolha o capítulo', texto: 'O índice leva a cada parte. Cada capítulo tem passos, dicas e atenções.' }],
  },
  {
    id: 'ajuda', titulo: 'Ajuda rápida',
    serve: 'Respostas curtas por tarefa, com exemplo e erros frequentes.',
    passos: [
      { titulo: 'Busque', texto: 'Digite o que quer fazer: nota, cronograma, portal…' },
      { titulo: 'Reveja a introdução', texto: 'O tour de boas-vindas pode ser aberto de novo.', alvo: 'Rever introdução' },
    ],
  },
];

export const GUIAS: Record<string, Guia> = Object.fromEntries(G.map((g) => [g.id, g]));

/** Rotas (da mais específica para a mais geral) e o guia de cada uma. */
const ROTAS: [RegExp, string][] = [
  [/^\/$/, 'inicio'],
  [/^\/d\/comercial/, 'dep-comercial'],
  [/^\/d\/obras/, 'dep-obras'],
  [/^\/d\/financeiro/, 'dep-financeiro'],
  [/^\/d\/empresa/, 'dep-empresa'],
  [/^\/comercial/, 'comercial'],
  [/^\/orcamento\/precos/, 'precos'],
  [/^\/orcamento/, 'orcamento'],
  [/^\/propostas\/[^/]+/, 'proposta'],
  [/^\/propostas/, 'propostas'],
  [/^\/biblioteca/, 'biblioteca'],
  [/^\/clausulas/, 'clausulas'],
  [/^\/obras\/[^/]+/, 'obra'],
  [/^\/obras/, 'obras'],
  [/^\/agenda/, 'agenda'],
  [/^\/pendencias/, 'pendencias'],
  [/^\/financeiro/, 'financeiro'],
  [/^\/contas/, 'contas'],
  [/^\/notas/, 'notas'],
  [/^\/planejador/, 'planejador'],
  [/^\/assistente/, 'assistente'],
  [/^\/pessoas/, 'pessoas'],
  [/^\/configuracoes/, 'configuracoes'],
  [/^\/aparencia/, 'aparencia'],
  [/^\/lixeira/, 'lixeira'],
  [/^\/manual/, 'manual'],
  [/^\/ajuda/, 'ajuda'],
];

export function guiaDaRota(caminho: string): Guia | null {
  const r = ROTAS.find(([re]) => re.test(caminho));
  return r ? GUIAS[r[1]] ?? null : null;
}
