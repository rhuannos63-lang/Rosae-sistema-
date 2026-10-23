import { describe, expect, it } from 'vitest';
import { centavosXml, chaveValida, lerNfe, lerXml, valorFinal } from './nfe';

function comDv(base43: string): string {
  let soma = 0, peso = 2;
  for (let i = 42; i >= 0; i--) { soma += Number(base43[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11;
  return base43 + (r < 2 ? 0 : 11 - r);
}
const CHAVE = comDv('3326101234567800019955001000001234100001234');

function xml({ itens, tot, dup = '', prot = true }: { itens: string; tot: string; dup?: string; prot?: boolean }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${CHAVE}" versao="4.00">
<ide><mod>55</mod><serie>1</serie><nNF>1234</nNF><dhEmi>2026-10-15T09:30:00-03:00</dhEmi></ide>
<emit><CNPJ>12345678000199</CNPJ><xNome>Loja Fictícia &amp; Cia</xNome></emit>
${itens}<total><ICMSTot>${tot}</ICMSTot></total>${dup}
</infNFe></NFe>${prot ? `<protNFe><infProt><chNFe>${CHAVE}</chNFe><cStat>100</cStat></infProt></protNFe>` : ''}</nfeProc>`;
}
const det = (n: number, vProd: string, extra = '', imposto = '') =>
  `<det nItem="${n}"><prod><cProd>C${n}</cProd><xProd>Item ${n}</xProd><NCM>25232910</NCM><uCom>UN</uCom><qCom>2.0000</qCom><vProd>${vProd}</vProd>${extra}</prod><imposto>${imposto}</imposto></det>`;

describe('nfe', () => {
  it('centavos sem ponto flutuante e chave', () => {
    expect(centavosXml('1234.56')).toBe(123456);
    expect(centavosXml('0.1')).toBe(10);
    expect(centavosXml('10.005')).toBe(1001);
    expect(chaveValida(CHAVE)).toBe(true);
    expect(chaveValida(CHAVE.slice(0, 43) + ((Number(CHAVE[43]) + 1) % 10))).toBe(false);
  });

  it('distribui frete e desconto proporcionalmente e fecha o total', () => {
    const n = lerNfe(xml({ itens: det(1, '600.00') + det(2, '300.00'), tot: '<vProd>900.00</vProd><vFrete>20.00</vFrete><vDesc>10.00</vDesc><vNF>910.00</vNF>',
      dup: '<cobr><dup><nDup>001</nDup><dVenc>2026-11-15</dVenc><vDup>455.00</vDup></dup><dup><nDup>002</nDup><dVenc>2026-12-15</dVenc><vDup>455.00</vDup></dup></cobr>' }));
    expect(n.chave).toBe(CHAVE);
    expect(n.emitente).toEqual({ documento: '12345678000199', nome: 'Loja Fictícia & Cia' });
    expect(n.data_emissao).toBe('2026-10-15');
    expect(n.criterio).toBe('proporcional');
    expect(n.itens.map((i) => [i.frete, i.desconto])).toEqual([[1333, 667], [667, 333]]);
    expect(n.itens.reduce((s, i) => s + valorFinal(i), 0)).toBe(91000);
    expect(n.duplicatas).toHaveLength(2);
    expect(n.avisos).toEqual([]);
  });

  it('usa os valores do item quando o XML traz e fecha; IPI entra como acréscimo', () => {
    const n = lerNfe(xml({
      itens: det(1, '100.00', '<vFrete>5.00</vFrete>', '<IPI><IPITrib><vIPI>10.00</vIPI></IPITrib></IPI>') + det(2, '50.00', '<vFrete>5.00</vFrete><vDesc>2.00</vDesc>'),
      tot: '<vProd>150.00</vProd><vFrete>10.00</vFrete><vDesc>2.00</vDesc><vIPI>10.00</vIPI><vNF>168.00</vNF>' }));
    expect(n.criterio).toBe('informado_no_xml');
    expect(n.itens.map(valorFinal)).toEqual([11500, 5300]);
    expect(n.totais.outros).toBe(1000);
  });

  it('avisa o que é incerto', () => {
    const n = lerNfe(xml({ itens: det(1, '10.00'), tot: '<vProd>10.00</vProd><vNF>10.00</vNF>', prot: false }));
    expect(n.avisos.join(' ')).toMatch(/protocolo de autorização/);
  });

  it('recusa arquivo que não é NF-e ou está quebrado', () => {
    expect(() => lerNfe('<html><body>oi</body></html>')).toThrow(/NF-e/);
    expect(() => lerXml('<a><b></a>')).toThrow();
  });
});
