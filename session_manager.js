#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

class SessionManager {
    constructor() {
        this.sessionPath = '.wwebjs_auth';
        this.cachePath = '.wwebjs_cache';
    }

    checkSession() {
        const sessionExists = fs.existsSync(this.sessionPath);
        const sessions = [];
        
        if (sessionExists) {
            try {
                const files = fs.readdirSync(this.sessionPath);
                const sessionDirs = files.filter(f => f.startsWith('session-'));
                
                sessionDirs.forEach(dir => {
                    const sessionId = dir.replace('session-', '');
                    const sessionFullPath = path.join(this.sessionPath, dir);
                    const stats = fs.statSync(sessionFullPath);
                    
                    sessions.push({
                        id: sessionId,
                        path: sessionFullPath,
                        created: stats.birthtime,
                        modified: stats.mtime,
                        size: this.getDirectorySize(sessionFullPath)
                    });
                });
            } catch (error) {
                console.error('Error reading sessions:', error);
            }
        }
        
        return sessions;
    }

    getDirectorySize(dirPath) {
        let size = 0;
        try {
            const files = fs.readdirSync(dirPath);
            files.forEach(file => {
                const filePath = path.join(dirPath, file);
                const stats = fs.statSync(filePath);
                if (stats.isFile()) {
                    size += stats.size;
                } else if (stats.isDirectory()) {
                    size += this.getDirectorySize(filePath);
                }
            });
        } catch (error) {
            // Silent fail
        }
        return size;
    }

    formatSize(bytes) {
        const sizes = ['B', 'KB', 'MB', 'GB'];
        if (bytes === 0) return '0 B';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }

    async logoutSession(sessionId = null) {
        if (sessionId) {
            const sessionDir = path.join(this.sessionPath, `session-${sessionId}`);
            if (fs.existsSync(sessionDir)) {
                fs.rmSync(sessionDir, { recursive: true, force: true });
                console.log(`✅ Logged out session: ${sessionId}`);
                return true;
            } else {
                console.log(`❌ Session not found: ${sessionId}`);
                return false;
            }
        } else {
            // Logout all sessions
            if (fs.existsSync(this.sessionPath)) {
                fs.rmSync(this.sessionPath, { recursive: true, force: true });
                console.log('✅ All WhatsApp sessions logged out');
                return true;
            } else {
                console.log('ℹ️  No active sessions found');
                return false;
            }
        }
    }

    clearCache() {
        if (fs.existsSync(this.cachePath)) {
            fs.rmSync(this.cachePath, { recursive: true, force: true });
            console.log('✅ WhatsApp cache cleared');
            return true;
        } else {
            console.log('ℹ️  No cache found');
            return false;
        }
    }

    async showStatus() {
        const sessions = this.checkSession();
        
        console.log('\n📱 WhatsApp Session Status');
        console.log('═'.repeat(50));
        
        if (sessions.length === 0) {
            console.log('No active sessions found.');
            console.log('You will need to scan QR code on next validation.');
        } else {
            console.log(`Active sessions: ${sessions.length}\n`);
            
            sessions.forEach((session, index) => {
                console.log(`Session ${index + 1}:`);
                console.log(`  ID: ${session.id}`);
                console.log(`  Created: ${session.created.toLocaleString()}`);
                console.log(`  Modified: ${session.modified.toLocaleString()}`);
                console.log(`  Size: ${this.formatSize(session.size)}`);
                console.log('');
            });
        }
        
        console.log('═'.repeat(50));
    }

    async interactiveMenu() {
        console.clear();
        console.log('═'.repeat(50));
        console.log('       WhatsApp Session Manager');
        console.log('═'.repeat(50));
        
        await this.showStatus();
        
        console.log('\nOptions:');
        console.log('1. Logout all sessions');
        console.log('2. Logout specific session');
        console.log('3. Clear cache');
        console.log('4. Clear everything (sessions + cache)');
        console.log('5. Exit\n');
        
        const choice = await question('Select option (1-5): ');
        
        switch(choice) {
            case '1':
                await this.logoutSession();
                break;
            case '2':
                const sessions = this.checkSession();
                if (sessions.length > 0) {
                    const sessionId = await question('Enter session ID to logout: ');
                    await this.logoutSession(sessionId);
                } else {
                    console.log('No sessions to logout');
                }
                break;
            case '3':
                await this.clearCache();
                break;
            case '4':
                await this.logoutSession();
                await this.clearCache();
                console.log('✅ All data cleared');
                break;
            case '5':
                console.log('👋 Goodbye!');
                rl.close();
                return;
        }
        
        const again = await question('\nPress Enter to continue...');
        await this.interactiveMenu();
    }
}

// Main execution
if (require.main === module) {
    const manager = new SessionManager();
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        manager.interactiveMenu().catch(console.error);
    } else {
        const command = args[0];
        
        switch(command) {
            case 'status':
                manager.showStatus();
                break;
            case 'logout':
                manager.logoutSession(args[1]);
                break;
            case 'clear':
                manager.clearCache();
                break;
            case 'reset':
                manager.logoutSession();
                manager.clearCache();
                break;
            default:
                console.log('Usage:');
                console.log('  node session_manager.js          - Interactive menu');
                console.log('  node session_manager.js status   - Show session status');
                console.log('  node session_manager.js logout   - Logout all sessions');
                console.log('  node session_manager.js clear    - Clear cache');
                console.log('  node session_manager.js reset    - Clear everything');
        }
        
        if (args.length > 0) {
            rl.close();
        }
    }
}

module.exports = SessionManager;