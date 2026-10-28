import { describe, expect, it } from 'vitest';
import { contraste, normalizar, PADRAO, variaveis } from '../lib/aparencia';

describe('aparência', () => {
  it('descarta valores inválidos e usa o padrão', () => {
    expect(normalizar({ cor: 'vermelho', menu: 'x', cantos: 'retos' })).toEqual({ ...PADRAO, cantos: 'retos' });
    expect(normalizar(null)).toEqual(PADRAO);
  });
  it('a cor padrão (verde musgo) tem contraste para texto branco no botão', () => {
    expect(contraste(PADRAO.cor, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(variaveis(PADRAO, false)['--btn-texto']).toBe('#ffffff');
  });
  it('cor clara passa a usar texto escuro no botão', () => {
    expect(variaveis({ ...PADRAO, cor: '#f2e36b' }, false)['--btn-texto']).not.toBe('#ffffff');
  });
});
