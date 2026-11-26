// Tabela de preços do orçamento automático: padrões do código + o que o Rhuann ajustou no banco.
import { supabase } from './supabase';
import { ok } from './consulta';
import { parametrosDe, parametrosPadrao, TIPOS, type Parametros, type TipoServico } from '../core/orcamento';

export type TabelaPrecos = Record<TipoServico, Parametros>;

export async function carregarPrecos(): Promise<TabelaPrecos> {
  const linhas = ok(await supabase.from('orcamento_parametro').select('tipo, valores')) as { tipo: TipoServico; valores: Parametros }[];
  const r = Object.fromEntries(TIPOS.map((t) => [t, parametrosPadrao(t)])) as TabelaPrecos;
  for (const l of linhas) {
    if (!r[l.tipo]) continue;
    for (const [k, v] of Object.entries(l.valores ?? {})) if (Number.isFinite(Number(v))) r[l.tipo][k] = Number(v);
  }
  return r;
}

/** Grava só o que difere do padrão: se o padrão do código melhorar, quem não mexeu acompanha. */
export async function salvarPrecos(tipo: TipoServico, valores: Parametros): Promise<void> {
  const padrao = parametrosPadrao(tipo);
  const gravar: Parametros = {};
  for (const d of parametrosDe(tipo)) if (Number.isFinite(valores[d.id]) && valores[d.id] !== padrao[d.id]) gravar[d.id] = valores[d.id];
  // Preços do montador por andar ("cat.<serviço>") ficam junto da reforma e não podem se perder aqui.
  for (const [k, v] of Object.entries(valores)) if (k.startsWith('cat.') && Number.isFinite(v)) gravar[k] = v;
  ok(await supabase.from('orcamento_parametro').update({ valores: gravar }).eq('tipo', tipo).select('tipo'));
}

/** Preços do montador por andar com os seus ajustes ("cat.<serviço>" na linha da reforma). */
export async function carregarPrecosCatalogo(): Promise<Record<string, number>> {
  const { data } = await supabase.from('orcamento_parametro').select('valores').eq('tipo', 'reforma').maybeSingle();
  const v = ((data as { valores?: Record<string, unknown> } | null)?.valores ?? {}) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(v).filter(([k, n]) => k.startsWith('cat.') && Number.isFinite(Number(n))).map(([k, n]) => [k, Number(n)]));
}

/** Grava um preço do catálogo como o seu padrão (sem mexer nos outros parâmetros da reforma). */
export async function salvarPrecoCatalogo(id: string, preco: number): Promise<void> {
  const atual = ok(await supabase.from('orcamento_parametro').select('valores').eq('tipo', 'reforma').maybeSingle()) as { valores?: Parametros } | null;
  const valores: Parametros = { ...(atual?.valores ?? {}), [`cat.${id}`]: Math.round(preco * 100) / 100 };
  ok(await supabase.from('orcamento_parametro').update({ valores }).eq('tipo', 'reforma').select('tipo'));
}
