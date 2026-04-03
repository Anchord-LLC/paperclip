import { and, desc, eq, inArray, not, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, approvals, heartbeatRuns } from "@paperclipai/db";
import type { SidebarBadges } from "@paperclipai/shared";

const ACTIONABLE_APPROVAL_STATUSES = ["pending", "revision_requested"];
const FAILED_HEARTBEAT_STATUSES = ["failed", "timed_out"];
const SIDEBAR_BADGES_CACHE_TTL_MS = 10_000;
const sidebarBadgesCache = new Map<string, { expiresAt: number; value: SidebarBadges }>();

export function sidebarBadgeService(db: Db) {
  return {
    get: async (
      companyId: string,
      extra?: { joinRequests?: number; unreadTouchedIssues?: number },
    ): Promise<SidebarBadges> => {
      const nowMs = Date.now();
      const cacheKey = `${companyId}:${extra?.joinRequests ?? 0}:${extra?.unreadTouchedIssues ?? 0}`;
      const cached = sidebarBadgesCache.get(cacheKey);
      if (cached && cached.expiresAt > nowMs) return cached.value;
      const actionableApprovals = await db
        .select({ count: sql<number>`count(*)` })
        .from(approvals)
        .where(
          and(
            eq(approvals.companyId, companyId),
            inArray(approvals.status, ACTIONABLE_APPROVAL_STATUSES),
          ),
        )
        .then((rows) => Number(rows[0]?.count ?? 0));

      const latestRunByAgent = await db
        .selectDistinctOn([heartbeatRuns.agentId], {
          runStatus: heartbeatRuns.status,
        })
        .from(heartbeatRuns)
        .innerJoin(agents, eq(heartbeatRuns.agentId, agents.id))
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            eq(agents.companyId, companyId),
            not(eq(agents.status, "terminated")),
          ),
        )
        .orderBy(heartbeatRuns.agentId, desc(heartbeatRuns.createdAt));

      const failedRuns = latestRunByAgent.filter((row) =>
        FAILED_HEARTBEAT_STATUSES.includes(row.runStatus),
      ).length;

      const joinRequests = extra?.joinRequests ?? 0;
      const unreadTouchedIssues = extra?.unreadTouchedIssues ?? 0;
      const badges: SidebarBadges = {
        inbox: actionableApprovals + failedRuns + joinRequests + unreadTouchedIssues,
        approvals: actionableApprovals,
        failedRuns,
        joinRequests,
      };
      sidebarBadgesCache.set(cacheKey, { expiresAt: nowMs + SIDEBAR_BADGES_CACHE_TTL_MS, value: badges });
      return badges;
    },
  };
}
