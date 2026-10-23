// Aba "Portal" da obra (escritório): links pessoais dos clientes, o que vai
// para o portal, mensagens e ciências. Nada é publicado sem um clique aqui.
import { useMemo, useState } from 'react';
import { supabase, mensagemErro } from '../lib/supabase';
import { useConsulta, ok } from '../lib/consulta';
import { Ajuda, Carregando, Erro, Modal, useToast } from '../components/ui';
import { Icone } from '../components/Icone';
import { formatarData, formatarDataHora } from '../core/datas';
import { comprimirImagem, useUrlsFotos } from './ObraRegistros';
import { SeloEtapa } from './ObraCronograma';
import { TIPO_COMENTARIO, cienciaDoItem, type DadosPortal } from '../core/portal';
import { TIPO_PENDENCIA, TIPO_REGISTRO, type Etapa, type Foto, type Obra, type Pendencia, type Registro } from '../lib/tipos';

type Acesso = {
  id: string; pessoa_id: string; expira_em: string; revogado_em: string | null; motivo_revogacao: string | null;
  ultimo_acesso_em: string | null; acessos: number; criado_em: string; pessoa: { nome: string; telefone: string | null; email: string | null } | null;
};
type PessoaCurta = { id: string; nome: string; telefone: string | null; email: string | null };
type ObraPortalCampos = Obra & { portal_boas_vindas?: string | null; portal_capa_foto_id?: string | null };

async function paraBase64(b: Blob): Promise<string> {
  const url = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
  return url.slice(url.indexOf(',') + 1);
}

/** Cópia para o cliente: reduzida e regravada (sai sem os metadados da câmera, como localização). */
export async function prepararCopiaPortal(original: Blob) {
  const arquivo = new File([original], 'foto.jpg', { type: original.type || 'image/jpeg' });
  const grande = await comprimirImagem(arquivo, 1600, 0.8);
  const mini = await comprimirImagem(arquivo, 480, 0.72);
  return { imagem: await paraBase64(grande.blob), miniatura: await paraBase64(mini.blob), largura: grande.largura, altura: grande.altura };
}

