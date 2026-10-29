// Consultas e ações do assistente. Tudo roda com o login da própria pessoa,
// então as permissões do sistema (financeiro, obras do campo etc.) valem aqui também.
import { compactar, dataBr, dataValida, reais } from './texto.ts';

// O cliente do supabase-js (tipado como any para este módulo rodar no Deno e nos testes).
// deno-lint-ignore no-explicit-any
export type Db = any;

export type Imagem = { mime: string; base64: string };
export type Contexto = { hoje: string; imagem?: Imagem | null; novoId?: () => string };
export type AcaoPreparada = { tipo: string; dados: Record<string, unknown>; resumo: string };
export type AcaoGravada = { id: string; tipo: string; dados: Record<string, unknown>; resumo: string };

type Args = Record<string, unknown>;

/** Erro com mensagem para a IA (e para a pessoa) entenderem o que faltou. */
export class ErroAssistente extends Error {}

async function r<T = unknown>(consulta: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await consulta;
  if (error) {
    const msg = (error as { message?: string }).message ?? String(error);
    if (/row-level security|permission denied|Sem permissão/i.test(msg)) throw new ErroAssistente('Você não tem permissão para isso no sistema.');
    throw new ErroAssistente(msg);
  }
  return data;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const opcional = (v: unknown) => str(v) || null;
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const filtroSeguro = (s: string) => s.replace(/[,()%*\\]/g, ' ').trim();
const ENCERRADAS = ['concluida_fisicamente', 'encerrada_financeiramente', 'cancelada'];

async function obraPorId(db: Db, id: unknown) {
  if (!str(id)) throw new ErroAssistente('Informe a obra (use buscar_obras para achar o id).');
  const o = await r<{ id: string; codigo: string; nome: string } | null>(db.from('obra').select('id, codigo, nome').eq('id', str(id)).maybeSingle());
  if (!o) throw new ErroAssistente('Obra não encontrada. Use buscar_obras para achar o id certo.');
  return o;
}

// ---------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------
export async function consultar(db: Db, nome: string, a: Args, ctx: Contexto): Promise<string> {
  switch (nome) {
    case 'buscar_obras': {
      const lista = await r<Array<Record<string, unknown>>>(db.from('obra')
        .select('id, codigo, nome, status, endereco, tipo_servico, data_inicio, data_previsao_fim, cliente:cliente_id(nome)')
        .eq('arquivado', false).order('criado_em', { ascending: false }).limit(300));
      const t = semAcento(str(a.texto));
      const filtradas = lista.filter((o) => {
        if (!a.incluir_encerradas && ENCERRADAS.includes(String(o.status))) return false;
        if (!t) return true;
        const alvo = semAcento([o.codigo, o.nome, o.endereco, (o.cliente as { nome?: string } | null)?.nome].join(' '));
        return t.split(/\s+/).every((p) => alvo.includes(p));
      });
      return compactar(filtradas.slice(0, 30));
    }
    case 'detalhes_obra': {
      const o = await obraPorId(db, a.obra_id);
      const [obra, progresso, financeiro, etapas, pendencias, registros] = await Promise.all([
        r(db.from('obra').select('codigo, nome, status, endereco, tipo_servico, data_inicio, data_previsao_fim, data_conclusao, observacoes, cliente:cliente_id(nome, telefone)').eq('id', o.id).single()),
        r(db.rpc('progresso_obra', { p_obra: o.id })),
        db.rpc('resumo_obra', { p_obra: o.id }).then((x: { data: unknown }) => x.data ?? null),
        r(db.from('etapa').select('id, nome, estado, percentual, inicio_previsto, fim_previsto, fim_real, servico:servico_id(nome)').eq('obra_id', o.id).order('ordem').limit(80)),
        r(db.from('pendencia').select('id, titulo, tipo, prioridade, responsavel, prazo').eq('obra_id', o.id).eq('estado', 'aberta').order('prazo', { ascending: true, nullsFirst: false }).limit(30)),
        r(db.from('registro').select('data, tipo, titulo, texto').eq('obra_id', o.id).neq('tipo', 'sistema').order('data', { ascending: false }).limit(8)),
      ]);
      return compactar({ id: o.id, obra, progresso, financeiro: financeiro ?? 'sem acesso ao financeiro', etapas, pendencias_abertas: pendencias, ultimos_registros: registros });
    }
    case 'pendencias_gerais': {
      const itens = await r<Array<Record<string, unknown>>>(db.rpc('central_pendencias'));
      return compactar(itens.slice(0, 40).map(({ link: _link, chave: _chave, ...resto }) => resto));
    }
    case 'contas_em_aberto': {
      let q = db.from('v_parcela')
        .select('codigo, tipo, descricao, valor, saldo, vencimento, situacao, numero, total_parcelas, pessoa_nome, obra_nome, categoria_nome')
        .in('situacao', ['aberta', 'parcial', 'vencida']).order('vencimento').limit(40);
      if (a.tipo === 'pagar' || a.tipo === 'receber') q = q.eq('tipo', a.tipo);
      if (dataValida(a.ate)) q = q.lte('vencimento', a.ate);
      if (str(a.obra_id)) q = q.eq('obra_id', str(a.obra_id));
      return compactar(await r(q));
    }
    case 'indicadores_financeiros': {
      if (!dataValida(a.inicio) || !dataValida(a.fim)) throw new ErroAssistente('Informe início e fim no formato AAAA-MM-DD.');
      return compactar(await r(db.rpc('painel_indicadores', { p_inicio: a.inicio, p_fim: a.fim })));
    }
    case 'opcoes_financeiro': {
      const [categorias, contas] = await Promise.all([
        r(db.from('categoria').select('id, nome, tipo, natureza').eq('ativo', true).order('tipo').order('ordem')),
        r(db.from('conta_bancaria').select('id, nome, instituicao, tipo').eq('ativa', true).order('ordem')),
      ]);
      return compactar({ categorias, contas_bancarias: contas });
    }
    case 'buscar_pessoas': {
      const t = filtroSeguro(str(a.texto));
      if (!t) throw new ErroAssistente('Informe parte do nome, telefone ou documento.');
      const digitos = t.replace(/\D/g, '');
      const ou = [`nome.ilike.%${t}%`, `documento.ilike.%${t}%`, `email.ilike.%${t}%`];
      if (digitos.length >= 4) ou.push(`telefone.ilike.%${digitos.slice(-8)}%`);
      return compactar(await r(db.from('pessoa')
        .select('id, codigo, nome, telefone, email, eh_cliente, eh_fornecedor, eh_prestador, especialidade')
        .eq('arquivado', false).or(ou.join(',')).limit(15)));
    }
    case 'buscar_leads': {
      const lista = await r<Array<Record<string, unknown>>>(db.from('oportunidade')
        .select('id, codigo, titulo, tipo_servico, local_obra, proxima_acao, proxima_acao_data, valor_estimado, origem, estado:estado_id(nome, tipo), pessoa:pessoa_id(nome, telefone)')
        .eq('arquivado', false).order('atualizado_em', { ascending: false }).limit(100));
      const t = semAcento(str(a.texto));
      return compactar(lista
        .filter((o) => (o.estado as { tipo?: string } | null)?.tipo === 'aberto')
        .filter((o) => !t || semAcento(`${o.titulo} ${(o.pessoa as { nome?: string } | null)?.nome ?? ''}`).includes(t))
        .slice(0, 30));
    }
  }
  void ctx;
  throw new ErroAssistente(`Ferramenta desconhecida: ${nome}`);
}

// ---------------------------------------------------------------------
// Preparar ações (validam e montam o resumo; nada é gravado no sistema)
// ---------------------------------------------------------------------
const TIPOS_REGISTRO: Record<string, string> = { andamento: 'andamento', impedimento: 'impedimento', inspecao: 'inspeção', decisao: 'decisão', nota_interna: 'nota interna' };
const ESTADOS_ETAPA: Record<string, string> = {
  nao_iniciado: 'não iniciada', programado: 'programada', em_execucao: 'em execução', aguardando_material: 'aguardando material',
  aguardando_liberacao: 'aguardando liberação', suspenso: 'suspensa', executado: 'executada',
};

export async function preparar(db: Db, nome: string, a: Args, ctx: Contexto): Promise<AcaoPreparada> {
  switch (nome) {
    case 'lancar_conta': {
      const tipo = a.tipo === 'receber' ? 'receber' : a.tipo === 'pagar' ? 'pagar' : null;
      if (!tipo) throw new ErroAssistente('Diga se é conta a pagar ou a receber.');
      const valor = Math.round(Number(a.valor) * 100) / 100;
      if (!Number.isFinite(valor) || valor <= 0) throw new ErroAssistente('Valor precisa ser maior que zero.');
      const descricao = str(a.descricao);
      if (!descricao) throw new ErroAssistente('Falta a descrição.');
      const cat = await r<{ id: string; nome: string; tipo: string } | null>(db.from('categoria').select('id, nome, tipo').eq('id', str(a.categoria_id)).maybeSingle());
      if (!cat) throw new ErroAssistente('Categoria não encontrada. Use opcoes_financeiro.');
      if (cat.tipo !== tipo) throw new ErroAssistente(`A categoria "${cat.nome}" é de conta a ${cat.tipo}, não a ${tipo}.`);
      const obra = str(a.obra_id) ? await obraPorId(db, a.obra_id) : null;
      const pessoa = str(a.pessoa_id) ? await r<{ id: string; nome: string } | null>(db.from('pessoa').select('id, nome').eq('id', str(a.pessoa_id)).maybeSingle()) : null;
      if (str(a.pessoa_id) && !pessoa) throw new ErroAssistente('Pessoa não encontrada. Use buscar_pessoas.');
      const competencia = dataValida(a.data_competencia) ? a.data_competencia : ctx.hoje;
      const vencimento = dataValida(a.vencimento) ? a.vencimento : competencia;
      const quitado = a.quitado === true;
      let conta: { id: string; nome: string } | null = null;
      if (quitado) {
        conta = await r(db.from('conta_bancaria').select('id, nome').eq('id', str(a.conta_bancaria_id)).maybeSingle());
        if (!conta) throw new ErroAssistente('Informe de qual conta bancária saiu ou entrou o dinheiro (use opcoes_financeiro).');
      }
      const resumo = [
        `${tipo === 'pagar' ? 'Despesa' : 'Receita'} de ${reais(valor)}: ${descricao}`,
        `categoria ${cat.nome}`,
        obra ? `obra ${obra.codigo} ${obra.nome}` : 'empresa',
        pessoa ? pessoa.nome : null,
        `data ${dataBr(competencia)}`,
        quitado ? `${tipo === 'pagar' ? 'paga' : 'recebida'} pela ${conta!.nome}` : `vence ${dataBr(vencimento)}`,
      ].filter(Boolean).join(' · ');
      return {
        tipo: 'lancar_conta', resumo,
        dados: { tipo, descricao, valor, categoria_id: cat.id, obra_id: obra?.id ?? null, pessoa_id: pessoa?.id ?? null,
                 data_competencia: competencia, vencimento, quitado, conta_bancaria_id: conta?.id ?? null, documento_ref: opcional(a.documento_ref) },
      };
    }
    case 'registrar_diario': {
      const obra = await obraPorId(db, a.obra_id);
      const tipo = TIPOS_REGISTRO[str(a.tipo)] ? str(a.tipo) : 'andamento';
      const titulo = str(a.titulo);
      if (!titulo) throw new ErroAssistente('Falta o título do registro.');
      const data = dataValida(a.data) ? a.data : ctx.hoje;
      return {
        tipo: 'registrar_diario',
        resumo: `Diário da obra ${obra.codigo} ${obra.nome} (${TIPOS_REGISTRO[tipo]}, ${dataBr(data)}): ${titulo}${str(a.texto) ? ` · ${str(a.texto)}` : ''}`,
        dados: { obra_id: obra.id, tipo, titulo, texto: opcional(a.texto), data },
      };
    }
    case 'criar_pendencia': {
      const obra = await obraPorId(db, a.obra_id);
      const titulo = str(a.titulo);
      if (!titulo) throw new ErroAssistente('Falta o que precisa ser feito.');
      const prioridade = ['alta', 'media', 'baixa'].includes(str(a.prioridade)) ? str(a.prioridade) : 'media';
      const responsavel = ['rosae', 'cliente', 'parceiro', 'outro'].includes(str(a.responsavel)) ? str(a.responsavel) : 'rosae';
      const tipo = ['pendencia', 'decisao_cliente', 'impedimento', 'inspecao'].includes(str(a.tipo)) ? str(a.tipo) : 'pendencia';
      const prazo = dataValida(a.prazo) ? a.prazo : null;
      return {
        tipo: 'criar_pendencia',
        resumo: `Pendência na obra ${obra.codigo} ${obra.nome}: ${titulo} · prioridade ${prioridade} · com ${responsavel === 'rosae' ? 'a ROSAE' : `o ${responsavel}`}${prazo ? ` · prazo ${dataBr(prazo)}` : ''}`,
        dados: { obra_id: obra.id, titulo, descricao: opcional(a.descricao), tipo, prioridade, responsavel, prazo },
      };
    }
    case 'resolver_pendencia': {
      const p = await r<{ id: string; titulo: string; estado: string; obra: { nome: string } | null } | null>(
        db.from('pendencia').select('id, titulo, estado, obra:obra_id(nome)').eq('id', str(a.pendencia_id)).maybeSingle());
      if (!p) throw new ErroAssistente('Pendência não encontrada. Use detalhes_obra para achar o id.');
      if (p.estado !== 'aberta') throw new ErroAssistente('Essa pendência já não está aberta.');
      const resolucao = str(a.resolucao);
      if (!resolucao) throw new ErroAssistente('Diga como a pendência foi resolvida.');
      return { tipo: 'resolver_pendencia', resumo: `Resolver pendência "${p.titulo}" (${p.obra?.nome ?? 'obra'}): ${resolucao}`, dados: { pendencia_id: p.id, resolucao } };
    }
    case 'atualizar_etapa': {
      const e = await r<{ id: string; nome: string; percentual: number; estado: string; obra: { nome: string } | null } | null>(
        db.from('etapa').select('id, nome, percentual, estado, obra:obra_id(nome)').eq('id', str(a.etapa_id)).maybeSingle());
      if (!e) throw new ErroAssistente('Etapa não encontrada. Use detalhes_obra para achar o id.');
      const dados: Record<string, unknown> = { etapa_id: e.id };
      const partes: string[] = [];
      if (a.percentual !== undefined && a.percentual !== null) {
        const pct = Math.round(Number(a.percentual) * 100) / 100;
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new ErroAssistente('Percentual precisa estar entre 0 e 100.');
        dados.percentual = pct;
        partes.push(`${Number(e.percentual)}% → ${pct}%`);
      }
      if (ESTADOS_ETAPA[str(a.estado)]) { dados.estado = str(a.estado); partes.push(ESTADOS_ETAPA[str(a.estado)]); }
      if (!partes.length) throw new ErroAssistente('Diga o percentual executado ou a nova situação da etapa.');
      dados.observacao = opcional(a.observacao);
      return { tipo: 'atualizar_etapa', resumo: `Etapa "${e.nome}" (${e.obra?.nome ?? 'obra'}): ${partes.join(', ')}${dados.observacao ? ` · ${dados.observacao}` : ''}`, dados };
    }
    case 'novo_lead': {
      const titulo = str(a.titulo);
      if (!titulo) throw new ErroAssistente('Falta um título para o pedido.');
      let pessoaNome = str(a.nome);
      let pessoaId: string | null = null;
      if (str(a.pessoa_id)) {
        const p = await r<{ id: string; nome: string } | null>(db.from('pessoa').select('id, nome').eq('id', str(a.pessoa_id)).maybeSingle());
        if (!p) throw new ErroAssistente('Pessoa não encontrada. Use buscar_pessoas.');
        pessoaId = p.id; pessoaNome = p.nome;
      }
      if (!pessoaNome) throw new ErroAssistente('Falta o nome do contato.');
      const origem = ['indicacao', 'site', 'instagram', 'whatsapp', 'telefone', 'outro'].includes(str(a.origem)) ? str(a.origem) : 'indicacao';
      return {
        tipo: 'novo_lead',
        resumo: `Novo contato no funil: ${pessoaNome}${pessoaId ? ' (já cadastrado)' : str(a.telefone) ? ` · ${str(a.telefone)}` : ''} · ${titulo} · origem ${origem}`,
        dados: { pessoa_id: pessoaId, nome: pessoaNome, telefone: opcional(a.telefone), email: opcional(a.email), titulo, tipo_servico: opcional(a.tipo_servico),
                 local_obra: opcional(a.local_obra), resumo: opcional(a.resumo), origem, indicado_por: opcional(a.indicado_por) },
      };
    }
    case 'salvar_foto': {
      if (!ctx.imagem) throw new ErroAssistente('Não há foto nesta mensagem. Peça para a pessoa enviar a foto junto.');
      const obra = await obraPorId(db, a.obra_id);
      const momento = ['antes', 'durante', 'depois', 'outro'].includes(str(a.momento)) ? str(a.momento) : 'durante';
      const ext = ctx.imagem.mime.includes('png') ? 'png' : ctx.imagem.mime.includes('webp') ? 'webp' : 'jpg';
      const caminho = `obras/${obra.id}/fotos/${(ctx.novoId ?? (() => crypto.randomUUID()))()}.${ext}`;
      const bytes = Uint8Array.from(atob(ctx.imagem.base64), (c) => c.charCodeAt(0));
      await r(db.storage.from('documentos').upload(caminho, bytes, { contentType: ctx.imagem.mime, upsert: false }));
      return {
        tipo: 'salvar_foto',
        resumo: `Foto na obra ${obra.codigo} ${obra.nome} (${momento})${str(a.legenda) ? `: ${str(a.legenda)}` : ''}`,
        dados: { obra_id: obra.id, caminho, legenda: opcional(a.legenda), momento },
      };
    }
  }
  throw new ErroAssistente(`Ferramenta desconhecida: ${nome}`);
}

// ---------------------------------------------------------------------
// Executar ações confirmadas
// ---------------------------------------------------------------------
export async function executar(db: Db, acao: AcaoGravada): Promise<string> {
  // deno-lint-ignore no-explicit-any
  const d = acao.dados as Record<string, any>;
  switch (acao.tipo) {
    case 'lancar_conta': {
      const id = await r<string>(db.rpc('salvar_lancamento', {
        p: {
          tipo: d.tipo, descricao: d.descricao, pessoa_id: d.pessoa_id ?? '', categoria_id: d.categoria_id,
          escopo: d.obra_id ? 'obra' : 'empresa', obra_id: d.obra_id ?? '', valor_total: d.valor,
          data_competencia: d.data_competencia, documento_ref: d.documento_ref, observacoes: 'Lançado pelo assistente de IA.',
          parcelas: [{ numero: 1, valor: d.valor, vencimento: d.vencimento }],
        },
      }));
      if (d.quitado) {
        const parcela = await r<{ id: string }>(db.from('parcela').select('id').eq('lancamento_id', id).eq('numero', 1).single());
        await r(db.rpc('registrar_liquidacao', {
          p_parcela: parcela.id, p_conta: d.conta_bancaria_id, p_valor: d.valor, p_data: d.data_competencia,
          p_descricao: d.descricao, p_chave: `assistente-${acao.id}`,
        }));
      }
      const l = await r<{ codigo: string }>(db.from('lancamento').select('codigo').eq('id', id).single());
      return `Lançado ${l.codigo}${d.quitado ? ' e quitado' : ''}.`;
    }
    case 'registrar_diario':
      await r(db.from('registro').insert({ obra_id: d.obra_id, tipo: d.tipo, titulo: d.titulo, texto: d.texto, data: d.data }));
      return 'Registro salvo no diário da obra.';
    case 'criar_pendencia':
      await r(db.from('pendencia').insert({ obra_id: d.obra_id, titulo: d.titulo, descricao: d.descricao, tipo: d.tipo, prioridade: d.prioridade, responsavel: d.responsavel, prazo: d.prazo }));
      return 'Pendência criada.';
    case 'resolver_pendencia': {
      const feitas = await r<unknown[]>(db.from('pendencia').update({ estado: 'resolvida', resolucao: d.resolucao }).eq('id', d.pendencia_id).eq('estado', 'aberta').select('id'));
      if (!feitas.length) throw new ErroAssistente('A pendência não está mais aberta ou você não pode alterá-la.');
      return 'Pendência resolvida.';
    }
    case 'atualizar_etapa': {
      const mudar: Record<string, unknown> = { motivo_alteracao: d.observacao ?? null };
      if (d.percentual !== undefined) mudar.percentual = d.percentual;
      if (d.estado) mudar.estado = d.estado;
      const feitas = await r<unknown[]>(db.from('etapa').update(mudar).eq('id', d.etapa_id).select('id'));
      if (!feitas.length) throw new ErroAssistente('Você não pode alterar essa etapa.');
      return 'Etapa atualizada.';
    }
    case 'novo_lead': {
      let pessoaId = d.pessoa_id as string | null;
      if (!pessoaId) {
        const p = await r<{ id: string }>(db.from('pessoa').insert({ nome: d.nome, telefone: d.telefone, email: d.email, eh_cliente: true }).select('id').single());
        pessoaId = p.id;
      }
      const estado = await r<string>(db.rpc('estado_funil_id', { p_nome: 'Novo contato' }));
      const o = await r<{ codigo: string | null }>(db.from('oportunidade').insert({
        pessoa_id: pessoaId, titulo: d.titulo, origem: d.origem, indicado_por: d.indicado_por, tipo_servico: d.tipo_servico,
        local_obra: d.local_obra, resumo: d.resumo, estado_id: estado, proxima_acao: 'Retornar o contato', proxima_acao_data: null,
      }).select('codigo').single());
      return `Contato criado no funil${o.codigo ? ` (${o.codigo})` : ''}.`;
    }
    case 'salvar_foto':
      await r(db.from('foto').insert({ obra_id: d.obra_id, caminho: d.caminho, legenda: d.legenda, momento: d.momento }));
      return 'Foto salva na obra.';
  }
  throw new ErroAssistente(`Ação desconhecida: ${acao.tipo}`);
}

/** Desfaz o que a preparação deixou pronto (hoje, só o arquivo da foto). */
export async function descartar(db: Db, acao: AcaoGravada): Promise<void> {
  if (acao.tipo === 'salvar_foto' && typeof acao.dados.caminho === 'string') {
    await db.storage.from('documentos').remove([acao.dados.caminho]);
  }
}
