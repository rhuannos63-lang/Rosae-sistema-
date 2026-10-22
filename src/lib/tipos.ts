// Tipos das tabelas usadas pelas telas (espelham supabase/migrations).

export type Papel = 'administrador' | 'administrativo' | 'campo' | 'cliente';
export type TipoConta = 'receber' | 'pagar';
export type Escopo = 'obra' | 'empresa';
export type Numeric = string | number;

export type Usuario = { id: string; nome: string; email: string | null; papel: Papel; acesso_financeiro: boolean; ativo: boolean };

export type Empresa = {
  id: string; nome_fantasia: string; razao_social: string | null; cnpj: string | null; data_inicio_cnpj: string | null;
  responsavel_tecnico: string; registro_profissional: string | null; registro_conferido: boolean; registro_conferido_em: string | null;
  endereco: string | null; telefone: string | null; email: string | null; site: string | null; instagram: string | null;
  frase_institucional: string | null; meta_recebimentos_mensal: Numeric | null; meta_vendas_mensal: Numeric | null;
  provisao_impostos_pct: Numeric | null; reserva_pct: Numeric | null; regra_reconhecimento: string | null;
};

export type Pessoa = {
  id: string; codigo: string; tipo_pessoa: 'fisica' | 'juridica'; nome: string; documento: string | null; telefone: string | null;
  email: string | null; eh_cliente: boolean; eh_fornecedor: boolean; eh_prestador: boolean; especialidade: string | null;
  chave_pix: string | null; endereco: string | null; observacoes: string | null; arquivado: boolean; criado_em: string;
};

export type StatusObra = 'em_negociacao' | 'aprovada' | 'contratada' | 'em_execucao' | 'concluida_fisicamente' | 'encerrada_financeiramente' | 'cancelada';

export const STATUS_OBRA: Record<StatusObra, string> = {
  em_negociacao: 'Em negociação',
  aprovada: 'Aprovada',
  contratada: 'Contratada',
  em_execucao: 'Em execução',
  concluida_fisicamente: 'Concluída (física)',
  encerrada_financeiramente: 'Encerrada (financeiro)',
  cancelada: 'Cancelada',
};

export const MODELO_CONTRATACAO: Record<string, string> = {
  preco_fechado: 'Preço fechado (empreitada)',
  administracao: 'Administração',
  projeto: 'Projeto (honorários)',
  diaria: 'Diária',
  outro: 'Outro',
};

export const TIPOS_SERVICO = [
  'Projeto estrutural',
  'Reforço estrutural (concreto)',
  'Reforço estrutural (metálico)',
  'Reforma',
  'Construção',
  'Gestão de obra',
  'Acompanhamento técnico',
];

export type Obra = {
  id: string; codigo: string; nome: string; cliente_id: string | null; tipo_servico: string | null; endereco: string | null;
  status: StatusObra; data_inicio: string | null; data_previsao_fim: string | null; data_conclusao: string | null;
  observacoes: string | null; arquivado: boolean; criado_em: string;
  cliente?: { nome: string } | null;
};

export type ObraFinanceiro = { obra_id: string; modelo_contratacao: string | null; valor_contratado: Numeric; data_contratacao: string | null; observacoes: string | null };

export type Categoria = { id: string; nome: string; tipo: TipoConta; natureza: string; ativo: boolean; ordem: number };
export type ContaBancaria = { id: string; nome: string; instituicao: string | null; tipo: string; saldo_inicial: Numeric; data_saldo_inicial: string; ativa: boolean; ordem: number };
export type SaldoConta = { id: string; nome: string; instituicao: string | null; tipo: string; ativa: boolean; ordem: number; saldo_inicial: Numeric; saldo: Numeric };

export type Lancamento = {
  id: string; codigo: string; tipo: TipoConta; descricao: string; pessoa_id: string | null; categoria_id: string; escopo: Escopo;
  obra_id: string | null; servico_id: string | null; valor_total: Numeric; data_competencia: string; documento_ref: string | null;
  observacoes: string | null; cancelado: boolean; cancelado_motivo: string | null; criado_em: string;
};

export type Situacao = 'aberta' | 'parcial' | 'vencida' | 'liquidada' | 'cancelada';

export type VParcela = {
  id: string; lancamento_id: string; numero: number; valor: Numeric; vencimento: string; total_parcelas: number;
  codigo: string; tipo: TipoConta; descricao: string; pessoa_id: string | null; categoria_id: string; escopo: Escopo;
  obra_id: string | null; servico_id: string | null; data_competencia: string; cancelado: boolean; documento_ref: string | null;
  pessoa_nome: string | null; categoria_nome: string; categoria_natureza: string; obra_codigo: string | null; obra_nome: string | null;
  pago: Numeric; saldo: Numeric; situacao: Situacao; ultima_liquidacao: string | null;
};

