const dotenv = require('dotenv');
const mongoose = require('mongoose');

const connectDatabase = require('../src/config/db');
const { syncAllContent } = require('../src/services/sync-content');

dotenv.config();

async function run() {
  const force = process.argv.includes('--force');

  try {
    await connectDatabase();
    const report = await syncAllContent({ force });
    console.log('Sync complete:', JSON.stringify(report, null, 2));
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Sync failed:', error.message);
    await mongoose.disconnect();
    process.exit(1);
  }
}

run();
