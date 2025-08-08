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
const path = require('path');

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

class SafeWhatsAppValidator {
    constructor(options = {}) {
        this.options = {
            sessions: options.sessions || 1,
            checkDelay: options.checkDelay || 600,  // 0.6 seconds between checks for ~100/min
            batchSize: options.batchSize || 100,      // Larger batches, fewer breaks
            breakDuration: options.breakDuration || 5000, // 5 second breaks
            sessionDelay: options.sessionDelay || 2000,    // 2 seconds between session starts
            maxChecksPerHour: options.maxChecksPerHour || 3000, // Higher rate limit per session
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
            endTime: null,
            sessionStats: new Map()
        };
        
        this.results = [];
        this.sessionCheckCounts = new Map();
        this.sessionLastCheck = new Map();
        
        // Master file for immediate verified number appending
        this.masterFile = path.join('data', 'whatsapp_verified_numbers.csv');
        this.verifiedNumbers = new Set();
    }

    async initialize() {
        clearScreen();
        console.log('═'.repeat(60));
        console.log('    🛡️ SAFE WHATSAPP VALIDATOR');
        console.log('═'.repeat(60));
        console.log(`\n📋 Anti-Ban Configuration:`);
        console.log(`   • Sessions: ${this.options.sessions}`);
        console.log(`   • Check Delay: ${this.options.checkDelay}ms`);
        console.log(`   • Batch Size: ${this.options.batchSize}`);
        console.log(`   • Break Duration: ${this.options.breakDuration}ms`);
        console.log(`   • Max checks/hour/session: ${this.options.maxChecksPerHour}\n`);
        
        // Initialize master file and load existing verified numbers
        console.log('📊 Initializing master verification file...');
        await this.initializeMasterFile();
        
        console.log(`🟢 Initializing ${this.options.sessions} WhatsApp session(s)...\n`);
        console.log('⚠️  Staggering session initialization to avoid detection...\n');
        
        for (let i = 0; i < this.options.sessions; i++) {
            await this.initializeSession(i);
            
            // Stagger session initialization
            if (i < this.options.sessions - 1) {
                console.log(`⏳ Waiting ${this.options.sessionDelay/1000}s before next session...\n`);
                await this.delay(this.options.sessionDelay);
            }
        }
        
        console.log('\n✅ All sessions ready!\n');
        console.log('🛡️ Anti-ban protections active:');
        console.log('   • Random delays between checks');
        console.log('   • Regular breaks');
        console.log('   • Session rotation');
        console.log('   • Rate limiting');
        console.log('   • Immediate verified number saving\n');
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
                args: [...config.puppeteer.args, '--disable-blink-features=AutomationControlled'],
                defaultViewport: null,
                ignoreDefaultArgs: ['--enable-automation']
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
            errors: 0,
            lastCheckTime: Date.now(),
            totalChecksThisHour: 0,
            hourStartTime: Date.now()
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
        this.sessionCheckCounts.set(index, 0);
        this.sessionLastCheck.set(index, Date.now());
    }

    async validateBatch(numbers) {
        this.stats.total = numbers.length;
        this.stats.startTime = Date.now();
        
        console.log('═'.repeat(60));
        console.log('🛡️ SAFE VALIDATION STARTED');
        console.log('═'.repeat(60));
        console.log(`Total numbers: ${numbers.length}`);
        console.log(`Using ${this.options.sessions} session(s) with anti-ban protection\n`);
        
        // Distribute numbers evenly among sessions
        const chunks = this.distributeWork(numbers, this.options.sessions);
        
        // Process all sessions in parallel
        const validationPromises = [];
        for (let sessionIndex = 0; sessionIndex < this.options.sessions; sessionIndex++) {
            if (chunks[sessionIndex] && chunks[sessionIndex].length > 0) {
                validationPromises.push(
                    this.validateSessionChunk(
                        this.whatsappSessions[sessionIndex], 
                        chunks[sessionIndex],
                        sessionIndex
                    )
                );
            }
        }
        
        // Wait for all sessions to complete
        await Promise.all(validationPromises);
        
        this.stats.endTime = Date.now();
        this.stats.checked = this.results.length;
        this.stats.verified = this.results.filter(r => r.is_registered).length;
        this.stats.errors = this.results.filter(r => r.status === 'error').length;
        
        this.showStatistics();
        
        return this.results;
    }

