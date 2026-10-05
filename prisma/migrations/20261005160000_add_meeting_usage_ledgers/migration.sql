CREATE TABLE "meeting_stt_usage" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "meetingId" TEXT,
    "userEmail" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "jobId" TEXT,
    "chunkIndex" INTEGER,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "sampleRate" INTEGER NOT NULL,
    "inputBytes" INTEGER NOT NULL,
    "audioDurationMs" INTEGER NOT NULL,
    "providerDurationMs" INTEGER,
    "status" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "upstreamStatusCode" INTEGER,
    "providerRequestId" TEXT,
    "providerCostUsd" DECIMAL(18,8),
    "detectedLanguage" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "meeting_stt_usage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "meeting_stt_usage_requestId_key" ON "meeting_stt_usage"("requestId");
CREATE INDEX "meeting_stt_usage_userEmail_startedAt_idx" ON "meeting_stt_usage"("userEmail", "startedAt");
CREATE INDEX "meeting_stt_usage_meetingId_startedAt_idx" ON "meeting_stt_usage"("meetingId", "startedAt");
CREATE INDEX "meeting_stt_usage_purpose_startedAt_idx" ON "meeting_stt_usage"("purpose", "startedAt");
CREATE INDEX "meeting_stt_usage_status_startedAt_idx" ON "meeting_stt_usage"("status", "startedAt");
CREATE INDEX "meeting_stt_usage_jobId_idx" ON "meeting_stt_usage"("jobId");

ALTER TABLE "meeting_stt_usage"
ADD CONSTRAINT "meeting_stt_usage_meetingId_fkey"
FOREIGN KEY ("meetingId") REFERENCES "meetings"("id")
ON DELETE SET NULL ON UPDATE CASCADE;


CREATE TABLE "meeting_ai_usage" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'dify',
    "app" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "requestedModel" TEXT,
    "providerModel" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "totalPrice" DECIMAL(18,8),
    "currency" TEXT,
    "latencyMs" INTEGER,
    "httpStatus" INTEGER,
    "status" TEXT NOT NULL,
    "providerRequestId" TEXT,
    "workflowRunId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_ai_usage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "meeting_ai_usage_requestId_key" ON "meeting_ai_usage"("requestId");
CREATE INDEX "meeting_ai_usage_userEmail_createdAt_idx" ON "meeting_ai_usage"("userEmail", "createdAt");
CREATE INDEX "meeting_ai_usage_app_createdAt_idx" ON "meeting_ai_usage"("app", "createdAt");
CREATE INDEX "meeting_ai_usage_feature_createdAt_idx" ON "meeting_ai_usage"("feature", "createdAt");
CREATE INDEX "meeting_ai_usage_providerModel_createdAt_idx" ON "meeting_ai_usage"("providerModel", "createdAt");
CREATE INDEX "meeting_ai_usage_status_createdAt_idx" ON "meeting_ai_usage"("status", "createdAt");
