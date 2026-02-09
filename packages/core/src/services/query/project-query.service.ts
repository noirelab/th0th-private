/**
 * Project Query Service
 *
 * Service para consultas em projetos indexados usando Prisma.
 */

import { getPrismaClient } from "./prisma-client.js";

export class ProjectQueryService {
  private prisma = getPrismaClient();

  constructor() {
    // Prisma client singleton configurado com adapter
  }

  async listProjects() {
    const projects = await this.prisma.project.findMany({
      orderBy: { lastIndexed: "desc" },
      select: {
        id: true,
        projectId: true,
        path: true,
        documentCount: true,
        lastIndexed: true,
        _count: {
          select: { documents: true },
        },
      },
    });

    return {
      projects: projects.map((p) => ({
        id: p.projectId,
        path: p.path,
        documentCount: p._count.documents,
        lastIndexed: p.lastIndexed?.toISOString() || null,
      })),
      total: projects.length,
    };
  }

  async getProjectById(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { projectId },
      include: {
        _count: {
          select: { documents: true },
        },
        documents: {
          orderBy: { indexedAt: "desc" },
          take: 10,
        },
      },
    });

    if (!project) {
      return null;
    }

    // Get file type distribution
    const fileTypes = await this.prisma.document.groupBy({
      by: ["fileType"],
      where: { projectId },
      _count: true,
    });

    return {
      id: project.projectId,
      path: project.path,
      documentCount: project._count.documents,
      totalSize: project.totalSize,
      lastIndexed: project.lastIndexed?.toISOString() || null,
      fileTypes: fileTypes.map((ft) => ({
        type: ft.fileType || "unknown",
        count: ft._count,
      })),
      recentDocuments: project.documents.map((doc) => ({
        path: doc.filePath,
        type: doc.fileType,
        size: doc.size,
        indexedAt: doc.indexedAt.toISOString(),
      })),
    };
  }

  async getProjectDocuments(
    projectId: string,
    options: { limit?: number; offset?: number; fileType?: string } = {},
  ) {
    const { limit = 50, offset = 0, fileType } = options;

    const where: any = { projectId };
    if (fileType) {
      where.fileType = fileType;
    }

    const [documents, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        orderBy: { filePath: "asc" },
        take: limit,
        skip: offset,
      }),
      this.prisma.document.count({ where }),
    ]);

    return {
      documents: documents.map((doc) => ({
        path: doc.filePath,
        type: doc.fileType,
        size: doc.size,
        indexedAt: doc.indexedAt.toISOString(),
      })),
      total,
      limit,
      offset,
    };
  }

  async disconnect() {
    await this.prisma.$disconnect();
  }
}
