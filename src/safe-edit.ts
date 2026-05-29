import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const BACKUP_DIR_NAME = ".openagent-backups";

export type OpenAgentSafeEditBackup = {
  id: string;
  timestamp: string;
  originalPath: string;
  backupPath: string;
  lineHash: string;
  oldBlockPreview: string;
};

function isInsideRoot(candidatePath: string, rootPath: string): boolean {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedCandidate = path.resolve(candidatePath);
  const relative = path.relative(resolvedRoot, resolvedCandidate);

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }

  let count = 0;
  let index = 0;
  while (true) {
    index = haystack.indexOf(needle, index);
    if (index === -1) {
      return count;
    }

    count += 1;
    index += needle.length;
  }
}

export function hashSafeEditLine(line: string): string {
  return createHash("sha256").update(line, "utf8").digest("hex").slice(0, 16);
}

// ─── Backup / rollback infrastructure ────────────────────────────────────────

function resolveBackupDir(workspacePath?: string): string {
  return workspacePath
    ? path.join(workspacePath, BACKUP_DIR_NAME)
    : path.join(os.tmpdir(), BACKUP_DIR_NAME);
}

function ensureBackupDir(workspacePath?: string): string {
  const dir = resolveBackupDir(workspacePath);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Writes a pre-edit snapshot of a file before safe_edit modifies it.
 * Returns the backup metadata or null if the source file doesn't exist.
 */
async function backupBeforeSafeEdit(args: {
  workspacePath?: string;
  filePath: string;
  lineHash: string;
  oldBlock: string;
}): Promise<OpenAgentSafeEditBackup | null> {
  if (!existsSync(args.filePath)) {
    return null;
  }

  const originalContent = await readFile(args.filePath, "utf8");
  const backupDir = ensureBackupDir(args.workspacePath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileHash = hashSafeEditLine(args.filePath);
  const id = `backup-${timestamp}-${fileHash}`;
  const backupFileName = `${id}.bak`;
  const backupPath = path.join(backupDir, backupFileName);

  await writeFile(backupPath, originalContent, "utf8");

  const oldBlockPreview =
    args.oldBlock.length > 120
      ? `${args.oldBlock.slice(0, 120).trimEnd()}...`
      : args.oldBlock;

  return {
    id,
    timestamp,
    originalPath: args.filePath,
    backupPath,
    lineHash: args.lineHash,
    oldBlockPreview,
  };
}

/**
 * Rolls back a single safe_edit by restoring the pre-edit backup from a known
 * original path.  Callers should supply the backup metadata originally returned
 * by backupBeforeSafeEdit (or the backupId field from the edit result).
 */
export async function rollbackOpenAgentSafeEdit(args: {
  workspacePath?: string;
  backupId: string;
  originalPath: string;
}): Promise<string> {
  const backupDir = resolveBackupDir(args.workspacePath);
  const backupPath = path.join(backupDir, `${args.backupId}.bak`);

  if (!existsSync(backupPath)) {
    throw new Error(
      `Backup not found: ${args.backupId}. Use listOpenAgentSafeEditBackups to list available backups.`,
    );
  }

  const originalContent = await readFile(backupPath, "utf8");
  await writeFile(args.originalPath, originalContent, "utf8");
  await rm(backupPath, { force: true });

  return args.originalPath;
}

/**
 * Rolls back ALL safe_edit backups in reverse chronological order (newest first).
 * Requires callers to supply a path-resolver so we know which file each backup
 * belongs to.  If you just want best-effort cleanup, list backups first and
 * call rollbackOpenAgentSafeEdit individually.
 */
export async function rollbackAllOpenAgentSafeEdits(args: {
  workspacePath?: string;
  resolvePath: (backupId: string, backupPath: string) => string | null;
}): Promise<string[]> {
  const backupDir = resolveBackupDir(args.workspacePath);
  if (!existsSync(backupDir)) {
    return [];
  }

  const entries = readdirSync(backupDir)
    .filter((f) => f.endsWith(".bak"))
    .sort()
    .reverse();

  const restored: string[] = [];
  for (const entry of entries) {
    const id = entry.replace(/\.bak$/, "");
    const bp = path.join(backupDir, entry);
    const originalPath = args.resolvePath(id, bp);
    if (!originalPath) continue;

    try {
      const fp = await rollbackOpenAgentSafeEdit({
        workspacePath: args.workspacePath,
        backupId: id,
        originalPath,
      });
      restored.push(fp);
    } catch {
      // Skip backups we can't restore
    }
  }

  return restored;
}

/**
 * Lists available safe_edit backup IDs for inspection.
 */
export function listOpenAgentSafeEditBackups(args: {
  workspacePath?: string;
}): string[] {
  const backupDir = resolveBackupDir(args.workspacePath);
  if (!existsSync(backupDir)) {
    return [];
  }

  return readdirSync(backupDir)
    .filter((f) => f.endsWith(".bak"))
    .map((f) => f.replace(/\.bak$/, ""))
    .sort()
    .reverse();
}

/**
 * Formats available safe_edit backups as a human-readable string.
 */
export function formatOpenAgentSafeEditBackups(args: {
  workspacePath?: string;
}): string {
  const ids = listOpenAgentSafeEditBackups(args);
  if (ids.length === 0) {
    return "OpenAgent safe-edit backups: none";
  }

  const lines = [`OpenAgent safe-edit backups (${ids.length}):`];
  for (const id of ids) {
    lines.push(`  ${id}`);
  }

  return lines.join("\n");
}

// ─── Core safe-edit apply ────────────────────────────────────────────────────

export async function applyOpenAgentSafeEdit(args: {
  cwd: string;
  workspacePath?: string;
  file: string;
  lineHash: string;
  oldBlock: string;
  newBlock: string;
}): Promise<{
  filePath: string;
  lineNumber: number;
  nextContent: string;
  backupId: string | null;
}> {
  const resolvedFilePath = path.resolve(args.cwd, args.file);
  const allowedRoots = [path.resolve(args.cwd)];
  if (args.workspacePath) {
    allowedRoots.push(path.resolve(args.workspacePath));
  }

  if (!allowedRoots.some((root) => isInsideRoot(resolvedFilePath, root))) {
    throw new Error("openagent_safe_edit only allows files inside the repo or session workspace.");
  }

  if (args.oldBlock.length === 0) {
    throw new Error("openagent_safe_edit requires a non-empty oldBlock.");
  }

  const currentContent = await readFile(resolvedFilePath, "utf8");
  const occurrenceCount = countOccurrences(currentContent, args.oldBlock);
  if (occurrenceCount === 0) {
    throw new Error("openagent_safe_edit could not find oldBlock in the target file.");
  }

  if (occurrenceCount > 1) {
    throw new Error("openagent_safe_edit found multiple oldBlock matches; refine the block.");
  }

  const matchIndex = currentContent.indexOf(args.oldBlock);
  const lineNumber = currentContent.slice(0, matchIndex).split(/\r?\n/).length;
  const currentFirstLine = args.oldBlock.split(/\r?\n/, 1)[0] ?? "";
  const currentHash = hashSafeEditLine(currentFirstLine);
  if (currentHash !== args.lineHash) {
    throw new Error(
      `openagent_safe_edit refused to edit because the target line hash drifted (expected ${args.lineHash}, found ${currentHash}).`,
    );
  }

  // Take a pre-edit snapshot for rollback safety
  const backup = await backupBeforeSafeEdit({
    workspacePath: args.workspacePath,
    filePath: resolvedFilePath,
    lineHash: args.lineHash,
    oldBlock: args.oldBlock,
  });

  const nextContent = currentContent.replace(args.oldBlock, args.newBlock);
  await writeFile(resolvedFilePath, nextContent, "utf8");

  return {
    filePath: resolvedFilePath,
    lineNumber,
    nextContent,
    backupId: backup?.id ?? null,
  };
}
