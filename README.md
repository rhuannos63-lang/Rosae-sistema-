# ROSAE · Sistema de gestão

Sistema de uso próprio da ROSAE Engenharia & Estruturas: comercial e propostas, obras (contrato, cronograma, materiais, diário, fichas), financeiro (com importação de NF-e em XML), painel, central de pendências, relatórios, ajuda e portal do cliente.

## Como está montado

| Parte | Onde |
| --- | --- |
| Telas (React + TypeScript + Vite, instalável no celular) | `src/` |
| Regras de dinheiro, parcelas e datas (testadas, sem banco) | `src/core/` |
| Banco, permissões (RLS), auditoria e operações | `supabase/migrations/` |
| Testes do banco (perfis, estorno, parcelas, auditoria) | `supabase/tests/` |
| Automação: testes, migração do banco e backup diário | `.github/workflows/` |
| Logotipo vetorial | `public/marca/` |

Regras que o código garante:

- Dinheiro em `NUMERIC(14,2)` no banco e centavos inteiros nas telas; rateio pelo maior resto.
- Movimento financeiro nunca é alterado nem apagado: erro se corrige com estorno.
- Toda tabela crítica grava auditoria (quem, quando, antes e depois); a auditoria só aceita inclusão.
- Permissões validadas no banco para os quatro perfis; o cliente não lê nenhuma tabela.
- Sem regra de reconhecimento de receita configurada, todo resultado aparece como gerencial.
- Portal do cliente: cada pessoa recebe um link pessoal (`/c/<token>`) com validade e revogação; o banco guarda só o hash.
  O cliente só chama funções `portal_*`, que devolvem o que foi publicado (nunca valores, pagamentos, notas ou notas internas).
  Fotos publicadas ganham cópia reduzida sem metadados; retirar a publicação apaga a cópia. Ciência é por pessoa e por versão do conteúdo.
- Nota fiscal (XML da NF-e): conferida antes de importar, bloqueada contra duplicidade (chave e emitente+série+número),
  e só vira conta a pagar uma vez, na confirmação (ou é ligada a uma conta já lançada). Foto, PDF e QR ainda não são lidos automaticamente.
- Central de pendências (`central_pendencias()`) junta propostas, contas, notas, materiais, etapas paradas, mensagens do portal e cadastros incompletos; cada aviso pode ser adiado ou dispensado por usuário.

## Rodar no computador

```bash
npm install
cp .env.example .env.local   # preencha com o Project URL e a chave Publishable
npm run dev
```

Testes: `npm test` (regras) e `npm run test:db` (banco, precisa do PostgreSQL instalado).

## Segredos do GitHub (Settings → Secrets → Actions)

