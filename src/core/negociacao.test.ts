import { describe, expect, it } from 'vitest';
import { gerarOrcamento, parametrosPadrao, respostasPadrao } from './orcamento';
import { pendencias, prepararParaSalvar, somaParcelas, totalConteudo } from './proposta';
import { reajustarValor, textoReajuste } from './negociacao';

describe('alterar valor e reenviar', () => {
  const t = 'reforma' as const;
  const o = gerarOrcamento(t, { ...respostasPadrao(t), area: 120 } as ReturnType<typeof respostasPadrao>, parametrosPadrao(t), 2);
  const c = prepararParaSalvar(o.conteudo).conteudo;

  it('leva ao novo total com parcelas fechando, pronta para emitir', () => {
    const alvo = Math.round(totalConteudo(c) * 0.93) + 37;
    const r = reajustarValor(c, alvo);
    const salvo = prepararParaSalvar(r.conteudo).conteudo;
    expect(totalConteudo(salvo)).toBe(alvo);
    expect(somaParcelas(salvo)).toBe(alvo);
    expect(pendencias(salvo)).toEqual([]);
    expect(r.diferenca).toBe(alvo - totalConteudo(c));
    expect(r.percentual).toBeLessThan(0);
    // Só o valor muda: escopo e páginas continuam.
    expect(salvo.ambientes.map((a) => a.itens.length)).toEqual(c.ambientes.map((a) => a.itens.length));
    expect(salvo.paginas_ocultas).toEqual(c.paginas_ocultas);
  });

  it('fecha as parcelas mesmo quando elas não batiam antes', () => {
    const torto = { ...c, pagamento: { ...c.pagamento, parcelas: c.pagamento.parcelas.map((p, k) => (k === 0 ? { ...p, valor: p.valor + 1 } : p)) } };
    const r = reajustarValor(torto, 5_000_00);
    expect(somaParcelas(r.conteudo)).toBe(totalConteudo(r.conteudo));
  });

  it('texto do histórico', () => {
    expect(textoReajuste({ antes: 10_000_00, depois: 9_500_00, percentual: -5 }, 3, 'fechar à vista')).toMatch(/R\$\s?10\.000,00 → R\$\s?9\.500,00 \(-5%\)\. Versão 3 .*Motivo: fechar à vista/);
  });
});
