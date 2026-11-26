import { describe, expect, it } from 'vitest';
import { comConvite, conviteHtml, conviteTexto, normalizarInstagram, normalizarSite } from './convite.ts';
import { montarEmail } from './email.ts';

describe('convite para o site e o Instagram', () => {
  it('aceita o @, o nome ou o link do Instagram', () => {
    for (const v of ['@RosaeEngenharia', 'rosaeengenharia', 'instagram.com/rosaeengenharia', 'https://www.instagram.com/rosaeengenharia/?hl=pt'])
      expect(normalizarInstagram(v)).toEqual({ url: 'https://www.instagram.com/rosaeengenharia/', arroba: '@rosaeengenharia' });
    expect(normalizarInstagram('')).toBeNull();
    expect(normalizarInstagram('nome com espaço')).toBeNull();
  });

  it('completa o endereço do site', () => {
    expect(normalizarSite('rosaeengenharia.com')).toEqual({ url: 'https://rosaeengenharia.com', rotulo: 'rosaeengenharia.com' });
    expect(normalizarSite('https://www.rosaeengenharia.com/servicos/')).toEqual({ url: 'https://www.rosaeengenharia.com/servicos', rotulo: 'rosaeengenharia.com/servicos' });
    expect(normalizarSite('a preencher')).toBeNull();
    expect(normalizarSite(null)).toBeNull();
  });

  it('texto do WhatsApp entra antes da assinatura e só com o que existe', () => {
    const t = comConvite('Olá! Segue a proposta.', 'Rhuann', { site: 'rosaeengenharia.com', instagram: '@rosae' });
    expect(t).toBe(`Olá! Segue a proposta.\n\n${conviteTexto({ site: 'rosaeengenharia.com', instagram: '@rosae' })}\n\nRhuann`);
    expect(t).toContain('Conheça nossos serviços: https://rosaeengenharia.com');
    expect(t).toContain('Veja nossas obras no Instagram (@rosae): https://www.instagram.com/rosae/');
    expect(t).toContain('convido você a conhecer de perto');
    expect(conviteTexto({ site: 'rosaeengenharia.com', instagram: 'nome inválido' })).not.toContain('Instagram');
    // Cadastro em branco usa o site e o Instagram oficiais da ROSAE.
    expect(conviteTexto({})).toContain('https://www.instagram.com/eng.rhuannrosa/');
    expect(conviteTexto({ site: '' })).toContain('https://rosaeengenharia.com');
    expect(comConvite('Olá!', 'Rhuann', null)).toBe('Olá!\n\nRhuann');
    expect(comConvite(t.replace('\n\nRhuann', ''), 'Rhuann', { site: 'rosaeengenharia.com', instagram: '@rosae' })).toBe(t);
  });

  it('e-mail leva os dois botões, sem degradê, e pode desligar', () => {
    const e = { nome: 'ROSAE', site: 'rosaeengenharia.com', instagram: '@rosae' };
    const { html, texto } = montarEmail('Olá', 'https://x.dev/p/tok', e);
    expect(html).toContain('Conheça a ROSAE');
    expect(html).toContain('href="https://rosaeengenharia.com"');
    expect(html).toContain('href="https://www.instagram.com/rosae/"');
    expect(html).not.toMatch(/gradient/i);
    expect(texto).toContain('Conheça nossos serviços: https://rosaeengenharia.com');
    const sem = montarEmail('Olá', 'https://x.dev/p/tok', e, false);
    expect(sem.html).not.toContain('Conheça a ROSAE');
    expect(conviteHtml(null)).toBe('');
    expect(conviteHtml({})).toContain('eng.rhuannrosa');
  });
});
