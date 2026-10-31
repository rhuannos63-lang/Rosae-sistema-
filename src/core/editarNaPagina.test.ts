import { describe, expect, it } from 'vitest';
import { gerarOrcamento, parametrosPadrao, respostasPadrao, TIPOS, type TipoServico } from './orcamento';
import { alternarPagina, definirTotalItem, mudarItem, paginaOculta, paraCentavos, somaParcelas, totalConteudo, totalItem, type Item } from './proposta';

const resp = (t: TipoServico) => ({ ...respostasPadrao(t), area: 180 } as ReturnType<typeof respostasPadrao>);
const item = (x: Partial<Item>): Item => ({ id: 'i', titulo: 'Item', unidade: 'm2', quantidade: 10, preco_unitario: 50, total: 500, ...x });

describe('editar o valor de uma linha direto na página', () => {
  it('mantém quantidade e muda o preço unitário quando a conta fecha', () => {
    const n = definirTotalItem(item({}), 80000);
    expect(n.quantidade).toBe(10);
    expect(n.preco_unitario).toBe(80);
    expect(paraCentavos(totalItem(n))).toBe(80000);
  });
  it('vira verba quando nenhum preço unitário fecha ao centavo', () => {
    const n = definirTotalItem(item({ quantidade: 3 }), 100000);
    expect(n.unidade).toBe('vb');
    expect(n.quantidade).toBe(1);
    expect(paraCentavos(totalItem(n))).toBe(100000);
  });
  it('considera o fator de complexidade', () => {
    const n = definirTotalItem(item({ fator: 1.2, complexidade: 'Média' }), 72000);
    expect(paraCentavos(totalItem(n))).toBe(72000);
    expect(n.complexidade).toBe('Média');
  });
  it.each(TIPOS)('%s: parcelas e pacote acompanham o novo total', (t) => {
    const c = gerarOrcamento(t, resp(t), parametrosPadrao(t), 2).conteudo;
    const antes = totalConteudo(c);
    const atual = paraCentavos(totalItem(c.ambientes[0].itens[0]));
    const d = mudarItem(c, 0, 0, (i) => definirTotalItem(i, atual + 123456));
    expect(totalConteudo(d)).toBe(antes + 123456);
    if (d.pagamento.parcelas.length) expect(somaParcelas(d)).toBe(totalConteudo(d));
    const principal = d.opcoes?.find((o) => o.principal);
    if (principal) expect(paraCentavos(principal.valor)).toBe(totalConteudo(d));
  });
});

describe('tirar páginas da apresentação', () => {
  const c = gerarOrcamento('reforma', resp('reforma'), parametrosPadrao('reforma'), 2).conteudo;
  it('tira e devolve uma página opcional', () => {
    const a = alternarPagina(c, 'faq');
    expect(paginaOculta(a, 'faq')).toBe(true);
    expect(paginaOculta(alternarPagina(a, 'faq'), 'faq')).toBe(false);
  });
  it('não tira páginas obrigatórias', () => {
    for (const id of ['capa', 'escopo', 'incluso', 'investimento', 'pagamento', 'premissas', 'aceite']) {
      expect(paginaOculta(alternarPagina(c, id), id)).toBe(false);
      expect(paginaOculta({ paginas_ocultas: [id] }, id)).toBe(false);
    }
  });
});
