// Funil completo, do primeiro contato à obra entregue, numa visão só.
// Junta oportunidade, proposta (com versões e aberturas do link), obra e contrato
// e diz em que fase cada negócio está e qual é o único próximo passo.

export type FaseFunil = 'contato' | 'orcamento' | 'enviada' | 'aceita' | 'contrato' | 'obra' | 'entregue' | 'perdido';

export const FASES: { id: FaseFunil; nome: string; dica: string }[] = [
  { id: 'contato', nome: 'Contato', dica: 'Pediu orçamento e ainda não tem proposta.' },
  { id: 'orcamento', nome: 'Orçamento', dica: 'Proposta em preparação, ainda não enviada.' },
  { id: 'enviada', nome: 'Enviada', dica: 'Com o cliente, aguardando o aceite.' },
  { id: 'aceita', nome: 'Aceita', dica: 'Cliente aceitou: falta gerar o contrato.' },
  { id: 'contrato', nome: 'Contrato', dica: 'Contrato emitido, aguardando a assinatura.' },
  { id: 'obra', nome: 'Em execução', dica: 'Contrato assinado e serviço em andamento.' },
  { id: 'entregue', nome: 'Entregue', dica: 'Serviço concluído.' },
];
export const FASES_ATIVAS: FaseFunil[] = ['contato', 'orcamento', 'enviada', 'aceita', 'contrato', 'obra'];
export const NOME_FASE: Record<FaseFunil, string> = { ...Object.fromEntries(FASES.map((f) => [f.id, f.nome])), perdido: 'Perdido' } as Record<FaseFunil, string>;

export type OpFunil = {
  id: string; codigo: string; titulo: string; pessoa_id: string; pessoa_nome: string | null; telefone: string | null;
  tipo_servico: string | null; estado_tipo: 'aberto' | 'ganho' | 'perdido' | 'arquivado'; estado_nome: string;
  estado_desde: string; proxima_acao: string | null; proxima_acao_data: string | null; valor_estimado: number | null; criado_em: string;
};
export type PropostaFunil = {
  id: string; codigo: string; titulo: string; tipo: 'proposta' | 'aditivo'; oportunidade_id: string | null; pessoa_id: string; pessoa_nome: string | null; telefone: string | null;
  estado: 'rascunho' | 'enviada' | 'em_negociacao' | 'aprovada' | 'recusada' | 'arquivada';
  valor: number; validade: string | null; emitida: boolean; versao_aprovada_id: string | null; aprovada_em: string | null;
  atualizado_em: string; criado_em: string; vistas: number; ultima_vista: string | null; obra_id?: string | null;
};
export type ObraFunil = {
  id: string; codigo: string; nome: string; status: string; proposta_versao_id: string | null; data_previsao_fim: string | null; criado_em: string;
};
export type ContratoFunil = { id: string; obra_id: string; estado: 'rascunho' | 'emitido' | 'assinado' | 'cancelado'; emitido_em: string | null; assinado_em: string | null; criado_em: string };

export type Alerta = { texto: string; nivel: 'atencao' | 'bom' };
export type Passo = { rotulo: string; para: string; acao?: 'converter' | 'whatsapp' };

export type Negocio = {
  chave: string; fase: FaseFunil; cliente: string; titulo: string; codigo: string; servico: string | null;
  valor: number; desde: string; dias: number; telefone: string | null;
  abrir: string; passo: Passo | null; alertas: Alerta[]; atrasado: boolean; quente: boolean;
  oportunidadeId: string | null; propostaId: string | null; versaoAprovadaId: string | null; obraId: string | null; aditivos: number;
  /** Quando o cliente aceitou (para o fechado no mês). */
  aceitoEm: string | null;
};

const DIA = 86_400_000;
function dias(desde: string, hoje: string): number {
  const a = Date.parse(desde.length <= 10 ? `${desde}T12:00:00Z` : desde);
  const b = Date.parse(`${hoje}T12:00:00Z`);
  return Number.isFinite(a) ? Math.max(0, Math.floor((b - a) / DIA)) : 0;
}

const ORDEM_PROPOSTA: Record<PropostaFunil['estado'], number> = { aprovada: 5, em_negociacao: 4, enviada: 3, rascunho: 2, recusada: 1, arquivada: 0 };

/** A proposta que representa o negócio: a mais avançada; empate, a mais recente. */
export function propostaPrincipal(ps: PropostaFunil[]): PropostaFunil | null {
  const validas = ps.filter((p) => p.tipo === 'proposta' && p.estado !== 'arquivada');
  if (!validas.length) return null;
  return [...validas].sort((a, b) => ORDEM_PROPOSTA[b.estado] - ORDEM_PROPOSTA[a.estado] || b.atualizado_em.localeCompare(a.atualizado_em))[0];
}

