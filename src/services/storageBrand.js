// New uploads use the current brand. Existing IDs remain valid until migrated.
export const STORAGE_ROOTS = Object.freeze(["atseen", "onlyme"]);

export function ownsStoragePath(assetId, path) {
  return typeof assetId === "string" && STORAGE_ROOTS.some(root => assetId.startsWith(`${root}/${path}/`));
}
