// Entrega de documentos ao cliente e os passos do ciclo da obra (iniciar, entregar, encerrar).
// Sem acesso a banco: tudo aqui é testável sem rede.
import type { Perfil } from './jornada';
import type { StatusObra } from '../lib/tipos';

/** Serviços cujo resultado é um documento (pranchas, laudo, processo): a entrega vai por arquivo. */
export const PERFIS_DE_DOCUMENTO: Perfil[] = ['projeto', 'arquitetura', 'laudo', 'regularizacao'];
export const entregaPorDocumento = (perfil: Perfil) => PERFIS_DE_DOCUMENTO.includes(perfil);

/** Como chamar o trabalho nos botões ("Iniciar projeto", "Entregar laudo"). */
export function nomeDoTrabalho(perfil: Perfil): { nome: string; artigo: 'o' | 'a' } {
  switch (perfil) {
    case 'projeto': case 'arquitetura': return { nome: 'projeto', artigo: 'o' };
    case 'laudo': return { nome: 'laudo', artigo: 'o' };
    case 'regularizacao': return { nome: 'processo', artigo: 'o' };
    case 'gestao': return { nome: 'serviço', artigo: 'o' };
    default: return { nome: 'obra', artigo: 'a' };
  }
}

/** Fase do ciclo, para a barra de passos no alto da obra. */
export type Passo = 'aguardando' | 'andamento' | 'entregue' | 'encerrada';
export function passoDaObra(status: StatusObra): Passo | 'cancelada' {
  if (status === 'cancelada') return 'cancelada';
  if (status === 'em_execucao') return 'andamento';
  if (status === 'concluida_fisicamente') return 'entregue';
  if (status === 'encerrada_financeiramente') return 'encerrada';
  return 'aguardando';
}

type Instrucoes = { titulo: string; abertura: string; itens: string[] };

/** Instruções que acompanham cada tipo de entrega: como usar o material e o que fazer em seguida. */
export const INSTRUCOES: Partial<Record<Perfil, Instrucoes>> = {
  projeto: {
    titulo: 'Projeto estrutural',
    abertura: 'Seguem os arquivos do projeto estrutural, prontos para a execução.',
    itens: [
      'Entregue as pranchas ao responsável pela execução antes de começar a obra e peça para ele conferir tudo com antecedência.',
      'Imprima no tamanho indicado em cada prancha (A1, A2 ou A3), sem reduzir: as cotas e as escalas dependem disso.',
      'Siga as especificações do projeto: classe do concreto (fck), cobrimento, bitolas, espaçamentos e posição das armaduras.',
      'Não faça mudanças em pilares, vigas, lajes ou fundações sem consultar a ROSAE: qualquer alteração precisa de revisão do cálculo.',
      'Se a arquitetura mudar, avise antes de executar a parte afetada, para compatibilizarmos.',
      'Guarde a ART e os arquivos: eles fazem parte da documentação do imóvel.',
    ],
  },
  arquitetura: {
    titulo: 'Projeto arquitetônico',
    abertura: 'Seguem os arquivos do projeto arquitetônico.',
    itens: [
      'Entregue as pranchas a quem vai executar e aos demais projetistas (estrutura, elétrica, hidráulica) para compatibilização.',
      'Imprima no tamanho indicado, sem reduzir, para manter as escalas.',
      'Confira medidas no local antes de encomendar marcenaria, esquadrias e revestimentos.',
      'Mudanças de layout durante a obra devem ser combinadas antes, para atualizarmos o projeto.',
      'Guarde a RRT/ART e os arquivos junto com a documentação do imóvel.',
    ],
  },
  laudo: {
    titulo: 'Laudo técnico',
    abertura: 'Segue o laudo técnico com as conclusões da vistoria.',
    itens: [
      'Leia primeiro a conclusão e as recomendações: elas estão em ordem de prioridade.',
      'As recomendações urgentes devem ser providenciadas o quanto antes, com profissional habilitado.',
      'O laudo vale para as condições encontradas na data da vistoria. Mudanças no imóvel podem pedir nova avaliação.',
      'Guarde o laudo e a ART: podem ser pedidos pelo condomínio, pela seguradora ou em processos.',
    ],
  },
  regularizacao: {
    titulo: 'Regularização do imóvel',
    abertura: 'Seguem os documentos da regularização do imóvel.',
    itens: [
      'Guarde os originais assinados e as guias pagas em local seguro.',
      'Confira os dados do imóvel e dos proprietários. Qualquer divergência, nos avise antes de protocolar.',
      'Leve estes documentos quando o cartório ou a prefeitura pedirem, e avise a ROSAE sobre qualquer exigência que chegar.',
      'Mudanças futuras no imóvel podem exigir nova aprovação: consulte antes de construir ou reformar.',
    ],
  },
};

