module.exports = {
    // Number generation settings
    generation: {
        prefixes: ['077', '078', '079'],
        carriers: {
            '077': 'Orange Jordan',
            '078': 'Zain/Umniah',
            '079': 'Zain Jordan'
        },
        patterns: {
            realistic: 0.7,  // 70% realistic numbers
            common: 0.2,     // 20% common patterns
            edge: 0.1        // 10% edge cases
        }
    },
    
    // WhatsApp validation settings
    validation: {
        defaultCheckDelay: 2000,      // 2 seconds between checks
        minCheckDelay: 1000,          // Minimum 1 second
        defaultBatchSize: 50,         // Break every 50 numbers
        breakDuration: 10000,         // 10 second break
        saveInterval: 10,             // Save progress every 10 numbers
        maxRetries: 3,                // Retry failed numbers
        headlessMode: true            // Default to headless
    },
    
    // File paths
    paths: {
        progressFile: 'progress.json',
        validatedFile: 'validated_numbers.csv',
        reportFile: 'validation_report.json'
    },
    
    // Puppeteer settings
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    }
};