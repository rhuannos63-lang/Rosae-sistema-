import { describe, expect, it } from 'vitest';
import { clausulasAplicaveis, montarContrato, textoHonorarios, type Clausula } from './contrato';
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
