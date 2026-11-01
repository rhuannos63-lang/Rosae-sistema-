// Assinatura da marca: curvas de nível suaves em forma de rosa de cinco pétalas.
// Desenhada aqui em SVG (e não por máscara de CSS) para sair igual na tela e no PDF.
import { useId, useMemo } from 'react';

/** Caminhos das curvas: pétalas marcadas no centro que se abrem em ondas largas. */
export function curvasDaRosa(n = 22, pontos = 48): string[] {
  const linhas: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const raio = 70 + Math.pow(t, 1.1) * 560;
    const petala = 0.15 * Math.pow(1 - t, 1.4) + 0.012;
    const fase = -Math.PI / 2 + t * 0.55;
    const cx = 600 + 26 * t, cy = 600 - 18 * t;
    const p: [number, number][] = [];
    for (let k = 0; k < pontos; k++) {
      const a = (k / pontos) * Math.PI * 2;
      const r = raio * (1 + petala * Math.cos(5 * (a - fase)) + 0.018 * Math.sin(2 * a + t * 4) + 0.01 * Math.cos(3 * a - t * 6));
      p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    const f = (x: number) => x.toFixed(1);
    let d = `M${f(p[0][0])} ${f(p[0][1])}`;
    for (let k = 0; k < pontos; k++) {
      const [p0, p1, p2, p3] = [p[(k - 1 + pontos) % pontos], p[k], p[(k + 1) % pontos], p[(k + 2) % pontos]];
      d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
    }
    linhas.push(`${d}Z`);
  }
  return linhas;
}

let cache: string[] | null = null;

/** Rosa topográfica com as bordas se dissolvendo. A cor vem de `color` (currentColor). */
export function RosaTopografica({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '');
  const linhas = useMemo(() => (cache ??= curvasDaRosa()), []);
  return (
    <svg className={className} viewBox="0 0 1200 1200" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`g${id}`} cx="50%" cy="50%" r="50%">
          <stop offset="0.3" stopColor="#fff" />
          <stop offset="0.75" stopColor="#fff" stopOpacity="0.4" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id={`m${id}`}><rect width="1200" height="1200" fill={`url(#g${id})`} /></mask>
      </defs>
      <g mask={`url(#m${id})`} fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round">
        {linhas.map((d, k) => <path key={k} d={d} />)}
      </g>
    </svg>
  );
}
