// ==========================================================================
// FILE: js/dashboard.js
// FUNGSI: Navigasi Tab, Custom Modal, Multi-Layanan & Setelan Operasional
// ==========================================================================

import { auth, db } from './firebase-config.js';
import { ref, update } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

let izinInfoAktif = true;
let kategoriArmada = 'Motor'; // Default

// 1. SISTEM CUSTOM MODAL UI (Mencegat alert standar)
window.alert = function(msg, type = 'warning') {
    const modal = document.getElementById('cyber-modal');
    const modalBox = document.getElementById('cyber-modal-box');
    const title = document.getElementById('cyber-modal-title');
    const msgEl = document.getElementById('cyber-modal-msg');
    const icon = document.getElementById('cyber-modal-icon');

    msgEl.innerText = msg;
    modal.classList.remove('hidden-state');
    
    // Set tema berdasarkan tipe error
    if (type === 'error') {
        icon.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
        icon.className = 'text-4xl mb-3 text-[var(--danger)]';
        title.className = 'font-tech font-bold text-lg mb-2 text-[var(--danger)] tracking-widest uppercase';
        title.innerText = 'SISTEM MENOLAK';
    } else if (type === 'success') {
        icon.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
        icon.className = 'text-4xl mb-3 text-[var(--success)]';
        title.className = 'font-tech font-bold text-lg mb-2 text-[var(--success)] tracking-widest uppercase';
        title.innerText = 'BERHASIL';
    } else {
        icon.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i>';
        icon.className = 'text-4xl mb-3 text-[var(--neon-gold)]';
        title.className = 'font-tech font-bold text-lg mb-2 text-white tracking-widest uppercase';
        title.innerText = 'PEMBERITAHUAN';
    }

    setTimeout(() => {
        modal.classList.remove('opacity-0');
        modalBox.classList.remove('scale-95');
    }, 10);
};

document.getElementById('btn-close-modal').addEventListener('click', () => {
    const modal = document.getElementById('cyber-modal');
    const modalBox = document.getElementById('cyber-modal-box');
    modal.classList.add('opacity-0');
    modalBox.classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden-state'), 300);
});

// 2. LOGIKA NAVIGASI TAB BAWAH
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden-state'));
        const targetId = btn.getAttribute('data-target');
        document.getElementById(targetId).classList.remove('hidden-state');
        
        // Render ulang peta jika masuk tab radar untuk mencegah bug grey box
        if(targetId === 'tab-radar' && window.mapSystem) window.mapSystem.invalidateSize();
    });
});

// 3. TERIMA DATA DRIVER & RENDER LAYANAN
window.addEventListener('driverDataLoaded', (e) => {
    const data = e.detail;
    
    if (data.profile) {
        kategoriArmada = data.profile.kategori || 'Motor';
        document.getElementById('lock-nama').value = data.profile.nama || '';
        document.getElementById('lock-kendaraan').value = data.profile.kendaraan || '';
        document.getElementById('lock-plat').value = data.profile.plat || '';
        document.getElementById('lock-wa').value = data.profile.wa || '';
        if(data.profile.fotoUrl) document.getElementById('profile-photo-preview').src = data.profile.fotoUrl;
        
        renderLayananOptions();
    }
    
    if (data.settings) {
        document.getElementById('dash-info').value = data.settings.info || '';
        document.getElementById('dash-tarif').value = data.settings.tarif || '';
        document.getElementById('dash-radius').value = data.settings.radius || '';
        
        // Centang layanan tersimpan
        const layananAktif = data.settings.layanan || [];
        document.querySelectorAll('.chk-layanan').forEach(chk => {
            if (layananAktif.includes(chk.value)) chk.checked = true;
        });
    }
});

function renderLayananOptions() {
    const container = document.getElementById('layanan-options-container');
    container.innerHTML = '';
    
    const opsi = kategoriArmada === 'Mobil' 
        ? [{ val: 'Car', label: 'Car (Mobil)' }]
        : [ { val: 'Ride', label: 'Ride (Motor)' }, { val: 'Jastip', label: 'Jasa Titip' }, { val: 'Express', label: 'Express (Paket)' } ];
        
    opsi.forEach(item => {
        container.innerHTML += `
            <label class="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" value="${item.val}" class="chk-layanan cyber-checkbox" ${kategoriArmada === 'Mobil' ? 'checked disabled' : ''}>
                <span class="text-sm font-tech text-[var(--text-main)]">${item.label}</span>
            </label>
        `;
    });
}

// 4. PANTAU MASTER CONTROL PENGUMUMAN
window.addEventListener('masterControlUpdated', (e) => {
    const master = e.detail;
    const infoContainer = document.getElementById('dash-info').closest('.input-group');
    if (master.izinInfoBoard === false) {
        izinInfoAktif = false;
        infoContainer.classList.add('hidden-state');
    } else {
        izinInfoAktif = true;
        infoContainer.classList.remove('hidden-state');
    }
});

// 5. SIMPAN PEMBARUAN OPERASIONAL (Validasi Ketat)
let isSaving = false;
document.getElementById('btn-save-settings').addEventListener('click', () => {
    if (!auth.currentUser || isSaving) return;
    
    // Ambil checkbox yang dicentang
    const selectedLayanan = Array.from(document.querySelectorAll('.chk-layanan:checked')).map(chk => chk.value);
    const tarif = Number(document.getElementById('dash-tarif').value);
    const radius = Number(document.getElementById('dash-radius').value);

    if (selectedLayanan.length === 0) return alert("Pilih minimal 1 Layanan!", "error");
    if (tarif < 3000) return alert("Tarif minimal adalah Rp 3.000", "error");
    if (radius <= 0 || radius > 100) return alert("Radius operasi harus 1 - 100 Km", "error");

    isSaving = true;
    const btn = document.getElementById('btn-save-settings');
    const textAsli = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> MENYIMPAN...';

    const payload = { layanan: selectedLayanan, tarif: tarif, radius: radius };
    if (izinInfoAktif) payload.info = document.getElementById('dash-info').value.trim();

    update(ref(db, `drivers/${auth.currentUser.uid}/settings`), payload).then(() => {
        btn.innerHTML = '<i class="fa-solid fa-check"></i> TERSIMPAN';
        alert("Pembaruan operasional dikunci.", "success");
        setTimeout(() => { btn.innerHTML = textAsli; isSaving = false; }, 2000);
    }).catch(err => {
        alert("Gagal sinkronisasi ke server.", "error");
        btn.innerHTML = textAsli; isSaving = false;
    });
});

// 6. LOGIKA TEMA (Siang/Malam)
const btnThemeToggle = document.getElementById('btnThemeToggle');
const iconTheme = document.getElementById('iconTheme');
btnThemeToggle.addEventListener('click', () => {
    document.body.classList.toggle('theme-light');
    if (document.body.classList.contains('theme-light')) {
        iconTheme.classList.replace('fa-moon', 'fa-sun');
        iconTheme.style.color = '#d97706'; 
    } else {
        iconTheme.classList.replace('fa-sun', 'fa-moon');
        iconTheme.style.color = ''; 
    }
});
