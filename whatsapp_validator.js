const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const csv = require('csv-parser');
const { createObjectCsvWriter } = require('csv-writer');
const config = require('./config');
const WhatsAppAggregator = require('./aggregator');

class WhatsAppValidator {
    constructor(options = {}) {
        this.config = {
            sessionName: options.sessionName || 'validator-session',
            headless: options.headless !== false,
            checkDelay: options.checkDelay || config.validation.defaultCheckDelay,
            batchSize: options.batchSize || config.validation.defaultBatchSize,
            progressFile: options.progressFile || config.paths.progressFile,
            ...options
        };
        
        this.client = null;
        this.isReady = false;
        this.validatedNumbers = [];
        this.progress = this.loadProgress();
        this.aggregator = new WhatsAppAggregator();
    }

    loadProgress() {
        try {
            if (fs.existsSync(this.config.progressFile)) {
                return JSON.parse(fs.readFileSync(this.config.progressFile, 'utf8'));
            }
        } catch (error) {
            console.log('⚠️  No previous progress found, starting fresh');
        }
        return { lastIndex: 0, totalChecked: 0, startTime: new Date().toISOString() };
    }

    saveProgress() {
        fs.writeFileSync(this.config.progressFile, JSON.stringify(this.progress, null, 2));
    }

    async initialize() {
        console.log('🚀 Initializing WhatsApp client...');
        
        // Check if session exists
        const sessionPath = `.wwebjs_auth/session-${this.config.sessionName}`;
        const sessionExists = fs.existsSync(sessionPath);
        
        if (sessionExists) {
            console.log('✅ Found existing WhatsApp session, attempting to restore...');
        } else {
            console.log('📱 No session found, you will need to scan QR code...');
        }
        
        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: this.config.sessionName,
                dataPath: '.wwebjs_auth'
            }),
            puppeteer: {
                headless: 'new', // Force new headless mode
                args: config.puppeteer.args
            }
        });

        // QR Code generation for first-time auth
        this.client.on('qr', (qr) => {
            console.log('\n📱 Scan this QR code with WhatsApp:');
            qrcode.generate(qr, { small: true });
        });

        // Authentication successful
        this.client.on('authenticated', () => {
            console.log('✅ Authentication successful! Session saved.');
            console.log('📌 You won\'t need to scan QR code next time.');
        });

        // Client ready
        this.client.on('ready', () => {
            console.log('✅ WhatsApp client is ready!');
            console.log('📱 Connected to WhatsApp successfully!\n');
            this.isReady = true;
        });

        // Error handling
        this.client.on('auth_failure', (msg) => {
            console.error('❌ Authentication failed:', msg);
        });

        this.client.on('disconnected', (reason) => {
            console.log('🔌 Client disconnected:', reason);
            this.isReady = false;
        });

        // Initialize the client
        await this.client.initialize();
        
        // Wait for ready state
        await this.waitForReady();
    }

    async waitForReady() {
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                if (this.isReady) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 1000);
        });
    }

    async validateNumber(number) {
        try {
            // Format number for WhatsApp (country code without +)
            const formattedNumber = number.replace(/[^\d]/g, '');
            const whatsappId = formattedNumber.startsWith('962') 
                ? `${formattedNumber}@c.us`
                : `962${formattedNumber.substring(1)}@c.us`;

            // Check if number is registered on WhatsApp
            const isRegistered = await this.client.isRegisteredUser(whatsappId);
            
            let profilePic = false;
            let about = '';
            
            if (isRegistered) {
                try {
                    // Try to get profile picture URL
                    const picUrl = await this.client.getProfilePicUrl(whatsappId);
                    profilePic = !!picUrl;
                } catch (error) {
                    // No profile picture or private
                    profilePic = false;
                }
                
                try {
                    // Try to get contact info
                    const contact = await this.client.getContactById(whatsappId);
                    about = contact.about || '';
                } catch (error) {
                    // Contact info not available
                }
            }

            return {
                number: number,
                whatsapp_id: whatsappId,
                is_registered: isRegistered,
                has_profile_pic: profilePic,
                about: about,
                checked_at: new Date().toISOString(),
                status: 'success'
            };
        } catch (error) {
            console.error(`❌ Error checking ${number}:`, error.message);
            return {
                number: number,
                whatsapp_id: '',
                is_registered: false,
                has_profile_pic: false,
                about: '',
                checked_at: new Date().toISOString(),
                status: 'error',
                error: error.message
            };
        }
    }

    async validateBatch(numbers, startIndex = 0) {
        const results = [];
        const total = numbers.length;
        
        console.log(`\n📊 Validating batch of ${total} numbers starting from index ${startIndex}...`);
        
        for (let i = startIndex; i < numbers.length; i++) {
            const number = numbers[i];
            const progress = ((i + 1) / total * 100).toFixed(1);
            
            console.log(`[${i + 1}/${total}] (${progress}%) Checking ${number.number || number}...`);
            
            const result = await this.validateNumber(number.number || number);
            results.push(result);
            
            // Update progress
            this.progress.lastIndex = i + 1;
            this.progress.totalChecked++;
            
            // Save progress every 10 numbers
            if ((i + 1) % 10 === 0) {
                this.saveProgress();
                await this.saveResults(results.slice(-10), true); // Append last 10
            }
            
            // Add delay between checks to avoid rate limiting
            if (i < numbers.length - 1) {
                await this.delay(this.config.checkDelay);
            }
            
            // Take a longer break every batch
            if ((i + 1) % this.config.batchSize === 0) {
                console.log(`⏸️  Taking a 10-second break after ${this.config.batchSize} checks...`);
                await this.delay(10000);
            }
        }
        
        return results;
    }

    async loadNumbersFromCSV(filepath) {
        return new Promise((resolve, reject) => {
            const numbers = [];
            fs.createReadStream(filepath)
                .pipe(csv())
                .on('data', (row) => {
                    numbers.push(row);
                })
                .on('end', () => {
                    console.log(`📄 Loaded ${numbers.length} numbers from ${filepath}`);
                    resolve(numbers);
                })
                .on('error', reject);
        });
    }

    async saveResults(results, append = false, customFilename = null) {
        const filename = customFilename || 'validated_numbers.csv';
        
        if (!append || !fs.existsSync(filename)) {
            // Create new file with headers
            const csvWriter = createObjectCsvWriter({
                path: filename,
                header: [
                    { id: 'number', title: 'number' },
                    { id: 'whatsapp_id', title: 'whatsapp_id' },
                    { id: 'is_registered', title: 'is_registered' },
                    { id: 'has_profile_pic', title: 'has_profile_pic' },
                    { id: 'about', title: 'about' },
                    { id: 'checked_at', title: 'checked_at' },
                    { id: 'status', title: 'status' },
                    { id: 'error', title: 'error' }
                ],
                append: false
            });
            await csvWriter.writeRecords(results);
        } else {
            // Append to existing file
            const csvWriter = createObjectCsvWriter({
                path: filename,
                header: [
                    { id: 'number', title: 'number' },
                    { id: 'whatsapp_id', title: 'whatsapp_id' },
                    { id: 'is_registered', title: 'is_registered' },
                    { id: 'has_profile_pic', title: 'has_profile_pic' },
                    { id: 'about', title: 'about' },
                    { id: 'checked_at', title: 'checked_at' },
                    { id: 'status', title: 'status' },
                    { id: 'error', title: 'error' }
                ],
                append: true
            });
            await csvWriter.writeRecords(results);
        }
        
        if (!append) {
            console.log(`💾 Saved ${results.length} validation results to ${filename}`);
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async generateReport(results) {
        const total = results.length;
        const registered = results.filter(r => r.is_registered).length;
        const withProfilePic = results.filter(r => r.has_profile_pic).length;
        const errors = results.filter(r => r.status === 'error').length;
        
        const report = {
            summary: {
                total_checked: total,
                registered_on_whatsapp: registered,
                with_profile_picture: withProfilePic,
                errors: errors,
                success_rate: ((total - errors) / total * 100).toFixed(2) + '%',
                whatsapp_penetration: (registered / total * 100).toFixed(2) + '%'
            },
            carrier_breakdown: {
                '077_orange': results.filter(r => r.number.startsWith('077')).length,
                '078_zain_umniah': results.filter(r => r.number.startsWith('078')).length,
                '079_zain': results.filter(r => r.number.startsWith('079')).length
            },
            timestamp: new Date().toISOString()
        };
        
        console.log('\n📊 Validation Report:');
        console.log('='.repeat(50));
        console.log(`Total Numbers Checked: ${report.summary.total_checked}`);
        console.log(`Registered on WhatsApp: ${report.summary.registered_on_whatsapp} (${report.summary.whatsapp_penetration})`);
        console.log(`With Profile Picture: ${report.summary.with_profile_picture}`);
        console.log(`Errors: ${report.summary.errors}`);
        console.log(`Success Rate: ${report.summary.success_rate}`);
        console.log('\nCarrier Distribution:');
        console.log(`  077 (Orange): ${report.carrier_breakdown['077_orange']}`);
        console.log(`  078 (Zain/Umniah): ${report.carrier_breakdown['078_zain_umniah']}`);
        console.log(`  079 (Zain): ${report.carrier_breakdown['079_zain']}`);
        console.log('='.repeat(50));
        
        // Save report to file
        fs.writeFileSync('validation_report.json', JSON.stringify(report, null, 2));
        console.log('📄 Report saved to validation_report.json');
        
        return report;
    }

    async cleanup() {
        if (this.client) {
            await this.client.destroy();
            console.log('👋 WhatsApp client closed');
        }
    }
}

async function main() {
    const validator = new WhatsAppValidator({
        headless: false, // Set to true for production
        checkDelay: 2000, // 2 seconds between checks
        batchSize: 50 // Take break every 50 numbers
    });
    
    try {
        // Initialize WhatsApp client
        await validator.initialize();
        
        // Load numbers from CSV (use file with real numbers if it exists)
        const csvFile = fs.existsSync('test_numbers_with_real.csv') 
            ? 'test_numbers_with_real.csv' 
            : 'test_numbers.csv';
        console.log(`📂 Using CSV file: ${csvFile}`);
        const numbers = await validator.loadNumbersFromCSV(csvFile);
        
        // Check if resuming from previous session
        const startIndex = validator.progress.lastIndex;
        if (startIndex > 0) {
            console.log(`📌 Resuming from index ${startIndex}`);
        }
        
        // Validate numbers
        const results = await validator.validateBatch(numbers, startIndex);
        
        // Save final results
        const outputFile = `validated_${Date.now()}.csv`;
        if (startIndex === 0) {
            await validator.saveResults(results, false, outputFile);
        }
        
        // Generate report
        const report = await validator.generateReport(results);
        
        // Aggregate to master file
        const aggregator = new WhatsAppAggregator();
        await aggregator.loadExistingNumbers();
        await aggregator.aggregateResults(outputFile);
        console.log('\n✅ Results aggregated to master file: data/whatsapp_verified_numbers.csv');
        
    } catch (error) {
        console.error('❌ Fatal error:', error);
    } finally {
        await validator.cleanup();
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = WhatsAppValidator;