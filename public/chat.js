/* ═══════════════════════════════════════
   ★ NekoChat 2000 — Client Script ★
   ═══════════════════════════════════════ */

const socket = io();

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
    socket.emit('join', name);

    loginOverlay.classList.add('hidden');
    chatPage.classList.remove('hidden');
    chatInput.focus();
});

// ═══ SEND MESSAGE ═══
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (!msg) return;

    socket.emit('chat-message', msg);
    chatInput.value = '';
    chatInput.focus();
});

// ═══ RECEIVE MESSAGES ═══
socket.on('chat-message', (data) => {
    appendChatMessage(data);
    scrollToBottom();
});

socket.on('system-message', (data) => {
    appendSystemMessage(data);
    scrollToBottom();
});

socket.on('user-list', (users) => {
    updateUserList(users);
});

socket.on('visitor-count', (count) => {
    const padded = String(count).padStart(6, '0');
    if (visitorNum) visitorNum.textContent = count;
    if (counterValue) counterValue.textContent = padded;
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

    const isMe = data.username === currentUsername;

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
    if (users.length === 0) {
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

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ═══ CURSOR TRAIL EFFECT ═══
const trailSymbols = ['✦', '✧', '★', '☆', '·', '✶', '✴', '✸'];
let trailThrottle = 0;

document.addEventListener('mousemove', (e) => {
    const now = Date.now();
    if (now - trailThrottle < 60) return;
    trailThrottle = now;

    const star = document.createElement('span');
    star.className = 'trail-star';
    star.textContent = trailSymbols[Math.floor(Math.random() * trailSymbols.length)];
    star.style.left = e.clientX + 'px';
    star.style.top = e.clientY + 'px';
    star.style.color = `hsl(${Math.random() * 360}, 100%, 70%)`;

    document.body.appendChild(star);

    setTimeout(() => star.remove(), 800);
});

// ═══ KEYBOARD SHORTCUT ═══
document.addEventListener('keydown', (e) => {
    // Focus chat input on Enter if not already focused
    if (e.key === 'Enter' && document.activeElement !== chatInput && !loginOverlay.classList.contains('hidden') === false) {
        chatInput.focus();
    }
});

// ═══ ON CONNECT / DISCONNECT ═══
socket.on('connect', () => {
    console.log('✦ Connected to NekoChat 2000 ✦');
});

socket.on('disconnect', () => {
    appendSystemMessage({
        text: '⚠ Connection lost... Reconnecting... ⚠',
        timestamp: Date.now()
    });
});
