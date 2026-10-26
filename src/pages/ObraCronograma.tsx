// Cronograma da obra: etapas por serviço, progresso físico por peso, linha de base,
// e três visões (lista, linha do tempo, calendário).
import { useMemo, useState } from 'react';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { Ajuda, Carregando, Erro, Modal, Vazio, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import { formatarData, formatarDataHora, hoje, nomeMes, somarMeses } from '../core/datas';
import {
  desvioDias, diasEntre, ESTADO_ETAPA, limitesLinhaTempo, posicaoBarra, programarSequencial, semanasDoMes, type EstadoEtapa,
} from '../core/cronograma';
import type { Etapa, Pessoa, Progresso } from '../lib/tipos';
import { Grafico, TabelaDados, type Serie } from '../components/graficos';
import { curvaS, datasDaCurva, pesosNaObra } from '../core/graficos';

type Item = { id: string; nome: string };
const ESTADOS = Object.keys(ESTADO_ETAPA) as EstadoEtapa[];

export function BarraProgresso({ valor, conferido, rotulo }: { valor: number; conferido?: number; rotulo?: string }) {
  return (
    <div className="barra-progresso" role="progressbar" aria-valuenow={Math.round(valor)} aria-valuemin={0} aria-valuemax={100} aria-label={rotulo ?? 'Progresso'}>
      <div className="exec" style={{ width: `${Math.min(100, valor)}%` }} />
      {conferido !== undefined && <div className="conf" style={{ width: `${Math.min(100, conferido)}%` }} />}
    </div>
  );
}

export function Cronograma({ obraId, servicos, ehAdm, aoMudar }: { obraId: string; servicos: Item[]; ehAdm: boolean; aoMudar?: () => void }) {
  const toast = useToast();
  const [visao, setVisao] = useState<'lista' | 'linha' | 'calendario' | 'curva'>('lista');
  const [editar, setEditar] = useState<Etapa | 'nova' | null>(null);
  const [programar, setProgramar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const { dados, erro: erroCarga, carregando, recarregar } = useConsulta(async () => {
    const [e, p] = await Promise.all([
      supabase.from('etapa').select('*').eq('obra_id', obraId).order('ordem'),
      supabase.rpc('progresso_obra', { p_obra: obraId }),
    ]);
    return { etapas: ok(e) as Etapa[], progresso: ok(p) as Progresso };
  }, [obraId]);
  const etapas = dados?.etapas ?? [];
  const ordemServ = useMemo(() => new Map(servicos.map((s, i) => [s.id, i])), [servicos]);
  const ordenadas = useMemo(() => [...etapas].sort((a, b) => (ordemServ.get(a.servico_id) ?? 0) - (ordemServ.get(b.servico_id) ?? 0) || a.ordem - b.ordem), [etapas, ordemServ]);
  const temBase = etapas.some((e) => e.inicio_base);
  const semDatas = etapas.filter((e) => e.estado !== 'cancelado' && !e.inicio_previsto).length;

  function mudou() { recarregar(); aoMudar?.(); }

  async function mudarEstado(e: Etapa, estado: EstadoEtapa) {
    setErro(null);
    const r = await supabase.from('etapa').update({ estado }).eq('id', e.id);
    if (r.error) return setErro(mensagemErro(r.error));
    toast(`${e.nome}: ${ESTADO_ETAPA[estado].rotulo.toLowerCase()}.`);
    mudou();
  }

  async function linhaBase() {
    const substituir = temBase && window.confirm('Já existe linha de base. Deseja SUBSTITUIR o planejamento original pelas datas atuais? (Cancelar = só completar etapas que ainda não têm base.)');
    const r = await supabase.rpc('definir_linha_base', { p_obra: obraId, p_substituir: substituir });
    if (r.error) return setErro(mensagemErro(r.error));
    toast(r.data ? `Planejamento original guardado para ${r.data} etapa(s).` : 'Nenhuma etapa com datas para guardar.');
    mudou();
  }

  if (carregando && !dados) return <Carregando />;
  const prog = dados?.progresso;
  return (
    <div className="stack">
      <div className="card">
        <div className="topo" style={{ marginBottom: 10 }}>
          <h2>Progresso físico <Ajuda>
            Média ponderada pelo peso técnico: cada etapa pesa dentro do seu serviço e cada serviço pesa na obra (na conversão da proposta, o peso do serviço vem da participação no valor; você pode mudar).
            O percentual da etapa vem da quantidade executada ÷ prevista quando houver medição, ou do percentual informado. Compras e pagamentos nunca mudam o progresso.
            “Conferido” conta só etapas com conferência técnica da ROSAE. Etapas canceladas saem da conta e aparecem à parte.
          </Ajuda></h2>
          {ehAdm && (
            <div className="row">
              <button className="btn-secundario" onClick={() => setProgramar(true)} disabled={!etapas.length}><Icone nome="calendario" /> Programar datas</button>
              <button className="btn-secundario" onClick={linhaBase} disabled={!etapas.some((e) => e.inicio_previsto)}>Guardar linha de base</button>
              <button className="btn-primario" onClick={() => setEditar('nova')} disabled={!servicos.length}><Icone nome="mais" /> Etapa</button>
            </div>
          )}
        </div>
        {prog && (
          <div className="grid grid-3">
            <div>
              <div className="rotulo-kpi">Execução concluída</div>
              <div className="valor-grande num">{prog.executado.toLocaleString('pt-BR')}%</div>
              <BarraProgresso valor={prog.executado} conferido={prog.conferido} rotulo="Progresso físico da obra" />
              <div className="muted small" style={{ marginTop: 6 }}>Conferido tecnicamente: {prog.conferido.toLocaleString('pt-BR')}% · {prog.concluidas} de {prog.etapas} etapa(s){prog.canceladas ? ` · ${prog.canceladas} cancelada(s) fora da conta` : ''}</div>
            </div>
            <div className="stack" style={{ gap: 6, gridColumn: 'span 2' }}>
              {prog.servicos.filter((s) => s.etapas > 0).map((s) => (
                <div key={s.id} className="linha-prog">
                  <span className="small">{s.nome}</span>
                  <BarraProgresso valor={s.executado} conferido={s.conferido} rotulo={s.nome} />
                  <span className="small num right">{s.executado.toLocaleString('pt-BR')}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {!servicos.length && <p className="muted">Cadastre os serviços da obra primeiro (aba Visão geral).</p>}
        {semDatas > 0 && ehAdm && <div className="aviso info" style={{ marginTop: 10 }}><span>{semDatas} etapa(s) sem data prevista. Use “Programar datas” para sugerir um encadeamento a partir do início.</span></div>}
        {!temBase && etapas.some((e) => e.inicio_previsto) && ehAdm && <div className="aviso info" style={{ marginTop: 10 }}><span>Quando o cronograma estiver combinado com o cliente, clique em “Guardar linha de base”: o planejamento original fica guardado para comparar com a previsão atual.</span></div>}
      </div>

      <div className="card">
        <div className="topo" style={{ marginBottom: 10 }}>
          <div className="segmentado" role="tablist" aria-label="Visão do cronograma">
            {([['lista', 'Lista'], ['linha', 'Linha do tempo'], ['calendario', 'Calendário'], ['curva', 'Curva S']] as const).map(([k, r]) => (
              <button key={k} role="tab" aria-selected={visao === k} className={visao === k ? 'ativo' : ''} onClick={() => setVisao(k)}>{r}</button>
            ))}
          </div>
        </div>
        <Erro mensagem={erro ?? erroCarga} />
        {!etapas.length ? (
          <Vazio titulo="Nenhuma etapa ainda"><p>As etapas chegam da proposta convertida ou podem ser criadas aqui, por serviço.</p></Vazio>
        ) : visao === 'lista' ? (
          <ListaEtapas etapas={ordenadas} servicos={servicos} aoAbrir={setEditar} aoMudarEstado={mudarEstado} ehAdm={ehAdm} />
        ) : visao === 'linha' ? (
          <LinhaTempo etapas={ordenadas} servicos={servicos} aoAbrir={setEditar} />
        ) : visao === 'curva' ? (
          <CurvaS etapas={etapas} progresso={prog ?? null} />
        ) : (
          <Calendario etapas={ordenadas} aoAbrir={setEditar} />
        )}
      </div>

      {editar && <EtapaForm obraId={obraId} etapa={editar === 'nova' ? null : editar} etapas={etapas} servicos={servicos} ehAdm={ehAdm} aoFechar={() => setEditar(null)} aoSalvar={() => { setEditar(null); mudou(); }} />}
      {programar && <ProgramarDatas etapas={etapas} aoFechar={() => setProgramar(false)} aoSalvar={() => { setProgramar(false); mudou(); }} />}
    </div>
  );
}

/** Curva S: % acumulado planejado (linha de base) e previsto, com o realizado de hoje para comparar. */
function CurvaS({ etapas, progresso }: { etapas: Etapa[]; progresso: Progresso | null }) {
  const [tabela, setTabela] = useState(false);
  const calc = useMemo(() => {
    const et = etapas.map((e) => ({ ...e, peso: Number(e.peso) }));
    const pesoServ = new Map((progresso?.servicos ?? []).map((s) => [s.id, Number(s.peso)]));
    const pesos = pesosNaObra(et, pesoServ);
    const datas = et.flatMap((e) => [e.inicio_previsto, e.fim_previsto, e.inicio_base, e.fim_base]).filter(Boolean) as string[];
    if (!datas.length) return null;
    const lim = limitesLinhaTempo([...datas, hoje()], 1)!;
    const pontos = datasDaCurva(lim.inicio, lim.fim, 36);
    const prev = curvaS(et, pesos, pontos, 'previsto');
    const base = curvaS(et, pesos, pontos, 'base');
    const ih = pontos.findIndex((d) => d >= hoje());
    return { pontos, prev, base, ih: ih < 0 ? pontos.length - 1 : ih };
  }, [etapas, progresso]);
  if (!calc) return <Vazio titulo="Sem datas ainda"><p>Programe as datas das etapas para ver a Curva S.</p></Vazio>;
  const { pontos, prev, base, ih } = calc;
  const temBase = base.some((v) => v !== null);
  const series: Serie[] = [
    ...(temBase ? [{ chave: 'base', nome: 'Planejado (linha de base)', cor: 'var(--serie-3)', valores: base, forma: 'linha' as const, tracejada: true }] : []),
    { chave: 'prev', nome: 'Previsão atual', cor: 'var(--serie-1)', valores: prev, forma: 'area' },
  ];
  const fmt = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  const planejadoHoje = (temBase ? base[ih] : prev[ih]) ?? 0;
  const real = progresso?.executado ?? 0;
  const desvio = Math.round((real - planejadoHoje) * 10) / 10;
  const rotulos = pontos.map((d) => formatarData(d).slice(0, 5));
  return (
    <div className="stack">
      <div className="detalhe-numeros" style={{ margin: 0 }}>
        <div><span>{temBase ? 'Planejado até hoje' : 'Previsto até hoje'}</span><b>{fmt(planejadoHoje)}</b></div>
        <div><span>Executado (real)</span><b>{fmt(real)}</b></div>
        <div><span>Desvio</span><b style={{ color: desvio < 0 ? 'var(--desfavoravel)' : 'var(--favoravel)' }}>{desvio > 0 ? '+' : ''}{desvio.toLocaleString('pt-BR')} p.p.</b></div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', background: 'none', border: 0 }}>
          <button className="btn-secundario" style={{ padding: '5px 10px', fontSize: '0.8rem' }} onClick={() => setTabela((t) => !t)}><Icone nome={tabela ? 'grafico' : 'tabela'} /> {tabela ? 'Gráfico' : 'Tabela'}</button>
        </div>
      </div>
      {tabela ? (
        <TabelaDados rotulos={pontos.map(formatarData)} series={series} formatar={fmt} cabecalho="Data" />
      ) : (
        <Grafico
          rotulos={rotulos} rotulosLongos={pontos.map(formatarData)} series={series} formatar={fmt} dominio={[0, 100]} altura={280}
          descricao="Curva S da obra: percentual acumulado por data" marcador={{ indice: ih, rotulo: `hoje · real ${fmt(real)}` }}
        />
      )}
      <p className="muted small" style={{ margin: 0 }}>
        A curva distribui o peso de cada etapa entre início e fim. {temBase ? 'A linha tracejada é o planejamento original combinado com o cliente.' : 'Guarde a linha de base para comparar com o planejamento original.'} Desvio negativo = obra atrás do planejado.
      </p>
    </div>
  );
}

export function SeloEtapa({ estado }: { estado: EstadoEtapa }) {
  return <span className={`selo ${ESTADO_ETAPA[estado].classe}`}>{ESTADO_ETAPA[estado].rotulo}</span>;
}

function Desvio({ e }: { e: Etapa }) {
  const d = desvioDias(e.fim_base, e.fim_previsto);
  if (d === null || d === 0) return null;
  return <span className={d > 0 ? 'desfavoravel small' : 'favoravel small'} title="Diferença da previsão atual para o planejamento original">{d > 0 ? `▼ ${d} dia(s) depois do original` : `▲ ${-d} dia(s) antes`}</span>;
}

function ListaEtapas({ etapas, servicos, aoAbrir, aoMudarEstado, ehAdm }: { etapas: Etapa[]; servicos: Item[]; aoAbrir: (e: Etapa) => void; aoMudarEstado: (e: Etapa, s: EstadoEtapa) => void; ehAdm: boolean }) {
  return (
    <div className="stack">
      {servicos.filter((s) => etapas.some((e) => e.servico_id === s.id)).map((s) => (
        <div key={s.id}>
          <h3 className="sub-servico">{s.nome}</h3>
          <div className="tabela-wrap">
            <table className="tabela">
              <thead><tr><th>Etapa</th><th>Situação</th><th className="right">%</th><th>Previsto</th><th>Realizado</th></tr></thead>
              <tbody>
                {etapas.filter((e) => e.servico_id === s.id).map((e) => (
                  <tr key={e.id} className={`clicavel${e.estado === 'cancelado' ? ' cancelada' : ''}`} onClick={() => aoAbrir(e)}>
                    <td><b>{e.nome}</b>{Number(e.peso) !== 1 && <div className="muted small">peso {Number(e.peso).toLocaleString('pt-BR')}</div>}</td>
                    <td onClick={(ev) => ev.stopPropagation()}>
                      <select aria-label={`Situação de ${e.nome}`} value={e.estado} onChange={(ev) => aoMudarEstado(e, ev.target.value as EstadoEtapa)} className="select-compacto">
                        {ESTADOS.filter((k) => ehAdm || !['conferido', 'cancelado'].includes(k) || k === e.estado).map((k) => <option key={k} value={k}>{ESTADO_ETAPA[k].rotulo}</option>)}
                      </select>
                    </td>
                    <td className="right num">{Number(e.percentual).toLocaleString('pt-BR')}%</td>
                    <td className="small">{e.inicio_previsto ? `${formatarData(e.inicio_previsto)} a ${formatarData(e.fim_previsto)}` : <span className="muted">sem data</span>}<div><Desvio e={e} /></div></td>
                    <td className="small">{e.inicio_real ? `${formatarData(e.inicio_real)}${e.fim_real ? ` a ${formatarData(e.fim_real)}` : ' · em curso'}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function LinhaTempo({ etapas, servicos, aoAbrir }: { etapas: Etapa[]; servicos: Item[]; aoAbrir: (e: Etapa) => void }) {
  const comData = etapas.filter((e) => e.inicio_previsto && e.fim_previsto);
  const regua = limitesLinhaTempo(comData.flatMap((e) => [e.inicio_previsto, e.fim_previsto, e.inicio_base, e.fim_base, e.inicio_real, e.fim_real]).concat([hoje()]));
  if (!regua || !comData.length) return <p className="muted">Programe as datas das etapas para ver a linha do tempo.</p>;
  const hojeP = posicaoBarra(regua, hoje(), hoje()).esquerda;
  const meses: { rotulo: string; esq: number }[] = [{ rotulo: formatarData(regua.inicio).slice(0, 5), esq: 0 }];
  let m = somarMeses(regua.inicio.slice(0, 8) + '01', 1);
  while (m <= regua.fim) {
    meses.push({ rotulo: nomeMes(m).replace(' de ', '/'), esq: posicaoBarra(regua, m, m).esquerda });
    m = somarMeses(m, 1);
  }
  const nomeServ = new Map(servicos.map((s) => [s.id, s.nome]));
  return (
    <div className="linha-tempo-obra">
      <div className="lt-legenda small muted">
        <span><i className="lt-chave atual" /> Previsão atual</span>
        <span><i className="lt-chave base" /> Planejamento original</span>
        <span><i className="lt-chave real" /> Realizado</span>
      </div>
      <div className="lt-grade">
        <div className="lt-regua">{meses.map((x) => <span key={x.rotulo} style={{ left: `${x.esq}%` }}>{x.rotulo}</span>)}<span style={{ right: 0 }}>{formatarData(regua.fim).slice(0, 5)}</span></div>
        <div className="lt-hoje" style={{ left: `calc(38% + ${hojeP * 0.62}%)` }} title="Hoje" aria-hidden="true" />
        {comData.map((e) => {
          const a = posicaoBarra(regua, e.inicio_previsto!, e.fim_previsto!);
          const b = e.inicio_base && e.fim_base ? posicaoBarra(regua, e.inicio_base, e.fim_base) : null;
          const r = e.inicio_real ? posicaoBarra(regua, e.inicio_real, e.fim_real ?? hoje()) : null;
          return (
            <button key={e.id} className="lt-linha" onClick={() => aoAbrir(e)} aria-label={`${e.nome}, ${formatarData(e.inicio_previsto)} a ${formatarData(e.fim_previsto)}, ${ESTADO_ETAPA[e.estado].rotulo}`}>
              <span className="lt-nome"><b>{e.nome}</b><span className="muted"> · {nomeServ.get(e.servico_id)}</span></span>
              <span className="lt-trilho">
                {b && <span className="lt-barra base" style={{ left: `${b.esquerda}%`, width: `${b.largura}%` }} />}
                <span className={`lt-barra atual ${e.estado}`} style={{ left: `${a.esquerda}%`, width: `${a.largura}%` }}>
                  <span className="lt-feito" style={{ width: `${Number(e.percentual)}%` }} />
                </span>
                {r && <span className="lt-barra real" style={{ left: `${r.esquerda}%`, width: `${r.largura}%` }} />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Calendario({ etapas, aoAbrir }: { etapas: Etapa[]; aoAbrir: (e: Etapa) => void }) {
  const primeira = etapas.map((e) => e.inicio_previsto).filter(Boolean).sort()[0];
  const [ref, setRef] = useState(() => {
    const h = hoje();
    const temNoMes = etapas.some((e) => e.inicio_previsto && e.inicio_previsto.slice(0, 7) <= h.slice(0, 7) && (e.fim_previsto ?? '').slice(0, 7) >= h.slice(0, 7));
    return ((temNoMes || !primeira) ? h : primeira!).slice(0, 8) + '01';
  });
  const semanas = semanasDoMes(+ref.slice(0, 4), +ref.slice(5, 7));
  const h = hoje();
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <button className="btn-secundario" aria-label="Mês anterior" onClick={() => setRef(somarMeses(ref, -1))}>‹</button>
        <b style={{ textTransform: 'capitalize' }}>{nomeMes(ref)}</b>
        <button className="btn-secundario" aria-label="Próximo mês" onClick={() => setRef(somarMeses(ref, 1))}>›</button>
      </div>
      <div className="calendario" role="grid">
        {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((d) => <div key={d} className="cal-cab" role="columnheader">{d}</div>)}
        {semanas.flat().map((d) => {
          const doDia = etapas.filter((e) => e.estado !== 'cancelado' && e.inicio_previsto && e.inicio_previsto <= d && (e.fim_previsto ?? e.inicio_previsto) >= d);
          return (
            <div key={d} role="gridcell" className={`cal-dia${d.slice(5, 7) !== ref.slice(5, 7) ? ' fora' : ''}${d === h ? ' hoje' : ''}`}>
              <span className="cal-num">{+d.slice(8, 10)}</span>
              {doDia.slice(0, 3).map((e) => <button key={e.id} className={`cal-etapa ${e.estado}`} onClick={() => aoAbrir(e)} title={e.nome}>{e.nome}</button>)}
              {doDia.length > 3 && <span className="muted small">+{doDia.length - 3}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function linhas(t: string) { return t.split('\n').map((x) => x.trim()).filter(Boolean); }

function EtapaForm({ obraId, etapa, etapas, servicos, ehAdm, aoFechar, aoSalvar }: { obraId: string; etapa: Etapa | null; etapas: Etapa[]; servicos: Item[]; ehAdm: boolean; aoFechar: () => void; aoSalvar: () => void }) {
  const toast = useToast();
  const pessoas = useConsulta(async () => (ehAdm ? ok(await supabase.from('pessoa').select('id, nome, eh_prestador').eq('arquivado', false).order('nome')) as Pessoa[] : []), [ehAdm]);
  const historico = useConsulta(async () => (etapa ? ok(await supabase.from('etapa_historico').select('*').eq('etapa_id', etapa.id).order('em', { ascending: false }).limit(30)) as { id: number; em: string; campo: string; antes: string | null; depois: string | null; motivo: string | null }[] : []), [etapa?.id]);
  const [f, setF] = useState({
    nome: etapa?.nome ?? '', servico_id: etapa?.servico_id ?? servicos[0]?.id ?? '', estado: etapa?.estado ?? 'nao_iniciado' as EstadoEtapa,
    peso: String(etapa?.peso ?? 1), duracao_dias: etapa?.duracao_dias ? String(etapa.duracao_dias) : '',
    inicio_previsto: etapa?.inicio_previsto ?? '', fim_previsto: etapa?.fim_previsto ?? '', inicio_real: etapa?.inicio_real ?? '', fim_real: etapa?.fim_real ?? '',
    unidade: etapa?.unidade ?? '', quantidade_prevista: etapa?.quantidade_prevista != null ? String(etapa.quantidade_prevista) : '',
    quantidade_executada: etapa?.quantidade_executada != null ? String(etapa.quantidade_executada) : '', percentual: String(etapa?.percentual ?? 0),
    criterio_medicao: etapa?.criterio_medicao ?? '', criterios: (etapa?.criterios ?? []).join('\n'), descricao: etapa?.descricao ?? '',
    depende_de: etapa?.depende_de ?? [], responsavel_id: etapa?.responsavel_id ?? '', visivel_cliente: etapa?.visivel_cliente ?? true,
    conferencia_obs: etapa?.conferencia_obs ?? '', motivo: '',
  });
  const [erro, setErro] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const mudouPrazo = !!etapa?.inicio_base && (f.inicio_previsto !== (etapa.inicio_previsto ?? '') || f.fim_previsto !== (etapa.fim_previsto ?? ''));
  const porQuantidade = !!f.quantidade_prevista;
  const decimal = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);
    if (mudouPrazo && !f.motivo.trim()) return setErro('Informe o motivo da mudança de prazo: o planejamento original fica guardado.');
    const campo = {
      estado: f.estado, inicio_real: f.inicio_real || null, fim_real: f.fim_real || null,
      quantidade_executada: porQuantidade ? decimal(f.quantidade_executada) : null,
      percentual: porQuantidade ? undefined : Math.max(0, Math.min(100, decimal(f.percentual) ?? 0)),
      motivo_alteracao: f.motivo.trim() || null,
    };
    const reg = ehAdm ? {
      ...campo, obra_id: obraId, servico_id: f.servico_id, nome: f.nome.trim(), descricao: f.descricao.trim() || null,
      peso: decimal(f.peso) ?? 1, duracao_dias: decimal(f.duracao_dias), inicio_previsto: f.inicio_previsto || null, fim_previsto: f.fim_previsto || null,
      unidade: f.unidade.trim() || null, quantidade_prevista: decimal(f.quantidade_prevista), criterio_medicao: f.criterio_medicao.trim() || null,
      criterios: linhas(f.criterios), depende_de: f.depende_de, responsavel_id: f.responsavel_id || null, visivel_cliente: f.visivel_cliente,
      conferencia_obs: f.conferencia_obs.trim() || null,
      ...(etapa ? {} : { ordem: etapas.filter((e) => e.servico_id === f.servico_id).length + 1 }),
    } : campo;
    if (!etapa && reg.estado === 'conferido') return setErro('Conferência técnica é registrada depois da execução.');
    const r = etapa ? await supabase.from('etapa').update(reg).eq('id', etapa.id) : await supabase.from('etapa').insert(reg);
    if (r.error) return setErro(mensagemErro(r.error));
    toast(etapa ? 'Etapa atualizada.' : 'Etapa criada.');
    aoSalvar();
  }

  async function apagar() {
    if (!etapa || !window.confirm(`Apagar a etapa "${etapa.nome}"? Para tirar do escopo mantendo o histórico, prefira a situação "Cancelado".`)) return;
    const r = await supabase.from('etapa').delete().eq('id', etapa.id);
    if (r.error) return setErro(mensagemErro(r.error));
    aoSalvar();
  }

  const outras = etapas.filter((e) => e.id !== etapa?.id);
  return (
    <Modal titulo={etapa ? etapa.nome : 'Nova etapa'} aoFechar={aoFechar} largo
      rodape={<>{etapa && ehAdm && <button type="button" className="btn-link perigo" onClick={apagar}>Apagar</button>}<span style={{ flex: 1 }} /><button type="button" className="btn-secundario" onClick={aoFechar}>Cancelar</button><button className="btn-primario" form="form-etapa">Salvar</button></>}>
      <form id="form-etapa" className="stack" onSubmit={salvar}>
        {ehAdm && (
          <div className="grid grid-2">
            <label className="campo">Etapa<input value={f.nome} onChange={(e) => set('nome', e.target.value)} required /></label>
            <label className="campo">Serviço
              <select value={f.servico_id} onChange={(e) => set('servico_id', e.target.value)} required>{servicos.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select>
            </label>
          </div>
        )}
        <div className="grid grid-3">
          <label className="campo">Situação
            <select value={f.estado} onChange={(e) => set('estado', e.target.value as EstadoEtapa)}>
              {ESTADOS.filter((k) => ehAdm || !['conferido', 'cancelado'].includes(k) || k === etapa?.estado).map((k) => <option key={k} value={k}>{ESTADO_ETAPA[k].rotulo}</option>)}
            </select>
          </label>
          {porQuantidade ? (
            <label className="campo">Executado ({f.unidade || 'qtd'})<input inputMode="decimal" value={f.quantidade_executada} onChange={(e) => set('quantidade_executada', e.target.value)} />
              <span className="dica">de {f.quantidade_prevista} previstos</span></label>
          ) : (
            <label className="campo">Percentual executado<input inputMode="decimal" value={f.percentual} onChange={(e) => set('percentual', e.target.value)} disabled={f.estado === 'executado' || f.estado === 'conferido'} /></label>
          )}
          {ehAdm && <label className="campo">Peso técnico <Ajuda>Quanto esta etapa pesa no serviço. Ex.: assentamento 3, limpeza 1.</Ajuda><input inputMode="decimal" value={f.peso} onChange={(e) => set('peso', e.target.value)} /></label>}
        </div>
        {ehAdm && (
          <div className="grid grid-3">
            <label className="campo">Início previsto<input type="date" value={f.inicio_previsto} onChange={(e) => set('inicio_previsto', e.target.value)} /></label>
            <label className="campo">Fim previsto<input type="date" value={f.fim_previsto} min={f.inicio_previsto || undefined} onChange={(e) => set('fim_previsto', e.target.value)} /></label>
            <label className="campo">Duração (dias)<input inputMode="numeric" value={f.duracao_dias} onChange={(e) => set('duracao_dias', e.target.value)} /></label>
          </div>
        )}
        {etapa?.inicio_base && <p className="muted small" style={{ margin: 0 }}>Planejamento original: {formatarData(etapa.inicio_base)} a {formatarData(etapa.fim_base)}</p>}
        {mudouPrazo && <label className="campo">Motivo da mudança de prazo<input value={f.motivo} onChange={(e) => set('motivo', e.target.value)} required placeholder="Ex.: chuva; material do cliente atrasou" /></label>}
        <div className="grid grid-2">
          <label className="campo">Início real<input type="date" value={f.inicio_real} onChange={(e) => set('inicio_real', e.target.value)} /></label>
          <label className="campo">Fim real<input type="date" value={f.fim_real} onChange={(e) => set('fim_real', e.target.value)} /></label>
        </div>
        {ehAdm && (
          <details className="detalhes-form" open={!!(f.quantidade_prevista || f.criterio_medicao || f.criterios || f.depende_de.length)}>
            <summary>Medição, critérios e dependências</summary>
            <div className="stack" style={{ marginTop: 10 }}>
              <div className="grid grid-3">
                <label className="campo">Quantidade prevista<input inputMode="decimal" value={f.quantidade_prevista} onChange={(e) => set('quantidade_prevista', e.target.value)} placeholder="vazio = por percentual" /></label>
                <label className="campo">Unidade<input value={f.unidade} onChange={(e) => set('unidade', e.target.value)} placeholder="m², m, un" /></label>
                <label className="campo">Responsável
                  <select value={f.responsavel_id} onChange={(e) => set('responsavel_id', e.target.value)}>
                    <option value="">—</option>{(pessoas.dados ?? []).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </label>
              </div>
              <label className="campo">Critério de medição<input value={f.criterio_medicao} onChange={(e) => set('criterio_medicao', e.target.value)} placeholder="Ex.: m² assentados e rejuntados" /></label>
              <label className="campo">Pontos de verificação (um por linha)<textarea rows={3} value={f.criterios} onChange={(e) => set('criterios', e.target.value)} /></label>
              {outras.length > 0 && (
                <fieldset className="campo"><legend>Depende de</legend>
                  <div className="lista-check">
                    {outras.map((o) => (
                      <label key={o.id} className="check"><input type="checkbox" checked={f.depende_de.includes(o.id)} onChange={(e) => set('depende_de', e.target.checked ? [...f.depende_de, o.id] : f.depende_de.filter((x) => x !== o.id))} /> {o.nome}</label>
                    ))}
                  </div>
                </fieldset>
              )}
              <label className="check"><input type="checkbox" checked={f.visivel_cliente} onChange={(e) => set('visivel_cliente', e.target.checked)} /> Pode aparecer no portal do cliente (quando publicado)</label>
              <label className="campo">Observações<textarea rows={2} value={f.descricao} onChange={(e) => set('descricao', e.target.value)} /></label>
            </div>
          </details>
        )}
        {etapa?.estado === 'conferido' && <div className="aviso ok"><Icone nome="check" /><span>Conferido tecnicamente em {formatarDataHora(etapa.conferido_em)}.</span></div>}
        {ehAdm && (f.estado === 'conferido' || etapa?.estado === 'executado') && (
          <label className="campo">Observação da conferência técnica<input value={f.conferencia_obs} onChange={(e) => set('conferencia_obs', e.target.value)} /></label>
        )}
        <Erro mensagem={erro} />
        {(historico.dados?.length ?? 0) > 0 && (
          <details className="detalhes-form"><summary>Histórico ({historico.dados!.length})</summary>
            <ul className="linha-tempo" style={{ marginTop: 8 }}>
              {historico.dados!.map((h) => (
                <li key={h.id}><div className="small muted">{formatarDataHora(h.em)}</div>
                  <div className="small">{h.campo === 'estado' ? `Situação: ${ESTADO_ETAPA[h.antes as EstadoEtapa]?.rotulo ?? h.antes} → ${ESTADO_ETAPA[h.depois as EstadoEtapa]?.rotulo ?? h.depois}` : h.campo === 'prazo' ? `Prazo: ${h.antes || '—'} → ${h.depois || '—'}` : `Percentual: ${h.antes}% → ${h.depois}%`}{h.motivo ? ` · ${h.motivo}` : ''}</div>
                </li>
              ))}
            </ul>
          </details>
        )}
      </form>
    </Modal>
  );
}

function ProgramarDatas({ etapas, aoFechar, aoSalvar }: { etapas: Etapa[]; aoFechar: () => void; aoSalvar: () => void }) {
  const toast = useToast();
  const [inicio, setInicio] = useState(hoje());
  const [domingo, setDomingo] = useState(true);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  let plano: ReturnType<typeof programarSequencial> | null = null;
  let falha: string | null = null;
  try {
    plano = programarSequencial(etapas.map((e) => ({
      ...e, duracao_dias: e.duracao_dias ?? (e.inicio_previsto && e.fim_previsto ? diasEntre(e.inicio_previsto, e.fim_previsto) + 1 : 1),
    })), inicio, domingo);
  } catch (e) { falha = (e as Error).message; }
  const mudam = plano ? etapas.filter((e) => plano![e.id] && (plano![e.id].inicio !== e.inicio_previsto || plano![e.id].fim !== e.fim_previsto)) : [];
  const exigeMotivo = mudam.some((e) => e.inicio_base);

  async function aplicar() {
    if (!plano) return;
    if (exigeMotivo && !motivo.trim()) return setErro('Há etapas com linha de base: informe o motivo da reprogramação.');
    setSalvando(true);
    for (const e of mudam) {
      const r = await supabase.from('etapa').update({ inicio_previsto: plano[e.id].inicio, fim_previsto: plano[e.id].fim, motivo_alteracao: e.inicio_base ? motivo.trim() : null }).eq('id', e.id);
      if (r.error) { setSalvando(false); return setErro(`${e.nome}: ${mensagemErro(r.error)}`); }
    }
    toast(`${mudam.length} etapa(s) programada(s).`);
    aoSalvar();
  }

  return (
    <Modal titulo="Programar datas" aoFechar={aoFechar} largo
      rodape={<><button className="btn-secundario" onClick={aoFechar}>Cancelar</button><button className="btn-primario" onClick={aplicar} disabled={!mudam.length || salvando}>Aplicar a {mudam.length} etapa(s)</button></>}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>Sugestão: cada etapa começa depois da anterior do mesmo serviço (ou das que ela depende). Serviços diferentes começam juntos. Etapas concluídas não mudam. Confira antes de aplicar.</p>
        <div className="grid grid-2">
          <label className="campo">Início da obra<input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} /></label>
          <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={domingo} onChange={(e) => setDomingo(e.target.checked)} /> Não programar aos domingos</label>
        </div>
        {exigeMotivo && <label className="campo">Motivo da reprogramação<input value={motivo} onChange={(e) => setMotivo(e.target.value)} /></label>}
        <Erro mensagem={erro ?? falha} />
        {plano && (
          <div className="tabela-wrap">
            <table className="tabela">
              <thead><tr><th>Etapa</th><th>Atual</th><th>Sugerido</th></tr></thead>
              <tbody>{etapas.map((e) => plano![e.id] && (
                <tr key={e.id} className={mudam.includes(e) ? '' : 'muted'}>
                  <td>{e.nome}</td>
                  <td className="small">{e.inicio_previsto ? `${formatarData(e.inicio_previsto)} a ${formatarData(e.fim_previsto)}` : '—'}</td>
                  <td className="small">{formatarData(plano![e.id].inicio)} a {formatarData(plano![e.id].fim)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

