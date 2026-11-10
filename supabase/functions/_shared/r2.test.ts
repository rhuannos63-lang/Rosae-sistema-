import { assinarGet, codificar } from './r2.ts';

Deno.test('assinatura confere com o exemplo oficial da AWS', async () => {
  const url = await assinarGet(
    { chave: 'AKIAIOSFODNN7EXAMPLE', segredo: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', regiao: 'us-east-1' },
    'examplebucket.s3.amazonaws.com', '/test.txt', 86400, new Date('2013-05-24T00:00:00Z'),
  );
  const esperado = 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404';
  if (!url.endsWith('X-Amz-Signature=' + esperado)) throw new Error('assinatura diferente: ' + url);
});

Deno.test('caminho com acento e espaço é codificado, barra mantida', () => {
  const c = codificar('/b/obras/x/fotos/ação 1.jpg', true);
  if (c !== '/b/obras/x/fotos/a%C3%A7%C3%A3o%201.jpg') throw new Error(c);
});
