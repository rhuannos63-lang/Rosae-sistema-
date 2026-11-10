// Montagem do contrato a partir da proposta aprovada, das partes e das cláusulas.
// Puro: a tela grava o resultado como rascunho; emitir congela no banco.
import { formatar, doBanco } from './dinheiro';
import { dataEntrega, UNIDADES, type Conteudo, type ParcelaProposta, type Responsabilidade } from './proposta';

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

export type Clausula = { id?: string; codigo: string; titulo: string; texto: string; aplicavel: string[]; versao: number; revisao_juridica: 'minuta' | 'revisada'; ativo?: boolean; ordem?: number };
/** editada: você mudou esta cláusula neste contrato (ela não acompanha mais a sugestão do modelo). */
export type ClausulaContrato = { codigo: string; titulo: string; texto: string; versao: number; revisao_juridica: 'minuta' | 'revisada'; editada?: boolean };
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
};

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
};

export function clausulasAplicaveis(todas: Clausula[], modelo: ModeloContrato): Clausula[] {
  return todas
    .filter((c) => c.ativo !== false && (c.aplicavel.includes('todos') || c.aplicavel.includes(modelo) || (modelo === 'combinado' && c.aplicavel.includes('combinado'))))
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
}): ConteudoContrato {
  const c = e.proposta?.conteudo;
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
  };
  const clausulas = clausulasAplicaveis(e.clausulas, e.modelo).map((k) => ({
    codigo: k.codigo, titulo: k.titulo, texto: preencher(k.texto, valores, faltando), versao: k.versao, revisao_juridica: k.revisao_juridica,
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
