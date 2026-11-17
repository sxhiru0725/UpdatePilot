-- No release channel is currently verified by the manifest integration.
-- Clear the old inferred default instead of presenting it as source evidence.
ALTER TABLE "ReleaseMetadata" ALTER COLUMN "channel" DROP DEFAULT;
ALTER TABLE "ReleaseMetadata" ALTER COLUMN "channel" DROP NOT NULL;
UPDATE "ReleaseMetadata" SET "channel" = NULL WHERE "channel" = 'stable';
