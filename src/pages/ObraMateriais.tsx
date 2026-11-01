// Materiais da obra em quatro dimensões: necessidade, compra, entrega/local e pagamento.
// Pagamento aparece só para quem tem financeiro; material do cliente nunca vira despesa.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { Ajuda, Carregando, Dinheiro, Erro, Modal, Vazio, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import { BotaoExcluir } from '../components/Excluir';
import { doBanco } from '../core/dinheiro';
import { formatarData, hoje } from '../core/datas';
import { RESPONSAVEL_COMPRA, SITUACAO_MATERIAL, type Etapa, type Material, type MaterialEvento, type Pessoa } from '../lib/tipos';
import { LancamentoForm } from './Financeiro';

type Item = { id: string; nome: string };
const q = (v: unknown) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 }));
const TIPO_EVENTO: Record<MaterialEvento['tipo'], string> = { compra: 'Compra', compra_cancelada: 'Compra cancelada', entrega: 'Entrega na obra', devolucao: 'Devolução' };

export function Materiais({ obraId, servicos, ambientes, ehAdm, podeFinanceiro }: { obraId: string; servicos: Item[]; ambientes: Item[]; ehAdm: boolean; podeFinanceiro: boolean }) {
  const [filtro, setFiltro] = useState<'pendentes' | 'todos' | 'obra' | 'cliente'>('pendentes');
  const [editar, setEditar] = useState<Material | 'novo' | null>(null);
  const [abrir, setAbrir] = useState<Material | null>(null);
  const { dados, erro, carregando, recarregar } = useConsulta(async () => {
    const [m, a, e, p] = await Promise.all([
      supabase.from('v_material').select('*').eq('obra_id', obraId).order('necessario_em', { nullsFirst: false }).order('descricao'),
      supabase.rpc('alertas_materiais', { p_obra: obraId }),
      supabase.from('etapa').select('id, nome, servico_id, inicio_previsto').eq('obra_id', obraId).neq('estado', 'cancelado').order('ordem'),
      podeFinanceiro ? supabase.rpc('material_pagamentos', { p_obra: obraId }) : Promise.resolve({ data: [], error: null }),
    ]);
    const pag = new Map((ok(p) as { material_id: string; lancado: string; pago: string }[]).map((x) => [x.material_id, x]));
    return { materiais: ok(m) as Material[], alertas: ok(a) as { etapa_nome: string; inicio: string | null; material: string; situacao: string; material_id: string }[], etapas: ok(e) as Etapa[], pag };
  }, [obraId, podeFinanceiro]);

  if (carregando && !dados) return <Carregando />;
  const lista = (dados?.materiais ?? []).filter((m) =>
    filtro === 'todos' ? true : filtro === 'obra' ? m.situacao === 'na_obra' : filtro === 'cliente' ? m.responsavel_compra !== 'rosae' : !['na_obra', 'cancelado', 'substituido'].includes(m.situacao));
  return (
    <div className="stack">
      {(dados?.alertas.length ?? 0) > 0 && (
        <div className="aviso">
          <Icone nome="alerta" />
          <div>
            <b>Material faltando para etapa próxima ou em andamento</b>
            <ul className="lista-simples">
              {dados!.alertas.map((a) => (
                <li key={a.material_id + a.etapa_nome}>{a.material} · {SITUACAO_MATERIAL[a.situacao as keyof typeof SITUACAO_MATERIAL]?.rotulo.toLowerCase()} · para “{a.etapa_nome}”{a.inicio ? ` (${formatarData(a.inicio)})` : ''}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <div className="card">
        <div className="topo" style={{ marginBottom: 10 }}>
          <h2>Materiais <Ajuda>
            Necessidade (o que a obra precisa), compra (quanto foi comprado), entrega (quanto chegou e onde está) e pagamento (no financeiro) são separados: um item pode estar comprado, entregue em parte e ainda não pago.
            Materiais comprados pelo cliente aparecem aqui só para controle da obra; não viram despesa nem receita da ROSAE.
          </Ajuda></h2>
          <div className="row">
            <div className="segmentado">
              {([['pendentes', 'Pendentes'], ['obra', 'Na obra'], ['cliente', 'Do cliente/terceiro'], ['todos', 'Todos']] as const).map(([k, r]) => (
                <button key={k} className={filtro === k ? 'ativo' : ''} onClick={() => setFiltro(k)}>{r}</button>
              ))}
            </div>
            {ehAdm && <button className="btn-primario" onClick={() => setEditar('novo')}><Icone nome="mais" /> Material</button>}
          </div>
        </div>
        <Erro mensagem={erro} />
        {lista.length === 0 ? (
          <Vazio titulo={filtro === 'pendentes' ? 'Nada pendente' : 'Nenhum material aqui'}><p>Materiais sugeridos pela biblioteca chegam na conversão da proposta; você também pode adicionar.</p></Vazio>
        ) : (
          <div className="tabela-wrap">
            <table className="tabela">
              <thead><tr><th>Material</th><th>Compra</th><th className="right">Necessário</th><th className="right">Comprado</th><th className="right">Na obra</th><th>Situação</th>{podeFinanceiro && <th className="right">Pagamento</th>}</tr></thead>
              <tbody>
                {lista.map((m) => {
                  const p = dados!.pag.get(m.id);
                  return (
                    <tr key={m.id} className="clicavel" onClick={() => setAbrir(m)}>
                      <td><b>{m.descricao}</b>{m.especificacao && <span className="muted"> · {m.especificacao}</span>}
                        <div className="muted small">{[m.servico_nome, m.ambiente_nome, m.etapa_nome && `para ${m.etapa_nome}`].filter(Boolean).join(' · ')}{m.necessario_em ? ` · até ${formatarData(m.necessario_em)}` : ''}</div></td>
                      <td className="small">{RESPONSAVEL_COMPRA[m.responsavel_compra]}{m.fornecedor_nome ? <div className="muted">{m.fornecedor_nome}</div> : null}</td>
                      <td className="right num">{q(m.quantidade)} {m.unidade}</td>
                      <td className="right num">{m.responsavel_compra === 'rosae' ? q(m.comprado) : '—'}</td>
                      <td className="right num">{q(m.entregue)}{m.localizacao ? <div className="muted small">{m.localizacao}</div> : null}</td>
                      <td><span className={`selo ${SITUACAO_MATERIAL[m.situacao].classe}`}>{SITUACAO_MATERIAL[m.situacao].rotulo}</span></td>
                      {podeFinanceiro && <td className="right small">{p ? <>{doBanco(p.pago) >= doBanco(p.lancado) ? 'Pago' : <>Pago <Dinheiro valor={doBanco(p.pago)} /> de <Dinheiro valor={doBanco(p.lancado)} /></>}</> : m.responsavel_compra === 'rosae' && Number(m.comprado) > 0 ? <span className="alerta-texto">Sem conta lançada</span> : '—'}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editar && <MaterialForm obraId={obraId} m={editar === 'novo' ? null : editar} servicos={servicos} ambientes={ambientes} etapas={dados?.etapas ?? []} aoFechar={() => setEditar(null)} aoSalvar={() => { setEditar(null); setAbrir(null); recarregar(); }} />}
      {abrir && !editar && <MaterialDetalhe m={abrir} ehAdm={ehAdm} podeFinanceiro={podeFinanceiro} aoEditar={() => setEditar(abrir)} aoFechar={() => setAbrir(null)} aoMudar={() => { recarregar(); }} />}
    </div>
  );
}

function MaterialForm({ obraId, m, servicos, ambientes, etapas, aoFechar, aoSalvar }: { obraId: string; m: Material | null; servicos: Item[]; ambientes: Item[]; etapas: Etapa[]; aoFechar: () => void; aoSalvar: () => void }) {
  const toast = useToast();
  const pessoas = useConsulta(async () => ok(await supabase.from('pessoa').select('id, nome, eh_fornecedor').eq('arquivado', false).order('nome')) as Pessoa[], []);
  const [f, setF] = useState({
    descricao: m?.descricao ?? '', especificacao: m?.especificacao ?? '', unidade: m?.unidade ?? 'un', quantidade: m?.quantidade != null ? String(m.quantidade) : '',
    responsavel_compra: m?.responsavel_compra ?? 'rosae', fornecedor_id: m?.fornecedor_id ?? '', necessario_em: m?.necessario_em ?? '',
    servico_id: m?.servico_id ?? '', ambiente_id: m?.ambiente_id ?? '', etapa_id: m?.etapa_id ?? '', localizacao: m?.localizacao ?? '',
    observacoes: m?.observacoes ?? '', visivel_cliente: m?.visivel_cliente ?? true, estado: m?.estado ?? 'ativo', motivo: m?.motivo ?? '',
  });
  const [erro, setErro] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (f.estado !== 'ativo' && !f.motivo.trim()) return setErro('Informe o motivo do cancelamento ou da substituição.');
    const qtd = f.quantidade.trim() ? Number(f.quantidade.replace(',', '.')) : null;
    const reg = {
      obra_id: obraId, descricao: f.descricao.trim(), especificacao: f.especificacao.trim() || null, unidade: f.unidade.trim() || 'un', quantidade: qtd,
      responsavel_compra: f.responsavel_compra, fornecedor_id: f.fornecedor_id || null, necessario_em: f.necessario_em || null,
      servico_id: f.servico_id || null, ambiente_id: f.ambiente_id || null, etapa_id: f.etapa_id || null, localizacao: f.localizacao.trim() || null,
      observacoes: f.observacoes.trim() || null, visivel_cliente: f.visivel_cliente, estado: f.estado, motivo: f.motivo.trim() || null,
    };
    const r = m ? await supabase.from('material').update(reg).eq('id', m.id) : await supabase.from('material').insert(reg);
    if (r.error) return setErro(mensagemErro(r.error));
    toast(m ? 'Material atualizado.' : 'Material incluído.');
    aoSalvar();
  }
  const etapasServ = etapas.filter((e) => !f.servico_id || e.servico_id === f.servico_id);
  return (
    <Modal titulo={m ? m.descricao : 'Novo material'} aoFechar={aoFechar} largo
      rodape={<>{m && <BotaoExcluir tabela="material" id={m.id} nome={m.descricao} aoExcluir={aoSalvar} classe="btn-link perigo" />}<span style={{ flex: 1 }} /><button type="button" className="btn-secundario" onClick={aoFechar}>Cancelar</button><button className="btn-primario" form="form-mat">Salvar</button></>}>
      <form id="form-mat" className="stack" onSubmit={salvar}>
        <div className="grid grid-2">
          <label className="campo">Material<input value={f.descricao} onChange={(e) => set('descricao', e.target.value)} required placeholder="Ex.: Porcelanato 60×60" /></label>
          <label className="campo">Especificação<input value={f.especificacao} onChange={(e) => set('especificacao', e.target.value)} placeholder="Marca, linha, cor, classe…" /></label>
        </div>
        <div className="grid grid-3">
          <label className="campo">Quantidade<input inputMode="decimal" value={f.quantidade} onChange={(e) => set('quantidade', e.target.value)} placeholder="a definir" /></label>
          <label className="campo">Unidade<input value={f.unidade} onChange={(e) => set('unidade', e.target.value)} /></label>
          <label className="campo">Necessário até<input type="date" value={f.necessario_em} onChange={(e) => set('necessario_em', e.target.value)} /></label>
        </div>
        <div className="grid grid-2">
          <label className="campo">Quem compra <Ajuda>ROSAE: entra no custo da obra quando lançado no financeiro. Cliente ou terceiro: só controle de obra, sem valor.</Ajuda>
            <select value={f.responsavel_compra} onChange={(e) => set('responsavel_compra', e.target.value as Material['responsavel_compra'])}>
              {Object.entries(RESPONSAVEL_COMPRA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="campo">Fornecedor
            <select value={f.fornecedor_id} onChange={(e) => set('fornecedor_id', e.target.value)}>
              <option value="">—</option>{(pessoas.dados ?? []).filter((p) => p.eh_fornecedor || p.id === f.fornecedor_id).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </label>
        </div>
        <div className="grid grid-3">
          <label className="campo">Serviço<select value={f.servico_id} onChange={(e) => { set('servico_id', e.target.value); set('etapa_id', ''); }}><option value="">—</option>{servicos.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></label>
          <label className="campo">Ambiente<select value={f.ambiente_id} onChange={(e) => set('ambiente_id', e.target.value)}><option value="">—</option>{ambientes.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></label>
          <label className="campo">Para a etapa <Ajuda>Ligando a uma etapa, o sistema avisa quando a etapa estiver perto e o material ainda não estiver na obra.</Ajuda>
            <select value={f.etapa_id} onChange={(e) => set('etapa_id', e.target.value)}><option value="">—</option>{etapasServ.map((s) => <option key={s.id} value={s.id}>{s.nome}{s.inicio_previsto ? ` (${formatarData(s.inicio_previsto)})` : ''}</option>)}</select>
          </label>
        </div>
        <label className="campo">Onde está<input value={f.localizacao} onChange={(e) => set('localizacao', e.target.value)} placeholder="Ex.: depósito da obra, loja (retirar)" /></label>
        <label className="campo">Observações<textarea rows={2} value={f.observacoes} onChange={(e) => set('observacoes', e.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={f.visivel_cliente} onChange={(e) => set('visivel_cliente', e.target.checked)} /> Pode aparecer para o cliente como “previsto / aguardando entrega / disponível” (sem valores)</label>
        {m && (
          <div className="grid grid-2">
            <label className="campo">Situação do item
              <select value={f.estado} onChange={(e) => set('estado', e.target.value as Material['estado'])}><option value="ativo">Ativo</option><option value="cancelado">Cancelado</option><option value="substituido">Substituído</option></select>
            </label>
            {f.estado !== 'ativo' && <label className="campo">Motivo<input value={f.motivo} onChange={(e) => set('motivo', e.target.value)} required /></label>}
          </div>
        )}
        <Erro mensagem={erro} />
      </form>
    </Modal>
  );
}

function MaterialDetalhe({ m, ehAdm, podeFinanceiro, aoEditar, aoFechar, aoMudar }: { m: Material; ehAdm: boolean; podeFinanceiro: boolean; aoEditar: () => void; aoFechar: () => void; aoMudar: () => void }) {
  const toast = useToast();
  const [tipo, setTipo] = useState<MaterialEvento['tipo'] | null>(null);
  const [f, setF] = useState({ quantidade: '', data: hoje(), local: m.localizacao ?? '', documento: '', observacoes: '', conta: '' });
  const [novaConta, setNovaConta] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const ev = useConsulta(async () => {
    const [e, l] = await Promise.all([
      supabase.from('material_evento').select('*').eq('material_id', m.id).order('data').order('criado_em'),
      podeFinanceiro && m.responsavel_compra === 'rosae'
        ? supabase.from('lancamento').select('id, codigo, descricao, valor_total').eq('obra_id', m.obra_id).eq('tipo', 'pagar').eq('cancelado', false).order('criado_em', { ascending: false }).limit(30)
        : Promise.resolve({ data: [], error: null }),
    ]);
    return { eventos: ok(e) as MaterialEvento[], contas: ok(l) as { id: string; codigo: string; descricao: string; valor_total: string }[] };
  }, [m.id]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const [atual, setAtual] = useState(m);

  async function gravar(lancamentoId?: string) {
    setErro(null);
    const qtd = Number(f.quantidade.replace(',', '.'));
    if (!(qtd > 0)) return setErro('Informe a quantidade.');
    const r = await supabase.from('material_evento').insert({
      material_id: m.id, tipo, quantidade: qtd, data: f.data, local: f.local.trim() || null, documento: f.documento.trim() || null,
      observacoes: f.observacoes.trim() || null, lancamento_id: lancamentoId ?? (f.conta || null),
    });
    if (r.error) return setErro(mensagemErro(r.error));
    toast(`${TIPO_EVENTO[tipo!]} registrada.`);
    setTipo(null);
    setF((x) => ({ ...x, quantidade: '', documento: '', observacoes: '', conta: '' }));
    const nv = await supabase.from('v_material').select('*').eq('id', m.id).single();
    if (!nv.error) setAtual(nv.data as Material);
    ev.recarregar();
    aoMudar();
  }

  const falta = atual.quantidade != null ? Math.max(0, Number(atual.quantidade) - Number(atual.entregue)) : null;
  return (
    <Modal titulo={atual.descricao} aoFechar={aoFechar} largo
      rodape={<>{ehAdm && <button className="btn-secundario" onClick={aoEditar}><Icone nome="editar" /> Editar</button>}<span style={{ flex: 1 }} /><button className="btn-secundario" onClick={aoFechar}>Fechar</button></>}>
      <div className="stack">
        <div className="grid grid-kpi">
          <div className="kpi"><div className="rotulo">Necessário</div><div className="valor num">{q(atual.quantidade)} <small>{atual.unidade}</small></div><div className="det">{RESPONSAVEL_COMPRA[atual.responsavel_compra]} compra</div></div>
          <div className="kpi"><div className="rotulo">Comprado</div><div className="valor num">{atual.responsavel_compra === 'rosae' ? q(atual.comprado) : '—'}</div></div>
          <div className="kpi"><div className="rotulo">Na obra</div><div className="valor num">{q(atual.entregue)}</div><div className="det">{falta ? `Faltam ${q(falta)} ${atual.unidade}` : atual.localizacao ?? ''}</div></div>
          <div className="kpi"><div className="rotulo">Situação</div><div className="valor" style={{ fontSize: '1rem' }}><span className={`selo ${SITUACAO_MATERIAL[atual.situacao].classe}`}>{SITUACAO_MATERIAL[atual.situacao].rotulo}</span></div></div>
        </div>
        {atual.estado === 'ativo' && (
          <div className="row">
            {ehAdm && atual.responsavel_compra === 'rosae' && <button className="btn-secundario" onClick={() => setTipo('compra')}>Registrar compra</button>}
            <button className="btn-primario" onClick={() => setTipo('entrega')}>Registrar entrega na obra</button>
            {Number(atual.entregue) > 0 && <button className="btn-secundario" onClick={() => setTipo('devolucao')}>Devolução</button>}
            {ehAdm && Number(atual.comprado) > 0 && <button className="btn-link" onClick={() => setTipo('compra_cancelada')}>Cancelar parte da compra</button>}
          </div>
        )}
        {tipo && (
          <form className="stack card destaque-card" onSubmit={(e) => { e.preventDefault(); if (tipo === 'compra' && f.conta === 'nova') setNovaConta(true); else gravar(); }}>
            <b>{TIPO_EVENTO[tipo]}</b>
            <div className="grid grid-3">
              <label className="campo">Quantidade ({atual.unidade})<input inputMode="decimal" value={f.quantidade} onChange={(e) => set('quantidade', e.target.value)} required autoFocus /></label>
              <label className="campo">Data<input type="date" value={f.data} onChange={(e) => set('data', e.target.value)} /></label>
              {tipo === 'entrega' ? <label className="campo">Onde ficou<input value={f.local} onChange={(e) => set('local', e.target.value)} /></label>
                : <label className="campo">Documento<input value={f.documento} onChange={(e) => set('documento', e.target.value)} placeholder="Pedido, NF, romaneio" /></label>}
            </div>
            {tipo === 'compra' && podeFinanceiro && (
              <label className="campo">Conta a pagar <Ajuda>A despesa existe uma vez só, no financeiro. Ligue a compra à conta a pagar (nova ou já lançada); a nota e o comprovante ficam anexados nela.</Ajuda>
                <select value={f.conta} onChange={(e) => set('conta', e.target.value)}>
                  <option value="">Lançar depois</option>
                  <option value="nova">Lançar agora (abre o formulário)</option>
                  {(ev.dados?.contas ?? []).map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.descricao}</option>)}
                </select>
              </label>
            )}
            {tipo === 'compra' && !podeFinanceiro && <p className="muted small" style={{ margin: 0 }}>A conta a pagar é lançada por quem tem acesso ao financeiro.</p>}
            <label className="campo">Observação<input value={f.observacoes} onChange={(e) => set('observacoes', e.target.value)} /></label>
            <Erro mensagem={erro} />
            <div className="row"><button className="btn-primario">Registrar</button><button type="button" className="btn-secundario" onClick={() => setTipo(null)}>Cancelar</button></div>
          </form>
        )}
        <div>
          <h3 className="sub-servico">Histórico</h3>
          {ev.carregando && !ev.dados ? <Carregando /> : (ev.dados?.eventos.length ?? 0) === 0 ? <p className="muted small">Nenhuma compra ou entrega registrada.</p> : (
            <ul className="linha-tempo">
              {ev.dados!.eventos.map((x) => (
                <li key={x.id} className={x.tipo === 'entrega' ? 'aceita' : x.tipo === 'compra' ? '' : 'ajuste_pedido'}>
                  <div className="small muted">{formatarData(x.data)}</div>
                  <div>{TIPO_EVENTO[x.tipo]}: {q(x.quantidade)} {atual.unidade}{x.local ? ` · ${x.local}` : ''}{x.documento ? ` · ${x.documento}` : ''}{x.observacoes ? ` · ${x.observacoes}` : ''}
                    {x.lancamento_id && podeFinanceiro && <> · <Link to={`/financeiro/${x.lancamento_id}`}>conta a pagar</Link></>}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {novaConta && (
        <LancamentoForm tipo="pagar" padrao={{ escopo: 'obra', obra_id: atual.obra_id, servico_id: atual.servico_id ?? '', descricao: `${atual.descricao}${atual.especificacao ? ` (${atual.especificacao})` : ''}`, pessoa_id: atual.fornecedor_id ?? '' }}
          aoFechar={() => setNovaConta(false)} aoSalvar={(id) => { setNovaConta(false); gravar(id); }} />
      )}
    </Modal>
  );
}
