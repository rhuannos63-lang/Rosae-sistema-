// Assistente de IA: conversa no sistema, ligação com o WhatsApp e ajustes.
// A IA só prepara as gravações; cada uma espera a confirmação da pessoa.
import { useEffect, useRef, useState } from 'react';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { useAuth } from '../auth/AuthProvider';
import { Topo } from '../components/Layout';
import { Carregando, Erro, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import './assistente.css';

type Msg = { id: string; papel: 'usuario' | 'assistente'; texto: string; canal: string; criado_em: string; anexo?: { tipo: string } | null };
type Acao = { id: string; tipo: string; resumo: string };
type Status = { claude: boolean; gemini: boolean; whatsapp: boolean; numero: string | null; webhook: string; pronto: boolean };
type Config = { provedor: 'claude' | 'gemini'; modelo: string; whatsapp_ativo: boolean; instrucoes: string | null };

const SUGESTOES = [
  'O que está pendente esta semana?',
  'Como está o andamento das obras ativas?',
  'Quais contas vencem nos próximos 7 dias?',
  'Gastei R$ 350 de areia na obra, paguei pela conta principal',
  'Registra no diário: concretagem da laje concluída hoje',
];

export const MODELOS: Record<Config['provedor'], Array<{ id: string; nome: string; custo: string }>> = {
  claude: [
    { id: 'claude-opus-5-5', nome: 'Claude Opus 5.5 (mais inteligente)', custo: 'cerca de US$ 0,03 por mensagem' },
    { id: 'claude-sonnet-5-5', nome: 'Claude Sonnet 5.5 (equilibrado)', custo: 'cerca de US$ 0,015 por mensagem' },
    { id: 'claude-haiku-5-5', nome: 'Claude Haiku 5.5 (econômico)', custo: 'cerca de US$ 0,001 por mensagem' },
  ],
  gemini: [
    { id: 'gemini-2.5-flash', nome: 'Gemini 2.5 Flash', custo: 'grátis dentro do limite diário do Google' },
  ],
};

async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('assistente', { body: corpo });
  if (error) {
    let msg = error.message;
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.erro) msg = j.erro; } catch { /* resposta sem corpo */ }
    if (/Failed to send|FunctionsFetchError|404/i.test(msg)) msg = 'O assistente ainda não foi publicado no servidor. Veja a aba Ligar.';
    throw new Error(msg);
  }
  return data as T;
}

/** Reduz a foto (no máximo 1600 px) antes de enviar. */
async function prepararFoto(arquivo: File): Promise<{ mime: string; base64: string; previa: string }> {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bitmap.width * escala); c.height = Math.round(bitmap.height * escala);
  c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.85);
  return { mime: 'image/jpeg', base64: url.split(',')[1], previa: url };
}

/** Texto com *negrito* e listas simples, sem HTML vindo da IA. */
function TextoFormatado({ texto }: { texto: string }) {
  return (
    <>
      {texto.split('\n').map((linha, i) => (
        <p key={i}>
          {linha.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((t, j) =>
            /^\*\*?[^*]+\*\*?$/.test(t) ? <b key={j}>{t.replace(/\*/g, '')}</b> : <span key={j}>{t}</span>)}
        </p>
      ))}
    </>
  );
}

