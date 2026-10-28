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
  const itensEscopo = c.ambientes.flatMap((a) => a.itens.map((item) => ({ amb: a.nome, item })));
  const paginasEscopo = partes(itensEscopo, itensEscopo.length <= 5 ? 5 : 4);
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

  const prazoCapa = c.prazo_total_dias ? `${c.prazo_total_dias} dias` : c.prazo_texto ? c.prazo_texto.split(',')[0] : null;
  paginas.push({
    classe: 'capa',
    conteudo: (
      <div className="capa-grade">
        <div className="capa-texto">
          <img className="capa-logo" src="/marca/rosae-logo-horizontal-negativo.svg" alt="ROSAE Engenharia & Estruturas" />
          <p className="capa-tipo">{d.tipo === 'aditivo' ? 'Aditivo de escopo' : 'Proposta técnica e comercial'}</p>
          <h1>{d.titulo}</h1>
          <p className="capa-cliente">Preparada exclusivamente para <b>{d.cliente}</b></p>
        </div>
        <dl className="capa-dados">
          {c.local && <div><dt>Local</dt><dd>{c.local}</dd></div>}
          {prazoCapa && <div><dt>Prazo</dt><dd>{prazoCapa}</dd></div>}
          <div><dt>Emissão</dt><dd>{d.emitida_em ? formatarData(d.emitida_em.slice(0, 10)) : 'rascunho'}</dd></div>
          <div><dt>Válida até</dt><dd>{d.validade ? formatarData(d.validade) : `${c.validade_dias} dias após a emissão`}</dd></div>
          <div><dt>Referência</dt><dd>{d.codigo} · v{d.versao}</dd></div>
        </dl>
      </div>
    ),
  });

  if (c.resumo) {
    const principal = c.opcoes?.find((o) => o.principal);
    paginas.push({
      titulo: 'Em resumo',
      conteudo: (
        <div className="resumo-exec">
          <p className="resumo-frase">{c.resumo}</p>
          <div className="resumo-cartoes">
            <div><span>Investimento</span><b className="num">{formatar(total)}</b>{principal && <small>pacote {principal.nome}</small>}</div>
            <div><span>Prazo</span><b>{c.prazo_total_dias ? `${c.prazo_total_dias} dias` : '—'}</b><small>{c.etapas.length} etapas</small></div>
            <div><span>Você recebe</span><b>{(c.entregaveis ?? []).length || c.inclusoes.length}</b><small>{(c.entregaveis ?? []).length ? 'entregáveis' : 'itens inclusos'}</small></div>
            <div><span>Responsável técnico</span><b className="resumo-nome">{d.empresa?.responsavel ?? 'Engenheiro ROSAE'}</b><small>com ART</small></div>
          </div>
        </div>
      ),
    });
  }

  const temDados = (c.dados_tecnicos ?? []).length > 0;
  paginas.push({
    titulo: d.tipo === 'aditivo' ? 'O que muda' : temDados ? 'O que entendemos do seu projeto' : 'Quem somos e o que entendemos',
    conteudo: (
      <div className="duas-colunas">
        <div>
          {temDados ? (
            <>
              {c.necessidade && <><h3>A sua necessidade</h3><p className="citacao" style={{ whiteSpace: 'pre-wrap' }}>{c.necessidade}</p></>}
              <h3>Dados considerados</h3>
              <dl className="ficha-dados">{c.dados_tecnicos!.map((x) => <div key={x.rotulo}><dt>{x.rotulo}</dt><dd>{x.valor}</dd></div>)}</dl>
            </>
          ) : (
            <>
              <h3>A ROSAE</h3>
              <p>{c.apresentacao}</p>
              {d.empresa?.frase && <p className="destaque">“{d.empresa.frase}”</p>}
            </>
          )}
        </div>
        <div>
          {(c.riscos ?? []).length > 0 ? (
            <>
              <h3>Por que isso importa</h3>
              <ul className="lista-riscos">{c.riscos!.map((x) => <li key={x}>{x}</li>)}</ul>
            </>
          ) : (
            <>
              <h3>{d.tipo === 'aditivo' ? 'O que muda' : 'A sua necessidade'}</h3>
              <p style={{ whiteSpace: 'pre-wrap' }}>{c.necessidade || 'Descrição a completar.'}</p>
            </>
          )}
          {d.tipo === 'aditivo' && c.motivo && <p><b>Motivo:</b> {c.motivo}</p>}
          {d.tipo === 'aditivo' && c.impacto_prazo_dias != null && <p><b>Impacto no prazo:</b> {c.impacto_prazo_dias === 0 ? 'sem alteração' : `${c.impacto_prazo_dias > 0 ? '+' : ''}${c.impacto_prazo_dias} dia(s)`}</p>}
          {d.tipo === 'aditivo' && <p className="small">Este aditivo complementa o contrato original, que permanece válido nas demais condições.</p>}
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

  if ((c.entregaveis ?? []).length > 0) {
    paginas.push({
      titulo: 'O que você recebe',
      conteudo: (
        <div className="entregaveis">
          {c.entregaveis!.map((x, k) => <div key={x}><span className="entregavel-n">{String(k + 1).padStart(2, '0')}</span><b>{x}</b></div>)}
        </div>
      ),
    });
  }

  const inclusos = c.inclusoes.length ? c.inclusoes : ['Conforme escopo descrito.'];
  const naoInclusos = c.exclusoes.length ? c.exclusoes : ['Tudo o que não estiver descrito no escopo.'];
  if (inclusos.length + naoInclusos.length > 16) {
    paginas.push({ titulo: 'O que está incluso', conteudo: <ul className="marcas ok em-colunas">{inclusos.map((x) => <li key={x}>{x}</li>)}</ul> });
    paginas.push({ titulo: 'O que não está incluso', conteudo: <><ul className="marcas nao em-colunas">{naoInclusos.map((x) => <li key={x}>{x}</li>)}</ul><p className="small muted" style={{ marginTop: '2cqw' }}>Itens não inclusos podem ser contratados à parte, sempre com orçamento aprovado antes.</p></> });
  } else {
    paginas.push({
      titulo: 'O que está incluso e o que não está',
      conteudo: (
        <div className={`duas-colunas${inclusos.length + naoInclusos.length > 11 ? ' compacto' : ''}`}>
          <div>
            <h3 className="ok">Incluso</h3>
            <ul className="marcas ok">{inclusos.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
          <div>
            <h3 className="nao">Não incluso</h3>
            <ul className="marcas nao">{naoInclusos.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        </div>
      ),
    });
  }

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

  if ((c.metodologia ?? []).length > 0) {
    paginas.push({
      titulo: 'Como trabalhamos',
      conteudo: (
        <ol className="metodo">
          {c.metodologia!.map((m, k) => <li key={m.titulo}><span className="etapa-n">{k + 1}</span><b>{m.titulo}</b><span>{m.texto}</span></li>)}
        </ol>
      ),
    });
  }

  const comPrazo = c.etapas.length > 0 && c.etapas.every((e) => (e.prazo_dias ?? 0) > 0);
  const diasTotal = comPrazo ? c.etapas.reduce((t, e) => t + (e.prazo_dias ?? 0), 0) : 0;
  let acumulado = 0;
  paginas.push({
    titulo: comPrazo ? 'Cronograma' : 'Etapas e prazo',
    conteudo: (
      <div>
        {comPrazo ? (
          <div className="gantt">
            {c.etapas.map((e, k) => {
              const ini = acumulado;
              acumulado += e.prazo_dias ?? 0;
              return (
                <div key={k} className="gantt-linha">
                  <div className="gantt-nome"><b>{k + 1}. {e.nome}</b>{e.descricao && <span>{e.descricao}</span>}</div>
                  <div className="gantt-trilho">
                    <div className="gantt-barra" style={{ left: `${(ini / diasTotal) * 100}%`, width: `${((e.prazo_dias ?? 0) / diasTotal) * 100}%` }}><span>{e.prazo_dias} d</span></div>
                  </div>
                </div>
              );
            })}
            <div className="gantt-regua"><span>Aceite</span><span>dia {Math.round(diasTotal / 2)}</span><span>dia {diasTotal} · entrega</span></div>
          </div>
        ) : c.etapas.length > 0 && (
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

  const opcoes = (c.opcoes ?? []).filter((o) => o.valor > 0);
  if (opcoes.length > 1) {
    paginas.push({
      titulo: 'Escolha o seu pacote',
      conteudo: (
        <div className="opcoes-doc" style={{ gridTemplateColumns: `repeat(${opcoes.length}, 1fr)` }}>
          {opcoes.map((o) => (
            <div key={o.nome} className={`opcao-doc${o.principal ? ' principal' : ''}${o.recomendado ? ' recomendado' : ''}`}>
              {o.recomendado && <span className="opcao-selo">Mais escolhido</span>}
              <h3>{o.nome}</h3>
              <p className="opcao-sub">{o.subtitulo}</p>
              <p className="opcao-valor num">{formatar(paraCentavos(o.valor))}</p>
              <ul>{o.destaques.map((x) => <li key={x}>{x}</li>)}</ul>
              {o.principal && <p className="opcao-marca">Detalhado nesta proposta</p>}
            </div>
          ))}
        </div>
      ),
    });
  }

  paginasValores.forEach((pg, k) => {
    const ultima = k === paginasValores.length - 1;
    paginas.push({
      titulo: paginasValores.length > 1 ? `Investimento (${k + 1}/${paginasValores.length})` : 'Investimento',
      conteudo: (
        <div className={ultima && c.pagamento.parcelas.length ? 'investimento' : ''}>
          <table className="tabela-doc">
            <tbody>
              {pg.map(({ amb, item }, ix) =>
                item === null ? (
                  <tr key={`a-${amb.id ?? ix}`} className="amb"><td>{amb.nome}</td><td /><td className="num">{formatar(totalAmbiente(amb))}</td></tr>
                ) : (
                  <tr key={item.id ?? `i-${ix}`}><td>{item.titulo}</td><td className="muted">{qtd(item)}</td><td className="num">{formatar(paraCentavos(totalItem(item)))}</td></tr>
                ),
              )}
            </tbody>
            {ultima && <tfoot><tr><td>Total</td><td /><td className="num">{formatar(total)}</td></tr></tfoot>}
          </table>
          {ultima && c.pagamento.parcelas.length > 0 && (
            <div className="pagamento">
              <h3>Condições de pagamento</h3>
              {c.pagamento.descricao && <p>{c.pagamento.descricao}</p>}
              {c.condicao_especial && <p className="condicao-especial">{c.condicao_especial}</p>}
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

  if ((c.diferenciais ?? []).length > 0) {
    paginas.push({
      titulo: 'Por que a ROSAE',
      conteudo: (
        <div className="porque">
          <div className="porque-grade">
            {c.diferenciais!.map((x) => <div key={x.titulo}><b>{x.titulo}</b><span>{x.texto}</span></div>)}
          </div>
          {(c.normas ?? []).length > 0 && (
            <div className="normas"><h3>Normas técnicas que seguimos</h3><ul>{c.normas!.map((x) => <li key={x}>{x}</li>)}</ul></div>
          )}
        </div>
      ),
    });
  }

  if ((c.faq ?? []).length > 0) {
    paginas.push({
      titulo: 'Perguntas frequentes',
      conteudo: (
        <div className="faq">
          {c.faq!.slice(0, 6).map((x) => <div key={x.pergunta}><b>{x.pergunta}</b><p>{x.resposta}</p></div>)}
        </div>
      ),
    });
  }

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
