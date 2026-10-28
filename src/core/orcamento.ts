// Orçamento automático: o Rhuann escolhe o tipo de serviço, responde poucas perguntas
// e sai a proposta completa (escopo, pacotes, prazos, pagamento e textos de apresentação).
// Tudo aqui é cálculo puro e testável; os preços vêm da tabela editável (parâmetros).
import { ratear, type Centavos } from './dinheiro';
import {
  APRESENTACAO_PADRAO, conteudoVazio, novoId, parcelasPorPercentual,
  type Conteudo, type Etapa, type Item, type ModeloServico, type OpcaoProposta, type ParcelaProposta, type Pergunta as PerguntaFaq, type Responsabilidade, type Topico,
} from './proposta';

export type TipoServico = 'projeto_estrutural' | 'reforco' | 'reforma' | 'construcao' | 'laudo' | 'pericia';
export type Valor = string | number | boolean | null;
export type Respostas = Record<string, Valor>;
export type Parametros = Record<string, number>;

type Escolha = { valor: string; rotulo: string; descricao?: string };
export type Campo =
  | { id: string; rotulo: string; tipo: 'numero'; unidade?: string; min?: number; ajuda?: string; obrigatorio?: boolean; se?: (r: Respostas) => boolean }
  | { id: string; rotulo: string; tipo: 'escolha'; opcoes: Escolha[]; ajuda?: string; se?: (r: Respostas) => boolean }
  | { id: string; rotulo: string; tipo: 'sim_nao'; ajuda?: string; se?: (r: Respostas) => boolean }
  | { id: string; rotulo: string; tipo: 'texto'; placeholder?: string; ajuda?: string; se?: (r: Respostas) => boolean };

export type Parametro = { id: string; rotulo: string; unidade: string; padrao: number; custo?: boolean; ajuda?: string };

/** Uma linha de preço. pacote = a partir de qual pacote ela entra (1 Essencial, 2 Completo, 3 Premium). */
export type Linha = {
  titulo: string; descricao: string; valor: number; custo: number; pacote: 1 | 2 | 3;
  modelo?: string; quantidade?: number; unidade?: string; principal?: boolean;
};

type Base = {
  linhas: Linha[];
  visitas: [number, number, number]; // visitas ao local em cada pacote (para deslocamento)
  etapas: { nome: string; descricao: string; dias: number; percentual: number }[];
  dados: { rotulo: string; valor: string }[];
  resumo: string;
  titulo: string;
  inclusoes: string[];
  exclusoes: string[];
  responsabilidades: Responsabilidade[];
  entregaveis: string[];
  metodologia: Topico[];
  riscos: string[];
  normas: string[];
  faq: PerguntaFaq[];
  premissas: string[];
  garantia: string;
  diferencial: Topico;
  horas?: number;
  avisos: string[];
  pacotes: { nome: string; subtitulo: string; extras: string[] }[]; // 1 pacote = sem opções
  pagamento_padrao: FormaPagamento;
};

export type FormaPagamento = 'metade' | 'entrada_parcelas' | 'etapas' | 'mensal';

export type Definicao = {
  tipo: TipoServico;
  nome: string;
  chamada: string;
  campos: Campo[];
  parametros: Parametro[];
  padrao: Respostas;
  calcular: (r: Respostas, p: Parametros) => Base;
};

// ---------------------------------------------------------------------
// Ajudantes
// ---------------------------------------------------------------------
const n = (r: Respostas, id: string, padrao = 0): number => {
  const v = r[id];
  const x = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(x) && x >= 0 ? x : padrao;
};
const s = (r: Respostas, id: string, padrao = ''): string => (typeof r[id] === 'string' && r[id] ? (r[id] as string) : padrao);
const b = (r: Respostas, id: string): boolean => r[id] === true || r[id] === 'sim';
const q = (p: Parametros, id: string): number => (Number.isFinite(p[id]) ? p[id] : 0);
/** Arredonda para dezenas de reais (preço limpo na apresentação). */
export const arred10 = (v: number): number => Math.max(0, Math.round(v / 10) * 10);
const fmtN = (v: number, casas = 0) => v.toLocaleString('pt-BR', { maximumFractionDigits: casas });
const rotuloDe = (campos: Campo[], id: string, valor: string): string => {
  const c = campos.find((x) => x.id === id);
  return c && c.tipo === 'escolha' ? c.opcoes.find((o) => o.valor === valor)?.rotulo ?? valor : valor;
};
const sn = (v: boolean) => (v ? 'Sim' : 'Não');

/** Divide um total de dias pelas etapas conforme os pesos (mínimo 1 dia cada). */
function dividirDias(total: number, pesos: number[]): number[] {
  const t = Math.max(pesos.length, Math.round(total));
  return ratear(t, pesos.map((x) => Math.max(0.0001, x))).map((d) => Math.max(1, d));
}

// Perguntas comuns a todos os tipos.
const CAMPOS_COMUNS: Campo[] = [
  { id: 'distancia_km', rotulo: 'Distância até o local', tipo: 'numero', unidade: 'km (ida)', ajuda: 'Usada para calcular os deslocamentos das visitas. Deixe 0 se for perto.' },
  { id: 'urgencia', rotulo: 'Cliente precisa com urgência?', tipo: 'sim_nao', ajuda: 'Reduz o prazo em cerca de 25% e acrescenta a taxa de prioridade de agenda.' },
  {
    id: 'pagamento', rotulo: 'Forma de pagamento', tipo: 'escolha', opcoes: [
      { valor: 'metade', rotulo: '50% no aceite + 50% na entrega' },
      { valor: 'entrada_parcelas', rotulo: 'Entrada + parcelas mensais' },
      { valor: 'etapas', rotulo: 'Por etapa concluída' },
      { valor: 'mensal', rotulo: 'Mensalidades iguais' },
    ],
  },
  { id: 'parcelas', rotulo: 'Número de parcelas', tipo: 'numero', min: 1, se: (r) => r.pagamento === 'entrada_parcelas' || r.pagamento === 'mensal' },
];

const PARAMETROS_COMUNS: Parametro[] = [
  { id: 'km', rotulo: 'Deslocamento por km rodado', unidade: 'R$/km', padrao: 1.6 },
  { id: 'urgencia_pct', rotulo: 'Taxa de prioridade (urgência)', unidade: '%', padrao: 20 },
  { id: 'desconto_avista_pct', rotulo: 'Desconto para pagamento à vista', unidade: '%', padrao: 5, ajuda: 'Aparece na proposta como condição especial. 0 = não oferecer.' },
  { id: 'entrada_pct', rotulo: 'Entrada (quando houver parcelas)', unidade: '%', padrao: 30 },
  { id: 'validade_dias', rotulo: 'Validade da proposta', unidade: 'dias', padrao: 15 },
];

const RESP_CLIENTE_COMUM = ['Efetuar os pagamentos nas datas combinadas', 'Indicar uma pessoa para decisões e aprovações'];

const FAQ_COMUM: PerguntaFaq[] = [
  { pergunta: 'E se eu precisar mudar algo depois de aprovar?', resposta: 'Toda mudança é apresentada por escrito como aditivo, com valor e impacto no prazo. Nada é executado ou cobrado sem a sua aprovação.' },
  { pergunta: 'Como acompanho o andamento?', resposta: 'Você recebe acesso a um portal pelo celular com etapas, registros, fotos e documentos, além do contato direto com o engenheiro responsável.' },
];

