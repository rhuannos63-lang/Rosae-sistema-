import { describe, expect, it } from 'vitest';
import { cienciaDoItem, faseEtapa, paresAntesDepois, proximaEtapa, type CienciaPortal, type EtapaPortal, type FotoPortal } from './portal';

const et = (id: string, estado: EtapaPortal['estado'], inicio: string | null, ordem = 0): EtapaPortal => ({
  id, servico_id: 's', nome: id, estado, percentual: 0, ordem, inicio_previsto: inicio, fim_previsto: null, inicio_real: null, fim_real: null,
});
const foto = (id: string, momento: FotoPortal['momento'], extra: Partial<FotoPortal> = {}): FotoPortal => ({
  id, momento, tirada_em: '2026-10-01T10:00:00Z', legenda: null, servico_id: null, etapa_id: null, ambiente_id: null, registro_id: null,
  largura: null, altura: null, ...extra,
});

describe('portal', () => {
  it('fases e próxima atividade', () => {
    expect(faseEtapa({ estado: 'conferido' })).toBe('concluida');
    expect(faseEtapa({ estado: 'aguardando_material' })).toBe('atual');
    expect(faseEtapa({ estado: 'programado' })).toBe('futura');
    const p = proximaEtapa([et('a', 'executado', '2026-10-01'), et('b', 'programado', null), et('c', 'nao_iniciado', '2026-11-02'), et('d', 'programado', '2026-11-01')]);
    expect(p?.id).toBe('d');
    expect(proximaEtapa([et('a', 'executado', null)])).toBeNull();
  });

  it('ciência por pessoa e versão', () => {
    const c = (pessoa: string, versao: string): CienciaPortal => ({ alvo_tipo: 'registro', alvo_id: 'r', versao, pessoa_id: pessoa, pessoa, criado_em: '2026-10-01' });
    const r = cienciaDoItem([c('ana', 'v1'), c('bia', 'v1'), c('ana', 'v2'), c('caio', 'v0'), c('caio', 'v1')], 'registro', 'r', 'v2');
    expect(r.atuais.map((x) => x.pessoa_id)).toEqual(['ana']);
    expect(r.anteriores.map((x) => x.pessoa_id).sort()).toEqual(['bia', 'caio']);
    expect(r.anteriores.find((x) => x.pessoa_id === 'caio')?.versao).toBe('v1');
    expect(r.euAtual('ana')).toBe(true);
    expect(r.euAtual('bia')).toBe(false);
  });

  it('pares antes e depois', () => {
    const pares = paresAntesDepois([
      foto('a1', 'antes', { etapa_id: 'e1', servico_id: 's1' }), foto('d1', 'depois', { etapa_id: 'e1' }),
      foto('a2', 'antes', { ambiente_id: 'cozinha' }), foto('d2', 'depois', { ambiente_id: 'cozinha' }),
      foto('a3', 'antes', { ambiente_id: 'sala' }), foto('x', 'durante', { ambiente_id: 'sala' }),
    ]);
    expect(pares.map((p) => `${p.antes.id}-${p.depois.id}`)).toEqual(['a1-d1', 'a2-d2']);
  });
});
