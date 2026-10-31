// Portal do cliente. Abre pelo link pessoal (/c/<token>): o token fica só neste
// aparelho e some do endereço. Tudo vem de portal_dados, que já filtra o que foi
// publicado; a prévia do escritório ("Ver como cliente") usa a mesma montagem.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { supabase, mensagemErro } from '../lib/supabase';
import { novaChave } from '../lib/consulta';
import { Carregando } from '../components/ui';
import { Icone } from '../components/Icone';
import { CenaServico } from '../components/CenaServico';
import { calcularJornada, faseAtual, perfilDaObra, PERFIS, type Perfil } from '../core/jornada';
import { formatarData, formatarDataHora } from '../core/datas';
import {
  ESTADO_PORTAL, SITUACAO_MATERIAL_PORTAL, STATUS_OBRA_PORTAL, TIPO_COMENTARIO, TIPO_REGISTRO_PORTAL,
  cienciaDoItem, faseEtapa, paresAntesDepois, primeiroNome, proximaEtapa,
  type AlvoTipo, type ComentarioPortal, type DadosPortal, type EtapaPortal, type FotoPortal, type MedicaoPortal, type PendenciaPortal, type RegistroPortal,
} from '../core/portal';

const CHAVE_TOKEN = 'rosae.portal.token';
let tokenMemoria: string | null = null;

export function lerToken(): string | null {
  try { return localStorage.getItem(CHAVE_TOKEN) ?? tokenMemoria; } catch { return tokenMemoria; }
}
function gravarToken(t: string | null) {
  tokenMemoria = t;
  try { if (t) localStorage.setItem(CHAVE_TOKEN, t); else localStorage.removeItem(CHAVE_TOKEN); } catch { /* aparelho sem armazenamento: fica só nesta aba */ }
}

/** /c/<token>: guarda o link neste aparelho e tira o token do endereço. */
export function PortalEntrada() {
  const { token } = useParams();
  if (token) gravarToken(token);
  return <Navigate to="/c" replace />;
}

