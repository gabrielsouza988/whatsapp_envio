'use strict';

// ─── ESTADO ───────────────────────────────────────────────────────────────────
let ultimoStatus = null;   // último status do WhatsApp recebido
let gruposCache  = [];     // lista de grupos carregados da API
let cache        = {};     // id → agendamento (para edição e exclusão por id)
let idEdicao     = null;   // id do agendamento em edição
let qrTimer      = null;   // intervalo de refresh do QR
let toastTimer   = null;   // timeout para esconder o toast

// ─── UTILITÁRIOS ──────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatarDH(iso) {
  const [d, h] = iso.split('T');
  const [y, m, dd] = d.split('-');
  return `${dd}/${m}/${y} às ${h.slice(0, 5)}`;
}

// Texto resumido para preview (newlines viram ↵)
function textoPreview(txt, max = 130) {
  const s = txt.replace(/\n+/g, ' ↵ ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// ─── CAMADA DE API ────────────────────────────────────────────────────────────

async function req(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  // Sessão expirada ou não autenticado: redireciona para login
  if (r.status === 401) {
    location.href = '/login';
    return { ok: false, data: {} };
  }
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, data: json };
}

const api = {
  status:       ()        => req('GET',    '/api/whatsapp/status'),
  grupos:       ()        => req('GET',    '/api/grupos'),
  listar:       ()        => req('GET',    '/api/agendamentos'),
  criar:        (b)       => req('POST',   '/api/agendamentos', b),
  editar:       (id, b)   => req('PUT',   `/api/agendamentos/${id}`, b),
  deletar:      (id)      => req('DELETE', `/api/agendamentos/${id}`),
  enviarAgora:  (id)      => req('POST',  `/api/agendamentos/${id}/enviar-agora`),
};

// ─── TOAST ────────────────────────────────────────────────────────────────────

function toast(msg, tipo = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg.length > 90 ? msg.slice(0, 90) + '…' : msg;
  el.className   = `${tipo} visivel`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visivel'), 3600);
}

// ─── CONEXÃO WHATSAPP ─────────────────────────────────────────────────────────

const STATUS_LABEL = {
  desconectado:  'Desconectado',
  aguardando_qr: 'Aguardando QR',
  autenticando:  'Autenticando…',
  conectado:     'Conectado',
};

const STATUS_BADGE = {
  desconectado:  'badge-erro',
  aguardando_qr: 'badge-aviso',
  autenticando:  'badge-aviso',
  conectado:     'badge-ok',
};

function renderBadge(status) {
  const el  = document.getElementById('badge-status');
  const txt = document.getElementById('txt-status');
  el.className       = `badge ${STATUS_BADGE[status] ?? 'badge-neutro'}`;
  txt.textContent    = STATUS_LABEL[status] ?? status;
}

function atualizarQr() {
  document.getElementById('img-qr').src = `/api/whatsapp/qr.png?t=${Date.now()}`;
}

async function verificarStatus() {
  try {
    const { ok, data } = await api.status();
    if (!ok) return;

    const { status } = data;
    renderBadge(status);

    const secQr = document.getElementById('sec-qr');

    if (status === 'aguardando_qr') {
      secQr.hidden = false;
      atualizarQr();
      // Refresca o QR a cada 30 s (QR codes expiram em ~20 s)
      if (!qrTimer) qrTimer = setInterval(atualizarQr, 30_000);
    } else {
      secQr.hidden = true;
      clearInterval(qrTimer);
      qrTimer = null;
    }

    // Ao conectar: carrega grupos e atualiza lista
    if (status === 'conectado' && ultimoStatus !== 'conectado') {
      await carregarGrupos();
      await carregarAgendamentos();
    }

    ultimoStatus = status;
  } catch {
    renderBadge('desconectado');
  }
}

// ─── GRUPOS ───────────────────────────────────────────────────────────────────

async function carregarGrupos() {
  const { ok, data } = await api.grupos();
  if (!ok || !Array.isArray(data)) return;
  gruposCache = data;
  preencherSelect(document.getElementById('sel-grupo'));
}

/**
 * Preenche um <select> com os grupos do cache.
 * @param {HTMLSelectElement} sel
 * @param {string} selecionado  group_id a pré-selecionar (opcional)
 * @param {string} nomeExtra    nome a mostrar se o grupo não estiver no cache
 */
function preencherSelect(sel, selecionado = '', nomeExtra = '') {
  const valorAnterior = sel.value;
  const itens = [...gruposCache];

  // Adiciona o grupo salvo se não estiver no cache atual
  if (selecionado && !itens.find((g) => g.id === selecionado)) {
    itens.unshift({ id: selecionado, name: (nomeExtra || selecionado) + ' (não encontrado)' });
  }

  sel.innerHTML =
    `<option value="">Selecione um grupo…</option>` +
    itens.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');

  sel.value = selecionado || valorAnterior || '';
}

// ─── LISTA DE AGENDAMENTOS ────────────────────────────────────────────────────

const CHIP_INFO = {
  pending:   ['chip-pending',   'Pendente'],
  sent:      ['chip-sent',      'Enviado'],
  failed:    ['chip-failed',    'Falha'],
  cancelled: ['chip-cancelled', 'Cancelado'],
};

function renderLista(lista) {
  const el = document.getElementById('lista');
  cache = {};
  lista.forEach((a) => { cache[a.id] = a; });

  if (!lista.length) {
    el.innerHTML = '<p class="vazio">Nenhum agendamento cadastrado ainda.</p>';
    return;
  }

  el.innerHTML = lista.map((a) => {
    const [chipCls, chipTxt] = CHIP_INFO[a.status] ?? ['chip-cancelled', a.status];
    const editavel   = a.status === 'pending';
    const podeEnviar = a.status === 'pending' || a.status === 'failed';
    const lblEnviar  = a.status === 'failed' ? 'Reenviar' : 'Enviar agora';

    const detalhe = a.status === 'failed' && a.error_msg
      ? `<div class="item-detalhe item-detalhe-erro">⚠ ${esc(a.error_msg)}</div>`
      : a.status === 'sent' && a.sent_at
      ? `<div class="item-detalhe item-detalhe-ok">✓ Enviado em ${formatarDH(a.sent_at)}</div>`
      : '';

    return `
<div class="item item-${a.status}">
  <div class="item-topo">
    <span class="item-grupo">${esc(a.group_name || a.group_id)}</span>
    <span class="chip ${chipCls}">${chipTxt}</span>
  </div>
  <div class="item-texto">${esc(textoPreview(a.text))}</div>
  <div class="item-rodape">
    <span class="item-data">📅 ${formatarDH(a.send_at)}</span>
    <div class="item-acoes">
      ${podeEnviar
        ? `<button class="btn btn-info btn-sm" data-enviar="${a.id}" onclick="enviarAgora(${a.id})">${lblEnviar}</button>`
        : ''}
      ${editavel
        ? `<button class="btn btn-ghost btn-sm" onclick="abrirEdicao(${a.id})">Editar</button>`
        : ''}
      <button class="btn btn-perigo btn-sm" onclick="confirmarDelecao(${a.id})">Excluir</button>
    </div>
  </div>
  ${detalhe}
</div>`;
  }).join('');
}

async function carregarAgendamentos() {
  const { ok, data } = await api.listar();
  if (ok) renderLista(data);
}

async function confirmarDelecao(id) {
  const a = cache[id];
  if (!a) return;

  const confirmado = confirm(
    `Excluir este agendamento?\n\n📋 ${a.group_name || a.group_id}\n📅 ${formatarDH(a.send_at)}`
  );
  if (!confirmado) return;

  const { ok, data } = await api.deletar(id);
  if (ok) {
    toast('Agendamento excluído.');
    carregarAgendamentos();
  } else {
    toast(data.error || 'Erro ao excluir.', 'erro');
  }
}

// ─── FORMULÁRIO — NOVO AGENDAMENTO ───────────────────────────────────────────

function lerDadosNovo() {
  const sel = document.getElementById('sel-grupo');
  return {
    group_id:   sel.value.trim(),
    group_name: sel.selectedOptions[0]?.text ?? '',
    text:       document.getElementById('txt-msg').value,
    send_at:    `${document.getElementById('inp-data').value}T${document.getElementById('inp-hora').value}`,
  };
}

function validar(d) {
  const e = [];
  if (!d.group_id)                              e.push('Selecione um grupo de destino.');
  if (!d.text.trim())                           e.push('A mensagem não pode estar vazia.');
  if (!d.send_at.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)) e.push('Informe data e horário válidos.');
  return e;
}

