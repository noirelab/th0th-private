/**
 * Analytics Query Service
 *
 * Service para consultas de analytics e métricas usando Prisma.
 */

import { getPrismaClient } from "./prisma-client.js";

export class AnalyticsQueryService {
  private prisma = getPrismaClient();

  constructor() {
    // Prisma client singleton configurado com adapter
  }

  async getSummary() {
    const [
      totalQueries,
      totalCacheHits,
      avgDuration,
      last24Hours,
    ] = await Promise.all([
      this.prisma.searchQuery.count(),
      this.prisma.searchQuery.count({ where: { cacheHit: true } }),
      this.prisma.searchQuery.aggregate({
        _avg: { duration: true },
      }),
      this.prisma.searchQuery.count({
        where: {
          timestamp: {
            gt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    const cacheHitRate = totalQueries > 0 
      ? (totalCacheHits / totalQueries) * 100 
      : 0;

    return {
      totalQueries,
      cacheHitRate: Math.round(cacheHitRate * 100) / 100,
      avgDuration: Math.round(avgDuration._avg.duration || 0),
      last24Hours,
    };
  }

  async getRecentSearches(limit: number = 50) {
    const searches = await this.prisma.searchQuery.findMany({
      orderBy: { timestamp: "desc" },
      take: limit,
    });

    return searches.map((s) => ({
      ...s,
      timestamp: s.timestamp.toISOString(),
    }));
  }

  async getCachePerformance(projectId?: string) {
    const where: any = {};
    if (projectId) {
      where.projectId = projectId;
    }

    const cacheStats = await this.prisma.cacheStats.findMany({
      where,
      orderBy: { hitCount: "desc" },
      take: 20,
    });

    const totalHits = cacheStats.reduce((sum, stat) => sum + stat.hitCount, 0);

    return {
      entries: cacheStats.map((stat) => ({
        projectId: stat.projectId,
        queryHash: stat.queryHash,
        hitCount: stat.hitCount,
        createdAt: stat.createdAt.toISOString(),
        lastHitAt: stat.lastHitAt.toISOString(),
      })),
      totalHits,
      totalEntries: cacheStats.length,
    };
  }

  async getProjectAnalytics(projectId: string, limit: number = 10) {
    const [queries, cacheStats] = await Promise.all([
      this.prisma.searchQuery.findMany({
        where: { projectId },
        orderBy: { timestamp: "desc" },
        take: limit,
      }),
      this.prisma.cacheStats.findMany({
        where: { projectId },
        orderBy: { hitCount: "desc" },
        take: 10,
      }),
    ]);

    const totalQueries = await this.prisma.searchQuery.count({
      where: { projectId },
    });

    const cacheHits = await this.prisma.searchQuery.count({
      where: { projectId, cacheHit: true },
    });

    return {
      projectId,
      totalQueries,
      cacheHitRate: totalQueries > 0 
        ? Math.round((cacheHits / totalQueries) * 10000) / 100
        : 0,
      recentQueries: queries.map((q) => ({
        query: q.query,
        resultsCount: q.resultsCount,
        duration: q.duration,
        cacheHit: q.cacheHit,
        timestamp: q.timestamp.toISOString(),
      })),
      topCachedQueries: cacheStats.map((s) => ({
        queryHash: s.queryHash,
        hitCount: s.hitCount,
      })),
    };
  }

  async disconnect() {
    await this.prisma.$disconnect();
  }
}
