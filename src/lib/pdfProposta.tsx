// Gera o arquivo PDF da proposta no próprio aparelho: páginas deitadas 16:9 (como uma
// apresentação), iguais em qualquer tela, com os botões "Aceitar" clicáveis.
import { createRoot } from 'react-dom/client';
import { PropostaDocumento, type DadosDocumento } from '../components/PropostaDocumento';

const LARGURA_PX = 1600;
const LARGURA_MM = 338.67;
const ALTURA_MM = 190.5;

const quadro = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Nome de arquivo seguro: "Proposta PRO-2026-014 v1 - Marina Duarte.pdf". */
export function nomeDoPdf(d: Pick<DadosDocumento, 'codigo' | 'versao' | 'cliente'>): string {
  const cliente = d.cliente.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `Proposta ${d.codigo} v${d.versao}${cliente ? ` - ${cliente}` : ''}.pdf`;
}

/**
 * Monta a proposta fora da tela em largura fixa, fotografa cada página em alta resolução
 * e junta tudo num PDF. Os links (botões de aceite) viram áreas clicáveis no arquivo.
 */
export async function gerarPdfProposta(d: DadosDocumento, opcoes: { aceite?: string | null; aoProgredir?: (feito: number, total: number) => void } = {}): Promise<Blob> {
  const [{ toJpeg, getFontEmbedCSS }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, { position: 'fixed', left: '-20000px', top: '0', width: `${LARGURA_PX}px`, pointerEvents: 'none', background: '#fff' });
  document.body.appendChild(host);
  const raiz = createRoot(host);
  try {
    raiz.render(<PropostaDocumento d={d} pdf={{ aceite: opcoes.aceite ?? null }} />);
    await quadro(); await quadro();
    await document.fonts?.ready;
    await Promise.all(Array.from(host.querySelectorAll('img')).map((i) => i.decode().catch(() => undefined)));
    // Dá tempo para cada folha ajustar o tamanho da letra e caber inteira.
    await esperar(350); await quadro();

    const folhas = Array.from(host.querySelectorAll<HTMLElement>('.slide'));
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [LARGURA_MM, ALTURA_MM], compress: true });
    pdf.setProperties({ title: `Proposta ${d.codigo} · ${d.titulo}`, subject: d.titulo, author: d.empresa?.nome ?? 'ROSAE Engenharia & Estruturas', creator: d.empresa?.nome ?? 'ROSAE Engenharia & Estruturas' });
    const fontes = await getFontEmbedCSS(host).catch(() => undefined);
    for (let k = 0; k < folhas.length; k++) {
      const folha = folhas[k];
      const caixa = folha.getBoundingClientRect();
      const img = await toJpeg(folha, { quality: 0.9, pixelRatio: 1.4, backgroundColor: '#ffffff', fontEmbedCSS: fontes, width: caixa.width, height: caixa.height });
      if (k > 0) pdf.addPage([LARGURA_MM, ALTURA_MM], 'landscape');
      pdf.addImage(img, 'JPEG', 0, 0, LARGURA_MM, ALTURA_MM, undefined, 'FAST');
      const escala = LARGURA_MM / caixa.width;
      for (const a of Array.from(folha.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
        const r = a.getBoundingClientRect();
        pdf.link((r.left - caixa.left) * escala, (r.top - caixa.top) * escala, r.width * escala, r.height * escala, { url: a.href });
      }
      opcoes.aoProgredir?.(k + 1, folhas.length);
    }
    return pdf.output('blob');
  } finally {
    raiz.unmount();
    host.remove();
  }
}

/** Salva o arquivo no aparelho. */
export function baixarArquivo(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Abre o compartilhar do aparelho com o arquivo anexado (WhatsApp, e-mail…). Falso se o aparelho não permite. */
export async function compartilharArquivo(blob: Blob, nome: string, texto: string): Promise<'enviado' | 'cancelado' | 'sem-suporte'> {
  const arquivo = new File([blob], nome, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (!nav.share || !nav.canShare?.({ files: [arquivo] })) return 'sem-suporte';
  try {
    await nav.share({ files: [arquivo], text: texto, title: nome.replace(/\.pdf$/, '') });
    return 'enviado';
  } catch (e) {
    return e instanceof DOMException && e.name === 'AbortError' ? 'cancelado' : 'sem-suporte';
  }
}

/** Conteúdo do arquivo em base64 (para anexar no e-mail). */
export async function paraBase64(blob: Blob): Promise<string> {
  const dados = await new Promise<string>((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => falha(r.error);
    r.readAsDataURL(blob);
  });
  return dados.slice(dados.indexOf(',') + 1);
}
