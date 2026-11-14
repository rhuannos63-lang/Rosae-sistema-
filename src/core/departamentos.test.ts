import { describe, expect, it } from 'vitest';
import { abaAtual, departamentosVisiveis, localizar } from './departamentos';

const todos = { comercial: true, financeiro: true, admin: true };

describe('departamentos', () => {
  it('acha a subpasta mais específica de cada rota', () => {
    expect(localizar('/orcamento/precos')?.sub?.rotulo).toBe('Preços e modelos');
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
    expect(sem.find((d) => d.id === 'empresa')?.subpastas.some((s) => s.para === '/configuracoes' || s.abas?.some((a) => a.para === '/configuracoes'))).toBe(false);
    expect(departamentosVisiveis(todos)).toHaveLength(4);
  });

  it('não deixa rota de departamento escondido aparecer como dele', () => {
    const campo = departamentosVisiveis({ comercial: false, financeiro: false, admin: false });
    expect(localizar('/financeiro', campo)).toBeNull();
  });

  it('junta telas parecidas numa subpasta com abas', () => {
    const l = localizar('/clausulas');
    expect(l?.sub?.rotulo).toBe('Preços e modelos');
    expect(abaAtual('/clausulas', l!.sub)?.rotulo).toBe('Cláusulas de contrato');
    expect(abaAtual('/orcamento/composicoes', localizar('/orcamento/composicoes')!.sub)?.rotulo).toBe('Insumos e composições');
    expect(localizar('/lixeira')?.sub?.rotulo).toBe('Configurações');
    expect(localizar('/ajuda')?.sub?.rotulo).toBe('Ajuda');
    const com = departamentosVisiveis(todos).find((d) => d.id === 'comercial')!;
    expect(com.subpastas.map((s) => s.rotulo)).toEqual(['Funil', 'Novo orçamento', 'Propostas', 'Preços e modelos']);
  });

  it('sem permissão, a subpasta abre na primeira aba que a pessoa pode ver', () => {
    const emp = departamentosVisiveis({ comercial: true, financeiro: false, admin: false }).find((d) => d.id === 'empresa')!;
    const conf = emp.subpastas.find((s) => s.rotulo === 'Configurações')!;
    expect(conf.para).toBe('/aparencia');
    expect(conf.abas?.map((a) => a.para)).toEqual(['/aparencia']);
    const com = departamentosVisiveis({ comercial: true, financeiro: false, admin: false }).find((d) => d.id === 'comercial')!;
    expect(com.subpastas.at(-1)?.abas?.some((a) => a.para === '/orcamento/composicoes')).toBe(false);
  });
});
