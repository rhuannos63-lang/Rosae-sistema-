// Montador de reforma e construção andar por andar: catálogo de serviços com preço pronto,
// linhas simples (andar, serviço, onde, medida, preço) que viram os grupos da proposta,
// e a importação de um orçamento feito por IA ou colado de uma planilha.
import { novoId, nomeGrupo, tituloServico, totalConteudo, totalItem, type Ambiente, type Conteudo, type Item } from './proposta';

export type ModoMedida = 'area' | 'parede_teto' | 'quantidade';

export type ServicoCatalogo = {
  id: string;
  categoria: string;
  nome: string; // como aparece na coluna Serviço
  descricao: string; // "O que será feito"
  unidade: string; // chave de UNIDADES
  preco: number; // R$ por unidade (mão de obra e serviço)
  modo: ModoMedida;
  /** Serviço típico de construção (aparece primeiro quando a obra é construção). */
  construcao?: boolean;
};

// Preços de partida tirados do orçamento de reforma de 4 andares (Niterói, nov/2026); os de construção
// são referências a conferir. Todos se editam na proposta e podem virar o seu preço padrão.
export const CATALOGO: ServicoCatalogo[] = [
  // Pintura
  { id: 'pintura_interna', categoria: 'Pintura', nome: 'Pintura interna', descricao: 'Preparação, massa onde precisar, fundo e 2 demãos', unidade: 'm2', preco: 65, modo: 'parede_teto' },
  { id: 'pintura_teto', categoria: 'Pintura', nome: 'Pintura de teto', descricao: 'Lixamento, fundo e 2 demãos', unidade: 'm2', preco: 65, modo: 'area' },
  { id: 'pintura_epoxi', categoria: 'Pintura', nome: 'Pintura epóxi sobre azulejo', descricao: 'Limpeza, fundo aderente e 2 demãos de epóxi', unidade: 'm2', preco: 65, modo: 'area' },
  { id: 'pintura_externa', categoria: 'Pintura', nome: 'Pintura externa', descricao: 'Lavagem, tratamento de fissuras, fundo e 3 demãos', unidade: 'm2', preco: 65, modo: 'area' },
  { id: 'pintura_emborrachada', categoria: 'Pintura', nome: 'Pintura emborrachada', descricao: 'Lavagem, fundo e 3 demãos de tinta emborrachada', unidade: 'm2', preco: 65, modo: 'area' },
  // Pisos
  { id: 'quebra_piso', categoria: 'Pisos', nome: 'Troca de piso', descricao: 'Quebra e retirada do piso e do contrapiso', unidade: 'm2', preco: 56.13, modo: 'area' },
  { id: 'contrapiso', categoria: 'Pisos', nome: 'Troca de piso', descricao: 'Contrapiso novo, nivelado (≈ 4 cm)', unidade: 'm2', preco: 56.01, modo: 'area' },
  { id: 'contrapiso_caimento', categoria: 'Pisos', nome: 'Troca de piso', descricao: 'Contrapiso novo com caimento para o ralo', unidade: 'm2', preco: 56.01, modo: 'area' },
  { id: 'piso_ceramico', categoria: 'Pisos', nome: 'Troca de piso', descricao: 'Assentamento de piso cerâmico ou porcelanato', unidade: 'm2', preco: 70, modo: 'area' },
  { id: 'piso_laminado', categoria: 'Pisos', nome: 'Troca de piso', descricao: 'Piso laminado com manta', unidade: 'm2', preco: 39.83, modo: 'area' },
  { id: 'piso_vinilico', categoria: 'Pisos', nome: 'Troca de piso', descricao: 'Piso vinílico colado', unidade: 'm2', preco: 45, modo: 'area' },
  { id: 'rodape', categoria: 'Pisos', nome: 'Rodapé', descricao: 'Rodapé de poliestireno 7 cm', unidade: 'm', preco: 22.4, modo: 'area' },
  { id: 'rejunte_epoxi', categoria: 'Pisos', nome: 'Rejunte', descricao: 'Retirada do rejunte antigo e rejunte epóxi', unidade: 'm2', preco: 56.01, modo: 'area' },
  { id: 'piso_completo', categoria: 'Pisos', nome: 'Troca de piso', descricao: 'Quebra, contrapiso com caimento e piso novo', unidade: 'm2', preco: 186.7, modo: 'area' },
  // Revestimentos de parede
  { id: 'revestimento_parede', categoria: 'Revestimentos', nome: 'Revestimento', descricao: 'Assentamento de revestimento cerâmico na parede', unidade: 'm2', preco: 75, modo: 'area' },
  { id: 'retirada_revestimento', categoria: 'Revestimentos', nome: 'Demolição', descricao: 'Retirada de revestimento de parede', unidade: 'm2', preco: 35, modo: 'area' },
  // Tetos e paredes
  { id: 'drywall_forro', categoria: 'Tetos e paredes', nome: 'Teto', descricao: 'Rebaixamento em drywall (placa RU)', unidade: 'm2', preco: 70, modo: 'area' },
  { id: 'remocao_forro', categoria: 'Tetos e paredes', nome: 'Teto', descricao: 'Remoção do forro', unidade: 'm2', preco: 22.4, modo: 'area' },
  { id: 'reparo_teto', categoria: 'Tetos e paredes', nome: 'Teto', descricao: 'Abertura, reparo e fechamento', unidade: 'vb', preco: 647.23, modo: 'quantidade' },
  { id: 'reparo_revestimento', categoria: 'Tetos e paredes', nome: 'Teto', descricao: 'Reparo do revestimento', unidade: 'm2', preco: 99.57, modo: 'area' },
  { id: 'fechar_abertura', categoria: 'Tetos e paredes', nome: 'Parede', descricao: 'Fechar abertura na parede (ar-condicionado antigo, passagem)', unidade: 'un', preco: 472.98, modo: 'quantidade' },
  { id: 'drywall_parede', categoria: 'Tetos e paredes', nome: 'Parede', descricao: 'Parede de drywall com isolamento', unidade: 'm2', preco: 95, modo: 'area' },
  // Impermeabilização
  { id: 'imper_polimerica', categoria: 'Impermeabilização', nome: 'Impermeabilização', descricao: 'Argamassa polimérica + tela + teste de 72 h', unidade: 'm2', preco: 47.3, modo: 'area' },
  { id: 'imper_manta', categoria: 'Impermeabilização', nome: 'Impermeabilização', descricao: 'Membrana com tela, rodapé de 30 cm e teste de 72 h', unidade: 'm2', preco: 49.79, modo: 'area' },
  { id: 'imper_laje', categoria: 'Impermeabilização', nome: 'Teto', descricao: 'Reforço de impermeabilização da laje', unidade: 'm2', preco: 22.4, modo: 'area' },
  { id: 'infiltracao_parede', categoria: 'Impermeabilização', nome: 'Infiltração', descricao: 'Raspagem, impermeabilizante e massa', unidade: 'm2', preco: 59.74, modo: 'area' },
  { id: 'infiltracao_banheiro', categoria: 'Impermeabilização', nome: 'Infiltração', descricao: 'Teste, rejunte do box, ralo e registros', unidade: 'vb', preco: 809.04, modo: 'quantidade' },
  { id: 'verba_infiltracao', categoria: 'Impermeabilização', nome: 'Infiltrações', descricao: 'Verba para pontos não mapeados', unidade: 'vb', preco: 1493.62, modo: 'quantidade' },
  // Hidráulica e drenagem
  { id: 'desentupir_ralo', categoria: 'Hidráulica e drenagem', nome: 'Drenagem', descricao: 'Desentupimento do ralo', unidade: 'un', preco: 224.04, modo: 'quantidade' },
  { id: 'buzinote', categoria: 'Hidráulica e drenagem', nome: 'Drenagem', descricao: 'Ponto de saída de água (buzinote)', unidade: 'un', preco: 348.51, modo: 'quantidade' },
  { id: 'canaleta', categoria: 'Hidráulica e drenagem', nome: 'Drenagem', descricao: 'Caimento e canaleta', unidade: 'm', preco: 174.26, modo: 'area' },
  { id: 'calhas', categoria: 'Hidráulica e drenagem', nome: 'Drenagem', descricao: 'Calhas e condutores: revisão, vedação e trechos novos', unidade: 'vb', preco: 871.28, modo: 'quantidade' },
  { id: 'cisterna', categoria: 'Hidráulica e drenagem', nome: 'Hidráulica', descricao: 'Cisterna: limpeza, desinfecção, tampa e boia', unidade: 'un', preco: 597.45, modo: 'quantidade' },
  { id: 'bomba', categoria: 'Hidráulica e drenagem', nome: 'Hidráulica', descricao: 'Revisão de bomba, boias e retenção', unidade: 'vb', preco: 871.28, modo: 'quantidade' },
  { id: 'ponto_hidraulico', categoria: 'Hidráulica e drenagem', nome: 'Hidráulica', descricao: 'Ponto de água ou esgoto novo', unidade: 'pt', preco: 180, modo: 'quantidade', construcao: true },
  { id: 'inspecao_hidraulica', categoria: 'Hidráulica e drenagem', nome: 'Hidráulica', descricao: 'Inspeção com relatório do que precisa reparar', unidade: 'vb', preco: 700, modo: 'quantidade' },
  // Elétrica
  { id: 'avaliacao_eletrica', categoria: 'Elétrica', nome: 'Elétrica', descricao: 'Avaliação completa antes do orçamento das trocas', unidade: 'vb', preco: 1500, modo: 'quantidade' },
  { id: 'ponto_eletrico', categoria: 'Elétrica', nome: 'Elétrica', descricao: 'Ponto elétrico novo (tomada, interruptor ou luz)', unidade: 'pt', preco: 120, modo: 'quantidade', construcao: true },
  { id: 'quadro_eletrico', categoria: 'Elétrica', nome: 'Elétrica', descricao: 'Troca do quadro de distribuição com disjuntores e DR', unidade: 'un', preco: 950, modo: 'quantidade' },
  // Portas, ferragens e esquadrias
  { id: 'porta_pronta', categoria: 'Portas e ferragens', nome: 'Portas', descricao: 'Instalação de porta pronta com batente', unidade: 'un', preco: 373.4, modo: 'quantidade' },
  { id: 'macaneta', categoria: 'Portas e ferragens', nome: 'Portas', descricao: 'Instalação de maçaneta e fechadura', unidade: 'un', preco: 74.68, modo: 'quantidade' },
  { id: 'corrimao', categoria: 'Portas e ferragens', nome: 'Escada', descricao: 'Corrimão de aço inox Ø 1½"', unidade: 'm', preco: 136.91, modo: 'area' },
  { id: 'janela', categoria: 'Portas e ferragens', nome: 'Esquadrias', descricao: 'Instalação de janela com requadro', unidade: 'un', preco: 420, modo: 'quantidade' },
  // Demolições e limpeza
  { id: 'retirada_banheira', categoria: 'Demolições', nome: 'Demolição', descricao: 'Retirada de banheira', unidade: 'un', preco: 1120.21, modo: 'quantidade' },
  { id: 'demolicao_concreto', categoria: 'Demolições', nome: 'Demolição', descricao: 'Demolição de estruturas de concreto', unidade: 'm3', preco: 950, modo: 'area' },
  { id: 'demolicao_alvenaria', categoria: 'Demolições', nome: 'Demolição', descricao: 'Demolição de alvenaria com retirada do entulho', unidade: 'm2', preco: 45, modo: 'area' },
  { id: 'capina', categoria: 'Demolições', nome: 'Limpeza do terreno', descricao: 'Capina, poda e ensacamento do mato', unidade: 'm2', preco: 25, modo: 'area' },
  // Cozinha e banheiro
  { id: 'bancada', categoria: 'Cozinha e banheiro', nome: 'Cozinha', descricao: 'Instalação de bancada de granito com recorte', unidade: 'un', preco: 560.11, modo: 'quantidade' },
  { id: 'loucas', categoria: 'Cozinha e banheiro', nome: 'Banheiro', descricao: 'Instalação de louças e metais', unidade: 'un', preco: 180, modo: 'quantidade' },
  // Construção
  { id: 'fundacao', categoria: 'Estrutura', nome: 'Fundação', descricao: 'Fundação (sapatas ou radier) conforme projeto estrutural', unidade: 'm3', preco: 1800, modo: 'area', construcao: true },
  { id: 'estrutura_concreto', categoria: 'Estrutura', nome: 'Estrutura', descricao: 'Pilares, vigas e lajes de concreto armado', unidade: 'm3', preco: 2200, modo: 'area', construcao: true },
  { id: 'laje', categoria: 'Estrutura', nome: 'Laje', descricao: 'Laje pré-moldada com capa de concreto', unidade: 'm2', preco: 160, modo: 'area', construcao: true },
  { id: 'alvenaria', categoria: 'Alvenaria e revestimento', nome: 'Alvenaria', descricao: 'Alvenaria de vedação em bloco cerâmico', unidade: 'm2', preco: 55, modo: 'area', construcao: true },
  { id: 'chapisco_reboco', categoria: 'Alvenaria e revestimento', nome: 'Reboco', descricao: 'Chapisco e reboco', unidade: 'm2', preco: 38, modo: 'area', construcao: true },
  { id: 'telhado', categoria: 'Cobertura', nome: 'Telhado', descricao: 'Estrutura e telhamento', unidade: 'm2', preco: 120, modo: 'area', construcao: true },
  // Canteiro (normalmente em "Todos os andares")
  { id: 'canteiro', categoria: 'Canteiro', nome: 'Canteiro', descricao: 'Mobilização, proteção da casa e entrega final', unidade: 'vb', preco: 2987.23, modo: 'quantidade' },
  { id: 'cacamba', categoria: 'Canteiro', nome: 'Caçambas', descricao: 'Caçamba de 5 m³ (entrega e retirada)', unidade: 'un', preco: 746.81, modo: 'quantidade' },
  { id: 'andaime', categoria: 'Canteiro', nome: 'Andaime', descricao: '2 torres com montagem', unidade: 'mes', preco: 2240.43, modo: 'quantidade' },
  { id: 'limpeza_final', categoria: 'Canteiro', nome: 'Limpeza', descricao: 'Limpeza fina pós-obra', unidade: 'm2', preco: 14, modo: 'area' },
];

