// Carrega variáveis do .env sem dependência de dotenv
const fs   = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '..', '.env');
if (!fs.existsSync(envFile)) return;

fs.readFileSync(envFile, 'utf8')
  .split('\n')
  .forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = val;
  });
