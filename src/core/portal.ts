// O que o cliente vê no portal: tipos da resposta de portal_dados e regras de
// apresentação (fases das etapas, próxima atividade, ciência, antes e depois).

export type EstadoEtapaPortal =
  | 'nao_iniciado' | 'programado' | 'em_execucao' | 'aguardando_material' | 'aguardando_liberacao'
  | 'suspenso' | 'executado' | 'conferido';

export type EtapaPortal = {
  id: string; servico_id: string; nome: string; estado: EstadoEtapaPortal; percentual: number; ordem: number;
  inicio_previsto: string | null; fim_previsto: string | null; inicio_real: string | null; fim_real: string | null;
};
export type RegistroPortal = {
  id: string; data: string; tipo: 'andamento' | 'impedimento' | 'inspecao' | 'condicao_existente' | 'decisao';
  titulo: string | null; texto: string | null; detalhes: Record<string, string | boolean>;
  servico_id: string | null; etapa_id: string | null; ambiente_id: string | null; publicado_em: string; versao: string;
};
export type PendenciaPortal = {
  id: string; tipo: 'pendencia' | 'decisao_cliente' | 'impedimento' | 'inspecao'; titulo: string; descricao: string | null;
  estado: 'aberta' | 'resolvida'; prazo: string | null; responsavel: 'rosae' | 'cliente' | 'parceiro' | 'outro'; resolucao: string | null;
  servico_id: string | null; etapa_id: string | null; publicado_em: string; versao: string;
};
export type FotoPortal = {
  id: string; tirada_em: string; legenda: string | null; momento: 'antes' | 'durante' | 'depois' | 'outro';
  servico_id: string | null; etapa_id: string | null; ambiente_id: string | null; registro_id: string | null;
  largura: number | null; altura: number | null;
};
export type MaterialPortal = {
  id: string; descricao: string; servico_id: string | null; etapa_id: string | null; compra_cliente: boolean;
  necessario_em: string | null; situacao: 'previsto' | 'aguardando_entrega' | 'disponivel';
};
export type AlvoTipo = 'obra' | 'servico' | 'etapa' | 'foto' | 'registro' | 'pendencia';
export type ComentarioPortal = {
  id: string; alvo_tipo: AlvoTipo; alvo_id: string | null; tipo: 'comentario' | 'pergunta' | 'solicitacao_ajuste';
  texto: string; autor: string; meu: boolean; criado_em: string; estado: 'aberto' | 'respondido' | 'resolvido';
  resposta: string | null; respondido_em: string | null;
};
export type CienciaPortal = { alvo_tipo: 'registro' | 'pendencia'; alvo_id: string; versao: string; pessoa_id: string; pessoa: string; criado_em: string };

export type DadosPortal = {
  erro?: string;
  previa?: boolean;
  expira_em?: string;
  obra: {
    id: string; codigo: string; nome: string; endereco: string | null; status: string; data_inicio: string | null;
    data_previsao_fim: string | null; data_conclusao: string | null; boas_vindas: string | null; capa: string | null;
  };
  empresa: { nome: string; telefone: string | null; email: string | null; site: string | null; responsavel: string; frase: string | null } | null;
  eu: { id: string; nome: string } | null;
  participantes: { id: string; nome: string }[];
  progresso: { executado: number; conferido: number; etapas: number; concluidas: number };
  ambientes: { id: string; nome: string; executado: number }[];
  servicos: { id: string; nome: string; ordem: number; executado: number | null; ambientes: string[] }[];
  etapas: EtapaPortal[];
  registros: RegistroPortal[];
  pendencias: PendenciaPortal[];
  fotos: FotoPortal[];
  materiais: MaterialPortal[];
  comentarios: ComentarioPortal[];
  ciencias: CienciaPortal[];
  medicoes?: MedicaoPortal[];
  ultima_atualizacao: string | null;
};

/** Medição como o cliente vê: só percentuais, nunca valores. */
export type MedicaoPortal = {
  id: string; numero: number; data_corte: string; estado: 'enviada' | 'aprovada' | 'contestada';
  itens: { servico: string; etapa: string; anterior: number; atual: number }[];
  percentual_anterior: number; percentual_atual: number; observacao: string | null; hash: string;
  enviada_em: string; respondida_em: string | null; resposta_nome: string | null; resposta_texto: string | null;
};

