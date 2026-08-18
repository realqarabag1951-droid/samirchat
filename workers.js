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
          env.CH
