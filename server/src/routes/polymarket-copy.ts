import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  patchPolymarketCopyRuntimeConfigSchema,
  polymarketCopyDashboardActionSchema,
} from "@paperclipai/shared/validators/polymarket-copy";
import { polymarketCopyService } from "../services/polymarket/service.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";

export function polymarketCopyRoutes(db: Db) {
  const router = Router();
  const service = polymarketCopyService(db);

  router.get("/companies/:companyId/polymarket-copy/dashboard", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await service.getDashboard(companyId));
  });

  router.get("/companies/:companyId/polymarket-copy/runtime-config", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await service.getRuntimeConfig(companyId));
  });

  router.patch("/companies/:companyId/polymarket-copy/runtime-config", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const patch = patchPolymarketCopyRuntimeConfigSchema.parse(req.body ?? {});
    res.json(await service.updateRuntimeConfig(companyId, patch, getActorInfo(req)));
  });

  router.post("/companies/:companyId/polymarket-copy/auth/check-readiness", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const body = polymarketCopyDashboardActionSchema.parse(req.body ?? {});
    res.json(await service.checkAuthReadiness(companyId, getActorInfo(req), body.reason ?? "manual"));
  });

  router.post("/companies/:companyId/polymarket-copy/auth/derive-api-credentials", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const body = polymarketCopyDashboardActionSchema.parse(req.body ?? {});
    res.json(await service.deriveApiCredentials(companyId, getActorInfo(req), body.reason ?? "manual"));
  });

  router.post("/companies/:companyId/polymarket-copy/paper-baseline/reset", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const body = polymarketCopyDashboardActionSchema.parse(req.body ?? {});
    res.json(await service.resetPaperBaseline(companyId, getActorInfo(req), body.reason ?? "manual"));
  });

  router.post("/companies/:companyId/polymarket-copy/runs/wallet-selector", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const body = polymarketCopyDashboardActionSchema.parse(req.body ?? {});
    res.json(await service.runWalletSelection(companyId, body.reason ?? "manual"));
  });

  router.post("/companies/:companyId/polymarket-copy/runs/monitor-5m", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const body = polymarketCopyDashboardActionSchema.parse(req.body ?? {});
    res.json(await service.runMonitor(companyId, "5m", body.reason ?? "manual"));
  });

  router.post("/companies/:companyId/polymarket-copy/runs/monitor-15m", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const body = polymarketCopyDashboardActionSchema.parse(req.body ?? {});
    res.json(await service.runMonitor(companyId, "15m", body.reason ?? "manual"));
  });

  return router;
}
