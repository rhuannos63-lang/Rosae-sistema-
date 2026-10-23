// Relatórios por obra: o administrativo (completo, com financeiro para quem tem
// acesso) e o do cliente (só o que o portal mostra). Imprimem em A4.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { useAuth } from '../auth/AuthProvider';
import { Carregando, Erro, useToast } from '../components/ui';
import { doBanco, formatar } from '../core/dinheiro';
import { diasEntre, ESTADO_ETAPA } from '../core/cronograma';
import { formatarData, formatarDataHora, hoje } from '../core/datas';
import { ESTADO_PORTAL, SITUACAO_MATERIAL_PORTAL, TIPO_REGISTRO_PORTAL, faseEtapa, type DadosPortal } from '../core/portal';
import { MODELO_CONTRATO, type ModeloContrato } from '../core/contrato';
import { SITUACAO_MATERIAL, STATUS_OBRA, type Etapa, type SituacaoMaterial } from '../lib/tipos';
import { ImagemPortal, lerToken } from './Portal';

const R = (v: string | number | null | undefined) => formatar(doBanco(v));

function BarraRelatorio({ titulo }: { titulo: string }) {
  return (
    <div className="nao-imprimir relatorio-barra">
      <span>{titulo}</span>
      <button className="btn-primario" onClick={() => window.print()}>Imprimir ou salvar PDF</button>
    </div>
  );
}

function Cabecalho({ tipo, obra, sub }: { tipo: string; obra: { codigo: string; nome: string }; sub?: string }) {
  return (
    <header className="doc-cab">
      <img src="/marca/rosae-logo-horizontal.svg" alt="ROSAE Engenharia & Estruturas" style={{ height: 34 }} />
      <div style={{ textAlign: 'right' }}>
        <div className="small muted">{tipo}</div>
        <strong>{obra.codigo} · {obra.nome}</strong>
        <div className="small muted">{sub ?? `Gerado em ${formatarDataHora(new Date().toISOString())}`}</div>
      </div>
    </header>
  );
}

type Dados = {
  obra: { id: string; codigo: string; nome: string; status: string; endereco: string | null; data_inicio: string | null; data_previsao_fim: string | null; data_conclusao: string | null; pontos_melhoria: string | null; cliente: { nome: string } | null };
  progresso: { executado: number; conferido: number; etapas: number; concluidas: number; canceladas: number; servicos: { id: string; nome: string; executado: number; conferido: number }[] };
  etapas: Etapa[];
  contratos: { codigo: string; estado: string; modelo: ModeloContrato; valor_total: string; emitido_em: string | null; assinado_em: string | null }[];
  aditivos: { codigo: string; titulo: string; estado: string; aprovada_em: string | null }[];
  materiais: { id: string; descricao: string; unidade: string; quantidade: string | null; comprado: string; entregue: string; situacao: SituacaoMaterial; fornecedor_nome: string | null; responsavel_compra: string }[];
  pendencias: { id: string; titulo: string; tipo: string; prazo: string | null; responsavel: string }[];
  arquivos: { id: string; nome_original: string; natureza: string; criado_em: string }[];
  fotos: number;
  fichas: number;
  fin: null | {
    resumo: Record<string, string>;
    resultado: { modelo: string | null; vendido_obra: string; servicos: Record<string, string>[]; total: Record<string, string> };
    contratacoes: { id: string; pessoa_nome: string; servico_nome: string | null; valor_total: string; pago: string; saldo_a_pagar: string; estado: string }[];
    parcelas: { id: string; tipo: 'receber' | 'pagar'; codigo: string; descricao: string; numero: number; total_parcelas: number; valor: string; vencimento: string; saldo: string; situacao: string }[];
  };
};

