// Personalização da aparência: cor principal, menu, fundo, cantos, densidade e texto.
// Tudo muda na hora e fica salvo para o usuário (no aparelho e no banco).
import { useState } from 'react';
import { Topo } from '../components/Layout';
import { Icone } from '../components/Icone';
import { useToast } from '../components/ui';
import { contraste, CORES_PRONTAS, PADRAO, useAparencia, type Aparencia as TAparencia } from '../lib/aparencia';

type Opcao<K extends keyof TAparencia> = { valor: TAparencia[K]; rotulo: string; dica?: string };

function Escolha<K extends keyof TAparencia>({ campo, opcoes, rotulo }: { campo: K; opcoes: Opcao<K>[]; rotulo: string }) {
  const [a, mudar] = useAparencia();
  return (
    <div className="ap-linha">
      <div className="ap-rotulo">{rotulo}</div>
      <div className="segmentado" role="radiogroup" aria-label={rotulo}>
        {opcoes.map((o) => (
          <button key={String(o.valor)} role="radio" aria-checked={a[campo] === o.valor} className={a[campo] === o.valor ? 'ativo' : ''} title={o.dica} onClick={() => mudar({ [campo]: o.valor } as Partial<TAparencia>)}>
            {o.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Miniatura do sistema com as escolhas atuais. */
function Previa() {
  return (
    <div className="ap-previa" aria-hidden="true">
      <div className="ap-previa-menu">
        <img className="logo-pos" src="/marca/rosae-logo-horizontal.svg" alt="" />
        <img className="logo-neg" src="/marca/rosae-logo-horizontal-negativo.svg" alt="" />
        <i className="ativo" /><i /><i /><i />
      </div>
      <div className="ap-previa-corpo">
        <div className="ap-previa-topo"><b>Bom dia, Rhuann</b><span className="ap-previa-botao">Novo orçamento</span></div>
        <div className="ap-previa-kpis">
          {['Recebido', 'A receber', 'Obras ativas'].map((r, i) => (
            <div key={r} className="ap-previa-kpi"><span>{r}</span><b>{['R$ 48 mil', 'R$ 22 mil', '3'][i]}</b></div>
          ))}
        </div>
        <div className="ap-previa-grafico">
          {[38, 62, 45, 80, 58, 92, 70].map((h, i) => <span key={i} style={{ height: `${h}%` }} />)}
        </div>
      </div>
    </div>
  );
}

export function Aparencia() {
  const [a, mudar] = useAparencia();
  const toast = useToast();
  const [hex, setHex] = useState(a.cor);
  const pronta = CORES_PRONTAS.find((c) => c.cor === a.cor);
  const baixoContraste = contraste(a.cor, '#ffffff') < 3;
  const aplicarHex = (v: string) => { setHex(v); if (/^#[0-9a-f]{6}$/i.test(v)) mudar({ cor: v.toLowerCase() }); };

  return (
    <>
      <Topo titulo="Aparência" sub="Deixe o sistema do seu jeito. Muda na hora e fica salvo no seu usuário, no celular e no computador.">
        <button className="btn-secundario" onClick={() => { mudar(PADRAO); setHex(PADRAO.cor); toast('Aparência padrão da ROSAE restaurada.'); }}>
          Restaurar padrão
        </button>
      </Topo>

      <div className="grid ap-grade">
        <div className="stack">
          <section className="card">
            <div className="card-titulo"><div><h2>Cor principal</h2><div className="sub">Botões, destaques e item ativo do menu.</div></div></div>
            <div className="ap-cores" role="radiogroup" aria-label="Cores prontas">
              {CORES_PRONTAS.map((c) => (
                <button key={c.cor} role="radio" aria-checked={a.cor === c.cor} className={`ap-cor${a.cor === c.cor ? ' ativo' : ''}`} onClick={() => { setHex(c.cor); mudar({ cor: c.cor }); }}>
                  <span style={{ background: c.cor }}>{a.cor === c.cor && <Icone nome="check" />}</span>
                  {c.nome}
                </button>
              ))}
            </div>
            <div className="ap-linha" style={{ marginTop: 14 }}>
              <div className="ap-rotulo">Outra cor</div>
              <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                <input type="color" className="ap-seletor" value={a.cor} onChange={(e) => aplicarHex(e.target.value)} aria-label="Escolher cor" />
                <input value={hex} onChange={(e) => aplicarHex(e.target.value.trim())} maxLength={7} style={{ width: 110, fontFamily: 'monospace' }} aria-label="Código da cor" />
                {!pronta && <span className="selo neutro">Personalizada</span>}
              </div>
            </div>
            {baixoContraste && <div className="aviso" style={{ marginTop: 10 }}><Icone nome="alerta" /><span>Cor muito clara: o texto dos botões passa a ser escuro para continuar legível.</span></div>}
          </section>

          <section className="card">
            <div className="card-titulo"><div><h2>Menu e página</h2><div className="sub">Como o menu lateral e o fundo aparecem.</div></div></div>
            <div className="ap-menus" role="radiogroup" aria-label="Estilo do menu">
              {([['claro', 'Claro', 'Branco, minimalista'], ['escuro', 'Escuro', 'Tom profundo da cor'], ['cor', 'Na cor', 'Cor principal']] as const).map(([v, r, d]) => (
                <button key={v} role="radio" aria-checked={a.menu === v} className={`ap-menu ap-menu-${v}${a.menu === v ? ' ativo' : ''}`} onClick={() => mudar({ menu: v })}>
                  <span className="ap-menu-mini"><i /><em /></span>
                  <b>{r}</b><span className="muted small">{d}</span>
                </button>
              ))}
            </div>
            <Escolha campo="fundo" rotulo="Fundo da página" opcoes={[{ valor: 'branco', rotulo: 'Branco' }, { valor: 'gelo', rotulo: 'Gelo' }, { valor: 'cinza', rotulo: 'Cinza claro' }]} />
            <Escolha campo="modo" rotulo="Modo" opcoes={[{ valor: 'claro', rotulo: 'Claro' }, { valor: 'escuro', rotulo: 'Escuro' }, { valor: 'auto', rotulo: 'Automático', dica: 'Segue o celular ou computador' }]} />
          </section>

          <section className="card">
            <div className="card-titulo"><div><h2>Formas e texto</h2><div className="sub">Cantos, espaço entre os itens e tamanho da letra.</div></div></div>
            <Escolha campo="cantos" rotulo="Cantos" opcoes={[{ valor: 'retos', rotulo: 'Retos' }, { valor: 'suaves', rotulo: 'Suaves' }, { valor: 'redondos', rotulo: 'Redondos' }]} />
            <Escolha campo="densidade" rotulo="Espaçamento" opcoes={[{ valor: 'confortavel', rotulo: 'Confortável' }, { valor: 'compacta', rotulo: 'Compacto', dica: 'Mais informação por tela' }]} />
            <Escolha campo="fonte" rotulo="Tamanho do texto" opcoes={[{ valor: 'pequena', rotulo: 'Menor' }, { valor: 'normal', rotulo: 'Normal' }, { valor: 'grande', rotulo: 'Maior' }]} />
          </section>
        </div>

        <div className="ap-lateral">
          <section className="card">
            <div className="card-titulo"><h2>Prévia</h2></div>
            <Previa />
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn-primario"><Icone nome="check" /> Botão principal</button>
              <button className="btn-secundario">Secundário</button>
              <span className="selo">Selo</span>
            </div>
            <p className="muted small" style={{ marginBottom: 0 }}>Propostas, contratos, relatórios e o portal do cliente continuam sempre com as cores da marca ROSAE.</p>
          </section>
        </div>
      </div>
    </>
  );
}
