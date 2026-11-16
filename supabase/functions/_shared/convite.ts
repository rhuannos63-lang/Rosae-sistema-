// Convite para o cliente conhecer a ROSAE no site e no Instagram, no fim da proposta enviada
// por e-mail e por WhatsApp. Sem acesso a banco e sem APIs do Deno: a tela (src) e a função
// de e-mail usam o mesmo texto, e tudo aqui é testável sem rede.

export type RedesEmpresa = { site?: string | null; instagram?: string | null };
export type Redes = {
  site: { url: string; rotulo: string } | null;
  instagram: { url: string; arroba: string } | null;
};

/** Aceita "rosaeengenharia.com", "www.rosaeengenharia.com/" ou "https://...". Devolve null se não parecer um endereço. */
export function normalizarSite(bruto: string | null | undefined): Redes['site'] {
  const s = (bruto ?? '').trim();
  if (!s || /\s/.test(s)) return null;
  const comProtocolo = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  let u: URL;
  try { u = new URL(comProtocolo); } catch { return null; }
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) return null;
  const caminho = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
  const rotulo = `${u.hostname.replace(/^www\./i, '')}${caminho}`.toLowerCase();
  return { url: `${u.protocol}//${u.hostname}${caminho}${u.search}`, rotulo };
}

/** Aceita "@rosae", "rosae", "instagram.com/rosae" ou o link completo. */
export function normalizarInstagram(bruto: string | null | undefined): Redes['instagram'] {
  let s = (bruto ?? '').trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\//i, '').replace(/^(www\.)?(instagram\.com|instagr\.am)\//i, '').replace(/^@/, '');
  s = s.split(/[/?#]/)[0];
  if (!/^[a-z0-9._]{1,30}$/i.test(s)) return null;
  const nome = s.toLowerCase();
  return { url: `https://www.instagram.com/${nome}/`, arroba: `@${nome}` };
}

export function redesDaEmpresa(e: RedesEmpresa | null | undefined): Redes {
  return { site: normalizarSite(e?.site), instagram: normalizarInstagram(e?.instagram) };
}

/** Frase de abertura do convite, conforme o que estiver cadastrado. */
function chamada(r: Redes): string {
  if (r.site && r.instagram) return 'Enquanto avalia a proposta, que tal conhecer melhor a ROSAE? No site estão todos os nossos serviços e, no Instagram, o dia a dia das obras e os projetos entregues.';
  if (r.site) return 'Enquanto avalia a proposta, que tal conhecer melhor a ROSAE? No site estão todos os nossos serviços e a forma como trabalhamos.';
  return 'Enquanto avalia a proposta, que tal conhecer melhor a ROSAE? No Instagram mostramos o dia a dia das obras e os projetos entregues.';
}

/** Bloco de texto para WhatsApp e para a versão em texto do e-mail. Vazio se nada estiver cadastrado. */
export function conviteTexto(e: RedesEmpresa | null | undefined): string {
  const r = redesDaEmpresa(e);
  if (!r.site && !r.instagram) return '';
  const linhas = [chamada(r)];
  if (r.site) linhas.push(`Serviços: ${r.site.url}`);
  if (r.instagram) linhas.push(`Instagram: ${r.instagram.url} (${r.instagram.arroba})`);
  return linhas.join('\n');
}

/** Junta a mensagem e o convite antes da assinatura, sem duplicar se o convite já estiver no texto. */
export function comConvite(mensagem: string, assinatura: string, e: RedesEmpresa | null | undefined): string {
  const convite = conviteTexto(e);
  const corpo = mensagem.trim();
  return [corpo, convite && !corpo.includes(convite) ? convite : '', assinatura.trim()].filter(Boolean).join('\n\n');
}

const escapar = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Bloco HTML do e-mail: fundo claro, cores sólidas, dois botões com contorno. Vazio se nada estiver cadastrado. */
export function conviteHtml(e: RedesEmpresa | null | undefined, cor = '#5b6b2e'): string {
  const r = redesDaEmpresa(e);
  if (!r.site && !r.instagram) return '';
  const botao = (url: string, rotulo: string) =>
    `<a href="${escapar(url)}" style="display:inline-block;margin:0 8px 8px 0;border:1.5px solid ${cor};color:${cor};text-decoration:none;font-weight:bold;font-size:14px;padding:10px 18px;border-radius:999px">${escapar(rotulo)}</a>`;
  const botoes = [
    r.site ? botao(r.site.url, 'Conhecer os serviços') : '',
    r.instagram ? botao(r.instagram.url, `Instagram ${r.instagram.arroba}`) : '',
  ].join('');
  return `<tr><td style="padding:0 28px 24px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f2;border:1px solid #e2e4da;border-radius:10px"><tr><td style="padding:18px 20px">
<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${cor};font-weight:bold;margin:0 0 6px">Conheça a ROSAE</div>
<p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#3a3f30">${escapar(chamada(r))}</p>
${botoes}
</td></tr></table></td></tr>`;
}
