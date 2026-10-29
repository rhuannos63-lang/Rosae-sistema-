import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icone } from './Icone';
import { formatar, formatarCampo, lerDigitado, type Centavos } from '../core/dinheiro';

export function Modal({ titulo, aoFechar, children, rodape, largo }: { titulo: string; aoFechar: () => void; children: ReactNode; rodape?: ReactNode; largo?: boolean }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && aoFechar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [aoFechar]);
  // No body: a animação de entrada da página cria um novo contexto de posição, e a janela
  // sairia do centro da tela em páginas longas.
  return createPortal(
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div className={`modal${largo ? ' largo' : ''}`} role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal-cab">
          <h2>{titulo}</h2>
          <button className="btn-link" onClick={aoFechar} aria-label="Fechar">
            <Icone nome="fechar" />
          </button>
        </div>
        <div className="modal-corpo">{children}</div>
        {rodape && <div className="modal-rodape">{rodape}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Explicação curta sobre um número ou campo. */
export function Ajuda({ children }: { children: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  return (
    <span className="ajuda" onMouseLeave={() => setAberto(false)}>
      <button type="button" aria-label="O que é isto?" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setAberto((v) => !v); }} onMouseEnter={() => setAberto(true)}>
        <Icone nome="ajuda" />
      </button>
      {aberto && <span className="balao" role="tooltip">{children}</span>}
    </span>
  );
}

export function Dinheiro({ valor, sinal }: { valor: Centavos; sinal?: boolean }) {
  const cls = sinal ? (valor > 0 ? 'favoravel' : valor < 0 ? 'desfavoravel' : '') : '';
  return <span className={`num ${cls}`} style={cls ? { color: `var(--${cls})` } : undefined}>{formatar(valor)}</span>;
}

/** Campo de valor em reais. Guarda centavos inteiros; aceita "1.234,56". */
export function CampoValor({ valor, aoMudar, id, obrigatorio, autoFocus }: { valor: Centavos | null; aoMudar: (c: Centavos | null) => void; id?: string; obrigatorio?: boolean; autoFocus?: boolean }) {
  const [texto, setTexto] = useState(valor === null ? '' : formatarCampo(valor));
  const [invalido, setInvalido] = useState(false);
  useEffect(() => {
    const atual = lerDigitado(texto);
    if (atual !== valor) setTexto(valor === null ? '' : formatarCampo(valor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);
  return (
    <>
      <input
        id={id}
        className="valor"
        inputMode="decimal"
        placeholder="0,00"
        value={texto}
        required={obrigatorio}
        autoFocus={autoFocus}
        aria-invalid={invalido}
        onChange={(e) => {
          setTexto(e.target.value);
          const c = lerDigitado(e.target.value);
          setInvalido(e.target.value.trim() !== '' && c === null);
          aoMudar(c);
        }}
        onBlur={() => {
          const c = lerDigitado(texto);
          if (c !== null) setTexto(formatarCampo(c));
        }}
      />
      {invalido && <span className="erro-campo">Valor não reconhecido. Use, por exemplo, 1.250,00</span>}
    </>
  );
}

export function Vazio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="vazio">
      <h3>{titulo}</h3>
      {children}
    </div>
  );
}

export function Carregando() {
  return <div className="carregando">Carregando…</div>;
}

export function Erro({ mensagem }: { mensagem: string | null }) {
  if (!mensagem) return null;
  return (
    <div className="aviso erro" role="alert">
      <Icone nome="alerta" />
      <span>{mensagem}</span>
    </div>
  );
}

const ToastCtx = createContext<(msg: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const mostrar = useCallback((m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={mostrar}>
      {children}
      {msg && <div className="toast" role="status">{msg}</div>}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
