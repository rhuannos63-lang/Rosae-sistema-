// Montagem do portal: o que o cliente vê e em que ordem, sugerido pelo tipo de serviço
// e ajustado pela ROSAE (liga, desliga, reordena, renomeia, edita os textos e publica).
// Também escreve o rascunho da "novidade" (o resumo recente) a partir do andamento publicado.
import { PERFIS, calcularJornada, faseAtual, type Perfil } from './jornada';
import { SERVICO, diasAte, doTrabalho, seuTrabalho } from './portalServico';
import { faseEtapa, proximaEtapa, type EtapaPortal, type PendenciaPortal } from './portal';
import { formatarData } from './datas';

export type BlocoId = 'boas_vindas' | 'novidade' | 'agora' | 'aguardando' | 'jornada' | 'ambientes' | 'galeria' | 'correr_bem' | 'duvidas';
export type AbaOpcional = 'cronograma' | 'ambientes' | 'fotos' | 'medicoes';

export type BlocoMontado = { id: BlocoId; visivel: boolean; titulo?: string };
export type Duvida = { p: string; r: string };

export type Montagem = {
  versao: 1;
  /** Tipo de serviço usado na sugestão (se o serviço mudar, a ROSAE vê o aviso). */
  perfil: Perfil;
  blocos: BlocoMontado[];
  abas: Record<AbaOpcional, boolean>;
  /** Textos próprios desta obra; vazio = usa os textos do tipo de serviço. */
  pedimos?: string[];
  cuidados?: string[];
  duvidas?: Duvida[];
  publicado_em?: string;
};

type DefBloco = {
  nome: string;
  /** O que o bloco mostra, explicado ao escritório. */
  explica: string;
  /** Título que o cliente vê (null = bloco sem título). */
  titulo: (perfil: Perfil) => string | null;
  /** Só aparece quando há conteúdo (o escritório é avisado). */
  quando?: string;
};

export const BLOCOS: Record<BlocoId, DefBloco> = {
  boas_vindas: { nome: 'Boas-vindas', explica: 'A sua mensagem de abertura, logo abaixo da capa.', titulo: () => null, quando: 'Aparece quando a mensagem estiver escrita.' },
  novidade: { nome: 'Novidade recente', explica: 'O último resumo publicado, com as fotos escolhidas. É o que o cliente lê primeiro ao abrir.', titulo: () => 'Novidade', quando: 'Aparece depois da primeira novidade publicada.' },
  agora: { nome: 'O que está acontecendo agora', explica: 'Fase atual, o que acontece nela, como o cliente participa e o próximo marco.', titulo: () => null },
  aguardando: { nome: 'Aguardando você', explica: 'Decisões e medições que dependem do cliente, com prazo.', titulo: () => 'Aguardando você', quando: 'Aparece só quando há algo para o cliente responder.' },
  jornada: { nome: 'Jornada do serviço', explica: 'Ilustração, fases, linha do tempo, números e o que o cliente recebe.', titulo: () => null },
  ambientes: { nome: 'Por ambiente', explica: 'Percentual executado de cada ambiente.', titulo: () => 'Por ambiente', quando: 'Aparece quando a obra tem ambientes.' },
  galeria: { nome: 'Fotos recentes', explica: 'As últimas fotos ou imagens publicadas.', titulo: (p) => `${SERVICO[p].galeria} recentes`, quando: 'Aparece quando houver foto publicada.' },
  correr_bem: { nome: 'Para tudo correr bem', explica: 'O que costumamos pedir ao cliente e os cuidados durante a execução.', titulo: () => 'Para tudo correr bem' },
  duvidas: { nome: 'Dúvidas frequentes', explica: 'Perguntas e respostas do tipo de serviço e termos técnicos.', titulo: () => 'Dúvidas frequentes' },
};

export const ABAS_OPCIONAIS: Record<AbaOpcional, { nome: string; explica: string }> = {
  cronograma: { nome: 'Etapas', explica: 'Etapas em andamento, próximas e concluídas, com materiais.' },
  ambientes: { nome: 'Ambientes', explica: 'Cada ambiente com o seu andamento e fotos.' },
  fotos: { nome: 'Fotos', explica: 'Galeria completa, com antes e depois.' },
  medicoes: { nome: 'Medições', explica: 'Medições enviadas para o cliente conferir (sem valores).' },
};

