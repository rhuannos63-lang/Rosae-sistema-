import { describe, expect, it } from 'vitest';
import { codigoVinculo, interpretarResposta, normalizarTelefone, partirMensagem } from './texto.ts';
import { assinaturaValida, lerWebhook } from './whatsapp.ts';
import { esquemaGemini } from './gemini.ts';
import { FERRAMENTAS } from './ferramentas.ts';
import { conversar, type Dependencias } from './nucleo.ts';
import type { Mensagem, Modelo, Resposta } from './modelo.ts';

// ---------------------------------------------------------------------
// Banco de mentira, só com o que o assistente usa do supabase-js.
// ---------------------------------------------------------------------
type Linha = Record<string, unknown>;
function bancoFalso(tabelas: Record<string, Linha[]>, rpcs: Record<string, (a: Linha) => unknown> = {}) {
  const chamadasRpc: Array<[string, Linha]> = [];
  let seq = 0;
  function consulta(t: string) {
    const filtros: Array<(l: Linha) => boolean> = [];
    let op: 'select' | 'insert' | 'update' = 'select';
    let valores: Linha | Linha[] = {};
    let unico: 'single' | 'maybe' | null = null;
    let limite = Infinity;
    const q = {
      select: () => q, order: () => q, neq: (c: string, v: unknown) => (filtros.push((l) => l[c] !== v), q),
      eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), q),
      in: (c: string, v: unknown[]) => (filtros.push((l) => v.includes(l[c])), q),
      lt: (c: string, v: string) => (filtros.push((l) => String(l[c]) < v), q),
      lte: (c: string, v: string) => (filtros.push((l) => String(l[c]) <= v), q),
      or: () => q, limit: (n: number) => ((limite = n), q),
      insert: (v: Linha | Linha[]) => ((op = 'insert'), (valores = v), q),
      update: (v: Linha) => ((op = 'update'), (valores = v), q),
      single: () => ((unico = 'single'), q), maybeSingle: () => ((unico = 'maybe'), q),
      then: (ok: (r: { data: unknown; error: unknown }) => unknown) => {
        const lista = (tabelas[t] ??= []);
        let data: Linha[];
        if (op === 'insert') {
          data = (Array.isArray(valores) ? valores : [valores]).map((v) => ({ id: `id${++seq}`, criado_em: new Date().toISOString(), estado: 'proposta', ...v }));
          lista.push(...data);
        } else {
          data = lista.filter((l) => filtros.every((f) => f(l))).slice(0, limite);
          if (op === 'update') data.forEach((l) => Object.assign(l, valores));
        }
        const res = unico ? { data: data[0] ?? null, error: unico === 'single' && !data[0] ? { message: 'nada' } : null } : { data, error: null };
        return Promise.resolve(res).then(ok);
      },
    };
    return q;
  }
  return {
    db: {
      from: consulta,
      rpc: (nome: string, a: Linha) => {
        chamadasRpc.push([nome, a]);
        return Promise.resolve({ data: rpcs[nome]?.(a) ?? null, error: null });
      },
      storage: { from: () => ({ upload: () => Promise.resolve({ data: {}, error: null }), remove: () => Promise.resolve({ data: {}, error: null }) }) },
    },
    tabelas, chamadasRpc,
  };
}

/** IA de mentira: devolve as respostas na ordem e guarda o que recebeu. */
function iaRoteirizada(roteiro: Resposta[]) {
  const recebidas: Mensagem[][] = [];
  const modelo: Modelo = {
    responder: (_s, mensagens) => {
      recebidas.push(structuredClone(mensagens));
      return Promise.resolve(roteiro.shift() ?? { texto: 'fim', chamadas: [], bruto: null });
    },
  };
  return { modelo, recebidas };
}

const USUARIO = { id: 'u1', nome: 'Rhuann' };
function base() {
  return bancoFalso({
    obra: [{ id: 'o1', codigo: 'OBR-2026-001', nome: 'Reforço Leblon', status: 'em_execucao', arquivado: false, cliente: { nome: 'Ana' } }],
    categoria: [{ id: 'c1', nome: 'Material de obra', tipo: 'pagar', natureza: 'custo_material', ativo: true }],
    conta_bancaria: [{ id: 'b1', nome: 'Conta principal', ativa: true }],
    parcela: [], lancamento: [], assistente_acao: [], assistente_mensagem: [], registro: [],
  }, {
    salvar_lancamento: () => 'l1',
  });
}

