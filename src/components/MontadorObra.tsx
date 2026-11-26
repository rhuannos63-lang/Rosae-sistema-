// Montador de reforma e construção andar por andar: escolha o andar, toque nos serviços prontos,
// digite a medida. O que muda aqui já vai para a proposta (grupos por andar, totais e parcelas).
import { useEffect, useMemo, useState } from 'react';
import { Modal, useToast } from './ui';
import { Icone } from './Icone';
import { formatar } from '../core/dinheiro';
import { UNIDADES, novoId, paraCentavos, type Conteudo } from '../core/proposta';
import {
  ANDARES_SUGERIDOS, CATEGORIAS, aplicarImportado, aplicarLinhas, catalogoComPrecos, comMedidas, exportarPlanilha, importar, linhaDoCatalogo,
  linhasDoConteudo, modeloParaIA, numeroBr, resumoAndares, totalLinha, type Importado, type LinhaMontador, type ServicoCatalogo,
} from '../core/montador';
import { carregarPrecosCatalogo, salvarPrecoCatalogo } from '../lib/orcamentoParametros';

type SetC = (f: Conteudo | ((c: Conteudo) => Conteudo)) => void;

const andarDe = (l: LinhaMontador) => l.andar.trim() || 'Geral';
const num = (v: number) => (v ? String(v).replace('.', ',') : '');

