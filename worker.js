import { DurableObject } from "cloudflare:workers";

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const CODE_RE = /^\d{4,6}$/;
const MAX_MESSAGE_LENGTH = 500;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // REGISTER
    // =========================

    if (
      url.pathname === "/api/register" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();

        const username = String(
          body.username || ""
        ).trim();

        const code = String(
          body.code || ""
        ).trim();

        if (!USERNAME_RE.test(username)) {
          return Response.json(
            {
              ok: false,
              error:
                "Username 3-20 simvol olmalıdır. Yalnız hərf, rəqəm və _ istifadə edə bilərsən."
            },
            { status: 400 }
          );
        }

        if (!CODE_RE.test(code)) {
          return Response.json(
            {
              ok: false,
              error:
                "Kod 4-6 rəqəm olmalıdır."
            },
            { status: 400 }
          );
        }

        const room =
          env.CHAT_ROOM.getByName("main");

        return room.fetch(
          new Request(
            new URL(
              "/register",
              request.url
            ),
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json"
              },
              body: JSON.stringify({
                username,
                code
              })
            }
          )
        );

      } catch {
        return Response.json(
          {
            ok: false,
            error: "Yanlış sorğu."
          },
          { status: 400 }
        );
      }
    }


    // =========================
    // LOGIN
    // =========================

    if (
      url.pathname === "/api/login" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();

        const username = String(
          body.username || ""
        ).trim();

        const code = String(
          body.code || ""
        ).trim();

        if (!USERNAME_RE.test(username)) {
          return Response.json(
            {
              ok: false,
              error: "Username düzgün deyil."
            },
            { status: 400 }
          );
        }

        if (!CODE_RE.test(code)) {
          return Response.json(
            {
              ok: false,
              error: "Kod düzgün deyil."
            },
            { status: 400 }
          );
        }

        const room =
          env.CHAT_ROOM.getByName("main");

        return room.fetch(
          new Request(
            new URL(
              "/login",
              request.url
            ),
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json"
              },
              body: JSON.stringify({
                username,
                code
              })
            }
          )
        );

      } catch {
        return Response.json(
          {
            ok: false,
            error: "Yanlış sorğu."
          },
          { status: 400 }
        );
      }
    }


    // =========================
    // WEBSOCKET
    // =========================

    if (url.pathname === "/ws") {

      if (
        request.headers.get("Upgrade")
          ?.toLowerCase() !== "websocket"
      ) {
        return new Response(
          "WebSocket required",
          { status: 426 }
        );
      }

      const username =
        url.searchParams.get("username");

      if (
        !username ||
        !USERNAME_RE.test(username)
      ) {
        return new Response(
          "Valid username required",
          { status: 400 }
        );
      }

      const room =
        env.CHAT_ROOM.getByName("main");

      return room.fetch(request);
    }


    // =========================
    // WEBSITE
    // =========================

    return env.ASSETS.fetch(request);
  }
};


// ======================================================
// DURABLE OBJECT
// ======================================================

export class ChatRoom extends DurableObject {

  constructor(ctx, env) {
    super(ctx, env);

    this.ctx = ctx;
    this.env = env;
  }


  // ====================================================
  // REQUESTS
  // ====================================================