export const CATEGORIAS = Array.from(new Set(CATALOGO.map((s) => s.categoria)));
export const ANDARES_SUGERIDOS = ['Térreo', '1º andar', '2º andar', '3º andar', '4º andar', 'Cobertura', 'Área externa e fachadas', 'Todos os andares'];

/** Preços do catálogo com os seus ajustes (gravados como "cat.<id>" na tabela de preços da reforma). */
export function catalogoComPrecos(ajustes: Record<string, number> = {}): ServicoCatalogo[] {
  return CATALOGO.map((s) => {
    const v = Number(ajustes[`cat.${s.id}`]);
    return Number.isFinite(v) && v > 0 ? { ...s, preco: v } : s;
  });
}

// ---------------------------------------------------------------------
// Linha do montador <-> grupos da proposta
// ---------------------------------------------------------------------

export type LinhaMontador = {
  id: string; andar: string; categoria: string; servico: string; onde: string; descricao: string;
  unidade: string; quantidade: number; preco: number; parede?: number; teto?: number; catalogo?: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function totalLinha(l: Pick<LinhaMontador, 'quantidade' | 'preco'>): number {
  return totalItem({ quantidade: l.quantidade, preco_unitario: l.preco });
}

/** Nova linha a partir do catálogo. */
export function linhaDoCatalogo(s: ServicoCatalogo, andar: string, onde = ''): LinhaMontador {
  return { id: novoId(), andar, categoria: s.categoria, servico: s.nome, onde, descricao: s.descricao, unidade: s.unidade, quantidade: s.modo === 'quantidade' ? 1 : 0, preco: s.preco, catalogo: s.id, ...(s.modo === 'parede_teto' ? { parede: 0, teto: 0 } : {}) };
}

/** Pintura por ambiente: parede + teto viram a medida. */
export function comMedidas(l: LinhaMontador, parede: number | undefined, teto: number | undefined): LinhaMontador {
  const p = Math.max(0, parede ?? 0), t = Math.max(0, teto ?? 0);
  return { ...l, parede: p, teto: t, quantidade: r2(p + t), unidade: 'm2' };
}

function descricaoPintura(l: LinhaMontador): string {
  if (!l.parede && l.teto) return `Só o teto: ${fmt(l.teto)} m²`;
  return `Parede ${fmt(l.parede ?? 0)} m² · teto ${fmt(l.teto ?? 0)} m²`;
}

/** Itens da proposta de volta para linhas (para abrir o montador numa proposta pronta). */
export function linhasDoConteudo(c: Pick<Conteudo, 'ambientes'>): LinhaMontador[] {
  return c.ambientes.flatMap((a) => a.itens.map((i) => {
    const pintura = i.medidas && (i.medidas.parede != null || i.medidas.teto != null);
    return {
      id: i.id, andar: a.pavimento?.trim() || 'Geral', categoria: nomeGrupo(a), servico: tituloServico(i), onde: i.onde ?? '',
      descricao: pintura ? '' : i.descricao ?? '', unidade: i.unidade, quantidade: Number(i.quantidade) || 0, preco: Number(i.preco_unitario) || 0,
      ...(pintura ? { parede: i.medidas!.parede ?? 0, teto: i.medidas!.teto ?? 0 } : {}),
      ...(i.catalogo ? { catalogo: i.catalogo } : {}),
    };
  }));
}

/** Ordem dos andares: a do montador (primeira aparição), com "Área externa" e "Todos os andares" no fim. */
function ordemAndares(andares: string[]): string[] {
  const u = Array.from(new Set(andares));
  const peso = (a: string) => (/todos/i.test(a) ? 2 : /extern|fachad/i.test(a) ? 1 : 0);
  return u.map((a, i) => ({ a, i })).sort((x, y) => peso(x.a) - peso(y.a) || x.i - y.i).map((x) => x.a);
}

/** Linhas viram grupos: um grupo por andar e categoria, na ordem em que aparecem. */
export function ambientesDasLinhas(linhas: LinhaMontador[], anteriores: Ambiente[] = []): Ambiente[] {
  const chave = (andar: string, grupo: string) => `${andar}|${grupo}`;
  const notas = new Map(anteriores.map((a) => [chave(a.pavimento?.trim() || 'Geral', nomeGrupo(a)), a.nota]));
  const ids = new Map(anteriores.map((a) => [chave(a.pavimento?.trim() || 'Geral', nomeGrupo(a)), a.id]));
  const andares = ordemAndares(linhas.map((l) => l.andar.trim() || 'Geral'));
  const r: Ambiente[] = [];
  for (const andar of andares) {
    const doAndar = linhas.filter((l) => (l.andar.trim() || 'Geral') === andar);
    const cats = Array.from(new Set(doAndar.map((l) => l.categoria.trim() || 'Serviços')));
    for (const cat of cats) {
      const itens: Item[] = doAndar.filter((l) => (l.categoria.trim() || 'Serviços') === cat).map((l) => {
        const pintura = l.parede != null || l.teto != null;
        const it: Item = {
          id: l.id, titulo: l.servico.trim() || 'Serviço', onde: l.onde.trim() || undefined,
          descricao: pintura ? descricaoPintura(l) : l.descricao, unidade: l.unidade || 'vb', quantidade: r2(l.quantidade), preco_unitario: r2(l.preco),
          complexidade: null, fator: 1, total: 0, ...(l.catalogo ? { catalogo: l.catalogo } : {}), ...(pintura ? { medidas: { parede: l.parede ?? 0, teto: l.teto ?? 0 } } : {}),
        };
        return { ...it, total: totalItem(it) };
      });
      const nota = notas.get(chave(andar, cat));
      // "Geral" = sem andar: a proposta continua no formato de ambientes.
      r.push({ id: ids.get(chave(andar, cat)) ?? novoId(), nome: cat, ...(andar !== 'Geral' ? { pavimento: andar } : {}), itens, ...(nota ? { nota } : {}) });
    }
  }
  return r;
}

// ---------------------------------------------------------------------
// Importar de uma IA (JSON) ou de uma planilha (colunas separadas por tab ou ;)
// ---------------------------------------------------------------------

export const COLUNAS_PLANILHA = ['Andar', 'Categoria', 'Serviço', 'Onde', 'O que será feito', 'Quantidade', 'Unidade', 'Preço unitário'];

/** Texto para colar numa IA (ChatGPT, Claude, Gemini) junto com fotos, medidas e o que o cliente pediu. */
export function modeloParaIA(catalogo: ServicoCatalogo[] = CATALOGO): string {
  const precos = catalogo.map((s) => `- ${s.categoria} | ${s.nome}: ${s.descricao} — R$ ${fmt(s.preco)}/${s.unidade === 'm2' ? 'm²' : s.unidade === 'm3' ? 'm³' : s.unidade}`).join('\n');
  return `Você vai montar um orçamento de reforma (ou construção) da ROSAE Engenharia, detalhado andar por andar.
Use as informações que vou mandar (medidas, fotos, projeto, pedido do cliente). Valores são de mão de obra e serviços; materiais só entram se eu disser.

Responda SOMENTE com um JSON neste formato, sem texto antes ou depois:

{
  "titulo": "Reforma residencial completa",
  "local": "Rua, número · Bairro, Cidade",
  "resumo": "Duas ou três frases do que será feito e do que o cliente ganha.",
  "necessidade": "O que o cliente pediu.",
  "dados": [{ "rotulo": "Imóvel", "valor": "Casa de 4 andares" }],
  "prazo_semanas": 10,
  "andares": [
    {
      "andar": "1º andar",
      "grupos": [
        {
          "grupo": "Pintura",
          "nota": "Frase curta opcional sobre o grupo",
          "servicos": [
            { "servico": "Hall de entrada", "parede_m2": 14.4, "teto_m2": 2.7, "preco_unitario": 65 },
            { "servico": "Troca de piso", "onde": "Entrada", "o_que": "Quebra, contrapiso com caimento e piso novo", "quantidade": 6, "unidade": "m2", "preco_unitario": 186.7 }
          ]
        }
      ]
    },
    { "andar": "Área externa e fachadas", "grupos": [] },
    { "andar": "Todos os andares", "grupos": [{ "grupo": "Canteiro e revisões", "servicos": [] }] }
  ],
  "etapas": [{ "nome": "Mobilização e demolições", "semanas": 2 }],
  "pagamento": [{ "descricao": "Sinal · mobilização", "percentual": 30 }],
  "inclusoes": ["..."],
  "exclusoes": ["..."],
  "premissas": ["..."]
}

Regras:
- Unidades: m2, m, m3, un, vb (verba), mes, pt (ponto).
- Pintura de ambiente: use parede_m2 e teto_m2 (sem quantidade); paredes de azulejo entram só no teto, ou como pintura epóxi.
- Um grupo por tipo de serviço em cada andar (Pintura, Pisos, Tetos e paredes, Impermeabilização, Hidráulica e drenagem, Portas e ferragens, Demolições, Canteiro).
- Canteiro, caçambas, andaime, avaliações e verbas vão em "Todos os andares".
- Use estes preços quando o serviço for o mesmo (pode ajustar se a situação pedir):
${precos}`;
}

type JsonIA = {
  titulo?: string; local?: string; resumo?: string; necessidade?: string; dados?: { rotulo: string; valor: string }[];
  prazo_semanas?: number; andares?: { andar?: string; grupos?: { grupo?: string; nota?: string; servicos?: Record<string, unknown>[] }[]; servicos?: Record<string, unknown>[] }[];
  etapas?: { nome?: string; semanas?: number; dias?: number; descricao?: string }[];
  pagamento?: { descricao?: string; percentual?: number; quando?: string }[];
  inclusoes?: string[]; exclusoes?: string[]; premissas?: string[];
};

export type Importado = {
  titulo?: string;
  linhas: LinhaMontador[];
  notas: Record<string, string>; // "andar|grupo" -> nota
  conteudo: Partial<Conteudo>;
  pagamentoPct?: { descricao: string; percentual: number; quando?: string }[];
  avisos: string[];
};

/** Número em formato brasileiro ou internacional ("1.234,56", "1234.56", "R$ 65"). */
export function numeroBr(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let t = String(v ?? '').replace(/R\$|\s|m²|m2|%/gi, '').trim();
  if (!t) return 0;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

const UNID: Record<string, string> = { 'm²': 'm2', m2: 'm2', 'm³': 'm3', m3: 'm3', m: 'm', ml: 'm', un: 'un', und: 'un', unid: 'un', unidade: 'un', vb: 'vb', verba: 'vb', mes: 'mes', 'mês': 'mes', pt: 'pt', ponto: 'pt', kg: 'kg', dia: 'dia' };
const unidade = (u: unknown) => UNID[String(u ?? '').trim().toLowerCase()] ?? (String(u ?? '').trim().toLowerCase() || 'vb');
const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));

