# WhatsApp Envio — Agendador de Mensagens

Painel web para agendar e enviar mensagens para grupos do WhatsApp, sem custo e sem API paga. Funciona na sua rede local e é acessível por qualquer dispositivo (celular, outro PC) conectado ao mesmo Wi-Fi.

---

## Pré-requisitos

| Item | Versão mínima |
|---|---|
| Node.js | v22.15 (recomendado: v24) |
| Google Chrome | Qualquer versão recente |
| Sistema operacional | Windows 10/11 |

Verificar versão do Node.js:
```
node --version
```

---

## Instalação

```bash
# 1. Entre na pasta do projeto
cd C:\Users\SEU_USUARIO\Projects\whatsapp_envio

# 2. Instale as dependências
npm install
```

---

## Configuração

Edite o arquivo `.env` na raiz do projeto:

```env
PORT=3000                         # Porta do servidor
PANEL_PASSWORD=sua-senha-aqui     # Senha para acessar o painel
SESSION_SECRET=chave-longa-aleatoria-e-unica   # Chave de sessão (troque!)
DELAY_MIN_MS=2000                 # Delay mínimo entre envios (ms)
DELAY_MAX_MS=5000                 # Delay máximo entre envios (ms)
```

> **Importante:** Troque `PANEL_PASSWORD` e `SESSION_SECRET` antes de usar na rede.
> Para gerar uma chave segura: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

## Primeira execução e conexão do WhatsApp

### 1. Inicie o servidor

```bash
node src/server.js
```

Você verá no terminal:
```
✅  Servidor em http://0.0.0.0:3000
[WhatsApp] Iniciando cliente...
[WhatsApp] QR gerado — acesse /api/whatsapp/qr.png no painel.
```

### 2. Acesse o painel

Abra no navegador: **http://localhost:3000/login**

Entre com a senha definida em `PANEL_PASSWORD`.

### 3. Escaneie o QR Code

Após o login, o painel exibe automaticamente o QR Code na tela quando o WhatsApp precisa ser conectado.

**No celular:**
1. Abra o WhatsApp
2. Toque em **⋮ (três pontos)** → **Aparelhos conectados**
3. Toque em **Conectar aparelho**
4. Escaneie o QR exibido na tela

Após o scan, o painel mostra **🟢 Conectado** no topo. A sessão fica salva em `.wwebjs_auth/` — nas próximas execuções não precisará escanear novamente.

> O QR Code expira em ~20 segundos e é renovado automaticamente na tela.

---

## Acesso de outro dispositivo na rede Wi-Fi

### Descobrir o IP da máquina

Execute no terminal (Windows):
```
ipconfig
```

Procure a seção **Wi-Fi** e anote o **Endereço IPv4** (ex: `192.168.1.42`).

### Acessar pelo celular ou outro PC

```
http://192.168.1.42:3000/login
```

> O servidor escuta em `0.0.0.0`, então aceita conexões de qualquer dispositivo na mesma rede. A autenticação por senha protege o acesso.

---

## Usando o painel

### Criar um agendamento

1. Selecione o **grupo de destino** no dropdown (populado automaticamente após conectar o WhatsApp)
2. Digite a **mensagem** (suporta emojis 🎉, quebras de linha e links)
3. Escolha a **data** e o **horário**
4. Clique em **Agendar mensagem**

### Testar um envio imediato

Na lista de agendamentos, clique em **Enviar agora** para disparar a mensagem imediatamente, sem esperar o horário agendado. Útil para validar que a conexão e o grupo estão corretos.

Para mensagens com status **Falha**, o botão aparece como **Reenviar**.

### Editar um agendamento

Clique em **Editar** (só disponível para agendamentos com status *Pendente*). Um modal abre com os campos preenchidos. Salve as alterações.

### Excluir um agendamento

Clique em **Excluir** em qualquer agendamento. Uma confirmação é solicitada antes de deletar.

### Status dos agendamentos

| Status | Significado |
|---|---|
| 🟡 Pendente | Aguardando o horário agendado |
| 🟢 Enviado | Mensagem entregue com sucesso |
| 🔴 Falha | Erro no envio (motivo exibido no card) |
| ⚫ Cancelado | Cancelado manualmente |

---

## Execução contínua (servidor sempre ativo)

O agendador só funciona enquanto o processo `node` estiver rodando. Há duas opções:

---

### Opção A — PM2 (recomendada)

PM2 é um gerenciador de processos Node.js gratuito que reinicia o servidor automaticamente em caso de crash e pode iniciar junto com o Windows.

**Instalação:**
```bash
npm install -g pm2
npm install -g pm2-windows-startup
```

**Iniciar e registrar:**
```bash
# Inicie o servidor pelo PM2
pm2 start src/server.js --name whatsapp-envio --cwd "C:\Users\SEU_USUARIO\Projects\whatsapp_envio"

# Configure para iniciar com o Windows
pm2-windows-startup install
pm2 save
```

**Comandos úteis:**
```bash
pm2 status                    # Ver estado dos processos
pm2 logs whatsapp-envio       # Ver logs em tempo real
pm2 restart whatsapp-envio    # Reiniciar
pm2 stop whatsapp-envio       # Parar
```

> PM2 cria uma tarefa no Agendador de Tarefas do Windows que inicia o servidor automaticamente no boot, mesmo sem fazer login.

---

### Opção B — Agendador de Tarefas do Windows (sem instalação extra)

1. Pressione **Win + R**, digite `taskschd.msc`, Enter
2. Clique em **Criar Tarefa Básica…**
3. Nome: `WhatsApp Envio`
4. Gatilho: **Ao iniciar o computador**
5. Ação: **Iniciar um programa**
   - Programa: `C:\Program Files\nodejs\node.exe`
   - Argumentos: `src/server.js`
   - Iniciar em: `C:\Users\SEU_USUARIO\Projects\whatsapp_envio`
6. Marque **Executar independente de o usuário estar conectado**
7. Salvar

> Esta opção não reinicia automaticamente em caso de crash. Use PM2 se quiser reinício automático.

---

## Resolução de problemas

| Problema | Solução |
|---|---|
| `Could not find Chrome` | Execute: `node -e "require('whatsapp-web.js')"` — verifique se o Chrome está em `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| QR não aparece | Acesse `http://localhost:3000/api/whatsapp/qr.png` diretamente |
| `Sessão autenticada` mas não conecta | Aguarde 10–20 s; o evento `ready` demora um pouco após `authenticated` |
| Grupos não carregam | Verifique se o status é **🟢 Conectado** (não apenas *Autenticando*) |
| Mensagem com status Falha | O motivo aparece no card; use **Reenviar** para tentar novamente |
| Sessão do WhatsApp expirou | Delete a pasta `.wwebjs_auth/` e escaneie o QR novamente |
| Servidor não inicia com PM2 | Verifique o log: `pm2 logs whatsapp-envio --lines 50` |
