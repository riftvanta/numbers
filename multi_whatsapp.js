#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const readline = require('readline');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { createObjectCsvWriter } = require('csv-writer');
const WhatsAppAggregator = require('./aggregator');
const { generateJordanianNumbers, saveNumbersToCSV, loadNumbersFromCSV } = require('./generate_numbers');
const config = require('./config');

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

class MultiWhatsAppValidator {
    constructor(options = {}) {
        this.options = {
            sessions: options.sessions || 1,
            checkDelay: options.checkDelay || 1000,
            batchSize: options.batchSize || 100,
            ...options
        };
        
        this.whatsappSessions = [];
        this.whatsappClients = [];
        
        this.stats = {
            total: 0,
            checked: 0,
            verified: 0,
            errors: 0,
            startTime: null,
            endTime: null
        };
        
        this.results = [];
    }

    async initialize() {
        clearScreen();
        console.log('═'.repeat(60));
        console.log('    🚀 MULTI-SESSION WHATSAPP VALIDATOR');
        console.log('═'.repeat(60));
        console.log(`\n📋 Configuration:`);
        console.log(`   • Sessions: ${this.options.sessions}`);
        console.log(`   • Check Delay: ${this.options.checkDelay}ms`);
        console.log(`   • Batch Size: ${this.options.batchSize}\n`);
        
        console.log(`🟢 Initializing ${this.options.sessions} WhatsApp session(s)...\n`);
        
        for (let i = 0; i < this.options.sessions; i++) {
            await this.initializeSession(i);
        }
        
        console.log('\n✅ All sessions ready!\n');
    }

    async initializeSession(index) {
        const sessionName = `session-${index}`;
        const sessionPath = `.wwebjs_auth/session-${sessionName}`;
        const sessionExists = fs.existsSync(sessionPath);
        
        console.log(`📱 Session ${index + 1}/${this.options.sessions}:`);
        
        if (sessionExists) {
            console.log(`   ✓ Found existing session`);
        } else {
            console.log(`   ⚠ New session - QR code required`);
        }
        
        const client = new Client({
            authStrategy: new LocalAuth({
                clientId: sessionName,
                dataPath: '.wwebjs_auth'
            }),
            puppeteer: {
                headless: 'new',
                args: config.puppeteer.args
            }
        });

        const session = {
            id: index,
            name: sessionName,
            client: client,
            ready: false,
            busy: false,
            checked: 0,
            verified: 0,
            errors: 0
        };

        client.on('qr', (qr) => {
            console.log(`\n📱 Session ${index + 1}: Scan this QR code:\n`);
            qrcode.generate(qr, { small: true });
        });

        client.on('authenticated', () => {
            console.log(`   ✓ Authenticated successfully`);
        });

        client.on('ready', () => {
            console.log(`   ✅ Ready!`);
            session.ready = true;
        });

        client.on('auth_failure', (msg) => {
            console.error(`   ❌ Authentication failed:`, msg);
        });

        client.on('disconnected', (reason) => {
            console.log(`   🔌 Disconnected:`, reason);
            session.ready = false;
        });

        await client.initialize();
        
        while (!session.ready) {
            await this.delay(1000);
        }
        
        this.whatsappClients.push(client);
        this.whatsappSessions.push(session);
    }

    async validateBatch(numbers) {
        this.stats.total = numbers.length;
        this.stats.startTime = Date.now();
        
        console.log('═'.repeat(60));
        console.log('📊 VALIDATION STARTED');
        console.log('═'.repeat(60));
        console.log(`Total numbers: ${numbers.length}`);
        console.log(`Using ${this.options.sessions} parallel session(s)\n`);
        
        const chunks = this.distributeWork(numbers, this.options.sessions);
        const promises = [];
        
        for (let i = 0; i < this.options.sessions; i++) {
            if (chunks[i] && chunks[i].length > 0) {
                promises.push(this.validateSessionChunk(this.whatsappSessions[i], chunks[i]));
            }
        }
        
        const results = await Promise.all(promises);
        this.results = results.flat();
        
        this.stats.endTime = Date.now();
        this.stats.checked = this.results.length;
        this.stats.verified = this.results.filter(r => r.is_registered).length;
        this.stats.errors = this.results.filter(r => r.status === 'error').length;
        
        this.showStatistics();
        
        return this.results;
    }

