ALTER TABLE "meetings"
ADD COLUMN "diarizationStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN "diarizationError" TEXT,
ADD COLUMN "enrichmentStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN "enrichmentError" TEXT;
