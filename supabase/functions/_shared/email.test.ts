import { describe, expect, it } from 'vitest';
import { erroDoProvedor, estadoDoEvento, montarEmail, validarEnvio } from './email.ts';

const ok = { versao_id: '6f1c2d3e-4b5a-4c6d-8e7f-001122334455', destinatario: 'cliente@exemplo.com', assunto: 'Proposta', mensagem: 'Olá', chave: 'a'.repeat(20), origem: 'https://rosae.exemplo.dev' };

describe('e-mail da proposta', () => {
  it('valida o envio antes de falar com o provedor', () => {
    expect(validarEnvio(ok)).toBeNull();
    expect(validarEnvio({ ...ok, destinatario: 'sem-arroba' })).toBeTruthy();
    expect(validarEnvio({ ...ok, chave: 'curta' })).toBeTruthy();
    expect(validarEnvio({ ...ok, origem: 'javascript:alert(1)' })).toBeTruthy();
    expect(validarEnvio({ ...ok, assunto: '  ' })).toBeTruthy();
  });

  it('mensagem escapa HTML e leva o link', () => {
    const { html, texto } = montarEmail('Olá <b>Carlos</b>\n\nSegue a proposta.', 'https://x.dev/p/tok', { nome: 'ROSAE', telefone: '(21) 9' });
    expect(html).toContain('&lt;b&gt;Carlos&lt;/b&gt;');
    expect(html).not.toContain('<b>Carlos</b>');
    expect(html).toContain('href="https://x.dev/p/tok"');
    expect(texto).toContain('https://x.dev/p/tok');
  });

  it('abertura do e-mail não vira aprovação: só entregue', () => {
    expect(estadoDoEvento('delivered', 'enviado')).toBe('entregue');
    expect(estadoDoEvento('opened', 'enviado')).toBe('entregue');
    expect(estadoDoEvento('bounced', 'enviado')).toBe('devolvido');
    expect(estadoDoEvento('sent', 'enviado')).toBe('enviado');
    expect(estadoDoEvento(undefined, 'enviado')).toBe('enviado');
  });

  it('erros do provedor em português', () => {
    expect(erroDoProvedor(403, { message: 'The domain is not verified' })).toContain('domínio');
    expect(erroDoProvedor(401, null)).toContain('chave');
    expect(erroDoProvedor(503, null)).toContain('fora do ar');
  });
});
