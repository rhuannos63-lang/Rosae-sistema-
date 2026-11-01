// Envio da proposta por e-mail pelo provedor configurado (Gmail da ROSAE ou Resend), com prévia,
// conferência do destinatário e histórico com a situação de cada envio.
import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { Carregando, Erro, Modal, useToast } from './ui';
import { Icone } from './Icone';
import { formatarDataHora } from '../core/datas';

export type EnvioEmail = {
  id: string; versao_id: string; destinatario: string; assunto: string; mensagem: string;
  estado: 'enviando' | 'enviado' | 'entregue' | 'devolvido' | 'falhou'; provedor_id: string | null; erro: string | null; tentativas: number; criado_em: string; chave: string;
};
export const ESTADO_EMAIL: Record<EnvioEmail['estado'], { rotulo: string; classe: string }> = {
  enviando: { rotulo: 'Enviando…', classe: 'neutro' },
  enviado: { rotulo: 'Enviado ao provedor', classe: 'info' },
  entregue: { rotulo: 'Entregue', classe: 'ok' },
  devolvido: { rotulo: 'Voltou', classe: 'erro' },
  falhou: { rotulo: 'Falhou', classe: 'erro' },
};
const EMAIL_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Status = { configurado: boolean; remetente: string | null; publicado: boolean };
class ErroEmail extends Error { constructor(m: string, public envio?: EnvioEmail) { super(m); } }

async function chamar(corpo: Record<string, unknown>): Promise<{ envio?: EnvioEmail; repetido?: boolean; aviso?: string } & Partial<Status>> {
  const { data, error } = await supabase.functions.invoke('email', { body: corpo });
  if (error) {
    let msg = error.message;
    let envio: EnvioEmail | undefined;
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.erro) msg = j.erro; envio = j?.envio; } catch { /* resposta sem corpo */ }
    if (/Failed to send|FunctionsFetchError|404/i.test(msg)) msg = 'O envio de e-mail ainda não foi publicado no servidor.';
    throw new ErroEmail(msg, envio);
  }
  return data;
}

let statusCache: Promise<Status> | null = null;
export function statusEmail(): Promise<Status> {
  statusCache ??= chamar({ acao: 'status' })
    .then((d) => ({ configurado: !!d.configurado, remetente: d.remetente ?? null, publicado: true }))
    .catch(() => { statusCache = null; return { configurado: false, remetente: null, publicado: false }; });
  return statusCache;
}

