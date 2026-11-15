import { PortalProvider } from "@prisma/client";
import { PortalLeadAdapter } from "./types";
import { NinetyNineAcresAdapter, MagicbricksAdapter, NoBrokerAdapter } from "./adapters/provider-stubs";
import { GenericMockPortalAdapter } from "./adapters/generic-mock";

const defaultAdapters: Map<PortalProvider, PortalLeadAdapter> = new Map<PortalProvider, PortalLeadAdapter>([
  [PortalProvider.NINETY_NINE_ACRES, new NinetyNineAcresAdapter()],
  [PortalProvider.MAGICBRICKS, new MagicbricksAdapter()],
  [PortalProvider.NOBROKER, new NoBrokerAdapter()],
]);

const registeredAdapters: Map<PortalProvider, PortalLeadAdapter> = new Map<PortalProvider, PortalLeadAdapter>(defaultAdapters);

/**
 * Retrieves the registered adapter for a given portal provider.
 */
export function getPortalAdapter(provider: PortalProvider): PortalLeadAdapter {
  const adapter = registeredAdapters.get(provider);
  if (!adapter) {
    // Fallback to generic mock if no specific adapter is found
    return new GenericMockPortalAdapter(provider);
  }
  return adapter;
}

/**
 * Registers or overrides an adapter for a given portal provider.
 * Useful for mocking, testing, or updating partner-specific implementations.
 */
export function registerPortalAdapter(
  provider: PortalProvider,
  adapter: PortalLeadAdapter
): void {
  registeredAdapters.set(provider, adapter);
}

/**
 * Resets the adapter registry to default factory state.
 */
export function resetPortalAdapters(): void {
  registeredAdapters.clear();
  for (const [provider, adapter] of defaultAdapters) {
    registeredAdapters.set(provider, adapter);
  }
}
