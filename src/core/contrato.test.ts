import { describe, expect, it } from 'vitest';
import { clausulasAplicaveis, modeloSugerido, montarContrato, normasDosServicos, servicosDoContrato, textoHonorarios, tituloContrato, type Clausula } from './contrato';
import { conteudoVazio } from './proposta';

const cl = (codigo: string, texto: string, aplicavel: string[], revisao: 'minuta' | 'revisada' = 'minuta'): Clausula => ({ codigo, titulo: codigo, texto, aplicavel, versao: 1, revisao_juridica: revisao });
const base = [
  cl('objeto', 'Conforme a proposta {proposta}.', ['todos'], 'revisada'),
  cl('preco', 'Valor total de {valor_total}.', ['preco_fechado']),
  cl('gestao', 'Honorários: {honorarios}.', ['gestao']),
  cl('visitas', '{visitas_incluidas} visitas; adicional {visita_adicional}.', ['acompanhamento', 'gestao']),
];
const parte = { nome: 'X', documento: '1', endereco: 'Rua', email: null, telefone: null };

describe('contrato', () => {
  it('escolhe cláusulas pelo modelo', () => {
    expect(clausulasAplicaveis(base, 'preco_fechado').map((c) => c.codigo)).toEqual(['objeto', 'preco']);
    expect(clausulasAplicaveis(base, 'gestao').map((c) => c.codigo)).toEqual(['objeto', 'gestao', 'visitas']);
  });
  it('preenche marcadores e lista o que falta, sem taxa padrão', () => {
    const c = conteudoVazio();
    c.local = 'Rua Fictícia';
    const r = montarContrato({
      modelo: 'gestao', proposta: { codigo: 'PROP-1', versao: 2, hash: 'abcdef0123456789ff', conteudo: c, valor_total: 1000 },
      obra: { nome: 'Obra', endereco: null }, contratante: parte, contratada: { ...parte, documento: null },
      honorarios: { mensalidade: 1500, meses: 3, visitas_incluidas: 4 }, clausulas: base,
    });
    expect(r.clausulas[0].texto).toContain('PROP-1, versão 2 (código ABCDEF0123456789)');
    expect(r.clausulas[1].texto.replace(/\s/g, ' ')).toBe('Honorários: mensalidade de R$ 1.500,00 por 3 meses.');
    expect(r.clausulas[2].texto).toBe('4 visitas; adicional [a definir].');
    expect(r.faltando).toEqual(expect.arrayContaining(['contratada_cnpj', 'visita_adicional']));
    expect(r.clausulas[0].revisao_juridica).toBe('revisada');
  });
  it('texto dos honorários', () => {
    expect(textoHonorarios({})).toBeNull();
    expect(textoHonorarios({ valor_inicial: 500 })?.replace(/\s/g, ' ')).toBe('valor inicial de R$ 500,00');
  });
});

describe('contrato por tipo de serviço', () => {
  const lib: Clausula[] = [
    { ...cl('objeto', 'Serviços de {servicos}.', ['todos'], 'revisada') },
    { ...cl('preco', 'Preço {valor_total}.', ['preco_fechado', 'projeto']) },
    { ...cl('autoria', 'Autoria do projeto.', ['s:projeto', 's:arquitetura']), destaque: true },
    { ...cl('garantia_obra', 'Cinco anos (art. 618).', ['s:reforma', 's:construcao']) },
    { ...cl('reajuste', 'INCC.', ['todos', 's:construcao']) },
    { ...cl('legislacao', 'Normas: {normas}.', ['todos']) },
  ];
  it('filtra por serviço e por modelo', () => {
    expect(clausulasAplicaveis(lib, 'projeto', ['projeto']).map((c) => c.codigo)).toEqual(['objeto', 'preco', 'autoria', 'legislacao']);
    expect(clausulasAplicaveis(lib, 'preco_fechado', ['reforma']).map((c) => c.codigo)).toEqual(['objeto', 'preco', 'garantia_obra', 'legislacao']);
    expect(clausulasAplicaveis(lib, 'gestao', ['construcao']).map((c) => c.codigo)).toEqual(['objeto', 'garantia_obra', 'reajuste', 'legislacao']);
    expect(clausulasAplicaveis(lib, 'preco_fechado').map((c) => c.codigo)).toEqual(['objeto', 'preco', 'legislacao']);
  });
  it('tipos de serviço saem do orçamento automático, com os extras', () => {
    const c = conteudoVazio();
    c.gerador = { tipo: 'projeto_estrutural', respostas: {}, pacote: 1, em: '', extras: [{ tipo: 'regularizacao', respostas: {} }] };
    expect(servicosDoContrato(c)).toEqual(['projeto', 'regularizacao']);
    expect(servicosDoContrato(null, 'Reforma de apartamento')).toEqual(['reforma']);
  });
  it('título, normas, serviços e destaque', () => {
    expect(tituloContrato(['reforma'], 'preco_fechado')).toBe('Contrato de empreitada de reforma');
    expect(tituloContrato(['projeto'], 'projeto')).toBe('Contrato de prestação de serviços de projeto estrutural');
    expect(tituloContrato(['projeto', 'reforma'], 'preco_fechado')).toBe('Contrato de prestação de serviços de engenharia');
    expect(modeloSugerido(['gestao'])).toBe('gestao');
    const c = conteudoVazio();
    const r = montarContrato({
      modelo: 'projeto', proposta: { codigo: 'P', versao: 1, hash: null, conteudo: c, valor_total: 100 },
      obra: { nome: 'O', endereco: 'Rua' }, contratante: parte, contratada: parte, honorarios: {}, clausulas: lib, servicos: ['projeto', 'arquitetura'],
    });
    expect(r.titulo).toBe('Contrato de prestação de serviços de engenharia');
    expect(r.clausulas[0].texto).toBe('Serviços de projeto estrutural e projeto arquitetônico.');
    expect(r.clausulas.find((x) => x.codigo === 'autoria')?.destaque).toBe(true);
    expect(r.clausulas.find((x) => x.codigo === 'legislacao')?.texto).toContain('ABNT NBR 6118');
    expect(r.clausulas.find((x) => x.codigo === 'legislacao')?.texto).toContain('NBR 16636');
    expect(normasDosServicos(['projeto', 'reforco']).match(/NBR 6118/g)).toHaveLength(1);
  });
});
