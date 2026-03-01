/**
 * @th0th/core - Services Export
 */

// Search
export { ContextualSearchRLM } from "./search/contextual-search-rlm.js";
export { SearchCache } from "./search/search-cache.js";
export { SearchAnalytics } from "./search/search-analytics.js";
export { SearchCacheWarmup } from "./search/search-warmup.js";
export { IndexManager } from "./search/index-manager.js";

// Cache
export { CacheManager } from "./cache/cache-manager.js";
export { L1MemoryCache } from "./cache/l1-memory-cache.js";
export { L2SQLiteCache } from "./cache/l2-sqlite-cache.js";
export { EmbeddingCache } from "./cache/embedding-cache.js";

// Compression
export { CodeCompressor } from "./compression/code-compressor.js";

// Embeddings
export {
  createEmbeddingProvider,
  checkProviderAvailability,
} from "./embeddings/index.js";
export type { EmbeddingProvider } from "./embeddings/provider.js";

// Health (local-first)
export {
  LocalHealthChecker,
  getHealthChecker,
} from "./health/local-health-checker.js";
export type {
  LocalHealthReport,
  ServiceStatus,
} from "./health/local-health-checker.js";

// Pricing (local-first with cache)
export {
  ModelsDevClient,
  getModelsDevClient,
} from "./pricing/models-dev-client.js";
export type { ModelPricing } from "./pricing/models-dev-client.js";
