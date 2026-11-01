// Excluir qualquer cadastro, com segurança: mostra antes tudo o que vai junto, guarda na
// lixeira e permite restaurar. Só aparece para o administrador.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, mensagemErro } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { Icone } from './Icone';
import { Erro, Modal, useToast } from './ui';

/** Nome amigável de cada tabela, no singular e no plural. */
export const NOMES_TABELA: Record<string, [string, string]> = {
  pessoa: ['cadastro', 'cadastros'], oportunidade: ['oportunidade', 'oportunidades'], interacao: ['registro de conversa', 'registros de conversa'],
  proposta: ['proposta', 'propostas'], proposta_versao: ['versão de proposta', 'versões de proposta'], proposta_link: ['link de proposta', 'links de proposta'],
  proposta_evento: ['evento de proposta', 'eventos de proposta'], proposta_custo: ['custo interno de proposta', 'custos internos de proposta'],
  obra: ['obra', 'obras'], obra_financeiro: ['resumo financeiro de obra', 'resumos financeiros de obra'], membro_obra: ['membro de obra', 'membros de obra'],
  ambiente: ['ambiente', 'ambientes'], servico: ['serviço', 'serviços'], servico_ambiente: ['ligação serviço–ambiente', 'ligações serviço–ambiente'],
  servico_financeiro: ['valor de serviço', 'valores de serviço'], etapa: ['etapa', 'etapas'], etapa_historico: ['histórico de etapa', 'históricos de etapa'],
  material: ['material', 'materiais'], material_evento: ['movimento de material', 'movimentos de material'], ficha: ['ficha', 'fichas'],
  registro: ['registro do diário', 'registros do diário'], foto: ['foto', 'fotos'], foto_portal: ['foto do portal', 'fotos do portal'],
  pendencia: ['pendência', 'pendências'], portal_acesso: ['acesso ao portal', 'acessos ao portal'], portal_comentario: ['comentário do portal', 'comentários do portal'],
  portal_ciencia: ['ciência do cliente', 'ciências do cliente'], medicao: ['medição', 'medições'], contrato: ['contrato', 'contratos'],
  contrato_link: ['link de contrato', 'links de contrato'], contrato_aceite: ['assinatura de contrato', 'assinaturas de contrato'],
  contratacao: ['contratação de parceiro', 'contratações de parceiro'], contratacao_aditivo: ['aditivo de contratação', 'aditivos de contratação'],
  lancamento: ['lançamento', 'lançamentos'], parcela: ['parcela', 'parcelas'], movimento: ['movimento na conta', 'movimentos na conta'],
  lancamento_rateio: ['rateio', 'rateios'], arquivo: ['arquivo', 'arquivos'], conta_bancaria: ['conta bancária', 'contas bancárias'],
  categoria: ['categoria', 'categorias'], nota_fiscal: ['nota fiscal', 'notas fiscais'], nota_item: ['item de nota', 'itens de nota'],
  modelo_servico: ['serviço da biblioteca', 'serviços da biblioteca'], modelo_servico_custo: ['custo da biblioteca', 'custos da biblioteca'],
  clausula: ['cláusula', 'cláusulas'], clausula_versao: ['versão de cláusula', 'versões de cláusula'], meta: ['meta', 'metas'], envio_email: ['e-mail enviado', 'e-mails enviados'],
};
export const nomeTabela = (t: string, n: number) => (NOMES_TABELA[t] ?? [t.replace(/_/g, ' '), t.replace(/_/g, ' ')])[n === 1 ? 0 : 1];

type Plano = { resumo: Record<string, number>; total: number };

export function BotaoExcluir({ tabela, id, nome, aoExcluir, rotulo = 'Excluir', classe = 'btn-perigo' }: {
  tabela: string; id: string; nome: string; aoExcluir?: () => void; rotulo?: string; classe?: string;
}) {
  const { ehAdmin } = useAuth();
  const toast = useToast();
  const [plano, setPlano] = useState<Plano | null>(null);
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [certeza, setCerteza] = useState(false);
  if (!ehAdmin) return null;

  async function abrir() {
    setAberto(true); setErro(null); setPlano(null); setCerteza(false);
    const r = await supabase.rpc('excluir_registro', { p_tabela: tabela, p_id: id });
    if (r.error) setErro(mensagemErro(r.error)); else setPlano(r.data as Plano);
  }
  async function confirmar() {
    setOcupado(true);
    const r = await supabase.rpc('excluir_registro', { p_tabela: tabela, p_id: id, p_confirmar: true, p_nome: nome });
    setOcupado(false);
    if (r.error) return setErro(mensagemErro(r.error));
    setAberto(false);
    toast(`${nome} foi para a lixeira. Dá para restaurar em Empresa → Lixeira.`);
    aoExcluir?.();
  }
  const outros = plano ? Object.entries(plano.resumo).filter(([t]) => t !== tabela || plano.resumo[t] > 1).map(([t, n]) => [t, t === tabela ? n - 1 : n] as const).filter(([, n]) => n > 0) : [];
  const grande = (plano?.total ?? 0) > 1;
  return (
    <>
      <button type="button" className={classe} onClick={abrir}><Icone nome="lixeira" /> {rotulo}</button>
      {aberto && (
        <Modal titulo={`Excluir ${nome}?`} aoFechar={() => setAberto(false)} rodape={
          <>
            <button className="btn-link" onClick={() => setAberto(false)}>Cancelar</button>
            <button className="btn-perigo-cheio" disabled={!plano || ocupado || (grande && !certeza)} onClick={confirmar}>{ocupado ? 'Excluindo…' : 'Excluir e mandar para a lixeira'}</button>
          </>
        }>
          {!plano && !erro && <p className="muted">Conferindo o que está ligado…</p>}
          <Erro mensagem={erro} />
          {plano && (
            <div className="excluir-plano">
              {outros.length === 0 ? <p>Só este registro sai. Nada mais depende dele.</p> : (
                <>
                  <p>Junto com <b>{nome}</b> saem os registros ligados a ele:</p>
                  <ul>{outros.map(([t, n]) => <li key={t}><b className="num">{n}</b> {nomeTabela(t, n)}</li>)}</ul>
                </>
              )}
              <p className="muted small"><Icone nome="desfazer" /> Tudo vai para a <Link to="/lixeira">Lixeira</Link>, com os dados completos, e pode ser restaurado de uma vez.</p>
              {grande && (
                <label className="check"><input type="checkbox" checked={certeza} onChange={(e) => setCerteza(e.target.checked)} /> Entendi que {plano.total} registros saem juntos.</label>
              )}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
