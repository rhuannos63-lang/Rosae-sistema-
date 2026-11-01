// Modelo do conteúdo de uma versão de proposta e cálculos puros.
// Valores guardados em reais no JSON (o banco confere as somas em numeric);
// todas as contas aqui são feitas em centavos inteiros.
import { formatar, paraBanco, doBanco, ratear, somar, type Centavos } from './dinheiro';

const reais = (c: Centavos): number => Number(paraBanco(c));

export type Item = {
  id: string;
  modelo_id?: string | null;
  titulo: string;
  descricao?: string;
  unidade: string;
  quantidade: number;
  preco_unitario: number; // reais
  complexidade?: string | null;
  fator?: number; // multiplicador da complexidade (1 = sem ajuste)
  total: number; // reais, sempre recalculado por totalItem
  // Etapas que a obra recebe ao converter (o orçamento automático preenche com as durações).
  etapas?: { nome: string; descricao?: string; percentual?: number | null; duracao_dias?: number | null }[];
};
export type Ambiente = { id: string; nome: string; itens: Item[] };
export type Responsabilidade = { parte: string; itens: string[] };
export type Etapa = { nome: string; descricao?: string; prazo_dias?: number | null; percentual?: number | null };
export type ParcelaProposta = { descricao: string; valor: number; quando?: string };
export type Topico = { titulo: string; texto: string };
export type Pergunta = { pergunta: string; resposta: string };
export type OpcaoProposta = { nome: string; subtitulo: string; valor: number; destaques: string[]; recomendado: boolean; principal: boolean };

export type ValoresManuais = Partial<Record<1 | 2 | 3, number>>;

export type Conteudo = {
  apresentacao: string;
  necessidade: string;
  local: string;
  ambientes: Ambiente[];
  inclusoes: string[];
  exclusoes: string[];
  responsabilidades: Responsabilidade[];
  etapas: Etapa[];
  prazo_texto: string;
  pagamento: { descricao: string; parcelas: ParcelaProposta[] };
  premissas: string[];
  garantia: string;
  observacoes: string;
  validade_dias: number;
  // Só em aditivos: por que mudou e quanto muda o prazo.
  motivo?: string;
  impacto_prazo_dias?: number | null;
  // Partes da apresentação completa (o orçamento automático preenche; todas opcionais).
  tipo_servico?: string;
  resumo?: string;
  dados_tecnicos?: { rotulo: string; valor: string }[];
  entregaveis?: string[];
  metodologia?: Topico[];
  riscos?: string[];
  normas?: string[];
  diferenciais?: Topico[];
  faq?: Pergunta[];
  opcoes?: OpcaoProposta[];
  condicao_especial?: string;
  prazo_total_dias?: number | null;
  // valores: preço que você definiu para um pacote, no lugar do calculado pela tabela (reais, por número do pacote).
  // Páginas da apresentação que você tirou (ids de PAGINAS_OPCIONAIS). As obrigatórias não saem.
  paginas_ocultas?: string[];
  // Gatilhos de confiança: compromissos (reduzem o risco percebido) e depoimentos (prova social).
  compromissos?: string[];
  depoimentos?: string[];
  // Cor da apresentação (uma das paletas de Aparência). Vazio = musgo da marca.
  cor?: string;
  gerador?: { tipo: string; respostas: Record<string, string | number | boolean | null>; pacote: number; valores?: ValoresManuais; em: string };
};

export type ModeloServico = {
  id: string; nome: string; grupo: string; descricao_cliente: string | null; palavras_chave: string[];
  unidade: string; modelo_preco: 'fixo' | 'por_unidade' | 'area_complexidade'; preco_base: string | number | null;
  complexidade: { nivel: string; fator: number; descricao?: string }[];
  inclusoes: string[]; exclusoes: string[]; responsabilidades: Responsabilidade[];
  etapas: { nome: string; descricao?: string; percentual?: number }[];
  perguntas: { texto: string }[]; premissas: string[]; pontos_conferir: string[]; ativo: boolean; ordem: number;
};

export const UNIDADES: Record<string, string> = {
  m: 'm', m2: 'm²', m3: 'm³', kg: 'kg', un: 'un', vb: 'verba', mes: 'mês', visita: 'visita', dia: 'dia', pt: 'ponto',
};

