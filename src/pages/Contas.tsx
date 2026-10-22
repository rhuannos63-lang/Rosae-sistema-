import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok, novaChave } from '../lib/consulta';
import { Topo } from '../components/Layout';
import { CampoValor, Carregando, Dinheiro, Erro, Modal, Vazio, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import { doBanco, formatar, paraBanco, somar, type Centavos } from '../core/dinheiro';
import { formatarData, hoje, periodo } from '../core/datas';
import { paraCsv, baixarArquivo } from '../core/exportar';
import type { SaldoConta, VMovimento } from '../lib/tipos';

// Grupos que explicam cada número do painel (mesmos critérios de painel_indicadores).
const GRUPOS: Record<string, { rotulo: string; naturezas: string[] }> = {
  recebido: { rotulo: 'Recebido de clientes', naturezas: ['receita_servico', 'reembolso_cliente'] },
  pago_obras: { rotulo: 'Pago em obras', naturezas: ['custo_material', 'custo_mao_obra', 'custo_outros'] },
  pago_empresa: { rotulo: 'Despesas da empresa pagas', naturezas: ['despesa_empresa', 'tributo', 'outras_saidas'] },
  retiradas: { rotulo: 'Pró-labore e retiradas', naturezas: ['pro_labore', 'retirada'] },
  outras: { rotulo: 'Outras entradas', naturezas: ['rendimento', 'aporte', 'outras_entradas'] },
  operacional: { rotulo: 'Movimentos do resultado de caixa', naturezas: ['receita_servico', 'reembolso_cliente', 'custo_material', 'custo_mao_obra', 'custo_outros', 'despesa_empresa', 'tributo', 'outras_saidas'] },
  transferencia: { rotulo: 'Transferências entre contas', naturezas: ['transferencia'] },
};

export function Contas() {
  const [params, setParams] = useSearchParams();
  const mesAtual = periodo('mes', hoje());
  const inicio = params.get('inicio') ?? mesAtual.inicio;
  const fim = params.get('fim') ?? mesAtual.fim;
  const grupo = params.get('grupo') ?? '';
  const conta = params.get('conta') ?? '';
  const [transferir, setTransferir] = useState(false);
  const mudar = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };

  const saldos = useConsulta(async () => ok(await supabase.from('v_saldo_conta').select('*').order('ordem')) as SaldoConta[], []);
  const movs = useConsulta(async () => {
    let q = supabase.from('v_movimento').select('*').gte('data', inicio).lte('data', fim).order('data', { ascending: false }).order('criado_em', { ascending: false });
    if (conta) q = q.eq('conta_bancaria_id', conta);
    if (grupo && GRUPOS[grupo]) q = q.in('categoria_natureza', GRUPOS[grupo].naturezas);
    return ok(await q.limit(2000)) as VMovimento[];
  }, [inicio, fim, grupo, conta]);

  const total = useMemo(() => somar((movs.dados ?? []).map((m) => doBanco(m.valor_assinado))), [movs.dados]);
  const ativas = (saldos.dados ?? []).filter((s) => s.ativa);

  function exportar() {
    const linhas = (movs.dados ?? []).map((m) => ({
      data: formatarData(m.data), codigo: m.codigo, conta: m.conta_nome, descricao: m.lancamento_descricao ?? m.descricao,
      categoria: m.categoria_nome, lancamento: m.lancamento_codigo, valor: paraBanco(doBanco(m.valor_assinado)).replace('.', ','),
    }));
    baixarArquivo(`extrato-${inicio}-a-${fim}.csv`, paraCsv(linhas), 'text/csv;charset=utf-8');
  }

  return (
    <>
      <Topo titulo="Contas e movimentos" sub="Saldo de cada conta e cofrinho, e todo dinheiro que entrou ou saiu.">
        <button className="btn-secundario" onClick={() => setTransferir(true)}><Icone nome="transferir" /> Transferir entre contas</button>
      </Topo>
      <Erro mensagem={saldos.erro} />
      <div className="grid grid-kpi">
        {ativas.map((s) => (
          <button key={s.id} className={`kpi${conta === s.id ? ' destaque' : ''}`} style={{ textAlign: 'left', font: 'inherit' }} onClick={() => mudar('conta', conta === s.id ? '' : s.id)}>
            <div className="rotulo">{s.nome}</div>
            <div className="valor">{formatar(doBanco(s.saldo))}</div>
            <div className="det">{s.instituicao ?? ''}{s.tipo === 'cofrinho' ? ' · cofrinho' : ''}</div>
          </button>
        ))}
        <div className="kpi">
          <div className="rotulo">Total nas contas</div>
          <div className="valor">{formatar(somar(ativas.map((s) => doBanco(s.saldo))))}</div>
          <div className="det">Ajuste o saldo inicial em Configurações</div>
        </div>
      </div>

      <div className="card section">
        <div className="row" style={{ marginBottom: 12 }}>
          <label className="campo" style={{ flexDirection: 'row', alignItems: 'center' }}>De <input type="date" value={inicio} onChange={(e) => mudar('inicio', e.target.value)} /></label>
          <label className="campo" style={{ flexDirection: 'row', alignItems: 'center' }}>até <input type="date" value={fim} onChange={(e) => mudar('fim', e.target.value)} /></label>
          <select value={grupo} onChange={(e) => mudar('grupo', e.target.value)} style={{ width: 'auto' }} aria-label="Grupo">
            <option value="">Todos os movimentos</option>
            {Object.entries(GRUPOS).map(([k, g]) => <option key={k} value={k}>{g.rotulo}</option>)}
          </select>
          <div className="spacer" />
          <button className="btn-secundario" onClick={exportar} disabled={!movs.dados?.length}><Icone nome="baixar" /> CSV</button>
        </div>
        {grupo && GRUPOS[grupo] && (
          <div className="aviso info" style={{ marginBottom: 12 }}>
            <span>{GRUPOS[grupo].rotulo}, de {formatarData(inicio)} a {formatarData(fim)}{conta ? ' nesta conta' : ''}: <b>{formatar(Math.abs(total))}</b>. Estes são os lançamentos que formam o número do painel.</span>
          </div>
        )}
        <Erro mensagem={movs.erro} />
        {movs.carregando && !movs.dados ? <Carregando /> : (movs.dados ?? []).length === 0 ? (
          <Vazio titulo="Nenhum movimento no período" />
        ) : (
          <div className="tabela-wrap">
            <table className="tabela">
              <thead><tr><th>Data</th><th>Descrição</th><th>Conta</th><th>Categoria</th><th className="right">Valor</th></tr></thead>
              <tbody>
                {(movs.dados ?? []).map((m) => (
                  <tr key={m.id}>
                    <td className="num">{formatarData(m.data)}</td>
                    <td>
                      {m.lancamento_id ? <Link to={`/financeiro/${m.lancamento_id}`}>{m.lancamento_descricao}</Link> : m.descricao}
                      <div className="muted small">{m.codigo}{m.lancamento_codigo ? ` · ${m.lancamento_codigo}` : ''}{m.estorno_de ? ' · estorno' : ''}{m.descricao && m.lancamento_id ? ` · ${m.descricao}` : ''}</div>
                    </td>
                    <td>{m.conta_nome}</td>
                    <td className="small">{m.categoria_nome}</td>
                    <td className="right"><Dinheiro valor={doBanco(m.valor_assinado)} sinal /></td>
                  </tr>
                ))}
                <tr className="total"><td colSpan={4}>Soma do período</td><td className="right"><Dinheiro valor={total} /></td></tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
      {transferir && <TransferenciaModal contas={ativas} aoFechar={() => setTransferir(false)} aoSalvar={() => { setTransferir(false); saldos.recarregar(); movs.recarregar(); }} />}
    </>
  );
}

function TransferenciaModal({ contas, aoFechar, aoSalvar }: { contas: SaldoConta[]; aoFechar: () => void; aoSalvar: () => void }) {
  const toast = useToast();
  const [origem, setOrigem] = useState(contas[0]?.id ?? '');
  const [destino, setDestino] = useState(contas[1]?.id ?? '');
  const [valor, setValor] = useState<Centavos | null>(null);
  const [data, setData] = useState(hoje());
  const [desc, setDesc] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [chave] = useState(novaChave);
  const [salvando, setSalvando] = useState(false);
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!valor || valor <= 0) return setErro('Informe o valor.');
    if (origem === destino) return setErro('Escolha contas diferentes.');
    setSalvando(true);
    const { error } = await supabase.rpc('registrar_transferencia', { p_origem: origem, p_destino: destino, p_valor: paraBanco(valor), p_data: data, p_descricao: desc.trim() || null, p_chave: chave });
    setSalvando(false);
    if (error) return setErro(mensagemErro(error));
    toast('Transferência registrada.');
    aoSalvar();
  }
  return (
    <Modal titulo="Transferir entre contas" aoFechar={aoFechar}
      rodape={<><button type="button" className="btn-secundario" onClick={aoFechar}>Cancelar</button><button className="btn-primario" form="form-tr" disabled={salvando}>Registrar</button></>}>
      <form id="form-tr" className="stack" onSubmit={salvar}>
        <p className="muted small" style={{ margin: 0 }}>Mover dinheiro entre suas contas ou cofrinhos não é receita nem despesa: o total não muda.</p>
        <div className="grid grid-2">
          <label className="campo">De<select value={origem} onChange={(e) => setOrigem(e.target.value)}>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
          <label className="campo">Para<select value={destino} onChange={(e) => setDestino(e.target.value)}>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
          <label className="campo">Valor<CampoValor valor={valor} aoMudar={setValor} obrigatorio autoFocus /></label>
          <label className="campo">Data<input type="date" value={data} onChange={(e) => setData(e.target.value)} required /></label>
        </div>
        <label className="campo">Descrição<input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ex.: separar impostos do mês" /></label>
        <Erro mensagem={erro} />
      </form>
    </Modal>
  );
}
