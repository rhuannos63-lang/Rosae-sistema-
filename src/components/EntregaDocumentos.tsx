// Entrega de documentos ao cliente: escolhe os arquivos, a mensagem já vem pronta com as
// instruções do tipo de serviço, e envia por e-mail, WhatsApp e portal, tudo pelo sistema.
import { useMemo, useRef, useState } from 'react';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { Erro, Modal, useToast } from './ui';
import { Icone } from './Icone';
import { formatarDataHora } from '../core/datas';
import { perfilDaObra } from '../core/jornada';
import {
  ARQUIVO_MAX_BYTES, mensagemDaEntrega, nomeParaCaminho, tamanhoLegivel, textoWhatsAppEntrega, tipoDoArquivo, tituloDaEntrega,
} from '../core/entrega';
import { linkWhatsApp } from '../pages/Comercial';
import type { Obra } from '../lib/tipos';

type ObraEntrega = Obra & { cliente?: { nome: string; telefone?: string | null; email?: string | null } | null };
export type Entrega = {
  id: string; obra_id: string; titulo: string; mensagem: string; no_portal: boolean; email_para: string | null; email_em: string | null;
  email_erro: string | null; whatsapp_em: string | null; primeiro_acesso_em: string | null; acessos: number; downloads: number; criado_em: string;
  entrega_arquivo?: { id: string; nome: string; tamanho: number | null }[];
};
const EMAIL_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const novoId = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

async function chamar(corpo: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('entrega', { body: corpo });
  if (error) {
    let msg = error.message;
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.erro) msg = j.erro; } catch { /* sem corpo */ }
    if (/Failed to send|FunctionsFetchError|404/i.test(msg)) msg = 'O envio por e-mail ainda não foi publicado no servidor. Use o WhatsApp ou copie o link.';
    throw new Error(msg);
  }
  return data as { ok?: boolean; anexados?: number; url?: string; nome?: string };
}

