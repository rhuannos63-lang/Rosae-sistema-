import { describe, expect, it } from 'vitest';
import { agruparRecebimentos, faltaReceber, percentualRecebido } from './recebimentos';

const mov = (id: string, valor: string, chave: string | null, estornado = false) =>
  ({ id, data: '2026-11-05', valor, descricao: 'PIX', conta_nome: 'Conta principal', estornado, chave_idempotencia: chave, criado_em: '2026-11-05T12:00:00Z' });

describe('fechado × recebido', () => {
  it('calcula o que falta e o percentual', () => {
    expect(faltaReceber({ fechado: '10000.00', recebido: '3000.00' })).toBe(700000);
    expect(faltaReceber({ fechado: '10000.00', recebido: '11000.00' })).toBe(0);
    expect(percentualRecebido({ fechado: '10000.00', recebido: '3000.00' })).toBe(30);
    expect(percentualRecebido({ fechado: '0', recebido: '0' })).toBe(0);
  });

  it('junta as partes de um mesmo recebimento abatido em várias parcelas', () => {
    const g = agruparRecebimentos([mov('a', '2000.00', 'k1:1'), mov('b', '5000.00', 'k1:2'), mov('c', '1000.00', 'k1:3'), mov('d', '300.00', 'outra-chave')]);
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ chave: 'k1', valor: 800000, ids: ['a', 'b', 'c'], estornado: false });
    expect(g[1]).toMatchObject({ chave: 'd', valor: 30000 });
  });

  it('marca como desfeito só quando todas as partes foram estornadas', () => {
    expect(agruparRecebimentos([mov('a', '10', 'k:1', true), mov('b', '10', 'k:2', true)])[0].estornado).toBe(true);
    const parcial = agruparRecebimentos([mov('a', '10', 'k:1', true), mov('b', '10', 'k:2')])[0];
    expect(parcial.estornado).toBe(false);
    expect(parcial.ids).toEqual(['b']);
  });
});
