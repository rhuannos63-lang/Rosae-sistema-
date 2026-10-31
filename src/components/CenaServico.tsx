// Ilustração viva do serviço no portal do cliente: cada fase da jornada é uma camada do
// desenho. Fase concluída aparece inteira, a atual vai "subindo" conforme o andamento e
// as próximas ficam em traço leve. Um desenho por tipo de serviço.
import { useId, type ReactNode } from 'react';
import type { FaseCalculada, Perfil } from '../core/jornada';

type Caixa = [number, number, number, number]; // x, y, largura, altura

/** Camada da cena: fantasma em traço leve + parte preenchida (de baixo para cima) pelo progresso. */
function Camada({ fase, caixa, children, lado = false }: { fase?: FaseCalculada; caixa: Caixa; children: ReactNode; lado?: boolean }) {
  const id = useId().replace(/:/g, '');
  if (!fase) return null;
  const p = Math.max(0, Math.min(100, fase.progresso)) / 100;
  const [x, y, w, h] = caixa;
  return (
    <g className={`camada ${fase.estado}`} aria-hidden="true">
      <g className="camada-fantasma">{children}</g>
      {p > 0 && (
        <>
          <clipPath id={`c${id}`}>
            {lado ? <rect x={x} y={y} width={w * p} height={h} /> : <rect x={x} y={y + h * (1 - p)} width={w} height={h * p} />}
          </clipPath>
          <g className="camada-cheia" clipPath={`url(#c${id})`}>{children}</g>
        </>
      )}
    </g>
  );
}

function Construcao({ f }: { f: FaseCalculada[] }) {
  const [fund, estr, ved, inst, acab, entr] = f;
  return (
    <>
      <line x1="10" y1="226" x2="390" y2="226" className="chao" />
      <Camada fase={fund} caixa={[70, 206, 260, 34]}>
        <rect x="74" y="210" width="252" height="14" rx="2" className="concreto" />
        {[84, 150, 236, 304].map((x) => <rect key={x} x={x} y="224" width="14" height="14" className="concreto" />)}
      </Camada>
      <Camada fase={estr} caixa={[74, 70, 252, 140]}>
        {[84, 150, 236, 304].map((x) => <rect key={x} x={x} y="76" width="12" height="134" className="concreto" />)}
        <rect x="76" y="140" width="248" height="9" className="concreto" />
        <rect x="76" y="70" width="248" height="9" className="concreto" />
      </Camada>
      <Camada fase={ved} caixa={[60, 18, 280, 192]}>
        <rect x="96" y="149" width="54" height="61" className="parede" /><rect x="162" y="149" width="74" height="61" className="parede" /><rect x="248" y="149" width="56" height="61" className="parede" />
        <rect x="96" y="79" width="54" height="61" className="parede" /><rect x="162" y="79" width="74" height="61" className="parede" /><rect x="248" y="79" width="56" height="61" className="parede" />
        <path d="M60 72 L200 18 L340 72 Z" className="telhado" />
      </Camada>
      <Camada fase={inst} caixa={[100, 84, 200, 124]}>
        <path d="M112 206 V160 H140 V96" className="cano agua" /><path d="M290 206 V170 H262 V100" className="cano luz" />
        <path d="M180 206 V120 H220" className="cano luz" /><circle cx="140" cy="96" r="4" className="ponto" /><circle cx="262" cy="100" r="4" className="ponto" />
      </Camada>
      <Camada fase={acab} caixa={[96, 79, 208, 131]}>
        {[[108, 95], [262, 95], [108, 165], [262, 165]].map(([x, y]) => <rect key={`${x}${y}`} x={x} y={y} width="30" height="26" rx="2" className="janela" />)}
        <rect x="186" y="166" width="26" height="44" rx="2" className="porta" /><rect x="172" y="95" width="54" height="30" rx="2" className="janela" />
      </Camada>
      <Camada fase={entr} caixa={[20, 120, 360, 106]} lado>
        <circle cx="40" cy="190" r="20" className="arvore" /><rect x="37" y="200" width="6" height="26" className="tronco" />
        <circle cx="362" cy="196" r="15" className="arvore" /><rect x="359" y="204" width="6" height="22" className="tronco" />
        <path d="M200 226 L190 248 M200 226 L210 248" className="caminho" />
      </Camada>
    </>
  );
}

