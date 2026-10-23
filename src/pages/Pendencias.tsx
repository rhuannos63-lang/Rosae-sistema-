// Central de pendências: tudo que pede ação, com prioridade e link para o registro.
// Cada pessoa vê só o que suas permissões permitem (a consulta roda com elas).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { Topo } from '../components/Layout';
import { Carregando, Erro, Vazio, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import { formatarData, hoje, somarDias } from '../core/datas';

export type ItemPendencia = { chave: string; tipo: string; prioridade: number; titulo: string; detalhe: string; link: string; data: string | null; obra: string | null };

export const TIPOS_PENDENCIA: Record<string, string> = {
  proposta: 'Propostas', comercial: 'Comercial', nota: 'Notas', pagamento: 'Pagamentos', recebimento: 'Recebimentos', material: 'Materiais',
  obra: 'Obras', decisao: 'Decisões do cliente', pendencia: 'Pendências de obra', portal: 'Portal', documento: 'Documentos',
};
const PRIORIDADE: Record<number, [string, string]> = { 1: ['Urgente', 'erro'], 2: ['Atenção', 'alerta'], 3: ['Quando puder', 'neutro'] };

export function usePendencias() {
  return useConsulta(async () => ok(await supabase.rpc('central_pendencias')) as ItemPendencia[], []);
}

export function Pendencias() {
  const toast = useToast();
  const { dados, erro, carregando, recarregar } = usePendencias();
  const [filtro, setFiltro] = useState<string>('todos');
  async function dispensar(i: ItemPendencia, dias: number | null) {
    const r = await supabase.from('aviso_dispensado').upsert({ chave: i.chave, ate: dias === null ? null : somarDias(hoje(), dias) }, { onConflict: 'usuario_id,chave' });
    if (r.error) return toast(mensagemErro(r.error));
    toast(dias === null ? 'Aviso dispensado.' : `Aviso adiado por ${dias} dias.`);
    recarregar();
  }
  const tipos = [...new Set((dados ?? []).map((i) => i.tipo))];
  const lista = (dados ?? []).filter((i) => filtro === 'todos' || i.tipo === filtro);
  return (
    <>
      <Topo titulo="Pendências" sub="O que precisa da sua ação, do mais urgente para o menos." />
      {carregando && !dados ? <Carregando /> : erro ? <Erro mensagem={erro} /> : !dados?.length ? (
        <Vazio titulo="Nada pendente">Quando algo precisar de ação (proposta sem resposta, pagamento vencendo, material atrasado, mensagem de cliente), aparece aqui.</Vazio>
      ) : (
        <>
          <div className="portal-filtros" role="group" aria-label="Filtrar por tipo" style={{ marginBottom: 12 }}>
            <button className={filtro === 'todos' ? 'ativo' : ''} aria-pressed={filtro === 'todos'} onClick={() => setFiltro('todos')}>Todas ({dados.length})</button>
            {tipos.map((t) => (
              <button key={t} className={filtro === t ? 'ativo' : ''} aria-pressed={filtro === t} onClick={() => setFiltro(t)}>
                {TIPOS_PENDENCIA[t] ?? t} ({dados.filter((i) => i.tipo === t).length})
              </button>
            ))}
          </div>
          <div className="card">
            <ul className="lista-adm">
              {lista.map((i) => <LinhaPendencia key={i.chave} i={i} dispensar={dispensar} />)}
            </ul>
          </div>
        </>
      )}
    </>
  );
}

export function LinhaPendencia({ i, dispensar }: { i: ItemPendencia; dispensar?: (i: ItemPendencia, dias: number | null) => void }) {
  const atrasada = i.data && i.data < hoje();
  return (
    <li className="row" style={{ justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
      <div style={{ minWidth: 0 }}>
        <span className={`selo ${PRIORIDADE[i.prioridade]?.[1] ?? 'neutro'}`}>{PRIORIDADE[i.prioridade]?.[0]}</span>{' '}
        <Link to={i.link}><strong>{i.titulo}</strong></Link>
        <div className="small muted">{i.detalhe}{i.obra && ` · ${i.obra}`}{i.data && <span className={atrasada ? 'desfavoravel' : ''}> · {formatarData(i.data)}</span>}</div>
      </div>
      <div className="row" style={{ gap: 6, flex: 'none' }}>
        <Link className="btn-secundario" to={i.link} aria-label={`Abrir: ${i.titulo}`}><Icone nome="seta" /></Link>
        {dispensar && (
          <details className="menu-dispensar">
            <summary className="btn-link">Dispensar</summary>
            <div className="menu-dispensar-op">
              <button className="btn-link" onClick={() => dispensar(i, 3)}>Lembrar em 3 dias</button>
              <button className="btn-link" onClick={() => dispensar(i, 7)}>Lembrar em 7 dias</button>
              <button className="btn-link" onClick={() => dispensar(i, null)}>Não mostrar mais</button>
            </div>
          </details>
        )}
      </div>
    </li>
  );
}
