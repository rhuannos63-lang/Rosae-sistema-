// Busca rápida (Ctrl+K ou ⌘K): vai para qualquer tela ou encontra obra, pessoa,
// proposta, oportunidade ou lançamento pelo nome ou código.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { Icone } from './Icone';

export type Destino = { para: string; rotulo: string; icone: string };
type Resultado = { grupo: string; rotulo: string; det?: string; para: string; icone: string };

/** Tira o que o filtro do PostgREST interpretaria como sintaxe. */
const limpar = (t: string) => t.replace(/[,()%*\\]/g, ' ').trim();

export function useBuscaRapida() {
  const [aberta, setAberta] = useState(false);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setAberta((a) => !a); }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, []);
  return [aberta, setAberta] as const;
}

export function BuscaRapida({ destinos, aoFechar }: { destinos: Destino[]; aoFechar: () => void }) {
  const navegar = useNavigate();
  const { usuario, podeFinanceiro } = useAuth();
  const comercial = usuario?.papel === 'administrador' || usuario?.papel === 'administrativo';
  const [termo, setTermo] = useState('');
  const [dados, setDados] = useState<Resultado[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const lista = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const t = limpar(termo);
    if (t.length < 2) { setDados([]); return; }
    let cancelado = false;
    setBuscando(true);
    const id = window.setTimeout(async () => {
      const like = `%${t}%`;
      const [obras, pessoas, propostas, ops, lancs] = await Promise.all([
        supabase.from('obra').select('id, codigo, nome, status').or(`nome.ilike.${like},codigo.ilike.${like},endereco.ilike.${like}`).limit(5),
        supabase.from('pessoa').select('id, codigo, nome, telefone').or(`nome.ilike.${like},codigo.ilike.${like},telefone.ilike.${like},email.ilike.${like}`).limit(5),
        comercial ? supabase.from('proposta').select('id, codigo, titulo, estado').or(`titulo.ilike.${like},codigo.ilike.${like}`).limit(5) : Promise.resolve({ data: [] }),
        comercial ? supabase.from('oportunidade').select('id, codigo, titulo').or(`titulo.ilike.${like},codigo.ilike.${like},local_obra.ilike.${like}`).limit(5) : Promise.resolve({ data: [] }),
        podeFinanceiro ? supabase.from('lancamento').select('id, codigo, descricao, tipo').or(`descricao.ilike.${like},codigo.ilike.${like}`).limit(5) : Promise.resolve({ data: [] }),
      ]);
      if (cancelado) return;
      const r: Resultado[] = [];
      for (const o of (obras.data ?? []) as { id: string; codigo: string; nome: string; status: string }[]) r.push({ grupo: 'Obras', rotulo: o.nome, det: o.codigo, para: `/obras/${o.id}`, icone: 'obras' });
      for (const p of (pessoas.data ?? []) as { id: string; nome: string; telefone: string | null }[]) r.push({ grupo: 'Pessoas', rotulo: p.nome, det: p.telefone ?? undefined, para: `/pessoas?busca=${encodeURIComponent(p.nome)}`, icone: 'pessoas' });
      for (const p of (propostas.data ?? []) as { id: string; codigo: string; titulo: string }[]) r.push({ grupo: 'Propostas', rotulo: p.titulo, det: p.codigo, para: `/propostas/${p.id}`, icone: 'documento' });
      for (const o of (ops.data ?? []) as { id: string; codigo: string; titulo: string }[]) r.push({ grupo: 'Oportunidades', rotulo: o.titulo, det: o.codigo, para: `/comercial/${o.id}`, icone: 'comercial' });
      for (const l of (lancs.data ?? []) as { id: string; codigo: string; descricao: string; tipo: string }[]) r.push({ grupo: 'Lançamentos', rotulo: l.descricao, det: `${l.codigo} · ${l.tipo === 'receber' ? 'a receber' : 'a pagar'}`, para: `/financeiro/${l.id}`, icone: 'financeiro' });
      setDados(r);
      setBuscando(false);
    }, 180);
    return () => { cancelado = true; window.clearTimeout(id); };
  }, [termo, comercial, podeFinanceiro]);

  const itens = useMemo(() => {
    const t = termo.trim().toLowerCase();
    const telas = destinos.filter((d) => !t || d.rotulo.toLowerCase().includes(t)).map((d) => ({ grupo: 'Ir para', rotulo: d.rotulo, para: d.para, icone: d.icone }) as Resultado);
    return [...telas, ...dados];
  }, [termo, destinos, dados]);

  useEffect(() => setAtivo(0), [itens.length]);
  useEffect(() => {
    lista.current?.querySelector('.paleta-item.ativo')?.scrollIntoView({ block: 'nearest' });
  }, [ativo]);

  function ir(r: Resultado) { aoFechar(); navegar(r.para); }
  function tecla(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { setAtivo((a) => Math.min(itens.length - 1, a + 1)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setAtivo((a) => Math.max(0, a - 1)); e.preventDefault(); }
    else if (e.key === 'Enter' && itens[ativo]) { ir(itens[ativo]); e.preventDefault(); }
    else if (e.key === 'Escape') aoFechar();
  }

  let grupoAnterior = '';
  return (
    <div className="paleta-fundo" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div className="paleta" role="dialog" aria-modal="true" aria-label="Busca rápida" onKeyDown={tecla}>
        <div className="paleta-busca">
          <Icone nome="busca" />
          <input autoFocus placeholder="Buscar obra, cliente, proposta, lançamento ou tela…" value={termo} onChange={(e) => setTermo(e.target.value)} aria-label="Buscar" />
          <kbd>Esc</kbd>
        </div>
        <ul className="paleta-lista" ref={lista} role="listbox">
          {itens.map((r, i) => {
            const cab = r.grupo !== grupoAnterior ? r.grupo : null;
            grupoAnterior = r.grupo;
            return (
              <li key={r.grupo + r.para + i} role="presentation">
                {cab && <div className="paleta-grupo">{cab}</div>}
                <div role="option" aria-selected={i === ativo} className={`paleta-item${i === ativo ? ' ativo' : ''}`} onMouseMove={() => i !== ativo && setAtivo(i)} onClick={() => ir(r)}>
                  <Icone nome={r.icone} />
                  <span>{r.rotulo}</span>
                  {r.det && <small>{r.det}</small>}
                </div>
              </li>
            );
          })}
        </ul>
        {!itens.length && <div className="paleta-vazio">{buscando ? 'Buscando…' : 'Nada encontrado.'}</div>}
        <div className="paleta-rodape"><span><kbd>↑</kbd> <kbd>↓</kbd> navegar</span><span><kbd>Enter</kbd> abrir</span><span>{buscando ? 'Buscando…' : termo.trim().length < 2 ? 'Digite 2 letras para buscar nos dados' : ''}</span></div>
      </div>
    </div>
  );
}