export type VMovimento = {
  id: string; codigo: string; conta_bancaria_id: string; natureza: 'entrada' | 'saida'; valor: Numeric; data: string;
  parcela_id: string | null; transferencia_id: string | null; estorno_de: string | null; descricao: string | null; criado_em: string;
  conta_nome: string; valor_assinado: Numeric; lancamento_id: string | null; lancamento_codigo: string | null;
  lancamento_descricao: string | null; escopo: Escopo | null; obra_id: string | null; categoria_natureza: string; categoria_nome: string;
  estornado: boolean;
};

export type Arquivo = { id: string; caminho: string; nome_original: string; mime: string | null; tamanho: number | null; natureza: string; lancamento_id: string | null; movimento_id: string | null; criado_em: string };

export const SITUACAO: Record<Situacao, { rotulo: string; classe: string }> = {
  aberta: { rotulo: 'Em aberto', classe: 'neutro' },
  parcial: { rotulo: 'Parcial', classe: 'alerta' },
  vencida: { rotulo: 'Vencida', classe: 'erro' },
  liquidada: { rotulo: 'Liquidada', classe: 'ok' },
  cancelada: { rotulo: 'Cancelada', classe: 'neutro' },
};

// ---- Comercial (Etapa 2) ----
export type EstadoFunil = { id: string; nome: string; ordem: number; tipo: 'aberto' | 'ganho' | 'perdido' | 'arquivado'; ativo: boolean };
export type Origem = 'indicacao' | 'site' | 'instagram' | 'whatsapp' | 'telefone' | 'outro';
export const ORIGEM: Record<Origem, string> = {
  indicacao: 'Indicação', site: 'Site', instagram: 'Instagram', whatsapp: 'WhatsApp', telefone: 'Telefone', outro: 'Outro',
};
export type Oportunidade = {
  id: string; codigo: string; pessoa_id: string; titulo: string; origem: Origem; indicado_por: string | null; campanha: string | null;
  utm: Record<string, string> | null; tipo_servico: string | null; local_obra: string | null; resumo: string | null; estado_id: string;
  estado_desde: string; proxima_acao: string | null; proxima_acao_data: string | null; motivo_perda: string | null;
  valor_estimado: Numeric | null; arquivado: boolean; criado_em: string; atualizado_em: string;
  pessoa?: { nome: string; telefone: string | null; email: string | null } | null;
};
export type Interacao = { id: string; oportunidade_id: string; tipo: string; texto: string; em: string; criado_por: string | null };
export const TIPO_INTERACAO: Record<string, string> = {
  nota: 'Nota', ligacao: 'Ligação', whatsapp: 'WhatsApp', email: 'E-mail', visita: 'Visita', reuniao: 'Reunião', site: 'Site', sistema: 'Sistema',
};

export type EstadoProposta = 'rascunho' | 'enviada' | 'em_negociacao' | 'aprovada' | 'recusada' | 'arquivada';
export const ESTADO_PROPOSTA: Record<EstadoProposta, { rotulo: string; classe: string }> = {
  rascunho: { rotulo: 'Rascunho', classe: 'neutro' },
  enviada: { rotulo: 'Enviada', classe: 'alerta' },
  em_negociacao: { rotulo: 'Em negociação', classe: 'alerta' },
  aprovada: { rotulo: 'Aprovada', classe: 'ok' },
  recusada: { rotulo: 'Recusada', classe: 'erro' },
  arquivada: { rotulo: 'Arquivada', classe: 'neutro' },
};
export type Proposta = {
  id: string; codigo: string; tipo: 'proposta' | 'aditivo'; oportunidade_id: string | null; pessoa_id: string; obra_id: string | null;
  titulo: string; estado: EstadoProposta; versao_aprovada_id: string | null; aprovada_em: string | null; aprovada_por_nome: string | null;
  criado_em: string; atualizado_em: string;
  pessoa?: { nome: string; telefone: string | null; email: string | null } | null;
};
export type PropostaVersao = {
  id: string; proposta_id: string; numero: number; conteudo: unknown; valor_total: Numeric; emitida: boolean; emitida_em: string | null;
  hash: string | null; validade: string | null; criado_em: string;
};
export type PropostaEvento = {
  id: number; proposta_id: string; versao_id: string | null; tipo: string; nome: string | null; email: string | null; documento: string | null;
  comentario: string | null; canal: string | null; hash_versao: string | null; user_agent: string | null; em: string;
};
export const EVENTO_PROPOSTA: Record<string, string> = {
  emitida: 'Versão emitida', link_criado: 'Link criado', enviada_email: 'Preparada para e-mail', enviada_whatsapp: 'Preparada para WhatsApp',
  visualizada: 'Cliente abriu', aceita: 'Cliente aceitou', ajuste_pedido: 'Cliente pediu ajuste', recusada: 'Cliente recusou', link_revogado: 'Links revogados',
};