export const APRESENTACAO_PADRAO =
  'A ROSAE Engenharia & Estruturas atua em projeto estrutural, reforço de estruturas em concreto e aço, reformas, construção e gestão de obras. ' +
  'Trabalhamos com responsabilidade técnica, transparência no escopo e comunicação clara em cada etapa.';

export function conteudoVazio(): Conteudo {
  return {
    apresentacao: APRESENTACAO_PADRAO,
    necessidade: '',
    local: '',
    ambientes: [],
    inclusoes: [],
    exclusoes: [],
    responsabilidades: [],
    etapas: [],
    prazo_texto: '',
    pagamento: { descricao: '', parcelas: [] },
    premissas: [],
    garantia: '',
    observacoes: '',
    validade_dias: 15,
  };
}

/** Completa campos que faltam (versões antigas ou conteúdo parcial). */
export function normalizar(c: Partial<Conteudo> | null | undefined): Conteudo {
  const base = conteudoVazio();
  const r = { ...base, ...(c ?? {}) } as Conteudo;
  r.pagamento = { ...base.pagamento, ...(c?.pagamento ?? {}) };
  r.ambientes = (r.ambientes ?? []).map((a) => ({ ...a, itens: (a.itens ?? []).map((i) => ({ ...i, total: totalItem(i) })) }));
  return r;
}

