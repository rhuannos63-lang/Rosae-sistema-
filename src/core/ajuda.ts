// Central de ajuda por tarefa: para que serve, como usar, exemplo e erros frequentes.
export type TopicoAjuda = { id: string; titulo: string; onde: string; link: string; serve: string; passos: string[]; exemplo: string; erros?: string[] };

export const AJUDA: TopicoAjuda[] = [
  {
    id: 'cliente', titulo: 'Cadastrar cliente', onde: 'Cadastros', link: '/pessoas',
    serve: 'Um cadastro só para cada pessoa ou empresa. Ela pode ser cliente, fornecedor e parceiro ao mesmo tempo, sem duplicar.',
    passos: ['Abra Cadastros e toque em Nova pessoa.', 'Preencha nome, telefone e e-mail; CPF/CNPJ e endereço quando for gerar contrato.', 'Marque “Cliente”. O sistema avisa se já existe alguém com o mesmo telefone, e-mail ou documento.'],
    exemplo: 'Maria Souza, (21) 99999-0000, marcada como cliente. Depois o marido, João, também como cliente, para ter o próprio acesso ao portal.',
    erros: ['Criar a mesma pessoa duas vezes: use o aviso de semelhantes e abra o cadastro existente.'],
  },
  {
    id: 'proposta', titulo: 'Gerar proposta', onde: 'Comercial', link: '/comercial',
    serve: 'Montar uma proposta profissional por ambiente e serviço, com inclusões, exclusões, responsabilidades, prazo e pagamento.',
    passos: ['Abra o contato no Comercial e toque em Nova proposta.', 'Descreva o pedido em texto livre e toque em Sugerir escopo: o sistema busca serviços na biblioteca e lista o que falta confirmar com o cliente.', 'Revise itens, quantidades e preços. Custos internos ficam numa aba separada e nunca aparecem no documento.', 'Toque em Emitir versão: ela fica congelada com um código de verificação.'],
    exemplo: '“Troca de piso da cozinha e pintura do banheiro” vira dois serviços, em dois ambientes, com etapas e exclusões sugeridas.',
    erros: ['Editar uma versão emitida: não é possível. Crie uma nova versão; a anterior fica preservada.'],
  },
  {
    id: 'envio', titulo: 'Enviar proposta ao cliente', onde: 'Proposta emitida', link: '/propostas',
    serve: 'Mandar o link seguro da versão emitida para o cliente ler, aceitar ou pedir ajuste.',
    passos: ['Na versão emitida, toque em “Enviar por e-mail”.', 'Confira destinatário, assunto e mensagem na prévia e toque em Enviar. O link seguro entra sozinho no e-mail.', 'Acompanhe no histórico da versão: enviado ao provedor, entregue, voltou ou falhou. O aceite do cliente fica registrado com nome, data e a versão exata.'],
    exemplo: 'Você envia por e-mail; o histórico mostra “Entregue”; o cliente abre o link no celular e toca em Aceitar. A proposta passa para Aprovada.',
    erros: ['Achar que “Entregue” ou abrir o e-mail é aceite: só o botão Aceitar no link conta como aprovação.', 'Clicar em Enviar de novo achando que não foi: cada envio tem identificação própria e não duplica; use “Tentar de novo” só quando aparecer “Falhou”.', 'Sem o envio automático ligado, o sistema avisa e abre a mensagem no seu aplicativo de e-mail; nada aparece como enviado.'],
  },
  {
    id: 'obra', titulo: 'Criar obra', onde: 'Proposta aprovada ou Obras', link: '/obras',
    serve: 'Transformar a proposta aprovada em obra sem redigitar: ambientes, serviços, valores vendidos, etapas, materiais e previsão de recebimentos.',
    passos: ['Na proposta aprovada, toque em Converter em obra (repetir não duplica nada).', 'Gere o contrato na aba Contrato, confira os dados que faltam e emita.', 'Registre a assinatura e toque em Liberar obra para iniciar.'],
    exemplo: 'Proposta de R$ 6.000 em 2 parcelas vira obra com 2 serviços, 6 etapas e uma conta a receber em 2 parcelas.',
    erros: ['Confundir proposta aprovada, contrato assinado e obra liberada: são três passos diferentes, cada um com seu registro.'],
  },
  {
    id: 'cronograma', titulo: 'Montar cronograma', onde: 'Obra → Cronograma', link: '/obras',
    serve: 'Planejar etapas com datas, peso técnico e dependências, e comparar o plano original com a previsão atual.',
    passos: ['Na aba Cronograma, ajuste etapas, pesos e durações.', 'Use Programar datas para sequenciar a partir de um início.', 'Quando estiver combinado com o cliente, toque em Guardar linha de base. Depois disso, toda mudança de data pede um motivo.'],
    exemplo: 'Retirada do piso (peso 1), regularização (peso 2), assentamento (peso 3). O percentual da obra é a média ponderada pelo peso.',
    erros: ['Esperar que compra ou pagamento aumente o percentual: só a execução conta.', 'Marcar “conferido” sem “executado”: a conferência técnica vem depois da execução.'],
  },
  {
    id: 'execucao', titulo: 'Registrar execução', onde: 'Obra → Diário e fotos', link: '/obras',
    serve: 'Guardar o andamento, fotos datadas, impedimentos, inspeções e a condição existente antes de intervir.',
    passos: ['No Diário, toque em Registrar e escolha o tipo.', 'Anexe fotos (o sistema reduz o tamanho no aparelho) e marque se é antes, durante ou depois.', 'Para condição existente, preencha riscos, proteção, recomposições incluídas e não incluídas, e se precisa de aprovação antes de seguir.'],
    exemplo: 'Registro de impedimento “piso solto na região da pia” cria uma pendência com responsável e prazo.',
    erros: ['Usar nota interna para algo que o cliente deve ver: nota interna nunca vai ao portal.'],
  },
  {
    id: 'nota', titulo: 'Distribuir uma nota', onde: 'Financeiro → Notas fiscais', link: '/notas',
    serve: 'Ler o XML da NF-e, distribuir itens por obra e serviço, e lançar a conta a pagar uma única vez.',
    passos: ['Em Notas fiscais, toque em Importar XML e escolha o arquivo (ou “Foto ou PDF” para a IA ler a nota).', 'Confira emitente, total e os pontos marcados como incertos. O sistema avisa se a nota já foi importada.', 'Classifique os itens (um a um ou “Aplicar a todos”), ligue a um material se for o caso e toque em Confirmar e lançar.'],
    exemplo: 'Nota de R$ 910 com frete de R$ 20: cimento para a obra A e areia para a obra B. O frete é distribuído pelo valor de cada item e a conta a pagar sai rateada entre as duas obras.',
    erros: ['Lançar a conta à mão e depois importar a nota: na confirmação, escolha “Esta nota é de uma conta já lançada” para não duplicar.', 'Confirmar nota lida por foto sem conferir: a IA pode errar um número; os pontos incertos vêm marcados.'],
  },
  {
    id: 'pagamento', titulo: 'Registrar pagamento', onde: 'Financeiro → lançamento', link: '/financeiro',
    serve: 'Dar baixa numa parcela (total ou parcial) e guardar o comprovante, mantendo o histórico.',
    passos: ['Abra o lançamento e toque em Pagar (ou Receber) na parcela.', 'Informe data, valor, conta e anexe o comprovante.', 'Errou? Use Estornar: o movimento original fica guardado e o estorno aparece ao lado.'],
    exemplo: 'Parcela de R$ 455 paga em duas vezes: R$ 200 hoje e R$ 255 na semana que vem.',
    erros: ['Apagar um pagamento: não existe; o caminho é o estorno, que mantém a rastreabilidade.'],
  },
  {
    id: 'publicar', titulo: 'Publicar atualização ao cliente', onde: 'Obra → Portal do cliente', link: '/obras',
    serve: 'Escolher o que o cliente vê no portal: registros do diário, fotos, decisões, etapas e materiais (sem valores).',
    passos: ['Na aba Portal do cliente, gere um link para cada pessoa (marido e esposa têm links próprios).', 'Em Publicar no portal, toque em Publicar nos itens que o cliente deve ver.', 'Use Ver como cliente para conferir antes de avisar.', 'Responda mensagens e acompanhe quem deu ciência de cada atualização.'],
    exemplo: 'Você publica a foto do assentamento e o registro do dia; a cliente comenta na foto e o marido dá ciência da decisão do rejunte.',
    erros: ['Achar que “ciente” é aprovação: ciência só confirma que a pessoa leu aquela versão.'],
  },
  {
    id: 'resultado', titulo: 'Consultar resultado', onde: 'Obra → Financeiro e Painel', link: '/',
    serve: 'Ver vendido, custos previsto, contratado e realizado, pago, a pagar e a diferença estimada por serviço e por obra.',
    passos: ['Na obra, abra a aba Financeiro para o resultado por serviço.', 'No Painel, compare mês, semestre e ano; cada número abre os lançamentos que o explicam.', 'O relatório da obra junta contrato, escopo, compras, mão de obra, entradas, saídas e pendências para imprimir.'],
    exemplo: 'Serviço vendido por R$ 1.500 com mão de obra contratada de R$ 750 mostra diferença inicial de R$ 750, antes dos demais custos e tributos.',
    erros: ['Ler recebimento como lucro: o sistema separa vendas, recebimentos e resultado.'],
  },
];
