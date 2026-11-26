import { describe, expect, it } from 'vitest';
import { gerarOrcamento, gerarOrcamentoServicos, nomeDosServicos, parametrosPadrao, respostasPadrao, TIPOS, type Servico, type TipoServico } from './orcamento';
import { perfilDaObra } from './jornada';
import { pendencias, prepararParaSalvar, somaParcelas, totalConteudo } from './proposta';

const sv = (t: TipoServico, extra: Record<string, unknown> = {}): Servico => ({ tipo: t, respostas: { ...respostasPadrao(t), area: 180, ...extra } as Servico['respostas'] });
const precos = Object.fromEntries(TIPOS.map((t) => [t, parametrosPadrao(t)]));

describe('vários serviços na mesma proposta', () => {
  const lista = [sv('projeto_arquitetonico'), sv('projeto_estrutural'), sv('regularizacao', { objetivo: 'habite_se' })];

  it('cada pacote soma o mesmo pacote de cada serviço e a proposta fecha', () => {
    const o = gerarOrcamentoServicos(lista, precos, 2);
    const sozinhos = lista.map((x) => gerarOrcamento(x.tipo, x.respostas, precos[x.tipo], 2));
    for (const k of [0, 1, 2]) expect(o.pacotes[k].valor).toBeCloseTo(sozinhos.reduce((t, s) => t + s.pacotes[k].valor, 0), 2);
    const c = prepararParaSalvar(o.conteudo).conteudo;
    expect(c.ambientes.map((a) => a.nome)).toEqual(['Projeto arquitetônico', 'Projeto estrutural', 'Regularização de imóveis']);
    expect(totalConteudo(c)).toBe(Math.round(o.principal.valor * 100));
    expect(somaParcelas(c)).toBe(totalConteudo(c));
    expect(pendencias(c)).toEqual([]);
    expect(o.tipos).toEqual(['projeto_arquitetonico', 'projeto_estrutural', 'regularizacao']);
    expect(nomeDosServicos(o)).toBe('Projeto arquitetônico + Projeto estrutural + Regularização de imóveis');
  });

  it('etapas em sequência, prazo somado e cada serviço com o próprio cronograma', () => {
    const o = gerarOrcamentoServicos(lista, precos, 2);
    const soma = lista.reduce((t, x) => t + gerarOrcamento(x.tipo, x.respostas, precos[x.tipo], 2).conteudo.prazo_total_dias!, 0);
    expect(o.conteudo.prazo_total_dias).toBe(soma);
    expect(o.conteudo.etapas[0].nome.startsWith('Projeto arquitetônico · ')).toBe(true);
    expect(o.conteudo.ambientes.every((a) => a.itens.some((i) => (i.etapas?.length ?? 0) > 0))).toBe(true);
  });

  it('o que um serviço cobre deixa de aparecer como exclusão do outro', () => {
    const o = gerarOrcamentoServicos([sv('projeto_estrutural'), sv('projeto_arquitetonico')], precos, 1);
    expect(o.conteudo.exclusoes.some((x) => /^projetos? de arquitetura/i.test(x))).toBe(false);
    expect(o.conteudo.exclusoes.some((x) => /^projetos? estrutura/i.test(x))).toBe(false);
    expect(o.conteudo.exclusoes).toContain('Projetos de instalações (elétrica, hidráulica e outros)');
  });

  it('o preço definido por você vale para o total combinado', () => {
    const o = gerarOrcamentoServicos(lista, precos, 2, { valores: { 2: 50000 } });
    expect(o.principal.valor).toBe(50000);
    const c = prepararParaSalvar(o.conteudo).conteudo;
    expect(totalConteudo(c)).toBe(5_000_000);
    expect(somaParcelas(c)).toBe(5_000_000);
  });

  it('guarda os serviços extras para reabrir e um serviço só continua igual', () => {
    const o = gerarOrcamentoServicos(lista, precos, 2);
    expect(o.conteudo.gerador?.tipo).toBe('projeto_arquitetonico');
    expect(o.conteudo.gerador?.extras?.map((x) => x.tipo)).toEqual(['projeto_estrutural', 'regularizacao']);
    const um = gerarOrcamentoServicos([lista[1]], precos, 2);
    expect(um.principal.valor).toBe(gerarOrcamento('projeto_estrutural', lista[1].respostas, precos.projeto_estrutural, 2).principal.valor);
  });

  it('jornada do portal reconhece os serviços novos', () => {
    expect(perfilDaObra('Projeto arquitetônico')).toBe('arquitetura');
    expect(perfilDaObra('Regularização de imóvel')).toBe('regularizacao');
    expect(perfilDaObra(null, 'regularizacao')).toBe('regularizacao');
    expect(perfilDaObra('Projeto estrutural')).toBe('projeto');
  });
});
