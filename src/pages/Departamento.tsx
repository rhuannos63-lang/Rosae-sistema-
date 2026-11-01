// Página de entrada de cada departamento: os números do setor, as subpastas,
// o que precisa de atenção ali e como ele se liga aos outros departamentos.
import { Link, Navigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { useDepartamentos } from '../components/Layout';
import { Icone } from '../components/Icone';
import { ComoFunciona } from '../components/ComoFunciona';
import { doBanco, formatar } from '../core/dinheiro';
import { formatarData, hoje } from '../core/datas';
import { DEPARTAMENTO_POR_ID, type Departamento as Dep } from '../core/departamentos';
import type { ItemPendencia } from './Pendencias';

type Numero = { rotulo: string; valor: string; det?: string; alerta?: boolean; para?: string };
type Resumo = { numeros: Numero[]; selos: Record<string, string>; pendencias: ItemPendencia[] };
type Comercial = { enviadas: number; em_negociacao: number; aprovadas_periodo: number; rascunhos: number; oportunidades_abertas: number; acoes_atrasadas: number };

async function carregar(dep: Dep): Promise<Resumo> {
  const fim = hoje();
  const inicio = fim.slice(0, 8) + '01';
  const precisaPainel = dep.id !== 'empresa';
  const [ind, pen, extra] = await Promise.all([
    precisaPainel ? supabase.rpc('painel_indicadores', { p_inicio: inicio, p_fim: fim }) : Promise.resolve({ data: null, error: null }),
    dep.pendencias.length ? supabase.rpc('central_pendencias') : Promise.resolve({ data: [], error: null }),
    dep.id === 'obras' ? supabase.from('medicao').select('id', { count: 'exact', head: true }).eq('estado', 'enviada')
      : dep.id === 'empresa' ? supabase.from('pessoa').select('id', { count: 'exact', head: true }).eq('arquivado', false)
      : Promise.resolve({ data: null, error: null, count: null }),
  ]);
  const i = (ok(ind) ?? {}) as Record<string, unknown> & { comercial?: Comercial | null; sem_permissao?: boolean };
  const pendencias = ((ok(pen) ?? []) as ItemPendencia[]).filter((p) => dep.pendencias.includes(p.tipo));
  const n = (k: string) => doBanco(i[k] as string | null | undefined);
  const c = i.comercial;
  const qtd = (extra as { count?: number | null }).count ?? 0;
  const urgentes = pendencias.filter((p) => p.prioridade === 1).length;
  const numPend: Numero = { rotulo: 'Precisa de atenção', valor: String(pendencias.length), det: urgentes ? `${urgentes} urgente(s)` : 'Nada urgente', alerta: urgentes > 0, para: '/pendencias' };

  switch (dep.id) {
    case 'comercial':
      return {
        pendencias,
        numeros: c ? [
          { rotulo: 'Oportunidades abertas', valor: String(c.oportunidades_abertas), det: c.acoes_atrasadas ? `${c.acoes_atrasadas} com ação atrasada` : 'Ações em dia', alerta: c.acoes_atrasadas > 0, para: '/comercial' },
          { rotulo: 'Propostas em aberto', valor: String((Number(c.enviadas) || 0) + (Number(c.em_negociacao) || 0)), det: `${c.rascunhos} em rascunho`, para: '/propostas' },
          { rotulo: 'Aprovadas no mês', valor: String(c.aprovadas_periodo), det: 'Viram obra na Gestão de Obras', para: '/propostas' },
          numPend,
        ] : [numPend],
        selos: c ? { '/comercial': `${c.oportunidades_abertas} abertas`, '/propostas': `${c.enviadas + c.em_negociacao} em aberto` } : {},
      };
    case 'obras':
      return {
        pendencias,
        numeros: [
          { rotulo: 'Obras ativas', valor: String(i.obras_ativas ?? 0), det: 'Contratadas e em execução', para: '/obras' },
          { rotulo: 'Medições com o cliente', valor: String(qtd), det: qtd ? 'Aguardando aprovação no portal' : 'Nenhuma aguardando', para: '/obras' },
          numPend,
        ],
        selos: { '/obras': `${i.obras_ativas ?? 0} ativas`, '/pendencias': String(pendencias.length) },
      };
    case 'financeiro':
      return {
        pendencias,
        numeros: i.sem_permissao ? [numPend] : [
          { rotulo: 'Saldo nas contas', valor: formatar(n('saldo_contas')), det: 'Hoje, todas as contas ativas', para: '/contas' },
          { rotulo: 'A receber', valor: formatar(n('a_receber')), det: n('a_receber_vencido') > 0 ? `${formatar(n('a_receber_vencido'))} vencido` : 'Nada vencido', alerta: n('a_receber_vencido') > 0, para: '/financeiro?tipo=receber&situacao=abertas' },
          { rotulo: 'A pagar em 7 dias', valor: formatar(n('a_pagar_7_dias')), det: `Total em aberto ${formatar(n('a_pagar'))}`, para: '/financeiro?tipo=pagar&situacao=abertas' },
          { rotulo: 'Recebido no mês', valor: formatar(n('recebido')), det: `Pago em obras ${formatar(n('pago_obras'))}`, para: '/financeiro' },
        ],
        selos: {},
      };
    default:
      return { pendencias, numeros: [{ rotulo: 'Cadastros ativos', valor: String(qtd), det: 'Clientes, parceiros e fornecedores', para: '/pessoas' }], selos: { '/pessoas': String(qtd) } };
  }
}

const PRIORIDADE: Record<number, string> = { 1: 'erro', 2: 'alerta', 3: 'neutro' };

export function Departamento() {
  const { id } = useParams();
  const deps = useDepartamentos();
  const dep = deps.find((d) => d.id === id);
  const { dados, carregando } = useConsulta(async () => (dep ? carregar(dep) : null), [dep?.id]);
  if (!dep) return <Navigate to="/" replace />;
  const resumo = dados;

  return (
    <div className={`dep dep-${dep.id}`}>
      <header className="dep-cab">
        <span className="dep-selo" aria-hidden="true"><Icone nome={dep.icone} /></span>
        <div>
          <span className="dep-kicker">Departamento</span>
          <h1>{dep.nome}</h1>
          <p className="dep-resumo">{dep.resumo}</p>
        </div>
        <div className="dep-como"><ComoFunciona /></div>
      </header>

      <section className="dep-numeros" aria-busy={carregando && !resumo}>
        {(resumo?.numeros ?? Array.from({ length: dep.id === 'empresa' ? 1 : 4 }, () => null)).map((x, k) =>
          x ? (
            <Link key={x.rotulo} to={x.para ?? '#'} className={`dep-numero${x.alerta ? ' alerta' : ''}`}>
              <span className="rotulo">{x.rotulo}</span>
              <b className="num">{x.valor}</b>
              {x.det && <span className="det">{x.det}</span>}
            </Link>
          ) : <div key={k} className="dep-numero esqueleto" aria-hidden="true" />,
        )}
      </section>

      <h2 className="dep-titulo">Subpastas</h2>
      <div className="dep-pastas">
        {dep.subpastas.map((s) => (
          <Link key={s.para} to={s.para} className="dep-pasta">
            <span className="dep-pasta-icone"><Icone nome={s.icone} /></span>
            <span className="dep-pasta-texto">
              <b>{s.rotulo}</b>
              <span>{s.descricao}</span>
            </span>
            {resumo?.selos[s.para] && <span className="dep-pasta-selo">{resumo.selos[s.para]}</span>}
            <Icone nome="chevron" />
          </Link>
        ))}
      </div>

      <div className="dep-baixo">
        {dep.pendencias.length > 0 && (
          <section className="card dep-atencao">
            <div className="row"><h2>Precisa de atenção</h2><div className="spacer" /><Link className="btn-link" to="/pendencias">Ver todas</Link></div>
            {!resumo ? <p className="muted small">Carregando…</p> : resumo.pendencias.length === 0 ? (
              <p className="dep-vazio"><Icone nome="check" /> Tudo em dia neste departamento.</p>
            ) : (
              <ul className="dep-lista">
                {resumo.pendencias.slice(0, 6).map((p) => (
                  <li key={p.chave}>
                    <Link to={p.link}>
                      <span className={`dep-ponto ${PRIORIDADE[p.prioridade] ?? 'neutro'}`} aria-hidden="true" />
                      <span className="dep-lista-texto"><b>{p.titulo}</b><span>{[p.obra, p.detalhe].filter(Boolean).join(' · ')}</span></span>
                      {p.data && <span className="muted small num">{formatarData(p.data)}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <section className="card dep-ligacoes">
          <h2>Como se liga aos outros</h2>
          <ul>
            {dep.ligacoes.map((l) => {
              const outro = deps.find((d) => d.id === l.com) ?? DEPARTAMENTO_POR_ID[l.com];
              const acessivel = deps.some((d) => d.id === l.com);
              const conteudo = (
                <>
                  <span className="dep-ligacao-icone"><Icone nome={outro.icone} /></span>
                  <span><b>{outro.nome}</b><span>{l.texto}</span></span>
                </>
              );
              return <li key={l.com}>{acessivel ? <Link to={`/d/${l.com}`}>{conteudo}<Icone nome="chevron" /></Link> : <div>{conteudo}</div>}</li>;
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
