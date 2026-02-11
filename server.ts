import type * as Party from "partykit/server";

// Retro color palette for usernames
const RETRO_COLORS = [
  "#ff00ff", "#00ffff", "#ffff00", "#ff6600",
  "#00ff00", "#ff0099", "#9900ff", "#ff3333",
  "#33ff33", "#3399ff", "#ff66cc", "#66ffcc",
  "#ffcc00", "#cc66ff", "#66ccff", "#ff9966",
];

function getRandomColor() {
  return RETRO_COLORS[Math.floor(Math.random() * RETRO_COLORS.length)];
}

const MAX_HISTORY = 200;
const HISTORY_ON_JOIN = 100;

export default class NekoChat implements Party.Server {
  constructor(readonly room: Party.Room) { }

  // Rate limits: conn.id -> number[] (timestamps)
  rateLimits = new Map<string, number[]>();

  async onStart() {
    // Initialize visitor count if not set
    const count = await this.room.storage.get("realVisitorCount");
    if (count === undefined) {
      await this.room.storage.put(
        "realVisitorCount",
        0
      );
    }
  }

  async onConnect(conn: Party.Connection) {
    // Increment visitor count
    let visitorCount =
      ((await this.room.storage.get("realVisitorCount")) as number) || 0;
    visitorCount++;
    await this.room.storage.put("realVisitorCount", visitorCount);

    // Send visitor count to the new connection
    conn.send(JSON.stringify({ type: "visitor-count", count: visitorCount }));
  }

  async onMessage(message: string, sender: Party.Connection) {
    let parsed;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }

