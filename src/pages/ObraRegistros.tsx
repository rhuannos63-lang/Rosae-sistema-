// Diário da obra: registros (andamento, impedimentos, inspeções, condição existente),
// fotos datadas e pendências com responsável e prazo.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok, novaChave } from '../lib/consulta';
import { Ajuda, Carregando, Erro, Modal, Vazio, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import { formatarData, formatarDataHora, hoje } from '../core/datas';
import {
  RESPONSAVEL_PENDENCIA, TIPO_PENDENCIA, TIPO_REGISTRO,
  type Etapa, type Foto, type Pendencia, type Registro, type TipoRegistro,
} from '../lib/tipos';

type Item = { id: string; nome: string };
const MOMENTO: Record<Foto['momento'], string> = { antes: 'Antes', durante: 'Durante', depois: 'Depois', outro: 'Outro' };
const CAMPOS_EXISTENTE: [string, string][] = [
  ['condicao_anterior', 'Condição anterior'], ['riscos', 'Riscos identificados'], ['protecao', 'Proteção ou desmontagem necessária'],
  ['recomposicao_inclusa', 'Recomposições incluídas'], ['recomposicao_nao_inclusa', 'Recomposições NÃO incluídas'],
  ['impedimentos', 'Impedimentos'], ['solucao', 'Solução proposta'],
];

/** Reduz a foto no aparelho (até 1600 px, JPEG) antes de enviar. */
export async function comprimirImagem(arquivo: File, max = 1600, qualidade = 0.82): Promise<{ blob: Blob; largura: number; altura: number }> {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Imagem inválida.')); i.src = url; });
    const escala = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * escala), h = Math.round(img.naturalHeight * escala);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Falha ao preparar a foto.'))), 'image/jpeg', qualidade));
    return { blob, largura: w, altura: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function enviarFotos(obraId: string, arquivos: File[], extra: Partial<Foto>): Promise<number> {
  let n = 0;
  for (const a of arquivos) {
    const { blob, largura, altura } = await comprimirImagem(a);
    const caminho = `obras/${obraId}/fotos/${novaChave()}.jpg`;
    const up = await supabase.storage.from('documentos').upload(caminho, blob, { contentType: 'image/jpeg', upsert: false });
    if (up.error) throw up.error;
    const r = await supabase.from('foto').insert({
      obra_id: obraId, caminho, largura, altura, tirada_em: a.lastModified ? new Date(a.lastModified).toISOString() : new Date().toISOString(), ...extra,
    });
    if (r.error) throw r.error;
    n++;
  }
  return n;
}

/** Endereços temporários (assinados) das fotos privadas. */
export function useUrlsFotos(fotos: Foto[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const chave = fotos.map((f) => f.caminho).join('|');
  useEffect(() => {
    if (!fotos.length) return;
    let vivo = true;
    supabase.storage.from('documentos').createSignedUrls(fotos.map((f) => f.caminho), 3600).then(({ data }) => {
      if (!vivo || !data) return;
      const m: Record<string, string> = {};
      data.forEach((d) => { if (d.signedUrl && d.path) m[d.path] = d.signedUrl; });
      setUrls(m);
    });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  return urls;
}

export function Registros({ obraId, servicos, ambientes, ehAdm }: { obraId: string; servicos: Item[]; ambientes: Item[]; ehAdm: boolean }) {
  const [novo, setNovo] = useState<TipoRegistro | null>(null);
  const [novaPend, setNovaPend] = useState(false);
  const [verFoto, setVerFoto] = useState<Foto | null>(null);
  const [aba, setAba] = useState<'diario' | 'fotos' | 'pendencias'>('diario');
  const { dados, erro, carregando, recarregar } = useConsulta(async () => {
    const [r, f, p, e] = await Promise.all([
      supabase.from('registro').select('*').eq('obra_id', obraId).order('data', { ascending: false }).order('criado_em', { ascending: false }).limit(200),
      supabase.from('foto').select('*').eq('obra_id', obraId).order('tirada_em', { ascending: false }).limit(300),
      supabase.from('pendencia').select('*').eq('obra_id', obraId).order('estado').order('prazo', { nullsFirst: false }),
      supabase.from('etapa').select('id, nome, servico_id').eq('obra_id', obraId).order('ordem'),
    ]);
    return { registros: ok(r) as Registro[], fotos: ok(f) as Foto[], pendencias: ok(p) as Pendencia[], etapas: ok(e) as Etapa[] };
  }, [obraId]);
  const urls = useUrlsFotos(dados?.fotos ?? []);
  const nome = useMemo(() => new Map([...servicos, ...ambientes, ...(dados?.etapas ?? [])].map((x) => [x.id, x.nome])), [servicos, ambientes, dados?.etapas]);

  if (carregando && !dados) return <Carregando />;
  const abertas = (dados?.pendencias ?? []).filter((p) => p.estado === 'aberta');
  const fotosDe = (id: string) => (dados?.fotos ?? []).filter((f) => f.registro_id === id);
  return (
    <div className="stack">
      <div className="card">
        <div className="topo" style={{ marginBottom: 10 }}>
          <div className="segmentado" role="tablist">
            <button className={aba === 'diario' ? 'ativo' : ''} onClick={() => setAba('diario')}>Diário</button>
            <button className={aba === 'fotos' ? 'ativo' : ''} onClick={() => setAba('fotos')}>Fotos ({dados?.fotos.length ?? 0})</button>
            <button className={aba === 'pendencias' ? 'ativo' : ''} onClick={() => setAba('pendencias')}>Pendências{abertas.length ? ` (${abertas.length})` : ''}</button>
          </div>
          <div className="row">
            <button className="btn-primario" onClick={() => setNovo('andamento')}><Icone nome="camera" /> Registrar</button>
            <button className="btn-secundario" onClick={() => setNovo('condicao_existente')}>Condição existente</button>
            <button className="btn-secundario" onClick={() => setNovaPend(true)}><Icone nome="mais" /> Pendência</button>
          </div>
        </div>
        <Erro mensagem={erro} />
        {aba === 'diario' && (
          (dados?.registros.length ?? 0) === 0 ? (
            <Vazio titulo="Nada registrado ainda"><p>Registre o andamento do dia com fotos. Antes de mexer em algo existente, use “Condição existente” para documentar como estava.</p></Vazio>
          ) : (
            <ul className="diario">
              {dados!.registros.map((r) => (
                <li key={r.id} className={`diario-item ${r.tipo}`}>
                  <div className="diario-cab">
                    <span className={`selo ${r.tipo === 'impedimento' ? 'erro' : r.tipo === 'sistema' ? 'neutro' : r.tipo === 'condicao_existente' ? 'alerta' : ''}`}>{TIPO_REGISTRO[r.tipo]}</span>
                    <span className="small muted">{formatarData(r.data)}{[r.servico_id, r.ambiente_id, r.etapa_id].filter(Boolean).map((x) => ` · ${nome.get(x!) ?? ''}`).join('')}</span>
                    {r.publicado_em && <span className="selo ok">Publicado ao cliente</span>}
                  </div>
                  {r.titulo && <b>{r.titulo}</b>}
                  {r.texto && <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0' }}>{r.texto}</p>}
                  {r.tipo === 'condicao_existente' && (
                    <dl className="dl compacto">
                      {CAMPOS_EXISTENTE.filter(([k]) => r.detalhes[k]).map(([k, rot]) => <Fragment key={k}><dt>{rot}</dt><dd>{String(r.detalhes[k])}</dd></Fragment>)}
                      {r.detalhes.aprovacao_necessaria ? <><dt>Aprovação</dt><dd>Necessária antes de prosseguir</dd></> : null}
                    </dl>
                  )}
                  {fotosDe(r.id).length > 0 && (
                    <div className="galeria mini">
                      {fotosDe(r.id).map((f) => <button key={f.id} className="foto" onClick={() => setVerFoto(f)} aria-label={f.legenda ?? 'Foto'}>{urls[f.caminho] ? <img src={urls[f.caminho]} alt={f.legenda ?? ''} loading="lazy" /> : <span className="foto-carregando" />}<span className="foto-momento">{MOMENTO[f.momento]}</span></button>)}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )
        )}
        {aba === 'fotos' && (
          (dados?.fotos.length ?? 0) === 0 ? <Vazio titulo="Sem fotos"><p>As fotos entram pelo botão “Registrar”, direto da câmera do celular.</p></Vazio> : (
            <div className="galeria">
              {dados!.fotos.map((f) => (
                <button key={f.id} className="foto" onClick={() => setVerFoto(f)} aria-label={f.legenda ?? 'Foto'}>
                  {urls[f.caminho] ? <img src={urls[f.caminho]} alt={f.legenda ?? ''} loading="lazy" /> : <span className="foto-carregando" />}
                  <span className="foto-momento">{MOMENTO[f.momento]} · {formatarData(f.tirada_em.slice(0, 10))}</span>
                </button>
              ))}
            </div>
          )
        )}
        {aba === 'pendencias' && <ListaPendencias pendencias={dados?.pendencias ?? []} nome={nome} aoMudar={recarregar} />}
      </div>
      {novo && <RegistroForm obraId={obraId} tipoInicial={novo} servicos={servicos} ambientes={ambientes} etapas={dados?.etapas ?? []} aoFechar={() => setNovo(null)} aoSalvar={() => { setNovo(null); recarregar(); }} />}
      {novaPend && <PendenciaForm obraId={obraId} servicos={servicos} etapas={dados?.etapas ?? []} aoFechar={() => setNovaPend(false)} aoSalvar={() => { setNovaPend(false); setAba('pendencias'); recarregar(); }} />}
      {verFoto && <VerFoto foto={verFoto} url={urls[verFoto.caminho]} ehAdm={ehAdm} nome={nome} aoFechar={() => setVerFoto(null)} aoMudar={() => { setVerFoto(null); recarregar(); }} />}
    </div>
  );
}

function RegistroForm({ obraId, tipoInicial, servicos, ambientes, etapas, aoFechar, aoSalvar }: { obraId: string; tipoInicial: TipoRegistro; servicos: Item[]; ambientes: Item[]; etapas: Etapa[]; aoFechar: () => void; aoSalvar: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ tipo: tipoInicial, data: hoje(), servico_id: '', etapa_id: '', ambiente_id: '', titulo: '', texto: '' });
  const [det, setDet] = useState<Record<string, string | boolean>>({});
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [momento, setMomento] = useState<Foto['momento']>(tipoInicial === 'condicao_existente' ? 'antes' : 'durante');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const existente = f.tipo === 'condicao_existente';

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!f.texto.trim() && !f.titulo.trim() && !Object.values(det).some(Boolean)) return setErro('Escreva o que aconteceu.');
    setSalvando(true);
    try {
      const id = novaChave();
      const detalhes = Object.fromEntries(Object.entries(det).filter(([, v]) => v !== '' && v !== false));
      const r = await supabase.from('registro').insert({
        id, obra_id: obraId, tipo: f.tipo, data: f.data, servico_id: f.servico_id || null, etapa_id: f.etapa_id || null, ambiente_id: f.ambiente_id || null,
        titulo: f.titulo.trim() || null, texto: f.texto.trim() || null, detalhes,
      });
      if (r.error) throw r.error;
      if (arquivos.length) await enviarFotos(obraId, arquivos, { registro_id: id, momento, servico_id: f.servico_id || null, etapa_id: f.etapa_id || null, ambiente_id: f.ambiente_id || null });
      if ((existente && det.aprovacao_necessaria) || f.tipo === 'impedimento') {
        await supabase.from('pendencia').insert({
          obra_id: obraId, registro_id: id, servico_id: f.servico_id || null, etapa_id: f.etapa_id || null,
          tipo: existente ? 'decisao_cliente' : 'impedimento', responsavel: existente ? 'cliente' : 'rosae', prioridade: 'alta',
          titulo: existente ? `Aprovar solução antes de prosseguir: ${f.titulo || String(det.solucao ?? '').slice(0, 60) || 'condição existente'}` : `Resolver impedimento: ${f.titulo || f.texto.slice(0, 60)}`,
        });
      }
      toast(arquivos.length ? `Registro salvo com ${arquivos.length} foto(s).` : 'Registro salvo.');
      aoSalvar();
    } catch (x) {
      setErro(mensagemErro(x));
      setSalvando(false);
    }
  }
  const tipos = (Object.keys(TIPO_REGISTRO) as TipoRegistro[]).filter((t) => t !== 'sistema');
  return (
    <Modal titulo={existente ? 'Condição existente (antes de intervir)' : 'Registrar na obra'} aoFechar={aoFechar} largo
      rodape={<><button type="button" className="btn-secundario" onClick={aoFechar}>Cancelar</button><button className="btn-primario" form="form-reg" disabled={salvando}>{salvando ? 'Enviando…' : 'Salvar'}</button></>}>
      <form id="form-reg" className="stack" onSubmit={salvar}>
        <div className="grid grid-3">
          <label className="campo">Tipo<select value={f.tipo} onChange={(e) => set('tipo', e.target.value as TipoRegistro)}>{tipos.map((t) => <option key={t} value={t}>{TIPO_REGISTRO[t]}</option>)}</select></label>
          <label className="campo">Data<input type="date" value={f.data} max={hoje()} onChange={(e) => set('data', e.target.value)} /></label>
          <label className="campo">Ambiente<select value={f.ambiente_id} onChange={(e) => set('ambiente_id', e.target.value)}><option value="">—</option>{ambientes.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}</select></label>
        </div>
        <div className="grid grid-2">
          <label className="campo">Serviço<select value={f.servico_id} onChange={(e) => { set('servico_id', e.target.value); set('etapa_id', ''); }}><option value="">—</option>{servicos.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></label>
          <label className="campo">Etapa<select value={f.etapa_id} onChange={(e) => set('etapa_id', e.target.value)}><option value="">—</option>{etapas.filter((x) => !f.servico_id || x.servico_id === f.servico_id).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>
        </div>
        <label className="campo">Título<input value={f.titulo} onChange={(e) => set('titulo', e.target.value)} placeholder={existente ? 'Ex.: Porta existente da cozinha' : 'Opcional'} /></label>
        {existente ? (
          <>
            <p className="muted small" style={{ margin: 0 }}>Documente como estava antes de mexer, com fotos. Se precisar de decisão do cliente, marque abaixo: vira uma pendência e a execução espera.</p>
            {CAMPOS_EXISTENTE.map(([k, rot]) => (
              <label key={k} className="campo">{rot}<textarea rows={2} value={String(det[k] ?? '')} onChange={(e) => setDet((d) => ({ ...d, [k]: e.target.value }))} /></label>
            ))}
            <label className="check"><input type="checkbox" checked={!!det.aprovacao_necessaria} onChange={(e) => setDet((d) => ({ ...d, aprovacao_necessaria: e.target.checked }))} /> Precisa de aprovação do cliente antes de prosseguir</label>
            <p className="muted small" style={{ margin: 0 }}>A autorização do cliente não é renúncia a direitos; ela registra a decisão sobre a solução proposta.</p>
          </>
        ) : (
          <label className="campo">O que aconteceu<textarea rows={4} value={f.texto} onChange={(e) => set('texto', e.target.value)} /></label>
        )}
        <div className="grid grid-2">
          <label className="campo">Fotos <Ajuda>No celular abre a câmera. As fotos são reduzidas antes de enviar e ficam privadas; só aparecem para o cliente se você publicar.</Ajuda>
            <input type="file" accept="image/*" capture="environment" multiple onChange={(e) => setArquivos(Array.from(e.target.files ?? []))} />
            {arquivos.length > 0 && <span className="dica">{arquivos.length} foto(s) selecionada(s)</span>}
          </label>
          <label className="campo">Momento<select value={momento} onChange={(e) => setMomento(e.target.value as Foto['momento'])}>{Object.entries(MOMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <Erro mensagem={erro} />
      </form>
    </Modal>
  );
}

function ListaPendencias({ pendencias, nome, aoMudar }: { pendencias: Pendencia[]; nome: Map<string, string>; aoMudar: () => void }) {
  const toast = useToast();
  const [erro, setErro] = useState<string | null>(null);
  const [verTodas, setVerTodas] = useState(false);
  async function mudar(p: Pendencia, estado: Pendencia['estado']) {
    const resolucao = estado === 'aberta' ? null : window.prompt(estado === 'resolvida' ? 'Como foi resolvida?' : 'Motivo do cancelamento:');
    if (estado !== 'aberta' && !resolucao?.trim()) return;
    const r = await supabase.from('pendencia').update({ estado, resolucao }).eq('id', p.id);
    if (r.error) return setErro(mensagemErro(r.error));
    toast(estado === 'resolvida' ? 'Pendência resolvida.' : estado === 'aberta' ? 'Pendência reaberta.' : 'Pendência cancelada.');
    aoMudar();
  }
  const lista = pendencias.filter((p) => verTodas || p.estado === 'aberta');
  const h = hoje();
  return (
    <div className="stack">
      <Erro mensagem={erro} />
      <label className="check"><input type="checkbox" checked={verTodas} onChange={(e) => setVerTodas(e.target.checked)} /> Mostrar resolvidas e canceladas</label>
      {lista.length === 0 ? <Vazio titulo="Nenhuma pendência aberta" /> : (
        <ul className="lista-pendencias">
          {lista.map((p) => (
            <li key={p.id} className={`pend ${p.prioridade} ${p.estado}`}>
              <div className="pend-cab">
                <span className={`selo ${p.prioridade === 'alta' ? 'erro' : p.prioridade === 'media' ? 'alerta' : 'neutro'}`}>{p.prioridade === 'alta' ? 'Alta' : p.prioridade === 'media' ? 'Média' : 'Baixa'}</span>
                <span className="small muted">{TIPO_PENDENCIA[p.tipo]} · com {RESPONSAVEL_PENDENCIA[p.responsavel]}{p.prazo ? ` · até ${formatarData(p.prazo)}` : ''}{p.servico_id ? ` · ${nome.get(p.servico_id) ?? ''}` : ''}</span>
                {p.estado === 'aberta' && p.prazo && p.prazo < h && <span className="selo erro">Atrasada</span>}
              </div>
              <b>{p.titulo}</b>
              {p.descricao && <div className="small">{p.descricao}</div>}
              {p.estado !== 'aberta' && <div className="small muted">{p.estado === 'resolvida' ? 'Resolvida' : 'Cancelada'} em {formatarDataHora(p.resolvida_em)}: {p.resolucao}</div>}
              <div className="row" style={{ marginTop: 6 }}>
                {p.estado === 'aberta' ? (
                  <><button className="btn-secundario" onClick={() => mudar(p, 'resolvida')}><Icone nome="check" /> Resolver</button><button className="btn-link" onClick={() => mudar(p, 'cancelada')}>Cancelar</button></>
                ) : <button className="btn-link" onClick={() => mudar(p, 'aberta')}>Reabrir</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PendenciaForm({ obraId, servicos, etapas, aoFechar, aoSalvar }: { obraId: string; servicos: Item[]; etapas: Etapa[]; aoFechar: () => void; aoSalvar: () => void }) {
  const [f, setF] = useState({ titulo: '', descricao: '', tipo: 'pendencia' as Pendencia['tipo'], prioridade: 'media' as Pendencia['prioridade'], responsavel: 'rosae' as Pendencia['responsavel'], prazo: '', servico_id: '', etapa_id: '' });
  const [erro, setErro] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const r = await supabase.from('pendencia').insert({ ...f, obra_id: obraId, titulo: f.titulo.trim(), descricao: f.descricao.trim() || null, prazo: f.prazo || null, servico_id: f.servico_id || null, etapa_id: f.etapa_id || null });
    if (r.error) return setErro(mensagemErro(r.error));
    aoSalvar();
  }
  return (
    <Modal titulo="Nova pendência" aoFechar={aoFechar}
      rodape={<><button type="button" className="btn-secundario" onClick={aoFechar}>Cancelar</button><button className="btn-primario" form="form-pend">Salvar</button></>}>
      <form id="form-pend" className="stack" onSubmit={salvar}>
        <label className="campo">O que precisa ser feito<input value={f.titulo} onChange={(e) => set('titulo', e.target.value)} required /></label>
        <div className="grid grid-3">
          <label className="campo">Tipo<select value={f.tipo} onChange={(e) => set('tipo', e.target.value as Pendencia['tipo'])}>{Object.entries(TIPO_PENDENCIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="campo">Com quem<select value={f.responsavel} onChange={(e) => set('responsavel', e.target.value as Pendencia['responsavel'])}>{Object.entries(RESPONSAVEL_PENDENCIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="campo">Prioridade<select value={f.prioridade} onChange={(e) => set('prioridade', e.target.value as Pendencia['prioridade'])}><option value="alta">Alta</option><option value="media">Média</option><option value="baixa">Baixa</option></select></label>
        </div>
        <div className="grid grid-3">
          <label className="campo">Prazo<input type="date" value={f.prazo} onChange={(e) => set('prazo', e.target.value)} /></label>
          <label className="campo">Serviço<select value={f.servico_id} onChange={(e) => set('servico_id', e.target.value)}><option value="">—</option>{servicos.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></label>
          <label className="campo">Etapa<select value={f.etapa_id} onChange={(e) => set('etapa_id', e.target.value)}><option value="">—</option>{etapas.filter((x) => !f.servico_id || x.servico_id === f.servico_id).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>
        </div>
        <label className="campo">Detalhes<textarea rows={2} value={f.descricao} onChange={(e) => set('descricao', e.target.value)} /></label>
        <Erro mensagem={erro} />
      </form>
    </Modal>
  );
}

function VerFoto({ foto, url, ehAdm, nome, aoFechar, aoMudar }: { foto: Foto; url?: string; ehAdm: boolean; nome: Map<string, string>; aoFechar: () => void; aoMudar: () => void }) {
  const [legenda, setLegenda] = useState(foto.legenda ?? '');
  const [momento, setMomento] = useState(foto.momento);
  const [erro, setErro] = useState<string | null>(null);
  async function salvar() {
    const r = await supabase.from('foto').update({ legenda: legenda.trim() || null, momento }).eq('id', foto.id);
    if (r.error) return setErro(mensagemErro(r.error));
    aoMudar();
  }
  return (
    <Modal titulo={foto.legenda || `Foto de ${formatarDataHora(foto.tirada_em)}`} aoFechar={aoFechar} largo
      rodape={ehAdm ? <><button className="btn-secundario" onClick={aoFechar}>Fechar</button><button className="btn-primario" onClick={salvar}>Salvar</button></> : <button className="btn-secundario" onClick={aoFechar}>Fechar</button>}>
      <div className="stack">
        {url ? <img src={url} alt={foto.legenda ?? ''} className="foto-grande" /> : <Carregando />}
        <p className="muted small" style={{ margin: 0 }}>{formatarDataHora(foto.tirada_em)} · {MOMENTO[foto.momento]}{[foto.servico_id, foto.ambiente_id].filter(Boolean).map((x) => ` · ${nome.get(x!) ?? ''}`).join('')}{foto.publicada_em ? ' · publicada ao cliente' : ' · interna'}</p>
        {ehAdm && (
          <div className="grid grid-2">
            <label className="campo">Legenda<input value={legenda} onChange={(e) => setLegenda(e.target.value)} /></label>
            <label className="campo">Momento<select value={momento} onChange={(e) => setMomento(e.target.value as Foto['momento'])}>{Object.entries(MOMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          </div>
        )}
        <Erro mensagem={erro} />
      </div>
    </Modal>
  );
}