/** Janela "Enviar documentos": passo 1 monta a entrega; passo 2 envia por e-mail, WhatsApp ou link. */
export function EntregarDocumentos({ obra, entrega: existente, aoFechar, aoMudar }: { obra: ObraEntrega; entrega?: Entrega | null; aoFechar: () => void; aoMudar?: () => void }) {
  const toast = useToast();
  const perfil = perfilDaObra(obra.tipo_servico, obra.tipo_servico);
  const empresa = useConsulta(async () => ok(await supabase.from('empresa').select('responsavel_tecnico, nome_fantasia').maybeSingle()) as { responsavel_tecnico: string | null; nome_fantasia: string | null } | null, []);
  const [entrega, setEntrega] = useState<Entrega | null>(existente ?? null);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [titulo, setTitulo] = useState(existente?.titulo ?? tituloDaEntrega(perfil, obra.nome));
  const [mensagem, setMensagem] = useState<string | null>(existente?.mensagem ?? null);
  const textoMensagem = mensagem ?? mensagemDaEntrega(perfil, { cliente: obra.cliente?.nome, responsavel: empresa.dados?.responsavel_tecnico });
  const [noPortal, setNoPortal] = useState(existente?.no_portal ?? true);
  const [progresso, setProgresso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  function adicionar(lista: FileList | null) {
    if (!lista) return;
    const novos = Array.from(lista);
    const grande = novos.find((f) => f.size > ARQUIVO_MAX_BYTES);
    if (grande) setErro(`“${grande.name}” tem ${tamanhoLegivel(grande.size)}. O limite é 50 MB por arquivo: divida ou compacte.`);
    setArquivos((a) => [...a, ...novos.filter((f) => f.size <= ARQUIVO_MAX_BYTES && !a.some((x) => x.name === f.name && x.size === f.size))]);
  }

  async function salvar() {
    if (!arquivos.length) return setErro('Escolha pelo menos um arquivo.');
    if (!titulo.trim()) return setErro('Dê um título à entrega.');
    setErro(null);
    const pasta = `obras/${obra.id}/entregas/${novoId()}`;
    const enviados: { caminho: string; nome: string; mime: string; tamanho: number }[] = [];
    for (const [i, f] of arquivos.entries()) {
      setProgresso(`Enviando ${i + 1} de ${arquivos.length}: ${f.name}`);
      const caminho = `${pasta}/${String(i + 1).padStart(2, '0')}-${nomeParaCaminho(f.name)}`;
      const mime = tipoDoArquivo(f.name, f.type);
      const r = await supabase.storage.from('documentos').upload(caminho, f, { contentType: mime, upsert: false });
      if (r.error) { setProgresso(null); return setErro(`“${f.name}” não subiu: ${mensagemErro(r.error)}`); }
      enviados.push({ caminho, nome: f.name, mime, tamanho: f.size });
    }
    setProgresso('Salvando a entrega…');
    const r = await supabase.rpc('entrega_criar', { p_obra: obra.id, p_titulo: titulo.trim(), p_mensagem: textoMensagem, p_no_portal: noPortal, p_arquivos: enviados });
    setProgresso(null);
    if (r.error) return setErro(mensagemErro(r.error));
    const e = ok(await supabase.from('entrega').select('*, entrega_arquivo(id, nome, tamanho)').eq('id', r.data as string).single()) as Entrega;
    setEntrega(e);
    toast(noPortal ? 'Entrega salva e já aparece no portal do cliente.' : 'Entrega salva.');
    aoMudar?.();
  }

  if (entrega) return <EnviarEntrega obra={obra} entrega={entrega} arquivos={arquivos} aoFechar={aoFechar} aoMudar={aoMudar} />;

  return (
    <Modal titulo="Enviar documentos ao cliente" aoFechar={aoFechar} largo
      rodape={<><button className="btn-secundario" onClick={aoFechar}>Cancelar</button><button className="btn-primario" onClick={salvar} disabled={!!progresso || !arquivos.length}>{progresso ? 'Enviando…' : 'Salvar e escolher como enviar'}</button></>}>
      <div className="stack">
        <div
          className="area-arquivos" role="button" tabIndex={0}
          onClick={() => entrada.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') entrada.current?.click(); }}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); adicionar(e.dataTransfer.files); }}
        >
          <Icone nome="anexo" />
          <span><b>Escolher arquivos</b> ou arraste aqui</span>
          <span className="muted small">PDF, DWG, DXF, ZIP, imagens. Até 50 MB cada.</span>
          <input ref={entrada} type="file" multiple hidden onChange={(e) => { adicionar(e.target.files); e.target.value = ''; }} />
        </div>
        {arquivos.length > 0 && (
          <ul className="lista-arquivos">
            {arquivos.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <Icone nome="documento" /><span className="nome">{f.name}</span><span className="muted small">{tamanhoLegivel(f.size)}</span>
                <button type="button" className="btn-link" aria-label={`Tirar ${f.name}`} onClick={() => setArquivos((a) => a.filter((_, j) => j !== i))}><Icone nome="fechar" /></button>
              </li>
            ))}
          </ul>
        )}
        <label className="campo">Título<input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={160} /></label>
        <label className="campo">
          Mensagem para o cliente
          <span className="dica">Já vem com as orientações de {tituloDaEntrega(perfil, '').replace(' · ', '').toLowerCase()}. Ajuste o que quiser.</span>
          <textarea rows={10} value={textoMensagem} onChange={(e) => setMensagem(e.target.value)} />
        </label>
        <label className="check"><input type="checkbox" checked={noPortal} onChange={(e) => setNoPortal(e.target.checked)} /> Deixar também no portal do cliente, para baixar quando quiser</label>
        {progresso && <p className="muted small" style={{ margin: 0 }}>{progresso}</p>}
        <Erro mensagem={erro} />
      </div>
    </Modal>
  );
}

