const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Track online users
const users = new Map(); // socketId -> { username, color }
let visitorCount = Math.floor(Math.random() * 9000) + 1000; // fake starting count

// ═══ CHAT HISTORY (JSON file persistence) ═══
const HISTORY_FILE = path.join(__dirname, 'chat-history.json');
const MAX_HISTORY = 200; // max messages stored in file
const HISTORY_ON_JOIN = 100; // messages sent to new users

function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.log('⚠ Could not load chat history:', err.message);
    }
    return [];
}

function saveHistory(history) {
    try {
        // Keep only the last MAX_HISTORY messages
        const trimmed = history.slice(-MAX_HISTORY);
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
    } catch (err) {
        console.log('⚠ Could not save chat history:', err.message);
    }
}

let chatHistory = loadHistory();

// Retro color palette for usernames
const RETRO_COLORS = [
    '#ff00ff', '#00ffff', '#ffff00', '#ff6600',
    '#00ff00', '#ff0099', '#9900ff', '#ff3333',
    '#33ff33', '#3399ff', '#ff66cc', '#66ffcc',
    '#ffcc00', '#cc66ff', '#66ccff', '#ff9966'
];

function getRandomColor() {
    return RETRO_COLORS[Math.floor(Math.random() * RETRO_COLORS.length)];
}

function getOnlineList() {
    return Array.from(users.values()).map(u => ({
        username: u.username,
        color: u.color
    }));
}

io.on('connection', (socket) => {
    visitorCount++;

    // Send visitor count on connect
    socket.emit('visitor-count', visitorCount);

    socket.on('join', (username) => {
        // Sanitize username
        const sanitized = username.replace(/[<>&"']/g, '').trim().substring(0, 20);
        if (!sanitized) return;

        const color = getRandomColor();
        users.set(socket.id, { username: sanitized, color });

        // Send chat history to the joining user
        const recent = chatHistory.slice(-HISTORY_ON_JOIN);
        recent.forEach(msg => {
            if (msg.type === 'chat') {
                socket.emit('chat-message', msg.data);
            } else if (msg.type === 'system') {
                socket.emit('system-message', msg.data);
            }
        });

        // Announce join
        const joinMsg = {
            text: `✦ ${sanitized} has entered the chat ✦`,
            timestamp: Date.now()
        };
        io.emit('system-message', joinMsg);
        chatHistory.push({ type: 'system', data: joinMsg });
        saveHistory(chatHistory);

        // Update user list for everyone
        io.emit('user-list', getOnlineList());
        io.emit('visitor-count', visitorCount);
    });

    socket.on('chat-message', (msg) => {
        const user = users.get(socket.id);
        if (!user) return;

        const sanitized = msg.replace(/</g, '&lt;').replace(/>/g, '&gt;').substring(0, 500);
        if (!sanitized.trim()) return;

        const msgData = {
            username: user.username,
            color: user.color,
            text: sanitized,
            timestamp: Date.now()
        };
        io.emit('chat-message', msgData);

        // Persist to history
        chatHistory.push({ type: 'chat', data: msgData });
        saveHistory(chatHistory);
    });

    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user) {
            const leaveMsg = {
                text: `✧ ${user.username} has left the chat ✧`,
                timestamp: Date.now()
            };
            io.emit('system-message', leaveMsg);
            chatHistory.push({ type: 'system', data: leaveMsg });
            saveHistory(chatHistory);
            users.delete(socket.id);
            io.emit('user-list', getOnlineList());
        }
    });
});

server.listen(PORT, () => {
    console.log(`\n✦═══════════════════════════════════════════✦`);
    console.log(`║  🌟 RETRO CHAT is LIVE on port ${PORT}! 🌟  ║`);
    console.log(`║  http://localhost:${PORT}                    ║`);
    console.log(`✦═══════════════════════════════════════════✦\n`);
});
