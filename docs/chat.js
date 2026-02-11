/* ═══════════════════════════════════════
   ★ NekoChat 2000 — Client Script ★
   ═══════════════════════════════════════ */

// ═══ PARTYKIT CONNECTION (native WebSocket) ═══
const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const PARTYKIT_HOST = isLocal ? "localhost:1999" : "nekochat.frubcoin.partykit.dev";
const WS_PROTOCOL = isLocal ? "ws" : "wss";
const WS_URL = `${WS_PROTOCOL}://${PARTYKIT_HOST}/party/main-lobby`;

let ws;
let reconnectTimer = null;

function connectWebSocket() {
    ws = new WebSocket(WS_URL);

    ws.addEventListener('open', () => {
        console.log('✦ Connected to NekoChat 2000 ✦');
        // Re-join if we had a username (reconnection)
        if (currentUsername) {
            ws.send(JSON.stringify({ type: 'join', username: currentUsername }));
        }
    });

    ws.addEventListener('message', (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch {
            return;
        }

        switch (data.type) {
            case 'chat-message':
                appendChatMessage(data);
                scrollToBottom();
                break;
            case 'system-message':
                appendSystemMessage(data);
                scrollToBottom();
                break;
            case 'user-list':
                updateUserList(data.users);
                break;
            case 'visitor-count':
                updateVisitorCount(data.count);
                break;
            case 'history':
                if (data.messages && Array.isArray(data.messages)) {
                    data.messages.forEach(msg => {
                        if (msg.msgType === 'chat') {
                            appendChatMessage(msg);
                        } else if (msg.msgType === 'system') {
                            appendSystemMessage(msg);
                        }
                    });
                    scrollToBottom();
                }
                break;
            case 'cursor':
                updateRemoteCursor(data);
                break;
            case 'cursor-gone':
                removeRemoteCursor(data.id);
                break;
        }
    });

    ws.addEventListener('close', () => {
        appendSystemMessage({
            text: '⚠ Connection lost... Reconnecting... ⚠',
            timestamp: Date.now()
        });
        // Auto-reconnect after 2 seconds
        if (!reconnectTimer) {
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                connectWebSocket();
            }, 2000);
        }
    });

    ws.addEventListener('error', () => {
        // Will trigger close event, which handles reconnection
    });
}

connectWebSocket();

// ═══ DOM ELEMENTS ═══
const loginOverlay = document.getElementById('login-overlay');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username-input');
const chatPage = document.getElementById('chat-page');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');
const userListEl = document.getElementById('user-list');
const visitorNum = document.getElementById('visitor-num');
const counterValue = document.getElementById('counter-value');

let currentUsername = '';

// ═══ LOGIN ═══
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = usernameInput.value.trim();
    if (!name) return;

    currentUsername = name;
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'join', username: name }));
    }

    loginOverlay.classList.add('hidden');
    chatPage.classList.remove('hidden');
    chatInput.focus();
});

// ═══ SEND MESSAGE ═══
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (!msg) return;

    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'chat', text: msg }));
    }
    chatInput.value = '';
    chatInput.focus();
});

// ═══ RENDER FUNCTIONS ═══
function formatTime(timestamp) {
    const d = new Date(timestamp);
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ampm}`;
}

function appendChatMessage(data) {
    const div = document.createElement('div');
    div.className = 'chat-msg msg-flash';
    div.style.borderLeftColor = data.color;

    div.innerHTML = `
    <div class="msg-header">
      <span class="msg-username" style="color: ${data.color}">&lt;${data.username}&gt;</span>
      <span class="msg-time">${formatTime(data.timestamp)}</span>
    </div>
    <div class="msg-text">${data.text}</div>
  `;

    chatMessages.appendChild(div);
}

function appendSystemMessage(data) {
    const div = document.createElement('div');
    div.className = 'system-msg';
    div.textContent = data.text;
    chatMessages.appendChild(div);
}

function updateUserList(users) {
    userListEl.innerHTML = '';
    if (!users || users.length === 0) {
        userListEl.innerHTML = '<li class="no-users">No one here yet...</li>';
        return;
    }
    users.forEach(u => {
        const li = document.createElement('li');
        li.style.color = u.color;
        li.textContent = u.username;
        userListEl.appendChild(li);
    });
}

function updateVisitorCount(count) {
    const padded = String(count).padStart(6, '0');
    if (visitorNum) visitorNum.textContent = count;
    if (counterValue) counterValue.textContent = padded;
}

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ═══ CURSOR TRAIL EFFECT ═══
const trailSymbols = ['✦', '✧', '★', '☆', '·', '✶', '✴', '✸'];
let trailThrottle = 0;
let cursorSendThrottle = 0;

document.addEventListener('mousemove', (e) => {
    const now = Date.now();

    // Sparkle trail (every 60ms)
    if (now - trailThrottle >= 60) {
        trailThrottle = now;
        const star = document.createElement('span');
        star.className = 'trail-star';
        star.textContent = trailSymbols[Math.floor(Math.random() * trailSymbols.length)];
        star.style.left = e.clientX + 'px';
        star.style.top = e.clientY + 'px';
        star.style.color = `hsl(${Math.random() * 360}, 100%, 70%)`;
        document.body.appendChild(star);
        setTimeout(() => star.remove(), 800);
    }

    // Send cursor position to others (every 50ms)
    if (currentUsername && now - cursorSendThrottle >= 50) {
        cursorSendThrottle = now;
        if (ws.readyState === WebSocket.OPEN) {
            // Send as % of viewport so it works across different screen sizes
            ws.send(JSON.stringify({
                type: 'cursor',
                x: (e.clientX / window.innerWidth) * 100,
                y: (e.clientY / window.innerHeight) * 100,
            }));
        }
    }
});

// ═══ REMOTE CURSORS ═══
const remoteCursors = {}; // id -> { element, timeout }

function updateRemoteCursor(data) {
    let cursor = remoteCursors[data.id];

    if (!cursor) {
        // Create cursor element
        const el = document.createElement('div');
        el.className = 'remote-cursor';
        el.innerHTML = `
            <span class="remote-cursor-dot" style="background: ${data.color}; box-shadow: 0 0 8px ${data.color}, 0 0 16px ${data.color};"></span>
            <span class="remote-cursor-label" style="color: ${data.color}; text-shadow: 0 0 6px ${data.color};">${data.username}</span>
        `;
        document.body.appendChild(el);
        cursor = { el, timeout: null };
        remoteCursors[data.id] = cursor;
    }

    // Position at % of viewport
    const x = (data.x / 100) * window.innerWidth;
    const y = (data.y / 100) * window.innerHeight;
    cursor.el.style.left = x + 'px';
    cursor.el.style.top = y + 'px';

    // Reset stale timer — remove if no update for 5s
    if (cursor.timeout) clearTimeout(cursor.timeout);
    cursor.timeout = setTimeout(() => removeRemoteCursor(data.id), 5000);
}

function removeRemoteCursor(id) {
    const cursor = remoteCursors[id];
    if (cursor) {
        cursor.el.remove();
        if (cursor.timeout) clearTimeout(cursor.timeout);
        delete remoteCursors[id];
    }
}

// ═══ KEYBOARD SHORTCUT ═══
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && document.activeElement !== chatInput && !loginOverlay.classList.contains('hidden') === false) {
        chatInput.focus();
    }
});
