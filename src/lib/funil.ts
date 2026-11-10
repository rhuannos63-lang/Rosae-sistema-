// Carrega do banco tudo que o funil completo precisa e converte proposta aceita em obra.
import { supabase } from './supabase';
import { ok, todas } from './consulta';
import { hoje } from '../core/datas';
import { doBanco } from '../core/dinheiro';
import { montarFunil, type ContratoFunil, type Negocio, type ObraFunil, type OpFunil, type PropostaFunil } from '../core/funil';

type OpBanco = {
  id: string; codigo: string; titulo: string; pessoa_id: string; tipo_servico: string | null; estado_id: string; estado_desde: string;
  proxima_acao: string | null; proxima_acao_data: string | null; valor_estimado: string | number | null; criado_em: string;
  pessoa: { nome: string; telefone: string | null } | null;
};
type PropBanco = {
  id: string; codigo: string; titulo: string; tipo: 'proposta' | 'aditivo'; oportunidade_id: string | null; pessoa_id: string; obra_id: string | null;
  estado: PropostaFunil['estado']; versao_aprovada_id: string | null; aprovada_em: string | null; atualizado_em: string; criado_em: string;
  pessoa: { nome: string; telefone: string | null } | null;
  versoes: { id: string; numero: number; valor_total: string | number; emitida: boolean; validade: string | null }[];
};

/** Tabelas que a pessoa pode não ter permissão de ler voltam vazias em vez de travar o funil. */
async function talvez<T>(f: () => Promise<T[]>): Promise<T[]> {
  try { return await f(); } catch { return []; }
}

