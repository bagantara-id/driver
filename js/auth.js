// ==========================================================================
// FILE: js/auth.js
// FUNGSI: Otorisasi Google, Single-Device Login, & Pembatasan Akses Admin
// ==========================================================================

import { auth, db, provider } from './firebase-config.js';
import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { ref, get, onValue, set, update, onDisconnect, goOnline } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

export function switchState(stateName) {
    document.getElementById('state-login').classList.add('hidden-state');
    document.getElementById('state-registration').classList.add('hidden-state');
    document.getElementById('state-dashboard').classList.add('hidden-state');
    document.getElementById(`state-${stateName}`).classList.remove('hidden-state');
}

let currentUser = null;
let masterControlCache = {};
let currentSessionId = null;

// 1. KONTROL LOGIN & LOGOUT
provider.setCustomParameters({ prompt: 'select_account' });
const aksiLogin = () => {
    goOnline(db);
    signInWithPopup(auth, provider).catch(error => alert("Otorisasi Gagal: " + error.message, "error"));
};
document.getElementById('btnGoogleLogin').addEventListener('click', aksiLogin);
document.getElementById('btn-auth').addEventListener('click', aksiLogin);

document.querySelectorAll('.btn-logout').forEach(btn => {
    btn.addEventListener('click', () => {
        goOnline(db);
        if (currentUser) {
            update(ref(db, `drivers/${currentUser.uid}/status`), { 
                isOnline: false, 
                session_id: null 
            }).then(() => {
                localStorage.removeItem('bagantara_session');
                signOut(auth);
            });
        } else {
            signOut(auth);
        }
    });
});

// 2. PEMANTAUAN OTORISASI UTAMA & GERBANG WHITELIST
onAuthStateChanged(auth, (user) => {
    if (user && user.email) {
        const safeEmail = user.email.toLowerCase().trim().replace(/\./g, ',');
        
        get(ref(db, `whitelist_emails/${safeEmail}`)).then((snap) => {
            if (snap.exists() && snap.val() === true) {
                currentUser = user;
                document.getElementById('reg-email').value = user.email;
                inisialisasiSesiDriver(user.uid);
            } else {
                signOut(auth).then(() => {
                    alert("OTORISASI DITOLAK: Email tidak terdaftar dalam jangkauan radar.", "error");
                    switchState('login');
                });
            }
        }).catch(err => {
            console.error("Akses Ditolak Database:", err.message);
            signOut(auth).then(() => {
                alert("GANGGUAN SISTEM: Gagal memverifikasi rantai otoritas.", "error");
                switchState('login');
            });
        });
    } else {
        currentUser = null;
        switchState('login');
    }
});

// 3. LOGIKA SINGLE-DEVICE LOGIN & AUDIT SESI
function inisialisasiSesiDriver(uid) {
    // Generate Sesi Unik Perangkat Ini
    currentSessionId = "SESSION_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
    localStorage.setItem('bagantara_session', currentSessionId);

    // Daftarkan sesi ke Firebase status
    update(ref(db, `drivers/${uid}/status`), { session_id: currentSessionId });

    // Dengarkan node session_id secara real-time (Hanya butuh beberapa byte)
    onValue(ref(db, `drivers/${uid}/status/session_id`), (snap) => {
        const remoteSession = snap.val();
        const localSession = localStorage.getItem('bagantara_session');
        
        // Jika session_id di server berubah dan bukan milik HP ini -> Tendang keluar
        if (remoteSession && localSession && remoteSession !== localSession) {
            alert("AKUN DIGUNAKAN DI PERANGKAT LAIN. Portal dikunci.", "error");
            setTimeout(() => {
                signOut(auth);
                location.reload();
            }, 1500);
        }
    });

    pantauInstruksiAdmin(uid);
}

// 4. LOGIKA HEMAT KUOTA (DATA STATIS + REALTIME SELEKTIF)
function pantauInstruksiAdmin(uid) {
    // A. Tarik Data Master Control (Global)
    onValue(ref(db, 'master_control'), (snap) => {
        masterControlCache = snap.val() || {};
        window.dispatchEvent(new CustomEvent('masterControlUpdated', { detail: masterControlCache }));
    });

    // B. Tarik Profil & Setting HANYA 1 KALI (.get)
    get(ref(db, `drivers/${uid}`)).then((snapshot) => {
        const data = snapshot.val();
        
        if (!data || !data.profile) {
            bukaFormRegistrasi();
            return;
        }

        // C. Buka Jalur Realtime HANYA untuk Admin Status
        const adminStatusRef = ref(db, `drivers/${uid}/admin_status`);
        
        // Aturan OnDisconnect: Jika tab mati tak sengaja, matikan status
        onDisconnect(ref(db, `drivers/${uid}/status/isOnline`)).set(false);

        onValue(adminStatusRef, (adminSnap) => {
            const adminStatus = adminSnap.val() || {};
            
            if (adminStatus.isApproved !== true) {
                kunciFormRegistrasi(data, adminStatus);
                return;
            }

            // Jika Approved -> Masuk Dashboard
            switchState('dashboard');
            window.dispatchEvent(new CustomEvent('driverDataLoaded', { 
                detail: { profile: data.profile, settings: data.settings, status: data.status, admin: adminStatus } 
            }));
        });
    }).catch(err => alert("Gagal memuat server: " + err.message, "error"));
}

