-- Track actual draft orders created by an Excel import session.
ALTER TABLE "OrderImportSession"
ADD COLUMN "committedOrderNos" JSONB;
