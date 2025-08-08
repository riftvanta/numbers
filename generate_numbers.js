const fs = require('fs');
const { createObjectCsvWriter } = require('csv-writer');

async function generateJordanianNumbers(count = 1000) {
    const numbers = [];
    const prefixes = ['077', '078', '079'];
    
    // Generate diverse test numbers
    const numbersPerPrefix = Math.floor(count / 3);
    const remainder = count % 3;
    
    for (let i = 0; i < prefixes.length; i++) {
        const prefix = prefixes[i];
        const numToGenerate = numbersPerPrefix + (i < remainder ? 1 : 0);
        
        for (let j = 0; j < numToGenerate; j++) {
            // Generate more realistic numbers (avoid sequences)
            let suffix;
            if (j < numToGenerate * 0.7) {
                // 70% random realistic numbers
                suffix = Math.floor(Math.random() * 9000000 + 1000000).toString();
            } else if (j < numToGenerate * 0.9) {
                // 20% from common patterns (likely active)
                const commonStarts = ['5', '6', '7', '9'];
                const start = commonStarts[Math.floor(Math.random() * commonStarts.length)];
                suffix = start + Math.floor(Math.random() * 900000 + 100000).toString();
            } else {
                // 10% edge cases
                suffix = Math.floor(Math.random() * 10000000).toString().padStart(7, '0');
            }
            
            const fullNumber = prefix + suffix;
            numbers.push({
                number: fullNumber,
                formatted: `+962${fullNumber.substring(1)}`,
                local_format: fullNumber,
                carrier_prefix: prefix,
                generated_at: new Date().toISOString()
            });
        }
    }
    
    // Shuffle array for random distribution
    for (let i = numbers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
    }
    
    return numbers;
}

async function saveNumbersToCSV(numbers, filename = 'test_numbers.csv') {
    const csvWriter = createObjectCsvWriter({
        path: filename,
        header: [
            { id: 'number', title: 'number' },
            { id: 'formatted', title: 'formatted' },
            { id: 'local_format', title: 'local_format' },
            { id: 'carrier_prefix', title: 'carrier_prefix' },
            { id: 'generated_at', title: 'generated_at' }
        ]
    });
    
    await csvWriter.writeRecords(numbers);
    console.log(`✅ Generated ${numbers.length} numbers and saved to ${filename}`);
    
    // Show sample
    console.log('\nSample numbers:');
    for (let i = 0; i < Math.min(5, numbers.length); i++) {
        console.log(`  ${numbers[i].local_format} (${numbers[i].formatted})`);
    }
}

async function main() {
    const count = process.argv[2] ? parseInt(process.argv[2]) : 1000;
    console.log(`🔄 Generating ${count} Jordanian mobile numbers...`);
    
    const numbers = await generateJordanianNumbers(count);
    await saveNumbersToCSV(numbers);
    
    // Statistics
    const stats = {
        '077': numbers.filter(n => n.carrier_prefix === '077').length,
        '078': numbers.filter(n => n.carrier_prefix === '078').length,
        '079': numbers.filter(n => n.carrier_prefix === '079').length
    };
    
    console.log('\nDistribution:');
    console.log(`  077 (Orange): ${stats['077']} numbers`);
    console.log(`  078 (Zain/Umniah): ${stats['078']} numbers`);
    console.log(`  079 (Zain): ${stats['079']} numbers`);
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { generateJordanianNumbers, saveNumbersToCSV };