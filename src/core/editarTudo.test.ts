import { describe, expect, it } from 'vitest';
import {
  acompanharPrazo, conteudoVazio, dataEntrega, datasDasEtapas, definirFimEtapa, incluirAmbiente, incluirEtapa, incluirItem, incluirParcela,
  moverItem, mudarEtapa, mudarQuantidade, somaParcelas, tirarAmbiente, tirarEtapa, tirarItem, tirarPacote, tirarParcela, totalConteudo, type Conteudo,
} from './proposta';
import { mesclarClausulas, pendenciasContrato, totalEscopo, type ClausulaContrato, type ConteudoContrato } from './contrato';
import { gerarOrcamento, respostasPadrao } from './orcamento';

function base(): Conteudo {
  const c = conteudoVazio();
  c.ambientes = [
    { id: 'a', nome: 'Sala', itens: [
      { id: 'i1', titulo: 'Demolição', unidade: 'vb', quantidade: 1, preco_unitario: 1000, total: 1000 },
      { id: 'i2', titulo: 'Piso', unidade: 'm2', quantidade: 10, preco_unitario: 100, total: 1000 },
    ] },
    { id: 'b', nome: 'Cozinha', itens: [{ id: 'i3', titulo: 'Bancada', unidade: 'vb', quantidade: 1, preco_unitario: 2000, total: 2000 }] },
  ];
  c.pagamento.parcelas = [{ descricao: 'Entrada', valor: 2000 }, { descricao: 'Saldo', valor: 2000 }];
  c.etapas = [{ nome: 'Demolição', prazo_dias: 5 }, { nome: 'Acabamento', prazo_dias: 10 }];
  c.prazo_total_dias = 15;
  c.prazo_texto = '15 dias corridos, a contar do aceite.';
  return c;
}

describe('editar tudo no orçamento', () => {
  it('tirar um serviço baixa o total e as parcelas acompanham', () => {
    const r = tirarItem(base(), 0, 0);
    expect(r.ambientes[0].itens.map((i) => i.titulo)).toEqual(['Piso']);
    expect(totalConteudo(r)).toBe(300000);
    expect(somaParcelas(r)).toBe(300000);
  });
  it('tirar o último serviço de um grupo tira o grupo', () => {
    const r = tirarItem(base(), 1, 0);
    expect(r.ambientes.map((a) => a.nome)).toEqual(['Sala']);
  });
  it('incluir serviço, grupo e tirar grupo', () => {
    expect(incluirItem(conteudoVazio()).ambientes[0].nome).toBe('Escopo geral');
    const r = incluirAmbiente(base());
    expect(r.ambientes).toHaveLength(3);
    expect(r.ambientes[2].itens).toHaveLength(1);
    expect(tirarAmbiente(base(), 1).ambientes).toHaveLength(1);
  });
  it('mover e mudar quantidade', () => {
    expect(moverItem(base(), 0, 0, 1).ambientes[0].itens[0].titulo).toBe('Piso');
    const r = mudarQuantidade(base(), 0, 1, 20);
    expect(r.ambientes[0].itens[1].total).toBe(2000);
    expect(somaParcelas(r)).toBe(totalConteudo(r));
  });
  it('etapas: prazo total e texto do sistema acompanham; texto seu fica', () => {
    const r = mudarEtapa(base(), 1, { prazo_dias: 25 });
    expect(r.prazo_total_dias).toBe(30);
    expect(r.prazo_texto).toBe('30 dias corridos, a contar do aceite.');
    const meu = { ...base(), prazo_texto: 'Entrega antes do Natal.' };
    expect(tirarEtapa(meu, 0).prazo_texto).toBe('Entrega antes do Natal.');
    expect(tirarEtapa(meu, 0).prazo_total_dias).toBe(10);
    expect(incluirEtapa(base()).etapas[2].prazo_dias).toBe(7);
    expect(acompanharPrazo(base())).toEqual(base());
  });
  it('datas de execução a partir do início', () => {
    const c = { ...base(), data_inicio: '2026-12-01' };
    expect(datasDasEtapas(c)).toEqual([{ inicio: '2026-12-01', fim: '2026-12-05' }, { inicio: '2026-12-06', fim: '2026-12-15' }]);
    expect(dataEntrega(c)).toBe('2026-12-15');
    expect(datasDasEtapas(base())).toBeNull();
    const r = definirFimEtapa(c, 0, '2026-12-10');
    expect(r.etapas[0].prazo_dias).toBe(10);
    expect(dataEntrega(r)).toBe('2026-12-20');
  });
  it('parcelas e pacotes', () => {
    expect(incluirParcela(base()).pagamento.parcelas).toHaveLength(3);
    expect(tirarParcela(base(), 0).pagamento.parcelas.map((p) => p.descricao)).toEqual(['Saldo']);
    const c = { ...base(), opcoes: [
      { nome: 'Essencial', subtitulo: '', valor: 1, destaques: [], recomendado: false, principal: false },
      { nome: 'Completo', subtitulo: '', valor: 2, destaques: [], recomendado: true, principal: true },
    ] };
    expect(tirarPacote(c, 'Essencial').opcoes!.map((o) => o.nome)).toEqual(['Completo']);
    expect(tirarPacote(c, 'Completo').opcoes).toHaveLength(2);
  });
  it('orçamento automático sem um item sugerido', () => {
    const r = { ...respostasPadrao('reforma'), area: 40 };
    const cheio = gerarOrcamento('reforma', r, {}, 1);
    const titulo = cheio.principal.linhas[cheio.principal.linhas.length - 1].titulo;
    const sem = gerarOrcamento('reforma', r, {}, 1, { tiradas: [titulo] });
    expect(sem.principal.linhas.some((l) => l.titulo === titulo)).toBe(false);
    expect(sem.principal.valor).toBeLessThan(cheio.principal.valor);
    expect(sem.conteudo.gerador?.tiradas).toEqual([titulo]);
  });
});

