// Encaixe na agenda: quando um trabalho novo pode começar sem bater com os que já estão na
// fila (obras em andamento, propostas aceitas e, se quiser, as em aberto).
import { Link } from 'react-router-dom';
import { useConsulta } from '../lib/consulta';
import { useAuth } from '../auth/AuthProvider';
import { carregarFila, type Fila } from '../lib/agenda';
import { formatarData, somarDias } from '../core/datas';

/** Busca a fila uma vez (a data livre não depende do tamanho do trabalho novo). */
export function useFila(ignorar?: string | null): Fila | null {
  const { usuario } = useAuth();
  const pode = usuario?.papel === 'administrador' || usuario?.papel === 'administrativo';
  const { dados } = useConsulta(() => (pode ? carregarFila(null, ignorar).catch(() => null) : Promise.resolve(null)), [pode, ignorar]);
  return dados;
}

export function EncaixeAgenda({ fila, dias, inicio, aoUsar }: { fila: Fila | null; dias: number; inicio?: string | null; aoUsar?: (data: string) => void }) {
  if (!fila) return null;
  const n = Math.max(1, Math.round(dias || 1));
  const fim = somarDias(fila.livre, n - 1);
  const ocupados = fila.fila.filter((x) => x.fim >= fila.hoje).slice(-3);
  const conflito = inicio && inicio < fila.livre ? fila.fila.find((x) => x.inicio <= somarDias(inicio, n - 1) && x.fim >= inicio) : null;
  return (
    <div className="encaixe">
      <span>Pela sua agenda, este trabalho começa em <b>{formatarData(fila.livre)}</b> e termina em <b>{formatarData(fim)}</b> ({n} dias).</span>
      {ocupados.length > 0 && (
        <span className="encaixe-fila">Depois de: {ocupados.map((x) => <span key={x.tipo + x.id}>{x.titulo} até {formatarData(x.fim).slice(0, 5)}{x.situacao === 'em_aberto' ? ' (em aberto)' : ''}</span>)}</span>
      )}
      {conflito && fila.paralelos === 1 && <span style={{ color: 'var(--alerta)' }}>O início {formatarData(inicio)} cai junto com {conflito.titulo}.</span>}
      <span className="row" style={{ gap: 10 }}>
        {aoUsar && inicio !== fila.livre && <button type="button" className="btn-secundario btn-mini" onClick={() => aoUsar(fila.livre)}>Usar {formatarData(fila.livre).slice(0, 5)} como início</button>}
        <Link className="btn-link small" to="/agenda">Ver a agenda</Link>
      </span>
    </div>
  );
}
