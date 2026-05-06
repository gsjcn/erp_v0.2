import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CommonStatus, CustomerRegionType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CheckCustomerCodeQueryDto,
  CheckCustomerNameQueryDto,
  CreateCustomerDto,
  CustomerContactDto,
  CustomerQueryDto,
  UpdateCustomerDto,
  UpdateCustomerStatusDto
} from './dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: CustomerQueryDto) {
    const where: Prisma.CustomerWhereInput = {};
    const keyword = query.keyword?.trim();

    if (keyword) {
      where.OR = [
        { customerCode: { contains: keyword, mode: 'insensitive' } },
        { customerName: { contains: keyword, mode: 'insensitive' } },
        { contactName: { contains: keyword, mode: 'insensitive' } },
        { contacts: { some: { contactName: { contains: keyword, mode: 'insensitive' } } } },
        { contacts: { some: { contactPhone: { contains: keyword, mode: 'insensitive' } } } }
      ];
    }

    if (query.status) {
      where.status = query.status;
    }

    return this.prisma.customer.findMany({
      where,
      include: this.customerInclude(),
      orderBy: [{ status: 'asc' }, { customerCode: 'asc' }]
    });
  }

  async checkName(query: CheckCustomerNameQueryDto) {
    const customerName = query.customerName.trim();
    if (!customerName) {
      throw new BadRequestException('customerName is required');
    }
    const exists = await this.customerNameExists(customerName, query.excludeId);
    return {
      customerName,
      exists,
      available: !exists
    };
  }

  async checkCode(query: CheckCustomerCodeQueryDto) {
    const customerCode = query.customerCode.trim();
    if (!customerCode) {
      throw new BadRequestException('customerCode is required');
    }
    const exists = await this.customerCodeExists(customerCode, query.excludeId);
    return {
      customerCode,
      exists,
      available: !exists
    };
  }

  async nextCode() {
    return { customerCode: await this.generateCustomerCode() };
  }

  async create(dto: CreateCustomerDto) {
    const customerName = this.normalizeRequired(dto.customerName, 'customerName is required');
    await this.ensureCustomerNameAvailable(customerName);

    const customerCode = dto.customerCode?.trim() || (await this.generateCustomerCode());
    await this.ensureCustomerCodeAvailable(customerCode);
    const regionData = this.normalizeRegion(dto);
    const contacts = this.normalizeContacts(dto.contacts, dto.contactName, dto.contactPhone);
    const primaryContact = contacts.find((contact) => contact.isPrimary);

    try {
      return await this.prisma.customer.create({
        data: {
          customerCode,
          customerName,
          ...regionData,
          // 客户主表保留首要联系人快照，联系人明细表保存多联系人。
          contactName: primaryContact?.contactName,
          contactPhone: primaryContact?.contactPhone,
          address: this.buildAddress(regionData),
          remark: dto.remark?.trim(),
          status: contacts.length ? CommonStatus.ENABLED : CommonStatus.DISABLED,
          contacts: contacts.length ? { create: contacts } : undefined
        },
        include: this.customerInclude()
      });
    } catch (error) {
      if (this.isDuplicateCustomerNameError(error)) {
        throw new BadRequestException(`Customer name ${customerName} already exists`);
      }
      if (this.isDuplicateCustomerCodeError(error)) {
        throw new BadRequestException(`Customer code ${customerCode} already exists`);
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateCustomerDto) {
    const existing = await this.ensureExists(id);

    const customerName = dto.customerName ? this.normalizeRequired(dto.customerName, 'customerName is required') : undefined;
    if (customerName) {
      await this.ensureCustomerNameAvailable(customerName, id);
    }
    if (dto.customerCode?.trim() && dto.customerCode.trim() !== existing.customerCode) {
      throw new BadRequestException('Customer code cannot be changed after creation');
    }

    const regionData = this.normalizeRegion({
      ...dto,
      regionType: dto.regionType ?? existing.regionType,
      country: dto.country ?? existing.country,
      province: dto.province ?? existing.province ?? undefined,
      state: dto.state ?? existing.state ?? undefined,
      district: dto.district ?? existing.district ?? undefined,
      city: dto.city ?? existing.city ?? undefined,
      detailAddress: dto.detailAddress ?? existing.detailAddress ?? undefined
    });
    const contacts = this.normalizeContacts(dto.contacts, dto.contactName, dto.contactPhone);
    const primaryContact = contacts.find((contact) => contact.isPrimary);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.customerContact.deleteMany({ where: { customerId: id } });
        return tx.customer.update({
          where: { id },
          data: {
            customerName,
            ...regionData,
            contactName: primaryContact?.contactName,
            contactPhone: primaryContact?.contactPhone,
            address: this.buildAddress(regionData),
            remark: dto.remark?.trim(),
            status: contacts.length ? existing.status : CommonStatus.DISABLED,
            contacts: contacts.length ? { create: contacts } : undefined
          },
          include: this.customerInclude()
        });
      });
    } catch (error) {
      if (this.isDuplicateCustomerNameError(error)) {
        throw new BadRequestException(`Customer name ${customerName} already exists`);
      }
      if (this.isDuplicateCustomerCodeError(error)) {
        throw new BadRequestException(`Customer code ${existing.customerCode} already exists`);
      }
      throw error;
    }
  }

  async updateStatus(id: string, dto: UpdateCustomerStatusDto) {
    await this.ensureExists(id);

    if (dto.status === CommonStatus.ENABLED) {
      const primaryContactCount = await this.prisma.customerContact.count({ where: { customerId: id, isPrimary: true } });
      if (primaryContactCount === 0) {
        throw new BadRequestException('Cannot enable customer without primary contact');
      }
    }

    return this.prisma.customer.update({
      where: { id },
      data: { status: dto.status },
      include: this.customerInclude()
    });
  }

  private async ensureExists(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  private normalizeRequired(value: string | undefined, message: string) {
    const normalized = value?.trim();
    if (!normalized) {
      throw new BadRequestException(message);
    }
    return normalized;
  }

  private normalizeRegion(dto: CreateCustomerDto | UpdateCustomerDto) {
    // 国内客户必须落到省份和城市；国外客户只强制国家，其余州/省/区/城市为选填。
    const regionType = dto.regionType || CustomerRegionType.CHINA;

    if (regionType === CustomerRegionType.CHINA) {
      const province = this.normalizeRequired(dto.province, 'province is required for China customer');
      const city = this.normalizeRequired(dto.city, 'city is required for China customer');
      return {
        regionType,
        country: '中国',
        province,
        state: null,
        district: dto.district?.trim() || null,
        city,
        detailAddress: dto.detailAddress?.trim() || null
      };
    }

    const country = this.normalizeRequired(dto.country, 'country is required for overseas customer');
    return {
      regionType,
      country,
      province: dto.province?.trim() || null,
      state: dto.state?.trim() || null,
      district: dto.district?.trim() || null,
      city: dto.city?.trim() || null,
      detailAddress: dto.detailAddress?.trim() || null
    };
  }

  private normalizeContacts(contacts?: CustomerContactDto[], fallbackName?: string, fallbackPhone?: string) {
    // 有联系人时必须明确选择一个主联系人；没有联系人时客户会自动停用但保留客户ID和名称。
    const source =
      contacts && contacts.length > 0
        ? contacts
        : fallbackName || fallbackPhone
          ? [{ contactName: fallbackName || '默认联系人', contactPhone: fallbackPhone, isPrimary: true }]
          : [];

    const normalized = source
      .map((contact, index) => ({
        contactName: contact.contactName?.trim(),
        contactPhone: contact.contactPhone?.trim() || null,
        title: contact.title?.trim() || null,
        remark: contact.remark?.trim() || null,
        isPrimary: Boolean(contact.isPrimary)
      }))
      .filter((contact) => Boolean(contact.contactName))
      .map((contact) => ({ ...contact, contactName: contact.contactName as string }));

    if (normalized.length === 0) {
      return [];
    }

    const primaryCount = normalized.filter((contact) => contact.isPrimary).length;
    if (primaryCount !== 1) {
      throw new BadRequestException('Exactly one primary contact is required');
    }

    return normalized;
  }

  private buildAddress(region: ReturnType<CustomersService['normalizeRegion']>) {
    const parts =
      region.regionType === CustomerRegionType.CHINA
        ? [region.country, region.province, region.city, region.district, region.detailAddress]
        : [region.country, region.state, region.province, region.district, region.city, region.detailAddress];
    return parts.filter(Boolean).join(' ');
  }

  private async customerNameExists(customerName: string, excludeId?: string) {
    const existing = await this.prisma.customer.findFirst({
      where: {
        customerName: { equals: customerName, mode: 'insensitive' },
        id: excludeId ? { not: excludeId } : undefined
      },
      select: { id: true }
    });
    return Boolean(existing);
  }

  private async ensureCustomerNameAvailable(customerName: string, excludeId?: string) {
    if (await this.customerNameExists(customerName, excludeId)) {
      throw new BadRequestException(`Customer name ${customerName} already exists`);
    }
  }

  private async customerCodeExists(customerCode: string, excludeId?: string) {
    const existing = await this.prisma.customer.findFirst({
      where: {
        customerCode: { equals: customerCode, mode: 'insensitive' },
        id: excludeId ? { not: excludeId } : undefined
      },
      select: { id: true }
    });
    return Boolean(existing);
  }

  private async ensureCustomerCodeAvailable(customerCode: string, excludeId?: string) {
    if (await this.customerCodeExists(customerCode, excludeId)) {
      throw new BadRequestException(`Customer code ${customerCode} already exists`);
    }
  }

  private async generateCustomerCode() {
    const count = await this.prisma.customer.count();
    for (let index = count + 1; index < count + 1000; index += 1) {
      const code = `C-${String(index).padStart(3, '0')}`;
      if (!(await this.customerCodeExists(code))) {
        return code;
      }
    }
    throw new BadRequestException('Unable to generate customerCode');
  }

  private customerInclude() {
    return {
      contacts: {
        orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }]
      }
    };
  }

  private isDuplicateCustomerNameError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      JSON.stringify(error.meta || {}).includes('Customer_customerName_lower_key')
    );
  }

  private isDuplicateCustomerCodeError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      (JSON.stringify(error.meta || {}).includes('customerCode') ||
        JSON.stringify(error.meta || {}).includes('Customer_customerCode_lower_key'))
    );
  }
}
