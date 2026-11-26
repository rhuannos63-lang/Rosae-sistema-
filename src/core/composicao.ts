// Composição de custos: cada serviço da proposta pode ser ligado a composições (insumos com
// coeficientes). Daqui sai o custo de material, mão de obra e equipamento, o preço sugerido
// com BDI e a lista consolidada de insumos. Tudo cálculo puro e testável.

export type TipoInsumo = 'material' | 'mao_de_obra' | 'equipamento';
/** Padrão de acabamento: muda o preço do material de acabamento, da mão de obra e o tempo de execução. */
export type Padrao = 'basico' | 'medio' | 'premium';
export const PADRAO: Record<Padrao, string> = { basico: 'Básico', medio: 'Médio', premium: 'Premium' };
export const PADROES: Padrao[] = ['basico', 'medio', 'premium'];
/** preco = padrão médio. */
export type Insumo = {
  id: string; codigo: string; nome: string; tipo: TipoInsumo; unidade: string; preco: number; preco_basico: number; preco_premium: number;
  compra_unidade: string | null; compra_fator: number | null; ativo?: boolean;
};
export type ItemComposicao = { insumo_id: string; coeficiente: number };
export type Composicao = {
  id: string; codigo: string; nome: string; unidade: string; grupo: string; metodologia: string | null;
  palavras_chave: string[]; ativo?: boolean; itens: ItemComposicao[];
  /** Serviço de acabamento: o padrão muda preços e o tempo da mão de obra (fatores). */
  varia_padrao: boolean; fator_mo_basico: number; fator_mo_premium: number;
};
/** Uma composição aplicada a um item da proposta. padrao vazio = o padrão geral da proposta. */
export type Uso = { id: string; item_id: string; composicao_id: string; quantidade: number; perda_pct: number; padrao?: Padrao | null };

/** Preço do insumo no padrão (serviço que não varia usa sempre o médio). */
export function precoNoPadrao(i: Insumo, p: Padrao): number {
  const v = p === 'basico' ? i.preco_basico : p === 'premium' ? i.preco_premium : i.preco;
  return Number(v) > 0 ? Number(v) : Number(i.preco || 0);
}
/** Quanto a mão de obra demora a mais (ou a menos) no padrão. */
export function fatorMaoDeObra(c: Composicao, p: Padrao): number {
  if (!c.varia_padrao) return 1;
  return p === 'basico' ? Number(c.fator_mo_basico) || 1 : p === 'premium' ? Number(c.fator_mo_premium) || 1 : 1;
}
const padraoDa = (c: Composicao, p: Padrao): Padrao => (c.varia_padrao ? p : 'medio');

export const TIPO_INSUMO: Record<TipoInsumo, string> = { material: 'Material', mao_de_obra: 'Mão de obra', equipamento: 'Equipamento' };

export type Parcelas = { material: number; mao_de_obra: number; equipamento: number; total: number };
const zero = (): Parcelas => ({ material: 0, mao_de_obra: 0, equipamento: 0, total: 0 });
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Custo de uma unidade da composição (ex.: 1 m² de alvenaria), por tipo de insumo. */
export function custoUnitario(c: Composicao, insumos: Map<string, Insumo>, padrao: Padrao = 'medio'): Parcelas {
  const p = zero();
  const pd = padraoDa(c, padrao);
  for (const it of c.itens) {
    const i = insumos.get(it.insumo_id);
    if (!i) continue;
    const coef = it.coeficiente * (i.tipo === 'mao_de_obra' ? fatorMaoDeObra(c, pd) : 1);
    p[i.tipo] += coef * precoNoPadrao(i, pd);
  }
  p.total = p.material + p.mao_de_obra + p.equipamento;
  return p;
}

export type LinhaInsumo = { insumo: Insumo; quantidade: number; custo: number; compra: { quantidade: number; unidade: string } | null };
export type ResultadoUso = Uso & { composicao: Composicao | null; custos: Parcelas; padraoUsado: Padrao };

/** Quantidade de compra: na embalagem (saco, galão, barra), sempre arredondando para cima. */
export function quantidadeCompra(i: Insumo, q: number): { quantidade: number; unidade: string } | null {
  if (!(q > 0)) return null;
  if (i.compra_fator && i.compra_fator > 0) return { quantidade: Math.ceil(q / i.compra_fator - 1e-9), unidade: i.compra_unidade || i.unidade };
  if (['un', 'kg', 'm', 'L'].includes(i.unidade)) return { quantidade: Math.ceil(q - 1e-9), unidade: i.unidade };
  return { quantidade: Math.ceil(q * 100 - 1e-6) / 100, unidade: i.unidade };
}

/**
 * Aplica as composições aos itens: custo de cada uso (a perda só pesa no material),
 * totais por item e no geral, e a lista consolidada de insumos.
 */
