import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { useAuth } from '../auth/AuthProvider';
import { Topo } from '../components/Layout';
import { Ajuda, Carregando, Erro } from '../components/ui';
import { Icone } from '../components/Icone';
import { doBanco, formatar, type Centavos } from '../core/dinheiro';
import { deslocarPeriodo, hoje, nomeMesCurto, periodo } from '../core/datas';
import type { Empresa } from '../lib/tipos';

type Comercial = { enviadas: number; em_negociacao: number; aprovadas_periodo: number; recusadas_periodo: number; rascunhos: number; oportunidades_abertas: number; acoes_atrasadas: number; cliques_whatsapp: number; formularios: number };
type Indicadores = Record<string, string | number | boolean | null | Comercial> & { sem_permissao?: boolean; gerencial?: boolean; comercial?: Comercial | null };

function KpisComerciais({ c }: { c: Comercial | null | undefined }) {
  if (!c) return null;
  return (
    <>
      <Kpi rotulo="Propostas em aberto" valor={String(c.enviadas + c.em_negociacao)} det={<>{c.em_negociacao} em negociação · {c.rascunhos} rascunho(s) · {c.aprovadas_periodo} aprovada(s) no período</>} para="/propostas" />
      <Kpi rotulo="Oportunidades" valor={String(c.oportunidades_abertas)} det={c.acoes_atrasadas > 0 ? <span style={{ color: 'var(--desfavoravel)' }}>{c.acoes_atrasadas} com ação atrasada</span> : 'Nenhuma ação atrasada'} para="/comercial" ajuda="Contatos em andamento no funil. Formulários do site e cliques no WhatsApp do período aparecem no Comercial." />
    </>
  );
}
type Serie = { mes: string; recebido: string; pago: string; vendido: string };
type TipoPeriodo = 'mes' | 'semestre' | 'ano';

function Kpi({ rotulo, valor, det, para, ajuda, destaque, meta }: { rotulo: string; valor: string; det?: React.ReactNode; para?: string; ajuda?: string; destaque?: boolean; meta?: number | null }) {
  const conteudo = (
    <>
      <div className="rotulo">
        {rotulo}
        {ajuda && <Ajuda>{ajuda}</Ajuda>}
      </div>
      <div className="valor">{valor}</div>
      {det && <div className="det">{det}</div>}
      {meta !== undefined && meta !== null && (
        <div className="barra-meta" aria-label={`${Math.round(meta)}% da meta`}>
          <div style={{ width: `${Math.min(100, Math.max(0, meta))}%` }} />
        </div>
      )}
      {para && <Icone nome="seta" className="seta" />}
    </>
  );
  return para ? (
    <Link to={para} className={`kpi${destaque ? ' destaque' : ''}`}>{conteudo}</Link>
  ) : (
    <div className={`kpi${destaque ? ' destaque' : ''}`}>{conteudo}</div>
  );
}

function GraficoMensal({ serie }: { serie: Serie[] }) {
  const dados = serie.map((s) => ({ mes: s.mes, rec: doBanco(s.recebido), pag: doBanco(s.pago) }));
  const max = Math.max(1, ...dados.flatMap((d) => [d.rec, d.pag]));
  const W = 720, H = 200, base = 170, larg = W / dados.length;
  const altura = (v: Centavos) => (v / max) * 140;
  return (
    <div className="grafico">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Recebido e pago por mês nos últimos 12 meses">
        <line x1="0" x2={W} y1={base} y2={base} stroke="var(--linha-forte)" />
        {dados.map((d, i) => {
          const x = i * larg + larg / 2;
          return (
            <g key={d.mes}>
              <rect x={x - 13} y={base - altura(d.rec)} width="12" height={altura(d.rec)} rx="2" fill="var(--oliva)">
                <title>{`${nomeMesCurto(d.mes)} · recebido ${formatar(d.rec)}`}</title>
              </rect>
              <rect x={x + 1} y={base - altura(d.pag)} width="12" height={altura(d.pag)} rx="2" fill="#c9b98f">
                <title>{`${nomeMesCurto(d.mes)} · pago ${formatar(d.pag)}`}</title>
              </rect>
              <text x={x} y={base + 18} textAnchor="middle" fontSize="11" fill="var(--texto-2)">{nomeMesCurto(d.mes)}</text>
            </g>
          );
        })}
      </svg>
      <div className="legenda">
        <span><i style={{ background: 'var(--oliva)' }} />Recebido de clientes</span>
        <span><i style={{ background: '#c9b98f' }} />Pago (obras e empresa, sem retiradas)</span>
        <span>Passe o dedo ou o mouse nas barras para ver os valores.</span>
      </div>
    </div>
  );
}