describe('editar tudo no contrato', () => {
  const k = (codigo: string, texto: string, editada?: boolean): ClausulaContrato => ({ codigo, titulo: codigo, texto, versao: 1, revisao_juridica: 'minuta', editada });
  it('cláusulas editadas ficam; as outras acompanham a sugestão; tiradas não voltam', () => {
    const atuais = [k('preco', 'Valor de R$ 10', false), k('foro', 'Foro do Rio', true), k('livre-1', 'Minha cláusula', true)];
    const sug = [k('objeto', 'Objeto novo'), k('preco', 'Valor de R$ 20'), k('foro', 'Foro [a definir]'), k('rescisao', 'Rescisão')];
    const r = mesclarClausulas(atuais, sug, ['rescisao']);
    expect(r.map((x) => `${x.codigo}:${x.texto}`)).toEqual(['preco:Valor de R$ 20', 'foro:Foro do Rio', 'livre-1:Minha cláusula', 'objeto:Objeto novo']);
  });
  it('pendências do contrato editado', () => {
    const parte = { nome: 'X', documento: '1', endereco: 'Rua', email: null, telefone: null };
    const c: ConteudoContrato = {
      partes: { contratada: parte, contratante: { ...parte, documento: null } }, proposta: null, objeto: '', local: 'Rua A',
      escopo: [{ ambiente: 'Geral', itens: [{ titulo: 'A', quantidade: 1, unidade: 'vb', total: 1500.5 }] }], inclusoes: [], exclusoes: [], responsabilidades: [],
      prazo: '', pagamento: [], honorarios: {}, clausulas: [k('x', 'Prazo de [a definir].')], observacoes: '', faltando: [],
    };
    expect(pendenciasContrato(c)).toEqual(['contratante_documento', 'clausulas_a_definir']);
    expect(totalEscopo(c)).toBe(150050);
  });
});
