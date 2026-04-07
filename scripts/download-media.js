const { syncAllContent } = require('../src/services/sync-content');

async function run() {
  const force = process.argv.includes('--force');

  try {
    const report = await syncAllContent({ force, saveToDb: false });
    console.log('Download complete:', JSON.stringify(report, null, 2));
    process.exit(0);
  } catch (error) {
    console.error('Download failed:', error.message);
    process.exit(1);
  }
}

run();