export function Painel() {
  const { podeFinanceiro, usuario, ehAdmin } = useAuth();
  const [tipo, setTipo] = useState<TipoPeriodo>('mes');
  const [ref, setRef] = useState(hoje());
  const p = periodo(tipo, ref);

  const { dados, erro, carregando } = useConsulta(async () => {
    const [ind, serie, empresa] = await Promise.all([
      supabase.rpc('painel_indicadores', { p_inicio: p.inicio, p_fim: p.fim }),
      podeFinanceiro ? supabase.rpc('serie_mensal', { p_fim: p.fim }) : Promise.resolve({ data: [], error: null }),
      supabase.from('empresa').select('*').maybeSingle(),
    ]);
    return { ind: ok(ind) as Indicadores, serie: (ok(serie) ?? []) as Serie[], empresa: ok(empresa) as Empresa | null };
  }, [p.inicio, p.fim, podeFinanceiro]);

  const primeiroNome = usuario?.nome.split(' ')[0] ?? '';
  const qs = `inicio=${p.inicio}&fim=${p.fim}`;

  return (
    <>
      <Topo titulo={`Olá, ${primeiroNome}`} sub={<>Situação da ROSAE · {p.rotulo}</>}>
        <div className="segmentado" role="group" aria-label="Período">
          {(['mes', 'semestre', 'ano'] as TipoPeriodo[]).map((t) => (
            <button key={t} className={tipo === t ? 'ativo' : ''} onClick={() => setTipo(t)}>
              {t === 'mes' ? 'Mês' : t === 'semestre' ? 'Semestre' : 'Ano'}
            </button>
          ))}
        </div>
        <button className="btn-secundario" aria-label="Período anterior" onClick={() => setRef(deslocarPeriodo(tipo, ref, -1))}>‹</button>
        <button className="btn-secundario" aria-label="Próximo período" onClick={() => setRef(deslocarPeriodo(tipo, ref, 1))}>›</button>
      </Topo>
      <Erro mensagem={erro} />
      {carregando && !dados && <Carregando />}
      {dados && <ConteudoPainel ind={dados.ind} serie={dados.serie} empresa={dados.empresa} qs={qs} rotulo={p.rotulo} tipo={tipo} ehAdmin={ehAdmin} />}
    </>
  );
}

