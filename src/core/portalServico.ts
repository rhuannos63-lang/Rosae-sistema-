// Portal do cliente ajustado a cada tipo de serviço: vocabulário, o que o cliente faz em
// cada fase, o que costumamos pedir, cuidados na obra, dúvidas frequentes e termos técnicos.
// Também calcula a linha do tempo das fases e o próximo marco, a partir das etapas publicadas.
import { faseEtapa, type EtapaPortal } from './portal';
import { PERFIS, type FaseCalculada, type Perfil } from './jornada';

export type ConfigServico = {
  /** Como o trabalho é chamado nos textos ("Acompanhe a sua obra"). */
  trabalho: 'obra' | 'projeto' | 'laudo' | 'processo';
  /** Serviço com execução física: mostra ambientes, materiais, medições e cuidados na obra. */
  campo: boolean;
  /** Nome da galeria: fotos da obra ou imagens do projeto. */
  galeria: string;
  /** Como o cliente participa em cada fase (pelo id da fase). */
  voce: Record<string, string>;
  /** O que costumamos pedir ao cliente neste tipo de serviço. */
  pedimos: string[];
  /** Cuidados durante a execução (só serviços de campo). */
  cuidados: string[];
  duvidas: { p: string; r: string }[];
  termos: { t: string; d: string }[];
};

const DUVIDA_AJUSTE = { p: 'Posso pedir uma mudança?', r: 'Pode, a qualquer momento, pela aba Mensagens (escolha “Solicitação de ajuste”). Se a mudança alterar escopo, preço ou prazo, a ROSAE envia um adicional para você aprovar antes de fazer.' };
const DUVIDA_CIENTE = { p: 'O que quer dizer “Estou ciente”?', r: 'Que você leu aquela atualização. Não é aprovação técnica, quitação nem aceite de contrato: serve para a ROSAE saber que a informação chegou até você.' };

