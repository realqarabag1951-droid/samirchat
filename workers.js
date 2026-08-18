import { DurableObject } from "cloudflare:workers";

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const MAX_MESSAGE_LENGTH = 500;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // WebSocket chat endpoint
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket required", { status: 426 });
      }

      const room = env.CHAT_ROOM.getByName("main");
      return room.fetch(request);
    }

    // Username registration
    if (url.pathname === "/api/register" && request.method === "POST") {
      try {
        const body = await request.json();
        const username = String(body.username || "").trim();

        if (!USERNAME_RE.test(username)) {
          return Response.json(
            {
              ok: false,
              error:
                "Username 3-20 simvol olmalıdır və yalnız hərf, rəqəm və _ istifadə edə bilər.",
            },
            { status: 400 }
          );
        }

        const room = env.CHAT_ROOM.getByName("main");

        return room.fetch(
          new Request(new URL("/register", request.url), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ username }),
          })
        );
      } catch {
        return Response.json(
          { ok: false, error: "Yanlış sorğu." },
          { status: 400 }
        );
      }
    }

    return env.ASSETS.fetch(request);
  },
};

export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Username registration
    if (url.pathname === "/register" && request.method === "POST") {
      const { username } = await request.json();

      const key = `user:${username.toLowerCase()}`;
      const existing = await this.ctx.storage.get(key);

      if (existing) {
        return Response.json(
          {
            ok: false,
            error: "Bu username artıq istifadə olunur.",
          },
          { status: 409 }
        );
      }

      await this.ctx.storage.put(key, {
        username,
        createdAt: Date.now(),
      });

      return Response.json({
        ok: true,
        username,
      });
    }

    // WebSocket connection
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("ChatRoom is running.", { status: 200 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const username = new URL(request.url).searchParams.get("username");

    if (!username) {
      return new Response("Username required", { status: 400 });
    }

    // Hibernation WebSocket
    this.ctx.acceptWebSocket(server, [username]);

    server.serializeAttachment({
      username,
    });

    // Send current online users to the new user
    const users = this.getOnlineUsers();

    server.send(
      JSON.stringify({
        type: "welcome",
        username,
        users,
      })
    );

    // Tell everybody that this user joined
    this.broadcast(
      {
        type: "system",
        text: `${username} çata qoşuldu.`,
      },
      server
    );

    this.broadcastUsers();

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  webSocketMessage(ws, message) {
    try {
      const data = JSON.parse(message);

      if (data.type !== "message") {
        return;
      }

      const text = String(data.text || "").trim();

      if (!text || text.length > MAX_MESSAGE_LENGTH) {
        return;
      }

      const attachment = ws.deserializeAttachment();
      const username = attachment?.username;

      if (!username) {
        return;
      }

      this.broadcast({
        type: "message",
        username,
        text,
        time: Date.now(),
      });
    } catch {
      // Ignore invalid messages
    }
  }

  webSocketClose(ws) {
    const attachment = ws.deserializeAttachment();
    const username = attachment?.username;

    if (username) {
      this.broadcast({
        type: "system",
        text: `${username} çatdan ayrıldı.`,
      });

      this.broadcastUsers();
    }
  }

  getOnlineUsers() {
    const sockets = this.ctx.getWebSockets();

    return sockets
      .map((ws) => ws.deserializeAttachment()?.username)
      .filter(Boolean);
  }

  broadcast(data, except = null) {
    const message = JSON.stringify(data);

    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;

      try {
        ws.send(message);
      } catch {
        // Ignore disconnected sockets
      }
    }
  }

  broadcastUsers() {
    this.broadcast({
      type: "users",
      users: this.getOnlineUsers(),
    });
  }
          }
