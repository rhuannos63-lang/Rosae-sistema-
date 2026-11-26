// Cartão do painel: hoje, amanhã e depois, os atrasados e quando a agenda fica livre.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useConsulta } from '../lib/consulta';
import { useAuth } from '../auth/AuthProvider';
import { carregarEventos, carregarFila } from '../lib/agenda';
import { eventosDoDia, nomeDiaCurto, type Evento } from '../core/agenda';
import { formatarData, hoje as hojeSP, somarDias } from '../core/datas';
import { formatar } from '../core/dinheiro';
import { Icone } from './Icone';

const MAX = 5;

export function AgendaPainel() {
  const { usuario, podeFinanceiro } = useAuth();
  const comercial = usuario?.papel === 'administrador' || usuario?.papel === 'administrativo';
  const navegar = useNavigate();
  const h = hojeSP();
  const [dias] = useState(() => [h, somarDias(h, 1), somarDias(h, 2)]);
  const { dados } = useConsulta(async () => {
    const [ev, fila] = await Promise.all([
      carregarEventos(dias[0], dias[2], h, { financeiro: podeFinanceiro, comercial }),
      comercial ? carregarFila(null).catch(() => null) : Promise.resolve(null),
    ]);
    return { eventos: ev.eventos.filter((e) => !e.feito), fila };
  }, [dias, h, podeFinanceiro, comercial]);
  if (!dados) return null;
  const atrasados = dados.eventos.filter((e) => e.atrasado);
  const dia = (d: string) => eventosDoDia(dados.eventos.filter((e) => !e.atrasado || d === h), d);
  const abrir = (e: Evento) => navegar(`/agenda?vista=dia&data=${e.inicio < h ? h : e.inicio}`);
  const receber = dados.eventos.filter((e) => e.fonte === 'receber' && e.inicio <= dias[2] && e.inicio >= h).reduce((t, e) => t + (e.valor ?? 0), 0);
  return (
    <div className="painel-agenda">
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Icone nome="calendario" /> Sua agenda</h2>
          <div className="row" style={{ gap: 6 }}>
            <Link className="btn-secundario btn-mini" to={`/agenda?vista=dia&data=${h}&nova=1`}><Icone nome="mais" /> Tarefa</Link>
            <Link className="btn-primario btn-mini" to="/agenda">Abrir a agenda</Link>
          </div>
        </div>
        <div className="painel-agenda-dias">
          {dias.map((d, k) => {
            const l = dia(d);
            return (
              <div key={d} className={`painel-agenda-dia${k === 0 ? ' hoje' : ''}`}>
                <h4><span>{k === 0 ? 'Hoje' : k === 1 ? 'Amanhã' : nomeDiaCurto(d)}</span><span>{formatarData(d).slice(0, 5)}</span></h4>
                {l.slice(0, MAX).map((e) => (
                  <button key={e.id} type="button" className={`ag-ev c-${e.cor}${e.atrasado ? ' atrasado' : ''}`} onClick={() => abrir(e)} title={e.det ?? e.titulo}>
                    {e.hora && <span className="ag-ev-hora">{e.hora}</span>}<span className="ag-ev-titulo">{e.titulo}</span>
                  </button>
                ))}
                {l.length > MAX && <Link className="btn-link small" to={`/agenda?vista=dia&data=${d}`}>+{l.length - MAX} mais</Link>}
                {l.length === 0 && <span className="muted small">Nada marcado.</span>}
              </div>
            );
          })}
        </div>
      </div>
      <div className="card ag-card" style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
        <Link to={`/agenda?vista=dia&data=${h}`} className="ag-mini-texto c-pagar" style={{ textDecoration: 'none' }}>
          <span className="ag-bolinha" style={{ background: atrasados.length ? 'var(--desfavoravel)' : 'var(--favoravel)' }} />
          <span><b>{atrasados.length ? `${atrasados.length} ${atrasados.length === 1 ? 'item atrasado' : 'itens atrasados'}` : 'Nada atrasado'}</b>
            <small className="muted">{atrasados.length ? atrasados.slice(0, 3).map((e) => e.titulo).join(' · ') : 'Tarefas, etapas e contas em dia.'}</small></span>
        </Link>
        {podeFinanceiro && receber > 0 && (
          <div className="ag-mini-texto c-receber"><span className="ag-bolinha" /><span><b className="num">{formatar(receber)}</b><small className="muted">a receber até {formatarData(dias[2]).slice(0, 5)}</small></span></div>
        )}
        {dados.fila && (
          <Link to="/agenda" className="ag-mini-texto c-trabalho" style={{ textDecoration: 'none' }}>
            <span className="ag-bolinha" />
            <span><b>Livre a partir de {formatarData(dados.fila.livre)}</b><small className="muted">{dados.fila.fila.length ? `${dados.fila.fila.length} trabalho(s) na fila · o prazo das propostas novas já começa aí` : 'Nenhum trabalho na fila'}</small></span>
          </Link>
        )}
      </div>
    </div>
  );
}
