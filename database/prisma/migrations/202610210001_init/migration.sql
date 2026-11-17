-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('SCAN', 'UPDATE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'VERIFYING', 'COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'RESTART_REQUIRED', 'VERIFICATION_FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retentionDays" INTEGER NOT NULL DEFAULT 90,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pairing" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "Pairing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "agentVersion" TEXT NOT NULL,
    "wingetVersion" TEXT,
    "health" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCredential" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AgentCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentNonce" (
    "id" UUID NOT NULL,
    "credentialId" UUID NOT NULL,
    "nonce" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentNonce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "identity" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publisher" TEXT,
    "installedVersion" TEXT NOT NULL,
    "availableVersion" TEXT,
    "packageId" TEXT,
    "source" TEXT,
    "status" TEXT NOT NULL,
    "lastObserved" TIMESTAMP(3) NOT NULL,
    "present" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseMetadata" (
    "id" UUID NOT NULL,
    "packageId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'stable',
    "publisher" TEXT,
    "officialUrl" TEXT,
    "changelogUrl" TEXT,
    "releaseNotes" TEXT,
    "releaseDate" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpdateApproval" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "appId" UUID NOT NULL,
    "fromVersion" TEXT NOT NULL,
    "targetVersion" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "UpdateApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" UUID NOT NULL,
    "kind" "JobKind" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "deviceId" UUID NOT NULL,
    "appId" UUID,
    "initiatorId" UUID NOT NULL,
    "packageId" TEXT,
    "source" TEXT,
    "previousVersion" TEXT,
    "targetVersion" TEXT,
    "resultingVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "leaseHash" TEXT,
    "exitCode" INTEGER,
    "error" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "detectedCount" INTEGER,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanSnapshot" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "appId" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "ScanSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "deviceId" UUID,
    "type" TEXT NOT NULL,
    "target" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityFinding" (
    "id" UUID NOT NULL,
    "packageId" TEXT NOT NULL,
    "advisoryId" TEXT NOT NULL,
    "severity" TEXT,
    "affectedRange" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "advisoryUrl" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Pairing_tokenHash_key" ON "Pairing"("tokenHash");

-- CreateIndex
CREATE INDEX "Device_ownerId_lastSeen_idx" ON "Device"("ownerId", "lastSeen");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCredential_tokenHash_key" ON "AgentCredential"("tokenHash");

-- CreateIndex
CREATE INDEX "AgentNonce_createdAt_idx" ON "AgentNonce"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentNonce_credentialId_nonce_key" ON "AgentNonce"("credentialId", "nonce");

-- CreateIndex
CREATE INDEX "Application_deviceId_present_status_idx" ON "Application"("deviceId", "present", "status");

-- CreateIndex
CREATE INDEX "Application_name_idx" ON "Application"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Application_deviceId_identity_key" ON "Application"("deviceId", "identity");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseMetadata_packageId_version_source_key" ON "ReleaseMetadata"("packageId", "version", "source");

-- CreateIndex
CREATE UNIQUE INDEX "UpdateApproval_tokenHash_key" ON "UpdateApproval"("tokenHash");

-- CreateIndex
CREATE INDEX "Job_deviceId_status_createdAt_idx" ON "Job"("deviceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Job_initiatorId_createdAt_idx" ON "Job"("initiatorId", "createdAt");

-- CreateIndex
CREATE INDEX "ScanSnapshot_jobId_idx" ON "ScanSnapshot"("jobId");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_createdAt_idx" ON "AuditEvent"("actorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityFinding_packageId_advisoryId_source_key" ON "SecurityFinding"("packageId", "advisoryId", "source");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCredential" ADD CONSTRAINT "AgentCredential_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentNonce" ADD CONSTRAINT "AgentNonce_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "AgentCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpdateApproval" ADD CONSTRAINT "UpdateApproval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpdateApproval" ADD CONSTRAINT "UpdateApproval_appId_fkey" FOREIGN KEY ("appId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_appId_fkey" FOREIGN KEY ("appId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanSnapshot" ADD CONSTRAINT "ScanSnapshot_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanSnapshot" ADD CONSTRAINT "ScanSnapshot_appId_fkey" FOREIGN KEY ("appId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