let seq = 0;
export function novoId(): string {
  seq += 1;
  return `${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Total do item em reais: quantidade × preço × fator, arredondado ao centavo. */
export function totalItem(i: Pick<Item, 'quantidade' | 'preco_unitario' | 'fator'>): number {
  const q = Number(i.quantidade) || 0;
  const p = paraCentavos(i.preco_unitario);
  const f = i.fator && i.fator > 0 ? i.fator : 1;
  return reais(Math.round(q * p * f));
}

export function paraCentavos(r: number | string | null | undefined): Centavos {
  return doBanco(typeof r === 'string' && r.trim() === '' ? 0 : r ?? 0);
}

export function totalAmbiente(a: Ambiente): Centavos {
  return somar(a.itens.map((i) => paraCentavos(totalItem(i))));
}

export function totalConteudo(c: Conteudo): Centavos {
  return somar(c.ambientes.map(totalAmbiente));
}

export function somaParcelas(c: Conteudo): Centavos {
  return somar(c.pagamento.parcelas.map((p) => paraCentavos(p.valor)));
}

/** Pendências que impedem emitir (mesmas regras do banco, para avisar antes). */
export function pendencias(c: Conteudo, aditivo = false): string[] {
  const p: string[] = [];
  if (aditivo && !c.motivo?.trim()) p.push('Informe o motivo do aditivo (aba Apresentação).');
  const total = totalConteudo(c);
  if (c.ambientes.length === 0 || total <= 0) p.push('Inclua ao menos um item com valor.');
  c.ambientes.forEach((a) => {
    if (!a.nome.trim()) p.push('Há um ambiente sem nome.');
    a.itens.forEach((i) => {
      if (!i.titulo.trim()) p.push(`Item sem título em "${a.nome || 'ambiente'}".`);
      if (!(Number(i.quantidade) > 0)) p.push(`"${i.titulo || 'Item'}" está sem quantidade.`);
      if (!(paraCentavos(i.preco_unitario) > 0)) p.push(`"${i.titulo || 'Item'}" está sem preço.`);
    });
  });
  if (c.pagamento.parcelas.length > 0 && somaParcelas(c) !== total) {
    p.push('As condições de pagamento não somam o total da proposta.');
  }
  if (!c.prazo_texto.trim() && c.etapas.length === 0) p.push('Informe o prazo ou as etapas.');
  return Array.from(new Set(p));
}

/** Divide o total em parcelas por percentuais (soma exata pelo maior resto). */
export function parcelasPorPercentual(total: Centavos, partes: { descricao: string; percentual: number; quando?: string }[]): ParcelaProposta[] {
  const pesos = partes.map((p) => Math.max(0, p.percentual));
  const valores = ratear(total, pesos);
  return partes.map((p, k) => ({ descricao: p.descricao, quando: p.quando, valor: reais(valores[k]) }));
}

/** Gera condições comuns de pagamento. */
export function sugerirPagamento(total: Centavos, modo: 'entrada_parcelas' | 'etapas' | 'mensal', n: number, etapas: Etapa[] = []): ParcelaProposta[] {
  if (total <= 0) return [];
  if (modo === 'etapas' && etapas.length > 0) {
    const temPct = etapas.some((e) => (e.percentual ?? 0) > 0);
    return parcelasPorPercentual(
      total,
      etapas.map((e) => ({ descricao: e.nome, percentual: temPct ? e.percentual ?? 0 : 1, quando: 'Ao concluir a etapa' })),
    );
  }
  if (modo === 'mensal') {
    const k = Math.max(1, n);
    return parcelasPorPercentual(total, Array.from({ length: k }, (_, j) => ({ descricao: `Mensalidade ${j + 1}/${k}`, percentual: 1, quando: `Mês ${j + 1}` })));
  }
  const k = Math.max(1, n);
  return parcelasPorPercentual(total, [
    { descricao: 'Entrada', percentual: 30, quando: 'Na assinatura' },
    ...Array.from({ length: k }, (_, j) => ({ descricao: `Parcela ${j + 1}/${k}`, percentual: 70 / k, quando: `${30 * (j + 1)} dias` })),
  ]);
}

// ---------------------------------------------------------------------
// Do texto ao escopo: encontra serviços da biblioteca citados no pedido.
// ---------------------------------------------------------------------
export function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const AMBIENTES_CONHECIDOS = [
  'sala', 'cozinha', 'banheiro', 'lavabo', 'quarto', 'suíte', 'suite', 'varanda', 'área de serviço', 'area de servico', 'garagem',
  'fachada', 'telhado', 'cobertura', 'escada', 'piscina', 'muro', 'quintal', 'escritório', 'escritorio', 'loja', 'galpão', 'galpao',
];

export type Sugestao = { modelo: ModeloServico; termos: string[]; pontuacao: number };

export function sugerirServicos(texto: string, biblioteca: ModeloServico[]): Sugestao[] {
  const t = ` ${semAcento(texto).replace(/[^a-z0-9²]+/g, ' ')} `;
  const r: Sugestao[] = [];
  for (const m of biblioteca) {
    if (!m.ativo) continue;
    const termos = [m.nome, ...m.palavras_chave].filter((k) => {
      const k2 = semAcento(k).replace(/[^a-z0-9²]+/g, ' ').trim();
      return k2.length > 2 && t.includes(` ${k2} `);
    });
    if (termos.length) r.push({ modelo: m, termos, pontuacao: termos.reduce((s, k) => s + k.split(' ').length, 0) });
  }
  return r.sort((a, b) => b.pontuacao - a.pontuacao || a.modelo.ordem - b.modelo.ordem);
}

export function encontrarAmbientes(texto: string): string[] {
  const t = ` ${semAcento(texto)} `;
  const vistos = new Set<string>();
  const r: string[] = [];
  for (const a of AMBIENTES_CONHECIDOS) {
    const chave = semAcento(a);
    if (new RegExp(`[^a-z]${chave}s?[^a-z]`).test(t) && !vistos.has(chave.replace('suite', 'suite'))) {
      vistos.add(chave);
      const nome = a.charAt(0).toUpperCase() + a.slice(1);
      if (!r.some((x) => semAcento(x) === chave)) r.push(nome);
    }
  }
  return r;
}

/** Primeira área citada no texto ("120 m2", "85,5 m²", "200 metros quadrados"). */
export function encontrarArea(texto: string): number | null {
  const m = semAcento(texto).match(/(\d+(?:[.,]\d+)?)\s*(?:m2|m²|metros? quadrados?)/);
  return m ? Number(m[1].replace(',', '.')) : null;
}

/** Cria um item a partir de um modelo da biblioteca. */
export function itemDoModelo(m: ModeloServico, quantidade = 1, nivel?: string): Item {
  const c = m.complexidade.find((x) => x.nivel === nivel) ?? (m.modelo_preco === 'area_complexidade' ? m.complexidade[0] : undefined);
  const i: Item = {
    id: novoId(),
    modelo_id: m.id,
    titulo: m.nome,
    descricao: m.descricao_cliente ?? '',
    unidade: m.unidade,
    quantidade: m.modelo_preco === 'fixo' ? 1 : quantidade,
    preco_unitario: Number(m.preco_base ?? 0),
    complexidade: c?.nivel ?? null,
    fator: c?.fator ?? 1,
    total: 0,
  };
  i.total = totalItem(i);
  return i;
}

function unir(a: string[], b: string[]): string[] {
  const r = [...a];
  for (const x of b) if (!r.some((y) => semAcento(y) === semAcento(x))) r.push(x);
  return r;
}

function unirResponsabilidades(a: Responsabilidade[], b: Responsabilidade[]): Responsabilidade[] {
  const r = a.map((x) => ({ ...x, itens: [...x.itens] }));
  for (const x of b) {
    const alvo = r.find((y) => y.parte === x.parte);
    if (alvo) alvo.itens = unir(alvo.itens, x.itens);
    else r.push({ parte: x.parte, itens: [...x.itens] });
  }
  return r;
}

/** Acrescenta ao conteúdo os textos padrão (inclusões, exclusões, responsabilidades, etapas, premissas) dos modelos usados. */
export function aplicarModelos(c: Conteudo, modelos: ModeloServico[]): Conteudo {
  const r = { ...c };
  for (const m of modelos) {
    r.inclusoes = unir(r.inclusoes, m.inclusoes);
    r.exclusoes = unir(r.exclusoes, m.exclusoes);
    r.premissas = unir(r.premissas, m.premissas);
    r.responsabilidades = unirResponsabilidades(r.responsabilidades, m.responsabilidades);
    if (r.etapas.length === 0) r.etapas = m.etapas.map((e) => ({ nome: e.nome, descricao: e.descricao, percentual: e.percentual ?? null, prazo_dias: null }));
  }
  return r;
}

/** Monta um rascunho de escopo a partir do pedido escrito pelo cliente. Nada é enviado sem revisão. */
export function rascunhoDoTexto(texto: string, biblioteca: ModeloServico[], base: Conteudo = conteudoVazio()): { conteudo: Conteudo; usados: ModeloServico[]; perguntas: string[] } {
  const sugestoes = sugerirServicos(texto, biblioteca);
  const usados = sugestoes.slice(0, 3).map((s) => s.modelo);
  const area = encontrarArea(texto);
  const ambientes = encontrarAmbientes(texto);
  const itens = usados.map((m) => itemDoModelo(m, m.unidade === 'm2' && area ? area : 1));
  let c: Conteudo = { ...base, necessidade: base.necessidade || texto.trim() };
  if (itens.length) {
    if (ambientes.length > 1 && usados.every((m) => m.unidade !== 'm2')) {
      c.ambientes = [...c.ambientes, ...ambientes.map((nome) => ({ id: novoId(), nome, itens: itens.map((i) => ({ ...i, id: novoId() })) }))];
    } else {
      c.ambientes = [...c.ambientes, { id: novoId(), nome: ambientes.length === 1 ? ambientes[0] : 'Escopo geral', itens }];
    }
  }
  c = aplicarModelos(c, usados);
  const perguntas = unir([], usados.flatMap((m) => m.perguntas.map((p) => p.texto)));
  if (!area && usados.some((m) => m.unidade === 'm2')) perguntas.unshift('Qual a área (m²)? Não encontrei no texto.');
  return { conteudo: c, usados, perguntas };
}

// ---------------------------------------------------------------------
// Comparação entre versões
// ---------------------------------------------------------------------
export type Diferenca = { onde: string; antes: string; depois: string };

export function compararVersoes(a: Conteudo, b: Conteudo): Diferenca[] {
  const d: Diferenca[] = [];
  const fmt = (c: Centavos) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const ta = totalConteudo(a), tb = totalConteudo(b);
  if (ta !== tb) d.push({ onde: 'Valor total', antes: fmt(ta), depois: fmt(tb) });
  const itensA = new Map(a.ambientes.flatMap((x) => x.itens.map((i) => [`${x.nome} · ${i.titulo}`, i] as const)));
  const itensB = new Map(b.ambientes.flatMap((x) => x.itens.map((i) => [`${x.nome} · ${i.titulo}`, i] as const)));
  for (const [k, i] of itensA) {
    const j = itensB.get(k);
    if (!j) d.push({ onde: k, antes: `${i.quantidade} ${UNIDADES[i.unidade] ?? i.unidade} · ${fmt(paraCentavos(totalItem(i)))}`, depois: 'removido' });
    else if (totalItem(i) !== totalItem(j) || i.quantidade !== j.quantidade)
      d.push({ onde: k, antes: `${i.quantidade} ${UNIDADES[i.unidade] ?? i.unidade} · ${fmt(paraCentavos(totalItem(i)))}`, depois: `${j.quantidade} ${UNIDADES[j.unidade] ?? j.unidade} · ${fmt(paraCentavos(totalItem(j)))}` });
  }
  for (const [k, j] of itensB) if (!itensA.has(k)) d.push({ onde: k, antes: 'não existia', depois: `${j.quantidade} ${UNIDADES[j.unidade] ?? j.unidade} · ${fmt(paraCentavos(totalItem(j)))}` });
  const lista = (nome: string, x: string[], y: string[]) => {
    const tirados = x.filter((v) => !y.includes(v));
    const postos = y.filter((v) => !x.includes(v));
    if (tirados.length || postos.length) d.push({ onde: nome, antes: tirados.join('; ') || '—', depois: postos.join('; ') || '—' });
  };
  lista('Incluso', a.inclusoes, b.inclusoes);
  lista('Não incluso', a.exclusoes, b.exclusoes);
  lista('Premissas', a.premissas, b.premissas);
  if (a.prazo_texto !== b.prazo_texto) d.push({ onde: 'Prazo', antes: a.prazo_texto || '—', depois: b.prazo_texto || '—' });
  const pa = a.pagamento.parcelas.map((p) => `${p.descricao} ${fmt(paraCentavos(p.valor))}`).join('; ');
  const pb = b.pagamento.parcelas.map((p) => `${p.descricao} ${fmt(paraCentavos(p.valor))}`).join('; ');
  if (pa !== pb) d.push({ onde: 'Pagamento', antes: pa || '—', depois: pb || '—' });
  if (a.validade_dias !== b.validade_dias) d.push({ onde: 'Validade', antes: `${a.validade_dias} dias`, depois: `${b.validade_dias} dias` });
  return d;
}

/** Recalcula todos os totais antes de salvar (o banco confere de novo ao emitir). */
export function prepararParaSalvar(c: Conteudo): { conteudo: Conteudo; valor_total: number } {
  const conteudo: Conteudo = {
    ...c,
    ambientes: c.ambientes.map((a) => ({ ...a, itens: a.itens.map((i) => ({ ...i, total: totalItem(i) })) })),
  };
  return { conteudo, valor_total: reais(totalConteudo(conteudo)) };
}

// ---------------------------------------------------------------------
// Editar valores de um orçamento pronto
// ---------------------------------------------------------------------
const brl = (c: Centavos) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const arred10c = (c: Centavos): Centavos => Math.max(0, Math.round(c / 1000) * 1000);

/** Atualiza o valor à vista escrito pelo orçamento automático ("À vista: R$ … (5% de desconto)"). */
export function atualizarAvista(texto: string, total: Centavos): string {
  const pct = (s: string) => Number(s.replace(',', '.')) || 0;
  return texto
    .replace(/À vista: R\$\s?[\d.]+,\d{2} \(([\d,]+)% de desconto\)/, (_, d: string) => `À vista: ${brl(arred10c(total * (1 - pct(d) / 100)))} (${d}% de desconto)`)
    .replace(/à vista com ([\d,]+)% de desconto: R\$\s?[\d.]+,\d{2}/, (_, d: string) => `à vista com ${d}% de desconto: ${brl(arred10c(total * (1 - pct(d) / 100)))}`);
}

/**
 * Depois de mudar itens ou valores: leva o novo total para as parcelas (se elas fechavam
 * com o total anterior), para o pacote escolhido na comparação e para o valor à vista.
 */
export function acompanharTotal(antes: Conteudo, depois: Conteudo): Conteudo {
  const tA = totalConteudo(antes);
  const tD = totalConteudo(depois);
  if (tA === tD) return depois;
  let r = depois;
  const parcelas = r.pagamento.parcelas;
  const pesos = parcelas.map((p) => Math.max(0, paraCentavos(p.valor)));
  if (tD > 0 && parcelas.length > 0 && somaParcelas(antes) === tA && pesos.some((p) => p > 0)) {
    const novos = ratear(tD, pesos);
    r = { ...r, pagamento: { ...r.pagamento, parcelas: parcelas.map((p, k) => ({ ...p, valor: reais(novos[k]) })) } };
  }
  if (r.opcoes?.some((o) => o.principal)) r = { ...r, opcoes: r.opcoes.map((o) => (o.principal ? { ...o, valor: reais(tD) } : o)) };
  r = { ...r, pagamento: { ...r.pagamento, descricao: atualizarAvista(r.pagamento.descricao, tD) } };
  if (r.condicao_especial) r = { ...r, condicao_especial: atualizarAvista(r.condicao_especial, tD) };
  return r;
}

/**
 * Leva o total da proposta para o valor pedido, repartindo a diferença entre os itens
 * na proporção de cada um. A soma fecha ao centavo: se nenhum preço unitário fecha,
 * o maior item passa a ser cobrado como verba.
 */
export function ajustarTotal(c: Conteudo, alvo: Centavos): Conteudo {
  const atual = totalConteudo(c);
  if (alvo <= 0 || atual <= 0 || alvo === atual) return c;
  const lista = c.ambientes.flatMap((a, ai) => a.itens.map((i, ii) => ({ ai, ii, i, t: paraCentavos(totalItem(i)) })));
  const metas = ratear(alvo, lista.map((x) => Math.max(0, x.t)));
  const novos = lista.map((x, k) => {
    const mult = (Number(x.i.quantidade) || 0) * (x.i.fator && x.i.fator > 0 ? x.i.fator : 1);
    if (!(mult > 0) || x.t <= 0) return x.i;
    return { ...x.i, preco_unitario: reais(Math.round(metas[k] / mult)) };
  });
  // Diferença de arredondamento: vai para um item de quantidade 1, ou o maior vira verba.
  const falta = alvo - somar(novos.map((i) => paraCentavos(totalItem(i))));
  if (falta !== 0) {
    const k1 = novos.findIndex((i, k) => lista[k].t > 0 && Number(i.quantidade) === 1 && (!i.fator || i.fator === 1));
    if (k1 >= 0) novos[k1] = { ...novos[k1], preco_unitario: reais(paraCentavos(novos[k1].preco_unitario) + falta) };
    else {
      const km = lista.reduce((m, x, k) => (x.t > lista[m].t ? k : m), 0);
      const t = paraCentavos(totalItem(novos[km])) + falta;
      novos[km] = { ...novos[km], quantidade: 1, unidade: 'vb', fator: 1, complexidade: null, preco_unitario: reais(t) };
    }
  }
  const porPosicao = new Map(lista.map((x, k) => [`${x.ai}:${x.ii}`, novos[k]]));
  const depois: Conteudo = {
    ...c,
    ambientes: c.ambientes.map((a, ai) => ({ ...a, itens: a.itens.map((i, ii) => { const n = porPosicao.get(`${ai}:${ii}`) ?? i; return { ...n, total: totalItem(n) }; }) })),
  };
  return acompanharTotal(c, depois);
}

/** Reparte o total entre as parcelas na proporção atual de cada uma (ou em partes iguais, se estiverem zeradas). */
export function parcelasAoTotal(c: Conteudo): Conteudo {
  const total = totalConteudo(c);
  const ps = c.pagamento.parcelas;
  if (!ps.length || total <= 0) return c;
  const pesos = ps.map((p) => Math.max(0, paraCentavos(p.valor)));
  const novos = ratear(total, pesos.some((p) => p > 0) ? pesos : ps.map(() => 1));
  return { ...c, pagamento: { ...c.pagamento, parcelas: ps.map((p, k) => ({ ...p, valor: reais(novos[k]) })) } };
}

// ---------------------------------------------------------------------
// Edição direta na página da apresentação
// ---------------------------------------------------------------------
/** Páginas que podem sair da apresentação. Capa, escopo, incluso, investimento, condições e aceite ficam sempre. */
export const PAGINAS_OPCIONAIS: Record<string, string> = {
  resumo: 'Em resumo', entendimento: 'O que entendemos', entregaveis: 'O que você recebe', responsabilidades: 'Responsabilidades',
  metodologia: 'Como trabalhamos', cronograma: 'Cronograma', pacotes: 'Escolha do pacote', compromissos: 'Nossos compromissos',
  porque: 'Por que a ROSAE', depoimentos: 'Quem já confiou', faq: 'Perguntas frequentes',
};

/** Tira ou devolve uma página opcional. */
export function alternarPagina(c: Conteudo, id: string): Conteudo {
  if (!(id in PAGINAS_OPCIONAIS)) return c;
  const atuais = c.paginas_ocultas ?? [];
  const novas = atuais.includes(id) ? atuais.filter((x) => x !== id) : [...atuais, id];
  return { ...c, paginas_ocultas: novas };
}

export function paginaOculta(c: Pick<Conteudo, 'paginas_ocultas'>, id: string): boolean {
  return id in PAGINAS_OPCIONAIS && (c.paginas_ocultas ?? []).includes(id);
}

/**
 * Valor de uma linha digitado direto na página. Mantém quantidade e fator quando o preço
 * unitário fecha o total ao centavo; senão a linha passa a ser cobrada como verba.
 */
export function definirTotalItem(i: Item, total: Centavos): Item {
  const alvo = Math.max(0, total);
  const mult = (Number(i.quantidade) || 0) * (i.fator && i.fator > 0 ? i.fator : 1);
  if (mult > 0) {
    const pu = Math.round(alvo / mult);
    const n = { ...i, preco_unitario: reais(pu) };
    if (paraCentavos(totalItem(n)) === alvo) return { ...n, total: totalItem(n) };
  }
  const n = { ...i, quantidade: 1, unidade: 'vb', fator: 1, complexidade: null, preco_unitario: reais(alvo) };
  return { ...n, total: totalItem(n) };
}

/** Troca um item (por posição) e devolve o conteúdo com as parcelas e o pacote acompanhando o novo total. */
export function mudarItem(c: Conteudo, ai: number, ii: number, f: (i: Item) => Item): Conteudo {
  const depois: Conteudo = {
    ...c,
    ambientes: c.ambientes.map((a, x) => (x !== ai ? a : { ...a, itens: a.itens.map((i, y) => { if (y !== ii) return i; const n = f(i); return { ...n, total: totalItem(n) }; }) })),
  };
  return acompanharTotal(c, depois);
}

// ---------------------------------------------------------------------
// Conversão: o que ajuda o cliente a decidir com segurança
// ---------------------------------------------------------------------
/** Área informada no orçamento automático (m²), quando houver. */
export function areaDaProposta(c: Pick<Conteudo, 'gerador'>): number {
  const a = Number(c.gerador?.respostas?.area);
  return Number.isFinite(a) && a > 0 ? a : 0;
}

/** "R$ 38,61 por m²": o valor traduzido numa unidade que o cliente compara. */
export function valorPorMetro(totalCentavos: Centavos, area: number): string | null {
  if (!(area > 0) || !(totalCentavos > 0)) return null;
  return `${formatar(Math.round(totalCentavos / area))} por m²`;
}

/** Facilita a decisão mostrando o parcelamento junto do preço. */
export function textoParcelamento(c: Pick<Conteudo, 'pagamento'>): string | null {
  const n = (c.pagamento?.parcelas ?? []).filter((p) => Number(p.valor) > 0).length;
  return n >= 2 ? `em até ${n} parcelas` : null;
}

const SERVICOS_DE_OBRA = ['reforma', 'construcao', 'reforco', 'gestao'];
/** Compromissos sugeridos para o tipo de serviço (o engenheiro edita na página). */
export function compromissosPadrao(c: Pick<Conteudo, 'tipo_servico' | 'gerador'>): string[] {
  const tipo = c.gerador?.tipo ?? c.tipo_servico ?? '';
  const obra = SERVICOS_DE_OBRA.some((t) => tipo.toLowerCase().includes(t));
  return [
    'Preço fechado: nada fora do escopo é cobrado sem o seu aceite por escrito.',
    obra
      ? 'Cronograma com acompanhamento semanal, fotos e relatório de cada etapa.'
      : 'Ajustes de projeto incluídos até a aprovação, dentro do escopo desta proposta.',
    'Responsabilidade técnica com ART registrada no CREA.',
    obra
      ? 'Obra limpa e organizada, com proteção dos ambientes e descarte correto.'
      : 'Entrega no prazo combinado; qualquer imprevisto é avisado com antecedência e um novo plano.',
  ];
}

export type ItemForca = { ok: boolean; titulo: string; dica: string };
/**
 * Força da proposta: confere os elementos que mais pesam na decisão do cliente
 * (clareza, ancoragem em pacotes, facilidade de pagamento, redução de risco, prova social,
 * autoridade, respostas às objeções e validade curta).
 */
export function forcaDaProposta(c: Conteudo): { nota: number; itens: ItemForca[] } {
  const vis = (id: string) => !paginaOculta(c, id);
  const opcoes = (c.opcoes ?? []).filter((o) => o.valor > 0);
  const itens: ItemForca[] = [
    { ok: !!c.resumo?.trim() && vis('resumo'), titulo: 'Abre com o resultado', dica: 'Uma página “Em resumo” com o que o cliente ganha, o valor e o prazo. Quem decide lê primeiro (e às vezes só) isso.' },
    { ok: !!c.necessidade?.trim(), titulo: 'Mostra que você entendeu o pedido', dica: 'Escreva a necessidade com as palavras do cliente. Proposta personalizada converte mais que proposta genérica.' },
    { ok: c.inclusoes.length >= 3 && c.exclusoes.length >= 2, titulo: 'Deixa claro o que está e o que não está incluso', dica: 'Pelo menos 3 inclusões e 2 exclusões. Clareza evita objeção e discussão depois.' },
    { ok: opcoes.length >= 3 && opcoes.some((o) => o.recomendado) && vis('pacotes'), titulo: 'Três pacotes, com um recomendado', dica: 'Três opções ancoram o preço: o cliente compara entre elas, e não entre você e o concorrente.' },
    { ok: !!textoParcelamento(c), titulo: 'Facilita o pagamento', dica: 'Divida em parcelas ou por etapa. O parcelamento aparece junto do preço.' },
    { ok: !!(c.prazo_total_dias || c.etapas.length), titulo: 'Tem prazo e etapas definidos', dica: 'Um cronograma visível passa controle e profissionalismo.' },
    { ok: vis('compromissos') || !!c.garantia?.trim(), titulo: 'Reduz o risco de quem compra', dica: 'Mostre os compromissos: preço fechado, ART, prazo e garantia. Tira o medo de errar na escolha.' },
    { ok: (c.depoimentos ?? []).some((x) => x.trim()) && vis('depoimentos'), titulo: 'Tem prova social', dica: 'Um ou dois depoimentos de clientes (nome e cidade). É o gatilho de confiança mais forte em serviços.' },
    { ok: ((c.diferenciais ?? []).length >= 2 || (c.normas ?? []).length > 0) && vis('porque'), titulo: 'Mostra autoridade técnica', dica: 'Diferenciais e normas técnicas seguidas na página “Por que a ROSAE”.' },
    { ok: (c.faq ?? []).length >= 3 && vis('faq'), titulo: 'Responde às objeções antes', dica: 'Três ou mais perguntas frequentes respondidas.' },
    { ok: (c.validade_dias || 0) > 0 && c.validade_dias <= 15, titulo: 'Validade curta', dica: 'Até 15 dias. Dá um motivo legítimo para decidir agora (valores e agenda garantidos).' },
  ];
  const ok = itens.filter((i) => i.ok).length;
  return { nota: Math.round((ok / itens.length) * 10), itens };
}
