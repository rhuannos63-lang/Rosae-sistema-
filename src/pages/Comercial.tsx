import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase, supabaseUrl, supabaseChave, mensagemErro } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { Topo } from '../components/Layout';
import { Ajuda, CampoValor, Carregando, Dinheiro, Erro, Modal, Vazio, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import { doBanco, paraBanco, type Centavos } from '../core/dinheiro';
import { formatarData, formatarDataHora, hoje } from '../core/datas';
import {
  ESTADO_PROPOSTA, ORIGEM, TIPOS_SERVICO, TIPO_INTERACAO,
  type EstadoFunil, type Interacao, type Oportunidade, type Origem, type Pessoa, type Proposta,
} from '../lib/tipos';
import { PessoaForm } from './Pessoas';

const SELECT_OP = '*, pessoa:pessoa(nome, telefone, email)';

function diasDesde(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export function linkWhatsApp(telefone: string | null | undefined, texto?: string): string | null {
  let d = (telefone ?? '').replace(/\D/g, '');
  if (d.length < 10) return null;
  if (!d.startsWith('55')) d = `55${d}`;
  return `https://wa.me/${d}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`;
}

function ProximaAcao({ o }: { o: Oportunidade }) {
  if (!o.proxima_acao && !o.proxima_acao_data) return <span className="muted small">Sem próxima ação</span>;
  const atrasada = o.proxima_acao_data && o.proxima_acao_data < hoje();
  return (
    <span className="small" style={{ color: atrasada ? 'var(--desfavoravel)' : undefined }}>
      {atrasada && <b>Atrasada · </b>}
      {o.proxima_acao}{o.proxima_acao_data ? ` · ${formatarData(o.proxima_acao_data)}` : ''}
    </span>
  );
}

export function Comercial() {
  const navegar = useNavigate();
  const [modo, setModo] = useState<'quadro' | 'lista'>(() => (window.innerWidth <= 860 ? 'lista' : 'quadro'));
  const [filtro, setFiltro] = useState<'abertas' | 'atrasadas' | 'encerradas'>('abertas');
  const [busca, setBusca] = useState('');
  const [etapa, setEtapa] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const [site, setSite] = useState(false);
  const { dados, erro, carregando, recarregar } = useConsulta(async () => {
    const [e, o] = await Promise.all([
      supabase.from('estado_funil').select('*').eq('ativo', true).order('ordem'),
      supabase.from('oportunidade').select(SELECT_OP).eq('arquivado', false).order('atualizado_em', { ascending: false }),
    ]);
    return { estados: ok(e) as EstadoFunil[], ops: ok(o) as Oportunidade[] };
  }, []);

  const estados = dados?.estados ?? [];
  const tipoDe = useMemo(() => new Map(estados.map((e) => [e.id, e])), [estados]);
  const lista = (dados?.ops ?? []).filter((o) => {
    const t = tipoDe.get(o.estado_id)?.tipo;
    if (filtro === 'abertas' && t !== 'aberto' && t !== 'ganho') return false;
    if (filtro === 'encerradas' && (t === 'aberto')) return false;
    if (filtro === 'atrasadas' && !(t === 'aberto' && o.proxima_acao_data && o.proxima_acao_data < hoje())) return false;
    if (etapa && o.estado_id !== etapa) return false;
    const b = busca.trim().toLowerCase();
    return !b || [o.titulo, o.pessoa?.nome, o.pessoa?.telefone, o.codigo, o.local_obra].some((v) => v?.toLowerCase().includes(b));
  });
  const colunas = estados.filter((e) => (filtro === 'encerradas' ? e.tipo !== 'aberto' : e.tipo === 'aberto' || e.tipo === 'ganho')).filter((e) => !etapa || e.id === etapa);
  const funil = estados.filter((e) => e.tipo === 'aberto' || e.tipo === 'ganho').map((e) => ({ e, qtd: (dados?.ops ?? []).filter((o) => o.estado_id === e.id).length }));
  const maxFunil = Math.max(1, ...funil.map((f) => f.qtd));
  const atrasadas = (dados?.ops ?? []).filter((o) => tipoDe.get(o.estado_id)?.tipo === 'aberto' && o.proxima_acao_data && o.proxima_acao_data < hoje()).length;

  return (
    <>
      <Topo titulo="Comercial" sub="Cada contato vira uma oportunidade. Acompanhe a etapa, a próxima ação e as propostas.">
        <button className="btn-secundario" onClick={() => setSite(true)}>Formulário do site</button>
        <Link className="btn-secundario" to="/propostas">Propostas</Link>
        <button className="btn-primario" onClick={() => setNova(true)}><Icone nome="mais" /> Novo contato</button>
      </Topo>
      {atrasadas > 0 && filtro !== 'atrasadas' && (
        <div className="aviso" style={{ marginBottom: 14 }}>
          <Icone nome="alerta" />
          <span>{atrasadas === 1 ? '1 oportunidade está' : `${atrasadas} oportunidades estão`} com a próxima ação atrasada. <button className="btn-link" onClick={() => setFiltro('atrasadas')}>Ver</button></span>
        </div>
      )}
      {funil.length > 0 && filtro !== 'encerradas' && (
        <div className="funil" role="group" aria-label="Funil: clique numa etapa para filtrar">
          {funil.map(({ e, qtd }) => (
            <button key={e.id} className={etapa === e.id ? 'ativo' : ''} aria-pressed={etapa === e.id} onClick={() => setEtapa(etapa === e.id ? null : e.id)} title={etapa === e.id ? 'Mostrar todas as etapas' : `Ver só “${e.nome}”`}>
              <span className="f-nome">{e.nome}</span>
              <span className="f-num num">{qtd}</span>
              <span className="f-trilho"><span style={{ width: `${(qtd / maxFunil) * 100}%`, background: e.tipo === 'ganho' ? 'var(--favoravel)' : undefined }} /></span>
            </button>
          ))}
        </div>
      )}
      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          {etapa && <button className="chip-link ativo" onClick={() => setEtapa(null)}>{tipoDe.get(etapa)?.nome} <Icone nome="fechar" /></button>}
          <div className="segmentado" role="group" aria-label="Filtro">
            {(['abertas', 'atrasadas', 'encerradas'] as const).map((f) => (
              <button key={f} className={filtro === f ? 'ativo' : ''} onClick={() => setFiltro(f)}>
                {{ abertas: 'Em andamento', atrasadas: 'Atrasadas', encerradas: 'Encerradas' }[f]}
              </button>
            ))}
          </div>
          <div className="segmentado so-desktop" role="group" aria-label="Visualização">
            <button className={modo === 'quadro' ? 'ativo' : ''} onClick={() => setModo('quadro')}>Quadro</button>
            <button className={modo === 'lista' ? 'ativo' : ''} onClick={() => setModo('lista')}>Lista</button>
          </div>
          <div className="spacer" />
          <input placeholder="Buscar nome, telefone, local…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 260 }} />
        </div>
        <Erro mensagem={erro} />
        {carregando && !dados ? (
          <Carregando />
        ) : lista.length === 0 ? (
          <Vazio titulo={filtro === 'atrasadas' ? 'Nada atrasado' : 'Nenhuma oportunidade aqui'}>
            <p>Cadastre cada pedido de orçamento como um contato. Os que chegam pelo formulário do site entram sozinhos.</p>
          </Vazio>
        ) : modo === 'quadro' && window.innerWidth > 860 ? (
          <div className="quadro">
            {colunas.map((c) => {
              const itens = lista.filter((o) => o.estado_id === c.id);
              return (
                <div key={c.id} className="coluna">
                  <div className="coluna-cab"><span>{c.nome}</span><span className="muted">{itens.length}</span></div>
                  {itens.map((o) => (
                    <button key={o.id} className="cartao-op" onClick={() => navegar(`/comercial/${o.id}`)}>
                      <b>{o.pessoa?.nome}</b>
                      <span className="small">{o.titulo}</span>
                      <ProximaAcao o={o} />
                      <span className="muted small">{ORIGEM[o.origem]} · há {diasDesde(o.estado_desde)} d nesta etapa</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="lista-cartoes" style={{ display: 'grid' }}>
            {lista.map((o) => (
              <button key={o.id} className="item-cartao" style={{ textAlign: 'left', fontWeight: 400 }} onClick={() => navegar(`/comercial/${o.id}`)}>
                <div style={{ display: 'grid', gap: 2 }}>
                  <div className="titulo">{o.pessoa?.nome} <span className="selo" style={{ marginLeft: 6 }}>{tipoDe.get(o.estado_id)?.nome}</span></div>
                  <span className="small">{o.titulo}</span>
                  <ProximaAcao o={o} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {nova && <OportunidadeForm estados={estados} aoFechar={() => setNova(false)} aoSalvar={(id) => { setNova(false); recarregar(); navegar(`/comercial/${id}`); }} />}
      {site && <FormularioSite aoFechar={() => setSite(false)} />}
    </>
  );
}

const opVazia = {
  titulo: '', origem: 'indicacao' as Origem, indicado_por: '', tipo_servico: '', local_obra: '', resumo: '', proxima_acao: 'Retornar contato',
  proxima_acao_data: hoje(),
};

export function OportunidadeForm({ estados, op, aoFechar, aoSalvar }: { estados: EstadoFunil[]; op?: Oportunidade; aoFechar: () => void; aoSalvar: (id: string) => void }) {
  const toast = useToast();
  const [f, setF] = useState(() => (op ? { ...opVazia, ...Object.fromEntries(Object.keys(opVazia).map((k) => [k, (op as Record<string, unknown>)[k] ?? ''])) } : opVazia) as typeof opVazia);
  const [valor, setValor] = useState<Centavos | null>(op?.valor_estimado != null ? doBanco(op.valor_estimado) : null);
  const [pessoaId, setPessoaId] = useState<string>(op?.pessoa_id ?? '');
  const [novaPessoa, setNovaPessoa] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const pessoas = useConsulta(async () => ok(await supabase.from('pessoa').select('id, nome, telefone, codigo').eq('arquivado', false).order('nome')) as Pessoa[], []);
  const set = <K extends keyof typeof opVazia>(k: K, v: (typeof opVazia)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!pessoaId) return setErro('Escolha ou cadastre a pessoa.');
    setSalvando(true);
    const pessoa = pessoas.dados?.find((p) => p.id === pessoaId);
    const reg = {
      pessoa_id: pessoaId,
      titulo: f.titulo.trim() || `${f.tipo_servico || 'Contato'} · ${pessoa?.nome ?? ''}`,
      origem: f.origem,
      indicado_por: f.indicado_por.trim() || null,
      tipo_servico: f.tipo_servico || null,
      local_obra: f.local_obra.trim() || null,
      resumo: f.resumo.trim() || null,
      proxima_acao: f.proxima_acao.trim() || null,
      proxima_acao_data: f.proxima_acao_data || null,
      valor_estimado: valor === null ? null : paraBanco(valor),
    };
    const r = op
      ? await supabase.from('oportunidade').update(reg).eq('id', op.id).select('id').single()
      : await supabase.from('oportunidade').insert({ ...reg, estado_id: estados.find((x) => x.nome === 'Novo contato')?.id ?? estados[0]?.id }).select('id').single();
    setSalvando(false);
    if (r.error) return setErro(mensagemErro(r.error));
    toast(op ? 'Oportunidade atualizada.' : 'Contato registrado.');
    aoSalvar((r.data as { id: string }).id);
  }

  return (
    <Modal
      titulo={op ? 'Editar oportunidade' : 'Novo contato'}
      aoFechar={aoFechar}
      rodape={<><button type="button" className="btn-secundario" onClick={aoFechar}>Cancelar</button><button className="btn-primario" form="form-op" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button></>}
    >
      <form id="form-op" className="stack" onSubmit={salvar}>
        <label className="campo">
          Pessoa
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <select value={pessoaId} onChange={(e) => setPessoaId(e.target.value)} required style={{ flex: 1 }}>
              <option value="">Escolha…</option>
              {(pessoas.dados ?? []).map((p) => <option key={p.id} value={p.id}>{p.nome}{p.telefone ? ` · ${p.telefone}` : ''}</option>)}
            </select>
            <button type="button" className="btn-secundario" onClick={() => setNovaPessoa(true)}><Icone nome="mais" /> Nova</button>
          </div>
        </label>
        <div className="grid grid-2">
          <label className="campo">
            Serviço
            <select value={f.tipo_servico} onChange={(e) => set('tipo_servico', e.target.value)}>
              <option value="">—</option>
              {TIPOS_SERVICO.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="campo">
            Origem
            <select value={f.origem} onChange={(e) => set('origem', e.target.value as Origem)}>
              {Object.entries(ORIGEM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        {f.origem === 'indicacao' && (
          <label className="campo">Indicado por<input value={f.indicado_por} onChange={(e) => set('indicado_por', e.target.value)} /></label>
        )}
        <label className="campo">Título (opcional)<input value={f.titulo} onChange={(e) => set('titulo', e.target.value)} placeholder="Ex.: Reforço de laje da garagem" /></label>
        <label className="campo">Local da obra<input value={f.local_obra} onChange={(e) => set('local_obra', e.target.value)} placeholder="Bairro, cidade" /></label>
        <label className="campo">
          O que o cliente pediu
          <textarea value={f.resumo} onChange={(e) => set('resumo', e.target.value)} placeholder="Cole aqui a mensagem do cliente. Ela ajuda a montar o escopo da proposta." />
        </label>
        <div className="grid grid-2">
          <label className="campo">Próxima ação<input value={f.proxima_acao} onChange={(e) => set('proxima_acao', e.target.value)} /></label>
          <label className="campo">Até<input type="date" value={f.proxima_acao_data} onChange={(e) => set('proxima_acao_data', e.target.value)} /></label>
        </div>
        <label className="campo">
          <span>Valor estimado (opcional) <Ajuda>Só para você ter noção do tamanho da oportunidade. Não entra em nenhum total de vendas.</Ajuda></span>
          <CampoValor valor={valor} aoMudar={setValor} />
        </label>
        <Erro mensagem={erro} />
      </form>
      {novaPessoa && (
        <PessoaForm pessoa={null} aoFechar={() => setNovaPessoa(false)} aoSalvar={(p) => { setNovaPessoa(false); pessoas.recarregar(); setPessoaId(p.id); }} />
      )}
    </Modal>
  );
}

export function OportunidadeDetalhe() {
  const { id } = useParams();
  const navegar = useNavigate();
  const toast = useToast();
  const [editar, setEditar] = useState(false);
  const [perda, setPerda] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [nota, setNota] = useState({ tipo: 'nota', texto: '' });
  const [erro, setErro] = useState<string | null>(null);
  const { dados, erro: erroCarga, carregando, recarregar } = useConsulta(async () => {
    const [o, e, h, p] = await Promise.all([
      supabase.from('oportunidade').select(SELECT_OP).eq('id', id!).maybeSingle(),
      supabase.from('estado_funil').select('*').eq('ativo', true).order('ordem'),
      supabase.from('interacao').select('*').eq('oportunidade_id', id!).order('em', { ascending: false }),
      supabase.from('proposta').select('*, versoes:proposta_versao!proposta_versao_proposta_id_fkey(numero, valor_total, emitida)').eq('oportunidade_id', id!).order('criado_em', { ascending: false }),
    ]);
    return {
      op: ok(o) as Oportunidade | null, estados: ok(e) as EstadoFunil[], historico: ok(h) as Interacao[],
      propostas: ok(p) as (Proposta & { versoes: { numero: number; valor_total: string; emitida: boolean }[] })[],
    };
  }, [id]);

  if (carregando && !dados) return <Carregando />;
  if (erroCarga) return <Erro mensagem={erroCarga} />;
  if (!dados?.op) return <Vazio titulo="Oportunidade não encontrada ou sem acesso" />;
  const { op, estados } = dados;
  const estado = estados.find((e) => e.id === op.estado_id);
  const wa = linkWhatsApp(op.pessoa?.telefone, `Olá, ${op.pessoa?.nome?.split(' ')[0] ?? ''}! Aqui é o Rhuann, da ROSAE Engenharia.`);

  async function mudarEstado(novo: string, motivoPerda?: string) {
    setErro(null);
    const alvo = estados.find((e) => e.id === novo);
    if (alvo?.tipo === 'perdido' && !motivoPerda) { setPerda(novo); return; }
    const { error } = await supabase.from('oportunidade').update({ estado_id: novo, ...(motivoPerda ? { motivo_perda: motivoPerda } : {}) }).eq('id', op.id);
    if (error) return setErro(mensagemErro(error));
    setPerda(null); setMotivo('');
    toast(`Etapa: ${alvo?.nome}`);
    recarregar();
  }

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    if (!nota.texto.trim()) return;
    const { error } = await supabase.from('interacao').insert({ oportunidade_id: op.id, tipo: nota.tipo, texto: nota.texto.trim() });
    if (error) return setErro(mensagemErro(error));
    setNota({ tipo: nota.tipo, texto: '' });
    recarregar();
  }

  async function arquivar() {
    if (!window.confirm('Arquivar esta oportunidade? Ela some do quadro, mas o histórico fica guardado.')) return;
    const { error } = await supabase.from('oportunidade').update({ arquivado: true }).eq('id', op.id);
    if (error) return setErro(mensagemErro(error));
    navegar('/comercial');
  }

  async function novaProposta() {
    setErro(null);
    const r = await supabase.from('proposta').insert({ oportunidade_id: op.id, pessoa_id: op.pessoa_id, titulo: op.titulo }).select('id').single();
    if (r.error) return setErro(mensagemErro(r.error));
    const pid = (r.data as { id: string }).id;
    const v = await supabase.rpc('nova_versao_proposta', { p_proposta: pid });
    if (v.error) return setErro(mensagemErro(v.error));
    if (estado && estado.tipo === 'aberto' && estado.ordem < 4) {
      const prep = estados.find((x) => x.nome === 'Proposta em preparação');
      if (prep) await supabase.from('oportunidade').update({ estado_id: prep.id }).eq('id', op.id);
    }
    navegar(`/propostas/${pid}`);
  }

  return (
    <>
      <Topo titulo={op.pessoa?.nome ?? op.titulo} sub={<>{op.codigo} · {op.titulo}</>}>
        <button className="btn-secundario" onClick={() => navegar('/comercial')}><Icone nome="voltar" /> Comercial</button>
        <button className="btn-secundario" onClick={() => setEditar(true)}><Icone nome="editar" /> Editar</button>
        <button className="btn-primario" onClick={novaProposta}><Icone nome="mais" /> Nova proposta</button>
      </Topo>
      <Erro mensagem={erro} />
      <div className="grid grid-2">
        <div className="stack">
          <div className="card">
            <h2 style={{ marginBottom: 10 }}>Etapa</h2>
            <div className="etapas-funil">
              {estados.filter((e) => e.tipo !== 'arquivado').map((e) => (
                <button key={e.id} className={`${e.id === op.estado_id ? 'ativo' : ''} ${e.tipo}`} onClick={() => e.id !== op.estado_id && mudarEstado(e.id)}>
                  {e.nome}
                </button>
              ))}
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>Nesta etapa há {diasDesde(op.estado_desde)} dia(s).{op.motivo_perda && estado?.tipo === 'perdido' ? ` Motivo da perda: ${op.motivo_perda}` : ''}</p>
          </div>
          <div className="card">
            <h2 style={{ marginBottom: 10 }}>Contato</h2>
            <dl className="dl">
              <dt>Telefone</dt><dd>{op.pessoa?.telefone ?? '—'} {wa && <a href={wa} target="_blank" rel="noreferrer" className="chip-link">Abrir WhatsApp</a>}</dd>
              <dt>E-mail</dt><dd>{op.pessoa?.email ? <a href={`mailto:${op.pessoa.email}`}>{op.pessoa.email}</a> : '—'}</dd>
              <dt>Origem</dt><dd>{ORIGEM[op.origem]}{op.indicado_por ? ` · ${op.indicado_por}` : ''}{op.campanha ? ` · campanha ${op.campanha}` : ''}</dd>
              <dt>Serviço</dt><dd>{op.tipo_servico ?? '—'}</dd>
              <dt>Local</dt><dd>{op.local_obra ?? '—'}</dd>
              <dt>Próxima ação</dt><dd><ProximaAcao o={op} /></dd>
              {op.valor_estimado != null && <><dt>Estimativa</dt><dd><Dinheiro valor={doBanco(op.valor_estimado)} /></dd></>}
            </dl>
            {op.resumo && <><h3 style={{ margin: '12px 0 4px' }}>Pedido</h3><p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{op.resumo}</p></>}
            <div className="row" style={{ marginTop: 12 }}><button className="btn-link" onClick={arquivar}>Arquivar oportunidade</button></div>
          </div>
          <div className="card">
            <h2 style={{ marginBottom: 10 }}>Propostas</h2>
            {dados.propostas.length === 0 ? (
              <p className="muted">Nenhuma proposta ainda. Use “Nova proposta”: o sistema sugere o escopo a partir do pedido.</p>
            ) : (
              <div className="stack" style={{ gap: 6 }}>
                {dados.propostas.map((p) => {
                  const ultima = [...p.versoes].sort((a, b) => b.numero - a.numero)[0];
                  return (
                    <Link key={p.id} to={`/propostas/${p.id}`} className="item-cartao">
                      <div>
                        <div className="titulo">{p.codigo} · {p.titulo}</div>
                        <div className="small muted">versão {ultima?.numero ?? 1} · <span className={`selo ${ESTADO_PROPOSTA[p.estado].classe}`}>{ESTADO_PROPOSTA[p.estado].rotulo}</span></div>
                      </div>
                      {ultima && <Dinheiro valor={doBanco(ultima.valor_total)} />}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div className="card">
          <h2 style={{ marginBottom: 10 }}>Histórico</h2>
          <form className="stack" onSubmit={registrar} style={{ marginBottom: 14 }}>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <select value={nota.tipo} onChange={(e) => setNota({ ...nota, tipo: e.target.value })} style={{ width: 130 }} aria-label="Tipo">
                {Object.entries(TIPO_INTERACAO).filter(([k]) => k !== 'sistema' && k !== 'site').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input value={nota.texto} onChange={(e) => setNota({ ...nota, texto: e.target.value })} placeholder="O que aconteceu?" style={{ flex: 1 }} />
              <button className="btn-primario" disabled={!nota.texto.trim()}>Registrar</button>
            </div>
          </form>
          <ul className="linha-tempo">
            {dados.historico.map((h) => (
              <li key={h.id} className={h.tipo}>
                <div className="small muted">{formatarDataHora(h.em)} · {TIPO_INTERACAO[h.tipo] ?? h.tipo}</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{h.texto}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {editar && <OportunidadeForm estados={estados} op={op} aoFechar={() => setEditar(false)} aoSalvar={() => { setEditar(false); recarregar(); }} />}
      {perda && (
        <Modal titulo="Motivo da perda" aoFechar={() => setPerda(null)}
          rodape={<><button className="btn-secundario" onClick={() => setPerda(null)}>Cancelar</button><button className="btn-primario" disabled={!motivo.trim()} onClick={() => mudarEstado(perda, motivo.trim())}>Confirmar</button></>}>
          <div className="stack">
            <p className="muted" style={{ margin: 0 }}>Saber por que perdemos ajuda a ajustar preço e proposta.</p>
            <div className="row">
              {['Preço', 'Prazo', 'Fechou com outro', 'Desistiu da obra', 'Sem resposta'].map((m) => (
                <button key={m} type="button" className={`chip-link${motivo === m ? ' ativo' : ''}`} onClick={() => setMotivo(m)}>{m}</button>
              ))}
            </div>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ou escreva o motivo" autoFocus />
          </div>
        </Modal>
      )}
    </>
  );
}

function FormularioSite({ aoFechar }: { aoFechar: () => void }) {
  const codigo = `<!-- Formulário de contato ROSAE: cole no site (rosaeengenharia.com) -->
<form id="rosae-contato">
  <input name="nome" placeholder="Seu nome" required>
  <input name="telefone" placeholder="WhatsApp">
  <input name="email" type="email" placeholder="E-mail">
  <select name="tipo_servico">
    <option>Projeto estrutural</option><option>Reforço estrutural</option><option>Laudo / vistoria</option>
    <option>Reforma</option><option>Construção</option><option>Gestão de obra</option>
  </select>
  <input name="local" placeholder="Bairro / cidade da obra">
  <textarea name="mensagem" placeholder="Conte o que precisa"></textarea>
  <input name="site" style="display:none" tabindex="-1" autocomplete="off">
  <button>Enviar</button>
  <p id="rosae-msg"></p>
</form>
<script>
(function () {
  var URL = '${supabaseUrl}/rest/v1/rpc/', CHAVE = '${supabaseChave}';
  var q = new URLSearchParams(location.search);
  var utm = { source: q.get('utm_source'), medium: q.get('utm_medium'), campaign: q.get('utm_campaign') };
  function chamar(fn, corpo) {
    return fetch(URL + fn, { method: 'POST', headers: { apikey: CHAVE, 'Content-Type': 'application/json' }, body: JSON.stringify({ p: corpo }) });
  }
  document.getElementById('rosae-contato').addEventListener('submit', function (e) {
    e.preventDefault();
    var d = Object.fromEntries(new FormData(e.target)); d.pagina = location.pathname; d.utm = utm;
    chamar('site_registrar_contato', d).then(function (r) {
      document.getElementById('rosae-msg').textContent = r.ok ? 'Recebemos sua mensagem. Responderemos em breve.' : 'Não foi possível enviar. Chame no WhatsApp.';
      if (r.ok) e.target.reset();
    });
  });
  // Conta cliques nos botões de WhatsApp (não cria contato).
  document.querySelectorAll('a[href*="wa.me"], a[href*="whatsapp"]').forEach(function (a) {
    a.addEventListener('click', function () { chamar('site_registrar_clique', { pagina: location.pathname, utm: utm }); });
  });
})();
</script>`;
  const toast = useToast();
  return (
    <Modal titulo="Formulário do site" aoFechar={aoFechar} largo
      rodape={<><button className="btn-secundario" onClick={aoFechar}>Fechar</button><button className="btn-primario" onClick={() => { navigator.clipboard.writeText(codigo); toast('Código copiado.'); }}>Copiar código</button></>}>
      <div className="stack">
        <p style={{ margin: 0 }}>
          Quando o site rosaeengenharia.com for publicado, cole este trecho na página de contato. Cada mensagem vira um contato em “Novo contato”,
          sem duplicar quem já está cadastrado. Cliques no botão de WhatsApp só são contados (não viram contato, porque ninguém escreveu nada ainda).
        </p>
        <div className="aviso info"><span>A chave que aparece no código é pública por natureza. Ela só permite enviar mensagens; ler dados exige login.</span></div>
        <pre className="codigo">{codigo}</pre>
      </div>
    </Modal>
  );
}