// ---------------------------------------------------------------------
// 1. Projeto estrutural
// ---------------------------------------------------------------------
const projeto: Definicao = {
  tipo: 'projeto_estrutural',
  nome: 'Projeto estrutural',
  chamada: 'Cálculo e detalhamento da estrutura, cobrado por m² e complexidade.',
  campos: [
    { id: 'area', rotulo: 'Área construída', tipo: 'numero', unidade: 'm²', obrigatorio: true },
    { id: 'pavimentos', rotulo: 'Pavimentos', tipo: 'numero', min: 1 },
    {
      id: 'sistema', rotulo: 'Sistema estrutural', tipo: 'escolha', opcoes: [
        { valor: 'concreto', rotulo: 'Concreto armado' }, { valor: 'metalica', rotulo: 'Estrutura metálica' }, { valor: 'misto', rotulo: 'Misto (concreto + metálica)' },
      ],
    },
    {
      id: 'uso', rotulo: 'Uso da edificação', tipo: 'escolha', opcoes: [
        { valor: 'residencial', rotulo: 'Residencial unifamiliar' }, { valor: 'multifamiliar', rotulo: 'Residencial multifamiliar' },
        { valor: 'comercial', rotulo: 'Comercial' }, { valor: 'galpao', rotulo: 'Galpão / industrial' },
      ],
    },
    {
      id: 'complexidade', rotulo: 'Complexidade', tipo: 'escolha', opcoes: [
        { valor: 'baixa', rotulo: 'Baixa', descricao: 'Vãos usuais, sem balanços' },
        { valor: 'media', rotulo: 'Média', descricao: 'Alguns vãos maiores ou balanços' },
        { valor: 'alta', rotulo: 'Alta', descricao: 'Grandes vãos, transições, arquitetura recortada' },
      ],
    },
    { id: 'piscina', rotulo: 'Tem piscina?', tipo: 'sim_nao' },
    { id: 'contencao', rotulo: 'Tem subsolo ou muro de contenção?', tipo: 'sim_nao' },
    { id: 'sondagem', rotulo: 'Já existe sondagem do solo?', tipo: 'sim_nao' },
    { id: 'arquitetura_ok', rotulo: 'Arquitetura definitiva (DWG/IFC)?', tipo: 'sim_nao' },
  ],
  parametros: [
    { id: 'preco_m2', rotulo: 'Preço base por m² (concreto armado)', unidade: 'R$/m²', padrao: 24 },
    { id: 'minimo', rotulo: 'Valor mínimo do projeto', unidade: 'R$', padrao: 3500 },
    { id: 'fator_baixa', rotulo: 'Fator complexidade baixa', unidade: 'x', padrao: 1 },
    { id: 'fator_media', rotulo: 'Fator complexidade média', unidade: 'x', padrao: 1.25 },
    { id: 'fator_alta', rotulo: 'Fator complexidade alta', unidade: 'x', padrao: 1.6 },
    { id: 'fator_metalica', rotulo: 'Fator estrutura metálica', unidade: 'x', padrao: 1.15 },
    { id: 'fator_misto', rotulo: 'Fator sistema misto', unidade: 'x', padrao: 1.3 },
    { id: 'pav_extra_pct', rotulo: 'Acréscimo por pavimento acima de 2', unidade: '%', padrao: 5 },
    { id: 'piscina', rotulo: 'Estrutura da piscina', unidade: 'R$', padrao: 1800 },
    { id: 'contencao', rotulo: 'Contenções e subsolo', unidade: 'R$', padrao: 3500 },
    { id: 'compat_pct', rotulo: 'Compatibilização (pacote Completo)', unidade: '%', padrao: 12 },
    { id: 'bim_pct', rotulo: 'Modelo 3D/BIM (pacote Premium)', unidade: '%', padrao: 10 },
    { id: 'visita', rotulo: 'Visita técnica de obra', unidade: 'R$', padrao: 450 },
    { id: 'dias_base', rotulo: 'Prazo base', unidade: 'dias', padrao: 15 },
    { id: 'dias_100m2', rotulo: 'Prazo adicional a cada 100 m²', unidade: 'dias', padrao: 5 },
    { id: 'horas_m2', rotulo: 'Horas de trabalho por m²', unidade: 'h', padrao: 0.12, custo: true },
    { id: 'custo_hora', rotulo: 'Custo da sua hora (referência interna)', unidade: 'R$/h', padrao: 90, custo: true },
    { id: 'art', rotulo: 'Taxa da ART (conferir tabela CREA-RJ)', unidade: 'R$', padrao: 110, custo: true },
  ],
  padrao: { area: null, pavimentos: 2, sistema: 'concreto', uso: 'residencial', complexidade: 'media', piscina: false, contencao: false, sondagem: false, arquitetura_ok: true, pagamento: 'metade', parcelas: 3, distancia_km: 0, urgencia: false },
  calcular(r, p) {
    const area = n(r, 'area');
    const pav = Math.max(1, n(r, 'pavimentos', 1));
    const sistema = s(r, 'sistema', 'concreto');
    const comp = s(r, 'complexidade', 'media');
    const fComp = q(p, `fator_${comp}`) || 1;
    const fSis = sistema === 'metalica' ? q(p, 'fator_metalica') : sistema === 'misto' ? q(p, 'fator_misto') : 1;
    const fPav = 1 + (Math.max(0, pav - 2) * q(p, 'pav_extra_pct')) / 100;
    const bruto = area * q(p, 'preco_m2') * fComp * fSis * fPav;
    const base = arred10(Math.max(q(p, 'minimo'), bruto));
    const horas = Math.round(area * q(p, 'horas_m2') * fComp * fSis * fPav + 6);
    const sistemaTxt = { concreto: 'concreto armado', metalica: 'estrutura metálica', misto: 'concreto armado e estrutura metálica' }[sistema] ?? sistema;
    const linhas: Linha[] = [{
      titulo: 'Projeto estrutural executivo',
      descricao: `Concepção, cálculo e detalhamento da estrutura em ${sistemaTxt} para ${fmtN(area, 2)} m² em ${pav} pavimento(s): fundações, pilares, vigas, lajes e escadas, com plantas de forma, armação${sistema !== 'concreto' ? ' e ligações metálicas' : ''}, quantitativos de materiais e memorial.`,
      valor: base, custo: Math.round(horas * q(p, 'custo_hora') + q(p, 'art')), pacote: 1, principal: true,
      modelo: sistema === 'metalica' ? 'Projeto estrutural em estrutura metálica' : 'Projeto estrutural em concreto armado', quantidade: area, unidade: 'm2',
    }];
    if (b(r, 'piscina')) linhas.push({ titulo: 'Estrutura da piscina', descricao: 'Dimensionamento e detalhamento das paredes, fundo e apoios da piscina, compatibilizado com a estrutura da edificação.', valor: arred10(q(p, 'piscina')), custo: Math.round(8 * q(p, 'custo_hora')), pacote: 1 });
    if (b(r, 'contencao')) linhas.push({ titulo: 'Contenções e subsolo', descricao: 'Muros de arrimo, cortinas e lajes de subsolo, com verificação de empuxo e drenagem estrutural.', valor: arred10(q(p, 'contencao')), custo: Math.round(16 * q(p, 'custo_hora')), pacote: 1 });
    linhas.push(
      { titulo: 'Compatibilização com arquitetura e complementares', descricao: 'Sobreposição da estrutura com arquitetura, elétrica e hidráulica, com relatório de interferências resolvidas antes da obra e uma rodada extra de revisões.', valor: arred10(base * q(p, 'compat_pct') / 100), custo: Math.round(horas * 0.15 * q(p, 'custo_hora')), pacote: 2 },
      { titulo: 'Acompanhamento técnico nas etapas críticas (2 visitas)', descricao: 'Visitas na armação das fundações e da primeira laje, para conferir a execução conforme o projeto antes da concretagem.', valor: arred10(2 * q(p, 'visita')), custo: Math.round(2 * 3 * q(p, 'custo_hora')), pacote: 2, quantidade: 2, unidade: 'visita' },
      { titulo: 'Modelo 3D (BIM) da estrutura', descricao: 'Entrega do modelo tridimensional em IFC para coordenação com os demais projetos e visualização da estrutura.', valor: arred10(base * q(p, 'bim_pct') / 100), custo: Math.round(horas * 0.12 * q(p, 'custo_hora')), pacote: 3 },
      { titulo: 'Acompanhamento ampliado (+4 visitas, total de 6)', descricao: 'Visitas adicionais em pilares, lajes superiores e cobertura, com relatório fotográfico de cada visita.', valor: arred10(4 * q(p, 'visita')), custo: Math.round(4 * 3 * q(p, 'custo_hora')), pacote: 3, quantidade: 4, unidade: 'visita' },
    );
    const dias = q(p, 'dias_base') + (area / 100) * q(p, 'dias_100m2') * fComp;
    const [d1, d2, d3] = dividirDias(dias, [30, 40, 30]);
    const avisos: string[] = [];
    if (!area) avisos.push('Informe a área construída para calcular o preço.');
    if (area > 2000) avisos.push('Área acima de 2.000 m²: confira se o preço por m² não deveria ser menor para esse porte.');
    if (!b(r, 'sondagem')) avisos.push('Sem sondagem: a fundação fica com premissa. Indique o laboratório ao cliente.');
    if (!b(r, 'arquitetura_ok')) avisos.push('Arquitetura ainda em desenvolvimento: risco de retrabalho. Mantenha a premissa de congelamento.');
    if (bruto < q(p, 'minimo')) avisos.push(`O cálculo por m² ficou abaixo do mínimo; foi aplicado o valor mínimo de R$ ${fmtN(q(p, 'minimo'))}.`);
    return {
      linhas, visitas: [0, 2, 6], horas, avisos,
      titulo: `Projeto estrutural · ${fmtN(area)} m²`,
      etapas: [
        { nome: 'Estudo e concepção', descricao: 'Análise da arquitetura, lançamento da estrutura e definição das soluções', dias: d1, percentual: 30 },
        { nome: 'Cálculo e dimensionamento', descricao: 'Modelagem, cargas, verificações e dimensionamento de todos os elementos', dias: d2, percentual: 40 },
        { nome: 'Detalhamento e entrega', descricao: 'Pranchas, quantitativos, memorial, ART e reunião de entrega', dias: d3, percentual: 30 },
      ],
      dados: [
        { rotulo: 'Área construída', valor: `${fmtN(area, 2)} m²` }, { rotulo: 'Pavimentos', valor: String(pav) },
        { rotulo: 'Sistema estrutural', valor: rotuloDe(projeto.campos, 'sistema', sistema) }, { rotulo: 'Uso', valor: rotuloDe(projeto.campos, 'uso', s(r, 'uso', 'residencial')) },
        { rotulo: 'Complexidade', valor: rotuloDe(projeto.campos, 'complexidade', comp) }, { rotulo: 'Piscina', valor: sn(b(r, 'piscina')) },
        { rotulo: 'Subsolo / contenções', valor: sn(b(r, 'contencao')) }, { rotulo: 'Sondagem disponível', valor: sn(b(r, 'sondagem')) },
      ],
      resumo: `Você vai receber o projeto estrutural completo da sua edificação de ${fmtN(area)} m², pronto para orçar e executar: cada pilar, viga, laje e fundação calculado e detalhado, com a lista de aço e concreto e a responsabilidade técnica (ART) do engenheiro. Um projeto bem resolvido evita improviso no canteiro, compras erradas de material e retrabalho.`,
      inclusoes: ['Lançamento estrutural sobre a arquitetura', 'Cálculo e dimensionamento de fundações, pilares, vigas, lajes e escadas', 'Plantas de forma de todos os pavimentos', `Detalhamento de armaduras${sistema !== 'concreto' ? ' e ligações metálicas' : ''}`, 'Quantitativos de aço, concreto e formas', 'Memorial descritivo', 'ART de projeto', 'Uma rodada de ajustes por compatibilização com a arquitetura', 'Esclarecimento de dúvidas da obra sobre o projeto'],
      exclusoes: ['Projeto de arquitetura e projetos de instalações', ...(b(r, 'sondagem') ? [] : ['Sondagem do solo (indicamos laboratórios de confiança)']), 'Taxas de prefeitura e aprovações', 'Alterações de arquitetura depois de iniciado o cálculo (orçadas como aditivo)', 'Execução da obra e compra de materiais'],
      responsabilidades: [
        { parte: 'ROSAE', itens: ['Elaborar o projeto conforme as normas técnicas vigentes', 'Emitir a ART do projeto', 'Cumprir os prazos de cada etapa', 'Esclarecer dúvidas da obra sobre o projeto'] },
        { parte: 'Cliente', itens: ['Fornecer a arquitetura definitiva em DWG ou IFC', b(r, 'sondagem') ? 'Fornecer o relatório de sondagem' : 'Contratar a sondagem indicada pela ROSAE', 'Avisar qualquer mudança na arquitetura antes do início do cálculo', ...RESP_CLIENTE_COMUM] },
      ],
      entregaveis: ['Pranchas de forma e armação em PDF e DWG', 'Quantitativos de aço, concreto e formas', 'Memorial descritivo e de cálculo resumido', 'ART de projeto registrada no CREA-RJ'],
      metodologia: [
        { titulo: 'Reunião de partida', texto: 'Entendemos a arquitetura, o uso e as prioridades (custo, prazo, vãos livres).' },
        { titulo: 'Concepção', texto: 'Definimos o sistema estrutural mais eficiente e validamos com você as interferências.' },
        { titulo: 'Cálculo', texto: 'Modelagem e verificação de todos os elementos conforme as normas ABNT.' },
        { titulo: 'Detalhamento', texto: 'Pranchas claras para a obra executar sem dúvidas, com quantitativos.' },
        { titulo: 'Entrega e suporte', texto: 'Apresentamos o projeto e seguimos disponíveis para dúvidas da obra.' },
      ],
      riscos: ['Obras sem projeto estrutural costumam consumir aço e concreto além do necessário, ou abaixo do seguro.', 'Fissuras, flechas excessivas e recalques são muito mais caros de corrigir depois de construído.', 'Sem projeto e ART, a obra fica exposta em aprovações, financiamentos, seguros e numa futura venda do imóvel.'],
      normas: ['ABNT NBR 6118 · Projeto de estruturas de concreto', 'ABNT NBR 6120 · Ações para o cálculo de estruturas', 'ABNT NBR 6122 · Projeto e execução de fundações', 'ABNT NBR 6123 · Forças devidas ao vento', 'ABNT NBR 8681 · Ações e segurança nas estruturas', ...(sistema !== 'concreto' ? ['ABNT NBR 8800 · Estruturas de aço'] : [])],
      faq: [
        { pergunta: 'O preço muda se a arquitetura mudar?', resposta: 'Ajustes pequenos de compatibilização estão incluídos. Mudanças de layout depois do início do cálculo são orçadas antes, como aditivo.' },
        { pergunta: 'Preciso mesmo de sondagem?', resposta: 'Sim. É ela que mostra a resistência do solo e define a fundação. Sem sondagem, a fundação é dimensionada por premissa e pode precisar de revisão.' },
        { pergunta: 'O projeto serve para orçar a obra?', resposta: 'Sim. Os quantitativos de aço, concreto e formas permitem cotar materiais e mão de obra com precisão.' },
        ...FAQ_COMUM,
      ],
      premissas: ['Arquitetura definitiva fornecida pelo cliente antes do início do cálculo', b(r, 'sondagem') ? 'Sondagem fornecida pelo cliente, compatível com o porte da obra' : 'Fundação dimensionada após o recebimento da sondagem', 'Cargas de uso usuais para o tipo de edificação informado'],
      garantia: 'A ROSAE responde tecnicamente pelo projeto (ART) e corrige, sem custo, qualquer inconsistência de projeto identificada durante a execução.',
      diferencial: { titulo: 'Projeto pensado para a obra', texto: 'Soluções que equilibram segurança e economia de material, com pranchas fáceis de executar.' },
      pacotes: [
        { nome: 'Essencial', subtitulo: 'Projeto completo com ART', extras: [] },
        { nome: 'Completo', subtitulo: 'Projeto compatibilizado e conferido na obra', extras: ['Uma rodada extra de revisões'] },
        { nome: 'Premium', subtitulo: 'Projeto em 3D com acompanhamento ampliado', extras: ['Prioridade de atendimento durante a obra'] },
      ],
      pagamento_padrao: 'metade',
    };
  },
};

