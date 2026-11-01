// Envio de e-mail pelo Resend: montagem da mensagem e leitura das respostas do provedor.
// Sem acesso a banco: tudo aqui é testável sem rede.

export const EMAIL_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export type Estado = 'enviando' | 'enviado' | 'entregue' | 'devolvido' | 'falhou';

export function validarEnvio(c: { destinatario?: unknown; assunto?: unknown; mensagem?: unknown; chave?: unknown; versao_id?: unknown; origem?: unknown }): string | null {
  if (typeof c.versao_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(c.versao_id)) return 'Versão da proposta inválida.';
  if (typeof c.destinatario !== 'string' || !EMAIL_VALIDO.test(c.destinatario.trim())) return 'Confira o e-mail do cliente.';
  if (typeof c.assunto !== 'string' || !c.assunto.trim() || c.assunto.length > 200) return 'Escreva o assunto (até 200 caracteres).';
  if (typeof c.mensagem !== 'string' || c.mensagem.length > 5000) return 'A mensagem passou de 5.000 caracteres.';
  if (typeof c.chave !== 'string' || c.chave.length < 16 || c.chave.length > 80) return 'Envio sem identificação. Recarregue a página.';
  if (typeof c.origem !== 'string' || !/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(c.origem)) return 'Endereço do sistema inválido.';
  return validarAnexo(c as { anexo_nome?: unknown; anexo_base64?: unknown });
}

/** PDF anexado (opcional): nome .pdf e até 15 MB. */
export const ANEXO_MAX_BASE64 = 20_000_000;
export function validarAnexo(c: { anexo_nome?: unknown; anexo_base64?: unknown }): string | null {
  if (c.anexo_nome === undefined && c.anexo_base64 === undefined) return null;
  if (typeof c.anexo_nome !== 'string' || !/^[^\\/:*?"<>|]{1,140}\.pdf$/i.test(c.anexo_nome)) return 'Nome do anexo inválido.';
  if (typeof c.anexo_base64 !== 'string' || !c.anexo_base64.startsWith('JVBER')) return 'O anexo precisa ser um PDF.';
  if (c.anexo_base64.length > ANEXO_MAX_BASE64) return 'O PDF passou de 15 MB.';
  return null;
}

const escapar = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type Empresa = { nome?: string | null; telefone?: string | null; email?: string | null; site?: string | null; responsavel?: string | null; frase?: string | null };

/** HTML simples e compatível com os principais leitores de e-mail, com o botão do link da proposta. */
export function montarEmail(mensagem: string, link: string, e: Empresa): { html: string; texto: string } {
  const nome = e.nome || 'ROSAE Engenharia & Estruturas';
  const rodape = [e.responsavel, nome, e.telefone, e.email, e.site].filter(Boolean) as string[];
  const paragrafos = mensagem.trim().split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${escapar(p).replace(/\n/g, '<br>')}</p>`).join('');
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f5f0;font-family:Arial,Helvetica,sans-serif;color:#1f2417">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f0;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e4da;border-radius:12px">
<tr><td style="padding:22px 28px;border-bottom:3px solid #5b6b2e"><b style="font-size:18px;letter-spacing:.04em;color:#3b451e">${escapar(nome)}</b></td></tr>
<tr><td style="padding:24px 28px;font-size:15px;line-height:1.55">${paragrafos}
<p style="margin:22px 0"><a href="${escapar(link)}" style="display:inline-block;background:#5b6b2e;color:#ffffff;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:999px">Aceitar ou pedir ajuste</a></p>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #e2e4da;font-size:12px;color:#6b705e">${rodape.map(escapar).join(' · ')}${e.frase ? `<br><i>${escapar(e.frase)}</i>` : ''}</td></tr>
</table></td></tr></table></body></html>`;
  const texto = `${mensagem.trim()}\n\nAceitar ou pedir ajuste:\n${link}\n\n${rodape.join(' · ')}`;
  return { html, texto };
}

/** Situação a partir do último evento informado pelo Resend. */
export function estadoDoEvento(evento: string | null | undefined, atual: Estado): Estado {
  switch (evento) {
    case 'delivered': case 'opened': case 'clicked': return 'entregue';
    case 'bounced': case 'complained': return 'devolvido';
    case 'failed': case 'canceled': return 'falhou';
    default: return atual;
  }
}

/** Mensagem de erro do Resend em português, sem repassar dados sensíveis. */
export function erroDoProvedor(status: number, corpo: { message?: string; name?: string } | null): string {
  const m = corpo?.message ?? '';
  if (status === 401 || status === 403) {
    if (/domain/i.test(m)) return 'O domínio do remetente ainda não foi verificado no Resend.';
    return 'A chave do Resend foi recusada. Confira a chave cadastrada.';
  }
  if (status === 422) return `O provedor recusou o e-mail: ${m || 'dados inválidos'}.`;
  if (status === 429) return 'Limite de envios do provedor atingido. Tente de novo em alguns minutos.';
  if (status >= 500) return 'O provedor de e-mail está fora do ar. Tente de novo em alguns minutos.';
  return m ? `O provedor recusou o e-mail: ${m}.` : `Falha no provedor (código ${status}).`;
}
