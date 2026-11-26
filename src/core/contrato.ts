// Montagem do contrato a partir da proposta aprovada, das partes e das cláusulas.
// Puro: a tela grava o resultado como rascunho; emitir congela no banco.
import { formatar, doBanco } from './dinheiro';
import { dataEntrega, UNIDADES, type Conteudo, type ParcelaProposta, type Responsabilidade } from './proposta';
import { perfilDaObra, type Perfil } from './jornada';

export type ModeloContrato = 'preco_fechado' | 'gestao' | 'acompanhamento' | 'administracao' | 'projeto' | 'combinado';

export const MODELO_CONTRATO: Record<ModeloContrato, { rotulo: string; ajuda: string }> = {
  preco_fechado: { rotulo: 'Preço fechado', ajuda: 'Valor total fixo pelo escopo descrito. Economias e excessos de custo ficam com a ROSAE.' },
  gestao: { rotulo: 'Gestão com honorários fixos', ajuda: 'O cliente paga os custos da obra; a ROSAE recebe honorários de gestão (valor inicial e/ou mensalidade).' },
  acompanhamento: { rotulo: 'Acompanhamento com visitas', ajuda: 'Visitas técnicas previstas no período, com valor para visitas adicionais.' },
  administracao: { rotulo: 'Administração ou reembolso', ajuda: 'Custos pagos ou reembolsados pelo cliente com comprovante; remuneração definida em contrato. Economias são do cliente, salvo regra escrita.' },
  projeto: { rotulo: 'Projeto (honorários)', ajuda: 'Honorários pelo projeto conforme o escopo e as etapas de entrega.' },
  combinado: { rotulo: 'Combinação configurada', ajuda: 'Mistura explícita de modelos (por exemplo, preço fechado para parte e administração para outra). Descreva nas condições.' },
};

export type Honorarios = {
  valor_inicial?: number | null; // reais
  mensalidade?: number | null;
  meses?: number | null;
  visitas_incluidas?: number | null;
  valor_visita_adicional?: number | null;
  remuneracao_administracao?: string; // texto livre: "x% sobre os custos comprovados" ou valor fixo
  condicoes_adicionais?: string;
};

/** minuta: texto de partida; fundamentada: com base legal citada, pronta para uso; revisada: revisão registrada por advogado. */
export type RevisaoJuridica = 'minuta' | 'fundamentada' | 'revisada';
/** aplicavel: modelos de contratação ('todos', 'preco_fechado'…) e tipos de serviço com prefixo "s:" (s:reforma…). */
export type Clausula = { id?: string; codigo: string; titulo: string; texto: string; aplicavel: string[]; versao: number; revisao_juridica: RevisaoJuridica; destaque?: boolean; ativo?: boolean; ordem?: number };
/** editada: você mudou esta cláusula neste contrato (ela não acompanha mais a sugestão do modelo).
 *  destaque: cláusula que limita direito, impressa em destaque (CDC, art. 54, § 4º). */
export type ClausulaContrato = { codigo: string; titulo: string; texto: string; versao: number; revisao_juridica: RevisaoJuridica; editada?: boolean; destaque?: boolean };
/** Parcela do contrato: a da proposta, com data de vencimento opcional. */
export type ParcelaContrato = ParcelaProposta & { data?: string | null };
export type ItemContrato = { titulo: string; descricao?: string; quantidade: number; unidade: string; total: number };

export type Parte = { nome: string; documento: string | null; endereco: string | null; email: string | null; telefone: string | null; extra?: string | null };

export type ConteudoContrato = {
  partes: { contratada: Parte; contratante: Parte };
  proposta: { codigo: string; versao: number; hash: string | null } | null;
  objeto: string;
  local: string;
  escopo: { ambiente: string; itens: ItemContrato[] }[];
  inclusoes: string[];
  exclusoes: string[];
  responsabilidades: Responsabilidade[];
  prazo: string;
  /** Datas previstas (AAAA-MM-DD). Começam da proposta e podem ser mudadas. */
  data_inicio?: string | null;
  data_entrega?: string | null;
  pagamento: ParcelaContrato[];
  honorarios: Honorarios;
  clausulas: ClausulaContrato[];
  /** Cláusulas sugeridas que você tirou deste contrato (pelo código). */
  removidas?: string[];
  observacoes: string;
  faltando: string[];
  /** 2 = editor completo (cláusulas editadas marcadas). */
  edicao?: number;
  /** Tipos de serviço do contrato (escolhem as cláusulas específicas e o título). */
  servicos?: Perfil[];
  /** Título do documento ("Contrato de empreitada de reforma"…). */
  titulo?: string;
};

