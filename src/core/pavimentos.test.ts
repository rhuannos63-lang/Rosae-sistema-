import { describe, expect, it } from 'vitest';
import { andaresDaReforma, gerarOrcamento, parametrosPadrao, respostasPadrao } from './orcamento';
import { conteudoVazio, pavimentos, prepararParaSalvar, somaParcelas, temPavimentos, tituloGrupo, totalConteudo, type Conteudo } from './proposta';

const item = (titulo: string, valor: number, onde = '') => ({ id: titulo, titulo, onde, descricao: '', unidade: 'vb', quantidade: 1, preco_unitario: valor, total: valor });

describe('proposta por pavimento', () => {
  const c: Conteudo = {
    ...conteudoVazio(),
    ambientes: [
      { id: 'a', nome: 'Pintura', pavimento: '1º andar', itens: [item('Estar', 2962.7), item('Jantar', 2519.4)] },
      { id: 'b', nome: 'Área externa e fachadas', pavimento: 'Área externa e fachadas', itens: [item('Pintura externa', 14493.05, 'Fachadas')] },
      { id: 'c', nome: 'Teto e cozinha', pavimento: '1º andar', itens: [item('Teto', 1071.6, 'Estar e jantar')] },
      { id: 'd', nome: 'Avulso', itens: [item('Visita', 100)] },
    ],
  };

  it('agrupa por andar na ordem da primeira aparição e soma o total de cada um', () => {
    expect(temPavimentos(c)).toBe(true);
    const p = pavimentos(c);
    expect(p.map((x) => x.nome)).toEqual(['1º andar', 'Área externa e fachadas', 'Outros serviços']);
    expect(p[0].grupos.map((g) => g.amb.nome)).toEqual(['Pintura', 'Teto e cozinha']);
    expect(p[0].total).toBe(655370);
    expect(p.reduce((t, x) => t + x.total, 0)).toBe(totalConteudo(c));
  });

  it('título do grupo junta andar e nome sem repetir', () => {
    expect(tituloGrupo(c.ambientes[0])).toBe('1º andar · Pintura');
    expect(tituloGrupo(c.ambientes[1])).toBe('Área externa e fachadas');
    expect(tituloGrupo({ nome: 'Serviços', pavimento: '2º andar' })).toBe('2º andar');
    expect(tituloGrupo(c.ambientes[3])).toBe('Avulso');
  });

  it('proposta sem andar continua como antes', () => {
    expect(temPavimentos({ ambientes: [c.ambientes[3]] })).toBe(false);
  });
});

describe('reforma por andar no orçamento automático', () => {
  const r = { ...respostasPadrao('reforma'), area: null, pavimentos: 4, areas_andar: '56; 50; 55; 18', servicos_andar: '1º: pintura e piso da entrada; 2º: pintura e laminado; 3º: varanda e forro; caixa d\'água' };

  it('lê andares, áreas e o que será feito', () => {
    const a = andaresDaReforma(r);
    expect(a.map((x) => x.area)).toEqual([56, 50, 55, 18]);
    expect(a[0].servicos).toBe('pintura e piso da entrada');
    expect(a[3].nome).toBe('4º andar');
    expect(andaresDaReforma({ ...r, pavimentos: 1 })).toEqual([]);
  });

  it('divide a área total igualmente quando as áreas não foram informadas', () => {
    expect(andaresDaReforma({ pavimentos: 2, area: 100 }).map((x) => x.area)).toEqual([50, 50]);
  });

  it('gera um grupo por andar, com valor proporcional à área, e fecha totais e parcelas', () => {
    const o = gerarOrcamento('reforma', r, parametrosPadrao('reforma'));
    const c = prepararParaSalvar(o.conteudo).conteudo;
    const p = pavimentos(c);
    expect(p.map((x) => x.nome)).toEqual(['1º andar', '2º andar', '3º andar', '4º andar', 'Todos os andares']);
    expect(p[0].total).toBeGreaterThan(p[3].total);
    expect(c.ambientes[0].itens[0].descricao).toMatch(/^Pintura e piso da entrada em 56 m²/);
    expect(c.ambientes[0].itens[0].etapas?.length).toBeGreaterThan(0);
    expect(c.ambientes[1].itens[0].etapas).toBeUndefined();
    expect(totalConteudo(c)).toBe(Math.round(o.principal.valor * 100));
    expect(somaParcelas(c)).toBe(totalConteudo(c));
  });
});
