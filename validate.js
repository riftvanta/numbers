#!/usr/bin/env node

// Quick validation script - directly runs multi-session validator
const { execSync } = require('child_process');

console.log('🚀 Starting WhatsApp Validator...\n');

try {
    execSync('node multi_whatsapp.js', { stdio: 'inherit' });
} catch (error) {
    if (error.signal !== 'SIGINT') {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

process.exit(0);