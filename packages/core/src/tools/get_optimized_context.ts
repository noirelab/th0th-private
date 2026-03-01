/**
 * Get Optimized Context Tool
 *
 * Busca código relevante + memórias persistentes + comprime semanticamente
 * para economizar tokens.
 * Combina search_project + search_memories + compress_context automaticamente.
 */

import { IToolHandler } from "@th0th/shared";
import { ToolResponse } from "@th0th/shared";
import { SearchProjectTool } from "./search_project.js";
import { CompressContextTool } from "./compress_context.js";
import { SearchMemoriesTool } from "./search_memories.js";
import { logger } from "@th0th/shared";
import { estimateTokens } from "@th0th/shared";

interface GetOptimizedContextParams {
  query: string;
  projectId: string;
  projectPath?: string;
  maxTokens?: number;
  maxResults?: number;
  workingMemoryBudget?: number;
  userId?: string;
  sessionId?: string;
  includeMemories?: boolean;
  memoryBudgetRatio?: number; // 0-1, fraction of maxTokens for memories (default 0.2)
}

export class GetOptimizedContextTool implements IToolHandler {
  name = "get_optimized_context";
  description =
    "Retrieve code context + persistent memories with maximum token efficiency (search + memories + compress)";
  inputSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query to find relevant context",
      },
      projectId: {
        type: "string",
        description: "Project ID for code context",
      },
      projectPath: {
        type: "string",
        description: "Project path (for auto-reindex)",
      },
      maxTokens: {
        type: "number",
        description: "Maximum tokens in returned context",
        default: 4000,
      },
      maxResults: {
        type: "number",
        description: "Maximum search results to include",
        default: 5,
      },
      workingMemoryBudget: {
        type: "number",
        description:
          "Token budget for active working set before compression (defaults to 80% of maxTokens)",
      },
      userId: {
        type: "string",
        description: "User ID for memory search (filters memories by user)",
      },
      sessionId: {
        type: "string",
        description: "Session ID for memory search (includes current session memories)",
      },
      includeMemories: {
        type: "boolean",
        description: "Include persistent memories from previous sessions (default: true)",
        default: true,
      },
      memoryBudgetRatio: {
        type: "number",
        description:
          "Fraction of maxTokens allocated for memories (0-1, default: 0.2 = 20%)",
        default: 0.2,
      },
    },
    required: ["query", "projectId"],
  };

  private searchTool: SearchProjectTool;
  private compressTool: CompressContextTool;
  private memoryTool: SearchMemoriesTool;

  constructor() {
    this.searchTool = new SearchProjectTool();
    this.compressTool = new CompressContextTool();
    this.memoryTool = new SearchMemoriesTool();
  }

  async handle(params: unknown): Promise<ToolResponse> {
    const {
      query,
      projectId,
      projectPath,
      maxTokens = 4000,
      maxResults = 5,
      workingMemoryBudget,
      userId,
      sessionId,
      includeMemories = true,
      memoryBudgetRatio = 0.2,
    } = params as GetOptimizedContextParams;

    try {
      // Clamp memory budget ratio to [0, 0.5] — never let memories consume > 50%
      const clampedMemoryRatio = Math.max(0, Math.min(0.5, memoryBudgetRatio));
      const memoryTokenBudget = includeMemories
        ? Math.floor(maxTokens * clampedMemoryRatio)
        : 0;
      const codeTokenBudget = maxTokens - memoryTokenBudget;

      logger.info("Getting optimized context", {
        query: query.slice(0, 50),
        projectId,
        maxTokens,
        includeMemories,
        memoryTokenBudget,
        codeTokenBudget,
        workingMemoryBudget:
          workingMemoryBudget || Math.floor(codeTokenBudget * 0.8),
      });

      // Step 1: Search for relevant code + memories in parallel
      const [searchResponse, memoryResponse] = await Promise.all([
        this.searchTool.handle({
          query,
          projectId,
          projectPath,
          maxResults,
          responseMode: "full",
          autoReindex: false,
          minScore: 0.4,
        }),
        includeMemories
          ? this.searchMemoriesSafe(query, {
              projectId,
              userId,
              sessionId,
              limit: 5,
            })
          : Promise.resolve(null),
      ]);

      if (!searchResponse.success || !searchResponse.data) {
        return {
          success: false,
          error: "Failed to search code",
        };
      }

      // Step 2: Format code search results
      const results = (searchResponse.data as any)?.results || [];
      const wmBudget =
        workingMemoryBudget || Math.floor(codeTokenBudget * 0.8);
      const workingSet = this.selectWorkingSet(results, wmBudget);

      // Step 2.5: Format memory results
      const memories = memoryResponse || [];
      const memorySection = this.formatMemorySection(
        memories,
        memoryTokenBudget,
      );

      if (workingSet.length === 0 && memories.length === 0) {
        return {
          success: true,
          data: {
            context: `No relevant code or memories found for query: "${query}"`,
            sources: [],
            memoriesCount: 0,
          },
          metadata: {
            tokensSaved: 0,
            compressionRatio: 0,
            cacheHit: false,
          },
        };
      }

      const contextParts: string[] = [
        `# Context for: ${query}\n`,
      ];

      // Add memory section first (decisions/patterns inform code reading)
      if (memorySection) {
        contextParts.push(memorySection);
        contextParts.push(""); // Blank line separator
      }

      if (workingSet.length > 0) {
        contextParts.push(
          `## Code (${workingSet.length} relevant sections, WM budget: ${wmBudget} tokens)\n`,
        );

        workingSet.forEach((result: any, idx: number) => {
          contextParts.push(
            `### ${idx + 1}. ${result.filePath || "Unknown"} (score: ${(result.score * 100).toFixed(1)}%)`,
          );
          contextParts.push(`Lines ${result.lineStart}-${result.lineEnd}\n`);
          contextParts.push("```" + (result.language || ""));
          contextParts.push(
            result.content || result.preview || "(no content)",
          );
          contextParts.push("```\n");
        });
      }

      const rawContext = contextParts.join("\n");
      const rawTokens = estimateTokens(rawContext, "code");

      // Step 3: Compress if needed
      let finalContext = rawContext;
      let compressionRatio = 0;
      let tokensSaved = 0;

      if (rawTokens > maxTokens) {
        logger.info("Context exceeds maxTokens, compressing", {
          rawTokens,
          maxTokens,
        });

        const compressResponse = await this.compressTool.handle({
          content: rawContext,
          strategy: "code_structure",
          targetRatio: 0.6,
        });

        if (compressResponse.success && compressResponse.data) {
          finalContext = (compressResponse.data as any).compressed;
          compressionRatio = compressResponse.metadata?.compressionRatio || 0;
          tokensSaved = compressResponse.metadata?.tokensSaved || 0;
        }
      }

      const finalTokens = estimateTokens(finalContext, "code");

      logger.info("Optimized context retrieved", {
        rawTokens,
        finalTokens,
        tokensSaved: rawTokens - finalTokens,
        compressionRatio: compressionRatio || 0,
        codeSources: workingSet.length,
        memoriesIncluded: memories.length,
        wmBudget,
      });

      return {
        success: true,
        data: {
          context: finalContext,
          sources: workingSet.map((r: any) => r.filePath || "unknown"),
          resultsCount: workingSet.length,
          memoriesCount: memories.length,
        },
        metadata: {
          tokensSaved: rawTokens - finalTokens,
          compressionRatio: compressionRatio || 0,
          cacheHit: false,
        } as any,
      };
    } catch (error) {
      logger.error("Failed to get optimized context", error as Error, {
        query,
        projectId,
      });

      return {
        success: false,
        error: `Failed to retrieve context: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Search memories with graceful error handling.
   * Memory search should never cause the overall tool to fail —
   * if memories are unavailable, we still return code context.
   */
  private async searchMemoriesSafe(
    query: string,
    options: {
      projectId: string;
      userId?: string;
      sessionId?: string;
      limit: number;
    },
  ): Promise<any[]> {
    try {
      const response = await this.memoryTool.handle({
        query,
        projectId: options.projectId,
        userId: options.userId,
        sessionId: options.sessionId,
        includePersistent: true,
        minImportance: 0.3,
        limit: options.limit,
        format: "json", // Need structured data, not TOON
      });

      if (!response.success || !response.data) {
        logger.warn("Memory search returned no results", {
          query: query.slice(0, 30),
        });
        return [];
      }

      const data = response.data as any;
      return data.memories || [];
    } catch (error) {
      // Non-fatal: log and continue with code-only context
      logger.warn("Memory search failed, continuing without memories", {
        error: (error as Error).message,
        query: query.slice(0, 30),
      });
      return [];
    }
  }

  /**
   * Format memories into a context section, respecting token budget.
   * Memories are ordered by score (already ranked by SearchMemoriesTool).
   */
  private formatMemorySection(
    memories: any[],
    tokenBudget: number,
  ): string | null {
    if (memories.length === 0 || tokenBudget <= 0) {
      return null;
    }

    const parts: string[] = [
      `## Relevant Memories (from previous sessions)\n`,
    ];

    let usedTokens = estimateTokens(parts[0], "text");

    for (const memory of memories) {
      const typeLabel = (memory.type || "unknown").toUpperCase();
      const score = memory.score
        ? ` (relevance: ${(memory.score * 100).toFixed(0)}%)`
        : "";
      const importance = memory.importance
        ? ` [importance: ${(memory.importance * 100).toFixed(0)}%]`
        : "";
      const agent = memory.agentId ? ` (by: ${memory.agentId})` : "";

      const entry = `- **[${typeLabel}]**${score}${importance}${agent}: ${memory.content}`;
      const entryTokens = estimateTokens(entry, "text");

      if (usedTokens + entryTokens > tokenBudget) {
        break; // Respect budget
      }

      parts.push(entry);
      usedTokens += entryTokens;
    }

    // Only return if we actually included at least one memory
    if (parts.length <= 1) {
      return null;
    }

    return parts.join("\n");
  }

  /**
   * Select an active working set under token budget.
   * Prioritizes top scores while keeping source diversity.
   */
  private selectWorkingSet(results: any[], tokenBudget: number): any[] {
    if (!results.length || tokenBudget <= 0) {
      return [];
    }

    const selected: any[] = [];
    const selectedFiles = new Set<string>();
    let usedTokens = 0;

    const sorted = [...results].sort((a, b) => (b.score || 0) - (a.score || 0));

    // Pass 1: pick best from distinct files
    for (const result of sorted) {
      const filePath = result.filePath || "unknown";
      if (selectedFiles.has(filePath)) {
        continue;
      }

      const content = result.content || result.preview || "";
      const tokens = estimateTokens(content, "code");
      if (usedTokens + tokens > tokenBudget) {
        continue;
      }

      selected.push(result);
      selectedFiles.add(filePath);
      usedTokens += tokens;
    }

    // Pass 2: fill remaining budget with best leftovers
    for (const result of sorted) {
      if (selected.includes(result)) {
        continue;
      }

      const content = result.content || result.preview || "";
      const tokens = estimateTokens(content, "code");
      if (usedTokens + tokens > tokenBudget) {
        continue;
      }

      selected.push(result);
      usedTokens += tokens;
    }

    return selected;
  }
}
