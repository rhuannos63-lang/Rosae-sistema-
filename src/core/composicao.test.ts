import { describe, expect, it } from 'vitest';
import { calcularComposicao, custoUnitario, fatorMaoDeObra, precoComBdi, quantidadeCompra, sugerirComposicoes, type Composicao, type Insumo } from './composicao';

const ins: Insumo[] = [
  { id: 'cim', codigo: 'MAT-001', nome: 'Cimento', tipo: 'material', unidade: 'kg', preco: 0.85, preco_basico: 0.85, preco_premium: 0.85, compra_unidade: 'saco 50 kg', compra_fator: 50 },
  { id: 'blo', codigo: 'MAT-004', nome: 'Bloco', tipo: 'material', unidade: 'un', preco: 1.6, preco_basico: 1.2, preco_premium: 2.4, compra_unidade: null, compra_fator: null },
  { id: 'are', codigo: 'MAT-002', nome: 'Areia', tipo: 'material', unidade: 'm³', preco: 140, preco_basico: 140, preco_premium: 140, compra_unidade: null, compra_fator: null },
  { id: 'ped', codigo: 'MO-001', nome: 'Pedreiro', tipo: 'mao_de_obra', unidade: 'h', preco: 29, preco_basico: 26, preco_premium: 38, compra_unidade: null, compra_fator: null },
  { id: 'vib', codigo: 'EQ-001', nome: 'Vibrador', tipo: 'equipamento', unidade: 'h', preco: 4, preco_basico: 4, preco_premium: 4, compra_unidade: null, compra_fator: null },
];
const alv: Composicao = { id: 'alv', codigo: 'CP-001', nome: 'Alvenaria', unidade: 'm²', grupo: 'Alvenaria', metodologia: null, palavras_chave: ['alvenaria', 'parede'], varia_padrao: true, fator_mo_basico: 0.9, fator_mo_premium: 1.25, itens: [{ insumo_id: 'blo', coeficiente: 25.5 }, { insumo_id: 'cim', coeficiente: 2 }, { insumo_id: 'are', coeficiente: 0.012 }, { insumo_id: 'ped', coeficiente: 0.75 }] };
const conc: Composicao = { id: 'con', codigo: 'CP-009', nome: 'Concreto', unidade: 'm³', grupo: 'Estrutura', metodologia: null, palavras_chave: ['concreto', 'laje'], varia_padrao: false, fator_mo_basico: 0.9, fator_mo_premium: 1.25, itens: [{ insumo_id: 'cim', coeficiente: 300 }, { insumo_id: 'ped', coeficiente: 1.5 }, { insumo_id: 'vib', coeficiente: 0.4 }] };

describe('composição de custos', () => {
  it('custo unitário separado por material, mão de obra e equipamento', () => {
    const p = custoUnitario(alv, new Map(ins.map((i) => [i.id, i])));
    expect(p.material).toBeCloseTo(25.5 * 1.6 + 2 * 0.85 + 0.012 * 140, 6);
    expect(p.mao_de_obra).toBeCloseTo(0.75 * 29, 6);
    expect(p.total).toBeCloseTo(p.material + p.mao_de_obra, 6);
  });

  it('perda entra só no material e os insumos somam entre serviços', () => {
    const r = calcularComposicao([
      { id: 'u1', item_id: 'i1', composicao_id: 'alv', quantidade: 10, perda_pct: 10 },
      { id: 'u2', item_id: 'i2', composicao_id: 'con', quantidade: 2, perda_pct: 0 },
    ], [alv, conc], ins);
    const cimento = r.insumos.find((l) => l.insumo.id === 'cim')!;
    expect(cimento.quantidade).toBeCloseTo(10 * 2 * 1.1 + 2 * 300, 6);
    expect(cimento.compra).toEqual({ quantidade: 13, unidade: 'saco 50 kg' }); // 622 kg
    const ped = r.insumos.find((l) => l.insumo.id === 'ped')!;
    expect(ped.quantidade).toBeCloseTo(10 * 0.75 + 2 * 1.5, 6); // sem perda na mão de obra
    expect(ped.compra).toBeNull();
    expect(r.porItem.get('i1')!.mao_de_obra).toBeCloseTo(217.5, 2);
    expect(r.total.total).toBeCloseTo(r.porItem.get('i1')!.total + r.porItem.get('i2')!.total, 2);
  });

  it('compra arredonda para cima na embalagem', () => {
    expect(quantidadeCompra(ins[0], 100)).toEqual({ quantidade: 2, unidade: 'saco 50 kg' });
    expect(quantidadeCompra(ins[0], 100.4)).toEqual({ quantidade: 3, unidade: 'saco 50 kg' });
    expect(quantidadeCompra(ins[1], 254.2)).toEqual({ quantidade: 255, unidade: 'un' });
    expect(quantidadeCompra(ins[2], 0.1234)).toEqual({ quantidade: 0.13, unidade: 'm³' });
  });

  it('BDI e sugestões por palavra-chave', () => {
    expect(precoComBdi(1000, 25)).toBe(1250);
    expect(sugerirComposicoes({ titulo: 'Paredes novas em alvenaria', unidade: 'm2' }, [conc, alv])[0].id).toBe('alv');
    expect(sugerirComposicoes({ titulo: 'Pintura' }, [conc, alv])).toEqual([]);
  });

  it('padrão de acabamento muda preço e tempo de mão de obra só nos serviços de acabamento', () => {
    const m = new Map(ins.map((i) => [i.id, i]));
    const basico = custoUnitario(alv, m, 'basico'), medio = custoUnitario(alv, m, 'medio'), premium = custoUnitario(alv, m, 'premium');
    expect(basico.total).toBeLessThan(medio.total);
    expect(premium.total).toBeGreaterThan(medio.total);
    expect(premium.mao_de_obra).toBeCloseTo(0.75 * 1.25 * 38, 6);
    expect(fatorMaoDeObra(conc, 'premium')).toBe(1);
    expect(custoUnitario(conc, m, 'premium').total).toBeCloseTo(custoUnitario(conc, m, 'basico').total, 6);
    // Na proposta: padrão geral premium, com um uso forçado no básico.
    const r = calcularComposicao([
      { id: 'u1', item_id: 'i1', composicao_id: 'alv', quantidade: 1, perda_pct: 0 },
      { id: 'u2', item_id: 'i2', composicao_id: 'alv', quantidade: 1, perda_pct: 0, padrao: 'basico' },
    ], [alv], ins, 'premium');
    expect(r.porItem.get('i1')!.total).toBeCloseTo(premium.total, 2);
    expect(r.porItem.get('i2')!.total).toBeCloseTo(basico.total, 2);
  });
});

describe('sugestões', () => {
  it('casa palavra inteira, não pedaço de palavra', () => {
    const forma = { id: 'f', codigo: 'CP-011', nome: 'Forma', unidade: 'm²', grupo: 'Estrutura', metodologia: null, palavras_chave: ['forma'], varia_padrao: false, fator_mo_basico: 0.9, fator_mo_premium: 1.25, itens: [] };
    expect(sugerirComposicoes({ titulo: 'Plano de reforma (NBR 16280)' }, [forma])).toEqual([]);
    expect(sugerirComposicoes({ titulo: 'Formas de pilares' }, [forma]).length).toBe(1);
  });
});
