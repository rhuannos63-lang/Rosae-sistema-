// Agenda: busca no banco tudo o que tem data (tarefas, etapas, materiais, contas, propostas e
// comercial) e transforma em eventos do calendário. Também grava as mudanças feitas na agenda.
import { supabase } from './supabase';
import { ok } from './consulta';
import { doBanco } from '../core/dinheiro';
import { somarDias } from '../core/datas';
import { expandirTarefa, type Evento, type Tarefa } from '../core/agenda';

export const CAMPOS_TAREFA = 'id, titulo, notas, data, data_fim, hora, hora_fim, categoria, prioridade, repetir, repetir_ate, concluida, concluidas, lembrete_min, obra_id, proposta_id, origem, chave';

export type Permissoes = { financeiro: boolean; comercial: boolean };

const vazio = Promise.resolve({ data: [], error: null });

/** Eventos entre de e ate, mais tudo o que está atrasado (de qualquer data). */
export async function carregarEventos(de: string, ate: string, hoje: string, perm: Permissoes): Promise<{ eventos: Evento[]; tarefas: Tarefa[] }> {
  const [tf, et, etAtr, mt, pc, pcAtr, pr, op] = await Promise.all([
    perm.comercial
      ? supabase.from('tarefa').select(CAMPOS_TAREFA).lte('data', ate).or(`repetir.neq.nao,concluida.eq.false,data.gte.${de},data_fim.gte.${de}`).order('data').limit(1000)
      : vazio,
    supabase.from('etapa').select('id, nome, estado, inicio_previsto, fim_previsto, obra_id, obra:obra(nome, codigo, status)')
      .neq('estado', 'cancelado').gte('fim_previsto', de).lte('inicio_previsto', ate).limit(600),
    supabase.from('etapa').select('id, nome, estado, inicio_previsto, fim_previsto, obra_id, obra:obra(nome, codigo, status)')
      .not('estado', 'in', '(executado,conferido,cancelado)').lt('fim_previsto', hoje).limit(200),
    supabase.from('v_material').select('id, descricao, necessario_em, situacao, obra_id').eq('estado', 'ativo').lte('necessario_em', ate)
      .not('situacao', 'in', '(na_obra,cancelado,substituido)').limit(300),
    perm.financeiro
      ? supabase.from('v_parcela').select('id, lancamento_id, tipo, descricao, saldo, valor, vencimento, situacao, pessoa_nome, obra_nome').neq('situacao', 'cancelada').gte('vencimento', de).lte('vencimento', ate).limit(600)
      : vazio,
    perm.financeiro
      ? supabase.from('v_parcela').select('id, lancamento_id, tipo, descricao, saldo, valor, vencimento, situacao, pessoa_nome, obra_nome').eq('situacao', 'vencida').limit(200)
      : vazio,
    perm.comercial
      ? supabase.from('proposta').select('id, codigo, titulo, estado, pessoa:pessoa(nome), versoes:proposta_versao!proposta_versao_proposta_id_fkey(numero, emitida, validade)').in('estado', ['enviada', 'em_negociacao'])
      : vazio,
    perm.comercial
      ? supabase.from('oportunidade').select('id, titulo, proxima_acao, proxima_acao_data').eq('arquivado', false).not('proxima_acao_data', 'is', null).lte('proxima_acao_data', ate)
      : vazio,
  ]);
  const ev: Evento[] = [];
  const tarefas = ok(tf) as unknown as Tarefa[];
  for (const t of tarefas) ev.push(...expandirTarefa({ ...t, concluidas: t.concluidas ?? [] }, de, ate, hoje));

  type Et = { id: string; nome: string; estado: string; inicio_previsto: string | null; fim_previsto: string | null; obra_id: string; obra: { nome: string; codigo: string; status: string } | null };
  const etapas = new Map<string, Et>();
  for (const e of [...(ok(et) as unknown as Et[]), ...(ok(etAtr) as unknown as Et[])]) etapas.set(e.id, e);
  for (const e of etapas.values()) {
    if (!e.fim_previsto || e.obra?.status === 'cancelada') continue;
    const feito = ['executado', 'conferido'].includes(e.estado);
    ev.push({
      id: `etapa:${e.id}`, fonte: 'etapa', ref: e.id, titulo: e.nome, det: e.obra ? `${e.obra.codigo} · ${e.obra.nome}` : 'Obra',
      inicio: e.inicio_previsto ?? e.fim_previsto, fim: e.fim_previsto, cor: 'etapa', feito, atrasado: !feito && e.fim_previsto < hoje,
      link: `/obras/${e.obra_id}?aba=cronograma`, movivel: !feito,
    });
  }
  for (const m of ok(mt) as { id: string; descricao: string; necessario_em: string; situacao: string; obra_id: string }[]) {
    if (m.necessario_em < de && m.necessario_em >= hoje) continue;
    ev.push({
      id: `material:${m.id}`, fonte: 'material', ref: m.id, titulo: m.descricao, det: m.situacao.replace(/_/g, ' '), inicio: m.necessario_em, fim: m.necessario_em,
      cor: 'material', feito: false, atrasado: m.necessario_em < hoje, link: `/obras/${m.obra_id}?aba=materiais`, movivel: false,
    });
  }
  type Pc = { id: string; lancamento_id: string; tipo: 'pagar' | 'receber'; descricao: string; saldo: string; valor: string; vencimento: string; situacao: string; pessoa_nome: string | null; obra_nome: string | null };
  const parcelas = new Map<string, Pc>();
  for (const p of [...(ok(pc) as Pc[]), ...(ok(pcAtr) as Pc[])]) parcelas.set(p.id, p);
  for (const p of parcelas.values()) {
    const feito = p.situacao === 'liquidada';
    ev.push({
      id: `${p.tipo}:${p.id}`, fonte: p.tipo, ref: p.id, titulo: p.descricao, det: [p.pessoa_nome, p.obra_nome].filter(Boolean).join(' · '),
      inicio: p.vencimento, fim: p.vencimento, cor: p.tipo, feito, atrasado: p.situacao === 'vencida', valor: doBanco(feito ? p.valor : p.saldo),
      link: `/financeiro/${p.lancamento_id}`, movivel: !feito,
    });
  }
  for (const p of ok(pr) as unknown as { id: string; codigo: string; titulo: string; pessoa: { nome: string } | null; versoes: { numero: number; emitida: boolean; validade: string | null }[] }[]) {
    const v = p.versoes.filter((x) => x.emitida).sort((a, b) => b.numero - a.numero)[0];
    if (!v?.validade || v.validade < de || v.validade > ate) continue;
    ev.push({
      id: `proposta:${p.id}`, fonte: 'proposta', ref: p.id, titulo: `Proposta vence: ${p.codigo}`, det: `${p.titulo}${p.pessoa ? ` · ${p.pessoa.nome}` : ''}`,
      inicio: v.validade, fim: v.validade, cor: 'proposta', feito: false, atrasado: false, link: `/propostas/${p.id}`, movivel: false,
    });
  }
  for (const o of ok(op) as { id: string; titulo: string; proxima_acao: string | null; proxima_acao_data: string }[]) {
    if (o.proxima_acao_data < de && o.proxima_acao_data >= hoje) continue;
    ev.push({
      id: `comercial:${o.id}`, fonte: 'comercial', ref: o.id, titulo: o.proxima_acao || 'Próxima ação', det: o.titulo,
      inicio: o.proxima_acao_data, fim: o.proxima_acao_data, cor: 'comercial', feito: false, atrasado: o.proxima_acao_data < hoje, link: `/comercial/${o.id}`, movivel: true,
    });
  }
  return { eventos: ev, tarefas };
}

