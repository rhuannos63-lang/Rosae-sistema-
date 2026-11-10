// Backup dos arquivos (fotos, comprovantes, notas) para o Cloudflare R2, e arquivo frio.
// Roda no GitHub Actions (workflow backup.yml) com a chave de serviço do Supabase.
//
//   node scripts/backup-arquivos.mjs copiar   -> copia para o R2 o que ainda não tem cópia (só o novo)
//   node scripts/backup-arquivos.mjs arquivar -> se o Supabase passou do limite, tira de lá os mais
//                                                antigos que já estão no R2 (o sistema passa a ler do R2)
//   node scripts/backup-arquivos.mjs baixar <pasta> -> baixa todos os arquivos (backup sem R2)
//
// Variáveis: SUPABASE_URL, SUPABASE_SECRET; para o R2: R2_ACCOUNT_ID, R2_BUCKET e as chaves
// AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (usadas pelo aws cli). Escreve um resumo em resumo.json.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const URL = process.env.SUPABASE_URL;
const SEC = process.env.SUPABASE_SECRET;
const BALDE = process.env.R2_BUCKET;
const ENDPOINT = process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '';
if (!URL || !SEC) { console.error('Falta SUPABASE_URL ou SUPABASE_SECRET.'); process.exit(1); }
const H = { apikey: SEC, Authorization: `Bearer ${SEC}` };
const caminhoUrl = (c) => c.split('/').map(encodeURIComponent).join('/');

async function rpc(fn, corpo = {}) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`);
  return r.json();
}
async function baixar(caminho, destino) {
  const r = await fetch(`${URL}/storage/v1/object/documentos/${caminhoUrl(caminho)}`, { headers: H });
  if (!r.ok) throw new Error(`baixar ${caminho}: ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer());
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, b);
  return b.length;
}
function aws(...args) {
  return execFileSync('aws', [...args, '--endpoint-url', ENDPOINT, '--region', 'auto', '--only-show-errors'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}
function tamanhoNoR2(caminho) {
  try {
    const out = aws('s3api', 'head-object', '--bucket', BALDE, '--key', `arquivos/${caminho}`, '--output', 'json');
    return JSON.parse(out).ContentLength ?? -1;
  } catch { return -1; }
}

const resumo = { copiados: 0, copiados_bytes: 0, arquivados: 0, arquivados_bytes: 0, falhas: [] };
const salvar = () => writeFileSync('resumo.json', JSON.stringify(resumo));

async function copiar() {
  if (!ENDPOINT || !BALDE) throw new Error('R2 não configurado.');
  const tmp = 'espelho';
  // Até 10 voltas de 300 arquivos por execução (o resto vai no dia seguinte).
  for (let volta = 0; volta < 10; volta++) {
    const lista = await rpc('arquivos_sem_copia', { p_limite: 300 });
    if (!lista.length) break;
    rmSync(tmp, { recursive: true, force: true });
    const ok = [];
    for (const { caminho } of lista) {
      try { ok.push({ caminho, bytes: await baixar(caminho, join(tmp, caminho)) }); }
      catch (e) { resumo.falhas.push(String(e.message ?? e)); }
    }
    if (!ok.length) break;
    aws('s3', 'cp', tmp, `s3://${BALDE}/arquivos/`, '--recursive');
    await rpc('marcar_copiados', { p_itens: ok });
    resumo.copiados += ok.length;
    resumo.copiados_bytes += ok.reduce((s, i) => s + i.bytes, 0);
    if (ok.length < lista.length) break; // houve falha: não insiste hoje
  }
  rmSync(tmp, { recursive: true, force: true });
}

async function arquivar() {
  if (!ENDPOINT || !BALDE) throw new Error('R2 não configurado.');
  const lista = await rpc('arquivos_para_arquivar');
  const conferidos = [];
  for (const { caminho, bytes } of lista) {
    const t = tamanhoNoR2(caminho);
    // Só tira do Supabase o que está no R2 com o mesmo tamanho.
    if (t >= 0 && (!bytes || t === Number(bytes))) conferidos.push({ caminho, bytes: Number(bytes) || t });
    else resumo.falhas.push(`sem cópia conferida no R2: ${caminho}`);
  }
  for (let i = 0; i < conferidos.length; i += 100) {
    const lote = conferidos.slice(i, i + 100);
    const r = await fetch(`${URL}/storage/v1/object/documentos`, {
      method: 'DELETE', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: lote.map((x) => x.caminho) }),
    });
    if (!r.ok) { resumo.falhas.push(`apagar do Supabase: ${r.status}`); break; }
    await rpc('marcar_arquivados', { p_caminhos: lote.map((x) => x.caminho) });
    resumo.arquivados += lote.length;
    resumo.arquivados_bytes += lote.reduce((s, x) => s + x.bytes, 0);
  }
}

async function listarTudo(prefixo = '') {
  const saida = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${URL}/storage/v1/object/list/documentos`, {
      method: 'POST', headers: { ...H, 'content-type': 'application/json' },
      body: JSON.stringify({ prefix: prefixo, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!r.ok) throw new Error(`listar ${prefixo}: ${r.status}`);
    const itens = await r.json();
    for (const it of itens) {
      const nome = prefixo ? `${prefixo}/${it.name}` : it.name;
      if (it.id === null) saida.push(...(await listarTudo(nome)));
      else saida.push(nome);
    }
    if (itens.length < 1000) break;
  }
  return saida;
}

async function baixarTudo(pasta) {
  for (const c of await listarTudo()) {
    const destino = join(pasta, c);
    if (existsSync(destino)) continue;
    try { resumo.copiados_bytes += await baixar(c, destino); resumo.copiados++; }
    catch (e) { resumo.falhas.push(String(e.message ?? e)); }
  }
}

const modo = process.argv[2];
try {
  if (modo === 'copiar') await copiar();
  else if (modo === 'arquivar') await arquivar();
  else if (modo === 'baixar') await baixarTudo(process.argv[3] ?? 'arquivos');
  else throw new Error('Use: copiar | arquivar | baixar <pasta>');
} catch (e) {
  resumo.falhas.push(String(e.message ?? e));
  salvar();
  console.error(e.message ?? e);
  process.exit(1);
}
salvar();
console.log(JSON.stringify({ ...resumo, falhas: resumo.falhas.length }));
if (resumo.falhas.length) console.log('Falhas:\n' + resumo.falhas.slice(0, 20).join('\n'));
