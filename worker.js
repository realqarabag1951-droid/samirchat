import { DurableObject } from "cloudflare:workers";

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const CODE_RE = /^[A-Za-z0-9]{4,10}$/;
const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY = 200;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}

function cleanUsername(value) {
  return String(value || "").trim();
}

function cleanCode(value) {
  return String(value || "").trim();
}

function userKey(username) {
  return "user:" + username.toLowerCase();
}

function sessionKey(token) {
  return "session:" + token;
}

function dmKey(a, b) {
  const users = [
    a.toLowerCase(),
    b.toLowerCase()
  ].sort();

  return "dm:" + users[0] + ":" + users[1];
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
  return (
    crypto.randomUUID() +
    "-" +
    crypto.randomUUID()
  );
}

async function getSession(ctx, token) {
  if (!token) {
    return null;
  }

  return await ctx.storage.get(
    sessionKey(token)
  );
}

export default {

  async fetch(request, env) {

    const url = new URL(request.url);


    /* =========================
       REGISTER
    ========================= */

    if (
      url.pathname === "/api/register" &&
      request.method === "POST"
    ) {

      try {

        const body = await request.json();

        const username =
          cleanUsername(body.username);

        const code =
          cleanCode(body.code);


        if (!USERNAME_RE.test(username)) {

          return json({
            ok: false,
            error:
              "Username 3-20 simvol olmalıdır."
          }, 400);
        }


        if (!CODE_RE.test(code)) {

          return json({
            ok: false,
            error:
              "Kod 4-10 simvol olmalıdır."
          }, 400);
        }


        const room =
          env.CHAT_ROOM.getByName("main");


        return await room.fetch(
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

      } catch (error) {

        return json({
          ok: false,
          error:
            "Hesab yaradılarkən server xətası baş verdi."
        }, 500);
      }
    }


    /* =========================
       LOGIN
    ========================= */

    if (
      url.pathname === "/api/login" &&
      request.method === "POST"
    ) {

      try {

        const body = await request.json();

        const username =
          cleanUsername(body.username);

        const code =
          cleanCode(body.code);


        if (!USERNAME_RE.test(username)) {

          return json({
            ok: false,
            error:
              "Username düzgün deyil."
          }, 400);
        }


        if (!CODE_RE.test(code)) {

          return json({
            ok: false,
            error:
              "Kod 4-10 simvol olmalıdır."
          }, 400);
        }


        const room =
          env.CHAT_ROOM.getByName("main");


        return await room.fetch(
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

      } catch (error) {

        return json({
          ok: false,
          error:
            "Giriş zamanı server xətası baş verdi."
        }, 500);
      }
    }


    /* =========================
       DM HISTORY
    ========================= */

    if (
      url.pathname === "/api/dm" &&
      request.method === "GET"
    ) {

      const authorization =
        request.headers.get(
          "Authorization"
        );


      if (
        !authorization ||
        !authorization.startsWith("Bearer ")
      ) {

        return json({
          ok: false,
          error:
            "Giriş tələb olunur."
        }, 401);
      }


      const token =
        authorization.substring(7);


      const other =
        cleanUsername(
          url.searchParams.get("with")
        );


      if (!USERNAME_RE.test(other)) {

        return json({
          ok: false,
          error:
            "Username düzgün deyil."
        }, 400);
      }


      const room =
        env.CHAT_ROOM.getByName("main");


      return await room.fetch(
        new Request(
          new URL(
            "/dm-history",
            request.url
          ),
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body: JSON.stringify({
              token,
              other
            })
          }
        )
      );
    }


    /* =========================
       WEBSOCKET
    ========================= */

    if (url.pathname === "/ws") {

      const upgrade =
        request.headers.get("Upgrade");


      if (
        !upgrade ||
        upgrade.toLowerCase() !== "websocket"
      ) {

        return new Response(
          "WebSocket required",
          {
            status: 426
          }
        );
      }


      const room =
        env.CHAT_ROOM.getByName("main");


      return await room.fetch(request);
    }


    /* =========================
       WEBSITE
    ========================= */

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }


    return new Response(
      "SamirChat Worker işləyir.",
      {
        status: 200,
        headers: {
          "Content-Type":
            "text/plain; charset=UTF-8"
        }
      }
    );
  }
};


