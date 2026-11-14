// Resumo da obra no topo da "Visão geral": andamento, o que acontece agora e o dinheiro,
// para bater o olho e saber como a obra está sem abrir cada aba.
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { formatarData, hoje } from '../core/datas';
import { doBanco, formatar } from '../core/dinheiro';
import type { Etapa, Progresso, VParcela } from '../lib/tipos';
import { Icone } from './Icone';

const FEITAS = ['executado', 'conferido'];

/** Etapa em andamento, a próxima a começar e a data prevista de término, a partir das etapas da obra. */
export function momentoDaObra(etapas: Pick<Etapa, 'nome' | 'estado' | 'inicio_previsto' | 'fim_previsto'>[], dia = hoje()) {
  const vivas = etapas.filter((e) => e.estado !== 'cancelado');
  const porInicio = [...vivas].sort((a, b) => (a.inicio_previsto ?? '9999').localeCompare(b.inicio_previsto ?? '9999'));
  const agora = porInicio.find((e) => e.estado === 'em_execucao')
    ?? porInicio.find((e) => !FEITAS.includes(e.estado) && e.inicio_previsto && e.inicio_previsto <= dia && (!e.fim_previsto || e.fim_previsto >= dia))
    ?? null;
  const proxima = porInicio.find((e) => e !== agora && !FEITAS.includes(e.estado) && e.estado !== 'em_execucao' && (!e.inicio_previsto || e.inicio_previsto >= dia)) ?? null;
  const atrasadas = vivas.filter((e) => !FEITAS.includes(e.estado) && e.fim_previsto && e.fim_previsto < dia).length;
  const fim = vivas.reduce<string | null>((m, e) => (e.fim_previsto && (!m || e.fim_previsto > m) ? e.fim_previsto : m), null);
  return { agora, proxima, atrasadas, fim };
}

export function ObraResumo({ obraId, previsaoFim, resumo, parcelas }: {
  obraId: string; previsaoFim: string | null;
  resumo: Record<string, string> | null; parcelas: VParcela[];
}) {
  const { dados } = useConsulta(async () => {
    const [e, p] = await Promise.all([
      supabase.from('etapa').select('nome, estado, inicio_previsto, fim_previsto').eq('obra_id', obraId),
      supabase.rpc('progresso_obra', { p_obra: obraId }),
    ]);
    return { etapas: (ok(e) ?? []) as Etapa[], progresso: ok(p) as Progresso | null };
  }, [obraId]);
  const pct = Math.round(Number(dados?.progresso?.executado ?? 0));
  const m = momentoDaObra(dados?.etapas ?? []);
  const total = (dados?.progresso?.etapas ?? 0) - (dados?.progresso?.canceladas ?? 0);

  const r = (k: string) => doBanco(resumo?.[k]);
  const contratado = resumo ? (r('valor_contratado') || r('a_receber_total')) + r('aditivos') : 0;
  const recebido = resumo ? r('recebido') : 0;
  const pctRec = contratado > 0 ? Math.min(100, Math.round((recebido / contratado) * 100)) : 0;
  const proximoReceber = parcelas
    .filter((p) => p.tipo === 'receber' && doBanco(p.saldo) > 0 && !p.cancelado)
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];

  return (
    <div className="obra-resumo">
      <section className="obra-resumo-bloco">
        <span className="obra-resumo-rot">Andamento</span>
        <div className="obra-resumo-num">{pct}<small>%</small></div>
        <div className="obra-resumo-barra" aria-label={`${pct}% executado`}><div style={{ width: `${pct}%` }} /></div>
        <p className="muted small">{dados ? `${dados.progresso?.concluidas ?? 0} de ${total} etapa(s) concluída(s)` : 'Carregando…'}{m.atrasadas > 0 && <span className="obra-resumo-alerta"> · {m.atrasadas} atrasada(s)</span>}</p>
      </section>
      <section className="obra-resumo-bloco">
        <span className="obra-resumo-rot">Agora</span>
        <p className="obra-resumo-texto">{m.agora ? m.agora.nome : dados && total === 0 ? 'Sem etapas no cronograma' : 'Nenhuma etapa em andamento'}</p>
        {m.proxima && <p className="muted small">Depois: {m.proxima.nome}{m.proxima.inicio_previsto ? ` · ${formatarData(m.proxima.inicio_previsto)}` : ''}</p>}
        <p className="muted small">Término previsto: {formatarData(m.fim ?? previsaoFim) || '—'}</p>
        <Link to="?aba=cronograma" className="small">Abrir cronograma <Icone nome="seta" /></Link>
      </section>
      {resumo && (
        <section className="obra-resumo-bloco">
          <span className="obra-resumo-rot">Recebido</span>
          <div className="obra-resumo-num pequeno">{formatar(recebido)}</div>
          <div className="obra-resumo-barra" aria-label={`${pctRec}% recebido`}><div style={{ width: `${pctRec}%` }} /></div>
          <p className="muted small">{contratado > 0 ? <>de {formatar(contratado)} · falta {formatar(Math.max(0, contratado - recebido))}</> : 'Valor do contrato ainda não lançado'}</p>
          {proximoReceber && <p className="muted small">Próximo: {formatar(doBanco(proximoReceber.saldo))} em {formatarData(proximoReceber.vencimento)}</p>}
          <Link to="?aba=financeiro" className="small">Abrir financeiro <Icone nome="seta" /></Link>
        </section>
      )}
    </div>
  );
}