// ---------------------------------------------------------------------
// 2. Reforço estrutural
// ---------------------------------------------------------------------
const TECNICAS: Record<string, { rotulo: string; texto: string }> = {
  encamisamento: { rotulo: 'Encamisamento em concreto', texto: 'aumento de seção com nova armadura e concreto/graute' },
  metalico: { rotulo: 'Perfis e chapas metálicas', texto: 'reforço com perfis e chapas de aço ancorados à estrutura' },
  fibra: { rotulo: 'Fibra de carbono', texto: 'colagem de mantas ou laminados de fibra de carbono' },
  recuperacao: { rotulo: 'Recuperação e tratamento de corrosão', texto: 'remoção do concreto degradado, tratamento das armaduras e reconstituição' },
  definir: { rotulo: 'A definir no diagnóstico', texto: 'técnica definida após o diagnóstico' },
};
const reforco: Definicao = {
  tipo: 'reforco',
  nome: 'Reforço estrutural',
  chamada: 'Diagnóstico, projeto e/ou execução de reforço em concreto ou aço.',
  campos: [
    {
      id: 'escopo', rotulo: 'O que será contratado', tipo: 'escolha', opcoes: [
        { valor: 'projeto', rotulo: 'Só o projeto de reforço' }, { valor: 'projeto_execucao', rotulo: 'Projeto + execução' }, { valor: 'execucao', rotulo: 'Só a execução (já tem projeto)' },
      ],
    },
    { id: 'material', rotulo: 'Estrutura existente', tipo: 'escolha', opcoes: [{ valor: 'concreto', rotulo: 'Concreto armado' }, { valor: 'metalica', rotulo: 'Metálica' }, { valor: 'alvenaria', rotulo: 'Alvenaria' }] },
    { id: 'tecnica', rotulo: 'Técnica provável', tipo: 'escolha', opcoes: Object.entries(TECNICAS).map(([valor, t]) => ({ valor, rotulo: t.rotulo })) },
    { id: 'elementos', rotulo: 'Elementos a reforçar (pilares, vigas, lajes)', tipo: 'numero', unidade: 'un', min: 1, obrigatorio: true },
    {
      id: 'gravidade', rotulo: 'Extensão do problema', tipo: 'escolha', opcoes: [
        { valor: 'pontual', rotulo: 'Pontual', descricao: 'Poucos elementos, acesso fácil' }, { valor: 'moderada', rotulo: 'Moderada', descricao: 'Vários elementos ou aumento de carga' }, { valor: 'extensa', rotulo: 'Extensa', descricao: 'Reforço global ou escoramento complexo' },
      ],
    },
    { id: 'laudo', rotulo: 'Já existe laudo ou diagnóstico?', tipo: 'sim_nao' },
    { id: 'escoramento', rotulo: 'Vai precisar de escoramento?', tipo: 'sim_nao' },
    { id: 'ocupado', rotulo: 'Imóvel em uso durante o serviço?', tipo: 'sim_nao' },
  ],
  parametros: [
    { id: 'diagnostico', rotulo: 'Diagnóstico inicial (vistoria e levantamento)', unidade: 'R$', padrao: 1500 },
    { id: 'projeto_base', rotulo: 'Projeto de reforço: valor base', unidade: 'R$', padrao: 2800 },
    { id: 'projeto_elemento', rotulo: 'Projeto de reforço: por elemento', unidade: 'R$', padrao: 450 },
    { id: 'fator_pontual', rotulo: 'Fator extensão pontual', unidade: 'x', padrao: 1 },
    { id: 'fator_moderada', rotulo: 'Fator extensão moderada', unidade: 'x', padrao: 1.4 },
    { id: 'fator_extensa', rotulo: 'Fator extensão extensa', unidade: 'x', padrao: 2 },
    { id: 'custo_encamisamento', rotulo: 'Custo de execução por elemento: encamisamento', unidade: 'R$', padrao: 3000, custo: true },
    { id: 'custo_metalico', rotulo: 'Custo de execução por elemento: metálico', unidade: 'R$', padrao: 3400, custo: true },
    { id: 'custo_fibra', rotulo: 'Custo de execução por elemento: fibra de carbono', unidade: 'R$', padrao: 4200, custo: true },
    { id: 'custo_recuperacao', rotulo: 'Custo de execução por elemento: recuperação', unidade: 'R$', padrao: 1400, custo: true },
    { id: 'custo_definir', rotulo: 'Custo de execução por elemento: a definir', unidade: 'R$', padrao: 2800, custo: true },
    { id: 'custo_escoramento', rotulo: 'Custo do escoramento (verba)', unidade: 'R$', padrao: 2000, custo: true },
    { id: 'custo_mobilizacao', rotulo: 'Custo de mobilização e proteção', unidade: 'R$', padrao: 1200, custo: true },
    { id: 'bdi', rotulo: 'BDI sobre o custo de execução', unidade: '%', padrao: 30, ajuda: 'Margem, administração, impostos e riscos sobre o custo direto.' },
    { id: 'ocupado_pct', rotulo: 'Acréscimo por imóvel ocupado', unidade: '%', padrao: 10 },
    { id: 'ensaios', rotulo: 'Ensaios não destrutivos (pacometria, esclerometria)', unidade: 'R$', padrao: 1800 },
    { id: 'monitoramento', rotulo: 'Monitoramento pós-reforço (90 dias)', unidade: 'R$', padrao: 1200 },
    { id: 'visita', rotulo: 'Visita técnica', unidade: 'R$', padrao: 450 },
    { id: 'custo_hora', rotulo: 'Custo da sua hora (referência interna)', unidade: 'R$/h', padrao: 90, custo: true },
  ],
  padrao: { escopo: 'projeto_execucao', material: 'concreto', tecnica: 'definir', elementos: 4, gravidade: 'moderada', laudo: false, escoramento: true, ocupado: true, pagamento: 'etapas', parcelas: 3, distancia_km: 0, urgencia: false },
  calcular(r, p) {
    const esc = s(r, 'escopo', 'projeto_execucao');
    const tec = s(r, 'tecnica', 'definir');
    const el = Math.max(1, Math.round(n(r, 'elementos', 1)));
    const grav = s(r, 'gravidade', 'moderada');
    const f = q(p, `fator_${grav}`) || 1;
    const ocup = b(r, 'ocupado') ? 1 + q(p, 'ocupado_pct') / 100 : 1;
    const bdi = 1 + q(p, 'bdi') / 100;
    const temProjeto = esc !== 'execucao';
    const temExec = esc !== 'projeto';
    const linhas: Linha[] = [];
    let horas = 0;
    if (!b(r, 'laudo') && temProjeto) {
      linhas.push({ titulo: 'Diagnóstico estrutural inicial', descricao: 'Vistoria, levantamento dos elementos afetados, registro fotográfico e identificação das causas antes de definir a solução.', valor: arred10(q(p, 'diagnostico')), custo: Math.round(10 * q(p, 'custo_hora')), pacote: 1 });
      horas += 10;
    }
    if (temProjeto) {
      const hp = Math.round((12 + el * 3) * f);
      horas += hp;
      linhas.push({
        titulo: 'Projeto de reforço estrutural', principal: !temExec,
        descricao: `Verificação da capacidade atual e solução de reforço (${TECNICAS[tec]?.texto ?? 'técnica a definir'}) para ${el} elemento(s), com detalhes executivos, procedimento de escoramento e execução, especificação de materiais e ART.`,
        valor: arred10((q(p, 'projeto_base') + el * q(p, 'projeto_elemento')) * f), custo: Math.round(hp * q(p, 'custo_hora')), pacote: 1,
        modelo: 'Projeto de reforço estrutural',
      });
    }
    if (temExec) {
      const custoEl = q(p, `custo_${tec}`) || q(p, 'custo_definir');
      const custoExec = el * custoEl * f * ocup;
      linhas.push({
        titulo: 'Execução do reforço estrutural', principal: true,
        descricao: `Execução em ${el} elemento(s) por ${TECNICAS[tec]?.texto ?? 'técnica definida em projeto'}, com equipe especializada, materiais estruturais especificados, controle de qualidade e responsabilidade técnica de execução.`,
        valor: arred10(custoExec * bdi), custo: Math.round(custoExec), pacote: 1, modelo: 'Execução de reforço estrutural', quantidade: el, unidade: 'un',
      });
      const mob = q(p, 'custo_mobilizacao') + (b(r, 'escoramento') ? q(p, 'custo_escoramento') : 0);
      linhas.push({ titulo: b(r, 'escoramento') ? 'Mobilização, proteção e escoramento' : 'Mobilização e proteção', descricao: `Proteção dos ambientes, isolamento da área${b(r, 'escoramento') ? ', escoramento provisório dimensionado' : ''} e desmobilização com limpeza.`, valor: arred10(mob * bdi * ocup), custo: Math.round(mob * ocup), pacote: 1 });
    }
    linhas.push({ titulo: 'Ensaios não destrutivos', descricao: 'Pacometria (posição e cobrimento das armaduras) e esclerometria (resistência superficial do concreto) para confirmar a solução com dados reais.', valor: arred10(q(p, 'ensaios')), custo: Math.round(q(p, 'ensaios') * 0.7), pacote: 2 });
    if (temExec) linhas.push({ titulo: 'Relatório de execução (as built)', descricao: 'Registro fotográfico de cada etapa do reforço e documento final do que foi executado, para o histórico do imóvel.', valor: arred10(q(p, 'visita') * 1.5), custo: Math.round(5 * q(p, 'custo_hora')), pacote: 2 });
    linhas.push({ titulo: 'Monitoramento pós-reforço (90 dias)', descricao: 'Instalação de testemunhos de fissura e duas revistorias para comprovar a estabilização da estrutura.', valor: arred10(q(p, 'monitoramento')), custo: Math.round(q(p, 'monitoramento') * 0.45), pacote: 3 });
    const visitasExec = temExec ? Math.ceil(el / 2) + 2 : 1;
    const dProj = temProjeto ? Math.round((10 + el * 2) * f) : 0;
    const dExec = temExec ? Math.round((7 + el * 3) * f) : 0;
    const etapas = [
      ...(temProjeto ? [{ nome: 'Diagnóstico e levantamento', descricao: 'Vistoria, medições e causas', dias: Math.max(3, Math.round(dProj * 0.3)), percentual: temExec ? 10 : 30 }, { nome: 'Projeto de reforço', descricao: 'Verificação, solução, detalhes e ART', dias: Math.max(4, Math.round(dProj * 0.7)), percentual: temExec ? 20 : 70 }] : []),
      ...(temExec ? [{ nome: 'Mobilização e escoramento', descricao: 'Proteções, isolamento e escoramento', dias: Math.max(2, Math.round(dExec * 0.2)), percentual: temProjeto ? 20 : 25 }, { nome: 'Execução do reforço', descricao: 'Serviços de reforço com conferência por elemento', dias: Math.max(3, Math.round(dExec * 0.65)), percentual: temProjeto ? 40 : 55 }, { nome: 'Conclusão e entrega', descricao: 'Desmobilização, limpeza e vistoria final', dias: Math.max(1, Math.round(dExec * 0.15)), percentual: temProjeto ? 10 : 20 }] : []),
    ];
    const avisos: string[] = [];
    if (tec === 'definir' && temExec) avisos.push('Técnica "a definir": o preço de execução é uma estimativa. Deixe claro na premissa e revise após o diagnóstico.');
    if (esc === 'execucao' && !b(r, 'laudo')) avisos.push('Execução sem projeto ou laudo: confirme que existe projeto de reforço com ART antes de emitir.');
    return {
      linhas, visitas: [visitasExec, visitasExec + 1, visitasExec + 3], horas: horas || undefined, avisos,
      titulo: `Reforço estrutural · ${el} elemento(s)`,
      etapas,
      dados: [
        { rotulo: 'Contratação', valor: rotuloDe(reforco.campos, 'escopo', esc) }, { rotulo: 'Estrutura existente', valor: rotuloDe(reforco.campos, 'material', s(r, 'material', 'concreto')) },
        { rotulo: 'Técnica provável', valor: TECNICAS[tec]?.rotulo ?? tec }, { rotulo: 'Elementos', valor: String(el) },
        { rotulo: 'Extensão', valor: rotuloDe(reforco.campos, 'gravidade', grav) }, { rotulo: 'Escoramento', valor: sn(b(r, 'escoramento')) },
        { rotulo: 'Imóvel em uso', valor: sn(b(r, 'ocupado')) },
      ],
      resumo: `Vamos devolver segurança à sua estrutura: ${temProjeto ? 'identificar a causa do problema, projetar a solução certa' : 'executar o reforço conforme o projeto'}${temExec ? ' e executar o reforço com equipe especializada' : ''}, com responsabilidade técnica do engenheiro em cada etapa. Agir agora impede que o dano avance e que a correção fique mais cara e mais invasiva.`,
      inclusoes: [
        ...(temProjeto ? ['Levantamento dos elementos afetados', 'Verificação da capacidade atual', 'Solução de reforço com detalhes executivos', 'Procedimento de execução e escoramento', 'Especificação de materiais', 'ART de projeto'] : []),
        ...(temExec ? ['Mobilização de equipe e equipamentos', 'Materiais estruturais especificados (graute, aço, resinas, conforme a técnica)', 'Execução conforme projeto com conferência por elemento', 'Limpeza da área de trabalho', 'ART de execução'] : []),
      ],
      exclusoes: ['Ensaios destrutivos e extração de testemunhos (orçados se necessários)', ...(temExec ? ['Acabamentos finais (pintura, revestimentos), salvo se listados', 'Remoção de móveis e objetos'] : ['Execução do reforço (pode ser contratada na sequência)']), 'Taxas e licenças'],
      responsabilidades: [
        { parte: 'ROSAE', itens: ['Responder tecnicamente pela solução e pela execução (ART)', 'Comunicar imediatamente qualquer risco identificado', 'Manter a área sinalizada e segura'] },
        { parte: 'Cliente', itens: ['Liberar o acesso e os horários de trabalho', 'Respeitar as restrições de uso indicadas até a conclusão', 'Fornecer ponto de água e energia', ...RESP_CLIENTE_COMUM] },
        ...(temExec ? [{ parte: 'Parceiro', itens: ['Executar os serviços conforme o procedimento', 'Cumprir normas de segurança do trabalho'] }] : []),
      ],
      entregaveis: [...(temProjeto ? ['Relatório de diagnóstico com fotos', 'Projeto de reforço com detalhes e procedimento', 'ART de projeto'] : []), ...(temExec ? ['Reforço executado e conferido', 'ART de execução'] : [])],
      metodologia: [
        { titulo: 'Diagnóstico', texto: 'Entendemos a causa antes de propor a solução: reforço sem diagnóstico trata o sintoma.' },
        { titulo: 'Solução', texto: 'Escolhemos a técnica pelo melhor equilíbrio entre segurança, custo e interferência no imóvel.' },
        { titulo: 'Execução controlada', texto: 'Escoramento, sequência executiva e conferência elemento por elemento.' },
        { titulo: 'Entrega documentada', texto: 'Registro de tudo o que foi feito, para o histórico e a valorização do imóvel.' },
      ],
      riscos: ['Fissuras e corrosão em elementos estruturais tendem a progredir: o reparo fica maior a cada mês.', 'A perda de seção do aço reduz a capacidade da peça sem aviso visível.', 'Intervenções sem projeto podem transferir carga para onde a estrutura não suporta.'],
      normas: ['ABNT NBR 6118 · Projeto de estruturas de concreto', 'ABNT NBR 15575 · Desempenho de edificações', ...(s(r, 'material') === 'metalica' || tec === 'metalico' ? ['ABNT NBR 8800 · Estruturas de aço'] : [])],
      faq: [
        { pergunta: 'Vou precisar sair do imóvel?', resposta: 'Na maioria dos casos, não. Isolamos a área de trabalho e indicamos as restrições de uso de cada etapa.' },
        { pergunta: 'E se o diagnóstico mostrar algo diferente?', resposta: 'Apresentamos a nova situação por escrito, com a solução e o impacto no valor, antes de executar qualquer coisa além do combinado.' },
        ...FAQ_COMUM,
      ],
      premissas: ['Elementos acessíveis para inspeção e execução', tec === 'definir' ? 'Técnica e quantidades confirmadas após o diagnóstico' : `Técnica prevista: ${TECNICAS[tec]?.rotulo}`, 'Horário de trabalho em dias úteis, salvo combinação diferente'],
      garantia: temExec ? 'Garantia de 5 anos pela solidez e segurança do reforço executado, conforme o art. 618 do Código Civil, e de 12 meses para os demais serviços.' : 'A ROSAE responde tecnicamente pelo projeto (ART) e orienta a equipe de execução sobre o procedimento.',
      diferencial: { titulo: 'Diagnóstico antes da solução', texto: 'Tratamos a causa, não só o sintoma, para o problema não voltar.' },
      pacotes: [
        { nome: 'Essencial', subtitulo: 'A solução técnica necessária', extras: [] },
        { nome: 'Completo', subtitulo: 'Solução confirmada por ensaios e documentada', extras: [] },
        { nome: 'Premium', subtitulo: 'Com monitoramento e comprovação da estabilização', extras: ['Prioridade de atendimento'] },
      ],
      pagamento_padrao: 'etapas',
    };
  },
};

