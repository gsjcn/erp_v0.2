import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from './prisma/prisma.service';
import { exportRootPath, uploadRootPath } from './storage/upload-paths';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const uploadPath = this.assertWritableDirectory(uploadRootPath());
      const exportPath = this.assertWritableDirectory(exportRootPath());

      return {
        status: 'ok',
        scope: 'first-stage',
        database: 'ok',
        storage: {
          uploads: uploadPath,
          exports: exportPath
        }
      };
    } catch (error) {
      throw new ServiceUnavailableException({
        status: 'error',
        scope: 'first-stage',
        message: error instanceof Error ? error.message : 'healthcheck failed'
      });
    }
  }

  private assertWritableDirectory(directory: string) {
    const filePath = join(directory, `.healthcheck-${randomUUID()}`);
    // Docker / NAS 部署时必须确认挂载目录可写，否则上传图纸和导出文件会在运行中失败。
    writeFileSync(filePath, 'ok', 'utf8');
    unlinkSync(filePath);
    return {
      path: directory,
      writable: true
    };
  }
}
