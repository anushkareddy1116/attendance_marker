// Application State
let attendanceData = [];
let scannedIdsToday = new Map(); // Store ID -> Last Scan Timestamp
let isServerOnline = false;
let webcamStream = null;
let currentCameraId = '';
let scanIntervalId = null;
let serverCheckIntervalId = null;
let isScanning = false;
let audioContext = null;

// DOM Elements
const webcamPreview = document.getElementById('webcam-preview');
const webcamCanvas = document.getElementById('webcam-canvas');
const cameraSelect = document.getElementById('camera-select');
const cameraToggleBtn = document.getElementById('camera-toggle-btn');
const scannerOverlay = document.getElementById('scanner-viewfinder');
const cameraFallbackMsg = document.getElementById('camera-fallback-msg');
const scanFeedbackAlert = document.getElementById('scan-feedback-alert');
const attendanceTbody = document.getElementById('attendance-tbody');
const liveClockSpan = document.getElementById('live-clock');

// Stats DOM
const metricTotal = document.getElementById('metric-total');
const metricUnique = document.getElementById('metric-unique');
const metricLast = document.getElementById('metric-last');

// Server Status Pill DOM
const serverStatusPill = document.getElementById('server-status-pill');
const serverStatusText = document.getElementById('server-status-text');

// Toast DOM
const toastElement = document.getElementById('toast');
const toastTitle = document.getElementById('toast-title');
const toastDesc = document.getElementById('toast-desc');
const toastIcon = document.getElementById('toast-icon');

// QR Generator DOM
const qrForm = document.getElementById('qr-form');
const cardStudentName = document.getElementById('card-student-name');
const cardStudentId = document.getElementById('card-student-id');
const cardStudentDept = document.getElementById('card-student-dept');
const downloadQrBtn = document.getElementById('download-qr-btn');
const printQrBtn = document.getElementById('print-qr-btn');
const qrCodeContainer = document.getElementById('qrcode-canvas-container');

// App Initialization
document.addEventListener('DOMContentLoaded', () => {
    // Start clock tick
    updateClock();
    setInterval(updateClock, 1000);

    // Initialize local database cache
    loadLocalAttendance();

    // Verify status of local server
    checkServerStatus();
    serverCheckIntervalId = setInterval(checkServerStatus, 5000);

    // Bind event handlers
    cameraSelect.addEventListener('change', (e) => {
        currentCameraId = e.target.value;
        if (webcamStream) {
            initWebcam(currentCameraId);
        }
    });

    cameraToggleBtn.addEventListener('click', toggleCamera);

    // Start scanner console on start
    initWebcam();
});

// Clock widget tick
function updateClock() {
    const now = new Date();
    const options = { 
        weekday: 'short', 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        hour12: false 
    };
    liveClockSpan.textContent = now.toLocaleDateString('en-US', options);
}

// Fetch local backend network state
async function checkServerStatus() {
    try {
        const response = await fetch('/api/status', { method: 'GET', signal: AbortSignal.timeout(2000) });
        if (response.ok) {
            if (!isServerOnline) {
                isServerOnline = true;
                serverStatusPill.className = 'connection-pill online';
                serverStatusText.textContent = 'Connected';
                showToast('Server Active', 'Logs are being auto-saved directly to local disk.', 'success');
                syncLocalDataToServer();
            }
        } else {
            throw new Error('Connection error');
        }
    } catch (e) {
        if (isServerOnline || serverStatusText.textContent === 'Connecting...') {
            isServerOnline = false;
            serverStatusPill.className = 'connection-pill offline';
            serverStatusText.textContent = 'Offline Mode';
            showToast('Offline Mode Active', 'Attendance changes cached to browser storage.', 'warning');
        }
    }
}

// Navigate app screens
function switchTab(tabName) {
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`nav-${tabName}`).classList.add('active');

    document.querySelectorAll('.tab-content').forEach(pane => pane.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).classList.add('active');

    const viewTitle = document.getElementById('view-title');
    const viewSubtitle = document.getElementById('view-subtitle');
    
    if (tabName === 'scanner') {
        viewTitle.textContent = 'Scan Terminal';
        viewSubtitle.textContent = 'Capture real-time student check-ins';
        if (!webcamStream) {
            initWebcam(currentCameraId);
        }
    } else {
        viewTitle.textContent = 'Pass Register';
        viewSubtitle.textContent = 'Create unique printable identification passes';
        stopWebcam();
    }
}

