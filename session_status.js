#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function checkSessions() {
    const sessionPath = '.wwebjs_auth';
    
    console.log('═'.repeat(60));
    console.log('     📱 WHATSAPP SESSION STATUS');
    console.log('═'.repeat(60));
    console.log();
    
    if (!fs.existsSync(sessionPath)) {
        console.log('❌ No WhatsApp sessions found');
        console.log('   You will need to scan QR codes when running the validator');
        return;
    }
    
    try {
        const files = fs.readdirSync(sessionPath);
        const sessions = files.filter(f => f.startsWith('session-'));
        
        if (sessions.length === 0) {
            console.log('⚠️  Session directory exists but no active sessions found');
        } else {
            console.log(`✅ Found ${sessions.length} saved session(s):\n`);
            
            sessions.forEach((session, index) => {
                const sessionStats = fs.statSync(path.join(sessionPath, session));
                const lastModified = new Date(sessionStats.mtime);
                const ageInDays = Math.floor((Date.now() - lastModified) / (1000 * 60 * 60 * 24));
                
                console.log(`   ${index + 1}. ${session}`);
                console.log(`      Last used: ${lastModified.toLocaleDateString()} (${ageInDays} days ago)`);
            });
            
            console.log('\n💡 Sessions will be reused automatically');
            console.log('   Use "npm run logout" to clear all sessions');
        }
    } catch (error) {
        console.error('❌ Error checking sessions:', error.message);
    }
}

if (require.main === module) {
    checkSessions();
    console.log();
}