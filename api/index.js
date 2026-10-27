// Vercel serverless entry. vercel.json rewrites every /api/* request here.
import { getApp } from "../server/config.js";
import { apiPath } from "../server/app.js";

async function handler(request) {
  let app;
  try {
    app = getApp();
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "not_configured", message: err.message }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }
  return app(request, apiPath(request.url));
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
