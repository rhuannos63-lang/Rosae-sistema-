import { describe, expect, it } from 'vitest';
import {
  compararVersoes, conteudoVazio, encontrarAmbientes, encontrarArea, itemDoModelo, pendencias, prepararParaSalvar,
  rascunhoDoTexto, sugerirPagamento, sugerirServicos, totalConteudo, totalItem, type ModeloServico,
} from './proposta';

const modelo = (x: Partial<ModeloServico>): ModeloServico => ({
  id: x.nome ?? 'm', nome: 'Modelo', grupo: 'G', descricao_cliente: null, palavras_chave: [], unidade: 'vb', modelo_preco: 'fixo',
  preco_base: null, complexidade: [], inclusoes: [], exclusoes: [], responsabilidades: [], etapas: [], perguntas: [], premissas: [],
  pontos_conferir: [], ativo: true, ordem: 0, ...x,
});

const biblioteca = [
  modelo({ nome: 'Projeto estrutural em concreto armado', unidade: 'm2', modelo_preco: 'area_complexidade', preco_base: '18.50',
    palavras_chave: ['projeto estrutural', 'laje'], complexidade: [{ nivel: 'Baixa', fator: 1 }, { nivel: 'Alta', fator: 1.6 }],
    inclusoes: ['ART de projeto'], exclusoes: ['Sondagem'], perguntas: [{ texto: 'Quantos pavimentos?' }],
    responsabilidades: [{ parte: 'ROSAE', itens: ['Emitir ART'] }], etapas: [{ nome: 'Estudo', percentual: 30 }, { nome: 'Entrega', percentual: 70 }], ordem: 10 }),
  modelo({ nome: 'Laudo técnico e vistoria estrutural', palavras_chave: ['laudo', 'trinca', 'fissura'], preco_base: 1200, inclusoes: ['ART de projeto', 'Relatório'], ordem: 30 }),
  modelo({ nome: 'Reforma', palavras_chave: ['reforma', 'banheiro'], ativo: false }),
];

describe('itens e totais', () => {
  it('calcula quantidade × preço × fator ao centavo', () => {
    expect(totalItem({ quantidade: 120, preco_unitario: 18.5, fator: 1.6 })).toBe(3552);
    expect(totalItem({ quantidade: 3, preco_unitario: 0.1 })).toBe(0.3);
    expect(totalItem({ quantidade: 1.333, preco_unitario: 10 })).toBe(13.33);
  });
  it('total do conteúdo soma em centavos', () => {
    const c = conteudoVazio();
    c.ambientes = [{ id: 'a', nome: 'Sala', itens: [{ id: '1', titulo: 'A', unidade: 'un', quantidade: 3, preco_unitario: 0.1, total: 0 }, { id: '2', titulo: 'B', unidade: 'un', quantidade: 1, preco_unitario: 0.2, total: 0 }] }];
    expect(totalConteudo(c)).toBe(50);
    expect(prepararParaSalvar(c).valor_total).toBe(0.5);
    expect(prepararParaSalvar(c).conteudo.ambientes[0].itens[0].total).toBe(0.3);
  });
  it('item do modelo por área usa a primeira complexidade', () => {
    const i = itemDoModelo(biblioteca[0], 100);
    expect(i).toMatchObject({ quantidade: 100, preco_unitario: 18.5, fator: 1, complexidade: 'Baixa', total: 1850 });
    expect(itemDoModelo(biblioteca[0], 100, 'Alta').total).toBe(2960);
    expect(itemDoModelo(biblioteca[1], 50).quantidade).toBe(1);
  });
});

