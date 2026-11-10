// Condições da obra e logística: o que torna o serviço mais trabalhoso que o normal
// (escada, aclive, condomínio, imóvel ocupado, altura...). Cada condição soma um percentual
// na mão de obra e no material. A base fica no banco (condicao_obra) e é editável.

export type CondicaoObra = {
  id: string; codigo: string; grupo: string; nome: string; descricao: string | null;
  mao_de_obra_pct: number; material_pct: number; ordem: number; ativo: boolean;
};

export type Acrescimo = { mao_de_obra_pct: number; material_pct: number; nomes: string[] };

/** Já perguntado em reforço e reforma (“Imóvel ocupado?”): nesses serviços a condição não soma de novo. */
export const CONDICAO_OCUPADO = 'IM-01';

export const SEM_ACRESCIMO: Acrescimo = { mao_de_obra_pct: 0, material_pct: 0, nomes: [] };

/** Soma os percentuais das condições marcadas (por código). Condição inativa ou desconhecida é ignorada. */
export function acrescimoDas(codigos: string[] | undefined | null, base: CondicaoObra[]): Acrescimo {
  if (!codigos?.length) return SEM_ACRESCIMO;
  const marcadas = base.filter((c) => c.ativo !== false && codigos.includes(c.codigo));
  return {
    mao_de_obra_pct: Math.round(marcadas.reduce((t, c) => t + Math.max(0, Number(c.mao_de_obra_pct) || 0), 0) * 100) / 100,
    material_pct: Math.round(marcadas.reduce((t, c) => t + Math.max(0, Number(c.material_pct) || 0), 0) * 100) / 100,
    nomes: marcadas.map((c) => c.nome),
  };
}

/** Lista de códigos guardada nas respostas do orçamento ("AC-03,HO-01"). */
export const codigosDe = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).filter(Boolean) : typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : [];

export const alternarCodigo = (lista: string[], codigo: string): string[] =>
  (lista.includes(codigo) ? lista.filter((c) => c !== codigo) : [...lista, codigo]);

export function gruposDe(base: CondicaoObra[]): { grupo: string; itens: CondicaoObra[] }[] {
  const ativas = base.filter((c) => c.ativo !== false).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
  const grupos: { grupo: string; itens: CondicaoObra[] }[] = [];
  for (const c of ativas) {
    const g = grupos.find((x) => x.grupo === c.grupo);
    if (g) g.itens.push(c); else grupos.push({ grupo: c.grupo, itens: [c] });
  }
  return grupos;
}

const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
/** "+12% na mão de obra e +3% no material". */
export function textoAcrescimo(a: Acrescimo): string {
  const partes = [a.mao_de_obra_pct > 0 ? `+${pct(a.mao_de_obra_pct)} na mão de obra` : '', a.material_pct > 0 ? `+${pct(a.material_pct)} no material` : ''].filter(Boolean);
  return partes.join(' e ') || 'sem acréscimo';
}
