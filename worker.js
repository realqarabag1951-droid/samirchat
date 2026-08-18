import { DurableObject } from "cloudflare:workers";

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const CODE_RE = /^[A-Za-z0-9]{4,10}$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function username(value) {
  return String(value || "").trim();
}

function hashKey(name) {
  return "user:" + name.toLowerCase();
}

function sessionKey(token) {
  return "session:" + token;
}

async function hashCode(code) {
  const data = new TextEncoder().encode(code);

  const hash = await crypto.subtle.digest(
    "SHA-256",
    data
  );

  return Array.from(new Uint8Array(hash))
    .map(x => x.toString(16).padStart(2, "0"))
    .join("");
}

function createToken() {
  return crypto.randomUUID() + "-" + crypto.randomUUID();
}

async function getSession(ctx, token) {
  if (!token) return null;

  return await ctx.storage.get(
    sessionKey(token)
  );
}

export default {

  async fetch(request, env) {

    const url = new URL(request.url);

    /*
    ==========================
    HESAB YARAT
    ==========================
    */

    if (
      url.pathname === "/api/register" &&
      request.method === "POST"
    ) {

      try {

        const body = await request.json();

        const name = username(body.username);
        const code = String(body.code || "").trim();

        if (!USERNAME_RE.test(name)) {
          return json({
            ok: false,
            error: "Username 3-20 simvol olmalıdır."
          }, 400);
        }

        if (!CODE_RE.test(code)) {
          return json({
            ok: false,
            error: "Kod 4-10 simvol olmalıdır."
          }, 400);
        }

        const room =
          env.CHAT_ROOM.getByName("main");

        return room.fetch(
          new Request(
            new URL("/register", request.url),
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json"
              },
              body: JSON.stringify({
                username: name,
                code: code
              })
            }
          )
        );

      } catch {

        return json({
          ok: false,
          error: "Qeydiyyat zamanı xəta baş verdi."
        }, 500);

      }
    }


    /*
    ==========================
    HESABA DAXIL OL
    ==========================
    */

    if (
      url.pathname === "/api/login" &&
      request.method === "POST"
    ) {

      try {

        const body = await request.json();

        const name = username(body.username);
        const code = String(body.code || "").trim();

        if (!USERNAME_RE.test(name)) {
          return json({
            ok: false,
            error: "Username düzgün deyil."
          }, 400);
        }

        if (!CODE_RE.test(code)) {
          return json({
            ok: false,
            error: "Kod 4-10 simvol olmalıdır."
          }, 400);
        }

        const room =
          env.CHAT_ROOM.getByName("main");

        return room.fetch(
          new Request(
            new URL("/login", request.url),
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json"
              },
              body: JSON.stringify({
                username: name,
                code: code
              })
            }
          )
        );

      } catch {

        return json({
          ok: false,
          error: "Giriş zamanı xəta baş verdi."
        }, 500);

      }
    }


    /*
    ==========================
    WEBSOCKET
    ==========================
    */

    if (url.pathname === "/ws") {

      if (
        request.headers
          .get("Upgrade")
          ?.toLowerCase() !== "websocket"
      ) {
        return new Response(
          "WebSocket required",
          { status: 426 }
        );
      }

      const room =
        env.CHAT_ROOM.getByName("main");

      return room.fetch(request);
    }


    /*
    ==========================
    SAYT
    ==========================
    */

    return env.ASSETS.fetch(request);
  }
};


/*
=================================
DURABLE OBJECT
=================================
*/

export class ChatRoom extends DurableObject {

  constructor(ctx, env) {
    super(ctx, env);

    this.ctx = ctx;
    this.env = env;
  }


  async fetch(request) {

    const url = new URL(request.url);


    /*
    ==========================
    REGISTER
    ==========================
    */

    if (
      url.pathname === "/register" &&
      request.method === "POST"
    ) {

      try {

        const body = await request.json();

        const name =
          username(body.username);

        const code =
          String(body.code || "").trim();

        const existing =
          await this.ctx.storage.get(
            hashKey(name)
          );

        if (existing) {

          return json({
            ok: false,
            error:
              "Bu username artıq istifadə olunur."
          }, 409);

        }

        const codeHash =
          await hashCode(code);

        await this.ctx.storage.put(
          hashKey(name),
          {
            username: name,
            codeHash: codeHash,
            createdAt: Date.now()
          }
        );

        const token =
          createToken();

        await this.ctx.storage.put(
          sessionKey(token),
          {
            username: name,
            createdAt: Date.now()
          }
        );

        return json({
          ok: true,
          username: name,
          token: token
        });

      } catch {

        return json({
          ok: false,
          error:
            "Hesab yaratmaq mümkün olmadı."
        }, 500);

      }
    }


    /*
    ==========================
    LOGIN
    ==========================
    */

    if (
      url.pathname === "/login" &&
      request.method === "POST"
    ) {

      try {

        const body = await request.json();

        const name =
          username(body.username);

        const code =
          String(body.code || "").trim();

        const user =
          await this.ctx.storage.get(
            hashKey(name)
          );

        if (!user) {

          return json({
            ok: false,
            error:
              "Belə username ilə hesab yoxdur."
          }, 404);

        }

        const codeHash =
          await hashCode(code);

        if (
          codeHash !== user.codeHash
        ) {

          return json({
            ok: false,
            error: "Kod səhvdir."
          }, 401);

        }

        const token =
          createToken();

        await this.ctx.storage.put(
          sessionKey(token),
          {
            username: user.username,
            createdAt: Date.now()
          }
        );

        return json({
          ok: true,
          username: user.username,
          token: token
        });

      } catch {

        return json({
          ok: false,
          error:
            "Giriş zamanı xəta baş verdi."
        }, 500);

      }
    }


    /*
    ==========================
    WEBSOCKET
    ==========================
    */

    if (
      request.headers
        .get("Upgrade")
        ?.toLowerCase() !== "websocket"
    ) {

      return new Response(
        "SamirChat Worker işləyir."
      );
    }


    const token =
      url.searchParams.get("token");

    const session =
      await getSession(
        this.ctx,
        token
      );

    if (!session) {

      return new Response(
        "Invalid session",
        { status: 401 }
      );
    }


    const name =
      session.username;


    const pair =
      new WebSocketPair();

    const client =
      pair[0];

    const server =
      pair[1];


    this.ctx.acceptWebSocket(
      server,
      [name]
    );


    server.serializeAttachment({
      username: name,
      token: token
    });


    server.send(
      JSON.stringify({
        type: "welcome",
        username: name,
        users: this.getOnlineUsers()
      })
    );


    this.broadcast({
      type: "system",
      text:
        "@" + name + " çata qoşuldu."
    }, server);


    this.broadcastUsers();


    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }


  /*
  ==========================
  MESAJ
  ==========================
  */

  async webSocketMessage(ws, message) {

    try {

      const data =
        JSON.parse(message);

      const attachment =
        ws.deserializeAttachment();

      const sender =
        attachment?.username;

      if (!sender) return;


      /*
      ==========================
      ÜMUMİ SÖHBƏT
      ==========================
      */

      if (data.type === "message") {

        const text =
          String(data.text || "").trim();

        if (!text) return;

        if (text.length > 500) return;


        this.broadcast({
          type: "message",
          username: sender,
          text: text,
          time: Date.now()
        });

        return;
      }


      /*
      ==========================
      DM
      ==========================
      */

      if (data.type === "dm") {

        const target =
          username(data.to);

        const text =
          String(data.text || "").trim();


        if (!USERNAME_RE.test(target)) {
          return;
        }

        if (!text) return;

        if (text.length > 500) return;


        /*
        HƏDƏFİN HESABI VAR?
        */

        const targetUser =
          await this.ctx.storage.get(
            hashKey(target)
          );

        if (!targetUser) {

          ws.send(
            JSON.stringify({
              type: "error",
              error:
                "Belə username tapılmadı."
            })
          );

          return;
        }


        const dm = {

          id: crypto.randomUUID(),

          from: sender,

          to: targetUser.username,

          text: text,

          time: Date.now()

        };


        /*
        DM YALNIZ ONLINE
        İSTİFADƏÇİYƏ GÖNDƏRİLİR.

        SERVERDƏ SAXLANILMIR.
        */

        for (
          const socket
          of this.ctx.getWebSockets()
        ) {

          try {

            const socketUser =
              socket
                .deserializeAttachment()
                ?.username;

            if (!socketUser) continue;


            if (
              socketUser.toLowerCase() ===
                targetUser.username.toLowerCase()
              ||
              socketUser.toLowerCase() ===
                sender.toLowerCase()
            ) {

              socket.send(
                JSON.stringify({
                  type: "dm",
                  ...dm
                })
              );

            }

          } catch {
            // disconnected
          }
        }

        return;
      }

    } catch {

      try {

        ws.send(
          JSON.stringify({
            type: "error",
            error:
              "Mesaj göndərilərkən xəta baş verdi."
          })
        );

      } catch {}

    }
  }


  /*
  ==========================
  ÇATDAN ÇIXDI
  ==========================
  */

  webSocketClose(ws) {

    const attachment =
      ws.deserializeAttachment();

    const name =
      attachment?.username;

    if (!name) return;


    this.broadcast({
      type: "system",
      text:
        "@" + name + " çatdan ayrıldı."
    });


    this.broadcastUsers();
  }


  /*
  ==========================
  ONLINE USERS
  ==========================
  */

  getOnlineUsers() {

    const users = [];


    for (
      const ws
      of this.ctx.getWebSockets()
    ) {

      try {

        const name =
          ws
            .deserializeAttachment()
            ?.username;

        if (!name) continue;


        if (
          !users.some(
            x =>
              x.toLowerCase() ===
              name.toLowerCase()
          )
        ) {

          users.push(name);
        }

      } catch {}

    }


    return users.sort(
      (a, b) =>
        a.toLowerCase()
          .localeCompare(
            b.toLowerCase()
          )
    );
  }


  /*
  ==========================
  BROADCAST
  ==========================
  */

  broadcast(data, except = null) {

    const message =
      JSON.stringify(data);


    for (
      const ws
      of this.ctx.getWebSockets()
    ) {

      if (ws === except) {
        continue;
      }


      try {

        ws.send(message);

      } catch {}

    }
  }


  /*
  ==========================
  USER LIST
  ==========================
  */

  broadcastUsers() {

    this.broadcast({
      type: "users",
      users: this.getOnlineUsers()
    });

  }

  }
