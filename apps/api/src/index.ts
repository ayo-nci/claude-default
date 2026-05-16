import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { router } from "./routes/index.js";

const app = new Hono();

app.route("/", router);

const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});
