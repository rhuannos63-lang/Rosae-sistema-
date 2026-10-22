// Planejador de destinação: quanto do saldo em conta já tem dono.
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { useAuth } from '../auth/AuthProvider';
import { Topo } from '../components/Layout';
import { Ajuda, Carregando, Erro } from '../components/ui';
import { doBanco, formatar } from '../core/dinheiro';

type Plano = Record<string, string | number | boolean | null>;

export function Planejador() {
  const { ehAdmin } = useAuth();
  const { dados, erro, carregando } = useConsulta(async () => ok(await supabase.rpc('planejador_destinacao')) as Plano, []);
  if (carregando && !dados) return <Carregando />;
  if (erro || !dados) return <Erro mensagem={erro} />;
  const c = (k: string) => doBanco(dados[k] as string);
  const linhas: { rotulo: string; valor: number; ajuda: string; para?: string }[] = [
    { rotulo: 'Obrigações das obras', valor: c('obrigacoes_obras'), ajuda: 'Contas a pagar de obras já lançadas e ainda não pagas (materiais, parceiros, outros).', para: '/financeiro?tipo=pagar&situacao=abertas' },
    { rotulo: 'Combinado com parceiros e ainda não lançado', valor: c('contratado_nao_lancado'), ajuda: 'O que foi contratado com parceiros e ainda não virou conta a pagar. Continua sendo um compromisso.' },
    { rotulo: `Despesas da empresa nos próximos ${dados.horizonte_dias} dias`, valor: c('despesas_empresa'), ajuda: 'Contas da empresa (não de obra) que vencem no prazo configurado, incluindo vencidas.', para: '/financeiro?tipo=pagar&situacao=proximos' },
    { rotulo: dados.provisao_pct == null ? 'Provisão de tributos (não configurada)' : `Provisão de tributos (${String(dados.provisao_pct).replace('.', ',')}% do recebido no mês)`, valor: dados.provisao_tributos == null ? 0 : c('provisao_tributos'), ajuda: 'Percentual gerencial sobre o que entrou de clientes neste mês, descontando tributos já pagos no mês. Não é cálculo oficial de imposto.' },
    { rotulo: 'Reserva mínima', valor: c('reserva_minima'), ajuda: 'Valor que você definiu para sempre ficar em conta.' },
    { rotulo: 'Pró-labore planejado', valor: c('pro_labore'), ajuda: 'O que você planeja retirar como pró-labore neste mês.' },
  ];
  const disp = c('disponivel');
  return (
    <>
      <Topo titulo="Planejador de destinação" sub="Sugestão gerencial de quanto do dinheiro em conta está livre depois dos compromissos. Nada é movimentado automaticamente." />
      {!dados.configurado && (
        <div className="aviso" style={{ marginBottom: 14 }}>
          <span>Defina a provisão de tributos e a reserva mínima {ehAdmin ? <Link to="/configuracoes">em Configurações → Metas</Link> : 'em Configurações → Metas'} para o cálculo ficar completo.</span>
        </div>
      )}
      <div className="grid grid-2">
        <div className="card">
          <div className="destino linha-saldo"><span>Saldo nas contas hoje</span><b className="num">{formatar(c('saldo_contas'))}</b></div>
          {linhas.map((l) => (
            <div key={l.rotulo} className="destino">
              <span>− {l.para ? <Link to={l.para}>{l.rotulo}</Link> : l.rotulo} <Ajuda>{l.ajuda}</Ajuda></span>
              <span className="num">{formatar(l.valor)}</span>
            </div>
          ))}
          <div className="destino linha-total">
            <span>= Disponível sugerido</span>
            <b className="num" style={{ color: disp < 0 ? 'var(--desfavoravel)' : 'var(--favoravel)' }}>{formatar(disp)}</b>
          </div>
        </div>
        <div className="stack">
          {disp < 0 ? (
            <div className="aviso erro"><span><b>Atenção:</b> os compromissos são maiores que o saldo em {formatar(-disp)}. Antes de qualquer retirada, priorize recebimentos e renegocie vencimentos.</span></div>
          ) : (
            <div className="aviso ok"><span>Pelos compromissos registrados, {formatar(disp)} estão livres. Retiradas além do pró-labore são decisão sua, de preferência com apoio do contador.</span></div>
          )}
          <div className="card">
            <h3>Para considerar</h3>
            <ul className="small" style={{ paddingLeft: 18, margin: '6px 0 0' }}>
              <li>Ainda a receber de clientes: <b>{formatar(c('a_receber'))}</b>. Não entra no disponível até ser recebido.</li>
              <li>Dinheiro recebido de uma obra não deveria cobrir o déficit de outra sem você saber: confira o resultado por obra.</li>
              <li>Transferências entre suas contas não mudam este cálculo.</li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
