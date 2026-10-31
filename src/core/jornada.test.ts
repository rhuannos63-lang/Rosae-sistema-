import { describe, expect, it } from 'vitest';
import { calcularJornada, faseAtual, perfilDaObra, PERFIS } from './jornada';
import type { EtapaPortal } from './portal';

let n = 0;
const etapa = (nome: string, estado: EtapaPortal['estado'], percentual = 0): EtapaPortal => ({
  id: `e${++n}`, servico_id: 's', nome, estado, percentual, ordem: n, inicio_previsto: null, fim_previsto: null, inicio_real: null, fim_real: null,
});

describe('perfil da obra', () => {
  it('usa o tipo do orçamento automático quando existe', () => {
    expect(perfilDaObra('Construção', 'projeto_estrutural')).toBe('projeto');
    expect(perfilDaObra(null, 'pericia')).toBe('laudo');
  });
  it('lê o tipo de serviço escrito na obra', () => {
    expect(perfilDaObra('Reforço estrutural (metálico)')).toBe('reforco');
    expect(perfilDaObra('Projeto estrutural')).toBe('projeto');
    expect(perfilDaObra('Reforma')).toBe('reforma');
    expect(perfilDaObra('Laudo / vistoria')).toBe('laudo');
    expect(perfilDaObra('Gestão de obra')).toBe('gestao');
    expect(perfilDaObra('Acompanhamento técnico')).toBe('gestao');
    expect(perfilDaObra(null)).toBe('construcao');
  });
  it('todo perfil tem fases com textos para o cliente', () => {
    for (const p of Object.values(PERFIS)) {
      expect(p.fases.length).toBeGreaterThanOrEqual(5);
      for (const f of p.fases) expect(f.agora.length).toBeGreaterThan(20);
    }
  });
});

describe('jornada', () => {
  it('liga as etapas às fases pelo nome', () => {
    const fases = calcularJornada('construcao', [
      etapa('Serviços preliminares e fundação', 'conferido'),
      etapa('Estrutura', 'em_execucao', 40),
      etapa('Alvenaria e cobertura', 'nao_iniciado'),
      etapa('Revestimentos e acabamentos', 'nao_iniciado'),
    ], 30);
    expect(fases.map((f) => f.estado)).toEqual(['concluida', 'atual', 'futura', 'futura', 'futura', 'futura']);
    expect(fases[1].progresso).toBe(40);
    expect(faseAtual(fases)).toBe(1);
  });
  it('fase sem etapa entre fases começadas conta como passada', () => {
    const fases = calcularJornada('reforma', [etapa('Demolição', 'executado'), etapa('Pintura', 'em_execucao', 50)], 60);
    expect(fases.map((f) => f.estado)).toEqual(['concluida', 'concluida', 'concluida', 'atual', 'futura']);
  });
  it('etapa de nome desconhecido não volta para uma fase anterior', () => {
    const fases = calcularJornada('projeto', [etapa('Cálculo', 'executado'), etapa('Etapa X', 'em_execucao', 10)], 50);
    const ix = fases.findIndex((f) => f.etapas.some((e) => e.nome === 'Etapa X'));
    expect(ix).toBeGreaterThanOrEqual(2);
  });
  it('"art" só conta como palavra inteira', () => {
    const fases = calcularJornada('projeto', [etapa('Visita de partida', 'executado')], 10);
    expect(fases[0].etapas).toHaveLength(1);
  });
  it('sem etapas publicadas, segue o percentual geral', () => {
    const fases = calcularJornada('laudo', [], 50);
    expect(fases.map((f) => f.estado)).toEqual(['concluida', 'concluida', 'atual', 'futura', 'futura']);
    expect(Math.round(fases[2].progresso)).toBe(50);
  });
});
