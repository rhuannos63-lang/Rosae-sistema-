// Proposta em formato de apresentação 16:9. A mesma peça serve para a pré-visualização,
// a página do cliente e o PDF (impressão). Nunca recebe custos nem margens.
import { formatar } from '../core/dinheiro';
import { formatarData } from '../core/datas';
import { paraCentavos, totalAmbiente, totalConteudo, totalItem, UNIDADES, type Conteudo, type Item } from '../core/proposta';

export type EmpresaPublica = {
  nome: string | null; razao_social?: string | null; cnpj?: string | null; responsavel: string | null; registro: string | null;
  endereco: string | null; telefone: string | null; email: string | null; site: string | null; instagram: string | null; frase: string | null;
};

export type DadosDocumento = {
  codigo: string; tipo: 'proposta' | 'aditivo'; titulo: string; versao: number; cliente: string;
  emitida_em: string | null; validade: string | null; hash: string | null; conteudo: Conteudo; empresa: EmpresaPublica | null;
  rascunho?: boolean;
};

function Slide({ n, total, titulo, children, d, classe }: { n: number; total: number; titulo?: string; children: React.ReactNode; d: DadosDocumento; classe?: string }) {
  return (
    <section className={`slide ${classe ?? ''}`} aria-label={titulo ?? `Página ${n}`}>
      {d.rascunho && <div className="marca-rascunho">RASCUNHO · não enviado ao cliente</div>}
      {titulo && (
        <header className="slide-cab">
          <span className="slide-kicker">{d.codigo} · versão {d.versao}</span>
          <h2>{titulo}</h2>
        </header>
      )}
      <div className="slide-corpo">{children}</div>
      <footer className="slide-rodape">
        <img src="/marca/rosae-simbolo.svg" alt="" />
        <span>{d.empresa?.nome ?? 'ROSAE Engenharia & Estruturas'}</span>
        <span className="spacer" />
        <span>{n}/{total}</span>
      </footer>
    </section>
  );
}

function partes<T>(lista: T[], tamanho: number): T[][] {
  if (lista.length === 0) return [[]];
  const r: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) r.push(lista.slice(i, i + tamanho));
  return r;
}

const qtd = (i: Item) => `${Number(i.quantidade).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${UNIDADES[i.unidade] ?? i.unidade}`;

