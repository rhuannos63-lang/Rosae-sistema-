-- Contrato jurídico por tipo de serviço.
-- Cláusulas com base legal citada (Código Civil, CDC, Leis 5.194/66 e 6.496/77, LGPD,
-- Lei 14.063/20 e normas ABNT), um conjunto próprio para cada tipo de serviço e o
-- destaque das cláusulas que limitam direitos (CDC, art. 54, § 4º).
--
-- aplicavel passa a aceitar também o tipo de serviço, com o prefixo "s:"
-- (s:projeto, s:arquitetura, s:reforco, s:reforma, s:construcao, s:gestao,
-- s:regularizacao, s:laudo). Sem "s:", a cláusula vale para todos os serviços.
--
-- Novo estado de revisão: 'fundamentada' = texto com a base legal citada, pronto para
-- uso, sem a marca MINUTA. 'revisada' continua sendo a revisão registrada por advogado.

alter table public.clausula drop constraint if exists clausula_revisao_juridica_check;
alter table public.clausula add constraint clausula_revisao_juridica_check
  check (revisao_juridica in ('minuta', 'fundamentada', 'revisada'));
alter table public.clausula add column if not exists destaque boolean not null default false;

-- Mudou o texto: nova versão. Revisada por advogado volta a fundamentada (o texto não é
-- mais o revisado), a não ser que a nova revisão venha junto. Fundamentada continua.
create or replace function public.clausula_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.atualizado_em := now();
  if new.texto is distinct from old.texto or new.titulo is distinct from old.titulo then
    insert into clausula_versao (clausula_id, versao, titulo, texto, revisao_juridica)
    values (old.id, old.versao, old.titulo, old.texto, old.revisao_juridica);
    new.versao := old.versao + 1;
    if new.revisao_juridica = 'revisada' and new.revisado_em is distinct from old.revisado_em then
      null;
    elsif new.revisao_juridica in ('revisada', 'fundamentada') then
      new.revisao_juridica := 'fundamentada';
    else
      new.revisao_juridica := 'minuta';
    end if;
  end if;
  if new.revisao_juridica = 'revisada' and (coalesce(trim(new.revisado_por), '') = '' or new.revisado_em is null) then
    raise exception 'Para marcar como revisada, informe quem revisou e a data.';
  end if;
  return new;
end $$;

