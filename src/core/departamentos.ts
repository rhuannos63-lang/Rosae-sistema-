// Organização do sistema em departamentos, como numa empresa: cada um tem a sua
// pasta com subpastas, e eles se ligam (proposta vira obra, medição vira cobrança).

export type Acesso = 'todos' | 'comercial' | 'financeiro' | 'admin';
export type Subpasta = { para: string; rotulo: string; icone: string; descricao: string; acesso?: Acesso };
export type Ligacao = { com: IdDepartamento; texto: string };
export type IdDepartamento = 'comercial' | 'obras' | 'financeiro' | 'empresa';
export type Departamento = {
  id: IdDepartamento; nome: string; curto: string; icone: string; resumo: string; acesso: Acesso;
  subpastas: Subpasta[]; ligacoes: Ligacao[];
  /** Tipos da central de pendências que pertencem a este departamento. */
  pendencias: string[];
};

export const DEPARTAMENTOS: Departamento[] = [
  {
    id: 'comercial', nome: 'Comercial e Orçamentos', curto: 'Comercial', icone: 'comercial', acesso: 'comercial',
    resumo: 'Do primeiro contato à proposta aprovada: funil, orçamento automático, propostas e preços.',
    subpastas: [
      { para: '/comercial', rotulo: 'Funil de clientes', icone: 'comercial', descricao: 'Contatos, oportunidades e próximas ações.' },
      { para: '/orcamento', rotulo: 'Novo orçamento', icone: 'varinha', descricao: 'Orçamento automático por tipo de serviço, em 3 pacotes.' },
      { para: '/propostas', rotulo: 'Propostas', icone: 'documento', descricao: 'Editar, emitir, enviar o link e acompanhar o aceite.' },
      { para: '/orcamento/precos', rotulo: 'Tabela de preços', icone: 'tabela', descricao: 'Valores de referência que o orçamento usa.' },
      { para: '/biblioteca', rotulo: 'Biblioteca de serviços', icone: 'lista', descricao: 'Serviços prontos com escopo, inclusões e exclusões.' },
      { para: '/clausulas', rotulo: 'Cláusulas de contrato', icone: 'livro', descricao: 'Modelos de cláusulas usados nos contratos.' },
    ],
    ligacoes: [
      { com: 'obras', texto: 'Proposta aprovada vira obra, com serviços e etapas.' },
      { com: 'financeiro', texto: 'Condições de pagamento viram parcelas a receber.' },
    ],
    pendencias: ['proposta', 'comercial'],
  },
  {
    id: 'obras', nome: 'Gestão de Obras', curto: 'Obras', icone: 'obras', acesso: 'todos',
    resumo: 'Execução e acompanhamento: obras, cronograma, medições, contratos, agenda e pendências.',
    subpastas: [
      { para: '/obras', rotulo: 'Obras', icone: 'obras', descricao: 'Cronograma, materiais, diário, medições, contrato e portal de cada obra.' },
      { para: '/agenda', rotulo: 'Agenda', icone: 'calendario', descricao: 'Visitas, prazos de etapas e vencimentos no calendário.' },
      { para: '/pendencias', rotulo: 'Central de pendências', icone: 'alerta', descricao: 'Tudo que precisa de ação, de todos os departamentos.' },
    ],
    ligacoes: [
      { com: 'financeiro', texto: 'Medição aprovada gera a cobrança; custos ficam ligados à obra.' },
      { com: 'comercial', texto: 'Serviço a mais vira aditivo, com proposta e aceite do cliente.' },
    ],
    pendencias: ['obra', 'material', 'pendencia', 'decisao', 'portal', 'medicao', 'documento'],
  },
  {
    id: 'financeiro', nome: 'Financeiro', curto: 'Financeiro', icone: 'financeiro', acesso: 'financeiro',
    resumo: 'Dinheiro da empresa e de cada obra: contas a pagar e a receber, bancos, notas e planejamento.',
    subpastas: [
      { para: '/financeiro', rotulo: 'Pagar e receber', icone: 'financeiro', descricao: 'Lançamentos, parcelas, baixas e situação de cada conta.' },
      { para: '/contas', rotulo: 'Contas bancárias', icone: 'contas', descricao: 'Saldos, extrato e transferências entre contas.' },
      { para: '/notas', rotulo: 'Notas fiscais', icone: 'documento', descricao: 'Importar XML de NF-e e transformar em contas a pagar.' },
      { para: '/planejador', rotulo: 'Planejador', icone: 'planejador', descricao: 'Metas, previsão de caixa e retiradas.' },
    ],
    ligacoes: [
      { com: 'obras', texto: 'Cada lançamento pode ser de uma obra e de um serviço.' },
      { com: 'comercial', texto: 'O que foi vendido no mês aparece ao lado do que entrou.' },
    ],
    pendencias: ['pagamento', 'recebimento', 'nota'],
  },
  {
    id: 'empresa', nome: 'Empresa e Sistema', curto: 'Empresa', icone: 'pasta', acesso: 'todos',
    resumo: 'Cadastros usados por todos os departamentos, dados da ROSAE, aparência e ajuda.',
    subpastas: [
      { para: '/assistente', rotulo: 'Assistente IA', icone: 'varinha', descricao: 'Converse para consultar e lançar dados, aqui ou pelo WhatsApp.' },
      { para: '/pessoas', rotulo: 'Cadastros', icone: 'pessoas', descricao: 'Clientes, parceiros, prestadores e fornecedores.' },
      { para: '/configuracoes', rotulo: 'Configurações', icone: 'config', descricao: 'Dados da ROSAE, usuários e permissões.', acesso: 'admin' },
      { para: '/lixeira', rotulo: 'Lixeira', icone: 'lixeira', descricao: 'O que foi excluído, para restaurar com um toque.', acesso: 'admin' },
      { para: '/aparencia', rotulo: 'Aparência', icone: 'paleta', descricao: 'Cores, menu, modo escuro e tamanho do texto.' },
      { para: '/manual', rotulo: 'Manual', icone: 'livro', descricao: 'Passo a passo de cada parte do sistema.' },
      { para: '/ajuda', rotulo: 'Ajuda rápida', icone: 'ajuda', descricao: 'Respostas curtas por tarefa.' },
    ],
    ligacoes: [
      { com: 'comercial', texto: 'O cadastro do cliente vai para a proposta e o contrato.' },
      { com: 'obras', texto: 'Parceiros e prestadores entram nas obras e nos custos.' },
    ],
    pendencias: [],
  },
];

