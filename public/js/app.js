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
                        unique: this.unique
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