import { DurableObject } from "cloudflare:workers";

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const CODE_RE = /^\d{4,6}$/;
const MAX_MESSAGE_LENGTH = 500;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // WebSocket
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket required", {
          status: 426
        });
      }

      const room = env.CHAT_ROOM.getByName("main");
      return room.fetch(request);
    }

    // Register
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
          return Response.json({
            ok: false,
            error:
              "Username 3-20 simvol olmalıdır."
          }, { status: 400 });
        }

        if (!CODE_RE.test(code)) {
          return Response.json({
            ok: false,
            error:
              "Kod 4-6 rəqəm olmalıdır."
          }, { status: 400 });
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
        return Response.json({
          ok: false,
          error: "Yanlış sorğu."
        }, { status: 400 });
      }
    }

    // Login
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
          return Response.json({
            ok: false,
            error: "Username yanlışdır."
          }, { status: 400 });
        }

        if (!CODE_RE.test(code)) {
          return Response.json({
            ok: false,
            error: "Kod yanlışdır."
          }, { status: 400 });
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
        return Response.json({
          ok: false,
          error: "Yanlış sorğu."
        }, { status: 400 });
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

    const url =
      new URL(request.url);


    // REGISTER

    if (
      url.pathname === "/register" &&
      request.method === "POST"
    ) {

      const body =
        await request.json();

      const username =
        String(body.username || "").trim();

      const code =
        String(body.code || "").trim();

      const key =
        "user:" +
        username.toLowerCase();


      const existing =
        await this.ctx.storage.get(key);


      if (existing) {

        return Response.json({
          ok: false,
          error:
            "Bu username artıq istifadə olunur."
        }, { status: 409 });

      }


      await this.ctx.storage.put(
        key,
        {
          username,
          code,
          createdAt: Date.now()
        }
      );


      return Response.json({
        ok: true,
        username
      });
    }


    // LOGIN

    if (
      url.pathname === "/login" &&
      request.method === "POST"
    ) {

      const body =
        await request.json();

      const username =
        String(body.username || "").trim();

      const code =
        String(body.code || "").trim();


      const key =
        "user:" +
        username.toLowerCase();


      const user =
        await this.ctx.storage.get(key);


      if (!user) {

        return Response.json({
          ok: false,
          error:
            "Belə username mövcud deyil."
        }, { status: 404 });

      }


      if (user.code !== code) {

        return Response.json({
          ok: false,
          error:
            "Kod yanlışdır."
        }, { status: 401 });

      }


      return Response.json({
        ok: true,
        username: user.username
      });
    }


    // WEBSOCKET

    if (
      request.headers.get("Upgrade")
      !== "websocket"
    ) {

      return new Response(
        "SamirChat server işləyir.",
        { status: 200 }
      );
    }


    const username =
      new URL(request.url)
        .searchParams
        .get("username");


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
          `${username} çata qoşuldu.`
      },
      server
    );


    this.broadcastUsers();


    return new Response(
      null,
      {
        status: 101,
        webSocket
