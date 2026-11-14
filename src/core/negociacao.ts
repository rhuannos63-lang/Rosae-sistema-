// "Alterar valor e reenviar": depois de uma negociação, leva a proposta ao novo total
// sem mexer em mais nada (escopo, páginas e visual continuam os mesmos).
import { ajustarTotal, parcelasAoTotal, somaParcelas, totalConteudo, type Conteudo } from './proposta';
import type { Centavos } from './dinheiro';

export type Reajuste = {
  conteudo: Conteudo;
  antes: Centavos;
  depois: Centavos;
  diferenca: Centavos;
  /** Percentual da mudança (negativo = desconto). */
  percentual: number;
  parcelas: { descricao: string; antes: Centavos; depois: Centavos }[];
  /** Há outros pacotes na comparação que não acompanham o novo valor. */
  outrosPacotes: boolean;
};

const cent = (v: number) => Math.round((Number(v) || 0) * 100);

export function reajustarValor(c: Conteudo, alvo: Centavos): Reajuste {
  const antes = totalConteudo(c);
  let novo = ajustarTotal(c, alvo);
  // As parcelas precisam fechar com o total para a versão poder ser emitida.
  if (novo.pagamento.parcelas.length > 0 && somaParcelas(novo) !== totalConteudo(novo)) novo = parcelasAoTotal(novo);
  const depois = totalConteudo(novo);
  return {
    conteudo: novo,
    antes, depois,
    diferenca: depois - antes,
    percentual: antes > 0 ? ((depois - antes) / antes) * 100 : 0,
    parcelas: novo.pagamento.parcelas.map((p, k) => ({ descricao: p.descricao, antes: cent(c.pagamento.parcelas[k]?.valor ?? 0), depois: cent(p.valor) })),
    outrosPacotes: (novo.opcoes ?? []).filter((o) => !o.principal && o.valor > 0).length > 0,
  };
}

/** Texto curto para o histórico do negócio. */
export function textoReajuste(r: Pick<Reajuste, 'antes' | 'depois' | 'percentual'>, versao: number, motivo: string): string {
  const brl = (c: Centavos) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pct = `${r.percentual > 0 ? '+' : ''}${r.percentual.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  return `Valor alterado na negociação: ${brl(r.antes)} → ${brl(r.depois)} (${pct}). Versão ${versao} emitida para reenvio.${motivo.trim() ? ` Motivo: ${motivo.trim()}` : ''}`;
}
