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
  ok(await supabase.from('orcamento_parametro').update({ valores: gravar }).eq('tipo', tipo).select('tipo'));
}
