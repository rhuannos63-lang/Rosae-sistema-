import { describe, expect, it } from 'vitest';
import type { EtapaPortal } from './portal';
import type { Perfil } from './jornada';
import { SERVICO } from './portalServico';
import {
  BLOCOS, ajustesDaSugestao, fotosDaNovidade, moverBloco, normalizarMontagem, periodoNovidade, sugerirNovidade, sugestaoMontagem, textosDoPortal, tituloBloco,
  type BlocoId,
} from './portalMontagem';

const PERFIS_TODOS: Perfil[] = ['projeto', 'arquitetura', 'reforco', 'reforma', 'construcao', 'laudo', 'regularizacao', 'gestao'];
const et = (nome: string, estado: EtapaPortal['estado'], extra: Partial<EtapaPortal> = {}): EtapaPortal => ({
  id: nome, servico_id: 's', nome, estado, percentual: 0, ordem: 0, inicio_previsto: null, fim_previsto: null, inicio_real: null, fim_real: null, ...extra,
});

describe('montagem do portal', () => {
  it('sugestão de cada serviço traz todos os blocos uma vez', () => {
    for (const p of PERFIS_TODOS) {
      const s = sugestaoMontagem(p);
      expect(s.blocos.map((b) => b.id).sort()).toEqual((Object.keys(BLOCOS) as BlocoId[]).sort());
      expect(s.blocos.filter((b) => b.visivel).length).toBeGreaterThan(5);
      expect(ajustesDaSugestao(s, p)).toBe(0);
    }
  });

  it('obra mostra a novidade antes; projeto mostra a fase antes', () => {
    const ordem = (p: Perfil) => sugestaoMontagem(p).blocos.filter((b) => b.visivel).map((b) => b.id);
    expect(ordem('reforma').indexOf('novidade')).toBeLessThan(ordem('reforma').indexOf('agora'));
    expect(ordem('projeto').indexOf('agora')).toBeLessThan(ordem('projeto').indexOf('novidade'));
    expect(ordem('construcao')).toContain('ambientes');
    expect(ordem('reforma')).not.toContain('ambientes');
    expect(sugestaoMontagem('projeto').abas.medicoes).toBe(false);
    expect(sugestaoMontagem('construcao').abas.ambientes).toBe(true);
  });

  it('normaliza o que vem do banco', () => {
    expect(normalizarMontagem(null, 'reforma')).toEqual(sugestaoMontagem('reforma'));
    const m = normalizarMontagem({
      blocos: [{ id: 'galeria', visivel: true, titulo: '  Fotos da semana  ' }, { id: 'inexistente', visivel: true }, { id: 'galeria', visivel: false }, { id: 'agora', visivel: false }],
      abas: { fotos: false, medicoes: 'sim' }, pedimos: ['  Chave do portão ', ''], duvidas: [{ p: 'Pergunta?', r: '' }],
    }, 'reforma');
    expect(m.blocos[0]).toEqual({ id: 'galeria', visivel: true, titulo: 'Fotos da semana' });
    expect(m.blocos[1]).toEqual({ id: 'agora', visivel: false });
    expect(m.blocos).toHaveLength(Object.keys(BLOCOS).length);
    // Bloco que não estava na montagem gravada entra desligado no fim.
    expect(m.blocos.slice(2).every((b) => !b.visivel)).toBe(true);
    expect(m.abas.fotos).toBe(false);
    expect(m.abas.medicoes).toBe(true);
    expect(m.pedimos).toEqual(['Chave do portão']);
    expect(m.duvidas).toBeUndefined();
    expect(tituloBloco(m, 'galeria', 'reforma')).toBe('Fotos da semana');
    expect(tituloBloco(m, 'duvidas', 'reforma')).toBe('Dúvidas frequentes');
    expect(tituloBloco(sugestaoMontagem('projeto'), 'galeria', 'projeto')).toBe('Imagens recentes');
  });

  it('textos próprios ou do serviço', () => {
    const base = sugestaoMontagem('reforco');
    expect(textosDoPortal(base, 'reforco').pedimos).toEqual(SERVICO.reforco.pedimos);
    const t = textosDoPortal({ ...base, pedimos: ['A'], cuidados: [] }, 'reforco');
    expect(t.pedimos).toEqual(['A']);
    expect(t.cuidados).toEqual([]);
    expect(ajustesDaSugestao({ ...base, pedimos: ['A'] }, 'reforco')).toBe(1);
  });

  it('move blocos sem sair dos limites', () => {
    const s = sugestaoMontagem('reforma');
    const m = moverBloco(s, s.blocos[1].id, -1);
    expect(m.blocos[0].id).toBe(s.blocos[1].id);
    expect(moverBloco(s, s.blocos[0].id, -1)).toBe(s);
    expect(ajustesDaSugestao(m, 'reforma')).toBe(1);
  });
});

