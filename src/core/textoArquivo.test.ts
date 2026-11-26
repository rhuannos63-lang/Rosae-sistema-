import { describe, expect, it } from 'vitest';
import { consertarCodificacao, nomeDeArquivo, textoLimpo } from './textoArquivo';

describe('nome do arquivo com acentos', () => {
  it('mantém cedilha, til e acento', () => {
    expect(nomeDeArquivo('Proposta PROP-2026-0011 v1 - Gaffer Soluções Metálicas')).toBe('Proposta PROP-2026-0011 v1 - Gaffer Soluções Metálicas.pdf');
  });
  it('junta acentos digitados separados (NFD) num caractere só', () => {
    const nfd = 'Gaffer Soluções Metálicas'.normalize('NFD');
    const nome = nomeDeArquivo(nfd);
    expect(nome).toBe('Gaffer Soluções Metálicas.pdf');
    expect(nome).toBe(nome.normalize('NFC'));
    expect(nome.length).toBe('Gaffer Soluções Metálicas.pdf'.length);
  });
  it('conserta texto gravado com a codificação errada', () => {
    expect(consertarCodificacao('Gaffer SoluÃ§Ãµes MetÃ¡licas')).toBe('Gaffer Soluções Metálicas');
    expect(consertarCodificacao('JoÃ£o')).toBe('João');
    expect(consertarCodificacao('Ã‰rica')).toBe('Érica');
    expect(nomeDeArquivo('Proposta - Gaffer SoluÃ§Ãµes MetÃ¡licas')).toBe('Proposta - Gaffer Soluções Metálicas.pdf');
  });
  it('não mexe em texto certo que só parece estranho', () => {
    expect(consertarCodificacao('Ação São João')).toBe('Ação São João');
    expect(consertarCodificacao('Ã')).toBe('Ã');
  });
  it('troca só o que o Windows proíbe e tira ponto final', () => {
    expect(nomeDeArquivo('Obra: Rua 1/2 "Centro"...')).toBe('Obra Rua 1 2 Centro.pdf');
  });
  it('limpa espaços e caracteres invisíveis', () => {
    expect(textoLimpo('  Gaffer​   Soluções\n Metálicas ')).toBe('Gaffer Soluções Metálicas');
  });
});