export function RelatorioObra() {
  const { id } = useParams();
  const { podeFinanceiro } = useAuth();
  const toast = useToast();
  const [melhoria, setMelhoria] = useState<string | null>(null);
  const { dados, erro, carregando } = useConsulta(async (): Promise<Dados> => {
    const [o, p, e, c, a, m, pe, ar, fo, fi] = await Promise.all([
      supabase.from('obra').select('id, codigo, nome, status, endereco, data_inicio, data_previsao_fim, data_conclusao, pontos_melhoria, cliente:pessoa(nome)').eq('id', id!).single(),
      supabase.rpc('progresso_obra', { p_obra: id }),
      supabase.from('etapa').select('*').eq('obra_id', id!).order('ordem'),
      supabase.from('contrato').select('codigo, estado, modelo, valor_total, emitido_em, assinado_em').eq('obra_id', id!).order('criado_em'),
      supabase.from('proposta').select('codigo, titulo, estado, aprovada_em').eq('obra_id', id!).eq('tipo', 'aditivo').order('criado_em'),
      supabase.from('v_material').select('id, descricao, unidade, quantidade, comprado, entregue, situacao, fornecedor_nome, responsavel_compra').eq('obra_id', id!).order('descricao'),
      supabase.from('pendencia').select('id, titulo, tipo, prazo, responsavel').eq('obra_id', id!).eq('estado', 'aberta'),
      supabase.from('arquivo').select('id, nome_original, natureza, criado_em').eq('obra_id', id!).order('criado_em'),
      supabase.from('foto').select('id', { count: 'exact', head: true }).eq('obra_id', id!),
      supabase.from('ficha').select('id', { count: 'exact', head: true }).eq('obra_id', id!).eq('estado', 'liberada'),
    ]);
    let fin: Dados['fin'] = null;
    if (podeFinanceiro) {
      const [rs, rr, ct, pa] = await Promise.all([
        supabase.rpc('resumo_obra', { p_obra: id }),
        supabase.rpc('resultado_obra_servicos', { p_obra: id }),
        supabase.from('v_contratacao').select('id, pessoa_nome, servico_nome, valor_total, pago, saldo_a_pagar, estado').eq('obra_id', id!),
        supabase.from('v_parcela').select('id, tipo, codigo, descricao, numero, total_parcelas, valor, vencimento, saldo, situacao').eq('obra_id', id!).neq('situacao', 'cancelada').order('vencimento'),
      ]);
      fin = { resumo: ok(rs) as Record<string, string>, resultado: ok(rr) as NonNullable<Dados['fin']>['resultado'], contratacoes: ok(ct) as NonNullable<Dados['fin']>['contratacoes'], parcelas: ok(pa) as NonNullable<Dados['fin']>['parcelas'] };
    }
    return {
      obra: ok(o) as unknown as Dados['obra'], progresso: ok(p) as Dados['progresso'], etapas: ok(e) as Etapa[], contratos: ok(c) as Dados['contratos'],
      aditivos: ok(a) as Dados['aditivos'], materiais: ok(m) as Dados['materiais'], pendencias: ok(pe) as Dados['pendencias'],
      arquivos: ok(ar) as Dados['arquivos'], fotos: fo.count ?? 0, fichas: fi.count ?? 0, fin,
    };
  }, [id, podeFinanceiro]);
  useEffect(() => { if (dados) { document.title = `Relatório ${dados.obra.codigo} · ROSAE`; setMelhoria(dados.obra.pontos_melhoria ?? ''); } }, [dados]);

  if (carregando && !dados) return <Carregando />;
  if (erro || !dados) return <Erro mensagem={erro ?? 'Obra não encontrada.'} />;
  const { obra, progresso, fin } = dados;
  const nomeServ = new Map(progresso.servicos.map((s) => [s.id, s.nome]));
  async function salvarMelhoria() {
    const r = await supabase.from('obra').update({ pontos_melhoria: melhoria?.trim() || null }).eq('id', obra.id);
    toast(r.error ? mensagemErro(r.error) : 'Pontos de melhoria salvos.');
  }
  const etapasComBase = dados.etapas.filter((e) => e.fim_base);
  const pagarAberto = fin?.parcelas.filter((p) => p.tipo === 'pagar' && doBanco(p.saldo) > 0) ?? [];
  const receberAberto = fin?.parcelas.filter((p) => p.tipo === 'receber' && doBanco(p.saldo) > 0) ?? [];

  return (
    <div className="pagina-impressao a4">
      <BarraRelatorio titulo="Relatório administrativo da obra (uso interno)" />
      <article className="doc-a4 relatorio">
        <Cabecalho tipo="Relatório administrativo · uso interno" obra={obra} />
        <section>
          <h2>Resumo</h2>
          <dl className="dl">
            <dt>Cliente</dt><dd>{obra.cliente?.nome ?? '—'}</dd>
            <dt>Situação</dt><dd>{STATUS_OBRA[obra.status as keyof typeof STATUS_OBRA] ?? obra.status}{obra.data_conclusao && ` · concluída em ${formatarData(obra.data_conclusao)}`}</dd>
            <dt>Período</dt><dd>{formatarData(obra.data_inicio) || 'início a definir'} a {formatarData(obra.data_conclusao ?? obra.data_previsao_fim) || 'término a definir'}</dd>
            <dt>Avanço físico</dt><dd>{Math.round(Number(progresso.executado))}% executado · {Math.round(Number(progresso.conferido))}% conferido · {progresso.concluidas} de {progresso.etapas} etapas{progresso.canceladas ? ` · ${progresso.canceladas} cancelada(s)` : ''}</dd>
          </dl>
        </section>

        <section>
          <h2>Contrato e aditivos</h2>
          {dados.contratos.length === 0 && dados.aditivos.length === 0 ? <p className="muted">Sem contrato registrado no sistema.</p> : (
            <table className="doc-tabela">
              <thead><tr><th>Documento</th><th>Modelo / título</th><th>Situação</th><th>Datas</th>{fin && <th className="num">Valor</th>}</tr></thead>
              <tbody>
                {dados.contratos.map((c) => <tr key={c.codigo}><td>{c.codigo}</td><td>{MODELO_CONTRATO[c.modelo]?.rotulo ?? c.modelo}</td><td>{c.estado}</td><td>{c.emitido_em && `emitido ${formatarData(c.emitido_em)}`}{c.assinado_em && ` · assinado ${formatarData(c.assinado_em)}`}</td>{fin && <td className="num">{R(c.valor_total)}</td>}</tr>)}
                {dados.aditivos.map((a) => <tr key={a.codigo}><td>{a.codigo}</td><td>{a.titulo}</td><td>{a.estado}</td><td>{a.aprovada_em && `aprovado ${formatarData(a.aprovada_em)}`}</td>{fin && <td className="num">—</td>}</tr>)}
              </tbody>
            </table>
          )}
          {fin && Number(fin.resumo?.aditivos ?? 0) > 0 && <p className="small">Aditivos aprovados somam {R(fin.resumo.aditivos)}.</p>}
        </section>

        <section>
          <h2>Escopo executado</h2>
          <table className="doc-tabela">
            <thead><tr><th>Serviço</th><th className="num">Executado</th><th className="num">Conferido</th></tr></thead>
            <tbody>{progresso.servicos.map((s) => <tr key={s.id}><td>{s.nome}</td><td className="num">{Math.round(Number(s.executado))}%</td><td className="num">{Math.round(Number(s.conferido))}%</td></tr>)}</tbody>
          </table>
        </section>

        <section>
          <h2>Planejado × realizado</h2>
          {etapasComBase.length === 0 ? <p className="muted small">Sem linha de base guardada: a comparação aparece depois de “Guardar linha de base” no cronograma.</p> : (
            <table className="doc-tabela">
              <thead><tr><th>Etapa</th><th>Situação</th><th>Fim planejado</th><th>Fim atual / real</th><th className="num">Desvio</th></tr></thead>
              <tbody>
                {etapasComBase.map((e) => {
                  const fim = e.fim_real ?? e.fim_previsto;
                  const desvio = fim && e.fim_base ? diasEntre(e.fim_base, fim) : null;
                  return <tr key={e.id}><td>{e.nome}<div className="small muted">{nomeServ.get(e.servico_id)}</div></td><td>{ESTADO_ETAPA[e.estado].rotulo}</td><td>{formatarData(e.fim_base)}</td><td>{formatarData(fim)}{e.fim_real ? ' (real)' : ''}</td>
                    <td className={`num ${desvio && desvio > 0 ? 'desfavoravel' : ''}`}>{desvio === null ? '—' : desvio === 0 ? 'no prazo' : `${desvio > 0 ? '+' : ''}${desvio} dia(s)`}</td></tr>;
                })}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2>Compras e fornecedores</h2>
          {dados.materiais.length === 0 ? <p className="muted small">Sem materiais registrados.</p> : (
            <table className="doc-tabela">
              <thead><tr><th>Material</th><th>Compra</th><th>Fornecedor</th><th className="num">Comprado</th><th className="num">Entregue</th><th>Situação</th></tr></thead>
              <tbody>{dados.materiais.map((m) => <tr key={m.id}><td>{m.descricao}</td><td>{m.responsavel_compra === 'rosae' ? 'ROSAE' : m.responsavel_compra === 'cliente' ? 'Cliente' : 'Terceiro'}</td><td>{m.fornecedor_nome ?? '—'}</td>
                <td className="num">{Number(m.comprado).toLocaleString('pt-BR')} {m.unidade}</td><td className="num">{Number(m.entregue).toLocaleString('pt-BR')} {m.unidade}</td><td>{SITUACAO_MATERIAL[m.situacao]?.rotulo ?? m.situacao}</td></tr>)}</tbody>
            </table>
          )}
        </section>

        {fin && (
          <>
            <section>
              <h2>Mão de obra (parceiros)</h2>
              {fin.contratacoes.length === 0 ? <p className="muted small">Sem contratações.</p> : (
                <table className="doc-tabela">
                  <thead><tr><th>Parceiro</th><th>Serviço</th><th>Situação</th><th className="num">Contratado</th><th className="num">Pago</th><th className="num">A pagar</th></tr></thead>
                  <tbody>{fin.contratacoes.map((c) => <tr key={c.id}><td>{c.pessoa_nome}</td><td>{c.servico_nome ?? 'Obra em geral'}</td><td>{c.estado}</td><td className="num">{R(c.valor_total)}</td><td className="num">{R(c.pago)}</td><td className="num">{R(c.saldo_a_pagar)}</td></tr>)}</tbody>
                </table>
              )}
            </section>
            <section>
              <h2>Entradas e saídas</h2>
              <dl className="dl">
                <dt>Contratado (com aditivos)</dt><dd>{R(Number(fin.resumo.valor_contratado ?? 0) + Number(fin.resumo.aditivos ?? 0))}</dd>
                <dt>Recebido</dt><dd>{R(fin.resumo.recebido)}</dd>
                <dt>Custos lançados</dt><dd>{R(fin.resumo.custo_lancado)}</dd>
                <dt>Custos pagos</dt><dd>{R(fin.resumo.pago)}</dd>
                <dt>Saldo de caixa da obra</dt><dd>{R(fin.resumo.saldo_caixa)}</dd>
              </dl>
            </section>
            <section>
              <h2>Obrigações e recebíveis em aberto</h2>
              {pagarAberto.length + receberAberto.length === 0 ? <p className="muted small">Nada em aberto.</p> : (
                <table className="doc-tabela">
                  <thead><tr><th>Tipo</th><th>Lançamento</th><th>Vencimento</th><th>Situação</th><th className="num">Em aberto</th></tr></thead>
                  <tbody>{[...receberAberto, ...pagarAberto].map((p) => <tr key={p.id}><td>{p.tipo === 'receber' ? 'A receber' : 'A pagar'}</td><td>{p.codigo} · {p.descricao}{p.total_parcelas > 1 && ` (${p.numero}/${p.total_parcelas})`}</td><td>{formatarData(p.vencimento)}</td><td>{p.situacao}</td><td className="num">{R(p.saldo)}</td></tr>)}</tbody>
                </table>
              )}
              <p className="small muted">Obrigações de parceiros ainda não lançadas aparecem em “Mão de obra” (coluna A pagar).</p>
            </section>
            <section>
              <h2>Resultado por serviço</h2>
              <table className="doc-tabela">
                <thead><tr><th>Serviço</th><th className="num">Vendido</th><th className="num">Previsto</th><th className="num">Contratado</th><th className="num">Pago</th><th className="num">Custo estimado</th><th className="num">Diferença estimada</th></tr></thead>
                <tbody>{fin.resultado.servicos.map((s) => <tr key={s.servico_id ?? s.nome}><td>{s.nome ?? 'Sem serviço'}</td><td className="num">{R(s.vendido)}</td><td className="num">{R(s.previsto)}</td><td className="num">{R(s.contratado)}</td><td className="num">{R(s.pago)}</td><td className="num">{R(s.custo_estimado)}</td>
                  <td className={`num ${doBanco(s.diferenca_estimada) < 0 ? 'desfavoravel' : 'favoravel'}`}>{R(s.diferenca_estimada)}</td></tr>)}</tbody>
                <tfoot><tr><td><strong>Consolidado</strong></td><td className="num"><strong>{R(fin.resultado.vendido_obra)}</strong></td><td className="num">{R(fin.resultado.total.previsto)}</td><td className="num">{R(fin.resultado.total.contratado)}</td><td className="num">{R(fin.resultado.total.pago)}</td><td className="num">{R(fin.resultado.total.custo_estimado)}</td>
                  <td className="num"><strong>{R(fin.resultado.total.diferenca_estimada)}</strong></td></tr></tfoot>
              </table>
              <p className="small muted">Diferença estimada = vendido − custo estimado na conclusão, antes de tributos e despesas da empresa. Não é lucro líquido.{fin.resultado.modelo === 'administracao' && ' Obra por administração: a economia de custos pertence ao cliente, conforme o contrato.'}</p>
            </section>
          </>
        )}

        <section>
          <h2>Pendências abertas</h2>
          {dados.pendencias.length === 0 ? <p className="muted small">Nenhuma.</p> : <ul>{dados.pendencias.map((p) => <li key={p.id}>{p.titulo}{p.prazo && ` · até ${formatarData(p.prazo)}`} · responsável: {p.responsavel}</li>)}</ul>}
        </section>

        <section>
          <h2>Documentos vinculados</h2>
          <p className="small">{dados.contratos.length} contrato(s) · {dados.aditivos.length} aditivo(s) · {dados.fichas} ficha(s) liberada(s) · {dados.fotos} foto(s){dados.arquivos.length ? ` · ${dados.arquivos.length} arquivo(s)` : ''}</p>
          {dados.arquivos.length > 0 && <ul className="small">{dados.arquivos.map((a) => <li key={a.id}>{a.nome_original} ({a.natureza}) · {formatarData(a.criado_em)}</li>)}</ul>}
        </section>

        <section>
          <h2>Pontos de melhoria</h2>
          <div className="nao-imprimir stack">
            <textarea rows={4} value={melhoria ?? ''} onChange={(e) => setMelhoria(e.target.value)} aria-label="Pontos de melhoria" placeholder="O que aprender desta obra: prazos, orçamento, parceiros, comunicação…" />
            <button className="btn-secundario" onClick={salvarMelhoria} style={{ alignSelf: 'flex-start' }}>Salvar</button>
          </div>
          <p className="so-imprimir" style={{ whiteSpace: 'pre-wrap' }}>{melhoria || '—'}</p>
        </section>
        <footer className="doc-rodape small muted">Documento interno da ROSAE. Não enviar ao cliente: contém custos e resultados. Para o cliente, use o relatório do cliente.</footer>
      </article>
    </div>
  );
}

/** Relatório do cliente: mesmo conteúdo do portal, em A4. */
export function RelatorioCliente({ d, token }: { d: DadosPortal; token: string | null }) {
  useEffect(() => { document.title = `Acompanhamento ${d.obra.nome} · ROSAE`; }, [d]);
  const nomeServ = new Map(d.servicos.map((s) => [s.id, s.nome]));
  const fotos = d.fotos.slice(0, 12);
  return (
    <div className="pagina-impressao a4">
      <BarraRelatorio titulo={d.previa ? 'Relatório do cliente (prévia: igual ao que o cliente imprime)' : 'Relatório de acompanhamento'} />
      <article className="doc-a4 relatorio">
        <Cabecalho tipo="Relatório de acompanhamento" obra={d.obra} sub={`Situação em ${formatarData(hoje())}`} />
        <section>
          <h2>Andamento</h2>
          <dl className="dl">
            <dt>Avanço físico</dt><dd>{Math.round(Number(d.progresso.executado))}% executado · {Math.round(Number(d.progresso.conferido))}% conferido tecnicamente</dd>
            <dt>Etapas</dt><dd>{d.progresso.concluidas} de {d.progresso.etapas} concluídas</dd>
            <dt>Previsão de término</dt><dd>{formatarData(d.obra.data_previsao_fim) || 'a definir'}</dd>
            <dt>Última atualização</dt><dd>{formatarDataHora(d.ultima_atualizacao)}</dd>
          </dl>
          <p className="small muted">O percentual mede o serviço executado, pelo peso técnico de cada etapa. Compras e pagamentos não alteram esse número.</p>
        </section>
        {d.ambientes.length > 0 && (
          <section>
            <h2>Por ambiente</h2>
            <table className="doc-tabela"><tbody>{d.ambientes.map((a) => <tr key={a.id}><td>{a.nome}</td><td className="num">{Math.round(Number(a.executado))}%</td></tr>)}</tbody></table>
          </section>
        )}
        <section>
          <h2>Etapas</h2>
          <table className="doc-tabela">
            <thead><tr><th>Etapa</th><th>Situação</th><th>Previsto</th><th>Realizado</th></tr></thead>
            <tbody>{d.etapas.map((e) => <tr key={e.id} className={`fase-${faseEtapa(e)}`}><td>{e.nome}<div className="small muted">{nomeServ.get(e.servico_id)}</div></td><td>{ESTADO_PORTAL[e.estado].rotulo}</td>
              <td>{formatarData(e.inicio_previsto)}{e.fim_previsto && ` a ${formatarData(e.fim_previsto)}`}</td><td>{formatarData(e.inicio_real)}{e.fim_real && ` a ${formatarData(e.fim_real)}`}</td></tr>)}</tbody>
          </table>
        </section>
        {d.registros.length + d.pendencias.length > 0 && (
          <section>
            <h2>Atualizações e decisões</h2>
            {d.pendencias.filter((p) => p.estado === 'aberta').map((p) => <p key={p.id}><strong>Em aberto: {p.titulo}</strong>{p.prazo && ` · até ${formatarData(p.prazo)}`}{p.descricao && <><br />{p.descricao}</>}</p>)}
            {d.registros.map((r) => (
              <div key={r.id} className="relatorio-registro">
                <div className="small muted">{formatarData(r.data)} · {TIPO_REGISTRO_PORTAL[r.tipo]}</div>
                {r.titulo && <strong>{r.titulo}</strong>}
                {r.texto && <p style={{ margin: '2px 0 6px', whiteSpace: 'pre-wrap' }}>{r.texto}</p>}
              </div>
            ))}
          </section>
        )}
        {d.materiais.length > 0 && (
          <section>
            <h2>Materiais</h2>
            <table className="doc-tabela"><tbody>{d.materiais.map((m) => <tr key={m.id}><td>{m.descricao}{m.compra_cliente && !/cliente/i.test(m.descricao) && ' (compra do cliente)'}</td><td>{SITUACAO_MATERIAL_PORTAL[m.situacao]}</td></tr>)}</tbody></table>
          </section>
        )}
        {fotos.length > 0 && (
          <section>
            <h2>Fotos</h2>
            <div className="relatorio-fotos">
              {fotos.map((f) => <figure key={f.id}><ImagemPortal token={token} id={f.id} alt={f.legenda ?? 'Foto da obra'} /><figcaption>{formatarData(f.tirada_em)}{f.legenda && ` · ${f.legenda}`}</figcaption></figure>)}
            </div>
            {d.fotos.length > fotos.length && <p className="small muted">Mais {d.fotos.length - fotos.length} foto(s) no portal.</p>}
          </section>
        )}
        <footer className="doc-rodape small muted">{d.empresa?.nome} · {d.empresa?.responsavel}. Informações operacionais publicadas pela ROSAE. Valores e documentos comerciais seguem por e-mail.</footer>
      </article>
    </div>
  );
}

/** /c/relatorio: o cliente imprime o próprio acompanhamento. */
export function RelatorioClientePortal() {
  const token = lerToken();
  const [d, setD] = useState<DadosPortal | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return setErro('Abra pelo seu link pessoal.');
    supabase.rpc('portal_dados', { p_token: token }).then((r) => {
      if (r.error) return setErro(mensagemErro(r.error));
      const x = r.data as DadosPortal;
      if (x.erro) return setErro(x.erro);
      setD(x);
    });
  }, [token]);
  if (erro) return <Erro mensagem={erro} />;
  if (!d) return <Carregando />;
  return <RelatorioCliente d={d} token={token} />;
}

/** Escritório: o relatório do cliente exatamente como ele imprime. */
export function RelatorioClientePrevia() {
  const { id } = useParams();
  const { dados, erro, carregando } = useConsulta(async () => ok(await supabase.rpc('portal_previa', { p_obra: id })) as DadosPortal, [id]);
  if (carregando && !dados) return <Carregando />;
  if (erro || !dados) return <Erro mensagem={erro ?? 'Obra não encontrada.'} />;
  return <RelatorioCliente d={dados} token={null} />;
}
