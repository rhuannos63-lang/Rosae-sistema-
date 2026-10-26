import { describe, expect, it } from 'vitest';
import { acumular, curvaS, datasDaCurva, escalaY, formatarCompacto, pesosNaObra, type EtapaCurva } from './graficos';

describe('escalaY', () => {
  it('inclui o zero e arredonda', () => {
    const e = escalaY([1200, 4800]);
    expect(e.min).toBe(0);
    expect(e.max).toBeGreaterThanOrEqual(4800);
    expect(e.marcas[0]).toBe(0);
  });
  it('aceita negativos', () => {
    const e = escalaY([-300, 900]);
    expect(e.min).toBeLessThanOrEqual(-300);
    expect(e.marcas).toContain(0);
  });
  it('tudo zero não quebra', () => {
    expect(escalaY([0, 0]).max).toBeGreaterThan(0);
  });
});

describe('formatarCompacto', () => {
  it('formata mil e milhão', () => {
    expect(formatarCompacto(123456)).toBe('R$ 1,2 mil');
    expect(formatarCompacto(3500000)).toBe('R$ 35 mil');
    expect(formatarCompacto(140000000)).toBe('R$ 1,4 mi');
    expect(formatarCompacto(-50000)).toBe('−R$ 500');
  });
});

describe('Curva S', () => {
  const e = (servico_id: string, peso: number, ini: string, fim: string, estado = 'programado'): EtapaCurva => ({
    servico_id, peso, estado, inicio_previsto: ini, fim_previsto: fim, inicio_base: null, fim_base: null,
  });
  it('pesos somam 1 e ignoram canceladas', () => {
    const et = [e('a', 1, '2026-01-01', '2026-01-10'), e('a', 3, '2026-01-11', '2026-01-20'), e('b', 1, '2026-01-01', '2026-01-05'), e('b', 1, '2026-01-01', '2026-01-05', 'cancelado')];
    const p = pesosNaObra(et, new Map([['a', 3], ['b', 1]]));
    expect(p[3]).toBe(0);
    expect(p.reduce((s, x) => s + x, 0)).toBeCloseTo(1);
    expect(p[1]).toBeCloseTo(0.75 * 0.75);
  });
  it('vai de 0 a 100 de forma crescente', () => {
    const et = [e('a', 1, '2026-01-01', '2026-01-10'), e('a', 1, '2026-01-11', '2026-01-20')];
    const p = pesosNaObra(et, new Map());
    const d = datasDaCurva('2025-12-30', '2026-01-22');
    const c = curvaS(et, p, d, 'previsto') as number[];
    expect(c[0]).toBe(0);
    expect(c[c.length - 1]).toBe(100);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
  });
  it('sem datas retorna nulo', () => {
    const et = [{ ...e('a', 1, '2026-01-01', '2026-01-10'), inicio_previsto: null }];
    expect(curvaS(et, [1], ['2026-01-01'], 'previsto')).toEqual([null]);
  });
  it('acumula', () => expect(acumular([1, 2, 3])).toEqual([1, 3, 6]));
});
