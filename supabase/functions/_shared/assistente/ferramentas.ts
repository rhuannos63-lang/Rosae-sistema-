// Ferramentas que a IA pode usar. As de consulta rodam na hora; as de gravação
// só preparam uma ação, que a pessoa confirma antes de valer.

export type Esquema = {
  type: 'object';
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: false;
};
export type Ferramenta = { nome: string; descricao: string; parametros: Esquema; grava: boolean };

const texto = (description: string) => ({ type: 'string', description });
const data = (description: string) => ({ type: 'string', description: `${description} Formato AAAA-MM-DD.` });
const id = (description: string) => ({ type: 'string', description: `${description} (id retornado por uma consulta, nunca inventado)` });
const esquema = (properties: Esquema['properties'], required: string[] = []): Esquema => ({ type: 'object', properties, required, additionalProperties: false });

export const FERRAMENTAS: Ferramenta[] = [
  // ---------------- Consultas ----------------
  {
    nome: 'buscar_obras', grava: false,
    descricao: 'Lista as obras (código, nome, cliente, situação, datas). Use para achar o id da obra que a pessoa citou pelo nome, bairro, cliente ou código.',
    parametros: esquema({ texto: texto('Parte do nome, código, endereço ou cliente. Vazio lista as ativas.'), incluir_encerradas: { type: 'boolean', description: 'Incluir concluídas, encerradas e canceladas.' } }),
  },
  {
    nome: 'detalhes_obra', grava: false,
    descricao: 'Resumo completo de uma obra: dados, avanço físico por serviço, etapas do cronograma, pendências abertas, últimos registros do diário e, se a pessoa tiver acesso, o financeiro (contratado, recebido, custos, saldo).',
    parametros: esquema({ obra_id: id('Obra') }, ['obra_id']),
  },
  {
    nome: 'pendencias_gerais', grava: false,
    descricao: 'Central de pendências do sistema: propostas sem resposta, pagamentos e recebimentos vencendo, materiais atrasados, decisões do cliente, medições etc., da mais urgente para a menos.',
    parametros: esquema({}),
  },
  {
    nome: 'contas_em_aberto', grava: false,
    descricao: 'Parcelas a pagar ou a receber ainda não quitadas (inclui vencidas), ordenadas por vencimento.',
    parametros: esquema({
      tipo: { type: 'string', enum: ['pagar', 'receber', 'todas'], description: 'Filtro.' },
      ate: data('Vencimento até esta data (opcional).'),
      obra_id: id('Só desta obra (opcional)'),
    }),
  },
  {
    nome: 'indicadores_financeiros', grava: false,
    descricao: 'Números do painel financeiro num período: vendido, recebido, pago em obras, despesas da empresa, a receber, a pagar, saldo das contas.',
    parametros: esquema({ inicio: data('Início do período.'), fim: data('Fim do período.') }, ['inicio', 'fim']),
  },
  {
    nome: 'opcoes_financeiro', grava: false,
    descricao: 'Categorias de contas a pagar e a receber e contas bancárias. Use antes de lançar uma despesa ou receita para escolher a categoria e a conta certas.',
    parametros: esquema({}),
  },
  {
    nome: 'buscar_pessoas', grava: false,
    descricao: 'Procura clientes, fornecedores, parceiros e prestadores pelo nome, telefone ou documento.',
    parametros: esquema({ texto: texto('Nome, telefone ou documento.') }, ['texto']),
  },
  {
    nome: 'buscar_leads', grava: false,
    descricao: 'Oportunidades comerciais (leads) em andamento no funil, com estado e próxima ação.',
    parametros: esquema({ texto: texto('Parte do título ou nome do contato (opcional).') }),
  },

  // ---------------- Gravações (sempre com confirmação) ----------------
  {
    nome: 'lancar_conta', grava: true,
    descricao: 'Prepara um lançamento financeiro (despesa a pagar ou receita a receber), da obra ou da empresa. Se a pessoa disse que já pagou ou já recebeu, marque quitado=true e informe a conta bancária. Não grava: a pessoa confirma depois.',
    parametros: esquema({
      tipo: { type: 'string', enum: ['pagar', 'receber'], description: 'pagar = despesa; receber = receita.' },
      descricao: texto('Descrição curta, ex.: "Cimento CP-II 20 sacos".'),
      valor: { type: 'number', description: 'Valor total em reais, ex.: 850.5' },
      categoria_id: id('Categoria do mesmo tipo, de opcoes_financeiro'),
      obra_id: id('Obra (vazio = despesa ou receita da empresa)'),
      pessoa_id: id('Fornecedor, parceiro ou cliente (opcional)'),
      data_competencia: data('Data do fato (compra, serviço). Padrão: hoje.'),
      vencimento: data('Vencimento. Padrão: a data da competência.'),
      quitado: { type: 'boolean', description: 'true se já foi pago ou recebido.' },
      conta_bancaria_id: id('Conta bancária usada no pagamento ou recebimento (obrigatória se quitado)'),
      documento_ref: texto('Número de nota, recibo ou pedido (opcional).'),
    }, ['tipo', 'descricao', 'valor', 'categoria_id']),
  },
  {
    nome: 'registrar_diario', grava: true,
    descricao: 'Prepara um registro no diário da obra (andamento, impedimento, inspeção, decisão ou nota interna). Não grava: a pessoa confirma depois.',
    parametros: esquema({
      obra_id: id('Obra'),
      tipo: { type: 'string', enum: ['andamento', 'impedimento', 'inspecao', 'decisao', 'nota_interna'], description: 'Tipo do registro.' },
      titulo: texto('Título curto.'),
      texto: texto('O que aconteceu, com detalhes.'),
      data: data('Data do registro. Padrão: hoje.'),
    }, ['obra_id', 'tipo', 'titulo']),
  },
  {
    nome: 'criar_pendencia', grava: true,
    descricao: 'Prepara uma pendência na obra (algo a resolver, decisão do cliente, impedimento). Não grava: a pessoa confirma depois.',
    parametros: esquema({
      obra_id: id('Obra'),
      titulo: texto('O que precisa ser feito.'),
      descricao: texto('Detalhes (opcional).'),
      tipo: { type: 'string', enum: ['pendencia', 'decisao_cliente', 'impedimento', 'inspecao'] },
      prioridade: { type: 'string', enum: ['alta', 'media', 'baixa'] },
      responsavel: { type: 'string', enum: ['rosae', 'cliente', 'parceiro', 'outro'] },
      prazo: data('Prazo (opcional).'),
    }, ['obra_id', 'titulo']),
  },
  {
    nome: 'resolver_pendencia', grava: true,
    descricao: 'Prepara a baixa de uma pendência aberta da obra, com o que foi feito. Não grava: a pessoa confirma depois.',
    parametros: esquema({ pendencia_id: id('Pendência (de detalhes_obra)'), resolucao: texto('Como foi resolvida.') }, ['pendencia_id', 'resolucao']),
  },
  {
    nome: 'atualizar_etapa', grava: true,
    descricao: 'Prepara a atualização do andamento de uma etapa do cronograma (percentual executado e/ou situação). Não grava: a pessoa confirma depois.',
    parametros: esquema({
      etapa_id: id('Etapa (de detalhes_obra)'),
      percentual: { type: 'number', description: 'Percentual executado, de 0 a 100.' },
      estado: { type: 'string', enum: ['nao_iniciado', 'programado', 'em_execucao', 'aguardando_material', 'aguardando_liberacao', 'suspenso', 'executado'] },
      observacao: texto('Motivo ou observação (fica no histórico).'),
    }, ['etapa_id']),
  },
  {
    nome: 'novo_lead', grava: true,
    descricao: 'Prepara um novo contato comercial no funil (pessoa interessada em um serviço). Procure antes com buscar_pessoas para não duplicar. Não grava: a pessoa confirma depois.',
    parametros: esquema({
      nome: texto('Nome do contato.'),
      telefone: texto('Telefone (opcional).'),
      email: texto('E-mail (opcional).'),
      pessoa_id: id('Pessoa já cadastrada (opcional; se vier, nome/telefone são ignorados)'),
      titulo: texto('Resumo do pedido, ex.: "Reforço de laje - Barra".'),
      tipo_servico: texto('Tipo de serviço (opcional).'),
      local_obra: texto('Local (opcional).'),
      resumo: texto('O que o cliente pediu (opcional).'),
      origem: { type: 'string', enum: ['indicacao', 'site', 'instagram', 'whatsapp', 'telefone', 'outro'] },
      indicado_por: texto('Quem indicou (opcional).'),
    }, ['titulo']),
  },
  {
    nome: 'salvar_foto', grava: true,
    descricao: 'Prepara salvar na obra a foto que a pessoa enviou nesta mensagem, com legenda e momento (antes, durante, depois). Só use quando houver foto anexada. Não grava: a pessoa confirma depois.',
    parametros: esquema({
      obra_id: id('Obra'),
      legenda: texto('Legenda da foto.'),
      momento: { type: 'string', enum: ['antes', 'durante', 'depois', 'outro'] },
    }, ['obra_id']),
  },
];

export const FERRAMENTAS_QUE_GRAVAM = new Set(FERRAMENTAS.filter((f) => f.grava).map((f) => f.nome));
