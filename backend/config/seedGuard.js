// Safety guard for seed.js, which DELETES all users, buses, routes, stops and trips in the
// database named by MONGO_URI. It only runs against throwaway databases (name ends in
// _demo, _seed or _test). Any other database, including the main "campusbus" one, needs
// SEED_CONFIRM_WIPE set to the exact database name.
const SAFE_NAME = /(_demo|_seed|_test)$/i;

export function databaseNameFromUri(uri = "") {
  const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/.exec(String(uri));
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function checkSeedTarget(uri, env = process.env) {
  const dbName = databaseNameFromUri(uri);
  if (!dbName) {
    return {
      ok: false,
      dbName,
      reason: "MONGO_URI must name a database, e.g. mongodb://127.0.0.1:27017/campusbus_demo.",
    };
  }
  if (SAFE_NAME.test(dbName)) return { ok: true, dbName };
  if (env.SEED_CONFIRM_WIPE === dbName) return { ok: true, dbName, overridden: true };
  return {
    ok: false,
    dbName,
    reason:
      `Refusing to seed "${dbName}": seed.js deletes all users, buses, routes, stops and trips in it. ` +
      `Use a throwaway database (name ending in _demo, _seed or _test), e.g. campusbus_demo, ` +
      `or set SEED_CONFIRM_WIPE=${dbName} to confirm you really want to wipe this database.`,
  };
}
