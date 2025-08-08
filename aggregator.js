const fs = require('fs');
const csv = require('csv-parser');
const { createObjectCsvWriter } = require('csv-writer');
const path = require('path');

class WhatsAppAggregator {
    constructor() {
        this.masterFile = path.join('data', 'whatsapp_verified_numbers.csv');
        this.verifiedNumbers = new Set();
    }

    async loadExistingNumbers() {
        if (!fs.existsSync(this.masterFile)) {
            console.log('📝 Creating new master file for verified WhatsApp numbers...');
            return;
        }

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
    }

    async aggregateResults(validationResultsFile) {
        const newVerifiedNumbers = [];
        let totalProcessed = 0;
        let newlyAdded = 0;

        return new Promise((resolve, reject) => {
            fs.createReadStream(validationResultsFile)
                .pipe(csv())
                .on('data', (row) => {
                    totalProcessed++;
                    
                    // Check if number has WhatsApp (is_registered is true or 'true' string)
                    const isRegistered = row.is_registered === true || 
                                       row.is_registered === 'true' || 
                                       row.is_registered === '1';
                    
                    if (isRegistered && !this.verifiedNumbers.has(row.number)) {
                        const verifiedEntry = {
                            number: row.number,
                            whatsapp_id: row.whatsapp_id || '',
                            has_profile_pic: row.has_profile_pic || false,
                            about: row.about || '',
                            carrier_prefix: row.number ? row.number.substring(0, 3) : '',
                            first_verified_at: row.checked_at || new Date().toISOString(),
                            last_verified_at: new Date().toISOString()
                        };
                        
                        newVerifiedNumbers.push(verifiedEntry);
                        this.verifiedNumbers.add(row.number);
                        newlyAdded++;
                    }
                })
                .on('end', async () => {
                    console.log(`\n📊 Aggregation Results:`);
                    console.log(`  • Total processed: ${totalProcessed}`);
                    console.log(`  • Newly verified: ${newlyAdded}`);
                    console.log(`  • Total verified: ${this.verifiedNumbers.size}`);
                    
                    if (newVerifiedNumbers.length > 0) {
                        await this.appendToMasterFile(newVerifiedNumbers);
                    }
                    
                    resolve({
                        totalProcessed,
                        newlyAdded,
                        totalVerified: this.verifiedNumbers.size
                    });
                })
                .on('error', reject);
        });
    }

    async appendToMasterFile(newNumbers) {
        // Ensure data directory exists
        if (!fs.existsSync('data')) {
            fs.mkdirSync('data');
        }

        const fileExists = fs.existsSync(this.masterFile);
        
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
            append: fileExists
        });

        await csvWriter.writeRecords(newNumbers);
        console.log(`✅ Added ${newNumbers.length} new verified numbers to master file`);
    }

    async getStatistics() {
        await this.loadExistingNumbers();
        
        const stats = {
            '077': 0,
            '078': 0,
            '079': 0,
            total: this.verifiedNumbers.size
        };

        this.verifiedNumbers.forEach(number => {
            const prefix = number.substring(0, 3);
            if (stats[prefix] !== undefined) {
                stats[prefix]++;
            }
        });

        return stats;
    }

    async exportVerifiedNumbers(outputFile = null) {
        await this.loadExistingNumbers();
        
        const exportFile = outputFile || `verified_export_${Date.now()}.csv`;
        const numbers = Array.from(this.verifiedNumbers).map(number => ({
            number,
            formatted: `+962${number.substring(1)}`,
            carrier: this.getCarrier(number)
        }));

        const csvWriter = createObjectCsvWriter({
            path: exportFile,
            header: [
                { id: 'number', title: 'number' },
                { id: 'formatted', title: 'formatted' },
                { id: 'carrier', title: 'carrier' }
            ]
        });

        await csvWriter.writeRecords(numbers);
        console.log(`📤 Exported ${numbers.length} verified numbers to ${exportFile}`);
        
        return exportFile;
    }

    getCarrier(number) {
        const prefix = number.substring(0, 3);
        const carriers = {
            '077': 'Orange Jordan',
            '078': 'Zain/Umniah',
            '079': 'Zain Jordan'
        };
        return carriers[prefix] || 'Unknown';
    }
}

// Export for use in other modules
module.exports = WhatsAppAggregator;

// Run if called directly
if (require.main === module) {
    async function main() {
        const aggregator = new WhatsAppAggregator();
        
        // Get command line arguments
        const args = process.argv.slice(2);
        const command = args[0];
        
        if (command === 'stats') {
            const stats = await aggregator.getStatistics();
            console.log('\n📊 WhatsApp Verified Numbers Statistics:');
            console.log('═'.repeat(40));
            console.log(`Total Verified: ${stats.total}`);
            console.log(`077 (Orange): ${stats['077']}`);
            console.log(`078 (Zain/Umniah): ${stats['078']}`);
            console.log(`079 (Zain): ${stats['079']}`);
            console.log('═'.repeat(40));
        } else if (command === 'export') {
            await aggregator.exportVerifiedNumbers();
        } else if (command === 'aggregate' && args[1]) {
            await aggregator.loadExistingNumbers();
            await aggregator.aggregateResults(args[1]);
        } else {
            console.log('Usage:');
            console.log('  node aggregator.js stats          - Show statistics');
            console.log('  node aggregator.js export         - Export verified numbers');
            console.log('  node aggregator.js aggregate <file> - Aggregate results from validation file');
        }
    }
    
    main().catch(console.error);
}