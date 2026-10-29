// Leitura do XML da NF-e (modelo 55) e NFC-e (65). O arquivo é dado externo:
// só extraímos campos conhecidos, nunca executamos nada dele. A distribuição de
// frete, desconto e acréscimos usa o valor do próprio item quando o XML traz e
// fecha; senão, é proporcional ao valor dos produtos (maior resto, em centavos).
import { ratear, type Centavos } from './dinheiro';

type No = { nome: string; attrs: Record<string, string>; filhos: No[]; texto: string };

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodificar(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENTIDADES[e] ?? m;
  });
}

/** Parser mínimo de XML bem formado (sem DTD). Remove prefixos de namespace. */
export function lerXml(xml: string): No {
  const raiz: No = { nome: '#raiz', attrs: {}, filhos: [], texto: '' };
  const pilha: No[] = [raiz];
  const limpo = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(limpo))) {
    const topo = pilha[pilha.length - 1];
    if (m[1] !== undefined) { topo.texto += m[1]; continue; }
    if (m[6] !== undefined) { topo.texto += decodificar(m[6]); continue; }
    const nome = m[3].replace(/^.*:/, '');
    if (m[2]) {
      if (pilha.length > 1 && topo.nome === nome) pilha.pop();
      else throw new Error('XML mal formado.');
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1].replace(/^.*:/, '')] = decodificar(a[2] ?? a[3] ?? '');
    const no: No = { nome, attrs, filhos: [], texto: '' };
    topo.filhos.push(no);
    if (!m[5]) pilha.push(no);
  }
  if (pilha.length !== 1) throw new Error('XML incompleto.');
  return raiz;
}

function achar(no: No | undefined, caminho: string): No | undefined {
  let atual = no;
  for (const p of caminho.split('/')) {
    if (!atual) return undefined;
    atual = p === '*' ? atual.filhos[0] : atual.filhos.find((f) => f.nome === p);
  }
  return atual;
}
function buscar(no: No | undefined, nome: string): No | undefined {
  if (!no) return undefined;
  for (const f of no.filhos) {
    if (f.nome === nome) return f;
    const r = buscar(f, nome);
    if (r) return r;
  }
  return undefined;
}
function todos(no: No | undefined, nome: string): No[] {
  return no ? no.filhos.filter((f) => f.nome === nome) : [];
}
const txt = (no: No | undefined, caminho: string) => achar(no, caminho)?.texto.trim() || null;

/** "123.45" (XML) → centavos inteiros, sem ponto flutuante. */
export function centavosXml(v: string | null | undefined): Centavos {
  if (!v) return 0;
  const m = /^(-?)(\d+)(?:\.(\d{1,10}))?$/.exec(v.trim());
  if (!m) throw new Error(`Valor inválido no XML: ${v}`);
  const dec = (m[3] ?? '').padEnd(3, '0');
  let c = Number(m[2]) * 100 + Number(dec.slice(0, 2));
  if (Number(dec[2]) >= 5) c += 1; // arredonda a 3ª casa (raro em valores de nota)
  return m[1] ? -c : c;
}

