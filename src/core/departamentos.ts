// Organização do sistema em departamentos, como numa empresa: cada um tem a sua
// pasta com subpastas, e eles se ligam (proposta vira obra, medição vira cobrança).

export type Acesso = 'todos' | 'comercial' | 'financeiro' | 'admin';
export type Aba = { para: string; rotulo: string; acesso?: Acesso };
/** Subpasta do menu. Com `abas`, junta várias telas parecidas numa entrada só, com abas no topo. */
export type Subpasta = { para: string; rotulo: string; icone: string; descricao: string; acesso?: Acesso; abas?: Aba[] };
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
      { para: '/comercial', rotulo: 'Funil', icone: 'comercial', descricao: 'Todos os negócios do contato à obra, com o próximo passo de cada um.' },
      { para: '/orcamento', rotulo: 'Novo orçamento', icone: 'varinha', descricao: 'Orçamento automático por tipo de serviço, em 3 pacotes.' },
      { para: '/propostas', rotulo: 'Propostas', icone: 'documento', descricao: 'Editar, emitir, enviar o link e acompanhar o aceite.' },
      {
        para: '/orcamento/precos', rotulo: 'Preços e modelos', icone: 'tabela', descricao: 'Tabela de preços, insumos, biblioteca de serviços e cláusulas de contrato.',
        abas: [
          { para: '/orcamento/precos', rotulo: 'Tabela de preços' },
          { para: '/orcamento/composicoes', rotulo: 'Insumos e composições', acesso: 'financeiro' },
          { para: '/biblioteca', rotulo: 'Biblioteca de serviços' },
          { para: '/clausulas', rotulo: 'Cláusulas de contrato' },
        ],
      },
    ],
    ligacoes: [
      { com: 'obras', texto: 'Proposta aprovada vira obra, com serviços e etapas.' },
      { com: 'financeiro', texto: 'Orçamento aceito aparece como fechado; o recebido você registra quando entrar.' },
    ],
    pendencias: ['proposta', 'comercial'],
  },
  {
    id: 'obras', nome: 'Gestão de Obras', curto: 'Obras', icone: 'obras', acesso: 'todos',
    resumo: 'Execução e acompanhamento: obras, cronograma, medições, contratos, agenda e pendências.',
    subpastas: [
      { para: '/obras', rotulo: 'Obras', icone: 'obras', descricao: 'Cronograma, materiais, diário, medições, contrato e portal de cada obra.' },
      { para: '/agenda', rotulo: 'Agenda', icone: 'calendario', descricao: 'Calendário do dia a dia: tarefas, etapas, propostas aceitas e vencimentos, com avisos.' },
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
      { para: '/recebimentos', rotulo: 'Contratos e recebimentos', icone: 'caixa', descricao: 'Quanto fechou em cada orçamento e quanto de fato entrou.' },
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
      {
        para: '/configuracoes', rotulo: 'Configurações', icone: 'config', descricao: 'Dados da ROSAE, usuários, segurança, aparência e lixeira.',
        abas: [
          { para: '/configuracoes', rotulo: 'Empresa e usuários', acesso: 'admin' },
          { para: '/aparencia', rotulo: 'Aparência' },
          { para: '/lixeira', rotulo: 'Lixeira', acesso: 'admin' },
        ],
      },
      {
        para: '/manual', rotulo: 'Ajuda', icone: 'ajuda', descricao: 'Manual passo a passo e respostas curtas por tarefa.',
        abas: [
          { para: '/manual', rotulo: 'Manual' },
          { para: '/ajuda', rotulo: 'Respostas rápidas' },
        ],
      },
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
    .map((d) => ({
      ...d,
      subpastas: d.subpastas.filter((s) => pode(s.acesso, p)).flatMap((s) => {
        if (!s.abas) return [s];
        const abas = s.abas.filter((a) => pode(a.acesso, p));
        return abas.length ? [{ ...s, para: abas[0].para, abas }] : [];
      }),
    }))
    .filter((d) => d.subpastas.length > 0);
}

/** Em qual departamento e subpasta está uma rota (a subpasta de caminho mais longo que casar). */
export function localizar(caminho: string, deps: Departamento[] = DEPARTAMENTOS): { dep: Departamento; sub: Subpasta | null } | null {
  const m = /^\/d\/([a-z]+)/.exec(caminho);
  if (m) { const dep = deps.find((d) => d.id === m[1]); return dep ? { dep, sub: null } : null; }
  let melhor: { dep: Departamento; sub: Subpasta; tam: number } | null = null;
  for (const dep of deps) {
    for (const sub of dep.subpastas) {
      for (const alvo of [sub.para, ...(sub.abas ?? []).map((a) => a.para)]) {
        if ((caminho === alvo || caminho.startsWith(alvo + '/')) && (!melhor || alvo.length > melhor.tam)) melhor = { dep, sub, tam: alvo.length };
      }
    }
  }
  // Rotas internas que não são subpastas próprias, mas pertencem a um departamento.
  if (!melhor && /^\/contratos\//.test(caminho)) { const dep = deps.find((d) => d.id === 'obras'); if (dep) return { dep, sub: dep.subpastas[0] }; }
  return melhor && { dep: melhor.dep, sub: melhor.sub };
}

/** A aba (dentro de uma subpasta com abas) que corresponde a esta rota. */
export function abaAtual(caminho: string, sub: Subpasta | null): Aba | null {
  if (!sub?.abas) return null;
  return [...sub.abas].sort((a, b) => b.para.length - a.para.length).find((a) => caminho === a.para || caminho.startsWith(a.para + '/')) ?? null;
}

export const DEPARTAMENTO_POR_ID = Object.fromEntries(DEPARTAMENTOS.map((d) => [d.id, d])) as Record<IdDepartamento, Departamento>;
