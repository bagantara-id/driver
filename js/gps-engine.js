// ==========================================================================
// FILE: js/gps-engine.js
// FUNGSI: Integrasi Peta OSM, Radar Dinamis (Wake Lock), AI Throttling & Koneksi Siluman JWT
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

// KECERDASAN BUATAN: Interval Dipercepat 10 Detik
let intervalGlobal = 10000; 
let lastSentCoord = null; 

// 1. INISIALISASI PETA OSM (LEAFLET)
window.mapSystem = L.map('map').setView([-6.200000, 106.816666], 14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
}).addTo(window.mapSystem);

let driverMarker = L.marker([-6.200000, 106.816666]).addTo(window.mapSystem);

navigator.geolocation.getCurrentPosition(
    pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        window.mapSystem.setView([lat, lng], 16);
        driverMarker.setLatLng([lat, lng]);
    },
    err => console.warn("Menunggu izin lokasi dari pengemudi...")
);

// 2. PANTAU INSTRUKSI ADMIN
window.addEventListener('masterControlUpdated', (e) => {
    const master = e.detail;
    isBlokirGlobal = master.blokirSemuaGps === true;
    if (master.intervalGlobalGps) intervalGlobal = master.intervalGlobalGps;
});

window.addEventListener('driverDataLoaded', (e) => {
    const data = e.detail;
    if (data.admin) isBlokirLokal = data.admin.blokirGps === true;
    
    if (data.status && data.status.isOnline) {
        toggleOnline.checked = true;
        modeSelect.value = data.status.mode || 'dinamis';
        
        if (data.status.mode === 'jaring' && data.status.expiresAt < Date.now()) {
            matikanPaksa("Durasi mangkal sebelumnya telah habis.");
        } else {
            updateUI(true, modeSelect.value);
            if (modeSelect.value === 'jaring') eksekusiModeJaring();
            else eksekusiModeDinamis();
        }
    }
});

// 3. LOGIKA WAKE LOCK API (Anti-Layar Mati)
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

// 4. KONTROL UI MODE RADAR
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
    
    if (toggleOnline.checked) {
        alert("Mode diubah. Radar otomatis dimatikan.", "warning");
        matikanPaksa();
    }
});

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
// RUMUS HAVERSINE (OTAK KECERDASAN BUATAN)
// ==========================================
function hitungJarakHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371000; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; 
}

// ==========================================
// MESIN 1: MODE JARING (Titik Manual & KONEKSI SILUMAN)
// ==========================================
async function eksekusiModeJaring() {
    updateUI(true, 'jaring');
    
    const durasiJam = parseInt(durasiSelect.value);
    const expiresAt = Date.now() + (durasiJam * 60 * 60 * 1000); 
    const pos = driverMarker.getLatLng();

    const payload = {
        isOnline: true, 
        mode: 'jaring',
        lat: pos.lat, 
        lng: pos.lng,
        timestamp: Date.now(),
        expiresAt: expiresAt
    };

    try {
        // PERBAIKAN MUTLAK: Ambil Token Otorisasi untuk membuka gerbang Firebase REST API
        const token = await auth.currentUser.getIdToken();
        const dbUrl = `https://bagantara-core-default-rtdb.asia-southeast1.firebasedatabase.app/drivers/${auth.currentUser.uid}/status.json?auth=${token}`;
        
        const response = await fetch(dbUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            alert(`Titik mangkal dikunci untuk ${durasiJam} Jam ke depan.`, "success");
            driverMarker.dragging.disable(); 
        } else {
            throw new Error("Ditolak oleh Satelit Database");
        }
    } catch (error) {
        console.error("Transmisi Mode Jaring Gagal:", error);
        matikanPaksa("Koneksi gagal. Radar dimatikan.");
        return;
    }

    mangkalTimeout = setTimeout(() => {
        matikanPaksa("Durasi mangkal habis. Radar dimatikan otomatis.");
    }, durasiJam * 60 * 60 * 1000);
}

// ==========================================
// MESIN 2: MODE DINAMIS (AI Throttled 10 Detik & KONEKSI SILUMAN)
// ==========================================
function eksekusiModeDinamis() {
    updateUI(true, 'dinamis');
    let koordinatLokal = null;
    lastSentCoord = null; 

    // 1. Pelacak GPS Hardware (Hanya menggerakkan pin di HP, tidak dikirim ke Firebase)
    gpsWatchId = navigator.geolocation.watchPosition(
        (pos) => { 
            koordinatLokal = pos; 
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            driverMarker.setLatLng([lat, lng]);
            window.mapSystem.setView([lat, lng]);
        },
        (err) => { 
            alert("Akses GPS ditolak atau sinyal lemah.", "error"); 
            matikanPaksa(); 
        },
        { enableHighAccuracy: true, timeout: 5000 }
    );

    // 2. Mesin Transmisi REST API Berkala
    transmisiTimer = setInterval(async () => {
        if (isBlokirGlobal || isBlokirLokal) { matikanPaksa("Akses diblokir admin."); return; }
        
        if (koordinatLokal) {
            const currentLat = koordinatLokal.coords.latitude;
            const currentLng = koordinatLokal.coords.longitude;

            // LOGIKA FILTER KECERDASAN BUATAN
            if (lastSentCoord) {
                const jarakPergeseran = hitungJarakHaversine(lastSentCoord.lat, lastSentCoord.lng, currentLat, currentLng);
                
                // Cegah transmisi jika pergeseran kurang dari 10 meter
                if (jarakPergeseran < 10) {
                    console.log(`[AI-BAGANTARA] Dihentikan sementara. Mobil diam (Jarak: ${jarakPergeseran.toFixed(1)}m).`);
                    return; 
                }
            }

            // PERBAIKAN MUTLAK: Ambil Token JWT dan eksekusi Koneksi Siluman (PATCH)
            try {
                const token = await auth.currentUser.getIdToken();
                const dbUrl = `https://bagantara-core-default-rtdb.asia-southeast1.firebasedatabase.app/drivers/${auth.currentUser.uid}/status.json?auth=${token}`;
                
                const payload = {
                    isOnline: true, 
                    mode: 'dinamis',
                    lat: currentLat, 
                    lng: currentLng,
                    timestamp: Date.now(),
                    expiresAt: null 
                };

                const response = await fetch(dbUrl, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if(response.ok) {
                    lastSentCoord = { lat: currentLat, lng: currentLng };
                    console.log("[AI-BAGANTARA] Berhasil memperbarui satelit.");
                } else {
                    console.warn("Transmisi satelit ditolak.");
                }
            } catch (error) {
                console.warn("Transmisi tertunda (Offline/Gangguan Sinyal)");
            }
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

    // Pemutusan Koneksi terakhir dilakukan secara senyap
    if (auth.currentUser) {
        auth.currentUser.getIdToken().then(token => {
            const dbUrl = `https://bagantara-core-default-rtdb.asia-southeast1.firebasedatabase.app/drivers/${auth.currentUser.uid}/status.json?auth=${token}`;
            fetch(dbUrl, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isOnline: false, mode: 'offline' })
            }).catch(() => {});
        }).catch(() => {});
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
