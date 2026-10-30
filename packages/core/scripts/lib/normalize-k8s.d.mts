// Type declarations for normalize-k8s.mjs (consumed by the TypeScript tests).
type Schema = Record<string, unknown>;

export interface Gvk {
  group: string;
  version: string;
  kind: string;
}

export declare const QUANTITY_DEF: string;
export declare const QUANTITY_PATTERN: string;
export declare const TIME_DEF: string;
export declare function kindGvk(name: string, def: Schema): Gvk | undefined;
export declare function apiVersionOf(gvk: Pick<Gvk, 'group' | 'version'>): string;
export declare function kindId(gvk: Gvk): string;
export declare function normalizeK8s(
  components: Record<string, Schema>,
  options?: { kindRoots?: boolean },
): Record<string, Schema>;
export declare function kindRoot(def: Schema, gvk: Gvk): Schema;
export declare function collectReachable(defs: Record<string, Schema>, rootName: string): Record<string, Schema>;
export declare function refsOf(node: unknown, acc?: Set<string>): Set<string>;