/** Marca como feito (ou desfaz). Tarefas que se repetem marcam só o dia. */
export async function alternarFeito(e: Evento, tarefas: Tarefa[]): Promise<void> {
  if (e.fonte === 'tarefa') {
    const t = tarefas.find((x) => x.id === e.ref);
    if (e.ocorrencia && t) {
      const concluidas = e.feito ? t.concluidas.filter((d) => d !== e.ocorrencia) : [...t.concluidas, e.ocorrencia];
      ok(await supabase.from('tarefa').update({ concluidas }).eq('id', e.ref).select('id'));
    } else {
      ok(await supabase.from('tarefa').update({ concluida: !e.feito }).eq('id', e.ref).select('id'));
    }
  } else if (e.fonte === 'etapa') {
    ok(await supabase.from('etapa').update(e.feito ? { estado: 'em_execucao' } : { estado: 'executado', percentual: 100 }).eq('id', e.ref).select('id'));
  }
}

/** Muda a data (arrastando ou "passar para amanhã"). Etapas com linha de base pedem o motivo. */
export async function mudarData(e: Evento, inicio: string, fim: string, motivo?: string): Promise<void> {
  if (e.fonte === 'tarefa') {
    ok(await supabase.from('tarefa').update({ data: inicio, data_fim: fim === inicio ? null : fim }).eq('id', e.ref).select('id'));
  } else if (e.fonte === 'etapa') {
    ok(await supabase.from('etapa').update({ inicio_previsto: inicio, fim_previsto: fim, ...(motivo ? { motivo_alteracao: motivo } : {}) }).eq('id', e.ref).select('id'));
  } else if (e.fonte === 'receber' || e.fonte === 'pagar') {
    ok(await supabase.from('parcela').update({ vencimento: inicio }).eq('id', e.ref).select('id'));
  } else if (e.fonte === 'comercial') {
    ok(await supabase.from('oportunidade').update({ proxima_acao_data: inicio }).eq('id', e.ref).select('id'));
  }
}

export type ItemFila = { tipo: 'obra' | 'proposta'; situacao: string; id: string; titulo: string; inicio: string; fim: string; atrasada?: boolean; validade?: string | null; link: string };
export type Fila = {
  hoje: string; livre: string; fim: string | null; paralelos: number; contar_em_aberto: boolean; antecedencia_dias: number; intervalo_dias: number;
  fila: ItemFila[]; sem_data: { id: string; titulo: string; link: string }[];
};

/** Quando a agenda fica livre para um trabalho de "dias" dias (ignorando a própria proposta). */
export async function carregarFila(dias?: number | null, ignorar?: string | null): Promise<Fila> {
  return ok(await supabase.rpc('agenda_fila', { p_ignorar: ignorar ?? null, p_dias: dias && dias > 0 ? Math.round(dias) : null })) as Fila;
}

export type ConfigAgenda = { paralelos: number; contar_em_aberto: boolean; antecedencia_dias: number; intervalo_dias: number; resumo_hora: number; avisar_resumo: boolean; avisar_atrasos: boolean };

export async function carregarConfig(): Promise<ConfigAgenda | null> {
  return ok(await supabase.from('agenda_config').select('paralelos, contar_em_aberto, antecedencia_dias, intervalo_dias, resumo_hora, avisar_resumo, avisar_atrasos').eq('id', 1).maybeSingle()) as ConfigAgenda | null;
}

export async function salvarConfig(c: ConfigAgenda): Promise<void> {
  ok(await supabase.from('agenda_config').update(c).eq('id', 1).select('id'));
}

export const amanha = (hoje: string) => somarDias(hoje, 1);
