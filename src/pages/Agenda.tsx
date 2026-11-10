// Agenda: calendário do dia a dia (mês, semana, dia e lista). Junta as tarefas do Rhuann
// (manuais e as criadas sozinhas quando uma proposta é aceita) com tudo o que tem data no
// sistema: etapas das obras, materiais, contas a receber e a pagar, validade de propostas e
// ações do comercial. Arraste para mudar a data, marque como feito e edite tudo.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase, mensagemErro } from '../lib/supabase';
import { ok, useConsulta } from '../lib/consulta';
import { useAuth } from '../auth/AuthProvider';
import { Topo } from '../components/Layout';
import { Carregando, Erro, Modal, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import { AvisosAparelho } from '../components/AvisosAparelho';
import { formatar } from '../core/dinheiro';
import { formatarData, hoje as hojeSP, nomeMes, somarDias, somarMeses } from '../core/datas';
import {
  CATEGORIAS, DIAS_CABECALHO, FONTES, GRUPOS, LEMBRETES, REPETIR, dataPorExtenso, diasEntre, eventosDoDia, faixasDaSemana, gradeDoMes, grupoDe,
  mesmoMes, minutos, moverPara, nomeDiaCurto, nomeDiaLongo, ordenar, resumoDoDia, rotuloHora, rotuloPeriodo, semana, tituloSemana,
  type Categoria, type Evento, type Grupo, type Repetir, type Tarefa,
} from '../core/agenda';
import {
  alternarFeito, carregarConfig, carregarEventos, carregarFila, mudarData, salvarConfig, type ConfigAgenda, type Fila,
} from '../lib/agenda';

type Vista = 'mes' | 'semana' | 'dia' | 'lista';
const VISTAS: [Vista, string][] = [['mes', 'Mês'], ['semana', 'Semana'], ['dia', 'Dia'], ['lista', 'Lista']];
const CHAVE_VISTA = 'rosae.agenda.vista';
const CHAVE_GRUPOS = 'rosae.agenda.grupos';
const LINHAS_MES = 3;
const LINHAS_SEMANA = 4;
const HORA_PX = 46;

const ehVista = (v: string | null): v is Vista => !!v && VISTAS.some(([k]) => k === v);
const celular = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 700px)').matches;

function periodoDa(vista: Vista, ref: string): { de: string; ate: string } {
  if (vista === 'mes') { const g = gradeDoMes(ref); return { de: g[0][0], ate: g[g.length - 1][6] }; }
  if (vista === 'semana') { const s = semana(ref); return { de: s[0], ate: s[6] }; }
  if (vista === 'dia') return { de: ref, ate: ref };
  return { de: ref, ate: somarDias(ref, 30) };
}

function passo(vista: Vista, ref: string, n: number): string {
  if (vista === 'mes') return somarMeses(`${ref.slice(0, 7)}-01`, n);
  if (vista === 'semana') return somarDias(ref, 7 * n);
  if (vista === 'dia') return somarDias(ref, n);
  return somarDias(ref, 30 * n);
}

