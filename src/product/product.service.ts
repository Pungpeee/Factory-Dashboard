import { BadRequestException, Injectable } from '@nestjs/common';
import { Model, Product } from '@prisma/client';
import { AlertService } from 'src/alert/alert.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductQuery } from './interface/product-query.interface';

@Injectable()
export class ProductService {
  constructor(
    private prisma: PrismaService,
    private alertService: AlertService,
  ) {}

  async create({ defect, employee, ...createProductDto }: CreateProductDto) {
    let product: Product;
    const model = await this.prisma.model.findUnique({
      where: { modelId: createProductDto.modelId },
    });
    if (!model) throw new BadRequestException('model not found');
    const existProduct = await this.prisma.product.findUnique({
      where: { serialNumber: createProductDto.serialNumber },
    });
    // if product exist but finish
    if (existProduct && existProduct?.isGoods)
      throw new BadRequestException(
        'there is conflict pin number please provide another pin number',
      );

    // checking defect or employee is empty
    if (defect) {
      if (!employee)
        throw new BadRequestException(
          'defect must has employee data who inserted',
        );
    } else if (employee) {
      if (!defect)
        throw new BadRequestException(
          "there is employee data but doesn't has defect",
        );
    }

    if (!defect && !employee) {
      if (existProduct) {
        // if exist product not finish and convert to goods
        product = await this.prisma.product.update({
          data: { isGoods: true },
          where: { productId: existProduct.productId },
        });
        return product;
      }
      // if product not exist and it's good
      product = await this.prisma.product.create({
        data: { isGoods: true, ...createProductDto },
      });
    } else {
      // if product not finish and have more failure or new defect product
      product = await this.createProductDefect(
        { defect, employee, ...createProductDto },
        model,
        existProduct,
      );
    }
    await this.alertService.alertWhenBelowCriteria(
      model.lineId,
      createProductDto.timestamp,
    );
    return product;
  }

  async createProductDefect(
    { defect, employee, ...createProductDto }: CreateProductDto,
    model: Model,
    existProduct?: Product,
  ) {
    const workingTime = await this.prisma.workingTime.findFirst({
      where: {
        lineId: model.lineId,
        shift: employee.shift,
        type: employee.workingTimeType,
      },
    });
    if (!workingTime) throw new BadRequestException('working time not found');
    const existEmployee = await this.prisma.employee.findUnique({
      where: { employeeId: employee.employeeId },
    });
    if (!existEmployee)
      throw new BadRequestException('employee data not found');
    const employeeShift = await this.prisma.employeeShift.findFirst({
      where: {
        employeeId: existEmployee.employeeId,
        group: employee.group,
        workingTimeId: workingTime.workingTimeId,
      },
    });
    const failureDetail = await this.prisma.failureDetail.findFirst({
      where: {
        failureDetailId: defect.failureDetailId,
        lineId: model.lineId,
      },
    });
    if (!failureDetail)
      throw new BadRequestException(
        'failure detail id is invalid, maybe it not exist in this fabricator line',
      );
    const station = await this.prisma.station.findFirst({
      where: { stationId: defect.stationId, lineId: model.lineId },
    });
    if (!station)
      throw new BadRequestException(
        'station id is invalid, maybe it not exist in this fabricator line',
      );

    const failure = await this.prisma.failure.create({
      data: {
        position: defect.position,
        failureDetail: {
          connect: { failureDetailId: defect.failureDetailId },
        },
        station: { connect: { stationId: defect.stationId } },
        employeeShift: {
          connectOrCreate: {
            create: {
              group: employee.group,
              employee: { connect: { employeeId: employee.employeeId } },
              workingTime: {
                connect: { workingTimeId: workingTime.workingTimeId },
              },
            },
            where: { employeeShiftId: employeeShift?.employeeShiftId || -1 },
          },
        },
      },
    });
    let product: Product = existProduct;
    if (!existProduct) {
      product = await this.prisma.product.create({
        data: { isGoods: false, ...createProductDto },
      });
    }
    await this.prisma.productHaveFailure.create({
      data: {
        failureId: failure.failureId,
        productId: existProduct ? existProduct.productId : product.productId,
        timestamp: createProductDto.timestamp,
      },
    });
    return product;
  }

  async findAll() {
    return await this.prisma.product.findMany();
  }

  async findOne(id: number) {
    return await this.prisma.product.findUnique({
      where: { productId: id },
    });
  }
}