export function MontadorObra({ c, setC, podeEditarPrecos }: { c: Conteudo; setC: SetC; podeEditarPrecos: boolean }) {
  const toast = useToast();
  const linhas = useMemo(() => linhasDoConteudo(c), [c]);
  const construcao = (c.gerador?.tipo ?? c.tipo_servico) === 'construcao';
  const [ajustes, setAjustes] = useState<Record<string, number>>({});
  useEffect(() => { carregarPrecosCatalogo().then(setAjustes).catch(() => undefined); }, []);
  const catalogo = useMemo(() => catalogoComPrecos(ajustes), [ajustes]);
  const porId = useMemo(() => new Map(catalogo.map((s) => [s.id, s])), [catalogo]);
  // Construção começa pela estrutura; reforma, pelos acabamentos.
  const categorias = useMemo(() => {
    const primeiro = ['Estrutura', 'Alvenaria e revestimento', 'Cobertura', 'Hidráulica e drenagem', 'Elétrica'];
    return construcao ? [...primeiro, ...CATEGORIAS.filter((k) => !primeiro.includes(k))] : CATEGORIAS;
  }, [construcao]);

  // Andares: os que já têm serviço + os que você abriu agora (ainda vazios).
  const [abertos, setAbertos] = useState<string[]>([]);
  const andares = useMemo(() => {
    const r = Array.from(new Set([...linhas.map(andarDe), ...abertos]));
    return r.length ? r : ['Térreo'];
  }, [linhas, abertos]);
  const [andar, setAndar] = useState<string>(() => andares[0]);
  const ativo = andares.includes(andar) ? andar : andares[0];
  const [categoria, setCategoria] = useState<string>(categorias[0]);
  const [novoAndar, setNovoAndar] = useState('');
  const [janela, setJanela] = useState<'ia' | 'importar' | 'copiar' | null>(null);

  const gravar = (novas: LinhaMontador[]) => setC((x) => aplicarLinhas(x, novas));
  const mudar = (id: string, m: Partial<LinhaMontador>) => gravar(linhas.map((l) => (l.id === id ? { ...l, ...m } : l)));
  const tirar = (id: string) => gravar(linhas.filter((l) => l.id !== id));
  // Novo serviço entra logo depois do último do mesmo andar (a ordem do andar se mantém).
  function incluir(l: LinhaMontador) {
    let pos = -1;
    linhas.forEach((x, k) => { if (andarDe(x) === andarDe(l)) pos = k; });
    gravar(pos < 0 ? [...linhas, l] : [...linhas.slice(0, pos + 1), l, ...linhas.slice(pos + 1)]);
  }
  const doAndar = linhas.filter((l) => andarDe(l) === ativo);
  const grupos = Array.from(new Set(doAndar.map((l) => l.categoria || 'Serviços')));
  const resumo = resumoAndares(linhas);
  const totalGeral = linhas.reduce((t, l) => t + paraCentavos(totalLinha(l)), 0);

  function abrirAndar(nome: string) {
    const n = nome.trim();
    if (!n) return;
    if (!andares.includes(n)) setAbertos((a) => [...a, n]);
    setAndar(n);
    setNovoAndar('');
  }
  function renomearAndar(de: string) {
    const para = window.prompt('Novo nome do andar', de)?.trim();
    if (!para || para === de) return;
    setAbertos((a) => a.map((x) => (x === de ? para : x)));
    gravar(linhas.map((l) => (andarDe(l) === de ? { ...l, andar: para } : l)));
    setAndar(para);
  }
  function tirarAndar(a: string) {
    const n = linhas.filter((l) => andarDe(l) === a).length;
    if (n && !window.confirm(`Tirar o ${a} e os ${n} serviço(s) dele da proposta?`)) return;
    setAbertos((x) => x.filter((y) => y !== a));
    gravar(linhas.filter((l) => andarDe(l) !== a));
  }
  async function guardarPreco(s: ServicoCatalogo, preco: number) {
    try {
      await salvarPrecoCatalogo(s.id, preco);
      setAjustes((a) => ({ ...a, [`cat.${s.id}`]: preco }));
      toast(`${s.descricao}: R$ ${num(preco)} agora é o seu preço padrão.`);
    } catch {
      toast('Não consegui gravar o preço padrão. Tente de novo.');
    }
  }
  function baixarPlanilha() {
    const blob = new Blob(['﻿' + exportarPlanilha(linhas, ';')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'orcamento-por-andar.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return (
    <div className="stack montador">
      <div className="montador-topo">
        <div>
          <span className="muted small">Total da obra</span>
          <b className="num">{formatar(totalGeral)}</b>
          <span className="muted small">{linhas.length} serviço(s) em {resumo.length} andar(es)</span>
        </div>
        <div className="row">
          <button className="btn-secundario" onClick={() => setJanela('ia')}><Icone nome="copiar" /> Modelo para a IA</button>
          <button className="btn-secundario" onClick={() => setJanela('importar')}>Importar da IA ou planilha</button>
          <button className="btn-secundario" onClick={baixarPlanilha} disabled={!linhas.length}>Exportar planilha</button>
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Escolha o andar, toque nos serviços prontos e digite a medida. Tudo vai direto para a proposta, andar por andar, com o total de cada um; as parcelas acompanham.
        Preço diferente do seu padrão aparece com <b>Guardar como padrão</b>.
      </p>

      <div className="montador-andares" role="tablist" aria-label="Andares">
        {andares.map((a) => {
          const r = resumo.find((x) => x.andar === a);
          return (
            <button key={a} role="tab" aria-selected={a === ativo} className={`montador-andar${a === ativo ? ' ativo' : ''}`} onClick={() => setAndar(a)}>
              <span>{a === 'Geral' ? 'Sem andar' : a}</span>
              <small className="num">{r ? formatar(paraCentavos(r.total)) : 'vazio'}</small>
            </button>
          );
        })}
        <form className="row montador-novo-andar" onSubmit={(e) => { e.preventDefault(); abrirAndar(novoAndar); }}>
          <input value={novoAndar} onChange={(e) => setNovoAndar(e.target.value)} list="montador-andares-sugestao" placeholder="+ Andar (ex.: 2º andar)" aria-label="Novo andar" />
          <datalist id="montador-andares-sugestao">{ANDARES_SUGERIDOS.filter((a) => !andares.includes(a)).map((a) => <option key={a} value={a} />)}</datalist>
          <button className="btn-secundario" disabled={!novoAndar.trim()}>Abrir</button>
        </form>
      </div>

      <div className="bloco-ambiente">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b>{ativo === 'Geral' ? 'Serviços sem andar' : ativo}</b>
          <div className="row">
            {doAndar.length > 0 && <button className="btn-link" onClick={() => setJanela('copiar')}>Copiar para outro andar</button>}
            <button className="btn-link" onClick={() => renomearAndar(ativo)}>Renomear</button>
            <button className="btn-link" onClick={() => tirarAndar(ativo)}>Tirar andar</button>
          </div>
        </div>

        {grupos.map((g) => (
          <div key={g} className="montador-grupo">
            <div className="montador-grupo-titulo">
              <input value={g} aria-label="Nome do grupo" onChange={(e) => gravar(linhas.map((l) => (andarDe(l) === ativo && (l.categoria || 'Serviços') === g ? { ...l, categoria: e.target.value } : l)))} />
              <span className="num muted">{formatar(doAndar.filter((l) => (l.categoria || 'Serviços') === g).reduce((t, l) => t + paraCentavos(totalLinha(l)), 0))}</span>
            </div>
            {doAndar.filter((l) => (l.categoria || 'Serviços') === g).map((l) => {
              const cat = l.catalogo ? porId.get(l.catalogo) : undefined;
              const pintura = l.parede != null || l.teto != null;
              const outroPreco = podeEditarPrecos && cat && l.preco > 0 && Math.abs(l.preco - cat.preco) >= 0.005;
              return (
                <div key={l.id} className="montador-linha">
                  <input className="m-servico" value={l.servico} onChange={(e) => mudar(l.id, { servico: e.target.value })} aria-label="Serviço" placeholder="Serviço" />
                  <input className="m-onde" value={l.onde} onChange={(e) => mudar(l.id, { onde: e.target.value })} aria-label="Onde" placeholder="Onde (ex.: quartos)" />
                  {pintura ? (
                    <div className="m-medidas">
                      <label><span>Parede m²</span><input inputMode="decimal" value={num(l.parede ?? 0)} onChange={(e) => gravar(linhas.map((x) => (x.id === l.id ? comMedidas(x, numeroBr(e.target.value), x.teto) : x)))} /></label>
                      <label><span>Teto m²</span><input inputMode="decimal" value={num(l.teto ?? 0)} onChange={(e) => gravar(linhas.map((x) => (x.id === l.id ? comMedidas(x, x.parede, numeroBr(e.target.value)) : x)))} /></label>
                    </div>
                  ) : (
                    <input className="m-desc" value={l.descricao} onChange={(e) => mudar(l.id, { descricao: e.target.value })} aria-label="O que será feito" placeholder="O que será feito" />
                  )}
                  <label className="m-qtd"><span>Qtd.</span><input inputMode="decimal" value={num(l.quantidade)} readOnly={pintura} onChange={(e) => mudar(l.id, { quantidade: numeroBr(e.target.value) })} /></label>
                  <label className="m-un"><span>Un.</span>
                    <select value={l.unidade} onChange={(e) => mudar(l.id, { unidade: e.target.value })} disabled={pintura}>{Object.entries(UNIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                  </label>
                  <label className="m-preco"><span>R$ / un.</span><input inputMode="decimal" value={num(l.preco)} onChange={(e) => mudar(l.id, { preco: numeroBr(e.target.value) })} /></label>
                  <b className="num m-total">{formatar(paraCentavos(totalLinha(l)))}</b>
                  <button className="btn-link m-tirar" aria-label="Tirar serviço" title="Tirar este serviço" onClick={() => tirar(l.id)}><Icone nome="fechar" /></button>
                  {outroPreco && <button className="btn-link m-padrao small" onClick={() => guardarPreco(cat!, l.preco)}>Guardar R$ {num(l.preco)} como padrão (hoje R$ {num(cat!.preco)})</button>}
                </div>
              );
            })}
          </div>
        ))}
        {!doAndar.length && <p className="muted small" style={{ margin: 0 }}>Nenhum serviço neste andar ainda. Toque nos serviços abaixo para incluir.</p>}

        <div className="montador-catalogo">
          <div className="row" style={{ gap: 6 }}>
            {categorias.map((k) => <button key={k} className={`chip-link${k === categoria ? ' ativo' : ''}`} onClick={() => setCategoria(k)}>{k}</button>)}
          </div>
          <div className="montador-servicos">
            {catalogo.filter((s) => s.categoria === categoria).map((s) => (
              <button key={s.id} className="montador-servico" onClick={() => incluir(linhaDoCatalogo(s, ativo))}>
                <span>{s.nome === s.categoria || s.nome === 'Troca de piso' || s.nome === 'Teto' || s.nome === 'Parede' ? s.descricao : `${s.nome} · ${s.descricao}`}</span>
                <small className="num">R$ {num(s.preco)}/{UNIDADES[s.unidade as keyof typeof UNIDADES] ?? s.unidade}</small>
              </button>
            ))}
            <button className="montador-servico livre" onClick={() => incluir({ id: novoId(), andar: ativo, categoria, servico: '', onde: '', descricao: '', unidade: 'vb', quantidade: 1, preco: 0 })}>
              <span>+ Serviço livre em {categoria}</span><small>você escreve e põe o preço</small>
            </button>
          </div>
        </div>
      </div>

      {janela === 'ia' && <JanelaModeloIA catalogo={catalogo} aoFechar={() => setJanela(null)} />}
      {janela === 'importar' && (
        <JanelaImportar temServicos={linhas.length > 0} aoFechar={() => setJanela(null)} aoAplicar={(imp, juntar, textos) => {
          setC((x) => aplicarImportado(x, imp, { juntar, textos }));
          setAbertos([]);
          setAndar(imp.linhas[0]?.andar ?? ativo);
          setJanela(null);
          toast(`${imp.linhas.length} serviço(s) importados. Confira andar por andar.`);
        }} />
      )}
      {janela === 'copiar' && (
        <Modal titulo={`Copiar o ${ativo} para…`} aoFechar={() => setJanela(null)}>
          <p className="muted small">Os {doAndar.length} serviços entram com as mesmas medidas; depois é só ajustar o que muda.</p>
          <div className="row">
            {[...andares, ...ANDARES_SUGERIDOS.filter((a) => !andares.includes(a))].filter((a) => a !== ativo).map((a) => (
              <button key={a} className="btn-secundario" onClick={() => {
                const copias = doAndar.map((l) => ({ ...l, id: novoId(), andar: a }));
                gravar([...linhas, ...copias]);
                setAndar(a);
                setJanela(null);
                toast(`${copias.length} serviço(s) copiados para o ${a}.`);
              }}>{a}</button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function JanelaModeloIA({ catalogo, aoFechar }: { catalogo: ServicoCatalogo[]; aoFechar: () => void }) {
  const toast = useToast();
  const texto = useMemo(() => modeloParaIA(catalogo), [catalogo]);
  async function copiar() {
    try { await navigator.clipboard.writeText(texto); toast('Modelo copiado. Cole na IA junto com as medidas, fotos e o pedido do cliente.'); }
    catch { toast('Selecione o texto e copie manualmente.'); }
  }
  return (
    <Modal titulo="Modelo para a IA" aoFechar={aoFechar} largo rodape={<button className="btn-primario" onClick={copiar}><Icone nome="copiar" /> Copiar modelo</button>}>
      <ol className="small" style={{ marginTop: 0, paddingLeft: 18 }}>
        <li>Copie o modelo e cole no ChatGPT, Claude ou Gemini.</li>
        <li>Mande junto as medidas, as fotos, o projeto ou o áudio do que o cliente pediu.</li>
        <li>Copie a resposta inteira da IA e use <b>Importar da IA ou planilha</b>. O sistema organiza andar por andar, com os seus preços.</li>
      </ol>
      <textarea readOnly rows={16} value={texto} style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem' }} onFocus={(e) => e.currentTarget.select()} />
    </Modal>
  );
}

function JanelaImportar({ temServicos, aoFechar, aoAplicar }: { temServicos: boolean; aoFechar: () => void; aoAplicar: (imp: Importado, juntar: boolean, textos: boolean) => void }) {
  const [texto, setTexto] = useState('');
  const [juntar, setJuntar] = useState(false);
  const [textos, setTextos] = useState(true);
  const imp = useMemo(() => (texto.trim() ? importar(texto) : null), [texto]);
  const resumo = imp ? resumoAndares(imp.linhas) : [];
  const total = resumo.reduce((t, r) => t + paraCentavos(r.total), 0);
  const temTextos = !!imp && (Object.keys(imp.conteudo).length > 0 || !!imp.pagamentoPct?.length);
  return (
    <Modal titulo="Importar orçamento" aoFechar={aoFechar} largo rodape={
      <button className="btn-primario" disabled={!imp?.linhas.length} onClick={() => imp && aoAplicar(imp, juntar, textos)}>
        {imp?.linhas.length ? `Aplicar ${imp.linhas.length} serviço(s) · ${formatar(total)}` : 'Aplicar'}
      </button>
    }>
      <p className="muted small" style={{ marginTop: 0 }}>Cole a resposta da IA (o JSON do modelo) ou linhas copiadas de uma planilha com as colunas Andar, Categoria, Serviço, Onde, O que será feito, Quantidade, Unidade e Preço unitário.</p>
      <textarea rows={10} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Cole aqui" style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem' }} autoFocus />
      {imp && (
        <div className="stack" style={{ marginTop: 10 }}>
          {imp.avisos.map((a) => <div key={a} className="small" style={{ color: 'var(--alerta)' }}>{a}</div>)}
          {resumo.length > 0 && (
            <table className="tabela">
              <thead><tr><th>Andar</th><th>Serviços</th><th style={{ textAlign: 'right' }}>Valor</th></tr></thead>
              <tbody>
                {resumo.map((r) => <tr key={r.andar}><td>{r.andar}</td><td>{r.servicos}</td><td className="num" style={{ textAlign: 'right' }}>{formatar(paraCentavos(r.total))}</td></tr>)}
                <tr className="total"><td>Total</td><td>{imp.linhas.length}</td><td className="num" style={{ textAlign: 'right' }}>{formatar(total)}</td></tr>
              </tbody>
            </table>
          )}
          {temServicos && <label className="row small"><input type="checkbox" checked={juntar} onChange={(e) => setJuntar(e.target.checked)} /> Juntar aos serviços que já estão na proposta (sem marcar, substitui)</label>}
          {temTextos && <label className="row small"><input type="checkbox" checked={textos} onChange={(e) => setTextos(e.target.checked)} /> Usar também os textos que vieram (resumo, etapas, pagamento, incluso e não incluso)</label>}
        </div>
      )}
    </Modal>
  );
}