const TODOS: BlocoId[] = ['boas_vindas', 'novidade', 'agora', 'aguardando', 'jornada', 'ambientes', 'galeria', 'correr_bem', 'duvidas'];

/** Ordem sugerida por tipo de serviço: o que mais interessa ao cliente daquele serviço vem primeiro. */
const ORDEM: Record<Perfil, BlocoId[]> = {
  // Projeto: o cliente quer saber em que fase está e o que precisa enviar; fotos importam pouco.
  projeto: ['boas_vindas', 'agora', 'aguardando', 'novidade', 'jornada', 'correr_bem', 'galeria', 'duvidas'],
  arquitetura: ['boas_vindas', 'agora', 'aguardando', 'novidade', 'jornada', 'galeria', 'correr_bem', 'duvidas'],
  // Obras: a novidade com fotos é o que o cliente procura; ambientes ajudam na construção.
  reforma: ['boas_vindas', 'novidade', 'aguardando', 'agora', 'galeria', 'jornada', 'correr_bem', 'duvidas'],
  construcao: ['boas_vindas', 'novidade', 'aguardando', 'agora', 'jornada', 'ambientes', 'galeria', 'correr_bem', 'duvidas'],
  // Reforço: segurança e decisões primeiro; os cuidados ficam à vista.
  reforco: ['boas_vindas', 'aguardando', 'agora', 'novidade', 'jornada', 'correr_bem', 'galeria', 'duvidas'],
  laudo: ['boas_vindas', 'agora', 'aguardando', 'novidade', 'jornada', 'galeria', 'duvidas', 'correr_bem'],
  regularizacao: ['boas_vindas', 'agora', 'aguardando', 'novidade', 'jornada', 'correr_bem', 'duvidas'],
  gestao: ['boas_vindas', 'novidade', 'aguardando', 'agora', 'jornada', 'ambientes', 'galeria', 'correr_bem', 'duvidas'],
};

/** Montagem sugerida para o tipo de serviço. Blocos fora da ordem ficam desligados no fim. */
export function sugestaoMontagem(perfil: Perfil): Montagem {
  const ordem = ORDEM[perfil];
  const campo = SERVICO[perfil].campo;
  return {
    versao: 1,
    perfil,
    blocos: [...ordem.map((id) => ({ id, visivel: true })), ...TODOS.filter((id) => !ordem.includes(id)).map((id) => ({ id, visivel: false }))],
    abas: { cronograma: true, ambientes: campo, fotos: true, medicoes: campo },
  };
}

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const listaTextos = (v: unknown, max: number) => (Array.isArray(v) ? v.map((x) => texto(x, max)).filter(Boolean).slice(0, 20) : undefined);

/**
 * Lê a montagem gravada (ou nada) e devolve uma montagem completa: blocos desconhecidos saem,
 * blocos novos do sistema entram desligados no fim, abas e textos ausentes seguem a sugestão.
 */
export function normalizarMontagem(gravada: unknown, perfil: Perfil): Montagem {
  const base = sugestaoMontagem(perfil);
  if (!gravada || typeof gravada !== 'object') return base;
  const g = gravada as Partial<Montagem>;
  const vistos = new Set<BlocoId>();
  const blocos: BlocoMontado[] = [];
  for (const b of Array.isArray(g.blocos) ? g.blocos : []) {
    if (!b || !TODOS.includes(b.id) || vistos.has(b.id)) continue;
    vistos.add(b.id);
    const titulo = texto(b.titulo, 60);
    blocos.push({ id: b.id, visivel: b.visivel !== false, ...(titulo ? { titulo } : {}) });
  }
  for (const b of base.blocos) if (!vistos.has(b.id)) blocos.push({ ...b, visivel: blocos.length === 0 ? b.visivel : false });
  const abas = { ...base.abas };
  if (g.abas && typeof g.abas === 'object') for (const k of Object.keys(abas) as AbaOpcional[]) if (typeof g.abas[k] === 'boolean') abas[k] = g.abas[k];
  const pedimos = listaTextos(g.pedimos, 200);
  const cuidados = listaTextos(g.cuidados, 200);
  const duvidas = Array.isArray(g.duvidas)
    ? g.duvidas.map((d) => ({ p: texto(d?.p, 160), r: texto(d?.r, 800) })).filter((d) => d.p && d.r).slice(0, 20)
    : undefined;
  return {
    versao: 1,
    perfil: g.perfil && g.perfil in PERFIS ? g.perfil : perfil,
    blocos, abas,
    ...(pedimos?.length ? { pedimos } : {}),
    ...(cuidados ? { cuidados } : {}),
    ...(duvidas?.length ? { duvidas } : {}),
    ...(typeof g.publicado_em === 'string' ? { publicado_em: g.publicado_em } : {}),
  };
}

