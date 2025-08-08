#!/usr/bin/env node

const readline = require('readline');
const { execSync } = require('child_process');
const fs = require('fs');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

function clearScreen() {
    console.clear();
}

function showHeader() {
    clearScreen();
    console.log('═'.repeat(60));
    console.log('     📱 JORDANIAN WHATSAPP NUMBER VALIDATOR');
    console.log('═'.repeat(60));
    console.log();
}

function showSessionStatus() {
    const sessionPath = '.wwebjs_auth';
    if (fs.existsSync(sessionPath)) {
        const files = fs.readdirSync(sessionPath);
        const sessions = files.filter(f => f.startsWith('session-'));
        if (sessions.length > 0) {
            console.log(`📱 Active Sessions: ${sessions.length} saved`);
        } else {
            console.log('⚠️  No saved sessions (QR scan required)');
        }
    } else {
        console.log('⚠️  No saved sessions (QR scan required)');
    }
    console.log();
}

async function showMenu() {
    showHeader();
    showSessionStatus();
    
    console.log('MAIN MENU:');
    console.log('1. Run WhatsApp Validator (Standard)');
    console.log('2. Run WhatsApp Validator (🛡️ SAFE Mode)');
    console.log('3. View Statistics');
    console.log('4. Export Database');
    console.log('5. Session Status');
    console.log('6. Logout Sessions');
    console.log('0. Exit');
    console.log();
    
    const choice = await question('Enter your choice (0-6): ');
    return choice.trim();
}

async function runValidator() {
    clearScreen();
    console.log('Starting WhatsApp Validator (Standard)...\n');
    try {
        execSync('node multi_whatsapp.js', { stdio: 'inherit' });
    } catch (error) {
        if (error.status !== 130) { // 130 is Ctrl+C
            console.error('\nError:', error.message);
        }
    }
    await question('\nPress Enter to return to menu...');
}

async function runSafeValidator() {
    clearScreen();
    console.log('Starting WhatsApp Validator (🛡️ SAFE MODE)...\n');
    console.log('⚠️  This mode includes anti-ban protection:');
    console.log('   • Random delays between checks');
    console.log('   • Regular breaks');
    console.log('   • Rate limiting');
    console.log('   • Session rotation\n');
    try {
        execSync('node multi_whatsapp_safe.js', { stdio: 'inherit' });
    } catch (error) {
        if (error.status !== 130) { // 130 is Ctrl+C
            console.error('\nError:', error.message);
        }
    }
    await question('\nPress Enter to return to menu...');
}

async function viewStats() {
    showHeader();
    try {
        execSync('node aggregator.js stats', { stdio: 'inherit' });
    } catch (error) {
        console.error('Error:', error.message);
    }
    await question('\nPress Enter to return to menu...');
}

async function exportDatabase() {
    showHeader();
    try {
        execSync('node aggregator.js export', { stdio: 'inherit' });
    } catch (error) {
        console.error('Error:', error.message);
    }
    await question('\nPress Enter to return to menu...');
}

async function checkSessions() {
    showHeader();
    try {
        execSync('node session_status.js', { stdio: 'inherit' });
    } catch (error) {
        console.error('Error:', error.message);
    }
    await question('Press Enter to return to menu...');
}

async function logoutSessions() {
    showHeader();
    console.log('LOGOUT WHATSAPP SESSIONS\n');
    
    const confirm = await question('Are you sure you want to logout all sessions? (y/n): ');
    
    if (confirm.toLowerCase() === 'y') {
        const sessionPath = '.wwebjs_auth';
        if (fs.existsSync(sessionPath)) {
            try {
                fs.rmSync(sessionPath, { recursive: true, force: true });
                console.log('\n✅ All sessions logged out successfully!');
            } catch (error) {
                console.error('\n❌ Error:', error.message);
            }
        } else {
            console.log('\n⚠️  No sessions to logout');
        }
    } else {
        console.log('\nCancelled');
    }
    
    await question('\nPress Enter to return to menu...');
}

async function main() {
    while (true) {
        const choice = await showMenu();
        
        switch (choice) {
            case '1':
                await runValidator();
                break;
            case '2':
                await runSafeValidator();
                break;
            case '3':
                await viewStats();
                break;
            case '4':
                await exportDatabase();
                break;
            case '5':
                await checkSessions();
                break;
            case '6':
                await logoutSessions();
                break;
            case '0':
            case 'exit':
            case 'quit':
                console.log('\n👋 Goodbye!\n');
                rl.close();
                process.exit(0);
                break;
            default:
                console.log('\n❌ Invalid choice. Please try again.');
                await question('Press Enter to continue...');
        }
    }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
    console.log('\n\n👋 Goodbye!\n');
    rl.close();
    process.exit(0);
});

// Start the application
main().catch(error => {
    console.error('Fatal error:', error);
    rl.close();
    process.exit(1);
});