describe('novidade sugerida', () => {
  const etapas = [
    et('Demolição', 'executado', { ordem: 1, inicio_real: '2026-11-03', fim_real: '2026-11-08' }),
    et('Instalações elétricas', 'em_execucao', { ordem: 2, inicio_real: '2026-11-10', percentual: 40 }),
    et('Contrapiso', 'programado', { ordem: 3, inicio_previsto: '2026-11-20' }),
  ];
  it('reforma: conta o que avançou, o próximo passo e o que depende do cliente', () => {
    const n = sugerirNovidade({
      perfil: 'reforma', etapas, executado: 35, desde: '2026-11-07', hoje: '2026-11-14', fotos: 3,
      pendencias: [{ titulo: 'Escolher o porcelanato', estado: 'aberta', responsavel: 'cliente', prazo: '2026-11-18' }, { titulo: 'Interna', estado: 'aberta', responsavel: 'rosae', prazo: null }],
    });
    expect(n.titulo).toBe('Concluímos demolição');
    expect(n.texto).toContain('O que avançou nesta semana:');
    expect(n.texto).toContain('• Concluímos Demolição.');
    expect(n.texto).toContain('• Começamos Instalações elétricas.');
    expect(n.texto).toContain('Próximo passo: Contrapiso, previsto para 20/11/2026.');
    expect(n.texto).toContain('Escolher o porcelanato (até 18/11/2026)');
    expect(n.texto).not.toContain('Interna');
    expect(n.texto).toContain('Separamos 3 fotos');
    expect(n.etapa_id).toBe('Demolição');
  });

  it('sem movimento no período: fala da fase e usa o vocabulário do serviço', () => {
    const n = sugerirNovidade({ perfil: 'projeto', etapas: [et('Cálculo estrutural', 'em_execucao', { inicio_real: '2026-10-01', percentual: 50 })], executado: 50, desde: '2026-11-07', hoje: '2026-11-14', fotos: 1, pendencias: [] });
    expect(n.titulo).toBe('Andamento do projeto: cálculo');
    expect(n.texto).toContain('Agora no escritório: Cálculo.');
    expect(n.texto).toContain('Separamos uma imagem');
  });

  it('tudo concluído vira mensagem de entrega', () => {
    const n = sugerirNovidade({ perfil: 'reforma', etapas: [et('Entrega', 'conferido', { fim_real: '2026-11-12' })], executado: 100, desde: '2026-11-07', hoje: '2026-11-14', fotos: 0, pendencias: [] });
    expect(n.titulo).toBe('Sua obra está pronta');
    expect(n.texto).not.toContain('Próximo passo');
  });

  it('período e fotos da novidade', () => {
    expect(periodoNovidade('2026-11-07', '2026-11-14')).toBe('nesta semana');
    expect(periodoNovidade('2026-11-02', '2026-11-14')).toBe('desde 02/11');
    expect(fotosDaNovidade({ fotos: 'a, b,,c' })).toEqual(['a', 'b', 'c']);
    expect(fotosDaNovidade({})).toEqual([]);
  });
});
