// Cartão "Avisos neste aparelho": liga a notificação de proposta aceita no celular e no computador.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ativarAvisos, desativarAvisos, situacaoAvisos, testarAvisos, type SituacaoAvisos } from '../lib/avisos';
import { Icone } from './Icone';
import { useToast } from './ui';
import { useAuth } from '../auth/AuthProvider';

const DISPENSA = 'rosae.avisos.dispensado';

export function AvisosAparelho({ compacto }: { compacto?: boolean }) {
  const toast = useToast();
  const { usuario } = useAuth();
  const doEscritorio = !!usuario?.ativo && ['administrador', 'administrativo'].includes(usuario.papel);
  const [sit, setSit] = useState<SituacaoAvisos | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aparelhos, setAparelhos] = useState<{ id: string; aparelho: string | null; criado_em: string }[]>([]);
  const [dispensado, setDispensado] = useState(() => localStorage.getItem(DISPENSA) === '1');

  const carregar = async () => {
    setSit(await situacaoAvisos().catch(() => 'sem_suporte' as const));
    if (!compacto) {
      const { data } = await supabase.from('push_assinatura').select('id, aparelho, criado_em').order('criado_em');
      setAparelhos((data ?? []) as typeof aparelhos);
    }
  };
  useEffect(() => { void carregar(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!sit || !doEscritorio) return null;
  if (compacto && (sit !== 'desligado' || dispensado)) return null;

  async function ligar() {
    setOcupado(true);
    const erro = await ativarAvisos().catch(() => 'Não consegui ligar os avisos neste aparelho.');
    setOcupado(false);
    if (erro) return toast(erro);
    toast('Avisos ligados neste aparelho.');
    await carregar();
    toast(await testarAvisos());
  }
  async function desligar() {
    setOcupado(true);
    await desativarAvisos().catch(() => undefined);
    setOcupado(false);
    toast('Avisos desligados neste aparelho.');
    await carregar();
  }

  if (compacto) {
    return (
      <div className="aviso info avisos-convite">
        <Icone nome="sino" />
        <span><b>Receba a agenda do dia, os lembretes, os atrasos e os aceites de proposta.</b> Ligue os avisos neste aparelho (vale para o celular e o computador).</span>
        <span className="spacer" />
        <button className="btn-primario" disabled={ocupado} onClick={ligar}>Ligar avisos</button>
        <button className="btn-link" onClick={() => { localStorage.setItem(DISPENSA, '1'); setDispensado(true); }}>Agora não</button>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Avisos no celular e no computador</h2>
      <p className="muted small" style={{ marginTop: 4 }}>Chega uma notificação do app ROSAE neste aparelho, mesmo com o sistema fechado: o resumo da agenda de cada manhã, o lembrete das tarefas com hora, o que atrasou (etapas, tarefas, contas e recebimentos) e quando um cliente aceita uma proposta ou um aditivo. Ligue em cada aparelho que você usa.</p>
      {sit === 'ligado' && <div className="aviso ok"><Icone nome="check" /><span>Avisos ligados neste aparelho.</span></div>}
      {sit === 'bloqueado' && <div className="aviso"><Icone nome="alerta" /><span>As notificações deste site estão bloqueadas no navegador. Libere em Configurações do navegador › Notificações e volte aqui.</span></div>}
      {sit === 'instalar_iphone' && <div className="aviso info"><span>No iPhone, os avisos funcionam com o app instalado: no Safari, toque em Compartilhar › Adicionar à Tela de Início, abra o ROSAE por lá e ligue os avisos.</span></div>}
      {sit === 'sem_suporte' && <div className="aviso info"><span>Este navegador não recebe avisos. Use o Chrome, o Edge ou o app instalado.</span></div>}
      <div className="row" style={{ marginTop: 10 }}>
        {sit === 'desligado' && <button className="btn-primario" disabled={ocupado} onClick={ligar}><Icone nome="sino" /> Ligar avisos neste aparelho</button>}
        {sit === 'ligado' && <button className="btn-secundario" disabled={ocupado} onClick={async () => toast(await testarAvisos())}>Mandar um aviso de teste</button>}
        {sit === 'ligado' && <button className="btn-link" disabled={ocupado} onClick={desligar}>Desligar neste aparelho</button>}
      </div>
      {aparelhos.length > 0 && (
        <>
          <h3 style={{ marginTop: 14 }}>Aparelhos com avisos ligados</h3>
          <ul className="lista-adm">
            {aparelhos.map((a) => (
              <li key={a.id} className="row" style={{ justifyContent: 'space-between' }}>
                <span>{a.aparelho ?? 'Aparelho'} <span className="muted small">· desde {new Date(a.criado_em).toLocaleDateString('pt-BR')}</span></span>
                <button className="btn-link small" onClick={async () => { await supabase.from('push_assinatura').delete().eq('id', a.id); await carregar(); }}>Tirar</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
