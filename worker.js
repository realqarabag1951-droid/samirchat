import { DurableObject } from "cloudflare:workers";

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const MAX_MESSAGE = 500;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket required", { status: 426 });
      }

      const room = env.CHAT_ROOM.getByName("main");
      return room.fetch(request);
    }

    if (
      url.pathname === "/api/register" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();
        const username = String(body.username || "").trim();

        if (!USERNAME_RE.test(username)) {
          return Response.json(
            {
              ok: false,
              error: "Username 3-20 simvol olmalıdır."
            },
            { status: 400 }
          );
        }

        const room = env.CHAT_ROOM.getByName("main");

        return room.fetch(
          new Request(
            new URL("/register", request.url),
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ username })
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

    return env.ASSETS.fetch(request);
  }
};

export class ChatRoom extends DurableObject {

  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (
      url.pathname === "/register" &&
      request.method === "POST"
    ) {
      const body = await request.json();
      const username = String(body.username || "").trim();

      const key = "user:" + username.toLowerCase();
      const oldUser = await this.ctx.storage.get(key);

      if (oldUser) {
        return Response.json({
          ok: true,
          username: oldUser.username
        });
      }

      await this.ctx.storage.put(key, {
        username: username,
        createdAt: Date.now()
      });

      return Response.json({
        ok: true,
        username: username
      });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("SamirChat server işləyir.");
    }

    const username =
      url.searchParams.get("username");

    if (!username) {
      return new Response(
        "Username required",
        { status: 400 }
      );
    }

    const pair = new WebSocketPair();

    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(
      server,
      [username]
    );

    server.serializeAttachment({
      username: username
    });

    server.send(
      JSON.stringify({
        type: "welcome",
        username: username,
        users: this.getUsers()
      })
    );

    this.broadcast(
      {
        type: "system",
        text: "@" + username + " çata qoşuldu."
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

      const attachment =
        ws.deserializeAttachment();

      const username =
        attachment &&
        attachment.username;

      if (!username) {
        return;
      }

      if (data.type === "message") {
        this.handleMessage(
          username,
          data.text
        );
        return;
      }

      if (data.type === "dm") {
        this.handleDM(
          ws,
          username,
          data.to,
          data.text
        );
      }

    } catch (error) {
      return;
    }
  }

  handleMessage(username, rawText) {
    const text =
      String(rawText || "").trim();

    if (!text) {
      return;
    }

    if (text.length > MAX_MESSAGE) {
      return;
    }

    this.broadcast({
      type: "message",
      username: username,
      text: text,
      time: Date.now()
    });
  }

  handleDM(ws, username, rawTo, rawText) {
    const to =
      String(rawTo || "").trim();

    const text =
      String(rawText || "").trim();

    if (!to || !text) {
      return;
    }

    if (text.length > MAX_MESSAGE) {
      return;
    }

    if (
      to.toLowerCase() ===
      username.toLowerCase()
    ) {
      return;
    }

    let delivered = false;

    const sockets =
      this.ctx.getWebSockets();

    for (const socket of sockets) {

      const info =
        socket.deserializeAttachment();

      const target =
        info && info.username;

      if (!target) {
        continue;
      }

      if (
        target.toLowerCase() ===
        to.toLowerCase()
      ) {

        socket.send(
          JSON.stringify({
            type: "dm",
            from: username,
            to: target,
            text: text,
            time: Date.now()
          })
        );

        delivered = true;
      }
    }

    ws.send(
      JSON.stringify({
        type: "dm",
        from: username,
        to: to,
        text: text,
        time: Date.now()
      })
    );

    if (!delivered) {
      ws.send(
        JSON.stringify({
          type: "system",
          text:
            "@" +
            to +
            " hazırda online deyil."
        })
      );
    }
  }

  webSocketClose(ws) {
    const info =
      ws.deserializeAttachment();

    const username =
      info && info.username;

    if (!username) {
      return;
    }

    this.broadcast({
      type: "system",
      text:
        "@" +
        username +
        " çatdan ayrıldı."
    });

    this.broadcastUsers();
  }

  getUsers() {
    const sockets =
      this.ctx.getWebSockets();

    const users = [];

    for (const socket of sockets) {

      const info =
        socket.deserializeAttachment();

      const username =
        info && info.username;

      if (!username) {
        continue;
      }

      if (!users.includes(username)) {
        users.push(username);
      }
    }

    return users;
  }

  broadcast(data, except) {
    const message =
      JSON.stringify(data);

    const sockets =
      this.ctx.getWebSockets();

    for (const socket of sockets) {

      if (socket === except) {
        continue;
      }

      try {
        socket.send(message);
      } catch (error) {
        continue;
      }
    }
  }

  broadcastUsers() {
    this.broadcast({
      type: "users",
      users: this.getUsers()
    });
  }
        }
