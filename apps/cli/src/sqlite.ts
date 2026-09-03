import "./quiet.js";

/**
 * `node:sqlite`, loaded late.
 *
 * Node emits `ExperimentalWarning` for this module when it *links* the
 * builtin, which in ESM happens before any user module body runs — so a
 * static `import "node:sqlite"` anywhere in the entry graph prints the
 * warning no matter how early the filter is installed. Loading it
 * dynamically, after `./quiet.js` has run, keeps the CLI's stderr for things
 * the user asked about.
 */
export const { DatabaseSync } = await import("node:sqlite");
export type Database = InstanceType<typeof DatabaseSync>;