/** Dígito verificador da chave de acesso (módulo 11). */
export function chaveValida(chave: string): boolean {
  if (!/^\d{44}$/.test(chave)) return false;
  let soma = 0, peso = 2;
  for (let i = 42; i >= 0; i--) { soma += Number(chave[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const resto = soma % 11;
  const dv = resto < 2 ? 0 : 11 - resto;
  return dv === Number(chave[43]);
}

export type ItemLido = {
  numero: number; codigo: string | null; descricao: string; ncm: string | null; unidade: string | null;
  quantidade: number; valor_bruto: Centavos; frete: Centavos; desconto: Centavos; outros: Centavos;
};
export type NotaLida = {
  chave: string | null; modelo: string | null; numero: string | null; serie: string | null;
  emitente: { documento: string | null; nome: string | null };
  data_emissao: string | null;
  totais: { produtos: Centavos; frete: Centavos; desconto: Centavos; outros: Centavos; total: Centavos };
  itens: ItemLido[];
  duplicatas: { numero: string | null; vencimento: string; valor: Centavos }[];
  criterio: 'informado_no_xml' | 'proporcional';
  avisos: string[];
};

export const valorFinal = (i: Pick<ItemLido, 'valor_bruto' | 'frete' | 'desconto' | 'outros'>): Centavos => i.valor_bruto + i.frete + i.outros - i.desconto;

/** Distribui um valor do cabeçalho entre os itens, proporcional ao valor dos produtos. */
function distribuir(total: Centavos, pesos: Centavos[]): Centavos[] {
  if (total === 0 || pesos.length === 0) return pesos.map(() => 0);
  if (pesos.every((p) => p === 0)) return ratear(total, pesos.map(() => 1));
  return ratear(total, pesos);
}

export function lerNfe(xml: string): NotaLida {
  if (xml.length > 5_000_000) throw new Error('Arquivo grande demais para uma nota.');
  const raiz = lerXml(xml);
  const inf = buscar(raiz, 'infNFe');
  if (!inf) throw new Error('Este arquivo não parece ser o XML de uma NF-e (falta “infNFe”).');
  const avisos: string[] = [];
  const ide = achar(inf, 'ide'), emit = achar(inf, 'emit');
  const chaveId = (inf.attrs.Id ?? '').replace(/^NFe/, '');
  const prot = buscar(raiz, 'infProt');
  const chave = txt(prot, 'chNFe') || (chaveId || null);
  if (!chave) avisos.push('O arquivo não traz a chave de acesso.');
  else if (!chaveValida(chave)) avisos.push('A chave de acesso não confere (dígito verificador). Confira o arquivo.');
  const cStat = txt(prot, 'cStat');
  if (!prot) avisos.push('O arquivo não traz o protocolo de autorização da SEFAZ (pode ser só o XML assinado). Confira se a nota foi autorizada.');
  else if (cStat && !['100', '150'].includes(cStat)) avisos.push(`Situação na SEFAZ: código ${cStat} (não é “autorizada”). Confira antes de lançar.`);
  const modelo = txt(ide, 'mod');
  if (modelo === '65') avisos.push('NFC-e (cupom): costuma não identificar o comprador.');
  const dataHora = txt(ide, 'dhEmi') ?? txt(ide, 'dEmi');
  const data_emissao = dataHora ? dataHora.slice(0, 10) : null;
  if (!data_emissao) avisos.push('Data de emissão não encontrada.');

  const tot = achar(inf, 'total/ICMSTot');
  const vProd = centavosXml(txt(tot, 'vProd')), vFrete = centavosXml(txt(tot, 'vFrete')), vDesc = centavosXml(txt(tot, 'vDesc'));
  const vNF = centavosXml(txt(tot, 'vNF'));
  if (vNF <= 0) throw new Error('Total da nota (vNF) não encontrado.');
  // Acréscimos (seguro, outras despesas, IPI, ST, II...) = o que falta para fechar o total.
  let vOutros = vNF - vProd - vFrete + vDesc;
  let descontoExtra = 0;
  if (vOutros < 0) { descontoExtra = -vOutros; vOutros = 0; avisos.push('O total da nota é menor que produtos + frete − desconto (por exemplo, ICMS desonerado). A diferença entrou como desconto.'); }

  const dets = todos(inf, 'det');
  if (!dets.length) throw new Error('A nota não tem itens.');
  const itens: ItemLido[] = dets.map((d, k) => {
    const p = achar(d, 'prod');
    const imp = achar(d, 'imposto');
    const qtd = Number(txt(p, 'qCom') ?? '1');
    const outrosItem = ['vSeg', 'vOutro'].reduce((s, c) => s + centavosXml(txt(p, c)), 0)
      + centavosXml(buscar(achar(imp, 'IPI'), 'vIPI')?.texto) + centavosXml(buscar(achar(imp, 'ICMS'), 'vICMSST')?.texto)
      + centavosXml(buscar(achar(imp, 'II'), 'vII')?.texto) + centavosXml(buscar(achar(imp, 'ICMS'), 'vFCPST')?.texto);
    return {
      numero: Number(d.attrs.nItem ?? k + 1),
      codigo: txt(p, 'cProd'), descricao: (txt(p, 'xProd') ?? 'Item sem descrição').slice(0, 300), ncm: txt(p, 'NCM'), unidade: txt(p, 'uCom'),
      quantidade: Number.isFinite(qtd) && qtd > 0 ? qtd : 1,
      valor_bruto: centavosXml(txt(p, 'vProd')),
      frete: centavosXml(txt(p, 'vFrete')), desconto: centavosXml(txt(p, 'vDesc')), outros: outrosItem,
    };
  });
  const soma = (f: (i: ItemLido) => number) => itens.reduce((s, i) => s + f(i), 0);
  if (soma((i) => i.valor_bruto) !== vProd) avisos.push('A soma dos produtos dos itens difere do total de produtos da nota.');

  const usaItem = soma((i) => i.frete) === vFrete && soma((i) => i.desconto) === vDesc + descontoExtra && soma((i) => i.outros) === vOutros;
  const pesos = itens.map((i) => i.valor_bruto);
  if (!usaItem) {
    const fr = distribuir(vFrete, pesos), de = distribuir(vDesc + descontoExtra, pesos), ou = distribuir(vOutros, pesos);
    itens.forEach((i, k) => { i.frete = fr[k]; i.desconto = de[k]; i.outros = ou[k]; });
  }
  const dif = vNF - soma(valorFinal);
  if (dif !== 0) {
    const maior = itens.reduce((a, b) => (b.valor_bruto > a.valor_bruto ? b : a));
    maior.outros += dif;
    avisos.push(`Ajuste de ${(dif / 100).toFixed(2).replace('.', ',')} no item ${maior.numero} para a soma fechar com o total.`);
  }

  const duplicatas = todos(achar(inf, 'cobr'), 'dup').map((d) => ({
    numero: txt(d, 'nDup'), vencimento: txt(d, 'dVenc') ?? data_emissao ?? '', valor: centavosXml(txt(d, 'vDup')),
  })).filter((d) => d.valor > 0 && /^\d{4}-\d{2}-\d{2}$/.test(d.vencimento));
  if (duplicatas.length && duplicatas.reduce((s, d) => s + d.valor, 0) !== vNF) {
    avisos.push('As duplicatas não somam o total da nota; a conta a pagar terá uma parcela única.');
  }

  return {
    chave, modelo, numero: txt(ide, 'nNF'), serie: txt(ide, 'serie'),
    emitente: { documento: txt(emit, 'CNPJ') ?? txt(emit, 'CPF'), nome: txt(emit, 'xNome') ?? txt(emit, 'xFant') },
    data_emissao,
    totais: { produtos: vProd, frete: vFrete, desconto: vDesc + descontoExtra, outros: vOutros, total: vNF },
    itens, duplicatas, criterio: usaItem ? 'informado_no_xml' : 'proporcional', avisos,
  };
}

// ---------------------------------------------------------------------
// Leitura de foto ou PDF pela IA: os dados chegam como sugestão e passam
// pelas mesmas contas do XML (rateio de frete/desconto, soma exata, avisos).
// ---------------------------------------------------------------------
export type LeituraIa = {
  emitente_nome?: string | null; emitente_documento?: string | null; numero?: string | null; serie?: string | null; chave?: string | null;
  data_emissao?: string | null; frete?: number | null; desconto?: number | null; outros?: number | null; total?: number | null;
  itens: { descricao: string; quantidade?: number | null; unidade?: string | null; valor_total?: number | null }[];
  duplicatas?: { vencimento: string; valor: number }[];
  incertos: string[];
};

const emCentavos = (v: number | null | undefined): Centavos => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 100) : 0);
const texto = (v: string | null | undefined, max = 120): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export function notaDaLeitura(l: LeituraIa): NotaLida {
  const avisos = ['Lida pela IA a partir de foto ou PDF: confira emitente, número, itens e valores com o documento antes de confirmar.'];
  for (const x of (l.incertos ?? []).slice(0, 10)) avisos.push(`A IA não teve certeza: ${String(x).slice(0, 160)}.`);
  const digitos = (l.chave ?? '').replace(/\D/g, '');
  const chave = digitos.length === 44 && chaveValida(digitos) ? digitos : null;
  if (digitos && !chave) avisos.push('A chave de acesso lida não confere (dígito verificador): ficou em branco.');
  const data = texto(l.data_emissao, 10);
  const data_emissao = data && /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : null;
  if (!data_emissao) avisos.push('Data de emissão não encontrada.');

  const itens: ItemLido[] = (l.itens ?? []).slice(0, 300).map((i, k) => ({
    numero: k + 1, codigo: null, descricao: (texto(i.descricao, 300) ?? 'Item sem descrição'), ncm: null, unidade: texto(i.unidade, 10),
    quantidade: typeof i.quantidade === 'number' && i.quantidade > 0 ? i.quantidade : 1,
    valor_bruto: emCentavos(i.valor_total), frete: 0, desconto: 0, outros: 0,
  })).filter((i) => i.valor_bruto > 0);
  const vProdItens = itens.reduce((s, i) => s + i.valor_bruto, 0);
  const vFrete = emCentavos(l.frete), vDesc = emCentavos(l.desconto);
  let vOutros = emCentavos(l.outros);
  const vNF = emCentavos(l.total) || vProdItens + vFrete + vOutros - vDesc;
  if (vNF <= 0) throw new Error('Não consegui ler o total da nota. Tente uma foto mais nítida ou use a nota manual.');
  if (!itens.length) {
    itens.push({ numero: 1, codigo: null, descricao: 'Itens da nota (não lidos um a um)', ncm: null, unidade: null, quantidade: 1, valor_bruto: vNF - vFrete - vOutros + vDesc, frete: 0, desconto: 0, outros: 0 });
    avisos.push('Os itens não foram lidos um a um: entrou um item único com o valor dos produtos.');
  }
  let vProd = itens.reduce((s, i) => s + i.valor_bruto, 0);
  let descontoExtra = 0;
  const resto = vNF - vProd - vFrete - vOutros + vDesc;
  if (resto > 0) { vOutros += resto; avisos.push(`A soma dos itens ficou ${formatarReais(resto)} abaixo do total: a diferença entrou como acréscimo. Confira se faltou algum item.`); }
  if (resto < 0) { descontoExtra = -resto; avisos.push(`A soma dos itens passou ${formatarReais(-resto)} do total: a diferença entrou como desconto. Confira os valores.`); }
  vProd = itens.reduce((s, i) => s + i.valor_bruto, 0);
  const pesos = itens.map((i) => i.valor_bruto);
  const fr = distribuir(vFrete, pesos), de = distribuir(vDesc + descontoExtra, pesos), ou = distribuir(vOutros, pesos);
  itens.forEach((i, k) => { i.frete = fr[k]; i.desconto = de[k]; i.outros = ou[k]; });

  const duplicatas = (l.duplicatas ?? []).map((d) => ({ numero: null, vencimento: String(d.vencimento ?? ''), valor: emCentavos(d.valor) }))
    .filter((d) => d.valor > 0 && /^\d{4}-\d{2}-\d{2}$/.test(d.vencimento));
  const docEmit = (l.emitente_documento ?? '').replace(/\D/g, '');
  return {
    chave, modelo: null, numero: texto(l.numero, 20), serie: texto(l.serie, 5),
    emitente: { documento: docEmit.length === 11 || docEmit.length === 14 ? docEmit : null, nome: texto(l.emitente_nome, 120) },
    data_emissao,
    totais: { produtos: vProd, frete: vFrete, desconto: vDesc + descontoExtra, outros: vOutros, total: vNF },
    itens,
    duplicatas: duplicatas.reduce((s, d) => s + d.valor, 0) === vNF ? duplicatas : [],
    criterio: 'proporcional', avisos,
  };
}

const formatarReais = (c: Centavos) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