export const ESTADO_PORTAL: Record<EstadoEtapaPortal, { rotulo: string; tom: 'ok' | 'info' | 'alerta' | 'neutro' }> = {
  nao_iniciado: { rotulo: 'A iniciar', tom: 'neutro' },
  programado: { rotulo: 'Programada', tom: 'neutro' },
  em_execucao: { rotulo: 'Em andamento', tom: 'info' },
  aguardando_material: { rotulo: 'Aguardando material', tom: 'alerta' },
  aguardando_liberacao: { rotulo: 'Aguardando liberação', tom: 'alerta' },
  suspenso: { rotulo: 'Pausada', tom: 'alerta' },
  executado: { rotulo: 'Concluída', tom: 'ok' },
  conferido: { rotulo: 'Concluída e conferida', tom: 'ok' },
};

export const STATUS_OBRA_PORTAL: Record<string, string> = {
  em_negociacao: 'Em negociação', aprovada: 'Aprovada', contratada: 'Contratada', em_execucao: 'Em execução',
  concluida_fisicamente: 'Concluída', encerrada_financeiramente: 'Concluída',
};

export const TIPO_REGISTRO_PORTAL: Record<RegistroPortal['tipo'], string> = {
  andamento: 'Andamento', impedimento: 'Impedimento', inspecao: 'Inspeção', condicao_existente: 'Condição existente', decisao: 'Decisão',
};

export const SITUACAO_MATERIAL_PORTAL: Record<MaterialPortal['situacao'], string> = {
  previsto: 'Previsto', aguardando_entrega: 'Aguardando entrega', disponivel: 'Disponível na obra',
};

export const TIPO_COMENTARIO: Record<ComentarioPortal['tipo'], string> = {
  comentario: 'Comentário', pergunta: 'Pergunta', solicitacao_ajuste: 'Solicitação de ajuste',
};

export type Fase = 'concluida' | 'atual' | 'futura';
export function faseEtapa(e: Pick<EtapaPortal, 'estado'>): Fase {
  if (e.estado === 'executado' || e.estado === 'conferido') return 'concluida';
  if (e.estado === 'nao_iniciado' || e.estado === 'programado') return 'futura';
  return 'atual';
}

/** Próxima atividade: a primeira etapa ainda não iniciada, pela data prevista (sem data vai para o fim). */
export function proximaEtapa(etapas: EtapaPortal[]): EtapaPortal | null {
  const futuras = etapas.filter((e) => faseEtapa(e) === 'futura');
  futuras.sort((a, b) => (a.inicio_previsto ?? '9999').localeCompare(b.inicio_previsto ?? '9999') || a.ordem - b.ordem);
  return futuras[0] ?? null;
}

/** Ciência de um item: quem já deu ciência da versão atual e quem deu só de uma versão anterior. */
export function cienciaDoItem(ciencias: CienciaPortal[], tipo: CienciaPortal['alvo_tipo'], id: string, versaoAtual: string) {
  const doItem = ciencias.filter((c) => c.alvo_tipo === tipo && c.alvo_id === id);
  const atuais = doItem.filter((c) => c.versao === versaoAtual);
  const comAtual = new Set(atuais.map((c) => c.pessoa_id));
  const anteriores = doItem.filter((c) => c.versao !== versaoAtual && !comAtual.has(c.pessoa_id));
  // Uma linha por pessoa (a mais recente de versão anterior).
  const porPessoa = new Map<string, CienciaPortal>();
  for (const c of anteriores) porPessoa.set(c.pessoa_id, c);
  return { atuais, anteriores: [...porPessoa.values()], euAtual: (eu: string | undefined) => !!eu && comAtual.has(eu) };
}

/** Pares antes/depois: mesma etapa, serviço ou ambiente (nessa ordem de preferência). */
export function paresAntesDepois(fotos: FotoPortal[]): { antes: FotoPortal; depois: FotoPortal; chave: string }[] {
  const antes = fotos.filter((f) => f.momento === 'antes');
  const depois = fotos.filter((f) => f.momento === 'depois');
  const usados = new Set<string>();
  const pares: { antes: FotoPortal; depois: FotoPortal; chave: string }[] = [];
  for (const campo of ['etapa_id', 'servico_id', 'ambiente_id'] as const) {
    for (const a of antes) {
      if (usados.has(a.id) || !a[campo]) continue;
      const d = depois.filter((x) => !usados.has(x.id) && x[campo] === a[campo]).sort((x, y) => y.tirada_em.localeCompare(x.tirada_em))[0];
      if (d) { usados.add(a.id); usados.add(d.id); pares.push({ antes: a, depois: d, chave: `${campo}:${a[campo]}` }); }
    }
  }
  return pares;
}

export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}