export function Agenda() {
  const { usuario, podeFinanceiro } = useAuth();
  const comercial = usuario?.papel === 'administrador' || usuario?.papel === 'administrativo';
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const h = hojeSP();
  const vista: Vista = ehVista(params.get('vista')) ? (params.get('vista') as Vista) : ehVista(localStorage.getItem(CHAVE_VISTA)) ? (localStorage.getItem(CHAVE_VISTA) as Vista) : celular() ? 'dia' : 'mes';
  const ref = /^\d{4}-\d{2}-\d{2}$/.test(params.get('data') ?? '') ? params.get('data')! : h;
  const ir = (m: { vista?: Vista; data?: string }) => {
    const p = new URLSearchParams(params);
    if (m.vista) { p.set('vista', m.vista); localStorage.setItem(CHAVE_VISTA, m.vista); }
    if (m.data) p.set('data', m.data);
    p.delete('nova');
    setParams(p, { replace: true });
  };
  const [grupos, setGrupos] = useState<Set<Grupo>>(() => {
    try { const g = JSON.parse(localStorage.getItem(CHAVE_GRUPOS) ?? 'null'); if (Array.isArray(g)) return new Set(g as Grupo[]); } catch { /* padrão */ }
    return new Set(GRUPOS.map((g) => g.id));
  });
  const [verFeitos, setVerFeitos] = useState(true);
  const [aberto, setAberto] = useState<Evento | null>(null);
  const [form, setForm] = useState<{ tarefa?: Tarefa; data?: string; hora?: string } | null>(params.get('nova') ? { data: params.get('data') ?? h } : null);
  const [config, setConfig] = useState(false);

  const { de, ate } = periodoDa(vista, ref);
  const consulta = useConsulta(() => carregarEventos(de, ate, h, { financeiro: podeFinanceiro, comercial }), [de, ate, h, podeFinanceiro, comercial]);
  const fila = useConsulta<Fila | null>(() => (comercial ? carregarFila(null) : Promise.resolve(null)), [comercial, consulta.dados]);
  const todos = consulta.dados?.eventos ?? [];
  const tarefas = consulta.dados?.tarefas ?? [];
  const eventos = useMemo(() => todos.filter((e) => grupos.has(grupoDe(e)) && (verFeitos || !e.feito)), [todos, grupos, verFeitos]);
  const atrasados = useMemo(() => todos.filter((e) => e.atrasado && grupos.has(grupoDe(e))).sort((a, b) => a.fim.localeCompare(b.fim)), [todos, grupos]);
  const porId = useMemo(() => new Map(todos.map((e) => [e.id, e])), [todos]);

  function alternarGrupo(g: Grupo) {
    const n = new Set(grupos);
    if (n.has(g)) n.delete(g); else n.add(g);
    if (n.size === 0) GRUPOS.forEach((x) => n.add(x.id));
    setGrupos(n);
    localStorage.setItem(CHAVE_GRUPOS, JSON.stringify([...n]));
  }

  async function executar(f: () => Promise<void>, msg?: string) {
    try { await f(); if (msg) toast(msg); await consulta.recarregar(); } catch (e) { toast(mensagemErro(e)); }
  }
  async function feito(e: Evento) {
    await executar(() => alternarFeito(e, tarefas), e.feito ? 'Voltou para pendente.' : e.fonte === 'etapa' ? 'Etapa marcada como executada.' : 'Feito!');
  }
  async function mover(e: Evento, inicio: string) {
    const n = moverPara(e, inicio);
    if (n.inicio === e.inicio) return;
    try {
      await mudarData(e, n.inicio, n.fim);
    } catch (err) {
      const m = mensagemErro(err);
      if (!/motivo/i.test(m)) return toast(m);
      const motivo = window.prompt('Esta etapa já tem o planejamento original guardado. Qual o motivo da mudança de data?');
      if (!motivo?.trim()) return;
      try { await mudarData(e, n.inicio, n.fim, motivo.trim()); } catch (e2) { return toast(mensagemErro(e2)); }
    }
    toast(`${e.titulo}: ${rotuloPeriodo(n)}.`);
    setAberto(null);
    await consulta.recarregar();
  }

  const tituloPeriodo = vista === 'mes' ? nomeMes(ref) : vista === 'semana' ? tituloSemana(semana(ref)) : vista === 'dia' ? `${nomeDiaLongo(ref)}, ${dataPorExtenso(ref, h)}` : `Próximos 30 dias a partir de ${formatarData(ref)}`;
  const arrastar = { aoSoltar: (id: string, dia: string) => { const e = porId.get(id); if (e?.movivel) void mover(e, dia); } };

  return (
    <>
      <Topo titulo="Agenda" sub="Tudo o que você precisa fazer, num lugar só: suas tarefas, as etapas das obras, propostas aceitas e o dinheiro que entra e sai.">
        <button className="btn-secundario" onClick={() => setConfig(true)}><Icone nome="sino" /> Avisos e encaixe</button>
        <button className="btn-primario" onClick={() => setForm({ data: vista === 'lista' ? h : ref })}><Icone nome="mais" /> Nova tarefa</button>
      </Topo>

      <div className="ag-barra">
        <div className="ag-nav">
          <button className="btn-secundario ag-seta" aria-label="Anterior" onClick={() => ir({ data: passo(vista, ref, -1) })}>‹</button>
          <button className="btn-secundario" onClick={() => ir({ data: h })} disabled={ref === h}>Hoje</button>
          <button className="btn-secundario ag-seta" aria-label="Próximo" onClick={() => ir({ data: passo(vista, ref, 1) })}>›</button>
          <h2 className="ag-titulo">{tituloPeriodo.charAt(0).toUpperCase() + tituloPeriodo.slice(1)}</h2>
        </div>
        <div className="segmentado" role="group" aria-label="Visão">
          {VISTAS.map(([k, r]) => <button key={k} className={vista === k ? 'ativo' : ''} onClick={() => ir({ vista: k })}>{r}</button>)}
        </div>
      </div>
      <div className="ag-filtros" role="group" aria-label="Mostrar">
        {GRUPOS.filter((g) => (g.id !== 'receber' && g.id !== 'pagar') || podeFinanceiro).filter((g) => !['tarefas', 'propostas', 'comercial'].includes(g.id) || comercial).map((g) => (
          <button key={g.id} className={`ag-filtro c-${g.cor}${grupos.has(g.id) ? ' ativo' : ''}`} aria-pressed={grupos.has(g.id)} onClick={() => alternarGrupo(g.id)}>
            <span className="ag-bolinha" />{g.rotulo}
          </button>
        ))}
        <label className="ag-feitos"><input type="checkbox" checked={verFeitos} onChange={(e) => setVerFeitos(e.target.checked)} /> Mostrar os feitos</label>
      </div>

      <Erro mensagem={consulta.erro} />
      <div className="ag-corpo">
        <div className="ag-principal">
          {consulta.carregando && !consulta.dados ? <Carregando /> : (
            <>
              {vista === 'mes' && <VistaMes base={ref} hoje={h} eventos={eventos} abrir={setAberto} abrirDia={(d) => ir({ vista: 'dia', data: d })} nova={(d) => setForm({ data: d })} {...arrastar} />}
              {vista === 'semana' && <VistaSemana base={ref} hoje={h} eventos={eventos} abrir={setAberto} abrirDia={(d) => ir({ vista: 'dia', data: d })} nova={(d, hora) => setForm({ data: d, hora })} {...arrastar} />}
              {vista === 'dia' && <VistaDia dia={ref} hoje={h} eventos={eventos} atrasados={atrasados} abrir={setAberto} feito={feito} mover={mover} nova={(hora) => setForm({ data: ref, hora })} criarRapido={async (titulo) => executar(async () => { ok(await supabase.from('tarefa').insert({ titulo, data: ref }).select('id')); }, 'Tarefa adicionada.')} />}
              {vista === 'lista' && <VistaLista de={ref} hoje={h} eventos={eventos} abrir={setAberto} feito={feito} />}
            </>
          )}
        </div>
        <aside className="ag-lateral">
          {!(vista === 'dia' && ref === h) && <ResumoHoje hoje={h} eventos={todos} atrasados={atrasados} irHoje={() => ir({ vista: 'dia', data: h })} />}
          {atrasados.length > 0 && (
            <div className="card ag-card">
              <h3 className="ag-card-titulo"><Icone nome="alerta" /> Atrasados <span className="selo erro">{atrasados.length}</span></h3>
              <div className="ag-lista-mini">
                {atrasados.slice(0, 8).map((e) => (
                  <div key={e.id} className="ag-mini">
                    <button className={`ag-mini-texto c-${e.cor}`} onClick={() => setAberto(e)}>
                      <span className="ag-bolinha" /><span><b>{e.titulo}</b><small className="muted">{FONTES[e.fonte].rotulo} · era {rotuloPeriodo({ inicio: e.fim, fim: e.fim })}</small></span>
                    </button>
                    {e.movivel && <button className="btn-link small" title="Passar para hoje" onClick={() => void mover(e, e.fonte === 'etapa' ? somarDias(e.inicio, diasEntre(e.fim, h)) : h)}>hoje</button>}
                  </div>
                ))}
                {atrasados.length > 8 && <button className="btn-link small" onClick={() => ir({ vista: 'dia', data: h })}>Ver todos ({atrasados.length})</button>}
              </div>
            </div>
          )}
          {fila.dados && <FilaTrabalhos fila={fila.dados} />}
        </aside>
      </div>

      {aberto && <Detalhe e={aberto} hoje={h} fechar={() => setAberto(null)} feito={async () => { await feito(aberto); setAberto(null); }} mover={(d) => mover(aberto, d)}
        editar={() => { const t = tarefas.find((x) => x.id === aberto.ref); setAberto(null); if (t) setForm({ tarefa: t }); }}
        excluir={async () => { if (!window.confirm('Excluir esta tarefa?')) return; const id = aberto.ref; setAberto(null); await executar(async () => { ok(await supabase.from('tarefa').delete().eq('id', id).select('id')); }, 'Tarefa excluída.'); }} />}
      {form && <FormTarefa inicial={form} fechar={() => { setForm(null); if (params.get('nova')) ir({}); }} salvo={async (msg) => { setForm(null); toast(msg); await consulta.recarregar(); }} />}
      {config && <ConfigModal fechar={() => setConfig(false)} salvo={() => { setConfig(false); toast('Agenda configurada.'); void fila.recarregar(); }} />}
    </>
  );
}

