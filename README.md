# ROSAE · Sistema de gestão

Sistema de uso próprio da ROSAE Engenharia & Estruturas: obras, cadastros, financeiro e painel. Portal do cliente, propostas e operação de obra chegam nas próximas etapas.

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

## Rodar no computador

```bash
npm install
cp .env.example .env.local   # preencha com o Project URL e a chave Publishable
npm run dev
```

Testes: `npm test` (regras) e `npm run test:db` (banco, precisa do PostgreSQL instalado).

## Segredos do GitHub (Settings → Secrets → Actions)

`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` e, opcional, `BACKUP_SENHA` (senha da criptografia do backup; sem ela, usa a senha do banco).

## Restaurar um backup

Baixe o arquivo em Actions → Backup diário, depois:

```bash
gpg -d rosae-backup-AAAA-MM-DD.tar.gz.gpg | tar xz
psql "<conexão do banco novo>" -f backup/papeis.sql -f backup/estrutura.sql -f backup/dados.sql
```
