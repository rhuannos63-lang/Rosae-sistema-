// Comparativo orçado × fechado por categoria, em cada obra.
// Categoria = cada serviço do orçamento aceito (ex.: "Troca de piso"). Dentro dela, as linhas
// vêm da composição de custos (piso, argamassa, rejunte e a mão de obra somada) e dos custos
// internos lançados na proposta. O Rhuann lança quanto fechou com cada profissional ou
// fornecedor; a diferença mostra lucro ou prejuízo por linha, por categoria e no total.
// Tudo em centavos inteiros e cálculo puro (testável).
import type { Composicao, Insumo, Padrao, Uso } from './composicao';
import { fatorMaoDeObra, precoNoPadrao } from './composicao';
import type { Acrescimo } from './condicoes';
import type { Conteudo } from './proposta';
import { paraCentavos } from './proposta';
import type { Centavos } from './dinheiro';

export type TipoLinha = 'material' | 'mao_de_obra' | 'equipamento' | 'outro';
export const TIPO_LINHA: Record<TipoLinha, string> = { material: 'Material', mao_de_obra: 'Mão de obra', equipamento: 'Equipamento', outro: 'Outro' };

export type LinhaOrcada = {
  id: string; nome: string; tipo: TipoLinha; orcado: Centavos;
  quantidade?: number; unidade?: string; detalhe?: string;
  /** Linha criada pelo Rhuann (não veio do orçamento). */
  manual?: boolean;
};
export type CategoriaOrcada = {
  id: string; nome: string; vendido: Centavos; linhas: LinhaOrcada[];
  /** De onde veio: ambiente da proposta ou aditivo. */
  origem?: string; manual?: boolean;
};

/** Um orçamento aceito (o original ou um aditivo) com os custos internos salvos na proposta. */
export type FonteOrcamento = {
  rotulo?: string | null;
  conteudo: Pick<Conteudo, 'ambientes'>;
  custos: { linhas?: { descricao: string; valor: number | string }[]; composicoes?: Uso[]; padrao?: Padrao } | null;
  acrescimo?: Pick<Acrescimo, 'mao_de_obra_pct' | 'material_pct'>;
};

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const c = (reais: number) => Math.round(reais * 100);

/** Famílias de serviço: palavras que puxam um custo para a categoria certa (ex.: cobre → ar-condicionado). */
const FAMILIAS: string[][] = [
  ['ar condicionado', 'ar-condicionado', 'split', 'btu', 'condensadora', 'evaporadora', 'cobre', 'dreno', 'climatiz', 'refrigera'],
  ['piso', 'porcelanato', 'ceramica', 'rejunte', 'argamassa', 'contrapiso', 'rodape', 'revestimento', 'azulej', 'laminado', 'vinilico'],
  ['pintura', 'tinta', 'massa corrida', 'selador', 'textura', 'lixa', 'pintor', 'emassamento'],
  ['eletric', 'fio', 'disjuntor', 'tomada', 'interruptor', 'quadro de distribuicao', 'iluminacao', 'luminaria', 'eletroduto'],
  ['hidraul', 'registro', 'tubo', 'conexo', 'pvc', 'ppr', 'esgoto', 'caixa d', 'encanador', 'aquecedor'],
  ['gesso', 'drywall', 'forro', 'sanca', 'placa de gesso'],
  ['bancada', 'granito', 'marmore', 'quartzo', 'marmoraria', 'pedra'],
  ['esquadria', 'janela', 'porta', 'vidro', 'box', 'aluminio'],
  ['impermeabiliza', 'manta', 'asfaltic'],
  ['estrutur', 'reforco', 'concreto', 'aco', 'armadura', 'fibra de carbono', 'perfil metalico', 'escoramento'],
];
const VAZIAS = new Set(['para', 'com', 'sem', 'dos', 'das', 'de', 'da', 'do', 'e', 'em', 'no', 'na', 'un', 'und', 'servico', 'execucao', 'fornecimento', 'instalacao', 'troca', 'novo', 'nova']);
const palavras = (t: string) => sem(t).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !VAZIAS.has(w));

/** Categoria do orçamento que mais se parece com a descrição do custo (ou nenhuma). */
export function categoriaParecida<T extends { nome: string }>(descricao: string, cats: T[]): T | undefined {
  const d = sem(descricao);
  const dw = new Set(palavras(descricao));
  let melhor: T | undefined; let pontos = 0;
  for (const cat of cats) {
    const n = sem(cat.nome);
    let p = palavras(cat.nome).filter((w) => dw.has(w)).length * 2;
    for (const f of FAMILIAS) if (f.some((k) => n.includes(k)) && f.some((k) => d.includes(k))) p += 3;
    if (p > pontos) { pontos = p; melhor = cat; }
  }
  return pontos >= 2 ? melhor : undefined;
}