export function PortalObra({ obra, aoMudar }: { obra: ObraPortalCampos; aoMudar: () => void }) {
  const toast = useToast();
  const [secao, setSecao] = useState<'registros' | 'fotos' | 'pendencias' | 'etapas' | 'materiais'>('registros');
  const [novoLink, setNovoLink] = useState<{ nome: string; link: string; telefone: string | null; email: string | null } | null>(null);
  const [gerar, setGerar] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const { dados, erro, carregando, recarregar } = useConsulta(async () => {
    const [ac, pes, reg, fot, pen, eta, mat, prev] = await Promise.all([
      supabase.from('portal_acesso').select('id, pessoa_id, expira_em, revogado_em, motivo_revogacao, ultimo_acesso_em, acessos, criado_em, pessoa:pessoa_id(nome, telefone, email)').eq('obra_id', obra.id).order('criado_em', { ascending: false }),
      supabase.from('pessoa').select('id, nome, telefone, email').or(`eh_cliente.eq.true${obra.cliente_id ? `,id.eq.${obra.cliente_id}` : ''}`).eq('arquivado', false).order('nome'),
      supabase.from('registro').select('*').eq('obra_id', obra.id).not('tipo', 'in', '(nota_interna,sistema)').order('data', { ascending: false }).order('criado_em', { ascending: false }),
      supabase.from('foto').select('*').eq('obra_id', obra.id).order('tirada_em', { ascending: false }),
      supabase.from('pendencia').select('*').eq('obra_id', obra.id).neq('estado', 'cancelada').order('criado_em', { ascending: false }),
      supabase.from('etapa').select('*').eq('obra_id', obra.id).neq('estado', 'cancelado').order('ordem'),
      supabase.from('material').select('id, descricao, visivel_cliente, responsavel_compra').eq('obra_id', obra.id).eq('estado', 'ativo').order('descricao'),
      supabase.rpc('portal_previa', { p_obra: obra.id }),
    ]);
    return {
      acessos: ok(ac) as unknown as Acesso[], pessoas: ok(pes) as PessoaCurta[], registros: ok(reg) as Registro[], fotos: ok(fot) as Foto[],
      pendencias: ok(pen) as Pendencia[], etapas: ok(eta) as Etapa[], materiais: ok(mat) as { id: string; descricao: string; visivel_cliente: boolean; responsavel_compra: string }[],
      previa: ok(prev) as DadosPortal,
    };
  }, [obra.id]);
  const urls = useUrlsFotos(dados?.fotos ?? []);

  async function chamar(rotulo: string, fn: () => PromiseLike<{ error: unknown }>, sucesso?: string) {
    setOcupado(rotulo);
    const r = await fn();
    setOcupado(null);
    if (r.error) return toast(mensagemErro(r.error));
    if (sucesso) toast(sucesso);
    recarregar();
  }

  async function publicarFoto(f: Foto) {
    setOcupado(f.id);
    try {
      const url = urls[f.caminho] ?? (await supabase.storage.from('documentos').createSignedUrl(f.caminho, 600)).data?.signedUrl;
      if (!url) throw new Error('Não consegui abrir a foto original.');
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Não consegui baixar a foto original.');
      const c = await prepararCopiaPortal(await resp.blob());
      const r = await supabase.rpc('publicar_foto', { p_foto: f.id, p_imagem: c.imagem, p_miniatura: c.miniatura, p_largura: c.largura, p_altura: c.altura });
      if (r.error) throw r.error;
      toast('Foto publicada no portal.');
      recarregar();
    } catch (e) {
      toast(mensagemErro(e));
    } finally {
      setOcupado(null);
    }
  }

  const vigentes = useMemo(() => (dados?.acessos ?? []).filter((a) => !a.revogado_em), [dados]);
  const historico = useMemo(() => (dados?.acessos ?? []).filter((a) => a.revogado_em), [dados]);

  if (carregando && !dados) return <Carregando />;
  if (erro) return <Erro mensagem={erro} />;
  if (!dados) return null;
  const { previa } = dados;
  const fotosPublicadas = dados.fotos.filter((f) => f.publicada_em);
  const abertas = previa.comentarios.filter((c) => c.estado === 'aberto').length;

  return (
    <div className="stack">
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h2>Portal do cliente</h2>
            <p className="muted small" style={{ margin: 0 }}>
              O cliente vê só o que estiver publicado: andamento físico, etapas visíveis, fotos, decisões e materiais sem valores. Nunca vê preços, pagamentos, notas ou notas internas.
            </p>
          </div>
          <a className="btn-secundario" href={`/obras/${obra.id}/portal-previa`} target="_blank" rel="noreferrer"><Icone nome="olho" /> Ver como cliente</a>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>Acesso das pessoas <Ajuda>Cada pessoa (por exemplo, marido e esposa) recebe o seu link e registra as próprias manifestações. O link vale pelo prazo escolhido e pode ser revogado a qualquer momento. Gerar um novo link invalida o anterior da mesma pessoa.</Ajuda></h3>
            <button className="btn-primario" onClick={() => setGerar(true)}><Icone nome="link" /> Gerar link</button>
          </div>
          {vigentes.length === 0 ? <p className="muted">Ninguém tem acesso ainda.</p> : (
            <ul className="lista-adm">
              {vigentes.map((a) => {
                const expirado = new Date(a.expira_em) < new Date();
                return (
                  <li key={a.id} className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <strong>{a.pessoa?.nome}</strong>{' '}
                      {expirado ? <span className="selo alerta">Expirado</span> : <span className="selo ok">Vale até {formatarData(a.expira_em)}</span>}
                      <div className="muted small">{a.ultimo_acesso_em ? `Último acesso ${formatarDataHora(a.ultimo_acesso_em)} · ${a.acessos} ${a.acessos === 1 ? 'acesso' : 'acessos'}` : 'Ainda não abriu'}</div>
                    </div>
                    <button className="btn-link" disabled={ocupado === a.id} onClick={() => {
                      if (!confirm(`Revogar o acesso de ${a.pessoa?.nome}? O link deixa de funcionar na hora.`)) return;
                      chamar(a.id, () => supabase.rpc('portal_revogar_acesso', { p_acesso: a.id, p_motivo: null }), 'Acesso revogado.');
                    }}>Revogar</button>
                  </li>
                );
              })}
            </ul>
          )}
          {historico.length > 0 && (
            <details className="small"><summary>Links anteriores ({historico.length})</summary>
              <ul className="lista-adm">{historico.map((a) => <li key={a.id}>{a.pessoa?.nome} · criado {formatarData(a.criado_em)} · revogado {formatarData(a.revogado_em)} ({a.motivo_revogacao})</li>)}</ul>
            </details>
          )}
        </div>

        <Apresentacao obra={obra} fotos={fotosPublicadas} urls={urls} aoSalvar={() => { aoMudar(); recarregar(); }} />
      </div>

      <div className="card">
        <h3>Publicar no portal</h3>
        <div className="segmentado" role="tablist" style={{ margin: '8px 0 12px' }}>
          {([['registros', 'Diário'], ['fotos', 'Fotos'], ['pendencias', 'Decisões e pendências'], ['etapas', 'Etapas'], ['materiais', 'Materiais']] as const).map(([k, r]) => (
            <button key={k} role="tab" aria-selected={secao === k} className={secao === k ? 'ativo' : ''} onClick={() => setSecao(k)}>{r}</button>
          ))}
        </div>

        {secao === 'registros' && (dados.registros.length === 0 ? <p className="muted">Sem registros no diário. Notas internas nunca aparecem aqui.</p> : (
          <ul className="lista-adm">
            {dados.registros.map((r) => (
              <li key={r.id} className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <span className="selo neutro">{TIPO_REGISTRO[r.tipo]}</span> <span className="muted small">{formatarData(r.data)}</span>
                  <div><strong>{r.titulo}</strong> {r.texto && <span className="muted">{r.texto.length > 140 ? `${r.texto.slice(0, 140)}…` : r.texto}</span>}</div>
                </div>
                <BotaoPublicar publicado={!!r.publicado_em} ocupado={ocupado === r.id}
                  aoClicar={() => chamar(r.id, () => supabase.rpc('portal_publicar', { p_tipo: 'registro', p_id: r.id, p_publicar: !r.publicado_em }), r.publicado_em ? 'Retirado do portal.' : 'Publicado no portal.')} />
              </li>
            ))}
          </ul>
        ))}

        {secao === 'fotos' && (dados.fotos.length === 0 ? <p className="muted">Sem fotos. Envie pelo Diário e fotos.</p> : (
          <>
            <p className="muted small">Ao publicar, o sistema cria uma cópia reduzida para o cliente, sem localização e demais dados da câmera. Retirar apaga a cópia na hora.</p>
            <div className="galeria">
              {dados.fotos.map((f) => (
                <div key={f.id} className="foto-pub">
                  {urls[f.caminho] ? <img src={urls[f.caminho]} alt={f.legenda ?? 'Foto'} /> : <div className="foto-carregando" />}
                  <div className="row" style={{ justifyContent: 'space-between', padding: '4px 6px', gap: 4 }}>
                    <span className="small muted">{formatarData(f.tirada_em)}</span>
                    <BotaoPublicar publicado={!!f.publicada_em} ocupado={ocupado === f.id} compacto
                      aoClicar={() => (f.publicada_em ? chamar(f.id, () => supabase.rpc('despublicar_foto', { p_foto: f.id }), 'Foto retirada do portal.') : publicarFoto(f))} />
                  </div>
                </div>
              ))}
            </div>
          </>
        ))}

        {secao === 'pendencias' && (dados.pendencias.length === 0 ? <p className="muted">Sem pendências. Crie pelo Diário (decisão do cliente, impedimento).</p> : (
          <ul className="lista-adm">
            {dados.pendencias.map((p) => (
              <li key={p.id} className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <div><span className="selo neutro">{TIPO_PENDENCIA[p.tipo]}</span> <strong>{p.titulo}</strong> <span className="muted small">{p.estado === 'aberta' ? 'em aberto' : 'resolvida'}</span></div>
                <BotaoPublicar publicado={!!p.publicado_em} ocupado={ocupado === p.id}
                  aoClicar={() => chamar(p.id, () => supabase.rpc('portal_publicar', { p_tipo: 'pendencia', p_id: p.id, p_publicar: !p.publicado_em }), p.publicado_em ? 'Retirada do portal.' : 'Publicada no portal.')} />
              </li>
            ))}
          </ul>
        ))}

        {secao === 'etapas' && (dados.etapas.length === 0 ? <p className="muted">Sem etapas no cronograma.</p> : (
          <>
            <p className="muted small">Etapas visíveis aparecem com estado, datas previstas e realizadas. O percentual geral considera todas as etapas.</p>
            <ul className="lista-adm">
              {dados.etapas.map((e) => (
                <li key={e.id} className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  <div><strong>{e.nome}</strong> <SeloEtapa estado={e.estado} /> <span className="muted small">{e.inicio_previsto ? formatarData(e.inicio_previsto) : 'sem data'}</span></div>
                  <BotaoPublicar publicado={e.visivel_cliente} ocupado={ocupado === e.id} rotulos={['Mostrar', 'Ocultar']}
                    aoClicar={() => chamar(e.id, () => supabase.rpc('portal_publicar', { p_tipo: 'etapa', p_id: e.id, p_publicar: !e.visivel_cliente }))} />
                </li>
              ))}
            </ul>
          </>
        ))}

        {secao === 'materiais' && (dados.materiais.length === 0 ? <p className="muted">Sem materiais.</p> : (
          <>
            <p className="muted small">O cliente vê só “previsto”, “aguardando entrega” ou “disponível na obra”. Sem quantidades compradas, fornecedores ou valores.</p>
            <ul className="lista-adm">
              {dados.materiais.map((m) => (
                <li key={m.id} className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  <span>{m.descricao}{m.responsavel_compra === 'cliente' && <span className="muted small"> · compra do cliente</span>}</span>
                  <BotaoPublicar publicado={m.visivel_cliente} ocupado={ocupado === m.id} rotulos={['Mostrar', 'Ocultar']}
                    aoClicar={() => chamar(m.id, () => supabase.rpc('portal_publicar', { p_tipo: 'material', p_id: m.id, p_publicar: !m.visivel_cliente }))} />
                </li>
              ))}
            </ul>
          </>
        ))}
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h3>Mensagens do cliente {abertas > 0 && <span className="selo alerta">{abertas} em aberto</span>}</h3>
          {previa.comentarios.length === 0 ? <p className="muted">Nenhuma mensagem ainda.</p> : (
            <ul className="lista-adm">
              {previa.comentarios.slice().reverse().map((c) => <RespostaComentario key={c.id} c={c} previa={previa} aoMudar={recarregar} />)}
            </ul>
          )}
        </div>
        <div className="card">
          <h3>Ciência dos participantes <Ajuda>Cada pessoa registra a própria ciência, com data e a versão do conteúdo. Se o item for alterado depois, a ciência antiga continua guardada e aparece como “versão anterior”. Ciência não é aprovação técnica, quitação nem aceite contratual.</Ajuda></h3>
          {previa.registros.length + previa.pendencias.length === 0 ? <p className="muted">Publique atualizações para colher ciência.</p> : (
            <ul className="lista-adm">
              {[...previa.registros.map((r) => ({ tipo: 'registro' as const, id: r.id, titulo: r.titulo || r.texto?.slice(0, 60) || TIPO_REGISTRO[r.tipo], versao: r.versao })),
                ...previa.pendencias.map((p) => ({ tipo: 'pendencia' as const, id: p.id, titulo: p.titulo, versao: p.versao }))].map((it) => {
                const c = cienciaDoItem(previa.ciencias, it.tipo, it.id, it.versao);
                const faltam = previa.participantes.filter((p) => !c.atuais.some((x) => x.pessoa_id === p.id));
                return (
                  <li key={it.id}>
                    <strong>{it.titulo}</strong>
                    <div className="small">
                      {c.atuais.map((x) => <span key={x.pessoa_id} className="selo ok" style={{ marginRight: 4 }}>{x.pessoa} · {formatarDataHora(x.criado_em)}</span>)}
                      {c.anteriores.map((x) => <span key={x.pessoa_id} className="selo neutro" style={{ marginRight: 4 }}>{x.pessoa}: versão anterior</span>)}
                      {faltam.length > 0 && <span className="muted">Sem ciência: {faltam.map((p) => p.nome).join(', ')}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {gerar && (
        <GerarLink obra={obra} pessoas={dados.pessoas} fechar={() => setGerar(false)}
          aoGerar={(l) => { setGerar(false); setNovoLink(l); recarregar(); }} />
      )}
      {novoLink && <LinkGerado l={novoLink} obraNome={obra.nome} fechar={() => setNovoLink(null)} />}
    </div>
  );
}

function BotaoPublicar({ publicado, ocupado, aoClicar, compacto, rotulos = ['Publicar', 'Retirar'] }: { publicado: boolean; ocupado: boolean; aoClicar: () => void; compacto?: boolean; rotulos?: [string, string] }) {
  return (
    <button className={publicado ? 'btn-secundario' : 'btn-primario'} style={compacto ? { padding: '2px 8px', fontSize: '0.8rem' } : undefined} disabled={ocupado} onClick={aoClicar}
      aria-label={publicado ? `${rotulos[1]} (está no portal)` : rotulos[0]}>
      {ocupado ? '…' : publicado ? <><Icone nome="check" /> {rotulos[1]}</> : rotulos[0]}
    </button>
  );
}

function Apresentacao({ obra, fotos, urls, aoSalvar }: { obra: ObraPortalCampos; fotos: Foto[]; urls: Record<string, string>; aoSalvar: () => void }) {
  const toast = useToast();
  const [texto, setTexto] = useState(obra.portal_boas_vindas ?? '');
  const [capa, setCapa] = useState(obra.portal_capa_foto_id ?? '');
  const [salvando, setSalvando] = useState(false);
  async function salvar() {
    setSalvando(true);
    const r = await supabase.from('obra').update({ portal_boas_vindas: texto.trim() || null, portal_capa_foto_id: capa || null }).eq('id', obra.id);
    setSalvando(false);
    if (r.error) return toast(mensagemErro(r.error));
    toast('Apresentação salva.');
    aoSalvar();
  }
  return (
    <div className="card">
      <h3>Apresentação</h3>
      <label htmlFor="boas-vindas">Mensagem de boas-vindas</label>
      <textarea id="boas-vindas" rows={3} maxLength={600} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ex.: Aqui vocês acompanham cada etapa da reforma. Qualquer dúvida, comentem direto na etapa ou na foto." />
      <label style={{ marginTop: 10 }}>Imagem de capa</label>
      {fotos.length === 0 ? <p className="muted small">Publique uma foto para usá-la como capa. Sem capa, o portal usa o fundo da marca.</p> : (
        <div className="portal-capas" role="radiogroup" aria-label="Imagem de capa">
          <button type="button" role="radio" aria-checked={!capa} className={!capa ? 'ativo' : ''} onClick={() => setCapa('')}>Sem capa</button>
          {fotos.map((f) => (
            <button type="button" key={f.id} role="radio" aria-checked={capa === f.id} className={capa === f.id ? 'ativo' : ''} onClick={() => setCapa(f.id)}>
              {urls[f.caminho] ? <img src={urls[f.caminho]} alt={f.legenda ?? `Foto de ${formatarData(f.tirada_em)}`} /> : formatarData(f.tirada_em)}
            </button>
          ))}
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
        <button className="btn-primario" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
      </div>
    </div>
  );
}

function GerarLink({ obra, pessoas, fechar, aoGerar }: { obra: Obra; pessoas: PessoaCurta[]; fechar: () => void; aoGerar: (l: { nome: string; link: string; telefone: string | null; email: string | null }) => void }) {
  const [pessoa, setPessoa] = useState(obra.cliente_id ?? pessoas[0]?.id ?? '');
  const [dias, setDias] = useState(180);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function gerar(e: React.FormEvent) {
    e.preventDefault();
    if (!pessoa) return setErro('Escolha a pessoa.');
    setEnviando(true);
    const r = await supabase.rpc('portal_criar_acesso', { p_obra: obra.id, p_pessoa: pessoa, p_dias: dias });
    setEnviando(false);
    if (r.error) return setErro(mensagemErro(r.error));
    const p = pessoas.find((x) => x.id === pessoa);
    aoGerar({ nome: p?.nome ?? '', link: `${window.location.origin}/c/${r.data as string}`, telefone: p?.telefone ?? null, email: p?.email ?? null });
  }
  return (
    <Modal titulo="Gerar link do portal" aoFechar={fechar} rodape={<><button className="btn-link" onClick={fechar}>Cancelar</button><button className="btn-primario" form="form-link" disabled={enviando}>{enviando ? 'Gerando…' : 'Gerar link'}</button></>}>
      <form id="form-link" onSubmit={gerar} className="stack">
        <div>
          <label htmlFor="pessoa-link">Pessoa</label>
          <select id="pessoa-link" value={pessoa} onChange={(e) => setPessoa(e.target.value)}>
            {pessoas.length === 0 && <option value="">Cadastre a pessoa em Pessoas (marque “cliente”)</option>}
            {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.id === obra.cliente_id ? ' (cliente da obra)' : ''}</option>)}
          </select>
          <p className="muted small">Para o cônjuge ou outro participante, cadastre a pessoa em Pessoas como cliente e gere um link só para ela.</p>
        </div>
        <div>
          <label htmlFor="dias-link">Validade</label>
          <select id="dias-link" value={dias} onChange={(e) => setDias(Number(e.target.value))}>
            {[30, 90, 180, 365].map((d) => <option key={d} value={d}>{d} dias</option>)}
          </select>
        </div>
        <p className="small muted">Se essa pessoa já tiver um link, ele deixa de valer e o novo passa a ser o único.</p>
        {erro && <p className="erro-campo" role="alert">{erro}</p>}
      </form>
    </Modal>
  );
}

function LinkGerado({ l, obraNome, fechar }: { l: { nome: string; link: string; telefone: string | null; email: string | null }; obraNome: string; fechar: () => void }) {
  const toast = useToast();
  const msg = `Olá, ${l.nome.split(' ')[0]}! Este é o seu link pessoal para acompanhar a obra "${obraNome}" com a ROSAE: ${l.link}\nEle é só seu, não compartilhe.`;
  const fone = l.telefone?.replace(/\D/g, '');
  return (
    <Modal titulo={`Link de ${l.nome}`} aoFechar={fechar} rodape={<button className="btn-primario" onClick={fechar}>Pronto</button>}>
      <div className="stack">
        <p className="aviso small">Este link aparece só agora. Envie para {l.nome}. Se perder, gere outro (o anterior deixa de valer).</p>
        <input readOnly value={l.link} onFocus={(e) => e.target.select()} aria-label="Link pessoal" />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-secundario" onClick={async () => { try { await navigator.clipboard.writeText(l.link); toast('Link copiado.'); } catch { toast('Copie manualmente o link acima.'); } }}>Copiar link</button>
          <a className="btn-secundario" href={`https://wa.me/${fone && fone.length >= 10 ? (fone.length <= 11 ? `55${fone}` : fone) : ''}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer">Enviar por WhatsApp</a>
          {l.email && <a className="btn-secundario" href={`mailto:${l.email}?subject=${encodeURIComponent(`Acompanhamento da obra ${obraNome}`)}&body=${encodeURIComponent(msg)}`}>Enviar por e-mail</a>}
        </div>
      </div>
    </Modal>
  );
}

function RespostaComentario({ c, previa, aoMudar }: { c: DadosPortal['comentarios'][number]; previa: DadosPortal; aoMudar: () => void }) {
  const toast = useToast();
  const [resp, setResp] = useState(c.resposta ?? '');
  const [aberto, setAberto] = useState(false);
  const onde = c.alvo_tipo === 'obra' ? 'Geral'
    : c.alvo_tipo === 'etapa' ? `Etapa ${previa.etapas.find((e) => e.id === c.alvo_id)?.nome ?? ''}`
      : c.alvo_tipo === 'servico' ? `Serviço ${previa.servicos.find((s) => s.id === c.alvo_id)?.nome ?? ''}`
        : c.alvo_tipo === 'registro' ? 'Atualização do diário' : c.alvo_tipo === 'foto' ? 'Foto' : 'Decisão/pendência';
  async function salvar(estado: 'respondido' | 'resolvido') {
    const r = await supabase.rpc('responder_comentario', { p_id: c.id, p_resposta: resp, p_estado: estado });
    if (r.error) return toast(mensagemErro(r.error));
    toast(estado === 'resolvido' ? 'Marcado como resolvido.' : 'Resposta publicada ao cliente.');
    setAberto(false);
    aoMudar();
  }
  return (
    <li>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <span><strong>{c.autor}</strong> <span className="muted small">· {TIPO_COMENTARIO[c.tipo]} · {onde} · {formatarDataHora(c.criado_em)}</span></span>
        <span className={`selo ${c.estado === 'aberto' ? 'alerta' : 'ok'}`}>{c.estado === 'aberto' ? 'Em aberto' : c.estado === 'respondido' ? 'Respondido' : 'Resolvido'}</span>
      </div>
      <p style={{ margin: '4px 0' }}>{c.texto}</p>
      {c.resposta && !aberto && <p className="small" style={{ margin: '4px 0' }}><strong>Resposta:</strong> {c.resposta}</p>}
      {aberto ? (
        <div className="stack">
          <textarea rows={2} value={resp} onChange={(e) => setResp(e.target.value)} aria-label="Resposta ao cliente" placeholder="A resposta aparece para todos os participantes da obra." />
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn-link" onClick={() => setAberto(false)}>Cancelar</button>
            <button className="btn-secundario" onClick={() => salvar('resolvido')}>Resolvido</button>
            <button className="btn-primario" onClick={() => salvar('respondido')} disabled={!resp.trim()}>Responder</button>
          </div>
        </div>
      ) : <button className="btn-link" onClick={() => setAberto(true)}>{c.resposta ? 'Editar resposta' : 'Responder'}</button>}
    </li>
  );
}