/* =====================================================
   DURABLE OBJECT
===================================================== */

export class ChatRoom extends DurableObject {

  constructor(ctx, env) {

    super(ctx, env);

    this.ctx = ctx;
    this.env = env;
  }


  /* =========================
     INTERNAL FETCH
  ========================= */

  async fetch(request) {

    const url =
      new URL(request.url);


    /* =========================
       REGISTER
    ========================= */

    if (
      url.pathname === "/register" &&
      request.method === "POST"
    ) {

      try {

        const body =
          await request.json();


        const username =
          cleanUsername(
            body.username
          );


        const code =
          cleanCode(
            body.code
          );


        const key =
          userKey(username);


        const existing =
          await this.ctx.storage.get(
            key
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
          key,
          {
            username,
            codeHash,
            createdAt:
              Date.now()
          }
        );


        const token =
          createToken();


        await this.ctx.storage.put(
          sessionKey(token),
          {
            username,
            createdAt:
              Date.now()
          }
        );


        return json({
          ok: true,
          username,
          token
        });


      } catch (error) {

        return json({
          ok: false,
          error:
            "Hesab yaratmaq mümkün olmadı."
        }, 500);
      }
    }


    /* =========================
       LOGIN
    ========================= */

    if (
      url.pathname === "/login" &&
      request.method === "POST"
    ) {

      try {

        const body =
          await request.json();


        const username =
          cleanUsername(
            body.username
          );


        const code =
          cleanCode(
            body.code
          );


        const user =
          await this.ctx.storage.get(
            userKey(username)
          );


        if (!user) {

          return json({
            ok: false,
            error:
              "Bu username ilə hesab tapılmadı."
          }, 404);
        }


        const enteredHash =
          await hashCode(code);


        if (
          enteredHash !==
          user.codeHash
        ) {

          return json({
            ok: false,
            error:
              "Kod səhvdir."
          }, 401);
        }


        const token =
          createToken();


        await this.ctx.storage.put(
          sessionKey(token),
          {
            username:
              user.username,
            createdAt:
              Date.now()
          }
        );


        return json({
          ok: true,
          username:
            user.username,
          token
        });


      } catch (error) {

        return json({
          ok: false,
          error:
            "Giriş mümkün olmadı."
        }, 500);
      }
    }


    /* =========================
       DM HISTORY
    ========================= */

    if (
      url.pathname === "/dm-history" &&
      request.method === "POST"
    ) {

      try {

        const body =
          await request.json();


        const session =
          await getSession(
            this.ctx,
            body.token
          );


        if (!session) {

          return json({
            ok: false,
            error:
              "Sessiya etibarsızdır."
          }, 401);
        }


        const other =
          cleanUsername(
            body.other
          );


        const key =
          dmKey(
            session.username,
            other
          );


        const history =
          await this.ctx.storage.get(
            key
          );


        return json({
          ok: true,

          messages:
            Array.isArray(history)
              ? history
              : []
        });


      } catch (error) {

        return json({
          ok: false,
          error:
            "Mesajlar yüklənmədi."
        }, 500);
      }
    }


    /* =========================
       WEBSOCKET
    ========================= */

    const upgrade =
      request.headers.get("Upgrade");


    if (
      !upgrade ||
      upgrade.toLowerCase() !== "websocket"
    ) {

      return new Response(
        "SamirChat Worker işləyir."
      );
    }


    const token =
      url.searchParams.get(
        "token"
      );


    const session =
      await getSession(
        this.ctx,
        token
      );


    if (!session) {

      return new Response(
        "Invalid session",
        {
          status: 401
        }
      );
    }


    const username =
      session.username;


    const pair =
      new WebSocketPair();


    const client =
      pair[0];


    const server =
      pair[1];


    this.ctx.acceptWebSocket(
      server
    );


    server.serializeAttachment({
      username,
      token
    });


    server.send(
      JSON.stringify({
        type: "welcome",
        username,
        users:
          this.getOnlineUsers()
      })
    );


    this.broadcastUsers();


    return new Response(
      null,
      {
        status: 101,
        webSocket: client
      }
    );
  }


