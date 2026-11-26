// Situação real de cada proposta, a partir das versões, das respostas do cliente e do negócio.
// É a única regra usada nos números do sistema (lista de propostas, funil, painel e departamentos),
// para que nenhuma tela conte diferente da outra.

export type Situacao =
  | 'rascunho'    // nunca foi enviada ao cliente
  | 'aguardando'  // enviada, dentro da validade, sem resposta
  | 'ajuste'      // o cliente pediu ajuste (ou você marcou que está negociando)
  | 'revisando'   // já enviada e com uma nova versão em preparo (valor ou escopo mudando)
  | 'vencida'     // enviada, sem resposta, e a validade passou
  | 'aprovada'
  | 'recusada'    // cliente recusou, ou o negócio foi marcado como perdido
  | 'arquivada';

export const SITUACAO_PROPOSTA: Record<Situacao, { rotulo: string; classe: string; dica: string }> = {
  rascunho: { rotulo: 'Em preparo', classe: 'neutro', dica: 'Ainda não foi enviada ao cliente.' },
  aguardando: { rotulo: 'Aguardando o cliente', classe: 'alerta', dica: 'Enviada e dentro da validade, sem resposta.' },
  ajuste: { rotulo: 'Em negociação', classe: 'alerta', dica: 'O cliente pediu ajuste: altere o valor ou o escopo e reenvie.' },
  revisando: { rotulo: 'Nova versão em preparo', classe: 'alerta', dica: 'A versão anterior está com o cliente; a nova ainda não foi enviada.' },
  vencida: { rotulo: 'Vencida sem resposta', classe: 'erro', dica: 'A validade passou. Reenvie com nova validade ou marque como perdida.' },
  aprovada: { rotulo: 'Aprovada', classe: 'ok', dica: 'O cliente aceitou.' },
  recusada: { rotulo: 'Recusada / perdida', classe: 'erro', dica: 'O cliente recusou ou o negócio foi perdido.' },
  arquivada: { rotulo: 'Arquivada', classe: 'neutro', dica: 'Fora das contas.' },
};

/** Enviadas e ainda sem aprovação: tudo que está "com o cliente". */
export const COM_O_CLIENTE: Situacao[] = ['aguardando', 'ajuste', 'revisando', 'vencida'];
export const EM_ABERTO: Situacao[] = ['rascunho', ...COM_O_CLIENTE];

export type EntradaSituacao = {
  estado: 'rascunho' | 'enviada' | 'em_negociacao' | 'aprovada' | 'recusada' | 'arquivada';
  versoes: { numero: number; emitida: boolean; validade: string | null }[];
  /** Tipo do estado do negócio (oportunidade) ligado, quando houver. */
  negocio?: 'aberto' | 'ganho' | 'perdido' | 'arquivado' | null;
};

export function situacaoDa(p: EntradaSituacao, hoje: string): Situacao {
  if (p.estado === 'arquivada') return 'arquivada';
  if (p.estado === 'aprovada') return 'aprovada';
  if (p.estado === 'recusada' || p.negocio === 'perdido') return 'recusada';
  const vs = [...p.versoes].sort((a, b) => b.numero - a.numero);
  const ultimaEmitida = vs.find((v) => v.emitida);
  // Nunca emitida: ainda não saiu daqui, mesmo que o estado diga outra coisa.
  if (!ultimaEmitida) return 'rascunho';
  if (vs[0] && !vs[0].emitida && vs[0].numero > ultimaEmitida.numero) return 'revisando';
  if (p.estado === 'em_negociacao') return 'ajuste';
  if (ultimaEmitida.validade && ultimaEmitida.validade < hoje) return 'vencida';
  return 'aguardando';
}

export type Contagem = Record<Situacao, { qtd: number; valor: number }> & {
  comCliente: { qtd: number; valor: number };
  emAberto: { qtd: number; valor: number };
};

/** Soma por situação. `valor` em centavos (o da versão que vale para cada proposta). */
export function contarSituacoes(itens: { situacao: Situacao; valor: number }[]): Contagem {
  const vazio = () => ({ qtd: 0, valor: 0 });
  const c = Object.fromEntries(Object.keys(SITUACAO_PROPOSTA).map((k) => [k, vazio()])) as Contagem;
  c.comCliente = vazio();
  c.emAberto = vazio();
  for (const i of itens) {
    c[i.situacao].qtd += 1;
    c[i.situacao].valor += i.valor;
    if (COM_O_CLIENTE.includes(i.situacao)) { c.comCliente.qtd += 1; c.comCliente.valor += i.valor; }
    if (EM_ABERTO.includes(i.situacao)) { c.emAberto.qtd += 1; c.emAberto.valor += i.valor; }
  }
  return c;
}

/** Frase curta com o detalhe de quem está com o cliente: "2 aguardando · 1 em negociação". */
export function detalheComCliente(c: Contagem): string {
  const partes: string[] = [];
  if (c.aguardando.qtd) partes.push(`${c.aguardando.qtd} aguardando`);
  if (c.ajuste.qtd) partes.push(`${c.ajuste.qtd} em negociação`);
  if (c.revisando.qtd) partes.push(`${c.revisando.qtd} com nova versão em preparo`);
  if (c.vencida.qtd) partes.push(`${c.vencida.qtd} vencida(s)`);
  return partes.join(' · ') || 'Nenhuma com o cliente';
}

/** Valor que vale para a proposta: o aprovado; senão o da última versão emitida; senão o do rascunho. */
export function valorDe(versoes: { id?: string; numero: number; emitida: boolean; valor: number }[], aprovadaId?: string | null): number {
  const vs = [...versoes].sort((a, b) => b.numero - a.numero);
  const aprovada = aprovadaId ? vs.find((v) => v.id === aprovadaId) : undefined;
  return (aprovada ?? vs.find((v) => v.emitida) ?? vs[0])?.valor ?? 0;
}
