const router = require('express').Router();
const { client, getStatus } = require('../whatsapp');

// GET /api/grupos
router.get('/', async (req, res) => {
  const { status } = getStatus();
  if (status === 'autenticando') {
    return res.status(503).json({
      error: 'WhatsApp está inicializando. Aguarde "Cliente pronto e conectado!" no terminal e tente de novo.',
      status,
    });
  }
  if (status !== 'conectado') {
    return res.status(503).json({
      error: 'WhatsApp não está conectado. Escaneie o QR em /api/whatsapp/qr.png primeiro.',
      status,
    });
  }

  try {
    const chats = await client.getChats();
    const groups = chats
      .filter((c) => c.isGroup)
      .map((c) => ({ id: c.id._serialized, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar grupos: ' + err.message });
  }
});

module.exports = router;
