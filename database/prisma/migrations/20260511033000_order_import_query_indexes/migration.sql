-- Improve large Excel import preview and commit lookups.
CREATE INDEX "OrderImportRow_sessionId_orderNo_sourceRowNo_idx"
ON "OrderImportRow"("sessionId", "orderNo", "sourceRowNo");