/** Descobre o tipo de uma linha de custo pelo texto ("Execução ... mão de obra" → mão de obra). */
export function tipoPeloTexto(texto: string): TipoLinha {
  const t = sem(texto);
  if (/mao de obra|execucao|equipe|empreit|diaria|instalac|montagem|pedreiro|pintor|eletricista|encanador/.test(t)) return 'mao_de_obra';
  if (/materia|insumo|compra|revestimento|piso|argamassa|cimento|tinta|aparelho|split|condensadora|tubula|cobre|cabo|fio|suporte|bancada|granito|porcelanato/.test(t)) return 'material';
  if (/equipamento|locacao|aluguel|andaime|cacamba/.test(t)) return 'equipamento';
  return 'outro';
}

/**
 * Monta as categorias a partir dos orçamentos aceitos. Material da composição sai insumo por
 * insumo; mão de obra e equipamento saem somados (é assim que se fecha com o profissional).
 * Condições da obra (escada, condomínio...) entram nos valores, como no orçamento.
 */
export function montarCategorias(fontes: FonteOrcamento[], base: { composicoes: Composicao[]; insumos: Insumo[] }): CategoriaOrcada[] {
  const porComp = new Map(base.composicoes.map((x) => [x.id, x]));
  const porIns = new Map(base.insumos.map((x) => [x.id, x]));
  const cats: CategoriaOrcada[] = [];
  fontes.forEach((f, fi) => {
    const pre = fi === 0 ? '' : `a${fi}:`;
    const fMo = 1 + Math.max(0, f.acrescimo?.mao_de_obra_pct ?? 0) / 100;
    const fMat = 1 + Math.max(0, f.acrescimo?.material_pct ?? 0) / 100;
    const padraoGeral: Padrao = f.custos?.padrao ?? 'medio';
    const usos = Array.isArray(f.custos?.composicoes) ? f.custos!.composicoes! : [];
    const porItem = new Map<string, CategoriaOrcada>();
    const porTitulo = new Map<string, CategoriaOrcada>();
    for (const a of f.conteudo.ambientes ?? []) {
      for (const it of a.itens ?? []) {
        const cat: CategoriaOrcada = {
          id: `${pre}item:${it.id}`, nome: it.titulo?.trim() || 'Serviço', vendido: paraCentavos(it.total), linhas: [],
          origem: [f.rotulo, (f.conteudo.ambientes.length > 1 && a.nome?.trim()) || null].filter(Boolean).join(' · ') || undefined,
        };
        porItem.set(it.id, cat);
        if (!porTitulo.has(sem(cat.nome))) porTitulo.set(sem(cat.nome), cat);
        cats.push(cat);
      }
    }
    // Composições: material por insumo; mão de obra e equipamento somados por categoria.
    const acumula = (cat: CategoriaOrcada, id: string, dados: Omit<LinhaOrcada, 'id' | 'orcado'>, valor: number, qtd?: number, detalhe?: string) => {
      let l = cat.linhas.find((x) => x.id === id);
      if (!l) { l = { id, ...dados, orcado: 0 }; cat.linhas.push(l); }
      (l as LinhaOrcada & { _r?: number })._r = ((l as LinhaOrcada & { _r?: number })._r ?? 0) + valor;
      if (qtd != null) l.quantidade = (l.quantidade ?? 0) + qtd;
      if (detalhe) l.detalhe = Array.from(new Set([...(l.detalhe ? l.detalhe.split(', ') : []), detalhe])).join(', ');
    };
    for (const u of usos) {
      const comp = porComp.get(u.composicao_id);
      const cat = porItem.get(u.item_id);
      const q = Math.max(0, Number(u.quantidade) || 0);
      if (!comp || !cat || !(q > 0)) continue;
      const pd: Padrao = comp.varia_padrao ? (u.padrao || padraoGeral) : 'medio';
      const perda = 1 + Math.max(0, Number(u.perda_pct) || 0) / 100;
      for (const ci of comp.itens) {
        const i = porIns.get(ci.insumo_id);
        if (!i) continue;
        const qtd = q * ci.coeficiente * (i.tipo === 'material' ? perda : i.tipo === 'mao_de_obra' ? fatorMaoDeObra(comp, pd) : 1);
        const valor = qtd * precoNoPadrao(i, pd) * (i.tipo === 'material' ? fMat : fMo);
        if (i.tipo === 'material') acumula(cat, `${cat.id}:ins:${i.id}`, { nome: i.nome, tipo: 'material', unidade: i.unidade }, valor, qtd);
        else acumula(cat, `${cat.id}:${i.tipo}`, { nome: i.tipo === 'mao_de_obra' ? 'Mão de obra' : 'Equipamentos', tipo: i.tipo }, valor, undefined, i.nome);
      }
    }
    // Custos internos lançados na proposta (manuais ou do orçamento automático).
    let outros: CategoriaOrcada | null = null;
    (f.custos?.linhas ?? []).forEach((l, li) => {
      const valor = paraCentavos(l.valor);
      const desc = (l.descricao ?? '').trim();
      if (!valor && !desc) return;
      const partes = desc.split(' · ');
      const alvo = porTitulo.get(sem(desc)) ?? (partes.length > 1 ? porTitulo.get(sem(partes.slice(1).join(' · '))) : undefined)
        ?? categoriaParecida(desc, cats.filter((x) => x.id.startsWith(`${pre}item:`)));
      // Custo com o mesmo nome do serviço: só diz o tipo quando o texto é claro ("mão de obra", "materiais").
      const mesmoNome = !!alvo && sem(desc).endsWith(sem(alvo.nome));
      const tipo: TipoLinha = !mesmoNome ? tipoPeloTexto(desc) : /mao de obra/.test(sem(desc)) ? 'mao_de_obra' : /^materia/.test(sem(desc)) ? 'material' : 'outro';
      let cat = alvo;
      if (!cat) {
        if (!outros) { outros = { id: `${pre}outros`, nome: f.rotulo ? `Outros custos · ${f.rotulo}` : 'Outros custos do orçamento', vendido: 0, linhas: [], origem: f.rotulo || undefined }; cats.push(outros); }
        cat = outros;
      }
      const nome = mesmoNome ? (tipo === 'outro' ? 'Custo previsto do serviço' : TIPO_LINHA[tipo]) : desc || 'Custo previsto';
      acumula(cat, `${pre}custo:${li}:${sem(desc).slice(0, 40)}`, { nome, tipo }, valor / 100);
    });
    for (const cat of cats) for (const l of cat.linhas) {
      const x = l as LinhaOrcada & { _r?: number };
      if (x._r != null) { l.orcado = c(x._r); delete x._r; }
      if (l.quantidade != null) l.quantidade = Math.round(l.quantidade * 100) / 100;
    }
  });
  // Material primeiro (maior valor antes), depois mão de obra, equipamento e outros.
  const ordem: Record<TipoLinha, number> = { material: 0, mao_de_obra: 1, equipamento: 2, outro: 3 };
  for (const cat of cats) cat.linhas.sort((a, b) => ordem[a.tipo] - ordem[b.tipo] || b.orcado - a.orcado);
  return cats;
}