// ---------------------------------------------------------------------
// 3. Reforma
// ---------------------------------------------------------------------
const reforma: Definicao = {
  tipo: 'reforma',
  nome: 'Reforma',
  chamada: 'Reforma com gestão completa, por m², intensidade e padrão de acabamento.',
  campos: [
    { id: 'area', rotulo: 'Área a reformar', tipo: 'numero', unidade: 'm²', obrigatorio: true },
    { id: 'ambientes', rotulo: 'Ambientes', tipo: 'texto', placeholder: 'Ex.: cozinha, 2 banheiros, sala' },
    {
      id: 'intensidade', rotulo: 'Intensidade', tipo: 'escolha', opcoes: [
        { valor: 'leve', rotulo: 'Leve', descricao: 'Pintura, acabamentos, pequenos reparos' },
        { valor: 'media', rotulo: 'Média', descricao: 'Troca de revestimentos e instalações' },
        { valor: 'pesada', rotulo: 'Pesada', descricao: 'Demolições, mudança de layout' },
      ],
    },
    { id: 'padrao', rotulo: 'Padrão de acabamento', tipo: 'escolha', opcoes: [{ valor: 'economico', rotulo: 'Econômico' }, { valor: 'medio', rotulo: 'Médio' }, { valor: 'alto', rotulo: 'Alto padrão' }] },
    { id: 'materiais', rotulo: 'Quem compra os materiais', tipo: 'escolha', opcoes: [{ valor: 'rosae', rotulo: 'ROSAE (com curadoria e cotação)' }, { valor: 'cliente', rotulo: 'Cliente' }] },
    { id: 'condominio', rotulo: 'Em condomínio?', tipo: 'sim_nao', ajuda: 'Inclui o plano de reforma da NBR 16280 com ART, exigido pelos condomínios.' },
    { id: 'estrutural', rotulo: 'Mexe em estrutura (paredes, vigas, lajes)?', tipo: 'sim_nao' },
    { id: 'ocupado', rotulo: 'Imóvel ocupado durante a obra?', tipo: 'sim_nao' },
  ],
  parametros: [
    { id: 'mo_leve', rotulo: 'Custo de mão de obra por m²: leve', unidade: 'R$/m²', padrao: 180, custo: true },
    { id: 'mo_media', rotulo: 'Custo de mão de obra por m²: média', unidade: 'R$/m²', padrao: 420, custo: true },
    { id: 'mo_pesada', rotulo: 'Custo de mão de obra por m²: pesada', unidade: 'R$/m²', padrao: 700, custo: true },
    { id: 'mat_economico', rotulo: 'Custo de material por m²: econômico', unidade: 'R$/m²', padrao: 260, custo: true },
    { id: 'mat_medio', rotulo: 'Custo de material por m²: médio', unidade: 'R$/m²', padrao: 480, custo: true },
    { id: 'mat_alto', rotulo: 'Custo de material por m²: alto', unidade: 'R$/m²', padrao: 900, custo: true },
    { id: 'mat_fator_leve', rotulo: 'Fração de material na reforma leve', unidade: 'x', padrao: 0.4 },
    { id: 'mat_fator_pesada', rotulo: 'Fração de material na reforma pesada', unidade: 'x', padrao: 1.3 },
    { id: 'bdi', rotulo: 'BDI sobre mão de obra', unidade: '%', padrao: 30 },
    { id: 'bdi_material', rotulo: 'Taxa de gestão sobre materiais', unidade: '%', padrao: 12 },
    { id: 'gestao_m2', rotulo: 'Gestão técnica e responsabilidade (por m²)', unidade: 'R$/m²', padrao: 45 },
    { id: 'plano_reforma', rotulo: 'Plano de reforma NBR 16280 + ART', unidade: 'R$', padrao: 1200 },
    { id: 'estrutural', rotulo: 'Avaliação e projeto de adequação estrutural', unidade: 'R$', padrao: 2500 },
    { id: 'ocupado_pct', rotulo: 'Acréscimo por imóvel ocupado', unidade: '%', padrao: 12 },
    { id: 'limpeza_m2', rotulo: 'Limpeza fina pós-obra', unidade: 'R$/m²', padrao: 14 },
    { id: 'projeto3d_m2', rotulo: 'Projeto executivo com 3D', unidade: 'R$/m²', padrao: 45 },
    { id: 'dias_base', rotulo: 'Prazo base', unidade: 'dias', padrao: 15 },
    { id: 'dias_m2', rotulo: 'Dias por m² (reforma média)', unidade: 'dias', padrao: 0.5 },
  ],
  padrao: { area: null, ambientes: '', intensidade: 'media', padrao: 'medio', materiais: 'rosae', condominio: true, estrutural: false, ocupado: false, pagamento: 'etapas', parcelas: 4, distancia_km: 0, urgencia: false },
  calcular(r, p) {
    const area = n(r, 'area');
    const int = s(r, 'intensidade', 'media');
    const pad = s(r, 'padrao', 'medio');
    const rosaeCompra = s(r, 'materiais', 'rosae') === 'rosae';
    const ocup = b(r, 'ocupado') ? 1 + q(p, 'ocupado_pct') / 100 : 1;
    const mo = area * q(p, `mo_${int}`) * ocup;
    const fMat = int === 'leve' ? q(p, 'mat_fator_leve') : int === 'pesada' ? q(p, 'mat_fator_pesada') : 1;
    const mat = area * q(p, `mat_${pad}`) * fMat;
    const amb = s(r, 'ambientes');
    const linhas: Linha[] = [
      { titulo: 'Execução da reforma (mão de obra especializada)', principal: true, descricao: `Serviços de ${rotuloDe(reforma.campos, 'intensidade', int).toLowerCase()} intensidade em ${fmtN(area, 2)} m²${amb ? ` (${amb})` : ''}: preparação, ${int === 'pesada' ? 'demolições, ' : ''}${int !== 'leve' ? 'instalações, revestimentos, ' : ''}acabamentos e pintura, com equipes parceiras coordenadas pela ROSAE.`, valor: arred10(mo * (1 + q(p, 'bdi') / 100)), custo: Math.round(mo), pacote: 1, modelo: 'Reforma', quantidade: area, unidade: 'm2' },
      { titulo: 'Gestão técnica e responsabilidade de execução', descricao: 'Planejamento, cronograma, compras, coordenação das equipes, conferência de qualidade por etapa e ART de execução.', valor: arred10(area * q(p, 'gestao_m2')), custo: 0, pacote: 1 },
    ];
    if (rosaeCompra) linhas.push({ titulo: `Materiais padrão ${rotuloDe(reforma.campos, 'padrao', pad).toLowerCase()}`, descricao: 'Materiais básicos e de acabamento especificados, cotados e comprados pela ROSAE, com entrega programada conforme o cronograma.', valor: arred10(mat * (1 + q(p, 'bdi_material') / 100)), custo: Math.round(mat), pacote: 1 });
    if (b(r, 'condominio')) linhas.push({ titulo: 'Plano de reforma (NBR 16280) com ART', descricao: 'Documento exigido pelo condomínio antes do início: descrição dos serviços, responsável técnico, horários e medidas de segurança.', valor: arred10(q(p, 'plano_reforma')), custo: 300, pacote: 1 });
    if (b(r, 'estrutural')) linhas.push({ titulo: 'Avaliação e projeto de adequação estrutural', descricao: 'Verificação das paredes, vigas ou lajes afetadas e projeto da solução antes de qualquer demolição.', valor: arred10(q(p, 'estrutural')), custo: 900, pacote: 1 });
    linhas.push(
      { titulo: 'Limpeza fina pós-obra', descricao: 'Limpeza completa para entrega pronta para morar: vidros, pisos, louças e remoção de resíduos.', valor: arred10(area * q(p, 'limpeza_m2')), custo: Math.round(area * q(p, 'limpeza_m2') * 0.7), pacote: 2 },
      { titulo: 'Projeto executivo da reforma com imagens 3D', descricao: 'Plantas de layout, paginação de pisos e revestimentos e imagens 3D para você aprovar antes de comprar.', valor: arred10(area * q(p, 'projeto3d_m2')), custo: Math.round(area * q(p, 'projeto3d_m2') * 0.5), pacote: 3 },
    );
    const fInt = int === 'leve' ? 0.5 : int === 'pesada' ? 1.5 : 1;
    const dias = q(p, 'dias_base') + area * q(p, 'dias_m2') * fInt;
    const pesos = int === 'leve' ? [10, 20, 60, 10] : [15, 35, 40, 10];
    const ds = dividirDias(dias, pesos);
    const avisos: string[] = [];
    if (!area) avisos.push('Informe a área a reformar para calcular o preço.');
    if (!rosaeCompra) avisos.push(`Cliente compra os materiais: estimativa informada a ele de R$ ${fmtN(arred10(mat))} para planejar.`);
    if (b(r, 'estrutural')) avisos.push('Há intervenção estrutural: o projeto de adequação precisa ser concluído antes das demolições.');
    const visitas = Math.max(2, Math.round(dias / 7) * 2);
    return {
      linhas, visitas: [visitas, visitas, visitas], avisos,
      titulo: `Reforma · ${fmtN(area)} m²${amb ? ` · ${amb}` : ''}`,
      etapas: [
        { nome: 'Preparação e proteções', descricao: int === 'pesada' ? 'Proteções, demolições e retirada de entulho' : 'Proteções e preparação das superfícies', dias: ds[0], percentual: pesos[0] },
        { nome: 'Infraestrutura', descricao: 'Instalações, regularizações e bases', dias: ds[1], percentual: pesos[1] },
        { nome: 'Acabamentos', descricao: 'Revestimentos, louças, metais e pintura', dias: ds[2], percentual: pesos[2] },
        { nome: 'Entrega', descricao: 'Limpeza, vistoria final com você e ajustes', dias: ds[3], percentual: pesos[3] },
      ],
      dados: [
        { rotulo: 'Área', valor: `${fmtN(area, 2)} m²` }, ...(amb ? [{ rotulo: 'Ambientes', valor: amb }] : []),
        { rotulo: 'Intensidade', valor: rotuloDe(reforma.campos, 'intensidade', int) }, { rotulo: 'Acabamento', valor: rotuloDe(reforma.campos, 'padrao', pad) },
        { rotulo: 'Materiais', valor: rosaeCompra ? 'Fornecidos pela ROSAE' : 'Comprados pelo cliente' }, { rotulo: 'Condomínio', valor: sn(b(r, 'condominio')) },
        { rotulo: 'Intervenção estrutural', valor: sn(b(r, 'estrutural')) }, { rotulo: 'Imóvel ocupado', valor: sn(b(r, 'ocupado')) },
      ],
      resumo: `Sua reforma com um único responsável do início ao fim: planejamento, equipes, ${rosaeCompra ? 'compra de materiais, ' : ''}qualidade conferida em cada etapa e prazo acompanhado por você pelo celular. Você aprova o que vai ser feito, acompanha a evolução e recebe o imóvel limpo, conferido e documentado.`,
      inclusoes: ['Planejamento e cronograma da obra', 'Coordenação de todas as equipes parceiras', 'Execução dos serviços descritos no escopo', ...(rosaeCompra ? ['Cotação, compra e logística de materiais'] : []), 'Conferência de qualidade ao fim de cada etapa', 'Limpeza grossa e retirada de entulho', 'Relatório fotográfico da evolução', 'ART de execução'],
      exclusoes: ['Móveis planejados, eletrodomésticos e decoração', ...(rosaeCompra ? [] : ['Materiais (comprados pelo cliente, com nossa lista e orientação)']), 'Serviços não listados no escopo (orçados como aditivo)', 'Taxas de condomínio e de prefeitura'],
      responsabilidades: [
        { parte: 'ROSAE', itens: ['Planejar, coordenar e responder tecnicamente pela obra', 'Garantir a qualidade e corrigir o que não estiver conforme', 'Informar o andamento com registros e fotos'] },
        { parte: 'Cliente', itens: ['Aprovar acabamentos dentro do prazo do cronograma', 'Liberar o acesso ao imóvel e às áreas comuns', ...(rosaeCompra ? [] : ['Comprar os materiais nas datas da lista de compras']), ...RESP_CLIENTE_COMUM] },
        { parte: 'Parceiro', itens: ['Executar os serviços com qualidade e segurança', 'Cumprir os prazos e as regras do condomínio'] },
      ],
      entregaveis: ['Cronograma da obra', ...(rosaeCompra ? [] : ['Lista de compras com quantidades e datas']), 'Relatórios fotográficos de evolução', 'Termo de entrega com vistoria final', 'ART de execução'],
      metodologia: [
        { titulo: 'Levantamento', texto: 'Medimos e registramos o imóvel antes de começar.' },
        { titulo: 'Planejamento', texto: 'Cronograma, lista de materiais e sequência das equipes, sem tempo morto.' },
        { titulo: 'Execução', texto: 'Equipes coordenadas, com conferência de qualidade a cada etapa.' },
        { titulo: 'Acompanhamento', texto: 'Fotos e andamento no portal; decisões registradas por escrito.' },
        { titulo: 'Entrega', texto: 'Vistoria final com você e ajuste de qualquer pendência.' },
      ],
      riscos: ['Reforma sem planejamento é a principal causa de estouro de prazo e de orçamento.', 'Sem plano de reforma e ART, o condomínio pode embargar a obra.', 'Equipes sem coordenação geram retrabalho entre etapas (hidráulica, revestimento, pintura).'],
      normas: ['ABNT NBR 16280 · Reforma em edificações', 'ABNT NBR 15575 · Desempenho de edificações', 'ABNT NBR 13753 e 13755 · Revestimentos cerâmicos'],
      faq: [
        { pergunta: 'Posso escolher os acabamentos depois?', resposta: 'Sim, dentro das datas do cronograma. Mantemos uma lista de decisões pendentes para nada atrasar a obra.' },
        { pergunta: 'E se aparecer algo escondido na parede?', resposta: 'Registramos com fotos e apresentamos a solução com valor antes de executar. Nada é cobrado sem sua aprovação.' },
        ...FAQ_COMUM,
      ],
      premissas: ['Escopo por ambiente aprovado antes do início', 'Acesso ao imóvel em dias úteis no horário permitido', rosaeCompra ? `Materiais no padrão ${rotuloDe(reforma.campos, 'padrao', pad).toLowerCase()}; trocas de especificação ajustam o valor` : 'Materiais entregues pelo cliente nas datas da lista de compras'],
      garantia: 'Garantia de 12 meses para os serviços executados e de 5 anos para solidez e segurança, conforme o art. 618 do Código Civil. Materiais seguem a garantia dos fabricantes.',
      diferencial: { titulo: 'Um responsável por tudo', texto: 'Você não precisa coordenar pedreiro, eletricista e pintor: a ROSAE responde pela obra inteira.' },
      pacotes: [
        { nome: 'Essencial', subtitulo: 'Reforma completa com gestão', extras: [] },
        { nome: 'Completo', subtitulo: 'Entrega pronta para usar', extras: [] },
        { nome: 'Premium', subtitulo: 'Projeto em 3D antes de começar', extras: ['Aprovação visual antes de comprar'] },
      ],
      pagamento_padrao: 'etapas',
    };
  },
};