export const SERVICO: Record<Perfil, ConfigServico> = {
  projeto: {
    trabalho: 'projeto', campo: false, galeria: 'Imagens',
    voce: {
      levantamento: 'Envie a arquitetura (de preferência em DWG), a sondagem do solo, se tiver, e conte como pretende usar cada ambiente.',
      concepcao: 'Se a arquitetura mudar, avise agora: mudar nesta fase é rápido e não gera retrabalho.',
      calculo: 'Fase técnica: não precisa fazer nada. Perguntas são bem-vindas a qualquer hora.',
      detalhamento: 'Mudanças de arquitetura agora mexem em várias pranchas. Fale antes com a ROSAE.',
      entrega: 'Confira as pranchas recebidas e guarde a ART: a obra e a prefeitura vão pedir.',
    },
    pedimos: ['Projeto arquitetônico atualizado (DWG ou PDF)', 'Sondagem do solo (SPT), quando houver', 'Uso previsto de cada ambiente e cargas especiais (piscina, caixa-d’água, maquinário)', 'Dados do imóvel e do proprietário para a ART'],
    cuidados: [],
    duvidas: [
      { p: 'Quanto tempo leva cada fase?', r: 'As datas previstas aparecem na linha do tempo. O cálculo e o detalhamento são as fases mais longas; a concepção depende da arquitetura estar fechada.' },
      { p: 'Posso começar a obra antes do projeto ficar pronto?', r: 'A fundação só pode começar com as pranchas de fundação liberadas. Se houver pressa, fale com a ROSAE: dá para priorizar essa parte.' },
      { p: 'O que recebo no final?', r: 'As pranchas assinadas (formas e armações), o memorial quando previsto na proposta e a ART registrada no CREA.' },
      DUVIDA_AJUSTE,
    ],
    termos: [
      { t: 'ART', d: 'Anotação de Responsabilidade Técnica: o registro no CREA de que um engenheiro responde pelo projeto.' },
      { t: 'Prancha', d: 'Cada folha de desenho do projeto, com plantas, cortes e detalhes.' },
      { t: 'Forma', d: 'Desenho com as medidas de pilares, vigas e lajes, como se vê a estrutura de concreto.' },
      { t: 'Armação', d: 'Desenho das barras de aço dentro do concreto: bitola, quantidade e posição.' },
      { t: 'Sondagem (SPT)', d: 'Ensaio do solo que mostra a resistência do terreno; define o tipo de fundação.' },
    ],
  },
  arquitetura: {
    trabalho: 'projeto', campo: false, galeria: 'Imagens',
    voce: {
      briefing: 'Conte sua rotina, gostos e referências (fotos, Pinterest). Quanto mais detalhe, melhor o primeiro estudo.',
      estudo: 'Escolha a opção de layout que mais combina com você e diga o que mudaria.',
      anteprojeto: 'Aprove o volume, as fachadas e os materiais. Depois desta fase, mudanças grandes viram revisão.',
      legal: 'Separe os documentos do imóvel que a prefeitura pedir. A ROSAE avisa cada exigência por aqui.',
      executivo: 'Confira o projeto final e guarde os arquivos e a ART/RRT para a obra.',
    },
    pedimos: ['Escritura ou matrícula e IPTU do imóvel', 'Levantamento do terreno ou da construção existente, se houver', 'Referências de estilo e lista de ambientes desejados', 'Orçamento pretendido para a obra'],
    cuidados: [],
    duvidas: [
      { p: 'Quantas opções de layout eu vejo?', r: 'O estudo preliminar apresenta as opções previstas na proposta. Ajustes na opção escolhida fazem parte do anteprojeto.' },
      { p: 'Quanto tempo a prefeitura demora?', r: 'Depende do município e das exigências. O prazo do órgão não é controlado pela ROSAE, mas cada movimento do processo aparece aqui.' },
      { p: 'O que recebo no final?', r: 'O projeto executivo com plantas, cortes, fachadas e detalhes, além do responsável técnico registrado.' },
      DUVIDA_AJUSTE,
    ],
    termos: [
      { t: 'Estudo preliminar', d: 'Primeira proposta de distribuição dos ambientes, ainda sem detalhes.' },
      { t: 'Anteprojeto', d: 'A solução escolhida com volumes, fachadas e materiais definidos.' },
      { t: 'Projeto legal', d: 'Versão do projeto no formato exigido pela prefeitura para aprovação.' },
      { t: 'Projeto executivo', d: 'O projeto completo e detalhado que a obra segue.' },
    ],
  },
  reforco: {
    trabalho: 'obra', campo: true, galeria: 'Fotos',
    voce: {
      diagnostico: 'Garanta acesso aos locais da vistoria e conte desde quando percebeu trincas, ferrugem ou deformações.',
      projeto: 'Fase técnica: a ROSAE define a solução. Pergunte o que quiser sobre ela.',
      preparo: 'Não mexa no escoramento e mantenha pessoas e móveis fora da área isolada.',
      execucao: 'Evite carregar a área reforçada até a liberação da engenharia (cura dos materiais).',
      entrega: 'Confira o resultado e guarde a documentação e a ART do reforço.',
    },
    pedimos: ['Acesso livre às áreas da estrutura', 'Projetos antigos da edificação, se existirem', 'Autorização do condomínio, quando for o caso', 'Ponto de energia e água para os equipamentos'],
    cuidados: ['Escoras e isolamentos só são retirados pela equipe, com liberação da engenharia.', 'Não carregue a área reforçada antes da liberação: os materiais precisam de tempo de cura.', 'Avise na hora qualquer barulho, trinca nova ou deformação.'],
    duvidas: [
      { p: 'É seguro ficar no imóvel durante o reforço?', r: 'Na maioria dos casos, sim, respeitando as áreas isoladas. Quando não for, a ROSAE avisa antes, por aqui.' },
      { p: 'Por que o escoramento fica tanto tempo?', r: 'O reforço só trabalha depois da cura do concreto, do graute ou da resina. Retirar antes compromete o resultado.' },
      { p: 'O que recebo no final?', r: 'O relatório do que foi executado, as fotos de cada etapa e a ART do serviço.' },
      DUVIDA_CIENTE,
    ],
    termos: [
      { t: 'Escoramento', d: 'Apoios provisórios que seguram a estrutura enquanto ela é reforçada.' },
      { t: 'Encamisamento', d: 'Aumentar um pilar ou viga com nova armadura e concreto em volta.' },
      { t: 'Fibra de carbono', d: 'Mantas coladas na peça que aumentam a resistência sem aumentar o tamanho.' },
      { t: 'Graute', d: 'Argamassa fluida e muito resistente usada para preencher e reforçar.' },
      { t: 'Cura', d: 'Tempo que o material leva para atingir a resistência; não pode ser apressado.' },
    ],
  },
  reforma: {
    trabalho: 'obra', campo: true, galeria: 'Fotos',
    voce: {
      preparo: 'Retire objetos de valor e combine o horário de acesso da equipe.',
      infra: 'Confirme a posição de tomadas, pontos de água e iluminação: depois de fechar a parede, mudar custa mais.',
      base: 'Hora de fechar a escolha de revestimentos, louças e metais, se ainda faltar.',
      acabamento: 'Acompanhe as escolhas sendo instaladas e aponte qualquer detalhe pelo comentário da etapa.',
      entrega: 'Faça a vistoria junto com a ROSAE e anote o que precisar de ajuste.',
    },
    pedimos: ['Escolha de revestimentos, louças, metais e cores (com prazo para não parar a obra)', 'Autorização e regras do condomínio (horários, elevador, caçamba)', 'Acesso ao imóvel nos dias de trabalho', 'Compras por sua conta, quando combinadas na proposta'],
    cuidados: ['A equipe trabalha nos horários permitidos pelo condomínio.', 'Mantenha crianças e animais longe da área em obra.', 'Itens que ficam no ambiente são protegidos, mas objetos de valor devem ser retirados.'],
    duvidas: [
      { p: 'A obra pode parar por falta de material?', r: 'Pode, se uma escolha ou compra atrasar. Por isso a aba Etapas mostra a situação de cada material e o prazo de cada decisão.' },
      { p: 'Como acompanho cada ambiente?', r: 'Na aba Ambientes você vê o andamento e as fotos de cada cômodo.' },
      { p: 'O que é a medição?', r: 'Um registro do quanto foi executado até uma data. Você confere e aprova ou aponta o que não confere.' },
      DUVIDA_AJUSTE,
    ],
    termos: [
      { t: 'Contrapiso', d: 'Camada de argamassa que nivela o piso antes do revestimento.' },
      { t: 'Impermeabilização', d: 'Proteção contra água em áreas molhadas, antes do piso.' },
      { t: 'Rejunte', d: 'Material entre as peças de revestimento.' },
      { t: 'Medição', d: 'Registro do percentual executado em cada etapa até uma data de corte.' },
    ],
  },
  construcao: {
    trabalho: 'obra', campo: true, galeria: 'Fotos',
    voce: {
      fundacao: 'Garanta o terreno limpo e acessível, com a documentação do imóvel em dia.',
      estrutura: 'Visite a obra com a ROSAE se quiser ver a armação antes da concretagem.',
      vedacao: 'Confirme portas, janelas e a posição das paredes: ainda é fácil ajustar.',
      instalacoes: 'Confirme tomadas, interruptores, pontos de água e de ar-condicionado antes do reboco.',
      acabamentos: 'Feche as escolhas de revestimentos, louças e cores no prazo de cada decisão.',
      entrega: 'Faça a vistoria final com a ROSAE e receba o manual do proprietário.',
    },
    pedimos: ['Documentação do terreno e projeto aprovado / alvará', 'Escolhas de acabamento no prazo de cada decisão', 'Ligações provisórias de água e energia, quando por sua conta', 'Compras por sua conta, quando combinadas na proposta'],
    cuidados: ['Visitas à obra são combinadas com a ROSAE e feitas com calçado fechado.', 'Não suba em lajes ou andaimes sem acompanhamento.', 'Concretagem tem dia marcado: chuva forte pode adiar, por segurança.'],
    duvidas: [
      { p: 'Posso visitar a obra?', r: 'Pode e deve. Combine pelo Mensagens para alguém da ROSAE acompanhar.' },
      { p: 'O percentual inclui compras e pagamentos?', r: 'Não. Ele mede só o serviço executado, pelo peso técnico de cada etapa.' },
      { p: 'O que é “conferido pela engenharia”?', r: 'A parte do executado que já foi inspecionada pela ROSAE e está dentro do projeto.' },
      DUVIDA_AJUSTE,
    ],
    termos: [
      { t: 'Baldrame', d: 'Viga na base das paredes, ligada à fundação.' },
      { t: 'Concretagem', d: 'O dia em que o concreto é lançado em pilares, vigas ou lajes.' },
      { t: 'Alvenaria', d: 'As paredes de blocos ou tijolos.' },
      { t: 'Habite-se', d: 'Documento da prefeitura que confirma que o imóvel pode ser ocupado.' },
      { t: 'Medição', d: 'Registro do percentual executado em cada etapa até uma data de corte.' },
    ],
  },
  laudo: {
    trabalho: 'laudo', campo: false, galeria: 'Fotos',
    voce: {
      vistoria: 'Garanta acesso a todos os ambientes e conte o histórico do problema (quando começou, o que já foi feito).',
      ensaios: 'Pode ser preciso voltar ao imóvel para medir ou ensaiar. A ROSAE combina a data por aqui.',
      analise: 'Fase técnica. Se lembrar de alguma informação nova, mande pelo Mensagens.',
      redacao: 'Nada a fazer agora: o laudo está sendo escrito.',
      entrega: 'Leia o laudo com calma e tire as dúvidas na reunião de apresentação.',
    },
    pedimos: ['Acesso a todos os ambientes do imóvel', 'Projetos, plantas e documentos do imóvel, se existirem', 'Histórico do problema e fotos antigas', 'Contatos de vizinhos ou do síndico, quando a vistoria envolver áreas comuns'],
    cuidados: [],
    duvidas: [
      { p: 'O laudo serve para a Justiça ou para o seguro?', r: 'Ele é técnico, com ART, e pode ser usado nesses casos. O objetivo combinado está na proposta.' },
      { p: 'Vou saber o resultado antes do laudo pronto?', r: 'As observações importantes da vistoria aparecem nas atualizações. A conclusão vem no laudo, depois da análise.' },
      { p: 'O que recebo no final?', r: 'O laudo assinado, com fotos, conclusões e recomendações, e a ART registrada.' },
      DUVIDA_CIENTE,
    ],
    termos: [
      { t: 'ART', d: 'Anotação de Responsabilidade Técnica: o registro no CREA de que um engenheiro responde pelo laudo.' },
      { t: 'Patologia', d: 'Na engenharia, qualquer defeito da construção: trinca, infiltração, corrosão.' },
      { t: 'Esclerometria', d: 'Ensaio que estima a resistência do concreto sem quebrar a peça.' },
      { t: 'Nexo causal', d: 'A ligação entre a causa e o dano observado.' },
    ],
  },
  regularizacao: {
    trabalho: 'processo', campo: false, galeria: 'Imagens',
    voce: {
      levantamento: 'Envie matrícula, IPTU e documentos pessoais. Garanta acesso para a medição do imóvel.',
      plantas: 'Confira os dados das plantas (nomes, áreas, confrontantes) antes do protocolo.',
      protocolo: 'Pode ser preciso assinar requerimentos. A ROSAE avisa por aqui.',
      exigencias: 'Responda rápido quando houver exigência: cada dia parado atrasa o processo.',
      registro: 'Guarde a certidão e a matrícula atualizada.',
    },
    pedimos: ['Matrícula atualizada e IPTU', 'Documentos pessoais dos proprietários', 'Plantas ou alvarás antigos, se existirem', 'Taxas e emolumentos dos órgãos, quando por sua conta'],
    cuidados: [],
    duvidas: [
      { p: 'Quanto tempo leva?', r: 'Depende da prefeitura e do cartório. Os prazos dos órgãos não são controlados pela ROSAE, mas cada movimento do processo aparece aqui.' },
      { p: 'O que é uma exigência?', r: 'Um pedido do órgão para ajustar ou completar algo. A ROSAE responde e mostra cada uma por aqui.' },
      { p: 'O que recebo no final?', r: 'A aprovação ou certidão do órgão e a matrícula atualizada, conforme o objetivo da proposta.' },
      DUVIDA_CIENTE,
    ],
    termos: [
      { t: 'Matrícula', d: 'O “RG” do imóvel no cartório de registro.' },
      { t: 'Averbação', d: 'Anotar na matrícula uma mudança, como a construção existente.' },
      { t: 'Habite-se', d: 'Documento da prefeitura que confirma que o imóvel pode ser ocupado.' },
      { t: 'Exigência', d: 'Pedido do órgão para completar ou corrigir o processo.' },
    ],
  },
  gestao: {
    trabalho: 'obra', campo: true, galeria: 'Fotos',
    voce: {
      planejamento: 'Aprove o cronograma e diga as datas que não podem mudar.',
      contratacao: 'A ROSAE apresenta as opções de equipes e fornecedores. Aprove ou peça outra cotação.',
      execucao: 'Acompanhe por aqui e responda às decisões no prazo para a obra não parar.',
      conferencia: 'Aponte pelo comentário da etapa qualquer detalhe que não estiver como esperado.',
      entrega: 'Faça a vistoria final com a ROSAE e receba a documentação.',
    },
    pedimos: ['Projetos e orçamento da obra', 'Aprovação das contratações e compras', 'Decisões no prazo indicado em cada uma', 'Acesso à obra'],
    cuidados: ['Visitas à obra são combinadas com a ROSAE e feitas com calçado fechado.', 'Decisões atrasadas podem parar equipes: acompanhe a área “Aguardando você”.'],
    duvidas: [
      { p: 'Quem contrata as equipes?', r: 'O combinado está na proposta. Em todo caso, cada contratação aparece aqui para você acompanhar.' },
      { p: 'O que é “conferido pela engenharia”?', r: 'A parte do executado que já foi inspecionada pela ROSAE.' },
      DUVIDA_AJUSTE,
      DUVIDA_CIENTE,
    ],
    termos: [
      { t: 'Cronograma', d: 'A sequência das etapas com datas previstas.' },
      { t: 'Medição', d: 'Registro do percentual executado em cada etapa até uma data de corte.' },
      { t: 'Cotação', d: 'Preço pedido a fornecedores para comparar antes de comprar.' },
    ],
  },
};