export function PropostaDocumento({ d }: { d: DadosDocumento }) {
  const c = d.conteudo;
  const total = totalConteudo(c);
  const linhas = c.ambientes.flatMap((a) => [{ amb: a, item: null as Item | null }, ...a.itens.map((item) => ({ amb: a, item }))]);
  const paginasEscopo = partes(c.ambientes.flatMap((a) => a.itens.map((item) => ({ amb: a.nome, item }))), 5);
  const paginasValores = partes(linhas, 11);
  const temResp = c.responsabilidades.some((r) => r.itens.length > 0);
  const condicoes = [
    `Esta proposta é válida até ${d.validade ? formatarData(d.validade) : `${c.validade_dias} dias após a emissão`}.`,
    'Serviços ou alterações fora do escopo descrito serão orçados à parte e só executados após aprovação por escrito (aditivo).',
    'Prazos contam a partir da aprovação, do pagamento da entrada (quando houver) e da liberação do local e das informações necessárias.',
    'Atrasos causados por decisões pendentes, mudanças pedidas pelo cliente, chuvas ou falta de acesso ajustam o prazo na mesma proporção.',
    'A qualidade é conferida por etapa; pendências encontradas são registradas e corrigidas antes da etapa seguinte.',
  ];

  type P = { titulo?: string; classe?: string; conteudo: React.ReactNode };
  const paginas: P[] = [];

  paginas.push({
    classe: 'capa',
    conteudo: (
      <div className="capa-grade">
        <div>
          <img className="capa-logo" src="/marca/rosae-logo-horizontal.svg" alt="ROSAE Engenharia & Estruturas" />
          <p className="capa-tipo">{d.tipo === 'aditivo' ? 'Aditivo de escopo' : 'Proposta técnica e comercial'}</p>
          <h1>{d.titulo}</h1>
          <p className="capa-cliente">Preparada para <b>{d.cliente}</b></p>
        </div>
        <dl className="capa-dados">
          <dt>Código</dt><dd>{d.codigo}</dd>
          <dt>Versão</dt><dd>{d.versao}</dd>
          <dt>Emissão</dt><dd>{d.emitida_em ? formatarData(d.emitida_em.slice(0, 10)) : '—'}</dd>
          <dt>Validade</dt><dd>{d.validade ? formatarData(d.validade) : `${c.validade_dias} dias`}</dd>
          {c.local && <><dt>Local</dt><dd>{c.local}</dd></>}
        </dl>
      </div>
    ),
  });

  paginas.push({
    titulo: 'Quem somos e o que entendemos',
    conteudo: (
      <div className="duas-colunas">
        <div>
          <h3>A ROSAE</h3>
          <p>{c.apresentacao}</p>
          {d.empresa?.frase && <p className="destaque">“{d.empresa.frase}”</p>}
        </div>
        <div>
          <h3>A sua necessidade</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{c.necessidade || 'Descrição a completar.'}</p>
        </div>
      </div>
    ),
  });

  paginasEscopo.forEach((pg, k) => {
    paginas.push({
      titulo: paginasEscopo.length > 1 ? `Escopo dos serviços (${k + 1}/${paginasEscopo.length})` : 'Escopo dos serviços',
      conteudo: pg.length === 0 ? <p>Escopo a definir.</p> : (
        <div className="escopo">
          {pg.map(({ amb, item }) => (
            <div key={item.id} className="escopo-item">
              <span className="escopo-amb">{amb}</span>
              <h3>{item.titulo}</h3>
              {item.descricao && <p>{item.descricao}</p>}
              <span className="escopo-qtd">{qtd(item)}{item.complexidade ? ` · complexidade ${item.complexidade.toLowerCase()}` : ''}</span>
            </div>
          ))}
        </div>
      ),
    });
  });

  paginas.push({
    titulo: 'O que está incluso e o que não está',
    conteudo: (
      <div className="duas-colunas">
        <div>
          <h3 className="ok">Incluso</h3>
          <ul className="marcas ok">{(c.inclusoes.length ? c.inclusoes : ['Conforme escopo descrito.']).map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
        <div>
          <h3 className="nao">Não incluso</h3>
          <ul className="marcas nao">{(c.exclusoes.length ? c.exclusoes : ['Tudo o que não estiver descrito no escopo.']).map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      </div>
    ),
  });

  if (temResp) {
    paginas.push({
      titulo: 'Responsabilidades de cada parte',
      conteudo: (
        <div className="colunas-resp" style={{ gridTemplateColumns: `repeat(${Math.min(3, c.responsabilidades.length)}, 1fr)` }}>
          {c.responsabilidades.filter((r) => r.itens.length).map((r) => (
            <div key={r.parte}>
              <h3>{r.parte === 'Parceiro' ? 'Equipes parceiras' : r.parte}</h3>
              <ul>{r.itens.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          ))}
        </div>
      ),
    });
  }

  paginas.push({
    titulo: 'Etapas e prazo',
    conteudo: (
      <div>
        {c.etapas.length > 0 && (
          <ol className="linha-etapas">
            {c.etapas.map((e, k) => (
              <li key={k}>
                <span className="etapa-n">{k + 1}</span>
                <b>{e.nome}</b>
                {e.descricao && <span>{e.descricao}</span>}
                {e.prazo_dias ? <span className="etapa-prazo">{e.prazo_dias} dias</span> : null}
              </li>
            ))}
          </ol>
        )}
        {c.prazo_texto && <p className="destaque">Prazo: {c.prazo_texto}</p>}
      </div>
    ),
  });

  paginasValores.forEach((pg, k) => {
    const ultima = k === paginasValores.length - 1;
    paginas.push({
      titulo: paginasValores.length > 1 ? `Investimento (${k + 1}/${paginasValores.length})` : 'Investimento',
      conteudo: (
        <div className={ultima && c.pagamento.parcelas.length ? 'investimento' : ''}>
          <table className="tabela-doc">
            <tbody>
              {pg.map(({ amb, item }) =>
                item === null ? (
                  <tr key={`a-${amb.id}`} className="amb"><td>{amb.nome}</td><td /><td className="num">{formatar(totalAmbiente(amb))}</td></tr>
                ) : (
                  <tr key={item.id}><td>{item.titulo}</td><td className="muted">{qtd(item)}</td><td className="num">{formatar(paraCentavos(totalItem(item)))}</td></tr>
                ),
              )}
            </tbody>
            {ultima && <tfoot><tr><td>Total</td><td /><td className="num">{formatar(total)}</td></tr></tfoot>}
          </table>
          {ultima && c.pagamento.parcelas.length > 0 && (
            <div className="pagamento">
              <h3>Condições de pagamento</h3>
              {c.pagamento.descricao && <p>{c.pagamento.descricao}</p>}
              <ul>
                {c.pagamento.parcelas.map((p, j) => (
                  <li key={j}><span>{p.descricao}{p.quando ? <span className="muted"> · {p.quando}</span> : null}</span><b className="num">{formatar(paraCentavos(p.valor))}</b></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ),
    });
  });

  paginas.push({
    titulo: 'Premissas e condições',
    conteudo: (
      <div className="duas-colunas">
        <div>
          <h3>Premissas desta proposta</h3>
          <ul>{(c.premissas.length ? c.premissas : ['Informações fornecidas pelo cliente até a data de emissão.']).map((x) => <li key={x}>{x}</li>)}</ul>
          {c.garantia && <><h3>Garantia</h3><p>{c.garantia}</p></>}
        </div>
        <div>
          <h3>Condições gerais</h3>
          <ul>{condicoes.map((x) => <li key={x}>{x}</li>)}</ul>
          {c.observacoes && <p style={{ whiteSpace: 'pre-wrap' }}>{c.observacoes}</p>}
        </div>
      </div>
    ),
  });

  paginas.push({
    titulo: 'Aceite e próximos passos',
    conteudo: (
      <div className="duas-colunas">
        <div>
          <h3>Como aprovar</h3>
          <ol>
            <li>Abra o link desta proposta e clique em <b>Aceitar esta proposta</b>, ou responda pedindo ajustes.</li>
            <li>Combinamos a data de início e, quando houver, o pagamento da entrada.</li>
            <li>Você recebe o acompanhamento de cada etapa com registros e fotos.</li>
          </ol>
          <p className="total-final">Total: <b>{formatar(total)}</b></p>
        </div>
        <div className="assinatura">
          <p><b>{d.empresa?.responsavel ?? 'Responsável técnico'}</b></p>
          <p>{d.empresa?.nome ?? 'ROSAE Engenharia & Estruturas'}</p>
          {d.empresa?.registro && <p>{d.empresa.registro}</p>}
          {d.empresa?.cnpj && <p>CNPJ {d.empresa.cnpj}</p>}
          <p>{[d.empresa?.telefone, d.empresa?.email, d.empresa?.site].filter(Boolean).join(' · ')}</p>
          {d.hash && <p className="codigo-verificacao">Código de verificação desta versão:<br />{d.hash.slice(0, 16).toUpperCase()}</p>}
        </div>
      </div>
    ),
  });

  return (
    <div className="documento-proposta">
      {paginas.map((p, k) => (
        <Slide key={k} n={k + 1} total={paginas.length} titulo={p.titulo} d={d} classe={p.classe}>{p.conteudo}</Slide>
      ))}
    </div>
  );
}
