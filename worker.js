import { DurableObject } from "cloudflare:workers";

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const CODE_RE = /^[A-Za-z0-9]{4,10}$/;

const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY = 200;

const BAD_WORDS = [
  "sik",
  "sikiş",
  "sikim",
  "sikdir",
  "amcik",
  "amcıq",
  "qəhbə",
  "qehbe",
  "orospu",
  "puta",
  "fuck",
  "shit"
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function normalizeUsername(username) {
  return String(username || "").trim();
}

function userKey(username) {
  return `user:${username.toLowerCase()}`;
}

function sessionKey(token) {
  return `session:${token}`;
}

function dmKey(a, b) {
  const users = [
    a.toLowerCase(),
    b.toLowerCase()
  ].sort();

  return `dm:${users[0]}:${users[1]}`;
}

function containsBadWord(text) {
  const lower = String(text).toLowerCase();

  return BAD_WORDS.some(word => lower.includes(word));
}

async function hashCode(code) {
  const data = new TextEncoder().encode(code);

  const hash = await crypto.subtle.digest(
    "SHA-256",
    data
  );

  return Array.from(new Uint8Array(hash))
    .map(byte =>
      byte.toString(16).padStart(2, "0")
    )
    .join("");
}

function createToken() {
  return (
    crypto.randomUUID() +
    "-" +
    crypto.randomUUID()
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /*
     * =========================
     * REGISTER
     * =========================
     */

    if (
      url.pathname === "/api/register" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();

        const username =
          normalizeUsername(body.username);

        const code =
          String(body.code || "").trim();

        if (!USERNAME_RE.test(username)) {
          return json(
            {
              ok: false,
              error:
                "Username 3-20 simvol olmalıdır. Yalnız hərf, rəqəm və _ istifadə et."
            },
            400
          );
        }

        if (!CODE_RE.test(code)) {
          return json(
            {
              ok: false,
              error:
                "Kod 4-10 simvol olmalıdır və yalnız hərf və rəqəm istifadə edilə bilər."
            },
            400
          );
        }

        const room =
          env.CHAT_ROOM.getByName("main");

        return room.fetch(
          new Request(
            new URL(
              "/internal/register",
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
        return json(
          {
            ok: false,
            error: "Yanlış sorğu."
          },
          400
        );
      }
    }

    /*
     * =========================
     * LOGIN
     * =========================
     */

    if (
      url.pathname === "/api/login" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();

        const username =
          normalizeUsername(body.username);

        const code =
          String(body.code || "").trim();

        if (!USERNAME_RE.test(username)) {
          return json(
            {
              ok: false,
              error:
                "Username düzgün deyil."
            },
            400
          );
        }

        if (!CODE_RE.test(code)) {
          return json(
            {
              ok: false,
              error:
                "Kod 4-10 simvol olmalıdır."
            },
            400
          );
        }

        const room =
          env.CHAT_ROOM.getByName("main");

        return room.fetch(
          new Request(
            new URL(
              "/internal/login",
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
        return json(
          {
            ok: false,
            error:
              "Giriş zamanı xəta baş verdi."
          },
          400
        );
      }
    }

    /*
     * =========================
     * DM HISTORY
     * =========================
     */

    if (
      url.pathname === "/api/dm" &&
      request.method === "GET"
    ) {
      const auth =
        request.headers.get(
          "Authorization"
        );

      if (
        !auth ||
        !auth.startsWith("Bearer ")
      ) {
        return json(
          {
            ok: false,
            error:
              "Giriş tələb olunur."
          },
          401
        );
      }

      const token =
        auth.slice(7);

      const other =
        normalizeUsername(
          url.searchParams.get("with")
        );

      if (!other) {
        return json(
          {
            ok: false,
            error:
              "İstifadəçi göstərilməyib."
          },
          400
        );
      }

      const room =
        env.CHAT_ROOM.getByName("main");

      return room.fetch(
        new Request(
          new URL(
            "/internal/dm-history",
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

    /*
     * =========================
     * WEBSOCKET
     * =========================
     */

    if (url.pathname === "/ws") {
      if (
        request.headers
          .get("Upgrade")
          ?.toLowerCase() !==
        "websocket"
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
     * =========================
     * WEBSITE
     * =========================
     */

    return env.ASSETS.fetch(request);
  }
};


/*
 * ==========================================
 * CHAT ROOM
 * ==========================================
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
     * =========================
     * REGISTER
     * =========================
     */

    if (
      url.pathname === "/internal/register" &&
      request.method === "POST"
    ) {
      try {
        const body =
          await request.json();

        const username =
          normalizeUsername(
            body.username
          );

        const code =
          String(body.code || "").trim();

        const key =
          userKey(username);

        const existing =
          await this.ctx.storage.get(
            key
          );

        if (existing) {
          return json(
            {
              ok: false,
              error:
                "Bu username artıq istifadə olunur."
            },
            409
          );
        }

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

        const token =
          createToken();

        await this.ctx.storage.put(
          sessionKey(token),
          {
            username,
            createdAt: Date.now()
          }
        );

        return json({
          ok: true,
          username,
          token
        });

      } catch {
        return json(
          {
            ok: false,
            error:
              "Qeydiyyat zamanı xəta baş verdi."
          },
          500
        );
      }
    }

    /*
     * =========================
     * LOGIN
     * =========================
     */

    if (
      url.pathname === "/internal/login" &&
      request.method === "POST"
    ) {
      try {
        const body =
          await request.json();

        const username =
          normalizeUsername(
            body.username
          );

        const code =
          String(body.code || "").trim();

        const user =
          await this.ctx.storage.get(
            userKey(username)
          );

        if (!user) {
          return json(
            {
              ok: false,
              error:
                "Bu username mövcud deyil."
            },
            404
          );
        }

        const codeHash =
          await hashCode(code);

        if (
          codeHash !== user.codeHash
        ) {
          return json(
            {
              ok: false,
              error:
                "Kod səhvdir."
            },
            401
          );
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
          token
        });

      } catch {
        return json(
          {
            ok: false,
            error:
              "Giriş zamanı xəta baş verdi."
          },
          500
        );
      }
    }

    /*
     * =========================
     * DM HISTORY
     * =========================
     */

    if (
      url.pathname === "/internal/dm-history" &&
      request.method === "POST"
    ) {
      try {
        const body =
          await request.json();

        const session =
          await this.ctx.storage.get(
            sessionKey(body.token)
          );

        if (!session) {
          return json(
            {
              ok: false,
              error:
                "Sessiya etibarlı deyil."
            },
            401
          );
        }

        const other =
          normalizeUsername(
            body.other
          );

        const history =
          await this.ctx.storage.get(
            dmKey(
              session.username,
              other
            )
          ) || [];

        return json({
          ok: true,
          messages: history
        });

      } catch {
        return json(
          {
            ok: false,
            error:
              "Mesaj tarixçəsi alınmadı."
          },
          500
        );
      }
    }

    /*
     * =========================
     * WEBSOCKET
     * =========================
     */

    if (
      request.headers
        .get("Upgrade")
        ?.toLowerCase() !==
      "websocket"
    ) {
      return new Response(
        "SamirChat Worker işləyir.",
        { status: 200 }
      );
    }

    const token =
      url.searchParams.get(
        "token"
      );

    if (!token) {
      return new Response(
        "Token required",
        { status: 401 }
      );
    }

    const session =
      await this.ctx.storage.get(
        sessionKey(token)
      );

    if (!session) {
      return new Response(
        "Invalid session",
        { status: 401 }
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
      server,
      [username]
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

    this.broadcast(
      {
        type: "system",
        text:
          `@${username} çata qoşuldu.`
      },
      server
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

  /*
   * =========================
   * MESSAGE
   * =========================
   */

  async webSocketMessage(
    ws,
    message
  ) {
    try {
      const data =
        JSON.parse(message);

      const attachment =
        ws.deserializeAttachment();

      const username =
        attachment?.username;

      if (!username) {
        return;
      }

      /*
       * GENERAL CHAT
       */

      if (
        data.type === "message"
      ) {
        const text =
          String(data.text || "")
            .trim();

        if (
          !text ||
          text.length >
            MAX_MESSAGE_LENGTH
        ) {
          return;
        }

        if (
          containsBadWord(text)
        ) {
          ws.send(
            JSON.stringify({
              type: "error",
              error:
                "Zəhmət olmasa nalayiq sözlərdən istifadə etmə."
            })
          );

          return;
        }

        this.broadcast({
          type: "message",
          username,
          text,
          time: Date.now()
        });

        return;
      }

      /*
       * DIRECT MESSAGE
       */

      if (
        data.type === "dm"
      ) {
        const to =
          normalizeUsername(
            data.to
          );

        const text =
          String(data.text || "")
            .trim();

        if (
          !to ||
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

        if (
          containsBadWord(text)
        ) {
          ws.send(
            JSON.stringify({
              type: "error",
              error:
                "Zəhmət olmasa nalayiq sözlərdən istifadə etmə."
            })
          );

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
                "Belə username tapılmadı."
            })
          );

          return;
        }

        const messageObject = {
          id:
            crypto.randomUUID(),

          from:
            username,

          to:
            target.username,

          text,

          time:
            Date.now()
        };

        /*
         * SAVE
         */

        const key =
          dmKey(
            username,
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

        /*
         * SEND TO TARGET
         */

        let delivered =
          false;

        for (
          const socket
          of this.ctx.getWebSockets()
        ) {
          try {
            const socketUser =
              socket
                .deserializeAttachment()
                ?.username;

            if (
              socketUser &&
              socketUser.toLowerCase() ===
                target.username.toLowerCase()
            ) {
              socket.send(
                JSON.stringify({
                  type: "dm",
                  ...messageObject
                })
              );

              delivered =
                true;
            }

          } catch {
            // disconnected socket
          }
        }

        /*
         * SEND TO SENDER
         */

        ws.send(
          JSON.stringify({
            type: "dm",
            ...messageObject,
            delivered
          })
        );

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
      } catch {
        // ignore
      }
    }
  }

  /*
   * =========================
   * USER LEFT
   * =========================
   */

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

  /*
   * =========================
   * ONLINE USERS
   * =========================
   */

  getOnlineUsers() {
    const users = [];

    for (
      const ws
      of this.ctx.getWebSockets()
    ) {
      try {
        const username =
          ws
            .deserializeAttachment()
            ?.username;

        if (
          username &&
          !users.some(
            user =>
              user.toLowerCase() ===
              username.toLowerCase()
          )
        ) {
          users.push(username);
        }

      } catch {
        // ignore
      }
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
   * =========================
   * BROADCAST
   * =========================
   */

  broadcast(
    data,
    except = null
  ) {
    const message =
      JSON.stringify(data);

    for (
      const ws
      of this.ctx.getWebSockets()
    ) {
      if (
        ws === except
      ) {
        continue;
      }

      try {
        ws.send(message);
      } catch {
        // ignore
      }
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
