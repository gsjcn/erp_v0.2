import { mkdirSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';

function ensureDirectory(path: string) {
  mkdirSync(path, { recursive: true });
  return path;
}

function projectRootPath() {
  const cwd = resolve(process.cwd());
  return cwd.endsWith(`${sep}backend`) ? resolve(cwd, '..') : cwd;
}

function resolveStoragePath(configuredPath: string | undefined, fallbackPath: string) {
  const cleanPath = configuredPath?.trim();
  if (!cleanPath) {
    return resolve(projectRootPath(), fallbackPath);
  }
  return isAbsolute(cleanPath) ? resolve(cleanPath) : resolve(projectRootPath(), cleanPath);
}

export function uploadRootPath() {
  return ensureDirectory(resolveStoragePath(process.env.UPLOAD_DIR, 'storage/uploads'));
}

export function exportRootPath() {
  return ensureDirectory(resolveStoragePath(process.env.EXPORT_DIR, 'storage/exports'));
}

export function drawingUploadPath() {
  return ensureDirectory(resolve(uploadRootPath(), 'drawings'));
}

export function inventoryAdjustmentUploadPath() {
  return ensureDirectory(resolve(uploadRootPath(), 'inventory-adjustments'));
}

export function orderImportUploadPath() {
  return ensureDirectory(resolve(uploadRootPath(), 'order-imports'));
}