// ---------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------
type Arrastar = { aoSoltar: (id: string, dia: string) => void };

function Chip({ e, onClick, faixa }: { e: Evento; onClick: () => void; faixa?: { continuaAntes: boolean; continuaDepois: boolean } }) {
  const cls = ['ag-ev', `c-${e.cor}`, e.feito && 'feito', e.atrasado && 'atrasado', e.automatica && 'auto', faixa?.continuaAntes && 'antes', faixa?.continuaDepois && 'depois', e.inicio !== e.fim && 'longo'].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} draggable={e.movivel} title={`${e.titulo}${e.det ? ` · ${e.det}` : ''}${e.valor !== undefined ? ` · ${formatar(e.valor)}` : ''}`}
      onDragStart={(ev) => { ev.dataTransfer.setData('text/plain', e.id); ev.dataTransfer.effectAllowed = 'move'; }}
      onClick={(ev) => { ev.stopPropagation(); onClick(); }}>
      {e.hora && <span className="ag-ev-hora">{e.hora}</span>}
      <span className="ag-ev-titulo">{e.titulo}</span>
      {e.valor !== undefined && <span className="ag-ev-valor num">{formatar(e.valor)}</span>}
    </button>
  );
}

function alvo(dia: string, a: Arrastar) {
  return {
    onDragOver: (ev: React.DragEvent) => { ev.preventDefault(); (ev.currentTarget as HTMLElement).classList.add('soltar'); },
    onDragLeave: (ev: React.DragEvent) => (ev.currentTarget as HTMLElement).classList.remove('soltar'),
    onDrop: (ev: React.DragEvent) => { ev.preventDefault(); (ev.currentTarget as HTMLElement).classList.remove('soltar'); const id = ev.dataTransfer.getData('text/plain'); if (id) a.aoSoltar(id, dia); },
  };
}

/** Uma semana com as faixas empilhadas (mês e topo da semana). */
function Semana({ dias, hoje, eventos, linhas, abrir, abrirDia, nova, mes, aoSoltar, numeros = true }: Arrastar & { dias: string[]; hoje: string; eventos: Evento[]; linhas: number; abrir: (e: Evento) => void; abrirDia: (d: string) => void; nova: (d: string) => void; mes?: string; numeros?: boolean }) {
  const faixas = faixasDaSemana(eventos, dias);
  const escondidos = dias.map((_, k) => faixas.filter((f) => f.linha >= linhas && f.coluna <= k && f.coluna + f.span > k).length);
  const usadas = Math.min(linhas, Math.max(0, ...faixas.map((f) => f.linha + 1)));
  return (
    <div className={`ag-sem${numeros ? '' : ' sem-numeros'}`} style={{ gridTemplateRows: `${numeros ? '30px ' : ''}repeat(${numeros ? linhas : Math.max(1, usadas)}, 24px) 20px` }}>
      {dias.map((d, k) => (
        <div key={d} className={`ag-celula${d === hoje ? ' hoje' : ''}${mes && !mesmoMes(d, mes) ? ' fora' : ''}${diaFimDeSemana(k) ? ' fds' : ''}`} style={{ gridColumn: k + 1, gridRow: '1 / -1' }}
          onClick={() => abrirDia(d)} {...alvo(d, { aoSoltar })}>
          {numeros && (
            <div className="ag-celula-topo">
              <span className="ag-num">{Number(d.slice(8, 10))}{d.slice(8, 10) === '01' && <small> {nomeMes(d).split(' ')[0].slice(0, 3)}</small>}</span>
              <button type="button" className="ag-add" aria-label={`Nova tarefa em ${formatarData(d)}`} onClick={(ev) => { ev.stopPropagation(); nova(d); }}><Icone nome="mais" /></button>
            </div>
          )}
        </div>
      ))}
      {faixas.filter((f) => f.linha < linhas).map((f) => (
        <div key={f.e.id} className="ag-faixa" style={{ gridColumn: `${f.coluna + 1} / span ${f.span}`, gridRow: f.linha + (numeros ? 2 : 1) }}>
          <Chip e={f.e} onClick={() => abrir(f.e)} faixa={f} />
        </div>
      ))}
      {escondidos.map((n, k) => n > 0 && (
        <button key={k} type="button" className="ag-mais" style={{ gridColumn: k + 1, gridRow: (numeros ? linhas : Math.max(1, usadas)) + (numeros ? 2 : 1) }} onClick={(ev) => { ev.stopPropagation(); abrirDia(dias[k]); }}>+{n} mais</button>
      ))}
    </div>
  );
}
const diaFimDeSemana = (k: number) => k >= 5;

