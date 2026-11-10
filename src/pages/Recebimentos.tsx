// Contratos: quanto foi fechado em cada orçamento e quanto de fato entrou.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useConsulta } from '../lib/consulta';
import { Topo } from '../components/Layout';
import { Ajuda, Carregando, Erro, Vazio } from '../components/ui';
import { Icone } from '../components/Icone';
import { carregarContratos, RegistrarRecebimento, type Contrato } from '../components/Recebimentos';
import { doBanco, formatar, somar } from '../core/dinheiro';
import { formatarData } from '../core/datas';
import { faltaReceber, percentualRecebido } from '../core/recebimentos';

type Filtro = 'abertos' | 'quitados' | 'todos';

export function Recebimentos() {
  const { dados, erro, carregando, recarregar } = useConsulta(carregarContratos, []);
  const [filtro, setFiltro] = useState<Filtro>('abertos');
  const [busca, setBusca] = useState('');
  const [registrar, setRegistrar] = useState<Contrato | null>(null);

  const todos = dados ?? [];
  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return todos.filter((c) => (filtro === 'todos' ? true : filtro === 'quitados' ? faltaReceber(c) === 0 : faltaReceber(c) > 0))
      .filter((c) => !b || [c.titulo, c.codigo, c.cliente, c.obra_nome].some((x) => x?.toLowerCase().includes(b)));
  }, [todos, filtro, busca]);
  const tFechado = somar(todos.map((c) => doBanco(c.fechado)));
  const tRecebido = somar(todos.map((c) => doBanco(c.recebido)));
  const tFalta = somar(todos.map(faltaReceber));

  return (
    <>
      <Topo titulo="Contratos e recebimentos" sub="Quanto você fechou em cada orçamento e quanto de fato entrou. O aceite do cliente não conta como recebido.">
        <Link className="btn-secundario" to="/financeiro"><Icone nome="financeiro" /> Pagar e receber</Link>
      </Topo>
      <div className="grid grid-3" style={{ marginBottom: 14 }}>
        <div className="kpi"><div className="rotulo">Fechado <Ajuda>Orçamentos aceitos mais os aditivos aceitos, e obras lançadas sem proposta.</Ajuda></div><div className="valor num">{formatar(tFechado)}</div><div className="det">{todos.length} contrato(s)</div></div>
        <div className="kpi"><div className="rotulo">Recebido de fato</div><div className="valor num">{formatar(tRecebido)}</div><div className="det">Só o que você registrou como entrado</div></div>
        <div className="kpi"><div className="rotulo">Falta receber</div><div className="valor num">{formatar(tFalta)}</div><div className="det">Fechado − recebido</div></div>
      </div>
      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="segmentado">
            {(['abertos', 'quitados', 'todos'] as const).map((f) => (
              <button key={f} className={filtro === f ? 'ativo' : ''} onClick={() => setFiltro(f)}>{{ abertos: 'Com saldo a receber', quitados: 'Quitados', todos: 'Todos' }[f]}</button>
            ))}
          </div>
          <input type="search" placeholder="Buscar cliente, obra ou código" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 280 }} />
        </div>
        <Erro mensagem={erro} />
        {carregando && !dados ? <Carregando /> : lista.length === 0 ? (
          <Vazio titulo={todos.length ? 'Nada neste filtro' : 'Nenhum contrato fechado ainda'}><p>Quando o cliente aceitar uma proposta, ela aparece aqui com o valor fechado. Você registra cada valor que entrar, do jeito que foi combinado.</p></Vazio>
        ) : (
          <div className="tabela-wrap">
            <table className="tabela">
              <thead><tr><th>Contrato</th><th className="right">Fechado</th><th className="right">Recebido</th><th className="right">Falta</th><th /></tr></thead>
              <tbody>
                {lista.map((c) => {
                  const pct = percentualRecebido(c);
                  const vencido = doBanco(c.previsto_vencido);
                  const para = c.proposta_id ? `/propostas/${c.proposta_id}` : `/obras/${c.obra_id}?aba=financeiro`;
                  return (
                    <tr key={c.proposta_id ?? c.obra_id}>
                      <td>
                        <Link to={para}><b>{c.titulo}</b></Link>
                        <div className="muted small">{c.codigo}{c.cliente ? ` · ${c.cliente}` : ''}{c.data_fechamento ? ` · fechado em ${formatarData(c.data_fechamento)}` : ''}</div>
                        <div className="barra-meta" style={{ marginTop: 6, maxWidth: 260 }}><div style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                        <div className="muted small">{pct}% recebido{c.ultimo_recebimento ? ` · último em ${formatarData(c.ultimo_recebimento)}` : ''}{vencido > 0 ? ` · ${formatar(vencido)} previsto já venceu` : ''}</div>
                      </td>
                      <td className="right num">{formatar(doBanco(c.fechado))}{doBanco(c.aditivos) > 0 && <div className="muted small">com aditivos</div>}</td>
                      <td className="right num">{formatar(doBanco(c.recebido))}</td>
                      <td className="right num"><b>{formatar(faltaReceber(c))}</b></td>
                      <td className="right"><button className="btn-secundario" onClick={() => setRegistrar(c)}><Icone nome="mais" /> Recebimento</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {registrar && <RegistrarRecebimento contrato={registrar} aoFechar={() => setRegistrar(null)} aoSalvar={() => { setRegistrar(null); recarregar(); }} />}
    </>
  );
}
