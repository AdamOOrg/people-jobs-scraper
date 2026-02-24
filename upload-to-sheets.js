/**
 * 📊 Upload job results to Google Sheets
 * 
 * This script reads the latest scraper output and appends it
 * to a Google Sheet. Uses a Google Service Account for auth.
 * 
 * Setup: See SETUP.md for how to create a service account.
 */

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// ============================================================
// CONFIGURATION (set via environment variables or .env)
// ============================================================

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'Jobs';
const SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

async function uploadToSheets() {
  // Find the latest summary file
  const outputDir = path.join(__dirname, 'output');
  const files = fs.readdirSync(outputDir).filter(f => f.startsWith('summary-') && f.endsWith('.json'));
  
  if (files.length === 0) {
    console.log('❌ No summary files found. Run the scraper first.');
    return;
  }

  // Sort and get latest
  files.sort().reverse();
  const latestFile = path.join(outputDir, files[0]);
  const data = JSON.parse(fs.readFileSync(latestFile, 'utf8'));

  console.log(`📂 Loading ${data.jobs.length} jobs from ${files[0]}`);

  if (!SPREADSHEET_ID || !SERVICE_ACCOUNT_KEY) {
    console.log('\n⚠️  Google Sheets credentials not configured.');
    console.log('   Set GOOGLE_SHEET_ID and GOOGLE_SERVICE_ACCOUNT_KEY environment variables.');
    console.log('   See SETUP.md for instructions.\n');
    console.log('📁 Your results are still available as CSV in the output/ folder.');
    return;
  }

  // Parse service account key
  let credentials;
  try {
    credentials = JSON.parse(SERVICE_ACCOUNT_KEY);
  } catch (e) {
    console.error('❌ Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY. Make sure it\'s valid JSON.');
    return;
  }

  // Authenticate
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Check if sheet exists, create headers if needed
  try {
    const sheetInfo = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const sheetNames = sheetInfo.data.sheets.map(s => s.properties.title);
    
    if (!sheetNames.includes(SHEET_NAME)) {
      // Add the sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: [{
            addSheet: { properties: { title: SHEET_NAME } }
          }]
        }
      });

      // Add headers
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A1:G1`,
        valueInputOption: 'RAW',
        resource: {
          values: [['Date Found', 'Title', 'Company', 'Salary', 'Location', 'Platform', 'URL']]
        }
      });

      console.log(`✅ Created "${SHEET_NAME}" sheet with headers`);
    }
  } catch (error) {
    console.error(`❌ Error accessing spreadsheet: ${error.message}`);
    return;
  }

  // Prepare rows
  const rows = data.jobs.map(job => [
    data.date,
    job.title || '',
    job.company || '',
    job.salary || '',
    job.location || '',
    job.platform || '',
    job.url || '',
  ]);

  if (rows.length === 0) {
    console.log('ℹ️  No jobs to upload this week.');
    return;
  }

  // Append rows
  try {
    const result = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:G`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: rows },
    });

    console.log(`✅ Uploaded ${rows.length} jobs to Google Sheets!`);
    console.log(`   Sheet: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`);
  } catch (error) {
    console.error(`❌ Error uploading to Sheets: ${error.message}`);
  }

  // Also save the LinkedIn post draft
  const postFiles = fs.readdirSync(outputDir).filter(f => f.startsWith('linkedin-post-'));
  if (postFiles.length > 0) {
    postFiles.sort().reverse();
    const postContent = fs.readFileSync(path.join(outputDir, postFiles[0]), 'utf8');
    
    // Append LinkedIn post to a separate "Posts" tab
    try {
      const sheetInfo = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
      const sheetNames = sheetInfo.data.sheets.map(s => s.properties.title);
      
      if (!sheetNames.includes('LinkedIn Posts')) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          resource: {
            requests: [{
              addSheet: { properties: { title: 'LinkedIn Posts' } }
            }]
          }
        });

        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `'LinkedIn Posts'!A1:B1`,
          valueInputOption: 'RAW',
          resource: { values: [['Date', 'Post Draft']] }
        });
      }

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `'LinkedIn Posts'!A:B`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: [[data.date, postContent]] },
      });

      console.log('✅ LinkedIn post draft also saved to "LinkedIn Posts" tab');
    } catch (error) {
      console.log(`⚠️  Could not save LinkedIn post to Sheets: ${error.message}`);
    }
  }
}

uploadToSheets().catch(console.error);