    async validateSessionChunk(session, numbers) {
        const results = [];
        const total = numbers.length;
        
        console.log(`📱 Session ${session.id + 1}: Processing ${total} numbers...`);
        
        for (let i = 0; i < numbers.length; i++) {
            const number = numbers[i].number || numbers[i];
            
            if ((i + 1) % 10 === 0 || i === numbers.length - 1) {
                const progress = ((i + 1) / total * 100).toFixed(1);
                console.log(`   Session ${session.id + 1}: [${i + 1}/${total}] ${progress}% - Verified: ${session.verified}`);
            }
            
            const result = await this.validateNumber(session, number);
            results.push(result);
            session.checked++;
            
            if (result.is_registered) {
                session.verified++;
            }
            
            if (i < numbers.length - 1) {
                await this.delay(this.options.checkDelay);
            }
            
            if ((i + 1) % this.options.batchSize === 0 && i < numbers.length - 1) {
                console.log(`   Session ${session.id + 1}: Taking 5-second break...`);
                await this.delay(5000);
            }
        }
        
        console.log(`✅ Session ${session.id + 1}: Completed (${session.verified}/${total} verified)\n`);
        
        return results;
    }

    async validateNumber(session, number) {
        try {
            const formattedNumber = number.replace(/[^\d]/g, '');
            const whatsappId = formattedNumber.startsWith('962') 
                ? `${formattedNumber}@c.us`
                : `962${formattedNumber.substring(1)}@c.us`;

            const isRegistered = await session.client.isRegisteredUser(whatsappId);
            
            let profilePic = false;
            
            if (isRegistered) {
                try {
                    const picUrl = await session.client.getProfilePicUrl(whatsappId);
                    profilePic = !!picUrl;
                } catch (error) {
                    profilePic = false;
                }
            }

            return {
                number: number,
                whatsapp_id: whatsappId,
                is_registered: isRegistered,
                has_profile_pic: profilePic,
                checked_at: new Date().toISOString(),
                status: 'success',
                session_id: session.id
            };
        } catch (error) {
            session.errors++;
            return {
                number: number,
                whatsapp_id: '',
                is_registered: false,
                has_profile_pic: false,
                checked_at: new Date().toISOString(),
                status: 'error',
                error: error.message,
                session_id: session.id
            };
        }
    }

    distributeWork(array, chunks) {
        const result = [];
        const chunkSize = Math.ceil(array.length / chunks);
        
        for (let i = 0; i < chunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, array.length);
            result.push(array.slice(start, end));
        }
        
