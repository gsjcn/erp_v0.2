UPDATE "Customer"
SET "province" = '江苏省'
WHERE "regionType" = 'CHINA'
  AND "province" IS NULL
  AND "address" LIKE '%江苏省%';

UPDATE "Customer"
SET "city" = '常州市'
WHERE "regionType" = 'CHINA'
  AND "city" IS NULL
  AND "address" LIKE '%常州市%';

UPDATE "Customer"
SET "city" = '无锡市'
WHERE "regionType" = 'CHINA'
  AND "city" IS NULL
  AND "address" LIKE '%无锡市%';

UPDATE "Customer"
SET "city" = '苏州市'
WHERE "regionType" = 'CHINA'
  AND "city" IS NULL
  AND "address" LIKE '%苏州市%';