function Reforma({ f, ambientes }: { f: FaseCalculada[]; ambientes: { nome: string; executado: number }[] }) {
  if (ambientes.length >= 2) {
    // Planta: um cômodo por ambiente, enchendo conforme o andamento.
    const lista = ambientes.slice(0, 6);
    const col = lista.length <= 4 ? 2 : 3;
    const lin = Math.ceil(lista.length / col);
    const w = 340 / col, h = 210 / lin;
    return (
      <>
        <rect x="28" y="22" width="344" height="214" rx="6" className="planta-borda" />
        {lista.map((a, k) => {
          const x = 30 + (k % col) * w, y = 24 + Math.floor(k / col) * h;
          const p = Math.max(0, Math.min(100, a.executado)) / 100;
          return (
            <g key={a.nome} className={`comodo ${p >= 1 ? 'concluida' : p > 0 ? 'atual' : 'futura'}`}>
              <rect x={x + 3} y={y + 3} width={w - 6} height={h - 6} rx="4" className="comodo-fundo" />
              <rect x={x + 3} y={y + 3 + (h - 6) * (1 - p)} width={w - 6} height={(h - 6) * p} rx="4" className="comodo-cheio" />
              <text x={x + w / 2} y={y + h / 2 - 4} textAnchor="middle" className="comodo-nome">{a.nome.length > 16 ? `${a.nome.slice(0, 15)}…` : a.nome}</text>
              <text x={x + w / 2} y={y + h / 2 + 16} textAnchor="middle" className="comodo-pct">{Math.round(a.executado)}%</text>
            </g>
          );
        })}
      </>
    );
  }
  const [prep, infra, base, acab, entr] = f;
  return (
    <>
      <path d="M40 220 L130 180 L370 180 L370 226 L40 226 Z" className="piso-base" />
      <path d="M130 40 L370 40 L370 180 L130 180 Z" className="parede-fundo" /><path d="M40 70 L130 40 L130 180 L40 220 Z" className="parede-lado" />
      <Camada fase={prep} caixa={[40, 170, 330, 60]}>
        <path d="M60 214 l14 -8 l10 6 l-12 8 Z M300 206 l18 -6 l8 10 l-16 6 Z M220 212 l10 -10 l12 8 l-10 8 Z" className="entulho" />
      </Camada>
      <Camada fase={infra} caixa={[130, 50, 240, 130]}>
        <path d="M160 178 V110 H220 V60" className="cano agua" /><path d="M340 178 V96 H280 V60" className="cano luz" /><circle cx="220" cy="60" r="4" className="ponto" />
      </Camada>
      <Camada fase={base} caixa={[40, 40, 330, 186]}>
        <path d="M130 40 L370 40 L370 180 L130 180 Z" className="reboco" /><path d="M40 70 L130 40 L130 180 L40 220 Z" className="reboco" />
      </Camada>
      <Camada fase={acab} caixa={[40, 40, 330, 186]}>
        <path d="M40 220 L130 180 L370 180 L370 226 L40 226 Z" className="piso-novo" />
        <rect x="170" y="70" width="70" height="56" rx="3" className="janela" /><rect x="290" y="96" width="40" height="84" rx="2" className="porta" />
        <path d="M60 120 L110 100 L110 150 L60 170 Z" className="quadro" />
      </Camada>
      <Camada fase={entr} caixa={[150, 120, 120, 60]} lado>
        <rect x="160" y="150" width="96" height="30" rx="6" className="movel" /><rect x="168" y="138" width="80" height="16" rx="5" className="movel-claro" />
      </Camada>
    </>
  );
}

function Reforco({ f }: { f: FaseCalculada[] }) {
  const [diag, proj, prep, exec, entr] = f;
  return (
    <>
      <line x1="10" y1="230" x2="390" y2="230" className="chao" />
      <rect x="60" y="70" width="34" height="160" className="concreto" /><rect x="306" y="70" width="34" height="160" className="concreto" />
      <rect x="50" y="58" width="300" height="34" className="concreto" />
      <Camada fase={diag} caixa={[110, 56, 200, 50]} lado>
        <path d="M150 92 l6 -10 l-4 -8 l7 -8 M210 92 l-5 -12 l6 -6 l-3 -9 M262 92 l4 -9 l-6 -7" className="fissura" />
      </Camada>
      <Camada fase={proj} caixa={[50, 20, 300, 40]} lado>
        <path d="M50 34 H350 M50 28 V40 M350 28 V40" className="cota" /><text x="200" y="28" textAnchor="middle" className="cota-texto">reforço calculado</text>
      </Camada>
      <Camada fase={prep} caixa={[110, 92, 200, 138]}>
        {[130, 175, 225, 270].map((x) => <g key={x}><rect x={x} y="92" width="6" height="138" className="escora" /><rect x={x - 8} y="92" width="22" height="5" className="escora" /></g>)}
      </Camada>
      <Camada fase={exec} caixa={[44, 52, 312, 178]} lado>
        <rect x="46" y="54" width="308" height="42" rx="3" className="reforco" /><rect x="56" y="92" width="42" height="138" rx="3" className="reforco" /><rect x="302" y="92" width="42" height="138" rx="3" className="reforco" />
        {[80, 120, 160, 200, 240, 280, 320].map((x) => <line key={x} x1={x} y1="54" x2={x} y2="96" className="fibra" />)}
      </Camada>
      <Camada fase={entr} caixa={[170, 130, 60, 60]}>
        <circle cx="200" cy="160" r="26" className="selo-ok" /><path d="M188 160 l9 9 l17 -18" className="selo-check" />
      </Camada>
    </>
  );
}

