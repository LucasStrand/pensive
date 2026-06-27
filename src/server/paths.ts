import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The pensive install root = two levels up from src/server/. Everything the
// server persists (cloned repos, dedupe state) lives here, not in process.cwd(),
// so it behaves the same no matter where you launch it from.
export const INSTALL_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const REPOS_DIR = join(INSTALL_ROOT, ".pensive", "repos");
export const STATE_FILE = join(INSTALL_ROOT, ".pensive", "server-state.json");