/** Monta um negócio por oportunidade (ou por proposta solta) e diz a fase e o próximo passo. */
export function montarFunil(
  d: { ops: OpFunil[]; propostas: PropostaFunil[]; obras: ObraFunil[]; contratos: ContratoFunil[]; versaoDaProposta: Map<string, string[]> },
  hoje: string,
): Negocio[] {
  const porOp = new Map<string, PropostaFunil[]>();
  const soltas: PropostaFunil[] = [];
  const aditivos = new Map<string, number>();
  for (const p of d.propostas) {
    if (p.tipo === 'aditivo') {
      if (p.estado !== 'arquivada' && p.estado !== 'recusada') {
        // Aditivo conta no negócio da proposta de origem, pela obra.
        if (p.obra_id) aditivos.set(p.obra_id, (aditivos.get(p.obra_id) ?? 0) + 1);
      }
      continue;
    }
    if (p.oportunidade_id) porOp.set(p.oportunidade_id, [...(porOp.get(p.oportunidade_id) ?? []), p]);
    else soltas.push(p);
  }
  // Obra ligada à versão aprovada; contrato ativo (não cancelado) da obra.
  const obraPorVersao = new Map(d.obras.filter((o) => o.proposta_versao_id).map((o) => [o.proposta_versao_id!, o]));
  const contratoPorObra = new Map<string, ContratoFunil>();
  for (const c of d.contratos) if (c.estado !== 'cancelado') contratoPorObra.set(c.obra_id, c);

  const obraDaProposta = (p: PropostaFunil | null): ObraFunil | null => {
    if (!p) return null;
    if (p.versao_aprovada_id && obraPorVersao.has(p.versao_aprovada_id)) return obraPorVersao.get(p.versao_aprovada_id)!;
    for (const v of d.versaoDaProposta.get(p.id) ?? []) if (obraPorVersao.has(v)) return obraPorVersao.get(v)!;
    return null;
  };

  const negocios: Negocio[] = [];
  const montar = (op: OpFunil | null, p: PropostaFunil | null) => {
    const obra = obraDaProposta(p);
    const contrato = obra ? contratoPorObra.get(obra.id) ?? null : null;
    let fase: FaseFunil;
    let desde: string;
    if (obra && (obra.status === 'concluida_fisicamente' || obra.status === 'encerrada_financeiramente')) { fase = 'entregue'; desde = obra.criado_em; }
    else if (obra && obra.status === 'cancelada') { fase = 'perdido'; desde = obra.criado_em; }
    else if (contrato?.estado === 'assinado' || obra?.status === 'em_execucao') { fase = 'obra'; desde = contrato?.assinado_em ?? obra!.criado_em; }
    else if (contrato?.estado === 'emitido') { fase = 'contrato'; desde = contrato.emitido_em ?? contrato.criado_em; }
    else if (p?.estado === 'aprovada') { fase = 'aceita'; desde = p.aprovada_em ?? p.atualizado_em; }
    else if (op && (op.estado_tipo === 'perdido' || op.estado_tipo === 'arquivado')) { fase = 'perdido'; desde = op.estado_desde; }
    else if (p && (p.estado === 'enviada' || p.estado === 'em_negociacao')) { fase = 'enviada'; desde = p.atualizado_em; }
    else if (p?.estado === 'recusada') { fase = 'perdido'; desde = p.atualizado_em; }
    else if (p) { fase = 'orcamento'; desde = p.criado_em; }
    else if (op?.estado_tipo === 'ganho') { fase = 'aceita'; desde = op.estado_desde; }
    else { fase = 'contato'; desde = op?.estado_desde ?? hoje; }

    const cliente = p?.pessoa_nome ?? op?.pessoa_nome ?? 'Cliente';
    const telefone = p?.telefone ?? op?.telefone ?? null;
    const valor = p ? p.valor : op?.valor_estimado ?? 0;
    const abrir = op ? `/comercial/${op.id}` : `/propostas/${p!.id}`;
    const alertas: Alerta[] = [];
    const atrasado = !!(op?.proxima_acao_data && op.proxima_acao_data < hoje && (fase === 'contato' || fase === 'orcamento' || fase === 'enviada'));
    if (atrasado) alertas.push({ texto: `Atrasado: ${op!.proxima_acao ?? 'próxima ação'}`, nivel: 'atencao' });
    const quente = fase === 'enviada' && (p?.vistas ?? 0) >= 3;
    if (fase === 'enviada' && p) {
      if (p.vistas === 0) alertas.push({ texto: 'Ainda não abriu o link', nivel: 'atencao' });
      else alertas.push({ texto: `Abriu ${p.vistas}×${quente ? ' · quente' : ''}`, nivel: quente ? 'bom' : 'atencao' });
      if (p.validade) {
        const resta = Math.round((Date.parse(`${p.validade}T12:00:00Z`) - Date.parse(`${hoje}T12:00:00Z`)) / DIA);
        if (resta < 0) alertas.push({ texto: 'Validade vencida', nivel: 'atencao' });
        else if (resta <= 3) alertas.push({ texto: resta === 0 ? 'Vence hoje' : `Vence em ${resta} d`, nivel: 'atencao' });
      }
    }
    const n = dias(desde, hoje);
    if ((fase === 'aceita' || fase === 'contrato') && n >= 3) alertas.push({ texto: `Parado há ${n} dias`, nivel: 'atencao' });

    let passo: Passo | null = null;
    switch (fase) {
      case 'contato': passo = { rotulo: 'Fazer orçamento', para: op ? `/orcamento?oportunidade=${op.id}` : '/orcamento' }; break;
      case 'orcamento': passo = { rotulo: 'Terminar e enviar', para: `/propostas/${p!.id}` }; break;
      case 'enviada': passo = telefone ? { rotulo: 'Cobrar retorno', para: `/propostas/${p!.id}`, acao: 'whatsapp' } : { rotulo: 'Ver proposta', para: `/propostas/${p!.id}` }; break;
      case 'aceita': passo = obra ? { rotulo: 'Gerar contrato', para: `/obras/${obra.id}?aba=contrato` } : p?.versao_aprovada_id ? { rotulo: 'Gerar contrato', para: `/propostas/${p.id}`, acao: 'converter' } : p ? { rotulo: 'Ver proposta', para: `/propostas/${p.id}` } : null; break;
      case 'contrato': passo = { rotulo: 'Acompanhar assinatura', para: `/obras/${obra!.id}?aba=contrato` }; break;
      case 'obra': passo = { rotulo: 'Abrir obra', para: `/obras/${obra!.id}` }; break;
      case 'entregue': passo = obra ? { rotulo: 'Abrir obra', para: `/obras/${obra.id}` } : null; break;
      default: passo = null;
    }

    negocios.push({
      chave: op?.id ?? p!.id, fase, cliente, titulo: p?.titulo ?? op?.titulo ?? '', codigo: p?.codigo ?? op?.codigo ?? '',
      servico: op?.tipo_servico ?? null, valor, desde, dias: n, telefone, abrir, passo, alertas, atrasado, quente,
      oportunidadeId: op?.id ?? null, propostaId: p?.id ?? null, versaoAprovadaId: p?.versao_aprovada_id ?? null, obraId: obra?.id ?? null,
      aditivos: obra ? aditivos.get(obra.id) ?? 0 : 0,
      aceitoEm: p?.estado === 'aprovada' ? p.aprovada_em ?? p.atualizado_em : null,
    });
  };
  for (const op of d.ops) montar(op, propostaPrincipal(porOp.get(op.id) ?? []));
  for (const p of soltas) if (p.estado !== 'arquivada') montar(null, p);
  return negocios;
}

