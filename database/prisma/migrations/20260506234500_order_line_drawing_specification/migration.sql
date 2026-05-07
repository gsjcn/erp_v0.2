ALTER TABLE "OrderLine"
  ADD COLUMN "drawingVersion" TEXT,
  ADD COLUMN "drawingFileName" TEXT,
  ADD COLUMN "drawingFileUrl" TEXT,
  ADD COLUMN "partThickness" DECIMAL(18,3) NOT NULL DEFAULT 1,
  ADD COLUMN "partSpecification" TEXT;
