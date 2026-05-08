import { Decimal } from '@prisma/client/runtime/library';

export const STANDARD_PROCESS_NAMES = ['激光切割', '折弯', '冲压', '焊接', '打磨', '喷涂', '抛丸', '抛光', '装配', '包装', '其他'] as const;

export type StandardProcessName = (typeof STANDARD_PROCESS_NAMES)[number];

export function decimalToNumber(value: Decimal | number | string | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number(value);
  }
  return value.toNumber();
}

export interface ProcessStepSnapshot {
  processName: string;
  processRemark?: string;
}

export function processSnapshotToDetails(value: unknown): ProcessStepSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === 'string') {
        return splitLegacyProcessStep(item);
      }
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        const processName = String(record.processName || '').trim();
        const processRemark = String(record.processRemark || '').trim();
        return splitLegacyProcessStep(processName, processRemark);
      }
      return { processName: '' };
    })
    .filter((item) => item.processName);
}

export function processSnapshotToArray(value: unknown): string[] {
  return processSnapshotToDetails(value).map((item) => item.processName);
}

function splitLegacyProcessStep(processName: string, existingRemark = ''): ProcessStepSnapshot {
  const normalizedName = processName.trim();
  const normalizedRemark = existingRemark.trim();
  if (!normalizedName) {
    return { processName: '' };
  }

  const matchedStandardName = STANDARD_PROCESS_NAMES.find(
    (standardName) => normalizedName !== standardName && normalizedName.startsWith(standardName)
  );
  if (!matchedStandardName) {
    return {
      processName: normalizedName,
      ...(normalizedRemark ? { processRemark: normalizedRemark } : {})
    };
  }

  const legacyRemark = normalizedName
    .slice(matchedStandardName.length)
    .replace(/^[\s+＋:：/\\-]+/, '')
    .trim();
  const processRemark = [normalizedRemark, legacyRemark].filter(Boolean).join('；');
  return {
    processName: matchedStandardName,
    ...(processRemark ? { processRemark } : {})
  };
}
