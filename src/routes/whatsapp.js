const router = require('express').Router();
const QRCode = require('qrcode');
const { getStatus, getQrString } = require('../whatsapp');

// GET /api/whatsapp/status
router.get('/status', (req, res) => {
  res.json(getStatus());
});

// GET /api/whatsapp/qr → retorna a string bruta (para o frontend renderizar)
router.get('/qr', (req, res) => {
  const qr = getQrString();
  if (!qr) {
    return res.status(404).json({
      error: 'QR indisponível.',
      status: getStatus().status,
    });
  }
  res.json({ qr });
});

// GET /api/whatsapp/qr.png → imagem PNG direto no navegador (fácil para escanear)
router.get('/qr.png', async (req, res) => {
  const qr = getQrString();
  if (!qr) {
    return res.status(404).send('QR indisponível. Status: ' + getStatus().status);
  }
  try {
    const buffer = await QRCode.toBuffer(qr, { scale: 8 });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store'); // QR muda; nunca fazer cache
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao gerar imagem do QR.' });
  }
});

module.exports = router;