// ---------------------------------------------------------------------
// 4. Construção
// ---------------------------------------------------------------------
const FASES = [
  { nome: 'Serviços preliminares e fundação', descricao: 'Canteiro, locação, movimento de terra e fundações', pct: 12 },
  { nome: 'Estrutura', descricao: 'Pilares, vigas, lajes e escadas', pct: 24 },
  { nome: 'Alvenaria e cobertura', descricao: 'Vedações, cobertura e impermeabilizações', pct: 16 },
  { nome: 'Instalações', descricao: 'Elétrica, hidráulica, esgoto e gás', pct: 15 },
  { nome: 'Revestimentos e acabamentos', descricao: 'Pisos, revestimentos, esquadrias, louças e pintura', pct: 28 },
  { nome: 'Limpeza e entrega', descricao: 'Limpeza, vistoria e entrega das chaves', pct: 5 },
];
const construcao: Definicao = {
  tipo: 'construcao',
  nome: 'Construção',
  chamada: 'Obra nova por empreitada (preço fechado) ou por administração.',
  campos: [
    { id: 'area', rotulo: 'Área a construir', tipo: 'numero', unidade: 'm²', obrigatorio: true },
    { id: 'pavimentos', rotulo: 'Pavimentos', tipo: 'numero', min: 1 },
    { id: 'padrao', rotulo: 'Padrão construtivo', tipo: 'escolha', opcoes: [{ valor: 'normal', rotulo: 'Normal' }, { valor: 'alto', rotulo: 'Alto' }, { valor: 'luxo', rotulo: 'Luxo' }] },
    {
      id: 'modelo', rotulo: 'Modelo de contratação', tipo: 'escolha', opcoes: [
        { valor: 'empreitada', rotulo: 'Empreitada global (preço fechado)', descricao: 'ROSAE fornece material e mão de obra' },
        { valor: 'administracao', rotulo: 'Administração (taxa sobre o custo)', descricao: 'Cliente paga a obra direto; ROSAE administra' },
      ],
    },
    { id: 'terreno', rotulo: 'Terreno em aclive ou declive?', tipo: 'sim_nao' },
    { id: 'fundacao_profunda', rotulo: 'Fundação profunda (estacas)?', tipo: 'sim_nao' },
    { id: 'projeto_estrutural', rotulo: 'Incluir o projeto estrutural?', tipo: 'sim_nao' },
  ],
  parametros: [
    { id: 'custo_normal', rotulo: 'Custo direto por m²: padrão normal', unidade: 'R$/m²', padrao: 2600, custo: true, ajuda: 'Referência: CUB-RJ do mês + ajustes da sua realidade.' },
    { id: 'custo_alto', rotulo: 'Custo direto por m²: padrão alto', unidade: 'R$/m²', padrao: 3400, custo: true },
    { id: 'custo_luxo', rotulo: 'Custo direto por m²: luxo', unidade: 'R$/m²', padrao: 4600, custo: true },
    { id: 'fator_terreno', rotulo: 'Fator terreno inclinado', unidade: 'x', padrao: 1.06 },
    { id: 'fator_fundacao', rotulo: 'Fator fundação profunda', unidade: 'x', padrao: 1.05 },
    { id: 'bdi', rotulo: 'BDI na empreitada', unidade: '%', padrao: 22 },
    { id: 'taxa_adm', rotulo: 'Taxa de administração', unidade: '%', padrao: 15 },
    { id: 'projeto_m2', rotulo: 'Projeto estrutural por m²', unidade: 'R$/m²', padrao: 24 },
    { id: 'controle_tecnologico', rotulo: 'Controle tecnológico do concreto (ensaios)', unidade: 'R$', padrao: 2800 },
    { id: 'asbuilt_m2', rotulo: 'As built e manual do proprietário', unidade: 'R$/m²', padrao: 12 },
    { id: 'pos_obra', rotulo: 'Assistência pós-obra 12 meses (4 visitas)', unidade: 'R$', padrao: 2400 },
    { id: 'meses_base', rotulo: 'Prazo base', unidade: 'meses', padrao: 4 },
    { id: 'm2_por_mes', rotulo: 'm² construídos por mês (ritmo)', unidade: 'm²', padrao: 45 },
  ],
  padrao: { area: null, pavimentos: 2, padrao: 'normal', modelo: 'empreitada', terreno: false, fundacao_profunda: false, projeto_estrutural: false, pagamento: 'etapas', parcelas: 8, distancia_km: 0, urgencia: false },
  calcular(r, p) {
    const area = n(r, 'area');
    const pav = Math.max(1, n(r, 'pavimentos', 1));
    const pad = s(r, 'padrao', 'normal');
    const adm = s(r, 'modelo', 'empreitada') === 'administracao';
    const f = (b(r, 'terreno') ? q(p, 'fator_terreno') : 1) * (b(r, 'fundacao_profunda') ? q(p, 'fator_fundacao') : 1);
    const custo = area * q(p, `custo_${pad}`) * f;
    const linhas: Linha[] = [];
    if (adm) {
      linhas.push({ titulo: 'Administração e gestão técnica da obra', principal: true, descricao: `Taxa de ${fmtN(q(p, 'taxa_adm'), 1)}% sobre o custo estimado de R$ ${fmtN(arred10(custo))} (${fmtN(area, 2)} m², padrão ${rotuloDe(construcao.campos, 'padrao', pad).toLowerCase()}): planejamento, compras, contratação e gestão das equipes, medições, qualidade e responsabilidade técnica. Materiais e mão de obra são pagos pelo cliente diretamente, mediante medição aprovada.`, valor: arred10(custo * q(p, 'taxa_adm') / 100), custo: Math.round(custo * q(p, 'taxa_adm') / 100 * 0.35), pacote: 1, modelo: 'Construção', quantidade: area, unidade: 'm2' });
    } else {
      const total = custo * (1 + q(p, 'bdi') / 100);
      const valores = ratear(Math.round(arred10(total)), FASES.map((x) => x.pct));
      FASES.forEach((fase, k) => linhas.push({ titulo: fase.nome, descricao: `${fase.descricao}, com materiais e mão de obra.`, valor: valores[k], custo: Math.round(custo * fase.pct / 100), pacote: 1, principal: k === 0, modelo: k === 0 ? 'Construção' : undefined }));
    }
    if (b(r, 'projeto_estrutural')) linhas.push({ titulo: 'Projeto estrutural executivo', descricao: 'Cálculo e detalhamento de toda a estrutura com ART, compatibilizado com a arquitetura.', valor: arred10(Math.max(3500, area * q(p, 'projeto_m2'))), custo: Math.round(area * 0.12 * 90), pacote: 1 });
    linhas.push(
      { titulo: 'Controle tecnológico do concreto', descricao: 'Ensaios de resistência dos corpos de prova em laboratório a cada concretagem: prova documental da qualidade da estrutura.', valor: arred10(q(p, 'controle_tecnologico')), custo: Math.round(q(p, 'controle_tecnologico') * 0.7), pacote: 2 },
      { titulo: 'As built e manual do proprietário', descricao: 'Registro do que foi construído (tubulações, quadros, pontos) e manual de uso e manutenção conforme a NBR 14037.', valor: arred10(area * q(p, 'asbuilt_m2')), custo: Math.round(area * q(p, 'asbuilt_m2') * 0.5), pacote: 2 },
      { titulo: 'Assistência pós-obra por 12 meses', descricao: 'Quatro visitas programadas no primeiro ano para verificar o imóvel e orientar a manutenção preventiva.', valor: arred10(q(p, 'pos_obra')), custo: Math.round(q(p, 'pos_obra') * 0.5), pacote: 3 },
    );
    const meses = q(p, 'meses_base') + area / Math.max(1, q(p, 'm2_por_mes'));
    const ds = dividirDias(meses * 30, FASES.map((x) => x.pct));
    const avisos: string[] = [];
    if (!area) avisos.push('Informe a área a construir para calcular o preço.');
    avisos.push('Confira o custo por m² com o CUB-RJ do mês antes de emitir.');
    if (adm) avisos.push('Administração: o total da proposta é só a taxa. O custo estimado da obra aparece no texto para o cliente se planejar.');
    const visitas = Math.round(meses * 8);
    return {
      linhas, visitas: [visitas, visitas, visitas + 4], avisos,
      titulo: `Construção · ${fmtN(area)} m²`,
      etapas: FASES.map((x, k) => ({ nome: x.nome, descricao: x.descricao, dias: ds[k], percentual: x.pct })),
      dados: [
        { rotulo: 'Área construída', valor: `${fmtN(area, 2)} m²` }, { rotulo: 'Pavimentos', valor: String(pav) },
        { rotulo: 'Padrão', valor: rotuloDe(construcao.campos, 'padrao', pad) }, { rotulo: 'Contratação', valor: adm ? 'Administração' : 'Empreitada global' },
        { rotulo: 'Terreno inclinado', valor: sn(b(r, 'terreno')) }, { rotulo: 'Fundação profunda', valor: sn(b(r, 'fundacao_profunda')) },
        ...(adm ? [{ rotulo: 'Custo estimado da obra', valor: `R$ ${fmtN(arred10(custo))}` }] : []),
      ],
      resumo: `Vamos construir o seu imóvel de ${fmtN(area)} m² com planejamento de ponta a ponta, ${adm ? 'transparência total de custos (você paga a obra direto, nós administramos)' : 'preço fechado'} e um engenheiro responsável por cada etapa. Você acompanha a evolução pelo portal, com cronograma, fotos e medições, e recebe a obra conferida e documentada.`,
      inclusoes: ['Planejamento, orçamento executivo e cronograma', 'Gestão de equipes e parceiros', adm ? 'Cotação e compra de materiais em nome do cliente' : 'Materiais e mão de obra de todas as etapas listadas', 'Controle de qualidade e conferência por etapa', 'Medições mensais e relatórios de evolução', 'ART de execução'],
      exclusoes: ['Projetos de arquitetura e complementares (salvo se listados)', 'Taxas, licenças, alvará e habite-se', 'Ligações definitivas de concessionárias', 'Móveis planejados, eletrodomésticos e paisagismo', ...(adm ? ['Materiais e mão de obra (pagos diretamente pelo cliente)'] : [])],
      responsabilidades: [
        { parte: 'ROSAE', itens: ['Executar conforme projetos e normas', 'Gerir prazos, equipes e qualidade', 'Prestar contas por medições', 'Responder tecnicamente pela execução (ART)'] },
        { parte: 'Cliente', itens: ['Fornecer projetos aprovados e terreno liberado', 'Tomar decisões de acabamento no prazo do cronograma', ...(adm ? ['Pagar fornecedores e equipes conforme as medições aprovadas'] : []), ...RESP_CLIENTE_COMUM] },
        { parte: 'Parceiro', itens: ['Executar os serviços com qualidade e segurança', 'Cumprir os prazos combinados'] },
      ],
      entregaveis: ['Cronograma físico-financeiro', 'Medições e relatórios mensais', 'Obra concluída e conferida', 'ART de execução', 'Termo de entrega'],
      metodologia: [
        { titulo: 'Orçamento executivo', texto: 'Detalhamos custos por etapa antes de começar: sem surpresa no meio da obra.' },
        { titulo: 'Planejamento', texto: 'Cronograma com linha de base e curva de avanço para acompanhar o prazo.' },
        { titulo: 'Execução', texto: 'Equipes coordenadas com conferência de qualidade em cada etapa.' },
        { titulo: 'Medições', texto: 'Você paga pelo que foi executado e conferido.' },
        { titulo: 'Entrega', texto: 'Vistoria com você, termo de entrega e orientações de manutenção.' },
      ],
      riscos: ['Obra sem gestão técnica perde, em média, prazo e dinheiro em retrabalho e compras mal planejadas.', 'Sem controle de qualidade por etapa, defeitos ficam escondidos atrás do acabamento.', 'Sem ART e documentação, a obra fica vulnerável em financiamento, habite-se e venda.'],
      normas: ['ABNT NBR 15575 · Desempenho de edificações', 'ABNT NBR 6118 · Estruturas de concreto', 'ABNT NBR 12721 · Custos unitários de construção (CUB)', 'ABNT NBR 14037 · Manual de uso, operação e manutenção'],
      faq: [
        { pergunta: 'Qual a diferença entre empreitada e administração?', resposta: 'Na empreitada o preço é fechado e a ROSAE assume materiais e mão de obra. Na administração você paga a obra pelo custo real e a ROSAE cobra uma taxa pela gestão, com prestação de contas completa.' },
        { pergunta: 'O preço pode mudar no meio da obra?', resposta: 'Na empreitada, só por mudança de escopo aprovada por você em aditivo. Na administração, você acompanha o custo real a cada medição.' },
        ...FAQ_COMUM,
      ],
      premissas: ['Projetos aprovados e compatibilizados antes do início', 'Terreno limpo, demarcado e com acesso para caminhões', `Padrão construtivo ${rotuloDe(construcao.campos, 'padrao', pad).toLowerCase()} conforme memorial a ser anexado`],
      garantia: 'Garantia de 5 anos pela solidez e segurança da obra (art. 618 do Código Civil) e prazos de garantia por sistema conforme a NBR 15575.',
      diferencial: { titulo: 'Obra com números na mesa', texto: 'Cronograma, medições e custos abertos para você em cada etapa.' },
      pacotes: [
        { nome: 'Essencial', subtitulo: 'Construção com gestão completa', extras: [] },
        { nome: 'Completo', subtitulo: 'Qualidade comprovada e documentada', extras: [] },
        { nome: 'Premium', subtitulo: 'Com assistência no primeiro ano', extras: ['Prioridade no atendimento pós-obra'] },
      ],
      pagamento_padrao: adm ? 'mensal' : 'etapas',
    };
  },
};