function mostrarErro(idEl, erros) {
  const el = document.getElementById(idEl);
  if (erros.length) { el.textContent = erros.join(' '); el.hidden = false; }
  else              { el.hidden = true; }
}

document.getElementById('form-novo').addEventListener('submit', async (e) => {
  e.preventDefault();

  const dados = lerDadosNovo();
  const erros = validar(dados);
  mostrarErro('novo-erro', erros);
  if (erros.length) return;

  const btn = document.getElementById('btn-agendar');
  btn.disabled    = true;
  btn.textContent = 'Agendando…';

  const { ok, data } = await api.criar(dados);

  btn.disabled    = false;
  btn.textContent = 'Agendar mensagem';

  if (ok) {
    toast('Mensagem agendada! ✓');
    document.getElementById('txt-msg').value = '';
    mostrarErro('novo-erro', []);
    await carregarAgendamentos();
  } else {
    const msg = data.erros?.join(' ') || data.error || 'Erro ao criar agendamento.';
    mostrarErro('novo-erro', [msg]);
    toast(msg, 'erro');
  }
});

// ─── MODAL DE EDIÇÃO ──────────────────────────────────────────────────────────

const modal = document.getElementById('modal');

// Abriremos a função via atributo onclick no HTML gerado, então precisa ser global
window.abrirEdicao = function (id) {
  const a = cache[id];
  if (!a) return;
  idEdicao = id;

  preencherSelect(document.getElementById('edit-grupo'), a.group_id, a.group_name);

  const [datePart, timePart] = a.send_at.split('T');
  document.getElementById('edit-msg').value  = a.text;
  document.getElementById('edit-data').value = datePart;
  document.getElementById('edit-hora').value = timePart.slice(0, 5);
  mostrarErro('edit-erro', []);

  modal.showModal();
};

