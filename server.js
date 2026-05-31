const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const CSV_FILE = path.join(__dirname, 'attendance.csv');
const EXCEL_FILE = path.join(__dirname, 'attendance.xlsx');

// Content types map for static files
const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const method = req.method;

    console.log(`${method} ${url.pathname}`);

    // --- API ENDPOINTS ---

    // 1. GET /api/status
    if (url.pathname === '/api/status' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'online' }));
        return;
    }

    // 2. POST /api/attendance (Append single record to CSV)
    if (url.pathname === '/api/attendance' && method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const record = JSON.parse(body);
                
                // Write Header if file doesn't exist
                if (!fs.existsSync(CSV_FILE)) {
                    fs.writeFileSync(CSV_FILE, '"S.No","Student ID","Name","Department","Date","Time Logged"\n', 'utf8');
                }
                
                // Format CSV Line and append
                const csvLine = `"${record.index}","${record.id}","${record.name}","${record.dept}","${record.date}","${record.time}"\n`;
                fs.appendFileSync(CSV_FILE, csvLine, 'utf8');

                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Attendance logged to CSV');
            } catch (err) {
                console.error(err);
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Bad Request - Invalid JSON');
            }
        });
        return;
    }

    // 3. POST /api/save-excel (Write client-generated excel buffer to disk)
    if (url.pathname === '/api/save-excel' && method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                if (!payload.base64Data) {
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('Missing base64 data');
                    return;
                }

                // Decode base64 to binary buffer
                const buffer = Buffer.from(payload.base64Data, 'base64');
                
                // Overwrite the excel file
                fs.writeFileSync(EXCEL_FILE, buffer);

                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Attendance spreadsheet saved');
            } catch (err) {
                console.error(err);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Failed to save spreadsheet');
            }
        });
        return;
    }

    // 4. POST /api/sync-batch (Rebuild CSV when syncing)
    if (url.pathname === '/api/sync-batch' && method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                const records = payload.records || [];

                // Re-write CSV header and content
                let csvContent = '"S.No","Student ID","Name","Department","Date","Time Logged"\n';
                records.forEach(record => {
                    csvContent += `"${record.index}","${record.id}","${record.name}","${record.dept}","${record.date}","${record.time}"\n`;
                });

                fs.writeFileSync(CSV_FILE, csvContent, 'utf8');

                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Batch sync complete');
            } catch (err) {
                console.error(err);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Failed to batch sync CSV');
            }
        });
        return;
    }

    // 5. POST /api/clear-files (Wipe files from disk on clear)
    if (url.pathname === '/api/clear-files' && method === 'POST') {
        try {
            if (fs.existsSync(CSV_FILE)) fs.unlinkSync(CSV_FILE);
            if (fs.existsSync(EXCEL_FILE)) fs.unlinkSync(EXCEL_FILE);
            
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Files deleted');
        } catch (e) {
            console.error(e);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error deleting files');
        }
        return;
    }

    // --- STATIC FILE SERVING ---
    
    // Default route mapping
    let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
    let fullPath = path.join(__dirname, filePath);

    // Security check - prevent folder traversal
    const relativePath = path.relative(__dirname, fullPath);
    const isSafe = relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);

    if (!isSafe) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }

    fs.stat(fullPath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
            return;
        }

        // Get extension
        const ext = path.extname(fullPath).toLowerCase();
        const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';

        // Pipe file contents to response stream
        res.writeHead(200, { 'Content-Type': contentType });
        const stream = fs.createReadStream(fullPath);
        stream.pipe(res);
    });
});

server.listen(PORT, () => {
    console.log(`=============================================================`);
    console.log(`  QR Attendance System Server is running at:`);
    console.log(`  🚀 http://localhost:${PORT}`);
    console.log(`=============================================================`);
});