const DIA = 86400000;
const t = (iso: string) => Date.parse(iso.slice(0, 10) + 'T12:00:00Z');

/** Dias entre hoje e a data (positivo = futuro). */
export function diasAte(data: string, hoje: string): number {
  return Math.round((t(data) - t(hoje)) / DIA);
}

/** "hoje", "ontem", "há 3 dias", "há 2 semanas"... */
export function haQuanto(iso: string | null | undefined, hoje: string): string {
  if (!iso) return '';
  const d = -diasAte(iso, hoje);
  if (d <= 0) return 'hoje';
  if (d === 1) return 'ontem';
  if (d < 14) return `há ${d} dias`;
  if (d < 60) return `há ${Math.floor(d / 7)} semanas`;
  return `há ${Math.floor(d / 30)} meses`;
}

/** "amanhã", "em 5 dias", "hoje", "há 2 dias". */
export function emQuanto(data: string, hoje: string): string {
  const d = diasAte(data, hoje);
  if (d === 0) return 'hoje';
  if (d === 1) return 'amanhã';
  if (d > 1) return `em ${d} dias`;
  return d === -1 ? 'ontem' : `há ${-d} dias`;
}

const inicioEtapa = (e: EtapaPortal) => e.inicio_real ?? e.inicio_previsto;
const fimEtapa = (e: EtapaPortal) => e.fim_real ?? e.fim_previsto;

