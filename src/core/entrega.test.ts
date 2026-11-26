import { describe, expect, it } from 'vitest';
import { entregaPorDocumento, lerEtapas, mensagemDaEntrega, nomeDoTrabalho, nomeParaCaminho, passoDaObra, tamanhoLegivel, textoWhatsAppEntrega, tipoDoArquivo, tituloDaEntrega } from './entrega';

describe('etapas em lote', () => {
  it('uma por linha, com a duração quando está clara', () => {
    expect(lerEtapas('Fundação 10 dias\nAlvenaria - 15d\n• Laje (7)\nPintura\n\nEtapa 2')).toEqual([
      { nome: 'Fundação', dias: 10 }, { nome: 'Alvenaria', dias: 15 }, { nome: 'Laje', dias: 7 }, { nome: 'Pintura', dias: null }, { nome: 'Etapa 2', dias: null },
    ]);
  });
  it('aceita lista numerada e ponto e vírgula', () => {
    expect(lerEtapas('1. Levantamento 3 dias; 2) Cálculo').map((e) => e.nome)).toEqual(['Levantamento', 'Cálculo']);
  });
});

describe('entrega de documentos', () => {
  it('só os serviços que terminam em documento', () => {
    expect(entregaPorDocumento('projeto')).toBe(true);
    expect(entregaPorDocumento('laudo')).toBe(true);
    expect(entregaPorDocumento('reforma')).toBe(false);
  });
  it('mensagem pronta com o primeiro nome e as instruções do tipo', () => {
    const m = mensagemDaEntrega('projeto', { cliente: 'Carlos Souza', responsavel: 'Eng. Rhuann Rosa' });
    expect(m.startsWith('Olá, Carlos!')).toBe(true);
    expect(m).toContain('pilares, vigas, lajes');
    expect(m.endsWith('Eng. Rhuann Rosa')).toBe(true);
    expect(mensagemDaEntrega('reforma', {})).toContain('Seguem os documentos');
  });
  it('título, WhatsApp e nomes de arquivo', () => {
    expect(tituloDaEntrega('laudo', 'Casa Itaipu')).toBe('Laudo técnico · Casa Itaipu');
    expect(textoWhatsAppEntrega('Olá', 'https://x/e/t')).toBe('Olá\n\n*Baixar os documentos:*\nhttps://x/e/t');
    expect(nomeParaCaminho('Prancha Fundação 01.pdf')).toBe('Prancha-Fundacao-01.pdf');
    expect(tipoDoArquivo('Formas.DWG', '')).toBe('image/vnd.dwg');
    expect(tipoDoArquivo('a.pdf', 'application/pdf')).toBe('application/pdf');
    expect(tamanhoLegivel(2_500_000)).toBe('2,4 MB');
  });
  it('passos e nomes do ciclo', () => {
    expect(passoDaObra('aprovada')).toBe('aguardando');
    expect(passoDaObra('concluida_fisicamente')).toBe('entregue');
    expect(nomeDoTrabalho('projeto').nome).toBe('projeto');
    expect(nomeDoTrabalho('reforma').artigo).toBe('a');
  });
});
