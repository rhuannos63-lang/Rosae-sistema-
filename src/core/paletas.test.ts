import { describe, it, expect } from 'vitest';
import { COR_MARCA, PALETAS, contraste, derivarPaleta, variaveis, variaveisDocumento, normalizar } from '../lib/aparencia';

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const distancia = (a: string, b: string) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));

const matiz = (h: string) => {
  const [r, g, b] = rgb(h).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 0.06) return null; // quase cinza: combina com tudo
  const x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (x * 60 + 360) % 360;
};
const perto = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b)) <= 25;

describe('paletas prontas', () => {
  it('cada paleta é um duotom: as cores dos gráficos vêm só da principal e da companheira', () => {
    for (const p of PALETAS) {
      const base = [matiz(p.series[0]), matiz(p.series[1])];
      for (const c of p.series.slice(2)) {
        const m = matiz(c);
        if (m === null) continue;
        expect(base.some((b) => b === null || perto(b, m)), `${p.nome} ${c}`).toBe(true);
      }
    }
  });

  it('toda cor principal aceita texto branco no botão e tem tom profundo escuro', () => {
    for (const p of PALETAS) {
      expect(contraste(p.cor, '#ffffff'), p.nome).toBeGreaterThanOrEqual(4.5);
      expect(contraste(p.profundo, '#ffffff'), p.nome).toBeGreaterThanOrEqual(12);
    }
  });

  it('as quatro cores de gráfico de cada paleta se distinguem pelo tom ou pela claridade', () => {
    for (const p of PALETAS) {
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
        expect(distancia(p.series[i], p.series[j]), `${p.nome} ${i}x${j}`).toBeGreaterThan(55);
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

  it('a proposta pode usar qualquer paleta; sem cor fica no musgo da marca', () => {
    expect(variaveisDocumento(undefined)).toBeUndefined();
    expect(variaveisDocumento(COR_MARCA)).toBeUndefined();
    expect(variaveisDocumento('azul')).toBeUndefined();
    const v = variaveisDocumento('#1f66c9')!;
    expect(v['--verde']).toBe('#1f66c9');
    expect(v['--serie-2']).toBe('#c0a46e');
    expect(v['--fundo']).toBeUndefined();
  });

  it('há paletas em todas as famílias de cor', () => {
    const grupos = new Set(PALETAS.map((p) => p.grupo));
    expect([...grupos].sort()).toEqual(['Azuis', 'Neutros', 'Quentes', 'Roxos e rosas', 'Verdes']);
  });
});
