import { describe, expect, it } from 'vitest';
import { assinarGet, codificar } from './r2.ts';

describe('assinatura do R2 (AWS Signature V4)', () => {
  it('confere com o exemplo oficial da AWS', async () => {
    const url = await assinarGet(
      { chave: 'AKIAIOSFODNN7EXAMPLE', segredo: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', regiao: 'us-east-1' },
      'examplebucket.s3.amazonaws.com', '/test.txt', 86400, new Date('2013-05-24T00:00:00Z'),
    );
    expect(url.endsWith('X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404')).toBe(true);
  });

  it('codifica acento e espaço e mantém a barra', () => {
    expect(codificar('/b/obras/x/fotos/ação 1.jpg', true)).toBe('/b/obras/x/fotos/a%C3%A7%C3%A3o%201.jpg');
  });
});
