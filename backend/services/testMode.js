// Prototype test mode (simulated driver GPS). Enabled by default so the demo
// works out of the box; set DRIVER_TEST_MODE=false to disable it on a server.
export function isTestModeEnabled() {
  return String(process.env.DRIVER_TEST_MODE || "true").toLowerCase() !== "false";
}
