import { describe, it, expect } from 'vitest';
import { corCompanheira, contraste, variaveis, normalizar } from '../lib/aparencia';

describe('cor companheira (verde que acompanha o musgo)', () => {
  it('leva o musgo para um verde mais fechado, legível sobre branco', () => {
    const c = corCompanheira('#5b6b2e');
    expect(c).toMatch(/^#[0-9a-f]{6}$/);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    expect(contraste(c, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('funciona com cores que não são verdes e entra nas variáveis', () => {
    expect(corCompanheira('#1f4e8c')).toMatch(/^#[0-9a-f]{6}$/);
    const v = variaveis(normalizar({}), false);
    expect(v['--verde-2']).toMatch(/^#/);
    expect(v['--verde-2-rgb'].split(',').length).toBe(3);
  });
});
