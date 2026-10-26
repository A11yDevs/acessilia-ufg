import fs from 'node:fs';
import path from 'node:path';
import { botAcessClient } from '../integrations/bot-acess/client.js';

/**
 * Localização do documento processado pelo Acessilia Core.
 *
 * storage_path pode ser:
 *  - o download_url do Core (https://.../download/<token>): o arquivo é buscado no Core;
 *  - um caminho '/uploads/<arquivo>' gravado pelo próprio Gestor. Ele é relativo à raiz
 *    do projeto (ver material.service.js); path.isAbsolute() o trataria como raiz do
 *    sistema de arquivos e nunca encontraria o arquivo.
 */
export function resolveStoragePath(storagePath) {
  if (!storagePath || /^https?:\/\//i.test(storagePath)) return null;
  const inProject = path.resolve(process.cwd(), storagePath.replace(/^\/+/, ''));
  if (isFile(inProject)) return inProject;
  if (path.isAbsolute(storagePath) && isFile(storagePath)) return storagePath;
  return null;
}

/** Caminhos locais onde a cópia do HTML processado pode estar, na ordem de preferência. */
export function processedHtmlCandidates(version) {
  if (!version) return [];
  const candidates = [resolveStoragePath(version.storage_path)];
  // handleJobCompleted grava a cópia como accessible_<external_job_id>.html; storage_key = proc_<external_job_id>
  const jobKey = String(version.storage_key || '').replace(/^proc_/, '');
  if (jobKey) candidates.push(path.resolve(process.cwd(), 'uploads', `accessible_${jobKey}.html`));
  candidates.push(
    path.resolve(process.cwd(), 'uploads', `accessible_${version.id}.html`),
    path.resolve(process.cwd(), 'public/uploads', `accessible_${version.id}.html`)
  );
  return candidates.filter(Boolean);
}

/**
 * HTML do documento processado: cópia local se existir; senão busca no Core pelo token
 * do download_url e guarda a cópia em uploads/accessible_<versão>.html. Null se não houver.
 */
export async function loadProcessedHtml(version) {
  for (const candidate of processedHtmlCandidates(version)) {
    if (!isFile(candidate)) continue;
    const html = fs.readFileSync(candidate, 'utf8');
    if (html) return html;
  }

  const token = version ? botAcessClient.extractDownloadToken(version.storage_path) : null;
  if (!token) return null;
  const file = await botAcessClient.fetchProcessedFile(token, 'html');
  if (!file.ok || !file.buffer) return null;

  try {
    const dir = path.resolve(process.cwd(), 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `accessible_${version.id}.html`), file.buffer);
  } catch (_) {}
  return file.buffer.toString('utf8');
}

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch (_) {
    return false;
  }
}
