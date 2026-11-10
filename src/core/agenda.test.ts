import { describe, expect, it } from 'vitest';
import { diaDaSemana, expandirTarefa, faixasDaSemana, gradeDoMes, moverPara, semana, tarefaNoDia, type Evento, type Tarefa } from './agenda';

const tarefa = (m: Partial<Tarefa> = {}): Tarefa => ({
  id: 't1', titulo: 'Conferir e-mails', notas: null, data: '2026-11-10', data_fim: null, hora: null, hora_fim: null, categoria: 'tarefa', prioridade: 2,
  repetir: 'nao', repetir_ate: null, concluida: false, concluidas: [], lembrete_min: null, obra_id: null, proposta_id: null, origem: 'manual', chave: null, ...m,
});
const ev = (id: string, inicio: string, fim = inicio): Evento => ({ id, fonte: 'tarefa', ref: id, titulo: id, inicio, fim, cor: 'tarefa', feito: false, atrasado: false, movivel: true });

describe('agenda', () => {
  it('semana começa na segunda', () => {
    expect(diaDaSemana('2026-11-10')).toBe(2); // terça
    expect(semana('2026-11-10')[0]).toBe('2026-11-09');
    expect(semana('2026-11-15')[6]).toBe('2026-11-15'); // domingo fecha a semana
  });

  it('grade do mês cobre o mês inteiro em semanas', () => {
    const g = gradeDoMes('2026-11-10');
    expect(g[0][0]).toBe('2026-10-26');
    expect(g[g.length - 1][6]).toBe('2026-12-06');
    expect(g.flat()).toContain('2026-11-30');
  });

  it('tarefas que se repetem', () => {
    expect(tarefaNoDia(tarefa({ repetir: 'dias_uteis' }), '2026-11-14')).toBe(false); // sábado
    expect(tarefaNoDia(tarefa({ repetir: 'semanal' }), '2026-11-17')).toBe(true);
    expect(tarefaNoDia(tarefa({ repetir: 'mensal', data: '2026-10-31' }), '2026-11-30')).toBe(true); // último dia do mês
    expect(tarefaNoDia(tarefa({ repetir: 'diaria', repetir_ate: '2026-11-12' }), '2026-11-13')).toBe(false);
    const evs = expandirTarefa(tarefa({ repetir: 'diaria', concluidas: ['2026-11-11'] }), '2026-11-09', '2026-11-12', '2026-11-10');
    expect(evs.map((e) => e.inicio)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);
    expect(evs[1].feito).toBe(true);
  });

  it('tarefa pendente de dia passado aparece como atrasada', () => {
    const [e] = expandirTarefa(tarefa({ data: '2026-11-01' }), '2026-11-10', '2026-11-16', '2026-11-10');
    expect(e.atrasado).toBe(true);
    expect(expandirTarefa(tarefa({ data: '2026-11-01', concluida: true }), '2026-11-10', '2026-11-16', '2026-11-10')).toEqual([]);
  });

  it('faixas de vários dias não se sobrepõem', () => {
    const dias = semana('2026-11-10');
    const f = faixasDaSemana([ev('a', '2026-11-08', '2026-11-11'), ev('b', '2026-11-10'), ev('c', '2026-11-12', '2026-11-20')], dias);
    const a = f.find((x) => x.e.id === 'a')!;
    const b = f.find((x) => x.e.id === 'b')!;
    const c = f.find((x) => x.e.id === 'c')!;
    expect([a.coluna, a.span, a.continuaAntes]).toEqual([0, 3, true]);
    expect(b.linha).not.toBe(a.linha);
    expect([c.coluna, c.span, c.continuaDepois, c.linha]).toEqual([3, 4, true, 0]);
  });

  it('arrastar mantém a duração', () => {
    expect(moverPara({ inicio: '2026-11-10', fim: '2026-11-14' }, '2026-11-28')).toEqual({ inicio: '2026-11-28', fim: '2026-12-02' });
  });
});
