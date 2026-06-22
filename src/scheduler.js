const cron = require('node-cron');
const db   = require('./db');
const { client, getStatus } = require('./whatsapp');

const TIMEZONE    = 'America/Sao_Paulo';
const DELAY_MIN   = Math.max(500,  parseInt(process.env.DELAY_MIN_MS || '2000', 10));
const DELAY_MAX   = Math.max(DELAY_MIN, parseInt(process.env.DELAY_MAX_MS || '5000', 10));

let executando = false; // lock: evita sobreposição de ticks
let iniciado   = false; // garante que o cron seja registrado uma única vez

// ── Utilitários ───────────────────────────────────────────────────────────────

function nowSP() {
  // "YYYY-MM-DDTHH:MM:SS" no fuso America/Sao_Paulo
  return new Date()
    .toLocaleString('sv-SE', { timeZone: TIMEZONE, hourCycle: 'h23' })
    .replace(' ', 'T');
}

function delayAleatorio() {
  const ms = DELAY_MIN + Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN + 1));
  return new Promise((r) => setTimeout(r, ms));
}

// ── Motor de disparo ──────────────────────────────────────────────────────────

async function dispararPendentes() {
  if (executando) return;
  if (getStatus().status !== 'conectado') return;

  executando = true;
  try {
    const prefixo   = nowSP().slice(0, 16); // "2026-06-25T14:30"
    const pendentes = db
      .prepare(
        `SELECT * FROM scheduled_messages
         WHERE status = 'pending' AND send_at LIKE ?
         ORDER BY id ASC`
      )
      .all(prefixo + '%');

    if (!pendentes.length) return;

    console.log(`[Scheduler] ⏰ ${prefixo} — ${pendentes.length} mensagem(ns) a enviar.`);

    for (let i = 0; i < pendentes.length; i++) {
      // Delay aleatório entre mensagens (anti-ban) — exceto antes da primeira
      if (i > 0) await delayAleatorio();

      const msg = pendentes[i];
      try {
        await client.sendMessage(msg.group_id, msg.text);

        db.prepare(
          `UPDATE scheduled_messages
           SET status = 'sent', sent_at = ?, error_msg = NULL
           WHERE id = ?`
        ).run(nowSP(), msg.id);

        console.log(`[Scheduler] ✅ #${msg.id} → "${msg.group_name}"`);
      } catch (err) {
        db.prepare(
          `UPDATE scheduled_messages
           SET status = 'failed', error_msg = ?
           WHERE id = ?`
        ).run(String(err?.message ?? 'Erro desconhecido'), msg.id);

        console.error(`[Scheduler] ❌ #${msg.id} falhou: ${err?.message}`);
        // Falha de uma mensagem não interrompe as demais
      }
    }
  } finally {
    executando = false;
  }
}

function marcarAtrasadasComoFalha() {
  const inicioMinuto = nowSP().slice(0, 16) + ':00';
  const { changes } = db
    .prepare(
      `UPDATE scheduled_messages
       SET status = 'failed',
           error_msg = 'Horário já passou — servidor estava offline quando deveria ter sido enviado.'
       WHERE status = 'pending' AND send_at < ?`
    )
    .run(inicioMinuto);

  if (changes > 0) {
    console.warn(`[Scheduler] ⚠️  ${changes} mensagem(ns) atrasada(s) marcada(s) como "failed".`);
  }
}

// ── Inicialização (idempotente) ───────────────────────────────────────────────

function iniciar() {
  if (iniciado) return; // protege contra duplo registro ao reconectar
  iniciado = true;

  marcarAtrasadasComoFalha();
  dispararPendentes(); // captura mensagens do minuto atual ao (re)iniciar

  cron.schedule('* * * * *', dispararPendentes, { timezone: TIMEZONE });

  console.log(
    `[Scheduler] Motor iniciado — varredura a cada minuto (America/Sao_Paulo).` +
    ` Delay entre mensagens: ${DELAY_MIN}–${DELAY_MAX} ms.`
  );
}

module.exports = { iniciar, dispararPendentes, nowSP };