describe('pendências antes de emitir', () => {
  it('aponta falta de item, preço e prazo', () => {
    expect(pendencias(conteudoVazio())).toContain('Inclua ao menos um item com valor.');
    const c = conteudoVazio();
    c.ambientes = [{ id: 'a', nome: 'Sala', itens: [itemDoModelo(modelo({ nome: 'Sem preço' }))] }];
    expect(pendencias(c).some((p) => p.includes('sem preço'))).toBe(true);
  });
  it('confere a soma das parcelas', () => {
    const c = conteudoVazio();
    c.ambientes = [{ id: 'a', nome: 'Sala', itens: [itemDoModelo(biblioteca[1])] }];
    c.prazo_texto = '10 dias';
    c.pagamento.parcelas = [{ descricao: 'Única', valor: 1000 }];
    expect(pendencias(c)).toEqual(['As condições de pagamento não somam o total da proposta.']);
    c.pagamento.parcelas = [{ descricao: 'Única', valor: 1200 }];
    expect(pendencias(c)).toEqual([]);
  });
});

describe('condições de pagamento', () => {
  it('entrada e parcelas somam exatamente', () => {
    const p = sugerirPagamento(100000, 'entrada_parcelas', 3);
    expect(p.map((x) => x.valor)).toEqual([300, 233.34, 233.33, 233.33]);
  });
  it('por etapas usa os percentuais', () => {
    const p = sugerirPagamento(123456, 'etapas', 0, [{ nome: 'A', percentual: 30 }, { nome: 'B', percentual: 70 }]);
    expect(p.reduce((s, x) => s + Math.round(x.valor * 100), 0)).toBe(123456);
    expect(p[0].valor).toBe(370.37);
  });
  it('mensal divide igualmente', () => {
    expect(sugerirPagamento(1000, 'mensal', 3).map((x) => x.valor)).toEqual([3.34, 3.33, 3.33]);
  });
});

describe('do texto ao escopo', () => {
  const pedido = 'Olá, preciso de projeto estrutural para uma casa de 2 pavimentos com 180,5 m² e laje na varanda e na garagem.';
  it('acha serviços, área e ambientes sem acento nem caixa', () => {
    expect(sugerirServicos('Tem uma TRINCA na parede', biblioteca)[0].modelo.nome).toBe('Laudo técnico e vistoria estrutural');
    expect(sugerirServicos('quero reforma do banheiro', biblioteca)).toEqual([]); // modelo inativo
    expect(encontrarArea(pedido)).toBe(180.5);
    expect(encontrarArea('casa de 200 metros quadrados')).toBe(200);
    expect(encontrarAmbientes(pedido)).toEqual(['Varanda', 'Garagem']);
  });
  it('gera rascunho com textos padrão sem duplicar', () => {
    const r = rascunhoDoTexto(pedido + ' Há fissura no pilar, quero laudo.', biblioteca);
    expect(r.usados.map((m) => m.nome)).toEqual(['Projeto estrutural em concreto armado', 'Laudo técnico e vistoria estrutural']);
    expect(r.conteudo.ambientes).toHaveLength(1);
    expect(r.conteudo.ambientes[0].itens[0].quantidade).toBe(180.5);
    expect(r.conteudo.inclusoes).toEqual(['ART de projeto', 'Relatório']);
    expect(r.conteudo.etapas.map((e) => e.nome)).toEqual(['Estudo', 'Entrega']);
    expect(r.perguntas).toContain('Quantos pavimentos?');
    expect(r.conteudo.necessidade).toContain('projeto estrutural');
  });
  it('pede a área quando não encontra', () => {
    expect(rascunhoDoTexto('preciso de projeto estrutural', biblioteca).perguntas[0]).toMatch(/área/);
  });
});

describe('comparação de versões', () => {
  it('mostra o que mudou', () => {
    const a = conteudoVazio();
    a.ambientes = [{ id: 'a', nome: 'Sala', itens: [itemDoModelo(biblioteca[1])] }];
    a.inclusoes = ['X'];
    const b = structuredClone(a);
    b.ambientes[0].itens[0].preco_unitario = 1000;
    b.inclusoes = ['X', 'Y'];
    b.validade_dias = 30;
    const d = compararVersoes(a, b);
    expect(d.map((x) => x.onde)).toEqual(['Valor total', 'Sala · Laudo técnico e vistoria estrutural', 'Incluso', 'Validade']);
    expect(d[2]).toEqual({ onde: 'Incluso', antes: '—', depois: 'Y' });
  });
});
