const http = require('http');

http.get('http://localhost:3000/api/tickets/metrics?scope=mantenimientos', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            console.log("Full JSON:", json);
        } catch(e) {
            console.log("Error parsing JSON:", e, data);
        }
    });
}).on('error', (err) => console.log("Request error:", err));