function linhaDoJson(s: Record<string, unknown>, andar: string, grupo: string): LinhaMontador {
  const parede = s.parede_m2 ?? s.parede, teto = s.teto_m2 ?? s.teto;
  const base: LinhaMontador = {
    id: novoId(), andar, categoria: grupo, servico: texto(s.servico ?? s.nome ?? s.titulo) || 'Serviço', onde: texto(s.onde),
    descricao: texto(s.o_que ?? s.descricao ?? s.o_que_sera_feito), unidade: unidade(s.unidade), quantidade: numeroBr(s.quantidade ?? s.medida),
    preco: numeroBr(s.preco_unitario ?? s.preco),
  };
  if (parede != null || teto != null) return comMedidas(base, numeroBr(parede), numeroBr(teto));
  // Só o valor total: vira verba.
  if (!base.preco && s.valor != null) return { ...base, quantidade: 1, unidade: 'vb', preco: numeroBr(s.valor) };
  if (!base.quantidade) return { ...base, quantidade: 1 };
  return base;
}

function extrairJson(t: string): unknown {
  const bloco = t.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? t;
  const ini = bloco.indexOf('{'), fim = bloco.lastIndexOf('}');
  if (ini < 0 || fim <= ini) return null;
  try { return JSON.parse(bloco.slice(ini, fim + 1)); } catch { return null; }
}

