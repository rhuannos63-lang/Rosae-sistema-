// Agenda: tudo que tem data nas próximas semanas, num lugar só (etapas das obras, materiais,
// recebimentos e pagamentos, validade de propostas e próximas ações comerciais).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ok, useConsulta } from '../lib/consulta';
import { useAuth } from '../auth/AuthProvider';
import { Topo } from '../components/Layout';
import { Carregando, Erro, Vazio } from '../components/ui';
import { Icone } from '../components/Icone';
import { doBanco, formatar } from '../core/dinheiro';
import { formatarData, hoje, somarDias } from '../core/datas';

type Tipo = 'etapa_inicio' | 'etapa_fim' | 'material' | 'receber' | 'pagar' | 'proposta' | 'comercial';
type Evento = { data: string; tipo: Tipo; titulo: string; det: string; link: string; atrasado: boolean; valor?: number };

const TIPOS: Record<Tipo, { rotulo: string; icone: string; classe: string }> = {
  etapa_inicio: { rotulo: 'Início de etapa', icone: 'obras', classe: 'info' },
  etapa_fim: { rotulo: 'Fim de etapa', icone: 'check', classe: '' },
  material: { rotulo: 'Material necessário', icone: 'caixa', classe: 'alerta' },
  receber: { rotulo: 'A receber', icone: 'financeiro', classe: 'ok' },
  pagar: { rotulo: 'A pagar', icone: 'contas', classe: 'erro' },
  proposta: { rotulo: 'Proposta vence', icone: 'documento', classe: 'alerta' },
  comercial: { rotulo: 'Ação comercial', icone: 'comercial', classe: 'neutro' },
};
const FILTROS = [['tudo', 'Tudo'], ['obras', 'Obras'], ['dinheiro', 'Dinheiro'], ['comercial', 'Comercial']] as const;
const GRUPO: Record<Tipo, (typeof FILTROS)[number][0]> = { etapa_inicio: 'obras', etapa_fim: 'obras', material: 'obras', receber: 'dinheiro', pagar: 'dinheiro', proposta: 'comercial', comercial: 'comercial' };

const DIA_SEMANA = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' });
const diaSemana = (iso: string) => DIA_SEMANA.format(new Date(`${iso}T12:00:00Z`));