// ---------------------------------------------------------------------------------------------
// O que o Rhuann lança (guardado em obra_comparativo.dados)
// ---------------------------------------------------------------------------------------------
export type Fechamento = { valor: Centavos | null; fornecedor?: string };
export type LinhaManual = { id: string; nome: string; tipo: TipoLinha; orcado: Centavos };
export type CategoriaManual = { id: string; nome: string };
export type DadosComparativo = {
  /** Quanto fechou em cada linha. */
  linhas?: Record<string, Fechamento>;
  /** Categoria fechada inteira com um profissional (ex.: piso com material e mão de obra). */
  pacotes?: Record<string, Fechamento>;
  /** Linhas que não estavam no orçamento, por categoria. */
  extras?: Record<string, LinhaManual[]>;
  /** Categorias que não estavam no orçamento. */
  categorias?: CategoriaManual[];
  /** Linhas do orçamento que não vão acontecer (o cliente tirou, ou vai comprar ele mesmo). */
  dispensadas?: string[];
};

export type Situacao = 'aberta' | 'parcial' | 'fechada';
export type LinhaComparada = LinhaOrcada & { fechado: Centavos | null; fornecedor: string; diferenca: Centavos | null; dispensada: boolean };
export type CategoriaComparada = Omit<CategoriaOrcada, 'linhas'> & {
  linhas: LinhaComparada[];
  orcado: Centavos;
  /** Total fechado (pacote ou soma das linhas fechadas). */
  fechado: Centavos;
  /** Orçado só do que já foi fechado: é contra ele que se mede o resultado. */
  orcadoFechado: Centavos;
  /** orçado do que foi fechado − fechado. Positivo = lucro, negativo = prejuízo. */
  diferenca: Centavos;
  aFechar: Centavos;
  situacao: Situacao;
  pacote: Fechamento | null;
};
export type Totais = { orcado: Centavos; fechado: Centavos; orcadoFechado: Centavos; diferenca: Centavos; aFechar: Centavos; vendido: Centavos; categorias: number; fechadas: number; comLucro: number; comPrejuizo: number };