// --- CAMERA VIDEO STREAMS ---

async function initWebcam(deviceId = null) {
    stopWebcam();
    cameraFallbackMsg.style.display = 'none';
    webcamPreview.style.display = 'block';
    
    try {
        const constraints = {
            video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' }
        };
        
        webcamStream = await navigator.mediaDevices.getUserMedia(constraints);
        webcamPreview.srcObject = webcamStream;
        cameraToggleBtn.classList.add('active');
        isScanning = true;
        
        enumerateCameras();

        // Start requestAnimationFrame loop
        scanIntervalId = requestAnimationFrame(scanQRCodeLoop);

    } catch (err) {
        console.error('Camera input error:', err);
        cameraFallbackMsg.style.display = 'flex';
        cameraFallbackMsg.querySelector('p').textContent = 'Webcam not found or access denied.';
        webcamPreview.style.display = 'none';
        cameraToggleBtn.classList.remove('active');
        isScanning = false;
    }
}

function stopWebcam() {
    isScanning = false;
    if (scanIntervalId) {
        cancelAnimationFrame(scanIntervalId);
        scanIntervalId = null;
    }
    if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
        webcamStream = null;
    }
    webcamPreview.srcObject = null;
    cameraToggleBtn.classList.remove('active');
    cameraFallbackMsg.style.display = 'flex';
    cameraFallbackMsg.querySelector('p').textContent = 'Camera feed disabled';
}

function toggleCamera() {
    if (webcamStream) {
        stopWebcam();
    } else {
        initWebcam(currentCameraId);
    }
}

async function enumerateCameras() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        
        cameraSelect.innerHTML = '';
        if (videoDevices.length === 0) {
            cameraSelect.innerHTML = '<option value="">No cameras detected</option>';
            return;
        }

        videoDevices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = device.label || `Camera ${cameraSelect.length + 1}`;
            if (device.deviceId === currentCameraId) {
                option.selected = true;
            }
            cameraSelect.appendChild(option);
        });

        if (!currentCameraId && videoDevices.length > 0) {
            currentCameraId = videoDevices[0].deviceId;
        }
    } catch (e) {
        console.error('Error fetching cameras:', e);
    }
}

// Canvas Frame grab loop
function scanQRCodeLoop() {
    if (!isScanning || !webcamStream || webcamPreview.paused || webcamPreview.ended) {
        if (isScanning) {
            scanIntervalId = requestAnimationFrame(scanQRCodeLoop);
        }
        return;
    }

    if (webcamPreview.readyState === webcamPreview.HAVE_ENOUGH_DATA) {
        webcamCanvas.width = webcamPreview.videoWidth;
        webcamCanvas.height = webcamPreview.videoHeight;
        
        const ctx = webcamCanvas.getContext('2d');
        ctx.translate(webcamCanvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(webcamPreview, 0, 0, webcamCanvas.width, webcamCanvas.height);
        
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const imageData = ctx.getImageData(0, 0, webcamCanvas.width, webcamCanvas.height);
        
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
        });

        if (code) {
            processScannedContent(code.data);
        }
    }
    
    if (isScanning) {
        scanIntervalId = requestAnimationFrame(scanQRCodeLoop);
    }
}

// QR parsing & cooling debounce
function processScannedContent(rawText) {
    try {
        let student = null;
        if (rawText.trim().startsWith('{')) {
            student = JSON.parse(rawText);
        } else {
            const parts = rawText.split('|');
            if (parts.length >= 3) {
                student = {
                    id: parts[0].trim(),
                    name: parts[1].trim(),
                    dept: parts[2].trim()
                };
            }
        }

        if (!student || !student.id || !student.name || !student.dept) return;

        const now = Date.now();
        const DEBOUNCE_MS = 6000;

        if (scannedIdsToday.has(student.id)) {
            const lastScan = scannedIdsToday.get(student.id);
            if (now - lastScan < DEBOUNCE_MS) return;
        }

        scannedIdsToday.set(student.id, now);
        markStudentPresent(student);

    } catch (e) {
        console.warn('QR Code skipped:', e);
    }
}

