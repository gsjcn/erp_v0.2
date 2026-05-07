import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type SerializableTransactionRunner = {
  $transaction<T>(
    action: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel }
  ): Promise<T>;
};

const SERIALIZABLE_RETRY_COUNT = 3;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSerializableConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

export async function runSerializableTransaction<T>(
  prisma: SerializableTransactionRunner,
  action: (tx: Prisma.TransactionClient) => Promise<T>,
  retryFailedMessage = '当前库存数据正在被其他操作修改，请稍后重试'
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= SERIALIZABLE_RETRY_COUNT; attempt += 1) {
    try {
      return await prisma.$transaction(action, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });
    } catch (error) {
      if (!isSerializableConflict(error)) {
        throw error;
      }

      lastError = error;
      if (attempt < SERIALIZABLE_RETRY_COUNT) {
        // 库存相关事务遇到并发写入冲突时短暂重试，避免用户偶发点击失败。
        await delay(40 * attempt);
      }
    }
  }

  throw new BadRequestException(retryFailedMessage, { cause: lastError });
}
