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

`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` e, opcional, `BACKUP_SENHA` (senha da criptografia do backup; sem ela, usa a senha do banco).

Assistente de IA (opcional): `ANTHROPIC_API_KEY` (Claude), `GEMINI_API_KEY` (Gemini; também transcreve áudio do WhatsApp) e, para o WhatsApp oficial da Meta, `WHATSAPP_TOKEN`, `WHATSAPP_NUMERO_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` e `WHATSAPP_NUMERO_EXIBICAO`. Depois de cadastrar, rode o workflow **Publicar assistente**: ele copia as chaves para o Supabase e publica as funções `assistente` e `whatsapp` (`supabase/functions`). O passo a passo completo está no sistema, em Empresa e Sistema › Assistente IA › Ligar.

E-mail das propostas (opcional): `RESEND_API_KEY` (conta em resend.com, com o domínio rosaeengenharia.com verificado) e `EMAIL_REMETENTE` (por exemplo `ROSAE Engenharia <propostas@rosaeengenharia.com>`). Depois de cadastrar, rode **Publicar assistente**: ele publica também a função `email`. Sem essas chaves o sistema avisa e abre a mensagem no aplicativo de e-mail; nada aparece como enviado. A mesma chave da IA (`ANTHROPIC_API_KEY`) liga a leitura de notas por foto ou PDF.

## Privacidade e guarda dos dados

- Permissões são conferidas no banco (RLS e funções), não só na tela. O cliente acessa só a própria obra por link pessoal com prazo e revogação.
- Não são apagados: propostas emitidas, contratos, aceites, medições, lançamentos, pagamentos, notas e a auditoria. O prazo de guarda de documentos fiscais e financeiros deve ser definido com o contador.
- Pedido de exclusão de dados pessoais (LGPD): Cadastros › Privacidade › Anonimizar (só administrador). Tira nome, documento, contatos, endereço e Pix do cadastro e da auditoria, desativa os acessos ao portal e mantém os registros financeiros e contratuais.
- Backup diário criptografado, guardado 30 dias (workflow `backup.yml`).
- Logs das funções não gravam chaves nem o conteúdo de documentos.

## Restaurar um backup

Baixe o arquivo em Actions → Backup diário, depois:

```bash
gpg -d rosae-backup-AAAA-MM-DD.tar.gz.gpg | tar xz
psql "<conexão do banco novo>" -f backup/papeis.sql -f backup/estrutura.sql -f backup/dados.sql
```

## Publicação

- O site é publicado pela Cloudflare (Workers Builds) a cada push no `main`. O banco é atualizado antes, pelo workflow `banco.yml`.
- Cada ramo fora do `main` ganha um link de prévia (`npx wrangler preview`). Esse comando exige o bloco `"previews": {}` no `wrangler.jsonc`: sem ele, o build falha no passo de deploy.
- Para conferir se a produção publicou, veja o check "Workers Builds" do commit no `main`. O link de detalhes deve conter `/production/builds/`, e não `/previews/`.
