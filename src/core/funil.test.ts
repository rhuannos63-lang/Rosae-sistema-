import { describe, expect, it } from 'vitest';
import { montarFunil, ordenar, resumir, type ContratoFunil, type ObraFunil, type OpFunil, type PropostaFunil } from './funil';

const HOJE = '2026-11-10';
const op = (id: string, x: Partial<OpFunil> = {}): OpFunil => ({
  id, codigo: `OP-${id}`, titulo: `Negócio ${id}`, pessoa_id: `p${id}`, pessoa_nome: `Cliente ${id}`, telefone: '21999990000', tipo_servico: 'Reforma',
  estado_tipo: 'aberto', estado_nome: 'Novo contato', estado_desde: '2026-11-08T10:00:00Z', proxima_acao: 'Retornar', proxima_acao_data: '2026-11-12',
  valor_estimado: null, criado_em: '2026-11-08T10:00:00Z', ...x,
});
const prop = (id: string, opId: string | null, x: Partial<PropostaFunil> = {}): PropostaFunil => ({
  id, codigo: `PR-${id}`, titulo: `Proposta ${id}`, tipo: 'proposta', oportunidade_id: opId, pessoa_id: 'p', pessoa_nome: 'Cliente P', telefone: '21999990000',
  estado: 'rascunho', valor: 10000, validade: null, emitida: false, versao_aprovada_id: null, aprovada_em: null,
  atualizado_em: '2026-11-09T10:00:00Z', criado_em: '2026-11-09T10:00:00Z', vistas: 0, ultima_vista: null, ...x,
});
const vazio = { ops: [] as OpFunil[], propostas: [] as PropostaFunil[], obras: [] as ObraFunil[], contratos: [] as ContratoFunil[], versaoDaProposta: new Map<string, string[]>() };