export async function carregarFunil(oportunidadeId?: string): Promise<{ negocios: Negocio[]; estados: { id: string; nome: string; tipo: OpFunil['estado_tipo'] }[] }> {
  const est = ok(await supabase.from('estado_funil').select('id, nome, tipo, ordem').order('ordem')) as { id: string; nome: string; tipo: OpFunil['estado_tipo'] }[];
  const tipo = new Map(est.map((e) => [e.id, e]));
  const [ops, props, eventos] = await Promise.all([
    todas<OpBanco>((de, ate) => {
      let q = supabase.from('oportunidade').select('id, codigo, titulo, pessoa_id, tipo_servico, estado_id, estado_desde, proxima_acao, proxima_acao_data, valor_estimado, criado_em, pessoa:pessoa(nome, telefone)').eq('arquivado', false);
      if (oportunidadeId) q = q.eq('id', oportunidadeId);
      return q.order('atualizado_em', { ascending: false }).order('id').range(de, ate) as unknown as PromiseLike<{ data: OpBanco[] | null; error: unknown }>;
    }),
    todas<PropBanco>((de, ate) => {
      let q = supabase.from('proposta').select('id, codigo, titulo, tipo, oportunidade_id, pessoa_id, obra_id, estado, versao_aprovada_id, aprovada_em, atualizado_em, criado_em, pessoa:pessoa(nome, telefone), versoes:proposta_versao!proposta_versao_proposta_id_fkey(id, numero, valor_total, emitida, validade)');
      if (oportunidadeId) q = q.eq('oportunidade_id', oportunidadeId);
      return q.order('atualizado_em', { ascending: false }).order('id').range(de, ate) as unknown as PromiseLike<{ data: PropBanco[] | null; error: unknown }>;
    }),
    talvez(() => todas<{ proposta_id: string; em: string }>((de, ate) => supabase.from('proposta_evento').select('proposta_id, em').eq('tipo', 'visualizada').order('em', { ascending: false }).order('id').range(de, ate) as unknown as PromiseLike<{ data: { proposta_id: string; em: string }[] | null; error: unknown }>)),
  ]);
  const vistas = new Map<string, { n: number; ultima: string }>();
  for (const e of eventos) { const x = vistas.get(e.proposta_id); vistas.set(e.proposta_id, { n: (x?.n ?? 0) + 1, ultima: x?.ultima ?? e.em }); }

  const versaoDaProposta = new Map<string, string[]>();
  const propostas: PropostaFunil[] = props.map((p) => {
    const vs = [...(p.versoes ?? [])].sort((a, b) => b.numero - a.numero);
    versaoDaProposta.set(p.id, vs.map((v) => v.id));
    const ref = (p.versao_aprovada_id && vs.find((v) => v.id === p.versao_aprovada_id)) || vs[0];
    const ultimaEmitida = vs.find((v) => v.emitida);
    return {
      id: p.id, codigo: p.codigo, titulo: p.titulo, tipo: p.tipo, oportunidade_id: p.oportunidade_id, pessoa_id: p.pessoa_id, obra_id: p.obra_id,
      pessoa_nome: p.pessoa?.nome ?? null, telefone: p.pessoa?.telefone ?? null, estado: p.estado,
      valor: doBanco(ref?.valor_total ?? 0), validade: ultimaEmitida?.validade ?? null, emitida: !!ultimaEmitida,
      versao_aprovada_id: p.versao_aprovada_id, aprovada_em: p.aprovada_em, atualizado_em: p.atualizado_em, criado_em: p.criado_em,
      vistas: vistas.get(p.id)?.n ?? 0, ultima_vista: vistas.get(p.id)?.ultima ?? null,
    };
  });
  const versoes = propostas.flatMap((p) => versaoDaProposta.get(p.id) ?? []);
  const [obras, contratos] = await Promise.all([
    talvez(() => todas<ObraFunil>((de, ate) => {
      let q = supabase.from('obra').select('id, codigo, nome, status, proposta_versao_id, data_previsao_fim, criado_em').eq('arquivado', false).not('proposta_versao_id', 'is', null);
      if (oportunidadeId) q = q.in('proposta_versao_id', versoes.length ? versoes : ['00000000-0000-0000-0000-000000000000']);
      return q.order('criado_em').order('id').range(de, ate) as unknown as PromiseLike<{ data: ObraFunil[] | null; error: unknown }>;
    })),
    talvez(() => todas<ContratoFunil>((de, ate) => supabase.from('contrato').select('id, obra_id, estado, emitido_em, assinado_em, criado_em').order('criado_em').order('id').range(de, ate) as unknown as PromiseLike<{ data: ContratoFunil[] | null; error: unknown }>)),
  ]);

  const opsF: OpFunil[] = ops.map((o) => ({
    id: o.id, codigo: o.codigo, titulo: o.titulo, pessoa_id: o.pessoa_id, pessoa_nome: o.pessoa?.nome ?? null, telefone: o.pessoa?.telefone ?? null,
    tipo_servico: o.tipo_servico, estado_tipo: tipo.get(o.estado_id)?.tipo ?? 'aberto', estado_nome: tipo.get(o.estado_id)?.nome ?? '',
    estado_desde: o.estado_desde, proxima_acao: o.proxima_acao, proxima_acao_data: o.proxima_acao_data,
    valor_estimado: o.valor_estimado == null ? null : doBanco(o.valor_estimado), criado_em: o.criado_em,
  }));
  // Valores em centavos, como no resto do sistema.
  const negocios = montarFunil({ ops: opsF, propostas, obras, contratos, versaoDaProposta }, hoje());
  return { negocios, estados: est };
}

/** Proposta aceita vira obra (com os aditivos aceitos e a lista de compras). Devolve o id da obra. */
export async function converterEmObra(propostaId: string, versaoId: string): Promise<string> {
  const r = await supabase.rpc('converter_proposta', { p_versao: versaoId });
  if (r.error) throw r.error;
  const obraId = r.data as string;
  const ads = await supabase.from('proposta').select('versao_aprovada_id').eq('proposta_origem_id', propostaId).eq('estado', 'aprovada');
  for (const a of (ads.data ?? []) as { versao_aprovada_id: string | null }[]) {
    if (a.versao_aprovada_id) { const x = await supabase.rpc('converter_proposta', { p_versao: a.versao_aprovada_id }); if (x.error) throw x.error; }
  }
  await supabase.rpc('gerar_lista_compras', { p_obra: obraId });
  return obraId;
}