    if (parsed.type === "join") {
      const username = (parsed.username || "")
        .replace(/[<>&"']/g, "")
        .trim()
        .substring(0, 20);
      const wallet = parsed.wallet || null;

      if (!username) return;

      console.log(`[JOIN] User: ${username}, Wallet: ${wallet || "None"}`);

      // ═══ COLOR PERSISTENCE ═══
      let userColor = parsed.color;
      const userColors = (await this.room.storage.get("userColors") as Record<string, string>) || {};

      if (userColor) {
        // User provided a color, save it
        userColors[username] = userColor;
        await this.room.storage.put("userColors", userColors);
      } else if (userColors[username]) {
        // User didn't provide color, but has one saved
        userColor = userColors[username];
      } else {
        // No color provided or saved, generate random
        userColor = getRandomColor();
        // Save it so it sticks next time
        userColors[username] = userColor;
        await this.room.storage.put("userColors", userColors);
      }

      sender.setState({ username, color: userColor, wallet });

      // Send chat history to joining user
      const history =
        ((await this.room.storage.get("chatHistory")) as any[]) || [];
      const recent = history.slice(-HISTORY_ON_JOIN);
      sender.send(JSON.stringify({ type: "history", messages: recent }));

      // Broadcast join system message
      const joinMsg = {
        msgType: "system",
        text: `✦ ${username} has entered the chat ✦`,
        timestamp: Date.now(),
      };

      this.room.broadcast(JSON.stringify({ type: "system-message", ...joinMsg }));

      // Persist to history
      history.push(joinMsg);
      await this.room.storage.put(
        "chatHistory",
        history.slice(-MAX_HISTORY)
      );

      // Log wallet if present
      if (wallet) {
        const walletLog = (await this.room.storage.get("walletLog") as Record<string, string>) || {};
        // Store wallet with username (overwrite if same username cleans up, or append if new)
        // If we want a log of "who used what wallet", we can key by wallet or username.
        // User asked "log all wallets that login".
        // Let's store: username -> wallet (latest)
        walletLog[username] = wallet;
        await this.room.storage.put("walletLog", walletLog);
      }

      // Broadcast updated user list
      await this.broadcastUserList();

      // Broadcast visitor count
      const visitorCount = await this.room.storage.get("realVisitorCount");
      this.room.broadcast(
        JSON.stringify({ type: "visitor-count", count: visitorCount })
      );
    }

    if (parsed.type === "chat") {
      // ═══ RATE LIMIT CHECK ═══
      const now = Date.now();
      const timestamps = this.rateLimits.get(sender.id) || [];
      const recent = timestamps.filter(t => now - t < 10000); // 10s window

      if (recent.length >= 5) {
        sender.send(JSON.stringify({
          type: "system-message",
          text: "You're chatting too fast! 🐢"
        }));
        return;
      }

      recent.push(now);
      this.rateLimits.set(sender.id, recent);

      const state = sender.state as any;
      if (!state?.username) return;

      const text = (parsed.text || "")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .substring(0, 500);
      if (!text.trim()) return;

      const msgData = {
        msgType: "chat",
        username: state.username,
        color: state.color,
        text,
        timestamp: Date.now(),
      };

      // Broadcast to everyone
      this.room.broadcast(
        JSON.stringify({ type: "chat-message", ...msgData })
      );

      // Persist to history
      const history =
        ((await this.room.storage.get("chatHistory")) as any[]) || [];
      history.push(msgData);
      await this.room.storage.put(
        "chatHistory",
        history.slice(-MAX_HISTORY)
      );
    }

    if (parsed.type === "set-color") {
      const state = sender.state as any;
      if (!state?.username) return;

      const newColor = parsed.color;
      if (!newColor) return;

      // Update state
      sender.setState({ ...state, color: newColor });

      // Persist
      const userColors = (await this.room.storage.get("userColors") as Record<string, string>) || {};
      userColors[state.username] = newColor;
      await this.room.storage.put("userColors", userColors);

      // Broadcast updated user list
      await this.broadcastUserList();

      // Announce change? No, too noisy. Just update list and future messages.
    }

    // Cursor position — relay to everyone else (no persistence)
    if (parsed.type === "cursor") {
      const state = sender.state as any;
      if (!state?.username) return;

      this.room.broadcast(
        JSON.stringify({
          type: "cursor",
          id: sender.id,
          username: state.username,
          color: state.color,
          x: parsed.x,
          y: parsed.y,
        }),
        [sender.id] // exclude sender
      );
    }
  }

  static onBeforeConnect(req: Party.Request) {
    const origin = req.headers.get("Origin") || "";
    // Allow localhost for dev, and any subdomain of frub.bio
    if (origin.includes("localhost") || origin.includes("127.0.0.1") || origin.endsWith("frub.bio")) {
      return req;
    }
    return new Response("Unauthorized Origin", { status: 403 });
  }

  async onRequest(req: Party.Request) {
    if (req.method === "GET") {
      const url = new URL(req.url);
      if (url.pathname.endsWith("/wallets")) {
        // Return persistent log of all wallets that ever connected
        const walletLog = (await this.room.storage.get("walletLog") as Record<string, string>) || {};
        return new Response(JSON.stringify(walletLog, null, 2), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response("Not Found", { status: 404 });
  }

  async onClose(conn: Party.Connection) {
    this.rateLimits.delete(conn.id);
    const state = conn.state as any;
    if (state?.username) {
      // Broadcast leave message
      const leaveMsg = {
        msgType: "system",
        text: `✧ ${state.username} has left the chat ✧`,
        timestamp: Date.now(),
      };
      this.room.broadcast(
        JSON.stringify({ type: "system-message", ...leaveMsg })
      );

      // Persist to history
      const history =
        ((await this.room.storage.get("chatHistory")) as any[]) || [];
      history.push(leaveMsg);
      await this.room.storage.put(
        "chatHistory",
        history.slice(-MAX_HISTORY)
      );

      // Tell others to remove cursor
      this.room.broadcast(
        JSON.stringify({ type: "cursor-gone", id: conn.id })
      );
    }

    // Always broadcast updated user list (active connection count changed)
    await this.broadcastUserList();
  }

  async broadcastUserList() {
    const users: { username: string; color: string; wallet?: string }[] = [];
    let totalConnections = 0;
    for (const conn of this.room.getConnections()) {
      totalConnections++;
      const state = conn.state as any;
      if (state?.username) {
        users.push({
          username: state.username,
          color: state.color
        });
      }
    }
    this.room.broadcast(JSON.stringify({ type: "user-list", users, total: totalConnections }));
  }
}

NekoChat satisfies Party.Worker;
