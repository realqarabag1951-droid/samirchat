import { DurableObject } from "cloudflare:workers";

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const MAX_MESSAGE_LENGTH = 500;

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
              error:
                "Username 3-20 simvol olmalıdır. Yalnız hərf, rəqəm və _ istifadə et."
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
              body: JSON.stringify({
                username
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
      try {
        const body = await
