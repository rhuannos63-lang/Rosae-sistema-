// Exportação completa: JSON com todas as tabelas e CSV por tabela (abre no Excel em português).

export function paraCsv(linhas: Record<string, unknown>[]): string {
  if (linhas.length === 0) return '';
  const colunas = Array.from(new Set(linhas.flatMap((l) => Object.keys(l))));
  const celula = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Separador ";" e BOM para o Excel brasileiro reconhecer acentos e colunas.
  return '﻿' + [colunas.join(';'), ...linhas.map((l) => colunas.map((c) => celula(l[c])).join(';'))].join('\r\n');
}

export function baixarArquivo(nome: string, conteudo: string | Blob, tipo = 'application/octet-stream') {
  const blob = typeof conteudo === 'string' ? new Blob([conteudo], { type: tipo }) : conteudo;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
