import { DurableObject } from "cloudflare:workers";

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const CODE_RE = /^\d{4,6}$/;
const MAX_MESSAGE_LENGTH = 500;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/register" && request.method === "POST") {
      return handleAccount(request, env, "register");
    }

    if (url.pathname === "/api/login" && request.method === "POST") {
      return handleAccount(request, env, "login");
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket required", { status: 426 });
      }

      const room = env.CHAT_ROOM.getByName("main");
      return room.fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};

async function handleAccount(request, env, action) {
  try {
    const body = await request.json();

    const username = String(body.username || "").trim();
    const code = String(body.code || "").trim();

    if (!USERNAME_RE.test(username)) {
      return Response.json(
        {
          ok: false,
          error: "Username 3-20 simvol olmalıdır."
        },
        { status: 400 }
      );
    }

    if (!CODE_RE.test(code)) {
      return Response.json(
        {
          ok: false,
          error: "Kod 4-6 rəqəmdən ibarət olmalıdır."
        },
        { status: 400 }
      );
    }

    const room = env.CHAT_ROOM.getByName("main");

    return room.fetch(
      new Request(
        new URL("/" + action, request.url),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            username,
            code
          })
        }
      )
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: "Yanlış sorğu."
      },
      { status: 400 }
    );
  }
}

export class ChatRoom extends DurableObject {

  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/register" && request.method === "POST") {
      return this.register(request);
    }

    if (url.pathname === "/login" && request.method === "POST") {
      return this.login(request);
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("SamirChat server is running.");
    }

    return this.websocket(request);
  }

  async register(request) {
    const body = await request.json();

    const username = String(body.username || "").trim();
    const code = String(body.code || "").trim();

    const key = "user:" + username.toLowerCase();

    const existing = await this.ctx.storage.get(key);

    if (existing) {
      return Response.json(
        {
          ok: false,
          error: "Bu username artıq istifadə olunur."
        },
        { status: 409 }
      );
    }

    await this.ctx.storage.put(key, {
      username,
      code,
      createdAt: Date.now()
    });

    return Response.json({
      ok: true,
      username
    });
  }

  async login(request) {
    const body = await request.json();

    const username = String(body.username || "").trim();
    const code = String(body.code || "").trim();

    const key = "user:" + username.toLowerCase();

    const user = await this.ctx.storage.get(key);

    if (!user) {
      return Response.json(
        {
          ok: false,
          error: "Belə username mövcud deyil."
        },
        { status: 404 }
      );
    }

    if (user.code !== code) {
      return Response.json(
        {
          ok: false,
          error: "Kod yanlışdır."
        },
        { status: 401 }
      );
    }

    return Response.json({
      ok: true,
      username: user.username
    });
  }

  websocket(request) {
    const username = new URL(request.url)
      .searchParams
      .get("username");

    if (!username || !USERNAME_RE.test(username)) {
      return new Response(
        "Username required",
        { status: 400 }
      );
    }

    const pair = new WebSocketPair();

    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);

    server.serializeAttachment({
      username
    });

    server.send(
      JSON.stringify({
        type: "welcome",
        username,
        users: this.getOnlineUsers()
      })
    );

    this.broadcast(
      {
        type: "system",
        text: username + " çata qoşuldu."
      },
      server
    );

    this.broadcastUsers();

    return new Response(null, {
      status: 101,
      webSocket: client
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

      const username = attachment
        ? attachment.username
        : null;

      if (!username) {
        return;
      }

      this.broadcast({
        type: "message",
        username,
        text,
        time: Date.now()
      });

    } catch (error) {
      // Invalid message ignored
    }
  }

  webSocketClose(ws) {
    const attachment = ws.deserializeAttachment();

    const username = attachment
      ? attachment.username
      : null;

    if (!username) {
      return;
    }

    this.broadcast({
      type: "system",
      text: username + " çatdan ayrıldı."
    });

    this.broadcastUsers();
  }

  getOnlineUsers() {
    return this.ctx
      .getWebSockets()
      .map(function(ws) {
        const attachment = ws.deserializeAttachment();

        return attachment
          ? attachment.username
          : null;
      })
      .filter(Boolean);
  }

  broadcast(data, except) {
    const message = JSON.stringify(data);

    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) {
        continue;
      }

      try {
        ws.send(message);
      } catch (error) {
        // Socket already closed
      }
    }
  }

  broadcastUsers() {
    this.broadcast({
      type: "users",
      users: this.getOnlineUsers()
    });
  }
  }
