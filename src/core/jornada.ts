// Jornada do cliente por tipo de serviço: as grandes fases de cada tipo de trabalho,
// em linguagem simples, e como as etapas publicadas da obra se distribuem nelas.
import { faseEtapa, type EtapaPortal, type Fase } from './portal';

export type Perfil = 'projeto' | 'reforco' | 'reforma' | 'construcao' | 'laudo' | 'gestao';

export type FaseJornada = {
  id: string;
  nome: string;
  /** O que acontece nesta fase, explicado ao cliente. */
  agora: string;
  /** Palavras que ligam uma etapa da obra a esta fase. */
  palavras: string[];
};

export type DefinicaoPerfil = {
  nome: string;
  /** Frase que abre a jornada. */
  chamada: string;
  /** Onde o trabalho acontece: muda os textos ("na obra" ou "no escritório"). */
  onde: string;
  fases: FaseJornada[];
};

export const PERFIS: Record<Perfil, DefinicaoPerfil> = {
  projeto: {
    nome: 'Projeto estrutural',
    chamada: 'Do levantamento às pranchas assinadas: acompanhe o seu projeto ganhar forma.',
    onde: 'no escritório',
    fases: [
      { id: 'levantamento', nome: 'Levantamento', agora: 'Reunimos a arquitetura, as medidas e as suas necessidades para começar certo.', palavras: ['levant', 'brief', 'visita', 'arquitet', 'dados', 'reuni', 'sondag'] },
      { id: 'concepcao', nome: 'Concepção', agora: 'Definimos onde ficam pilares, vigas e lajes, conversando com a arquitetura.', palavras: ['concep', 'lança', 'lanç', 'modelo', 'pré-dimension', 'estudo'] },
      { id: 'calculo', nome: 'Cálculo', agora: 'Calculamos cargas, esforços e dimensões de cada peça pelas normas técnicas.', palavras: ['cálcul', 'calcul', 'dimension', 'anális', 'verific'] },
      { id: 'detalhamento', nome: 'Detalhamento', agora: 'Desenhamos as pranchas de formas e armações que a obra vai seguir.', palavras: ['detalh', 'prancha', 'desenho', 'armaç', 'forma'] },
      { id: 'entrega', nome: 'Entrega', agora: 'Revisamos tudo, emitimos a ART e entregamos o projeto pronto para executar.', palavras: ['revis', 'entreg', 'art', 'compatib', 'aprova'] },
    ],
  },
  reforco: {
    nome: 'Reforço estrutural',
    chamada: 'Da investigação à estrutura reforçada: veja cada camada do trabalho.',
    onde: 'na obra',
    fases: [
      { id: 'diagnostico', nome: 'Diagnóstico', agora: 'Investigamos a estrutura, medimos e registramos o que precisa ser corrigido.', palavras: ['diagn', 'vistor', 'inspe', 'ensaio', 'levant', 'investig'] },
      { id: 'projeto', nome: 'Projeto do reforço', agora: 'Calculamos a solução de reforço e definimos materiais e sequência.', palavras: ['projeto', 'cálcul', 'calcul', 'dimension', 'solução'] },
      { id: 'preparo', nome: 'Escoramento e preparo', agora: 'Escoramos com segurança e preparamos a superfície para receber o reforço.', palavras: ['escor', 'prepar', 'apicoa', 'demol', 'limpeza do', 'remoç', 'tratamento', 'corros'] },
      { id: 'execucao', nome: 'Execução do reforço', agora: 'Aplicamos o reforço: armaduras, chapas, fibras ou concreto novo.', palavras: ['reforç', 'encamis', 'fibra', 'chapa', 'concret', 'graute', 'solda', 'armad', 'perfil'] },
      { id: 'entrega', nome: 'Conferência e entrega', agora: 'Conferimos o resultado, retiramos o escoramento e entregamos com a documentação.', palavras: ['confer', 'entreg', 'acabam', 'desforma', 'retirada', 'laudo', 'art'] },
    ],
  },
  reforma: {
    nome: 'Reforma',
    chamada: 'Ambiente por ambiente, da preparação ao último acabamento.',
    onde: 'na obra',
    fases: [
      { id: 'preparo', nome: 'Preparação', agora: 'Protegemos o que fica e retiramos o que sai, com o local organizado.', palavras: ['prote', 'demol', 'retir', 'prepar', 'mobiliz', 'remoç'] },
      { id: 'infra', nome: 'Instalações', agora: 'Passamos as novas instalações elétricas e hidráulicas antes de fechar paredes e pisos.', palavras: ['elétr', 'eletr', 'hidr', 'instal', 'tubul', 'infra', 'gás', 'esgot'] },
      { id: 'base', nome: 'Paredes e pisos', agora: 'Fazemos alvenaria, reboco, contrapiso e gesso: a base dos acabamentos.', palavras: ['alvenar', 'reboco', 'contrapiso', 'regulariz', 'gesso', 'drywall', 'impermeab', 'forro'] },
      { id: 'acabamento', nome: 'Acabamentos', agora: 'Revestimentos, pintura, louças e metais: é aqui que o ambiente aparece.', palavras: ['revest', 'pint', 'piso', 'acab', 'louç', 'metai', 'marcen', 'porcelan', 'bancad'] },
      { id: 'entrega', nome: 'Entrega', agora: 'Limpeza fina, conferência item a item e entrega das chaves.', palavras: ['limp', 'entreg', 'vistoria', 'confer'] },
    ],
  },
  construcao: {
    nome: 'Construção',
    chamada: 'Da fundação às chaves: acompanhe a sua construção subir.',
    onde: 'na obra',
    fases: [
      { id: 'fundacao', nome: 'Fundação', agora: 'Preparamos o terreno e executamos a fundação, que sustenta toda a casa.', palavras: ['prelim', 'fund', 'terra', 'canteiro', 'locaç', 'sapat', 'estaca', 'baldram'] },
      { id: 'estrutura', nome: 'Estrutura', agora: 'Pilares, vigas e lajes: o esqueleto da construção.', palavras: ['estrut', 'pilar', 'viga', 'laje', 'escad'] },
      { id: 'vedacao', nome: 'Paredes e cobertura', agora: 'Levantamos as paredes e fechamos o telhado.', palavras: ['alvenar', 'cobert', 'telhad', 'vedaç', 'parede'] },
      { id: 'instalacoes', nome: 'Instalações', agora: 'Elétrica, hidráulica e esgoto passam por dentro de paredes e pisos.', palavras: ['instal', 'elétr', 'eletr', 'hidr', 'esgot', 'gás'] },
      { id: 'acabamentos', nome: 'Acabamentos', agora: 'Revestimentos, pintura, esquadrias e louças dão cara de casa pronta.', palavras: ['revest', 'acab', 'pint', 'piso', 'esquadr', 'louç'] },
      { id: 'entrega', nome: 'Entrega', agora: 'Limpeza, conferência final, manual do proprietário e chaves na mão.', palavras: ['limp', 'entreg', 'as built', 'manual', 'habite', 'controle tecnol'] },
    ],
  },
  laudo: {
    nome: 'Laudo técnico',
    chamada: 'Da vistoria ao laudo assinado: cada passo da análise.',
    onde: 'no imóvel e no escritório',
    fases: [
      { id: 'vistoria', nome: 'Vistoria', agora: 'Visitamos o imóvel, fotografamos e registramos tudo o que é observado.', palavras: ['vistor', 'visita', 'agend', 'inspe', 'levant'] },
      { id: 'ensaios', nome: 'Ensaios e medições', agora: 'Medimos e, quando preciso, ensaiamos materiais para ter números confiáveis.', palavras: ['ensaio', 'medi', 'esclerom', 'sondag', 'extraç', 'fotograf'] },
      { id: 'analise', nome: 'Análise técnica', agora: 'Cruzamos o que foi visto com as normas para chegar às causas e riscos.', palavras: ['anális', 'diagn', 'cálcul', 'calcul', 'estudo', 'norma'] },
      { id: 'redacao', nome: 'Redação do laudo', agora: 'Escrevemos o laudo com fotos, conclusões e recomendações claras.', palavras: ['laudo', 'relat', 'redaç', 'parecer', 'document'] },
      { id: 'entrega', nome: 'Entrega e ART', agora: 'Entregamos o laudo assinado, com ART, e explicamos o resultado a você.', palavras: ['entreg', 'art', 'apresent', 'reuni'] },
    ],
  },
  gestao: {
    nome: 'Gestão de obra',
    chamada: 'Planejamento, execução e conferência: tudo acompanhado de perto.',
    onde: 'na obra',
    fases: [
      { id: 'planejamento', nome: 'Planejamento', agora: 'Organizamos cronograma, compras e equipes antes de começar.', palavras: ['planej', 'cronogr', 'orçam', 'mobiliz', 'prelim'] },
      { id: 'contratacao', nome: 'Contratações', agora: 'Escolhemos e contratamos as equipes e fornecedores certos.', palavras: ['contrat', 'cotaç', 'compra', 'fornec'] },
      { id: 'execucao', nome: 'Execução', agora: 'Acompanhamos a execução de perto, etapa por etapa.', palavras: ['execu', 'obra', 'serviç', 'estrut', 'alvenar', 'instal', 'acab'] },
      { id: 'conferencia', nome: 'Conferência', agora: 'Conferimos a qualidade e corrigimos pendências antes de seguir.', palavras: ['confer', 'inspe', 'qualid', 'vistor'] },
      { id: 'entrega', nome: 'Entrega', agora: 'Fechamos a obra com tudo conferido e documentado.', palavras: ['entreg', 'limp', 'as built', 'manual'] },
    ],
  },
};