// ---------------------------------------------------------------------
// Tipo de serviço
// ---------------------------------------------------------------------
export const SERVICO_CONTRATO: Record<Perfil, { rotulo: string; objeto: string; obra: boolean; modelo: ModeloContrato }> = {
  projeto: { rotulo: 'Projeto estrutural', objeto: 'projeto estrutural', obra: false, modelo: 'projeto' },
  arquitetura: { rotulo: 'Projeto arquitetônico', objeto: 'projeto arquitetônico', obra: false, modelo: 'projeto' },
  reforco: { rotulo: 'Reforço estrutural', objeto: 'reforço estrutural', obra: true, modelo: 'preco_fechado' },
  reforma: { rotulo: 'Reforma', objeto: 'reforma', obra: true, modelo: 'preco_fechado' },
  construcao: { rotulo: 'Construção', objeto: 'construção', obra: true, modelo: 'preco_fechado' },
  gestao: { rotulo: 'Gestão e acompanhamento', objeto: 'gestão e acompanhamento técnico de obra', obra: false, modelo: 'gestao' },
  regularizacao: { rotulo: 'Regularização', objeto: 'regularização de imóvel', obra: false, modelo: 'projeto' },
  laudo: { rotulo: 'Laudo, vistoria ou perícia', objeto: 'vistoria técnica e elaboração de laudo', obra: false, modelo: 'projeto' },
};
export const SERVICOS_CONTRATO = Object.keys(SERVICO_CONTRATO) as Perfil[];

/** Normas e leis específicas de cada tipo de serviço (entram no marcador {normas}). */
export const NORMAS_SERVICO: Record<Perfil, string[]> = {
  projeto: ['ABNT NBR 6118 (estruturas de concreto)', 'ABNT NBR 6120 (ações para o cálculo)', 'ABNT NBR 6122 (fundações)', 'ABNT NBR 6123 (vento)', 'ABNT NBR 8681 (ações e segurança)', 'ABNT NBR 8800 (estruturas de aço)', 'Lei 9.610/1998 (direitos autorais)'],
  arquitetura: ['ABNT NBR 16636 (projetos arquitetônicos)', 'ABNT NBR 9050 (acessibilidade)', 'ABNT NBR 15575 (desempenho)', 'Lei 9.610/1998 (direitos autorais)', 'legislação urbanística e código de obras do município'],
  reforco: ['ABNT NBR 6118 (estruturas de concreto)', 'ABNT NBR 8800 (estruturas de aço)', 'ABNT NBR 14931 (execução de estruturas de concreto)', 'ABNT NBR 16280 (reforma em edificações)', 'NR-18 (segurança na construção)'],
  reforma: ['ABNT NBR 16280 (reforma em edificações)', 'ABNT NBR 15575 (desempenho)', 'ABNT NBR 5674 (manutenção)', 'NR-18 (segurança na construção)', 'Resolução CONAMA 307/2002 (resíduos)'],
  construcao: ['ABNT NBR 15575 (desempenho)', 'ABNT NBR 14931 (execução de estruturas de concreto)', 'ABNT NBR 6122 (fundações)', 'ABNT NBR 14037 (manual de uso)', 'ABNT NBR 5674 (manutenção)', 'NR-18 (segurança na construção)', 'Resolução CONAMA 307/2002 (resíduos)'],
  gestao: ['ABNT NBR 15575 (desempenho)', 'ABNT NBR 16280 (reforma em edificações)', 'NR-18 (segurança na construção)'],
  regularizacao: ['Lei 6.015/1973 (registros públicos)', 'legislação urbanística e código de obras do município'],
  laudo: ['ABNT NBR 13752 (perícias de engenharia)', 'ABNT NBR 16747 (inspeção predial)'],
};

export function normasDosServicos(servicos: Perfil[]): string {
  const vistos = new Set<string>();
  for (const s of servicos) for (const n of NORMAS_SERVICO[s] ?? []) vistos.add(n);
  return [...vistos].join('; ');
}

