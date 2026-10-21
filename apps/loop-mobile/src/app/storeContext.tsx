/**
 * Store context — one HerdrStore per mounted app tree. Screens read state
 * with `useHerdrState()` (useSyncExternalStore) and act through
 * `useStore().client`. App.tsx owns the store instance, so tests can mount
 * a fresh one.
 */

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

import { HerdrStore, type HerdrAppState } from "../herdr/store";

const StoreContext = createContext<HerdrStore | null>(null);

export function StoreProvider(props: { store: HerdrStore; children: ReactNode }) {
  return <StoreContext.Provider value={props.store}>{props.children}</StoreContext.Provider>;
}

export function useStore(): HerdrStore {
  const store = useContext(StoreContext);
  if (store === null) {
    throw new Error("useStore requires a StoreProvider");
  }
  return store;
}

export function useHerdrState(): HerdrAppState {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