// ---------------------------------------------------------------------
// 5. Laudo técnico
// ---------------------------------------------------------------------
const TIPOS_LAUDO: Record<string, { rotulo: string; param: string; objetivo: string; norma?: string }> = {
  patologias: { rotulo: 'Patologias (trincas, infiltrações, corrosão)', param: 'base_patologias', objetivo: 'identificar as causas das manifestações patológicas e indicar como corrigi-las' },
  estabilidade: { rotulo: 'Estabilidade e segurança estrutural', param: 'base_estabilidade', objetivo: 'avaliar se a estrutura está segura para o uso atual' },
  cautelar: { rotulo: 'Vistoria cautelar de vizinhança', param: 'base_cautelar', objetivo: 'registrar o estado dos imóveis vizinhos antes de uma obra, protegendo todas as partes' },
  inspecao: { rotulo: 'Inspeção predial', param: 'base_inspecao', objetivo: 'avaliar os sistemas da edificação e orientar a manutenção', norma: 'ABNT NBR 16747 · Inspeção predial' },
  reforma: { rotulo: 'Laudo para reforma (NBR 16280)', param: 'base_reforma', objetivo: 'avaliar a reforma pretendida e seus impactos na edificação', norma: 'ABNT NBR 16280 · Reforma em edificações' },
  recebimento: { rotulo: 'Vistoria de recebimento de imóvel', param: 'base_recebimento', objetivo: 'apontar vícios e pendências antes de você receber as chaves' },
};
const laudo: Definicao = {
  tipo: 'laudo',
  nome: 'Laudo técnico',
  chamada: 'Vistoria e laudo com ART: patologias, estabilidade, cautelar, inspeção predial.',
  campos: [
    { id: 'tipo_laudo', rotulo: 'Tipo de laudo', tipo: 'escolha', opcoes: Object.entries(TIPOS_LAUDO).map(([valor, t]) => ({ valor, rotulo: t.rotulo })) },
    { id: 'area', rotulo: 'Área vistoriada', tipo: 'numero', unidade: 'm²' },
    { id: 'unidades', rotulo: 'Imóveis ou unidades vistoriadas', tipo: 'numero', unidade: 'un', min: 1 },
    { id: 'finalidade', rotulo: 'Finalidade', tipo: 'escolha', opcoes: [{ valor: 'tecnica', rotulo: 'Técnica / manutenção' }, { valor: 'judicial', rotulo: 'Judicial, seguradora ou negociação' }] },
    { id: 'ensaios', rotulo: 'Ensaios', tipo: 'escolha', opcoes: [{ valor: 'nenhum', rotulo: 'Só inspeção visual' }, { valor: 'basicos', rotulo: 'Ensaios não destrutivos básicos' }, { valor: 'completos', rotulo: 'Ensaios completos (com extração)' }] },
  ],
  parametros: [
    { id: 'base_patologias', rotulo: 'Laudo de patologias', unidade: 'R$', padrao: 1800 },
    { id: 'base_estabilidade', rotulo: 'Laudo de estabilidade', unidade: 'R$', padrao: 2800 },
    { id: 'base_cautelar', rotulo: 'Vistoria cautelar por unidade', unidade: 'R$', padrao: 900 },
    { id: 'base_inspecao', rotulo: 'Inspeção predial', unidade: 'R$', padrao: 3500 },
    { id: 'base_reforma', rotulo: 'Laudo para reforma', unidade: 'R$', padrao: 1500 },
    { id: 'base_recebimento', rotulo: 'Vistoria de recebimento', unidade: 'R$', padrao: 900 },
    { id: 'area_inclusa', rotulo: 'Área incluída no valor base', unidade: 'm²', padrao: 100 },
    { id: 'm2_extra', rotulo: 'Valor por m² acima da área incluída', unidade: 'R$/m²', padrao: 5 },
    { id: 'judicial_pct', rotulo: 'Acréscimo para finalidade judicial', unidade: '%', padrao: 20 },
    { id: 'ensaios_basicos', rotulo: 'Ensaios não destrutivos básicos', unidade: 'R$', padrao: 1500 },
    { id: 'ensaios_completos', rotulo: 'Ensaios completos (com extração)', unidade: 'R$', padrao: 4500 },
    { id: 'mapa_danos', rotulo: 'Mapa de danos com croquis', unidade: 'R$', padrao: 700 },
    { id: 'estimativa_reparo', rotulo: 'Estimativa de custo de recuperação', unidade: 'R$', padrao: 1200 },
    { id: 'revistoria', rotulo: 'Revistoria após os reparos', unidade: 'R$', padrao: 650 },
    { id: 'horas_base', rotulo: 'Horas por laudo', unidade: 'h', padrao: 12, custo: true },
    { id: 'custo_hora', rotulo: 'Custo da sua hora (referência interna)', unidade: 'R$/h', padrao: 90, custo: true },
    { id: 'art', rotulo: 'Taxa da ART (conferir tabela CREA-RJ)', unidade: 'R$', padrao: 110, custo: true },
  ],
  padrao: { tipo_laudo: 'patologias', area: 100, unidades: 1, finalidade: 'tecnica', ensaios: 'nenhum', pagamento: 'metade', parcelas: 2, distancia_km: 0, urgencia: false },
  calcular(r, p) {
    const tl = s(r, 'tipo_laudo', 'patologias');
    const t = TIPOS_LAUDO[tl] ?? TIPOS_LAUDO.patologias;
    const area = n(r, 'area');
    const un = Math.max(1, Math.round(n(r, 'unidades', 1)));
    const jud = s(r, 'finalidade', 'tecnica') === 'judicial';
    const ens = s(r, 'ensaios', 'nenhum');
    const fJud = jud ? 1 + q(p, 'judicial_pct') / 100 : 1;
    const baseUn = tl === 'cautelar' ? q(p, t.param) * un : q(p, t.param) * (1 + (un - 1) * 0.6);
    const extra = Math.max(0, area - q(p, 'area_inclusa')) * q(p, 'm2_extra');
    const horas = Math.round((q(p, 'horas_base') + extra / 60) * (tl === 'cautelar' ? Math.max(1, un * 0.5) : 1) * fJud);
    const linhas: Linha[] = [{
      titulo: `Laudo técnico: ${t.rotulo.toLowerCase()}`, principal: true,
      descricao: `Vistoria técnica${un > 1 ? ` de ${un} imóveis/unidades` : ''}${area ? ` (${fmtN(area, 2)} m²)` : ''} para ${t.objetivo}, com registro fotográfico, análise técnica, conclusão e recomendações com prioridade, e ART.${jud ? ' Redação com rigor pericial para uso judicial, em seguradora ou em negociação.' : ''}`,
      valor: arred10((baseUn + extra) * fJud), custo: Math.round(horas * q(p, 'custo_hora') + q(p, 'art')), pacote: 1, modelo: 'Laudo técnico e vistoria estrutural',
    }];
    if (ens === 'basicos') linhas.push({ titulo: 'Ensaios não destrutivos', descricao: 'Pacometria, esclerometria e medição de umidade, conforme o caso.', valor: arred10(q(p, 'ensaios_basicos')), custo: Math.round(q(p, 'ensaios_basicos') * 0.6), pacote: 1 });
    if (ens === 'completos') linhas.push({ titulo: 'Ensaios completos com extração de testemunhos', descricao: 'Extração de testemunhos de concreto com ensaio de compressão em laboratório, profundidade de carbonatação e ensaios não destrutivos.', valor: arred10(q(p, 'ensaios_completos')), custo: Math.round(q(p, 'ensaios_completos') * 0.7), pacote: 1 });
    linhas.push(
      { titulo: 'Mapa de danos com croquis', descricao: 'Localização de cada ocorrência em planta, para orientar orçamento e execução dos reparos.', valor: arred10(q(p, 'mapa_danos')), custo: Math.round(4 * q(p, 'custo_hora')), pacote: 2 },
      ...(ens === 'nenhum' ? [{ titulo: 'Ensaios não destrutivos', descricao: 'Pacometria, esclerometria e medição de umidade para confirmar o diagnóstico com dados.', valor: arred10(q(p, 'ensaios_basicos')), custo: Math.round(q(p, 'ensaios_basicos') * 0.6), pacote: 2 as const }] : []),
      { titulo: 'Estimativa de custo de recuperação', descricao: 'Valor estimado de cada reparo recomendado, por prioridade, para você planejar e negociar.', valor: arred10(q(p, 'estimativa_reparo')), custo: Math.round(6 * q(p, 'custo_hora')), pacote: 3 },
      { titulo: 'Revistoria após os reparos', descricao: 'Nova vistoria para atestar que os reparos foram executados corretamente.', valor: arred10(q(p, 'revistoria')), custo: Math.round(4 * q(p, 'custo_hora')), pacote: 3 },
    );
    const dias = Math.round(5 + horas / 3 + (ens === 'completos' ? 10 : ens === 'basicos' ? 3 : 0));
    const ds = dividirDias(dias, [25, 15, 60]);
    const normas = [t.norma, 'ABNT NBR 13752 · Perícias de engenharia na construção civil', 'ABNT NBR 6118 · Projeto de estruturas de concreto', 'ABNT NBR 15575 · Desempenho de edificações'].filter(Boolean) as string[];
    return {
      linhas, visitas: [Math.max(1, Math.ceil(un / 4)), Math.max(1, Math.ceil(un / 4)), Math.max(1, Math.ceil(un / 4)) + 1], horas, avisos: tl === 'cautelar' && un > 10 ? ['Muitas unidades: confira se vale um valor por unidade menor.'] : [],
      titulo: `Laudo técnico · ${t.rotulo.split(' (')[0]}`,
      etapas: [
        { nome: 'Agendamento e análise prévia', descricao: 'Coleta de documentos, histórico e plantas', dias: ds[0], percentual: 0 },
        { nome: 'Vistoria técnica', descricao: 'Inspeção, registros, medições e ensaios', dias: ds[1], percentual: 50 },
        { nome: 'Laudo e apresentação', descricao: 'Análise, redação, ART e reunião de entrega', dias: ds[2], percentual: 50 },
      ],
      dados: [
        { rotulo: 'Tipo de laudo', valor: t.rotulo }, ...(area ? [{ rotulo: 'Área', valor: `${fmtN(area, 2)} m²` }] : []), { rotulo: 'Unidades', valor: String(un) },
        { rotulo: 'Finalidade', valor: jud ? 'Judicial / seguradora / negociação' : 'Técnica / manutenção' }, { rotulo: 'Ensaios', valor: rotuloDe(laudo.campos, 'ensaios', ens) },
      ],
      resumo: `Você vai saber exatamente o que está acontecendo no imóvel, por que está acontecendo e o que fazer, em ordem de prioridade. O laudo é assinado por engenheiro com ART e serve como documento técnico para decisões, ${jud ? 'processos, seguradoras e negociações' : 'orçamentos de reparo e manutenção'}.`,
      inclusoes: ['Análise prévia de documentos e histórico', 'Vistoria técnica no local', 'Registro fotográfico de todas as ocorrências', 'Diagnóstico das causas prováveis', 'Recomendações com grau de urgência', 'Laudo técnico assinado', 'ART do laudo'],
      exclusoes: [...(ens === 'completos' ? [] : ['Ensaios destrutivos e de laboratório (orçados se necessários)']), 'Projeto e execução dos reparos (podem ser contratados na sequência)', 'Acompanhamento judicial e audiências'],
      responsabilidades: [
        { parte: 'ROSAE', itens: ['Realizar a vistoria e emitir o laudo com ART', 'Comunicar imediatamente qualquer risco grave identificado', 'Manter sigilo sobre as informações do imóvel'] },
        { parte: 'Cliente', itens: ['Garantir acesso a todos os ambientes na data agendada', 'Fornecer plantas, projetos e histórico de reformas disponíveis', ...RESP_CLIENTE_COMUM] },
      ],
      entregaveis: ['Laudo técnico em PDF assinado', 'Relatório fotográfico', 'Quadro de recomendações por prioridade', 'ART do laudo'],
      metodologia: [
        { titulo: 'Análise prévia', texto: 'Documentos, histórico e relato do problema antes de ir ao local.' },
        { titulo: 'Vistoria', texto: 'Inspeção sistemática com registro e localização de cada ocorrência.' },
        { titulo: 'Diagnóstico', texto: 'Causa provável, gravidade e risco de cada manifestação.' },
        { titulo: 'Recomendações', texto: 'O que fazer, em que ordem e com qual urgência.' },
      ],
      riscos: ['Problemas estruturais e de umidade evoluem: quanto antes o diagnóstico, menor o custo do reparo.', 'Sem laudo técnico, discussões com construtora, vizinho ou seguradora viram opinião contra opinião.', 'Reparos feitos sem diagnóstico costumam tratar o sintoma e o problema volta.'],
      normas,
      faq: [
        { pergunta: 'Quanto tempo dura a vistoria?', resposta: 'Normalmente de 2 a 4 horas por imóvel, conforme o tamanho e a quantidade de ocorrências.' },
        { pergunta: 'O laudo vale na Justiça?', resposta: 'É um documento técnico assinado com ART. Em processos, pode ser juntado como prova técnica ou servir de base para assistente técnico.' },
        ...FAQ_COMUM.slice(0, 1),
      ],
      premissas: ['Acesso livre a todos os ambientes na data agendada', 'Avaliação baseada nas condições visíveis e nos ensaios contratados'],
      garantia: 'Laudo assinado por engenheiro civil com ART. Esclarecimentos sobre o conteúdo do laudo por 90 dias após a entrega, sem custo.',
      diferencial: { titulo: 'Diagnóstico que vira decisão', texto: 'Cada problema sai com causa, gravidade e o que fazer, em linguagem clara.' },
      pacotes: [
        { nome: 'Essencial', subtitulo: 'Laudo técnico com ART', extras: [] },
        { nome: 'Completo', subtitulo: 'Diagnóstico confirmado e mapeado', extras: ['Reunião de apresentação do laudo'] },
        { nome: 'Premium', subtitulo: 'Do diagnóstico ao reparo conferido', extras: ['Reunião de apresentação do laudo'] },
      ],
      pagamento_padrao: 'metade',
    };
  },
};

