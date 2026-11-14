// Carrega as propostas com a situação real de cada uma (mesma regra em todas as telas).
import { supabase } from './supabase';
import { ok, todas, useConsulta } from './consulta';
import { hoje } from '../core/datas';
import { doBanco } from '../core/dinheiro';
import { contarSituacoes, situacaoDa, valorDe, type Contagem, type Situacao } from '../core/situacaoProposta';
import type { Proposta } from './tipos';

export type VersaoLista = { id: string; numero: number; valor_total: string; emitida: boolean; validade: string | null };
export type PropostaComSituacao = Proposta & {
  versoes: VersaoLista[];
  oportunidade?: { estado_id: string } | null;
  situacao: Situacao;
  /** Centavos: aprovado, ou o da versão que está com o cliente, ou o do rascunho. */
  valor: number;
};

const SELECT = '*, pessoa:pessoa(nome, telefone, email), oportunidade:oportunidade(estado_id), versoes:proposta_versao!proposta_versao_proposta_id_fkey(id, numero, valor_total, emitida, validade)';

export async function carregarPropostas(): Promise<PropostaComSituacao[]> {
  const [lista, est] = await Promise.all([
    todas<PropostaComSituacao>((de, ate) => supabase.from('proposta').select(SELECT).order('atualizado_em', { ascending: false }).order('id').range(de, ate) as unknown as PromiseLike<{ data: PropostaComSituacao[] | null; error: unknown }>),
    supabase.from('estado_funil').select('id, tipo'),
  ]);
  const tipo = new Map((ok(est) as { id: string; tipo: 'aberto' | 'ganho' | 'perdido' | 'arquivado' }[]).map((e) => [e.id, e.tipo]));
  const d = hoje();
  return lista.map((p) => ({
    ...p,
    situacao: situacaoDa({ estado: p.estado, versoes: p.versoes ?? [], negocio: p.oportunidade ? tipo.get(p.oportunidade.estado_id) ?? null : null }, d),
    valor: valorDe((p.versoes ?? []).map((v) => ({ id: v.id, numero: v.numero, emitida: v.emitida, valor: doBanco(v.valor_total) })), p.versao_aprovada_id),
  }));
}

/** Números das propostas (sem contar aditivos, que entram no orçamento de origem). */
export function resumoPropostas(ps: PropostaComSituacao[], inicioMes = hoje().slice(0, 8) + '01'): Contagem & { aprovadasMes: number; aditivosAbertos: number } {
  const principais = ps.filter((p) => p.tipo === 'proposta');
  const c = contarSituacoes(principais.map((p) => ({ situacao: p.situacao, valor: p.valor })));
  return {
    ...c,
    aprovadasMes: principais.filter((p) => p.situacao === 'aprovada' && (p.aprovada_em ?? '').slice(0, 10) >= inicioMes).length,
    aditivosAbertos: ps.filter((p) => p.tipo === 'aditivo' && ['rascunho', 'aguardando', 'ajuste', 'revisando', 'vencida'].includes(p.situacao)).length,
  };
}

export async function carregarResumoPropostas() {
  return resumoPropostas(await carregarPropostas());
}

/** Números das propostas para cartões de resumo (painel e departamentos). */
export function useResumoPropostas() {
  return useConsulta(carregarResumoPropostas, []).dados;
}
