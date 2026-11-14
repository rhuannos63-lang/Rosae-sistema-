import { describe, expect, it } from 'vitest';
import { compararCategorias, montarCategorias, rotuloDiferenca, tipoPeloTexto, type FonteOrcamento } from './comparativo';
import type { Composicao, Insumo } from './composicao';
import type { Item } from './proposta';

const ins: Insumo[] = [
  { id: 'piso', codigo: 'MAT-030', nome: 'Porcelanato', tipo: 'material', unidade: 'm²', preco: 80, preco_basico: 50, preco_premium: 160, compra_unidade: null, compra_fator: null },
  { id: 'arg', codigo: 'MAT-031', nome: 'Argamassa AC-III', tipo: 'material', unidade: 'kg', preco: 1.5, preco_basico: 1.5, preco_premium: 1.5, compra_unidade: null, compra_fator: null },
  { id: 'rej', codigo: 'MAT-032', nome: 'Rejunte', tipo: 'material', unidade: 'kg', preco: 10, preco_basico: 10, preco_premium: 10, compra_unidade: null, compra_fator: null },
  { id: 'ped', codigo: 'MO-001', nome: 'Pedreiro', tipo: 'mao_de_obra', unidade: 'h', preco: 30, preco_basico: 30, preco_premium: 30, compra_unidade: null, compra_fator: null },
  { id: 'ser', codigo: 'MO-002', nome: 'Servente', tipo: 'mao_de_obra', unidade: 'h', preco: 20, preco_basico: 20, preco_premium: 20, compra_unidade: null, compra_fator: null },
];
const pisoComp: Composicao = {
  id: 'cp-piso', codigo: 'CP-020', nome: 'Assentamento de porcelanato', unidade: 'm²', grupo: 'Revestimento', metodologia: null, palavras_chave: ['piso'],
  varia_padrao: false, fator_mo_basico: 1, fator_mo_premium: 1,
  itens: [{ insumo_id: 'piso', coeficiente: 1 }, { insumo_id: 'arg', coeficiente: 5 }, { insumo_id: 'rej', coeficiente: 0.3 }, { insumo_id: 'ped', coeficiente: 0.5 }, { insumo_id: 'ser', coeficiente: 0.5 }],
};
const item = (id: string, titulo: string, total: number): Item => ({ id, titulo, unidade: 'm2', quantidade: 1, preco_unitario: total, total });

const fonte: FonteOrcamento = {
  conteudo: { ambientes: [{ id: 'a', nome: 'Sala', itens: [item('i1', 'Troca de piso', 9000), item('i2', 'Ar-condicionado split', 4000)] }] },
  custos: {
    composicoes: [{ id: 'u1', item_id: 'i1', composicao_id: 'cp-piso', quantidade: 40, perda_pct: 10 }],
    linhas: [{ descricao: 'Ar-condicionado split', valor: 2500 }, { descricao: 'Tubulação de cobre e suporte', valor: 600 }, { descricao: 'Caçamba', valor: 450 }],
  },
};