const INSTRUCOES_GERAIS: Instrucoes = {
  titulo: 'Documentos',
  abertura: 'Seguem os documentos do serviço.',
  itens: [
    'Guarde os arquivos junto com a documentação do imóvel.',
    'Qualquer dúvida sobre o material, fale com a ROSAE antes de executar.',
  ],
};

export function instrucoesDe(perfil: Perfil): Instrucoes {
  return INSTRUCOES[perfil] ?? INSTRUCOES_GERAIS;
}

/** Título sugerido da entrega ("Projeto estrutural · Casa Itaipu"). */
export function tituloDaEntrega(perfil: Perfil, obra: string): string {
  return `${instrucoesDe(perfil).titulo} · ${obra}`.slice(0, 160);
}

/** Mensagem pronta da entrega, com as instruções do tipo de serviço. */
export function mensagemDaEntrega(perfil: Perfil, d: { cliente?: string | null; responsavel?: string | null }): string {
  const i = instrucoesDe(perfil);
  const primeiro = (d.cliente ?? '').trim().split(/\s+/)[0] ?? '';
  const ola = primeiro ? `Olá, ${primeiro}!` : 'Olá!';
  return [
    ola,
    `${i.abertura} Pelo link você baixa os arquivos sempre que precisar.`,
    `Algumas orientações importantes:\n${i.itens.map((x) => `• ${x}`).join('\n')}`,
    'Qualquer dúvida sobre o material, é só me chamar. Foi um prazer trabalhar com você!',
    d.responsavel ? d.responsavel : '',
  ].filter(Boolean).join('\n\n');
}

/** Texto para o WhatsApp: a mensagem e o link para baixar. */
export function textoWhatsAppEntrega(mensagem: string, link: string): string {
  return `${mensagem.trim()}\n\n*Baixar os documentos:*\n${link}`;
}

/** Tamanho legível ("2,4 MB"). */
export function tamanhoLegivel(bytes: number | null | undefined): string {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

export const ARQUIVO_MAX_BYTES = 50 * 1024 * 1024;

/** Nome seguro para a pasta do Storage, mantendo a extensão. */
export function nomeParaCaminho(nome: string): string {
  const limpo = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return (limpo || 'arquivo').slice(-120);
}

/** Tipo do arquivo para o Storage (DWG e DXF costumam chegar sem tipo do navegador). */
export function tipoDoArquivo(nome: string, tipo: string): string {
  if (tipo) return tipo;
  const ext = nome.split('.').pop()?.toLowerCase();
  if (ext === 'dwg') return 'image/vnd.dwg';
  if (ext === 'dxf') return 'application/dxf';
  if (ext === 'zip') return 'application/zip';
  if (ext === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
}

// ---------------------------------------------------------------------
// Etapas em lote: "Fundação 10 dias", uma por linha.
// ---------------------------------------------------------------------
export type EtapaRapida = { nome: string; dias: number | null };

/** Lê uma etapa por linha. A duração pode vir no fim: "Fundação 10 dias", "Pintura - 5d", "Laje (7)". */
export function lerEtapas(texto: string): EtapaRapida[] {
  return texto.split(/\n|;/).map((l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim()).filter(Boolean).map((l) => {
    // Duração só quando está clara: "10 dias", "5d" ou "(7)" no fim. "Etapa 2" continua sendo nome.
    const m = l.match(/^(.*?)[\s,:–—-]*(?:\(\s*(\d{1,3})\s*(?:dias?|d)?\s*\)|(\d{1,3})\s*(?:dias?|d))\s*$/i);
    const dias = m ? Number(m[2] ?? m[3]) : 0;
    if (m && m[1].trim() && dias > 0) return { nome: m[1].trim().slice(0, 120), dias };
    return { nome: l.slice(0, 120), dias: null };
  });
}