// Também precisam ser globais (inline onclick)
window.confirmarDelecao = confirmarDelecao;

window.enviarAgora = async function (id) {
  const btn = document.querySelector(`[data-enviar="${id}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }

  const { ok, data } = await api.enviarAgora(id);

  if (ok) {
    toast('Mensagem enviada com sucesso! ✓');
    await carregarAgendamentos();
  } else {
    toast(data.error || 'Falha no envio.', 'erro');
    // Recarrega a lista para refletir o status 'failed' que o backend gravou
    await carregarAgendamentos();
  }
};

document.getElementById('btn-cancelar').addEventListener('click', () => modal.close());

// Fecha ao clicar no backdrop (clique direto no <dialog>)
modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });

document.getElementById('form-editar').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!idEdicao) return;

  const sel = document.getElementById('edit-grupo');
  const dados = {
    group_id:   sel.value.trim(),
    group_name: sel.selectedOptions[0]?.text ?? '',
    text:       document.getElementById('edit-msg').value,
    send_at:    `${document.getElementById('edit-data').value}T${document.getElementById('edit-hora').value}`,
  };

  const erros = validar(dados);
  mostrarErro('edit-erro', erros);
  if (erros.length) return;

  const { ok, data } = await api.editar(idEdicao, dados);

  if (ok) {
    modal.close();
    toast('Agendamento atualizado! ✓');
    await carregarAgendamentos();
  } else {
    const msg = data.erros?.join(' ') || data.error || 'Erro ao salvar.';
    mostrarErro('edit-erro', [msg]);
    toast(msg, 'erro');
  }
});

// ─── INICIALIZAÇÃO ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Define data mínima como hoje nos dois formulários
  const hoje = new Date().toISOString().slice(0, 10);
  document.getElementById('inp-data').min  = hoje;
  document.getElementById('inp-data').value = hoje;
  document.getElementById('edit-data').min = hoje;

  // Polling de status a cada 5 s
  verificarStatus();
  setInterval(verificarStatus, 5_000);

  // Lista inicial + refresh automático a cada 20 s
  carregarAgendamentos();
  setInterval(carregarAgendamentos, 20_000);

  // Botão de logout
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' });
    location.href = '/login';
  });

  // Botão de refresh manual
  document.getElementById('btn-refresh').addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh');
    btn.textContent = '…';
    btn.disabled    = true;
    await carregarAgendamentos();
    btn.textContent = '↻ Atualizar';
    btn.disabled    = false;
  });
});