export function calcularComposicao(usos: Uso[], composicoes: Composicao[], insumos: Insumo[], padraoGeral: Padrao = 'medio', acrescimo?: { mao_de_obra_pct: number; material_pct: number }) {
  // Condições da obra (escada, aclive, condomínio...): acréscimo no custo, sem mudar a quantidade de material.
  const fMo = 1 + Math.max(0, acrescimo?.mao_de_obra_pct ?? 0) / 100;
  const fMat = 1 + Math.max(0, acrescimo?.material_pct ?? 0) / 100;
  let extra = 0;
  const porComp = new Map(composicoes.map((c) => [c.id, c]));
  const porIns = new Map(insumos.map((i) => [i.id, i]));
  const consolidado = new Map<string, LinhaInsumo>();
  const porItem = new Map<string, Parcelas>();
  const total = zero();
  const resultados: ResultadoUso[] = usos.map((u) => {
    const comp = porComp.get(u.composicao_id) ?? null;
    const custos = zero();
    const q = Math.max(0, Number(u.quantidade) || 0);
    const perda = 1 + Math.max(0, Number(u.perda_pct) || 0) / 100;
    const pd = comp ? padraoDa(comp, u.padrao || padraoGeral) : 'medio';
    for (const it of comp?.itens ?? []) {
      const i = porIns.get(it.insumo_id);
      if (!i || !comp) continue;
      const qtd = q * it.coeficiente * (i.tipo === 'material' ? perda : i.tipo === 'mao_de_obra' ? fatorMaoDeObra(comp, pd) : 1);
      const custo = qtd * precoNoPadrao(i, pd);
      custos[i.tipo] += custo;
      const l = consolidado.get(i.id) ?? { insumo: i, quantidade: 0, custo: 0, compra: null };
      l.quantidade += qtd; l.custo += custo;
      consolidado.set(i.id, l);
    }
    const semCond = custos.material + custos.mao_de_obra + custos.equipamento;
    custos.material *= fMat; custos.mao_de_obra *= fMo; custos.equipamento *= fMo;
    custos.total = custos.material + custos.mao_de_obra + custos.equipamento;
    extra += custos.total - semCond;
    (['material', 'mao_de_obra', 'equipamento', 'total'] as const).forEach((k) => { custos[k] = r2(custos[k]); });
    const pi = porItem.get(u.item_id) ?? zero();
    (['material', 'mao_de_obra', 'equipamento', 'total'] as const).forEach((k) => { pi[k] = r2(pi[k] + custos[k]); total[k] = r2(total[k] + custos[k]); });
    porItem.set(u.item_id, pi);
    return { ...u, composicao: comp, custos, padraoUsado: pd };
  });
  const insumosLista = Array.from(consolidado.values())
    .map((l) => ({ ...l, quantidade: Math.round(l.quantidade * 1000) / 1000, custo: r2(l.custo), compra: l.insumo.tipo === 'material' ? quantidadeCompra(l.insumo, l.quantidade) : null }))
    .sort((a, b) => a.insumo.tipo.localeCompare(b.insumo.tipo) || b.custo - a.custo);
  return { resultados, porItem, total, insumos: insumosLista, acrescimoCondicoes: r2(extra) };
}

/** Preço de venda a partir do custo direto: custo × (1 + BDI). */
export const precoComBdi = (custo: number, bdiPct: number) => r2(custo * (1 + Math.max(0, bdiPct) / 100));

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const UNID: Record<string, string> = { m2: 'm²', m3: 'm³', 'm²': 'm²', 'm³': 'm³' };
export const mesmaUnidade = (a: string, b: string) => (UNID[a] ?? a) === (UNID[b] ?? b);

/** Composições que combinam com o item (palavras-chave e nome no título e na descrição), melhores primeiro. */
export function sugerirComposicoes(item: { titulo: string; descricao?: string | null; unidade?: string }, composicoes: Composicao[], limite = 4): Composicao[] {
  const texto = ` ${sem(`${item.titulo} ${item.descricao ?? ''}`)} `;
  const pontos = composicoes.filter((c) => c.ativo !== false).map((c) => {
    let p = 0;
    // Palavra inteira (aceita plural): “forma” não casa com “reforma”.
    for (const k of c.palavras_chave) if (new RegExp(`[^a-z0-9]${sem(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?[^a-z0-9]`).test(texto)) p += k.length > 6 ? 3 : 2;
    if (p && item.unidade && mesmaUnidade(item.unidade, c.unidade)) p += 1;
    return { c, p };
  });
  return pontos.filter((x) => x.p > 0).sort((a, b) => b.p - a.p).slice(0, limite).map((x) => x.c);
}

export const novoUsoId = () => Math.random().toString(36).slice(2, 10);
