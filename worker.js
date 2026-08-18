import { DurableObject } from "cloudflare:workers";

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const MAX_MESSAGE = 500;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // WebSocket
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket required", { status: 426 });
      }

      const room = env.CHAT_ROOM.getByName("main");
      return room.fetch(request);
    }

    // Username registration
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

    /*
     * USERNAME REGISTER
     */
    if (
      url.pathname === "/register" &&
      request.method === "POST"
    ) {
      const body = await request.json();
      const username = String(body.username || "").trim();

      if (!USERNAME_RE.test(username)) {
        return Response.json(
          {
            ok: false,
            error: "Username düzgün deyil."
          },
          { status: 400 }
        );
      }

      const key =
        "user:" + username.toLowerCase();

      const oldUser =
        await this.ctx.storage.get(key);

      // Username artıq varsa, yenidən istifadə et
      if (oldUser) {
        return Response.json({
          ok: true,
          username: oldUser.username
        });
      }

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
    }


    /*
     * GET DM HISTORY
     *
     * /dm-history?user1=samir&user2=ali
     */
    if (
      url.pathname === "/dm-history" &&
      request.method === "GET"
    ) {
      const user1 =
        String(
          url.searchParams.get("user1") || ""
        ).trim();

      const user2 =
        String(
          url.searchParams.get("user2") || ""
        ).trim();

      if (!user1 || !user2) {
        return Response.json(
          {
            ok: false,
            error: "Users required."
          },
          { status: 400 }
        );
      }

      const messages =
        await this.getDMHistory(
          user1,
          user2
        );

      return Response.json({
        ok: true,
        messages
      });
    }


    /*
     * WEBSOCKET
     */
    if (
      request.headers.get("Upgrade") !==
      "websocket"
    ) {
      return new Response(
        "SamirChat server işləyir."
      );
    }

    const username =
      url.searchParams.get("username");

    if (!username) {
      return new Response(
        "Username required",
        { status: 400 }
      );
    }

    if (!USERNAME_RE.test(username)) {
      return new Response(
        "Invalid username",
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

    /*
     * Online users
     */
    server.send(
      JSON.stringify({
        type: "welcome",
        username,
        users: this.getUsers()
      })
    );

    /*
     * User joined
     */
    this.broadcast(
      {
        type: "system",
        text:
          "@" +
          username +
          " çata qoşuldu."
      },
      server
    );

    this.broadcastUsers();

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }


  /*
   * WEBSOCKET MESSAGE
   */
  webSocketMessage(ws, message) {
    try {

      const data =
        JSON.parse(message);

      const attachment =
        ws.deserializeAttachment();

      const username =
        attachment &&
        attachment.username;

      if (!username) {
        return;
      }


      /*
       * GENERAL CHAT
       */
      if (data.type === "message") {

        const text =
          String(data.text || "").trim();

        if (!text) {
          return;
        }

        if (text.length > MAX_MESSAGE) {
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
      if (data.type === "dm") {

        this.handleDM(
          ws,
          username,
          data.to,
          data.text
        );

        return;
      }


      /*
       * DM HISTORY REQUEST
       */
      if (data.type === "dm_history") {

        this.sendDMHistory(
          ws,
          username,
          data.with
        );

        return;
      }

    } catch {
      return;
    }
  }


  /*
   * SEND DM
   */
  async handleDM(
    ws,
    username,
    rawTo,
    rawText
  ) {

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
      username.toLowerCase() ===
      to.toLowerCase()
    ) {
      return;
    }


    /*
     * DM object
     */
    const dm = {
      from: username,
      to: to,
      text: text,
      time: Date.now()
    };


    /*
     * YADDA SAXLA
     */
    await this.saveDM(dm);


    /*
     * Qarşı tərəfə göndər
     */
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
            text,
            time: dm.time
          })
        );

        delivered = true;
      }
    }


    /*
     * Göndərənə də göstər
     */
    ws.send(
      JSON.stringify({
        type: "dm",
        from: username,
        to,
        text,
        time: dm.time
      })
    );


    /*
     * Qarşı tərəf offline-dırsa
     */
    if (!delivered) {

      ws.send(
        JSON.stringify({
          type: "system",
          text:
            "@" +
            to +
            " hazırda online deyil. Mesaj yadda saxlanıldı."
        })
      );

    }
  }


  /*
   * SAVE DM
   */
  async saveDM(dm) {

    const users =
      [
        dm.from.toLowerCase(),
        dm.to.toLowerCase()
      ].sort();

    const conversationKey =
      "dm:" +
      users[0] +
      ":" +
      users[1];

    const oldMessages =
      await this.ctx.storage.get(
        conversationKey
      ) || [];

    oldMessages.push(dm);

    /*
     * Son 500 mesajı saxlayırıq.
     */
    const messages =
      oldMessages.slice(-500);

    await this.ctx.storage.put(
      conversationKey,
      messages
    );
  }


  /*
   * GET DM HISTORY
   */
  async getDMHistory(
    user1,
    user2
  ) {

    const users =
      [
        user1.toLowerCase(),
        user2.toLowerCase()
      ].sort();

    const key =
      "dm:" +
      users[0] +
      ":" +
      users[1];

    return (
      await this.ctx.storage.get(key)
    ) || [];
  }


  /*
   * SEND DM HISTORY THROUGH WEBSOCKET
   */
  async sendDMHistory(
    ws,
    username,
    otherUser
  ) {

    if (!otherUser) {
      return;
    }

    const messages =
      await this.getDMHistory(
        username,
        String(otherUser)
      );

    ws.send(
      JSON.stringify({
        type: "dm_history",
        with: otherUser,
        messages
      })
    );
  }


  /*
   * USER DISCONNECTED
   */
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


  /*
   * ONLINE USERS
   */
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


  /*
   * BROADCAST
   */
  broadcast(
    data,
    except
  ) {

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
      } catch {
        continue;
      }
    }
  }


  /*
   * UPDATE ONLINE USERS
   */
  broadcastUsers() {

    this.broadcast({
      type: "users",
      users: this.getUsers()
    });
  }

    }
