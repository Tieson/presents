// Vercel serverless entry. vercel.json rewrites every /api/* request here.
import { getApp } from "../src/config.js";
import { apiPath } from "../src/app.js";

async function handler(request) {
  return getApp()(request, apiPath(request.url));
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
