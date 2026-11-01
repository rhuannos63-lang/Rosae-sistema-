// Tipos das tabelas usadas pelas telas (espelham supabase/migrations).
import type { EstadoEtapa } from '../core/cronograma';
import type { ConteudoContrato, ModeloContrato } from '../core/contrato';

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
  reserva_minima?: Numeric | null; pro_labore_planejado?: Numeric | null; horizonte_despesas_dias?: number;
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
  'Projeto arquitetônico',
  'Regularização de imóvel',
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
  proposta_versao_id?: string | null; liberada_em?: string | null; imagem_caminho?: string | null;
  cliente?: { nome: string } | null;
};

export type ObraFinanceiro = { obra_id: string; modelo_contratacao: string | null; valor_contratado: Numeric; data_contratacao: string | null; observacoes: string | null };

export type Categoria = { id: string; nome: string; tipo: TipoConta; natureza: string; ativo: boolean; ordem: number };
export type ContaBancaria = { id: string; nome: string; instituicao: string | null; tipo: string; saldo_inicial: Numeric; data_saldo_inicial: string; ativa: boolean; ordem: number };
export type SaldoConta = { id: string; nome: string; instituicao: string | null; tipo: string; ativa: boolean; ordem: number; saldo_inicial: Numeric; saldo: Numeric };