/** Passo 2: e-mail (com os arquivos anexados quando cabem), WhatsApp e link. */
function EnviarEntrega({ obra, entrega, arquivos, aoFechar, aoMudar }: { obra: ObraEntrega; entrega: Entrega; arquivos: File[]; aoFechar: () => void; aoMudar?: () => void }) {
  const toast = useToast();
  const [dest, setDest] = useState(obra.cliente?.email ?? entrega.email_para ?? '');
  const [assunto, setAssunto] = useState(`${entrega.titulo} · ROSAE Engenharia & Estruturas`);
  const [anexar, setAnexar] = useState(true);
  const [enviando, setEnviando] = useState<'email' | 'whatsapp' | 'link' | null>(null);
  const [feito, setFeito] = useState<{ email?: string; whatsapp?: boolean; link?: boolean }>({});
  const [erro, setErro] = useState<string | null>(null);
  const tel = obra.cliente?.telefone ?? '';
  const total = (entrega.entrega_arquivo ?? []).reduce((s, a) => s + (Number(a.tamanho) || 0), 0);
  const podeCompartilhar = useMemo(() => arquivos.length > 0 && typeof navigator !== 'undefined' && !!navigator.canShare?.({ files: arquivos }), [arquivos]);

  async function link(canal: 'whatsapp' | 'link') {
    const r = await supabase.rpc('entrega_link_novo', { p_entrega: entrega.id, p_canal: canal, p_dias: 365 });
    if (r.error) throw new Error(mensagemErro(r.error));
    return `${window.location.origin}/e/${r.data as string}`;
  }

  async function porEmail() {
    if (!EMAIL_VALIDO.test(dest.trim())) return setErro('Confira o e-mail do cliente.');
    setErro(null); setEnviando('email');
    try {
      const d = await chamar({ acao: 'email', entrega_id: entrega.id, destinatario: dest.trim(), assunto, mensagem: entrega.mensagem, origem: window.location.origin, anexar });
      setFeito((f) => ({ ...f, email: dest.trim() }));
      toast(d.anexados ? `E-mail enviado com ${d.anexados} arquivo(s) anexado(s) e o botão para baixar.` : 'E-mail enviado com o botão para baixar os documentos.');
      aoMudar?.();
    } catch (e) { setErro((e as Error).message); }
    setEnviando(null);
  }

  async function porWhatsApp() {
    setErro(null); setEnviando('whatsapp');
    // Abre a janela já no clique (o navegador bloqueia se abrir depois de esperar o servidor).
    const janela = window.open('', '_blank');
    try {
      const url = await link('whatsapp');
      const texto = textoWhatsAppEntrega(entrega.mensagem, url);
      const destino = linkWhatsApp(tel, texto) ?? `https://wa.me/?text=${encodeURIComponent(texto)}`;
      if (janela) { janela.opener = null; janela.location.href = destino; } else window.location.href = destino;
      await supabase.rpc('entrega_marcar_envio', { p_entrega: entrega.id, p_canal: 'whatsapp' });
      setFeito((f) => ({ ...f, whatsapp: true }));
      aoMudar?.();
    } catch (e) { janela?.close(); setErro((e as Error).message); }
    setEnviando(null);
  }

  async function compartilhar() {
    setErro(null);
    try {
      const url = await link('whatsapp');
      await navigator.share({ files: arquivos, title: entrega.titulo, text: textoWhatsAppEntrega(entrega.mensagem, url) });
      await supabase.rpc('entrega_marcar_envio', { p_entrega: entrega.id, p_canal: 'whatsapp' });
      setFeito((f) => ({ ...f, whatsapp: true }));
      aoMudar?.();
    } catch (e) { if ((e as Error).name !== 'AbortError') setErro((e as Error).message); }
  }

  async function copiar() {
    setErro(null); setEnviando('link');
    try {
      const url = await link('link');
      await navigator.clipboard.writeText(textoWhatsAppEntrega(entrega.mensagem, url));
      setFeito((f) => ({ ...f, link: true }));
      toast('Mensagem com o link copiada. Cole onde quiser.');
    } catch (e) { setErro((e as Error).message); }
    setEnviando(null);
  }

  return (
    <Modal titulo="Como enviar ao cliente?" aoFechar={aoFechar} largo
      rodape={<><span className="muted small" style={{ flex: 1 }}>{entrega.no_portal ? 'Também está no portal do cliente.' : 'Fora do portal do cliente.'}</span><button className="btn-primario" onClick={aoFechar}>Concluir</button></>}>
      <div className="stack">
        <div className="aviso ok"><Icone nome="check" /><span><b>{entrega.titulo}</b> · {(entrega.entrega_arquivo ?? []).length} arquivo(s), {tamanhoLegivel(total)}. Cada envio leva um link próprio para o cliente baixar.</span></div>

        <section className="envio-canal">
          <h3><Icone nome="mensagem" /> E-mail</h3>
          <div className="grid grid-2">
            <label className="campo">Para<input type="email" value={dest} onChange={(e) => setDest(e.target.value)} placeholder="cliente@email.com" /></label>
            <label className="campo">Assunto<input value={assunto} onChange={(e) => setAssunto(e.target.value)} maxLength={200} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={anexar} onChange={(e) => setAnexar(e.target.checked)} /> Anexar os arquivos ao e-mail {total > 15_000_000 ? '(grandes demais: vai só o botão para baixar)' : '(além do botão para baixar)'}</label>
          <div className="row">
            <button className="btn-primario" onClick={porEmail} disabled={enviando !== null}>{enviando === 'email' ? 'Enviando…' : feito.email ? 'Enviar de novo' : 'Enviar por e-mail'}</button>
            {feito.email && <span className="selo ok">Enviado para {feito.email}</span>}
          </div>
        </section>

        <section className="envio-canal">
          <h3><Icone nome="link" /> WhatsApp</h3>
          <p className="muted small" style={{ margin: 0 }}>{tel ? `Abre a conversa com ${obra.cliente?.nome?.split(' ')[0] ?? 'o cliente'} (${tel}) com a mensagem e o link prontos.` : 'Cadastro sem telefone: o WhatsApp abre para você escolher a conversa.'}</p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-primario" onClick={porWhatsApp} disabled={enviando !== null}>{enviando === 'whatsapp' ? 'Abrindo…' : 'Enviar pelo WhatsApp'}</button>
            {podeCompartilhar && <button className="btn-secundario" onClick={compartilhar}>Mandar os arquivos (celular)</button>}
            <button className="btn-secundario" onClick={copiar} disabled={enviando !== null}><Icone nome="copiar" /> Copiar mensagem e link</button>
            {feito.whatsapp && <span className="selo ok">WhatsApp aberto</span>}
          </div>
        </section>
        <Erro mensagem={erro} />
      </div>
    </Modal>
  );
}