// ---------------------------------------------------------------------
// 6. Perícia
// ---------------------------------------------------------------------
const pericia: Definicao = {
  tipo: 'pericia',
  nome: 'Perícia',
  chamada: 'Perícia judicial, assistência técnica ou perícia extrajudicial, por horas técnicas.',
  campos: [
    {
      id: 'modalidade', rotulo: 'Modalidade', tipo: 'escolha', opcoes: [
        { valor: 'assistente', rotulo: 'Assistente técnico de uma das partes' }, { valor: 'extrajudicial', rotulo: 'Perícia extrajudicial / parecer técnico' }, { valor: 'judicial', rotulo: 'Perito do juízo (proposta de honorários)' },
      ],
    },
    {
      id: 'objeto', rotulo: 'Objeto', tipo: 'escolha', opcoes: [
        { valor: 'vicios', rotulo: 'Vícios construtivos' }, { valor: 'vizinhanca', rotulo: 'Danos de vizinhança' }, { valor: 'servicos', rotulo: 'Serviços, medições e contratos de obra' },
        { valor: 'sinistro', rotulo: 'Sinistro, desabamento ou acidente' }, { valor: 'outro', rotulo: 'Outro' },
      ],
    },
    { id: 'complexidade', rotulo: 'Complexidade', tipo: 'escolha', opcoes: [{ valor: 'simples', rotulo: 'Simples' }, { valor: 'media', rotulo: 'Média' }, { valor: 'alta', rotulo: 'Alta' }] },
    { id: 'quesitos', rotulo: 'Quesitos a responder', tipo: 'numero', unidade: 'quesitos' },
    { id: 'vistorias', rotulo: 'Vistorias previstas', tipo: 'numero', min: 1 },
    { id: 'documentos', rotulo: 'Volume de documentos', tipo: 'escolha', opcoes: [{ valor: 'pouco', rotulo: 'Pouco' }, { valor: 'medio', rotulo: 'Médio' }, { valor: 'muito', rotulo: 'Muito (processo extenso)' }] },
    { id: 'processo', rotulo: 'Nº do processo (se houver)', tipo: 'texto', placeholder: '0000000-00.0000.8.19.0000' },
  ],
  parametros: [
    { id: 'valor_hora', rotulo: 'Valor da hora técnica', unidade: 'R$/h', padrao: 300 },
    { id: 'horas_simples', rotulo: 'Horas de análise e laudo: simples', unidade: 'h', padrao: 14 },
    { id: 'horas_media', rotulo: 'Horas de análise e laudo: média', unidade: 'h', padrao: 26 },
    { id: 'horas_alta', rotulo: 'Horas de análise e laudo: alta', unidade: 'h', padrao: 48 },
    { id: 'horas_quesito', rotulo: 'Horas por quesito', unidade: 'h', padrao: 1 },
    { id: 'horas_vistoria', rotulo: 'Horas por vistoria (com deslocamento)', unidade: 'h', padrao: 4 },
    { id: 'horas_docs_pouco', rotulo: 'Horas de leitura de documentos: pouco', unidade: 'h', padrao: 2 },
    { id: 'horas_docs_medio', rotulo: 'Horas de leitura de documentos: médio', unidade: 'h', padrao: 6 },
    { id: 'horas_docs_muito', rotulo: 'Horas de leitura de documentos: muito', unidade: 'h', padrao: 14 },
    { id: 'minimo', rotulo: 'Honorário mínimo', unidade: 'R$', padrao: 3500 },
    { id: 'horas_esclarecimentos', rotulo: 'Horas reservadas para esclarecimentos (Completo)', unidade: 'h', padrao: 6 },
    { id: 'horas_audiencia', rotulo: 'Horas para audiência e parecer crítico (Premium)', unidade: 'h', padrao: 10 },
    { id: 'custo_hora', rotulo: 'Custo da sua hora (referência interna)', unidade: 'R$/h', padrao: 90, custo: true },
  ],
  padrao: { modalidade: 'assistente', objeto: 'vicios', complexidade: 'media', quesitos: 10, vistorias: 1, documentos: 'medio', processo: '', pagamento: 'metade', parcelas: 2, distancia_km: 0, urgencia: false },
  calcular(r, p) {
    const mod = s(r, 'modalidade', 'assistente');
    const comp = s(r, 'complexidade', 'media');
    const qs = Math.round(n(r, 'quesitos', 0));
    const vis = Math.max(1, Math.round(n(r, 'vistorias', 1)));
    const docs = s(r, 'documentos', 'medio');
    const vh = q(p, 'valor_hora');
    const hDocs = q(p, `horas_docs_${docs}`);
    const hVis = vis * q(p, 'horas_vistoria');
    const hQues = qs * q(p, 'horas_quesito');
    const hLaudo = q(p, `horas_${comp}`);
    const horas = hDocs + hVis + hQues + hLaudo;
    const judicial = mod === 'judicial';
    const produto = mod === 'assistente' ? 'parecer técnico do assistente' : judicial ? 'laudo pericial' : 'laudo pericial extrajudicial';
    const linhas: Linha[] = [
      { titulo: 'Análise dos autos e documentos', descricao: `Estudo do processo, contratos, projetos, fotos e demais documentos (${fmtN(hDocs, 1)} h técnicas).`, valor: arred10(hDocs * vh), custo: Math.round(hDocs * q(p, 'custo_hora')), pacote: 1, quantidade: hDocs, unidade: 'un' },
      { titulo: `Vistoria${vis > 1 ? 's' : ''} técnica${vis > 1 ? 's' : ''}`, descricao: `${vis} diligência(s) ao local com registro fotográfico, medições e ata (${fmtN(hVis, 1)} h técnicas).`, valor: arred10(hVis * vh), custo: Math.round(hVis * q(p, 'custo_hora')), pacote: 1 },
      ...(qs > 0 ? [{ titulo: 'Resposta aos quesitos', descricao: `Resposta fundamentada a ${qs} quesito(s) (${fmtN(hQues, 1)} h técnicas).`, valor: arred10(hQues * vh), custo: Math.round(hQues * q(p, 'custo_hora')), pacote: 1 as const }] : []),
      { titulo: `Elaboração do ${produto}`, principal: true, descricao: `Análise técnica, conclusões e redação do ${produto} conforme a ABNT NBR 13752, com ART (${fmtN(hLaudo, 1)} h técnicas).`, valor: arred10(hLaudo * vh), custo: Math.round(hLaudo * q(p, 'custo_hora') + 110), pacote: 1, modelo: 'Perícia técnica de engenharia' },
    ];
    const soma = linhas.reduce((t, l) => t + l.valor, 0);
    if (soma < q(p, 'minimo')) {
      const princ = linhas.find((l) => l.principal)!;
      princ.valor = arred10(princ.valor + q(p, 'minimo') - soma);
    }
    if (!judicial) {
      linhas.push(
        { titulo: 'Esclarecimentos e quesitos suplementares', descricao: `Reserva de ${fmtN(q(p, 'horas_esclarecimentos'))} h para responder pedidos de esclarecimento e quesitos suplementares, sem nova contratação.`, valor: arred10(q(p, 'horas_esclarecimentos') * vh), custo: Math.round(q(p, 'horas_esclarecimentos') * q(p, 'custo_hora')), pacote: 2 },
        { titulo: mod === 'assistente' ? 'Audiência e parecer crítico ao laudo oficial' : 'Reunião técnica de conciliação', descricao: mod === 'assistente' ? 'Análise crítica do laudo do perito do juízo e participação em audiência, quando designada.' : 'Apresentação técnica dos resultados às partes, buscando acordo antes do processo.', valor: arred10(q(p, 'horas_audiencia') * vh), custo: Math.round(q(p, 'horas_audiencia') * q(p, 'custo_hora')), pacote: 3 },
      );
    }
    const dias = Math.round(10 + horas / 2.5);
    const ds = dividirDias(dias, [20, 20, 60]);
    const proc = s(r, 'processo');
    return {
      linhas, visitas: [vis, vis, vis + (mod === 'assistente' ? 1 : 0)], horas, avisos: judicial ? ['Perito do juízo: proposta única de honorários, sem pacotes. Confira as regras do tribunal sobre depósito e levantamento.'] : [],
      titulo: `${judicial ? 'Proposta de honorários periciais' : mod === 'assistente' ? 'Assistência técnica pericial' : 'Perícia técnica'} · ${rotuloDe(pericia.campos, 'objeto', s(r, 'objeto', 'vicios'))}`,
      etapas: [
        { nome: 'Análise documental', descricao: 'Leitura dos autos e documentos, plano de trabalho', dias: ds[0], percentual: 0 },
        { nome: 'Diligências', descricao: 'Vistorias técnicas com as partes', dias: ds[1], percentual: 50 },
        { nome: 'Laudo / parecer', descricao: 'Análise, quesitos, redação e entrega com ART', dias: ds[2], percentual: 50 },
      ],
      dados: [
        { rotulo: 'Modalidade', valor: rotuloDe(pericia.campos, 'modalidade', mod) }, { rotulo: 'Objeto', valor: rotuloDe(pericia.campos, 'objeto', s(r, 'objeto', 'vicios')) },
        { rotulo: 'Complexidade', valor: rotuloDe(pericia.campos, 'complexidade', comp) }, { rotulo: 'Quesitos', valor: String(qs) }, { rotulo: 'Vistorias', valor: String(vis) },
        { rotulo: 'Horas técnicas estimadas', valor: `${fmtN(horas, 1)} h` }, ...(proc ? [{ rotulo: 'Processo', valor: proc }] : []),
      ],
      resumo: judicial
        ? `Apresentamos a estimativa de honorários para a perícia de engenharia, calculada por ${fmtN(horas, 1)} horas técnicas, com metodologia conforme a ABNT NBR 13752 e laudo fundamentado, imparcial e objetivo.`
        : `Você terá ao seu lado um engenheiro com análise técnica fundamentada para ${mod === 'assistente' ? 'defender tecnicamente a sua posição no processo' : 'esclarecer a questão com isenção e embasamento'}. Cada conclusão é amparada em vistoria, documentos e normas técnicas, em linguagem que advogados e juízes entendem.`,
      inclusoes: ['Análise dos autos e documentos', `${vis} vistoria(s) técnica(s) com registro`, ...(qs ? ['Resposta fundamentada aos quesitos'] : []), `${produto.charAt(0).toUpperCase()}${produto.slice(1)} conforme ABNT NBR 13752`, 'ART'],
      exclusoes: ['Ensaios de laboratório (orçados se necessários)', 'Deslocamentos para fora do estado', ...(judicial ? [] : ['Horas além das estimadas, cobradas pela hora técnica mediante aviso prévio']), 'Custas processuais'],
      responsabilidades: [
        { parte: 'ROSAE', itens: ['Atuar com técnica, ética e sigilo', 'Cumprir os prazos processuais combinados', 'Comunicar fatos relevantes assim que identificados'] },
        { parte: judicial ? 'Partes' : 'Cliente', itens: ['Fornecer cópia integral dos autos e documentos', 'Garantir o acesso ao local nas datas das diligências', judicial ? 'Depositar os honorários conforme determinação do juízo' : 'Informar prazos processuais com antecedência', ...(judicial ? [] : RESP_CLIENTE_COMUM.slice(0, 1))] },
      ],
      entregaveis: [`${produto.charAt(0).toUpperCase()}${produto.slice(1)} em PDF assinado`, 'Relatório fotográfico das diligências', ...(qs ? ['Respostas aos quesitos'] : []), 'ART'],
      metodologia: [
        { titulo: 'Plano de trabalho', texto: 'Leitura dos autos, pontos controvertidos e quesitos.' },
        { titulo: 'Diligências', texto: 'Vistoria com comunicação às partes e registro completo.' },
        { titulo: 'Análise', texto: 'Confronto entre fatos, documentos e normas técnicas.' },
        { titulo: 'Laudo', texto: 'Conclusões objetivas e quesitos respondidos um a um.' },
      ],
      riscos: mod === 'assistente' ? ['Sem assistente técnico, a parte fica sem quem conteste tecnicamente o laudo oficial.', 'Quesitos mal formulados limitam o que a perícia pode provar.'] : ['Sem prova técnica, a discussão fica sem base objetiva.', 'Vícios construtivos têm prazos para reclamação: agir cedo preserva direitos.'],
      normas: ['ABNT NBR 13752 · Perícias de engenharia na construção civil', 'ABNT NBR 15575 · Desempenho de edificações', 'ABNT NBR 16747 · Inspeção predial'],
      faq: [
        { pergunta: 'Como as horas foram estimadas?', resposta: 'Pela leitura de documentos, número de vistorias e de quesitos e pela complexidade do caso. O detalhamento está no investimento.' },
        { pergunta: 'E se o processo exigir mais trabalho?', resposta: 'Avisamos antes e só seguimos com sua concordância, pelo mesmo valor de hora técnica.' },
      ],
      premissas: ['Acesso integral aos autos e documentos', `${vis} vistoria(s) prevista(s)`, 'Valor da hora técnica mantido durante a validade desta proposta'],
      garantia: 'Trabalho conforme a ABNT NBR 13752, com ART e sigilo sobre todas as informações do caso.',
      diferencial: { titulo: 'Técnica que se sustenta', texto: 'Conclusões amparadas em norma, documento e vistoria, sem achismo.' },
      pacotes: judicial ? [{ nome: 'Honorários periciais', subtitulo: 'Estimativa por horas técnicas', extras: [] }] : [
        { nome: 'Essencial', subtitulo: 'Laudo ou parecer técnico', extras: [] },
        { nome: 'Completo', subtitulo: 'Com esclarecimentos garantidos', extras: ['Reunião estratégica com o advogado'] },
        { nome: 'Premium', subtitulo: 'Acompanhamento até a audiência', extras: ['Reunião estratégica com o advogado'] },
      ],
      pagamento_padrao: 'metade',
    };
  },
};