`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` e, opcional, `BACKUP_SENHA` (senha da criptografia do backup; sem ela, usa a senha do banco). Para guardar 10 anos: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` e `R2_BUCKET` (veja abaixo).

Assistente de IA (opcional): `ANTHROPIC_API_KEY` (Claude), `GEMINI_API_KEY` (Gemini; também transcreve áudio do WhatsApp) e, para o WhatsApp oficial da Meta, `WHATSAPP_TOKEN`, `WHATSAPP_NUMERO_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` e `WHATSAPP_NUMERO_EXIBICAO`. Depois de cadastrar, rode o workflow **Publicar assistente**: ele copia as chaves para o Supabase e publica as funções `assistente` e `whatsapp` (`supabase/functions`). O passo a passo completo está no sistema, em Empresa e Sistema › Assistente IA › Ligar.

E-mail das propostas (opcional): `RESEND_API_KEY` (conta em resend.com, com o domínio rosaeengenharia.com verificado) e `EMAIL_REMETENTE` (por exemplo `ROSAE Engenharia <propostas@rosaeengenharia.com>`). Depois de cadastrar, rode **Publicar assistente**: ele publica também a função `email`. Sem essas chaves o sistema avisa e abre a mensagem no aplicativo de e-mail; nada aparece como enviado. A mesma chave da IA (`ANTHROPIC_API_KEY`) liga a leitura de notas por foto ou PDF.

## Privacidade e guarda dos dados

- Permissões são conferidas no banco (RLS e funções), não só na tela. O cliente acessa só a própria obra por link pessoal com prazo e revogação.
- Não são apagados: propostas emitidas, contratos, aceites, medições, lançamentos, pagamentos, notas e a auditoria. O prazo de guarda de documentos fiscais e financeiros deve ser definido com o contador.
- Pedido de exclusão de dados pessoais (LGPD): Cadastros › Privacidade › Anonimizar (só administrador). Tira nome, documento, contatos, endereço e Pix do cadastro e da auditoria, desativa os acessos ao portal e mantém os registros financeiros e contratuais.
- Verificação em 2 etapas (código do aplicativo autenticador), ligada em Configurações › Dados e segurança. Vale no banco: com o código ativado, uma sessão só com a senha não lê nem grava nada (`sessao_segura()` dentro de `eh_admin`, `eh_equipe_adm`, `eh_equipe`, `tem_financeiro`, `meu_papel` e `membro_da_obra`). Perdeu o celular? Supabase › Authentication › Users › o usuário › remover o fator.
- Saída por inatividade em cada aparelho (padrão 8 horas).
- Cabeçalhos de proteção no site (`public/_headers`): CSP sem scripts de fora, HSTS, sem abrir dentro de outro site.
- O Storage só aceita foto, PDF e XML.
- Auditoria guarda só o que mudou em cada alteração (e nada quando nada mudou), com compressão lz4.
- Backup diário criptografado (workflow `backup.yml`). Com o Cloudflare R2: diário por 35 dias, um por mês por 10 anos e cópia de todos os arquivos. Sem o R2: 30 dias no GitHub, com os arquivos no dia 1 de cada mês.
- Arquivo frio: quando os arquivos passam de 70% do limite do Supabase, os mais antigos (já copiados e com mais de 6 meses) saem de lá e são lidos do R2 pela função `arquivos`, que confere a permissão no banco (`arquivos_frios_permitidos`). Uso e projeção de 10 anos em Configurações › Dados e segurança (`uso_armazenamento()`).
- Logs das funções não gravam chaves nem o conteúdo de documentos.

## Guardar 10 anos (Cloudflare R2)

1. Cloudflare › R2 Object Storage: ative o R2 (plano grátis, 10 GB) e crie o bucket `rosae-arquivos`.
2. R2 › Manage API tokens › Create API token: permissão **Object Read & Write**, só para esse bucket. Copie o Access Key ID e o Secret Access Key. O Account ID aparece na página do R2.
3. GitHub › Settings › Secrets › Actions: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (= `rosae-arquivos`).
4. Rode **Publicar assistente** (copia as chaves para a função `arquivos`) e depois **Backup diário**.

## Restaurar um backup

Baixe o arquivo (R2: `backups/diario/` ou `backups/mensal/`; sem R2: Actions → Backup diário), depois:

```bash
gpg -d rosae-backup-AAAA-MM-DD.tar.gz.gpg | tar xz
psql "<conexão do banco novo>" -f backup/papeis.sql -f backup/estrutura.sql -f backup/dados.sql
```

Arquivos (fotos, comprovantes, notas): no R2 ficam em `arquivos/` com o mesmo caminho do Storage
(`aws s3 sync s3://rosae-arquivos/arquivos ./arquivos --endpoint-url https://<conta>.r2.cloudflarestorage.com`);
sem R2, estão dentro do backup do dia 1 em `backup/arquivos/`.

## Publicação

- O site é publicado pela Cloudflare (Workers Builds) a cada push no `main`. O banco é atualizado antes, pelo workflow `banco.yml`.
- Cada ramo fora do `main` ganha um link de prévia (`npx wrangler preview`). Esse comando exige o bloco `"previews": {}` no `wrangler.jsonc`: sem ele, o build falha no passo de deploy.
- Para conferir se a produção publicou, veja o check "Workers Builds" do commit no `main`. O link de detalhes deve conter `/production/builds/`, e não `/previews/`.