export function Portal() {
  const navigate = useNavigate();
  const token = lerToken();
  const [d, setD] = useState<DadosPortal | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    if (!token) return;
    const r = await supabase.rpc('portal_dados', { p_token: token });
    if (r.error) return setErro(mensagemErro(r.error));
    setErro(null);
    setD(r.data as DadosPortal);
  }
  useEffect(() => { carregar(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  useEffect(() => { if (d?.obra) document.title = `${d.obra.nome} · Acompanhamento ROSAE`; }, [d]);

  if (!token) return <AvisoPortal titulo="Abra pelo seu link">Use o link pessoal que a ROSAE enviou para você. Cada pessoa da obra tem o seu.</AvisoPortal>;
  if (erro && !d) return <AvisoPortal titulo="Não foi possível abrir">{erro} <button className="btn-link" onClick={carregar}>Tentar de novo</button></AvisoPortal>;
  if (!d) return <Carregando />;
  if (d.erro) return <AvisoPortal titulo="Link sem validade">{d.erro}</AvisoPortal>;
  return <PortalVisao d={d} token={token} recarregar={carregar} sair={() => { gravarToken(null); navigate('/c', { replace: true }); window.location.reload(); }} />;
}

/** "Ver como cliente": mesma tela, com os dados que o cliente vê agora. */
export function PortalPrevia() {
  const { id } = useParams();
  const [d, setD] = useState<DadosPortal | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  async function carregar() {
    const r = await supabase.rpc('portal_previa', { p_obra: id });
    if (r.error) return setErro(mensagemErro(r.error));
    setD(r.data as DadosPortal);
  }
  useEffect(() => { carregar(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (erro) return <AvisoPortal titulo="Prévia indisponível">{erro}</AvisoPortal>;
  if (!d) return <Carregando />;
  return <PortalVisao d={d} token={null} recarregar={carregar} />;
}

function AvisoPortal({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="portal portal-aviso">
      <div className="portal-aviso-card">
        <img src="/marca/rosae-logo-vertical.svg" alt="ROSAE Engenharia & Estruturas" width={140} />
        <h1>{titulo}</h1>
        <p>{children}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Fotos (cópia publicada, servida pela função do portal)
// ---------------------------------------------------------------------
const cacheFotos = new Map<string, Promise<string>>();
function useFoto(token: string | null, id: string | null | undefined, grande = false): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let vivo = true;
    const k = `${token ?? 'previa'}:${id}:${grande ? 'g' : 'm'}`;
    let p = cacheFotos.get(k);
    if (!p) {
      p = (async () => {
        const r = await supabase.rpc('portal_foto', { p_token: token, p_foto: id, p_grande: grande });
        if (r.error) throw r.error;
        const b64 = (r.data as string).replace(/\s/g, '');
        return `data:${b64.startsWith('UklGR') ? 'image/webp' : 'image/jpeg'};base64,${b64}`;
      })();
      cacheFotos.set(k, p);
      p.catch(() => cacheFotos.delete(k));
    }
    p.then((u) => vivo && setUrl(u)).catch(() => vivo && setUrl(null));
    return () => { vivo = false; };
  }, [token, id, grande]);
  return url;
}

export function ImagemPortal({ token, id, grande, alt, className }: { token: string | null; id: string; grande?: boolean; alt: string; className?: string }) {
  const url = useFoto(token, id, grande);
  return url ? <img src={url} alt={alt} className={className} decoding="async" /> : <div className={`${className ?? ''} foto-espera`} aria-hidden="true" />;
}

// ---------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------
type Aba = 'inicio' | 'cronograma' | 'ambientes' | 'fotos' | 'medicoes' | 'atualizacoes' | 'mensagens';
type Ctx = { d: DadosPortal; token: string | null; recarregar: () => Promise<void> | void; nomeServico: (id: string | null) => string; nomeEtapa: (id: string | null) => string; abrirFoto: (f: FotoPortal) => void };

function PortalVisao({ d, token, recarregar, sair }: { d: DadosPortal; token: string | null; recarregar: () => Promise<void> | void; sair?: () => void }) {
  const [aba, setAba] = useState<Aba>('inicio');
  const [foto, setFoto] = useState<FotoPortal | null>(null);
  const servicos = useMemo(() => new Map(d.servicos.map((s) => [s.id, s.nome])), [d.servicos]);
  const etapas = useMemo(() => new Map(d.etapas.map((e) => [e.id, e.nome])), [d.etapas]);
  const ctx: Ctx = {
    d, token, recarregar,
    nomeServico: (id) => (id ? servicos.get(id) ?? '' : ''),
    nomeEtapa: (id) => (id ? etapas.get(id) ?? '' : ''),
    abrirFoto: setFoto,
  };
  const eu = d.eu?.id;
  const semCiencia = [
    ...d.registros.filter((r) => !cienciaDoItem(d.ciencias, 'registro', r.id, r.versao).euAtual(eu)),
    ...d.pendencias.filter((p) => p.estado === 'aberta' && !cienciaDoItem(d.ciencias, 'pendencia', p.id, p.versao).euAtual(eu)),
  ].length;
  const medicoes = d.medicoes ?? [];
  const abas: [Aba, string, number?][] = [
    ['inicio', 'Início'], ['cronograma', 'Etapas'], ...(d.ambientes.length ? [['ambientes', 'Ambientes'] as [Aba, string]] : []), ...(d.fotos.length ? [['fotos', 'Fotos', d.fotos.length] as [Aba, string, number]] : []),
    ...(medicoes.length ? [['medicoes', 'Medições', medicoes.filter((m) => m.estado === 'enviada').length] as [Aba, string, number]] : []),
    ['atualizacoes', 'Atualizações', eu ? semCiencia : undefined], ['mensagens', 'Mensagens', d.comentarios.length],
  ];
  function irPara(a: Aba) {
    setAba(a);
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  return (
    <div className="portal">
      {d.previa && (
        <div className="portal-previa" role="status">
          <Icone nome="olho" /> <span><strong>Prévia:</strong> é exatamente o que o cliente vê agora. Envios estão desligados aqui.</span>
        </div>
      )}
      <header className="portal-topo">
        <img src="/marca/rosae-logo-horizontal.svg" alt="ROSAE Engenharia & Estruturas" className="portal-logo" />
        <div className="portal-quem">
          {d.eu ? <>Olá, <strong>{primeiroNome(d.eu.nome)}</strong></> : <span>Portal do cliente</span>}
        </div>
      </header>

      <Capa ctx={ctx} />

      <nav className="portal-abas" aria-label="Seções do acompanhamento">
        {abas.map(([k, rot, n]) => (
          <button key={k} className={aba === k ? 'ativo' : ''} aria-current={aba === k ? 'page' : undefined} onClick={() => irPara(k)}>
            {rot}{n ? <span className="portal-badge" aria-label={`${n} itens`}>{n}</span> : null}
          </button>
        ))}
      </nav>

      <main className="portal-corpo" key={aba}>
        {aba === 'inicio' && <Inicio ctx={ctx} irPara={irPara} />}
        {aba === 'cronograma' && <Etapas ctx={ctx} />}
        {aba === 'ambientes' && <Ambientes ctx={ctx} />}
        {aba === 'fotos' && <Fotos ctx={ctx} />}
        {aba === 'medicoes' && <Medicoes ctx={ctx} />}
        {aba === 'atualizacoes' && <Atualizacoes ctx={ctx} />}
        {aba === 'mensagens' && <Mensagens ctx={ctx} />}
      </main>

      <footer className="portal-rodape">
        {d.empresa?.frase && <p className="portal-frase">“{d.empresa.frase}”</p>}
        <p>
          {d.empresa?.nome ?? 'ROSAE Engenharia & Estruturas'} · {d.empresa?.responsavel}
          {d.empresa?.telefone && <> · <a href={`tel:${d.empresa.telefone.replace(/\D/g, '')}`}>{d.empresa.telefone}</a></>}
          {d.empresa?.email && <> · <a href={`mailto:${d.empresa.email}`}>{d.empresa.email}</a></>}
        </p>
        <p className="small">
          Este acompanhamento mostra o andamento físico publicado pela ROSAE. Valores, pagamentos e documentos comerciais seguem por e-mail.
          {d.expira_em && <> Seu link pessoal vale até {formatarData(d.expira_em)}.</>}
        </p>
        <p className="portal-rodape-acoes">
          <a href={token ? '/c/relatorio' : `/obras/${d.obra.id}/relatorio-cliente`} target={token ? undefined : '_blank'} rel="noreferrer">Relatório para imprimir</a>
          {sair && <button className="btn-link" onClick={sair}>Sair deste aparelho</button>}
        </p>
      </footer>

      {foto && <VerFoto ctx={ctx} foto={foto} fechar={() => setFoto(null)} mudar={setFoto} />}
    </div>
  );
}

function Capa({ ctx }: { ctx: Ctx }) {
  const { d, token } = ctx;
  const capa = useFoto(token, d.obra.capa, true);
  return (
    <section className={`portal-capa ${capa ? 'com-imagem' : ''}`} style={capa ? { backgroundImage: `url("${capa}")` } : undefined}>
      <div className="portal-capa-conteudo">
        <span className="portal-kicker">{d.obra.codigo} · {STATUS_OBRA_PORTAL[d.obra.status] ?? 'Em andamento'}</span>
        <h1>{d.obra.nome}</h1>
        {d.obra.endereco && <p className="portal-endereco">{d.obra.endereco}</p>}
      </div>
    </section>
  );
}

function Barra({ valor, rotulo }: { valor: number; rotulo: string }) {
  return (
    <div className="portal-barra" role="progressbar" aria-valuenow={Math.round(valor)} aria-valuemin={0} aria-valuemax={100} aria-label={rotulo}>
      <div style={{ width: `${Math.min(100, Math.max(0, valor))}%` }} />
    </div>
  );
}

function SeloEstado({ e }: { e: EtapaPortal }) {
  const s = ESTADO_PORTAL[e.estado];
  return <span className={`selo ${s.tom}`}>{s.rotulo}</span>;
}

function datasEtapa(e: EtapaPortal): string {
  const prev = e.inicio_previsto || e.fim_previsto ? `Previsto ${formatarData(e.inicio_previsto)}${e.fim_previsto ? ` a ${formatarData(e.fim_previsto)}` : ''}` : 'Data a definir';
  if (e.fim_real) return `Concluída em ${formatarData(e.fim_real)}`;
  if (e.inicio_real) return `Iniciada em ${formatarData(e.inicio_real)}${e.fim_previsto ? ` · previsão ${formatarData(e.fim_previsto)}` : ''}`;
  return prev;
}

function Inicio({ ctx, irPara }: { ctx: Ctx; irPara: (a: Aba) => void }) {
  const { d } = ctx;
  const decisoes = d.pendencias.filter((p) => p.estado === 'aberta' && p.responsavel === 'cliente');
  const medicaoAberta = (d.medicoes ?? []).find((m) => m.estado === 'enviada');
  const ultimas = d.fotos.slice(0, 8);
  const perfil = perfilDaObra(d.obra.tipo_servico, d.obra.perfil);
  return (
    <div className="portal-stack">
      {d.obra.boas_vindas && <p className="portal-boas-vindas">{d.obra.boas_vindas}</p>}

      {(medicaoAberta || decisoes.length > 0) && (
        <section className="portal-card portal-destaque portal-aguardando">
          <h2><Icone nome="alerta" /> Aguardando você</h2>
          <ul className="portal-lista">
            {medicaoAberta && (
              <li className="portal-linha">
                <span><strong>Medição nº {medicaoAberta.numero}</strong><span className="muted"> · {fmtPct(medicaoAberta.percentual_atual)} executado até {formatarData(medicaoAberta.data_corte)}</span></span>
                <button className="btn-primario" onClick={() => irPara('medicoes')}>Conferir</button>
              </li>
            )}
            {decisoes.map((p) => (
              <li key={p.id} className="portal-linha">
                <span><strong>{p.titulo}</strong>{p.prazo && <span className="muted"> · até {formatarData(p.prazo)}</span>}</span>
                <button className="btn-secundario" onClick={() => irPara('atualizacoes')}>Responder</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Jornada ctx={ctx} perfil={perfil} />

      {perfil !== 'reforma' && d.ambientes.length > 0 && (
        <section className="portal-card">
          <div className="portal-linha"><h2>Por ambiente</h2><button className="btn-link" onClick={() => irPara('ambientes')}>Explorar</button></div>
          <div className="portal-ambientes-mini">
            {d.ambientes.map((a) => (
              <div key={a.id}><div className="portal-linha"><span>{a.nome}</span><strong>{Math.round(Number(a.executado))}%</strong></div><Barra valor={Number(a.executado)} rotulo={a.nome} /></div>
            ))}
          </div>
        </section>
      )}

      {ultimas.length > 0 && (
        <section className="portal-card">
          <div className="portal-linha"><h2>Fotos recentes</h2><button className="btn-link" onClick={() => irPara('fotos')}>Ver todas</button></div>
          <div className="portal-faixa">
            {ultimas.map((f) => (
              <button key={f.id} className="portal-mini" onClick={() => ctx.abrirFoto(f)} aria-label={`Abrir foto ${f.legenda ?? ''} de ${formatarData(f.tirada_em)}`}>
                <ImagemPortal token={ctx.token} id={f.id} alt={f.legenda ?? 'Foto da obra'} />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** A jornada do serviço: desenho que cresce com a obra, fases em linguagem simples e o detalhe da fase escolhida. */
function Jornada({ ctx, perfil }: { ctx: Ctx; perfil: Perfil }) {
  const { d } = ctx;
  const def = PERFIS[perfil];
  const fases = useMemo(() => calcularJornada(perfil, d.etapas, Number(d.progresso.executado), ctx.nomeServico),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [perfil, d.etapas, d.progresso.executado]);
  const atual = faseAtual(fases);
  const [sel, setSel] = useState(atual);
  const fase = fases[sel] ?? fases[atual];
  const executado = Number(d.progresso.executado);
  const concluida = fases.every((f) => f.estado === 'concluida');
  const proxima = proximaEtapa(d.etapas);
  const idsEtapas = new Set(fase.etapas.map((e) => e.id));
  const fotosFase = d.fotos.filter((f) => f.etapa_id && idsEtapas.has(f.etapa_id)).slice(0, 6);
  const entregaveis = d.obra.entregaveis ?? [];
  const ambientes = d.ambientes.map((a) => ({ nome: a.nome, executado: Number(a.executado) }));
  return (
    <section className={`portal-jornada perfil-${perfil}`} aria-label={`Jornada: ${def.nome}`}>
      <div className="pj-topo">
        <div>
          <span className="pj-kicker">{d.obra.tipo_servico || def.nome}</span>
          <h2>{concluida ? 'Tudo pronto. Obrigado pela confiança!' : def.chamada}</h2>
        </div>
        <div className="pj-pct" aria-label={`${Math.round(executado)}% executado`}><strong>{Math.round(executado)}%</strong><span>executado</span></div>
      </div>

      <div className="pj-grade">
        <div className="pj-cena">
          <CenaServico perfil={perfil} fases={fases} ambientes={ambientes} rotulo={`Ilustração do andamento: ${fases.filter((f) => f.estado === 'concluida').length} de ${fases.length} fases concluídas`} />
          <div className="pj-legenda"><span className="l-feito" /> concluído <span className="l-agora" /> em andamento <span className="l-depois" /> a seguir</div>
        </div>

        <div className="pj-lado">
          <ol className="pj-fases">
            {fases.map((f, k) => (
              <li key={f.id} className={`pj-fase ${f.estado}${k === sel ? ' sel' : ''}`}>
                <button onClick={() => setSel(k)} aria-pressed={k === sel}>
                  <span className="pj-bolinha" aria-hidden="true">{f.estado === 'concluida' ? '✓' : k + 1}</span>
                  <span className="pj-fase-nome">{f.nome}</span>
                  <span className="pj-fase-est">{f.estado === 'concluida' ? 'Concluída' : f.estado === 'atual' ? `${Math.round(f.progresso)}%` : k === atual ? 'A seguir' : ''}</span>
                </button>
              </li>
            ))}
          </ol>

          <div className="pj-detalhe" key={fase.id}>
            <span className="pj-kicker">{fase.estado === 'concluida' ? 'Fase concluída' : fase.estado === 'atual' ? `Agora ${def.onde}` : 'Próxima fase'}</span>
            <h3>{fase.nome}</h3>
            <p>{fase.agora}</p>
            {fase.estado === 'atual' && <Barra valor={fase.progresso} rotulo={`Andamento da fase ${fase.nome}`} />}
            {fase.etapas.length > 0 && (
              <ul className="pj-etapas">
                {fase.etapas.map((e) => (
                  <li key={e.id}>
                    <span className={`pj-mini ${faseEtapa(e)}`} aria-hidden="true" />
                    <span><strong>{e.nome}</strong><span className="muted small"> · {datasEtapa(e)}</span></span>
                    <SeloEstado e={e} />
                  </li>
                ))}
              </ul>
            )}
            {fotosFase.length > 0 && (
              <div className="portal-faixa">
                {fotosFase.map((f) => (
                  <button key={f.id} className="portal-mini" onClick={() => ctx.abrirFoto(f)} aria-label={`Abrir foto de ${formatarData(f.tirada_em)}`}>
                    <ImagemPortal token={ctx.token} id={f.id} alt={f.legenda ?? `Foto: ${fase.nome}`} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <dl className="pj-numeros">
        <div><dt>Etapas concluídas</dt><dd>{d.progresso.concluidas} de {d.progresso.etapas}</dd></div>
        <div><dt>Conferido pela engenharia</dt><dd>{Math.round(Number(d.progresso.conferido))}%</dd></div>
        <div><dt>{d.obra.data_conclusao ? 'Concluída em' : 'Previsão de término'}</dt><dd>{d.obra.data_conclusao ? formatarData(d.obra.data_conclusao) : d.obra.data_previsao_fim ? formatarData(d.obra.data_previsao_fim) : 'A definir'}</dd></div>
        <div><dt>Próxima atividade</dt><dd>{proxima ? proxima.nome : concluida ? '—' : 'A publicar'}</dd></div>
      </dl>

      {entregaveis.length > 0 && (
        <div className="pj-entregaveis">
          <h3>O que você recebe</h3>
          <ul>
            {entregaveis.map((x) => <li key={x} className={concluida ? 'pronto' : ''}><span aria-hidden="true">{concluida ? '✓' : '○'}</span>{x}</li>)}
          </ul>
        </div>
      )}
      <p className="portal-nota">
        O percentual mede o serviço executado, pelo peso técnico de cada etapa; compras e pagamentos não mudam esse número.
        “Conferido” é a parte já verificada pela engenharia.
      </p>
    </section>
  );
}


function Etapas({ ctx }: { ctx: Ctx }) {
  const { d } = ctx;
  const grupos: [string, EtapaPortal[]][] = [
    ['Em andamento', d.etapas.filter((e) => faseEtapa(e) === 'atual')],
    ['Próximas', d.etapas.filter((e) => faseEtapa(e) === 'futura')],
    ['Concluídas', d.etapas.filter((e) => faseEtapa(e) === 'concluida')],
  ];
  return (
    <div className="portal-stack">
      {d.etapas.length === 0 && <p className="portal-card muted">As etapas aparecem aqui quando a ROSAE publicar o cronograma.</p>}
      {grupos.filter(([, l]) => l.length).map(([titulo, lista]) => (
        <section key={titulo}>
          <h2 className="portal-sec">{titulo} <span className="muted">({lista.length})</span></h2>
          <ol className="portal-tempo">
            {lista.map((e) => (
              <li key={e.id} className={`fase-${faseEtapa(e)}`}>
                <span className="portal-ponto" aria-hidden="true" />
                <div className="portal-card">
                  <div className="portal-linha"><strong>{e.nome}</strong><SeloEstado e={e} /></div>
                  <span className="muted small">{ctx.nomeServico(e.servico_id)} · {datasEtapa(e)}</span>
                  {faseEtapa(e) === 'atual' && <Barra valor={Number(e.percentual)} rotulo={`Andamento de ${e.nome}`} />}
                  <Conversa ctx={ctx} alvo="etapa" id={e.id} />
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
      {d.materiais.length > 0 && (
        <section className="portal-card">
          <h2>Materiais</h2>
          <p className="muted small">Situação operacional dos materiais (sem valores).</p>
          <ul className="portal-lista">
            {d.materiais.map((m) => (
              <li key={m.id} className="portal-linha">
                <span>{m.descricao}{m.compra_cliente && <span className="muted small"> · compra por sua conta</span>}{m.necessario_em && <span className="muted small"> · para {formatarData(m.necessario_em)}</span>}</span>
                <span className={`selo ${m.situacao === 'disponivel' ? 'ok' : m.situacao === 'aguardando_entrega' ? 'info' : 'neutro'}`}>{SITUACAO_MATERIAL_PORTAL[m.situacao]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Ambientes({ ctx }: { ctx: Ctx }) {
  const { d } = ctx;
  const [aberto, setAberto] = useState<string | null>(d.ambientes[0]?.id ?? null);
  const semAmbiente = d.servicos.filter((s) => s.ambientes.length === 0);
  const grupos = [...d.ambientes.map((a) => ({ id: a.id, nome: a.nome, executado: Number(a.executado), servicos: d.servicos.filter((s) => s.ambientes.includes(a.id)) })),
    ...(semAmbiente.length ? [{ id: 'geral', nome: 'Geral', executado: NaN, servicos: semAmbiente }] : [])];
  if (!grupos.length) return <p className="portal-card muted">Os ambientes aparecem aqui quando o escopo estiver organizado.</p>;
  return (
    <div className="portal-stack">
      {grupos.map((g) => {
        const fotosAmb = d.fotos.filter((f) => f.ambiente_id === g.id || g.servicos.some((s) => s.id === f.servico_id));
        const ab = aberto === g.id;
        return (
          <section key={g.id} className={`portal-card portal-amb ${ab ? 'aberto' : ''}`}>
            <button className="portal-amb-cab" aria-expanded={ab} onClick={() => setAberto(ab ? null : g.id)}>
              <span className="portal-amb-nome">{g.nome}</span>
              {!Number.isNaN(g.executado) && <strong>{Math.round(g.executado)}%</strong>}
            </button>
            {!Number.isNaN(g.executado) && <Barra valor={g.executado} rotulo={g.nome} />}
            {ab && (
              <div className="portal-amb-corpo">
                {g.servicos.map((s) => {
                  const ets = d.etapas.filter((e) => e.servico_id === s.id);
                  return (
                    <div key={s.id} className="portal-servico">
                      <div className="portal-linha"><strong>{s.nome}</strong>{s.executado != null && <span>{Math.round(Number(s.executado))}%</span>}</div>
                      {ets.length > 0 && (
                        <ul className="portal-etapas-mini">
                          {ets.map((e) => <li key={e.id} className={`fase-${faseEtapa(e)}`}><span>{e.nome}</span><SeloEstado e={e} /></li>)}
                        </ul>
                      )}
                      <Conversa ctx={ctx} alvo="servico" id={s.id} />
                    </div>
                  );
                })}
                {fotosAmb.length > 0 && (
                  <div className="portal-faixa">
                    {fotosAmb.slice(0, 8).map((f) => (
                      <button key={f.id} className="portal-mini" onClick={() => ctx.abrirFoto(f)} aria-label={`Abrir foto de ${formatarData(f.tirada_em)}`}>
                        <ImagemPortal token={ctx.token} id={f.id} alt={f.legenda ?? 'Foto do ambiente'} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

const MOMENTO: Record<FotoPortal['momento'], string> = { antes: 'Antes', durante: 'Durante', depois: 'Depois', outro: 'Outras' };

function Fotos({ ctx }: { ctx: Ctx }) {
  const { d } = ctx;
  const [filtro, setFiltro] = useState<FotoPortal['momento'] | 'todas'>('todas');
  const pares = useMemo(() => paresAntesDepois(d.fotos), [d.fotos]);
  const lista = d.fotos.filter((f) => filtro === 'todas' || f.momento === filtro);
  if (!d.fotos.length) return <p className="portal-card muted">As fotos aparecem aqui quando a ROSAE publicar.</p>;
  return (
    <div className="portal-stack">
      {pares.length > 0 && (
        <section className="portal-card">
          <h2>Antes e depois</h2>
          {pares.map((p) => <AntesDepois key={p.chave} ctx={ctx} antes={p.antes} depois={p.depois} />)}
        </section>
      )}
      <div className="portal-filtros" role="group" aria-label="Filtrar fotos">
        {(['todas', 'antes', 'durante', 'depois', 'outro'] as const).filter((m) => m === 'todas' || d.fotos.some((f) => f.momento === m)).map((m) => (
          <button key={m} className={filtro === m ? 'ativo' : ''} aria-pressed={filtro === m} onClick={() => setFiltro(m)}>{m === 'todas' ? 'Todas' : MOMENTO[m]}</button>
        ))}
      </div>
      <div className="portal-galeria">
        {lista.map((f) => (
          <button key={f.id} className="portal-foto" onClick={() => ctx.abrirFoto(f)} aria-label={`Abrir foto ${f.legenda ?? ''} de ${formatarData(f.tirada_em)}`}>
            <ImagemPortal token={ctx.token} id={f.id} alt={f.legenda ?? 'Foto da obra'} />
            <span className="portal-foto-data">{formatarData(f.tirada_em)} · {MOMENTO[f.momento]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AntesDepois({ ctx, antes, depois }: { ctx: Ctx; antes: FotoPortal; depois: FotoPortal }) {
  const [pos, setPos] = useState(50);
  const titulo = ctx.nomeEtapa(antes.etapa_id) || ctx.nomeServico(antes.servico_id) || antes.legenda || 'Comparação';
  return (
    <figure className="portal-comparador">
      <div className="portal-comparador-quadro">
        <ImagemPortal token={ctx.token} id={depois.id} grande alt={`Depois: ${titulo}`} />
        <div className="portal-comparador-antes" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
          <ImagemPortal token={ctx.token} id={antes.id} grande alt={`Antes: ${titulo}`} />
        </div>
        <div className="portal-comparador-linha" style={{ left: `${pos}%` }} aria-hidden="true" />
        <span className="portal-comparador-rot esq">Antes</span><span className="portal-comparador-rot dir">Depois</span>
        <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label={`Comparar antes e depois: ${titulo}`} />
      </div>
      <figcaption>{titulo} · {formatarData(antes.tirada_em)} → {formatarData(depois.tirada_em)}</figcaption>
    </figure>
  );
}

function VerFoto({ ctx, foto, fechar, mudar }: { ctx: Ctx; foto: FotoPortal; fechar: () => void; mudar: (f: FotoPortal) => void }) {
  const lista = ctx.d.fotos;
  const i = lista.findIndex((f) => f.id === foto.id);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar();
      if (e.key === 'ArrowRight' && i < lista.length - 1) mudar(lista[i + 1]);
      if (e.key === 'ArrowLeft' && i > 0) mudar(lista[i - 1]);
    };
    window.addEventListener('keydown', tecla);
    return () => { window.removeEventListener('keydown', tecla); anterior?.focus(); };
  }, [i, lista, fechar, mudar]);
  const contexto = [ctx.nomeServico(foto.servico_id), ctx.nomeEtapa(foto.etapa_id)].filter(Boolean).join(' · ');
  return (
    <div className="portal-luz" role="dialog" aria-modal="true" aria-label="Foto" tabIndex={-1} ref={ref} onClick={(e) => e.target === e.currentTarget && fechar()}>
      <div className="portal-luz-caixa">
        <div className="portal-luz-topo">
          <span>{i + 1} de {lista.length}</span>
          <button className="portal-luz-fechar" onClick={fechar} aria-label="Fechar"><Icone nome="fechar" /></button>
        </div>
        <div className="portal-luz-img">
          <ImagemPortal token={ctx.token} id={foto.id} grande alt={foto.legenda ?? 'Foto da obra'} />
          {i > 0 && <button className="portal-luz-nav esq" onClick={() => mudar(lista[i - 1])} aria-label="Foto anterior"><Icone nome="voltar" /></button>}
          {i < lista.length - 1 && <button className="portal-luz-nav dir" onClick={() => mudar(lista[i + 1])} aria-label="Próxima foto"><Icone nome="voltar" /></button>}
        </div>
        <div className="portal-luz-info">
          {foto.legenda && <p><strong>{foto.legenda}</strong></p>}
          <p className="muted small">{formatarDataHora(foto.tirada_em)} · {MOMENTO[foto.momento]}{contexto && ` · ${contexto}`}</p>
          <Conversa ctx={ctx} alvo="foto" id={foto.id} aberta />
        </div>
      </div>
    </div>
  );
}

const DETALHE: [string, string][] = [
  ['condicao_anterior', 'Condição anterior'], ['riscos', 'Riscos identificados'], ['protecao', 'Proteção ou desmontagem'],
  ['recomposicao_inclusa', 'Recomposições incluídas'], ['recomposicao_nao_inclusa', 'Recomposições não incluídas'],
  ['impedimentos', 'Impedimentos'], ['solucao', 'Solução proposta'],
];

type ItemFeed = { k: 'registro'; data: string; r: RegistroPortal } | { k: 'pendencia'; data: string; p: PendenciaPortal };

function Atualizacoes({ ctx }: { ctx: Ctx }) {
  const { d } = ctx;
  const itens: ItemFeed[] = [
    ...d.registros.map((r) => ({ k: 'registro' as const, data: r.publicado_em, r })),
    ...d.pendencias.map((p) => ({ k: 'pendencia' as const, data: p.publicado_em, p })),
  ].sort((a, b) => {
    const abertoA = a.k === 'pendencia' && a.p.estado === 'aberta' ? 1 : 0, abertoB = b.k === 'pendencia' && b.p.estado === 'aberta' ? 1 : 0;
    return abertoB - abertoA || b.data.localeCompare(a.data);
  });
  if (!itens.length) return <p className="portal-card muted">As atualizações publicadas pela ROSAE aparecem aqui.</p>;
  return (
    <div className="portal-stack">
      {itens.map((it) => it.k === 'registro' ? (
        <article key={it.r.id} className="portal-card portal-registro">
          <div className="portal-linha">
            <span className={`selo ${it.r.tipo === 'impedimento' ? 'alerta' : it.r.tipo === 'decisao' ? 'info' : 'neutro'}`}>{TIPO_REGISTRO_PORTAL[it.r.tipo]}</span>
            <span className="muted small">{formatarData(it.r.data)}</span>
          </div>
          {it.r.titulo && <h3>{it.r.titulo}</h3>}
          {it.r.texto && <p className="portal-texto">{it.r.texto}</p>}
          {Object.keys(it.r.detalhes ?? {}).length > 0 && (
            <dl className="portal-detalhes">
              {DETALHE.filter(([k]) => it.r.detalhes[k]).map(([k, rot]) => <div key={k}><dt>{rot}</dt><dd>{String(it.r.detalhes[k])}</dd></div>)}
              {it.r.detalhes.aprovacao_necessaria === true && <div><dt>Aprovação</dt><dd>É necessária aprovação antes de prosseguir.</dd></div>}
            </dl>
          )}
          {(it.r.servico_id || it.r.etapa_id) && <p className="muted small">{[ctx.nomeServico(it.r.servico_id), ctx.nomeEtapa(it.r.etapa_id)].filter(Boolean).join(' · ')}</p>}
          <FotosDoRegistro ctx={ctx} id={it.r.id} />
          <Ciencia ctx={ctx} tipo="registro" id={it.r.id} versao={it.r.versao} />
          <Conversa ctx={ctx} alvo="registro" id={it.r.id} />
        </article>
      ) : (
        <article key={it.p.id} className={`portal-card portal-registro ${it.p.estado === 'aberta' && it.p.responsavel === 'cliente' ? 'portal-destaque' : ''}`}>
          <div className="portal-linha">
            <span className={`selo ${it.p.estado === 'resolvida' ? 'ok' : 'alerta'}`}>
              {it.p.tipo === 'decisao_cliente' ? 'Decisão' : it.p.tipo === 'impedimento' ? 'Impedimento' : it.p.tipo === 'inspecao' ? 'Inspeção' : 'Pendência'} · {it.p.estado === 'resolvida' ? 'resolvida' : 'em aberto'}
            </span>
            {it.p.prazo && <span className="muted small">até {formatarData(it.p.prazo)}</span>}
          </div>
          <h3>{it.p.titulo}</h3>
          {it.p.descricao && <p className="portal-texto">{it.p.descricao}</p>}
          {it.p.estado === 'aberta' && it.p.responsavel === 'cliente' && <p className="small"><strong>Depende de você.</strong> Responda pelos comentários abaixo ou fale com a ROSAE.</p>}
          {it.p.resolucao && <p className="small"><strong>Resolução:</strong> {it.p.resolucao}</p>}
          <Ciencia ctx={ctx} tipo="pendencia" id={it.p.id} versao={it.p.versao} />
          <Conversa ctx={ctx} alvo="pendencia" id={it.p.id} />
        </article>
      ))}
    </div>
  );
}

function FotosDoRegistro({ ctx, id }: { ctx: Ctx; id: string }) {
  const fotos = ctx.d.fotos.filter((f) => f.registro_id === id);
  if (!fotos.length) return null;
  return (
    <div className="portal-faixa">
      {fotos.map((f) => (
        <button key={f.id} className="portal-mini" onClick={() => ctx.abrirFoto(f)} aria-label={`Abrir foto de ${formatarData(f.tirada_em)}`}>
          <ImagemPortal token={ctx.token} id={f.id} alt={f.legenda ?? 'Foto do registro'} />
        </button>
      ))}
    </div>
  );
}

const fmtPct = (v: number) => `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const ESTADO_MEDICAO_PORTAL = { enviada: { rotulo: 'Aguardando sua resposta', tom: 'alerta' }, aprovada: { rotulo: 'Aprovada', tom: 'ok' }, contestada: { rotulo: 'Contestada', tom: 'erro' } } as const;

function Medicoes({ ctx }: { ctx: Ctx }) {
  const lista = ctx.d.medicoes ?? [];
  return (
    <div className="portal-stack">
      <section className="portal-card">
        <h2>Medições</h2>
        <p className="portal-nota" style={{ marginTop: 0 }}>
          A medição registra quanto da obra foi executado até a data de corte, etapa por etapa. Confira e aprove, ou conteste dizendo o que não confere.
          Os valores do período seguem pela cobrança combinada no contrato.
        </p>
      </section>
      {lista.map((m) => <MedicaoCliente key={m.id} ctx={ctx} m={m} />)}
    </div>
  );
}

function MedicaoCliente({ ctx, m }: { ctx: Ctx; m: MedicaoPortal }) {
  const { d, token } = ctx;
  const [acao, setAcao] = useState<'aprovar' | 'contestar' | null>(null);
  const [nome, setNome] = useState(d.eu?.nome ?? '');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const e = ESTADO_MEDICAO_PORTAL[m.estado];
  async function responder(ev: React.FormEvent) {
    ev.preventDefault();
    if (!acao) return;
    setEnviando(true); setErro(null);
    const r = await supabase.rpc('portal_responder_medicao', { p_token: token, p_medicao: m.id, p_hash: m.hash, p_acao: acao, p_nome: nome, p_texto: texto || null, p_user_agent: navigator.userAgent });
    setEnviando(false);
    if (r.error) return setErro(mensagemErro(r.error));
    setOk((r.data as { mensagem: string }).mensagem);
    setAcao(null);
    await ctx.recarregar();
  }
  return (
    <section className={`portal-card${m.estado === 'enviada' ? ' portal-destaque' : ''}`}>
      <div className="portal-linha"><h2>Medição nº {m.numero}</h2><span className={`selo ${e.tom}`}>{e.rotulo}</span></div>
      <p className="muted small">Data de corte {formatarData(m.data_corte)} · enviada em {formatarDataHora(m.enviada_em)}</p>
      <dl className="portal-numeros">
        <div><dt>Executado antes</dt><dd>{fmtPct(m.percentual_anterior)}</dd></div>
        <div><dt>Executado até o corte</dt><dd>{fmtPct(m.percentual_atual)}</dd></div>
        <div><dt>Neste período</dt><dd>{fmtPct(m.percentual_atual - m.percentual_anterior)}</dd></div>
      </dl>
      <Barra valor={Number(m.percentual_atual)} rotulo={`Executado até a medição ${m.numero}`} />
      <details className="portal-medicao-itens" open={m.estado === 'enviada'}>
        <summary>Ver etapa por etapa ({m.itens.length})</summary>
        <ul className="portal-lista">
          {m.itens.map((i, k) => (
            <li key={k}>
              <div className="portal-linha"><strong>{i.etapa}</strong><span className="small">{fmtPct(i.anterior)} → <strong>{fmtPct(i.atual)}</strong></span></div>
              <span className="muted small">{i.servico}</span>
              <Barra valor={Number(i.atual)} rotulo={`Andamento de ${i.etapa}`} />
            </li>
          ))}
        </ul>
      </details>
      {m.observacao && <p><strong>Observação da ROSAE:</strong> {m.observacao}</p>}
      {m.respondida_em && (
        <p className="small">{m.estado === 'aprovada' ? 'Aprovada' : 'Contestada'} por <strong>{m.resposta_nome}</strong> em {formatarDataHora(m.respondida_em)}{m.resposta_texto ? `: “${m.resposta_texto}”` : '.'}</p>
      )}
      {ok && <div className="aviso ok"><span>{ok}</span></div>}
      {m.estado === 'enviada' && !d.previa && token && (
        !acao ? (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-primario" onClick={() => setAcao('aprovar')}>Aprovar medição</button>
            <button className="btn-secundario" onClick={() => setAcao('contestar')}>Algo não confere</button>
          </div>
        ) : (
          <form className="stack" onSubmit={responder}>
            <h3>{acao === 'aprovar' ? 'Aprovar a medição' : 'Contestar a medição'}</h3>
            <label className="campo">Seu nome completo<input value={nome} onChange={(ev) => setNome(ev.target.value)} required minLength={3} autoComplete="name" /></label>
            <label className="campo">{acao === 'aprovar' ? 'Comentário (opcional)' : 'O que não confere?'}<textarea value={texto} onChange={(ev) => setTexto(ev.target.value)} required={acao === 'contestar'} /></label>
            {acao === 'aprovar' && <p className="portal-nota">Ao aprovar, você confirma que o andamento acima (código {m.hash.toUpperCase()}) corresponde ao que foi executado até {formatarData(m.data_corte)}.</p>}
            {erro && <p className="erro-campo" role="alert">{erro}</p>}
            <div className="row">
              <button className="btn-primario" disabled={enviando}>{enviando ? 'Enviando…' : 'Confirmar'}</button>
              <button type="button" className="btn-link" onClick={() => setAcao(null)}>Voltar</button>
            </div>
          </form>
        )
      )}
      {m.estado === 'enviada' && d.previa && <p className="portal-nota">Na prévia, os botões de aprovar e contestar ficam desligados.</p>}
    </section>
  );
}

function Ciencia({ ctx, tipo, id, versao }: { ctx: Ctx; tipo: 'registro' | 'pendencia'; id: string; versao: string }) {
  const { d, token } = ctx;
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const c = cienciaDoItem(d.ciencias, tipo, id, versao);
  const eu = d.eu?.id;
  const jaDei = c.euAtual(eu);
  const minhaAnterior = c.anteriores.find((x) => x.pessoa_id === eu);
  async function dar() {
    setEnviando(true); setErro(null);
    const r = await supabase.rpc('portal_dar_ciencia', { p_token: token, p_alvo_tipo: tipo, p_alvo_id: id, p_versao: versao, p_user_agent: navigator.userAgent });
    setEnviando(false);
    if (r.error) return setErro(mensagemErro(r.error));
    await ctx.recarregar();
  }
  return (
    <div className="portal-ciencia">
      <div className="portal-ciencia-quem">
        {c.atuais.map((x) => <span key={x.pessoa_id} className="selo ok" title={formatarDataHora(x.criado_em)}><Icone nome="check" /> {primeiroNome(x.pessoa)} ciente · {formatarData(x.criado_em)}</span>)}
        {c.anteriores.map((x) => <span key={x.pessoa_id} className="selo neutro" title="Ciência dada antes da última alteração">{primeiroNome(x.pessoa)}: ciência da versão anterior</span>)}
      </div>
      {eu && !jaDei && !d.previa && (
        <div>
          <button className="btn-secundario" onClick={dar} disabled={enviando}>{enviando ? 'Registrando…' : 'Estou ciente'}</button>
          {minhaAnterior && <span className="muted small"> Este item mudou depois da sua ciência.</span>}
          <p className="portal-nota">Ciente quer dizer que você leu esta versão. Não é aprovação técnica, quitação nem aceite de contrato.</p>
        </div>
      )}
      {erro && <p className="erro-campo" role="alert">{erro}</p>}
    </div>
  );
}

function Conversa({ ctx, alvo, id, aberta }: { ctx: Ctx; alvo: AlvoTipo; id: string | null; aberta?: boolean }) {
  const { d, token } = ctx;
  const itens = d.comentarios.filter((c) => c.alvo_tipo === alvo && (c.alvo_id ?? null) === id);
  const [mostrar, setMostrar] = useState(!!aberta || alvo === 'obra');
  const [form, setForm] = useState(false);
  const [tipo, setTipo] = useState<ComentarioPortal['tipo']>('comentario');
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const chave = useRef(novaChave());
  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!texto.trim()) return;
    setEnviando(true); setErro(null);
    const r = await supabase.rpc('portal_comentar', { p_token: token, p_chave: chave.current, p_alvo_tipo: alvo, p_alvo_id: id, p_tipo: tipo, p_texto: texto });
    setEnviando(false);
    if (r.error) return setErro(mensagemErro(r.error));
    chave.current = novaChave();
    setTexto(''); setForm(false);
    await ctx.recarregar();
  }
  return (
    <div className="portal-conversa">
      {!mostrar ? (
        <button className="btn-link" onClick={() => setMostrar(true)}><Icone nome="mensagem" /> {itens.length ? `${itens.length} ${itens.length === 1 ? 'mensagem' : 'mensagens'}` : 'Comentar'}</button>
      ) : (
        <>
          {itens.map((c) => <Mensagem key={c.id} c={c} />)}
          {!form ? (
            <button className="btn-link" onClick={() => setForm(true)} disabled={d.previa}><Icone nome="mensagem" /> {d.previa ? 'Comentários desligados na prévia' : 'Escrever'}</button>
          ) : (
            <form onSubmit={enviar} className="portal-form">
              <div className="portal-filtros" role="radiogroup" aria-label="Tipo de mensagem">
                {(Object.keys(TIPO_COMENTARIO) as ComentarioPortal['tipo'][]).map((t) => (
                  <button type="button" key={t} role="radio" aria-checked={tipo === t} className={tipo === t ? 'ativo' : ''} onClick={() => setTipo(t)}>{TIPO_COMENTARIO[t]}</button>
                ))}
              </div>
              <label className="sr-only" htmlFor={`txt-${alvo}-${id}`}>Mensagem</label>
              <textarea id={`txt-${alvo}-${id}`} rows={3} maxLength={2000} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={tipo === 'solicitacao_ajuste' ? 'Descreva o ajuste que você gostaria' : 'Escreva sua mensagem'} autoFocus />
              {tipo === 'solicitacao_ajuste' && <p className="portal-nota">A ROSAE avalia cada pedido. Se mudar escopo, preço ou prazo, vira um adicional enviado para sua aprovação.</p>}
              {erro && <p className="erro-campo" role="alert">{erro}</p>}
              <div className="portal-linha" style={{ justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn-link" onClick={() => setForm(false)}>Cancelar</button>
                <button className="btn-primario" disabled={enviando || !texto.trim()}>{enviando ? 'Enviando…' : 'Enviar'}</button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}

function Mensagem({ c }: { c: ComentarioPortal }) {
  return (
    <div className={`portal-msg ${c.meu ? 'minha' : ''}`}>
      <div className="portal-msg-cab"><strong>{c.meu ? 'Você' : primeiroNome(c.autor)}</strong> <span className="muted small">· {TIPO_COMENTARIO[c.tipo]} · {formatarDataHora(c.criado_em)}</span></div>
      <p>{c.texto}</p>
      {c.resposta && (
        <div className="portal-msg-resp"><strong>ROSAE</strong> <span className="muted small">· {formatarDataHora(c.respondido_em)}</span><p>{c.resposta}</p></div>
      )}
      {!c.resposta && <span className="muted small">{c.estado === 'resolvido' ? 'Resolvido' : 'Aguardando resposta da ROSAE'}</span>}
    </div>
  );
}

function Mensagens({ ctx }: { ctx: Ctx }) {
  const { d } = ctx;
  const onde = (c: ComentarioPortal) => {
    if (c.alvo_tipo === 'obra') return 'Geral';
    if (c.alvo_tipo === 'etapa') return `Etapa: ${ctx.nomeEtapa(c.alvo_id)}`;
    if (c.alvo_tipo === 'servico') return `Serviço: ${ctx.nomeServico(c.alvo_id)}`;
    if (c.alvo_tipo === 'foto') return 'Foto';
    if (c.alvo_tipo === 'registro') return `Atualização: ${d.registros.find((r) => r.id === c.alvo_id)?.titulo ?? 'registro'}`;
    return `Decisão: ${d.pendencias.find((p) => p.id === c.alvo_id)?.titulo ?? 'pendência'}`;
  };
  const outros = d.comentarios.filter((c) => c.alvo_tipo !== 'obra').slice().reverse();
  return (
    <div className="portal-stack">
      <section className="portal-card">
        <h2>Fale com a ROSAE</h2>
        <p className="muted small">Mensagens gerais da obra. Para falar de uma etapa ou foto, comente direto nela.</p>
        <Conversa ctx={ctx} alvo="obra" id={null} aberta />
      </section>
      {outros.length > 0 && (
        <section className="portal-card">
          <h2>Nos itens da obra</h2>
          {outros.map((c) => (
            <div key={c.id}>
              <p className="portal-onde small">{onde(c)}</p>
              <Mensagem c={c} />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