/** Junta o orçado com o que foi lançado e calcula a diferença de cada linha, categoria e total. */
export function compararCategorias(cats: CategoriaOrcada[], dados: DadosComparativo): { categorias: CategoriaComparada[]; totais: Totais } {
  const extras = dados.extras ?? {};
  const disp = new Set(dados.dispensadas ?? []);
  const todas: CategoriaOrcada[] = [
    ...cats,
    ...(dados.categorias ?? []).map((m) => ({ id: m.id, nome: m.nome, vendido: 0, linhas: [], manual: true })),
  ];
  const categorias = todas.map((cat): CategoriaComparada => {
    const linhasBase: LinhaOrcada[] = [...cat.linhas, ...(extras[cat.id] ?? []).map((l) => ({ ...l, manual: true }))];
    const pacote = dados.pacotes?.[cat.id]?.valor != null ? dados.pacotes[cat.id] : null;
    const linhas = linhasBase.map((l): LinhaComparada => {
      const f = dados.linhas?.[l.id];
      const dispensada = disp.has(l.id);
      const fechado = dispensada ? 0 : f?.valor ?? null;
      return { ...l, fechado: pacote ? null : fechado, fornecedor: f?.fornecedor ?? '', dispensada, diferenca: pacote || fechado == null ? null : l.orcado - fechado };
    });
    const orcado = linhas.reduce((t, l) => t + l.orcado, 0);
    let fechado: Centavos, orcadoFechado: Centavos, situacao: Situacao;
    if (pacote) {
      fechado = pacote.valor!; orcadoFechado = orcado; situacao = 'fechada';
    } else {
      const fech = linhas.filter((l) => l.fechado != null);
      fechado = fech.reduce((t, l) => t + (l.fechado ?? 0), 0);
      orcadoFechado = fech.reduce((t, l) => t + l.orcado, 0);
      situacao = !fech.length ? 'aberta' : fech.length === linhas.length ? 'fechada' : 'parcial';
    }
    return { ...cat, linhas, orcado, fechado, orcadoFechado, diferenca: orcadoFechado - fechado, aFechar: orcado - orcadoFechado, situacao, pacote };
  });
  const soma = (k: 'orcado' | 'fechado' | 'orcadoFechado' | 'diferenca' | 'aFechar' | 'vendido') => categorias.reduce((t, x) => t + x[k], 0);
  return {
    categorias,
    totais: {
      orcado: soma('orcado'), fechado: soma('fechado'), orcadoFechado: soma('orcadoFechado'), diferenca: soma('diferenca'), aFechar: soma('aFechar'), vendido: soma('vendido'),
      categorias: categorias.length, fechadas: categorias.filter((x) => x.situacao === 'fechada').length,
      comLucro: categorias.filter((x) => x.situacao !== 'aberta' && x.diferenca > 0).length,
      comPrejuizo: categorias.filter((x) => x.situacao !== 'aberta' && x.diferenca < 0).length,
    },
  };
}

/** Resultado em palavras, para o rótulo ao lado do valor. */
export function rotuloDiferenca(d: Centavos | null): { texto: string; classe: 'lucro' | 'prejuizo' | 'neutro' } {
  if (d == null) return { texto: 'A fechar', classe: 'neutro' };
  if (d > 0) return { texto: 'Lucro', classe: 'lucro' };
  if (d < 0) return { texto: 'Prejuízo', classe: 'prejuizo' };
  return { texto: 'No orçado', classe: 'neutro' };
}

/** Percentual da diferença sobre o orçado (para "12% abaixo do orçado"). */
export const percentual = (diferenca: Centavos, base: Centavos) => (base > 0 ? Math.round((diferenca / base) * 1000) / 10 : 0);

export const novoId = (prefixo: string) => `${prefixo}:${Math.random().toString(36).slice(2, 10)}`;
