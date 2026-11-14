import { describe, expect, it } from 'vitest';
import { momentoDaObra } from './ObraResumo';

const e = (nome: string, estado: string, inicio: string | null, fim: string | null) => ({ nome, estado, inicio_previsto: inicio, fim_previsto: fim }) as Parameters<typeof momentoDaObra>[0][number];

describe('momento da obra', () => {
  const etapas = [
    e('Demolição', 'executado', '2026-10-06', '2026-10-10'),
    e('Piso', 'em_execucao', '2026-10-13', '2026-11-21'),
    e('Pintura', 'programado', '2026-11-24', '2026-12-05'),
    e('Ar-condicionado', 'programado', '2026-12-08', '2026-12-18'),
    e('Cancelada', 'cancelado', '2026-12-20', '2026-12-30'),
  ];
  it('mostra a etapa em andamento, a próxima e o término', () => {
    const m = momentoDaObra(etapas, '2026-11-14');
    expect(m.agora?.nome).toBe('Piso');
    expect(m.proxima?.nome).toBe('Pintura');
    expect(m.fim).toBe('2026-12-18');
    expect(m.atrasadas).toBe(0);
  });
  it('conta etapas atrasadas e usa a data quando nada foi marcado em andamento', () => {
    const m = momentoDaObra([e('Piso', 'programado', '2026-10-13', '2026-11-10'), e('Pintura', 'programado', '2026-11-12', '2026-11-30')], '2026-11-14');
    expect(m.atrasadas).toBe(1);
    expect(m.agora?.nome).toBe('Pintura');
    expect(m.proxima).toBeNull();
  });
});
