// Condições da obra e logística: o engenheiro marca o que vale para o local (escada, aclive,
// condomínio, imóvel ocupado...) e o custo de mão de obra e material sobe junto.
import { acrescimoDas, alternarCodigo, gruposDe, textoAcrescimo, type CondicaoObra } from '../core/condicoes';

const pct = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

export function SeletorCondicoes({ base, marcadas, aoMudar, compacto, ocultar = [] }: {
  base: CondicaoObra[]; marcadas: string[]; aoMudar: (codigos: string[]) => void; compacto?: boolean;
  /** Condições já cobertas por uma pergunta do serviço (ex.: imóvel ocupado na reforma). */
  ocultar?: string[];
}) {
  const visiveis = base.filter((c) => !ocultar.includes(c.codigo));
  const grupos = gruposDe(visiveis);
  const acr = acrescimoDas(marcadas, visiveis);
  if (!grupos.length) return <p className="muted small">Nenhuma condição cadastrada. Cadastre em Insumos e composições → Condições da obra.</p>;
  return (
    <div className={`condicoes-sel${compacto ? ' compacto' : ''}`}>
      {grupos.map((g) => (
        <fieldset key={g.grupo} className="condicoes-grupo">
          <legend>{g.grupo}</legend>
          <div className="condicoes-lista">
            {g.itens.map((c) => {
              const ativo = marcadas.includes(c.codigo);
              return (
                <button key={c.codigo} type="button" role="checkbox" aria-checked={ativo} className={`condicao${ativo ? ' ativo' : ''}`} title={c.descricao ?? undefined} onClick={() => aoMudar(alternarCodigo(marcadas, c.codigo))}>
                  <span className="condicao-nome">{c.nome}</span>
                  <span className="condicao-pct">{[c.mao_de_obra_pct > 0 ? `+${pct(c.mao_de_obra_pct)}% M.O.` : '', c.material_pct > 0 ? `+${pct(c.material_pct)}% mat.` : ''].filter(Boolean).join(' · ') || 'sem acréscimo'}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      <p className="condicoes-total small">{acr.nomes.length ? <>Com {acr.nomes.length === 1 ? '1 condição' : `${acr.nomes.length} condições`}: <b>{textoAcrescimo(acr)}</b>.</> : 'Nenhuma condição marcada: local de acesso fácil, sem acréscimo.'}</p>
    </div>
  );
}
