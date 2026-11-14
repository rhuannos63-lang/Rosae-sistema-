import { describe, expect, it } from 'vitest';
import { calcularJornada, PERFIS, type Perfil } from './jornada';
import type { EtapaPortal } from './portal';
import { diasAte, doTrabalho, emQuanto, haQuanto, linhaDoTempo, proximoMarco, SERVICO, seuTrabalho } from './portalServico';

let n = 0;
const etapa = (nome: string, estado: EtapaPortal['estado'], ini: string | null, fim: string | null, percentual = 0): EtapaPortal => ({
  id: `e${++n}`, servico_id: 's', nome, estado, percentual, ordem: n, inicio_previsto: ini, fim_previsto: fim, inicio_real: null, fim_real: null,
});

describe('conteúdo por tipo de serviço', () => {
  it('todo perfil tem texto de participação para cada fase, pedidos, dúvidas e termos', () => {
    for (const [perfil, def] of Object.entries(PERFIS) as [Perfil, (typeof PERFIS)[Perfil]][]) {
      const c = SERVICO[perfil];
      for (const f of def.fases) expect(c.voce[f.id], `${perfil}/${f.id}`).toBeTruthy();
      expect(Object.keys(c.voce).every((id) => def.fases.some((f) => f.id === id))).toBe(true);
      expect(c.pedimos.length).toBeGreaterThanOrEqual(3);
      expect(c.duvidas.length).toBeGreaterThanOrEqual(3);
      expect(c.termos.length).toBeGreaterThanOrEqual(3);
      if (c.campo) expect(c.cuidados.length).toBeGreaterThan(0);
    }
  });
  it('vocabulário: obra, projeto, laudo, processo', () => {
    expect(seuTrabalho('construcao')).toBe('sua obra');
    expect(seuTrabalho('projeto')).toBe('seu projeto');
    expect(doTrabalho('laudo')).toBe('do laudo');
    expect(doTrabalho('reforma')).toBe('da obra');
    expect(SERVICO.regularizacao.campo).toBe(false);
    expect(SERVICO.reforco.campo).toBe(true);
  });
});

describe('datas relativas', () => {
  it('conta dias e escreve em palavras', () => {
    expect(diasAte('2026-11-20', '2026-11-10')).toBe(10);
    expect(emQuanto('2026-11-11', '2026-11-10')).toBe('amanhã');
    expect(emQuanto('2026-11-15', '2026-11-10')).toBe('em 5 dias');
    expect(haQuanto('2026-11-10T09:00:00Z', '2026-11-10')).toBe('hoje');
    expect(haQuanto('2026-11-07', '2026-11-10')).toBe('há 3 dias');
    expect(haQuanto('2026-10-20', '2026-11-10')).toBe('há 3 semanas');
  });
});

describe('linha do tempo e próximo marco', () => {
  const etapas = [
    etapa('Fundação', 'executado', '2026-11-01', '2026-11-10'),
    etapa('Estrutura', 'em_execucao', '2026-11-11', '2026-11-30', 40),
    etapa('Alvenaria', 'programado', '2026-12-01', '2026-12-20'),
  ];
  const fases = calcularJornada('construcao', etapas, 30);

  it('posiciona as fases com datas e marca hoje', () => {
    const l = linhaDoTempo(fases, '2026-11-15')!;
    expect(l.inicio).toBe('2026-11-01');
    expect(l.fim).toBe('2026-12-20');
    expect(l.fases.map((f) => f.id)).toEqual(['fundacao', 'estrutura', 'vedacao']);
    expect(l.fases[0].esquerda).toBe(0);
    expect(l.hoje).toBeGreaterThan(0);
    expect(l.hoje).toBeLessThan(l.fases[1].esquerda + l.fases[1].largura);
    expect(linhaDoTempo(fases, '2027-05-01')!.hoje).toBeNull();
  });
  it('sem datas suficientes não mostra a linha', () => {
    expect(linhaDoTempo(calcularJornada('construcao', [etapa('Fundação', 'em_execucao', null, null)], 0), '2026-11-15')).toBeNull();
  });
  it('próximo marco: fim da fase em andamento; depois início da próxima etapa', () => {
    expect(proximoMarco(fases, etapas, null, '2026-11-15')).toMatchObject({ titulo: 'Fim da fase Estrutura', data: '2026-11-30', quando: 'em 15 dias' });
    const semAtual = calcularJornada('construcao', [etapas[0], etapas[2]], 30);
    expect(proximoMarco(semAtual, [etapas[0], etapas[2]], null, '2026-11-15')).toMatchObject({ titulo: 'Início: Alvenaria', data: '2026-12-01' });
    expect(proximoMarco(calcularJornada('construcao', [], 0), [], '2027-01-10', '2026-11-15')?.titulo).toBe('Término previsto');
  });
});

describe('etapa de entrega', () => {
  it('"Retirada do escoramento e entrega" cai na última fase do reforço', () => {
    const f = calcularJornada('reforco', [etapa('Escoramento', 'em_execucao', null, null), etapa('Retirada do escoramento e entrega', 'programado', null, null)], 0);
    expect(f.at(-1)!.etapas.map((e) => e.nome)).toEqual(['Retirada do escoramento e entrega']);
  });
});