/** Prioridade dentro da coluna: atrasado e quente primeiro, depois o parado há mais tempo. */
export function ordenar(ns: Negocio[]): Negocio[] {
  const peso = (n: Negocio) => (n.atrasado ? 0 : n.quente ? 1 : n.alertas.length ? 2 : 3);
  return [...ns].sort((a, b) => peso(a) - peso(b) || b.dias - a.dias || a.cliente.localeCompare(b.cliente));
}

export type ResumoFunil = {
  porFase: Record<FaseFunil, { qtd: number; valor: number }>;
  emAberto: number; aguardandoCliente: number; fechadoMes: number; qtdFechadoMes: number; conversao: number | null; precisamAcao: number;
};

/** Números de cima: quanto está em jogo, quanto fechou no mês e a taxa de conversão (90 dias). */
export function resumir(ns: Negocio[], hoje: string): ResumoFunil {
  const porFase = Object.fromEntries([...FASES.map((f) => f.id), 'perdido'].map((f) => [f, { qtd: 0, valor: 0 }])) as ResumoFunil['porFase'];
  for (const n of ns) { porFase[n.fase].qtd += 1; porFase[n.fase].valor += n.valor; }
  const mes = hoje.slice(0, 7);
  let fechadoMes = 0, qtdFechadoMes = 0;
  for (const n of ns) {
    const em = n.aceitoEm;
    if (em && em.slice(0, 7) === mes) { fechadoMes += n.valor; qtdFechadoMes += 1; }
  }
  const limite = Date.parse(`${hoje}T12:00:00Z`) - 90 * DIA;
  const recentes = ns.filter((n) => Date.parse(n.desde.length <= 10 ? `${n.desde}T12:00:00Z` : n.desde) >= limite);
  const ganhos = recentes.filter((n) => ['aceita', 'contrato', 'obra', 'entregue'].includes(n.fase)).length;
  const perdidos = recentes.filter((n) => n.fase === 'perdido').length;
  return {
    porFase,
    emAberto: porFase.contato.valor + porFase.orcamento.valor + porFase.enviada.valor,
    aguardandoCliente: porFase.enviada.valor,
    fechadoMes, qtdFechadoMes,
    conversao: ganhos + perdidos > 0 ? ganhos / (ganhos + perdidos) : null,
    precisamAcao: ns.filter((n) => n.atrasado || ((n.fase === 'aceita' || n.fase === 'contrato') && n.dias >= 3)).length,
  };
}
