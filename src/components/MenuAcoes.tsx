// Botão "⋯" que guarda as ações de pouco uso, para o topo da tela ter só o essencial.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icone } from './Icone';

export function MenuAcoes({ children, rotulo = 'Mais ações', texto }: { children: ReactNode; rotulo?: string; texto?: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);
  return (
    <div className="menu-acoes" ref={ref}>
      <button type="button" className={texto ? 'btn-primario' : 'btn-secundario'} aria-haspopup="menu" aria-expanded={aberto} aria-label={texto ? undefined : rotulo} title={rotulo} onClick={() => setAberto((x) => !x)}>
        {texto ?? <Icone nome="menu" />}
      </button>
      {/* Fica montado mesmo fechado: ações que abrem janela (como Excluir) continuam vivas. */}
      <div className="menu-acoes-lista" role="menu" hidden={!aberto} onClick={() => setAberto(false)}>{children}</div>
    </div>
  );
}
