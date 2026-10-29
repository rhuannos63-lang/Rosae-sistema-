import { describe, expect, it } from 'vitest';
import { notaDaLeitura, valorFinal } from './nfe';

const base = { incertos: [] as string[], itens: [{ descricao: 'Cimento CP-II 50 kg', quantidade: 10, unidade: 'SC', valor_total: 389.9 }, { descricao: 'Areia média', quantidade: 2, unidade: 'M3', valor_total: 260 }] };

describe('nota lida por foto ou PDF', () => {
  it('soma fecha com o total e frete/desconto são rateados', () => {
    const n = notaDaLeitura({ ...base, emitente_nome: 'Depósito Fictício', emitente_documento: '12.345.678/0001-90', numero: '1234', total: 679.9, frete: 40, desconto: 10 });
    expect(n.totais.total).toBe(67990);
    expect(n.itens.reduce((s, i) => s + valorFinal(i), 0)).toBe(67990);
    expect(n.itens.reduce((s, i) => s + i.frete, 0)).toBe(4000);
    expect(n.emitente.documento).toBe('12345678000190');
    expect(n.avisos[0]).toContain('Lida pela IA');
  });

  it('diferença entre itens e total vira aviso, nunca some', () => {
    const n = notaDaLeitura({ ...base, total: 700 });
    expect(n.itens.reduce((s, i) => s + valorFinal(i), 0)).toBe(70000);
    expect(n.avisos.some((a) => a.includes('abaixo do total'))).toBe(true);
  });

  it('chave inválida fica em branco e incertos viram avisos', () => {
    const n = notaDaLeitura({ ...base, total: 649.9, chave: '1'.repeat(44), incertos: ['número da nota cortado'] });
    expect(n.chave).toBeNull();
    expect(n.avisos.some((a) => a.includes('número da nota cortado'))).toBe(true);
  });

  it('sem itens lidos entra um item único; sem total dá erro', () => {
    const n = notaDaLeitura({ itens: [], incertos: [], total: 150 });
    expect(n.itens).toHaveLength(1);
    expect(n.itens[0].valor_bruto).toBe(15000);
    expect(() => notaDaLeitura({ itens: [], incertos: [] })).toThrow();
  });
});
