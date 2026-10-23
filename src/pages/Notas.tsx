// Notas fiscais: importar o XML da NF-e, conferir, distribuir por obra/serviço
// e confirmar. A confirmação gera (ou liga) uma única conta a pagar.
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { Topo } from '../components/Layout';
import { Ajuda, Carregando, Dinheiro, Erro, Modal, Vazio, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import { doBanco, formatar, paraBanco, somar } from '../core/dinheiro';
import { formatarData, hoje } from '../core/datas';
import { lerNfe, type NotaLida } from '../core/nfe';
import type { Categoria } from '../lib/tipos';

type Nota = {
  id: string; origem: 'xml' | 'manual'; chave: string | null; numero: string | null; serie: string | null; emitente_documento: string | null;
  emitente_nome: string | null; fornecedor_id: string | null; data_emissao: string | null; valor_produtos: string; valor_frete: string;
  valor_desconto: string; valor_outros: string; valor_total: string; criterio_rateio: string; duplicatas: { numero: string | null; vencimento: string; valor: number }[];
  avisos: string[]; estado: 'rascunho' | 'confirmada' | 'descartada'; descarte_motivo: string | null; lancamento_id: string | null;
  arquivo_caminho: string | null; confirmada_em: string | null; criado_em: string;
};
type ItemNota = {
  id: string; numero: number; codigo: string | null; descricao: string; ncm: string | null; unidade: string | null; quantidade: string;
  valor_bruto: string; frete: string; desconto: string; outros: string; valor_final: string;
  obra_id: string | null; servico_id: string | null; material_id: string | null;
};
type Semelhante = { tipo: 'nota' | 'lancamento'; id: string; descricao: string; motivo: string };
const ESTADO: Record<Nota['estado'], [string, string]> = { rascunho: ['Para conferir', 'alerta'], confirmada: ['Confirmada', 'ok'], descartada: ['Descartada', 'neutro'] };
const soDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

export function Notas() {
  const navegar = useNavigate();
  const toast = useToast();
  const arquivo = useRef<HTMLInputElement>(null);
  const [lida, setLida] = useState<{ nota: NotaLida; xml: string; nome: string } | null>(null);
  const [manual, setManual] = useState(false);
  const { dados, erro, carregando } = useConsulta(async () => ok(await supabase.from('nota_fiscal').select('*').order('criado_em', { ascending: false }).limit(200)) as Nota[], []);

  async function abrirXml(f: File | undefined) {
    if (!f) return;
    try {
      const xml = await f.text();
      setLida({ nota: lerNfe(xml), xml, nome: f.name });
    } catch (e) {
      toast(mensagemErro(e));
    } finally {
      if (arquivo.current) arquivo.current.value = '';
    }
  }

  return (
    <>
      <Topo titulo="Notas fiscais">
        <button className="btn-secundario" onClick={() => setManual(true)}>Nota manual</button>
        <button className="btn-primario" onClick={() => arquivo.current?.click()}><Icone nome="anexo" /> Importar XML</button>
        <input ref={arquivo} type="file" accept=".xml,text/xml,application/xml" hidden onChange={(e) => abrirXml(e.target.files?.[0])} aria-label="Arquivo XML da nota" />
      </Topo>
      <div className="card aviso small" style={{ marginBottom: 12 }}>
        <strong>Como entra uma nota:</strong> o XML da NF-e é lido aqui no aparelho (peça ao fornecedor ou baixe no portal da SEFAZ).
        Foto, PDF e QR code ainda não têm leitura automática confiável neste sistema: para esses, use “Nota manual” e anexe o arquivo na conta a pagar.
        A nota só vira conta a pagar quando você confirma, e nunca em dobro.
      </div>
      {carregando && !dados ? <Carregando /> : erro ? <Erro mensagem={erro} /> : !dados?.length ? (
        <Vazio titulo="Nenhuma nota importada">Importe o XML de uma compra para distribuir os itens entre obras e serviços.</Vazio>
      ) : (
        <div className="card tabela-wrap">
          <table className="tabela">
            <thead><tr><th>Emitente</th><th>Número</th><th>Emissão</th><th className="num">Total</th><th>Situação</th></tr></thead>
            <tbody>
              {dados.map((n) => (
                <tr key={n.id} onClick={() => navegar(`/notas/${n.id}`)} style={{ cursor: 'pointer' }}>
                  <td><Link to={`/notas/${n.id}`}>{n.emitente_nome ?? 'Sem emitente'}</Link></td>
                  <td>{n.numero ?? '—'}{n.serie ? ` / ${n.serie}` : ''}</td>
                  <td>{formatarData(n.data_emissao)}</td>
                  <td className="num"><Dinheiro valor={doBanco(n.valor_total)} /></td>
                  <td><span className={`selo ${ESTADO[n.estado][1]}`}>{ESTADO[n.estado][0]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {lida && <PreviaImportacao {...lida} fechar={() => setLida(null)} aoCriar={(id) => navegar(`/notas/${id}`)} />}
      {manual && <NotaManual fechar={() => setManual(false)} aoCriar={(id) => navegar(`/notas/${id}`)} />}
    </>
  );
}

function PreviaImportacao({ nota, xml, nome, fechar, aoCriar }: { nota: NotaLida; xml: string; nome: string; fechar: () => void; aoCriar: (id: string) => void }) {
  const toast = useToast();
  const [salvando, setSalvando] = useState(false);
  const [cadastrar, setCadastrar] = useState(true);
  const { dados } = useConsulta(async () => {
    const [sem, forn] = await Promise.all([
      supabase.rpc('notas_semelhantes', { p_chave: nota.chave, p_emitente: nota.emitente.documento, p_numero: nota.numero, p_serie: nota.serie,
        p_total: paraBanco(nota.totais.total), p_data: nota.data_emissao }),
      supabase.from('pessoa').select('id, nome, documento').not('documento', 'is', null),
    ]);
    const pessoas = ok(forn) as { id: string; nome: string; documento: string }[];
    return { semelhantes: ok(sem) as Semelhante[], fornecedor: pessoas.find((p) => soDigitos(p.documento) === soDigitos(nota.emitente.documento) && soDigitos(p.documento)) ?? null };
  }, [nota]);
  const notaRepetida = dados?.semelhantes.find((s) => s.tipo === 'nota');

  async function criar() {
    setSalvando(true);
    try {
      let fornecedor = dados?.fornecedor?.id ?? null;
      if (!fornecedor && cadastrar && nota.emitente.nome) {
        const p = await supabase.from('pessoa').insert({ nome: nota.emitente.nome, documento: nota.emitente.documento,
          tipo_pessoa: soDigitos(nota.emitente.documento).length === 14 ? 'juridica' : 'fisica', eh_fornecedor: true }).select('id').single();
        if (p.error) throw p.error;
        fornecedor = p.data.id;
      }
      const r = await supabase.from('nota_fiscal').insert({
        origem: 'xml', chave: nota.chave, modelo: nota.modelo, numero: nota.numero, serie: nota.serie,
        emitente_documento: nota.emitente.documento, emitente_nome: nota.emitente.nome, fornecedor_id: fornecedor, data_emissao: nota.data_emissao,
        valor_produtos: paraBanco(nota.totais.produtos), valor_frete: paraBanco(nota.totais.frete), valor_desconto: paraBanco(nota.totais.desconto),
        valor_outros: paraBanco(nota.totais.outros), valor_total: paraBanco(nota.totais.total), criterio_rateio: nota.criterio,
        duplicatas: nota.duplicatas.map((d) => ({ numero: d.numero, vencimento: d.vencimento, valor: paraBanco(d.valor) })), avisos: nota.avisos,
      }).select('id').single();
      if (r.error) throw r.error;
      const id = r.data.id as string;
      const it = await supabase.from('nota_item').insert(nota.itens.map((i) => ({
        nota_id: id, numero: i.numero, codigo: i.codigo, descricao: i.descricao, ncm: i.ncm, unidade: i.unidade, quantidade: i.quantidade,
        valor_bruto: paraBanco(i.valor_bruto), frete: paraBanco(i.frete), desconto: paraBanco(i.desconto), outros: paraBanco(i.outros),
      })));
      if (it.error) throw it.error;
      // Guarda o XML original (restrito ao financeiro).
      const caminho = `financeiro/notas/${id}.xml`;
      const up = await supabase.storage.from('documentos').upload(caminho, new Blob([xml], { type: 'text/xml' }), { contentType: 'text/xml', upsert: false });
      if (!up.error) await supabase.from('nota_fiscal').update({ arquivo_caminho: caminho }).eq('id', id);
      else toast('Nota criada, mas o XML original não foi guardado: ' + mensagemErro(up.error));
      aoCriar(id);
    } catch (e) {
      toast(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal titulo="Conferir nota antes de importar" largo aoFechar={fechar} rodape={<>
      <button className="btn-link" onClick={fechar}>Cancelar</button>
      <button className="btn-primario" onClick={criar} disabled={salvando || !!notaRepetida}>{salvando ? 'Importando…' : 'Importar para conferir'}</button>
    </>}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>Arquivo: {nome}. Nada é lançado agora: a nota entra como rascunho para você distribuir e confirmar.</p>
        <dl className="dl">
          <dt>Emitente</dt><dd>{nota.emitente.nome ?? '—'} {nota.emitente.documento && <span className="muted">· {nota.emitente.documento}</span>}</dd>
          <dt>Número</dt><dd>{nota.numero ?? '—'}{nota.serie ? ` · série ${nota.serie}` : ''}</dd>
          <dt>Emissão</dt><dd>{formatarData(nota.data_emissao)}</dd>
          <dt>Chave</dt><dd className="small">{nota.chave ?? '—'}</dd>
          <dt>Produtos</dt><dd><Dinheiro valor={nota.totais.produtos} /></dd>
          <dt>Frete</dt><dd><Dinheiro valor={nota.totais.frete} /></dd>
          <dt>Desconto</dt><dd><Dinheiro valor={nota.totais.desconto} /></dd>
          <dt>Acréscimos</dt><dd><Dinheiro valor={nota.totais.outros} /> <span className="muted small">(seguro, outras despesas, IPI, ST)</span></dd>
          <dt>Total da nota</dt><dd><strong><Dinheiro valor={nota.totais.total} /></strong></dd>
          <dt>Itens</dt><dd>{nota.itens.length} · {nota.criterio === 'informado_no_xml' ? 'frete e desconto pelo valor de cada item no XML' : 'frete, desconto e acréscimos distribuídos pelo valor dos produtos'}</dd>
          {nota.duplicatas.length > 0 && <><dt>Duplicatas</dt><dd>{nota.duplicatas.map((d) => `${formatarData(d.vencimento)}: ${formatar(d.valor)}`).join(' · ')}</dd></>}
        </dl>
        {nota.avisos.length > 0 && <div className="aviso small"><strong>Pontos para conferir:</strong><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{nota.avisos.map((a) => <li key={a}>{a}</li>)}</ul></div>}
        {dados?.semelhantes.length ? (
          <div className={notaRepetida ? 'erro-campo' : 'aviso small'} role="alert">
            <strong>{notaRepetida ? 'Esta nota já foi importada:' : 'Possível duplicidade:'}</strong>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{dados.semelhantes.map((s) => <li key={s.tipo + s.id}>{s.descricao} ({s.motivo}){s.tipo === 'lancamento' && ' · você poderá ligar a nota a esta conta na confirmação'}</li>)}</ul>
          </div>
        ) : null}
        {dados && !dados.fornecedor && nota.emitente.nome && (
          <label className="check"><input type="checkbox" checked={cadastrar} onChange={(e) => setCadastrar(e.target.checked)} /> Cadastrar “{nota.emitente.nome}” como fornecedor</label>
        )}
        {dados?.fornecedor && <p className="small muted" style={{ margin: 0 }}>Fornecedor já cadastrado: {dados.fornecedor.nome}.</p>}
      </div>
    </Modal>
  );
}

function NotaManual({ fechar, aoCriar }: { fechar: () => void; aoCriar: (id: string) => void }) {
  const [f, setF] = useState({ emitente: '', numero: '', data: hoje(), descricao: '', total: '' });
  const [erro, setErro] = useState<string | null>(null);
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const total = Number(f.total.replace(/\./g, '').replace(',', '.'));
    if (!(total > 0)) return setErro('Informe o total da nota.');
    const r = await supabase.from('nota_fiscal').insert({ origem: 'manual', emitente_nome: f.emitente || null, numero: f.numero || null, data_emissao: f.data,
      valor_produtos: total.toFixed(2), valor_total: total.toFixed(2), avisos: ['Nota digitada à mão: confira com o documento.'] }).select('id').single();
    if (r.error) return setErro(mensagemErro(r.error));
    const it = await supabase.from('nota_item').insert({ nota_id: r.data.id, numero: 1, descricao: f.descricao || 'Itens da nota', valor_bruto: total.toFixed(2) });
    if (it.error) return setErro(mensagemErro(it.error));
    aoCriar(r.data.id);
  }
  return (
    <Modal titulo="Nota manual" aoFechar={fechar} rodape={<><button className="btn-link" onClick={fechar}>Cancelar</button><button className="btn-primario" form="form-nota-manual">Criar</button></>}>
      <form id="form-nota-manual" className="stack" onSubmit={salvar}>
        <div><label htmlFor="nm-emit">Emitente</label><input id="nm-emit" value={f.emitente} onChange={(e) => setF({ ...f, emitente: e.target.value })} /></div>
        <div className="grid grid-2">
          <div><label htmlFor="nm-num">Número</label><input id="nm-num" value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} /></div>
          <div><label htmlFor="nm-data">Emissão</label><input id="nm-data" type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></div>
        </div>
        <div><label htmlFor="nm-desc">Descrição</label><input id="nm-desc" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} placeholder="Ex.: material elétrico" /></div>
        <div><label htmlFor="nm-total">Total (R$)</label><input id="nm-total" inputMode="decimal" value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} placeholder="0,00" /></div>
        {erro && <p className="erro-campo" role="alert">{erro}</p>}
      </form>
    </Modal>
  );
}

export function NotaDetalhe() {
  const { id } = useParams();
  const toast = useToast();
  const [lote, setLote] = useState({ obra: '', servico: '' });
  const [conf, setConf] = useState({ categoria: '', lancamento: '', vencimento: '' });
  const [descartar, setDescartar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const { dados, erro, carregando, recarregar } = useConsulta(async () => {
    const [n, it, ob, cat] = await Promise.all([
      supabase.from('nota_fiscal').select('*').eq('id', id!).maybeSingle(),
      supabase.from('nota_item').select('*').eq('nota_id', id!).order('numero'),
      supabase.from('obra').select('id, codigo, nome').eq('arquivado', false).not('status', 'eq', 'cancelada').order('codigo', { ascending: false }),
      supabase.from('categoria').select('*').eq('tipo', 'pagar').eq('ativo', true).order('ordem'),
    ]);
    const nota = ok(n) as Nota | null;
    const itens = ok(it) as ItemNota[];
    const obrasUsadas = [...new Set(itens.map((i) => i.obra_id).filter(Boolean))] as string[];
    const [sv, mt, sem] = await Promise.all([
      obrasUsadas.length ? supabase.from('servico').select('id, nome, obra_id').in('obra_id', obrasUsadas).eq('arquivado', false).order('ordem') : Promise.resolve({ data: [], error: null }),
      obrasUsadas.length ? supabase.from('material').select('id, descricao, obra_id').in('obra_id', obrasUsadas).eq('estado', 'ativo').eq('responsavel_compra', 'rosae').order('descricao') : Promise.resolve({ data: [], error: null }),
      nota && nota.estado === 'rascunho'
        ? supabase.rpc('notas_semelhantes', { p_chave: nota.chave, p_emitente: nota.emitente_documento, p_numero: nota.numero, p_serie: nota.serie, p_total: nota.valor_total, p_data: nota.data_emissao })
        : Promise.resolve({ data: [], error: null }),
    ]);
    return {
      nota, itens, obras: ok(ob) as { id: string; codigo: string; nome: string }[], categorias: ok(cat) as Categoria[],
      servicos: ok(sv) as { id: string; nome: string; obra_id: string }[], materiais: ok(mt) as { id: string; descricao: string; obra_id: string }[],
      semelhantes: (ok(sem) as Semelhante[]).filter((s) => s.tipo === 'lancamento'),
    };
  }, [id]);
  const total = useMemo(() => somar((dados?.itens ?? []).map((i) => doBanco(i.valor_final))), [dados]);

  if (carregando && !dados) return <Carregando />;
  if (erro) return <Erro mensagem={erro} />;
  if (!dados?.nota) return <Vazio titulo="Nota não encontrada" />;
  const { nota, itens } = dados;
  const editavel = nota.estado === 'rascunho';
  const totalNota = doBanco(nota.valor_total);
  const fecha = total === totalNota;
  const semObra = itens.filter((i) => !i.obra_id).length;
  const misto = semObra > 0 && semObra < itens.length;
  const categoria = conf.categoria || dados.categorias.find((c) => c.natureza === 'custo_material')?.id || '';

  async function mudarItem(i: ItemNota, campos: Partial<ItemNota>) {
    const r = await supabase.from('nota_item').update(campos).eq('id', i.id);
    if (r.error) return toast(mensagemErro(r.error));
    recarregar();
  }
  async function aplicarLote() {
    const r = await supabase.from('nota_item').update({ obra_id: lote.obra || null, servico_id: lote.servico || null, material_id: null }).eq('nota_id', nota.id);
    if (r.error) return toast(mensagemErro(r.error));
    toast('Classificação aplicada a todos os itens.');
    recarregar();
  }
  async function confirmar() {
    setEnviando(true);
    const r = await supabase.rpc('confirmar_nota', { p_nota: nota.id, p_categoria: conf.lancamento ? null : categoria || null,
      p_lancamento: conf.lancamento || null, p_vencimento: conf.vencimento || null });
    if (r.error) { setEnviando(false); return toast(mensagemErro(r.error)); }
    // O XML passa a acompanhar a conta a pagar como documento.
    if (nota.arquivo_caminho) {
      await supabase.from('arquivo').insert({ caminho: nota.arquivo_caminho, nome_original: `NF-e ${nota.numero ?? ''}.xml`, mime: 'text/xml', natureza: 'nota_fiscal', lancamento_id: r.data as string });
    }
    setEnviando(false);
    toast('Nota confirmada e conta a pagar lançada.');
    recarregar();
  }

  return (
    <>
      <Topo titulo={`${nota.emitente_nome ?? 'Nota'} · nº ${nota.numero ?? 's/n'}`} sub={<span className={`selo ${ESTADO[nota.estado][1]}`}>{ESTADO[nota.estado][0]}</span>}>
        <Link className="btn-secundario" to="/notas"><Icone nome="voltar" /> Notas</Link>
      </Topo>
      <div className="grid grid-2">
        <div className="card">
          <dl className="dl">
            <dt>Emissão</dt><dd>{formatarData(nota.data_emissao)}</dd>
            <dt>Emitente</dt><dd>{nota.emitente_nome ?? '—'} {nota.emitente_documento && <span className="muted">· {nota.emitente_documento}</span>}</dd>
            {nota.chave && <><dt>Chave</dt><dd className="small">{nota.chave}</dd></>}
            <dt>Total da nota</dt><dd><strong><Dinheiro valor={totalNota} /></strong></dd>
            <dt>Distribuição <Ajuda>Frete, desconto e acréscimos (seguro, IPI, ST, outras despesas) entram no custo de cada item. Quando o XML informa o valor por item e ele fecha, usamos o do XML; senão, distribuímos pelo valor dos produtos, em centavos, sem sobrar nem faltar.</Ajuda></dt>
            <dd>{nota.criterio_rateio === 'informado_no_xml' ? 'Pelo valor de cada item no XML' : 'Proporcional ao valor dos produtos'}</dd>
            {nota.duplicatas.length > 0 && <><dt>Duplicatas</dt><dd>{nota.duplicatas.map((d) => `${formatarData(d.vencimento)}: ${formatar(doBanco(d.valor))}`).join(' · ')}</dd></>}
          </dl>
          {nota.avisos.length > 0 && <div className="aviso small" style={{ marginTop: 10 }}><strong>Pontos para conferir:</strong><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{nota.avisos.map((a) => <li key={a}>{a}</li>)}</ul></div>}
        </div>

        {editavel ? (
          <div className="card stack">
            <h3>Confirmar</h3>
            <p className={`small ${fecha ? 'favoravel' : 'desfavoravel'}`} role="status">
              {fecha ? <><Icone nome="check" /> A soma dos itens fecha com o total: {formatar(total)}.</> : <>A soma dos itens ({formatar(total)}) não fecha com o total ({formatar(totalNota)}).</>}
            </p>
            {misto && <p className="small desfavoravel">Há itens com e sem obra. Classifique todos numa obra ou deixe todos sem obra (despesa da empresa).</p>}
            {!misto && <p className="small muted" style={{ margin: 0 }}>{semObra === itens.length ? 'Sem obra: vira despesa da empresa.' : 'Vira custo das obras escolhidas (rateado quando houver mais de uma obra ou serviço).'}</p>}
            {dados.semelhantes.length > 0 && (
              <div>
                <label htmlFor="ligar">Esta nota é de uma conta a pagar já lançada?</label>
                <select id="ligar" value={conf.lancamento} onChange={(e) => setConf({ ...conf, lancamento: e.target.value })}>
                  <option value="">Não: criar a conta a pagar agora</option>
                  {dados.semelhantes.map((s) => <option key={s.id} value={s.id}>Sim: {s.descricao}</option>)}
                </select>
                <p className="muted small">Ligar evita lançar o mesmo gasto duas vezes.</p>
              </div>
            )}
            {!conf.lancamento && (
              <>
                <div>
                  <label htmlFor="cat-nota">Categoria</label>
                  <select id="cat-nota" value={categoria} onChange={(e) => setConf({ ...conf, categoria: e.target.value })}>
                    {dados.categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </div>
                {nota.duplicatas.length === 0 && (
                  <div><label htmlFor="venc-nota">Vencimento</label><input id="venc-nota" type="date" value={conf.vencimento || nota.data_emissao || ''} onChange={(e) => setConf({ ...conf, vencimento: e.target.value })} /></div>
                )}
              </>
            )}
            <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <button className="btn-link" onClick={() => setDescartar(true)}>Descartar nota</button>
              <button className="btn-primario" onClick={confirmar} disabled={enviando || !fecha || misto}>{enviando ? 'Confirmando…' : 'Confirmar e lançar'}</button>
            </div>
          </div>
        ) : (
          <div className="card">
            {nota.estado === 'confirmada' ? (
              <>
                <h3>Lançada</h3>
                <p>Conta a pagar: <Link to={`/financeiro/${nota.lancamento_id}`}>abrir lançamento</Link>. O pagamento e o comprovante são registrados lá.</p>
                <p className="muted small">Confirmada em {formatarData(nota.confirmada_em)}. A nota não muda mais; erros se corrigem no lançamento (estorno ou cancelamento).</p>
              </>
            ) : <><h3>Descartada</h3><p className="muted">{nota.descarte_motivo}</p></>}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <h3>Itens</h3>
          {editavel && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <select aria-label="Obra para todos" className="select-compacto" value={lote.obra} onChange={(e) => setLote({ obra: e.target.value, servico: '' })}>
                <option value="">Sem obra (empresa)</option>
                {dados.obras.map((o) => <option key={o.id} value={o.id}>{o.codigo} · {o.nome}</option>)}
              </select>
              <button className="btn-secundario" onClick={aplicarLote}>Aplicar a todos</button>
            </div>
          )}
        </div>
        <div className="tabela-wrap">
          <table className="tabela">
            <thead><tr><th>#</th><th>Item</th><th className="num">Qtd.</th><th className="num">Produto</th><th className="num">Frete</th><th className="num">Desc.</th><th className="num">Acrésc.</th><th className="num">Custo</th><th>Obra · serviço · material</th></tr></thead>
            <tbody>
              {itens.map((i) => {
                const servicos = dados.servicos.filter((s) => s.obra_id === i.obra_id);
                const materiais = dados.materiais.filter((m) => m.obra_id === i.obra_id);
                return (
                  <tr key={i.id}>
                    <td>{i.numero}</td>
                    <td>{i.descricao}<div className="muted small">{[i.codigo, i.ncm && `NCM ${i.ncm}`].filter(Boolean).join(' · ')}</div></td>
                    <td className="num">{Number(i.quantidade).toLocaleString('pt-BR')} {i.unidade}</td>
                    <td className="num">{formatar(doBanco(i.valor_bruto))}</td>
                    <td className="num">{formatar(doBanco(i.frete))}</td>
                    <td className="num">{formatar(doBanco(i.desconto))}</td>
                    <td className="num">{formatar(doBanco(i.outros))}</td>
                    <td className="num"><strong>{formatar(doBanco(i.valor_final))}</strong></td>
                    <td>
                      {editavel ? (
                        <div className="stack" style={{ gap: 4 }}>
                          <select aria-label={`Obra do item ${i.numero}`} className="select-compacto" value={i.obra_id ?? ''} onChange={(e) => mudarItem(i, { obra_id: e.target.value || null, servico_id: null, material_id: null })}>
                            <option value="">Sem obra (empresa)</option>
                            {dados.obras.map((o) => <option key={o.id} value={o.id}>{o.codigo} · {o.nome}</option>)}
                          </select>
                          {i.obra_id && (
                            <select aria-label={`Serviço do item ${i.numero}`} className="select-compacto" value={i.servico_id ?? ''} onChange={(e) => mudarItem(i, { servico_id: e.target.value || null })}>
                              <option value="">Obra em geral</option>
                              {servicos.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                            </select>
                          )}
                          {i.obra_id && materiais.length > 0 && (
                            <select aria-label={`Material do item ${i.numero}`} className="select-compacto" value={i.material_id ?? ''} onChange={(e) => mudarItem(i, { material_id: e.target.value || null })}>
                              <option value="">Sem ligar a material</option>
                              {materiais.map((m) => <option key={m.id} value={m.id}>Compra de: {m.descricao}</option>)}
                            </select>
                          )}
                        </div>
                      ) : (
                        <span className="small">{dados.obras.find((o) => o.id === i.obra_id)?.nome ?? 'Empresa'}{i.servico_id && ` · ${dados.servicos.find((s) => s.id === i.servico_id)?.nome ?? ''}`}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td colSpan={7}><strong>Soma dos itens</strong></td><td className="num"><strong>{formatar(total)}</strong></td><td /></tr></tfoot>
          </table>
        </div>
      </div>
      {descartar && <DescartarNota id={nota.id} fechar={() => setDescartar(false)} aoSalvar={() => { setDescartar(false); recarregar(); }} />}
    </>
  );
}

function DescartarNota({ id, fechar, aoSalvar }: { id: string; fechar: () => void; aoSalvar: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  async function salvar() {
    if (!motivo.trim()) return setErro('Informe o motivo.');
    const r = await supabase.from('nota_fiscal').update({ estado: 'descartada', descarte_motivo: motivo.trim() }).eq('id', id);
    if (r.error) return setErro(mensagemErro(r.error));
    aoSalvar();
  }
  return (
    <Modal titulo="Descartar nota" aoFechar={fechar} rodape={<><button className="btn-link" onClick={fechar}>Voltar</button><button className="btn-perigo" onClick={salvar}>Descartar</button></>}>
      <label htmlFor="motivo-desc">Motivo</label>
      <input id="motivo-desc" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: nota de outra empresa, importada por engano" autoFocus />
      {erro && <p className="erro-campo" role="alert">{erro}</p>}
    </Modal>
  );
}