/** Textos que o cliente vê nos blocos "Para tudo correr bem" e "Dúvidas": os da obra ou os do serviço. */
export function textosDoPortal(m: Montagem, perfil: Perfil) {
  const cfg = SERVICO[perfil];
  return {
    pedimos: m.pedimos?.length ? m.pedimos : cfg.pedimos,
    cuidados: m.cuidados ?? cfg.cuidados,
    duvidas: m.duvidas?.length ? m.duvidas : cfg.duvidas,
  };
}

/** Título do bloco para o cliente: o escolhido pela ROSAE ou o padrão do serviço. */
export function tituloBloco(m: Montagem, id: BlocoId, perfil: Perfil): string | null {
  return m.blocos.find((b) => b.id === id)?.titulo || BLOCOS[id].titulo(perfil);
}

/** Quantas escolhas diferem da sugestão do serviço (0 = segue a sugestão). */
export function ajustesDaSugestao(m: Montagem, perfil: Perfil): number {
  const s = sugestaoMontagem(perfil);
  const visiveis = (x: Montagem) => x.blocos.filter((b) => b.visivel).map((b) => b.id).join(',');
  let n = visiveis(m) === visiveis(s) ? 0 : 1;
  n += m.blocos.filter((b) => b.titulo).length;
  n += (Object.keys(s.abas) as AbaOpcional[]).filter((k) => s.abas[k] !== m.abas[k]).length;
  n += (m.pedimos ? 1 : 0) + (m.cuidados ? 1 : 0) + (m.duvidas ? 1 : 0);
  return n;
}

/** Move um bloco uma posição para cima (-1) ou para baixo (+1). */
export function moverBloco(m: Montagem, id: BlocoId, passo: -1 | 1): Montagem {
  const i = m.blocos.findIndex((b) => b.id === id);
  const j = i + passo;
  if (i < 0 || j < 0 || j >= m.blocos.length) return m;
  const blocos = [...m.blocos];
  [blocos[i], blocos[j]] = [blocos[j], blocos[i]];
  return { ...m, blocos };
}

// ---------------------------------------------------------------------
// Novidade: resumo recente, escrito pelo sistema e revisado pela ROSAE
// ---------------------------------------------------------------------

export type EntradaNovidade = {
  perfil: Perfil;
  /** Etapas que o cliente vê (publicadas). */
  etapas: EtapaPortal[];
  pendencias: Pick<PendenciaPortal, 'titulo' | 'estado' | 'responsavel' | 'prazo'>[];
  executado: number;
  /** Início do período do resumo (AAAA-MM-DD). */
  desde: string;
  hoje: string;
  /** Fotos escolhidas para acompanhar o resumo. */
  fotos: number;
  nomeServico?: (id: string | null) => string;
};

export type Novidade = { titulo: string; texto: string; etapa_id: string | null };

const lista = (nomes: string[]) => (nomes.length <= 1 ? nomes[0] ?? '' : `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)}`);
const dentro = (d: string | null | undefined, desde: string, hoje: string) => !!d && d.slice(0, 10) >= desde && d.slice(0, 10) <= hoje;

/** "nos últimos 7 dias", "desde 02/11", "hoje". */
export function periodoNovidade(desde: string, hoje: string): string {
  const dias = diasAte(hoje, desde);
  if (dias <= 0) return 'hoje';
  if (dias === 7) return 'nesta semana';
  if (dias === 14 || dias === 15) return 'nas últimas duas semanas';
  return `desde ${formatarData(desde).slice(0, 5)}`;
}

