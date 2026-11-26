import { describe, expect, it } from 'vitest';
import { buscarClientes, chaveBusca, clientesParecidos } from './clienteBusca';

const lista = [
  { id: '1', nome: 'Gaffer Soluções Metálicas', telefone: '(21) 99876-5432', email: 'contato@gaffer.com.br' },
  { id: '2', nome: 'Thays Reis', telefone: '+55 21 2212-7947', email: null },
  { id: '3', nome: 'Ana Paula Souza', telefone: null, email: 'ana@exemplo.com' },
];

describe('busca de cliente no novo orçamento', () => {
  it('acha sem acento e em qualquer ordem', () => {
    expect(chaveBusca('Soluções Metálicas')).toBe('solucoes metalicas');
    expect(buscarClientes(lista, 'solucoes').map((p) => p.id)).toEqual(['1']);
    expect(buscarClientes(lista, 'METÁLICAS gaffer').map((p) => p.id)).toEqual(['1']);
    expect(buscarClientes(lista, 'paula ana').map((p) => p.id)).toEqual(['3']);
  });
  it('acha pelo telefone ou e-mail', () => {
    expect(buscarClientes(lista, '98765').map((p) => p.id)).toEqual(['1']);
    expect(buscarClientes(lista, 'ana@exemplo').map((p) => p.id)).toEqual(['3']);
  });
  it('sem termo devolve todos', () => {
    expect(buscarClientes(lista, '  ')).toHaveLength(3);
  });
});

describe('cliente repetido', () => {
  it('avisa pelo mesmo nome, sem ligar para acento', () => {
    expect(clientesParecidos(lista, { nome: 'gaffer solucoes metalicas' }).map((p) => p.id)).toEqual(['1']);
  });
  it('avisa pelo mesmo celular, com ou sem DDD e 55', () => {
    expect(clientesParecidos(lista, { nome: 'Outro', telefone: '21 2212 7947' }).map((p) => p.id)).toEqual(['2']);
  });
  it('avisa pelo mesmo e-mail', () => {
    expect(clientesParecidos(lista, { nome: 'X', email: 'ANA@exemplo.com ' }).map((p) => p.id)).toEqual(['3']);
  });
  it('não avisa à toa', () => {
    expect(clientesParecidos(lista, { nome: 'Ga' })).toEqual([]);
    expect(clientesParecidos(lista, { nome: 'Gaffer' })).toEqual([]);
  });
});
