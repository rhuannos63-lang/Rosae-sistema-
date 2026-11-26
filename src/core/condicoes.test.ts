import { describe, expect, it } from 'vitest';
import { acrescimoDas, alternarCodigo, codigosDe, gruposDe, textoAcrescimo, type CondicaoObra } from './condicoes';
import { calcularComposicao, type Composicao, type Insumo } from './composicao';

const base: CondicaoObra[] = [
  { id: '1', codigo: 'AC-03', grupo: 'Acesso', nome: 'Material pela escada', descricao: null, mao_de_obra_pct: 12, material_pct: 3, ordem: 30, ativo: true },
  { id: '2', codigo: 'HO-01', grupo: 'Horários', nome: 'Horário reduzido', descricao: null, mao_de_obra_pct: 10, material_pct: 0, ordem: 110, ativo: true },
  { id: '3', codigo: 'XX-01', grupo: 'Acesso', nome: 'Desativada', descricao: null, mao_de_obra_pct: 50, material_pct: 50, ordem: 1, ativo: false },
];

describe('condições da obra', () => {
  it('soma os percentuais das marcadas e ignora as inativas', () => {
    const a = acrescimoDas(['AC-03', 'HO-01', 'XX-01', 'nao-existe'], base);
    expect(a).toEqual({ mao_de_obra_pct: 22, material_pct: 3, nomes: ['Material pela escada', 'Horário reduzido'] });
    expect(textoAcrescimo(a)).toBe('+22% na mão de obra e +3% no material');
    expect(acrescimoDas([], base).mao_de_obra_pct).toBe(0);
  });

  it('lê e alterna os códigos guardados', () => {
    expect(codigosDe('AC-03, HO-01')).toEqual(['AC-03', 'HO-01']);
    expect(codigosDe(null)).toEqual([]);
    expect(alternarCodigo(['AC-03'], 'HO-01')).toEqual(['AC-03', 'HO-01']);
    expect(alternarCodigo(['AC-03', 'HO-01'], 'AC-03')).toEqual(['HO-01']);
  });

  it('agrupa só as ativas, na ordem', () => {
    expect(gruposDe(base).map((g) => [g.grupo, g.itens.map((i) => i.codigo)])).toEqual([['Acesso', ['AC-03']], ['Horários', ['HO-01']]]);
  });

  it('acréscimo entra no custo sem mudar a quantidade de material', () => {
    const ins: Insumo[] = [
      { id: 'blo', codigo: 'M', nome: 'Bloco', tipo: 'material', unidade: 'un', preco: 2, preco_basico: 2, preco_premium: 2, compra_unidade: null, compra_fator: null },
      { id: 'ped', codigo: 'P', nome: 'Pedreiro', tipo: 'mao_de_obra', unidade: 'h', preco: 30, preco_basico: 30, preco_premium: 30, compra_unidade: null, compra_fator: null },
    ];
    const c: Composicao = { id: 'c', codigo: 'CP', nome: 'Alvenaria', unidade: 'm²', grupo: 'A', metodologia: null, palavras_chave: [], varia_padrao: false, fator_mo_basico: 0.9, fator_mo_premium: 1.25, itens: [{ insumo_id: 'blo', coeficiente: 25 }, { insumo_id: 'ped', coeficiente: 1 }] };
    const usos = [{ id: 'u', item_id: 'i', composicao_id: 'c', quantidade: 10, perda_pct: 0 }];
    const sem = calcularComposicao(usos, [c], ins);
    const com = calcularComposicao(usos, [c], ins, 'medio', acrescimoDas(['AC-03', 'HO-01'], base));
    expect(sem.total.total).toBe(800);
    expect(com.total.material).toBeCloseTo(500 * 1.03, 2);
    expect(com.total.mao_de_obra).toBeCloseTo(300 * 1.22, 2);
    expect(com.acrescimoCondicoes).toBeCloseTo(15 + 66, 2);
    expect(com.insumos.find((l) => l.insumo.id === 'blo')!.quantidade).toBe(250);
  });
});

import { gerarOrcamento, gerarOrcamentoServicos, respostasPadrao } from './orcamento';

describe('condições no orçamento automático', () => {
  const r = { ...respostasPadrao('reforma'), area: 40 };
  it('reforma ganha a linha de logística e a premissa', () => {
    const sem = gerarOrcamento('reforma', r, {}, 2, { condicoes: base });
    const com = gerarOrcamento('reforma', { ...r, condicoes: 'AC-03,HO-01' }, {}, 2, { condicoes: base });
    const linha = com.principal.linhas.find((l) => l.titulo === 'Logística e condições do local')!;
    expect(linha).toBeTruthy();
    expect(linha.descricao).toContain('material pela escada e horário reduzido');
    // 22% de mão de obra × 55% + 3% de material × 45% = 13,45% sobre a execução
    const sub = sem.principal.linhas.reduce((t, l) => t + l.valor, 0);
    expect(Math.abs(linha.valor - sub * 0.1345)).toBeLessThanOrEqual(10);
    expect(com.principal.valor).toBeGreaterThan(sem.principal.valor);
    expect(com.conteudo.premissas.some((p) => p.includes('condições do local'))).toBe(true);
  });
  it('projeto não muda com as condições', () => {
    const rp = { ...respostasPadrao('projeto_estrutural'), area: 120, condicoes: 'AC-04' };
    const o = gerarOrcamento('projeto_estrutural', rp, {}, 2, { condicoes: base });
    expect(o.principal.linhas.some((l) => l.titulo.startsWith('Logística'))).toBe(false);
  });
  it('em vários serviços, só a execução recebe o acréscimo', () => {
    const o = gerarOrcamentoServicos([
      { tipo: 'projeto_estrutural', respostas: { ...respostasPadrao('projeto_estrutural'), area: 80, condicoes: 'AC-03' } },
      { tipo: 'reforma', respostas: r },
    ], {}, 2, { condicoes: base });
    const log = o.principal.linhas.filter((l) => l.titulo.startsWith('Logística'));
    expect(log.length).toBe(1);
    expect(log[0].servico).toBe(1);
  });
});

describe('imóvel ocupado não soma duas vezes', () => {
  it('na reforma a pergunta própria já cobre a condição', () => {
    const cond: CondicaoObra[] = [{ id: 'o', codigo: 'IM-01', grupo: 'Imóvel', nome: 'Imóvel ocupado', descricao: null, mao_de_obra_pct: 12, material_pct: 2, ordem: 1, ativo: true }];
    const r = { ...respostasPadrao('reforma'), area: 40, condicoes: 'IM-01' };
    const o = gerarOrcamento('reforma', r, {}, 2, { condicoes: cond });
    expect(o.principal.linhas.some((l) => l.titulo.startsWith('Logística'))).toBe(false);
    const c = gerarOrcamento('construcao', { ...respostasPadrao('construcao'), area: 100, condicoes: 'IM-01' }, {}, 2, { condicoes: cond });
    expect(c.principal.linhas.some((l) => l.titulo.startsWith('Logística'))).toBe(true);
  });
});
