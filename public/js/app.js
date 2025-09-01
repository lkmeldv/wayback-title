function waybackApp() {
    return {
        domains: '',
        snapshots: 5,
        unique: false,
        processing: false,
        results: [],
        errors: [],
        currentDomain: '',
        completedDomains: 0,
        totalDomains: 0,
        
        // API Key management
        apiKey: localStorage.getItem('perplexity_api_key') || '',
        apiKeyInput: '',
        
        // New features
        inputMethod: 'manual',
        csvFile: null,
        analyzeContent: false,
        showApiConfig: false,
        
        // Computed properties for site classification
        get cleanSites() {
            return this.results.filter(domain => this.isCleanDomain(domain));
        },
        
        get spamSites() {
            return this.results.filter(domain => this.isSpamDomain(domain));
        },

        async startExtraction() {
            this.processing = true;
            this.results = [];
            this.errors = [];
            this.completedDomains = 0;

            const domainList = this.domains.trim().split('\n')
                .map(d => d.trim())
                .filter(d => d.length > 0);

            this.totalDomains = domainList.length;

            try {
                const response = await fetch('/api/extract', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        domains: domainList,
                        n: this.snapshots,
                        unique: this.unique,
                        analyzeContent: this.analyzeContent,
                        apiKey: this.apiKey
                    })
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\n').filter(line => line.trim());

                    for (const line of lines) {
                        try {
                            const data = JSON.parse(line);
                            
                            if (data.type === 'progress') {
                                this.currentDomain = data.domain;
                            } else if (data.type === 'result') {
                                this.results.push(data.data);
                                this.completedDomains++;
                                this.currentDomain = '';
                            } else if (data.type === 'error') {
                                this.errors.push(data.message);
                                this.completedDomains++;
                            }
                        } catch (e) {
                            console.error('Parse error:', e);
                        }
                    }
                }
            } catch (error) {
                this.errors.push(`Erreur générale: ${error.message}`);
            } finally {
                this.processing = false;
                this.currentDomain = '';
            }
        },

        formatDate(timestamp) {
            if (!timestamp || timestamp.length < 8) return timestamp;
            const year = timestamp.substr(0, 4);
            const month = timestamp.substr(4, 2);
            const day = timestamp.substr(6, 2);
            return `${day}/${month}/${year}`;
        },

        getWaybackUrl(timestamp, originalUrl) {
            // Generate standard Wayback Machine URL (not id_ mode for viewing)
            return `https://web.archive.org/web/${timestamp}/${originalUrl}`;
        },

        // API Key management
        saveApiKey() {
            if (this.apiKeyInput.trim()) {
                localStorage.setItem('perplexity_api_key', this.apiKeyInput.trim());
                this.apiKey = this.apiKeyInput.trim();
                this.apiKeyInput = '';
            }
        },

        clearApiKey() {
            localStorage.removeItem('perplexity_api_key');
            this.apiKey = '';
        },

        // CSV handling
        handleCsvUpload(event) {
            const file = event.target.files[0];
            if (file && file.type === 'text/csv') {
                this.csvFile = file;
                const reader = new FileReader();
                reader.onload = (e) => {
                    const csv = e.target.result;
                    const lines = csv.split('\n').filter(line => line.trim());
                    // Assume first column contains domains, skip header if present
                    const domains = lines.map(line => {
                        const columns = line.split(',');
                        return columns[0].trim().replace(/['"]/g, '');
                    }).filter(domain => domain && !domain.toLowerCase().includes('domain'));
                    
                    this.domains = domains.join('\n');
                };
                reader.readAsText(file);
            }
        },

        // Spam detection keywords (comprehensive list)
        spamKeywords: [
            // Casino & Gambling
            'casino', 'poker', 'jackpot', 'slots', 'roulette', 'blackjack', 'bingo', 'lottery',
            'gambling', 'betting', 'wager', 'odds', 'bookmaker', 'sportsbook', 'bet365',
            'spin', 'fortune', 'lucky', 'vegas', 'monte carlo',
            
            // Adult content
            'adult', 'porn', 'xxx', 'explicit', 'nude', 'naked', 'escort', 'erotic',
            'milf', 'amateur', 'webcam', 'hookup', 'fetish', 'nsfw',
            
            // Pharmacy & Health scams
            'viagra', 'cialis', 'levitra', 'pharmacy', 'prescription', 'pills', 'medication',
            'weight loss', 'diet pills', 'slim', 'fat burner', 'supplement',
            
            // Finance scams
            'crypto', 'bitcoin', 'forex', 'trading', 'investment', 'loan', 'credit',
            'payday', 'debt', 'mortgage', 'insurance', 'binary options', 'get rich',
            'make money fast', 'earn from home',
            
            // Fake products
            'replica', 'fake', 'counterfeit', 'cheap', 'discount', 'wholesale',
            'designer', 'luxury', 'rolex', 'gucci', 'louis vuitton',
            
            // Tech scams
            'hack', 'crack', 'keygen', 'serial', 'activation', 'license key',
            'torrent', 'download', 'free software', 'pirate',
            
            // General spam indicators
            'click here', 'limited time', 'act now', 'urgent', 'exclusive offer',
            'guaranteed', 'risk free', 'no obligation', 'winner', 'congratulations'
        ],

        // Detect if domain is spam based on title, description, and domain name
        isSpamDomain(domainResult) {
            const domain = domainResult.domain.toLowerCase();
            const snapshots = domainResult.snapshots || [];
            
            // Check if it's a known legitimate domain pattern
            if (this.isLegitimatePattern(domain)) {
                return false;
            }
            
            // Check domain name for spam indicators (more precise matching)
            for (const keyword of this.spamKeywords) {
                if (this.matchesSpamKeyword(domain, keyword)) {
                    domainResult.spamCategory = this.categorizeSpam(keyword);
                    return true;
                }
            }
            
            // Check titles and descriptions
            for (const snapshot of snapshots) {
                const title = (snapshot.title || '').toLowerCase();
                const description = (snapshot.description || '').toLowerCase();
                const text = title + ' ' + description;
                
                for (const keyword of this.spamKeywords) {
                    if (this.matchesSpamKeyword(text, keyword)) {
                        domainResult.spamCategory = this.categorizeSpam(keyword);
                        return true;
                    }
                }
                
                // If Perplexity analysis indicates spam
                if (snapshot.category && this.isSpamCategory(snapshot.category)) {
                    domainResult.spamCategory = snapshot.category;
                    return true;
                }
            }
            
            return false;
        },

        // More precise keyword matching to avoid false positives
        matchesSpamKeyword(text, keyword) {
            // Avoid partial matches for short keywords
            if (keyword.length <= 3) {
                // Use word boundaries for short keywords
                const regex = new RegExp(`\\b${keyword}\\b`, 'i');
                return regex.test(text);
            }
            
            // For longer keywords, simple includes is fine
            return text.includes(keyword);
        },

        // Check for legitimate domain patterns
        isLegitimatePattern(domain) {
            const legitimatePatterns = [
                // Sports
                /football|soccer|sport|match|league|team|player/,
                // News & Media
                /news|media|journal|press|info|actualite/,
                // Government & Education
                /\.gov\.|\.edu\.|\.org\.|ministere|education|universite/,
                // Well-known brands
                /google|microsoft|apple|amazon|facebook|twitter|youtube/,
                // Technology
                /tech|software|app|web|dev|code|github/
            ];
            
            return legitimatePatterns.some(pattern => pattern.test(domain));
        },

        isCleanDomain(domainResult) {
            return !this.isSpamDomain(domainResult);
        },

        categorizeSpam(keyword) {
            const categories = {
                'Casino/Jeux': ['casino', 'poker', 'jackpot', 'slots', 'roulette', 'blackjack', 'bingo', 'lottery', 'gambling', 'betting', 'wager', 'odds', 'bookmaker', 'sportsbook', 'bet365', 'spin', 'fortune', 'lucky', 'vegas'],
                'Contenu adulte': ['adult', 'porn', 'xxx', 'sex', 'sexy', 'nude', 'naked', 'escort', 'dating', 'milf', 'teens', 'amateur', 'webcam', 'cam', 'live', 'chat', 'hookup'],
                'Pharma/Santé': ['viagra', 'cialis', 'levitra', 'pharmacy', 'prescription', 'pills', 'medication', 'weight loss', 'diet pills', 'slim', 'fat burner', 'supplement'],
                'Finance suspect': ['crypto', 'bitcoin', 'forex', 'trading', 'investment', 'loan', 'credit', 'payday', 'debt', 'mortgage', 'insurance', 'binary options', 'get rich', 'make money fast'],
                'Contrefaçon': ['replica', 'fake', 'counterfeit', 'cheap', 'discount', 'wholesale', 'designer', 'luxury', 'rolex', 'gucci', 'louis vuitton'],
                'Piratage': ['hack', 'crack', 'keygen', 'serial', 'activation', 'license key', 'torrent', 'download', 'free software', 'pirate'],
                'Spam générique': ['click here', 'limited time', 'act now', 'urgent', 'exclusive offer', 'guaranteed', 'risk free', 'no obligation', 'winner', 'congratulations']
            };

            for (const [category, keywords] of Object.entries(categories)) {
                if (keywords.includes(keyword)) {
                    return category;
                }
            }
            return 'Spam/Suspect';
        },

        isSpamCategory(category) {
            const spamCategories = ['Casino/Jeux', 'Contenu adulte', 'Spam/Suspect', 'Pharma/Santé', 'Finance suspect', 'Contrefaçon', 'Piratage'];
            return spamCategories.includes(category);
        },

        getSpamCategoryStyle(category) {
            const styles = {
                'Casino/Jeux': 'bg-orange-100 text-orange-800',
                'Contenu adulte': 'bg-red-100 text-red-800',
                'Pharma/Santé': 'bg-pink-100 text-pink-800',
                'Finance suspect': 'bg-yellow-100 text-yellow-800',
                'Contrefaçon': 'bg-purple-100 text-purple-800',
                'Piratage': 'bg-indigo-100 text-indigo-800',
                'Spam générique': 'bg-gray-100 text-gray-800',
                'Spam/Suspect': 'bg-red-100 text-red-800'
            };
            return styles[category] || 'bg-red-100 text-red-800';
        },

        exportJSON() {
            const data = JSON.stringify(this.results, null, 2);
            this.downloadFile(data, 'wayback-results.json', 'application/json');
        },

        exportCSV() {
            let csv = 'Domain,Timestamp,Title,Description,Status,Length,H1_Count\n';
            
            this.results.forEach(domainResult => {
                domainResult.snapshots.forEach(snapshot => {
                    const row = [
                        domainResult.domain,
                        snapshot.timestamp,
                        this.escapeCsvValue(snapshot.title),
                        this.escapeCsvValue(snapshot.description),
                        snapshot.status,
                        snapshot.length,
                        snapshot.h1_count
                    ].join(',');
                    csv += row + '\n';
                });
            });

            this.downloadFile(csv, 'wayback-results.csv', 'text/csv');
        },

        escapeCsvValue(value) {
            if (!value) return '';
            const str = String(value);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        },

        downloadFile(content, filename, contentType) {
            const blob = new Blob([content], { type: contentType });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }
    }
}