/** Lê planilha colada: cabeçalho opcional, colunas na ordem de COLUNAS_PLANILHA. */
function lerPlanilha(t: string): LinhaMontador[] {
  const linhas = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!linhas.length) return [];
  const sep = linhas[0].includes('\t') ? '\t' : ';';
  const corpo = /andar/i.test(linhas[0]) && /servi/i.test(linhas[0]) ? linhas.slice(1) : linhas;
  return corpo.map((l) => l.split(sep).map((x) => x.trim())).filter((c) => c.length >= 6).map((c) => ({
    id: novoId(), andar: c[0] || 'Geral', categoria: c[1] || 'Serviços', servico: c[2] || 'Serviço', onde: c[3] ?? '', descricao: c[4] ?? '',
    quantidade: numeroBr(c[5]) || 1, unidade: unidade(c[6]), preco: numeroBr(c[7]),
  }));
}

/** Importa o que a IA devolveu (JSON) ou uma planilha colada. */
export function importar(t: string): Importado {
  const avisos: string[] = [];
  const j = extrairJson(t) as JsonIA | null;
  if (!j) {
    const linhas = lerPlanilha(t);
    if (!linhas.length) return { linhas: [], notas: {}, conteudo: {}, avisos: ['Não reconheci o formato. Cole o JSON que a IA devolveu ou as colunas da planilha.'] };
    return { linhas, notas: {}, conteudo: {}, avisos };
  }
  const linhas: LinhaMontador[] = [];
  const notas: Record<string, string> = {};
  for (const a of j.andares ?? []) {
    const andar = texto(a.andar) || 'Geral';
    const grupos = a.grupos ?? (a.servicos ? [{ grupo: 'Serviços', servicos: a.servicos }] : []);
    for (const g of grupos) {
      const grupo = texto(g.grupo) || 'Serviços';
      if (g.nota) notas[`${andar}|${grupo}`] = texto(g.nota);
      for (const s of g.servicos ?? []) linhas.push(linhaDoJson(s, andar, grupo));
    }
  }
  const semPreco = linhas.filter((l) => !(l.preco > 0)).length;
  if (semPreco) avisos.push(`${semPreco} serviço(s) vieram sem preço: confira antes de aplicar.`);
  const conteudo: Partial<Conteudo> = {};
  if (j.local) conteudo.local = texto(j.local);
  if (j.resumo) conteudo.resumo = texto(j.resumo);
  if (j.necessidade) conteudo.necessidade = texto(j.necessidade);
  if (Array.isArray(j.dados) && j.dados.length) conteudo.dados_tecnicos = j.dados.map((d) => ({ rotulo: texto(d.rotulo), valor: texto(d.valor) }));
  if (Array.isArray(j.inclusoes) && j.inclusoes.length) conteudo.inclusoes = j.inclusoes.map(texto).filter(Boolean);
  if (Array.isArray(j.exclusoes) && j.exclusoes.length) conteudo.exclusoes = j.exclusoes.map(texto).filter(Boolean);
  if (Array.isArray(j.premissas) && j.premissas.length) conteudo.premissas = j.premissas.map(texto).filter(Boolean);
  if (Array.isArray(j.etapas) && j.etapas.length) {
    conteudo.etapas = j.etapas.map((e) => ({ nome: texto(e.nome) || 'Etapa', descricao: texto(e.descricao) || undefined, prazo_dias: Math.round(numeroBr(e.dias) || numeroBr(e.semanas) * 7) || null, percentual: null }));
    const dias = conteudo.etapas.reduce((t2, e) => t2 + (e.prazo_dias ?? 0), 0);
    if (dias) conteudo.prazo_total_dias = dias;
  }
  if (j.prazo_semanas && !conteudo.prazo_total_dias) conteudo.prazo_total_dias = Math.round(numeroBr(j.prazo_semanas) * 7);
  if (j.prazo_semanas) conteudo.prazo_texto = `${numeroBr(j.prazo_semanas)} semanas, a contar do aceite, do pagamento do sinal e da liberação do imóvel.`;
  const pagamentoPct = Array.isArray(j.pagamento) && j.pagamento.length
    ? j.pagamento.map((p) => ({ descricao: texto(p.descricao) || 'Parcela', percentual: numeroBr(p.percentual), quando: texto(p.quando) || undefined })).filter((p) => p.percentual > 0)
    : undefined;
  if (pagamentoPct && Math.round(pagamentoPct.reduce((t2, p) => t2 + p.percentual, 0)) !== 100) avisos.push('Os percentuais do pagamento não somam 100%: ajuste na aba Pagamento.');
  return { titulo: j.titulo ? texto(j.titulo) : undefined, linhas, notas, conteudo, pagamentoPct, avisos };
}

