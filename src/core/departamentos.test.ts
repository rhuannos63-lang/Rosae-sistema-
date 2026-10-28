import { describe, expect, it } from 'vitest';
import { departamentosVisiveis, localizar } from './departamentos';

const todos = { comercial: true, financeiro: true, admin: true };

describe('departamentos', () => {
  it('acha a subpasta mais específica de cada rota', () => {
    expect(localizar('/orcamento/precos')?.sub?.rotulo).toBe('Tabela de preços');
    expect(localizar('/orcamento')?.sub?.rotulo).toBe('Novo orçamento');
    expect(localizar('/financeiro/abc')?.dep.id).toBe('financeiro');
    expect(localizar('/obras/123')?.sub?.para).toBe('/obras');
    expect(localizar('/contratos/1/imprimir')?.dep.id).toBe('obras');
    expect(localizar('/d/comercial')).toMatchObject({ dep: { id: 'comercial' }, sub: null });
    expect(localizar('/')).toBeNull();
  });

  it('esconde o que a pessoa não pode abrir', () => {
    const campo = departamentosVisiveis({ comercial: false, financeiro: false, admin: false }).map((d) => d.id);
    expect(campo).toEqual(['obras', 'empresa']);
    const sem = departamentosVisiveis({ comercial: true, financeiro: false, admin: false });
    expect(sem.find((d) => d.id === 'empresa')?.subpastas.some((s) => s.para === '/configuracoes')).toBe(false);
    expect(departamentosVisiveis(todos)).toHaveLength(4);
  });

  it('não deixa rota de departamento escondido aparecer como dele', () => {
    const campo = departamentosVisiveis({ comercial: false, financeiro: false, admin: false });
    expect(localizar('/financeiro', campo)).toBeNull();
  });
});
