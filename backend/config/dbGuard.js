// Safety guard for scripts that use the database named by MONGO_URI but are NOT isolated
// test suites (add-route-*.js, configure-evening-schedules.js, the scenario / token / photo
// tests). They read or modify real data, so they refuse to run against anything except a
// throwaway database (name ending in demo, seed or test) unless CONFIRM_DB_WRITE is set to
// the exact database name. Call assertSafeDatabase() BEFORE connecting.
import { databaseNameFromUri } from "./seedGuard.js";

const SAFE_NAME = /(demo|seed|test)$/i;

export function checkDatabaseTarget(uri, env = process.env) {
  const dbName = databaseNameFromUri(uri);
  if (!dbName) {
    return { ok: false, dbName, reason: "MONGO_URI must name a database, e.g. mongodb://127.0.0.1:27017/campusbus_test." };
  }
  if (SAFE_NAME.test(dbName)) return { ok: true, dbName };
  if (env.CONFIRM_DB_WRITE === dbName) return { ok: true, dbName, overridden: true };
  return {
    ok: false,
    dbName,
    reason:
      `Refusing to run against "${dbName}": this script reads or modifies real data. ` +
      `Point MONGO_URI at a throwaway database (name ending in demo, seed or test, e.g. campusbus_test), ` +
      `or set CONFIRM_DB_WRITE=${dbName} to confirm you intend to use this database.`,
  };
}

export function assertSafeDatabase(scriptName, uri = process.env.MONGO_URI, env = process.env) {
  const r = checkDatabaseTarget(uri, env);
  if (!r.ok) {
    console.error(`[${scriptName}] ${r.reason}`);
    process.exit(1);
  }
  if (r.overridden) console.warn(`[${scriptName}] CONFIRM_DB_WRITE matches "${r.dbName}"; proceeding on that database.`);
  return r.dbName;
}
