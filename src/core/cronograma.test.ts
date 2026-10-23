import { describe, expect, it } from 'vitest';
import { desvioDias, limitesLinhaTempo, posicaoBarra, programarSequencial, semanasDoMes, type EtapaPlano } from './cronograma';

const e = (id: string, servico: string, ordem: number, dur: number, extra: Partial<EtapaPlano> = {}): EtapaPlano => ({
  id, servico_id: servico, ordem, duracao_dias: dur, depende_de: [], inicio_previsto: null, fim_previsto: null, estado: 'nao_iniciado', ...extra,
});

describe('programarSequencial', () => {
  it('encadeia etapas do mesmo serviço e pula domingos', () => {
    // 2026-10-23 é sexta.
    const r = programarSequencial([e('a', 's', 1, 2), e('b', 's', 2, 2)], '2026-10-23');
    expect(r.a).toEqual({ inicio: '2026-10-23', fim: '2026-10-24' });
    expect(r.b).toEqual({ inicio: '2026-10-26', fim: '2026-10-27' });
  });
  it('serviços diferentes começam juntos; dependência explícita espera', () => {
    const r = programarSequencial([e('a', 's1', 1, 3), e('b', 's2', 2, 1), e('c', 's2', 3, 1, { depende_de: ['a'] })], '2026-10-20', false);
    expect(r.b.inicio).toBe('2026-10-20');
    expect(r.c.inicio).toBe('2026-10-23');
  });
  it('mantém datas de etapas concluídas', () => {
    const r = programarSequencial([e('a', 's', 1, 5, { estado: 'executado', inicio_previsto: '2026-10-01', fim_previsto: '2026-10-02' }), e('b', 's', 2, 1)], '2026-10-01', false);
    expect(r.a.fim).toBe('2026-10-02');
    expect(r.b.inicio).toBe('2026-10-03');
  });
  it('acusa dependência circular', () => {
    expect(() => programarSequencial([e('a', 's', 1, 1, { depende_de: ['b'] }), e('b', 's', 2, 1, { depende_de: ['a'] })], '2026-10-01')).toThrow(/circular/);
  });
});

describe('linha do tempo', () => {
  it('régua e barras', () => {
    const r = limitesLinhaTempo(['2026-10-10', null, '2026-10-19'], 0)!;
    expect(r.dias).toBe(10);
    expect(posicaoBarra(r, '2026-10-10', '2026-10-14')).toEqual({ esquerda: 0, largura: 50 });
  });
  it('desvio em dias', () => {
    expect(desvioDias('2026-10-25', '2026-10-28')).toBe(3);
    expect(desvioDias(null, '2026-10-28')).toBeNull();
  });
  it('calendário começa na segunda', () => {
    const s = semanasDoMes(2026, 10);
    expect(s[0][0]).toBe('2026-09-28');
    expect(s.flat()).toContain('2026-10-31');
  });
});
