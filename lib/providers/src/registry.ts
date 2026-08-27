import type { ProviderAdapter } from "./adapter";

/**
 * ProviderRegistry maintains the set of registered ProviderAdapter implementations.
 * Concrete adapters register themselves at startup; the collector uses this
 * registry to look up the right adapter by internalName.
 */
export class ProviderRegistry {
  private adapters = new Map<string, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.internalName, adapter);
  }

  get(internalName: string): ProviderAdapter | undefined {
    return this.adapters.get(internalName);
  }

  list(): ProviderAdapter[] {
    return Array.from(this.adapters.values());
  }

  has(internalName: string): boolean {
    return this.adapters.has(internalName);
  }
}

/** Singleton registry — import this in the API server at startup. */
export const providerRegistry = new ProviderRegistry();
