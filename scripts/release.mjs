// npm run release: релиз на GitHub для автообновлений (src/updater.js).
// Сначала сами создаём релиз vX.Y.Z (gh), потом electron-builder только загружает в него файлы:
// если релиза нет, electron-builder создаёт его двумя запросами наперегонки, второй падает
// («Published releases must have a valid tag») и обрывает загрузку установщика и latest.yml.
// Токен — из gh (gh auth login), GH_TOKEN задавать не нужно.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tag = `v${version}`;
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const env = { ...process.env };
if (!env.GH_TOKEN) env.GH_TOKEN = gh('auth', 'token');

let exists = true;
try { gh('release', 'view', tag); } catch { exists = false; }
if (!exists) {
  console.log(`• создаю релиз ${tag}`);
  gh('release', 'create', tag, '--title', version, '--notes', `Авеон ${version}. Что нового — в самом плеере: профиль → «Что нового».`, '--target', execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
}

const r = spawnSync('npx', ['electron-builder', '--win', 'nsis', '--publish', 'always'], { stdio: 'inherit', env, shell: true });
process.exit(r.status ?? 1);
