// ── Crosspoint Sync Web App ──────────────────────────────────────────────────
// Uploads files directly to the Crosspoint device over local WiFi

(function () {
    'use strict';

    // ── State ──────────────────────────────────────────────────────────────────
    let deviceUrl = '';
    let connected = false;
    let queue = []; // { file: File, name: string, size: number }

    // ── DOM ────────────────────────────────────────────────────────────────────
    const $ = (id) => document.getElementById(id);
    const statusIndicator = $('statusIndicator');
    const statusText = statusIndicator.querySelector('.status-text');
    const deviceIpInput = $('deviceIp');
    const connectBtn = $('connectBtn');
    const connectionCard = $('connectionCard');
    const uploadCard = $('uploadCard');
    const queueCard = $('queueCard');
    const queueList = $('queueList');
    const queueCount = $('queueCount');
    const clearQueueBtn = $('clearQueueBtn');
    const syncBtn = $('syncBtn');
    const dropZone = $('dropZone');
    const fileInput = $('fileInput');
    const progressCard = $('progressCard');
    const progressFill = $('progressFill');
    const progressText = $('progressText');
    const progressFile = $('progressFile');
    const historyCard = $('historyCard');
    const historyList = $('historyList');
    const newSyncBtn = $('newSyncBtn');

    // ── Init ───────────────────────────────────────────────────────────────────
    function init() {
        // Check URL params for device IP (from QR code)
        const params = new URLSearchParams(window.location.search);
        const deviceParam = params.get('device');
        if (deviceParam) {
            deviceIpInput.value = deviceParam;
            attemptConnect(deviceParam);
        }

        // Load saved device IP
        const savedIp = localStorage.getItem('crosspoint_device_ip');
        if (savedIp && !deviceParam) {
            deviceIpInput.value = savedIp;
        }

        // Event listeners
        connectBtn.addEventListener('click', () => attemptConnect(deviceIpInput.value.trim()));
        deviceIpInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') attemptConnect(deviceIpInput.value.trim());
        });

        dropZone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', handleFileSelect);
        dropZone.addEventListener('dragover', handleDragOver);
        dropZone.addEventListener('dragleave', handleDragLeave);
        dropZone.addEventListener('drop', handleDrop);

        clearQueueBtn.addEventListener('click', clearQueue);
        syncBtn.addEventListener('click', syncFiles);
        newSyncBtn.addEventListener('click', resetToUpload);
    }

    // ── Connection ─────────────────────────────────────────────────────────────
    async function attemptConnect(ip) {
        if (!ip) return;

        // Normalize the IP
        if (!ip.startsWith('http://') && !ip.startsWith('https://')) {
            ip = 'http://' + ip;
        }
        deviceUrl = ip;

        setStatus('connecting', 'Connecting...');
        connectBtn.textContent = '...';
        connectBtn.disabled = true;

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            const resp = await fetch(deviceUrl + '/status', {
                signal: controller.signal,
                mode: 'cors'
            });
            clearTimeout(timeout);

            if (resp.ok) {
                const data = await resp.json();
                if (data.ready) {
                    onConnected(ip);
                    return;
                }
            }
            onConnectionFailed('Device not ready');
        } catch (e) {
            onConnectionFailed(e.name === 'AbortError' ? 'Timeout' : 'Connection failed');
        }
    }

    function onConnected(ip) {
        connected = true;
        localStorage.setItem('crosspoint_device_ip', ip);

        setStatus('connected', 'Connected');
        connectBtn.textContent = 'Connect';
        connectBtn.disabled = false;

        connectionCard.style.display = 'none';
        uploadCard.style.display = 'block';
        if (queue.length > 0) {
            queueCard.style.display = 'block';
        }
    }

    function onConnectionFailed(reason) {
        connected = false;
        setStatus('disconnected', reason);
        connectBtn.textContent = 'Connect';
        connectBtn.disabled = false;
    }

    function setStatus(state, text) {
        statusIndicator.className = 'status-indicator ' + (state === 'connected' ? 'connected' : '');
        statusText.textContent = text;
    }

    // ── File Handling ──────────────────────────────────────────────────────────
    function handleFileSelect(e) {
        addFiles(Array.from(e.target.files));
        fileInput.value = '';
    }

    function handleDragOver(e) {
        e.preventDefault();
        dropZone.classList.add('dragover');
    }

    function handleDragLeave(e) {
        e.preventDefault();
        dropZone.classList.remove('dragover');
    }

    function handleDrop(e) {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        addFiles(Array.from(e.dataTransfer.files));
    }

    function addFiles(files) {
        for (const file of files) {
            queue.push({
                file: file,
                name: file.name,
                size: file.size
            });
        }
        renderQueue();
    }

    function removeFile(index) {
        queue.splice(index, 1);
        renderQueue();
    }

    function clearQueue() {
        queue = [];
        renderQueue();
    }

    function renderQueue() {
        queueCount.textContent = queue.length;
        queueCard.style.display = queue.length > 0 ? 'block' : 'none';

        queueList.innerHTML = queue.map((item, i) => `
      <div class="queue-item">
        <span class="queue-item-icon">${getFileIcon(item.name)}</span>
        <div class="queue-item-info">
          <div class="queue-item-name">${escapeHtml(item.name)}</div>
          <div class="queue-item-size">${formatSize(item.size)}</div>
        </div>
        <button class="queue-item-remove" data-index="${i}" title="Remove">×</button>
      </div>
    `).join('');

        // Attach remove handlers
        queueList.querySelectorAll('.queue-item-remove').forEach(btn => {
            btn.addEventListener('click', () => removeFile(parseInt(btn.dataset.index)));
        });
    }

    // ── Sync ───────────────────────────────────────────────────────────────────
    async function syncFiles() {
        if (queue.length === 0 || !connected) return;

        uploadCard.style.display = 'none';
        queueCard.style.display = 'none';
        progressCard.style.display = 'block';

        const totalFiles = queue.length;
        const results = [];

        for (let i = 0; i < totalFiles; i++) {
            const item = queue[i];
            progressText.textContent = `${i + 1} / ${totalFiles} files`;
            progressFile.textContent = item.name;
            progressFill.style.width = `${((i) / totalFiles) * 100}%`;

            try {
                const formData = new FormData();
                formData.append('file', item.file, item.name);

                const resp = await fetch(deviceUrl + '/upload', {
                    method: 'POST',
                    headers: {
                        'X-Filename': item.name
                    },
                    body: formData
                });

                if (resp.ok) {
                    results.push({ name: item.name, success: true });
                } else {
                    results.push({ name: item.name, success: false });
                }
            } catch (e) {
                results.push({ name: item.name, success: false });
            }

            progressFill.style.width = `${((i + 1) / totalFiles) * 100}%`;
        }

        // Done
        progressCard.style.display = 'none';
        showHistory(results);
        queue = [];
    }

    function showHistory(results) {
        historyCard.style.display = 'block';
        historyList.innerHTML = results.map(r =>
            `<div class="history-item" style="${r.success ? '' : 'color: var(--danger); background: rgba(248,113,113,0.04)'}">
        ${escapeHtml(r.name)}${r.success ? '' : ' (failed)'}
      </div>`
        ).join('');
    }

    function resetToUpload() {
        historyCard.style.display = 'none';
        uploadCard.style.display = 'block';
        renderQueue();
    }

    // ── Helpers ────────────────────────────────────────────────────────────────
    function formatSize(bytes) {
        if (bytes > 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        if (bytes > 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return bytes + ' B';
    }

    function getFileIcon(name) {
        const ext = name.split('.').pop().toLowerCase();
        const icons = {
            epub: '📖', pdf: '📄', txt: '📝', mobi: '📕',
            jpg: '🖼️', jpeg: '🖼️', png: '🖼️', bmp: '🖼️',
            mp3: '🎵', wav: '🎵', flac: '🎵',
            zip: '📦', rar: '📦', '7z': '📦'
        };
        return icons[ext] || '📄';
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ── Background Sync (Service Worker check) ─────────────────────────────────
    // If there's a pending queue and the device becomes reachable, auto-sync
    async function backgroundPoll() {
        if (!connected && deviceUrl) {
            try {
                const resp = await fetch(deviceUrl + '/status', { mode: 'cors' });
                if (resp.ok) {
                    const data = await resp.json();
                    if (data.ready) {
                        onConnected(deviceUrl);
                        // Auto-sync if there are queued items
                        if (queue.length > 0) {
                            syncFiles();
                        }
                    }
                }
            } catch (e) {
                // Device not reachable, try again later
            }
        }
    }

    // Poll every 10 seconds for device availability
    setInterval(backgroundPoll, 10000);

    // ── Service Worker ─────────────────────────────────────────────────────────
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => { });
    }

    // ── Start ──────────────────────────────────────────────────────────────────
    init();
})();