/** Planilha (separada por tab) das linhas, para abrir no Excel/Google Planilhas ou mandar para a IA revisar. */
export function exportarPlanilha(linhas: LinhaMontador[], sep: '\t' | ';' = '\t'): string {
  const n = (v: number) => String(v).replace('.', ',');
  const cel = (v: string) => (sep === ';' && /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v.replace(/[\t\n]/g, ' '));
  return [COLUNAS_PLANILHA.join(sep), ...linhas.map((l) => [l.andar, l.categoria, l.servico, l.onde, l.parede != null || l.teto != null ? descricaoPintura(l) : l.descricao, n(l.quantidade), l.unidade, n(l.preco)].map(cel).join(sep))].join('\n');
}

/** Resumo por andar para conferir antes de aplicar. */
export function resumoAndares(linhas: LinhaMontador[]): { andar: string; servicos: number; total: number }[] {
  return ordemAndares(linhas.map((l) => l.andar.trim() || 'Geral')).map((andar) => {
    const ls = linhas.filter((l) => (l.andar.trim() || 'Geral') === andar);
    return { andar, servicos: ls.length, total: r2(ls.reduce((t, l) => t + totalLinha(l), 0)) };
  });
}

/** Linhas editadas no montador voltam para a proposta (os grupos e as notas se mantêm). */
export function aplicarLinhas(c: Conteudo, linhas: LinhaMontador[]): Conteudo {
  return { ...c, ambientes: ambientesDasLinhas(linhas, c.ambientes) };
}

