// ==========================================================================
// FILE: js/gps-engine.js
// FUNGSI: Integrasi Peta OSM, Radar Dinamis (Wake Lock), & Jaring Mangkal (TTL)
// ==========================================================================

import { auth, db } from './firebase-config.js';
import { ref, update } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const toggleOnline = document.getElementById('toggle-online');
const statusText = document.getElementById('status-text');
const modeSelect = document.getElementById('radar-mode');
const timerContainer = document.getElementById('mangkal-timer-container');
const durasiSelect = document.getElementById('mangkal-durasi');

let gpsWatchId = null;
let transmisiTimer = null;
let mangkalTimeout = null;
let wakeLock = null;

let isBlokirGlobal = false;
let isBlokirLokal = false;
let intervalGlobal = 30000; // Default 30 detik untuk penghematan kuota Dinamis

// 1. INISIALISASI PETA OSM (LEAFLET)
// Menggunakan window.mapSystem agar bisa dipanggil invalidateSize() dari dashboard.js
window.mapSystem = L.map('map').setView([-6.200000, 106.816666], 14); // Default Jakarta
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
}).addTo(window.mapSystem);

// Marker Driver
let driverMarker = L.marker([-6.200000, 106.816666]).addTo(window.mapSystem);

// Ambil lokasi instan saat aplikasi dibuka untuk update peta
navigator.geolocation.getCurrentPosition(pos => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    window.mapSystem.setView([lat, lng], 16);
    driverMarker.setLatLng([lat, lng]);
});


// 2. PANTAU INSTRUKSI ADMIN
window.addEventListener('masterControlUpdated', (e) => {
    const master = e.detail;
    isBlokirGlobal = master.blokirSemuaGps === true;
    if (master.intervalGlobalGps) intervalGlobal = master.intervalGlobalGps;
});

window.addEventListener('driverDataLoaded', (e) => {
    const data = e.detail;
    if (data.admin) isBlokirLokal = data.admin.blokirGps === true;
    
    // Kembalikan UI dari state terakhir di server
    if (data.status && data.status.isOnline) {
        toggleOnline.checked = true;
        modeSelect.value = data.status.mode || 'dinamis';
        
        // Hentikan radar jika status kedaluwarsa secara lokal
        if (data.status.mode === 'jaring' && data.status.expiresAt < Date.now()) {
            matikanPaksa("Durasi mangkal sebelumnya telah habis.");
        } else {
            // Lanjutkan radar (Trigger toggle)
            updateUI(true, modeSelect.value);
            if (modeSelect.value === 'jaring') eksekusiModeJaring();
            else eksekusiModeDinamis();
        }
    }
});


// 3. LOGIKA WAKE LOCK API (Anti-Layar Mati untuk Latar Belakang)
async function kunciLayarMenyala() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) {
        console.warn("Wake Lock ditolak OS:", err);
    }
}
function lepasKunciLayar() {
    if (wakeLock !== null) {
        wakeLock.release().then(() => wakeLock = null);
    }
}


// 4. KONTROL UI MODE RADAR (Dinamis vs Jaring)
modeSelect.addEventListener('change', (e) => {
    if (e.target.value === 'jaring') {
        timerContainer.classList.remove('hidden-state');
        driverMarker.dragging.enable();
        driverMarker.bindPopup("Geser pin ke titik mangkal").openPopup();
    } else {
        timerContainer.classList.add('hidden-state');
        driverMarker.dragging.disable();
        driverMarker.closePopup();
    }
    
    // Jika sedang ON dan mode diganti, matikan otomatis demi keamanan data
    if (toggleOnline.checked) {
        alert("Mode diubah. Radar otomatis dimatikan.", "warning");
        matikanPaksa();
    }
});


// 5. LOGIKA SAKELAR UTAMA
toggleOnline.addEventListener('change', (e) => {
    if (!auth.currentUser) return;
    const isOnline = e.target.checked;

    if (isOnline && (isBlokirGlobal || isBlokirLokal)) {
        alert("RADAR DIBLOKIR: Otoritas ditangguhkan oleh Admin.", "error");
        e.target.checked = false; return;
    }

    if (isOnline) {
        kunciLayarMenyala();
        modeSelect.disabled = true;
        
        if (modeSelect.value === 'jaring') eksekusiModeJaring();
        else eksekusiModeDinamis();
    } else {
        matikanPaksa();
    }
});


