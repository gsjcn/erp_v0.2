import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import multer = require('multer');

@Catch(multer.MulterError)
export class UploadExceptionFilter implements ExceptionFilter {
  catch(exception: multer.MulterError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const message =
      exception.code === 'LIMIT_FILE_SIZE'
        ? '上传文件超过大小限制，请压缩或拆分后重新上传'
        : exception.code === 'LIMIT_UNEXPECTED_FILE'
          ? '上传字段不正确，请选择正确的文件后重新上传'
          : exception.message || '文件上传失败';

    response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      message,
      error: 'Bad Request',
      code: exception.code
    });
  }
}
