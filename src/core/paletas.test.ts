import { describe, it, expect } from 'vitest';
import { PALETAS, contraste, derivarPaleta, variaveis, normalizar } from '../lib/aparencia';

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const distancia = (a: string, b: string) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));

describe('paletas prontas', () => {
  it('toda cor principal aceita texto branco no botão e tem tom profundo escuro', () => {
    for (const p of PALETAS) {
      expect(contraste(p.cor, '#ffffff'), p.nome).toBeGreaterThanOrEqual(4.5);
      expect(contraste(p.profundo, '#ffffff'), p.nome).toBeGreaterThanOrEqual(12);
    }
  });

  it('as quatro cores de gráfico de cada paleta são bem diferentes entre si', () => {
    for (const p of PALETAS) {
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
        expect(distancia(p.series[i], p.series[j]), `${p.nome} ${i}x${j}`).toBeGreaterThan(70);
      }
    }
  });

  it('ids e cores não se repetem', () => {
    expect(new Set(PALETAS.map((p) => p.id)).size).toBe(PALETAS.length);
    expect(new Set(PALETAS.map((p) => p.cor)).size).toBe(PALETAS.length);
  });

  it('cor personalizada também ganha tom profundo e gráficos', () => {
    const d = derivarPaleta('#1f4e8c');
    expect(d.profundo).toMatch(/^#[0-9a-f]{6}$/);
    expect(d.series.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
    const v = variaveis(normalizar({ cor: '#7a2840' }), false);
    expect(v['--serie-1']).toBe('#7a2840');
    expect(v['--profundo']).toBe('#2a0e16');
  });
});
