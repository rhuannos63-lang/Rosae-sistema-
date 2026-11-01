// Lixeira: tudo o que foi excluído, com o que saiu junto. Restaura com um toque.
import { useState } from 'react';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { Topo } from '../components/Layout';
import { Carregando, Erro, Vazio, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import { nomeTabela } from '../components/Excluir';
import { formatarDataHora } from '../core/datas';

type Item = { id: string; tabela: string; registro_id: string; nome: string | null; resumo: Record<string, number>; excluido_em: string; restaurado_em: string | null };

export function Lixeira() {
  const toast = useToast();
  const [verRestaurados, setVerRestaurados] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const { dados, carregando, erro: erroCarga, recarregar } = useConsulta(async () =>
    ok(await supabase.from('lixeira').select('id, tabela, registro_id, nome, resumo, excluido_em, restaurado_em').order('excluido_em', { ascending: false }).limit(300)) as Item[], []);
  async function restaurar(i: Item) {
    setOcupado(i.id); setErro(null);
    const r = await supabase.rpc('restaurar_lixeira', { p_lixeira: i.id });
    setOcupado(null);
    if (r.error) return setErro(mensagemErro(r.error));
    toast(`${i.nome ?? nomeTabela(i.tabela, 1)} restaurado, com tudo o que estava ligado.`);
    recarregar();
  }
  const lista = (dados ?? []).filter((i) => verRestaurados || !i.restaurado_em);
  return (
    <>
      <Topo titulo="Lixeira" sub="O que foi excluído fica guardado aqui com todos os dados. Restaurar devolve tudo como era, inclusive o que saiu junto.">
        <label className="check"><input type="checkbox" checked={verRestaurados} onChange={(e) => setVerRestaurados(e.target.checked)} /> Mostrar já restaurados</label>
      </Topo>
      <Erro mensagem={erro ?? erroCarga} />
      {carregando && !dados ? <Carregando /> : lista.length === 0 ? <Vazio titulo="Lixeira vazia">Nada foi excluído. Para excluir, use o botão Excluir dentro de cada cadastro.</Vazio> : (
        <div className="card lista-lixeira">
          {lista.map((i) => {
            const junto = Object.entries(i.resumo).map(([t, n]) => [t, t === i.tabela ? n - 1 : n] as const).filter(([, n]) => n > 0);
            return (
              <div key={i.id} className={`lixeira-item${i.restaurado_em ? ' restaurado' : ''}`}>
                <span className="lixeira-icone"><Icone nome="lixeira" /></span>
                <div className="lixeira-texto">
                  <b>{i.nome ?? nomeTabela(i.tabela, 1)}</b> <span className="selo neutro">{nomeTabela(i.tabela, 1)}</span>
                  <div className="muted small">Excluído em {formatarDataHora(i.excluido_em)}{junto.length > 0 && ` · junto: ${junto.map(([t, n]) => `${n} ${nomeTabela(t, n)}`).join(', ')}`}</div>
                </div>
                {i.restaurado_em
                  ? <span className="muted small">Restaurado em {formatarDataHora(i.restaurado_em)}</span>
                  : <button className="btn-secundario" disabled={ocupado === i.id} onClick={() => restaurar(i)}><Icone nome="desfazer" /> {ocupado === i.id ? 'Restaurando…' : 'Restaurar'}</button>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