export type Permissoes = { comercial: boolean; financeiro: boolean; admin: boolean };
export function pode(a: Acesso | undefined, p: Permissoes) {
  return !a || a === 'todos' || (a === 'comercial' && p.comercial) || (a === 'financeiro' && p.financeiro) || (a === 'admin' && p.admin);
}

/** Departamentos e subpastas que esta pessoa pode abrir. */
export function departamentosVisiveis(p: Permissoes): Departamento[] {
  return DEPARTAMENTOS.filter((d) => pode(d.acesso, p))
    .map((d) => ({ ...d, subpastas: d.subpastas.filter((s) => pode(s.acesso, p)) }))
    .filter((d) => d.subpastas.length > 0);
}

/** Em qual departamento e subpasta está uma rota (a subpasta de caminho mais longo que casar). */
export function localizar(caminho: string, deps: Departamento[] = DEPARTAMENTOS): { dep: Departamento; sub: Subpasta | null } | null {
  const m = /^\/d\/([a-z]+)/.exec(caminho);
  if (m) { const dep = deps.find((d) => d.id === m[1]); return dep ? { dep, sub: null } : null; }
  let melhor: { dep: Departamento; sub: Subpasta } | null = null;
  for (const dep of deps) {
    for (const sub of dep.subpastas) {
      if ((caminho === sub.para || caminho.startsWith(sub.para + '/')) && (!melhor || sub.para.length > melhor.sub.para.length)) melhor = { dep, sub };
    }
  }
  // Rotas internas que não são subpastas próprias, mas pertencem a um departamento.
  if (!melhor && /^\/contratos\//.test(caminho)) { const dep = deps.find((d) => d.id === 'obras'); if (dep) return { dep, sub: dep.subpastas[0] }; }
  return melhor;
}

export const DEPARTAMENTO_POR_ID = Object.fromEntries(DEPARTAMENTOS.map((d) => [d.id, d])) as Record<IdDepartamento, Departamento>;