/** Escreve o rascunho da novidade com o vocabulário do serviço. A ROSAE revisa antes de publicar. */
export function sugerirNovidade(e: EntradaNovidade): Novidade {
  const def = PERFIS[e.perfil];
  const cfg = SERVICO[e.perfil];
  const concluidas = e.etapas.filter((x) => faseEtapa(x) === 'concluida' && dentro(x.fim_real, e.desde, e.hoje));
  const iniciadas = e.etapas.filter((x) => faseEtapa(x) !== 'concluida' && dentro(x.inicio_real, e.desde, e.hoje));
  const andamento = e.etapas.filter((x) => faseEtapa(x) === 'atual' && !iniciadas.includes(x));
  const proxima = proximaEtapa(e.etapas);
  const fases = calcularJornada(e.perfil, e.etapas, e.executado, e.nomeServico);
  const fase = fases[faseAtual(fases)];
  const tudo = fases.every((f) => f.estado === 'concluida');
  const decisoes = e.pendencias.filter((p) => p.estado === 'aberta' && p.responsavel === 'cliente');
  const periodo = periodoNovidade(e.desde, e.hoje);

  const titulo = tudo ? `${seuTrabalho(e.perfil)[0].toUpperCase()}${seuTrabalho(e.perfil).slice(1)} está pront${cfg.trabalho === 'obra' ? 'a' : 'o'}`
    : concluidas.length ? `Concluímos ${concluidas[0].nome.toLowerCase()}${concluidas.length > 1 ? ` e mais ${concluidas.length - 1}` : ''}`
      : iniciadas.length ? `Começamos ${iniciadas[0].nome.toLowerCase()}`
        : `Andamento ${doTrabalho(e.perfil)}: ${fase.nome.toLowerCase()}`;

  const linhas: string[] = [];
  const feitos: string[] = [];
  if (concluidas.length) feitos.push(`• Concluímos ${lista(concluidas.map((x) => x.nome))}.`);
  if (iniciadas.length) feitos.push(`• Começamos ${lista(iniciadas.map((x) => x.nome))}.`);
  for (const x of andamento.slice(0, 3)) feitos.push(`• ${x.nome} segue em andamento (${Math.round(Number(x.percentual) || 0)}%).`);
  if (feitos.length) linhas.push(`O que avançou ${periodo}:`, ...feitos, '');
  if (!tudo) linhas.push(`Agora ${def.onde}: ${fase.nome}. ${fase.agora}`);
  linhas.push(`Executado até aqui: ${Math.round(Number(e.executado) || 0)}%.`);
  if (proxima && !tudo) {
    linhas.push('', `Próximo passo: ${proxima.nome}${proxima.inicio_previsto ? `, previsto para ${formatarData(proxima.inicio_previsto)}` : ''}.`);
  }
  if (decisoes.length) {
    linhas.push('', `Precisamos de você: ${lista(decisoes.map((p) => `${p.titulo}${p.prazo ? ` (até ${formatarData(p.prazo)})` : ''}`))}. Responda em “Aguardando você”.`);
  }
  if (e.fotos > 0) linhas.push('', e.fotos === 1 ? `Separamos uma ${cfg.galeria === 'Fotos' ? 'foto' : 'imagem'} para você acompanhar.` : `Separamos ${e.fotos} ${cfg.galeria === 'Fotos' ? 'fotos' : 'imagens'} para você acompanhar.`);
  linhas.push('', tudo ? 'Obrigado pela confiança. Qualquer dúvida, fale com a gente por aqui.' : 'Qualquer dúvida, comente aqui mesmo.');

  const foco = concluidas[0] ?? iniciadas[0] ?? andamento[0] ?? null;
  return { titulo, texto: linhas.join('\n').replace(/\n{3,}/g, '\n\n').trim(), etapa_id: foco?.id ?? null };
}

/** Fotos ligadas a uma novidade: guardadas em detalhes.fotos (ids separados por vírgula). */
export function fotosDaNovidade(detalhes: Record<string, unknown> | null | undefined): string[] {
  const v = detalhes?.fotos;
  return typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : [];
}