export const DEFINICOES: Record<TipoServico, Definicao> = {
  projeto_estrutural: projeto, reforco, reforma, construcao, laudo, pericia,
};
export const TIPOS: TipoServico[] = ['projeto_estrutural', 'reforco', 'reforma', 'construcao', 'laudo', 'pericia'];

/** Perguntas do tipo + as comuns (deslocamento, urgência, pagamento). */
export function camposDe(tipo: TipoServico): Campo[] {
  return [...DEFINICOES[tipo].campos, ...CAMPOS_COMUNS];
}
export function parametrosDe(tipo: TipoServico): Parametro[] {
  return [...DEFINICOES[tipo].parametros, ...PARAMETROS_COMUNS];
}
export function parametrosPadrao(tipo: TipoServico): Parametros {
  return Object.fromEntries(parametrosDe(tipo).map((x) => [x.id, x.padrao]));
}
export function respostasPadrao(tipo: TipoServico): Respostas {
  return { ...DEFINICOES[tipo].padrao };
}

/** Campos obrigatórios que faltam. */
export function faltando(tipo: TipoServico, r: Respostas): string[] {
  return camposDe(tipo).filter((c) => c.tipo === 'numero' && c.obrigatorio && !(n(r, c.id) > 0)).map((c) => c.rotulo);
}

// ---------------------------------------------------------------------
// Montagem final
// ---------------------------------------------------------------------
export type Pacote = { numero: 1 | 2 | 3; nome: string; subtitulo: string; valor: number; custo: number; linhas: Linha[]; destaques: string[] };
export type Orcamento = {
  tipo: TipoServico;
  titulo: string;
  pacotes: Pacote[];
  principal: Pacote;
  base: Base;
  conteudo: Conteudo;
  custos: { descricao: string; valor: number }[];
  analise: { preco: number; custo: number; margem: number; margem_pct: number; horas?: number; valor_hora?: number };
  avisos: string[];
};

/** Linhas de um pacote, com deslocamento e prioridade (urgência) já somados. */
function linhasDoPacote(base: Base, k: 1 | 2 | 3, r: Respostas, p: Parametros): Linha[] {
  const ls = base.linhas.filter((l) => l.pacote <= k).map((l) => ({ ...l }));
  const km = n(r, 'distancia_km');
  const vis = base.visitas[k - 1] ?? 0;
  if (km > 0 && vis > 0) {
    const v = km * 2 * q(p, 'km') * vis;
    ls.push({ titulo: 'Deslocamentos técnicos', descricao: `${vis} deslocamento(s) de ida e volta (${fmtN(km)} km por trecho).`, valor: arred10(v), custo: Math.round(v * 0.85), pacote: 1 });
  }
  if (b(r, 'urgencia') && q(p, 'urgencia_pct') > 0) {
    const sub = ls.reduce((t, l) => t + l.valor, 0);
    ls.push({ titulo: 'Prioridade de agenda (prazo reduzido)', descricao: 'Reorganização da agenda e da equipe para entregar em prazo menor que o usual.', valor: arred10(sub * q(p, 'urgencia_pct') / 100), custo: 0, pacote: 1 });
  }
  return ls.filter((l) => l.valor > 0);
}

function pagamento(forma: FormaPagamento, total: Centavos, nParc: number, etapas: Etapa[], entradaPct: number): ParcelaProposta[] {
  if (total <= 0) return [];
  if (forma === 'metade') return parcelasPorPercentual(total, [{ descricao: 'Sinal', percentual: 50, quando: 'No aceite da proposta' }, { descricao: 'Saldo', percentual: 50, quando: 'Na entrega' }]);
  if (forma === 'etapas' && etapas.some((e) => (e.percentual ?? 0) > 0)) {
    const com = etapas.filter((e) => (e.percentual ?? 0) > 0);
    return parcelasPorPercentual(total, [
      { descricao: 'Sinal para mobilização', percentual: 20, quando: 'No aceite da proposta' },
      ...com.map((e) => ({ descricao: e.nome, percentual: 80 * (e.percentual ?? 0) / com.reduce((t, x) => t + (x.percentual ?? 0), 0), quando: 'Ao concluir a etapa' })),
    ]);
  }
  const k = Math.max(1, Math.round(nParc) || 1);
  if (forma === 'mensal') return parcelasPorPercentual(total, Array.from({ length: k }, (_, j) => ({ descricao: `Mensalidade ${j + 1}/${k}`, percentual: 1, quando: j === 0 ? 'No aceite' : `Mês ${j + 1}` })));
  const e = Math.min(90, Math.max(0, entradaPct));
  return parcelasPorPercentual(total, [
    { descricao: 'Entrada', percentual: e, quando: 'No aceite da proposta' },
    ...Array.from({ length: k }, (_, j) => ({ descricao: `Parcela ${j + 1}/${k}`, percentual: (100 - e) / k, quando: `${30 * (j + 1)} dias` })),
  ]);
}

function textoPrazo(dias: number): string {
  if (dias <= 45) return `${dias} dias corridos`;
  if (dias <= 120) return `${dias} dias corridos (cerca de ${Math.round(dias / 7)} semanas)`;
  return `cerca de ${Math.round(dias / 30)} meses (${dias} dias corridos)`;
}

const reaisFmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const DIFERENCIAIS: Topico[] = [
  { titulo: 'Engenheiro responsável do início ao fim', texto: 'Você fala direto com quem projeta, calcula e responde tecnicamente pelo seu serviço.' },
  { titulo: 'Escopo sem letras miúdas', texto: 'O que está incluso, o que não está e o papel de cada parte, por escrito.' },
  { titulo: 'Acompanhamento pelo celular', texto: 'Portal exclusivo com etapas, registros, fotos e documentos do seu serviço.' },
  { titulo: 'Mudanças só com o seu aceite', texto: 'Qualquer alteração de escopo, prazo ou valor vira aditivo e só segue com a sua aprovação.' },
];

export type Contexto = { necessidade?: string; local?: string; biblioteca?: ModeloServico[]; base?: Conteudo };

/** Gera o orçamento completo. pacote = qual opção vai como valor da proposta (as outras aparecem para comparação). */
export function gerarOrcamento(tipo: TipoServico, r: Respostas, p: Parametros, pacoteEscolhido: 1 | 2 | 3 = 2, ctx: Contexto = {}): Orcamento {
  const def = DEFINICOES[tipo];
  const pp = { ...parametrosPadrao(tipo), ...p };
  const base = def.calcular(r, pp);
  const urg = b(r, 'urgencia');
  const pacotes: Pacote[] = base.pacotes.map((pc, i) => {
    const k = (i + 1) as 1 | 2 | 3;
    const ls = linhasDoPacote(base, base.pacotes.length === 1 ? 3 : k, r, pp);
    const novos = base.pacotes.length === 1 ? [] : base.linhas.filter((l) => l.pacote === k && l.valor > 0).map((l) => l.titulo);
    return {
      numero: k, nome: pc.nome, subtitulo: pc.subtitulo, linhas: ls,
      valor: ls.reduce((t, l) => t + l.valor, 0), custo: ls.reduce((t, l) => t + l.custo, 0),
      destaques: k === 1 || base.pacotes.length === 1 ? base.entregaveis.slice(0, 4) : [`Tudo do ${base.pacotes[i - 1].nome}`, ...novos, ...pc.extras],
    };
  });
  const principal = pacotes[Math.min(pacotes.length, pacoteEscolhido) - 1] ?? pacotes[0];

  // Etapas com prazo (urgência reduz ~25%).
  const etapas: Etapa[] = base.etapas.map((e) => ({ nome: e.nome, descricao: e.descricao, percentual: e.percentual, prazo_dias: Math.max(1, Math.round(e.dias * (urg ? 0.75 : 1))) }));
  const prazoTotal = etapas.reduce((t, e) => t + (e.prazo_dias ?? 0), 0);

  // Itens da proposta: a linha principal leva as etapas (viram o cronograma da obra na conversão).
  const porNome = new Map((ctx.biblioteca ?? []).map((m) => [m.nome, m.id]));
  const itens: Item[] = principal.linhas.map((l) => {
    const qtd = l.quantidade && l.unidade && l.unidade !== 'vb' ? l.quantidade : 1;
    const unid = qtd === 1 ? 'vb' : l.unidade ?? 'vb';
    const it: Item = {
      id: novoId(), modelo_id: (l.modelo && porNome.get(l.modelo)) || null, titulo: l.titulo, descricao: l.descricao,
      unidade: unid, quantidade: qtd, preco_unitario: qtd === 1 ? l.valor : Math.round((l.valor / qtd) * 100) / 100, complexidade: null, fator: 1, total: 0,
    };
    // Preço unitário arredondado pode não fechar o total: nesse caso vai como verba.
    if (Math.round(it.quantidade * it.preco_unitario * 100) !== Math.round(l.valor * 100)) { it.quantidade = 1; it.unidade = 'vb'; it.preco_unitario = l.valor; }
    it.total = Math.round(it.quantidade * it.preco_unitario * 100) / 100;
    if (l.principal) it.etapas = etapas.map((e) => ({ nome: e.nome, descricao: e.descricao, percentual: e.percentual, duracao_dias: e.prazo_dias }));
    return it;
  });
  const total = Math.round(principal.valor * 100);
  const forma = (s(r, 'pagamento') || base.pagamento_padrao) as FormaPagamento;
  const parcelas = pagamento(forma, total, n(r, 'parcelas', 3), etapas, q(pp, 'entrada_pct'));
  const desc = q(pp, 'desconto_avista_pct');
  const avista = desc > 0 ? arred10(principal.valor * (1 - desc / 100)) : 0;

  // Inclusões/exclusões do pacote escolhido: o que fica de fora aparece como opcional.
  const inclusos = [...base.inclusoes, ...base.linhas.filter((l) => l.pacote > 1 && l.pacote <= principal.numero && l.valor > 0).map((l) => l.titulo)];
  const foraDoPacote = base.pacotes.length > 1 ? base.linhas.filter((l) => l.pacote > principal.numero && l.valor > 0).map((l) => `${l.titulo} (disponível no pacote ${base.pacotes[l.pacote - 1].nome})`) : [];

  const opcoes: OpcaoProposta[] = pacotes.length > 1 ? pacotes.map((pc) => ({
    nome: pc.nome, subtitulo: pc.subtitulo, valor: pc.valor, destaques: pc.destaques, recomendado: pc.numero === 2, principal: pc.numero === principal.numero,
  })) : [];

  const vazio = ctx.base ?? conteudoVazio();
  const conteudo: Conteudo = {
    ...vazio,
    apresentacao: vazio.apresentacao || APRESENTACAO_PADRAO,
    necessidade: ctx.necessidade?.trim() || vazio.necessidade || '',
    local: ctx.local ?? vazio.local,
    ambientes: [{ id: novoId(), nome: def.nome, itens }],
    inclusoes: inclusos,
    exclusoes: [...base.exclusoes, ...foraDoPacote],
    responsabilidades: base.responsabilidades,
    etapas,
    prazo_texto: `${textoPrazo(prazoTotal)}, a contar do aceite, do pagamento do sinal e do recebimento das informações necessárias.`,
    pagamento: {
      descricao: `${rotuloDe(CAMPOS_COMUNS, 'pagamento', forma)}. Pix, transferência ou boleto.${avista ? ` À vista: ${reaisFmt(avista)} (${fmtN(desc, 1)}% de desconto).` : ''}`,
      parcelas,
    },
    premissas: base.premissas,
    garantia: base.garantia,
    validade_dias: Math.max(1, Math.round(q(pp, 'validade_dias')) || 15),
    tipo_servico: tipo,
    resumo: base.resumo,
    dados_tecnicos: base.dados,
    entregaveis: base.entregaveis,
    metodologia: base.metodologia,
    riscos: base.riscos,
    normas: base.normas,
    diferenciais: [...DIFERENCIAIS, base.diferencial],
    faq: base.faq,
    opcoes,
    condicao_especial: avista ? `Pagamento à vista com ${fmtN(desc, 1)}% de desconto: ${reaisFmt(avista)}, para aceite dentro da validade.` : '',
    prazo_total_dias: prazoTotal,
    gerador: { tipo, respostas: r, pacote: principal.numero, em: new Date().toISOString() },
  };

  const custos = principal.linhas.filter((l) => l.custo > 0).map((l) => ({ descricao: l.titulo, valor: Math.round(l.custo) }));
  const custo = custos.reduce((t, c) => t + c.valor, 0);
  const margem = principal.valor - custo;
  const avisos = [...base.avisos, ...faltando(tipo, r).map((x) => `Preencha: ${x}.`)];
  if (principal.valor > 0 && margem / principal.valor < 0.15) avisos.push('Margem estimada abaixo de 15%: revise preço ou custos antes de enviar.');
  return {
    tipo, titulo: base.titulo, pacotes, principal, base, conteudo, custos,
    analise: { preco: principal.valor, custo, margem, margem_pct: principal.valor ? (margem / principal.valor) * 100 : 0, horas: base.horas, valor_hora: base.horas ? principal.valor / base.horas : undefined },
    avisos: Array.from(new Set(avisos)),
  };
}

export const NOME_TIPO: Record<TipoServico, string> = Object.fromEntries(TIPOS.map((t) => [t, DEFINICOES[t].nome])) as Record<TipoServico, string>;