const PERFIL_DO_GERADOR: Record<string, Perfil> = {
  projeto_estrutural: 'projeto', reforco: 'reforco', reforma: 'reforma', construcao: 'construcao', laudo: 'laudo', pericia: 'laudo',
};

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Perfil da obra: pelo orçamento automático de origem; senão pelo tipo de serviço escrito na obra. */
export function perfilDaObra(tipoServico: string | null | undefined, gerador?: string | null): Perfil {
  if (gerador && PERFIL_DO_GERADOR[gerador]) return PERFIL_DO_GERADOR[gerador];
  const t = sem(tipoServico ?? '');
  if (/refor[cç]o/.test(t)) return 'reforco';
  if (/projeto|calculo/.test(t)) return 'projeto';
  if (/laudo|vistoria|pericia|inspecao|parecer/.test(t)) return 'laudo';
  if (/reforma|retrofit|banheiro|cozinha/.test(t)) return 'reforma';
  if (/constru/.test(t)) return 'construcao';
  if (/gest|acompanhamento|administra/.test(t)) return 'gestao';
  return 'construcao';
}

export type FaseCalculada = FaseJornada & {
  etapas: EtapaPortal[];
  /** 0 a 100 */
  progresso: number;
  estado: Fase;
};

/**
 * Distribui as etapas nas fases: pelo nome (da etapa ou do serviço); a etapa sem palavra
 * conhecida vai pela posição, nunca antes da fase da etapa anterior. Sem etapas publicadas, a fase segue o percentual geral.
 */
