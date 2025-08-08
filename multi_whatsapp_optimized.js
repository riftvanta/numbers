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

class OptimizedWhatsAppValidator {
    constructor(options = {}) {
        this.options = {
            sessions: options.sessions || 1,
            concurrentPerSession: options.concurrentPerSession || 10, // Process 10 numbers at once per session
            batchSize: options.batchSize || 20, // Small batches for better distribution
            batchDelay: options.batchDelay || 100, // Minimal delay between batches
            maxRetries: options.maxRetries || 2,
            ...options
        };
        
        this.whatsappSessions = [];
        this.whatsappClients = [];
        this.workQueue = [];
        this.results = [];
        this.processing = new Set();
        
        this.stats = {
            total: 0,
            processed: 0,
            verified: 0,
            errors: 0,
            startTime: null,
            endTime: null,
            sessionStats: new Map()
        };
    }

    async initialize() {
        console.clear();
        console.log('═'.repeat(60));
        console.log('    ⚡ OPTIMIZED WHATSAPP VALIDATOR');
        console.log('═'.repeat(60));
        console.log(`\n📋 Configuration:`);
        console.log(`   • Sessions: ${this.options.sessions}`);
        console.log(`   • Concurrent checks per session: ${this.options.concurrentPerSession}`);
        console.log(`   • Total concurrent: ${this.options.sessions * this.options.concurrentPerSession}`);
        console.log(`   • Batch size: ${this.options.batchSize}\n`);
        
        console.log(`🟢 Initializing ${this.options.sessions} WhatsApp session(s)...\n`);
        
        const initPromises = [];
        for (let i = 0; i < this.options.sessions; i++) {
            initPromises.push(this.initializeSession(i));
        }
        
        await Promise.all(initPromises);
        console.log('\n✅ All sessions ready!\n');
    }

    async initializeSession(index) {
        const sessionName = `session-${index}`;
        const sessionPath = `.wwebjs_auth/session-${sessionName}`;
        const sessionExists = fs.existsSync(sessionPath);
        
        console.log(`📱 Session ${index + 1}/${this.options.sessions}: ${sessionExists ? 'Existing' : 'New (QR required)'}`);
        
        const client = new Client({
            authStrategy: new LocalAuth({
                clientId: sessionName,
                dataPath: '.wwebjs_auth'
            }),
            puppeteer: {
                headless: 'new',
                args: [...config.puppeteer.args, '--disable-gpu', '--disable-dev-shm-usage']
            }
        });

        const session = {
            id: index,
            name: sessionName,
            client: client,
            ready: false,
            processing: 0,
            checked: 0,
            verified: 0,
            errors: 0,
            lastError: null
        };

        // Setup event handlers
        client.on('qr', (qr) => {
            console.log(`\n📱 Session ${index + 1}: Scan QR code:\n`);
            qrcode.generate(qr, { small: true });
        });

        client.on('authenticated', () => {
            console.log(`   ✓ Session ${index + 1}: Authenticated`);
        });

        client.on('ready', () => {
            console.log(`   ✅ Session ${index + 1}: Ready`);
            session.ready = true;
        });

        client.on('auth_failure', (msg) => {
            console.error(`   ❌ Session ${index + 1}: Auth failed:`, msg);
        });

        await client.initialize();
        
        // Wait for ready
        while (!session.ready) {
            await this.delay(500);
        }
        
        this.whatsappClients.push(client);
        this.whatsappSessions.push(session);
        this.stats.sessionStats.set(index, session);
    }

    async validateBatch(numbers) {
        this.stats.total = numbers.length;
        this.stats.startTime = Date.now();
        
        // Initialize work queue
        this.workQueue = [...numbers];
        
        console.log('═'.repeat(60));
        console.log('⚡ OPTIMIZED VALIDATION STARTED');
        console.log('═'.repeat(60));
        console.log(`Total numbers: ${numbers.length}`);
        console.log(`Sessions: ${this.options.sessions}`);
        console.log(`Concurrent per session: ${this.options.concurrentPerSession}`);
        console.log(`Total concurrent capacity: ${this.options.sessions * this.options.concurrentPerSession}\n`);
        
        // Start progress display
        const progressInterval = setInterval(() => {
            this.displayProgress();
        }, 2000);
        
        // Start all session workers
        const workers = [];
        for (const session of this.whatsappSessions) {
            workers.push(this.sessionWorker(session));
        }
        
        // Wait for all workers to complete
        await Promise.all(workers);
        
        clearInterval(progressInterval);
        
        this.stats.endTime = Date.now();
        this.showFinalStatistics();
        
        return this.results;
    }

