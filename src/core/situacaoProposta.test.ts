import { describe, expect, it } from 'vitest';
import { contarSituacoes, detalheComCliente, situacaoDa, valorDe } from './situacaoProposta';

const HOJE = '2026-11-12';
const v = (numero: number, emitida: boolean, validade: string | null = '2026-11-20') => ({ numero, emitida, validade });

describe('situação real da proposta', () => {
  it('enviada dentro da validade aguarda o cliente; vencida aparece como vencida', () => {
    expect(situacaoDa({ estado: 'enviada', versoes: [v(1, true)] }, HOJE)).toBe('aguardando');
    expect(situacaoDa({ estado: 'enviada', versoes: [v(1, true, '2026-11-01')] }, HOJE)).toBe('vencida');
  });
  it('nova versão em preparo depois de enviada', () => {
    expect(situacaoDa({ estado: 'enviada', versoes: [v(1, true), v(2, false, null)] }, HOJE)).toBe('revisando');
  });
  it('pedido de ajuste é negociação; sem versão emitida é rascunho', () => {
    expect(situacaoDa({ estado: 'em_negociacao', versoes: [v(1, true)] }, HOJE)).toBe('ajuste');
    expect(situacaoDa({ estado: 'enviada', versoes: [v(1, false, null)] }, HOJE)).toBe('rascunho');
  });
  it('negócio perdido tira a proposta da conta em aberto; aprovada vale sempre', () => {
    expect(situacaoDa({ estado: 'enviada', versoes: [v(1, true)], negocio: 'perdido' }, HOJE)).toBe('recusada');
    expect(situacaoDa({ estado: 'aprovada', versoes: [v(1, true, '2026-01-01')], negocio: 'perdido' }, HOJE)).toBe('aprovada');
  });
  it('duas enviadas sem aprovação contam duas', () => {
    const c = contarSituacoes([
      { situacao: situacaoDa({ estado: 'enviada', versoes: [v(1, true)] }, HOJE), valor: 1000 },
      { situacao: situacaoDa({ estado: 'em_negociacao', versoes: [v(1, true)] }, HOJE), valor: 500 },
      { situacao: 'rascunho', valor: 9 },
      { situacao: 'aprovada', valor: 7 },
    ]);
    expect(c.comCliente).toEqual({ qtd: 2, valor: 1500 });
    expect(c.emAberto.qtd).toBe(3);
    expect(detalheComCliente(c)).toBe('1 aguardando · 1 em negociação');
  });
  it('valor: aprovado, senão o enviado, senão o rascunho', () => {
    const vs = [{ id: 'a', numero: 1, emitida: true, valor: 100 }, { id: 'b', numero: 2, emitida: false, valor: 80 }];
    expect(valorDe(vs)).toBe(100);
    expect(valorDe([{ numero: 1, emitida: false, valor: 80 }])).toBe(80);
    expect(valorDe([...vs, { id: 'c', numero: 3, emitida: true, valor: 90 }], 'a')).toBe(100);
  });
});