function listar(itens: string[]): string {
  return itens.length <= 1 ? itens.join('') : `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

/** Tipos de serviço da proposta (orçamento automático e serviços extras); senão, pelo tipo escrito na obra. */
export function servicosDoContrato(c: Pick<Conteudo, 'tipo_servico' | 'gerador'> | null | undefined, tipoObra?: string | null): Perfil[] {
  const r: Perfil[] = [];
  const incluir = (p: Perfil) => { if (!r.includes(p)) r.push(p); };
  const g = c?.gerador;
  if (g?.tipo) incluir(perfilDaObra(null, g.tipo));
  for (const x of g?.extras ?? []) if (x.tipo) incluir(perfilDaObra(null, x.tipo));
  if (!r.length) incluir(perfilDaObra(c?.tipo_servico || tipoObra || null));
  return r;
}

/** Título do contrato: empreitada quando há execução por preço fechado; prestação de serviços no resto. */
export function tituloContrato(servicos: Perfil[], modelo: ModeloContrato): string {
  if (servicos.length === 1) {
    const s = SERVICO_CONTRATO[servicos[0]];
    if (s.obra && modelo === 'preco_fechado') return `Contrato de empreitada de ${s.objeto}`;
    if (s.obra && modelo === 'administracao') return `Contrato de ${s.objeto} por administração`;
    return `Contrato de prestação de serviços de ${s.objeto}`;
  }
  return 'Contrato de prestação de serviços de engenharia';
}

/** Modelo de contratação mais comum para os serviços (o primeiro manda). */
export function modeloSugerido(servicos: Perfil[]): ModeloContrato {
  return SERVICO_CONTRATO[servicos[0] ?? 'construcao'].modelo;
}

const A_DEFINIR = '[a definir]';

function moeda(v: number | null | undefined): string | null {
  return v == null || Number.isNaN(v) ? null : formatar(doBanco(v));
}

export function textoHonorarios(h: Honorarios): string | null {
  const p: string[] = [];
  if (h.valor_inicial) p.push(`valor inicial de ${moeda(h.valor_inicial)}`);
  if (h.mensalidade) p.push(`mensalidade de ${moeda(h.mensalidade)}${h.meses ? ` por ${h.meses} ${h.meses === 1 ? 'mês' : 'meses'}` : ''}`);
  return p.length ? p.join(' e ') : null;
}

/** Substitui {marcadores} da cláusula; o que faltar vira "[a definir]" (e entra na lista de pendências). */
export function preencher(texto: string, valores: Record<string, string | null | undefined>, faltando: Set<string>): string {
  return texto.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = valores[k];
    if (v == null || v === '') { faltando.add(k); return A_DEFINIR; }
    return v;
  });
}

export const ROTULO_MARCADOR: Record<string, string> = {
  proposta: 'Proposta aprovada', valor_total: 'Valor total', honorarios: 'Honorários (valor inicial/mensalidade)',
  visitas_incluidas: 'Visitas incluídas', visita_adicional: 'Valor da visita adicional', remuneracao_administracao: 'Remuneração da administração',
  prazo: 'Prazo', contratante_documento: 'CPF/CNPJ do contratante', contratante_endereco: 'Endereço do contratante',
  contratada_cnpj: 'CNPJ da ROSAE', contratada_endereco: 'Endereço da ROSAE', local: 'Local da obra',
  servicos: 'Serviços contratados', normas: 'Normas aplicáveis',
};

/**
 * Cláusulas que entram: pelo modelo de contratação ('todos' ou o modelo) e pelo tipo de
 * serviço (tags "s:"). Sem tag de modelo, vale para todos os modelos; sem tag "s:", para
 * todos os serviços. Sem serviços informados, as específicas de serviço ficam de fora.
 */
export function clausulasAplicaveis(todas: Clausula[], modelo: ModeloContrato, servicos: Perfil[] = []): Clausula[] {
  return todas
    .filter((c) => {
      if (c.ativo === false) return false;
      const modelos = c.aplicavel.filter((a) => !a.startsWith('s:'));
      const tipos = c.aplicavel.filter((a) => a.startsWith('s:')).map((a) => a.slice(2));
      const okModelo = modelos.length === 0 || modelos.includes('todos') || modelos.includes(modelo);
      const okServico = tipos.length === 0 || servicos.some((s) => tipos.includes(s));
      return okModelo && okServico;
    })
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
}

export function montarContrato(e: {
  modelo: ModeloContrato;
  proposta: { codigo: string; versao: number; hash: string | null; conteudo: Conteudo; valor_total: number } | null;
  obra: { nome: string; endereco: string | null };
  contratante: Parte;
  contratada: Parte;
  honorarios: Honorarios;
  clausulas: Clausula[];
  /** Tipos de serviço; sem eles, saem da proposta ou do tipo escrito na obra. */
  servicos?: Perfil[];
  tipoObra?: string | null;
}): ConteudoContrato {
  const c = e.proposta?.conteudo;
  const servicos = e.servicos?.length ? e.servicos : servicosDoContrato(c, e.tipoObra);
  const faltando = new Set<string>();
  if (!e.contratante.documento) faltando.add('contratante_documento');
  if (!e.contratante.endereco) faltando.add('contratante_endereco');
  if (!e.contratada.documento) faltando.add('contratada_cnpj');
  if (!e.contratada.endereco) faltando.add('contratada_endereco');
  const local = c?.local || e.obra.endereco || '';
  if (!local) faltando.add('local');
  const valores: Record<string, string | null> = {
    proposta: e.proposta ? `${e.proposta.codigo}, versão ${e.proposta.versao}${e.proposta.hash ? ` (código ${e.proposta.hash.slice(0, 16).toUpperCase()})` : ''}` : null,
    valor_total: e.proposta ? moeda(e.proposta.valor_total) : null,
    honorarios: textoHonorarios(e.honorarios),
    visitas_incluidas: e.honorarios.visitas_incluidas != null ? String(e.honorarios.visitas_incluidas) : null,
    visita_adicional: moeda(e.honorarios.valor_visita_adicional ?? null),
    remuneracao_administracao: e.honorarios.remuneracao_administracao?.trim() || null,
    prazo: c?.prazo_texto?.trim() || null,
    servicos: listar(servicos.map((x) => SERVICO_CONTRATO[x].objeto)),
    normas: normasDosServicos(servicos) || 'as normas técnicas da ABNT aplicáveis',
  };
  const clausulas = clausulasAplicaveis(e.clausulas, e.modelo, servicos).map((k) => ({
    codigo: k.codigo, titulo: k.titulo, texto: preencher(k.texto, valores, faltando), versao: k.versao, revisao_juridica: k.revisao_juridica,
    ...(k.destaque ? { destaque: true } : {}),
  }));
  if (clausulas.some((k) => k.texto.includes('[Minuta'))) faltando.add('clausulas_minuta');
  return {
    partes: { contratada: e.contratada, contratante: e.contratante },
    proposta: e.proposta ? { codigo: e.proposta.codigo, versao: e.proposta.versao, hash: e.proposta.hash } : null,
    objeto: c?.necessidade?.trim() || e.obra.nome,
    local,
    escopo: (c?.ambientes ?? []).map((a) => ({
      ambiente: a.nome || 'Geral',
      itens: a.itens.map((i) => ({ titulo: i.titulo, descricao: i.descricao, quantidade: i.quantidade, unidade: UNIDADES[i.unidade] ?? i.unidade, total: i.total })),
    })),
    inclusoes: c?.inclusoes ?? [],
    exclusoes: c?.exclusoes ?? [],
    responsabilidades: c?.responsabilidades ?? [],
    prazo: c?.prazo_texto ?? '',
    data_inicio: c?.data_inicio ?? null,
    data_entrega: c ? dataEntrega(c) : null,
    pagamento: c?.pagamento.parcelas ?? [],
    honorarios: e.honorarios,
    clausulas,
    observacoes: e.honorarios.condicoes_adicionais ?? '',
    faltando: [...faltando],
    servicos,
    titulo: tituloContrato(servicos, e.modelo),
  };
}

export const ROTULO_FALTANDO = (k: string) => (k === 'clausulas_minuta' ? 'Cláusulas de rescisão/foro ainda em minuta' : k === 'clausulas_a_definir' ? 'Trechos “[a definir]” nas cláusulas' : ROTULO_MARCADOR[k] ?? k);

/**
 * Junta as cláusulas do contrato com as sugeridas pelo modelo: as que você editou ficam
 * como estão; as outras acompanham a sugestão (valor, prazo, honorários); sugestões novas
 * entram no fim, menos as que você tirou. A ordem é a sua.
 */
export function mesclarClausulas(atuais: ClausulaContrato[], sugeridas: ClausulaContrato[], removidas: string[] = []): ClausulaContrato[] {
  const sug = new Map(sugeridas.map((x) => [x.codigo, x]));
  const vistos = new Set<string>();
  const r: ClausulaContrato[] = [];
  for (const a of atuais) {
    vistos.add(a.codigo);
    if (a.editada) r.push(a);
    else if (sug.has(a.codigo)) r.push(sug.get(a.codigo)!);
  }
  for (const x of sugeridas) if (!vistos.has(x.codigo) && !removidas.includes(x.codigo)) r.push(x);
  return r;
}

/** O que ainda falta no contrato editado (vai como "[a definir]"). */
export function pendenciasContrato(k: ConteudoContrato): string[] {
  const f = new Set<string>();
  if (!k.partes.contratante.documento?.trim()) f.add('contratante_documento');
  if (!k.partes.contratante.endereco?.trim()) f.add('contratante_endereco');
  if (!k.partes.contratada.documento?.trim()) f.add('contratada_cnpj');
  if (!k.partes.contratada.endereco?.trim()) f.add('contratada_endereco');
  if (!k.local.trim()) f.add('local');
  if (k.clausulas.some((x) => x.texto.includes('[a definir]'))) f.add('clausulas_a_definir');
  if (k.clausulas.some((x) => x.texto.includes('[Minuta'))) f.add('clausulas_minuta');
  return [...f];
}

/** Soma dos itens do escopo do contrato, em centavos. */
export function totalEscopo(k: Pick<ConteudoContrato, 'escopo'>): number {
  return k.escopo.reduce((t, a) => t + a.itens.reduce((s, i) => s + doBanco(i.total || 0), 0), 0);
}
