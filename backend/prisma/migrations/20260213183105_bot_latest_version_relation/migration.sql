-- AddForeignKey
ALTER TABLE "Bot" ADD CONSTRAINT "Bot_latestVersionId_fkey" FOREIGN KEY ("latestVersionId") REFERENCES "BotVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