// Mark student present process
function markStudentPresent(student) {
    const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });
    const dateStr = new Date().toLocaleDateString('en-US');
    
    const record = {
        index: attendanceData.length + 1,
        id: student.id,
        name: student.name,
        dept: student.dept,
        time: timeStr,
        date: dateStr
    };

    attendanceData.push(record);
    saveLocalAttendance();

    // Trigger visual components
    addRecordToTable(record, true);
    updateStatsWidgets(record);
    triggerViewfinderSuccess();
    showScanFeedbackCard(record);
    playVerifyBeep();

    if (isServerOnline) {
        syncSingleRecordToServer(record);
    } else {
        showToast('Check-in Logged', `${student.name} marked present locally.`, 'success');
    }
}

// Sound effects generator
function playVerifyBeep() {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }

        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(950, audioContext.currentTime); // C# note
        gain.gain.setValueAtTime(0.06, audioContext.currentTime);
        osc.start();
        osc.stop(audioContext.currentTime + 0.07);

        // Double note trigger
        setTimeout(() => {
            const osc2 = audioContext.createOscillator();
            const gain2 = audioContext.createGain();
            osc2.connect(gain2);
            gain2.connect(audioContext.destination);
            
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(1200, audioContext.currentTime); // High pitch note
            gain2.gain.setValueAtTime(0.06, audioContext.currentTime);
            osc2.start();
            osc2.stop(audioContext.currentTime + 0.1);
        }, 60);

    } catch (e) {
        console.error('Audio synthesizer error:', e);
    }
}

// Trigger visual success classes on view finder
function triggerViewfinderSuccess() {
    scannerOverlay.classList.add('success');
    setTimeout(() => {
        scannerOverlay.classList.remove('success');
    }, 450);
}

// Slide up notification banner on camera feed
function showScanFeedbackCard(record) {
    document.getElementById('feedback-name').textContent = record.name;
    document.getElementById('feedback-id').textContent = `ID: ${record.id}`;
    document.getElementById('feedback-time').textContent = record.time;
    
    scanFeedbackAlert.style.display = 'flex';

    setTimeout(() => {
        if (document.getElementById('feedback-id').textContent === `ID: ${record.id}`) {
            scanFeedbackAlert.style.animation = 'slide-up 0.3s reverse forwards';
            setTimeout(() => {
                scanFeedbackAlert.style.display = 'none';
                scanFeedbackAlert.style.animation = '';
            }, 300);
        }
    }, 3200);
}

// Build table row template
function addRecordToTable(record, isNew = false) {
    const emptyRow = attendanceTbody.querySelector('.table-empty-state');
    if (emptyRow) {
        emptyRow.remove();
    }

    const tr = document.createElement('tr');
    tr.id = `row-${record.id}`;
    if (isNew) {
        tr.className = 'new-row';
    }

    // Generate letters initials for avatar bubbler
    const nameParts = record.name.trim().split(' ');
    const initials = nameParts.map(p => p[0]).slice(0, 2).join('').toUpperCase() || 'ST';

    tr.innerHTML = `
        <td>
            <div class="student-avatar-cell">
                <div class="avatar-bubble">${initials}</div>
                <div class="student-name-meta">${record.name}</div>
            </div>
        </td>
        <td><span class="mono">${record.id}</span></td>
        <td><span class="badge">${record.dept}</span></td>
        <td><span class="mono">${record.time}</span></td>
        <td class="action-cell">
            <button class="action-row-btn" onclick="deleteRecord('${record.id}')" title="Delete record">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            </button>
        </td>
    `;

    attendanceTbody.insertBefore(tr, attendanceTbody.firstChild);
}

