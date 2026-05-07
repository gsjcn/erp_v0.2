import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export function uploadRootPath() {
  if (process.env.UPLOAD_DIR?.trim()) {
    return resolve(process.env.UPLOAD_DIR.trim());
  }
  const cwd = process.cwd();
  return resolve(cwd, cwd.endsWith('backend') ? '../storage/uploads' : 'storage/uploads');
}

export function drawingUploadPath() {
  const path = resolve(uploadRootPath(), 'drawings');
  mkdirSync(path, { recursive: true });
  return path;
}

export function inventoryAdjustmentUploadPath() {
  const path = resolve(uploadRootPath(), 'inventory-adjustments');
  mkdirSync(path, { recursive: true });
  return path;
}