    async sessionWorker(session) {
        const concurrentTasks = [];
        
        while (this.workQueue.length > 0 || this.processing.size > 0) {
            // Fill up concurrent slots
            while (concurrentTasks.length < this.options.concurrentPerSession && this.workQueue.length > 0) {
                const number = this.workQueue.shift();
                if (number) {
                    this.processing.add(number);
                    concurrentTasks.push(this.processNumber(session, number));
                }
            }
            
            // Wait for at least one task to complete
            if (concurrentTasks.length > 0) {
                await Promise.race(concurrentTasks);
                
                // Remove completed tasks
                for (let i = concurrentTasks.length - 1; i >= 0; i--) {
                    if (await this.isPromiseResolved(concurrentTasks[i])) {
                        concurrentTasks.splice(i, 1);
                    }
                }
            } else if (this.workQueue.length === 0 && this.processing.size > 0) {
                // Wait a bit for other sessions to finish
                await this.delay(100);
            }
            
            // Small delay to prevent CPU overload
            if (this.workQueue.length > 0) {
                await this.delay(10);
            }
        }
        
        // Wait for remaining tasks
        if (concurrentTasks.length > 0) {
            await Promise.all(concurrentTasks);
        }
    }

    async processNumber(session, numberObj) {
        const number = numberObj.number || numberObj;
        let retries = 0;
        
        while (retries < this.options.maxRetries) {
            try {
                const formattedNumber = number.replace(/[^\d]/g, '');
                const whatsappId = formattedNumber.startsWith('962') 
                    ? `${formattedNumber}@c.us`
                    : `962${formattedNumber.substring(1)}@c.us`;

                // Fast check - no profile pic, just registration status
                const isRegistered = await session.client.isRegisteredUser(whatsappId);
                
                const result = {
                    number: number,
                    whatsapp_id: whatsappId,
                    is_registered: isRegistered,
                    checked_at: new Date().toISOString(),
                    status: 'success',
                    session_id: session.id
                };
                
                this.results.push(result);
                session.checked++;
                this.stats.processed++;
                
                if (isRegistered) {
                    session.verified++;
                    this.stats.verified++;
                }
                
                this.processing.delete(numberObj);
                return result;
                
            } catch (error) {
                retries++;
                session.lastError = error.message;
                
                if (retries >= this.options.maxRetries) {
                    session.errors++;
                    this.stats.errors++;
                    
                    const result = {
                        number: number,
                        whatsapp_id: '',
                        is_registered: false,
                        checked_at: new Date().toISOString(),
                        status: 'error',
                        error: error.message,
                        session_id: session.id
                    };
                    
                    this.results.push(result);
                    this.stats.processed++;
                    this.processing.delete(numberObj);
                    return result;
                }
                
                // Brief retry delay
                await this.delay(100 * retries);
            }
        }
    }

    async isPromiseResolved(promise) {
        const race = await Promise.race([
            promise.then(() => true).catch(() => true),
            this.delay(1).then(() => false)
        ]);
        return race;
    }

    displayProgress() {
        const elapsed = (Date.now() - this.stats.startTime) / 1000;
        const speed = elapsed > 0 ? (this.stats.processed / elapsed * 60).toFixed(0) : 0;
        const percentage = (this.stats.processed / this.stats.total * 100).toFixed(1);
        const eta = speed > 0 ? ((this.stats.total - this.stats.processed) / (speed / 60)).toFixed(1) : '?';
        
        console.log(`\r⚡ Progress: ${this.stats.processed}/${this.stats.total} (${percentage}%) | ` +
                   `✅ ${this.stats.verified} | ❌ ${this.stats.errors} | ` +
                   `Speed: ${speed}/min | ETA: ${eta}s | ` +
                   `Queue: ${this.workQueue.length} | Processing: ${this.processing.size}    `);
    }

