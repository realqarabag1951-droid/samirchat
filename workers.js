import { DurableObject } from "cloudflare:workers";

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const MAX_MESSAGE_LENGTH = 500;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /*
     * USERNAME REGISTER
     * POST /api/register
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

        if (!USERNAME_RE.test(username)) {
          return Response.json(
            {
              ok: false,
              error:
                "Username 3-20 simvol olmalıdır. Yalnız hərf, rəqəm və _ istifadə edə bilərsən."
            },
            {
              status: 400
            }
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
                username
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
          {
            status: 400
          }
        );
      }
    }


    /*
     * WEBSOCKET CHAT
     * /ws?username=samir
     */
    if (url.pathname === "/ws") {

      if (
        request.headers.get("Upgrade")
          ?.toLowerCase() !== "websocket"
      ) {
        return new Response(
          "WebSocket required",
          {
            status: 426
          }
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
          {
            status: 400
          }
        );
      }

      const room =
        env.CHAT_ROOM.getByName("main");

      return room.fetch(request);
    }


    /*
     * EVERYTHING ELSE
     * Serve index.html / static assets
     */
    return env.ASSETS.fetch(request);
  }
};


/*
 * DURABLE OBJECT
 *
 * Burada bütün online istifadəçilər
 * və WebSocket bağlantıları idarə olunur.
 */
export class ChatRoom extends DurableObject {

  constructor(ctx, env) {
    super(ctx, env);

    this.ctx = ctx;
    this.env = env;
  }


  /*
   * REGISTER USERNAME
   *
   * Username bir dəfə qeydiyyatdan
   * keçdikdən sonra başqa istifadəçi
   * onu götürə bilməz.
   */
  async fetch(request) {

    const url =
      new URL(request.url);


    /*
     * USERNAME REGISTER
     */
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


        if (
          !USERNAME_RE.test(username)
        ) {

          return Response.json(
            {
              ok: false,
              error:
                "Username düzgün deyil."
            },
            {
              status: 400
            }
          );

        }


        /*
         * Username-ləri lowercase
         * formada yoxlayırıq.
         *
         * Beləliklə:
         * Samir
         * samir
         * SAMIR
         *
         * eyni username sayılır.
         */
        const key =
          `user:${username.toLowerCase()}`;


        const existing =
          await this.ctx.storage.get(
            key
          );


        /*
         * Artıq istifadə olunubsa
         */
        if (existing) {

          return Response.json(
            {
              ok: false,
              error:
                "Bu username artıq istifadə olunur."
            },
            {
              status: 409
            }
          );

        }


        /*
         * Username-i yadda saxla
         */
        await this.ctx.storage.put(
          key,
          {
            username,
            createdAt: Date.now()
          }
        );


        return Response.json({
          ok: true,
          username
        });

      } catch (error) {

        return Response.json(
          {
            ok: false,
            error:
              "Username qeydiyyatı zamanı xəta baş verdi."
          },
          {
            status: 400
          }
        );

      }
    }


    /*
     * WEBSOCKET
     */
    if (
      request.headers.get("Upgrade")
        ?.toLowerCase() !== "websocket"
    ) {

      return new Response(
        "SamirChat server işləyir.",
        {
          status: 200
        }
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
        {
          status: 400
        }
      );

    }


    /*
     * WebSocketPair yaradırıq
     */
    const pair =
      new WebSocketPair();


    const client =
      pair[0];

    const server =
      pair[1];


    /*
     * Hibernation WebSocket
     */
    this.ctx.acceptWebSocket(
      server,
      [username]
    );


    /*
     * WebSocket-ə username bağlayırıq
     */
    server.serializeAttachment({
      username
    });


    /*
     * Hazırda online olan istifadəçilər
     */
    const users =
      this.getOnlineUsers();


    /*
     * Yeni istifadəçiyə
     * online siyahısını göndər
     */
    server.send(
      JSON.stringify({
        type: "welcome",
        username,
        users
      })
    );


    /*
     * Digər istifadəçilərə
     * yeni istifadəçinin gəldiyini bildir
     */
    this.broadcast(
      {
        type: "system",
        text:
          `@${username} çata qoşuldu.`
      },
      server
    );


    /*
     * Hamıya yeni online siyahını göndər
     */
    this.broadcastUsers();


    /*
     * WebSocket-i browserə qaytar
     */
    return new Response(
      null,
      {
        status: 101,
        webSocket: client
      }
    );
  }


  /*
   * MESAJ GƏLƏNDƏ
   */
  webSocketMessage(
    ws,
    message
  ) {

    try {

      const data =
        JSON.parse(message);


      /*
       * Yalnız message qəbul edirik
       */
      if (
        data.type !== "message"
      ) {
        return;
      }


      /*
       * Mesajı təmizlə
       */
      const text =
        String(
          data.text || ""
        ).trim();


      /*
       * Boş mesaj
       */
      if (!text) {
        return;
      }


      /*
       * 500 simvoldan çox olmasın
       */
      if (
        text.length >
        MAX_MESSAGE_LENGTH
      ) {
        return;
      }


      /*
       * Username-i WebSocket-dən götür
       */
      const attachment =
        ws.deserializeAttachment();


      const username =
        attachment?.username;


      if (!username) {
        return;
      }


      /*
       * Mesajı bütün online
       * istifadəçilərə göndər
       */
      this.broadcast({
        type: "message",

        username,

        text,

        time: Date.now()
      });

    } catch (error) {

      /*
       * Səhv JSON gəlirsə
       * ignore et
       */

    }
  }


  /*
   * İSTİFADƏÇİ ÇIXANDA
   */
  webSocketClose(ws) {

    const attachment =
      ws.deserializeAttachment();


    const username =
      attachment?.username;


    if (!username) {
      return;
    }


    /*
     * Digər istifadəçilərə bildir
     */
    this.broadcast({
      type: "system",
      text:
        `@${username} çatdan ayrıldı.`
    });


    /*
     * Online siyahısını yenilə
     */
    this.broadcastUsers();
  }


  /*
   * ONLINE USERS
   */
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


    /*
     * Eyni username-in iki
     * dəfə görünməsinin qarşısını al
     */
    return [
      ...new Set(users)
    ];
  }


  /*
   * MESAJI HAMİYA GÖNDƏR
   */
  broadcast(
    data,
    except = null
  ) {

    const message =
      JSON.stringify(data);


    const sockets =
      this.ctx.getWebSockets();


    for (
      const ws of sockets
    ) {

      if (ws === except) {
        continue;
      }


      try {

        ws.send(message);

      } catch (error) {

        /*
         * Bağlanmış socket-i
         * ignore et
         */

      }
    }
  }


  /*
   * ONLINE USER SİYAHISINI
   * HAMİYA GÖNDƏR
   */
  broadcastUsers() {

    this.broadcast({
      type: "users",
      users:
        this.getOnlineUsers()
    });

  }
        }
