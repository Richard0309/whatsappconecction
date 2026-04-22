# WhatsApp Personal Service — Baileys v7

Servicio de prueba que conecta tu WhatsApp personal usando [Baileys v7](https://github.com/WhiskeySockets/Baileys), imprime los mensajes entrantes en la terminal y los retransmite via WebSocket local.

---

## Requisitos

- Node.js **≥ 20**
- npm ≥ 9
- Cuenta de WhatsApp activa en un teléfono

---

## Instalación

```bash
npm install
```

---

## Cómo conectar tu número de WhatsApp

### 1. Iniciar el servicio

```bash
npm start
```

Al arrancar por primera vez verás un **código QR** en la terminal, similar a este:

```
█████████████████████████
██ ▄▄▄▄▄ █ ▀█▄▀█ ▄▄▄▄▄ ██
██ █   █ ██▄▀  █ █   █ ██
...
⚠️  Escanea el QR de arriba con WhatsApp → Dispositivos vinculados → Vincular dispositivo
```

### 2. Escanear el QR desde tu teléfono

1. Abre **WhatsApp** en tu teléfono.
2. Ve a **Configuración** → **Dispositivos vinculados** → **Vincular un dispositivo**.
3. Apunta la cámara al QR mostrado en la terminal.
4. Espera la confirmación — verás en la terminal:

```
✅ WhatsApp conectado. Esperando mensajes...
```

> El QR caduca en ~60 segundos. Si expira, el servicio genera uno nuevo automáticamente.

### 3. Mensajes en la terminal

Cada mensaje que llegue al número vinculado se imprime así:

```
📨 14:35:22 [Juan Pérez (+521234567890)]
   Hola, ¿cómo estás?

📨 14:36:01 [YO → +521234567890]
   Bien, ¿y tú?
```

---

## WebSocket local

El servicio expone un WebSocket en **`ws://localhost:8080`** (configurable con la variable de entorno `PORT`).

Cada evento se emite como JSON:

### Mensaje entrante
```json
{
  "type": "message",
  "timestamp": "14:35:22",
  "from": "+521234567890",
  "pushName": "Juan Pérez",
  "fromMe": false,
  "jid": "521234567890@s.whatsapp.net",
  "text": "Hola, ¿cómo estás?"
}
```

### Cambio de estado de conexión
```json
{ "type": "status", "message": "WhatsApp conectado" }
```

### Ejemplo con `wscat`

```bash
npx wscat -c ws://localhost:8080
```

---

## Variables de entorno

| Variable | Descripción | Default |
|----------|-------------|---------|
| `PORT`   | Puerto del WebSocket local | `8080` |

---

## Persistencia

| Archivo / Carpeta          | Contenido                            |
|----------------------------|--------------------------------------|
| `baileys_auth_info/`       | Credenciales de sesión (no subir a git) |
| `baileys_store.json`       | Caché de chats y mensajes recientes  |

> **Importante:** agrega estas entradas a `.gitignore` para no exponer tu sesión.

---

## Desconectar / cerrar sesión

- **Detener el servicio** sin cerrar sesión: `Ctrl + C` (puedes reconectar después).
- **Cerrar sesión permanentemente**: desvincula el dispositivo desde tu teléfono en **Configuración → Dispositivos vinculados**, luego borra la carpeta de auth:

```bash
rm -rf baileys_auth_info/ baileys_store.json
```

---

## Notas de seguridad

- Las credenciales en `baileys_auth_info/` permiten acceso completo a tu cuenta. Protégelas como una contraseña.
- Este servicio es solo para **pruebas locales**. No lo expongas a Internet sin autenticación.
- La dependencia transitiva `protobufjs` (dentro de `libsignal`) reporta una vulnerabilidad conocida. Es un problema interno de Baileys; no ejecutes `npm audit fix` ya que puede romper el cifrado de señal.
# whatsappconecction