function Conversa({ status }: { status: Status | null }) {
  const toast = useToast();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [pendentes, setPendentes] = useState<Acao[]>([]);
  const [texto, setTexto] = useState('');
  const [foto, setFoto] = useState<{ mime: string; base64: string; previa: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const arquivo = useRef<HTMLInputElement>(null);

  async function carregar() {
    const [m, a] = await Promise.all([
      supabase.from('assistente_mensagem').select('id, papel, texto, canal, criado_em, anexo').order('criado_em', { ascending: false }).limit(60),
      supabase.from('assistente_acao').select('id, tipo, resumo').eq('estado', 'proposta').order('criado_em'),
    ]);
    if (!m.error) setMsgs(((m.data ?? []) as Msg[]).reverse());
    if (!a.error) setPendentes((a.data ?? []) as Acao[]);
  }
  useEffect(() => { void carregar(); }, []);
  useEffect(() => { fim.current?.scrollIntoView({ block: 'end' }); }, [msgs.length, pendentes.length, enviando]);

  async function enviar(t = texto) {
    if ((!t.trim() && !foto) || enviando) return;
    const temp: Msg = { id: `temp-${Date.now()}`, papel: 'usuario', texto: t.trim() || '(foto)', canal: 'sistema', criado_em: new Date().toISOString(), anexo: foto ? { tipo: 'imagem' } : null };
    setMsgs((m) => [...m, temp]);
    setTexto(''); setEnviando(true);
    const imagem = foto ? { mime: foto.mime, base64: foto.base64 } : null;
    setFoto(null);
    try {
      await chamar<{ texto: string; pendentes: Acao[] }>({ acao: 'mensagem', texto: t, imagem });
      await carregar();
    } catch (e) {
      toast(mensagemErro(e));
      setMsgs((m) => m.filter((x) => x.id !== temp.id));
      setTexto(t);
    } finally {
      setEnviando(false);
    }
  }

  async function decidir(acao: 'confirmar' | 'cancelar', ids: string[]) {
    setEnviando(true);
    try {
      await chamar({ acao, ids });
      await carregar();
    } catch (e) {
      toast(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  async function escolherFoto(f: File | undefined) {
    if (!f) return;
    try { setFoto(await prepararFoto(f)); } catch { toast('Não consegui abrir essa imagem.'); }
  }

  return (
    <section className="card ia-conversa">
      {status && !status.pronto && (
        <div className="aviso" style={{ marginBottom: 12 }}>
          <Icone nome="alerta" />
          <div>A IA ainda não está ligada: falta cadastrar a chave. Veja a aba <b>Ligar</b>.</div>
        </div>
      )}
      <div className="ia-mensagens" aria-live="polite">
        {!msgs.length && (
          <div className="ia-vazio">
            <div className="ia-avatar grande"><Icone nome="varinha" /></div>
            <h2>Como posso ajudar?</h2>
            <p className="muted">Pergunte sobre obras, prazos e dinheiro, ou peça para lançar uma despesa, registrar o diário ou salvar uma foto. Eu sempre peço sua confirmação antes de gravar.</p>
            <div className="ia-sugestoes">
              {SUGESTOES.map((s) => <button key={s} className="btn-secundario" onClick={() => void enviar(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={`ia-msg ${m.papel}`}>
            {m.papel === 'assistente' && <div className="ia-avatar"><Icone nome="varinha" /></div>}
            <div className="ia-balao">
              {m.anexo?.tipo === 'imagem' && <div className="ia-anexo"><Icone nome="foto" /> foto</div>}
              <TextoFormatado texto={m.texto} />
              <div className="ia-hora">
                {m.canal === 'whatsapp' && <span className="selo neutro">WhatsApp</span>}
                {new Date(m.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
        {enviando && <div className="ia-msg assistente"><div className="ia-avatar"><Icone nome="varinha" /></div><div className="ia-balao ia-digitando"><i /><i /><i /></div></div>}
        {pendentes.length > 0 && (
          <div className="ia-pendentes">
            <div className="ia-pendentes-titulo"><Icone nome="check" /> Aguardando sua confirmação</div>
            {pendentes.map((p) => (
              <div key={p.id} className="ia-acao">
                <div className="ia-acao-texto">{p.resumo}</div>
                <div className="row">
                  <button className="btn-primario" disabled={enviando} onClick={() => void decidir('confirmar', [p.id])}>Confirmar</button>
                  <button className="btn-secundario" disabled={enviando} onClick={() => void decidir('cancelar', [p.id])}>Cancelar</button>
                </div>
              </div>
            ))}
            {pendentes.length > 1 && (
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn-link" disabled={enviando} onClick={() => void decidir('cancelar', pendentes.map((p) => p.id))}>Cancelar todas</button>
                <button className="btn-primario" disabled={enviando} onClick={() => void decidir('confirmar', pendentes.map((p) => p.id))}>Confirmar todas</button>
              </div>
            )}
          </div>
        )}
        <div ref={fim} />
      </div>
      <form className="ia-entrada" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
        {foto && (
          <div className="ia-foto-previa">
            <img src={foto.previa} alt="Foto anexada" />
            <button type="button" className="btn-link" onClick={() => setFoto(null)} aria-label="Tirar a foto"><Icone nome="fechar" /></button>
          </div>
        )}
        <div className="ia-entrada-linha">
          <button type="button" className="btn-secundario ia-icone" onClick={() => arquivo.current?.click()} aria-label="Anexar foto" title="Anexar foto (nota, recibo ou obra)">
            <Icone nome="camera" />
          </button>
          <input ref={arquivo} type="file" accept="image/*" hidden onChange={(e) => { void escolherFoto(e.target.files?.[0]); e.target.value = ''; }} />
          <textarea
            rows={1} value={texto} placeholder="Escreva aqui…"
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
            aria-label="Mensagem para o assistente"
          />
          <button className="btn-primario" disabled={enviando || (!texto.trim() && !foto)}>Enviar</button>
        </div>
      </form>
    </section>
  );
}

function WhatsApp({ status }: { status: Status | null }) {
  const toast = useToast();
  const { dados: vinculo, recarregar } = useConsulta(async () =>
    ok(await supabase.from('assistente_vinculo').select('telefone, vinculado_em').maybeSingle()) as { telefone: string | null; vinculado_em: string | null } | null, []);
  const [codigo, setCodigo] = useState<string | null>(null);
  const numero = status?.numero?.replace(/\D/g, '') ?? '';

  async function gerar() {
    const r = await supabase.rpc('assistente_gerar_codigo');
    if (r.error) return toast(mensagemErro(r.error));
    setCodigo(r.data as string);
  }
  async function desvincular() {
    const r = await supabase.rpc('assistente_desvincular');
    if (r.error) return toast(mensagemErro(r.error));
    toast('WhatsApp desligado do seu usuário.');
    void recarregar();
  }

  if (!status) return <Carregando />;
  if (!status.whatsapp) {
    return (
      <section className="card">
        <div className="aviso info"><Icone nome="mensagem" /><div>O WhatsApp ainda não foi ligado ao sistema. O passo a passo está na aba <b>Ligar</b>.</div></div>
      </section>
    );
  }
  return (
    <section className="card stack">
      <div className="card-titulo"><div><h2>Seu WhatsApp</h2><div className="sub">Converse com o assistente pelo celular: texto, foto ou áudio.</div></div></div>
      {vinculo?.telefone ? (
        <>
          <div className="aviso ok"><Icone nome="check" /><div>Ligado ao número <b>+{vinculo.telefone}</b>. Mande mensagem para {status.numero ? <b>{status.numero}</b> : 'o número da ROSAE'}.</div></div>
          <div className="row">
            {numero && <a className="btn-primario" href={`https://wa.me/${numero}`} target="_blank" rel="noreferrer">Abrir conversa</a>}
            <button className="btn-secundario" onClick={() => void desvincular()}>Desligar este número</button>
          </div>
        </>
      ) : (
        <>
          <ol className="ia-passos">
            <li>Gere um código abaixo (vale 15 minutos).</li>
            <li>Do <b>seu</b> WhatsApp, mande <b>vincular</b> e o código para {status.numero ? <b>{status.numero}</b> : 'o número da ROSAE'}.</li>
            <li>Pronto: o assistente passa a responder você por lá, com as mesmas permissões que você tem aqui.</li>
          </ol>
          {codigo ? (
            <div className="ia-codigo">
              <div className="muted small">Mande esta mensagem:</div>
              <div className="ia-codigo-texto">vincular {codigo}</div>
              <div className="row">
                {numero && <a className="btn-primario" href={`https://wa.me/${numero}?text=${encodeURIComponent(`vincular ${codigo}`)}`} target="_blank" rel="noreferrer">Enviar pelo WhatsApp</a>}
                <button className="btn-secundario" onClick={() => void recarregar()}>Já mandei</button>
              </div>
            </div>
          ) : (
            <div><button className="btn-primario" onClick={() => void gerar()}>Gerar código</button></div>
          )}
        </>
      )}
    </section>
  );
}

function Ligar({ status, admin }: { status: Status | null; admin: boolean }) {
  const toast = useToast();
  const { dados: cfg, erro, setDados } = useConsulta(async () =>
    ok(await supabase.from('assistente_config').select('provedor, modelo, whatsapp_ativo, instrucoes').single()) as Config, []);
  const [salvando, setSalvando] = useState(false);
  if (erro) return <Erro mensagem={erro} />;
  if (!cfg) return <Carregando />;
  const mudar = (p: Partial<Config>) => setDados({ ...cfg, ...p });
  const modeloAtual = MODELOS[cfg.provedor].find((m) => m.id === cfg.modelo);

  async function salvar() {
    setSalvando(true);
    const { error } = await supabase.from('assistente_config').update({ provedor: cfg!.provedor, modelo: cfg!.modelo, whatsapp_ativo: cfg!.whatsapp_ativo, instrucoes: cfg!.instrucoes || null }).eq('id', true);
    setSalvando(false);
    toast(error ? mensagemErro(error) : 'Ajustes do assistente salvos.');
  }
  const Selo = ({ ok: s, sim, nao }: { ok: boolean | undefined; sim: string; nao: string }) =>
    <span className={`selo ${s ? 'ok' : 'neutro'}`}>{s ? sim : nao}</span>;

  return (
    <div className="grid ia-ligar">
      <section className="card stack">
        <div className="card-titulo"><div><h2>Situação</h2><div className="sub">O que já está ligado.</div></div></div>
        <div className="ia-situacao">
          <div>Chave do Claude</div><Selo ok={status?.claude} sim="Cadastrada" nao="Falta" />
          <div>Chave do Gemini</div><Selo ok={status?.gemini} sim="Cadastrada" nao="Opcional" />
          <div>WhatsApp</div><Selo ok={status?.whatsapp} sim="Ligado" nao="Falta" />
        </div>
        {admin ? (
          <>
            <label className="campo">Inteligência
              <select value={cfg.provedor} onChange={(e) => { const p = e.target.value as Config['provedor']; mudar({ provedor: p, modelo: MODELOS[p][0].id }); }}>
                <option value="claude">Claude (Anthropic)</option>
                <option value="gemini">Gemini (Google)</option>
              </select>
            </label>
            <label className="campo">Modelo
              <span className="dica">{modeloAtual?.custo}</span>
              <select value={cfg.modelo} onChange={(e) => mudar({ modelo: e.target.value })}>
                {MODELOS[cfg.provedor].map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </select>
            </label>
            <label className="check"><input type="checkbox" checked={cfg.whatsapp_ativo} onChange={(e) => mudar({ whatsapp_ativo: e.target.checked })} /> Responder pelo WhatsApp</label>
            <label className="campo">Instruções extras para o assistente
              <span className="dica">Ex.: "Obras de reforço: sempre lembrar de registrar fotos antes e depois."</span>
              <textarea rows={3} value={cfg.instrucoes ?? ''} onChange={(e) => mudar({ instrucoes: e.target.value })} />
            </label>
            <div><button className="btn-primario" disabled={salvando} onClick={() => void salvar()}>Salvar ajustes</button></div>
          </>
        ) : <p className="muted small">Só o administrador muda a IA e o WhatsApp.</p>}
      </section>
      <section className="card stack ia-guia">
        <div className="card-titulo"><div><h2>Como ligar</h2><div className="sub">Feito uma vez. As chaves ficam guardadas nos segredos do GitHub, nunca no código.</div></div></div>
        <h3>1. Chave da IA</h3>
        <ol>
          <li>Crie a conta em <a href="https://console.anthropic.com" target="_blank" rel="noreferrer">console.anthropic.com</a>, coloque crédito (a partir de US$ 5) e crie uma <i>API key</i>.</li>
          <li>No GitHub do sistema: <b>Settings › Secrets and variables › Actions › New repository secret</b>, nome <code>ANTHROPIC_API_KEY</code>.</li>
          <li>Opcional, para entender áudio do WhatsApp: crie uma chave grátis em <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com</a> e cadastre como <code>GEMINI_API_KEY</code>.</li>
          <li>Em <b>Actions › Publicar assistente › Run workflow</b>, rode para o sistema receber as chaves.</li>
        </ol>
        <h3>2. WhatsApp (API oficial da Meta)</h3>
        <ol>
          <li>Use um chip só para o sistema (o número não pode estar no app do WhatsApp).</li>
          <li>Em <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">developers.facebook.com</a>, crie um app do tipo <b>Empresa</b> e adicione o produto <b>WhatsApp</b>. Cadastre e verifique o número.</li>
          <li>Crie um token permanente (usuário do sistema no Gerenciador de Negócios, permissão <i>whatsapp_business_messaging</i>).</li>
          <li>Cadastre no GitHub: <code>WHATSAPP_TOKEN</code> (o token), <code>WHATSAPP_NUMERO_ID</code> (ID do número de telefone), <code>WHATSAPP_APP_SECRET</code> (Configurações do app › Básico › Chave secreta), <code>WHATSAPP_VERIFY_TOKEN</code> (uma senha que você inventa) e <code>WHATSAPP_NUMERO_EXIBICAO</code> (o número, ex.: +55 21 99999-0000).</li>
          <li>Rode <b>Publicar assistente</b> de novo.</li>
          <li>Na Meta, em WhatsApp › Configuração › Webhook, use a URL abaixo, a mesma senha do <code>WHATSAPP_VERIFY_TOKEN</code>, e assine o campo <b>messages</b>.</li>
        </ol>
        {status?.webhook && <div className="ia-codigo"><div className="muted small">URL do webhook</div><code className="ia-url">{status.webhook}</code>
          <div><button className="btn-secundario" onClick={() => { void navigator.clipboard.writeText(status.webhook); toast('URL copiada.'); }}>Copiar</button></div></div>}
        <p className="muted small">Custos: receber e responder mensagens no WhatsApp oficial é grátis. A IA é cobrada por uso conforme o modelo escolhido ao lado.</p>
      </section>
    </div>
  );
}

export function Assistente() {
  const { ehAdmin } = useAuth();
  const [aba, setAba] = useState<'conversa' | 'whatsapp' | 'ligar'>('conversa');
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    chamar<Status>({ acao: 'status' }).then(setStatus).catch(() =>
      setStatus({ claude: false, gemini: false, whatsapp: false, numero: null, webhook: '', pronto: false }));
  }, []);
  return (
    <>
      <Topo titulo="Assistente IA" sub="Pergunte, lance e registre conversando, aqui ou no WhatsApp. Nada é gravado sem a sua confirmação.">
        <div className="segmentado" role="tablist" aria-label="Seções do assistente">
          {([['conversa', 'Conversa'], ['whatsapp', 'WhatsApp'], ['ligar', 'Ligar']] as const).map(([k, r]) => (
            <button key={k} role="tab" aria-selected={aba === k} className={aba === k ? 'ativo' : ''} onClick={() => setAba(k)}>{r}</button>
          ))}
        </div>
      </Topo>
      {aba === 'conversa' && <Conversa status={status} />}
      {aba === 'whatsapp' && <WhatsApp status={status} />}
      {aba === 'ligar' && <Ligar status={status} admin={ehAdmin} />}
    </>
  );
}
