import { Worker } from 'bullmq';
import { prisma } from '../../utils/prisma.js';
import { connection } from '../../lib/redis.js';
import { buildVersion, storagePathsForVersion } from '../../builder/build.js';

export async function handleBuildJob(job) {
  const { botId, versionId } = job.data || {};
  if (!botId || !versionId) return;
  const version = await prisma.botVersion.findUnique({ where: { id: versionId } });
  if (!version || version.botId !== botId) return;
  const { zipPath } = storagePathsForVersion(versionId);
  try {
    await prisma.botVersion.update({ where: { id: versionId }, data: { status: 'built' } });
    const out = await buildVersion({ botId, versionId, zipPath });
    if (out.status === 'rejected') {
      await prisma.botVersion.update({
        where: { id: versionId },
        data: { status: 'rejected', notes: (out.reasons || []).join('; ') }
      });
      return;
    }

    await prisma.botVersion.update({
      where: { id: versionId },
      data: {
        status: 'scanned',
        imageRef: out.imageRef,
        sbomRef: out.sbomRef,
        signedDigest: out.signedDigest
      }
    });

    await prisma.botVersion.update({
      where: { id: versionId },
      data: { status: out.status || 'approved' }
    });
  } catch (e) {
    await prisma.botVersion.update({
      where: { id: versionId },
      data: { status: 'rejected', notes: String(e?.message || e) }
    });
  }
}

export function startBuildWorker() {
  if (!connection) return null;
  const worker = new Worker('build', handleBuildJob, { connection, concurrency: 2 });
  worker.on('error', (err) => console.error('[build.worker] error', err));
  return worker;
}