describe('texto', () => {
  it('entende sim e não', () => {
    expect(interpretarResposta('Sim')).toBe('sim');
    expect(interpretarResposta('pode lançar!')).toBe('sim');
    expect(interpretarResposta('👍')).toBe('sim');
    expect(interpretarResposta('Não')).toBe('nao');
    expect(interpretarResposta('cancela')).toBe('nao');
    expect(interpretarResposta('sim, mas o valor é 900 e não 850, corrige por favor')).toBeNull();
    expect(interpretarResposta('quanto gastei na obra?')).toBeNull();
  });
  it('normaliza telefone e lê código de vínculo', () => {
    expect(normalizarTelefone('(21) 99999-0000')).toBe('5521999990000');
    expect(normalizarTelefone('+55 21 99999-0000')).toBe('5521999990000');
    expect(codigoVinculo('Vincular 123456')).toBe('123456');
    expect(codigoVinculo('vincular 12345')).toBeNull();
  });
  it('parte mensagens longas', () => {
    const partes = partirMensagem('palavra '.repeat(1200), 4000);
    expect(partes.length).toBe(3);
    expect(partes.every((p) => p.length <= 4000)).toBe(true);
  });
});

describe('whatsapp', () => {
  it('lê texto, foto e áudio e ignora status', () => {
    const corpo = { entry: [{ changes: [{ value: {
      contacts: [{ wa_id: '5521999990000', profile: { name: 'Rhuann' } }],
      messages: [
        { id: 'w1', from: '5521999990000', type: 'text', text: { body: 'oi' } },
        { id: 'w2', from: '5521999990000', type: 'image', image: { id: 'm1', mime_type: 'image/jpeg', caption: 'nota' } },
        { id: 'w3', from: '5521999990000', type: 'audio', audio: { id: 'm2', mime_type: 'audio/ogg; codecs=opus' } },
      ],
      statuses: [{ id: 'x', status: 'read' }],
    } }] }] };
    const m = lerWebhook(corpo);
    expect(m.map((x) => x.tipo)).toEqual(['texto', 'imagem', 'audio']);
    expect(m[0]).toMatchObject({ texto: 'oi', nome: 'Rhuann' });
    expect(m[1]).toMatchObject({ midia: 'm1', legenda: 'nota' });
    expect(lerWebhook({ entry: [{ changes: [{ value: { statuses: [{}] } }] }] })).toEqual([]);
  });
  it('confere a assinatura da Meta', async () => {
    const corpo = '{"a":1}';
    const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode('segredo'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(corpo)))].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(await assinaturaValida(corpo, `sha256=${sig}`, 'segredo')).toBe(true);
    expect(await assinaturaValida(corpo + ' ', `sha256=${sig}`, 'segredo')).toBe(false);
    expect(await assinaturaValida(corpo, null, 'segredo')).toBe(false);
    expect(await assinaturaValida(corpo, `sha256=${sig}`, '')).toBe(false);
  });
});