// 5. REGISTRASI & KUNCI IDENTITAS
function bukaFormRegistrasi() {
    switchState('registration');
    const alertBox = document.getElementById('reg-status-alert');
    alertBox.className = "mb-4 p-3 rounded-lg text-[0.75rem] font-tech tracking-wide border text-center border-slate-600 text-slate-300 bg-[var(--bg-card)]";
    alertBox.innerHTML = "Isi kredensial identitas. Form akan <b class='text-[var(--neon-gold)]'>dikunci permanen</b>.";
    
    ['reg-kategori', 'reg-nama', 'reg-plat', 'reg-wa', 'reg-kendaraan'].forEach(id => document.getElementById(id).disabled = false);
    document.getElementById('btn-submit-reg').classList.remove('hidden-state');
}

function kunciFormRegistrasi(data, adminStatus) {
    switchState('registration');
    const alertBox = document.getElementById('reg-status-alert');
    
    if (adminStatus && adminStatus.isBanned === true) {
        alertBox.className = "mb-4 p-3 rounded-lg text-[0.75rem] font-tech font-bold tracking-wide border text-center border-[var(--danger)] text-[var(--danger)] bg-[rgba(239,68,68,0.15)]";
        alertBox.innerText = "AKUN DIBEKUKAN MUTLAK. Hubungi Administrator.";
    } else {
        alertBox.className = "mb-4 p-3 rounded-lg text-[0.75rem] font-tech font-bold tracking-wide border text-center border-[var(--neon-gold)] text-[var(--neon-gold)] bg-[rgba(197,168,128,0.15)]";
        alertBox.innerText = "MENUNGGU PERSETUJUAN ADMIN. Identitas ditinjau.";
    }

    if (data && data.profile) {
        document.getElementById('reg-kategori').value = data.profile.kategori || 'Motor';
        document.getElementById('reg-nama').value = data.profile.nama || '';
        document.getElementById('reg-plat').value = data.profile.plat || '';
        document.getElementById('reg-wa').value = data.profile.wa || '';
        document.getElementById('reg-kendaraan').value = data.profile.kendaraan || '';
    }

    ['reg-kategori', 'reg-nama', 'reg-plat', 'reg-wa', 'reg-kendaraan'].forEach(id => document.getElementById(id).disabled = true);
    document.getElementById('btn-submit-reg').classList.add('hidden-state');
}

// 6. PENGIRIMAN DATA FORM AWAL
document.getElementById('btn-submit-reg').addEventListener('click', () => {
    const pKategori = document.getElementById('reg-kategori').value;
    const pNama = document.getElementById('reg-nama').value.trim();
    const pPlat = document.getElementById('reg-plat').value.trim();
    const pWa = document.getElementById('reg-wa').value.trim();
    const pKendaraan = document.getElementById('reg-kendaraan').value.trim();

    if (!pNama || !pPlat || !pWa || !pKendaraan) { 
        alert("Seluruh kolom identitas wajib diisi!", "error"); 
        return; 
    }

    const defaultLayanan = pKategori === 'Mobil' ? ['Car'] : ['Ride', 'Jastip', 'Express'];
    const profilePayload = { 
        kategori: pKategori, 
        nama: pNama, 
        email: currentUser.email, 
        plat: pPlat, 
        wa: pWa, 
        kendaraan: pKendaraan,
        fotoUrl: ""
    };
    const settingPayload = { layanan: defaultLayanan, info: '', tarif: 10000, radius: 10 };

    const btnSubmit = document.getElementById('btn-submit-reg');
    btnSubmit.disabled = true; // Kunci tombol agar tidak bisa diklik ganda
    btnSubmit.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> MENGIRIM...';
    
    set(ref(db, `drivers/${currentUser.uid}/profile`), profilePayload)
        .then(() => set(ref(db, `drivers/${currentUser.uid}/settings`), settingPayload))
        .then(() => {
            btnSubmit.innerHTML = '<i class="fa-solid fa-check"></i> BERHASIL';
            alert("Identitas Terkunci. Menunggu Persetujuan Admin.", "success");
            setTimeout(() => location.reload(), 2000); 
        })
        .catch(err => {
            btnSubmit.disabled = false; // Buka kunci tombol jika gagal
            alert("Gagal kirim: " + err.message, "error");
            btnSubmit.innerHTML = '<i class="fa-solid fa-lock"></i> KIRIM & KUNCI DATA';
        });
});
