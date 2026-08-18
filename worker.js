import { DurableObject } from "cloudflare:workers";

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const CODE_RE = /^[A-Za-z0-9]{4,10}$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}

function userKey(username) {
  return "user:" + username.toLowerCase();
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /*
     * HESAB YARAT
     */

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
          error: "Server xətası."
        }, 500);
      }
    }

    /*
     * HESABA DAXİL OL
     */

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
          error: "Server xətası."
        }, 500);
      }
    }

    /*
     * WEBSOCKET
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
     * SAYT
     */

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

    const url =
      new URL(request.url);

    /*
     * HESAB YARAT
     */

    if (
      url.pathname === "/register" &&
      request.method === "POST"
    ) {
      try {

        const body =
          await request.json();

        const username =
          String(body.username || "")
            .trim();

        const code =
          String(body.code || "")
            .trim();

        const key =
          userKey(username);

        const existing =
          await this.ctx.storage.get(key);

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

      } catch (error) {

        return json({
          ok: false,
          error:
            "Hesab yaradılarkən xəta baş verdi."
        }, 500);

      }
    }


    /*
     * LOGIN
     */

    if (
      url.pathname === "/login" &&
      request.method === "POST"
    ) {
      try {

        const body =
          await request.json();

        const username =
          String(body.username || "")
            .trim();

        const code =
          String(body.code || "")
            .trim();

        const user =
          await this.ctx.storage.get(
            userKey(username)
          );

        if (!user) {
          return json({
            ok: false,
            error:
              "Belə username ilə hesab tapılmadı."
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
          token
        });

      } catch (error) {

        return json({
          ok: false,
          error:
            "Hesaba daxil olarkən xəta baş verdi."
        }, 500);

      }
    }


    /*
     * WEBSOCKET
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

    if (!token) {
      return new Response(
        "Token yoxdur.",
        { status: 401 }
      );
    }

    const session =
      await this.ctx.storage.get(
        sessionKey(token)
      );

    if (!session) {
      return new Response(
        "Sessiya etibarsızdır.",
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

    this.ctx.acceptWebSocket(server);

    server.serializeAttachment({
      username
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

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }


  /*
   * MESAJ
   */

  async webSocketMessage(ws, message) {

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

      if (
        data.type !== "message"
      ) {
        return;
      }

      const text =
        String(data.text || "")
          .trim();

      if (!text) {
        return;
      }

      if (text.length > 500) {
        return;
      }

      this.broadcast({
        type: "message",
        username,
        text,
        time: Date.now()
      });

    } catch (error) {

      try {
        ws.send(
          JSON.stringify({
            type: "error",
            error:
              "Mesaj göndərilmədi."
          })
        );
      } catch {}

    }
  }


  /*
   * İSTİFADƏÇİ ÇIXDI
   */

  webSocketClose(ws) {

    this.broadcastUsers();

  }


  /*
   * AKTİV İSTİFADƏÇİLƏR
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
            x =>
              x.toLowerCase() ===
              username.toLowerCase()
          )
        ) {
          users.push(username);
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
   * HAMISINA GÖNDƏR
   */

  broadcast(data) {

    const message =
      JSON.stringify(data);

    for (
      const ws
      of this.ctx.getWebSockets()
    ) {

      try {
        ws.send(message);
      } catch {}

    }
  }


  /*
   * AKTİV İSTİFADƏÇİLƏRİ YENİLƏ
   */

  broadcastUsers() {

    this.broadcast({
      type: "users",
      users:
        this.getOnlineUsers()
    });

  }
          }