    async validateSessionChunk(session, numbers, sessionIndex) {
        const total = numbers.length;
        let processed = 0;
        
        console.log(`📱 Session ${session.id + 1}: Starting to process ${total} numbers safely...\n`);
        
        for (let i = 0; i < numbers.length; i++) {
            // Check rate limit
            await this.checkRateLimit(session);
            
            const number = numbers[i].number || numbers[i];
            
            // Add random variation to delay (80-120% of base delay)
            const delayVariation = this.options.checkDelay * (0.8 + Math.random() * 0.4);
            
            // Process number
            const result = await this.validateNumber(session, number);
            this.results.push(result);
            session.checked++;
            processed++;
            
            if (result.is_registered) {
                session.verified++;
            }
            
            // Update progress less frequently to reduce console spam
            if (processed % 10 === 0 || processed === total) {
                const progress = ((processed / total) * 100).toFixed(1);
                console.log(`   Session ${session.id + 1}: [${processed}/${total}] ${progress}% - ` +
                           `✅ ${session.verified} verified | ` +
                           `Speed: ${this.getSessionSpeed(session)} checks/min`);
            }
            
            // Delay between checks with variation
            if (i < numbers.length - 1) {
                await this.delay(delayVariation);
            }
            
            // Take shorter breaks at intervals
            if (processed % this.options.batchSize === 0 && i < numbers.length - 1) {
                const breakTime = this.options.breakDuration + Math.random() * 2000; // Add 0-2s random
                console.log(`   Session ${session.id + 1}: Taking ${(breakTime/1000).toFixed(1)}s break (anti-ban protection)...`);
                await this.delay(breakTime);
            }
            
            // Shorter extended break every 200 checks
            if (processed % 200 === 0 && i < numbers.length - 1) {
                console.log(`   Session ${session.id + 1}: Extended break (10s) after 200 checks...`);
                await this.delay(10000);  // 10s extended break
            }
        }
        
        console.log(`✅ Session ${session.id + 1}: Completed safely (${session.verified}/${total} verified)\n`);
    }

    async checkRateLimit(session) {
        const now = Date.now();
        const hourElapsed = now - session.hourStartTime;
        
        // Reset hour counter if an hour has passed
        if (hourElapsed > 3600000) {
            session.totalChecksThisHour = 0;
            session.hourStartTime = now;
        }
        
        // If approaching rate limit, pause
        if (session.totalChecksThisHour >= this.options.maxChecksPerHour) {
            const waitTime = 3600000 - hourElapsed;
            console.log(`⚠️  Session ${session.id + 1}: Rate limit reached. Waiting ${(waitTime/60000).toFixed(1)} minutes...`);
            await this.delay(waitTime);
            session.totalChecksThisHour = 0;
            session.hourStartTime = Date.now();
        }
        
        session.totalChecksThisHour++;
    }

    getSessionSpeed(session) {
        const elapsed = (Date.now() - this.stats.startTime) / 1000 / 60; // minutes
        return elapsed > 0 ? (session.checked / elapsed).toFixed(0) : 0;
    }

