import { describe, expect, it } from 'vitest';
import { BASE_BANCO, formatarBytes, formatarMeses, projetar, type UsoArmazenamento } from './armazenamento';

const MB = 1024 ** 2;
const GB = 1024 ** 3;
function uso(p: Partial<{ banco: number; arquivos: number; frio: number; inicio: string; mensal: number[] }> = {}): UsoArmazenamento {
  const mensal = p.mensal ?? Array(12).fill(0);
  return {
    inicio: p.inicio ?? '2025-11-10T00:00:00Z',
    banco: { bytes: p.banco ?? BASE_BANCO + 12 * MB, limite_bytes: 500 * MB, tabelas: [] },
    arquivos: { bytes: p.arquivos ?? 240 * MB, quantidade: 800, fotos_bytes: 200 * MB, limite_bytes: 1024 * MB },
    frio: { bytes: p.frio ?? 0, quantidade: 0, copiado_bytes: 0, copiado_quantidade: 0, limite_bytes: 10 * GB, sem_copia: 0 },
    mensal: mensal.map((b, i) => ({ mes: `2026-${String(i + 1).padStart(2, '0')}`, bytes: b })),
    backups: [],
    config: { limite_banco_mb: 500, limite_arquivos_mb: 1024, limite_frio_gb: 10, arquivar_acima_pct: 70, alvo_pct: 55, idade_minima_meses: 6, guarda_anos: 10 },
  };
}
const agora = new Date('2026-11-10T00:00:00Z');

describe('projeção de 10 anos', () => {
  it('um ano de uso: 240 MB de arquivos vira cerca de 2,6 GB e enche o Supabase grátis em ~3 anos', () => {
    const p = projetar(uso(), agora);
    expect(p.meses).toBe(120);
    expect(p.arquivos_mes / MB).toBeCloseTo(20, 0);
    expect(p.arquivos_final / GB).toBeGreaterThan(2.5);
    expect(p.arquivos_final / GB).toBeLessThan(2.7);
    expect(p.supabase_arquivos_enche_em).toBeGreaterThan(30);
    expect(p.supabase_arquivos_enche_em).toBeLessThan(45);
    expect(p.custo_r2_mes_usd).toBe(0); // cabe nos 10 GB grátis do R2
  });

  it('banco: desconta a estrutura e não enche com 1 MB por mês', () => {
    const p = projetar(uso(), agora);
    expect(p.banco_mes / MB).toBeCloseTo(1, 1);
    expect(p.banco_enche_em).toBeNull();
  });

  it('ritmo dos últimos meses pesa quando acelera', () => {
    const p = projetar(uso({ arquivos: 300 * MB, mensal: [0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50].map((m) => m * MB) }), agora);
    expect(p.arquivos_mes / MB).toBeCloseTo(50, 0);
  });

  it('acima de 10 GB no R2 estima o custo em centavos de dólar', () => {
    const p = projetar(uso({ arquivos: 600 * MB, frio: 2 * GB, inicio: '2026-05-10T00:00:00Z' }), agora);
    expect(p.frio_final / GB).toBeGreaterThan(10);
    expect(p.custo_r2_mes_usd).toBeGreaterThan(0);
    expect(p.custo_r2_mes_usd).toBeLessThan(10);
  });

  it('formata tamanhos e prazos', () => {
    expect(formatarBytes(1.5 * GB)).toBe('1,5 GB');
    expect(formatarBytes(3.25 * MB)).toBe('3,3 MB');
    expect(formatarMeses(30)).toBe('2,5 anos');
    expect(formatarMeses(5)).toBe('5 meses');
  });
});