-- Emitir: só sai como minuta se houver cláusula sem base (minuta) ou trecho em aberto.
create or replace function public.emitir_contrato(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c contrato; v_hash text; v_minuta boolean;
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
  select * into c from contrato where id = p_id for update;
  if c.id is null then raise exception 'Contrato não encontrado.'; end if;
  if c.estado <> 'rascunho' then return c.hash; end if;
  if jsonb_array_length(coalesce(c.conteudo->'clausulas', '[]')) = 0 then raise exception 'O contrato precisa de cláusulas.'; end if;
  select exists (
    select 1 from jsonb_array_elements(c.conteudo->'clausulas') x
    where coalesce(x->>'revisao_juridica', 'minuta') not in ('revisada', 'fundamentada')
       or x->>'texto' like '%[Minuta%'
  ) into v_minuta;
  v_hash := encode(extensions.digest(convert_to(c.id::text || '|' || c.valor_total::text || '|' || c.conteudo::text, 'UTF8'), 'sha256'), 'hex');
  update contrato set estado = 'emitido', hash = v_hash, emitido_em = now(), minuta = v_minuta where id = p_id;
  return v_hash;
end $$;

-- ---------------------------------------------------------------------
-- Cláusulas gerais (as iniciais são reescritas só se você nunca as editou)
-- ---------------------------------------------------------------------
create temporary table _cl (codigo text, titulo text, texto text, aplicavel text[], ordem int, destaque boolean, referencias text);

insert into _cl values
('objeto', 'Objeto',
 $t$O presente contrato tem por objeto a prestação, pela CONTRATADA ao CONTRATANTE, dos serviços de {servicos}, no local indicado neste instrumento, conforme o escopo, as inclusões, as exclusões e as responsabilidades aqui descritos e a proposta {proposta} aprovada pelo CONTRATANTE, que integra este contrato. Serviços que não estejam expressamente listados no escopo não fazem parte deste contrato.$t$,
 '{todos}', 1, false, 'Código Civil, arts. 593 a 609 e 610 a 626'),
('documentos', 'Documentos integrantes e informação prévia',
 $t$Integram este contrato, nesta ordem de prevalência: (i) este instrumento; (ii) os aditivos aprovados por escrito; (iii) a proposta aprovada, na versão identificada. Em caso de divergência, prevalece o documento de ordem anterior, salvo aditivo posterior que trate do mesmo ponto. O CONTRATANTE declara que recebeu a proposta e este contrato antes da assinatura e que teve oportunidade de ler e esclarecer todas as cláusulas (CDC, arts. 6º, III, e 46).$t$,
 '{todos}', 2, false, 'CDC, arts. 6º, III, e 46'),
('preco_fechado', 'Preço',
 $t$Pela execução do escopo, o CONTRATANTE pagará o valor total de {valor_total}, conforme as condições de pagamento deste contrato. O preço é fixo e inclui todos os custos necessários à execução do escopo sob responsabilidade da CONTRATADA, inclusive mão de obra, encargos, equipamentos e tributos. O preço só será alterado por aditivo aprovado por escrito pelo CONTRATANTE (Código Civil, art. 619), salvo o reajuste previsto neste contrato.$t$,
 '{preco_fechado,projeto}', 3, false, 'Código Civil, art. 619'),
('gestao_honorarios', 'Honorários de gestão',
 $t$Pelos serviços de gestão, o CONTRATANTE pagará {honorarios}. Os custos de materiais, mão de obra e serviços de terceiros não estão incluídos nos honorários, salvo quando expressamente indicado no escopo, e são pagos pelo CONTRATANTE diretamente aos fornecedores ou por reembolso comprovado.$t$,
 '{gestao,combinado}', 4, false, null),
('acompanhamento', 'Acompanhamento técnico e visitas',
 $t$O acompanhamento compreende {visitas_incluidas} visita(s) técnica(s) no período contratado, com registro no portal de acompanhamento. Visitas adicionais solicitadas pelo CONTRATANTE custarão {visita_adicional} cada uma e só serão feitas após sua confirmação por escrito (CDC, art. 39, VI).$t$,
 '{acompanhamento,gestao,combinado}', 5, false, 'CDC, art. 39, VI'),
('administracao', 'Administração e reembolso',
 $t$Os custos da obra serão pagos pelo CONTRATANTE diretamente ou por reembolso, mediante apresentação da nota fiscal ou do comprovante de cada despesa. A remuneração da CONTRATADA pela administração será {remuneracao_administracao}. A CONTRATADA prestará contas mensalmente, com a relação das despesas e seus comprovantes. As economias obtidas nas compras pertencem ao CONTRATANTE.$t$,
 '{administracao,combinado}', 6, false, null),
('pagamento_mora', 'Pagamento e atraso',
 $t$Os pagamentos serão feitos nas datas e formas previstas neste contrato, e a CONTRATADA emitirá recibo ou nota fiscal de cada um. O valor pago em atraso terá multa de 2% (dois por cento) (CDC, art. 52, § 1º), juros de mora de 1% (um por cento) ao mês, calculados dia a dia, e correção monetária pelo IPCA/IBGE, desde o vencimento até o pagamento. Atraso superior a 15 (quinze) dias, depois de aviso por escrito, permite à CONTRATADA suspender os serviços até a regularização (Código Civil, art. 476), e o prazo fica prorrogado pelo mesmo período. O CONTRATANTE pode antecipar pagamentos a qualquer tempo.$t$,
 '{todos}', 7, true, 'CDC, art. 52, § 1º; Código Civil, arts. 389, 395 e 476'),
('prazo', 'Prazo e prorrogações',
 $t$O prazo estimado de execução é de {prazo}, contado da liberação para início, que ocorre depois da assinatura deste contrato, do pagamento da primeira parcela, quando houver, e da entrega pelo CONTRATANTE das informações, documentos e acessos necessários. O prazo fica prorrogado pelo tempo do impedimento em caso de: atraso do CONTRATANTE em decisões, aprovações, pagamentos ou fornecimentos que lhe cabem; chuvas que impeçam o trabalho; exigências ou demora de órgãos públicos, concessionárias ou condomínio; caso fortuito ou força maior (Código Civil, art. 393). Todo impedimento será registrado e comunicado por escrito ao CONTRATANTE.$t$,
 '{todos}', 8, false, 'Código Civil, art. 393'),
('atraso_contratada', 'Atraso por culpa da CONTRATADA',
 $t$Se a conclusão atrasar mais de 30 (trinta) dias além da data prevista, por culpa exclusiva da CONTRATADA, ela pagará ao CONTRATANTE multa de 0,5% (meio por cento) do valor do contrato por mês de atraso, proporcional aos dias, limitada a 10% (dez por cento) do valor do contrato, sem prejuízo de o CONTRATANTE exigir o cumprimento do contrato ou a indenização de danos comprovados que excedam a multa (Código Civil, art. 416, parágrafo único).$t$,
 '{todos}', 9, false, 'Código Civil, arts. 408 a 416'),
('reajuste', 'Reajuste',
 $t$Se a execução se estender, por motivo que não seja culpa da CONTRATADA, por mais de 12 (doze) meses contados da data da proposta, as parcelas que vencerem depois disso serão reajustadas pela variação do INCC-M/FGV acumulada desde aquela data (Lei 10.192/2001, art. 2º, § 1º).$t$,
 '{todos,s:construcao,s:reforma,s:reforco,s:gestao}', 10, false, 'Lei 10.192/2001, art. 2º');

-- ---------------------------------------------------------------------
-- Por tipo de serviço
-- ---------------------------------------------------------------------
insert into _cl values
-- Projeto estrutural
('projeto_entrada', 'Dados de entrada do projeto estrutural',
 $t$O projeto estrutural será desenvolvido com base no projeto arquitetônico definitivo, no levantamento do local e na sondagem do solo (ABNT NBR 6484 e NBR 8036), fornecidos pelo CONTRATANTE quando não incluídos no escopo. Sem sondagem, a CONTRATADA adotará hipóteses de cálculo conservadoras, informadas por escrito, e a fundação poderá ser revista quando a sondagem for apresentada. Mudanças na arquitetura depois do início do lançamento estrutural serão tratadas como alteração de escopo.$t$,
 '{s:projeto}', 20, false, 'ABNT NBR 6118, 6120, 6122, 6484 e 8036'),
('projeto_entregas', 'Entregáveis do projeto',
 $t$Serão entregues, conforme o escopo: plantas de formas, armações e detalhes, memorial com as premissas de cálculo, quantitativos dos materiais estruturais e a ART, em arquivos digitais assinados. O projeto atenderá às normas técnicas aplicáveis listadas na cláusula de legislação.$t$,
 '{s:projeto}', 21, false, null),
-- Projeto arquitetônico
('arquitetura_etapas', 'Etapas do projeto arquitetônico e aprovação legal',
 $t$O projeto arquitetônico será desenvolvido nas etapas previstas no escopo (por exemplo, estudo preliminar, anteprojeto, projeto legal e projeto executivo; ABNT NBR 16636), e cada etapa será aprovada por escrito pelo CONTRATANTE antes da seguinte. O CONTRATANTE fornecerá o programa de necessidades, o levantamento do terreno e a documentação do imóvel (matrícula ou escritura e IPTU). Quando a aprovação na prefeitura estiver no escopo, a CONTRATADA conduzirá o processo e atenderá às exigências técnicas; taxas e emolumentos públicos são do CONTRATANTE, e o tempo de análise dos órgãos públicos não conta no prazo deste contrato.$t$,
 '{s:arquitetura}', 22, false, 'ABNT NBR 16636 e NBR 9050'),
-- Projetos (estrutural e arquitetônico)
('projeto_revisoes', 'Revisões e aceite das entregas',
 $t$Estão incluídas as revisões indicadas na proposta para ajustes pedidos pelo CONTRATANTE. O CONTRATANTE terá 10 (dez) dias úteis para analisar cada entrega e pedir ajustes; sem manifestação nesse prazo, a etapa será considerada entregue para fins de pagamento. Correções de erros ou omissões da CONTRATADA são sempre gratuitas, a qualquer tempo, e não contam como revisão.$t$,
 '{s:projeto,s:arquitetura}', 23, true, null),
('projeto_autoria', 'Autoria e uso do projeto',
 $t$O projeto é obra intelectual de autoria do responsável técnico (Lei 9.610/1998, art. 7º, X; Lei 5.194/1966, arts. 17 e 18). Pago o preço, o CONTRATANTE pode usá-lo para executar a obra no local deste contrato. Alterações no projeto só podem ser feitas pelo autor ou com sua concordância por escrito (Código Civil, art. 621); quem alterar o projeto sem essa concordância assume a responsabilidade técnica pelas partes alteradas.$t$,
 '{s:projeto,s:arquitetura}', 24, true, 'Lei 9.610/1998, art. 7º, X; Lei 5.194/1966, arts. 17 e 18; Código Civil, art. 621'),
('projeto_execucao', 'Execução da obra por terceiros',
 $t$Este contrato não inclui a execução da obra nem sua fiscalização, salvo se constarem do escopo. A CONTRATADA esclarecerá, sem custo, dúvidas sobre o projeto durante a execução, pelos canais deste contrato; visitas à obra seguem o previsto no escopo. A CONTRATADA não responde por falhas causadas por execução em desacordo com o projeto, por materiais fora da especificação ou por remoção de escoramentos antes do prazo técnico.$t$,
 '{s:projeto,s:arquitetura}', 25, true, null),
-- Reforço estrutural
('reforco_diagnostico', 'Diagnóstico e condições encontradas',
 $t$O reforço segue o diagnóstico e o projeto de reforço indicados na proposta, elaborados ou validados pela CONTRATADA. Se, ao abrir os elementos, forem encontradas condições diferentes das previstas (como corrosão de armaduras além do estimado, vazios, fissuras ou cargas não informadas), a CONTRATADA paralisará o trecho afetado, adotará as medidas de segurança necessárias e apresentará ao CONTRATANTE a solução técnica, com preço e prazo, que só será executada após sua aprovação por escrito.$t$,
 '{s:reforco}', 26, false, 'ABNT NBR 6118, 8800 e 14931'),
('reforco_seguranca', 'Escoramento, segurança e liberação de uso',
 $t$A CONTRATADA é responsável pelo escoramento, pelas proteções e pela segurança dos trabalhadores durante o reforço (NR-18). O CONTRATANTE respeitará as áreas isoladas, não carregará os elementos em reforço e não liberará o uso dessas áreas antes da autorização escrita da CONTRATADA, observados os prazos de cura e de desforma. Em edificação em condomínio, o CONTRATANTE entregará o plano de reforma ao responsável legal antes do início (ABNT NBR 16280).$t$,
 '{s:reforco}', 27, false, 'NR-18; ABNT NBR 16280'),
-- Reforma
('reforma_plano', 'Plano de reforma e condomínio',
 $t$Antes do início, a CONTRATADA elaborará o plano de reforma, com a descrição dos serviços, os responsáveis técnicos, os prazos, os horários e a destinação dos resíduos (ABNT NBR 16280). Em edificação em condomínio, cabe ao CONTRATANTE entregar o plano ao síndico ou responsável legal e obter a autorização necessária, e o início depende dessa autorização. As partes respeitarão os horários e as regras internas do condomínio.$t$,
 '{s:reforma}', 28, false, 'ABNT NBR 16280'),
('reforma_preexistentes', 'Condições preexistentes do imóvel',
 $t$A CONTRATADA não responde por vícios, danos ou instalações irregulares que já existiam no imóvel e não fazem parte do escopo, como infiltrações, tubulações antigas, fiação fora de norma ou elementos estruturais comprometidos, salvo se agravados pela sua execução. Ao identificar uma condição preexistente que afete o serviço, a CONTRATADA a registrará com fotos, comunicará ao CONTRATANTE e proporá a solução por aditivo.$t$,
 '{s:reforma,s:reforco}', 29, true, null),
-- Construção
('construcao_licencas', 'Licenças, projetos e ligações',
 $t$Salvo indicação diferente no escopo, cabe ao CONTRATANTE providenciar e custear o alvará de obra, os projetos aprovados, as taxas públicas e os pedidos de ligação de água, esgoto e energia. A CONTRATADA não iniciará a obra sem alvará, quando exigido pela legislação municipal. A inscrição da obra no Cadastro Nacional de Obras (CNO) e os recolhimentos previdenciários da mão de obra seguem a legislação vigente, a cargo de quem o escopo indicar.$t$,
 '{s:construcao}', 30, false, null),
-- Execução no local (reforço, reforma, construção)
('riscos_obra', 'Riscos e guarda da obra',
 $t$Quando a CONTRATADA fornecer os materiais, os riscos da obra correm por sua conta até a entrega (Código Civil, art. 611); quando fornecer só a mão de obra, ela responde pelos riscos a que der causa (art. 612). Materiais comprados pelo CONTRATANTE ficam sob a guarda da CONTRATADA depois de recebidos por ela no local. A CONTRATADA cumprirá as normas de segurança do trabalho na construção (NR-18).$t$,
 '{s:reforco,s:reforma,s:construcao}', 31, false, 'Código Civil, arts. 611 e 612; NR-18'),
('residuos', 'Limpeza e resíduos',
 $t$A CONTRATADA manterá o local organizado, fará a limpeza ao fim de cada etapa e destinará o entulho a local licenciado (Resolução CONAMA 307/2002), salvo se o escopo atribuir essa tarefa ao CONTRATANTE. Caçambas e licenças de uso da via pública seguem o indicado no escopo.$t$,
 '{s:reforco,s:reforma,s:construcao}', 32, false, 'Resolução CONAMA 307/2002'),
('recebimento', 'Entrega e recebimento',
 $t$Concluídos os serviços, as partes farão vistoria conjunta e assinarão o termo de entrega, com a lista de pendências, se houver, que a CONTRATADA corrigirá no prazo combinado no termo. O CONTRATANTE pode recusar o recebimento se os serviços se afastarem do contratado ou das regras técnicas, ou recebê-los com abatimento no preço (Código Civil, arts. 615 e 616). Na entrega de construção ou reforma de sistemas, a CONTRATADA entregará as orientações de uso e manutenção (ABNT NBR 14037 e NBR 5674).$t$,
 '{s:reforco,s:reforma,s:construcao}', 33, false, 'Código Civil, arts. 614 a 616; ABNT NBR 14037 e 5674'),
-- Gestão e acompanhamento
('gestao_natureza', 'Natureza da gestão e responsabilidade de terceiros',
 $t$A gestão e o acompanhamento consistem em planejar, coordenar, orientar e fiscalizar tecnicamente a obra, com os relatórios previstos no escopo. Fornecedores e prestadores contratados diretamente pelo CONTRATANTE respondem pelos próprios serviços e materiais e por suas obrigações trabalhistas, fiscais e previdenciárias. A CONTRATADA responde pelas falhas da sua própria atuação, inclusive de fiscalização, e comunicará por escrito ao CONTRATANTE toda irregularidade que constatar na execução de terceiros, recomendando a correção ou a paralisação do serviço.$t$,
 '{s:gestao}', 34, true, null),
('gestao_compras', 'Compras em nome do CONTRATANTE',
 $t$Quando a CONTRATADA cotar, indicar ou comprar materiais e serviços em nome do CONTRATANTE, apresentará as cotações previstas no escopo, a nota fiscal e o comprovante de cada despesa, e prestará contas mensalmente. A CONTRATADA não receberá comissão ou vantagem de fornecedores sem informar o CONTRATANTE por escrito, e os descontos obtidos pertencem ao CONTRATANTE.$t$,
 '{s:gestao}', 35, false, null),
-- Regularização
('regularizacao_natureza', 'Natureza do serviço e órgãos públicos',
 $t$A CONTRATADA elaborará os levantamentos, as peças técnicas e os requerimentos previstos no escopo e acompanhará o processo na prefeitura, no cartório e nos demais órgãos, atendendo às exigências técnicas. O deferimento depende da decisão desses órgãos e da situação jurídica e física do imóvel; por isso, a CONTRATADA se obriga a conduzir o processo com diligência, mas não garante o resultado nem o tempo de análise, que não conta no prazo deste contrato. Toda exigência recebida será informada ao CONTRATANTE, por escrito, com as alternativas possíveis.$t$,
 '{s:regularizacao}', 36, true, 'Lei 6.015/1973; legislação urbanística municipal'),
('regularizacao_custos', 'Taxas, documentos e obras de adequação',
 $t$São do CONTRATANTE as taxas, emolumentos, impostos (como ITBI e IPTU em atraso), multas e contrapartidas cobrados pelos órgãos públicos e cartórios, e a entrega dos documentos pessoais e do imóvel solicitados. Obras de adequação exigidas para a regularização não estão incluídas e, se contratadas, serão objeto de aditivo. Exigências causadas por erro da CONTRATADA serão atendidas sem custo.$t$,
 '{s:regularizacao}', 37, true, null),
-- Laudo, vistoria e perícia
('laudo_alcance', 'Vistoria, alcance e uso do laudo',
 $t$A vistoria será visual, com os ensaios expressamente previstos no escopo, segundo a ABNT NBR 13752 e, quando aplicável, a ABNT NBR 16747. As conclusões refletem as condições observadas na data da vistoria e as informações e documentos fornecidos; vícios que só possam ser identificados com ensaios não previstos ficam fora do alcance do laudo, o que constará nele. O laudo terá ART, destina-se à finalidade informada pelo CONTRATANTE, e sua conclusão técnica é independente e não depende do pagamento ou do interesse das partes.$t$,
 '{s:laudo}', 38, true, 'ABNT NBR 13752 e 16747'),
-- Garantias
('garantia_obra', 'Garantia dos serviços',
 $t$A CONTRATADA responde, por 5 (cinco) anos contados da entrega, pela solidez e segurança dos serviços estruturais e da construção que executar, em razão dos materiais e do solo (Código Civil, art. 618). Para os demais vícios valem os prazos do CDC: 90 (noventa) dias para reclamar de vícios aparentes, contados da entrega, e, para vícios ocultos, contados de quando ficarem evidentes (CDC, art. 26). A CONTRATADA oferece ainda garantia contratual de 1 (um) ano, contada da entrega, que se soma à garantia legal (CDC, art. 50). Constatado o vício, a CONTRATADA o corrigirá sem custo; não corrigido em 30 (trinta) dias, o CONTRATANTE pode escolher a reexecução, o abatimento proporcional do preço ou a restituição do valor pago pela parte com vício, sem prejuízo de perdas e danos (CDC, art. 20). A garantia não cobre danos causados por uso inadequado, falta da manutenção prevista (ABNT NBR 5674), desgaste natural ou intervenção de terceiros.$t$,
 '{s:reforco,s:reforma,s:construcao}', 40, true, 'Código Civil, art. 618; CDC, arts. 20, 26 e 50; ABNT NBR 15575 e 5674'),
('garantia_projeto', 'Responsabilidade técnica pelo projeto',
 $t$A CONTRATADA responde pela correção técnica do projeto e pelo atendimento às normas aplicáveis, nos termos da lei. Erros ou omissões do projeto serão corrigidos sem custo assim que comunicados, e a CONTRATADA responde pelos danos que deles decorrerem (CDC, art. 14). Essa responsabilidade não alcança as partes alteradas por terceiros, a execução em desacordo com o projeto ou o uso da edificação diferente do previsto.$t$,
 '{s:projeto,s:arquitetura}', 41, true, 'CDC, art. 14'),
('garantia_servico_tecnico', 'Responsabilidade pelo serviço técnico',
 $t$A CONTRATADA responde pela correção técnica dos documentos que elaborar. Erros ou omissões da CONTRATADA serão corrigidos sem custo assim que comunicados, inclusive com o atendimento das exigências deles decorrentes, e a CONTRATADA responde pelos danos que deles decorrerem (CDC, art. 14).$t$,
 '{s:regularizacao,s:laudo,s:gestao}', 42, false, 'CDC, art. 14');

-- ---------------------------------------------------------------------
-- Cláusulas gerais do fim
-- ---------------------------------------------------------------------
insert into _cl values
('obrigacoes_contratada', 'Obrigações da CONTRATADA',
 $t$Executar os serviços com boa técnica e conforme as normas técnicas e a legislação aplicáveis; manter no serviço profissionais habilitados e responder pelos parceiros e subcontratados que ela indicar ou contratar, inclusive pelas obrigações trabalhistas, fiscais e previdenciárias deles; cumprir as normas de segurança do trabalho quando houver serviço no local; manter o CONTRATANTE informado por escrito sobre o andamento; registrar impedimentos e decisões; emitir recibo ou nota fiscal de cada pagamento; reparar os danos que causar ao imóvel, a vizinhos ou a terceiros na execução dos serviços (CDC, art. 14).$t$,
 '{todos}', 50, false, 'CDC, art. 14'),
('obrigacoes_contratante', 'Obrigações do CONTRATANTE',
 $t$Garantir o acesso ao local nos horários combinados; fornecer as informações e documentos necessários e informar, antes do início, tudo o que souber sobre o imóvel que possa afetar o serviço (reformas anteriores, problemas conhecidos, instalações ocultas); tomar as decisões que lhe cabem nos prazos combinados; efetuar os pagamentos nas datas previstas; providenciar os itens de sua responsabilidade listados no escopo; e não permitir que terceiros intervenham nos serviços da CONTRATADA sem aviso prévio a ela.$t$,
 '{todos}', 51, false, null),
('art', 'Responsabilidade técnica (ART)',
 $t$Antes do início, a CONTRATADA registrará no CREA a Anotação de Responsabilidade Técnica (ART) dos serviços deste contrato, em nome do responsável técnico identificado no preâmbulo (Lei 6.496/1977), e entregará cópia ao CONTRATANTE. A taxa da ART está incluída no preço, salvo indicação diferente no escopo. Serviços técnicos de outras especialidades que não estejam no escopo terão responsável técnico e ART próprios.$t$,
 '{todos}', 52, false, 'Lei 6.496/1977; Lei 5.194/1966'),
('alteracoes', 'Alterações e serviços adicionais',
 $t$Qualquer alteração de escopo, serviço adicional ou supressão será formalizada em aditivo, com descrição, preço, impacto no prazo e motivo, e só será executada após aprovação por escrito do CONTRATANTE. Nenhum serviço adicional será cobrado sem essa aprovação prévia (CDC, art. 39, VI). O contrato original permanece preservado.$t$,
 '{todos}', 53, false, 'CDC, art. 39, VI; Código Civil, art. 619'),
('existentes', 'Intervenções em elementos existentes',
 $t$Antes de intervir em elementos existentes, a CONTRATADA registrará a condição anterior com fotos, os riscos identificados, a necessidade de proteção ou desmontagem e as recomposições incluídas e não incluídas. Constatado um impedimento, a solução proposta será apresentada ao CONTRATANTE, e a execução só prosseguirá após sua aprovação. A autorização do CONTRATANTE não representa renúncia a direitos.$t$,
 '{todos,s:reforco,s:reforma,s:construcao,s:gestao}', 54, false, null),
('materiais', 'Materiais e compras',
 $t$A responsabilidade pela compra de cada material segue o indicado no escopo (CONTRATADA, CONTRATANTE ou terceiro). Os materiais fornecidos pela CONTRATADA serão novos e conformes à especificação, e a troca por similar depende de aprovação do CONTRATANTE. Materiais comprados pelo CONTRATANTE devem estar no local na data combinada; a falta deles prorroga o cronograma pelo tempo do atraso.$t$,
 '{todos,s:reforco,s:reforma,s:construcao,s:gestao}', 55, false, null),
('comunicacao', 'Comunicação e registros',
 $t$As comunicações entre as partes serão feitas por escrito, pelo portal de acompanhamento, por e-mail ou por WhatsApp, nos contatos indicados no preâmbulo, e valem como notificação. A parte que mudar de contato deve avisar a outra. A ciência do CONTRATANTE sobre uma atualização não significa aprovação técnica, quitação ou renúncia a direitos.$t$,
 '{todos}', 60, false, null),
('arrependimento', 'Direito de arrependimento',
 $t$Quando este contrato for celebrado fora do estabelecimento da CONTRATADA, inclusive por link, e-mail, telefone ou na residência do CONTRATANTE, o CONTRATANTE pode desistir dele em até 7 (sete) dias da assinatura, sem multa e sem justificativa, com a devolução imediata, e corrigida, dos valores pagos (CDC, art. 49). Para preservar esse direito, os serviços começam depois desse prazo, salvo pedido expresso e por escrito do CONTRATANTE para início antecipado.$t$,
 '{todos}', 61, true, 'CDC, art. 49'),
('rescisao', 'Rescisão',
 $t$Este contrato pode ser rescindido: (a) por qualquer das partes, se a outra descumprir obrigação e não corrigir a falha em 15 (quinze) dias depois de notificada por escrito; (b) por qualquer das partes, se caso fortuito ou força maior impedir a continuidade por mais de 60 (sessenta) dias; (c) pelo CONTRATANTE, a qualquer tempo, com aviso por escrito de 15 (quinze) dias. Em qualquer caso, o CONTRATANTE pagará os serviços executados até a rescisão, medidos proporcionalmente ao escopo, e os materiais comprados para a obra e já entregues, que passam a ser seus; a CONTRATADA devolverá em até 15 (quinze) dias o que tiver recebido além disso. Nas hipóteses (c) e (a) por culpa do CONTRATANTE, será devida à CONTRATADA multa compensatória de 10% (dez por cento) do valor dos serviços ainda não executados; na hipótese (a) por culpa da CONTRATADA, a mesma multa será devida ao CONTRATANTE. Em ambos os casos, a parte prejudicada pode cobrar a indenização dos danos comprovados que excederem a multa (Código Civil, art. 416, parágrafo único). Encerrado o contrato, a CONTRATADA entregará os documentos e arquivos produzidos até então e fará a baixa da ART, quando for o caso.$t$,
 '{todos}', 62, true, 'Código Civil, arts. 393, 408 a 416, 473 e 475; CDC, art. 51'),
('lgpd', 'Proteção de dados pessoais',
 $t$A CONTRATADA trata os dados pessoais do CONTRATANTE somente para executar este contrato, cumprir obrigações legais (como a emissão de nota fiscal, o registro da ART e a guarda dos documentos técnicos) e exercer seus direitos, nos termos da Lei 13.709/2018 (LGPD). Os dados não serão vendidos nem compartilhados além do necessário para esses fins, e o CONTRATANTE pode pedir a qualquer tempo acesso, correção ou informação sobre seu uso. Fotos do imóvel servem ao acompanhamento do serviço; o uso em divulgação depende de autorização específica do CONTRATANTE.$t$,
 '{todos}', 63, false, 'Lei 13.709/2018'),
('assinatura_eletronica', 'Assinatura eletrônica',
 $t$As partes reconhecem a validade da assinatura deste contrato por meio eletrônico, inclusive pelo link de assinatura da CONTRATADA, que registra nome, documento, data, hora e o código de verificação do documento (Lei 14.063/2020 e Medida Provisória 2.200-2/2001, art. 10, § 2º). O CONTRATANTE recebe cópia integral do contrato assinado.$t$,
 '{todos}', 64, false, 'Lei 14.063/2020; MP 2.200-2/2001, art. 10, § 2º; CPC, art. 784, § 4º'),
('legislacao', 'Legislação aplicável e interpretação',
 $t$Aplicam-se a este contrato o Código Civil (Lei 10.406/2002) e, quando a relação for de consumo, o Código de Defesa do Consumidor (Lei 8.078/1990), cujas regras prevalecem sobre este instrumento. As cláusulas serão interpretadas da maneira mais favorável ao consumidor (CDC, art. 47), e a eventual nulidade de uma delas não invalida as demais (CDC, art. 51, § 2º). Os serviços observarão a legislação profissional (Leis 5.194/1966 e 6.496/1977) e as normas aplicáveis, em especial: {normas}. As cláusulas que limitam direitos estão destacadas (CDC, art. 54, § 4º). A tolerância de uma parte com o descumprimento da outra não altera este contrato.$t$,
 '{todos}', 65, false, 'CDC, arts. 47, 51 e 54; Código Civil'),
('foro', 'Foro',
 $t$Fica eleito o foro da comarca do domicílio do CONTRATANTE para resolver as questões deste contrato (CDC, art. 101, I). Antes de recorrer ao Judiciário, as partes buscarão resolver divergências por conversa direta e, se preciso, por mediação.$t$,
 '{todos}', 70, false, 'CDC, art. 101, I');

-- Atualiza as iniciais que você nunca editou (versão 1 ou texto ainda "[Minuta …]").
update public.clausula c
   set titulo = n.titulo, texto = n.texto, aplicavel = n.aplicavel, ordem = n.ordem, destaque = n.destaque,
       referencias = coalesce(n.referencias, c.referencias), revisao_juridica = 'fundamentada'
  from _cl n
 where c.codigo = n.codigo
   and c.revisao_juridica <> 'revisada'
   and (c.versao = 1 or c.texto like '[Minuta%');

-- Insere as novas.
insert into public.clausula (codigo, titulo, texto, aplicavel, ordem, destaque, referencias, revisao_juridica)
select n.codigo, n.titulo, n.texto, n.aplicavel, n.ordem, n.destaque, n.referencias, 'fundamentada'
  from _cl n
 where not exists (select 1 from public.clausula c where c.codigo = n.codigo);

drop table _cl;
