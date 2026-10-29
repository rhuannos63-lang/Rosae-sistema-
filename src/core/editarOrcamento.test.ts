import { describe, expect, it } from 'vitest';
import { gerarOrcamento, parametrosPadrao, respostasPadrao, TIPOS, type TipoServico } from './orcamento';
import {
  acompanharTotal, ajustarTotal, atualizarAvista, conteudoVazio, parcelasAoTotal, pendencias, prepararParaSalvar, somaParcelas, totalConteudo,
  type Conteudo,
} from './proposta';

const resp = (t: TipoServico) => ({ ...respostasPadrao(t), area: 180 } as ReturnType<typeof respostasPadrao>);

describe('meu preço no orçamento automático', () => {
  it.each(TIPOS)('%s: o valor definido vira o total exato, com parcelas fechando', (t) => {
    const p = parametrosPadrao(t);
    const calc = gerarOrcamento(t, resp(t), p, 2);
    const alvo = Math.round(calc.principal.valor * 1.137) + 0.45;
    const o = gerarOrcamento(t, resp(t), p, 2, { valores: { [calc.principal.numero]: alvo } });
    const c = prepararParaSalvar(o.conteudo).conteudo;
    expect(o.principal.valor).toBe(alvo);
    expect(o.principal.calculado).toBe(calc.principal.valor);
    expect(totalConteudo(c)).toBe(Math.round(alvo * 100));
    expect(somaParcelas(c)).toBe(totalConteudo(c));
    expect(pendencias(c)).toEqual([]);
    expect(c.opcoes?.find((x) => x.principal)?.valor ?? alvo).toBe(alvo);
    expect(c.gerador?.valores).toEqual({ [calc.principal.numero]: alvo });
  });

  it('só o pacote ajustado muda; margem recalcula com o novo preço', () => {
    const t = 'projeto_estrutural';
    const calc = gerarOrcamento(t, resp(t), parametrosPadrao(t), 2);
    const o = gerarOrcamento(t, resp(t), parametrosPadrao(t), 2, { valores: { 2: 20000 } });
    expect(o.pacotes[0].valor).toBe(calc.pacotes[0].valor);
    expect(o.pacotes[2].valor).toBe(calc.pacotes[2].valor);
    expect(o.analise.custo).toBe(calc.analise.custo);
    expect(o.analise.margem).toBe(20000 - o.analise.custo);
  });
});

function exemplo(): Conteudo {
  const c = conteudoVazio();
  c.prazo_texto = '30 dias';
  c.ambientes = [{ id: 'a', nome: 'Escopo', itens: [
    { id: '1', titulo: 'Projeto', unidade: 'm2', quantidade: 180, preco_unitario: 46.5, fator: 1, total: 0 },
    { id: '2', titulo: 'Visitas', unidade: 'visita', quantidade: 3, preco_unitario: 450, total: 0 },
    { id: '3', titulo: 'ART', unidade: 'vb', quantidade: 1, preco_unitario: 99.64, total: 0 },
  ] }];
  const t = totalConteudo(c) / 100;
  c.pagamento = { descricao: 'Entrada + 2. Pix. À vista: R$ 9.290,00 (5% de desconto).', parcelas: [
    { descricao: 'Entrada', valor: Math.round(t * 30) / 100 }, { descricao: 'P1', valor: Math.round(t * 35) / 100 },
    { descricao: 'P2', valor: Math.round((t - Math.round(t * 30) / 100 - Math.round(t * 35) / 100) * 100) / 100 },
  ] };
  c.opcoes = [{ nome: 'Essencial', subtitulo: '', valor: 5000, destaques: [], recomendado: false, principal: false }, { nome: 'Completo', subtitulo: '', valor: t, destaques: [], recomendado: true, principal: true }];
  c.condicao_especial = 'Pagamento à vista com 5% de desconto: R$ 9.290,00, para aceite dentro da validade.';
  return c;
}

describe('editar orçamento pronto', () => {
  it('mudar o total reparte entre os itens e fecha ao centavo', () => {
    const c = exemplo();
    expect(somaParcelas(c)).toBe(totalConteudo(c));
    const d = ajustarTotal(c, 1_234_567);
    expect(totalConteudo(d)).toBe(1_234_567);
    expect(somaParcelas(d)).toBe(1_234_567);
    expect(pendencias(d)).toEqual([]);
    // Quem não é verba mantém quantidade e unidade; a sobra de centavos vai para o item de quantidade 1.
    expect(d.ambientes[0].itens[0]).toMatchObject({ quantidade: 180, unidade: 'm2' });
    expect(d.ambientes[0].itens[1]).toMatchObject({ quantidade: 3, unidade: 'visita' });
    expect(d.opcoes?.find((o) => o.principal)?.valor).toBe(12345.67);
    expect(d.opcoes?.find((o) => !o.principal)?.valor).toBe(5000);
    expect(d.condicao_especial).toContain('11.730,00');
    expect(d.pagamento.descricao).toContain('À vista: R$');
    expect(d.pagamento.descricao).toContain('11.730,00 (5% de desconto)');
  });

  it('sem item de quantidade 1, o maior vira verba para fechar o valor', () => {
    const c = exemplo();
    c.ambientes[0].itens = c.ambientes[0].itens.slice(0, 2);
    const d = ajustarTotal(c, 1_000_001);
    expect(totalConteudo(d)).toBe(1_000_001);
    expect(d.ambientes[0].itens[0]).toMatchObject({ quantidade: 1, unidade: 'vb' });
  });

  it('inserir item leva as parcelas junto; parcelas que já não fechavam ficam como estão', () => {
    const c = exemplo();
    const comItem: Conteudo = { ...c, ambientes: [{ ...c.ambientes[0], itens: [...c.ambientes[0].itens, { id: '4', titulo: 'Extra', unidade: 'vb', quantidade: 1, preco_unitario: 1000, total: 0 }] }] };
    const d = acompanharTotal(c, comItem);
    expect(somaParcelas(d)).toBe(totalConteudo(d));
    expect(totalConteudo(d)).toBe(totalConteudo(c) + 100000);

    const torto = { ...c, pagamento: { ...c.pagamento, parcelas: [{ descricao: 'Única', valor: 10 }] } };
    const e = acompanharTotal(torto, { ...comItem, pagamento: torto.pagamento });
    expect(e.pagamento.parcelas[0].valor).toBe(10);
    expect(somaParcelas(parcelasAoTotal(e))).toBe(totalConteudo(e));
  });

  it('valor à vista acompanha o total e o texto sem desconto não muda', () => {
    expect(atualizarAvista('Pix. À vista: R$ 1.000,00 (10% de desconto).', 200000)).toBe('Pix. À vista: R$ 1.800,00 (10% de desconto).');
    expect(atualizarAvista('Pix ou transferência.', 200000)).toBe('Pix ou transferência.');
  });
});
