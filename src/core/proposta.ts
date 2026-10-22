// Modelo do conteúdo de uma versão de proposta e cálculos puros.
// Valores guardados em reais no JSON (o banco confere as somas em numeric);
// todas as contas aqui são feitas em centavos inteiros.
import { paraBanco, doBanco, ratear, somar, type Centavos } from './dinheiro';

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
};
export type Ambiente = { id: string; nome: string; itens: Item[] };
export type Responsabilidade = { parte: string; itens: string[] };
export type Etapa = { nome: string; descricao?: string; prazo_dias?: number | null; percentual?: number | null };
export type ParcelaProposta = { descricao: string; valor: number; quando?: string };

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
export function pendencias(c: Conteudo): string[] {
  const p: string[] = [];
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