function ConteudoPainel({ ind, serie, empresa, qs, rotulo, tipo, ehAdmin }: { ind: Indicadores; serie: Serie[]; empresa: Empresa | null; qs: string; rotulo: string; tipo: TipoPeriodo; ehAdmin: boolean }) {
  if (ind.sem_permissao) {
    return (
      <div className="grid grid-kpi">
        <Kpi rotulo="Obras ativas" valor={String(ind.obras_ativas)} para="/obras" />
        <KpisComerciais c={ind.comercial} />
        <div className="aviso info" style={{ gridColumn: '1 / -1' }}>Os números financeiros aparecem só para quem tem acesso ao financeiro.</div>
      </div>
    );
  }
  const c = (k: string) => doBanco(ind[k] as string);
  const meses = tipo === 'mes' ? 1 : tipo === 'semestre' ? 6 : 12;
  const metaRec = ind.meta_recebimentos === null ? null : c('meta_recebimentos') * meses;
  const metaVen = ind.meta_vendas === null ? null : c('meta_vendas') * meses;
  const resultadoCaixa = c('recebido') - c('pago_obras') - c('pago_empresa');
  const pendencias: { texto: string; para: string }[] = [];
  if (Number(ind.a_receber_vencido_qtd) > 0) pendencias.push({ texto: `${ind.a_receber_vencido_qtd} recebimento(s) vencido(s): ${formatar(c('a_receber_vencido'))}`, para: '/financeiro?tipo=receber&situacao=vencida' });
  if (Number(ind.a_pagar_7_dias_qtd) > 0) pendencias.push({ texto: `${ind.a_pagar_7_dias_qtd} pagamento(s) vencido(s) ou nos próximos 7 dias: ${formatar(c('a_pagar_7_dias'))}`, para: '/financeiro?tipo=pagar&situacao=proximos' });
  if (ind.comercial && ind.comercial.acoes_atrasadas > 0) pendencias.push({ texto: `${ind.comercial.acoes_atrasadas} oportunidade(s) com próxima ação atrasada`, para: '/comercial' });
  if (empresa && !empresa.registro_conferido) pendencias.push({ texto: 'Registro profissional (CREA) ainda não conferido para documentos oficiais', para: ehAdmin ? '/configuracoes' : '/' });
  if (empresa && !empresa.cnpj) pendencias.push({ texto: 'CNPJ não informado (documentos mostram "a preencher")', para: ehAdmin ? '/configuracoes' : '/' });

  return (
    <>
      {ind.gerencial && (
        <div className="aviso info" style={{ marginBottom: 14 }}>
          <span>
            Valores <b>gerenciais (estimados)</b>: ainda não há regra de reconhecimento de receita configurada. Vendido, recebido e resultado são números diferentes e aparecem separados.
          </span>
        </div>
      )}
      <div className="grid grid-kpi">
        <Kpi
          destaque
          rotulo="Recebido de clientes"
          valor={formatar(c('recebido'))}
          det={metaRec !== null ? <>Meta de recebimentos: {formatar(metaRec)}</> : 'Defina a meta em Configurações'}
          meta={metaRec ? (c('recebido') / metaRec) * 100 : null}
          para={`/contas?grupo=recebido&${qs}`}
          ajuda="Dinheiro que de fato entrou de clientes no período (recebimentos registrados, já descontados estornos). Não inclui transferências entre suas contas nem rendimentos."
        />
        <Kpi
          rotulo="Vendido (contratado)"
          valor={formatar(c('vendido'))}
          det={metaVen !== null ? <>Meta de vendas: {formatar(metaVen)}</> : 'Sem meta de vendas definida'}
          meta={metaVen ? (c('vendido') / metaVen) * 100 : null}
          para={`/propostas?estado=aprovada`}
          ajuda="Propostas e aditivos aceitos pelo cliente no período (versão aprovada), mais obras lançadas sem proposta pela data de contratação. Vendido não é dinheiro em caixa."
        />
        <Kpi
          rotulo="A receber"
          valor={formatar(c('a_receber'))}
          det={c('a_receber_vencido') > 0 ? <span style={{ color: 'var(--desfavoravel)' }}>Vencido: {formatar(c('a_receber_vencido'))}</span> : 'Nada vencido'}
          para="/financeiro?tipo=receber&situacao=abertas"
          ajuda="Parcelas a receber em aberto (todas as datas). Vencido = vencimento antes de hoje."
        />
        <Kpi
          rotulo="A pagar"
          valor={formatar(c('a_pagar'))}
          det={<>Próximos 7 dias (com vencidos): {formatar(c('a_pagar_7_dias'))}</>}
          para="/financeiro?tipo=pagar&situacao=abertas"
          ajuda="Parcelas a pagar em aberto, de obras e da empresa."
        />
        <Kpi
          rotulo="Pago em obras"
          valor={formatar(c('pago_obras'))}
          det="Material, parceiros, frete e locação"
          para={`/contas?grupo=pago_obras&${qs}`}
        />
        <Kpi
          rotulo="Despesas da empresa"
          valor={formatar(c('pago_empresa'))}
          det={<>Lançadas no período (competência): {formatar(c('despesas_empresa_competencia'))}</>}
          para={`/contas?grupo=pago_empresa&${qs}`}
          ajuda="Pago no período em despesas da empresa, impostos e outras saídas. Abaixo, o total dessas despesas pela data de competência, pago ou não."
        />
        <Kpi
          rotulo="Resultado de caixa (gerencial)"
          valor={formatar(resultadoCaixa)}
          det="Recebido − pago em obras − despesas"
          ajuda="Critério: regime de caixa, só o que entrou e saiu no período. Não é lucro contábil: não considera o que falta receber ou pagar, impostos ainda não pagos nem pró-labore e retiradas."
          para={`/contas?grupo=operacional&${qs}`}
        />
        <Kpi
          rotulo="Pró-labore e retiradas"
          valor={formatar(c('retiradas'))}
          para={`/contas?grupo=retiradas&${qs}`}
          ajuda="O que saiu para você no período. Fica fora do resultado de caixa para não confundir resultado da empresa com o seu ganho."
        />
        <Kpi rotulo="Saldo nas contas" valor={formatar(c('saldo_contas'))} det="Hoje, somando todas as contas ativas" para="/contas" />
        <Kpi rotulo="Obras ativas" valor={String(ind.obras_ativas)} det="Contratadas ou em execução" para="/obras" />
        <KpisComerciais c={ind.comercial} />
        {c('outras_entradas') !== 0 && (
          <Kpi rotulo="Outras entradas" valor={formatar(c('outras_entradas'))} det="Rendimentos, aportes e outras" para={`/contas?grupo=outras&${qs}`} />
        )}
      </div>

      <div className="grid grid-2 section">
        <div className="card">
          <div className="card-titulo">
            <h2>Pendências</h2>
          </div>
          {pendencias.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Nada exigindo ação agora.</p>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {pendencias.map((p) => (
                <Link key={p.texto} to={p.para} className="item-cartao">
                  <span>{p.texto}</span>
                  <Icone nome="seta" className="seta" />
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-titulo">
            <h2>Últimos 12 meses</h2>
            <span className="muted small">até {rotulo}</span>
          </div>
          <GraficoMensal serie={serie} />
        </div>
      </div>
    </>
  );
}
