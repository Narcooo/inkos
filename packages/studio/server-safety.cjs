const path = require("node:path");
const os = require("node:os");

const SAFE_UPLOAD_FILE_ID = /^[A-Za-z0-9-]{1,64}$/;
const MAX_IMPORT_PATTERN_LENGTH = 160;
const SAFE_IMPORT_PATTERN = /^[\p{L}\p{N}\s[\]\\.^$*+?{}\-，。:：、_]+$/u;

function isSafeUploadFileId(fileId) {
  return typeof fileId === "string" && SAFE_UPLOAD_FILE_ID.test(fileId);
}

function buildImportRegex(pattern) {
  const normalized = String(pattern ?? "").trim();
  if (!normalized) {
    throw new Error("Import pattern is required");
  }
  if (normalized.length > MAX_IMPORT_PATTERN_LENGTH) {
    throw new Error(`Import pattern too long (max ${MAX_IMPORT_PATTERN_LENGTH} chars)`);
  }
  if (/[()|]/.test(normalized) || /\\[1-9]/.test(normalized) || normalized.includes("(?")) {
    throw new Error("Import pattern uses unsafe regex features");
  }
  if (!SAFE_IMPORT_PATTERN.test(normalized)) {
    throw new Error("Import pattern is invalid");
  }

  try {
    return new RegExp(normalized, "g");
  } catch {
    throw new Error("Import pattern is invalid");
  }
}

function createUploadResponse({
  fileId,
  size,
  chapterCount,
  firstTitle,
  totalChars,
}) {
  return {
    ok: true,
    fileId,
    size,
    chapterCount,
    firstTitle,
    totalChars,
  };
}

function resolveServerPort(env = process.env) {
  const raw = env.PORT ?? env.INKOS_STUDIO_PORT ?? "8799";
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8799;
}

async function ensureRuntimeDirs({
  projectRoot,
  homeDir = os.homedir(),
  mkdirFn,
  pathModule = path,
}) {
  if (typeof mkdirFn !== "function") {
    throw new Error("mkdirFn is required");
  }

  await mkdirFn(projectRoot, { recursive: true });
  await mkdirFn(pathModule.join(projectRoot, ".inkos"), { recursive: true });
  await mkdirFn(pathModule.join(homeDir, ".inkos"), { recursive: true });
}

module.exports = {
  buildImportRegex,
  createUploadResponse,
  ensureRuntimeDirs,
  isSafeUploadFileId,
  resolveServerPort,
};
