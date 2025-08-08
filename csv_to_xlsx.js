const fs = require('fs');
const csv = require('csv-parser');
const XLSX = require('xlsx');

async function convertToXLSX() {
    const phoneNumbers = [];
    
    console.log('📂 Reading verified numbers from CSV...');
    
    return new Promise((resolve, reject) => {
        fs.createReadStream('data/whatsapp_verified_numbers.csv')
            .pipe(csv({
                headers: ['number', 'whatsapp_id', 'has_profile_pic', 'about', 'carrier_prefix', 'first_verified_at', 'last_verified_at']
            }))
            .on('data', (row) => {
                if (row.number) {
                    // Convert to 962xxxxxxxxx format
                    let phoneNumber = row.number.replace(/[^\d]/g, '');
                    
                    // Add 962 prefix if it starts with 0
                    if (phoneNumber.startsWith('0')) {
                        phoneNumber = '962' + phoneNumber.substring(1);
                    }
                    // If it doesn't start with 962, add it
                    else if (!phoneNumber.startsWith('962')) {
                        phoneNumber = '962' + phoneNumber;
                    }
                    
                    phoneNumbers.push({ phone_number: phoneNumber });
                }
            })
            .on('end', () => {
                console.log(`✅ Processed ${phoneNumbers.length} phone numbers`);
                
                // Create workbook and worksheet
                const workbook = XLSX.utils.book_new();
                const worksheet = XLSX.utils.json_to_sheet(phoneNumbers);
                
                // Add worksheet to workbook
                XLSX.utils.book_append_sheet(workbook, worksheet, 'Verified Numbers');
                
                // Generate filename with timestamp
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
                const filename = `verified_numbers_${timestamp}.xlsx`;
                
                // Write XLSX file
                XLSX.writeFile(workbook, filename);
                
                console.log(`💾 Created XLSX file: ${filename}`);
                console.log(`📊 Contains ${phoneNumbers.length} phone numbers in 962xxxxxxxxx format`);
                
                resolve(filename);
            })
            .on('error', reject);
    });
}

// Run if called directly
if (require.main === module) {
    convertToXLSX().catch(console.error);
}

module.exports = convertToXLSX;