function Projeto({ f }: { f: FaseCalculada[] }) {
  const [lev, conc, calc, det, entr] = f;
  const xs = [70, 160, 250, 330], ys = [50, 130, 200];
  return (
    <>
      <rect x="20" y="16" width="360" height="226" rx="6" className="prancha" />
      <g className="grade-prancha">{Array.from({ length: 17 }, (_, k) => <line key={`v${k}`} x1={20 + k * 22.5} y1="16" x2={20 + k * 22.5} y2="242" />)}{Array.from({ length: 10 }, (_, k) => <line key={`h${k}`} x1="20" y1={16 + k * 22.6} x2="380" y2={16 + k * 22.6} />)}</g>
      <Camada fase={lev} caixa={[60, 40, 280, 170]}>
        <path d="M64 44 H336 V206 H64 Z M160 44 V130 H64 M250 130 H336" className="traco-planta" />
      </Camada>
      <Camada fase={conc} caixa={[60, 40, 280, 170]}>
        {xs.flatMap((x) => ys.map((y) => <rect key={`${x}${y}`} x={x - 6} y={y - 6} width="12" height="12" className="pilar" />))}
      </Camada>
      <Camada fase={calc} caixa={[60, 40, 280, 170]}>
        {ys.map((y) => <line key={y} x1="64" y1={y} x2="336" y2={y} className="viga" />)}
        {xs.map((x) => <line key={x} x1={x} y1="44" x2={x} y2="206" className="viga" />)}
        {[115, 205, 290].map((x) => <path key={x} d={`M${x} 60 v14 m-4 -5 l4 5 l4 -5`} className="carga" />)}
      </Camada>
      <Camada fase={det} caixa={[60, 40, 280, 190]}>
        <path d="M70 222 H330 M70 216 V228 M330 216 V228" className="cota" /><text x="200" y="218" textAnchor="middle" className="cota-texto">detalhamento</text>
        {[80, 95, 110, 125, 140].map((x) => <line key={x} x1={x} y1="54" x2={x + 8} y2="122" className="armadura" />)}
      </Camada>
      <Camada fase={entr} caixa={[286, 150, 90, 90]}>
        <circle cx="330" cy="190" r="30" className="carimbo" /><text x="330" y="195" textAnchor="middle" className="carimbo-texto">ART</text>
      </Camada>
    </>
  );
}

function Laudo({ f }: { f: FaseCalculada[] }) {
  const [vist, ens, anal, red, entr] = f;
  return (
    <>
      <line x1="10" y1="230" x2="390" y2="230" className="chao" />
      <rect x="40" y="60" width="170" height="170" className="parede" /><path d="M30 64 L125 20 L220 64 Z" className="telhado" />
      {[[62, 90], [140, 90], [62, 160], [140, 160]].map(([x, y]) => <rect key={`${x}${y}`} x={x} y={y} width="44" height="36" rx="2" className="janela" />)}
      <Camada fase={vist} caixa={[40, 80, 180, 130]}>
        {[[84, 108], [162, 178], [120, 140]].map(([x, y]) => <g key={`${x}${y}`}><circle cx={x} cy={y} r="11" className="marcador" /><circle cx={x} cy={y} r="4" className="marcador-ponto" /></g>)}
      </Camada>
      <Camada fase={ens} caixa={[50, 196, 160, 34]} lado>
        {[70, 120, 170].map((x) => <rect key={x} x={x - 9} y="204" width="18" height="22" rx="3" className="ensaio" />)}
      </Camada>
      <Camada fase={anal} caixa={[170, 70, 110, 110]}>
        <circle cx="214" cy="116" r="36" className="lupa" /><line x1="240" y1="142" x2="270" y2="172" className="lupa-cabo" />
      </Camada>
      <Camada fase={red} caixa={[250, 36, 120, 170]}>
        <rect x="256" y="40" width="108" height="150" rx="5" className="folha" />
        {[62, 78, 94, 110, 126, 142].map((y, k) => <line key={y} x1="270" y1={y} x2={k % 3 === 2 ? 320 : 350} y2={y} className="linha-texto" />)}
      </Camada>
      <Camada fase={entr} caixa={[300, 150, 80, 80]}>
        <circle cx="340" cy="176" r="24" className="carimbo" /><text x="340" y="181" textAnchor="middle" className="carimbo-texto">ART</text>
      </Camada>
    </>
  );
}

export function CenaServico({ perfil, fases, ambientes, rotulo }: { perfil: Perfil; fases: FaseCalculada[]; ambientes: { nome: string; executado: number }[]; rotulo: string }) {
  return (
    <svg className={`cena-servico cena-${perfil}`} viewBox="0 0 400 260" role="img" aria-label={rotulo}>
      {perfil === 'projeto' && <Projeto f={fases} />}
      {perfil === 'reforco' && <Reforco f={fases} />}
      {perfil === 'reforma' && <Reforma f={fases} ambientes={ambientes} />}
      {perfil === 'laudo' && <Laudo f={fases} />}
      {(perfil === 'construcao' || perfil === 'gestao') && <Construcao f={perfil === 'gestao' ? [fases[0], fases[1], fases[2], fases[2], fases[3], fases[4]] : fases} />}
    </svg>
  );
}