// ==========================================
// MESIN 1: MODE JARING (Titik Manual & TTL)
// ==========================================
function eksekusiModeJaring() {
    updateUI(true, 'jaring');
    
    const durasiJam = parseInt(durasiSelect.value);
    const expiresAt = Date.now() + (durasiJam * 60 * 60 * 1000); // Konversi jam ke milidetik
    const pos = driverMarker.getLatLng();

    const payload = {
        isOnline: true, 
        mode: 'jaring',
        lat: pos.lat, 
        lng: pos.lng,
        timestamp: Date.now(),
        expiresAt: expiresAt
    };

    update(ref(db, `drivers/${auth.currentUser.uid}/status`), payload).then(() => {
        alert(`Titik mangkal dikunci untuk ${durasiJam} Jam ke depan.`, "success");
        driverMarker.dragging.disable(); // Kunci pin agar tidak tergeser tak sengaja
    });

    // Auto-off lokal jika aplikasi dibiarkan terbuka terus menerus
    mangkalTimeout = setTimeout(() => {
        matikanPaksa("Durasi mangkal habis. Radar dimatikan otomatis.");
    }, durasiJam * 60 * 60 * 1000);
}


// ==========================================
// MESIN 2: MODE DINAMIS (Throttled GPS)
// ==========================================
function eksekusiModeDinamis() {
    updateUI(true, 'dinamis');
    let koordinatLokal = null;

    // Lacak posisi konstan untuk pergerakan mulus di Peta UI lokal
    gpsWatchId = navigator.geolocation.watchPosition(
        (pos) => { 
            koordinatLokal = pos; 
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            driverMarker.setLatLng([lat, lng]);
            window.mapSystem.setView([lat, lng]);
        },
        (err) => { 
            alert("Akses GPS ditolak atau tidak presisi.", "error"); 
            matikanPaksa(); 
        },
        { enableHighAccuracy: true }
    );

    // Tembak data ke Firebase berbasis interval (Hemat Kuota Ekstrem)
    transmisiTimer = setInterval(() => {
        if (isBlokirGlobal || isBlokirLokal) { matikanPaksa("Akses diblokir admin."); return; }
        
        if (koordinatLokal) {
            update(ref(db, `drivers/${auth.currentUser.uid}/status`), {
                isOnline: true, 
                mode: 'dinamis',
                lat: koordinatLokal.coords.latitude, 
                lng: koordinatLokal.coords.longitude,
                timestamp: Date.now(),
                expiresAt: null // Hapus batas waktu untuk mode dinamis
            });
            koordinatLokal = null; // Kosongkan sampai watchPosition mendapat data baru
        }
    }, intervalGlobal);
}


// ==========================================
// UTILITAS MESIN & UI
// ==========================================
function matikanPaksa(pesanAlert = "") {
    if (pesanAlert) alert(pesanAlert, "warning");
    
    toggleOnline.checked = false;
    modeSelect.disabled = false;
    lepasKunciLayar();
    
    if (gpsWatchId) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
    if (transmisiTimer) { clearInterval(transmisiTimer); transmisiTimer = null; }
    if (mangkalTimeout) { clearTimeout(mangkalTimeout); mangkalTimeout = null; }
    
    if (modeSelect.value === 'jaring') driverMarker.dragging.enable();

    if (auth.currentUser) {
        update(ref(db, `drivers/${auth.currentUser.uid}/status`), { isOnline: false, mode: 'offline' });
    }
    updateUI(false);
}

function updateUI(isOnline, mode = '') {
    const parentContainer = statusText.closest('.hologram-panel');
    
    if (!isOnline) {
        statusText.innerHTML = 'TERPUTUS (OFFLINE)';
        parentContainer.style.borderColor = "var(--border-cyber)";
    } else if (mode === 'jaring') {
        statusText.innerHTML = '<span style="color: #3b82f6; font-weight: bold; text-shadow: 0 0 10px rgba(59,130,246,0.5);"><i class="fa-solid fa-anchor"></i> MANGKAL AKTIF</span>';
        parentContainer.style.borderColor = "#3b82f6";
    } else {
        statusText.innerHTML = '<span style="color: var(--success); font-weight: bold; text-shadow: 0 0 10px rgba(16,185,129,0.5);"><i class="fa-solid fa-satellite"></i> MENGUDARA (DINAMIS)</span>';
        parentContainer.style.borderColor = "var(--success)";
    }
}
