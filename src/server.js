require('./env');
const express   = require('express');
const session   = require('express-session');
const crypto    = require('crypto');
const path      = require('path');

const db        = require('./db');
const whatsapp  = require('./whatsapp');
const scheduler = require('./scheduler');
const { router: authRouter, requireAuth } = require('./routes/auth');

const app    = express();
const PORT   = process.env.PORT   || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');

// ── Segurança básica ──────────────────────────────────────────────────────────
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.startsWith('troque-')) {
  console.warn('[Segurança] ⚠  SESSION_SECRET não foi alterado. Gere uma chave segura no .env!');
}

const sessionSecret = process.env.SESSION_SECRET ||
  crypto.randomBytes(32).toString('hex'); // fallback: sessões invalidam ao reiniciar

// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));  // limita payload (proteção básica contra DoS)
app.use(session({
  secret:            sessionSecret,
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,      // inacessível ao JavaScript do browser
    sameSite: 'strict',  // protege contra CSRF
    secure:   false,     // mude para true se usar HTTPS
    maxAge:   8 * 60 * 60 * 1000, // 8 horas
  },
}));

// ── Rotas públicas (sem autenticação) ─────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session?.autenticado) return res.redirect('/');
  res.sendFile(path.join(PUBLIC, 'login.html'));
});

app.use('/auth', authRouter);

// ── Rotas protegidas ──────────────────────────────────────────────────────────
// Painel principal
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC, 'index.html'));
});

// API — tudo abaixo requer sessão válida
app.use('/api', requireAuth);
app.use('/api/whatsapp',     require('./routes/whatsapp'));
app.use('/api/grupos',       require('./routes/grupos'));
app.use('/api/agendamentos', require('./routes/agendamentos'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ── Arquivos estáticos (CSS, JS — sem dados sensíveis) ────────────────────────
app.use(express.static(PUBLIC, { index: false }));

// ── Inicialização ─────────────────────────────────────────────────────────────
whatsapp.client.on('ready', () => {
  scheduler.iniciar(); // idempotente: seguro chamar em reconexões
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅  Servidor em http://0.0.0.0:${PORT}`);
  console.log(`   Painel:  http://localhost:${PORT}`);
  console.log(`   Login:   http://localhost:${PORT}/login`);
  console.log(`   Banco:   data/schedules.db\n`);
  whatsapp.initialize();
});
