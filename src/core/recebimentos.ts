// Contas do quadro "Fechado × recebido". Valores em centavos.
import { doBanco, type Centavos } from './dinheiro';

type Numerico = number | string | null | undefined;

/** Quanto falta receber do que foi fechado (nunca negativo). */
export function faltaReceber(c: { fechado: Numerico; recebido: Numerico }): Centavos {
  return Math.max(doBanco(c.fechado) - doBanco(c.recebido), 0);
}

/** Percentual recebido do fechado, inteiro (pode passar de 100 quando entrou mais que o fechado). */
export function percentualRecebido(c: { fechado: Numerico; recebido: Numerico }): number {
  const f = doBanco(c.fechado);
  if (f <= 0) return doBanco(c.recebido) > 0 ? 100 : 0;
  return Math.round((doBanco(c.recebido) * 100) / f);
}

export type MovRecebimento = {
  id: string; data: string; valor: Numerico; descricao: string | null; conta_nome: string;
  estornado: boolean; chave_idempotencia?: string | null; criado_em: string;
};
export type GrupoRecebimento = { chave: string; ids: string[]; data: string; valor: Centavos; descricao: string | null; conta: string; estornado: boolean };

/**
 * Um recebimento livre pode ter sido abatido de várias parcelas (um movimento por parcela,
 * com a mesma chave e o sufixo ":n"). Aqui eles voltam a ser uma linha só, como foi digitado.
 */
export function agruparRecebimentos(movs: MovRecebimento[]): GrupoRecebimento[] {
  const grupos = new Map<string, GrupoRecebimento>();
  for (const m of movs) {
    const k = m.chave_idempotencia && /:\d+$/.test(m.chave_idempotencia) ? m.chave_idempotencia.replace(/:\d+$/, '') : m.id;
    const g = grupos.get(k);
    if (g) {
      g.ids.push(m.id);
      g.valor += doBanco(m.valor);
      g.estornado = g.estornado && m.estornado;
    } else {
      grupos.set(k, { chave: k, ids: [m.id], data: m.data, valor: doBanco(m.valor), descricao: m.descricao, conta: m.conta_nome, estornado: m.estornado });
    }
  }
  // Desfazer só o que ainda não foi estornado.
  return [...grupos.values()].map((g) => ({ ...g, ids: g.estornado ? g.ids : g.ids.filter((id) => !movs.find((m) => m.id === id)?.estornado) }));
}
