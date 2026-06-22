const { Client, LocalAuth } = require('whatsapp-web.js');
const qrTerminal = require('qrcode-terminal');
const path       = require('path');

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
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
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

module.exports = { client, initialize, getStatus, getQrString };
