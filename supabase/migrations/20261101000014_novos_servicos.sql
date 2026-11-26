-- Novos serviços (2026-11-01): projeto arquitetônico e regularização de imóveis.
-- 1. A tabela de preços do orçamento automático aceita os dois tipos novos.
-- 2. Os dois entram na biblioteca de serviços (montagem pelo texto e escopo manual).
-- Propostas com vários serviços não mudam o banco: tudo fica no conteúdo da versão.

alter table public.orcamento_parametro drop constraint if exists orcamento_parametro_tipo_check;
alter table public.orcamento_parametro add constraint orcamento_parametro_tipo_check
  check (tipo in ('projeto_estrutural', 'projeto_arquitetonico', 'reforco', 'reforma', 'construcao', 'regularizacao', 'laudo', 'pericia'));
insert into public.orcamento_parametro (tipo) values ('projeto_arquitetonico'), ('regularizacao') on conflict (tipo) do nothing;

insert into public.modelo_servico (ordem, nome, grupo, unidade, modelo_preco, palavras_chave, descricao_cliente, inclusoes, exclusoes, responsabilidades, etapas, perguntas, premissas, pontos_conferir) values
(15, 'Projeto arquitetônico', 'Projetos', 'm2', 'area_complexidade',
 array['arquitetura','arquitetônico','arquitetonico','planta da casa','projeto da casa','layout','fachada','interiores','projeto legal','aprovação na prefeitura','aprovacao na prefeitura'],
 'Projeto de arquitetura do estudo preliminar ao executivo: opções de layout, volumetria em 3D, plantas, cortes, fachadas e detalhes para a obra, com projeto legal para a prefeitura quando necessário.',
 array['Briefing e programa de necessidades','Estudo preliminar com opções de layout','Anteprojeto com volumetria em 3D','Projeto executivo: plantas, cortes, fachadas, cobertura e esquadrias','Quadro de áreas e memorial','ART do projeto'],
 array['Projetos estrutural e de instalações (salvo se incluídos)','Levantamento topográfico e sondagem','Taxas e emolumentos da prefeitura','Mudanças de programa após o anteprojeto aprovado'],
 '[{"parte":"ROSAE","itens":["Desenvolver o projeto conforme normas e legislação do município","Apresentar cada etapa para aprovação","Emitir a ART"]},{"parte":"Cliente","itens":["Informar o programa de necessidades","Fornecer documentos do terreno","Aprovar cada etapa"]}]',
 '[{"nome":"Estudo preliminar","descricao":"Programa e opções de layout","percentual":20},{"nome":"Anteprojeto","descricao":"Solução em 3D e materiais","percentual":25},{"nome":"Projeto legal","descricao":"Aprovação na prefeitura","percentual":15},{"nome":"Projeto executivo","descricao":"Pranchas e detalhes para a obra","percentual":40}]',
 '[{"texto":"Qual a área e quantos pavimentos?"},{"texto":"Precisa aprovar na prefeitura?"},{"texto":"Inclui interiores (marcenaria, iluminação)?"}]',
 array['Documentos do terreno fornecidos pelo cliente','Prazo da prefeitura fora do cronograma'],
 array['Conferir atribuições do CREA para projeto arquitetônico deste porte (ou parceria com arquiteto)']),
(65, 'Regularização de imóvel', 'Regularização', 'vb', 'fixo',
 array['regularização','regularizacao','regularizar','habite-se','habite se','averbação','averbacao','legalização','legalizacao','usucapião','usucapiao','desmembramento','remembramento','retificação de área','retificacao de area','imóvel irregular','imovel irregular'],
 'Regularização do imóvel na prefeitura e no cartório: medição, plantas, memorial, ART, protocolo e acompanhamento para habite-se, averbação, legalização de obra, usucapião, desmembramento ou retificação de área.',
 array['Análise da documentação do imóvel','Medição e desenho do imóvel','Plantas e memorial no padrão exigido','Quadro de áreas','ART','Protocolo do processo'],
 array['Taxas, emolumentos, impostos e multas','Obras de adequação exigidas pelo órgão','Honorários de advogado (usucapião)','Certidões pessoais e do imóvel'],
 '[{"parte":"ROSAE","itens":["Levantar e desenhar o imóvel","Preparar a documentação técnica com ART","Protocolar e orientar sobre as exigências"]},{"parte":"Cliente","itens":["Fornecer escritura, matrícula e IPTU","Garantir acesso ao imóvel","Pagar taxas e emolumentos"]}]',
 '[{"nome":"Levantamento e análise","descricao":"Medições e documentação","percentual":30},{"nome":"Plantas e memoriais","descricao":"Documentação técnica com ART","percentual":40},{"nome":"Protocolo e exigências","descricao":"Entrada e acompanhamento","percentual":30}]',
 '[{"texto":"O que precisa regularizar (habite-se, averbação, usucapião...)?"},{"texto":"Existe planta ou projeto do imóvel?"},{"texto":"Há notificação ou multa da prefeitura?"}]',
 array['Documentação do imóvel fornecida pelo cliente','Prazo dos órgãos fora do cronograma'],
 array['Conferir exigências específicas do município e do cartório'])
on conflict (nome) do nothing;
