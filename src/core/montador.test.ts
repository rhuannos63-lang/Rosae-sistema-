import { describe, expect, it } from 'vitest';
import { conteudoVazio, pavimentos, totalConteudo } from './proposta';
import {
  CATALOGO, aplicarImportado, aplicarLinhas, catalogoComPrecos, comMedidas, exportarPlanilha, importar, linhaDoCatalogo, linhasDoConteudo, numeroBr, resumoAndares,
} from './montador';

const cat = (id: string) => CATALOGO.find((s) => s.id === id)!;

describe('montador por andar', () => {
  it('pintura soma parede e teto e vira grupo do andar', () => {
    const l = comMedidas(linhaDoCatalogo(cat('pintura_interna'), '1º andar', 'Hall'), 14.4, 2.7);
    const c = aplicarLinhas(conteudoVazio(), [l, linhaDoCatalogo(cat('cacamba'), 'Todos os andares')]);
    expect(c.ambientes.map((a) => `${a.pavimento}|${a.nome}`)).toEqual(['1º andar|Pintura', 'Todos os andares|Canteiro']);
    expect(c.ambientes[0].itens[0]).toMatchObject({ quantidade: 17.1, unidade: 'm2', descricao: 'Parede 14,40 m² · teto 2,70 m²', onde: 'Hall', catalogo: 'pintura_interna' });
    expect(totalConteudo(c)).toBe(Math.round(17.1 * 65 * 100) + 74681);
    // volta para as linhas sem perder as medidas
    const volta = linhasDoConteudo(c);
    expect(volta[0]).toMatchObject({ andar: '1º andar', parede: 14.4, teto: 2.7, catalogo: 'pintura_interna' });
  });

  it('mantém id e nota do grupo ao editar', () => {
    const c0 = aplicarLinhas(conteudoVazio(), [linhaDoCatalogo(cat('piso_ceramico'), 'Térreo')]);
    const c1 = { ...c0, ambientes: c0.ambientes.map((a) => ({ ...a, nota: 'Piso da sala' })) };
    const linhas = linhasDoConteudo(c1).map((l) => ({ ...l, quantidade: 20 }));
    const c2 = aplicarLinhas(c1, linhas);
    expect(c2.ambientes[0].id).toBe(c1.ambientes[0].id);
    expect(c2.ambientes[0].nota).toBe('Piso da sala');
    expect(totalConteudo(c2)).toBe(140000);
  });

  it('sem andar continua no formato de ambientes', () => {
    const c = aplicarLinhas(conteudoVazio(), [linhaDoCatalogo(cat('rodape'), 'Geral')]);
    expect(c.ambientes[0].pavimento).toBeUndefined();
  });

  it('área externa e todos os andares ficam no fim', () => {
    const c = aplicarLinhas(conteudoVazio(), [
      linhaDoCatalogo(cat('andaime'), 'Todos os andares'), linhaDoCatalogo(cat('pintura_externa'), 'Área externa e fachadas'), linhaDoCatalogo(cat('rodape'), '2º andar'),
    ]);
    expect(pavimentos(c).map((p) => p.nome)).toEqual(['2º andar', 'Área externa e fachadas', 'Todos os andares']);
  });

  it('preço ajustado substitui o do catálogo', () => {
    expect(catalogoComPrecos({ 'cat.drywall_forro': 80 }).find((s) => s.id === 'drywall_forro')!.preco).toBe(80);
    expect(catalogoComPrecos({ 'cat.drywall_forro': 0 }).find((s) => s.id === 'drywall_forro')!.preco).toBe(70);
  });

  it('lê números brasileiros', () => {
    expect(numeroBr('1.234,56')).toBe(1234.56);
    expect(numeroBr('R$ 65')).toBe(65);
    expect(numeroBr('1234.5')).toBe(1234.5);
    expect(numeroBr('2.240')).toBe(2240);
  });
});

describe('importar', () => {
  const resposta = '```json\n' + JSON.stringify({
    titulo: 'Reforma completa', local: 'Rua Roma, 469', resumo: 'Reforma dos 4 andares.', prazo_semanas: 14,
    andares: [
      { andar: '1º andar', grupos: [{ grupo: 'Pintura', nota: 'Paredes e tetos', servicos: [{ servico: 'Hall', parede_m2: 10, teto_m2: 2, preco_unitario: 65 }] }] },
      { andar: 'Todos os andares', grupos: [{ grupo: 'Canteiro', servicos: [{ servico: 'Caçambas', o_que: 'Caçamba 5 m³', quantidade: 2, unidade: 'un', preco_unitario: '746,81' }, { servico: 'Verba', valor: 1000 }] }] },
    ],
    etapas: [{ nome: 'Demolições', semanas: 2 }, { nome: 'Acabamentos', dias: 20 }],
    pagamento: [{ descricao: 'Sinal', percentual: 30 }, { descricao: 'Final', percentual: 70 }],
  }) + '\n```';

  it('lê o JSON da IA com cercas de código', () => {
    const imp = importar('Aqui está:\n' + resposta);
    expect(imp.avisos).toEqual([]);
    expect(imp.linhas).toHaveLength(3);
    expect(imp.linhas[0]).toMatchObject({ andar: '1º andar', categoria: 'Pintura', quantidade: 12, parede: 10, teto: 2 });
    expect(imp.linhas[2]).toMatchObject({ unidade: 'vb', quantidade: 1, preco: 1000 });
    expect(imp.conteudo.prazo_total_dias).toBe(34);
    expect(resumoAndares(imp.linhas).map((r) => r.total)).toEqual([780, 2493.62]);
  });

  it('aplica com notas, textos e pagamento fechando ao centavo', () => {
    const c = aplicarImportado(conteudoVazio(), importar(resposta));
    expect(c.ambientes[0].nota).toBe('Paredes e tetos');
    expect(c.local).toBe('Rua Roma, 469');
    const total = totalConteudo(c);
    expect(total).toBe(327362);
    expect(c.pagamento.parcelas.map((p) => Math.round(p.valor * 100))).toEqual([98209, 229153]);
  });

  it('juntar mantém o que já estava', () => {
    const c0 = aplicarLinhas(conteudoVazio(), [linhaDoCatalogo(cat('rodape'), 'Térreo')]);
    const c = aplicarImportado(c0, importar(resposta), { juntar: true, textos: false });
    expect(c.ambientes.map((a) => a.pavimento)).toEqual(['Térreo', '1º andar', 'Todos os andares']);
    expect(c.local).toBe('');
  });

  it('lê planilha colada (tab) e o que o sistema exporta', () => {
    const linhas = [linhaDoCatalogo(cat('piso_ceramico'), '2º andar', 'Sala')].map((l) => ({ ...l, quantidade: 12.5 }));
    const tsv = exportarPlanilha(linhas);
    const imp = importar(tsv);
    expect(imp.linhas[0]).toMatchObject({ andar: '2º andar', onde: 'Sala', quantidade: 12.5, unidade: 'm2', preco: 70 });
    const csv = exportarPlanilha(linhas, ';');
    expect(importar(csv).linhas[0].preco).toBe(70);
  });

  it('avisa quando não reconhece', () => {
    expect(importar('oi tudo bem').avisos[0]).toMatch(/Não reconheci/);
  });
});
