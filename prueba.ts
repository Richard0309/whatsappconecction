import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WAMessageKey,
  type WAMessageContent,
  type CacheStore,
} from 'baileys';
import { Boom } from '@hapi/boom';
import NodeCache from '@cacheable/node-cache';
import { WebSocketServer, type WebSocket } from 'ws';
import pino from 'pino';
import { readFileSync, writeFileSync } from 'fs';
import qrcode from 'qrcode-terminal';

// ─── Logger (silencia el spam de Baileys, solo muestra warn+) ───────────────
const logger = pino({ level: 'warn' });

// ─── Caché simple de mensajes para reintentos de descifrado ──────────────────
// (reemplaza makeInMemoryStore, removido en Baileys v7)
type StoredMessage = { message?: WAMessageContent };
const messageStore = new Map<string, StoredMessage>();
const STORE_FILE = './baileys_store.json';

function loadStore() {
  try {
    const data = JSON.parse(readFileSync(STORE_FILE, 'utf8')) as Record<string, StoredMessage>;
    for (const [k, v] of Object.entries(data)) messageStore.set(k, v);
    console.log(`[Store] ${messageStore.size} mensajes cargados desde disco.`);
  } catch { /* primera ejecución, el archivo no existe aún */ }
}

function saveStore() {
  try {
    const obj = Object.fromEntries(messageStore.entries());
    writeFileSync(STORE_FILE, JSON.stringify(obj));
  } catch (e) { console.error('[Store] Error al guardar:', e); }
}

loadStore();
setInterval(saveStore, 10_000);

// ─── Caché para reintentos de mensajes cifrados ──────────────────────────────
const msgRetryCounterCache = new NodeCache({ stdTTL: 60 }) as unknown as CacheStore;

// ─── Servidor WebSocket local ─────────────────────────────────────────────────
const WS_PORT = Number(process.env.PORT ?? 8080);
const wss = new WebSocketServer({ port: WS_PORT });
const wsClients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log(`[WS] Cliente conectado. Total: ${wsClients.size}`);
  ws.send(JSON.stringify({ type: 'status', message: 'Conectado al relay de WhatsApp' }));
  ws.on('close', () => {
    wsClients.delete(ws);
    console.log(`[WS] Cliente desconectado. Total: ${wsClients.size}`);
  });
});

function broadcast(payload: object) {
  const data = JSON.stringify(payload);
  for (const client of wsClients) {
    if (client.readyState === client.OPEN) {
      client.send(data);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function getMessage(key: WAMessageKey): Promise<WAMessageContent | undefined> {
  const stored = messageStore.get(key.id!);
  return stored?.message;
}

function extractText(msg: { message?: Record<string, unknown> | null }): string | null {
  if (!msg.message) return null;
  const m = msg.message as Record<string, unknown>;
  return (
    (m.conversation as string) ??
    ((m.extendedTextMessage as Record<string, unknown>)?.text as string) ??
    (m.imageMessage ? '[Imagen]' : null) ??
    (m.videoMessage ? '[Video]' : null) ??
    (m.audioMessage ? '[Audio]' : null) ??
    (m.documentMessage ? '[Documento]' : null) ??
    (m.stickerMessage ? '[Sticker]' : null) ??
    '[Mensaje no soportado]'
  );
}

function formatJid(jid: string): string {
  // Convierte "5219991234567@s.whatsapp.net" → "+52 999 123 4567"
  const phone = jid.replace(/@.+$/, '');
  return `+${phone}`;
}

// ─── Función principal: crea el socket de WhatsApp ───────────────────────────
async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`\n📱 Baileys v${version.join('.')} ${isLatest ? '(última versión)' : '(hay versión más nueva)'}`);
  console.log(`🌐 WebSocket local escuchando en ws://localhost:${WS_PORT}\n`);

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
    msgRetryCounterCache,
    getMessage,
    logger,
  });

  // ─── Eventos ─────────────────────────────────────────────────────────────
  sock.ev.process(async (events) => {

    // 1. Cambios de conexión
    if (events['connection.update']) {
      const { connection, lastDisconnect, qr } = events['connection.update'];

      if (qr) {
        console.log('\n── QR para vincular WhatsApp ──────────────────────────────────');
        qrcode.generate(qr, { small: true });
        console.log('⚠️  WhatsApp → Dispositivos vinculados → Vincular dispositivo\n');
      }

      if (connection === 'open') {
        console.log('\n✅ WhatsApp conectado. Esperando mensajes...\n');
        broadcast({ type: 'status', message: 'WhatsApp conectado' });
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        if (loggedOut) {
          console.log('\n🔴 Sesión cerrada (logout). Borra la carpeta baileys_auth_info/ y reinicia.\n');
          broadcast({ type: 'status', message: 'Sesión cerrada (logout)' });
          process.exit(0);
        } else {
          console.log(`\n🔄 Conexión cerrada (código ${statusCode}). Reconectando...\n`);
          broadcast({ type: 'status', message: `Reconectando... (código ${statusCode})` });
          setTimeout(startSock, 3_000);
        }
      }
    }

    // 2. Guardar credenciales actualizadas
    if (events['creds.update']) {
      await saveCreds();
    }

    // 3. Mensajes nuevos entrantes
    if (events['messages.upsert']) {
      const { messages, type } = events['messages.upsert'];

      // 'notify' = mensaje nuevo en tiempo real | 'append' = historial
      if (type !== 'notify') return;

      for (const msg of messages) {
        // Guarda en store para reintentos de descifrado
        if (msg.key.id) {
          messageStore.set(msg.key.id, { message: msg.message ?? undefined });
        }

        const jid = msg.key.remoteJid ?? 'desconocido';
        const fromMe = msg.key.fromMe ?? false;
        const sender = fromMe ? '[YO]' : formatJid(jid);
        const pushName = msg.pushName ?? '';
        const text = extractText(msg as { message?: Record<string, unknown> | null });
        const timestamp = new Date((Number(msg.messageTimestamp ?? 0)) * 1000).toLocaleTimeString('es-MX');

        // Imprime en terminal
        const label = fromMe ? `[YO → ${formatJid(jid)}]` : `[${pushName || sender}${pushName ? ` (${sender})` : ''}]`;
        console.log(`\n📨 ${timestamp} ${label}`);
        console.log(`   ${text}`);

        // Retransmite por WebSocket local
        broadcast({
          type: 'message',
          timestamp,
          from: sender,
          pushName,
          fromMe,
          jid,
          text,
        });
      }
    }

    // 4. Actualizaciones de estado de mensajes (leído, entregado, etc.)
    if (events['messages.update']) {
      for (const update of events['messages.update']) {
        const status = update.update.status;
        if (status !== undefined) {
          const labels: Record<number, string> = { 0: 'ERROR', 1: 'PENDIENTE', 2: 'ENVIADO', 3: 'ENTREGADO', 4: 'LEÍDO' };
          const statusLabel = status !== null ? (labels[status] ?? String(status)) : 'desconocido';
          console.log(`   ✉️  Estado mensaje [${update.key.id?.slice(0, 8)}...]: ${statusLabel}`);
        }
      }
    }

  });

  return sock;
}

// ─── Arranque ─────────────────────────────────────────────────────────────────
console.log('🚀 Iniciando servicio WhatsApp...');
startSock().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
