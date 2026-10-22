// Financeiro detalhado da obra: resultado por serviço, orçamento-base e parceiros contratados.
import { useState } from 'react';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { Ajuda, CampoValor, Carregando, Erro, Modal, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import { doBanco, formatar, paraBanco, type Centavos } from '../core/dinheiro';
import { formatarData, hoje } from '../core/datas';
import type { Pessoa } from '../lib/tipos';
import { LancamentoForm } from './Financeiro';

type Linha = Record<string, number | string | null> & { servico_id: string | null; nome: string };
type Resultado = { modelo: string | null; vendido_obra: number; servicos: Linha[]; total: Record<string, number> };

export type Contratacao = {
  id: string; codigo: string; obra_id: string; servico_id: string | null; pessoa_id: string; descricao: string; modalidade: string; natureza: string;
  quantidade: string | null; valor_unitario: string | null; valor_contratado: string; data_contratacao: string; prazo_inicio: string | null; prazo_fim: string | null;
  condicoes_pagamento: string | null; estado: 'ativa' | 'concluida' | 'cancelada'; motivo_cancelamento: string | null; concluida_em: string | null;
  avaliacao_qualidade: number | null; avaliacao_prazo: number | null; avaliacao_texto: string | null; observacoes: string | null;
  pessoa_nome: string; servico_nome: string | null; obra_codigo: string; obra_nome: string;
  aditivos: string; valor_total: string; lancado: string; pago: string; compromisso: string; saldo_a_pagar: string; a_lancar: string;
};

export const MODALIDADE: Record<string, string> = { empreitada: 'Empreitada (valor fechado)', diaria: 'Diárias', medicao: 'Por medição', outro: 'Outro' };
const ESTADO_CT: Record<string, { rotulo: string; classe: string }> = {
  ativa: { rotulo: 'Ativa', classe: 'alerta' }, concluida: { rotulo: 'Concluída', classe: 'ok' }, cancelada: { rotulo: 'Cancelada', classe: 'neutro' },
};

const n = (v: unknown) => doBanco((v ?? 0) as string);

function Variacao({ valor, inverter }: { valor: Centavos; inverter?: boolean }) {
  const fav = inverter ? valor < 0 : valor > 0;
  if (valor === 0) return <span className="num">{formatar(0)}</span>;
  return (
    <span className="num" style={{ color: fav ? 'var(--favoravel)' : 'var(--desfavoravel)' }}>
      {fav ? '▲' : '▼'} {formatar(valor)}<span className="sr-only">{fav ? ' (favorável)' : ' (desfavorável)'}</span>
    </span>
  );
}

export function ResultadoServicos({ obraId, servicos, aoMudar }: { obraId: string; servicos: { id: string; nome: string }[]; aoMudar?: () => void }) {
  const [orcamento, setOrcamento] = useState(false);
  const [detalhe, setDetalhe] = useState<Linha | null>(null);
  const { dados, erro, carregando, recarregar } = useConsulta(async () => ok(await supabase.rpc('resultado_obra_servicos', { p_obra: obraId })) as Resultado, [obraId]);
  if (carregando && !dados) return <Carregando />;
  if (erro) return <Erro mensagem={erro} />;
  if (!dados) return null;
  const t = dados.total;
  const adm = dados.modelo === 'administracao';
  const naoDistribuido = n(dados.vendido_obra) - n(t.vendido_servicos);
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-titulo">
        <h2>Resultado por serviço <Ajuda>Vendido vem do orçamento-base de cada serviço. Contratado = parceiros contratados + compras lançadas. Custo estimado na conclusão = contratado + o que ainda falta contratar do previsto. A diferença estimada é antes de tributos e despesas da empresa: não é lucro líquido.</Ajuda></h2>
        <button className="btn-secundario" onClick={() => setOrcamento(true)}><Icone nome="editar" /> Orçamento-base</button>
      </div>
      {adm && (
        <div className="aviso info" style={{ marginBottom: 10 }}>
          <span>Obra por <b>administração</b>: custos são reembolsáveis pelo cliente e a economia em material pertence a ele, conforme o contrato. O resultado da ROSAE é a remuneração combinada, não a diferença de custos.</span>
        </div>
      )}
      <div className="grid grid-kpi" style={{ marginBottom: 12 }}>
        <div className="kpi"><div className="rotulo">Vendido (contrato)</div><div className="valor num">{formatar(n(dados.vendido_obra))}</div>{naoDistribuido !== 0 && <div className="det">{formatar(naoDistribuido)} ainda não distribuído entre serviços</div>}</div>
        <div className="kpi"><div className="rotulo">Custo estimado na conclusão</div><div className="valor num">{formatar(n(t.custo_estimado))}</div><div className="det">Contratado {formatar(n(t.contratado))} + a contratar {formatar(n(t.a_contratar))}</div></div>
        <div className="kpi destaque"><div className="rotulo">{adm ? 'Diferença (referência)' : 'Diferença estimada'}</div><div className="valor num">{formatar(n(t.diferenca_estimada))}</div><div className="det">Antes de tributos e despesas da empresa</div></div>
        <div className="kpi"><div className="rotulo">Obrigações a pagar</div><div className="valor num">{formatar(n(t.a_pagar))}</div><div className="det">Contratado e ainda não pago</div></div>
        <div className="kpi"><div className="rotulo">Saldo de caixa</div><div className="valor num">{formatar(n(t.saldo_caixa))}</div><div className="det">Recebido {formatar(n(t.recebido))} − pago {formatar(n(t.pago))}</div></div>
      </div>
      <div className="tabela-wrap">
        <table className="tabela">
          <thead>
            <tr><th>Serviço</th><th className="right">Vendido</th><th className="right">Previsto</th><th className="right">Contratado</th><th className="right">Pago</th><th className="right">A pagar</th><th className="right">Custo estimado</th><th className="right">Previsto × estimado</th><th className="right">Diferença estimada</th></tr>
          </thead>
          <tbody>
            {dados.servicos.map((s) => (
              <tr key={s.servico_id ?? 'sem'} className="clicavel" onClick={() => setDetalhe(s)}>
                <td>{s.nome}</td>
                <td className="right num">{formatar(n(s.vendido))}</td>
                <td className="right num">{formatar(n(s.previsto))}</td>
                <td className="right num">{formatar(n(s.contratado))}</td>
                <td className="right num">{formatar(n(s.pago))}</td>
                <td className="right num">{formatar(n(s.a_pagar))}</td>
                <td className="right num">{formatar(n(s.custo_estimado))}</td>
                <td className="right">{n(s.previsto) > 0 ? <Variacao valor={n(s.variacao_previsto)} /> : <span className="muted small">sem previsão</span>}</td>
                <td className="right"><Variacao valor={n(s.diferenca_estimada)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">▲ verde = favorável · ▼ vermelho = desfavorável. Toque numa linha para ver a composição.</p>
      {detalhe && (
        <Modal titulo={detalhe.nome} aoFechar={() => setDetalhe(null)}>
          <dl className="dl">
            <dt>Vendido</dt><dd>{formatar(n(detalhe.vendido))}</dd>
            <dt>Previsto</dt><dd>{formatar(n(detalhe.previsto))} <span className="muted small">(material {formatar(n(detalhe.previsto_material))} · mão de obra {formatar(n(detalhe.previsto_mao_obra))} · outros {formatar(n(detalhe.previsto_outros))})</span></dd>
            <dt>Lançado</dt><dd>{formatar(n(detalhe.lancado))} <span className="muted small">(material {formatar(n(detalhe.lancado_material))} · mão de obra {formatar(n(detalhe.lancado_mao_obra))} · outros {formatar(n(detalhe.lancado_outros))})</span></dd>
            <dt>Contratado</dt><dd>{formatar(n(detalhe.contratado))}</dd>
            <dt>Pago</dt><dd>{formatar(n(detalhe.pago))}</dd>
            <dt>A pagar</dt><dd>{formatar(n(detalhe.a_pagar))}</dd>
            <dt>Ainda a contratar</dt><dd>{formatar(n(detalhe.a_contratar))}</dd>
            <dt>Custo estimado</dt><dd>{formatar(n(detalhe.custo_estimado))}</dd>
            <dt>Diferença estimada</dt><dd><Variacao valor={n(detalhe.diferenca_estimada)} /></dd>
            <dt>Recebido</dt><dd>{formatar(n(detalhe.recebido))} <span className="muted small">de {formatar(n(detalhe.faturado))} lançado a receber</span></dd>
          </dl>
          <p className="muted small">Serviço ainda não pago não é economia: continua em “a pagar”. A diferença estimada não inclui tributos nem despesas da empresa.</p>
        </Modal>
      )}
      {orcamento && <OrcamentoBase servicos={servicos} aoFechar={() => setOrcamento(false)} aoSalvar={() => { setOrcamento(false); recarregar(); aoMudar?.(); }} />}
    </div>
  );
}

type Orc = { servico_id: string; valor_vendido: Centavos | null; previsto_material: Centavos | null; previsto_mao_obra: Centavos | null; previsto_outros: Centavos | null };

function OrcamentoBase({ servicos, aoFechar, aoSalvar }: { servicos: { id: string; nome: string }[]; aoFechar: () => void; aoSalvar: () => void }) {
  const toast = useToast();
  const [linhas, setLinhas] = useState<Orc[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useConsulta(async () => {
    const r = ok(await supabase.from('servico_financeiro').select('*').in('servico_id', servicos.map((s) => s.id))) as Record<string, string>[];
    setLinhas(servicos.map((s) => {
      const f = r.find((x) => x.servico_id === s.id);
      return { servico_id: s.id, valor_vendido: f ? doBanco(f.valor_vendido) : null, previsto_material: f ? doBanco(f.previsto_material) : null, previsto_mao_obra: f ? doBanco(f.previsto_mao_obra) : null, previsto_outros: f ? doBanco(f.previsto_outros) : null };
    }));
    return r;
  }, [servicos.map((s) => s.id).join()]);
  const set = (i: number, k: keyof Orc, v: Centavos | null) => setLinhas((x) => x!.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  async function salvar() {
    const { error } = await supabase.from('servico_financeiro').upsert(linhas!.map((l) => ({
      servico_id: l.servico_id, valor_vendido: paraBanco(l.valor_vendido ?? 0), previsto_material: paraBanco(l.previsto_material ?? 0),
      previsto_mao_obra: paraBanco(l.previsto_mao_obra ?? 0), previsto_outros: paraBanco(l.previsto_outros ?? 0),
    })));
    if (error) return setErro(mensagemErro(error));
    toast('Orçamento-base salvo.');
    aoSalvar();
  }
  return (
    <Modal titulo="Orçamento-base por serviço" aoFechar={aoFechar} largo
      rodape={<><button className="btn-secundario" onClick={aoFechar}>Cancelar</button><button className="btn-primario" onClick={salvar} disabled={!linhas}>Salvar</button></>}>
      {servicos.length === 0 ? <p>Cadastre os serviços da obra primeiro (em “Ambientes e serviços”).</p> : !linhas ? <Carregando /> : (
        <div className="stack">
          <p className="muted small" style={{ margin: 0 }}>Quanto cada serviço vale na venda e quanto você prevê gastar. Isso permite comparar previsto, contratado e realizado.</p>
          {servicos.map((s, i) => (
            <div key={s.id} className="bloco-ambiente">
              <b>{s.nome}</b>
              <div className="linha-valores">
                <label className="campo">Vendido<CampoValor valor={linhas[i].valor_vendido} aoMudar={(v) => set(i, 'valor_vendido', v)} /></label>
                <label className="campo">Material previsto<CampoValor valor={linhas[i].previsto_material} aoMudar={(v) => set(i, 'previsto_material', v)} /></label>
                <label className="campo">Mão de obra prevista<CampoValor valor={linhas[i].previsto_mao_obra} aoMudar={(v) => set(i, 'previsto_mao_obra', v)} /></label>
                <label className="campo">Outros previstos<CampoValor valor={linhas[i].previsto_outros} aoMudar={(v) => set(i, 'previsto_outros', v)} /></label>
              </div>
            </div>
          ))}
          <Erro mensagem={erro} />
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Parceiros contratados
// ---------------------------------------------------------------------
export function Contratacoes({ obraId, servicos, aoMudar }: { obraId: string; servicos: { id: string; nome: string }[]; aoMudar: () => void }) {
  const [nova, setNova] = useState(false);
  const [aberta, setAberta] = useState<Contratacao | null>(null);
  const { dados, erro, recarregar } = useConsulta(async () => ok(await supabase.from('v_contratacao').select('*').eq('obra_id', obraId).order('data_contratacao', { ascending: false })) as Contratacao[], [obraId]);
  const mudou = () => { recarregar(); aoMudar(); };
  const total = (k: keyof Contratacao) => (dados ?? []).filter((c) => c.estado !== 'cancelada').reduce((s, c) => s + n(c[k]), 0);
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-titulo">
        <h2>Parceiros contratados <Ajuda>Registre o que foi combinado com cada parceiro (empreitada ou diárias). Os pagamentos lançados por aqui abatem o saldo. O que foi combinado e ainda não foi pago continua como obrigação.</Ajuda></h2>
        <button className="btn-secundario" onClick={() => setNova(true)}><Icone nome="mais" /> Contratar parceiro</button>
      </div>
      <Erro mensagem={erro} />
      {!dados?.length ? <p className="muted">Nenhum parceiro contratado nesta obra.</p> : (
        <>
          <div className="tabela-wrap">
            <table className="tabela">
              <thead><tr><th>Parceiro</th><th>Serviço</th><th>Situação</th><th className="right">Combinado</th><th className="right">Pago</th><th className="right">Saldo</th></tr></thead>
              <tbody>
                {dados.map((c) => (
                  <tr key={c.id} className="clicavel" onClick={() => setAberta(c)}>
                    <td><b>{c.pessoa_nome}</b><div className="muted small">{c.codigo} · {c.descricao}</div></td>
                    <td>{c.servico_nome ?? <span className="muted">Obra inteira</span>}</td>
                    <td><span className={`selo ${ESTADO_CT[c.estado].classe}`}>{ESTADO_CT[c.estado].rotulo}</span></td>
                    <td className="right num">{formatar(n(c.valor_total))}{n(c.aditivos) !== 0 && <div className="muted small">inclui adicionais {formatar(n(c.aditivos))}</div>}</td>
                    <td className="right num">{formatar(n(c.pago))}</td>
                    <td className="right num">{formatar(n(c.saldo_a_pagar))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Ativas e concluídas: combinado {formatar(total('valor_total'))} · pago {formatar(total('pago'))} · saldo {formatar(total('saldo_a_pagar'))}</p>
        </>
      )}
      {nova && <ContratacaoForm obraId={obraId} servicos={servicos} aoFechar={() => setNova(false)} aoSalvar={() => { setNova(false); mudou(); }} />}
      {aberta && <ContratacaoDetalhe c={aberta} servicos={servicos} aoFechar={() => setAberta(null)} aoMudar={() => { setAberta(null); mudou(); }} />}
    </div>
  );
}

function ContratacaoForm({ obraId, servicos, c, aoFechar, aoSalvar }: { obraId: string; servicos: { id: string; nome: string }[]; c?: Contratacao; aoFechar: () => void; aoSalvar: () => void }) {
  const toast = useToast();
  const pessoas = useConsulta(async () => ok(await supabase.from('pessoa').select('id, nome, especialidade, eh_prestador, eh_fornecedor').eq('arquivado', false).order('nome')) as Pessoa[], []);
  const [f, setF] = useState({
    pessoa_id: c?.pessoa_id ?? '', servico_id: c?.servico_id ?? '', descricao: c?.descricao ?? '', modalidade: c?.modalidade ?? 'empreitada',
    natureza: c?.natureza ?? 'mao_obra', quantidade: c?.quantidade ?? '', data_contratacao: c?.data_contratacao ?? hoje(),
    prazo_inicio: c?.prazo_inicio ?? '', prazo_fim: c?.prazo_fim ?? '', condicoes_pagamento: c?.condicoes_pagamento ?? '', observacoes: c?.observacoes ?? '',
  });
  const [valor, setValor] = useState<Centavos | null>(c ? n(c.valor_contratado) : null);
  const [unit, setUnit] = useState<Centavos | null>(c?.valor_unitario ? n(c.valor_unitario) : null);
  const [erro, setErro] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const qtd = Number(String(f.quantidade).replace(',', '.')) || 0;
  const valorCalc = f.modalidade === 'diaria' && unit !== null && qtd > 0 ? Math.round(unit * qtd) : valor;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.pessoa_id) return setErro('Escolha o parceiro.');
    if (valorCalc === null) return setErro('Informe o valor combinado.');
    const reg = {
      obra_id: obraId, pessoa_id: f.pessoa_id, servico_id: f.servico_id || null, descricao: f.descricao.trim(), modalidade: f.modalidade, natureza: f.natureza,
      quantidade: f.modalidade === 'diaria' && qtd > 0 ? qtd : null, valor_unitario: f.modalidade === 'diaria' && unit !== null ? paraBanco(unit) : null,
      valor_contratado: paraBanco(valorCalc), data_contratacao: f.data_contratacao, prazo_inicio: f.prazo_inicio || null, prazo_fim: f.prazo_fim || null,
      condicoes_pagamento: f.condicoes_pagamento.trim() || null, observacoes: f.observacoes.trim() || null,
    };
    const r = c ? await supabase.from('contratacao').update(reg).eq('id', c.id) : await supabase.from('contratacao').insert(reg);
    if (r.error) return setErro(mensagemErro(r.error));
    toast(c ? 'Contratação atualizada.' : 'Parceiro contratado.');
    aoSalvar();
  }
  const lista = (pessoas.dados ?? []).filter((p) => p.eh_prestador || p.eh_fornecedor || p.id === f.pessoa_id);
  return (
    <Modal titulo={c ? `Editar ${c.codigo}` : 'Contratar parceiro'} aoFechar={aoFechar}
      rodape={<><button type="button" className="btn-secundario" onClick={aoFechar}>Cancelar</button><button className="btn-primario" form="form-ct">Salvar</button></>}>
      <form id="form-ct" className="stack" onSubmit={salvar}>
        <div className="grid grid-2">
          <label className="campo">Parceiro
            <select value={f.pessoa_id} onChange={(e) => set('pessoa_id', e.target.value)} required>
              <option value="">Escolha…</option>
              {lista.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.especialidade ? ` · ${p.especialidade}` : ''}</option>)}
            </select>
            {lista.length === 0 && <span className="dica">Cadastre o parceiro em Cadastros (papel “Parceiro/prestador”).</span>}
          </label>
          <label className="campo">Serviço
            <select value={f.servico_id} onChange={(e) => set('servico_id', e.target.value)}>
              <option value="">Obra inteira</option>
              {servicos.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </label>
        </div>
        <label className="campo">O que foi combinado<input value={f.descricao} onChange={(e) => set('descricao', e.target.value)} required placeholder="Ex.: Assentamento de piso da cozinha e área de serviço" /></label>
        <div className="grid grid-2">
          <label className="campo">Forma
            <select value={f.modalidade} onChange={(e) => set('modalidade', e.target.value)}>{Object.entries(MODALIDADE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          <label className="campo">Tipo de custo
            <select value={f.natureza} onChange={(e) => set('natureza', e.target.value)}><option value="mao_obra">Mão de obra</option><option value="material">Material</option><option value="outros">Outros</option></select>
          </label>
        </div>
        {f.modalidade === 'diaria' ? (
          <div className="grid grid-3">
            <label className="campo">Diárias<input inputMode="decimal" value={f.quantidade} onChange={(e) => set('quantidade', e.target.value)} /></label>
            <label className="campo">Valor da diária<CampoValor valor={unit} aoMudar={setUnit} /></label>
            <div className="campo"><span>Total</span><b className="num" style={{ padding: '9px 0' }}>{valorCalc !== null ? formatar(valorCalc) : '—'}</b></div>
          </div>
        ) : (
          <label className="campo">Valor combinado<CampoValor valor={valor} aoMudar={setValor} obrigatorio /></label>
        )}
        <div className="grid grid-3">
          <label className="campo">Contratado em<input type="date" value={f.data_contratacao} onChange={(e) => set('data_contratacao', e.target.value)} required /></label>
          <label className="campo">Início previsto<input type="date" value={f.prazo_inicio} onChange={(e) => set('prazo_inicio', e.target.value)} /></label>
          <label className="campo">Término combinado<input type="date" value={f.prazo_fim} onChange={(e) => set('prazo_fim', e.target.value)} /></label>
        </div>
        <label className="campo">Condições de pagamento<input value={f.condicoes_pagamento} onChange={(e) => set('condicoes_pagamento', e.target.value)} placeholder="Ex.: 50% no início, 50% na conclusão" /></label>
        <label className="campo">Observações<textarea value={f.observacoes} onChange={(e) => set('observacoes', e.target.value)} /></label>
        <Erro mensagem={erro} />
      </form>
    </Modal>
  );
}

function Estrelas({ valor, aoMudar, rotulo }: { valor: number | null; aoMudar: (v: number) => void; rotulo: string }) {
  return (
    <div className="estrelas" role="radiogroup" aria-label={rotulo}>
      {[1, 2, 3, 4, 5].map((k) => (
        <button key={k} type="button" role="radio" aria-checked={valor === k} aria-label={`${k} de 5`} className={valor && k <= valor ? 'ativa' : ''} onClick={() => aoMudar(k)}>★</button>
      ))}
    </div>
  );
}

function ContratacaoDetalhe({ c, servicos, aoFechar, aoMudar }: { c: Contratacao; servicos: { id: string; nome: string }[]; aoFechar: () => void; aoMudar: () => void }) {
  const toast = useToast();
  const [modo, setModo] = useState<'ver' | 'editar' | 'pagar' | 'aditivo' | 'concluir' | 'cancelar'>('ver');
  const [erro, setErro] = useState<string | null>(null);
  const [ad, setAd] = useState({ descricao: '', motivo: '' });
  const [adValor, setAdValor] = useState<Centavos | null>(null);
  const [desconto, setDesconto] = useState(false);
  const [av, setAv] = useState({ q: c.avaliacao_qualidade, p: c.avaliacao_prazo, t: c.avaliacao_texto ?? '' });
  const [motivo, setMotivo] = useState('');
  const historico = useConsulta(async () => {
    const [a, l] = await Promise.all([
      supabase.from('contratacao_aditivo').select('*').eq('contratacao_id', c.id).order('data'),
      supabase.from('lancamento').select('id, codigo, descricao, valor_total, data_competencia, cancelado').eq('contratacao_id', c.id).order('data_competencia'),
    ]);
    return { aditivos: ok(a) as { id: string; descricao: string; valor: string; motivo: string | null; data: string }[], lancamentos: ok(l) as { id: string; codigo: string; descricao: string; valor_total: string; data_competencia: string; cancelado: boolean }[] };
  }, [c.id]);
  const categorias = useConsulta(async () => ok(await supabase.from('categoria').select('id, natureza').eq('tipo', 'pagar').eq('ativo', true).order('ordem')) as { id: string; natureza: string }[], []);

  async function exec(p: PromiseLike<{ error: unknown }>, msg: string) {
    const { error } = await p;
    if (error) return setErro(mensagemErro(error));
    toast(msg);
    aoMudar();
  }

  if (modo === 'editar') return <ContratacaoForm obraId={c.obra_id} servicos={servicos} c={c} aoFechar={() => setModo('ver')} aoSalvar={aoMudar} />;
  if (modo === 'pagar') {
    const nat = c.natureza === 'material' ? 'custo_material' : c.natureza === 'outros' ? 'custo_outros' : 'custo_mao_obra';
    return (
      <LancamentoForm tipo="pagar"
        padrao={{ escopo: 'obra', obra_id: c.obra_id, servico_id: c.servico_id ?? '', pessoa_id: c.pessoa_id, contratacao_id: c.id, descricao: `${c.pessoa_nome} · ${c.descricao}`, categoria_id: categorias.dados?.find((x) => x.natureza === nat)?.id, valor: Math.max(n(c.a_lancar), 0) || null }}
        aoFechar={() => setModo('ver')} aoSalvar={() => { toast('Pagamento lançado. Registre a liquidação quando pagar.'); aoMudar(); }} />
    );
  }

  return (
    <Modal titulo={`${c.pessoa_nome} · ${c.codigo}`} aoFechar={aoFechar} largo>
      <div className="stack">
        <div className="grid grid-kpi">
          <div className="kpi"><div className="rotulo">Combinado</div><div className="valor num">{formatar(n(c.valor_total))}</div><div className="det">Original {formatar(n(c.valor_contratado))}{n(c.aditivos) !== 0 ? ` · adicionais ${formatar(n(c.aditivos))}` : ''}</div></div>
          <div className="kpi"><div className="rotulo">Lançado</div><div className="valor num">{formatar(n(c.lancado))}</div><div className="det">Falta lançar {formatar(n(c.a_lancar))}</div></div>
          <div className="kpi"><div className="rotulo">Pago</div><div className="valor num">{formatar(n(c.pago))}</div></div>
          <div className="kpi destaque"><div className="rotulo">Saldo a pagar</div><div className="valor num">{formatar(n(c.saldo_a_pagar))}</div></div>
        </div>
        <dl className="dl">
          <dt>Combinado</dt><dd>{c.descricao}</dd>
          <dt>Forma</dt><dd>{MODALIDADE[c.modalidade]}{c.quantidade ? ` · ${String(c.quantidade).replace('.', ',')} diária(s) de ${formatar(n(c.valor_unitario))}` : ''}</dd>
          <dt>Serviço</dt><dd>{c.servico_nome ?? 'Obra inteira'}</dd>
          <dt>Prazo</dt><dd>{c.prazo_inicio ? formatarData(c.prazo_inicio) : '—'} até {c.prazo_fim ? formatarData(c.prazo_fim) : '—'}{c.estado === 'ativa' && c.prazo_fim && c.prazo_fim < hoje() ? <b style={{ color: 'var(--desfavoravel)' }}> · prazo vencido</b> : ''}</dd>
          {c.condicoes_pagamento && <><dt>Pagamento</dt><dd>{c.condicoes_pagamento}</dd></>}
          <dt>Situação</dt><dd><span className={`selo ${ESTADO_CT[c.estado].classe}`}>{ESTADO_CT[c.estado].rotulo}</span>{c.motivo_cancelamento ? ` · ${c.motivo_cancelamento}` : ''}{c.concluida_em ? ` · em ${formatarData(c.concluida_em)}` : ''}</dd>
          {(c.avaliacao_qualidade || c.avaliacao_prazo) && <><dt>Avaliação</dt><dd>Qualidade {c.avaliacao_qualidade ?? '—'}/5 · Prazo {c.avaliacao_prazo ?? '—'}/5{c.avaliacao_texto ? ` · ${c.avaliacao_texto}` : ''}</dd></>}
        </dl>
        <Erro mensagem={erro} />
        {modo === 'ver' && c.estado !== 'cancelada' && (
          <div className="row">
            <button className="btn-primario" onClick={() => setModo('pagar')}>Lançar pagamento</button>
            <button className="btn-secundario" onClick={() => setModo('aditivo')}>Adicional ou desconto</button>
            {c.estado === 'ativa' && <button className="btn-secundario" onClick={() => setModo('concluir')}>Concluir e avaliar</button>}
            <button className="btn-secundario" onClick={() => setModo('editar')}><Icone nome="editar" /> Editar</button>
            {c.estado === 'ativa' && <button className="btn-link" onClick={() => setModo('cancelar')}>Cancelar contratação</button>}
          </div>
        )}
        {modo === 'aditivo' && (
          <form className="stack card destaque-card" onSubmit={(e) => { e.preventDefault(); if (!adValor) return setErro('Informe o valor.'); exec(supabase.from('contratacao_aditivo').insert({ contratacao_id: c.id, descricao: ad.descricao.trim(), motivo: ad.motivo.trim() || null, valor: paraBanco(desconto ? -adValor : adValor) }), 'Registrado. O valor original foi preservado.'); }}>
            <div className="segmentado"><button type="button" className={!desconto ? 'ativo' : ''} onClick={() => setDesconto(false)}>Adicional</button><button type="button" className={desconto ? 'ativo' : ''} onClick={() => setDesconto(true)}>Desconto</button></div>
            <div className="grid grid-2">
              <label className="campo">Descrição<input value={ad.descricao} onChange={(e) => setAd({ ...ad, descricao: e.target.value })} required /></label>
              <label className="campo">Valor<CampoValor valor={adValor} aoMudar={setAdValor} obrigatorio /></label>
            </div>
            <label className="campo">Motivo<input value={ad.motivo} onChange={(e) => setAd({ ...ad, motivo: e.target.value })} placeholder="Ex.: mudança de escopo pedida pelo cliente" /></label>
            <div className="row"><button className="btn-primario">Registrar</button><button type="button" className="btn-link" onClick={() => setModo('ver')}>Voltar</button></div>
          </form>
        )}
        {modo === 'concluir' && (
          <form className="stack card destaque-card" onSubmit={(e) => { e.preventDefault(); exec(supabase.from('contratacao').update({ estado: 'concluida', avaliacao_qualidade: av.q, avaliacao_prazo: av.p, avaliacao_texto: av.t.trim() || null }).eq('id', c.id), 'Contratação concluída.'); }}>
            <p className="muted small" style={{ margin: 0 }}>A avaliação fica no histórico do parceiro e ajuda nas próximas contratações.</p>
            <div className="grid grid-2">
              <div className="campo"><span>Qualidade do serviço</span><Estrelas valor={av.q} aoMudar={(v) => setAv({ ...av, q: v })} rotulo="Qualidade" /></div>
              <div className="campo"><span>Cumprimento de prazo</span><Estrelas valor={av.p} aoMudar={(v) => setAv({ ...av, p: v })} rotulo="Prazo" /></div>
            </div>
            <label className="campo">Comentário<input value={av.t} onChange={(e) => setAv({ ...av, t: e.target.value })} /></label>
            {n(c.saldo_a_pagar) > 0 && <div className="aviso"><Icone nome="alerta" /><span>Ainda há {formatar(n(c.saldo_a_pagar))} a pagar. Concluir não quita o saldo: ele continua como obrigação.</span></div>}
            <div className="row"><button className="btn-primario">Concluir</button><button type="button" className="btn-link" onClick={() => setModo('ver')}>Voltar</button></div>
          </form>
        )}
        {modo === 'cancelar' && (
          <form className="stack card destaque-card" onSubmit={(e) => { e.preventDefault(); exec(supabase.from('contratacao').update({ estado: 'cancelada', motivo_cancelamento: motivo.trim() }).eq('id', c.id), 'Contratação cancelada.'); }}>
            <p className="muted small" style={{ margin: 0 }}>Depois de cancelada, só o que já foi lançado continua contando. Pagamentos já feitos ficam no histórico.</p>
            <label className="campo">Motivo<input value={motivo} onChange={(e) => setMotivo(e.target.value)} required placeholder="Ex.: parceiro atrasou e foi substituído" /></label>
            <div className="row"><button className="btn-perigo">Cancelar contratação</button><button type="button" className="btn-link" onClick={() => setModo('ver')}>Voltar</button></div>
          </form>
        )}
        <h3>Histórico</h3>
        {historico.carregando && !historico.dados ? <Carregando /> : (
          <ul className="linha-tempo">
            <li><div className="small muted">{formatarData(c.data_contratacao)}</div><div>Contratado: {formatar(n(c.valor_contratado))}</div></li>
            {historico.dados?.aditivos.map((a) => <li key={a.id} className={Number(a.valor) < 0 ? 'ajuste_pedido' : 'aceita'}><div className="small muted">{formatarData(a.data)}</div><div>{Number(a.valor) < 0 ? 'Desconto' : 'Adicional'}: {a.descricao} · {formatar(n(a.valor))}{a.motivo ? ` · ${a.motivo}` : ''}</div></li>)}
            {historico.dados?.lancamentos.map((l) => <li key={l.id} className={l.cancelado ? 'sistema' : ''}><div className="small muted">{formatarData(l.data_competencia)} · {l.codigo}</div><div><a href={`/financeiro/${l.id}`}>{l.descricao}</a> · {formatar(n(l.valor_total))}{l.cancelado ? ' (cancelado)' : ''}</div></li>)}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/** Histórico de um parceiro em todas as obras (para a ficha do cadastro). */
export function HistoricoParceiro({ pessoaId }: { pessoaId: string }) {
  const { dados } = useConsulta(async () => ok(await supabase.from('v_contratacao').select('*').eq('pessoa_id', pessoaId).order('data_contratacao', { ascending: false })) as Contratacao[], [pessoaId]);
  if (!dados?.length) return null;
  const notas = dados.flatMap((c) => [c.avaliacao_qualidade, c.avaliacao_prazo]).filter((x): x is number => x != null);
  const media = notas.length ? (notas.reduce((a, b) => a + b, 0) / notas.length).toFixed(1).replace('.', ',') : null;
  return (
    <div className="aviso info" style={{ display: 'block' }}>
      <b>Histórico como parceiro</b>{media && ` · média ${media}/5`}
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {dados.slice(0, 6).map((c) => <li key={c.id} className="small">{c.obra_codigo} · {c.descricao} · {formatar(n(c.valor_total))} · {ESTADO_CT[c.estado].rotulo}{c.avaliacao_qualidade ? ` · qualidade ${c.avaliacao_qualidade}/5` : ''}</li>)}
      </ul>
    </div>
  );
}

