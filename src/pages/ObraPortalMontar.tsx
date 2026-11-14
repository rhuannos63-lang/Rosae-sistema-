// Montador do portal (escritório): o sistema sugere o que o cliente vê conforme o tipo
// de serviço; a ROSAE escolhe, ordena, edita e publica. Duas partes:
// 1. Novidade: resumo recente escrito pelo sistema, com fotos sugeridas, revisado e publicado.
// 2. Página do cliente: blocos da página inicial, abas e textos do serviço.
// O rascunho fica neste aparelho e a "Prévia com o rascunho" acompanha ao vivo.
import { useEffect, useMemo, useState } from 'react';
import { supabase, mensagemErro } from '../lib/supabase';
import { novaChave } from '../lib/consulta';
import { publicarFotoNoPortal } from '../lib/fotoPortal';
import { useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import { formatarData, formatarDataHora, hoje as hojeISO, somarDias } from '../core/datas';
import { PERFIS, perfilDaObra, type Perfil } from '../core/jornada';
import { SERVICO } from '../core/portalServico';
import type { DadosPortal } from '../core/portal';
import {
  ABAS_OPCIONAIS, BLOCOS, ajustesDaSugestao, moverBloco, normalizarMontagem, sugerirNovidade, sugestaoMontagem, textosDoPortal,
  type AbaOpcional, type BlocoId, type Duvida, type Montagem,
} from '../core/portalMontagem';
import { gravarRascunhoPortal, lerRascunhoPortal } from '../lib/rascunhoPortal';
import type { Foto, Obra } from '../lib/tipos';

type Parte = 'novidade' | 'pagina' | 'textos';
type Periodo = 'ultima' | 7 | 15 | 30;
type ObraMontagem = Obra & { portal_montagem?: unknown; portal_boas_vindas?: string | null };

/** Só grava os textos que diferem dos do serviço (assim, melhorias nos textos padrão chegam sozinhas). */
function paraGravar(m: Montagem, perfil: Perfil): Montagem {
  const cfg = SERVICO[perfil];
  const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const { pedimos, cuidados, duvidas, ...resto } = m;
  return {
    ...resto,
    ...(pedimos && !igual(pedimos, cfg.pedimos) ? { pedimos } : {}),
    ...(cuidados && !igual(cuidados, cfg.cuidados) ? { cuidados } : {}),
    ...(duvidas && !igual(duvidas, cfg.duvidas) ? { duvidas } : {}),
  };
}

const ICONE_BLOCO: Record<BlocoId, string> = {
  boas_vindas: 'mensagem', novidade: 'sino', agora: 'raio', aguardando: 'alerta', jornada: 'grafico',
  ambientes: 'pasta', galeria: 'foto', correr_bem: 'check', duvidas: 'ajuda',
};

export function MontarPortal({ obra, previa, fotos, urls, aoPublicar }: {
  obra: ObraMontagem; previa: DadosPortal; fotos: Foto[]; urls: Record<string, string>; aoPublicar: () => void;
}) {
  const toast = useToast();
  const perfil = perfilDaObra(previa.obra.tipo_servico, previa.obra.perfil);
  const publicada = useMemo(() => paraGravar(normalizarMontagem(obra.portal_montagem, perfil), perfil), [obra.portal_montagem, perfil]);
  const guardado = useMemo(() => lerRascunhoPortal(obra.id), [obra.id]);
  const [m, setM] = useState<Montagem>(() => (guardado?.montagem ? normalizarMontagem(guardado.montagem, perfil) : publicada));
  const [parte, setParte] = useState<Parte>('novidade');
  const [publicando, setPublicando] = useState(false);

  // Novidade
  const ultimaNovidade = useMemo(() => previa.registros.map((r) => r.publicado_em).sort().at(-1) ?? null, [previa.registros]);
  const [periodo, setPeriodo] = useState<Periodo>(ultimaNovidade ? 'ultima' : 7);
  const hoje = hojeISO();
  const desdeDe = (p: Periodo) => (p === 'ultima' && ultimaNovidade ? ultimaNovidade.slice(0, 10) : somarDias(hoje, -(p === 'ultima' ? 7 : p)));
  const desde = desdeDe(periodo);
  const recentes = useMemo(() => {
    const doPeriodo = fotos.filter((f) => f.tirada_em.slice(0, 10) >= desde);
    return (doPeriodo.length ? doPeriodo : fotos).slice(0, 12);
  }, [fotos, desde]);
  const [selFotos, setSelFotos] = useState<string[]>([]);
  const [nov, setNov] = useState<{ titulo: string; texto: string; etapa_id: string | null }>(() => guardado?.novidade ?? { titulo: '', texto: '', etapa_id: null });
  const [enviandoNov, setEnviandoNov] = useState(false);

  function escreverSugestao(nFotos = selFotos.length, inicio = desde) {
    const s = sugerirNovidade({
      perfil, etapas: previa.etapas, pendencias: previa.pendencias, executado: Number(previa.progresso.executado),
      desde: inicio, hoje, fotos: nFotos, nomeServico: (id) => previa.servicos.find((x) => x.id === id)?.nome ?? '',
    });
    setNov(s);
  }
  // Primeira vez: o sistema já deixa uma sugestão pronta, com as fotos do período marcadas (até 4).
  useEffect(() => {
    if (guardado?.novidade?.texto) return;
    const marcar = fotos.filter((f) => f.tirada_em.slice(0, 10) >= desde).slice(0, 4).map((f) => f.id);
    setSelFotos(marcar);
    escreverSugestao(marcar.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // O rascunho fica neste aparelho; a prévia aberta em outra aba acompanha ao vivo.
  useEffect(() => { gravarRascunhoPortal(obra.id, { montagem: m, novidade: nov }); }, [obra.id, m, nov]);

  const alterada = JSON.stringify(paraGravar(m, perfil)) !== JSON.stringify(publicada);
  const ajustes = ajustesDaSugestao(paraGravar(m, perfil), perfil);
  const publicadaEm = (obra.portal_montagem as Montagem | null)?.publicado_em;

  async function publicarPagina() {
    setPublicando(true);
    const gravar = { ...paraGravar(m, perfil), publicado_em: new Date().toISOString() };
    const r = await supabase.from('obra').update({ portal_montagem: gravar }).eq('id', obra.id);
    setPublicando(false);
    if (r.error) return toast(mensagemErro(r.error));
    toast('Página do cliente publicada.');
    aoPublicar();
  }

  async function publicarNovidade() {
    if (!nov.titulo.trim() && !nov.texto.trim()) return toast('Escreva a novidade antes de publicar.');
    setEnviandoNov(true);
    try {
      const escolhidas = fotos.filter((f) => selFotos.includes(f.id));
      for (const f of escolhidas) if (!f.publicada_em) await publicarFotoNoPortal(f, urls[f.caminho]);
      const id = novaChave();
      const r = await supabase.from('registro').insert({
        id, obra_id: obra.id, tipo: 'andamento', data: hoje, etapa_id: nov.etapa_id,
        titulo: nov.titulo.trim() || null, texto: nov.texto.trim() || null,
        detalhes: escolhidas.length ? { fotos: escolhidas.map((f) => f.id).join(',') } : {},
      });
      if (r.error) throw r.error;
      const p = await supabase.rpc('portal_publicar', { p_tipo: 'registro', p_id: id, p_publicar: true });
      if (p.error) throw p.error;
      setNov({ titulo: '', texto: '', etapa_id: null });
      setSelFotos([]);
      toast(escolhidas.length ? `Novidade publicada com ${escolhidas.length} foto(s).` : 'Novidade publicada.');
      aoPublicar();
    } catch (e) {
      toast(mensagemErro(e));
    } finally {
      setEnviandoNov(false);
    }
  }

  const def = PERFIS[perfil];
  return (
    <div className="card montador">
      <div className="mp-cabeca">
        <div>
          <span className="mp-kicker">Montar o portal</span>
          <h2>O que o cliente vê</h2>
          <p className="muted small" style={{ margin: 0 }}>
            O sistema sugere tudo para <b>{def.nome.toLowerCase()}</b>. Você escolhe, ordena, edita e publica. Nada muda para o cliente antes de publicar.
          </p>
        </div>
        <div className="mp-acoes">
          <span className={`selo ${ajustes ? 'info' : 'neutro'}`}>{ajustes ? `${ajustes} ${ajustes === 1 ? 'ajuste' : 'ajustes'} seus` : 'Segue a sugestão do serviço'}</span>
          <a className="btn-secundario" href={`/obras/${obra.id}/portal-previa?rascunho=1`} target="_blank" rel="noreferrer"><Icone nome="olho" /> Prévia com o rascunho</a>
        </div>
      </div>

      <div className="segmentado mp-partes" role="tablist" aria-label="Partes do portal">
        {([['novidade', 'Novidade recente'], ['pagina', 'Página do cliente'], ['textos', 'Textos do serviço']] as const).map(([k, r]) => (
          <button key={k} role="tab" aria-selected={parte === k} className={parte === k ? 'ativo' : ''} onClick={() => setParte(k)}>{r}</button>
        ))}
      </div>

      <div className="mp-grade">
        <div className="mp-editor">
          {parte === 'novidade' && (
            <div className="stack">
              <div className="mp-linha">
                <div>
                  <h3>Resumo para o cliente</h3>
                  <p className="muted small" style={{ margin: 0 }}>Escrito pelo sistema a partir das etapas publicadas, das decisões em aberto e das fotos do período. Revise e publique.</p>
                </div>
                <button className="btn-secundario" onClick={() => escreverSugestao()}><Icone nome="varinha" /> Escrever de novo</button>
              </div>
              <div className="mp-periodo">
                <span className="muted small">Período</span>
                <div className="segmentado mini" role="radiogroup" aria-label="Período do resumo">
                  {([...(ultimaNovidade ? [['ultima', `Desde a última (${formatarData(ultimaNovidade).slice(0, 5)})`]] : []), [7, '7 dias'], [15, '15 dias'], [30, '30 dias']] as [Periodo, string][]).map(([k, r]) => (
                    <button key={String(k)} role="radio" aria-checked={periodo === k} className={periodo === k ? 'ativo' : ''} onClick={() => { setPeriodo(k); escreverSugestao(selFotos.length, desdeDe(k)); }}>{r}</button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="mp-titulo">Título</label>
                <input id="mp-titulo" maxLength={120} value={nov.titulo} onChange={(e) => setNov({ ...nov, titulo: e.target.value })} placeholder="Ex.: Concluímos o contrapiso da sala" />
              </div>
              <div>
                <label htmlFor="mp-texto">Texto</label>
                <textarea id="mp-texto" rows={10} maxLength={3000} value={nov.texto} onChange={(e) => setNov({ ...nov, texto: e.target.value })} />
              </div>
              <div>
                <div className="mp-linha">
                  <label style={{ margin: 0 }}>{SERVICO[perfil].galeria} para acompanhar <span className="muted">({selFotos.length} de {recentes.length})</span></label>
                  {recentes.length > 0 && <button className="btn-link" onClick={() => setSelFotos(selFotos.length ? [] : recentes.slice(0, 4).map((f) => f.id))}>{selFotos.length ? 'Desmarcar todas' : 'Marcar as 4 mais recentes'}</button>}
                </div>
                {recentes.length === 0 ? <p className="muted small">Sem fotos na obra. Envie pelo Diário e fotos.</p> : (
                  <div className="mp-fotos">
                    {recentes.map((f) => {
                      const sel = selFotos.includes(f.id);
                      return (
                        <button key={f.id} type="button" className={sel ? 'sel' : ''} aria-pressed={sel}
                          onClick={() => setSelFotos(sel ? selFotos.filter((x) => x !== f.id) : [...selFotos, f.id])}
                          aria-label={`${sel ? 'Tirar' : 'Escolher'} foto de ${formatarData(f.tirada_em)}`}>
                          {urls[f.caminho] ? <img src={urls[f.caminho]} alt="" /> : <span className="foto-carregando" />}
                          <span className="mp-foto-marca" aria-hidden="true">{sel ? <Icone nome="check" /> : null}</span>
                          <span className="mp-foto-data">{formatarData(f.tirada_em).slice(0, 5)}{!f.publicada_em && ' · nova'}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="muted small">Fotos “nova” são publicadas junto, em cópia reduzida e sem localização.</p>
              </div>
              <div className="mp-rodape">
                <span className="muted small">Entra em destaque no Início e em Atualizações, com “Estou ciente” e comentários.</span>
                <button className="btn-primario" onClick={publicarNovidade} disabled={enviandoNov}>{enviandoNov ? 'Publicando…' : 'Publicar novidade'}</button>
              </div>
            </div>
          )}

          {parte === 'pagina' && (
            <div className="stack">
              {m.perfil !== perfil && (
                <p className="aviso small">O tipo de serviço desta obra mudou para {def.nome.toLowerCase()}. <button className="btn-link" onClick={() => setM(sugestaoMontagem(perfil))}>Usar a sugestão de {def.nome.toLowerCase()}</button></p>
              )}
              <div className="mp-linha">
                <div>
                  <h3>Página inicial</h3>
                  <p className="muted small" style={{ margin: 0 }}>Na ordem em que o cliente vê. Desligue o que não fizer sentido e renomeie se quiser.</p>
                </div>
                <button className="btn-link" onClick={() => setM({ ...sugestaoMontagem(perfil), pedimos: m.pedimos, cuidados: m.cuidados, duvidas: m.duvidas })}><Icone nome="desfazer" /> Voltar à sugestão</button>
              </div>
              <ol className="mp-blocos">
                {m.blocos.map((b, i) => <LinhaBloco key={b.id} b={b} i={i} total={m.blocos.length} perfil={perfil} m={m} setM={setM} />)}
              </ol>
              <div>
                <h3>Abas</h3>
                <p className="muted small" style={{ margin: '0 0 8px' }}>Início, Atualizações e Mensagens ficam sempre. Abas sem conteúdo se escondem sozinhas.</p>
                <div className="mp-abas">
                  {(Object.keys(ABAS_OPCIONAIS) as AbaOpcional[]).map((k) => (
                    <label key={k} className={`mp-aba ${m.abas[k] ? 'ligada' : ''}`}>
                      <Chave ligada={m.abas[k]} rotulo={ABAS_OPCIONAIS[k].nome} aoMudar={(v) => setM({ ...m, abas: { ...m.abas, [k]: v } })} />
                      <span><strong>{k === 'fotos' ? SERVICO[perfil].galeria : ABAS_OPCIONAIS[k].nome}</strong><span className="muted small">{ABAS_OPCIONAIS[k].explica}</span></span>
                    </label>
                  ))}
                </div>
                {!m.abas.medicoes && <p className="muted small">Medição enviada para o cliente conferir sempre aparece, mesmo com a aba desligada.</p>}
              </div>
            </div>
          )}

          {parte === 'textos' && <Textos m={m} setM={setM} perfil={perfil} />}
        </div>

        <aside className="mp-lado" aria-label="Esquema do portal">
          <Esquema m={m} perfil={perfil} previa={previa} novidade={nov.titulo || null} boasVindas={!!obra.portal_boas_vindas} />
          <div className="mp-publicar">
            <span className="small">{alterada ? <><span className="mp-ponto" aria-hidden="true" /> Alterações não publicadas</> : publicadaEm ? `Publicada ${formatarDataHora(publicadaEm)}` : 'Usando a sugestão do serviço'}</span>
            <div className="row" style={{ gap: 8 }}>
              {alterada && <button className="btn-link" onClick={() => setM(publicada)}>Descartar</button>}
              <button className="btn-primario" onClick={publicarPagina} disabled={!alterada || publicando}>{publicando ? 'Publicando…' : 'Publicar página'}</button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Chave({ ligada, rotulo, aoMudar }: { ligada: boolean; rotulo: string; aoMudar: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={ligada} aria-label={rotulo} className={`mp-chave ${ligada ? 'ligada' : ''}`} onClick={(e) => { e.preventDefault(); aoMudar(!ligada); }}>
      <span />
    </button>
  );
}

function LinhaBloco({ b, i, total, perfil, m, setM }: { b: Montagem['blocos'][number]; i: number; total: number; perfil: Perfil; m: Montagem; setM: (m: Montagem) => void }) {
  const d = BLOCOS[b.id];
  const padrao = d.titulo(perfil);
  const [editando, setEditando] = useState(false);
  const mudar = (x: Partial<typeof b>) => setM({ ...m, blocos: m.blocos.map((y) => (y.id === b.id ? { ...y, ...x } : y)) });
  return (
    <li className={`mp-bloco ${b.visivel ? '' : 'desligado'}`}>
      <span className="mp-num" aria-hidden="true">{i + 1}</span>
      <span className="mp-icone" aria-hidden="true"><Icone nome={ICONE_BLOCO[b.id]} /></span>
      <div className="mp-bloco-texto">
        <strong>{b.titulo || d.nome}</strong>
        <span className="muted small">{d.explica}{d.quando ? ` ${d.quando}` : ''}</span>
        {editando && padrao !== null && (
          <input autoFocus maxLength={60} value={b.titulo ?? ''} placeholder={padrao} aria-label={`Título de ${d.nome}`}
            onChange={(e) => mudar({ titulo: e.target.value || undefined })} onBlur={() => setEditando(false)} onKeyDown={(e) => e.key === 'Enter' && setEditando(false)} />
        )}
      </div>
      <div className="mp-bloco-acoes">
        {padrao === null && <span className="mp-ico vazio" aria-hidden="true" />}
        {padrao !== null && <button className="mp-ico" onClick={() => setEditando(!editando)} aria-label={`Renomear ${d.nome}`} title="Renomear"><Icone nome="editar" /></button>}
        <button className="mp-ico sobe" disabled={i === 0} onClick={() => setM(moverBloco(m, b.id, -1))} aria-label={`Subir ${d.nome}`} title="Subir"><Icone nome="chevron" /></button>
        <button className="mp-ico desce" disabled={i === total - 1} onClick={() => setM(moverBloco(m, b.id, 1))} aria-label={`Descer ${d.nome}`} title="Descer"><Icone nome="chevron" /></button>
        <Chave ligada={b.visivel} rotulo={`Mostrar ${d.nome}`} aoMudar={(v) => mudar({ visivel: v })} />
      </div>
    </li>
  );
}

function Textos({ m, setM, perfil }: { m: Montagem; setM: (m: Montagem) => void; perfil: Perfil }) {
  const cfg = SERVICO[perfil];
  const t = textosDoPortal(m, perfil);
  const linhas = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean);
  const [pedimos, setPedimos] = useState(t.pedimos.join('\n'));
  const [cuidados, setCuidados] = useState(t.cuidados.join('\n'));
  const duvidas = t.duvidas;
  const mudarDuvidas = (l: Duvida[]) => setM({ ...m, duvidas: l });
  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>Os textos começam pelos de {PERFIS[perfil].nome.toLowerCase()}. Ajuste para esta obra: o cliente vê no bloco “Para tudo correr bem” e em “Dúvidas frequentes”.</p>
      <div>
        <div className="mp-linha"><label htmlFor="mp-pedimos" style={{ margin: 0 }}>O que costumamos pedir ao cliente <span className="muted">(um por linha)</span></label>
          {m.pedimos && <button className="btn-link" onClick={() => { setPedimos(cfg.pedimos.join('\n')); setM({ ...m, pedimos: undefined }); }}>Usar os do serviço</button>}</div>
        <textarea id="mp-pedimos" rows={5} value={pedimos} onChange={(e) => { setPedimos(e.target.value); setM({ ...m, pedimos: linhas(e.target.value) }); }} />
      </div>
      <div>
        <div className="mp-linha"><label htmlFor="mp-cuidados" style={{ margin: 0 }}>Cuidados durante a execução <span className="muted">(um por linha; vazio esconde)</span></label>
          {m.cuidados && <button className="btn-link" onClick={() => { setCuidados(cfg.cuidados.join('\n')); setM({ ...m, cuidados: undefined }); }}>Usar os do serviço</button>}</div>
        <textarea id="mp-cuidados" rows={4} value={cuidados} onChange={(e) => { setCuidados(e.target.value); setM({ ...m, cuidados: linhas(e.target.value) }); }} />
      </div>
      <div>
        <div className="mp-linha"><label style={{ margin: 0 }}>Dúvidas frequentes</label>
          <span className="row" style={{ gap: 10 }}>
            {m.duvidas && <button className="btn-link" onClick={() => setM({ ...m, duvidas: undefined })}>Usar as do serviço</button>}
            <button className="btn-link" onClick={() => mudarDuvidas([...duvidas, { p: '', r: '' }])}><Icone nome="mais" /> Pergunta</button>
          </span></div>
        <ul className="mp-duvidas">
          {duvidas.map((q, k) => (
            <li key={k}>
              <input value={q.p} maxLength={160} placeholder="Pergunta" aria-label={`Pergunta ${k + 1}`} onChange={(e) => mudarDuvidas(duvidas.map((x, j) => (j === k ? { ...x, p: e.target.value } : x)))} />
              <textarea rows={2} value={q.r} maxLength={800} placeholder="Resposta" aria-label={`Resposta ${k + 1}`} onChange={(e) => mudarDuvidas(duvidas.map((x, j) => (j === k ? { ...x, r: e.target.value } : x)))} />
              <button className="btn-link" onClick={() => mudarDuvidas(duvidas.filter((_, j) => j !== k))}>Tirar</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Esquema da tela do cliente no celular: muda na hora, conforme a montagem. */
function Esquema({ m, perfil, previa, novidade, boasVindas }: { m: Montagem; perfil: Perfil; previa: DadosPortal; novidade: string | null; boasVindas: boolean }) {
  const temConteudo: Record<BlocoId, boolean> = {
    boas_vindas: boasVindas, novidade: !!novidade || previa.registros.length > 0, agora: true,
    aguardando: previa.pendencias.some((p) => p.estado === 'aberta' && p.responsavel === 'cliente') || (previa.medicoes ?? []).some((x) => x.estado === 'enviada'),
    jornada: true, ambientes: previa.ambientes.length > 0, galeria: previa.fotos.length > 0, correr_bem: true, duvidas: true,
  };
  const abas = ['Início', ...(m.abas.cronograma ? ['Etapas'] : []), ...(m.abas.ambientes && previa.ambientes.length ? ['Ambientes'] : []), ...(m.abas.fotos && previa.fotos.length ? [SERVICO[perfil].galeria] : []), ...(m.abas.medicoes && (previa.medicoes ?? []).length ? ['Medições'] : []), 'Atualizações', 'Mensagens'];
  return (
    <div className="mp-celular" aria-hidden="true">
      <div className="mp-tela">
        <div className="mp-capa"><span>{previa.obra.codigo}</span><strong>{previa.obra.nome}</strong><em>{Math.round(Number(previa.progresso.executado))}%</em></div>
        <div className="mp-esq-blocos">
          {m.blocos.filter((b) => b.visivel).map((b) => (
            <div key={b.id} className={`mp-esq b-${b.id} ${temConteudo[b.id] ? '' : 'vazio'}`}>
              <Icone nome={ICONE_BLOCO[b.id]} />
              <span>{b.id === 'novidade' && novidade ? novidade : b.titulo || BLOCOS[b.id].titulo(perfil) || BLOCOS[b.id].nome}</span>
              {!temConteudo[b.id] && <small>sem conteúdo</small>}
            </div>
          ))}
        </div>
        <div className="mp-esq-abas">{abas.slice(0, 5).map((a) => <span key={a}>{a}</span>)}{abas.length > 5 && <span>+{abas.length - 5}</span>}</div>
      </div>
    </div>
  );
}