export type FaseNoTempo = { id: string; nome: string; estado: FaseCalculada['estado']; inicio: string; fim: string; esquerda: number; largura: number };
export type LinhaDoTempo = { inicio: string; fim: string; fases: FaseNoTempo[]; hoje: number | null };

/** Período de cada fase pelas datas das suas etapas (real antes de previsto), em % do período total. */
export function linhaDoTempo(fases: FaseCalculada[], hoje: string): LinhaDoTempo | null {
  const comDatas = fases.map((f) => {
    const ini = f.etapas.map(inicioEtapa).filter(Boolean).sort()[0] ?? f.etapas.map(fimEtapa).filter(Boolean).sort()[0];
    const fim = f.etapas.map(fimEtapa).filter(Boolean).sort().at(-1) ?? ini;
    return ini && fim ? { f, ini: ini.slice(0, 10), fim: (fim < ini ? ini : fim).slice(0, 10) } : null;
  }).filter((x): x is { f: FaseCalculada; ini: string; fim: string } => !!x);
  if (comDatas.length < 2) return null;
  const inicio = comDatas.map((x) => x.ini).sort()[0];
  const fim = comDatas.map((x) => x.fim).sort().at(-1)!;
  const total = Math.max(1, diasAte(fim, inicio) + 1);
  const pct = (d: string) => (diasAte(d, inicio) / total) * 100;
  const h = pct(hoje);
  return {
    inicio, fim,
    fases: comDatas.map(({ f, ini, fim: ff }) => ({ id: f.id, nome: f.nome, estado: f.estado, inicio: ini, fim: ff, esquerda: pct(ini), largura: Math.max(2, ((diasAte(ff, ini) + 1) / total) * 100) })),
    hoje: h >= 0 && h <= 100 ? h : null,
  };
}