  async fetch(request) {

    const url =
      new URL(request.url);


    // ==================================================
    // REGISTER
    // ==================================================

    if (
      url.pathname === "/register" &&
      request.method === "POST"
    ) {

      try {

        const body =
          await request.json();

        const username =
          String(
            body.username || ""
          ).trim();

        const code =
          String(
            body.code || ""
          ).trim();


        if (
          !USERNAME_RE.test(username)
        ) {
          return Response.json(
            {
              ok: false,
              error:
                "Username düzgün deyil."
            },
            { status: 400 }
          );
        }


        if (!CODE_RE.test(code)) {
          return Response.json(
            {
              ok: false,
              error:
                "Kod 4-6 rəqəm olmalıdır."
            },
            { status: 400 }
          );
        }


        const key =
          `user:${username.toLowerCase()}`;


        const existing =
          await this.ctx.storage.get(key);


        // Username artıq varsa
        if (existing) {

          return Response.json(
            {
              ok: false,
              error:
                "Bu username artıq istifadə olunur."
            },
            { status: 409 }
          );

        }


        // Kodu hash edirik
        const codeHash =
          await hashCode(code);


        await this.ctx.storage.put(
          key,
          {
            username,
            codeHash,
            createdAt: Date.now()
          }
        );


        return Response.json({
          ok: true,
          username
        });

      } catch {

        return Response.json(
          {
            ok: false,
            error:
              "Qeydiyyat zamanı xəta baş verdi."
          },
          { status: 400 }
        );

      }
    }


    // ==================================================
    // LOGIN
    // ==================================================

    if (
      url.pathname === "/login" &&
      request.method === "POST"
    ) {

      try {

        const body =
          await request.json();

        const username =
          String(
            body.username || ""
          ).trim();

        const code =
          String(
            body.code || ""
          ).trim();


        if (
          !USERNAME_RE.test(username) ||
          !CODE_RE.test(code)
        ) {

          return Response.json(
            {
              ok: false,
              error:
                "Username və ya kod düzgün deyil."
            },
            { status: 400 }
          );

        }


        const key =
          `user:${username.toLowerCase()}`;


        const account =
          await this.ctx.storage.get(key);


        if (!account) {

          return Response.json(
            {
              ok: false,
              error:
                "Bu username mövcud deyil."
            },
            { status: 404 }
          );

        }


        const codeHash =
          await hashCode(code);


        if (
          account.codeHash !== codeHash
        ) {

          return Response.json(
            {
              ok: false,
              error:
                "Kod səhvdir."
            },
            { status: 401 }
          );

        }


        return Response.json({
          ok: true,
          username: account.username
        });

      } catch {

        return Response.json(
          {
            ok: false,
            error:
              "Giriş zamanı xəta baş verdi."
          },
          { status: 400 }
        );

      }
    }


    // ==================================================
    // WEBSOCKET
    // ==================================================

    if (
      request.headers.get("Upgrade")
        ?.toLowerCase() !== "websocket"
    ) {

      return new Response(
        "SamirChat server işləyir.",
        { status: 200 }
      );

    }


    const username =
      url.searchParams.get(
        "username"
      );


    if (
      !username ||
      !USERNAME_RE.test(username)
    ) {

      return new Response(
        "Username required",
        { status: 400 }
      );

    }


    const pair =
      new WebSocketPair();

    const client =
      pair[0];

    const server =
      pair[1];


    this.ctx.acceptWebSocket(
      server,
      [username]
    );


    server.serializeAttachment({
      username
    });


    // Hazırda online olanlar
    const users =
      this.getOnlineUsers();


    // Yeni istifadəçiyə siyahını göndər
    server.send(
      JSON.stringify({
        type: "welcome",
        username,
        users
      })
    );


    // Digərlərinə bildir
    this.broadcast(
      {
        type: "system",
        text:
          `@${username} çata qoşuldu.`
      },
      server
    );


    // Online siyahısını yenilə
    this.broadcastUsers();


    return new Response(
      null,
      {
        status: 101,
        webSocket: client
      }
    );
  }


  // ====================================================
  // MESSAGE
  // ====================================================

  webSocketMessage(
    ws,
    message
  ) {

    try {

      const data =
        JSON.parse(message);


      if (
        data.type !== "message"
      ) {
        return;
      }


      const text =
        String(
          data.text || ""
        ).trim();


      if (!text) {
        return;
      }


      if (
        text.length >
        MAX_MESSAGE_LENGTH
      ) {
        return;
      }


      const attachment =
        ws.deserializeAttachment();


      const username =
        attachment?.username;


      if (!username) {
        return;
      }


      this.broadcast({
        type: "message",
        username,
        text,
        time: Date.now()
      });

    } catch {
      // Səhv mesajı ignore et
    }
  }


  // ====================================================
  // USER DISCONNECT
  // ====================================================

  webSocketClose(ws) {

    const attachment =
      ws.deserializeAttachment();


    const username =
      attachment?.username;


    if (!username) {
      return;
    }


    this.broadcast({
      type: "system",
      text:
        `@${username} çatdan ayrıldı.`
    });


    this.broadcastUsers();
  }


  // ====================================================
  // ONLINE USERS
  // ====================================================

  getOnlineUsers() {

    const sockets =
      this.ctx.getWebSockets();


    const users =
      sockets
        .map(
          ws =>
            ws
              .deserializeAttachment()
              ?.username
        )
        .filter(Boolean);


    return [
      ...new Set(users)
    ];
  }


  // ====================================================
  // BROADCAST
  // ====================================================

  broadcast(
    data,
    except = null
  ) {

    const message =
      JSON.stringify(data);


    for (
      const ws of
      this.ctx.getWebSockets()
    ) {

      if (ws === except) {
        continue;
      }


      try {

        ws.send(message);

      } catch {
        // Bağlantı kəsilib
      }
    }
  }


  // ====================================================
  // UPDATE ONLINE USERS
  // ====================================================

  broadcastUsers() {

    this.broadcast({
      type: "users",
      users:
        this.getOnlineUsers()
    });

  }
}


// ======================================================
// HASH CODE
// ======================================================

async function hashCode(code) {

  const data =
    new TextEncoder().encode(code);


  const hash =
    await crypto.subtle.digest(
      "SHA-256",
      data
    );


  return Array
    .from(
      new Uint8Array(hash)
    )
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(2, "0")
    )
    .join("");
           }
