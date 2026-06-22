const router = require('express').Router();
const crypto = require('crypto');

// Tentativas de login por IP (anti-brute-force em memória)
const tentativas = new Map(); // ip → { count, bloqueadoAte }
const MAX_TENTATIVAS  = 5;
const LOCKOUT_MS      = 5 * 60 * 1000; // 5 minutos

function checarRateLimit(ip) {
  const t = tentativas.get(ip);
  if (!t) return null;
  if (Date.now() < t.bloqueadoAte) {
    const restante = Math.ceil((t.bloqueadoAte - Date.now()) / 1000);
    return restante;
  }
  return null;
}

function registrarFalha(ip) {
  const t = tentativas.get(ip) || { count: 0, bloqueadoAte: 0 };
  t.count++;
  if (t.count >= MAX_TENTATIVAS) {
    t.bloqueadoAte = Date.now() + LOCKOUT_MS;
    t.count = 0;
    console.warn(`[Auth] IP ${ip} bloqueado por ${LOCKOUT_MS / 60_000} min (muitas tentativas).`);
  }
  tentativas.set(ip, t);
}

function registrarSucesso(ip) {
  tentativas.delete(ip);
}

// Comparação em tempo constante — previne timing attacks
function senhaOk(entrada, esperado) {
  try {
    const a = Buffer.from(String(entrada  ?? ''));
    const b = Buffer.from(String(esperado ?? ''));
    // Pads para comparar buffers de mesmo tamanho sem vazar comprimento
    const [pa, pb] = a.length < b.length
      ? [Buffer.concat([a, Buffer.alloc(b.length - a.length)]), b]
      : [a, Buffer.concat([b, Buffer.alloc(a.length - b.length)])];
    const igual = crypto.timingSafeEqual(pa, pb);
    return igual && a.length === b.length;
  } catch {
    return false;
  }
}

// ── Middleware ────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session?.autenticado) return next();
  if (req.path.startsWith('/api/') || req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }
  return res.redirect('/login');
}

// ── Rotas ─────────────────────────────────────────────────────────────────────

// POST /auth/login
router.post('/login', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress;

  const bloqueadoPor = checarRateLimit(ip);
  if (bloqueadoPor !== null) {
    return res.status(429).json({
      error: `Muitas tentativas. Aguarde ${bloqueadoPor}s.`,
    });
  }

  const senhaCorreta = process.env.PANEL_PASSWORD;
  if (!senhaCorreta) {
    return res.status(500).json({ error: 'PANEL_PASSWORD não está definido no servidor.' });
  }

  if (senhaOk(req.body?.senha, senhaCorreta)) {
    registrarSucesso(ip);
    req.session.autenticado = true;
    return res.json({ ok: true });
  }

  registrarFalha(ip);
  const t = tentativas.get(ip);
  const restantes = t ? MAX_TENTATIVAS - t.count : MAX_TENTATIVAS - 1;
  return res.status(401).json({
    error: `Senha incorreta. ${restantes > 0 ? `${restantes} tentativa(s) restante(s).` : 'Conta bloqueada.'}`,
  });
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

module.exports = { router, requireAuth };
