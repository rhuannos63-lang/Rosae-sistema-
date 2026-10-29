// O assistente em si: conversa, usa as ferramentas e guarda as ações para confirmação.
// O mesmo núcleo atende a tela do sistema e o WhatsApp.
import { FERRAMENTAS, FERRAMENTAS_QUE_GRAVAM } from './ferramentas.ts';
import { consultar, descartar, ErroAssistente, executar, preparar, type AcaoGravada, type Db, type Imagem } from './executar.ts';
import type { Mensagem, Modelo, Resultado } from './modelo.ts';
import { dataBr, hojeBrasilia, interpretarResposta } from './texto.ts';

export type Canal = 'sistema' | 'whatsapp';
export type Dependencias = {
  db: Db;
  modelo: Modelo | null;
  canal: Canal;
  usuario: { id: string; nome: string };
  instrucoes?: string | null;
  agora?: Date;
  novoId?: () => string;
};
export type Decisao = { id: string; resumo: string; ok: boolean; mensagem: string };
export type RespostaAssistente = { texto: string; pendentes: AcaoGravada[]; decisoes?: Decisao[] };

const MAX_RODADAS = 8;
const HISTORICO = 12;

export function instrucoesSistema(usuario: string, canal: Canal, hoje: string, extras?: string | null): string {
  return `Você é o assistente de gestão da ROSAE Engenharia & Estruturas, empresa de projeto estrutural, reforço estrutural, reforma, construção e gestão de obras. Você trabalha dentro do sistema de gestão da ROSAE e ajuda a equipe em todas as etapas: captação de clientes, orçamento, obra (cronograma, diário, pendências, fotos, materiais) e financeiro.

Como agir:
- Responda em português do Brasil, direto e cordial, como um colega de escritório experiente.
- Use as ferramentas para consultar dados reais. Nunca invente números, nomes, ids ou datas. Se não encontrar, diga que não encontrou.
- Para gravar algo (despesa, receita, diário, pendência, andamento de etapa, contato, foto), use a ferramenta de gravação. Ela só prepara a ação: a pessoa confirma depois. Não diga que já gravou.
- Antes de preparar uma gravação, confira os dados: ache a obra certa com buscar_obras, a categoria e a conta com opcoes_financeiro, a pessoa com buscar_pessoas. Se houver mais de uma obra possível ou faltar algo essencial (valor, obra), pergunte em uma frase.
- Quando houver foto de nota fiscal, recibo ou comprovante, leia valor, data, fornecedor e itens e proponha o lançamento. Quando for foto de obra, ofereça salvar na obra.
- Depois de preparar ações, não repita a lista em detalhes: o sistema mostra o resumo e pede a confirmação. Diga só, em uma frase, o que preparou.
- Valores em reais no formato R$ 1.234,56. Datas no formato dd/mm/aaaa.
${canal === 'whatsapp'
    ? '- Você está no WhatsApp: respostas curtas, sem tabelas nem títulos. Para destacar use *negrito*. Listas com "• ".'
    : '- Você está na tela do sistema: pode usar listas curtas. Evite tabelas largas.'}
- Você só vê o que a pessoa pode ver no sistema. Se uma consulta disser que falta permissão, explique isso.
- Não dê pareceres técnicos de engenharia como definitivos (cálculo estrutural, laudo, ART): ajude a organizar, e lembre que a decisão técnica é do engenheiro responsável.
${extras?.trim() ? `\nInstruções do dono do sistema:\n${extras.trim()}\n` : ''}
Contexto: hoje é ${dataBr(hoje)} (${hoje}), horário de Brasília. Você está falando com ${usuario}.`;
}

async function pendentesDe(dep: Dependencias): Promise<AcaoGravada[]> {
  const limite = new Date((dep.agora ?? new Date()).getTime() - 24 * 3600 * 1000).toISOString();
  const { data: velhas } = await dep.db.from('assistente_acao').select('id, tipo, dados, resumo')
    .eq('usuario_id', dep.usuario.id).eq('estado', 'proposta').lt('criado_em', limite);
  if (velhas?.length) await cancelar(dep, velhas.map((v: AcaoGravada) => v.id));
  const { data, error } = await dep.db.from('assistente_acao').select('id, tipo, dados, resumo')
    .eq('usuario_id', dep.usuario.id).eq('estado', 'proposta').order('criado_em');
  if (error) throw error;
  return data ?? [];
}

async function registrar(dep: Dependencias, papel: 'usuario' | 'assistente', texto: string, anexo?: unknown) {
  await dep.db.from('assistente_mensagem').insert({ usuario_id: dep.usuario.id, canal: dep.canal, papel, texto: texto || '(sem texto)', anexo: anexo ?? null });
}

/** Executa as ações escolhidas (cada uma uma única vez, mesmo com cliques repetidos). */
export async function confirmar(dep: Dependencias, ids: string[]): Promise<Decisao[]> {
  const saida: Decisao[] = [];
  const { data: acoes } = await dep.db.from('assistente_acao').select('id, tipo, dados, resumo')
    .eq('usuario_id', dep.usuario.id).eq('estado', 'proposta').in('id', ids).order('criado_em');
  for (const acao of (acoes ?? []) as AcaoGravada[]) {
    const { data: pega } = await dep.db.from('assistente_acao').update({ estado: 'executada', decidida_em: new Date().toISOString() })
      .eq('id', acao.id).eq('estado', 'proposta').select('id');
    if (!pega?.length) continue;
    try {
      const mensagem = await executar(dep.db, acao);
      await dep.db.from('assistente_acao').update({ resultado: { mensagem } }).eq('id', acao.id);
      saida.push({ id: acao.id, resumo: acao.resumo, ok: true, mensagem });
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : String(e);
      await dep.db.from('assistente_acao').update({ estado: 'erro', erro: mensagem }).eq('id', acao.id);
      saida.push({ id: acao.id, resumo: acao.resumo, ok: false, mensagem });
    }
  }
  return saida;
}

