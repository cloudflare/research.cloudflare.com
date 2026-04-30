/**
 * Minimal ambient declaration of the `astro:content` virtual module.
 *
 * Astro generates real types for `astro:content` inside the user's
 * project (via `astro sync`), but those types don't exist when this
 * package is type-checked in isolation. The shim below is the
 * smallest surface our runtime needs to call `getEntry`; the user's
 * generated types take precedence at consumer build time.
 */

declare module "astro:content" {
  /**
   * Parametric over the collection name so PolyStella's
   * `getLocalizedEntry` can infer the per-collection data shape via
   * `CollectionEntry<C>["data"]`. Inside this package the data type
   * resolves to `Record<string, unknown>` (we don't know the user's
   * schemas); inside a consumer project, Astro's `astro sync` types
   * take precedence and the data shape resolves to the real schema.
   */
  export interface CollectionEntry<C extends string = string> {
    id: string;
    slug?: string;
    collection: C;
    data: Record<string, unknown>;
    body?: string;
  }

  /**
   * Astro's `getEntry`. The real signature has rich generics for
   * collection/slug type inference; we accept plain strings here
   * because PolyStella's runtime forwards untyped IDs from the URL.
   */
  export function getEntry(
    collection: string,
    slug: string,
  ): Promise<CollectionEntry | undefined>;

  /**
   * Astro's `defineCollection`. Real shape is generic over the
   * loader and schema; we accept `unknown` because the
   * `polystellaCollections` helper threads opaque collection
   * config objects through and lets Astro re-validate them when
   * `astro sync` runs in the consumer project.
   */
  export function defineCollection(config: unknown): unknown;
}