// Update table visual rows
function renderTable() {
    attendanceTbody.innerHTML = '';
    
    if (attendanceData.length === 0) {
        attendanceTbody.innerHTML = `
            <tr class="table-empty-state">
                <td colspan="5">
                    <div class="empty-state-wrapper">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-muted);"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>
                        <p>Classroom register is empty. Hold QR pass to camera to mark attendance.</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    const reversed = [...attendanceData].reverse();
    reversed.forEach(record => {
        addRecordToTable(record, false);
    });
}

// Refresh top dashboard numbers
function updateStatsWidgets(lastRecord = null) {
    metricTotal.textContent = attendanceData.length;
    const uniques = new Set(attendanceData.map(r => r.id));
    metricUnique.textContent = uniques.size;

    if (lastRecord) {
        metricLast.textContent = lastRecord.time;
    } else {
        metricLast.textContent = '--:--:--';
    }
}

// Delete row handler
function deleteRecord(id) {
    if (confirm(`Remove attendance log for Student ID: ${id}?`)) {
        attendanceData = attendanceData.filter(r => r.id !== id);
        attendanceData.forEach((record, index) => {
            record.index = index + 1;
        });

        saveLocalAttendance();
        renderTable();
        updateStatsWidgets();

        if (isServerOnline) {
            syncFullDatabaseToServer();
        }

        showToast('Record Deleted', `Attendance log for Student ID: ${id} was deleted.`, 'success');
    }
}

// Wipe table logs
function clearLogs() {
    if (confirm('Are you sure you want to clear ALL attendance records for this session? This action is permanent!')) {
        attendanceData = [];
        scannedIdsToday.clear();
        saveLocalAttendance();
        renderTable();
        updateStatsWidgets();

        if (isServerOnline) {
            syncFullDatabaseToServer();
        }

        showToast('Database Wiped', 'Classroom records wiped successfully.', 'success');
    }
}

// Add manual override row
function handleManualAttendance(event) {
    event.preventDefault();
    const idField = document.getElementById('manual-id');
    const nameField = document.getElementById('manual-name');
    const deptField = document.getElementById('manual-dept');

    const student = {
        id: idField.value.trim(),
        name: nameField.value.trim(),
        dept: deptField.value.trim()
    };

    if (student.id && student.name && student.dept) {
        markStudentPresent(student);

        idField.value = '';
        nameField.value = '';
        deptField.value = '';
        
        showToast('Manual Check-in', `Registered ${student.name} present.`, 'success');
    }
}

// --- LOCAL SERVER FILE SYNCS ---

async function syncSingleRecordToServer(record) {
    try {
        const response = await fetch('/api/attendance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(record)
        });

        if (response.ok) {
            syncFullDatabaseToServer();
        }
    } catch (e) {
        console.error('Server sync error: ', e);
    }
}

// Convert data to Excel client-side and post base64 to server
async function syncFullDatabaseToServer() {
    if (attendanceData.length === 0) {
        try {
            await fetch('/api/clear-files', { method: 'POST' });
        } catch (e) { console.error(e); }
        return;
    }

    try {
        const worksheetData = attendanceData.map(r => ({
            "S.No": r.index,
            "Student ID": r.id,
            "Name": r.name,
            "Department": r.dept,
            "Date": r.date,
            "Time Logged": r.time
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(worksheetData);
        ws['!cols'] = [
            {wch: 8}, {wch: 18}, {wch: 25}, {wch: 20}, {wch: 15}, {wch: 15}
        ];

        XLSX.utils.book_append_sheet(wb, ws, "Attendance Sheet");
        const excelBase64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });

        await fetch('/api/save-excel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64Data: excelBase64 })
        });
    } catch (e) {
        console.error('Excel sync error:', e);
    }
}

// Batch sync local storage logs
async function syncLocalDataToServer() {
    if (attendanceData.length === 0) return;
    
    try {
        const response = await fetch('/api/sync-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ records: attendanceData })
        });
        
        if (response.ok) {
            syncFullDatabaseToServer();
            showToast('Sync Completed', 'All cached offline scan logs synchronized to server files.', 'success');
        }
    } catch (e) {
        console.error('Batch sync failed:', e);
    }
}

// --- LOCAL DATA CACHE & EXPORT FILE GENERATORS ---

function saveLocalAttendance() {
    localStorage.setItem('rollcall_attendance_logs', JSON.stringify(attendanceData));
}

function loadLocalAttendance() {
    const cached = localStorage.getItem('rollcall_attendance_logs');
    if (cached) {
        try {
            attendanceData = JSON.parse(cached);
            renderTable();
            updateStatsWidgets();
            
            attendanceData.forEach(r => {
                scannedIdsToday.set(r.id, Date.now() - 10000);
            });
        } catch (e) {
            console.error('Local cache error:', e);
            attendanceData = [];
        }
    }
}

// Client-side Excel export download
function exportExcel() {
    if (attendanceData.length === 0) {
        showToast('Export Cancelled', 'No attendance logs exist to export.', 'warning');
        return;
    }

    try {
        const worksheetData = attendanceData.map(r => ({
            "S.No": r.index,
            "Student ID": r.id,
            "Name": r.name,
            "Department": r.dept,
            "Date": r.date,
            "Time Logged": r.time
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(worksheetData);
        ws['!cols'] = [
            {wch: 8}, {wch: 18}, {wch: 25}, {wch: 20}, {wch: 15}, {wch: 15}
        ];

        XLSX.utils.book_append_sheet(wb, ws, "Attendance Log");
        
        const timestamp = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, `Attendance_Log_${timestamp}.xlsx`);
        showToast('Export Successful', 'Excel file download has started.', 'success');
    } catch (err) {
        console.error(err);
        showToast('Export Error', 'Could not generate spreadsheet.', 'warning');
    }
}

// Client-side CSV export download
function exportCSV() {
    if (attendanceData.length === 0) {
        showToast('Export Cancelled', 'No attendance logs exist to export.', 'warning');
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "S.No,Student ID,Name,Department,Date,Time Logged\n";

    attendanceData.forEach(r => {
        csvContent += `"${r.index}","${r.id}","${r.name}","${r.dept}","${r.date}","${r.time}"\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().slice(0, 10);
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Attendance_Log_${timestamp}.csv`);
    document.body.appendChild(link);
    
    link.click();
    document.body.removeChild(link);
    showToast('Export Successful', 'CSV file download has started.', 'success');
}

// --- STUDENT QR CARD CREATOR ---

let activeQRCode = null;

function generateStudentQR(event) {
    event.preventDefault();
    
    const idVal = document.getElementById('student-id').value.trim();
    const nameVal = document.getElementById('student-name').value.trim();
    const deptVal = document.getElementById('student-dept').value.trim();

    if (!idVal || !nameVal || !deptVal) {
        showToast('Invalid form details', 'Please check and complete all required inputs.', 'warning');
        return;
    }

    const payload = JSON.stringify({
        id: idVal,
        name: nameVal,
        dept: deptVal
    });

    qrCodeContainer.innerHTML = '';

    try {
        activeQRCode = new QRCode(qrCodeContainer, {
            text: payload,
            width: 120,
            height: 120,
            colorDark : "#000000",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.M
        });

        // Update ID preview details
        cardStudentName.textContent = nameVal.toUpperCase();
        cardStudentId.textContent = idVal;
        cardStudentDept.textContent = deptVal;

        // Enable buttons
        downloadQrBtn.disabled = false;
        printQrBtn.disabled = false;

        showToast('Card Created', `Official pass compiled for ${nameVal}.`, 'success');

    } catch (e) {
        console.error('QR creation error: ', e);
        showToast('Compilation error', 'Could not create QR block code.', 'warning');
    }
}

function resetGeneratorForm() {
    qrForm.reset();
    qrCodeContainer.innerHTML = `
        <div class="qr-placeholder">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="placeholder-qr-icon"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
            <span>Awaiting data entry</span>
        </div>
    `;
    cardStudentName.textContent = 'STUDENT NAME';
    cardStudentId.textContent = '-- --- --';
    cardStudentDept.textContent = '-----------';
    downloadQrBtn.disabled = true;
    printQrBtn.disabled = true;
    activeQRCode = null;
}

// Download ID card preview as image using html2canvas
function downloadCardImage() {
    const card = document.getElementById('student-card-element');
    const studentName = document.getElementById('student-name').value.trim().replace(/\s+/g, '_');
    
    html2canvas(card, {
        scale: 2,
        backgroundColor: '#09090b',
        logging: false,
        useCORS: true
    }).then(canvas => {
        const link = document.createElement('a');
        link.download = `Pass_Card_${studentName || 'Student'}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        showToast('Image Downloaded', 'ID Pass Card PNG file saved.', 'success');
    }).catch(err => {
        console.error('html2canvas rendering issue:', err);
        showToast('Download Blocked', 'Your browser security blocked canvas capture.', 'warning');
    });
}

function printCard() {
    window.print();
}

// --- BRAND SYSTEM TOAST ---

let toastTimeout = null;

function showToast(title, desc, type = 'success') {
    if (toastTimeout) {
        clearTimeout(toastTimeout);
    }

    toastTitle.textContent = title;
    toastDesc.textContent = desc;

    toastElement.className = 'system-toast show';
    
    if (type === 'success') {
        toastElement.classList.add('success');
        toastIcon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
    } else if (type === 'warning') {
        toastElement.classList.add('warning');
        toastIcon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
    } else {
        toastIcon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
    }

    toastTimeout = setTimeout(() => {
        toastElement.classList.remove('show');
    }, 4000);
}