    showFinalStatistics() {
        const elapsed = (this.stats.endTime - this.stats.startTime) / 1000;
        const speed = (this.stats.processed / elapsed * 60).toFixed(0);
        
        console.log('\n\n' + '═'.repeat(60));
        console.log('📊 VALIDATION COMPLETE');
        console.log('═'.repeat(60));
        
        console.log('\n【 Results 】');
        console.log(`Total processed: ${this.stats.processed}/${this.stats.total}`);
        console.log(`✅ Verified: ${this.stats.verified} (${(this.stats.verified / this.stats.total * 100).toFixed(1)}%)`);
        console.log(`❌ Not on WhatsApp: ${this.stats.processed - this.stats.verified - this.stats.errors}`);
        console.log(`⚠️  Errors: ${this.stats.errors}`);
        
        console.log('\n【 Performance 】');
        console.log(`Time: ${elapsed.toFixed(1)}s (${(elapsed / 60).toFixed(1)} minutes)`);
        console.log(`Speed: ${speed} numbers/minute`);
        console.log(`Avg per number: ${(elapsed / this.stats.processed * 1000).toFixed(0)}ms`);
        
        console.log('\n【 Session Stats 】');
        this.whatsappSessions.forEach(session => {
            const percentage = session.checked > 0 ? (session.verified / session.checked * 100).toFixed(1) : 0;
            console.log(`Session ${session.id + 1}: ${session.checked} checked, ` +
                       `${session.verified} verified (${percentage}%), ${session.errors} errors`);
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
        console.log(`\n💾 Results saved to ${resultsFile}`);
        
        // Aggregate to master database
        console.log('📊 Aggregating to master database...');
        const aggregator = new WhatsAppAggregator();
        await aggregator.loadExistingNumbers();
        await aggregator.aggregateResults(resultsFile);
        
        return resultsFile;
    }

    async cleanup() {
        console.log('\n🧹 Cleaning up sessions...');
        
        const cleanupPromises = this.whatsappSessions.map(session => 
            session.client.destroy().catch(err => console.error(`Error closing session ${session.id}:`, err))
        );
        
        await Promise.all(cleanupPromises);
        console.log('✅ All sessions closed');
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

async function main() {
    console.clear();
    console.log('═'.repeat(70));
    console.log('     ⚡ OPTIMIZED MULTI-SESSION WHATSAPP VALIDATOR');
    console.log('═'.repeat(70));
    console.log('\nMaximum speed validation with concurrent processing');
    console.log('• Concurrent checks per session');
    console.log('• No unnecessary delays');
    console.log('• Dynamic work distribution\n');
    
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
        console.log('OPTIMIZATION SETTINGS:');
        
        const sessionsInput = await question('Number of WhatsApp sessions (1-10, default 2): ');
        const sessions = Math.min(10, Math.max(1, parseInt(sessionsInput) || 2));
        
        const concurrentInput = await question('Concurrent checks per session (5-20, default 10): ');
        const concurrentPerSession = Math.min(20, Math.max(5, parseInt(concurrentInput) || 10));
        
        const totalConcurrent = sessions * concurrentPerSession;
        const estimatedSpeed = totalConcurrent * 30; // ~2 seconds per check with overhead
        const estimatedTime = numbers.length / estimatedSpeed;
        
        console.log('\n─'.repeat(70));
        console.log('PERFORMANCE ESTIMATE:');
        console.log(`• Numbers to validate: ${numbers.length}`);
        console.log(`• WhatsApp sessions: ${sessions}`);
        console.log(`• Concurrent per session: ${concurrentPerSession}`);
        console.log(`• Total concurrent capacity: ${totalConcurrent}`);
        console.log(`• Estimated speed: ${estimatedSpeed}-${estimatedSpeed * 2} numbers/minute`);
        console.log(`• Estimated time: ${estimatedTime.toFixed(1)}-${(estimatedTime * 2).toFixed(1)} minutes`);
        console.log();
        
        const proceed = await question('Proceed with optimized validation? (y/n): ');
        
        if (proceed.toLowerCase() !== 'y') {
            console.log('\nCancelled');
            rl.close();
            process.exit(0);
        }
        
        const validator = new OptimizedWhatsAppValidator({
            sessions: sessions,
            concurrentPerSession: concurrentPerSession,
            batchSize: 20,
            batchDelay: 50
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

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n⚠️  Process interrupted. Cleaning up...');
    rl.close();
    process.exit(0);
});

if (require.main === module) {
    main().catch(console.error);
}

module.exports = OptimizedWhatsAppValidator;