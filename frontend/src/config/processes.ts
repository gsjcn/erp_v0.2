export const standardProcessOptions = ['激光切割', '折弯', '冲压', '焊接', '打磨', '喷涂', '抛丸', '抛光', '装配', '包装', '其他'] as const;

export type StandardProcessOption = (typeof standardProcessOptions)[number];
