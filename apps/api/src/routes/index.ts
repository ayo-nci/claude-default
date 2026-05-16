import { Hono } from "hono";

export const router = new Hono();

router.get("/health", (c) => c.json({ status: "ok" }));
