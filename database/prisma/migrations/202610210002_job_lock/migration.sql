-- PostgreSQL enforces a single active operation per device, including competing API requests.
CREATE UNIQUE INDEX "Job_one_active_per_device" ON "Job" ("deviceId")
WHERE "status" IN ('QUEUED', 'RUNNING', 'VERIFYING');