describe('comparativo orçado × fechado', () => {
  const cats = montarCategorias([fonte], { composicoes: [pisoComp], insumos: ins });

  it('agrupa os insumos da composição na categoria do serviço, com a mão de obra somada', () => {
    const piso = cats.find((c) => c.nome === 'Troca de piso')!;
    expect(piso.vendido).toBe(900000);
    expect(piso.linhas.map((l) => l.nome)).toEqual(['Porcelanato', 'Argamassa AC-III', 'Rejunte', 'Mão de obra']);
    expect(piso.linhas[0].orcado).toBe(Math.round(40 * 1.1 * 80 * 100)); // perda só no material
    expect(piso.linhas[3].orcado).toBe(40 * (0.5 * 30 + 0.5 * 20) * 100);
    expect(piso.linhas[3].detalhe).toBe('Pedreiro, Servente');
  });

  it('custo com o mesmo nome ou da mesma família entra no serviço; o resto vai para "Outros custos"', () => {
    const ar = cats.find((c) => c.nome === 'Ar-condicionado split')!;
    expect(ar.linhas.map((l) => [l.nome, l.orcado])).toEqual([['Tubulação de cobre e suporte', 60000], ['Custo previsto do serviço', 250000]]);
    const outros = cats.find((c) => c.nome === 'Outros custos do orçamento')!;
    expect(outros.linhas.map((l) => l.nome)).toEqual(['Caçamba']);
  });

  it('diferença só conta o que já foi fechado e mostra lucro ou prejuízo', () => {
    const piso = cats.find((c) => c.nome === 'Troca de piso')!;
    const [porc, arg, , mo] = piso.linhas;
    const r = compararCategorias(cats, {
      linhas: { [porc.id]: { valor: porc.orcado - 20000, fornecedor: 'Loja X' }, [mo.id]: { valor: mo.orcado + 5000, fornecedor: 'João' } },
    });
    const p = r.categorias.find((c) => c.id === piso.id)!;
    expect(p.situacao).toBe('parcial');
    expect(p.diferenca).toBe(20000 - 5000);
    expect(p.aFechar).toBe(arg.orcado + piso.linhas[2].orcado);
    expect(p.linhas[3].diferenca).toBe(-5000);
    expect(rotuloDiferenca(p.linhas[3].diferenca).texto).toBe('Prejuízo');
    expect(rotuloDiferenca(p.linhas[1].diferenca).texto).toBe('A fechar');
    expect(r.totais.comLucro).toBe(1);
  });

  it('pacote fecha a categoria inteira e substitui as linhas', () => {
    const ar = cats.find((c) => c.nome === 'Ar-condicionado split')!;
    const r = compararCategorias(cats, { pacotes: { [ar.id]: { valor: 300000, fornecedor: 'Clima Rio' } }, linhas: { [ar.linhas[0].id]: { valor: 1 } } });
    const a = r.categorias.find((c) => c.id === ar.id)!;
    expect(a.situacao).toBe('fechada');
    expect(a.fechado).toBe(300000);
    expect(a.diferenca).toBe(310000 - 300000);
    expect(a.linhas[0].fechado).toBeNull();
  });

  it('linha e categoria fora do orçamento entram como custo extra (prejuízo); dispensada conta como zero', () => {
    const piso = cats.find((c) => c.nome === 'Troca de piso')!;
    const r = compararCategorias(cats, {
      categorias: [{ id: 'm:1', nome: 'Imprevistos' }],
      extras: { 'm:1': [{ id: 'm:1:l', nome: 'Troca de registro', tipo: 'mao_de_obra', orcado: 0 }] },
      linhas: { 'm:1:l': { valor: 35000 } },
      dispensadas: [piso.linhas[2].id],
    });
    const imp = r.categorias.find((c) => c.id === 'm:1')!;
    expect(imp.manual).toBe(true);
    expect(imp.diferenca).toBe(-35000);
    const p = r.categorias.find((c) => c.id === piso.id)!;
    expect(p.linhas[2].fechado).toBe(0);
    expect(p.linhas[2].diferenca).toBe(piso.linhas[2].orcado);
    expect(r.totais.orcado).toBe(cats.reduce((t, c) => t + c.linhas.reduce((s, l) => s + l.orcado, 0), 0));
  });

  it('aditivo vira categorias próprias, sem misturar com o orçamento original', () => {
    const c2 = montarCategorias([fonte, { rotulo: 'Aditivo ADT-00002', conteudo: { ambientes: [{ id: 'b', nome: '', itens: [item('i1', 'Troca de piso', 1000)] }] }, custos: { linhas: [{ descricao: 'Troca de piso', valor: 700 }] } }], { composicoes: [pisoComp], insumos: ins });
    const pisos = c2.filter((c) => c.nome === 'Troca de piso');
    expect(pisos).toHaveLength(2);
    expect(pisos[1].origem).toBe('Aditivo ADT-00002');
    expect(pisos[1].id).not.toBe(pisos[0].id);
  });

  it('reconhece o tipo pelo texto do custo', () => {
    expect(tipoPeloTexto('Execução da reforma (mão de obra especializada)')).toBe('mao_de_obra');
    expect(tipoPeloTexto('Materiais padrão médio')).toBe('material');
    expect(tipoPeloTexto('Taxa da ART')).toBe('outro');
  });
});

describe('custo puxado para a categoria parecida', () => {
  it('aparelho split e tubulação de cobre vão para o ar-condicionado; caçamba fica em outros', () => {
    const f: FonteOrcamento = {
      conteudo: { ambientes: [{ id: 'a', nome: '', itens: [item('i1', 'Troca de piso', 9000), item('i2', 'Ar-condicionado 12.000 BTUs', 4000)] }] },
      custos: { linhas: [{ descricao: 'Aparelho split inverter', valor: 2200 }, { descricao: 'Tubulação de cobre e suporte', valor: 600 }, { descricao: 'Porcelanato 60x60', valor: 3000 }, { descricao: 'Caçamba', valor: 450 }] },
    };
    const cats = montarCategorias([f], { composicoes: [], insumos: [] });
    expect(cats.find((c) => c.id === 'item:i2')!.linhas.map((l) => l.nome)).toEqual(['Aparelho split inverter', 'Tubulação de cobre e suporte']);
    expect(cats.find((c) => c.id === 'item:i1')!.linhas.map((l) => l.nome)).toEqual(['Porcelanato 60x60']);
    expect(cats.find((c) => c.id === 'outros')!.linhas.map((l) => l.nome)).toEqual(['Caçamba']);
  });
});
