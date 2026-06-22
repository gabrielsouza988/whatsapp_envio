const { Client, LocalAuth } = require('whatsapp-web.js');
const qrTerminal = require('qrcode-terminal');
const path       = require('path');
const fs         = require('fs');

// Detecta o executável do Chrome/Chromium de acordo com o SO,
// com override via variável CHROME_PATH no .env
function detectarChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  const candidatos = {
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium',
    ],
  };

  for (const caminho of candidatos[process.platform] ?? []) {
    if (fs.existsSync(caminho)) return caminho;
  }

  // Nenhum encontrado: deixa o Puppeteer tentar usar o Chromium embutido
  console.warn('[WhatsApp] Chrome não encontrado automaticamente. Defina CHROME_PATH no .env se necessário.');
  return undefined;
}

// Estado interno
let state    = 'desconectado'; // 'desconectado' | 'aguardando_qr' | 'autenticando' | 'conectado'
let qrString = null;

// Controle de reconexão com backoff exponencial
let reconectTimer  = null;
let tentativasRecn = 0;
const BACKOFF_MS   = [5_000, 10_000, 30_000, 60_000, 120_000];

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: path.join(__dirname, '..', '.wwebjs_auth'),
  }),
  puppeteer: {
    headless: true,
    executablePath: detectarChrome(),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-default-browser-check',
      '--metrics-recording-only',
    ],
  },
});

// ── Eventos ───────────────────────────────────────────────────────────────────

client.on('qr', (qr) => {
  state    = 'aguardando_qr';
  qrString = qr;
  qrTerminal.generate(qr, { small: true });
  console.log('[WhatsApp] QR gerado — acesse /api/whatsapp/qr.png no painel.');
});

client.on('authenticated', () => {
  state    = 'autenticando';
  qrString = null;
  console.log('[WhatsApp] Sessão autenticada — aguardando pronto…');
});

client.on('ready', () => {
  state          = 'conectado';
  qrString       = null;
  tentativasRecn = 0; // reseta o backoff ao conectar com sucesso
  console.log('[WhatsApp] Cliente pronto e conectado!');
});

client.on('auth_failure', (msg) => {
  state    = 'desconectado';
  qrString = null;
  console.error('[WhatsApp] Falha de autenticação:', msg);
  agendarReconexao();
});

client.on('disconnected', (reason) => {
  state    = 'desconectado';
  qrString = null;
  console.warn(`[WhatsApp] Desconectado (${reason}) — agendando reconexão…`);
  agendarReconexao();
});

// ── Reconexão automática com backoff ─────────────────────────────────────────

function agendarReconexao() {
  if (reconectTimer) return; // já há uma reconexão agendada

  const delay = BACKOFF_MS[Math.min(tentativasRecn, BACKOFF_MS.length - 1)];
  tentativasRecn++;

  console.log(`[WhatsApp] Reconexão em ${delay / 1000}s (tentativa ${tentativasRecn})…`);

  reconectTimer = setTimeout(async () => {
    reconectTimer = null;
    console.log('[WhatsApp] Tentando reconectar…');

    try {
      // Destrói o browser anterior para liberar recursos
      await client.destroy().catch(() => {});
      await client.initialize();
    } catch (err) {
      console.error('[WhatsApp] Erro ao reconectar:', err.message);
      agendarReconexao(); // tenta de novo com backoff maior
    }
  }, delay);
}

// ── API pública do módulo ─────────────────────────────────────────────────────

function initialize() {
  // Cancela qualquer reconexão pendente antes de iniciar manualmente
  if (reconectTimer) { clearTimeout(reconectTimer); reconectTimer = null; }
  tentativasRecn = 0;

  console.log('[WhatsApp] Iniciando cliente (isso pode levar alguns segundos)…');
  client.initialize().catch((err) => {
    console.error('[WhatsApp] Erro ao inicializar:', err.message);
  });
}

function getStatus()   { return { status: state, hasQr: qrString !== null }; }
function getQrString() { return qrString; }

// Chamado quando uma operação Puppeteer detecta que o contexto foi destruído
// sem que o evento 'disconnected' tenha disparado
function notificarContextoDestruido() {
  if (state === 'conectado') {
    state    = 'desconectado';
    qrString = null;
    console.warn('[WhatsApp] Contexto do browser destruído — forçando reconexão…');
    agendarReconexao();
  }
}

module.exports = { client, initialize, getStatus, getQrString, notificarContextoDestruido };