export function calcularJornada(perfil: Perfil, etapas: EtapaPortal[], executadoGeral: number, nomeServico: (id: string | null) => string = () => ''): FaseCalculada[] {
  const def = PERFIS[perfil];
  const ordenadas = [...etapas].sort((a, b) => a.ordem - b.ordem || (a.inicio_previsto ?? '').localeCompare(b.inicio_previsto ?? ''));
  const grupos: EtapaPortal[][] = def.fases.map(() => []);
  let ultima = 0;
  ordenadas.forEach((e, k) => {
    const nome = sem(e.nome);
    const servico = sem(nomeServico(e.servico_id));
    const achar = (texto: string) => def.fases.findIndex((f) => f.palavras.some((p) => (p.length <= 3 ? new RegExp(`\\b${sem(p)}\\b`).test(texto) : texto.includes(sem(p)))));
    let i = achar(nome);
    if (i < 0) i = achar(servico);
    if (i < 0) i = ordenadas.length > 1 ? Math.max(ultima, Math.min(def.fases.length - 1, Math.floor((k / ordenadas.length) * def.fases.length))) : ultima;
    grupos[i].push(e);
    ultima = i;
  });

  const n = def.fases.length;
  const geral = Math.max(0, Math.min(100, Number(executadoGeral) || 0));
  const fases: FaseCalculada[] = def.fases.map((f, i) => {
    const es = grupos[i];
    if (es.length) {
      const progresso = es.reduce((t, e) => t + (faseEtapa(e) === 'concluida' ? 100 : Math.max(0, Math.min(100, Number(e.percentual) || 0))), 0) / es.length;
      const estado: Fase = es.every((e) => faseEtapa(e) === 'concluida') ? 'concluida' : es.some((e) => faseEtapa(e) !== 'futura' || Number(e.percentual) > 0) ? 'atual' : 'futura';
      return { ...f, etapas: es, progresso, estado };
    }
    if (etapas.length) return { ...f, etapas: es, progresso: 0, estado: 'futura' as Fase };
    // Sem etapas publicadas: cada fase é uma fatia do percentual geral.
    const progresso = Math.max(0, Math.min(100, (geral - (i * 100) / n) * n));
    return { ...f, etapas: es, progresso, estado: progresso >= 100 ? 'concluida' : progresso > 0 ? 'atual' : 'futura' };
  });
  // Fase sem etapa entre fases já começadas conta como concluída (a obra passou por ela).
  const ultimaComecada = fases.reduce((m, f, i) => (f.estado !== 'futura' ? i : m), -1);
  return fases.map((f, i) => (f.etapas.length === 0 && etapas.length && i < ultimaComecada ? { ...f, progresso: 100, estado: 'concluida' } : f));
}

/** Fase em destaque: a primeira em andamento; senão a próxima a começar; senão a última. */
export function faseAtual(fases: FaseCalculada[]): number {
  const i = fases.findIndex((f) => f.estado === 'atual');
  if (i >= 0) return i;
  const j = fases.findIndex((f) => f.estado === 'futura');
  return j >= 0 ? j : fases.length - 1;
}