describe('funil completo', () => {
  it('contato sem proposta pede orçamento', () => {
    const [n] = montarFunil({ ...vazio, ops: [op('1')] }, HOJE);
    expect(n.fase).toBe('contato');
    expect(n.passo?.para).toBe('/orcamento?oportunidade=1');
  });

  it('cada proposta viva do mesmo contato conta uma vez', () => {
    const ns = montarFunil({ ...vazio, ops: [op('1')], propostas: [prop('a', '1'), prop('b', '1', { estado: 'enviada', vistas: 4 })] }, HOJE);
    expect(ns.map((x) => x.fase).sort()).toEqual(['enviada', 'orcamento']);
    expect(new Set(ns.map((x) => x.chave)).size).toBe(2);
    const n = ns.find((x) => x.fase === 'enviada')!;
    expect(n.abrir).toBe('/propostas/b');
    expect(n.propostaId).toBe('b');
    expect(n.quente).toBe(true);
    expect(n.passo?.acao).toBe('whatsapp');
  });

  it('aceita sem obra: gerar contrato converte primeiro', () => {
    const [n] = montarFunil({ ...vazio, ops: [op('1')], propostas: [prop('a', '1', { estado: 'aprovada', versao_aprovada_id: 'v1', aprovada_em: '2026-11-01T10:00:00Z' })] }, HOJE);
    expect(n.fase).toBe('aceita');
    expect(n.passo).toMatchObject({ rotulo: 'Gerar contrato', acao: 'converter' });
    expect(n.alertas.some((a) => a.texto.startsWith('Parado há'))).toBe(true);
  });

  it('segue a obra e o contrato até a entrega', () => {
    const base = { ...vazio, ops: [op('1')], propostas: [prop('a', '1', { estado: 'aprovada', versao_aprovada_id: 'v1' })] };
    const obra: ObraFunil = { id: 'o1', codigo: 'OB-1', nome: 'Obra', status: 'contratada', proposta_versao_id: 'v1', data_previsao_fim: null, criado_em: '2026-11-05T10:00:00Z' };
    expect(montarFunil({ ...base, obras: [obra] }, HOJE)[0].passo?.para).toBe('/obras/o1?aba=contrato');
    const emitido: ContratoFunil = { id: 'c', obra_id: 'o1', estado: 'emitido', emitido_em: '2026-11-06T10:00:00Z', assinado_em: null, criado_em: '2026-11-06T10:00:00Z' };
    expect(montarFunil({ ...base, obras: [obra], contratos: [emitido] }, HOJE)[0].fase).toBe('contrato');
    expect(montarFunil({ ...base, obras: [obra], contratos: [{ ...emitido, estado: 'assinado', assinado_em: '2026-11-07' }] }, HOJE)[0].fase).toBe('obra');
    expect(montarFunil({ ...base, obras: [{ ...obra, status: 'concluida_fisicamente' }] }, HOJE)[0].fase).toBe('entregue');
    expect(montarFunil({ ...base, obras: [obra], contratos: [{ ...emitido, estado: 'cancelado', cancelado_motivo: 'x' } as ContratoFunil] }, HOJE)[0].fase).toBe('aceita');
  });

  it('perdida e recusada ficam fora das fases ativas', () => {
    const ns = montarFunil({ ...vazio, ops: [op('1', { estado_tipo: 'perdido' }), op('2')], propostas: [prop('b', '2', { estado: 'recusada' })] }, HOJE);
    expect(ns.map((n) => n.fase)).toEqual(['perdido', 'perdido']);
  });

  it('aditivo não vira negócio separado; proposta sem oportunidade entra sozinha', () => {
    const ns = montarFunil({ ...vazio, propostas: [prop('a', null, { estado: 'enviada' }), prop('ad', null, { tipo: 'aditivo', obra_id: 'o1' })] }, HOJE);
    expect(ns).toHaveLength(1);
    expect(ns[0].abrir).toBe('/propostas/a');
  });

  it('atrasado vem primeiro e conta no resumo', () => {
    const ns = montarFunil({ ...vazio, ops: [op('1'), op('2', { proxima_acao_data: '2026-11-01' })], propostas: [prop('a', '1', { estado: 'enviada', valor: 5000 })] }, HOJE);
    expect(ordenar(ns)[0].oportunidadeId).toBe('2');
    const r = resumir(ns, HOJE);
    expect(r.precisamAcao).toBe(1);
    expect(r.aguardandoCliente).toBe(5000);
    expect(r.porFase.contato.qtd).toBe(1);
  });

  it('fechado no mês soma os aceites do mês', () => {
    const ns = montarFunil({ ...vazio, ops: [op('1'), op('2')], propostas: [
      prop('a', '1', { estado: 'aprovada', valor: 7000, aprovada_em: '2026-11-03T10:00:00Z' }),
      prop('b', '2', { estado: 'aprovada', valor: 9000, aprovada_em: '2026-10-20T10:00:00Z' }),
    ] }, HOJE);
    const r = resumir(ns, HOJE);
    expect(r.fechadoMes).toBe(7000);
    expect(r.qtdFechadoMes).toBe(1);
    expect(r.conversao).toBe(1);
  });

  it('validade perto do fim avisa', () => {
    const [n] = montarFunil({ ...vazio, ops: [op('1')], propostas: [prop('a', '1', { estado: 'enviada', validade: '2026-11-12', vistas: 1 })] }, HOJE);
    expect(n.alertas.map((a) => a.texto)).toContain('Vence em 2 d');
  });

  it('duas enviadas no mesmo contato aparecem como duas aguardando', () => {
    const ns = montarFunil({ ...vazio, ops: [op('1')], propostas: [
      prop('a', '1', { estado: 'enviada', emitida: true, situacao: 'aguardando' }),
      prop('b', '1', { estado: 'enviada', emitida: true, situacao: 'aguardando', pessoa_nome: 'Outra cliente' }),
    ] }, HOJE);
    expect(resumir(ns, HOJE).porFase.enviada.qtd).toBe(2);
  });

  it('recusada some quando há outra viva; contato arquivado não esconde a proposta', () => {
    const ns = montarFunil({ ...vazio, ops: [op('1')], propostas: [prop('a', '1', { estado: 'recusada' }), prop('b', '1', { estado: 'enviada' }), prop('c', 'arquivado', { estado: 'enviada' })] }, HOJE);
    expect(ns.map((x) => x.propostaId).sort()).toEqual(['b', 'c']);
  });

  it('negociação e vencida pedem para alterar o valor e reenviar', () => {
    const [a] = montarFunil({ ...vazio, propostas: [prop('a', null, { estado: 'em_negociacao', situacao: 'ajuste' })] }, HOJE);
    expect(a.fase).toBe('enviada');
    expect(a.passo).toMatchObject({ rotulo: 'Alterar valor e reenviar', para: '/propostas/a?alterar=valor' });
    const [v] = montarFunil({ ...vazio, propostas: [prop('v', null, { estado: 'enviada', situacao: 'vencida', validade: '2026-11-01' })] }, HOJE);
    expect(v.passo?.rotulo).toBe('Alterar valor e reenviar');
  });
});
