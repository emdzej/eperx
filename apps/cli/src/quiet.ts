/**
 * Silence Node's `ExperimentalWarning` for `node:sqlite`.
 *
 * The CLI's output is meant to be read and diffed, and a warning on stderr
 * about a module the user did not choose is noise. This must be imported
 * before anything that pulls in `node:sqlite`, because the warning is emitted
 * when that module is first evaluated.
 *
 * Only the SQLite warning is dropped; anything else Node has to say still
 * gets through.
 */
const emitWarning = process.emitWarning.bind(process);

process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === "string" ? warning : warning.message;
  if (text.includes("SQLite is an experimental feature")) return;
  return (emitWarning as (...args: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;