  /* =========================
     MESSAGE
  ========================= */

  async webSocketMessage(
    ws,
    message
  ) {

    try {

      const data =
        JSON.parse(message);


      const attachment =
        ws.deserializeAttachment();


      if (!attachment) {
        return;
      }


      const from =
        attachment.username;


      /* =========================
         GENERAL CHAT
      ========================= */

      if (
        data.type === "message"
      ) {

        const text =
          String(
            data.text || ""
          ).trim();


        if (
          !text ||
          text.length >
            MAX_MESSAGE_LENGTH
        ) {
          return;
        }


        this.broadcast({
          type: "message",
          username: from,
          text,
          time: Date.now()
        });


        return;
      }


      /* =========================
         DM
      ========================= */

      if (
        data.type === "dm"
      ) {

        const to =
          cleanUsername(
            data.to
          );


        const text =
          String(
            data.text || ""
          ).trim();


        if (
          !USERNAME_RE.test(to)
        ) {
          return;
        }


        if (
          !text ||
          text.length >
            MAX_MESSAGE_LENGTH
        ) {
          return;
        }


        const target =
          await this.ctx.storage.get(
            userKey(to)
          );


        if (!target) {

          ws.send(
            JSON.stringify({
              type: "error",
              error:
                "Bu username tapılmadı."
            })
          );

          return;
        }


        const messageObject = {

          id:
            crypto.randomUUID(),

          from,

          to:
            target.username,

          text,

          time:
            Date.now()
        };


        /* SAVE DM */

        const key =
          dmKey(
            from,
            target.username
          );


        let history =
          await this.ctx.storage.get(
            key
          );


        if (
          !Array.isArray(history)
        ) {
          history = [];
        }


        history.push(
          messageObject
        );


        if (
          history.length >
          MAX_HISTORY
        ) {

          history =
            history.slice(
              -MAX_HISTORY
            );
        }


        await this.ctx.storage.put(
          key,
          history
        );


        /* SEND TO BOTH */

        for (
          const socket
          of this.ctx.getWebSockets()
        ) {

          try {

            const socketData =
              socket.deserializeAttachment();


            const socketUser =
              socketData?.username;


            if (!socketUser) {
              continue;
            }


            if (
              socketUser.toLowerCase() ===
                from.toLowerCase() ||

              socketUser.toLowerCase() ===
                target.username.toLowerCase()
            ) {

              socket.send(
                JSON.stringify({
                  type: "dm",
                  ...messageObject
                })
              );
            }

          } catch (error) {
            // disconnected socket
          }
        }


        return;
      }

    } catch (error) {

      try {

        ws.send(
          JSON.stringify({
            type: "error",
            error:
              "Mesaj göndərmək mümkün olmadı."
          })
        );

      } catch (e) {}
    }
  }


  /* =========================
     SOCKET CLOSE
  ========================= */

  async webSocketClose(ws) {
    this.broadcastUsers();
  }


  /* =========================
     ONLINE USERS
  ========================= */

  getOnlineUsers() {

    const users = [];


    for (
      const ws
      of this.ctx.getWebSockets()
    ) {

      try {

        const data =
          ws.deserializeAttachment();


        const name =
          data?.username;


        if (
          name &&
          !users.some(
            x =>
              x.toLowerCase() ===
              name.toLowerCase()
          )
        ) {

          users.push(name);
        }

      } catch (error) {}
    }


    return users.sort(
      (a, b) =>
        a.toLowerCase()
          .localeCompare(
            b.toLowerCase()
          )
    );
  }


  /* =========================
     BROADCAST
  ========================= */

  broadcast(data) {

    const message =
      JSON.stringify(data);


    for (
      const ws
      of this.ctx.getWebSockets()
    ) {

      try {
        ws.send(message);
      } catch (error) {}
    }
  }


  broadcastUsers() {

    this.broadcast({
      type: "users",
      users:
        this.getOnlineUsers()
    });
  }
}