/**
 * Aplica um orçamento importado: substitui (ou junta) os serviços, usa os textos que vieram
 * e reparte o pagamento pelos percentuais, fechando ao centavo na última parcela.
 */
export function aplicarImportado(c: Conteudo, imp: Importado, opcoes: { juntar?: boolean; textos?: boolean } = {}): Conteudo {
  const base = opcoes.juntar ? linhasDoConteudo(c) : [];
  const anteriores: Ambiente[] = [
    ...(opcoes.juntar ? c.ambientes : []),
    ...Object.entries(imp.notas).map(([k, nota]) => { const [pavimento, nome] = k.split('|'); return { id: novoId(), nome, pavimento, itens: [], nota }; }),
  ];
  let r: Conteudo = { ...c, ambientes: ambientesDasLinhas([...base, ...imp.linhas], anteriores) };
  if (opcoes.textos !== false) {
    r = { ...r, ...imp.conteudo };
    const total = totalConteudo(r);
    if (imp.pagamentoPct?.length && total > 0) {
      const soma = imp.pagamentoPct.reduce((t, p) => t + p.percentual, 0);
      let usado = 0;
      const parcelas = imp.pagamentoPct.map((p, k) => {
        const v = k === imp.pagamentoPct!.length - 1 ? total - usado : Math.round((total * p.percentual) / soma);
        usado += v;
        return { descricao: p.descricao, valor: v / 100, ...(p.quando ? { quando: p.quando } : {}) };
      });
      r = { ...r, pagamento: { ...r.pagamento, parcelas } };
    }
  }
  return r;
}