    async validateNumber(session, number) {
        try {
            const formattedNumber = number.replace(/[^\d]/g, '');
            const whatsappId = formattedNumber.startsWith('962') 
                ? `${formattedNumber}@c.us`
                : `962${formattedNumber.substring(1)}@c.us`;

            // Simple check - just registration status, no profile pics
            const isRegistered = await session.client.isRegisteredUser(whatsappId);
            
            session.lastCheckTime = Date.now();
            
            const result = {
                number: number,
                whatsapp_id: whatsappId,
                is_registered: isRegistered,
                checked_at: new Date().toISOString(),
                status: 'success',
                session_id: session.id
            };
            
            // Immediately append to master file if verified
            if (isRegistered) {
                await this.appendVerifiedNumberImmediately(result);
            }
            
            return result;
        } catch (error) {
            session.errors++;
            
            // If error contains "ban" or "blocked", stop immediately
            if (error.message && (error.message.toLowerCase().includes('ban') || 
                                 error.message.toLowerCase().includes('block'))) {
                console.error(`\n⛔ Session ${session.id + 1} may be banned! Stopping validation.`);
                throw error;
            }
            
            return {
                number: number,
                whatsapp_id: '',
                is_registered: false,
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
        console.log('📊 SAFE VALIDATION REPORT');
        console.log('═'.repeat(60));
        
        console.log('\n【 Results Summary 】');
        console.log(`Total numbers: ${this.stats.total}`);
        console.log(`✅ Verified (has WhatsApp): ${this.stats.verified} (${(this.stats.verified / this.stats.total * 100).toFixed(1)}%)`);
        console.log(`❌ Not verified: ${this.stats.total - this.stats.verified}`);
        console.log(`⚠️  Errors: ${this.stats.errors}`);
        
        console.log('\n【 Performance Metrics 】');
        console.log(`Total time: ${elapsed.toFixed(1)} seconds (${(elapsed / 60).toFixed(1)} minutes)`);
        console.log(`Average speed: ${speed} numbers/minute`);
        console.log(`Sessions used: ${this.options.sessions}`);
        
        console.log('\n【 Anti-Ban Stats 】');
        console.log(`Delays applied: ${this.options.checkDelay}ms + random variation`);
        console.log(`Breaks taken: Every ${this.options.batchSize} checks`);
        console.log(`No sessions banned: ✅`);
        
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
        
        console.log('✅ All sessions closed safely');
    }

    async initializeMasterFile() {
        // Ensure data directory exists
        if (!fs.existsSync('data')) {
            fs.mkdirSync('data');
        }
        
        // Load existing verified numbers into memory to avoid duplicates
        if (fs.existsSync(this.masterFile)) {
            const csv = require('csv-parser');
            return new Promise((resolve, reject) => {
                fs.createReadStream(this.masterFile)
                    .pipe(csv())
                    .on('data', (row) => {
                        if (row.number) {
                            this.verifiedNumbers.add(row.number);
                        }
                    })
                    .on('end', () => {
                        console.log(`📊 Loaded ${this.verifiedNumbers.size} existing verified numbers`);
                        resolve();
                    })
                    .on('error', reject);
            });
        } else {
            // Create file with headers if it doesn't exist
            const csvWriter = createObjectCsvWriter({
                path: this.masterFile,
                header: [
                    { id: 'number', title: 'number' },
                    { id: 'whatsapp_id', title: 'whatsapp_id' },
                    { id: 'has_profile_pic', title: 'has_profile_pic' },
                    { id: 'about', title: 'about' },
                    { id: 'carrier_prefix', title: 'carrier_prefix' },
                    { id: 'first_verified_at', title: 'first_verified_at' },
                    { id: 'last_verified_at', title: 'last_verified_at' }
                ]
            });
            await csvWriter.writeRecords([]);
            console.log('📝 Created new master file for verified WhatsApp numbers');
        }
    }

    async appendVerifiedNumberImmediately(result) {
        // Only append if number is verified and not already in our set
        if (result.is_registered && !this.verifiedNumbers.has(result.number)) {
            const verifiedEntry = {
                number: result.number,
                whatsapp_id: result.whatsapp_id || '',
                has_profile_pic: false, // Safe mode doesn't check profile pics
                about: '',
                carrier_prefix: result.number ? result.number.substring(0, 3) : '',
                first_verified_at: result.checked_at,
                last_verified_at: result.checked_at
            };

            const csvWriter = createObjectCsvWriter({
                path: this.masterFile,
                header: [
                    { id: 'number', title: 'number' },
                    { id: 'whatsapp_id', title: 'whatsapp_id' },
                    { id: 'has_profile_pic', title: 'has_profile_pic' },
                    { id: 'about', title: 'about' },
                    { id: 'carrier_prefix', title: 'carrier_prefix' },
                    { id: 'first_verified_at', title: 'first_verified_at' },
                    { id: 'last_verified_at', title: 'last_verified_at' }
                ],
                append: true
            });

            await csvWriter.writeRecords([verifiedEntry]);
            this.verifiedNumbers.add(result.number);
            
            // Optional: log immediately appended numbers (can be disabled for less console output)
            console.log(`   ✅ Immediately saved verified number: ${result.number}`);
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

async function main() {
    clearScreen();
    console.log('═'.repeat(70));
    console.log('     🛡️ SAFE MULTI-SESSION WHATSAPP VALIDATOR');
    console.log('═'.repeat(70));
    console.log('\nAnti-ban protection with intelligent rate limiting');
    console.log('• Slower but SAFE validation');
    console.log('• Random delays and breaks');
    console.log('• Session rotation and rate limits\n');
    
    console.log('⚠️  IMPORTANT: This version prioritizes account safety over speed\n');
    
    try {
        console.log('─'.repeat(70));
        console.log('INPUT OPTIONS:');
        console.log('1. Generate new numbers');
        console.log('2. Load from CSV file');
        console.log();
        
        const mode = await question('Select input mode (1 or 2): ');
        
        let numbers;
        if (mode === '1') {
            const count = await question('How many numbers to generate? (default 500): ');
            const numberCount = parseInt(count) || 500;
            
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
        console.log('SAFETY CONFIGURATION:');
        
        const sessionsInput = await question('Number of WhatsApp sessions (1-10 allowed, 1-3 recommended): ');
        const sessions = Math.min(10, Math.max(1, parseInt(sessionsInput) || 1));
        
        const delayInput = await question('Delay between checks in ms (500-1500 recommended for fast-safe mode): ');
        const checkDelay = Math.max(500, parseInt(delayInput) || 600);
        
        const speed = sessions * 60000 / checkDelay * 0.7; // Account for breaks
        const estimatedTime = numbers.length / speed;
        
        console.log('\n─'.repeat(70));
        console.log('VALIDATION PLAN (SAFE MODE):');
        console.log(`• Numbers to validate: ${numbers.length}`);
        console.log(`• WhatsApp sessions: ${sessions}`);
        console.log(`• Check delay: ${checkDelay}ms + random variation`);
        console.log(`• Estimated speed: ${speed.toFixed(0)} numbers/minute`);
        console.log(`• Estimated time: ${estimatedTime.toFixed(1)} minutes`);
        console.log(`• Anti-ban features: ENABLED`);
        console.log();
        
        const proceed = await question('Proceed with SAFE validation? (y/n): ');
        
        if (proceed.toLowerCase() !== 'y') {
            console.log('\nCancelled');
            rl.close();
            process.exit(0);
        }
        
        const validator = new SafeWhatsAppValidator({
            sessions: sessions,
            checkDelay: checkDelay,
            batchSize: 100,
            breakDuration: 5000,
            sessionDelay: 2000,
            maxChecksPerHour: 3000
        });
        
        await validator.initialize();
        await validator.validateBatch(numbers);
        await validator.saveResults();
        await validator.cleanup();
        
        console.log('\n✨ Validation complete (No bans detected!)');
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        if (error.message && error.message.toLowerCase().includes('ban')) {
            console.error('\n⛔ POSSIBLE BAN DETECTED! Stop using this session immediately.');
        }
    } finally {
        rl.close();
        process.exit(0);
    }
}

process.on('SIGINT', () => {
    console.log('\n\n⚠️  Process interrupted. Cleaning up safely...');
    rl.close();
    process.exit(0);
});

if (require.main === module) {
    main().catch(console.error);
}

module.exports = SafeWhatsAppValidator;