export async function cancelar(dep: Dependencias, ids: string[]): Promise<Decisao[]> {
  const { data } = await dep.db.from('assistente_acao').update({ estado: 'cancelada', decidida_em: new Date().toISOString() })
    .eq('usuario_id', dep.usuario.id).eq('estado', 'proposta').in('id', ids).select('id, tipo, dados, resumo');
  for (const a of (data ?? []) as AcaoGravada[]) await descartar(dep.db, a).catch(() => undefined);
  return ((data ?? []) as AcaoGravada[]).map((a) => ({ id: a.id, resumo: a.resumo, ok: true, mensagem: 'Cancelada.' }));
}

export function textoDecisoes(decisoes: Decisao[], confirmou: boolean): string {
  if (!decisoes.length) return 'Não havia nada aguardando confirmação.';
  if (!confirmou) return decisoes.length === 1 ? 'Certo, cancelei.' : `Certo, cancelei as ${decisoes.length} ações.`;
  return decisoes.map((d) => `${d.ok ? '✅' : '⚠️'} ${d.resumo}\n${d.ok ? d.mensagem : `Não deu certo: ${d.mensagem}`}`).join('\n\n');
}

export async function conversar(dep: Dependencias, entrada: { texto: string; imagem?: Imagem | null }): Promise<RespostaAssistente> {
  const hoje = hojeBrasilia(dep.agora);
  const texto = (entrada.texto ?? '').trim();
  const pendentes = await pendentesDe(dep);

  // "sim" / "não" respondem às ações que estão esperando.
  const resposta = pendentes.length && !entrada.imagem ? interpretarResposta(texto) : null;
  if (resposta) {
    const ids = pendentes.map((p) => p.id);
    const decisoes = resposta === 'sim' ? await confirmar(dep, ids) : await cancelar(dep, ids);
    const saida = textoDecisoes(decisoes, resposta === 'sim');
    await registrar(dep, 'usuario', texto);
    await registrar(dep, 'assistente', saida);
    return { texto: saida, pendentes: [], decisoes };
  }

  if (!dep.modelo) {
    return { texto: 'O assistente ainda não está ligado: falta cadastrar a chave da IA. Veja em Empresa e Sistema › Assistente IA › Ligar.', pendentes };
  }

  const { data: anteriores } = await dep.db.from('assistente_mensagem').select('papel, texto')
    .eq('usuario_id', dep.usuario.id).order('criado_em', { ascending: false }).limit(HISTORICO);
  const historico: Mensagem[] = ((anteriores ?? []) as Array<{ papel: string; texto: string }>).reverse()
    .map((m) => (m.papel === 'usuario' ? { papel: 'usuario', texto: m.texto } : { papel: 'assistente', texto: m.texto }));
  // O histórico precisa começar pela pessoa.
  while (historico.length && historico[0].papel !== 'usuario') historico.shift();

  const aviso = pendentes.length
    ? `\n\n[Aguardando confirmação da pessoa: ${pendentes.map((p) => p.resumo).join(' | ')}]`
    : '';
  const mensagens: Mensagem[] = [...historico, { papel: 'usuario', texto: (texto || 'Veja a foto.') + aviso, imagem: entrada.imagem ?? null }];
  await registrar(dep, 'usuario', texto || '(foto)', entrada.imagem ? { tipo: 'imagem', mime: entrada.imagem.mime } : null);

  const sistema = instrucoesSistema(dep.usuario.nome, dep.canal, hoje, dep.instrucoes);
  const ctx = { hoje, imagem: entrada.imagem ?? null, novoId: dep.novoId };
  let final = '';
  for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
    const r = await dep.modelo.responder(sistema, mensagens, FERRAMENTAS);
    mensagens.push({ papel: 'assistente', texto: r.texto, chamadas: r.chamadas, bruto: r.bruto });
    if (r.texto) final = r.texto;
    if (!r.chamadas.length) break;
    const resultados: Resultado[] = await Promise.all(r.chamadas.map(async (c): Promise<Resultado> => {
      try {
        if (FERRAMENTAS_QUE_GRAVAM.has(c.nome)) {
          const p = await preparar(dep.db, c.nome, c.args, ctx);
          const { error } = await dep.db.from('assistente_acao').insert({ usuario_id: dep.usuario.id, canal: dep.canal, tipo: p.tipo, dados: p.dados, resumo: p.resumo });
          if (error) throw new ErroAssistente(error.message);
          return { id: c.id, nome: c.nome, conteudo: `Preparado, aguardando confirmação da pessoa: ${p.resumo}` };
        }
        return { id: c.id, nome: c.nome, conteudo: await consultar(dep.db, c.nome, c.args, ctx) };
      } catch (e) {
        return { id: c.id, nome: c.nome, conteudo: e instanceof Error ? e.message : String(e), erro: true };
      }
    }));
    mensagens.push({ papel: 'resultados', resultados });
    if (rodada === MAX_RODADAS - 1) final ||= 'Precisei de muitas consultas e parei aqui. Pode detalhar um pouco mais o pedido?';
  }
  final ||= 'Pronto.';
  await registrar(dep, 'assistente', final);
  return { texto: final, pendentes: await pendentesDe(dep) };
}
