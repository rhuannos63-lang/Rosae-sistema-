import { describe, expect, it } from 'vitest';
import { gerarParcelas, gerarComEntrada, validarPlano } from './parcelas';
import { somarMeses, periodo } from './datas';

describe('parcelas', () => {
  it('gera mensais com o último dia quando o mês é curto', () => {
    const p = gerarParcelas(100000, 3, '2026-01-31');
    expect(p.map((x) => x.vencimento)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(p.map((x) => x.valor)).toEqual([33334, 33333, 33333]);
    expect(validarPlano(100000, p)).toBeNull();
  });

  it('gera entrada + saldo', () => {
    const p = gerarComEntrada(1000000, 300000, 2, '2026-10-22', '2026-11-22');
    expect(p).toEqual([
      { numero: 1, valor: 300000, vencimento: '2026-10-22' },
      { numero: 2, valor: 350000, vencimento: '2026-11-22' },
      { numero: 3, valor: 350000, vencimento: '2026-12-22' },
    ]);
  });

  it('acusa plano que não soma o total', () => {
    expect(validarPlano(1000, [{ numero: 1, valor: 999, vencimento: '2026-10-01' }])).toMatch(/soma/);
  });

  it('calcula períodos', () => {
    expect(somarMeses('2026-12-15', 1)).toBe('2027-01-15');
    expect(periodo('mes', '2026-02-10')).toMatchObject({ inicio: '2026-02-01', fim: '2026-02-28' });
    expect(periodo('semestre', '2026-10-22')).toMatchObject({ inicio: '2026-07-01', fim: '2026-12-31' });
    expect(periodo('ano', '2026-10-22')).toMatchObject({ inicio: '2026-01-01', fim: '2026-12-31' });
  });
});
