import { Router } from "express";

type HealthDeps = {
  redisClient?: { ping: () => Promise<string> };
  isXeroReady: () => boolean;
};

export function createHealthRouter(deps: HealthDeps): Router {
  const router = Router();

  router.get("/livez", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  router.get("/readyz", async (_req, res) => {
    if (!deps.isXeroReady()) {
      res.status(503).json({ status: "unavailable", reason: "xero" });
      return;
    }

    if (deps.redisClient) {
      try {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 1000),
        );
        await Promise.race([deps.redisClient.ping(), timeout]);
      } catch {
        res.status(503).json({ status: "unavailable", reason: "redis" });
        return;
      }
    }

    res.status(200).json({ status: "ok" });
  });

  return router;
}
