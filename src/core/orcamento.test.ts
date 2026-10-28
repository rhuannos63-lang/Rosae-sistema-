import { describe, expect, it } from 'vitest';
import { faltando, gerarOrcamento, parametrosPadrao, respostasPadrao, TIPOS, type TipoServico } from './orcamento';
import { pendencias, prepararParaSalvar, somaParcelas, totalConteudo } from './proposta';

const resp = (t: TipoServico, extra: Record<string, unknown> = {}) => ({ ...respostasPadrao(t), area: 180, ...extra } as ReturnType<typeof respostasPadrao>);

describe('orçamento automático', () => {
  it.each(TIPOS)('%s gera proposta emitível (totais e parcelas fecham)', (t) => {
    const o = gerarOrcamento(t, resp(t), parametrosPadrao(t));
    const c = prepararParaSalvar(o.conteudo).conteudo;
    expect(totalConteudo(c)).toBe(Math.round(o.principal.valor * 100));
    expect(somaParcelas(c)).toBe(totalConteudo(c));
    expect(pendencias(c)).toEqual([]);
    expect(c.resumo).toBeTruthy();
    expect(c.etapas.every((e) => (e.prazo_dias ?? 0) >= 1)).toBe(true);
    // A linha principal leva as etapas para o cronograma da obra.
    expect(c.ambientes[0].itens.some((i) => (i.etapas?.length ?? 0) > 0)).toBe(true);
  });

  it('pacotes crescem de valor e a opção escolhida vira o total', () => {
    const r = resp('projeto_estrutural');
    const o = gerarOrcamento('projeto_estrutural', r, parametrosPadrao('projeto_estrutural'), 3);
    const [a, b, c] = o.pacotes.map((p) => p.valor);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(o.principal.numero).toBe(3);
    expect(o.conteudo.opcoes?.find((x) => x.principal)?.nome).toBe('Premium');
    expect(o.conteudo.opcoes?.find((x) => x.recomendado)?.nome).toBe('Completo');
  });

  it('projeto estrutural: m² × preço × fator e mínimo', () => {
    const p = parametrosPadrao('projeto_estrutural');
    const o = gerarOrcamento('projeto_estrutural', resp('projeto_estrutural', { complexidade: 'baixa', pavimentos: 2 }), p, 1);
    expect(o.principal.valor).toBe(180 * 24);
    const pequeno = gerarOrcamento('projeto_estrutural', resp('projeto_estrutural', { area: 40 }), p, 1);
    expect(pequeno.principal.valor).toBe(3500);
    expect(pequeno.avisos.some((x) => x.includes('mínimo'))).toBe(true);
  });

  it('urgência e deslocamento entram como linhas transparentes', () => {
    const p = parametrosPadrao('laudo');
    const normal = gerarOrcamento('laudo', resp('laudo'), p, 1);
    const urg = gerarOrcamento('laudo', resp('laudo', { urgencia: true, distancia_km: 50 }), p, 1);
    const titulos = urg.principal.linhas.map((l) => l.titulo);
    expect(titulos).toContain('Deslocamentos técnicos');
    expect(titulos).toContain('Prioridade de agenda (prazo reduzido)');
    expect(urg.conteudo.prazo_total_dias!).toBeLessThan(normal.conteudo.prazo_total_dias!);
  });

  it('perito do juízo não tem pacotes; respeita honorário mínimo', () => {
    const o = gerarOrcamento('pericia', resp('pericia', { modalidade: 'judicial', complexidade: 'simples', quesitos: 0, documentos: 'pouco' }), parametrosPadrao('pericia'));
    expect(o.pacotes).toHaveLength(1);
    expect(o.conteudo.opcoes).toEqual([]);
    expect(o.principal.valor).toBeGreaterThanOrEqual(3500);
  });

  it('construção por administração cobra só a taxa', () => {
    const p = parametrosPadrao('construcao');
    const o = gerarOrcamento('construcao', resp('construcao', { area: 100, modelo: 'administracao' }), p, 1);
    expect(o.principal.linhas[0].valor).toBe(Math.round(100 * 2600 * 0.15 / 10) * 10);
    const emp = gerarOrcamento('construcao', resp('construcao', { area: 100 }), p, 1);
    expect(emp.principal.linhas.filter((l) => l.pacote === 1)).toHaveLength(6);
  });

  it('custos internos e margem saem do pacote escolhido', () => {
    const o = gerarOrcamento('reforma', resp('reforma', { area: 60 }), parametrosPadrao('reforma'));
    expect(o.analise.custo).toBeGreaterThan(0);
    expect(o.analise.margem).toBe(o.analise.preco - o.analise.custo);
    expect(JSON.stringify(o.conteudo)).not.toContain('custo_hora');
  });

  it('avisa campos obrigatórios', () => {
    expect(faltando('reforma', { area: null })).toEqual(['Área a reformar']);
  });
});
