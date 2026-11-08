import { applyUpdate, buildRestartPlan, getUpdateStatus, restartRuntime } from './modules/update/service.js';

async function main(): Promise<void> {
  const status = await getUpdateStatus();
  console.log(
    `[dorado-update] Versi saat ini: ${status.currentVersion} (${status.branch}@${status.currentCommit ?? '?'})`
  );

  if (status.error) {
    console.error(`[dorado-update] ${status.error}`);
    process.exit(1);
  }
  if (status.upToDate) {
    console.log('[dorado-update] Sudah versi terbaru.');
    process.exit(0);
  }
  if (status.dirty) {
    console.error('[dorado-update] Working tree kotor. Commit/stash dulu sebelum update.');
    process.exit(1);
  }

  console.log(`[dorado-update] ${status.behindCount} commit baru akan diterapkan:`);
  for (const commit of status.commits) console.log(`  - ${commit.hash} ${commit.subject}`);

  const result = await applyUpdate();
  for (const step of result.steps) {
    console.log(`\n[${step.ok ? 'OK' : 'GAGAL'}] ${step.step}`);
    const tail = step.output.split('\n').slice(-20).join('\n');
    if (tail) console.log(tail);
  }
  if (!result.ok) {
    console.error('\n[dorado-update] Update GAGAL. Runtime tidak di-restart.');
    process.exit(1);
  }
  console.log(`\n[dorado-update] Update selesai (commit ${result.newCommit}).`);

  const restartCmd = (process.env.UPDATE_RESTART_CMD ?? '').trim();
  if (buildRestartPlan(restartCmd, []).kind === 'none') {
    console.log(
      '[dorado-update] Update selesai. Restart runtime Anda sekarang (mis. `systemctl restart dorado` atau jalankan ulang server).'
    );
    process.exit(0);
  }
  console.log(`[dorado-update] Me-restart runtime via: ${restartCmd}`);
  restartRuntime();
  setTimeout(() => process.exit(0), 800);
}

main().catch((error) => {
  console.error('[dorado-update] Error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
