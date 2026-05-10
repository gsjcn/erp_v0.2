import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

function ensureDirectory(path: string) {
  mkdirSync(path, { recursive: true });
  return path;
}

export function uploadRootPath() {
  if (process.env.UPLOAD_DIR?.trim()) {
    return ensureDirectory(resolve(process.env.UPLOAD_DIR.trim()));
  }
  const cwd = process.cwd();
  return ensureDirectory(resolve(cwd, cwd.endsWith('backend') ? '../storage/uploads' : 'storage/uploads'));
}

export function exportRootPath() {
  if (process.env.EXPORT_DIR?.trim()) {
    return ensureDirectory(resolve(process.env.EXPORT_DIR.trim()));
  }
  const cwd = process.cwd();
  return ensureDirectory(resolve(cwd, cwd.endsWith('backend') ? '../storage/exports' : 'storage/exports'));
}

export function drawingUploadPath() {
  return ensureDirectory(resolve(uploadRootPath(), 'drawings'));
}

export function inventoryAdjustmentUploadPath() {
  return ensureDirectory(resolve(uploadRootPath(), 'inventory-adjustments'));
}