export function Agenda() {
  const { usuario, podeFinanceiro } = useAuth();
  const comercial = usuario?.papel === 'administrador' || usuario?.papel === 'administrativo';
  const [dias, setDias] = useState(30);
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number][0]>('tudo');
  const h = hoje();
  const fim = somarDias(h, dias);
  const { dados, erro, carregando } = useConsulta(async () => {
    const ev: Evento[] = [];
    const [et, mt, pc, pr, op, ob] = await Promise.all([
      supabase.from('etapa').select('id, nome, estado, inicio_previsto, fim_previsto, obra_id, obra:obra(nome, codigo)')
        .not('estado', 'in', '(executado,conferido,cancelado)').or(`inicio_previsto.lte.${fim},fim_previsto.lte.${fim}`).limit(400),
      supabase.from('v_material').select('id, descricao, necessario_em, situacao, obra_id').eq('estado', 'ativo').lte('necessario_em', fim)
        .not('situacao', 'in', '(na_obra,cancelado,substituido)').limit(200),
      podeFinanceiro
        ? supabase.from('v_parcela').select('id, lancamento_id, tipo, descricao, saldo, vencimento, situacao, pessoa_nome, obra_nome').in('situacao', ['aberta', 'vencida', 'parcial']).lte('vencimento', fim).order('vencimento').limit(300)
        : Promise.resolve({ data: [], error: null }),
      comercial
        ? supabase.from('proposta').select('id, codigo, titulo, estado, pessoa:pessoa(nome), versoes:proposta_versao!proposta_versao_proposta_id_fkey(numero, emitida, validade)').in('estado', ['enviada', 'em_negociacao'])
        : Promise.resolve({ data: [], error: null }),
      comercial
        ? supabase.from('oportunidade').select('id, titulo, proxima_acao, proxima_acao_data').eq('arquivado', false).not('proxima_acao_data', 'is', null).lte('proxima_acao_data', fim)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('obra').select('id, nome'),
    ]);
    const nomeObra = new Map((ok(ob) as { id: string; nome: string }[]).map((o) => [o.id, o.nome]));
    type Et = { id: string; nome: string; estado: string; inicio_previsto: string | null; fim_previsto: string | null; obra_id: string; obra: { nome: string; codigo: string } | null };
    for (const e of ok(et) as unknown as Et[]) {
      const obra = e.obra ? `${e.obra.codigo} · ${e.obra.nome}` : 'Obra';
      const link = `/obras/${e.obra_id}?aba=cronograma`;
      const naoIniciada = ['nao_iniciado', 'programado'].includes(e.estado);
      if (e.inicio_previsto && naoIniciada && e.inicio_previsto <= fim) ev.push({ data: e.inicio_previsto, tipo: 'etapa_inicio', titulo: e.nome, det: obra, link, atrasado: e.inicio_previsto < h });
      if (e.fim_previsto && e.fim_previsto <= fim) ev.push({ data: e.fim_previsto, tipo: 'etapa_fim', titulo: e.nome, det: obra, link, atrasado: e.fim_previsto < h });
    }
    for (const m of ok(mt) as { id: string; descricao: string; necessario_em: string; situacao: string; obra_id: string }[]) {
      ev.push({ data: m.necessario_em, tipo: 'material', titulo: m.descricao, det: `${nomeObra.get(m.obra_id) ?? 'Obra'} · ${m.situacao.replace(/_/g, ' ')}`, link: `/obras/${m.obra_id}?aba=materiais`, atrasado: m.necessario_em < h });
    }
    for (const p of ok(pc) as { lancamento_id: string; tipo: 'pagar' | 'receber'; descricao: string; saldo: string; vencimento: string; pessoa_nome: string | null; obra_nome: string | null }[]) {
      ev.push({ data: p.vencimento, tipo: p.tipo, titulo: p.descricao, det: [p.pessoa_nome, p.obra_nome].filter(Boolean).join(' · '), link: `/financeiro/${p.lancamento_id}`, atrasado: p.vencimento < h, valor: doBanco(p.saldo) });
    }
    for (const p of ok(pr) as unknown as { id: string; codigo: string; titulo: string; pessoa: { nome: string } | null; versoes: { numero: number; emitida: boolean; validade: string | null }[] }[]) {
      const v = p.versoes.filter((x) => x.emitida).sort((a, b) => b.numero - a.numero)[0];
      if (v?.validade && v.validade <= fim) ev.push({ data: v.validade, tipo: 'proposta', titulo: `${p.codigo} · ${p.titulo}`, det: `${p.pessoa?.nome ?? ''} · v${v.numero}`, link: `/propostas/${p.id}`, atrasado: v.validade < h });
    }
    for (const o of ok(op) as { id: string; titulo: string; proxima_acao: string | null; proxima_acao_data: string }[]) {
      ev.push({ data: o.proxima_acao_data, tipo: 'comercial', titulo: o.proxima_acao || 'Próxima ação', det: o.titulo, link: `/comercial/${o.id}`, atrasado: o.proxima_acao_data < h });
    }
    return ev;
  }, [fim, podeFinanceiro, comercial]);

  const lista = useMemo(() => (dados ?? []).filter((e) => filtro === 'tudo' || GRUPO[e.tipo] === filtro), [dados, filtro]);
  const atrasados = lista.filter((e) => e.atrasado).sort((a, b) => a.data.localeCompare(b.data));
  const porDia = useMemo(() => {
    const m = new Map<string, Evento[]>();
    for (const e of lista.filter((x) => !x.atrasado).sort((a, b) => a.data.localeCompare(b.data))) m.set(e.data, [...(m.get(e.data) ?? []), e]);
    return [...m.entries()];
  }, [lista]);
  const semana = lista.filter((e) => !e.atrasado && e.data <= somarDias(h, 7));
  const entra = semana.filter((e) => e.tipo === 'receber').reduce((t, e) => t + (e.valor ?? 0), 0);
  const sai = semana.filter((e) => e.tipo === 'pagar').reduce((t, e) => t + (e.valor ?? 0), 0);

  return (
    <>
      <Topo titulo="Agenda" sub="O que tem data: etapas, materiais, dinheiro e comercial, de todas as obras, em ordem.">
        <div className="segmentado">
          {[7, 30, 60].map((d) => <button key={d} className={dias === d ? 'ativo' : ''} onClick={() => setDias(d)}>{d} dias</button>)}
        </div>
      </Topo>
      <div className="grid grid-kpi" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="rotulo">Atrasados</div><div className="valor" style={{ color: atrasados.length ? 'var(--desfavoravel)' : undefined }}>{atrasados.length}</div><div className="det">precisam de ação ou de nova data</div></div>
        <div className="kpi"><div className="rotulo">Próximos 7 dias</div><div className="valor">{semana.length}</div><div className="det">compromissos</div></div>
        {podeFinanceiro && <div className="kpi"><div className="rotulo">Entra em 7 dias</div><div className="valor num">{formatar(entra)}</div><div className="det">recebimentos previstos</div></div>}
        {podeFinanceiro && <div className="kpi"><div className="rotulo">Sai em 7 dias</div><div className="valor num">{formatar(sai)}</div><div className="det">pagamentos previstos</div></div>}
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="segmentado">
          {FILTROS.filter(([k]) => (k !== 'dinheiro' || podeFinanceiro) && (k !== 'comercial' || comercial)).map(([k, r]) => <button key={k} className={filtro === k ? 'ativo' : ''} onClick={() => setFiltro(k)}>{r}</button>)}
        </div>
      </div>
      <Erro mensagem={erro} />
      {carregando && !dados ? <Carregando /> : lista.length === 0 ? (
        <div className="card"><Vazio titulo="Nada com data neste período"><p>Programe as datas das etapas no cronograma de cada obra para elas aparecerem aqui.</p></Vazio></div>
      ) : (
        <div className="agenda">
          {atrasados.length > 0 && (
            <section className="agenda-dia atrasado">
              <h3><Icone nome="alerta" /> Atrasados</h3>
              {atrasados.map((e, k) => <LinhaAgenda key={`a${k}`} e={e} mostrarData />)}
            </section>
          )}
          {porDia.map(([data, evs]) => (
            <section key={data} className={`agenda-dia${data === h ? ' hoje' : ''}`}>
              <h3>{data === h ? 'Hoje' : data === somarDias(h, 1) ? 'Amanhã' : diaSemana(data)} <span className="muted">{formatarData(data)}</span></h3>
              {evs.map((e, k) => <LinhaAgenda key={k} e={e} />)}
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function LinhaAgenda({ e, mostrarData }: { e: Evento; mostrarData?: boolean }) {
  const t = TIPOS[e.tipo];
  return (
    <Link to={e.link} className="agenda-item">
      <span className={`agenda-icone ${t.classe}`}><Icone nome={t.icone} /></span>
      <span className="agenda-texto">
        <b>{e.titulo}</b>
        <span className="muted small">{t.rotulo}{e.det ? ` · ${e.det}` : ''}{mostrarData ? ` · ${formatarData(e.data)}` : ''}</span>
      </span>
      {e.valor !== undefined && <b className="num" style={{ color: e.tipo === 'pagar' ? 'var(--desfavoravel)' : 'var(--favoravel)' }}>{formatar(e.valor)}</b>}
    </Link>
  );
}
