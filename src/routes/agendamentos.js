const router    = require('express').Router();
const db        = require('../db');
const scheduler = require('../scheduler');
const whatsapp  = require('../whatsapp');

// ── Constantes de validação ───────────────────────────────────────────────────
const MAX_TEXTO    = 65_536;                   // limite prático do WhatsApp
const RE_GROUP_ID  = /^[\d-]+@g\.us$/;        // ex: "120363000000000001@g.us" ou "553899999999-1604672737@g.us"
const RE_DATETIME  = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

function validarCorpo(body, parcial = false) {
  const { text, group_id, send_at } = body ?? {};
  const erros = [];

  if (!parcial || text !== undefined) {
    if (typeof text !== 'string' || !text.trim()) {
      erros.push('text: obrigatório e não pode ser vazio.');
    } else if (text.length > MAX_TEXTO) {
      erros.push(`text: excede ${MAX_TEXTO.toLocaleString('pt-BR')} caracteres.`);
    }
  }

  if (!parcial || group_id !== undefined) {
    if (typeof group_id !== 'string' || !RE_GROUP_ID.test(group_id.trim())) {
      erros.push('group_id: formato inválido. Esperado: "120363XXXX@g.us" ou "5538XXXX-XXXX@g.us".');
    }
  }

  if (!parcial || send_at !== undefined) {
    if (!send_at) {
      erros.push('send_at: obrigatório (formato: "2026-06-25T14:30").');
    } else if (typeof send_at !== 'string' || !RE_DATETIME.test(send_at)) {
      erros.push('send_at: formato inválido. Use "YYYY-MM-DDTHH:MM".');
    } else {
      const d = new Date(send_at);
      if (isNaN(d.getTime())) {
        erros.push('send_at: data inexistente (verifique dia e mês).');
      } else {
        const limite = new Date();
        limite.setFullYear(limite.getFullYear() + 1);
        if (d > limite) {
          erros.push('send_at: muito distante no futuro (máximo 1 ano).');
        }
      }
    }
  }

  return erros;
}

function normalizarSendAt(s) {
  // "2026-06-25T14:30" → "2026-06-25T14:30:00"
  return /T\d{2}:\d{2}$/.test(s) ? s + ':00' : s;
}

function sanitizarGroupName(v) {
  // Limita comprimento e garante string (nunca null de input malicioso)
  return typeof v === 'string' ? v.slice(0, 200) : null;
}

// ── GET /api/agendamentos ─────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { status, data } = req.query;
  let sql  = 'SELECT * FROM scheduled_messages WHERE 1=1';
  const args = [];

  if (status && typeof status === 'string') {
    sql += ' AND status = ?';
    args.push(status);
  }
  if (data && /^\d{4}-\d{2}-\d{2}$/.test(data)) {
    sql += ' AND send_at LIKE ?';
    args.push(data + '%');
  }

  sql += ' ORDER BY send_at ASC';
  res.json(db.prepare(sql).all(...args));
});

// ── GET /api/agendamentos/:id ─────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Agendamento não encontrado.' });
  res.json(row);
});

// ── POST /api/agendamentos ────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const erros = validarCorpo(req.body);
  if (erros.length) return res.status(400).json({ erros });

  const { text, group_id } = req.body;
  const group_name = sanitizarGroupName(req.body.group_name);
  const send_at    = normalizarSendAt(req.body.send_at);

  const result = db.prepare(`
    INSERT INTO scheduled_messages (text, group_id, group_name, send_at, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(text, group_id.trim(), group_name, send_at);

  const criado = db
    .prepare('SELECT * FROM scheduled_messages WHERE id = ?')
    .get(result.lastInsertRowid);

  // Dispara imediatamente se o send_at for o minuto atual
  if (send_at.startsWith(scheduler.nowSP().slice(0, 16))) {
    scheduler.dispararPendentes();
  }

  res.status(201).json(criado);
});

// ── PUT /api/agendamentos/:id ─────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const atual = db
    .prepare('SELECT * FROM scheduled_messages WHERE id = ?')
    .get(req.params.id);

  if (!atual) return res.status(404).json({ error: 'Agendamento não encontrado.' });
  if (atual.status !== 'pending') {
    return res.status(409).json({
      error: `Só é possível editar agendamentos "pending". Status atual: "${atual.status}".`,
    });
  }

  const erros = validarCorpo(req.body);
  if (erros.length) return res.status(400).json({ erros });

  const { text, group_id } = req.body;
  const group_name = sanitizarGroupName(req.body.group_name);
  const send_at    = normalizarSendAt(req.body.send_at);

  db.prepare(`
    UPDATE scheduled_messages
    SET text = ?, group_id = ?, group_name = ?, send_at = ?
    WHERE id = ?
  `).run(text, group_id.trim(), group_name, send_at, req.params.id);

  res.json(
    db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(req.params.id)
  );
});

// ── POST /api/agendamentos/:id/enviar-agora ───────────────────────────────────
router.post('/:id/enviar-agora', async (req, res) => {
  const msg = db
    .prepare('SELECT * FROM scheduled_messages WHERE id = ?')
    .get(req.params.id);

  if (!msg) return res.status(404).json({ error: 'Agendamento não encontrado.' });

  if (!['pending', 'failed'].includes(msg.status)) {
    return res.status(409).json({
      error: `Só é possível enviar mensagens com status "pending" ou "failed". Status atual: "${msg.status}".`,
    });
  }

  if (whatsapp.getStatus().status !== 'conectado') {
    return res.status(503).json({ error: 'WhatsApp não está conectado.' });
  }

  try {
    await whatsapp.client.sendMessage(msg.group_id, msg.text);

    db.prepare(
      `UPDATE scheduled_messages SET status = 'sent', sent_at = ?, error_msg = NULL WHERE id = ?`
    ).run(scheduler.nowSP(), msg.id);

    const atualizado = db
      .prepare('SELECT * FROM scheduled_messages WHERE id = ?')
      .get(msg.id);

    res.json({ ok: true, agendamento: atualizado });
  } catch (err) {
    db.prepare(
      `UPDATE scheduled_messages SET status = 'failed', error_msg = ? WHERE id = ?`
    ).run(String(err?.message ?? 'Erro desconhecido'), msg.id);

    res.status(500).json({ error: `Falha no envio: ${err?.message}` });
  }
});

// ── DELETE /api/agendamentos/:id ──────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const row = db
    .prepare('SELECT id FROM scheduled_messages WHERE id = ?')
    .get(req.params.id);

  if (!row) return res.status(404).json({ error: 'Agendamento não encontrado.' });

  db.prepare('DELETE FROM scheduled_messages WHERE id = ?').run(req.params.id);
  res.json({ deleted: true, id: Number(req.params.id) });
});

module.exports = router;