export type Lancamento = {
  id: string; codigo: string; tipo: TipoConta; descricao: string; pessoa_id: string | null; categoria_id: string; escopo: Escopo;
  obra_id: string | null; servico_id: string | null; valor_total: Numeric; data_competencia: string; documento_ref: string | null;
  observacoes: string | null; cancelado: boolean; cancelado_motivo: string | null; criado_em: string; contratacao_id?: string | null;
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

// ---------------------------------------------------------------------
// Etapa 4: operação
// ---------------------------------------------------------------------

export type Etapa = {
  id: string; obra_id: string; servico_id: string; nome: string; descricao: string | null; ordem: number; estado: EstadoEtapa;
  peso: Numeric; criterio_medicao: string | null; unidade: string | null; quantidade_prevista: Numeric | null; quantidade_executada: Numeric | null;
  percentual: Numeric; duracao_dias: number | null; inicio_previsto: string | null; fim_previsto: string | null;
  inicio_base: string | null; fim_base: string | null; inicio_real: string | null; fim_real: string | null;
  responsavel_id: string | null; depende_de: string[]; criterios: string[]; conferido_por: string | null; conferido_em: string | null;
  conferencia_obs: string | null; visivel_cliente: boolean;
};

export type Progresso = {
  executado: number; conferido: number; etapas: number; concluidas: number; canceladas: number;
  servicos: { id: string; nome: string; peso: number; executado: number; conferido: number; etapas: number; concluidas: number; canceladas: number }[];
  ambientes: { id: string; nome: string; executado: number }[];
};

export type SituacaoMaterial = 'a_comprar' | 'comprado_parcial' | 'comprado' | 'parcial' | 'na_obra' | 'aguardando_cliente' | 'aguardando_terceiro' | 'cancelado' | 'substituido';
export const SITUACAO_MATERIAL: Record<SituacaoMaterial, { rotulo: string; classe: string }> = {
  a_comprar: { rotulo: 'A comprar', classe: 'neutro' },
  comprado_parcial: { rotulo: 'Comprado em parte', classe: 'alerta' },
  comprado: { rotulo: 'Comprado · aguardando entrega', classe: 'alerta' },
  parcial: { rotulo: 'Entregue em parte', classe: 'alerta' },
  na_obra: { rotulo: 'Disponível na obra', classe: 'ok' },
  aguardando_cliente: { rotulo: 'Aguardando o cliente', classe: 'alerta' },
  aguardando_terceiro: { rotulo: 'Aguardando terceiro', classe: 'alerta' },
  cancelado: { rotulo: 'Cancelado', classe: 'neutro' },
  substituido: { rotulo: 'Substituído', classe: 'neutro' },
};
export const RESPONSAVEL_COMPRA: Record<string, string> = { rosae: 'ROSAE', cliente: 'Cliente', terceiro: 'Terceiro' };

export type Material = {
  id: string; obra_id: string; servico_id: string | null; ambiente_id: string | null; etapa_id: string | null; descricao: string; especificacao: string | null;
  unidade: string; quantidade: Numeric | null; responsavel_compra: 'rosae' | 'cliente' | 'terceiro'; fornecedor_id: string | null; necessario_em: string | null;
  estado: 'ativo' | 'cancelado' | 'substituido'; motivo: string | null; localizacao: string | null; observacoes: string | null; visivel_cliente: boolean;
  servico_nome: string | null; ambiente_nome: string | null; etapa_nome: string | null; etapa_inicio: string | null; fornecedor_nome: string | null;
  comprado: Numeric; entregue: Numeric; devolvido: Numeric; situacao: SituacaoMaterial;
};
export type MaterialEvento = { id: string; material_id: string; tipo: 'compra' | 'compra_cancelada' | 'entrega' | 'devolucao'; quantidade: Numeric; data: string; local: string | null; documento: string | null; lancamento_id: string | null; observacoes: string | null; criado_em: string };

export type TipoRegistro = 'andamento' | 'impedimento' | 'inspecao' | 'condicao_existente' | 'decisao' | 'nota_interna' | 'sistema';
export const TIPO_REGISTRO: Record<TipoRegistro, string> = {
  andamento: 'Andamento', impedimento: 'Impedimento', inspecao: 'Inspeção', condicao_existente: 'Condição existente',
  decisao: 'Decisão', nota_interna: 'Nota interna', sistema: 'Sistema',
};
export type Registro = {
  id: string; obra_id: string; data: string; tipo: TipoRegistro; servico_id: string | null; etapa_id: string | null; ambiente_id: string | null;
  titulo: string | null; texto: string | null; detalhes: Record<string, unknown>; publicado_em: string | null; autor_id: string | null; criado_em: string;
};
export type Foto = {
  id: string; obra_id: string; registro_id: string | null; servico_id: string | null; etapa_id: string | null; ambiente_id: string | null;
  caminho: string; legenda: string | null; momento: 'antes' | 'durante' | 'depois' | 'outro'; tirada_em: string; publicada_em: string | null;
};
export type Pendencia = {
  id: string; obra_id: string; tipo: 'pendencia' | 'decisao_cliente' | 'impedimento' | 'inspecao'; titulo: string; descricao: string | null;
  prioridade: 'alta' | 'media' | 'baixa'; responsavel: 'rosae' | 'cliente' | 'parceiro' | 'outro'; prazo: string | null;
  estado: 'aberta' | 'resolvida' | 'cancelada'; resolucao: string | null; resolvida_em: string | null; servico_id: string | null; etapa_id: string | null; criado_em: string; publicado_em?: string | null;
};
export const TIPO_PENDENCIA: Record<Pendencia['tipo'], string> = { pendencia: 'Pendência', decisao_cliente: 'Decisão do cliente', impedimento: 'Impedimento', inspecao: 'Inspeção' };
export const RESPONSAVEL_PENDENCIA: Record<Pendencia['responsavel'], string> = { rosae: 'ROSAE', cliente: 'Cliente', parceiro: 'Parceiro', outro: 'Outro' };

export type Contrato = {
  id: string; codigo: string; obra_id: string; proposta_versao_id: string | null; modelo: ModeloContrato; estado: 'rascunho' | 'emitido' | 'assinado' | 'cancelado';
  conteudo: ConteudoContrato; valor_total: Numeric; minuta: boolean; hash: string | null; emitido_em: string | null; assinado_em: string | null;
  assinatura_registro: string | null; cancelado_motivo: string | null; criado_em: string;
};

export type ConteudoFicha = {
  responsavel?: string; atividades: string[]; materiais: string[]; pre_requisitos: string[]; conferencia: string[]; referencias: string[];
  impedimentos?: string; observacoes?: string;
};
export type Ficha = {
  id: string; obra_id: string; servico_id: string; revisao: number; estado: 'rascunho' | 'liberada' | 'substituida'; origem: 'modelo' | 'manual' | 'ia';
  conteudo: ConteudoFicha; liberada_por_nome: string | null; liberada_em: string | null; criado_em: string;
};