function VistaMes({ base: ref, hoje, eventos, abrir, abrirDia, nova, aoSoltar }: Arrastar & { base: string; hoje: string; eventos: Evento[]; abrir: (e: Evento) => void; abrirDia: (d: string) => void; nova: (d: string) => void }) {
  const grade = gradeDoMes(ref);
  return (
    <div className="ag-mes card">
      <div className="ag-cab-dias">{DIAS_CABECALHO.map((d) => <div key={d}>{d}</div>)}</div>
      {grade.map((dias) => <Semana key={dias[0]} dias={dias} hoje={hoje} eventos={eventos} linhas={LINHAS_MES} abrir={abrir} abrirDia={abrirDia} nova={nova} mes={ref} aoSoltar={aoSoltar} />)}
    </div>
  );
}

function VistaSemana({ base: ref, hoje, eventos, abrir, abrirDia, nova, aoSoltar }: Arrastar & { base: string; hoje: string; eventos: Evento[]; abrir: (e: Evento) => void; abrirDia: (d: string) => void; nova: (d: string, hora?: string) => void }) {
  const dias = semana(ref);
  const comHora = eventos.filter((e) => e.hora && e.inicio === e.fim);
  const diaInteiro = eventos.filter((e) => !(e.hora && e.inicio === e.fim));
  const horas = comHora.map((e) => minutos(e.hora!) / 60);
  const h0 = Math.min(7, ...horas.map(Math.floor));
  const h1 = Math.max(20, ...comHora.map((e) => Math.ceil(minutos(e.horaFim ?? e.hora!) / 60) + (e.horaFim ? 0 : 1)));
  const rolar = useRef<HTMLDivElement>(null);
  useEffect(() => { if (rolar.current) rolar.current.scrollTop = Math.max(0, (7 - h0) * HORA_PX); }, [h0, ref]);
  const agora = new Date();
  const minAgora = Number(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(agora)) * 60 + agora.getMinutes();
  return (
    <div className="ag-semana card">
      <div className="ag-sem-cab">
        <div className="ag-hora-col" />
        {dias.map((d) => (
          <button key={d} type="button" className={`ag-sem-dia${d === hoje ? ' hoje' : ''}`} onClick={() => abrirDia(d)}>
            <span>{nomeDiaCurto(d)}</span><b>{Number(d.slice(8, 10))}</b>
          </button>
        ))}
      </div>
      <div className="ag-sem-topo">
        <div className="ag-hora-col small muted">dia todo</div>
        <Semana dias={dias} hoje={hoje} eventos={diaInteiro} linhas={LINHAS_SEMANA} abrir={abrir} abrirDia={abrirDia} nova={(d) => nova(d)} aoSoltar={aoSoltar} numeros={false} />
      </div>
      <div className="ag-sem-horas" ref={rolar}>
        <div className="ag-grade-horas" style={{ height: (h1 - h0) * HORA_PX }}>
          <div className="ag-hora-col">
            {Array.from({ length: h1 - h0 }, (_, k) => <div key={k} className="ag-hora" style={{ height: HORA_PX }}>{String(h0 + k).padStart(2, '0')}:00</div>)}
          </div>
          {dias.map((d) => (
            <div key={d} className={`ag-coluna${d === hoje ? ' hoje' : ''}`} {...alvo(d, { aoSoltar })}
              onDoubleClick={(ev) => { const y = ev.clientY - (ev.currentTarget as HTMLElement).getBoundingClientRect().top; const hh = Math.floor(y / HORA_PX) + h0; nova(d, `${String(hh).padStart(2, '0')}:00`); }}>
              {Array.from({ length: h1 - h0 }, (_, k) => <div key={k} className="ag-linha-hora" style={{ height: HORA_PX }} />)}
              {d === hoje && minAgora >= h0 * 60 && minAgora <= h1 * 60 && <div className="ag-agora" style={{ top: ((minAgora - h0 * 60) / 60) * HORA_PX }} />}
              {comHora.filter((e) => e.inicio === d).sort(ordenar).map((e, k, lista) => {
                const ini = minutos(e.hora!);
                const fim = e.horaFim ? Math.max(minutos(e.horaFim), ini + 30) : ini + 60;
                const juntos = lista.filter((x) => { const xi = minutos(x.hora!); const xf = x.horaFim ? Math.max(minutos(x.horaFim), xi + 30) : xi + 60; return xi < fim && xf > ini; });
                const pos = juntos.indexOf(e);
                return (
                  <div key={e.id} className="ag-bloco" style={{ top: ((ini - h0 * 60) / 60) * HORA_PX, height: Math.max(22, ((fim - ini) / 60) * HORA_PX - 2), left: `${(pos / juntos.length) * 100}%`, width: `${100 / juntos.length}%`, zIndex: k + 1 }}>
                    <Chip e={e} onClick={() => abrir(e)} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="muted small ag-dica">Arraste para mudar o dia. Dê dois cliques num horário para marcar uma tarefa nele.</p>
    </div>
  );
}

function LinhaEvento({ e, abrir, feito, mostrarData }: { e: Evento; abrir: (e: Evento) => void; feito?: (e: Evento) => void; mostrarData?: boolean }) {
  const marcavel = !!feito && (e.fonte === 'tarefa' || e.fonte === 'etapa') && e.cor !== 'trabalho';
  return (
    <div className={`ag-linha c-${e.cor}${e.feito ? ' feito' : ''}${e.atrasado ? ' atrasado' : ''}`}>
      {marcavel ? (
        <button type="button" className={`ag-check${e.feito ? ' marcado' : ''}`} aria-label={e.feito ? 'Desmarcar' : 'Marcar como feito'} onClick={() => feito!(e)}>{e.feito && <Icone nome="check" />}</button>
      ) : <span className={`ag-icone`}><Icone nome={FONTES[e.fonte].icone} /></span>}
      <button type="button" className="ag-linha-texto" onClick={() => abrir(e)}>
        <b>{e.titulo}</b>
        <span className="muted small">
          {[e.hora ? rotuloHora(e) : null, e.fonte === 'tarefa' ? (CATEGORIAS.find((c) => c.id === e.cor)?.rotulo ?? 'Tarefa') : FONTES[e.fonte].rotulo, e.det, (mostrarData || e.inicio !== e.fim) ? rotuloPeriodo(e) : null, e.atrasado ? 'atrasado' : null].filter(Boolean).join(' · ')}
        </span>
      </button>
      {e.valor !== undefined && <b className="num ag-linha-valor" style={{ color: e.fonte === 'pagar' ? 'var(--desfavoravel)' : 'var(--favoravel)' }}>{formatar(e.valor)}</b>}
    </div>
  );
}

function VistaDia({ dia, hoje, eventos, atrasados, abrir, feito, mover, nova, criarRapido }: { dia: string; hoje: string; eventos: Evento[]; atrasados: Evento[]; abrir: (e: Evento) => void; feito: (e: Evento) => void; mover: (e: Evento, d: string) => void; nova: (hora?: string) => void; criarRapido: (titulo: string) => Promise<void> }) {
  const doDia = eventosDoDia(eventos, dia);
  const comHora = doDia.filter((e) => e.hora && e.inicio === e.fim);
  const resto = doDia.filter((e) => !(e.hora && e.inicio === e.fim));
  const tarefas = resto.filter((e) => e.fonte === 'tarefa' && e.cor !== 'trabalho');
  const outros = resto.filter((e) => !(e.fonte === 'tarefa' && e.cor !== 'trabalho'));
  const r = resumoDoDia(eventos, dia);
  const [texto, setTexto] = useState('');
  const pendentes = atrasados.filter((e) => !(e.inicio <= dia && e.fim >= dia));
  return (
    <div className="ag-dia">
      <div className="card ag-dia-cab">
        <div className="ag-dia-data">
          <span className="ag-dia-num">{Number(dia.slice(8, 10))}</span>
          <span><b>{dia === hoje ? 'Hoje' : dia === somarDias(hoje, 1) ? 'Amanhã' : nomeDiaLongo(dia)}</b><span className="muted">{nomeDiaLongo(dia)}, {dataPorExtenso(dia)}</span></span>
        </div>
        <div className="ag-dia-numeros">
          <span><b>{r.total - r.feitos}</b> a fazer</span>
          {r.feitos > 0 && <span><b>{r.feitos}</b> feito(s)</span>}
          {r.receber > 0 && <span className="fav"><b className="num">{formatar(r.receber)}</b> a receber</span>}
          {r.pagar > 0 && <span className="desfav"><b className="num">{formatar(r.pagar)}</b> a pagar</span>}
        </div>
        {r.total > 0 && <div className="ag-progresso" aria-label={`${r.feitos} de ${r.total} feitos`}><div style={{ width: `${(r.feitos / r.total) * 100}%` }} /></div>}
      </div>

      {dia === hoje && pendentes.length > 0 && (
        <section className="card ag-secao atrasado">
          <h3><Icone nome="alerta" /> Ficou para trás <span className="muted small">marque como feito ou traga para hoje</span></h3>
          {pendentes.map((e) => (
            <div key={e.id} className="ag-linha-acoes">
              <LinhaEvento e={e} abrir={abrir} feito={feito} mostrarData />
              {e.movivel && <button className="btn-secundario btn-mini" onClick={() => mover(e, e.fonte === 'etapa' ? somarDias(e.inicio, diasEntre(e.fim, hoje)) : hoje)}>Para hoje</button>}
            </div>
          ))}
        </section>
      )}

      <section className="card ag-secao">
        <h3>Tarefas</h3>
        <form className="ag-rapido" onSubmit={async (ev) => { ev.preventDefault(); const t = texto.trim(); if (!t) return; setTexto(''); await criarRapido(t); }}>
          <Icone nome="mais" />
          <input value={texto} onChange={(ev) => setTexto(ev.target.value)} placeholder={`Adicionar uma tarefa para ${dia === hoje ? 'hoje' : formatarData(dia)} e apertar Enter`} aria-label="Nova tarefa rápida" />
          <button type="button" className="btn-link small" onClick={() => nova()}>com hora, repetição…</button>
        </form>
        {tarefas.length === 0 && <p className="muted small" style={{ margin: '6px 0 0' }}>Nenhuma tarefa sua neste dia.</p>}
        {tarefas.map((e) => <LinhaEvento key={e.id} e={e} abrir={abrir} feito={feito} />)}
      </section>

      {comHora.length > 0 && (
        <section className="card ag-secao">
          <h3>Horários</h3>
          <div className="ag-linha-tempo">
            {comHora.sort(ordenar).map((e) => (
              <div key={e.id} className="ag-tempo-item"><span className="ag-tempo-hora num">{rotuloHora(e)}</span><LinhaEvento e={e} abrir={abrir} feito={feito} /></div>
            ))}
          </div>
        </section>
      )}

      <section className="card ag-secao">
        <h3>Obras, propostas e dinheiro</h3>
        {outros.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Nada do sistema marcado para este dia.</p> : outros.map((e) => <LinhaEvento key={e.id} e={e} abrir={abrir} feito={feito} />)}
      </section>
    </div>
  );
}

function VistaLista({ de, hoje, eventos, abrir, feito }: { de: string; hoje: string; eventos: Evento[]; abrir: (e: Evento) => void; feito: (e: Evento) => void }) {
  const dias = Array.from({ length: 31 }, (_, k) => somarDias(de, k)).map((d) => [d, eventos.filter((e) => e.inicio === d || (d === de && e.inicio < de && e.fim >= de)).sort(ordenar)] as const).filter(([, l]) => l.length);
  if (!dias.length) return <div className="card"><p className="muted" style={{ margin: 0 }}>Nada marcado nos próximos 30 dias.</p></div>;
  return (
    <div className="agenda">
      {dias.map(([d, l]) => (
        <section key={d} className={`agenda-dia${d === hoje ? ' hoje' : ''}`}>
          <h3>{d === hoje ? 'Hoje' : d === somarDias(hoje, 1) ? 'Amanhã' : nomeDiaLongo(d)} <span className="muted">{formatarData(d)}</span></h3>
          {l.map((e) => <LinhaEvento key={e.id} e={e} abrir={abrir} feito={feito} />)}
        </section>
      ))}
    </div>
  );
}

function ResumoHoje({ hoje, eventos, atrasados, irHoje }: { hoje: string; eventos: Evento[]; atrasados: Evento[]; irHoje: () => void }) {
  const r = resumoDoDia(eventos, hoje);
  const prox = eventosDoDia(eventos, hoje).filter((e) => !e.feito).slice(0, 4);
  return (
    <button type="button" className="card ag-card ag-hoje" onClick={irHoje}>
      <span className="ag-hoje-cab"><span className="ag-dia-num">{Number(hoje.slice(8, 10))}</span><span><b>Hoje</b><small className="muted">{nomeDiaLongo(hoje)}, {dataPorExtenso(hoje)}</small></span></span>
      <span className="ag-hoje-numeros"><span><b>{r.total - r.feitos}</b> a fazer</span><span><b>{atrasados.length}</b> atrasado(s)</span></span>
      {prox.map((e) => <span key={e.id} className={`ag-hoje-item c-${e.cor}`}><span className="ag-bolinha" />{e.hora && <b className="num">{e.hora}</b>}{e.titulo}</span>)}
      {prox.length === 0 && <span className="muted small">Nada pendente para hoje.</span>}
    </button>
  );
}

const SITUACAO: Record<string, [string, string]> = {
  em_execucao: ['em execução', 'ok'], contratada: ['contratada', 'info'], aprovada: ['aprovada', 'info'], aceita: ['aceita', 'ok'], em_aberto: ['em aberto', 'neutro'],
};

/** Fila de trabalhos: um depois do outro, até a próxima data livre. */
export function FilaTrabalhos({ fila, compacta }: { fila: Fila; compacta?: boolean }) {
  const itens = fila.fila;
  const ini = itens.length ? itens.reduce((m, x) => (x.inicio < m ? x.inicio : m), fila.hoje) : fila.hoje;
  const fim = itens.length ? itens.reduce((m, x) => (x.fim > m ? x.fim : m), fila.livre) : fila.livre;
  const total = Math.max(1, diasEntre(ini, fim) + 1);
  const pos = (d: string) => `${Math.max(0, Math.min(100, (diasEntre(ini, d) / total) * 100))}%`;
  return (
    <div className="card ag-card">
      <h3 className="ag-card-titulo"><Icone nome="planejador" /> Fila de trabalhos</h3>
      <p className="ag-livre">Livre para um trabalho novo a partir de <b>{formatarData(fila.livre)}</b></p>
      {itens.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Nenhum trabalho em andamento, aceito ou em aberto.</p> : (
        <div className="ag-fila">
          {itens.map((x) => (
            <Link key={x.tipo + x.id} to={x.link} className="ag-fila-item">
              <span className="ag-fila-texto"><b>{x.titulo}</b><small className="muted">{formatarData(x.inicio)} a {formatarData(x.fim)} <span className={`selo ${SITUACAO[x.situacao]?.[1] ?? 'neutro'}`}>{x.atrasada ? 'atrasada' : SITUACAO[x.situacao]?.[0] ?? x.situacao}</span></small></span>
              <span className="ag-fila-trilho"><span className={`ag-fila-barra s-${x.situacao}${x.atrasada ? ' atrasada' : ''}`} style={{ left: pos(x.inicio), width: `max(4px, calc(${pos(somarDias(x.fim, 1))} - ${pos(x.inicio)}))` }} /><span className="ag-fila-hoje" style={{ left: pos(fila.hoje) }} /></span>
            </Link>
          ))}
        </div>
      )}
      {fila.sem_data.length > 0 && !compacta && (
        <p className="muted small" style={{ margin: '8px 0 0' }}>Sem datas no cronograma (não entram na conta): {fila.sem_data.map((s, k) => <span key={s.id}>{k ? ', ' : ''}<Link to={s.link}>{s.titulo}</Link></span>)}.</p>
      )}
      {!compacta && <p className="muted small" style={{ margin: '8px 0 0' }}>{fila.paralelos === 1 ? 'Um trabalho depois do outro' : `${fila.paralelos} trabalhos ao mesmo tempo`}{fila.contar_em_aberto ? ', reservando também as propostas em aberto' : ''}. O prazo das propostas novas usa esta fila.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Detalhe, formulário e configuração
// ---------------------------------------------------------------------
function Detalhe({ e, hoje, fechar, feito, mover, editar, excluir }: { e: Evento; hoje: string; fechar: () => void; feito: () => void; mover: (d: string) => void; editar: () => void; excluir: () => void }) {
  const [data, setData] = useState(e.inicio);
  const marcavel = (e.fonte === 'tarefa' && e.cor !== 'trabalho') || e.fonte === 'etapa';
  const ehTarefa = e.fonte === 'tarefa';
  const nomeLink: Partial<Record<Evento['fonte'], string>> = { etapa: 'Abrir o cronograma da obra', material: 'Abrir os materiais', receber: 'Abrir o lançamento', pagar: 'Abrir o lançamento', proposta: 'Abrir a proposta', comercial: 'Abrir a oportunidade', tarefa: e.link?.startsWith('/propostas') ? 'Abrir a proposta' : 'Abrir a obra' };
  return (
    <Modal titulo={e.fonte === 'tarefa' ? (CATEGORIAS.find((c) => c.id === e.cor)?.rotulo ?? 'Tarefa') : FONTES[e.fonte].rotulo} aoFechar={fechar}
      rodape={(
        <>
          {ehTarefa && <button className="btn-link" onClick={excluir}><Icone nome="lixeira" /> Excluir</button>}
          <span className="spacer" />
          {ehTarefa && <button className="btn-secundario" onClick={editar}><Icone nome="editar" /> Editar</button>}
          {marcavel && <button className="btn-primario" onClick={feito}><Icone nome="check" /> {e.feito ? 'Voltar para pendente' : e.fonte === 'etapa' ? 'Etapa executada' : 'Feito'}</button>}
        </>
      )}>
      <div className={`ag-detalhe c-${e.cor}`}>
        <span className="ag-detalhe-cor" />
        <div className="stack" style={{ gap: 4 }}>
          <h3 style={{ fontSize: '1.15rem' }}>{e.titulo}</h3>
          <span className="muted">{e.inicio === e.fim ? `${nomeDiaLongo(e.inicio)}, ${dataPorExtenso(e.inicio, hoje)}` : `${formatarData(e.inicio)} a ${formatarData(e.fim)} · ${diasEntre(e.inicio, e.fim) + 1} dias`}{e.hora ? ` · ${rotuloHora(e)}` : ''}</span>
          {e.det && <span>{e.det}</span>}
          {e.valor !== undefined && <b className="num" style={{ fontSize: '1.1rem', color: e.fonte === 'pagar' ? 'var(--desfavoravel)' : 'var(--favoravel)' }}>{formatar(e.valor)}</b>}
          <div className="row" style={{ gap: 6 }}>
            {e.atrasado && <span className="selo erro">Atrasado</span>}
            {e.feito && <span className="selo ok">Feito</span>}
            {e.automatica && <span className="selo neutro">Criada pelo sistema</span>}
            {e.ocorrencia && <span className="selo neutro">Repete</span>}
          </div>
          {e.notas && <p style={{ whiteSpace: 'pre-line', margin: '6px 0 0' }}>{e.notas}</p>}
          {e.cor === 'trabalho' && <p className="muted small" style={{ margin: '6px 0 0' }}>Período reservado quando o cliente aceitou a proposta, depois dos trabalhos que já estavam na fila. Ao converter a proposta em obra, as etapas entram no cronograma com estas datas.</p>}
        </div>
      </div>
      {e.movivel && (
        <div className="ag-mudar-data">
          <label className="campo">{e.inicio === e.fim ? 'Mudar a data' : 'Mudar o início (a duração continua a mesma)'}<input type="date" value={data} onChange={(ev) => setData(ev.target.value)} /></label>
          <button className="btn-secundario" disabled={!data || data === e.inicio} onClick={() => mover(data)}>Mudar</button>
          <button className="btn-link" onClick={() => mover(somarDias(e.inicio, 1))}>+1 dia</button>
          <button className="btn-link" onClick={() => mover(somarDias(e.inicio, 7))}>+1 semana</button>
        </div>
      )}
      {e.link && <Link className="btn-link" to={e.link} onClick={fechar}>{nomeLink[e.fonte]} <Icone nome="seta" /></Link>}
    </Modal>
  );
}

type FormT = { titulo: string; notas: string; data: string; data_fim: string; diaTodo: boolean; hora: string; hora_fim: string; categoria: Categoria; prioridade: number; repetir: Repetir; repetir_ate: string; lembrete_min: number | null; obra_id: string };

function FormTarefa({ inicial, fechar, salvo }: { inicial: { tarefa?: Tarefa; data?: string; hora?: string }; fechar: () => void; salvo: (msg: string) => void }) {
  const t = inicial.tarefa;
  const [f, setF] = useState<FormT>({
    titulo: t?.titulo ?? '', notas: t?.notas ?? '', data: t?.data ?? inicial.data ?? hojeSP(), data_fim: t?.data_fim ?? '',
    diaTodo: t ? !t.hora : !inicial.hora, hora: t?.hora?.slice(0, 5) ?? inicial.hora ?? '09:00', hora_fim: t?.hora_fim?.slice(0, 5) ?? '',
    categoria: t?.categoria ?? 'tarefa', prioridade: t?.prioridade ?? 2, repetir: t?.repetir ?? 'nao', repetir_ate: t?.repetir_ate ?? '',
    lembrete_min: t ? t.lembrete_min : inicial.hora ? 30 : null, obra_id: t?.obra_id ?? '',
  });
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const obras = useConsulta(async () => ok(await supabase.from('obra').select('id, codigo, nome').in('status', ['aprovada', 'contratada', 'em_execucao']).order('codigo')) as { id: string; codigo: string; nome: string }[], []);
  const set = <K extends keyof FormT>(k: K, v: FormT[K]) => setF((x) => ({ ...x, [k]: v }));
  async function gravar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!f.titulo.trim()) return setErro('Escreva o que precisa ser feito.');
    setGravando(true);
    setErro(null);
    const linha = {
      titulo: f.titulo.trim(), notas: f.notas.trim() || null, data: f.data, data_fim: f.repetir === 'nao' && f.data_fim && f.data_fim > f.data ? f.data_fim : null,
      hora: f.diaTodo ? null : f.hora || null, hora_fim: f.diaTodo ? null : f.hora_fim || null, categoria: f.categoria, prioridade: f.prioridade,
      repetir: f.repetir, repetir_ate: f.repetir !== 'nao' && f.repetir_ate ? f.repetir_ate : null, lembrete_min: f.diaTodo ? null : f.lembrete_min, obra_id: f.obra_id || null,
    };
    try {
      if (t) ok(await supabase.from('tarefa').update(linha).eq('id', t.id).select('id'));
      else ok(await supabase.from('tarefa').insert(linha).select('id'));
      salvo(t ? 'Tarefa atualizada.' : 'Tarefa na agenda.');
    } catch (e) {
      setErro(mensagemErro(e));
      setGravando(false);
    }
  }
  return (
    <Modal titulo={t ? 'Editar tarefa' : 'Nova tarefa'} aoFechar={fechar}
      rodape={<><span className="spacer" /><button className="btn-secundario" onClick={fechar}>Cancelar</button><button className="btn-primario" form="form-tarefa" disabled={gravando}>{gravando ? 'Gravando…' : 'Salvar'}</button></>}>
      <form id="form-tarefa" className="stack" onSubmit={gravar}>
        <label className="campo">O que fazer<input autoFocus value={f.titulo} onChange={(e) => set('titulo', e.target.value)} placeholder="Ex.: Visita técnica no Edifício Aurora" /></label>
        <div className="ag-cats" role="radiogroup" aria-label="Tipo">
          {CATEGORIAS.filter((c) => c.id !== 'trabalho' || f.categoria === 'trabalho').map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={f.categoria === c.id} className={`ag-filtro c-${c.id}${f.categoria === c.id ? ' ativo' : ''}`} onClick={() => set('categoria', c.id)}><span className="ag-bolinha" />{c.rotulo}</button>
          ))}
        </div>
        <div className="grid grid-2">
          <label className="campo">Dia<input type="date" required value={f.data} onChange={(e) => set('data', e.target.value)} /></label>
          {f.repetir === 'nao' ? (
            <label className="campo">Até (vários dias) <span className="dica">opcional</span><input type="date" min={f.data} value={f.data_fim} onChange={(e) => set('data_fim', e.target.value)} /></label>
          ) : (
            <label className="campo">Repete até <span className="dica">opcional</span><input type="date" min={f.data} value={f.repetir_ate} onChange={(e) => set('repetir_ate', e.target.value)} /></label>
          )}
        </div>
        <label className="ag-feitos"><input type="checkbox" checked={f.diaTodo} onChange={(e) => set('diaTodo', e.target.checked)} /> Dia inteiro (sem hora marcada)</label>
        {!f.diaTodo && (
          <div className="grid grid-3">
            <label className="campo">Começa<input type="time" value={f.hora} onChange={(e) => set('hora', e.target.value)} /></label>
            <label className="campo">Termina <span className="dica">opcional</span><input type="time" value={f.hora_fim} onChange={(e) => set('hora_fim', e.target.value)} /></label>
            <label className="campo">Avisar no celular
              <select value={f.lembrete_min ?? ''} onChange={(e) => set('lembrete_min', e.target.value === '' ? null : Number(e.target.value))}>
                {LEMBRETES.map((l) => <option key={String(l.min)} value={l.min ?? ''}>{l.rotulo}</option>)}
              </select>
            </label>
          </div>
        )}
        <div className="grid grid-3">
          <label className="campo">Repetir
            <select value={f.repetir} onChange={(e) => set('repetir', e.target.value as Repetir)}>{REPETIR.map((r) => <option key={r.id} value={r.id}>{r.rotulo}</option>)}</select>
          </label>
          <label className="campo">Prioridade
            <select value={f.prioridade} onChange={(e) => set('prioridade', Number(e.target.value))}><option value={1}>Alta</option><option value={2}>Normal</option><option value={3}>Baixa</option></select>
          </label>
          <label className="campo">Obra <span className="dica">opcional</span>
            <select value={f.obra_id} onChange={(e) => set('obra_id', e.target.value)}>
              <option value="">Nenhuma</option>
              {(obras.dados ?? []).map((o) => <option key={o.id} value={o.id}>{o.codigo} · {o.nome}</option>)}
            </select>
          </label>
        </div>
        <label className="campo">Anotações<textarea rows={3} value={f.notas} onChange={(e) => set('notas', e.target.value)} placeholder="Endereço, telefone, o que levar…" /></label>
        <Erro mensagem={erro} />
      </form>
    </Modal>
  );
}

function ConfigModal({ fechar, salvo }: { fechar: () => void; salvo: () => void }) {
  const c = useConsulta(() => carregarConfig(), []);
  const [f, setF] = useState<ConfigAgenda | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { if (c.dados && !f) setF(c.dados); }, [c.dados, f]);
  const set = <K extends keyof ConfigAgenda>(k: K, v: ConfigAgenda[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  return (
    <Modal titulo="Avisos e encaixe dos trabalhos" aoFechar={fechar} largo
      rodape={<><span className="spacer" /><button className="btn-secundario" onClick={fechar}>Fechar</button><button className="btn-primario" disabled={!f} onClick={async () => { try { await salvarConfig(f!); salvo(); } catch (e) { setErro(mensagemErro(e)); } }}>Salvar</button></>}>
      {!f ? <Carregando /> : (
        <div className="stack">
          <h3>Como encaixar os trabalhos</h3>
          <p className="muted small" style={{ margin: 0 }}>O prazo sugerido nas propostas novas começa quando a agenda fica livre, depois das obras em andamento, das propostas aceitas e (se quiser) das propostas em aberto.</p>
          <div className="grid grid-2">
            <label className="campo">Trabalhos ao mesmo tempo<select value={f.paralelos} onChange={(e) => set('paralelos', Number(e.target.value))}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n === 1 ? '1 (um depois do outro)' : n}</option>)}</select></label>
            <label className="campo">Folga entre um trabalho e outro (dias)<input type="number" min={0} max={60} value={f.intervalo_dias} onChange={(e) => set('intervalo_dias', Math.max(0, Number(e.target.value) || 0))} /></label>
            <label className="campo">Antecedência mínima para começar (dias)<span className="dica">tempo para o cliente aceitar e pagar o sinal</span><input type="number" min={0} max={90} value={f.antecedencia_dias} onChange={(e) => set('antecedencia_dias', Math.max(0, Number(e.target.value) || 0))} /></label>
            <label className="ag-feitos" style={{ alignSelf: 'end' }}><input type="checkbox" checked={f.contar_em_aberto} onChange={(e) => set('contar_em_aberto', e.target.checked)} /> Reservar também as propostas em aberto (enviadas e em negociação)</label>
          </div>
          <h3 style={{ marginTop: 8 }}>Avisos no celular</h3>
          <div className="grid grid-2">
            <label className="ag-feitos"><input type="checkbox" checked={f.avisar_resumo} onChange={(e) => set('avisar_resumo', e.target.checked)} /> Resumo do dia, todas as manhãs</label>
            <label className="campo">Hora do resumo<select value={f.resumo_hora} onChange={(e) => set('resumo_hora', Number(e.target.value))}>{Array.from({ length: 13 }, (_, k) => k + 5).map((hh) => <option key={hh} value={hh}>{String(hh).padStart(2, '0')}:00</option>)}</select></label>
            <label className="ag-feitos"><input type="checkbox" checked={f.avisar_atrasos} onChange={(e) => set('avisar_atrasos', e.target.checked)} /> Avisar quando algo atrasar (etapa, tarefa, conta ou recebimento)</label>
          </div>
          <p className="muted small" style={{ margin: 0 }}>Também chegam: o lembrete das tarefas com hora e o aviso de proposta aceita, já dizendo em que dias ela entrou na agenda.</p>
          <Erro mensagem={erro} />
          <AvisosAparelho />
        </div>
      )}
    </Modal>
  );
}

