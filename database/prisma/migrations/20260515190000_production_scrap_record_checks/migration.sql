-- 生产报废记录只追加历史，必须保留正数量、可追溯快照和第一阶段已知来源类型。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionScrapRecord_identity_not_blank'
  ) THEN
    ALTER TABLE "ProductionScrapRecord"
    ADD CONSTRAINT "ProductionScrapRecord_identity_not_blank"
    CHECK (
      BTRIM("scrapNo") <> ''
      AND BTRIM("orderNo") <> ''
      AND ("productionTaskNo" IS NULL OR BTRIM("productionTaskNo") <> '')
      AND BTRIM("partCode") <> ''
      AND BTRIM("partName") <> ''
      AND BTRIM("unit") <> ''
      AND BTRIM("reason") <> ''
      AND BTRIM("sourceRecordType") <> ''
      AND BTRIM("sourceRecordId") <> ''
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionScrapRecord_quantity_positive'
  ) THEN
    ALTER TABLE "ProductionScrapRecord"
    ADD CONSTRAINT "ProductionScrapRecord_quantity_positive"
    CHECK ("quantity" > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionScrapRecord_source_type_valid'
  ) THEN
    ALTER TABLE "ProductionScrapRecord"
    ADD CONSTRAINT "ProductionScrapRecord_source_type_valid"
    CHECK (
      "sourceRecordType" IN (
        'ProductionProcessCompletion',
        'ProductionProcessCompletionScrapCancelled',
        'ProductionProcessCompletionWithdrawSnapshot',
        'ProductionTaskWithdraw',
        'CustomerChangeWarehouseScrap'
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionScrapRecord_archive_source_marker_valid'
  ) THEN
    ALTER TABLE "ProductionScrapRecord"
    ADD CONSTRAINT "ProductionScrapRecord_archive_source_marker_valid"
    CHECK (
      ("sourceRecordType" <> 'ProductionProcessCompletionScrapCancelled' OR POSITION(':scrap-cancel:' IN "sourceRecordId") > 0)
      AND ("sourceRecordType" <> 'ProductionProcessCompletionWithdrawSnapshot' OR POSITION(':withdraw:' IN "sourceRecordId") > 0)
      AND (
        "sourceRecordType" <> 'ProductionTaskWithdraw'
        OR "productionTaskId" IS NULL
        OR "sourceRecordId" LIKE ("productionTaskId" || ':%')
      )
    );
  END IF;
END $$;
