import { describe, expect, it } from 'vitest';
import { doBanco, paraBanco, lerDigitado, formatar, ratear, dividirEmParcelas, somar } from './dinheiro';

describe('dinheiro', () => {
  it('lê valores do banco sem erro de ponto flutuante', () => {
    expect(doBanco('1234.56')).toBe(123456);
    expect(doBanco(0.1)).toBe(10);
    expect(doBanco(0.29)).toBe(29); // 0.29 * 100 = 28.999999999999996 em float
    expect(doBanco('-10.5')).toBe(-1050);
    expect(doBanco('1.005')).toBe(101);
    expect(doBanco(null)).toBe(0);
    expect(doBanco('999999999999.99')).toBe(99999999999999);
  });

  it('envia para o banco como texto decimal', () => {
    expect(paraBanco(123456)).toBe('1234.56');
    expect(paraBanco(5)).toBe('0.05');
    expect(paraBanco(-1050)).toBe('-10.50');
  });

  it('entende o que se digita no Brasil', () => {
    expect(lerDigitado('1.234,56')).toBe(123456);
    expect(lerDigitado('R$ 10')).toBe(1000);
    expect(lerDigitado('10,5')).toBe(1050);
    expect(lerDigitado('10.50')).toBe(1050);
    expect(lerDigitado('1.500')).toBe(150000);
    expect(lerDigitado('abc')).toBeNull();
    expect(lerDigitado('1,234')).toBeNull();
    expect(lerDigitado('')).toBeNull();
  });

  it('formata em reais', () => {
    expect(formatar(123456)).toBe('R$ 1.234,56');
    expect(formatar(-500)).toBe('-R$ 5,00');
  });

  it('rateia pelo maior resto e a soma bate com o total', () => {
    expect(ratear(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(ratear(100, [1, 2])).toEqual([33, 67]);
    const partes = ratear(1_000_001, [3, 7, 11, 13]);
    expect(somar(partes)).toBe(1_000_001);
    expect(ratear(-1000, [1, 1, 1])).toEqual([-334, -333, -333]);
    expect(ratear(10, [99999999999999, 1])).toEqual([10, 0]);
  });

  it('divide em parcelas iguais', () => {
    expect(dividirEmParcelas(100000, 3)).toEqual([33334, 33333, 33333]);
    expect(() => dividirEmParcelas(100, 0)).toThrow();
  });

  it('recusa valores fora do NUMERIC(14,2)', () => {
    expect(() => doBanco('10000000000000.00')).toThrow();
    expect(lerDigitado('10.000.000.000.000,00')).toBeNull();
  });
});
