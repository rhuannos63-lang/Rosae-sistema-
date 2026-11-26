// Base de insumos e composições (só quem tem financeiro vê os preços).
import { supabase } from './supabase';
import { ok } from './consulta';
import type { Composicao, Insumo, ItemComposicao } from '../core/composicao';
import type { CondicaoObra } from '../core/condicoes';

export type Base = { insumos: Insumo[]; composicoes: Composicao[] };

export async function carregarBase(): Promise<Base> {
  const [i, c, it] = await Promise.all([
    supabase.from('insumo').select('id, codigo, nome, tipo, unidade, preco_basico, preco, preco_premium, compra_unidade, compra_fator, ativo').order('codigo'),
    supabase.from('composicao').select('id, codigo, nome, unidade, grupo, metodologia, palavras_chave, varia_padrao, fator_mo_basico, fator_mo_premium, ativo').order('codigo'),
    supabase.from('composicao_item').select('composicao_id, insumo_id, coeficiente'),
  ]);
  const itens = ok(it) as (ItemComposicao & { composicao_id: string })[];
  const porComp = new Map<string, ItemComposicao[]>();
  for (const x of itens) porComp.set(x.composicao_id, [...(porComp.get(x.composicao_id) ?? []), { insumo_id: x.insumo_id, coeficiente: Number(x.coeficiente) }]);
  return {
    insumos: (ok(i) as Insumo[]).map((x) => ({ ...x, preco: Number(x.preco), preco_basico: Number(x.preco_basico), preco_premium: Number(x.preco_premium), compra_fator: x.compra_fator === null ? null : Number(x.compra_fator) })),
    composicoes: (ok(c) as Omit<Composicao, 'itens'>[]).map((x) => ({ ...x, fator_mo_basico: Number(x.fator_mo_basico), fator_mo_premium: Number(x.fator_mo_premium), palavras_chave: x.palavras_chave ?? [], itens: porComp.get(x.id) ?? [] })),
  };
}

/** Próximo código livre de uma série ("MAT-041", "CP-027"). */
export function proximoCodigo(codigos: string[], prefixo: string): string {
  const n = codigos.filter((c) => c.startsWith(`${prefixo}-`)).map((c) => Number(c.slice(prefixo.length + 1)) || 0);
  return `${prefixo}-${String(Math.max(0, ...n) + 1).padStart(3, '0')}`;
}

/** Condições da obra e logística (escada, aclive, condomínio...). A equipe administrativa lê; quem tem financeiro edita. */
export async function carregarCondicoes(): Promise<CondicaoObra[]> {
  const r = await supabase.from('condicao_obra').select('id, codigo, grupo, nome, descricao, mao_de_obra_pct, material_pct, ordem, ativo').order('ordem');
  return (ok(r) as CondicaoObra[]).map((c) => ({ ...c, mao_de_obra_pct: Number(c.mao_de_obra_pct), material_pct: Number(c.material_pct) }));
}
