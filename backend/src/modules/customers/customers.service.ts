import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CommonStatus, CustomerRegionType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeSearchKeyword, pinyinSearchMatches } from '../../common/pinyin-search';
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
    const keyword = normalizeSearchKeyword(query.keyword);
    const withPage = query.withPage === 'true';
    const limit = Math.min(Math.max(query.limit || 50, 1), 200);
    const offset = Math.max(query.offset || 0, 0);

    if (query.status) {
      where.status = query.status;
    }

    const customers = await this.prisma.customer.findMany({
      where,
      include: this.customerInclude(),
      orderBy: [{ status: 'asc' }, { customerCode: 'asc' }]
    });

    const matchedCustomers = keyword
      ? customers
          .filter((customer) => this.customerMatchesKeyword(customer, keyword))
          .sort((left, right) => this.compareCustomerSearchResults(left, right, keyword))
      : customers;

    if (!withPage) {
      return matchedCustomers;
    }

    const totalCount = matchedCustomers.length;
    const items = matchedCustomers.slice(offset, offset + limit);
    // 客户搜索分页必须把总数和是否还有更多返回给前端，避免下拉静默截断导致误选。
    return {
      items,
      totalCount,
      limit,
      offset,
      hasMore: offset + items.length < totalCount
    };
  }

  async findOne(id: string) {
    // 客户下拉和跨页面跳转按 id 回填客户名称，不改变客户软停用和历史数据规则。
    return this.ensureExistsWithContacts(id);
  }

  async checkName(query: CheckCustomerNameQueryDto) {
    const customerName = query.customerName.trim();
    if (!customerName) {
      throw new BadRequestException('客户名称不能为空');
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
      throw new BadRequestException('客户ID不能为空');
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
    const customerName = this.normalizeRequired(dto.customerName, '客户名称不能为空');
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
        throw new BadRequestException(`客户名称 ${customerName} 已存在，请修改后再保存`);
      }
      if (this.isDuplicateCustomerCodeError(error)) {
        throw new BadRequestException(`客户ID ${customerCode} 已存在，请修改后再保存`);
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateCustomerDto) {
    const existing = await this.ensureExistsWithContacts(id);

    const customerName =
      dto.customerName !== undefined ? this.normalizeRequired(dto.customerName, '客户名称不能为空') : undefined;
    if (customerName) {
      await this.ensureCustomerNameAvailable(customerName, id);
    }
    if (dto.customerCode?.trim() && dto.customerCode.trim() !== existing.customerCode) {
      throw new BadRequestException('客户ID创建后不可修改');
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
    const shouldUpdateContacts = dto.contacts !== undefined || dto.contactName !== undefined || dto.contactPhone !== undefined;
    const contacts = shouldUpdateContacts
      ? this.normalizeContacts(dto.contacts, dto.contactName, dto.contactPhone)
      : this.normalizeExistingContacts(existing.contacts);
    const primaryContact = contacts.find((contact) => contact.isPrimary);

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (shouldUpdateContacts) {
          await tx.customerContact.deleteMany({ where: { customerId: id } });
        }
        return tx.customer.update({
          where: { id },
          data: {
            customerName,
            ...regionData,
            // 没有联系人时必须清空主表联系人快照，避免停用客户看起来仍有可用联系人。
            contactName: primaryContact ? primaryContact.contactName : null,
            contactPhone: primaryContact ? primaryContact.contactPhone : null,
            address: this.buildAddress(regionData),
            remark: dto.remark?.trim(),
            status: contacts.length ? existing.status : CommonStatus.DISABLED,
            ...(shouldUpdateContacts && contacts.length ? { contacts: { create: contacts } } : {})
          },
          include: this.customerInclude()
        });
      });
    } catch (error) {
      if (this.isDuplicateCustomerNameError(error)) {
        throw new BadRequestException(`客户名称 ${customerName} 已存在，请修改后再保存`);
      }
      if (this.isDuplicateCustomerCodeError(error)) {
        throw new BadRequestException(`客户ID ${existing.customerCode} 已存在，请修改后再保存`);
      }
      throw error;
    }
  }

  async updateStatus(id: string, dto: UpdateCustomerStatusDto) {
    await this.ensureExists(id);

    if (dto.status === CommonStatus.ENABLED) {
      const primaryContactCount = await this.prisma.customerContact.count({ where: { customerId: id, isPrimary: true } });
      if (primaryContactCount === 0) {
        throw new BadRequestException('没有主要联系人，不能启用客户');
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
      throw new NotFoundException('客户不存在');
    }
    return customer;
  }

  private async ensureExistsWithContacts(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: this.customerInclude()
    });
    if (!customer) {
      throw new NotFoundException('客户不存在');
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
      const province = this.normalizeRequired(dto.province, '中国地区客户必须选择省份');
      const city = this.normalizeRequired(dto.city, '中国地区客户必须选择城市');
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

    const country = this.normalizeRequired(dto.country, '国外地区客户必须选择国家');
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
    const fallbackContactName = fallbackName?.trim();
    const fallbackContactPhone = fallbackPhone?.trim();
    if (!contacts?.length && !fallbackContactName && fallbackContactPhone) {
      throw new BadRequestException('联系人姓名不能为空');
    }

    const source =
      contacts && contacts.length > 0
        ? contacts
        : fallbackContactName
          ? [{ contactName: fallbackContactName, contactPhone: fallbackContactPhone, isPrimary: true }]
          : [];

    const hasIncompleteContact = source.some(
      (contact) =>
        !contact.contactName?.trim() &&
        Boolean(contact.contactPhone?.trim() || contact.title?.trim() || contact.remark?.trim())
    );
    if (hasIncompleteContact) {
      throw new BadRequestException('联系人姓名不能为空');
    }

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
      throw new BadRequestException('有联系人时必须且只能选择一个主要联系人');
    }

    return normalized;
  }

  private normalizeExistingContacts(
    contacts: Array<{
      contactName: string;
      contactPhone?: string | null;
      title?: string | null;
      remark?: string | null;
      isPrimary?: boolean | null;
    }>
  ) {
    // PATCH 未传联系人时保留原联系人，避免局部更新误删联系人并自动停用客户。
    return contacts.map((contact) => ({
      contactName: contact.contactName.trim(),
      contactPhone: contact.contactPhone?.trim() || null,
      title: contact.title?.trim() || null,
      remark: contact.remark?.trim() || null,
      isPrimary: Boolean(contact.isPrimary)
    }));
  }

  private buildAddress(region: ReturnType<CustomersService['normalizeRegion']>) {
    const parts =
      region.regionType === CustomerRegionType.CHINA
        ? [region.country, region.province, region.city, region.district, region.detailAddress]
        : [region.country, region.state, region.province, region.district, region.city, region.detailAddress];
    return parts.filter(Boolean).join(' ');
  }

  private customerMatchesKeyword(customer: any, keyword: string) {
    // 客户资料搜索不能只依赖数据库 contains；拼音和首字母需要后端统一生成，避免不同终端规则不一致。
    const contactParts = (customer.contacts || []).flatMap((contact: any) => [
      contact.contactName,
      contact.contactPhone,
      contact.title,
      contact.remark
    ]);
    const searchParts = [
      customer.customerCode,
      customer.customerName,
      customer.contactName,
      customer.contactPhone,
      customer.address,
      customer.country,
      customer.province,
      customer.state,
      customer.district,
      customer.city,
      customer.detailAddress,
      customer.remark,
      ...contactParts
    ];
    return pinyinSearchMatches(searchParts, keyword);
  }

  private compareCustomerSearchResults(left: any, right: any, keyword: string) {
    const rankDiff = this.customerSearchRank(right, keyword) - this.customerSearchRank(left, keyword);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return String(left.customerName || '').localeCompare(String(right.customerName || ''), 'zh-Hans-CN');
  }

  private customerSearchRank(customer: any, keyword: string) {
    const customerCode = normalizeSearchKeyword(customer.customerCode);
    const customerName = normalizeSearchKeyword(customer.customerName);
    if (customerCode === keyword) {
      return 1000;
    }
    if (customerName === keyword) {
      return 960;
    }
    if (customerCode.startsWith(keyword)) {
      return 920;
    }
    if (customerName.startsWith(keyword)) {
      return 900;
    }
    if (customerCode.includes(keyword)) {
      return 860;
    }
    if (customerName.includes(keyword)) {
      return 840;
    }
    if (pinyinSearchMatches([customer.customerName], keyword)) {
      return 820;
    }
    if (pinyinSearchMatches([customer.contactName, customer.contactPhone, customer.remark], keyword)) {
      return 760;
    }
    if (
      pinyinSearchMatches(
        (customer.contacts || []).flatMap((contact: any) => [
          contact.contactName,
          contact.contactPhone,
          contact.title,
          contact.remark
        ]),
        keyword
      )
    ) {
      return 720;
    }
    return 0;
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
      throw new BadRequestException(`客户名称 ${customerName} 已存在，请修改后再保存`);
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
      throw new BadRequestException(`客户ID ${customerCode} 已存在，请修改后再保存`);
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
    throw new BadRequestException('无法自动生成客户ID，请手工填写');
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