        return result;
    }

    showStatistics() {
        const elapsed = (this.stats.endTime - this.stats.startTime) / 1000;
        const speed = (this.stats.checked / elapsed * 60).toFixed(0);
        
        console.log('═'.repeat(60));
        console.log('📊 VALIDATION REPORT');
        console.log('═'.repeat(60));
        
        console.log('\n【 Results Summary 】');
        console.log(`Total numbers: ${this.stats.total}`);
        console.log(`✅ Verified (has WhatsApp): ${this.stats.verified} (${(this.stats.verified / this.stats.total * 100).toFixed(1)}%)`);
        console.log(`❌ Not verified: ${this.stats.total - this.stats.verified}`);
        console.log(`⚠️  Errors: ${this.stats.errors}`);
        
        console.log('\n【 Performance Metrics 】');
        console.log(`Total time: ${elapsed.toFixed(1)} seconds (${(elapsed / 60).toFixed(1)} minutes)`);
        console.log(`Speed: ${speed} numbers/minute`);
        console.log(`Sessions used: ${this.options.sessions}`);
        
        console.log('\n【 Session Performance 】');
        this.whatsappSessions.forEach(session => {
            const percentage = session.checked > 0 ? (session.verified / session.checked * 100).toFixed(1) : 0;
            console.log(`Session ${session.id + 1}: ${session.checked} checked, ${session.verified} verified (${percentage}%), ${session.errors} errors`);
        });
        
        console.log('\n' + '═'.repeat(60));
    }

    async saveResults() {
        const timestamp = Date.now();
        const resultsFile = `whatsapp_results_${timestamp}.csv`;
        
        const csvWriter = createObjectCsvWriter({
            path: resultsFile,
            header: [
                { id: 'number', title: 'number' },
                { id: 'whatsapp_id', title: 'whatsapp_id' },
                { id: 'is_registered', title: 'is_registered' },
                { id: 'has_profile_pic', title: 'has_profile_pic' },
                { id: 'checked_at', title: 'checked_at' },
                { id: 'status', title: 'status' },
                { id: 'session_id', title: 'session_id' }
            ]
        });
        
        await csvWriter.writeRecords(this.results);
        console.log(`💾 Results saved to ${resultsFile}`);
        
        console.log('\n📊 Aggregating to master database...');
        const aggregator = new WhatsAppAggregator();
        await aggregator.loadExistingNumbers();
        await aggregator.aggregateResults(resultsFile);
        
        return resultsFile;
    }

    async cleanup() {
        console.log('\n🧹 Cleaning up...');
        
        for (const session of this.whatsappSessions) {
            if (session.client) {
                await session.client.destroy();
            }
        }
        
        console.log('✅ All sessions closed');
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

async function main() {
    clearScreen();
    console.log('═'.repeat(70));
    console.log('     🚀 MULTI-SESSION WHATSAPP VALIDATOR');
    console.log('═'.repeat(70));
    console.log('\nFast WhatsApp validation using multiple parallel sessions');
    console.log('• 1 session: ~60 numbers/minute');
    console.log('• 5 sessions: ~300 numbers/minute');
    console.log('• 10 sessions: ~600 numbers/minute\n');
    
    try {
        console.log('─'.repeat(70));
        console.log('INPUT OPTIONS:');
        console.log('1. Generate new numbers');
        console.log('2. Load from CSV file');
        console.log();
        
        const mode = await question('Select input mode (1 or 2): ');
        
        let numbers;
        if (mode === '1') {
            const count = await question('How many numbers to generate? (default 1000): ');
            const numberCount = parseInt(count) || 1000;
            
            console.log(`\n🔄 Generating ${numberCount} Jordanian numbers...`);
            numbers = await generateJordanianNumbers(numberCount);
            const csvFile = `input_${Date.now()}.csv`;
            await saveNumbersToCSV(numbers, csvFile);
            console.log(`✅ Generated and saved to ${csvFile}`);
        } else {
            const csvFile = await question('Enter CSV file path: ');
            console.log(`\n📂 Loading numbers from ${csvFile}...`);
            numbers = await loadNumbersFromCSV(csvFile);
            console.log(`✅ Loaded ${numbers.length} numbers`);
        }
        
        console.log('\n─'.repeat(70));
        console.log('CONFIGURATION:');
        
        const sessionsInput = await question('Number of WhatsApp sessions (1-10, default 1): ');
        const sessions = Math.min(10, Math.max(1, parseInt(sessionsInput) || 1));
        
        const delayInput = await question('Delay between checks in ms (default 1000): ');
        const checkDelay = Math.max(100, parseInt(delayInput) || 1000);
        
        const speed = sessions * 60000 / checkDelay;
        const estimatedTime = numbers.length / speed;
        
        console.log('\n─'.repeat(70));
        console.log('VALIDATION PLAN:');
        console.log(`• Numbers to validate: ${numbers.length}`);
        console.log(`• WhatsApp sessions: ${sessions}`);
        console.log(`• Check delay: ${checkDelay}ms`);
        console.log(`• Estimated speed: ${speed.toFixed(0)} numbers/minute`);
        console.log(`• Estimated time: ${estimatedTime.toFixed(1)} minutes`);
        console.log();
        
        const proceed = await question('Proceed with validation? (y/n): ');
        
        if (proceed.toLowerCase() !== 'y') {
            console.log('\nCancelled');
            rl.close();
            process.exit(0);
        }
        
        const validator = new MultiWhatsAppValidator({
            sessions: sessions,
            checkDelay: checkDelay,
            batchSize: 100
        });
        
        await validator.initialize();
        await validator.validateBatch(numbers);
        await validator.saveResults();
        await validator.cleanup();
        
        console.log('\n✨ Validation complete!');
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
    } finally {
        rl.close();
        process.exit(0);
    }
}

process.on('SIGINT', () => {
    console.log('\n\n⚠️  Process interrupted. Cleaning up...');
    rl.close();
    process.exit(0);
});

if (require.main === module) {
    main().catch(console.error);
}

module.exports = MultiWhatsAppValidator;