/** Documentos já entregues nesta obra, com a situação de cada envio. */
export function EntregasObra({ obra, mostrarVazio }: { obra: ObraEntrega; mostrarVazio: boolean }) {
  const [nova, setNova] = useState(false);
  const [reenviar, setReenviar] = useState<Entrega | null>(null);
  const { dados, recarregar } = useConsulta(async () => ok(await supabase.from('entrega').select('*, entrega_arquivo(id, nome, tamanho)').eq('obra_id', obra.id).order('criado_em', { ascending: false })) as Entrega[], [obra.id]);
  const lista = dados ?? [];
  if (!lista.length && !mostrarVazio) return null;
  return (
    <div className="card section">
      <div className="topo" style={{ marginBottom: 10 }}>
        <h2>Documentos entregues</h2>
        <button className="btn-secundario" onClick={() => setNova(true)}><Icone nome="mais" /> Nova entrega</button>
      </div>
      {lista.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>Quando o material estiver pronto, toque em “Nova entrega”: escolha os arquivos, a mensagem já vem pronta com as orientações, e você envia por e-mail e WhatsApp. Fica também no portal do cliente.</p>
      ) : (
        <ul className="lista-entregas">
          {lista.map((e) => (
            <li key={e.id}>
              <div>
                <b>{e.titulo}</b>
                <div className="muted small">{formatarDataHora(e.criado_em)} · {(e.entrega_arquivo ?? []).map((a) => a.nome).join(', ')}</div>
                <div className="row small" style={{ gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  {e.email_em && <span className="selo ok">E-mail {e.email_para ? `para ${e.email_para}` : ''}</span>}
                  {e.email_erro && !e.email_em && <span className="selo erro" title={e.email_erro}>E-mail falhou</span>}
                  {e.whatsapp_em && <span className="selo ok">WhatsApp</span>}
                  {e.no_portal && <span className="selo info">No portal</span>}
                  {e.primeiro_acesso_em ? <span className="selo neutro">Cliente abriu {e.acessos}× · {e.downloads} download(s)</span> : <span className="selo neutro">Ainda não aberto</span>}
                </div>
              </div>
              <button className="btn-secundario btn-mini" onClick={() => setReenviar(e)}>Enviar de novo</button>
            </li>
          ))}
        </ul>
      )}
      {nova && <EntregarDocumentos obra={obra} aoFechar={() => { setNova(false); recarregar(); }} aoMudar={recarregar} />}
      {reenviar && <EntregarDocumentos obra={obra} entrega={reenviar} aoFechar={() => { setReenviar(null); recarregar(); }} aoMudar={recarregar} />}
    </div>
  );
}