export type Marco = { titulo: string; data: string; quando: string };

/** Próximo marco: o fim previsto da fase em andamento; senão o início da próxima etapa; senão o término previsto. */
export function proximoMarco(fases: FaseCalculada[], etapas: EtapaPortal[], previsaoFim: string | null, hoje: string): Marco | null {
  const atual = fases.find((f) => f.estado === 'atual');
  if (atual) {
    const fins = atual.etapas.filter((e) => faseEtapa(e) !== 'concluida').map((e) => e.fim_previsto).filter((d): d is string => !!d && diasAte(d, hoje) >= 0).sort();
    if (fins.length) { const d = fins.at(-1)!; return { titulo: `Fim da fase ${atual.nome}`, data: d, quando: emQuanto(d, hoje) }; }
  }
  const prox = etapas.filter((e) => faseEtapa(e) === 'futura' && e.inicio_previsto && diasAte(e.inicio_previsto, hoje) >= 0)
    .sort((a, b) => a.inicio_previsto!.localeCompare(b.inicio_previsto!))[0];
  if (prox) return { titulo: `Início: ${prox.nome}`, data: prox.inicio_previsto!, quando: emQuanto(prox.inicio_previsto!, hoje) };
  if (previsaoFim && diasAte(previsaoFim, hoje) >= 0) return { titulo: 'Término previsto', data: previsaoFim, quando: emQuanto(previsaoFim, hoje) };
  return null;
}

/** Palavra do trabalho com artigo: "sua obra", "seu projeto", "seu laudo", "seu processo". */
export function seuTrabalho(perfil: Perfil): string {
  const p = SERVICO[perfil].trabalho;
  return `${p === 'obra' ? 'sua' : 'seu'} ${p}`;
}

/** Nome do serviço para o cliente. */
export const nomeServico = (perfil: Perfil) => PERFIS[perfil].nome;

/** "da obra", "do projeto", "do laudo", "do processo". */
export function doTrabalho(perfil: Perfil): string {
  const p = SERVICO[perfil].trabalho;
  return p === 'obra' ? 'da obra' : `do ${p}`;
}