describe('ferramentas', () => {
  it('têm esquemas estritos e nomes únicos', () => {
    const nomes = FERRAMENTAS.map((f) => f.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
    for (const f of FERRAMENTAS) {
      expect(f.parametros.additionalProperties).toBe(false);
      for (const r of f.parametros.required) expect(f.parametros.properties[r]).toBeDefined();
    }
  });
  it('esquema para o Gemini sai sem additionalProperties', () => {
    const e = esquemaGemini(FERRAMENTAS[0].parametros) as Record<string, unknown>;
    expect(JSON.stringify(e)).not.toContain('additionalProperties');
    expect(esquemaGemini({ type: 'object', properties: {}, required: [], additionalProperties: false })).toEqual({ type: 'object', required: [] });
  });
});

describe('conversa', () => {
  const agora = new Date('2026-10-29T15:00:00Z');

  it('prepara uma despesa sem gravar e grava só depois do "sim"', async () => {
    const b = base();
    const { modelo, recebidas } = iaRoteirizada([
      { texto: '', bruto: 'r1', chamadas: [{ id: 't1', nome: 'buscar_obras', args: { texto: 'leblon' } }] },
      { texto: '', bruto: 'r2', chamadas: [{ id: 't2', nome: 'lancar_conta', args: { tipo: 'pagar', descricao: 'Cimento', valor: 850, categoria_id: 'c1', obra_id: 'o1', quitado: true, conta_bancaria_id: 'b1' } }] },
      { texto: 'Preparei o lançamento do cimento.', bruto: 'r3', chamadas: [] },
    ]);
    const dep: Dependencias = { db: b.db, modelo, canal: 'whatsapp', usuario: USUARIO, agora };
    const r = await conversar(dep, { texto: 'gastei 850 de cimento no leblon, paguei na conta principal' });

    expect(r.texto).toBe('Preparei o lançamento do cimento.');
    expect(r.pendentes).toHaveLength(1);
    expect(r.pendentes[0].resumo).toContain('R$');
    expect(r.pendentes[0].resumo).toContain('Reforço Leblon');
    expect(b.chamadasRpc.find(([n]) => n === 'salvar_lancamento')).toBeUndefined();
    // A consulta de obras voltou para a IA e a resposta bruta foi reenviada na rodada seguinte.
    expect(JSON.stringify(recebidas[1])).toContain('OBR-2026-001');
    expect(recebidas[1].some((m) => m.papel === 'assistente' && m.bruto === 'r1')).toBe(true);

    b.tabelas.parcela.push({ id: 'p1', lancamento_id: 'l1', numero: 1 });
    b.tabelas.lancamento.push({ id: 'l1', codigo: 'CP-000001' });
    const sim = await conversar(dep, { texto: 'sim' });
    expect(sim.texto).toContain('CP-000001');
    const lanc = b.chamadasRpc.find(([n]) => n === 'salvar_lancamento')![1] as { p: Record<string, unknown> };
    expect(lanc.p).toMatchObject({ tipo: 'pagar', escopo: 'obra', obra_id: 'o1', valor_total: 850, data_competencia: '2026-10-29' });
    expect(b.chamadasRpc.find(([n]) => n === 'registrar_liquidacao')![1]).toMatchObject({ p_parcela: 'p1', p_conta: 'b1', p_valor: 850 });
    expect(b.tabelas.assistente_acao[0].estado).toBe('executada');

    // Um segundo "sim" não grava de novo.
    await conversar(dep, { texto: 'sim' });
    expect(b.chamadasRpc.filter(([n]) => n === 'salvar_lancamento')).toHaveLength(1);
  });

  it('"não" cancela o que estava esperando', async () => {
    const b = base();
    const { modelo } = iaRoteirizada([
      { texto: '', bruto: null, chamadas: [{ id: 't1', nome: 'registrar_diario', args: { obra_id: 'o1', tipo: 'andamento', titulo: 'Laje concretada' } }] },
      { texto: 'Preparei o registro.', bruto: null, chamadas: [] },
    ]);
    const dep: Dependencias = { db: b.db, modelo, canal: 'sistema', usuario: USUARIO, agora };
    await conversar(dep, { texto: 'laje concretada hoje no leblon' });
    const nao = await conversar(dep, { texto: 'não' });
    expect(nao.texto).toContain('cancelei');
    expect(b.tabelas.assistente_acao[0].estado).toBe('cancelada');
    expect(b.tabelas.registro).toHaveLength(0);
  });

  it('erro de validação volta para a IA, sem criar ação', async () => {
    const b = base();
    const { modelo, recebidas } = iaRoteirizada([
      { texto: '', bruto: null, chamadas: [{ id: 't1', nome: 'lancar_conta', args: { tipo: 'receber', descricao: 'X', valor: 10, categoria_id: 'c1' } }] },
      { texto: 'Essa categoria é de despesa.', bruto: null, chamadas: [] },
    ]);
    const r = await conversar({ db: b.db, modelo, canal: 'sistema', usuario: USUARIO, agora }, { texto: 'recebi 10' });
    expect(r.pendentes).toHaveLength(0);
    const res = recebidas[1].find((m) => m.papel === 'resultados');
    expect(res && res.papel === 'resultados' && res.resultados[0].erro).toBe(true);
  });

  it('sem chave de IA avisa como ligar', async () => {
    const b = base();
    const r = await conversar({ db: b.db, modelo: null, canal: 'sistema', usuario: USUARIO, agora }, { texto: 'oi' });
    expect(r.texto).toContain('chave da IA');
  });
});