function novaChave() {
  return `${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

/** Janela de envio: confere destinatário, assunto e mensagem, mostra a prévia e envia uma única vez. */
export function EnviarEmail({ versaoId, codigo, versao, titulo, cliente, emailCliente, aoFechar, aoEnviar, abrirNoAplicativo, anexo }: {
  versaoId: string; codigo: string; versao: number; titulo: string; cliente: string; emailCliente: string | null;
  aoFechar: () => void; aoEnviar: () => void; abrirNoAplicativo: () => void;
  /** Gera o PDF da proposta para ir anexado. */
  anexo?: () => Promise<{ nome: string; base64: string } | null>;
}) {
  const toast = useToast();
  const status = useConsulta(() => statusEmail(), []);
  const primeiro = cliente.split(' ')[0] ?? '';
  const [dest, setDest] = useState(emailCliente ?? '');
  const [assunto, setAssunto] = useState(`Proposta ${codigo} · ROSAE Engenharia & Estruturas`);
  const [mensagem, setMensagem] = useState(anexo
    ? `Olá, ${primeiro}!\n\nSegue em anexo a proposta ${codigo} (versão ${versao}): ${titulo}.\n\nNo PDF estão o escopo, o que está e o que não está incluso, prazos e condições. Para aprovar, é só tocar em “Aceitar esta proposta” dentro do arquivo ou no botão abaixo.\n\nQualquer dúvida, estou à disposição.`
    : `Olá, ${primeiro}!\n\nSegue a proposta ${codigo} (versão ${versao}): ${titulo}.\n\nNo botão abaixo estão o escopo, o que está e o que não está incluso, prazos e condições. Por lá você também pode aceitar ou pedir ajustes.\n\nQualquer dúvida, estou à disposição.`);
  const [comPdf, setComPdf] = useState(!!anexo);
  const chave = useMemo(novaChave, []);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const valido = EMAIL_VALIDO.test(dest.trim());

  async function enviar() {
    setErro(null);
    if (!valido) return setErro('Confira o e-mail do cliente.');
    setEnviando(true);
    try {
      const arquivo = comPdf && anexo ? await anexo() : null;
      if (comPdf && anexo && !arquivo) throw new Error('Não consegui gerar o PDF para anexar. Tente de novo.');
      const r = await chamar({ acao: 'enviar', versao_id: versaoId, destinatario: dest.trim(), assunto, mensagem, chave, origem: window.location.origin, ...(arquivo ? { anexo_nome: arquivo.nome, anexo_base64: arquivo.base64 } : {}) });
      toast(r.envio?.estado === 'enviando' ? 'Esse envio já está em andamento.' : r.repetido ? 'Esse e-mail já tinha sido enviado. Nada foi duplicado.' : `E-mail enviado ao provedor para ${dest.trim()}. A entrega aparece no histórico.`);
      aoEnviar();
      aoFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha no envio.');
      aoEnviar();
    } finally { setEnviando(false); }
  }

  const s = status.dados;
  return (
    <Modal titulo="Enviar a proposta por e-mail" aoFechar={aoFechar} largo
      rodape={s?.configurado ? (
        <>
          <button className="btn-link" onClick={aoFechar}>Cancelar</button>
          <button className="btn-primario" onClick={enviar} disabled={enviando || !valido || !assunto.trim()}>{enviando ? (comPdf ? 'Gerando o PDF e enviando…' : 'Enviando…') : erro ? 'Tentar de novo' : 'Enviar e-mail'}</button>
        </>
      ) : undefined}>
      {!s ? <Carregando /> : !s.configurado ? (
        <div className="stack">
          <div className="aviso info"><Icone nome="alerta" /><span>
            O envio automático de e-mail ainda não está ligado{s.publicado ? ': falta cadastrar o Gmail da ROSAE e a senha de app' : ''}. Nada foi enviado.
            Por enquanto, abra a mensagem pronta no seu aplicativo de e-mail e envie de lá.
          </span></div>
          <div className="row"><button className="btn-primario" onClick={() => { abrirNoAplicativo(); aoFechar(); }}><Icone nome="documento" /> Abrir no meu e-mail</button></div>
          <p className="muted small" style={{ margin: 0 }}>Com o envio automático ligado, o e-mail sai do endereço da ROSAE e o sistema registra se foi aceito pelo provedor, entregue ou devolvido.</p>
        </div>
      ) : (
        <div className="grid grid-2 envio-email">
          <div className="stack">
            <label className="campo">Para
              <input type="email" value={dest} onChange={(e) => setDest(e.target.value)} aria-invalid={!valido || undefined} placeholder="email@cliente.com" />
              {!emailCliente && <span className="dica">O cliente não tem e-mail no cadastro. Confira antes de enviar.</span>}
            </label>
            <label className="campo">Assunto<input value={assunto} onChange={(e) => setAssunto(e.target.value)} maxLength={200} /></label>
            <label className="campo">Mensagem<textarea rows={9} value={mensagem} onChange={(e) => setMensagem(e.target.value)} maxLength={5000} /></label>
            {anexo && <label className="check"><input type="checkbox" checked={comPdf} onChange={(e) => setComPdf(e.target.checked)} /> Anexar a proposta em PDF (deitada, com botão de aceite)</label>}
            <p className="muted small" style={{ margin: 0 }}>Sai de <b>{s.remetente}</b>. O botão “Aceitar ou pedir ajuste” entra no fim da mensagem, sem endereço aparente.</p>
            <Erro mensagem={erro} />
          </div>
          <div className="previa-email" aria-label="Prévia do e-mail">
            <div className="previa-email-cab"><span className="muted small">Para</span> {dest || '—'}<br /><span className="muted small">Assunto</span> <b>{assunto}</b></div>
            <div className="previa-email-corpo">
              {mensagem.trim().split(/\n{2,}/).map((p, k) => <p key={k}>{p}</p>)}
              {comPdf && anexo && <span className="previa-email-anexo"><Icone nome="anexo" /> Proposta {codigo} v{versao}.pdf</span>}
              <span className="previa-email-botao">Aceitar ou pedir ajuste</span>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Histórico dos e-mails desta versão, com a situação no provedor. */
export function HistoricoEmails({ versaoId, versao }: { versaoId: string; versao: number }) {
  const toast = useToast();
  const lista = useConsulta(async () => ok(await supabase.from('envio_email').select('*').eq('versao_id', versaoId).order('criado_em', { ascending: false })) as EnvioEmail[], [versaoId]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  if (!lista.dados?.length) return null;

  async function atualizar(e: EnvioEmail) {
    setErro(null); setOcupado(e.id);
    try { const r = await chamar({ acao: 'atualizar', id: e.id }); if (r.aviso) toast(r.aviso); lista.recarregar(); }
    catch (x) { setErro(x instanceof Error ? x.message : 'Falha ao consultar.'); } finally { setOcupado(null); }
  }
  async function repetir(e: EnvioEmail) {
    setErro(null); setOcupado(e.id);
    // Mesma chave: se o provedor já tinha recebido, ele não manda de novo.
    try { await chamar({ acao: 'enviar', versao_id: e.versao_id, destinatario: e.destinatario, assunto: e.assunto, mensagem: e.mensagem, chave: e.chave, origem: window.location.origin }); toast('Nova tentativa enviada ao provedor.'); }
    catch (x) { setErro(x instanceof Error ? x.message : 'Falha no envio.'); } finally { setOcupado(null); lista.recarregar(); }
  }
  return (
    <div className="card">
      <h2 style={{ marginBottom: 8 }}>E-mails da versão {versao}</h2>
      <ul className="lista-emails">
        {lista.dados.map((e) => (
          <li key={e.id}>
            <div className="row" style={{ gap: 8 }}>
              <span className={`selo ${ESTADO_EMAIL[e.estado].classe}`}>{ESTADO_EMAIL[e.estado].rotulo}</span>
              <span className="small">{e.destinatario}</span>
              <span className="muted small">{formatarDataHora(e.criado_em)}{e.tentativas > 1 ? ` · ${e.tentativas} tentativas` : ''}</span>
            </div>
            {e.erro && <div className="small" style={{ color: 'var(--desfavoravel)' }}>{e.erro}</div>}
            <div className="row" style={{ gap: 10 }}>
              {e.estado === 'enviado' && <button className="btn-link small" disabled={ocupado === e.id} onClick={() => atualizar(e)}>Atualizar situação</button>}
              {e.estado === 'falhou' && <button className="btn-link small" disabled={ocupado === e.id} onClick={() => repetir(e)}>Tentar de novo</button>}
            </div>
          </li>
        ))}
      </ul>
      <Erro mensagem={erro} />
      <p className="muted small" style={{ margin: '8px 0 0' }}>“Entregue” quer dizer que chegou na caixa do cliente, não que ele aceitou. O aceite aparece em Respostas do cliente.</p>
    </div>
  );
}
