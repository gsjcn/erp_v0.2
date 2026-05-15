-- 库存盘点调整必须保留非负数量、差异公式、签字和附件信息，避免绕过后端静默改库存。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InventoryAdjustment_quantities_valid'
  ) THEN
    ALTER TABLE "InventoryAdjustment"
    ADD CONSTRAINT "InventoryAdjustment_quantities_valid"
    CHECK (
      "beforeQuantity" >= 0
      AND "afterQuantity" >= 0
      AND "deltaQuantity" = "afterQuantity" - "beforeQuantity"
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InventoryAdjustment_identity_not_blank'
  ) THEN
    ALTER TABLE "InventoryAdjustment"
    ADD CONSTRAINT "InventoryAdjustment_identity_not_blank"
    CHECK (
      BTRIM("adjustmentNo") <> ''
      AND BTRIM("partCode") <> ''
      AND BTRIM("partName") <> ''
      AND BTRIM("unit") <> ''
      AND BTRIM("countedBy") <> ''
      AND BTRIM("signatureName") <> ''
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InventoryAdjustment_attachment_required'
  ) THEN
    ALTER TABLE "InventoryAdjustment"
    ADD CONSTRAINT "InventoryAdjustment_attachment_required"
    CHECK (
      "attachmentFileName" IS NOT NULL
      AND BTRIM("attachmentFileName") <> ''
      AND "attachmentFileUrl" IS NOT NULL
      AND BTRIM("attachmentFileUrl") <> ''
      AND ("attachmentSize" IS NULL OR "attachmentSize" >= 0)
    );
  END IF;
END $$;
