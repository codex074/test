import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, onSnapshot, addDoc, doc, deleteDoc, updateDoc, query, where, serverTimestamp, orderBy, getDocs, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyAGxbhp7jrMCVwXoqycYT5IT2wBxp25XBM",
    authDomain: "leaveopd.firebaseapp.com",
    projectId: "leaveopd",
    storageBucket: "leaveopd.appspot.com",
    messagingSenderId: "198276583055",
    appId: "1:198276583055:web:0bd83371a70f0fb891aafa"
};


// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
window.db = db;
window.firebase = {
    collection, onSnapshot, addDoc, doc, deleteDoc, updateDoc, query, where, serverTimestamp, orderBy, getDocs, setDoc
};

// --- Global variables ---
let currentDate = new Date();

let __initialLoaderTimer = null;

// === Approval helpers (added) ===
function isApproved(rec) {
    if (!rec || typeof rec !== 'object') return false;

    // กรณีลาเต็มวัน (มี leaveType)
    if ('leaveType' in rec) {
        const raw = (rec.status || '').toString().trim();
        const s = raw.replace(/\s/g, '').toLowerCase();

        // ถ้ายังไม่ระบุหรือเป็นสถานะรอ → ถือว่ายังไม่อนุมัติ
        if (!s) return false;
        if (/(รอ|ยังไม่|ไม่อนุมัติ|ปฏิเสธ|reject|pending)/.test(s)) return false;

        // อนุมัติจริง ๆ
        if (/(อนุมัติแล้ว|อนุมัติ|approved|approve)/.test(s)) return true;

        return false; // fallback
    }

    // กรณีลาชั่วโมง (มี confirmed)
    if ('confirmed' in rec) {
        return !!rec.confirmed;
    }

    return false;
}
function getStatusClass(rec) { return isApproved(rec) ? 'approved' : 'pending'; }

let users = [];

// --- Helper: resolve display nickname to userNickname (stored in users array) ---
function resolveUserNicknameFromDisplay(displayName) {
    if (!displayName) return null;
    const d = displayName.toString().trim();
    const u = users.find(u => u.nickname === d || u.fullname === d);
    return u ? u.nickname : null;
}

// --- Function: showPersonHourlyHistory(userNickname) ---
window.showPersonHourlyHistory = function(userNickname) {
    if (!userNickname) return showErrorPopup('ไม่พบข้อมูลผู้ใช้ที่ต้องการ');
    const records = (allHourlyRecords || []).filter(r => r.userNickname === userNickname);
    if (!records || records.length === 0) {
        // try alternative match by nickname field if any record stored nickname differently
        const alt = (allHourlyRecords || []).filter(r => (r.nickname || r.userNickname || '').toString() === userNickname);
        if (!alt || alt.length === 0) {
            const userObj = users.find(u => u.nickname === userNickname);
            const display = userObj ? userObj.nickname : userNickname;
            return Swal.fire('ไม่มีประวัติ', `ไม่พบข้อมูลของ ${display}`, 'info');
        }
    }
    const sorted = records.slice().sort((a,b) => new Date(b.date || b.startDate) - new Date(a.date || a.startDate));
    let html = '<div style="max-height:420px; overflow-y:auto; text-align:left;">';
    sorted.forEach(r => {
        html += `<div style="padding:10px;border-bottom:1px solid #eee;">
            <div><strong>วันที่:</strong> ${formatDateThaiShort(r.date || r.startDate)}</div>
            <div><strong>ประเภท:</strong> ${r.type === 'leave' ? 'ลาชั่วโมง' : (r.type === 'use' ? 'ใช้ชั่วโมง' : (r.hourlyType || r.type || '-'))}</div>
            <div><strong>เวลา:</strong> ${r.startTime || r.start || '-'} - ${r.endTime || r.end || '-'}</div>
            <div><strong>ผู้อนุมัติ:</strong> ${r.approver || r.approverName || '-'}</div>
            <div><strong>หมายเหตุ:</strong> ${r.note || r.notes || '-'}</div>
            <div><strong>สถานะ:</strong> ${ (r.confirmed || (r.status && /อนุมัติ/i.test(r.status))) ? '✔ อนุมัติแล้ว' : '⏳ รออนุมัติ' }</div>
        </div>`;
    });
    html += '</div>';
    const userObj = users.find(u => u.nickname === userNickname);
    const title = userObj ? `${userObj.fullname} (${userObj.nickname})` : userNickname;
    Swal.fire({ title: `ประวัติของ ${title}`, html: html, width: 700, confirmButtonText: 'ปิด' });
};

// Attach delegated click listener for hourly-summary-table to map display name -> userNickname
document.addEventListener('DOMContentLoaded', function(){
    const sumTable = document.getElementById('hourly-summary-table');
    if (sumTable) {
        sumTable.addEventListener('click', function(e){
            const el = e.target.closest('.clickable-name');
            if (!el) return;
            const user = el.dataset.user; if(user){ showPersonHourlyHistory(user); return;} const display = el.dataset.display || el.textContent;
            const userNick = resolveUserNicknameFromDisplay(display);
            if (userNick) {
                showPersonHourlyHistory(userNick);
            } else {
                // try lookup by fullname
                const byFull = users.find(u => u.fullname === display);
                if (byFull) return showPersonHourlyHistory(byFull.nickname);
                Swal.fire('ไม่มีประวัติ', `ไม่พบข้อมูลของ ${display}`, 'info');
            }
        });
    }
});

let admins = [];
let filteredUsers = [];
let allHourlyRecords = [];
let filteredHourlyRecords = [];
let allLeaveRecords = [];
let filteredLeaveRecords = [];
let hourlyRecordsUnsubscribe, leaveRecordsUnsubscribe, usersUnsubscribe, pinUnsubscribe, adminsUnsubscribe;
let tomSelectHourly, tomSelectLeave, tomSelectPinUser, tomSelectHourlyApprover, tomSelectAdminPinUser;
let hourlyRecordsCurrentPage = 1;
let hourlySummaryCurrentPage = 1;
let leaveRecordsCurrentPage = 1;
let leaveSummaryCurrentPage = 1;
let usersCurrentPage = 1;
let currentFullDayLeaveType = null;
const recordsPerPage = 10;
const summaryRecordsPerPage = 10;
let systemPIN = null; // This now only serves as the PIN for deleting records
let holidays = [];
let currentCalendarView = 'month'; // 'day', 'week', 'month', 'year'
let showFullDayLeaveOnCalendar = true;
let showHourlyLeaveOnCalendar = true;
let calendarPositionFilter = ''; // '' means all positions
let pendingFilterType = 'all';
let pendingApproverFilter = 'all';

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {

    // Fallback: auto-hide initial loader in case listeners fail or permissions block
    if (!__initialLoaderTimer) {
        __initialLoaderTimer = setTimeout(() => hideInitialLoader(), 8000);
    }    showTab('hourly');
    populateFiscalYearFilters();
    initializeDataListeners();
    initializePinListener();
    setDefaultDate();
    setupFormConstraints();
    setupEventListeners();
    updateDateTime();
    setInterval(updateDateTime, 1000);
});

function setupEventListeners() {
    const registerForm = document.getElementById('register-form');
    if (registerForm) registerForm.addEventListener('submit', handleRegisterSubmit);
    
    const hourlyForm = document.getElementById('hourly-form');
    if (hourlyForm) hourlyForm.addEventListener('submit', handleHourlySubmit);

    const leaveForm = document.getElementById('leave-form');
    if (leaveForm) leaveForm.addEventListener('submit', handleLeaveSubmit);

    const changePersonalPinForm = document.getElementById('change-personal-pin-form');
    if (changePersonalPinForm) changePersonalPinForm.addEventListener('submit', handleChangePersonalPin);

    ['leave-filter-fiscal-year', 'summary-search-name', 'summary-filter-position', 'records-search-name', 'records-filter-position', 'records-filter-start', 'records-filter-end'].forEach(id => {
        const element = document.getElementById(id);
        if(element) element.addEventListener('input', () => {
            leaveRecordsCurrentPage = 1; 
            leaveSummaryCurrentPage = 1;
            applyLeaveFiltersAndRender();
        });
    });
    ['hourly-filter-fiscal-year', 'hourly-search-name', 'hourly-filter-position', 'hourly-filter-start', 'hourly-filter-end', 'hourly-summary-filter-position'].forEach(id => {
        const element = document.getElementById(id);
        if(element) element.addEventListener('input', () => {
            hourlyRecordsCurrentPage = 1;
            hourlySummaryCurrentPage = 1;
            applyHourlyFiltersAndRender();
        });
    });
     ['user-search-name', 'user-filter-position'].forEach(id => {
        const element = document.getElementById(id);
        if(element) element.addEventListener('input', () => {
            usersCurrentPage = 1;
            applyUserFiltersAndRender();
        });
    });
    
    const radioOptions = document.querySelectorAll('.radio-option-animated');
    radioOptions.forEach(option => {
        option.addEventListener('click', function() {
            radioOptions.forEach(opt => opt.classList.remove('selected'));
            this.classList.add('selected');

            const radioInput = this.querySelector('input[type="radio"]');
            if (radioInput) radioInput.checked = true;
        });
    });

    const leaveButtons = document.querySelectorAll('#leave-type-buttons-new .leave-type-btn');
    leaveButtons.forEach(button => {
        button.addEventListener('click', function() {
            leaveButtons.forEach(btn => {
                btn.classList.remove('active', 'bg-purple-500', 'bg-green-500', 'bg-red-500', 'bg-pink-500', 'text-white', 'border-purple-500', 'border-green-500', 'border-red-500', 'border-pink-500');
                btn.classList.add('text-gray-700', 'border-gray-300');
            });

            this.classList.add('active');
            this.classList.remove('text-gray-700', 'border-gray-300');
            
            const color = this.dataset.color;
            const type = this.dataset.type;
            
            const colorClasses = {
                purple: ['bg-purple-500', 'text-white', 'border-purple-500'],
                green: ['bg-green-500', 'text-white', 'border-green-500'],
                red: ['bg-red-500', 'text-white', 'border-red-500'],
                pink: ['bg-pink-500', 'text-white', 'border-pink-500'],
            };
            if(colorClasses[color]) {
                this.classList.add(...colorClasses[color]);
            }

            currentFullDayLeaveType = type;
        });
    });

    const dropdownBtn = document.getElementById('view-dropdown-btn');
    const dropdownMenu = document.getElementById('view-dropdown-menu');
    if(dropdownBtn) {
        document.body.addEventListener('click', function(e) {
            if (e.target.closest('#view-dropdown-btn')) {
                dropdownMenu.classList.toggle('hidden');
            } else {
                dropdownMenu.classList.add('hidden');
            }
        });
    }

  // mark fiscal-year selects as user-selected when changed (to avoid overwriting on data updates)
  ;['leave-filter-fiscal-year','hourly-filter-fiscal-year'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.dataset._fyListenerBound) {
      el.addEventListener('change', () => { el.dataset.userSelected = '1'; });
      el.dataset._fyListenerBound = '1';
    }
  });

  // Event listener for the new backup button in the sidebar
  const exportBtn = document.getElementById('export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportAllDataToExcel);
  }

  // Listeners for Admin Dashboard new functions
  document.querySelectorAll('.filter-btn-group .filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
          document.querySelectorAll('.filter-btn-group .filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          pendingFilterType = btn.dataset.filterType;
          renderAdminDashboard();
      });
  });

  const approverFilterEl = document.getElementById('pending-approver-filter');
  if (approverFilterEl) {
      approverFilterEl.addEventListener('change', (e) => {
          pendingApproverFilter = e.target.value;
          renderAdminDashboard();
      });
  }
  
  const selectAllCheckbox = document.getElementById('select-all-pending');
  if (selectAllCheckbox) {
      selectAllCheckbox.addEventListener('click', (e) => {
          document.querySelectorAll('#pending-requests-list input[type="checkbox"]').forEach(checkbox => {
              checkbox.checked = e.target.checked;
          });
          updateBatchApproveButtonState();
      });
  }
  
  const batchApproveBtn = document.getElementById('batch-approve-btn');
  if (batchApproveBtn) {
      batchApproveBtn.addEventListener('click', handleBatchApprove);
  }
}

function initializePinListener() {
    const pinDocRef = doc(db, "pin", "config");
    if (pinUnsubscribe) pinUnsubscribe();
    pinUnsubscribe = onSnapshot(pinDocRef, (docSnap) => {
        if (docSnap.exists()) {
            systemPIN = docSnap.data().value;
        } else {
            systemPIN = null;
        }
    }, (error) => {
        console.error("Error fetching system PIN:", error);
        showErrorPopup("ไม่สามารถโหลดข้อมูล PIN (สำหรับลบ) ได้");
    });
}

async function initializeDataListeners() {
    if (adminsUnsubscribe) adminsUnsubscribe();
    adminsUnsubscribe = onSnapshot(collection(db, "admins"), (snapshot) => {
        admins = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a,b) => a.username.localeCompare(b.username, 'th'));
        populateApproverDropdowns();
    }, (error) => { console.error('Error fetching users: ', error); showErrorPopup('ไม่สามารถเชื่อมต่อฐานข้อมูลผู้ใช้ได้'); hideInitialLoader(); });

    if (usersUnsubscribe) usersUnsubscribe();
    usersUnsubscribe = onSnapshot(collection(db, "users"), (snapshot) => {
        users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a,b) => a.nickname.localeCompare(b.nickname, 'th'));
        populateUserDropdowns();
        applyUserFiltersAndRender();
        
        loadHourlyData();
        
        loadLeaveData(); 

        const dbStatus = document.getElementById('db-status');
        dbStatus.textContent = '✅ Connected';
        dbStatus.className = 'bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium';
        
        hideInitialLoader();
    }, (error) => {
        console.error("Error fetching users: ", error);
        showErrorPopup('ไม่สามารถเชื่อมต่อฐานข้อมูลผู้ใช้ได้');
    });

    await loadHolidays();
    
    const calendarContent = document.getElementById('calendar-content');
    if (calendarContent && !calendarContent.classList.contains('hidden')) {
        renderCalendar();
    }
}

function loadHourlyData() {
     if (hourlyRecordsUnsubscribe) hourlyRecordsUnsubscribe();
     const hourlyQuery = query(collection(db, "hourlyRecords"));
     hourlyRecordsUnsubscribe = onSnapshot(hourlyQuery, (snapshot) => {
        allHourlyRecords = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateFiscalYearFiltersFromData();
        applyHourlyFiltersAndRender();
     }, (error) => { 
        console.error('Error in hourlyRecords listener: ', error); 
        hideInitialLoader(); 
     });
}

function loadLeaveData() {
    if (leaveRecordsUnsubscribe) leaveRecordsUnsubscribe();
    const leaveQuery = query(collection(db, "leaveRecords"));
    leaveRecordsUnsubscribe = onSnapshot(leaveQuery, (snapshot) => {
        allLeaveRecords = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateFiscalYearFiltersFromData();
        applyLeaveFiltersAndRender();
        const calendarContent = document.getElementById('calendar-content');
        if (calendarContent && !calendarContent.classList.contains('hidden')) {
            renderCalendar();
        }
    }, (error) => { 
        console.error('Error in leaveRecords listener: ', error); 
        hideInitialLoader();
    });
}


// === Fiscal Year Helpers (INSERTED) ===
function computeFiscalYearFromDateString(isoDateStr) {
  if (!isoDateStr) return null;
  const d = new Date(isoDateStr + 'T00:00:00');
  const year = d.getFullYear();
  const month = d.getMonth(); // 0=Jan ... 11=Dec
  return (month >= 9 ? year + 544 : year + 543); // ต.ค.เริ่มปีงบฯ และใช้ พ.ศ.
}

function setFiscalYearOptions(selectEl, years, currentFiscalYear) {
  if (!selectEl) return;
  const hadUserValue = !!selectEl.dataset.userSelected;
  selectEl.innerHTML = '';
  years.forEach(y => {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    selectEl.add(opt);
  });
  if (!hadUserValue || !years.includes(parseInt(selectEl.value))) {
    selectEl.value = currentFiscalYear;
  }
}

function updateFiscalYearFiltersFromData() {
  const leaveFYEl  = document.getElementById('leave-filter-fiscal-year');
  const hourlyFYEl = document.getElementById('hourly-filter-fiscal-year');
  if (!leaveFYEl && !hourlyFYEl) return;
  const currentFiscalYear = getCurrentFiscalYear();

  const fromHourly = (Array.isArray(allHourlyRecords) ? allHourlyRecords : [])
    .map(r => parseInt(r.fiscalYear))
    .filter(Number.isFinite);

  const fromLeave = (Array.isArray(allLeaveRecords) ? allLeaveRecords : [])
    .map(r => {
      const fy = parseInt(r.fiscalYear);
      if (Number.isFinite(fy)) return fy;
      if (r.startDate) return computeFiscalYearFromDateString(r.startDate);
      if (r.endDate) return computeFiscalYearFromDateString(r.endDate);
      return null;
    })
    .filter(Number.isFinite);

  const setYears = new Set([...fromHourly, ...fromLeave, currentFiscalYear]);
  const years = Array.from(setYears).sort((a,b) => b - a);

  setFiscalYearOptions(leaveFYEl, years, currentFiscalYear);
  setFiscalYearOptions(hourlyFYEl, years, currentFiscalYear);
}
// === End Fiscal Year Helpers ===
function populateFiscalYearFilters() {
  const selects = [
    document.getElementById('leave-filter-fiscal-year'),
    document.getElementById('hourly-filter-fiscal-year')
  ];
  const currentFiscalYear = getCurrentFiscalYear();
  selects.forEach(select => {
    if (!select) return;
    select.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = currentFiscalYear;
    opt.textContent = currentFiscalYear;
    select.add(opt);
    select.value = currentFiscalYear;
  });
}

function hideInitialLoader() {
    try {
        if (__initialLoaderTimer) { clearTimeout(__initialLoaderTimer); __initialLoaderTimer = null; }
        const loader = document.getElementById('initial-loader');
        if (loader) loader.style.display = 'none';
    } catch(e) { /* no-op */ }
}

function populateUserDropdowns() {
    const userOptions = users.map(user => ({ value: user.nickname, text: `${user.nickname} (${user.fullname})`}));
    
    if (tomSelectHourly) tomSelectHourly.destroy();
    if (tomSelectLeave) tomSelectLeave.destroy();
    if (tomSelectPinUser) tomSelectPinUser.destroy();

    const hourlyUserEl = document.getElementById('hourly-user');
    if (hourlyUserEl) {
        tomSelectHourly = new TomSelect(hourlyUserEl, { options: userOptions, create: false });
    }
    
    const leaveUserEl = document.getElementById('leave-user');
    if (leaveUserEl) {
        tomSelectLeave = new TomSelect(leaveUserEl, { options: userOptions, create: false });
    }

    const pinUserEl = document.getElementById('change-pin-user');
    if (pinUserEl) {
        tomSelectPinUser = new TomSelect(pinUserEl, { options: userOptions, create: false });
    }
}

function populateApproverDropdowns() {
    const approverOptions = [{ value: '', text: 'เลือกผู้อนุมัติ' }, ...admins.map(admin => ({ value: admin.username, text: admin.username }))];

    const leaveApproverEl = document.getElementById('leave-approver');
    if (leaveApproverEl) {
        leaveApproverEl.innerHTML = approverOptions.map(opt => `<option value="${opt.value}">${opt.text}</option>`).join('');
    }

    const hourlyApproverEl = document.getElementById('hourly-approver');
    if (hourlyApproverEl) {
        if (tomSelectHourlyApprover) tomSelectHourlyApprover.destroy();
        tomSelectHourlyApprover = new TomSelect(hourlyApproverEl, { 
            options: admins.map(admin => ({ value: admin.username, text: admin.username })), 
            create: false,
            placeholder: 'เลือกผู้อนุมัติ...'
        });
    }
}


// --- UI & TAB MANAGEMENT ---
window.showTab = function(tabName) {
    document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
    document.querySelectorAll('.menu-item').forEach(tab => tab.classList.remove('active-tab'));
    
    const contentEl = document.getElementById(tabName + '-content');
    const tabEl = document.getElementById(tabName + '-tab');

    if(contentEl) contentEl.classList.remove('hidden');
    if(tabEl) tabEl.classList.add('active-tab');
    
    const body = document.body;
    body.className = `min-h-screen bg-theme-${tabName}`;

    if (tabName === 'calendar') renderCalendar();
    if (tabName === 'pin') {
        renderPinManagementPage(); // This will now render the new admin pin form
        const pinUserEl = document.getElementById('change-pin-user');
        if (pinUserEl && (!tomSelectPinUser || tomSelectPinUser.destroyed)) {
             const userOptions = users.map(user => ({ value: user.nickname, text: `${user.nickname} (${user.fullname})`}));
             tomSelectPinUser = new TomSelect(pinUserEl, { options: userOptions, create: false });
        }
    }
    if (tabName === 'admin-dashboard') {
        renderAdminDashboard();
    }
    closeSidebar();
}

window.toggleSidebar = function() {
    document.getElementById('sidebar').classList.toggle('-translate-x-full');
    document.getElementById('sidebar-overlay').classList.toggle('hidden');
}
window.closeSidebar = function() {
    document.getElementById('sidebar').classList.add('-translate-x-full');
    document.getElementById('sidebar-overlay').classList.add('hidden');
}

function setDefaultDate() {
    const today = toLocalISOStringInThailand(new Date());
    const hourlyDateEl = document.getElementById('hourly-date');
    const leaveStartEl = document.getElementById('leave-start-date');
    const leaveEndEl = document.getElementById('leave-end-date');
    if(hourlyDateEl) hourlyDateEl.value = today;
    if(leaveStartEl) leaveStartEl.value = today;
    if(leaveEndEl) leaveEndEl.value = today;
}

function setupFormConstraints(){
    // ----- Full-day leave: end date >= start date -----
    const startDateEl = document.getElementById('leave-start-date');
    const endDateEl   = document.getElementById('leave-end-date');
    if (startDateEl && endDateEl){
        const applyMin = () => {
            if (startDateEl.value){
                endDateEl.min = startDateEl.value;
                if (endDateEl.value && endDateEl.value < startDateEl.value){
                    endDateEl.value = startDateEl.value;
                }
            }
        };
        startDateEl.addEventListener('change', applyMin);
        // run once on load
        applyMin();
    }

    // ----- Hourly: end time > start time -----
    const startTimeEl = document.getElementById('hourly-start');
    const endTimeEl   = document.getElementById('hourly-end');
    if (startTimeEl && endTimeEl){
        const applyMinTime = () => {
            if (startTimeEl.value){
                endTimeEl.min = startTimeEl.value;
                // strictly later: if equal or earlier, clear end time
                if (endTimeEl.value && endTimeEl.value <= startTimeEl.value){
                    endTimeEl.value = '';
                }
            }
        };
        startTimeEl.addEventListener('change', applyMinTime);
        endTimeEl.addEventListener('change', () => {
            if (startTimeEl.value && endTimeEl.value <= startTimeEl.value){
                // force end > start
                endTimeEl.setCustomValidity('กรุณาเลือกเวลาสิ้นสุดหลังเวลาเริ่มต้น');
            }else{
                endTimeEl.setCustomValidity('');
            }
        });
        // run once
        applyMinTime();
    }
}


// --- PIN Management ---
function renderPinManagementPage() {
    const container = document.getElementById('system-pin-management-container');
    if (!container) return;

    // New HTML structure for changing admin PIN
    container.innerHTML = `
        <div class="bg-white rounded-xl shadow-lg p-6">
            <h2 class="text-xl font-bold text-gray-800 mb-4 text-center">เปลี่ยน PIN ผู้อนุมัติ (Admin)</h2>
            <form id="change-admin-pin-form">
                <div class="mb-4">
                    <label for="change-admin-pin-user" class="block text-sm font-medium text-gray-700 mb-2">เลือกผู้ใช้ (Admin)</label>
                    <select id="change-admin-pin-user" placeholder="ค้นหาหรือเลือกผู้ใช้..." required></select>
                </div>
                <div class="mb-4">
                    <label for="old-admin-pin" class="block text-sm font-medium text-gray-700 mb-2">PIN เดิม</label>
                    <input type="password" id="old-admin-pin" class="w-full" required maxlength="4" pattern="\\d{4}">
                </div>
                <div class="mb-4">
                    <label for="new-admin-pin" class="block text-sm font-medium text-gray-700 mb-2">PIN ใหม่ (4 หลัก)</label>
                    <input type="password" id="new-admin-pin" class="w-full" required maxlength="4" pattern="\\d{4}">
                </div>
                <div class="mb-6">
                    <label for="confirm-new-admin-pin" class="block text-sm font-medium text-gray-700 mb-2">ยืนยัน PIN ใหม่</label>
                    <input type="password" id="confirm-new-admin-pin" class="w-full" required maxlength="4" pattern="\\d{4}">
                </div>
                <button type="submit" class="w-full bg-green-600">เปลี่ยนรหัส PIN (Admin)</button>
            </form>
        </div>
    `;

    // Initialize TomSelect for the new dropdown
    const adminUserEl = document.getElementById('change-admin-pin-user');
    if (tomSelectAdminPinUser) tomSelectAdminPinUser.destroy();
    const adminOptions = admins.map(admin => ({ value: admin.username, text: admin.username }));
    tomSelectAdminPinUser = new TomSelect(adminUserEl, { options: adminOptions, create: false });

    // Add event listener to the new form
    document.getElementById('change-admin-pin-form').addEventListener('submit', handleChangeAdminPin);
}

async function handleChangeAdminPin(e) {
    e.preventDefault();
    const username = tomSelectAdminPinUser.getValue();
    const oldPin = document.getElementById('old-admin-pin').value;
    const newPin = document.getElementById('new-admin-pin').value;
    const confirmNewPin = document.getElementById('confirm-new-admin-pin').value;

    if (!username) return showErrorPopup('กรุณาเลือกผู้ใช้ (Admin)');

    const admin = admins.find(a => a.username === username);
    if (!admin) return showErrorPopup('ไม่พบข้อมูล Admin');

    if (oldPin !== admin.pin) return showErrorPopup('PIN เดิมไม่ถูกต้อง');

    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
        return showErrorPopup('PIN ใหม่ต้องเป็นตัวเลข 4 หลักเท่านั้น');
    }
    if (newPin !== confirmNewPin) return showErrorPopup('PIN ใหม่ทั้งสองช่องไม่ตรงกัน');
    if (oldPin === newPin) return showErrorPopup('PIN ใหม่ต้องไม่ซ้ำกับ PIN เดิม');

    showLoadingPopup('กำลังเปลี่ยนรหัส PIN (Admin)...');
    try {
        const adminDocRef = doc(db, "admins", admin.id);
        await updateDoc(adminDocRef, { pin: newPin });
        showSuccessPopup('เปลี่ยนรหัส PIN (Admin) สำเร็จ');
        
        admin.pin = newPin; 

        e.target.reset();
        tomSelectAdminPinUser.clear();
    } catch (error) {
        console.error("Error changing admin PIN:", error);
        showErrorPopup('เปลี่ยนรหัส PIN (Admin) ล้มเหลว');
    }
}

async function getSystemPinConfirmation() {
    return new Promise((resolve) => {
        let pin = '';
        
        const pinModalHtml = `
            <div class="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-sm">
                <div class="text-center mb-8">
                    <div class="w-16 h-16 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                        </svg>
                    </div>
                    <h1 class="text-2xl font-bold text-gray-800 mb-2">กรุณากรอกรหัสระบบ (สำหรับลบ)</h1>
                </div>
                <div id="pinDisplay" class="flex justify-center space-x-4 mb-8">
                    <div class="pin-dot w-4 h-4 rounded-full border-2 border-gray-300 bg-white"></div>
                    <div class="pin-dot w-4 h-4 rounded-full border-2 border-gray-300 bg-white"></div>
                    <div class="pin-dot w-4 h-4 rounded-full border-2 border-gray-300 bg-white"></div>
                    <div class="pin-dot w-4 h-4 rounded-full border-2 border-gray-300 bg-white"></div>
                </div>
                <div id="statusMessage" class="text-center mb-6 h-6">
                    <span class="text-sm text-gray-500">ใช้คีย์บอร์ดหรือแตะปุ่มด้านล่าง</span>
                </div>
                <div class="grid grid-cols-3 gap-2 mb-6">
                    ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => `<button class="keypad-btn bg-gray-50 hover:bg-gray-100 border-2 border-gray-300 text-2xl font-semibold text-gray-800 w-20 h-20 rounded-full flex items-center justify-center mx-auto" data-digit="${d}">${d}</button>`).join('')}
                    <button class="keypad-btn bg-red-50 hover:bg-red-100 border-2 border-red-200 text-red-600 w-20 h-20 rounded-full flex items-center justify-center mx-auto" data-action="cancel">
                        <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                    <button class="keypad-btn bg-gray-50 hover:bg-gray-100 border-2 border-gray-300 text-2xl font-semibold text-gray-800 w-20 h-20 rounded-full flex items-center justify-center mx-auto" data-digit="0">0</button>
                    <button class="keypad-btn bg-red-50 hover:bg-red-100 border-2 border-red-200 text-red-600 w-20 h-20 rounded-full flex items-center justify-center mx-auto" data-action="delete">
                        <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z"></path></svg>
                    </button>
                </div>
            </div>
        `;

        Swal.fire({
            html: pinModalHtml,
            customClass: { popup: 'pin-modal' },
            showConfirmButton: false,
            showCancelButton: false,
            didOpen: (modal) => {
                const pinDisplay = modal.querySelector('#pinDisplay');
                const statusMessage = modal.querySelector('#statusMessage');
                const keypadButtons = modal.querySelectorAll('.keypad-btn');
                const dots = modal.querySelectorAll('.pin-dot');

                const updatePinDisplay = () => {
                    dots.forEach((dot, index) => {
                        if (index < pin.length) {
                            dot.classList.add('filled');
                            dot.style.backgroundColor = '#6366f1';
                            dot.style.borderColor = '#6366f1';
                        } else {
                            dot.classList.remove('filled');
                            dot.style.backgroundColor = 'white';
                            dot.style.borderColor = '#d1d5db';
                        }
                    });
                };

                const clearPin = () => {
                    pin = '';
                    updatePinDisplay();
                    statusMessage.innerHTML = '<span class="text-sm text-gray-500">ใช้คีย์บอร์ดหรือแตะปุ่มด้านล่าง</span>';
                };

                const handleIncorrectPin = () => {
                    statusMessage.innerHTML = '<span class="text-sm text-red-600 font-medium">✗ PIN ไม่ถูกต้อง</span>';
                    pinDisplay.classList.add('shake');
                    dots.forEach(dot => {
                        dot.style.backgroundColor = '#ef4444'; dot.style.borderColor = '#ef4444';
                        dot.style.boxShadow = '0 0 20px rgba(239, 68, 68, 0.5)';
                    });
                    setTimeout(() => {
                        pinDisplay.classList.remove('shake');
                        clearPin();
                    }, 1000);
                };

                const handleCorrectPin = () => {
                    statusMessage.innerHTML = '<span class="text-sm text-green-600 font-medium">✓ PIN ถูกต้อง!</span>';
                    pinDisplay.classList.add('success-pulse');
                     dots.forEach(dot => {
                        dot.style.backgroundColor = '#10b981'; dot.style.borderColor = '#10b981';
                        dot.style.boxShadow = '0 0 20px rgba(16, 185, 129, 0.5)';
                    });
                    setTimeout(() => {
                        Swal.close();
                        resolve(pin);
                    }, 800);
                };
                
                const checkPin = () => {
                    if (pin === systemPIN) handleCorrectPin();
                    else handleIncorrectPin();
                };
                
                const addDigit = (digit) => {
                    if (pin.length < 4) {
                        pin += digit;
                        updatePinDisplay();
                        if (pin.length === 4) setTimeout(checkPin, 300);
                    }
                };
                
                const deleteDigit = () => {
                    if (pin.length > 0) {
                        pin = pin.slice(0, -1);
                        updatePinDisplay();
                        statusMessage.innerHTML = '<span class="text-sm text-gray-500">ใช้คีย์บอร์ดหรือแตะปุ่มด้านล่าง</span>';
                    }
                };
                
                const cancel = () => {
                    Swal.close();
                    resolve(null);
                }

                keypadButtons.forEach(button => {
                    button.addEventListener('click', () => {
                        if (button.dataset.digit) addDigit(button.dataset.digit);
                        else if (button.dataset.action === 'delete') deleteDigit();
                        else if (button.dataset.action === 'cancel') cancel();
                    });
                });
                
                const handleKeyDown = (event) => {
                    event.stopPropagation();
                    if (event.key >= '0' && event.key <= '9') {
                        addDigit(event.key);
                    } else if (event.key === 'Backspace') {
                        event.preventDefault();
                        deleteDigit();
                    } else if (event.key === 'Escape') {
                        cancel();
                    }
                };

                modal.addEventListener('keydown', handleKeyDown);
                modal.tabIndex = -1;
                modal.focus();
            }
        });
    });
}


// --- UTILITY FUNCTIONS ---
async function loadHolidays() {
    try {
      const response = await fetch('holidays.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const holidayData = await response.json();
      holidays = holidayData;
      console.log('✅ โหลดข้อมูลวันหยุดจาก holidays.json สำเร็จ');
  
    } catch (error) {
      console.error("❌ ไม่สามารถโหลดไฟล์ holidays.json ได้:", error);
      holidays = []; 
    }
}

function toLocalISOString(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function toLocalISOStringInThailand(date) {
    const options = {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    };
    return new Intl.DateTimeFormat('en-CA', options).format(date);
}

function updateDateTime() {
    const now = new Date();
    const options = { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        timeZone: 'Asia/Bangkok'
    };
    document.getElementById('datetime-display').textContent = now.toLocaleDateString('th-TH', options);
}

function getCurrentFiscalYear() {
    const now = new Date();
    const yearFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric'
    });
    const monthFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Bangkok',
        month: 'numeric'
    });

    const year = parseInt(yearFormatter.format(now));
    const month = parseInt(monthFormatter.format(now)) - 1;

    return month >= 9 ? year + 544 : year + 543;
}

function formatDateThaiShort(dateStrOrObj) {
    if (!dateStrOrObj) return '';
    const date = dateStrOrObj.toDate ? dateStrOrObj.toDate() : new Date(dateStrOrObj);
    const year = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })).getFullYear() + 543;
    const shortYear = year.toString().slice(-2);

    return new Intl.DateTimeFormat('th-TH', { 
        month: 'short', 
        day: 'numeric',
        timeZone: 'Asia/Bangkok'
    }).format(date) + ' ' + shortYear;
}

function formatDateTimeThaiShort(dateStrOrObj) {
    if (!dateStrOrObj) return '';
    const date = dateStrOrObj.toDate ? dateStrOrObj.toDate() : new Date(dateStrOrObj);
    const datePart = formatDateThaiShort(date);
    const timePart = new Intl.DateTimeFormat('th-TH', { 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: false,
        timeZone: 'Asia/Bangkok'
    }).format(date);
    return `${datePart}, ${timePart} น.`;
}

function formatHoursAndMinutes(decimalHours) {
    if (isNaN(decimalHours)) return '0 ชม. 0 นาที';
    const hours = Math.floor(decimalHours);
    const minutes = Math.round((decimalHours - hours) * 60);
    return `${hours} ชม. ${minutes} นาที`;
}
function calculateDuration(startTime, endTime) {
    const start = new Date(`1970-01-01T${startTime}`);
    const end = new Date(`1970-01-01T${endTime}`);
    const diff = (end - start) / 3600000;
    return diff > 0 ? { total: diff, hours: Math.floor(diff), minutes: Math.round((diff % 1) * 60) } : { total: 0, hours: 0, minutes: 0 };
}

function calculateLeaveDays(startDate, endDate, startPeriod, endPeriod) {
    const sDate = new Date(startDate + 'T00:00:00');
    const eDate = new Date(endDate + 'T00:00:00');

    if (sDate > eDate) return 0;

    // Helper
    const toYYYYMMDD = (d) => {
        const year = d.getFullYear();
        const month = (d.getMonth() + 1).toString().padStart(2, '0');
        const day = d.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // === Special case: same start & end date ===
    if (sDate.getTime() === eDate.getTime()) {
        // นโยบายใหม่: วันเดียวกันให้คิดตามประเภทตรง ๆ ไม่สนเสาร์-อาทิตย์/วันหยุด
        const isHalf = (startPeriod && startPeriod.includes('ครึ่งวัน')) || (endPeriod && endPeriod.includes('ครึ่งวัน'));
        return isHalf ? 0.5 : 1;
    }

    // === Multi-day logic (original) ===
    let leaveDayCount = 0;
    const currentDate = new Date(sDate);

    while (currentDate <= eDate) {
        const dateString = toYYYYMMDD(currentDate);
        const isWeekend = (currentDate.getDay() === 0 || currentDate.getDay() === 6);
        const isHoliday = holidays[dateString]; // <-- แก้ไขตรงนี้

        if (!isWeekend && !isHoliday) { // <-- แก้ไขตรงนี้ (ตรรกะเดิมยังใช้ได้)
            leaveDayCount++;
        }

        currentDate.setDate(currentDate.getDate() + 1);
    }

    // Adjust for half-day at start
    const sDateString = toYYYYMMDD(sDate);
    const sDateIsWorkday = (sDate.getDay() !== 0 && sDate.getDay() !== 6 && !holidays[sDateString]); // <-- แก้ไขตรงนี้
    if (sDateIsWorkday && startPeriod && startPeriod.includes('ครึ่งวัน')) {
        leaveDayCount -= 0.5;
    }

    // Adjust for half-day at end
    const eDateString = toYYYYMMDD(eDate);
    const eDateIsWorkday = (eDate.getDay() !== 0 && eDate.getDay() !== 6 && !holidays[eDateString]); // <-- แก้ไขตรงนี้
    if (eDateIsWorkday && endPeriod && endPeriod.includes('ครึ่งวัน')) {
        leaveDayCount -= 0.5;
    }

    return Math.max(0, leaveDayCount);
}

function getPositionBadgeClass(position) {
    switch (position) {
        case 'เภสัช': return 'pos-เภสัช';
        case 'จพง': return 'pos-จพง';
        case 'จนท': return 'pos-จนท';
        default: return 'pos-default';
    }
}
function getLeaveTypeClass(leaveType) {
    if (leaveType.includes('ป่วย')) return 'text-red-500';
    if (leaveType.includes('พักผ่อน')) return 'text-green-500';
    if (leaveType.includes('กิจ')) return 'text-purple-500';
    if (leaveType.includes('คลอด')) return 'text-pink-500';
    return 'text-gray-700';
}

function showLoadingPopup(message = 'กำลังประมวลผล...') {
    Swal.fire({ title: message, allowOutsideClick: false, didOpen: () => { Swal.showLoading(); }});
}
function showSuccessPopup(message = 'สำเร็จ') {
    Swal.fire({ title: message, icon: 'success', confirmButtonText: 'ตกลง' });
}
function showErrorPopup(message = 'เกิดข้อผิดพลาด') {
    Swal.fire({ title: 'เกิดข้อผิดพลาด!', text: message, icon: 'error', confirmButtonText: 'ตกลง' });
}

// --- FORM SUBMISSIONS & PIN LOGIC ---

async function handleRegisterSubmit(e) {
    e.preventDefault();
    const fullname = document.getElementById('register-fullname').value.trim();
    const nickname = document.getElementById('register-nickname').value.trim();
    const pin = document.getElementById('register-pin').value;
    const pinConfirm = document.getElementById('register-pin-confirm').value;

    if (!fullname || !nickname) return showErrorPopup("กรุณากรอกชื่อ-สกุล และชื่อเล่นให้ครบถ้วน");
    
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
        return showErrorPopup('PIN ต้องเป็นตัวเลข 4 หลักเท่านั้น');
    }
    if (pin !== pinConfirm) {
        return showErrorPopup('PIN ทั้งสองช่องไม่ตรงกัน');
    }

    showLoadingPopup("กำลังตรวจสอบ...");
    try {
        const usersRef = collection(db, "users");
        const qNickname = query(usersRef, where("nickname", "==", nickname));
        const nicknameSnapshot = await getDocs(qNickname);
        if (!nicknameSnapshot.empty) return showErrorPopup(`ชื่อเล่น "${nickname}" นี้มีในระบบแล้ว`);
        
        showLoadingPopup("กำลังบันทึก...");
        await addDoc(usersRef, { 
            fullname, 
            nickname, 
            position: document.getElementById('register-position').value,
            pin: pin
        });
        showSuccessPopup('ลงทะเบียนสำเร็จ');
        e.target.reset();
    } catch (error) { showErrorPopup('ลงทะเบียนล้มเหลว: ' + error.message); }
}

async function handleChangePersonalPin(e) {
    e.preventDefault();
    const nickname = tomSelectPinUser.getValue();
    const oldPin = document.getElementById('old-personal-pin').value;
    const newPin = document.getElementById('new-personal-pin').value;
    const confirmNewPin = document.getElementById('confirm-new-personal-pin').value;

    if (!nickname) return showErrorPopup('กรุณาเลือกผู้ใช้');

    const user = users.find(u => u.nickname === nickname);
    if (!user) return showErrorPopup('ไม่พบข้อมูลผู้ใช้');

    if (oldPin !== user.pin) return showErrorPopup('PIN เดิมไม่ถูกต้อง');

    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
        return showErrorPopup('PIN ใหม่ต้องเป็นตัวเลข 4 หลักเท่านั้น');
    }
    if (newPin !== confirmNewPin) return showErrorPopup('PIN ใหม่ทั้งสองช่องไม่ตรงกัน');
    if (oldPin === newPin) return showErrorPopup('PIN ใหม่ต้องไม่ซ้ำกับ PIN เดิม');

    showLoadingPopup('กำลังเปลี่ยนรหัส PIN...');
    try {
        const userDocRef = doc(db, "users", user.id);
        await updateDoc(userDocRef, { pin: newPin });
        showSuccessPopup('เปลี่ยนรหัส PIN สำเร็จ');
        user.pin = newPin;
        e.target.reset();
        tomSelectPinUser.clear();
    } catch (error) {
        console.error("Error changing personal PIN:", error);
        showErrorPopup('เปลี่ยนรหัส PIN ล้มเหลว');
    }
}

async function handleHourlySubmit(e) {
    e.preventDefault();
    
    const selectedTypeInput = document.querySelector('input[name="hourlyLeaveType"]:checked');
    if (!selectedTypeInput) return showErrorPopup('กรุณาเลือกประเภทรายการ');
    
    const currentLeaveType = selectedTypeInput.value;
    const approver = tomSelectHourlyApprover.getValue();

    if (!approver) {
        return showErrorPopup('กรุณาเลือกผู้อนุมัติ');
    }

    
    // Validate time order: end > start
    const startTimeVal = document.getElementById('hourly-start').value;
    const endTimeVal   = document.getElementById('hourly-end').value;
    if (startTimeVal && endTimeVal && endTimeVal <= startTimeVal){
        return showErrorPopup('กรุณาเลือกเวลาสิ้นสุดหลังจากเวลาเริ่มต้น');
    }
const formData = {
        fiscalYear: parseInt(document.getElementById('hourly-filter-fiscal-year').value),
        userNickname: tomSelectHourly.getValue(), 
        date: document.getElementById('hourly-date').value,
        startTime: document.getElementById('hourly-start').value, 
        endTime: document.getElementById('hourly-end').value,
        duration: calculateDuration(document.getElementById('hourly-start').value, document.getElementById('hourly-end').value).total,
        type: currentLeaveType, 
        note: document.getElementById('hourly-note').value, 
        approver: approver,
        confirmed: false, // This field means "approved"
    };

    if (formData.startTime >= formData.endTime) {
        return showErrorPopup('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น');
    }
    if (!formData.userNickname) return showErrorPopup('กรุณาเลือกผู้ใช้');

    const conflict = hasHourlyConflict(formData.userNickname, formData.date, formData.startTime, formData.endTime);
    if (conflict) {
        Swal.fire({
            icon: 'warning',
            title: 'ตรวจพบรายการซ้ำซ้อน',
            html: `มีการบันทึกข้อมูลในช่วงเวลา <b>${conflict.startTime} - ${conflict.endTime}</b> ของวันนี้ไปแล้ว<br><br>กรุณาตรวจสอบข้อมูลอีกครั้ง`,
            confirmButtonText: 'รับทราบ',
            confirmButtonColor: '#f59e0b'
        });
        return; 
    }

    const durationText = formatHoursAndMinutes(formData.duration);
    const summaryHtml = `
        <p><b>ผู้ใช้:</b> ${formData.userNickname}</p>
        <p><b>ประเภท:</b> ${formData.type === 'leave' ? 'ลาชั่วโมง' : 'ใช้ชั่วโมง'}</p>
        <p><b>วันที่:</b> ${formatDateThaiShort(formData.date)}</p>
        <p><b>เวลา:</b> ${formData.startTime} - ${formData.endTime}</p>
        <p><b>ผู้อนุมัติ:</b> ${formData.approver}</p>
        <p><b>รวมเป็นเวลา:</b> ${durationText}</p>
    `;

    const isPinCorrect = await confirmWithUserPin(formData.userNickname, summaryHtml);

    if (isPinCorrect) {
        showLoadingPopup();
        try {
            await addDoc(collection(db, "hourlyRecords"), {...formData, timestamp: serverTimestamp()});

            const user = users.find(u => u.nickname === formData.userNickname);
            if (user) {
                await sendHourlyTelegramNotification(formData, user);
            }

            showSuccessPopup('บันทึกสำเร็จ');
            e.target.reset(); 
            tomSelectHourly.clear();
            tomSelectHourlyApprover.clear();
            setDefaultDate();
            document.querySelectorAll('.radio-option-animated').forEach(opt => opt.classList.remove('selected'));
        } catch (error) { showErrorPopup('บันทึกล้มเหลว'); }
    }
}

async function sendHourlyTelegramNotification(hourlyData, user) {
    const apiToken = '8256265459:AAGPbAd_-wDPW0FSZUm49SwZD8FdEzy2zTQ';
    const chatId = '-1002988996292';
    const url = `https://api.telegram.org/bot${apiToken}/sendMessage`;

    const typeDisplay = hourlyData.type === 'leave' ? 'ลาชั่วโมง 🔴' : 'ใช้ชั่วโมง 🟢';
    const durationDisplay = formatHoursAndMinutes(hourlyData.duration);

    const message = `
🔵⏰ <b>มีรายการแจ้งลาชั่วโมงใหม่</b> ⏰🔵
--------------------------------------
<b>ชื่อ:</b> ${user.fullname} (${user.nickname})-${user.position}
<b>ประเภท:</b> ${typeDisplay}
<b>วันที่:</b> ${formatDateThaiShort(hourlyData.date)}
<b>เวลา:</b> ${hourlyData.startTime} - ${hourlyData.endTime} (${durationDisplay})
<b>หมายเหตุ:</b> ${hourlyData.note || '-'}
--------------------------------------
👩‍⚕️ <b>ผู้อนุมัติ:</b> ${hourlyData.approver}
<i>*กรุณาตรวจสอบและอนุมัติในระบบ*</i>
    `;

    const params = {
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        reply_markup: JSON.stringify({
            inline_keyboard: [
                [{ text: '🔗 เปิดระบบแจ้งลา', url: 'https://codex074.github.io/leave_OPD/' }]
            ]
        })
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(params)
        });

        const data = await response.json();
        if (data.ok) {
            console.log('Hourly Telegram notification sent successfully.');
        } else {
            console.error('Failed to send hourly Telegram notification:', data.description);
        }
    } catch (error) {
        console.error('Error sending hourly Telegram notification:', error);
    }
}


async function sendTelegramNotification(leaveData, user, leaveDays) {
    const apiToken = '8256265459:AAGPbAd_-wDPW0FSZUm49SwZD8FdEzy2zTQ';
    const chatId = '-1002988996292';
    const url = `https://api.telegram.org/bot${apiToken}/sendMessage`;

    const dateDisplay = leaveData.startDate === leaveData.endDate
        ? formatDateThaiShort(leaveData.startDate)
        : `${formatDateThaiShort(leaveData.startDate)} - ${formatDateThaiShort(leaveData.endDate)}`;

    let periodDisplay = '';
    if (leaveData.startDate === leaveData.endDate) {
        periodDisplay = `(${leaveData.startPeriod})`;
    } else {
        periodDisplay = `(เริ่ม${leaveData.startPeriod} - สิ้นสุด${leaveData.endPeriod})`;
    }

    const message = `
🔔📅 <b>มีรายการแจ้งลาใหม่</b> 📅 🔔
--------------------------------------
<b>ผู้ลา:</b> ${user.fullname} (${user.nickname})-${user.position}
<b>ประเภท:</b> ${leaveData.leaveType}
<b>วันที่:</b> ${dateDisplay} ${periodDisplay} (${leaveDays} วัน)
<b>หมายเหตุ:</b> ${leaveData.note || '-'}
--------------------------------------
👩‍⚕️ <b>ผู้อนุมัติ:</b> ${leaveData.approver}
<i>*กรุณาตรวจสอบและอนุมัติในระบบ*</i>
    `;

    const params = {
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        reply_markup: JSON.stringify({
            inline_keyboard: [
                [{ text: '🔗 เปิดระบบแจ้งลา', url: 'https://codex074.github.io/leave_OPD/' }]
            ]
        })
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(params)
        });

        const data = await response.json();
        if (data.ok) {
            console.log('Telegram notification sent successfully.');
        } else {
            console.error('Failed to send Telegram notification:', data.description);
        }
    } catch (error) {
        console.error('Error sending Telegram notification:', error);
    }
}

async function handleLeaveSubmit(e) {
    e.preventDefault();
    if (!currentFullDayLeaveType) {
        showErrorPopup('กรุณาเลือกประเภทการลา');
        return;
    }
    
    
    // Validate date order: endDate >= startDate
    const sDateVal = document.getElementById('leave-start-date').value;
    const eDateVal = document.getElementById('leave-end-date').value;
    if (sDateVal && eDateVal && eDateVal < sDateVal){
        return showErrorPopup('กรุณาเลือกวันที่สิ้นสุดไม่น้อยกว่าวันที่เริ่มต้น');
    }
const formData = {
        fiscalYear: parseInt(document.getElementById('leave-filter-fiscal-year').value),
        userNickname: tomSelectLeave.getValue(), 
        leaveType: currentFullDayLeaveType,
        startDate: document.getElementById('leave-start-date').value,
        endDate: document.getElementById('leave-end-date').value,
        startPeriod: document.getElementById('leave-start-period').value,
        endPeriod: document.getElementById('leave-end-period').value,
        approver: document.getElementById('leave-approver').value, 
        note: document.getElementById('leave-note').value, 
        status: 'รออนุมัติ',
    };
    
    if (!formData.approver) {
        return showErrorPopup('กรุณาเลือกผู้อนุมัติ');
    }
    
    if (!formData.userNickname) return showErrorPopup('กรุณาเลือกผู้ลา');
    if (new Date(formData.endDate) < new Date(formData.startDate)) return showErrorPopup('วันที่สิ้นสุดต้องไม่มาก่อนวันที่เริ่มต้น');

    const conflict = hasFullDayConflict(formData.userNickname, formData.startDate, formData.endDate, formData.startPeriod, formData.endPeriod);
    if (conflict) {
        Swal.fire({
            icon: 'warning',
            title: 'ตรวจพบการลาซ้ำซ้อน',
            html: `คุณมีข้อมูลการลาในวันที่ <b>${formatDateThaiShort(conflict.date)}</b> อยู่แล้ว<br>(${conflict.type})<br><br>กรุณาตรวจสอบข้อมูลอีกครั้ง`,
            confirmButtonText: 'ตกลง',
            confirmButtonColor: '#f59e0b'
        });
        return;
    }
    
    const leaveDays = calculateLeaveDays(formData.startDate, formData.endDate, formData.startPeriod, formData.endPeriod);
    const dateDisplay = formData.startDate === formData.endDate ? formatDateThaiShort(formData.startDate) : `${formatDateThaiShort(formData.startDate)} - ${formatDateThaiShort(formData.endDate)}`;
    let periodDisplay = '';
    if (formData.startDate === formData.endDate) {
        periodDisplay = formData.startPeriod;
    } else {
        periodDisplay = `เริ่มต้น (${formData.startPeriod}) ถึง สิ้นสุด (${formData.endPeriod})`;
    }
    
    const summaryHtml = `
        <p><b>ผู้ลา:</b> ${formData.userNickname}</p>
        <p><b>ประเภท:</b> ${formData.leaveType}</p>
        <p><b>วันที่:</b> ${dateDisplay}</p>
        <p><b>ช่วงเวลา:</b> ${periodDisplay}</p>
        <p><b>จำนวนวันลา:</b> ${leaveDays} วัน</p>
    `;
    
    const isPinCorrect = await confirmWithUserPin(formData.userNickname, summaryHtml);

    if (isPinCorrect) {
        showLoadingPopup();
        try {
            await addDoc(collection(db, "leaveRecords"), {...formData, createdDate: serverTimestamp()});
            
            const user = users.find(u => u.nickname === formData.userNickname);
            if (user) {
                await sendTelegramNotification(formData, user, leaveDays);
            }

            showSuccessPopup('บันทึกสำเร็จ');
            e.target.reset(); 
            tomSelectLeave.clear(); 
            setDefaultDate();
            currentFullDayLeaveType = null;
            
            const leaveButtons = document.querySelectorAll('#leave-type-buttons-new .leave-type-btn');
            leaveButtons.forEach(btn => {
                btn.classList.remove('active', 'bg-purple-500', 'bg-green-500', 'bg-red-500', 'bg-pink-500', 'text-white', 'border-purple-500', 'border-green-500', 'border-red-500', 'border-pink-500');
                btn.classList.add('text-gray-700', 'border-gray-300');
            });

        } catch (error) { showErrorPopup('บันทึกล้มเหลว');}
    }
}

async function confirmWithAdminPin(adminUsername, summaryHtml) {
    const admin = admins.find(a => a.username === adminUsername);
    if (!admin || !admin.pin) {
        showErrorPopup('ไม่พบข้อมูล PIN สำหรับผู้อนุมัตินี้');
        return false;
    }
    const correctPin = admin.pin;

    return new Promise((resolve) => {
        let pin = '';
        const pinModalHtml = `
            <div class="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-sm">
                <div class="text-left text-sm mb-6 p-4 bg-yellow-50 rounded-lg border border-yellow-200">${summaryHtml}</div>
                <hr class="my-4"/>
                <h1 class="text-xl font-bold text-gray-800 mb-2 text-center">ยืนยันการอนุมัติโดย: <br/><span class="text-indigo-600">${adminUsername}</span></h1>
                <p class="text-center text-sm text-gray-500 mb-4">กรุณากรอก PIN ส่วนตัวของท่านเพื่อยืนยัน</p>
                <div id="pinDisplay" class="flex justify-center space-x-4 mb-8">
                    <div class="pin-dot w-4 h-4 rounded-full border-2 border-gray-300 bg-white"></div>
                    <div class="pin-dot w-4 h-4 rounded-full border-2 border-gray-300 bg-white"></div>
                    <div class="pin-dot w-4 h-4 rounded-full border-2 border-gray-300 bg-white"></div>
                    <div class="pin-dot w-4 h-4 rounded-full border-2 border-gray-300 bg-white"></div>
                </div>
                <div id="statusMessage" class="text-center mb-6 h-6"></div>
                <div class="grid grid-cols-3 gap-2 mb-6">
                    ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => `<button class="keypad-btn bg-gray-50 hover:bg-gray-100 border-2 border-gray-300 text-2xl font-semibold text-gray-800 w-20 h-20 rounded-full flex items-center justify-center mx-auto" data-digit="${d}">${d}</button>`).join('')}
                    <button class="keypad-btn bg-red-50 hover:bg-red-100 border-2 border-red-200 text-red-600 w-20 h-20 rounded-full flex items-center justify-center mx-auto" data-action="cancel">
                        <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                    <button class="keypad-btn bg-gray-50 hover:bg-gray-100 border-2 border-gray-300 text-2xl font-semibold text-gray-800 w-20 h-20 rounded-full flex items-center justify-center mx-auto" data-digit="0">0</button>
                    <button class="keypad-btn bg-red-50 hover:bg-red-100 border-2 border-red-200 text-red-600 w-20 h-20 rounded-full flex items-center justify-center mx-auto" data-action="delete">
                        <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z"></path></svg>
                    </button>
                </div>
            </div>
        `;
        
        Swal.fire({
            html: pinModalHtml,
            customClass: { popup: 'pin-modal' },
            showConfirmButton: false,
            showCancelButton: false,
            didOpen: (modal) => {
                const pinDisplay = modal.querySelector('#pinDisplay');
                const statusMessage = modal.querySelector('#statusMessage');
                const keypadButtons = modal.querySelectorAll('.keypad-btn');
                const dots = modal.querySelectorAll('.pin-dot');

                const updatePinDisplay = () => {
                    dots.forEach((dot, index) => {
                        if (index < pin.length) {
                            dot.classList.add('filled');
                            dot.style.backgroundColor = '#6366f1';
                            dot.style.borderColor = '#6366f1';
                        } else {
                            dot.classList.remove('filled');
                            dot.style.backgroundColor = 'white';
                            dot.style.borderColor = '#d1d5db';
                        }
                    });
                };

                const clearPin = () => {
                    pin = '';
                    updatePinDisplay();
                };

                const handleIncorrectPin = () => {
                    statusMessage.innerHTML = '<span class="text-sm text-red-600 font-medium">✗ PIN ไม่ถูกต้อง</span>';
                    pinDisplay.classList.add('shake');
                    dots.forEach(dot => {
                        dot.style.backgroundColor = '#ef4444'; dot.style.borderColor = '#ef4444';
                    });
                    setTimeout(() => {
                        pinDisplay.classList.remove('shake');
                        clearPin();
                        statusMessage.innerHTML = '';
                    }, 1000);
                };

                const handleCorrectPin = () => {
                    statusMessage.innerHTML = '<span class="text-sm text-green-600 font-medium">✓ PIN ถูกต้อง!</span>';
                    pinDisplay.classList.add('success-pulse');
                     dots.forEach(dot => {
                        dot.style.backgroundColor = '#10b981'; dot.style.borderColor = '#10b981';
                    });
                    setTimeout(() => {
                        Swal.close();
                        resolve(true);
                    }, 800);
                };
                
                const checkPin = () => {
                    if (pin === correctPin) handleCorrectPin();
                    else handleIncorrectPin();
                };
                
                const addDigit = (digit) => {
                    if (pin.length < 4) {
                        pin += digit;
                        updatePinDisplay();
                        if (pin.length === 4) setTimeout(checkPin, 300);
                    }
                };
                
                const deleteDigit = () => {
                    if (pin.length > 0) {
                        pin = pin.slice(0, -1);
                        updatePinDisplay();
                        statusMessage.innerHTML = '';
                    }
                };
                
                const cancel = () => {
                    Swal.close();
                    resolve(false);
                }

                keypadButtons.forEach(button => {
                    button.addEventListener('click', () => {
                        if (button.dataset.digit) addDigit(button.dataset.digit);
                        else if (button.dataset.action === 'delete') deleteDigit();
                        else if (button.dataset.action === 'cancel') cancel();
                    });
                });
                
                const handleKeyDown = (event) => {
                    event.stopPropagation();
                    if (event.key >= '0' && event.key <= '9') { addDigit(event.key); } 
                    else if (event.key === 'Backspace') { event.preventDefault(); deleteDigit(); } 
                    else if (event.key === 'Escape') { cancel(); }
                };

                modal.addEventListener('keydown', handleKeyDown);
                modal.tabIndex = -1;
                modal.focus();
            }
        });
    });
}


async function confirmWithUserPin(nickname, summaryHtml) {
    const user = users.find(u => u.nickname === nickname);
    if (!user || !user.pin) {
        showErrorPopup('ไม่พบข้อมูล PIN สำหรับผู้ใช้นี้ หรือยังไม่ได้ตั้งค่า PIN');
        return false;
    }
    const correctPin = user.pin;

    return new Promise((resolve) => {
        let pin = '';
        
        const pinModalHtml = `
            <div class="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-sm">
                <div class="text-left text-sm mb-6 p-4 bg-gray-50 rounded-lg border">${summaryHtml}</div>
                <hr class="my-4"/>
                <h1 class="text-xl font-bold text-gray-800 mb-2 text-center">กรุณากรอก PIN เพื่อยืนยัน</h1>
                <div id="pinDisplay" class="flex justify-center space-x-4 mb-8">
                    <div class="pin-dot w-4 h-4 rounded-full border-2 border-gray-300 bg-white"></div>
                    <div class="pin-dot w-4 h-4 rounded-full border-2 border-gray-300 bg-white"></div>
                    <div class="pin-dot w-4 h-4 rounded-full border-2 border-gray-300 bg-white"></div>
                    <div class="pin-dot w-4 h-4 rounded-full border-2 border-gray-300 bg-white"></div>
                </div>
                <div id="statusMessage" class="text-center mb-6 h-6"></div>
                <div class="grid grid-cols-3 gap-2 mb-6">
                    ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => `<button class="keypad-btn bg-gray-50 hover:bg-gray-100 border-2 border-gray-300 text-2xl font-semibold text-gray-800 w-20 h-20 rounded-full flex items-center justify-center mx-auto" data-digit="${d}">${d}</button>`).join('')}
                    <button class="keypad-btn bg-red-50 hover:bg-red-100 border-2 border-red-200 text-red-600 w-20 h-20 rounded-full flex items-center justify-center mx-auto" data-action="cancel">
                        <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                    <button class="keypad-btn bg-gray-50 hover:bg-gray-100 border-2 border-gray-300 text-2xl font-semibold text-gray-800 w-20 h-20 rounded-full flex items-center justify-center mx-auto" data-digit="0">0</button>
                    <button class="keypad-btn bg-red-50 hover:bg-red-100 border-2 border-red-200 text-red-600 w-20 h-20 rounded-full flex items-center justify-center mx-auto" data-action="delete">
                        <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z"></path></svg>
                    </button>
                </div>
            </div>
        `;
        
        Swal.fire({
            html: pinModalHtml,
            customClass: { popup: 'pin-modal' },
            showConfirmButton: false,
            showCancelButton: false,
            didOpen: (modal) => {
                const pinDisplay = modal.querySelector('#pinDisplay');
                const statusMessage = modal.querySelector('#statusMessage');
                const keypadButtons = modal.querySelectorAll('.keypad-btn');
                const dots = modal.querySelectorAll('.pin-dot');

                const updatePinDisplay = () => {
                    dots.forEach((dot, index) => {
                        if (index < pin.length) {
                            dot.classList.add('filled');
                            dot.style.backgroundColor = '#6366f1';
                            dot.style.borderColor = '#6366f1';
                        } else {
                            dot.classList.remove('filled');
                            dot.style.backgroundColor = 'white';
                            dot.style.borderColor = '#d1d5db';
                        }
                    });
                };

                const clearPin = () => {
                    pin = '';
                    updatePinDisplay();
                };

                const handleIncorrectPin = () => {
                    statusMessage.innerHTML = '<span class="text-sm text-red-600 font-medium">✗ PIN ไม่ถูกต้อง</span>';
                    pinDisplay.classList.add('shake');
                    dots.forEach(dot => {
                        dot.style.backgroundColor = '#ef4444'; dot.style.borderColor = '#ef4444';
                    });
                    setTimeout(() => {
                        pinDisplay.classList.remove('shake');
                        clearPin();
                        statusMessage.innerHTML = '';
                    }, 1000);
                };

                const handleCorrectPin = () => {
                    statusMessage.innerHTML = '<span class="text-sm text-green-600 font-medium">✓ PIN ถูกต้อง!</span>';
                    pinDisplay.classList.add('success-pulse');
                     dots.forEach(dot => {
                        dot.style.backgroundColor = '#10b981'; dot.style.borderColor = '#10b981';
                    });
                    setTimeout(() => {
                        Swal.close();
                        resolve(true);
                    }, 800);
                };
                
                const checkPin = () => {
                    if (pin === correctPin) handleCorrectPin();
                    else handleIncorrectPin();
                };
                
                const addDigit = (digit) => {
                    if (pin.length < 4) {
                        pin += digit;
                        updatePinDisplay();
                        if (pin.length === 4) setTimeout(checkPin, 300);
                    }
                };
                
                const deleteDigit = () => {
                    if (pin.length > 0) {
                        pin = pin.slice(0, -1);
                        updatePinDisplay();
                        statusMessage.innerHTML = '';
                    }
                };
                
                const cancel = () => {
                    Swal.close();
                    resolve(false);
                }

                keypadButtons.forEach(button => {
                    button.addEventListener('click', () => {
                        if (button.dataset.digit) addDigit(button.dataset.digit);
                        else if (button.dataset.action === 'delete') deleteDigit();
                        else if (button.dataset.action === 'cancel') cancel();
                    });
                });
                
                const handleKeyDown = (event) => {
                    event.stopPropagation();
                    if (event.key >= '0' && event.key <= '9') { addDigit(event.key); } 
                    else if (event.key === 'Backspace') { event.preventDefault(); deleteDigit(); } 
                    else if (event.key === 'Escape') { cancel(); }
                };

                modal.addEventListener('keydown', handleKeyDown);
                modal.tabIndex = -1;
                modal.focus();
            }
        });
    });
}


// --- CONFLICT CHECKING FUNCTIONS ---
function hasHourlyConflict(nickname, date, newStartTime, newEndTime) {
    const newStart = new Date(`${date}T${newStartTime}`);
    const newEnd = new Date(`${date}T${newEndTime}`);

    const userRecordsOnDate = allHourlyRecords.filter(r => 
        r.userNickname === nickname && r.date === date
    );

    for (const record of userRecordsOnDate) {
        const existingStart = new Date(`${record.date}T${record.startTime}`);
        const existingEnd = new Date(`${record.date}T${record.endTime}`);
        if (newStart < existingEnd && existingStart < newEnd) {
            return record;
        }
    }
    return null;
}

function hasFullDayConflict(nickname, newStartDate, newEndDate, newStartPeriod, newEndPeriod) {
    const userRecords = allLeaveRecords.filter(r => r.userNickname === nickname);
    
    let currentDate = new Date(newStartDate + 'T00:00:00');
    const lastDate = new Date(newEndDate + 'T00:00:00');

    while (currentDate <= lastDate) {
        const dateStr = toLocalISOString(currentDate);
        
        let newPeriodForCurrentDay;
        if (dateStr === newStartDate) {
            newPeriodForCurrentDay = newStartPeriod;
        } else if (dateStr === newEndDate) {
            newPeriodForCurrentDay = newEndPeriod;
        } else {
            newPeriodForCurrentDay = 'เต็มวัน';
        }

        const existingLeavesOnDay = userRecords.filter(r => {
            const existingStart = new Date(r.startDate + 'T00:00:00');
            const existingEnd = new Date(r.endDate + 'T00:00:00');
            return currentDate >= existingStart && currentDate <= existingEnd;
        });

        if (existingLeavesOnDay.length > 0) {
            let existingMorning = false;
            let existingAfternoon = false;

            for (const leave of existingLeavesOnDay) {
                const isSingleDayLeave = leave.startDate === leave.endDate;
                let period;
                if (isSingleDayLeave) {
                    period = leave.startPeriod;
                } else if (dateStr === leave.startDate) {
                    period = leave.startPeriod;
                } else if (dateStr === leave.endDate) {
                    period = leave.endPeriod;
                } else {
                    period = 'เต็มวัน';
                }

                if (period === 'เต็มวัน') {
                    return { date: dateStr, type: 'มีรายการลาเต็มวันอยู่แล้ว' };
                }
                if (period === 'ครึ่งวัน-เช้า') {
                    existingMorning = true;
                }
                if (period === 'ครึ่งวัน-บ่าย') {
                    existingAfternoon = true;
                }
            }

            if (existingMorning && existingAfternoon) {
                 return { date: dateStr, type: 'มีรายการลาทั้งเช้าและบ่ายแล้ว' };
            }
            if (newPeriodForCurrentDay === 'เต็มวัน' && (existingMorning || existingAfternoon)) {
                return { date: dateStr, type: 'มีรายการลาครึ่งวันอยู่แล้ว' };
            }
            if (newPeriodForCurrentDay === 'ครึ่งวัน-เช้า' && existingMorning) {
                return { date: dateStr, type: 'มีรายการลาช่วงเช้าอยู่แล้ว' };
            }
            if (newPeriodForCurrentDay === 'ครึ่งวัน-บ่าย' && existingAfternoon) {
                return { date: dateStr, type: 'มีรายการลาช่วงบ่ายอยู่แล้ว' };
            }
        }
        
        currentDate.setDate(currentDate.getDate() + 1);
    }

    return null;
}


// --- DATA FILTERING & RENDERING ---
function applyHourlyFiltersAndRender() {
    const fiscalYearEl = document.getElementById('hourly-filter-fiscal-year');
    if (!fiscalYearEl) return;
    const fiscalYear = parseInt(fiscalYearEl.value);

    const searchTerm = document.getElementById('hourly-search-name')?.value.toLowerCase() || '';
    const position = document.getElementById('hourly-filter-position')?.value || '';
    const startDate = document.getElementById('hourly-filter-start')?.value || '';
    const endDate = document.getElementById('hourly-filter-end')?.value || '';

    filteredHourlyRecords = allHourlyRecords.filter(record => {
        if (record.fiscalYear !== fiscalYear) return false;
        const user = users.find(u => u.nickname === record.userNickname);
        if (!user) return false;

        const nameMatch = user.fullname.toLowerCase().includes(searchTerm) || user.nickname.toLowerCase().includes(searchTerm);
        const positionMatch = !position || user.position === position;
        const dateMatch = (!startDate || record.date >= startDate) && (!endDate || record.date <= endDate);
        
        return nameMatch && positionMatch && dateMatch;
    });
    
    const summaryPositionFilter = document.getElementById('hourly-summary-filter-position')?.value || '';
    const summaryMap = {};
    const filteredSummaryUsers = users.filter(u => {
        if (!summaryPositionFilter) return true;
        return u.position === summaryPositionFilter;
    });

    filteredSummaryUsers.forEach(u => { 
        summaryMap[u.nickname] = { nickname: u.nickname, fullname: u.fullname, position: u.position, leaveHours: 0, usedHours: 0 }; 
    });
    
    allHourlyRecords.forEach(r => {
        if (r.fiscalYear === fiscalYear && summaryMap[r.userNickname] && r.confirmed) {
            if (r.type === 'leave') summaryMap[r.userNickname].leaveHours += r.duration || 0;
            else if (r.type === 'use') summaryMap[r.userNickname].usedHours += r.duration || 0;
        }
    });
    
    const summary = Object.values(summaryMap).map(item => ({
        ...item,
        balance: item.usedHours - item.leaveHours
    }));

    summary.sort((a, b) => a.balance - b.balance);
    
    renderHourlySummary(summary);
    renderRankings(summary);
    renderHourlyRecords(filteredHourlyRecords);
}

function applyLeaveFiltersAndRender() {
    const fiscalYearEl = document.getElementById('leave-filter-fiscal-year');
    if(!fiscalYearEl) return;
    const fiscalYear = parseInt(fiscalYearEl.value);

    const fiscalYearSpan = document.getElementById('leave-summary-fiscal-year');
    if (fiscalYearSpan) fiscalYearSpan.textContent = fiscalYear;
    
    const summarySearchTerm = document.getElementById('summary-search-name')?.value.toLowerCase() || '';
    const summaryPosition = document.getElementById('summary-filter-position')?.value || '';
    let filteredSummaryUsers = users.filter(user => (user.fullname.toLowerCase().includes(summarySearchTerm) || user.nickname.toLowerCase().includes(summarySearchTerm)) && (!summaryPosition || user.position === summaryPosition));

    const recordsSearchTerm = document.getElementById('records-search-name')?.value.toLowerCase() || '';
    const recordsPosition = document.getElementById('records-filter-position')?.value || '';
    const recordsStart = document.getElementById('records-filter-start')?.value || '';
    const recordsEnd = document.getElementById('records-filter-end')?.value || '';

    filteredLeaveRecords = allLeaveRecords.filter(record => {
        if (record.fiscalYear !== fiscalYear) return false;
        const user = users.find(u => u.nickname === record.userNickname);
        if (!user) return false;
        const nameMatch = user.fullname.toLowerCase().includes(recordsSearchTerm) || user.nickname.toLowerCase().includes(recordsSearchTerm);
        const positionMatch = !recordsPosition || user.position === recordsPosition;
        const startDateMatch = !recordsStart || record.startDate >= recordsStart;
        const endDateMatch = !recordsEnd || record.endDate <= recordsEnd;
        return nameMatch && positionMatch && startDateMatch && endDateMatch;
    });
    
    renderLeaveSection(fiscalYear, filteredLeaveRecords, filteredSummaryUsers);
}

function applyUserFiltersAndRender() {
    const searchTerm = document.getElementById('user-search-name')?.value.toLowerCase() || '';
    const position = document.getElementById('user-filter-position')?.value || '';

    filteredUsers = users.filter(user => {
        const nameMatch = user.fullname.toLowerCase().includes(searchTerm) || user.nickname.toLowerCase().includes(searchTerm);
        const positionMatch = !position || user.position === position;
        return nameMatch && positionMatch;
    });
    
    renderUsersTable();
}

function renderLeaveSection(fiscalYear, records, summaryUsers) {
    const summaryMap = {};
    summaryUsers.forEach(u => { summaryMap[u.nickname] = { ...u, totalDays: 0 }; });
    allLeaveRecords.forEach(r => {
        const sPeriod = r.startPeriod || r.period;
        const ePeriod = r.endPeriod || r.period;
        if (r.fiscalYear === fiscalYear && r.status === 'อนุมัติแล้ว' && summaryMap[r.userNickname]) {
            summaryMap[r.userNickname].totalDays += calculateLeaveDays(r.startDate, r.endDate, sPeriod, ePeriod);
        }
    });

    const summaryData = Object.values(summaryMap);
    summaryData.sort((a, b) => b.totalDays - a.totalDays);
    
    renderLeaveSummary(summaryData);
    renderLeaveRecords(records);
}

function renderUsersTable() {
    const tbody = document.getElementById('users-table');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const totalRecords = filteredUsers.length;
    const totalPages = Math.ceil(totalRecords / recordsPerPage);
    usersCurrentPage = Math.max(1, Math.min(usersCurrentPage, totalPages || 1));
    
    const startIndex = (usersCurrentPage - 1) * recordsPerPage;
    const paginatedUsers = filteredUsers.slice(startIndex, startIndex + recordsPerPage);

    paginatedUsers.forEach(user => {
        tbody.innerHTML += `
            <tr class="border-b hover:bg-gray-50">
                <td class="px-4 py-3">${user.fullname}</td>
                <td class="px-4 py-3">${user.nickname}</td>
                <td class="px-4 py-3"><span class="position-badge ${getPositionBadgeClass(user.position)}">${user.position}</span></td>
                <td class="px-4 py-3">
                    <button onclick="editUser('${user.id}')" class="p-2 rounded-full hover:bg-blue-100 text-blue-600" title="แก้ไข">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" />
                            <path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" />
                        </svg>
                    </button>
                </td>
            </tr>`;
    });
    
    const pageInfo = document.getElementById('user-page-info');
    const prevBtn = document.getElementById('user-prev-btn');
    const nextBtn = document.getElementById('user-next-btn');

    if (pageInfo) pageInfo.textContent = `หน้า ${usersCurrentPage} / ${totalPages || 1}`;
    if (prevBtn) prevBtn.disabled = usersCurrentPage === 1;
    if (nextBtn) nextBtn.disabled = usersCurrentPage === totalPages || totalPages === 0;
}


function renderHourlySummary(summary) {
    const tbody = document.getElementById('hourly-summary-table');
    if(!tbody) return;
    tbody.innerHTML = '';

    const totalRecords = summary.length;
    const totalPages = Math.ceil(totalRecords / summaryRecordsPerPage) || 1;
    hourlySummaryCurrentPage = Math.max(1, Math.min(hourlySummaryCurrentPage, totalPages));

    const startIndex = (hourlySummaryCurrentPage - 1) * summaryRecordsPerPage;
    const paginatedData = summary.slice(startIndex, startIndex + summaryRecordsPerPage);

    paginatedData.forEach(item => {
        const leaveHours = item.leaveHours !== undefined ? item.leaveHours : (item['ชั่วโมงที่ลา (อนุมัติ)'] || 0);
        const usedHours = item.usedHours !== undefined ? item.usedHours : (item['ชั่วโมงที่ใช้ (อนุมัติ)'] || 0);
        const balance = (item.balance !== undefined) ? item.balance : (usedHours - leaveHours);
        // item.nickname is the display nickname (ไทย). We keep it and add clickable span.
        tbody.innerHTML += `
            <tr class="border-b hover:bg-gray-50">
                <td class="px-4 py-3">
                    <span class="clickable-name" data-user="${item.userNickname||item.nickname}" data-display="${item.fullname||item.nickname}">${item.fullname || '-'}</span>
                </td>
                <td class="px-4 py-3"><span class="clickable-name" data-user="${item.userNickname||item.nickname}" data-display="${item.nickname}">${item.nickname}</span></td>
                <td class="px-4 py-3"><span class="position-badge">${item.position || 'N/A'}</span></td>
                <td class="px-4 py-3 text-right">${formatHoursAndMinutes(leaveHours)}</td>
                <td class="px-4 py-3 text-right">${formatHoursAndMinutes(usedHours)}</td>
                <td class="px-4 py-3 text-right font-semibold">${formatHoursAndMinutes(balance)}</td>
            </tr>
        `;
    });

    const pageInfo = document.getElementById('hourly-summary-page-info');
    const prevBtn = document.getElementById('hourly-summary-prev-btn');
    const nextBtn = document.getElementById('hourly-summary-next-btn');
    
    if(pageInfo) pageInfo.textContent = `หน้า ${hourlySummaryCurrentPage} / ${totalPages}`;
    if(prevBtn) prevBtn.disabled = hourlySummaryCurrentPage === 1;
    if(nextBtn) nextBtn.disabled = hourlySummaryCurrentPage === totalPages;
}


function renderRankings(summary) {
    const negativeDiv = document.getElementById('negative-ranking');
    const positiveDiv = document.getElementById('positive-ranking');
    if(!negativeDiv || !positiveDiv) return;
    
    const negativeRanked = summary.filter(s => s.balance < 0).sort((a,b) => a.balance - b.balance).slice(0,3);
    const positiveRanked = summary.filter(s => s.balance > 0).sort((a,b) => b.balance - a.balance).slice(0,3);

    const crowns = { 1: '👑', 2: '🥈', 3: '🥉' };

    const createPodiumHTML = (data, type) => {
        let html = '';
        let displayData = [null, null, null];
        if (data[0]) displayData[1] = {...data[0], rank: 1};
        if (data[1]) displayData[0] = {...data[1], rank: 2};
        if (data[2]) displayData[2] = {...data[2], rank: 3};

        displayData.forEach(s => {
            if (s) {
                const timeValue = type === 'negative' ? Math.abs(s.balance) : s.balance;
                html += `
                <div class="podium-item">
                    <div class="podium-name">${s.nickname}</div>
                    <div class="podium-time">${formatHoursAndMinutes(timeValue)}</div>
                    <div class="podium-bar ${s.rank === 1 ? 'first' : s.rank === 2 ? 'second' : 'third'}">
                        <div class="podium-crown">${crowns[s.rank]}</div>
                        <span>${s.rank}</span>
                    </div>
                </div>`;
            } else {
                html += '<div class="podium-item" style="visibility: hidden;"></div>';
            }
        });
        return html;
    };
    
    negativeDiv.innerHTML = createPodiumHTML(negativeRanked, 'negative');
    negativeDiv.classList.add('negative');
    
    positiveDiv.innerHTML = createPodiumHTML(positiveRanked, 'positive');
    positiveDiv.classList.add('positive');
}


function renderHourlyRecords(records) {
    const tbody = document.getElementById('hourly-records-table');
    if(!tbody) return;
    tbody.innerHTML = '';

    const totalRecords = records.length;
    const totalPages = Math.ceil(totalRecords / recordsPerPage);
    hourlyRecordsCurrentPage = Math.max(1, Math.min(hourlyRecordsCurrentPage, totalPages || 1));

    const startIndex = (hourlyRecordsCurrentPage - 1) * recordsPerPage;
    const paginatedRecords = records.sort((a,b) => (b.timestamp?.toDate() || 0) - (a.timestamp?.toDate() || 0)).slice(startIndex, startIndex + recordsPerPage);

    paginatedRecords.forEach(r => {
        const user = users.find(u => u.nickname === r.userNickname) || {};
        const statusText = r.confirmed ? 'อนุมัติแล้ว' : 'รออนุมัติ';
        const statusClass = r.confirmed ? 'text-green-500' : 'text-yellow-500';

        tbody.innerHTML += `
        <tr class="border-b hover:bg-gray-50" data-id="${r.id}" onclick="showHourlyDetailModal('${r.id}')">
            <td class="px-4 py-3">${formatDateThaiShort(r.date)}</td>
            <td class="px-4 py-3">${r.userNickname}</td>
            <td class="px-4 py-3"><span class="position-badge ${getPositionBadgeClass(user.position)}">${user.position || 'N/A'}</span></td>
            <td class="px-4 py-3 font-semibold ${r.type === 'leave' ? 'text-red-500':'text-green-500'}">${r.type === 'leave' ? 'ลา' : 'ใช้'}</td>
            <td class="px-4 py-3">${r.startTime}-${r.endTime} <span class="font-semibold ${r.type === 'leave' ? 'text-red-500' : 'text-green-500'}">(${formatHoursAndMinutes(r.duration)})</span></td>
            <td class="px-4 py-3">${r.approver || '-'}</td>
            <td class="px-4 py-3 font-semibold ${statusClass}">${statusText}</td>
            <td class="px-4 py-3 flex items-center space-x-1">
                <button onclick="manageRecord('deleteHourly', '${r.id}')" class="p-2 rounded-full hover:bg-red-100 text-red-600" title="ลบ"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg></button>
            </td>
        </tr>`;
    });
    
    const pageInfo = document.getElementById('hourly-page-info');
    const prevBtn = document.getElementById('hourly-prev-btn');
    const nextBtn = document.getElementById('hourly-next-btn');
    
    if(pageInfo) pageInfo.textContent = `หน้า ${hourlyRecordsCurrentPage} / ${totalPages || 1}`;
    if(prevBtn) prevBtn.disabled = hourlyRecordsCurrentPage === 1;
    if(nextBtn) nextBtn.disabled = hourlyRecordsCurrentPage === totalPages || totalPages === 0;
}

function renderLeaveSummary(summaryData) {
    const tbody = document.getElementById('leave-summary-table');
    if(!tbody) return;
    tbody.innerHTML = '';

    const totalRecords = summaryData.length;
    const totalPages = Math.ceil(totalRecords / summaryRecordsPerPage) || 1;
    leaveSummaryCurrentPage = Math.max(1, Math.min(leaveSummaryCurrentPage, totalPages));

    const startIndex = (leaveSummaryCurrentPage - 1) * summaryRecordsPerPage;
    const paginatedData = summaryData.slice(startIndex, startIndex + summaryRecordsPerPage);

    paginatedData.forEach((user) => {
         tbody.innerHTML += `<tr class="border-b hover:bg-gray-50"><td class="px-4 py-3"><a href="#" onclick="event.preventDefault(); showLeaveDetailPopup('${user.nickname}')" class="text-purple-600 hover:underline">${user.fullname}</a></td><td class="px-4 py-3">${user.nickname}</td><td class="px-4 py-3"><span class="position-badge ${getPositionBadgeClass(user.position)}">${user.position}</span></td><td class="px-4 py-3 font-semibold">${user.totalDays} วัน</td></tr>`;
    });

    const pageInfo = document.getElementById('summary-page-info');
    const prevBtn = document.getElementById('summary-prev-btn');
    const nextBtn = document.getElementById('summary-next-btn');
    
    if(pageInfo) pageInfo.textContent = `หน้า ${leaveSummaryCurrentPage} / ${totalPages}`;
    if(prevBtn) prevBtn.disabled = leaveSummaryCurrentPage === 1;
    if(nextBtn) nextBtn.disabled = leaveSummaryCurrentPage === totalPages;
    window.showLeaveDetailPopup = function(nickname) {
  const fyEl = document.getElementById('leave-filter-fiscal-year');
  const fiscalYear = fyEl ? parseInt(fyEl.value) : getCurrentFiscalYear();

  const user = users.find(u => u.nickname === nickname);
  if (!user) return showErrorPopup('ไม่พบผู้ใช้');

  const getTypeKey = (t='') => {
    const s = String(t).trim();
    if (/พักผ่อน/i.test(s)) return 'vacation';
    if (/ป่วย/i.test(s))    return 'sick';
    if (/คลอด/i.test(s))    return 'maternity';
    return 'personal';
  };

  const totals = { vacation: 0, sick: 0, personal: 0, maternity: 0 };

  const records = allLeaveRecords
    .filter(r => r.userNickname === nickname && r.fiscalYear === fiscalYear && r.status === 'อนุมัติแล้ว')
    .map(r => {
      const sPeriod = r.startPeriod || r.period;
      const ePeriod = r.endPeriod || r.period;
      const days = calculateLeaveDays(r.startDate, r.endDate, sPeriod, ePeriod);
      const key  = getTypeKey(r.leaveType);
      totals[key] += days;
      return { ...r, days, key };
    })
    .sort((a,b) => (b.createdDate?.toDate?.() || new Date(b.startDate)) - (a.createdDate?.toDate?.() || new Date(a.startDate)));

  const card = (label, value, extra='') => `
    <div class="rounded-xl shadow-md p-4 text-center text-gray-800 ${extra}">
      <div class="text-sm mb-1">${label}</div>
      <div class="text-3xl font-extrabold">${value}</div>
      <div class="text-xs mt-1">วัน (อนุมัติ)</div>
    </div>`;

  const cardsHtml = `
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      ${card('ลาพักผ่อน', totals.vacation, 'leave-card-vacation')}
      ${card('ลาป่วย',     totals.sick,     'leave-card-sick')}
      ${card('ลากิจ/ฉุกเฉิน', totals.personal, 'leave-card-personal')}
      ${card('ลาคลอด',    totals.maternity,'leave-card-maternity')}
    </div>
  `;

  // === Pagination ===
  let currentPage = 1;
  const perPage = 10;
  const totalPages = Math.max(1, Math.ceil(records.length / perPage));

  const renderTable = () => {
    const start = (currentPage - 1) * perPage;
    const pageRecords = records.slice(start, start + perPage);

    const rows = pageRecords.map(r => {
      const dateText = (r.startDate === r.endDate)
        ? `${formatDateThaiShort(r.startDate)} (${r.startPeriod || r.period})`
        : `${formatDateThaiShort(r.startDate)} (${r.startPeriod || r.period}) - ${formatDateThaiShort(r.endDate)} (${r.endPeriod || r.period})`;

      const tagClass =
        r.key === 'vacation'  ? 'modal-tag modal-tag-green'   :
        r.key === 'sick'      ? 'modal-tag modal-tag-red'     :
        r.key === 'maternity' ? 'modal-tag modal-tag-pink'    :
                                'modal-tag modal-tag-purple';

      return `
        <tr class="border-b">
          <td class="px-3 py-2"><span class="${tagClass}">${r.leaveType}</span></td>
          <td class="px-3 py-2">${dateText}</td>
          <td class="px-3 py-2 text-center font-semibold">${r.days}</td>
          <td class="px-3 py-2">${r.approver || '-'}</td>
        </tr>`;
    }).join('') || `<tr><td colspan="4" class="px-3 py-6 text-center text-gray-500">ไม่มีข้อมูล</td></tr>`;

    const pager = `
      <div class="flex justify-between items-center mt-2">
        <button class="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300" ${currentPage===1?'disabled':''} onclick="document.querySelector('#leave-table-body').dispatchEvent(new CustomEvent('changePage',{detail:-1}))">ก่อนหน้า</button>
        <div class="text-sm">หน้า ${currentPage} / ${totalPages}</div>
        <button class="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300" ${currentPage===totalPages?'disabled':''} onclick="document.querySelector('#leave-table-body').dispatchEvent(new CustomEvent('changePage',{detail:1}))">ถัดไป</button>
      </div>`;

    return `
      <div class="bg-gray-50 border rounded-lg">
        <div class="px-3 py-2 text-sm font-semibold text-gray-700">รายการวันลา</div>
        <div class="overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead class="bg-white sticky top-0">
              <tr class="text-gray-600">
                <th class="px-3 py-2 text-left">ประเภท</th>
                <th class="px-3 py-2 text-left">ช่วงวัน/เวลา</th>
                <th class="px-3 py-2 w-24">วันลา</th>
                <th class="px-3 py-2">ผู้อนุมัติ</th>
              </tr>
            </thead>
            <tbody id="leave-table-body">${rows}</tbody>
          </table>
        </div>
        ${pager}
      </div>`;
  };

  Swal.fire({
    title: `สรุปวันลาของ ${user.fullname} (${user.nickname}) – ปีงบ ${fiscalYear}`,
    html: cardsHtml + renderTable(),
    width: Math.min(window.innerWidth - 32, 900),
    confirmButtonText: 'ปิด',
    didOpen: () => {
      const body = document.getElementById('leave-table-body');
      body.addEventListener('changePage', e => {
        currentPage = Math.min(Math.max(1, currentPage + e.detail), totalPages);
        Swal.update({ html: cardsHtml + renderTable() });
      });
    }
  });
};

}

function renderLeaveRecords(records) {
    const tbody = document.getElementById('leave-records-table');
    if(!tbody) return;
    tbody.innerHTML = '';

    const totalRecords = records.length;
    const totalPages = Math.ceil(totalRecords / recordsPerPage);
    leaveRecordsCurrentPage = Math.max(1, Math.min(leaveRecordsCurrentPage, totalPages || 1));

    const startIndex = (leaveRecordsCurrentPage - 1) * recordsPerPage;
    const paginatedRecords = records.sort((a,b) => (b.createdDate?.toDate() || 0) - (a.createdDate?.toDate() || 0)).slice(startIndex, startIndex + recordsPerPage);

    paginatedRecords.forEach(r => {
        const user = users.find(u => u.nickname === r.userNickname) || {};
        const dateDisplay = r.startDate === r.endDate ? formatDateThaiShort(r.startDate) : `${formatDateThaiShort(r.startDate)} - ${formatDateThaiShort(r.endDate)}`;
        const sPeriod = r.startPeriod || r.period;
        const ePeriod = r.endPeriod || r.period;
        const leaveDays = calculateLeaveDays(r.startDate, r.endDate, sPeriod, ePeriod);
        
        tbody.innerHTML += `
        <tr class="border-b hover:bg-gray-50 cursor-pointer" onclick="showLeaveRecordDetailsModal('${r.id}')">
            <td class="px-4 py-3">${user.fullname || r.userNickname}</td>
            <td class="px-4 py-3">${user.nickname}</td>
            <td class="px-4 py-3"><span class="position-badge ${getPositionBadgeClass(user.position)}">${user.position}</span></td>
            <td class="px-4 py-3"><span class="font-semibold ${getLeaveTypeClass(r.leaveType)}">${r.leaveType}</span></td>
            <td class="px-4 py-3">${dateDisplay}</td>
            <td class="px-4 py-3">${leaveDays}</td>
            <td class="px-4 py-3">${r.approver}</td>
            <td class="px-4 py-3 font-semibold ${r.status === 'อนุมัติแล้ว' ? 'text-green-500' : 'text-yellow-500'}">${r.status}</td>
            <td class="px-4 py-3 flex items-center space-x-1">
                <button onclick="event.stopPropagation(); manageRecord('deleteLeave', '${r.id}')" class="p-2 rounded-full hover:bg-red-100 text-red-600" title="ลบ"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg></button>
            </td>
        </tr>`;
    });
    
    const pageInfo = document.getElementById('leave-page-info');
    const prevBtn = document.getElementById('leave-prev-btn');
    const nextBtn = document.getElementById('leave-next-btn');
    
    if(pageInfo) pageInfo.textContent = `หน้า ${leaveRecordsCurrentPage} / ${totalPages || 1}`;
    if(prevBtn) prevBtn.disabled = leaveRecordsCurrentPage === 1;
    if(nextBtn) nextBtn.disabled = leaveRecordsCurrentPage === totalPages || totalPages === 0;
}

window.showLeaveRecordDetailsModal = function(id) {
    const record = allLeaveRecords.find(r => r.id === id);
    if (!record) {
        return showErrorPopup('ไม่พบข้อมูลการลา');
    }

    const user = users.find(u => u.nickname === record.userNickname);
    if (!user) {
        return showErrorPopup('ไม่พบข้อมูลผู้ใช้');
    }

    const leaveDays = calculateLeaveDays(record.startDate, record.endDate, record.startPeriod, record.endPeriod);

    let combinedDatePeriodDisplay = '';
    if (record.startDate === record.endDate) {
        combinedDatePeriodDisplay = `${formatDateThaiShort(record.startDate)} (${record.startPeriod})`;
    } else {
        combinedDatePeriodDisplay = `${formatDateThaiShort(record.startDate)} (${record.startPeriod}) - ${formatDateThaiShort(record.endDate)} (${record.endPeriod})`;
    }

    const statusClass = record.status === 'อนุมัติแล้ว' ? 'text-green-500' : 'text-yellow-500';
    
    const leaveTypeClass = getLeaveTypeClass(record.leaveType);

    const modalHtml = `
        <div class="space-y-3 text-left p-4">
            <p><strong>ชื่อ-สกุล:</strong> ${user.fullname} (${user.nickname})</p>
            <p><strong>ตำแหน่ง:</strong> ${user.position}</p>
            <hr class="my-2">
            <p><strong>ประเภทการลา:</strong> <span class="font-semibold ${leaveTypeClass}">${record.leaveType}</span></p>
            <p><strong>วันที่ลา:</strong> ${combinedDatePeriodDisplay}</p>
            <p><strong>จำนวนวัน:</strong> ${leaveDays} วัน</p>
            <p><strong>ผู้อนุมัติ:</strong> ${record.approver || '-'}</p>
            <p><strong>สถานะ:</strong> <span class="font-semibold ${statusClass}">${record.status}</span></p>
            <p><strong>หมายเหตุ:</strong> ${record.note || '-'}</p>
            <hr class="my-2">
            <p class="text-xs text-gray-500"><strong>วันที่แจ้งลา:</strong> ${formatDateTimeThaiShort(record.createdDate)}</p>
        </div>
    `;

    Swal.fire({
        title: 'รายละเอียดการลา',
        html: modalHtml,
        confirmButtonText: 'ปิด',
        width: '500px'
    });
}

// --- USER & RECORD MANAGEMENT ---
window.changeHourlyPage = function(direction) {
    hourlyRecordsCurrentPage += direction;
    applyHourlyFiltersAndRender();
}
window.changeHourlySummaryPage = function(direction) {
    hourlySummaryCurrentPage += direction;
    applyHourlyFiltersAndRender();
}
window.changeLeavePage = function(direction) {
    leaveRecordsCurrentPage += direction;
    applyLeaveFiltersAndRender();
}
window.changeLeaveSummaryPage = function(direction) {
    leaveSummaryCurrentPage += direction;
    applyLeaveFiltersAndRender();
}
window.changeUserPage = function(direction) {
    usersCurrentPage += direction;
    applyUserFiltersAndRender();
}
        
window.editUser = async function(id) {
    const user = users.find(u => u.id === id);
    if (!user) {
        showErrorPopup('ไม่พบข้อมูลผู้ใช้');
        return;
    }

    const { value: formValues } = await Swal.fire({
        showConfirmButton: true,
        showCancelButton: true,
        confirmButtonText: 'อัปเดตข้อมูล',
        cancelButtonText: 'ยกเลิก',
        customClass: {
            popup: 'swal-edit-user-popup',
            confirmButton: 'btn-primary',
            cancelButton: 'btn-cancel',
        },
        html: `
            <div class="edit-user-header">
                <div class="edit-user-icon-wrapper">
                    <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                    </svg>
                </div>
                <h1 class="text-2xl font-semibold text-gray-800">แก้ไขข้อมูลผู้ใช้</h1>
            </div>
            <div class="edit-user-form">
                <div class="input-group">
                    <input type="text" id="swal-fullname" class="input-field" value="${user.fullname}" required>
                    <label for="swal-fullname" class="label-float">ชื่อ-สกุล</label>
                </div>
                <div class="input-group">
                    <input type="text" id="swal-nickname" class="input-field" value="${user.nickname}" required>
                    <label for="swal-nickname" class="label-float">ชื่อเล่น</label>
                </div>
                <div class="input-group">
                     <select id="swal-position" class="input-field">
                        <option value="เภสัช" ${user.position === 'เภสัช' ? 'selected' : ''}>เภสัช</option>
                        <option value="จพง" ${user.position === 'จพง' ? 'selected' : ''}>จพง</option>
                        <option value="จนท" ${user.position === 'จนท' ? 'selected' : ''}>จนท</option>
                    </select>
                    <label for="swal-position" class="label-float">ตำแหน่ง</label>
                </div>
            </div>
        `,
        didOpen: () => {
            const popup = Swal.getPopup();
            const inputGroups = popup.querySelectorAll('.input-group');
            inputGroups.forEach(group => {
                const input = group.querySelector('.input-field');
                
                const checkValue = () => {
                    if (input.value && input.value.trim() !== '') {
                        group.classList.add('has-value');
                    } else {
                        group.classList.remove('has-value');
                    }
                };

                checkValue();
                input.addEventListener('focus', () => group.classList.add('has-value'));
                input.addEventListener('blur', checkValue);
            });
        },
        preConfirm: () => {
            const fullname = document.getElementById('swal-fullname').value;
            const nickname = document.getElementById('swal-nickname').value;
            const position = document.getElementById('swal-position').value;

            if (!fullname.trim() || !nickname.trim()) {
                Swal.showValidationMessage(`กรุณากรอกข้อมูลให้ครบถ้วน`);
                return false;
            }

            const isNicknameTaken = users.some(u => u.id !== id && u.nickname === nickname);
            if (isNicknameTaken) {
                Swal.showValidationMessage(`ชื่อเล่น "${nickname}" นี้มีผู้ใช้อื่นแล้ว`);
                return false;
            }
            
            return { fullname, nickname, position };
        }
    });

    if (formValues) {
        const summaryHtml = `
            <p class="text-center"><b>กรุณายืนยันการแก้ไขข้อมูลสำหรับ</b></p>
            <p class="text-center font-semibold text-blue-600 text-lg">${user.nickname}</p>
        `;
        const isPinCorrect = await confirmWithUserPin(user.nickname, summaryHtml);

        if (isPinCorrect) {
            showLoadingPopup('กำลังบันทึก...');
            try {
                const userDocRef = doc(db, "users", id);
                await updateDoc(userDocRef, {
                    fullname: formValues.fullname,
                    nickname: formValues.nickname,
                    position: formValues.position
                });
                showSuccessPopup('อัปเดตข้อมูลสำเร็จ');
            } catch (error) {
                console.error("Error updating user:", error);
                showErrorPopup('เกิดข้อผิดพลาดในการอัปเดตข้อมูล');
            }
        }
    }
}

window.manageRecord = async function(action, id) {
    const isApprovalAction = action === 'approveLeave' || action === 'approveHourly';
    const isDeleteAction = action === 'deleteLeave' || action === 'deleteHourly';

    let record, recordCollectionName;

    // ค้นหาข้อมูลจาก ID ที่ส่งมา
    if (action.includes('Leave')) {
        record = allLeaveRecords.find(r => r.id === id);
        recordCollectionName = 'leaveRecords';
    } else if (action.includes('Hourly')) {
        record = allHourlyRecords.find(r => r.id === id);
        recordCollectionName = 'hourlyRecords';
    }

    if (!record) {
        return showErrorPopup('ไม่พบข้อมูลที่ต้องการจัดการ');
    }

    // --- ส่วนจัดการการลบ (Logic ใหม่) ---
    if (isDeleteAction) {
        let isApproved;
        let summaryHtml;
        let isPinCorrect = false;

        // ตรวจสอบสถานะการอนุมัติและสร้างข้อความสรุป
        if (action === 'deleteHourly') {
            isApproved = record.confirmed;
            const user = users.find(u => u.nickname === record.userNickname) || {};
            summaryHtml = `
                <p class="text-center"><b>ยืนยันการลบรายการลาชั่วโมงของ</b></p>
                <p class="text-center font-semibold text-blue-600 text-lg">${user.nickname}</p>
                <p><b>ประเภท:</b> ${record.type === 'leave' ? 'ลาชั่วโมง' : 'ใช้ชั่วโมง'}</p>
                <p><b>วันที่:</b> ${formatDateThaiShort(record.date)}</p>
            `;
        } else { // deleteLeave
            isApproved = record.status === 'อนุมัติแล้ว';
            const user = users.find(u => u.nickname === record.userNickname) || {};
            const leaveDays = calculateLeaveDays(record.startDate, record.endDate, record.startPeriod, record.endPeriod);
            const dateDisplay = record.startDate === record.endDate ? formatDateThaiShort(record.startDate) : `${formatDateThaiShort(record.startDate)} - ${formatDateThaiShort(record.endDate)}`;
            summaryHtml = `
                <p class="text-center"><b>ยืนยันการลบรายการลาของ</b></p>
                <p class="text-center font-semibold text-blue-600 text-lg">${user.fullname}</p>
                <p><b>ประเภท:</b> ${record.leaveType}</p>
                <p><b>วันที่:</b> ${dateDisplay} (${leaveDays} วัน)</p>
            `;
        }

        // --- ตรวจสอบเงื่อนไขและเรียกใช้ PIN ที่ถูกต้อง ---
        if (isApproved) {
            // ถ้าอนุมัติแล้ว ต้องใช้ PIN ของผู้อนุมัติ
            if (!record.approver) {
                return showErrorPopup('ไม่สามารถลบได้: ไม่พบข้อมูลผู้อนุมัติในรายการนี้');
            }
            isPinCorrect = await confirmWithAdminPin(record.approver, summaryHtml);
        } else {
            // ถ้ายังไม่ได้อนุมัติ ใช้ PIN ของผู้แจ้ง
            isPinCorrect = await confirmWithUserPin(record.userNickname, summaryHtml);
        }

        // ถ้า PIN ถูกต้อง ให้ดำเนินการลบ
        if (isPinCorrect) {
            showLoadingPopup('กำลังลบข้อมูล...');
            try {
                await deleteDoc(doc(db, recordCollectionName, id));
                showSuccessPopup('ลบข้อมูลสำเร็จ');
            } catch (error) {
                console.error("Error deleting record:", error);
                showErrorPopup('เกิดข้อผิดพลาดในการลบข้อมูล');
            }
        }
        return; // จบการทำงานในส่วนของการลบ
    }

    // --- ส่วนจัดการการอนุมัติ (Logic เดิม) ---
    if (isApprovalAction) {
        const approverUsername = record.approver;
        if (!approverUsername) return showErrorPopup('ไม่พบข้อมูลผู้อนุมัติในรายการนี้');

        let summaryHtml;
        if (action === 'approveLeave') {
            const user = users.find(u => u.nickname === record.userNickname) || {};
            const leaveDays = calculateLeaveDays(record.startDate, record.endDate, record.startPeriod, record.endPeriod);
            summaryHtml = `
                <p><strong>อนุมัติการลาของ:</strong> ${user.fullname || record.userNickname}</p>
                <p><strong>ประเภท:</strong> ${record.leaveType}</p>
                <p><strong>จำนวน:</strong> ${leaveDays} วัน</p>
            `;
        } else { // approveHourly
             const user = users.find(u => u.nickname === record.userNickname) || {};
             summaryHtml = `
                <p><strong>อนุมัติรายการของ:</strong> ${user.nickname}</p>
                <p><strong>ประเภท:</strong> ${record.type === 'leave' ? 'ลาชั่วโมง' : 'ใช้ชั่วโมง'}</p>
                <p><strong>เวลา:</strong> ${record.startTime} - ${record.endTime}</p>
            `;
        }

        const isPinCorrect = await confirmWithAdminPin(approverUsername, summaryHtml);
        if (!isPinCorrect) return;

        showLoadingPopup('กำลังอนุมัติ...');
        try {
            const recordDoc = doc(db, recordCollectionName, id);
            if (action === 'approveLeave') {
                await updateDoc(recordDoc, { status: 'อนุมัติแล้ว' });
            } else { // approveHourly
                await updateDoc(recordDoc, { confirmed: true });
            }
            showSuccessPopup('อนุมัติสำเร็จ');
            renderAdminDashboard(); // Re-render the dashboard immediately
        } catch(error) {
            console.error("Error approving record:", error);
            showErrorPopup('เกิดข้อผิดพลาดในการอนุมัติ: ' + error.message);
        }
    }
}

window.toggleCalendarFilter = function(type, btnElement) {
    if (type === 'fullDay') {
        showFullDayLeaveOnCalendar = !showFullDayLeaveOnCalendar;
    } else if (type === 'hourly') {
        showHourlyLeaveOnCalendar = !showHourlyLeaveOnCalendar;
    }
    // The new CSS in style.css will handle the color based on the 'active' class
    btnElement.classList.toggle('active');
    renderCalendar();
}

window.filterCalendarByPosition = function(position) {
    calendarPositionFilter = position;
    renderCalendar();
}


window.showHourlyDetailModal = function(id) {
    const record = allHourlyRecords.find(r => r.id === id);
    if (!record) return showErrorPopup('ไม่พบข้อมูล');

    const user = users.find(u => u.nickname === record.userNickname) || {};
    const durationText = formatHoursAndMinutes(record.duration);
    
    // --- START: โค้ดที่แก้ไข ---
// แสดงอีเวนต์บนช่องวัน (ในกริด) สูงสุด 3 รายการ พร้อมไอคอน ⏳ ถ้ายังไม่อนุมัติ
dayEventsHtml += (function() {
    let html = '';
    combinedEvents.slice(0, 3).forEach(event => {
        const user = users.find(u => u.nickname === event.userNickname);
        if (!user) return;

        const statusClass = getStatusClass(event);
        const pendingEmoji = statusClass === 'pending' ? '⏳ ' : '';

        if (event.leaveType) {
            // Full-day leave (แจ้งลา/ลาล่วงหน้า)
            const tagClass = leaveTypeToTagClass(event.leaveType);
            html += `<div class="calendar-event ${statusClass} ${tagClass}"
                        onclick="showLeaveDetailModal('${event.id || ''}')">
                        ${pendingEmoji}${user.nickname} (${event.leaveType})
                     </div>`;
        } else {
            // Hourly leave (ลาชั่วโมง/ใช้ชั่วโมง)
            const isLeaveHour = (event.type === 'leave');
            const label = isLeaveHour ? 'ลาชม.' : 'ใช้ชม.';
            html += `<div class="calendar-event ${statusClass}"
                        onclick="showHourlyDetailModal('${event.id || ''}')">
                        ${pendingEmoji}${user.nickname} (${label})
                     </div>`;
        }
    });

    if (combinedEvents.length > 3) {
        const more = combinedEvents.length - 3;
        html += `<div class="show-more-btn" onclick="showMoreEventsModal('${dateString}')">+${more} เพิ่มเติม</div>`;
    }
    return html;
})();
// --- END: โค้ดที่แก้ไข ---

    const html = `
        <div class="space-y-2 text-left p-2">
            <p><strong>ผู้บันทึก:</strong> ${user.fullname || record.userNickname}</p>
            <p><strong>ประเภท:</strong> ${typeHtml}</p>
            <hr class="my-2">
            <p><strong>วันที่:</strong> ${formatDateThaiShort(record.date)}</p>
            <p><strong>ช่วงเวลา:</strong> ${record.startTime} - ${record.endTime}</p>
            <p><strong>รวมเป็นเวลา:</strong> <span class="font-bold text-blue-600">${durationText}</span></p>
        </div>
    `;

    Swal.fire({
        title: 'รายละเอียดรายการ',
        html: html,
        confirmButtonText: 'ปิด'
    });
}

// --- CALENDAR RENDERING ---
window.changeCalendarView = function(view) {
    currentCalendarView = view;
    
    const viewText = { day: 'วัน', week: 'สัปดาห์', month: 'เดือน', year: 'ปี' };
    document.getElementById('current-view-text').textContent = viewText[view];

    const menuItems = document.querySelectorAll('#view-dropdown-menu a');
    menuItems.forEach(item => {
        item.classList.remove('bg-gray-100', 'font-semibold');
        if (item.textContent.trim() === viewText[view]) {
            item.classList.add('bg-gray-100', 'font-semibold');
        }
    });
    
    document.getElementById('view-dropdown-menu').classList.add('hidden');
    renderCalendar();
}

window.goToToday = function() {
    currentDate = new Date();
    renderCalendar();
}

window.navigateCalendar = function(direction) {
    if (currentCalendarView === 'month') {
        currentDate.setMonth(currentDate.getMonth() + direction);
    } else if (currentCalendarView === 'week') {
        currentDate.setDate(currentDate.getDate() + (7 * direction));
    } else if (currentCalendarView === 'day') {
        currentDate.setDate(currentDate.getDate() + direction);
    } else if (currentCalendarView === 'year') {
        currentDate.setFullYear(currentDate.getFullYear() + direction);
    }
    renderCalendar();
}

window.renderCalendar = function() {
    const container = document.getElementById('calendar-grid-container');
    if (!container) return;

    switch(currentCalendarView) {
        case 'day':
            renderDayView();
            break;
        case 'week':
            renderWeekView();
            break;
        case 'year':
            renderYearView();
            break;
        case 'month':
        default:
            renderMonthView();
            break;
    }
}

function renderMonthView() {
    const container = document.getElementById('calendar-grid-container');
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const today = new Date();
    document.getElementById('calendar-title').textContent = new Intl.DateTimeFormat('th-TH', {month: 'long', year: 'numeric'}).format(currentDate);
    
    container.innerHTML = `<div class="grid grid-cols-7 gap-1 text-center font-semibold text-gray-600 mb-2"><div>อา</div><div>จ</div><div>อ</div><div>พ</div><div>พฤ</div><div>ศ</div><div>ส</div></div><div id="calendar-grid" class="grid grid-cols-7 gap-1"></div>`;
    const calendarGrid = document.getElementById('calendar-grid');

    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    let gridHtml = '';

    // Days from previous month
    for (let i = 0; i < firstDayOfMonth; i++) {
        const day = daysInPrevMonth - firstDayOfMonth + 1 + i;
        gridHtml += `<div class="calendar-day other-month-day"><div>${day}</div></div>`;
    }

    // Days in current month
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dateString = toLocalISOString(date);
        const holidayName = holidays[dateString]; // <-- แก้ไขตรงนี้
        
        const isTodayClass = date.toDateString() === today.toDateString() ? 'today-day' : '';
        const isWeekendClass = (date.getDay() === 0 || date.getDay() === 6) ? 'weekend-day' : 'bg-white';
        const isHolidayClass = holidayName ? 'holiday-day' : ''; // <-- แก้ไขตรงนี้
        const dayNumberClass = holidayName ? 'text-red-700' : ''; // <-- แก้ไขตรงนี้

        let dayEventsHtml = '';

        if (holidayName) { // <-- แก้ไขตรงนี้
            dayEventsHtml += `<div class="holiday-event">${holidayName}</div>`; // <-- แก้ไขตรงนี้
        }
        
        let dayEvents = showFullDayLeaveOnCalendar ? allLeaveRecords.filter(r => {
            return dateString >= r.startDate && dateString <= r.endDate;
        }) : [];
        
        let hourlyDayEvents = showHourlyLeaveOnCalendar ? allHourlyRecords.filter(r => r.date === dateString) : [];

        if (calendarPositionFilter) {
            dayEvents = dayEvents.filter(event => {
                const user = users.find(u => u.nickname === event.userNickname);
                return user && user.position === calendarPositionFilter;
            });
            hourlyDayEvents = hourlyDayEvents.filter(event => {
                const user = users.find(u => u.nickname === event.userNickname);
                return user && user.position === calendarPositionFilter;
            });
        }
        
        const combinedEvents = [...dayEvents, ...hourlyDayEvents];

        // --- START: โค้ดที่แก้ไข ---
        combinedEvents.slice(0, 3).forEach(event => {
            const user = users.find(u => u.nickname === event.userNickname);
            if (user) {
                if (event.leaveType) { // Full-day leave
                    dayEventsHtml += `<div class="calendar-event ${getStatusClass(event)} ${getEventClass(event.leaveType)}" onclick="showLeaveDetailModal('${event.id}')">${user.nickname}(${user.position})-${event.leaveType}</div>`;
                } else { // Hourly leave
                    const dot = event.type === 'leave' ? '🔴' : '🟢';
                    const shortType = event.type === 'leave' ? 'ลาชม.' : 'ใช้ชม.';
                    dayEventsHtml += `<div class="calendar-event ${getStatusClass(event)} hourly-leave cursor-pointer" onclick="showHourlyDetailModal('${event.id}')">${dot} ${user.nickname} (${shortType})</div>`;
                }
            }
        });

        if (combinedEvents.length > 3) {
            dayEventsHtml += `<div class="show-more-btn" onclick="showMoreEventsModal('${dateString}')">+${combinedEvents.length - 3} เพิ่มเติม</div>`;
        }
        // --- END: โค้ดที่แก้ไข ---

        gridHtml += `
            <div class="calendar-day border p-2 min-h-[120px] flex flex-col ${isHolidayClass} ${isWeekendClass} ${isTodayClass}">
                <div class="current-month-day font-semibold text-sm mb-1 ${dayNumberClass}">${day}</div>
                ${dayEventsHtml}
            </div>`;
    }

    // Days from next month
    const totalCells = 42;
    const renderedCells = firstDayOfMonth + daysInMonth;
    const remainingCells = totalCells - renderedCells;
    for (let i = 1; i <= remainingCells; i++) {
        gridHtml += `<div class="calendar-day other-month-day"><div>${i}</div></div>`;
    }

    calendarGrid.innerHTML = gridHtml;
}

function renderDayView() {
    const container = document.getElementById('calendar-grid-container');
    document.getElementById('calendar-title').textContent = new Intl.DateTimeFormat('th-TH', {dateStyle: 'full'}).format(currentDate);
    container.innerHTML = ''; 
    const dayCard = createDayCard(currentDate, false);
    container.appendChild(dayCard);
}

function renderWeekView() {
    const container = document.getElementById('calendar-grid-container');
    const week = getWeekDays(currentDate);
    document.getElementById('calendar-title').textContent = `${formatDateThaiShort(week[0])} - ${formatDateThaiShort(week[6])}`;
    
    let gridHtml = '<div class="grid grid-cols-7 gap-1 text-center font-semibold text-gray-600 mb-2">';
    week.forEach(day => {
        const dayName = new Intl.DateTimeFormat('th-TH', { weekday: 'short' }).format(day);
        gridHtml += `<div>${dayName} ${day.getDate()}</div>`; // Show date number in header
    });
    gridHtml += '</div><div id="calendar-grid" class="grid grid-cols-7 gap-1"></div>';
    container.innerHTML = gridHtml;

    const calendarGrid = document.getElementById('calendar-grid');
    week.forEach(day => {
        // Create each day card with the corrected logic
        const dayCard = createDayCard(day, true);
        calendarGrid.appendChild(dayCard);
    });
}

function renderYearView() {
    const container = document.getElementById('calendar-grid-container');
    const year = currentDate.getFullYear();
    document.getElementById('calendar-title').textContent = `ปี ${year + 543}`;
    
    container.innerHTML = '<div class="year-grid"></div>';
    const yearGrid = container.querySelector('.year-grid');
    const today = new Date();
    const todayString = toLocalISOString(today);

    for (let month = 0; month < 12; month++) {
        const monthContainer = document.createElement('div');
        monthContainer.className = 'month-container';
        monthContainer.onclick = () => {
            currentDate = new Date(year, month, 1);
            changeCalendarView('month');
        };
        
        const monthDate = new Date(year, month, 1);
        const monthHeader = document.createElement('div');
        monthHeader.className = 'month-header';
        monthHeader.textContent = new Intl.DateTimeFormat('th-TH', { month: 'long' }).format(monthDate);
        monthContainer.appendChild(monthHeader);

        const weekDaysHeader = document.createElement('div');
        weekDaysHeader.className = 'week-days-header';
        ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].forEach(day => {
            const dayEl = document.createElement('div');
            dayEl.textContent = day;
            weekDaysHeader.appendChild(dayEl);
        });
        monthContainer.appendChild(weekDaysHeader);

        const daysGrid = document.createElement('div');
        daysGrid.className = 'days-grid';
        
        const firstDayOfMonth = monthDate.getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        
        for (let i = 0; i < firstDayOfMonth; i++) {
            daysGrid.innerHTML += '<div class="day-cell-mini"></div>';
        }
        
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dateString = toLocalISOString(date);
            
            const hasLeave = allLeaveRecords.some(r => {
                return dateString >= r.startDate && dateString <= r.endDate;
            });
            
            const dayCell = document.createElement('div');
            dayCell.className = 'day-cell-mini';
            if (dateString === todayString) {
                dayCell.classList.add('is-today-mini');
            } else if (hasLeave) {
                dayCell.classList.add('has-leave-mini');
            }
            dayCell.textContent = day;
            daysGrid.appendChild(dayCell);
        }
        
        monthContainer.appendChild(daysGrid);
        yearGrid.appendChild(monthContainer);
    }
}

function createDayCard(date, isWeekView = false) {
    const container = document.createElement('div');
    const dateString = toLocalISOString(date);

    // --- START: Added complete filtering logic ---
    let dayEvents = showFullDayLeaveOnCalendar ? allLeaveRecords.filter(r => {
        return dateString >= r.startDate && dateString <= r.endDate;
    }) : [];
    
    let hourlyDayEvents = showHourlyLeaveOnCalendar ? allHourlyRecords.filter(r => r.date === dateString) : [];

    if (calendarPositionFilter) {
        dayEvents = dayEvents.filter(event => {
            const user = users.find(u => u.nickname === event.userNickname);
            return user && user.position === calendarPositionFilter;
        });
        hourlyDayEvents = hourlyDayEvents.filter(event => {
            const user = users.find(u => u.nickname === event.userNickname);
            return user && user.position === calendarPositionFilter;
        });
    }
    // --- END: Added complete filtering logic ---

    const combinedEvents = [...dayEvents, ...hourlyDayEvents];

    let eventsHtml = '';
    if (combinedEvents.length > 0) {
        combinedEvents.forEach(event => {
            const user = users.find(u => u.nickname === event.userNickname);
            if (user) {
                // Harmonized the display format to match the month view
                if (event.leaveType) { // Full-day leave
                    eventsHtml += `<div class="calendar-event ${getStatusClass(event)} ${getEventClass(event.leaveType)}" onclick="showLeaveDetailModal('${event.id}')">${user.nickname}(${user.position})-${event.leaveType}</div>`;
                } else { // Hourly leave
                    const dot = event.type === 'leave' ? '🔴' : '🟢';
                    const shortType = event.type === 'leave' ? 'ลาชม.' : 'ใช้ชม.';
                    eventsHtml += `<div class="calendar-event ${getStatusClass(event)} hourly-leave cursor-pointer" onclick="showHourlyDetailModal('${event.id}')">${dot} ${user.nickname} (${shortType})</div>`;
                }
            }
        });
    } else {
        eventsHtml = isWeekView ? '' : '<div class="events-list empty">ไม่มีรายการลา</div>';
    }

    if (isWeekView) {
        container.className = `calendar-day border p-2 min-h-[120px] flex flex-col ${dateString === toLocalISOString(new Date()) ? 'today-day bg-white' : 'bg-white'}`;
        // Add a simple day number for context in week view
        const dayNumber = date.getDate();
        container.innerHTML = `<div class="text-sm text-gray-500 mb-1">${dayNumber}</div><div class="events-list">${eventsHtml}</div>`;
    } else { // Day view
        const dayName = new Intl.DateTimeFormat('th-TH', {weekday: 'long'}).format(date);
        const dateFormatted = new Intl.DateTimeFormat('th-TH', {dateStyle: 'long'}).format(date);
        container.innerHTML = `
            <div class="list-view-container">
                <div class="day-header">
                    <span class="day-header-date">${dateFormatted}</span>
                    <span class="day-header-day">${dayName}</span>
                </div>
                <div class="events-list">${eventsHtml}</div>
            </div>
        `;
    }
    return container;
}

function getWeekDays(date) {
    const startOfWeek = new Date(date);
    startOfWeek.setDate(date.getDate() - date.getDay());
    const week = [];
    for(let i=0; i<7; i++){
        const day = new Date(startOfWeek);
        day.setDate(startOfWeek.getDate() + i);
        week.push(day);
    }
    return week;
}

window.showMoreEventsModal = function(dateString) {
    const date = new Date(dateString + 'T00:00:00');

    const dayEvents = allLeaveRecords.filter(r => {
        const startDate = new Date(r.startDate + 'T00:00:00');
        const endDate = new Date(r.endDate + 'T00:00:00');
        return date >= startDate && date <= endDate;
    });

    const hourlyDayEvents = allHourlyRecords.filter(r => r.date === dateString);
    const combinedEvents = [...dayEvents, ...hourlyDayEvents];

    function leaveTypeToTagClass(leaveType) {
        const t = String(leaveType || '').trim();
        if (/พักผ่อน/i.test(t)) return 'modal-tag-green';       // Vacation
        if (/ป่วย/i.test(t))    return 'modal-tag-red';         // Sick
        if (/คลอด/i.test(t))    return 'modal-tag-pink';        // Maternity
        if (/กิจ/i.test(t))     return 'modal-tag-purple';      // Personal/Emergency
        return 'modal-tag-green'; // default
    }

    let eventsHtml = '<div class="space-y-2">';
    combinedEvents.forEach(event => {
        const user = users.find(u => u.nickname === event.userNickname);
        if (!user) return;

        const statusClass = getStatusClass(event);
        const pendingEmoji = statusClass === 'pending' ? '⏳ ' : '';

        if (event.leaveType) { // Full-day leave (แจ้งลา/ลาล่วงหน้า) => left strip GREEN + tag color by type
            const tagClass = leaveTypeToTagClass(event.leaveType);
            eventsHtml += `<div class="calendar-event ${statusClass} modal-left-green"
                            onclick="Swal.close(); showLeaveDetailModal('${event.id || ''}')">
                              <span class="modal-tag ${tagClass}">${pendingEmoji}${event.leaveType}</span>
                              &nbsp; ${user.nickname} (${user.position || ''})
                           </div>`;
        } else { // Hourly leave/use => left strip BLUE ; text + tag color by action
            const isLeaveHour = event.type === 'leave'; // true = ลาชั่วโมง, false = ใช้ชั่วโมง
            const label = isLeaveHour ? 'ลาชม.' : 'ใช้ชม.';
            const timeText = event.startTime && event.endTime ? ` (${event.startTime}-${event.endTime})` : '';
            const durObj = (event.startTime && event.endTime) ? calculateDuration(event.startTime, event.endTime) : { total: 0 };
            const durationText = durObj && durObj.total > 0 ? ` ${formatHoursAndMinutes(durObj.total)}` : '';
            const textClass = isLeaveHour ? 'hourly-text-red' : 'hourly-text-green';
            const tagClass  = isLeaveHour ? 'modal-tag-red'    : 'modal-tag-green';
            eventsHtml += `<div class="calendar-event ${statusClass} modal-left-blue"
                            onclick="Swal.close(); showHourlyDetailModal('${event.id || ''}')">
                              <span class="modal-tag ${tagClass}">${pendingEmoji}${label}</span>
                              &nbsp; <span class="${textClass}">${user.nickname}${user.position ? ' ('+user.position+')' : ''}${timeText}${durationText}</span>
                           </div>`;
        }
    });
    eventsHtml += '</div>';

    Swal.fire({
        title: `รายการลาทั้งหมดวันที่ ${formatDateThaiShort(date)}`,
        html: eventsHtml,
        confirmButtonText: 'ปิด',
        customClass: { htmlContainer: 'swal-left' } 
    });
};;;

window.showLeaveDetailModal = function(id) {
    const record = allLeaveRecords.find(r => r.id === id);
    if (!record) return;
    const user = users.find(u => u.nickname === record.userNickname);
    if (!user) return;

    const sPeriod = record.startPeriod || record.period;
    const ePeriod = record.endPeriod || record.period;
    const leaveDays = calculateLeaveDays(record.startDate, record.endDate, sPeriod, ePeriod);
    
    let dateDisplay;
    if (record.startDate === record.endDate) {
        dateDisplay = `${formatDateThaiShort(record.startDate)} (${sPeriod})`;
    } else {
        dateDisplay = `${formatDateThaiShort(record.startDate)} (${sPeriod}) - ${formatDateThaiShort(record.endDate)} (${ePeriod})`;
    }

    const html = `
        <div class="space-y-1">
            <p><b>ชื่อ-สกุล:</b> ${user.fullname}</p>
            <p><b>ชื่อเล่น:</b> ${user.nickname}</p>
            <p><b>ตำแหน่ง:</b> ${user.position}</p>
            <p><b>ประเภทการลา:</b> ${record.leaveType}</p>
            <p><b>วันที่ลา:</b> ${dateDisplay}</p>
            <p><b>จำนวนวันลา:</b> ${leaveDays} วัน</p>
            <p><b>ผู้อนุมัติ:</b> ${record.approver}</p>
        </div>
    `;
    Swal.fire({
        title: 'รายละเอียดการลา',
        html: html,
        showCancelButton: true,
        confirmButtonText: 'ปิด',
        cancelButtonText: 'แก้ไขรายการ'
    }).then((result) => {
        if (result.dismiss === Swal.DismissReason.cancel) {
            editLeaveRecord(id);
        }
    });
}


function getEventClass(leaveType) {
    if (leaveType.includes('ป่วย')) return 'sick-leave'; if (leaveType.includes('พักผ่อน')) return 'vacation-leave';
    if (leaveType.includes('กิจ')) return 'personal-leave'; if (leaveType.includes('คลอด')) return 'maternity-leave';
    return 'personal-leave';
}
window.previousMonth = function() { currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar(); }
window.nextMonth = function() { currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(); }


// === Click empty day cell to open "all events for that day" (added) ===
document.addEventListener('click', function(e){
    const grid = document.getElementById('calendar-grid');
    if (!grid || !grid.contains(e.target)) return;
    // Detect clicks on existing event items or "show more" to avoid double handling
    if (e.target.closest('.calendar-event') || e.target.closest('.show-more-btn') || e.target.closest('button')) return;
    const cell = e.target.closest('.calendar-day');
    if (!cell || cell.classList.contains('other-month-day')) return;
    // The first child div usually contains the day number
    let dayNumberEl = cell.querySelector(':scope > div');
    let dayNum = dayNumberEl ? parseInt(dayNumberEl.textContent.trim(), 10) : NaN;
    if (!dayNum || isNaN(dayNum)) return;
    const dateObj = new Date(currentDate.getFullYear(), currentDate.getMonth(), dayNum);
    const dateString = toLocalISOString(dateObj);
    try { showMoreEventsModal(dateString); } catch(_) {}
});


// ========== START: ฟังก์ชันสำหรับ Backup ข้อมูล (เวอร์ชันล่าสุด) ==========
async function exportAllDataToExcel() {
    showLoadingPopup('กำลังเตรียมข้อมูล...');

    try {
        // --- 1. เตรียมข้อมูลผู้ใช้ ---
        const usersData = users.map(u => ({
            'ชื่อ-สกุล': u.fullname,
            'ชื่อเล่น': u.nickname,
            'ตำแหน่ง': u.position
        }));

        // --- 2. เตรียมข้อมูลการลาเต็มวัน (Leave Records) ---
        const leaveRecordsData = allLeaveRecords.map(r => {
            const user = users.find(u => u.nickname === r.userNickname) || {};
            const leaveDays = calculateLeaveDays(r.startDate, r.endDate, r.startPeriod, r.endPeriod);

            return {
                'ปีงบประมาณ': r.fiscalYear,
                'วันที่บันทึก': r.createdDate ? new Date(r.createdDate.seconds * 1000) : 'N/A',
                'ชื่อ-สกุล': user.fullname || r.userNickname,
                'ชื่อเล่น': user.nickname || r.userNickname,
                'ตำแหน่ง': user.position || 'N/A',
                'ประเภทการลา': r.leaveType,
                'วันลาเริ่มต้น': r.startDate,
                'วันลาสิ้นสุด': r.endDate,
                'ช่วงเวลาเริ่มต้น': r.startPeriod,
                'ช่วงเวลาสิ้นสุด': r.endPeriod,
                'จำนวนวันลา': leaveDays,
                'สถานะ': r.status,
                'ผู้อนุมัติ': r.approver
            };
        }).sort((a, b) => b['วันที่บันทึก'] - a['วันที่บันทึก']);

        // --- 3. เตรียมข้อมูลการลาชั่วโมง (Hourly Records) ---
        const hourlyRecordsData = allHourlyRecords.map(r => {
            const user = users.find(u => u.nickname === r.userNickname) || {};
            return {
                'ปีงบประมาณ': r.fiscalYear,
                'วันที่บันทึก': r.timestamp ? new Date(r.timestamp.seconds * 1000) : 'N/A',
                'ชื่อ-สกุล': user.fullname || r.userNickname,
                'ชื่อเล่น': user.nickname || r.userNickname,
                'ตำแหน่ง': user.position || 'N/A',
                'ประเภทรายการ': r.type === 'leave' ? 'ลาชั่วโมง' : 'ใช้ชั่วโมง',
                'วันที่': r.date,
                'เวลาเริ่มต้น': r.startTime,
                'เวลาสิ้นสุด': r.endTime,
                'ระยะเวลา (ชม.)': r.duration,
                'สถานะ': r.confirmed ? 'อนุมัติแล้ว' : 'รออนุมัติ',
                'ผู้อนุมัติ': r.approver
            };
        }).sort((a, b) => b['วันที่บันทึก'] - a['วันที่บันทึก']);
        
        // --- 4. เตรียมข้อมูลสรุปชั่วโมง ---
        const fiscalYear = getCurrentFiscalYear();
        const summaryMap = {};
        users.forEach(u => {
            summaryMap[u.nickname] = { nickname: u.nickname, fullname: u.fullname, position: u.position, leaveHours: 0, usedHours: 0 };
        });
        allHourlyRecords.forEach(r => {
            if (r.fiscalYear === fiscalYear && summaryMap[r.userNickname] && r.confirmed) {
                if (r.type === 'leave') summaryMap[r.userNickname].leaveHours += r.duration || 0;
                else if (r.type === 'use') summaryMap[r.userNickname].usedHours += r.duration || 0;
            }
        });
        const summaryData = Object.values(summaryMap).map(item => ({
            'ชื่อเล่น': item.nickname,
            'ตำแหน่ง': item.position,
            'ชั่วโมงที่ลา (อนุมัติ)': item.leaveHours,
            'ชั่วโมงที่ใช้ (อนุมัติ)': item.usedHours,
            'คงเหลือ (ชม.)': item.usedHours - item.leaveHours,
            'สถานะ': (item.usedHours - item.leaveHours) >= 0 ? 'ปกติ' : 'ติดลบ'
        })).sort((a,b) => a['คงเหลือ (ชม.)'] - b['คงเหลือ (ชม.)']);


        // --- 5. สร้าง Workbook และ Worksheets ---
        const wb = XLSX.utils.book_new();
        const wsUsers = XLSX.utils.json_to_sheet(usersData);
        const wsLeaveRecords = XLSX.utils.json_to_sheet(leaveRecordsData);
        const wsHourlyRecords = XLSX.utils.json_to_sheet(hourlyRecordsData);
        const wsSummary = XLSX.utils.json_to_sheet(summaryData);

        const fitToColumn = (data) => {
            if (!data || data.length === 0) return [];
            const columnWidths = [];
            for (const key in data[0]) {
                columnWidths.push({ wch: Math.max(key.length, ...data.map(row => (row[key] || '').toString().length)) + 2 });
            }
            return columnWidths;
        };
        wsUsers['!cols'] = fitToColumn(usersData);
        wsLeaveRecords['!cols'] = fitToColumn(leaveRecordsData);
        wsHourlyRecords['!cols'] = fitToColumn(hourlyRecordsData);
        wsSummary['!cols'] = fitToColumn(summaryData);

        XLSX.utils.book_append_sheet(wb, wsSummary, `สรุปชั่วโมงปีงบ ${fiscalYear}`);
        XLSX.utils.book_append_sheet(wb, wsHourlyRecords, 'ข้อมูลลาชั่วโมงทั้งหมด');
        XLSX.utils.book_append_sheet(wb, wsLeaveRecords, 'ข้อมูลการลาทั้งหมด');
        XLSX.utils.book_append_sheet(wb, wsUsers, 'รายชื่อผู้ใช้');

        // --- 6. สร้างไฟล์และดาวน์โหลด ---
        const today = toLocalISOStringInThailand(new Date());
        const filename = `leave-opd-backup-${today}.xlsx`;
        XLSX.writeFile(wb, filename);

        // ปิดหน้าต่าง "กำลังโหลด" หลังจากดาวน์โหลดไฟล์สำเร็จ
        Swal.close();

    } catch (error) {
        console.error("Backup failed:", error);
        showErrorPopup('การ Backup ข้อมูลล้มเหลว');
    }
}
// ========== END: ฟังก์ชันสำหรับ Backup ข้อมูล (เวอร์ชันล่าสุด) ==========


// ========== START: ฟังก์ชันใหม่สำหรับ Admin Dashboard ==========
function renderAdminDashboard() {
    const today = new Date();
    const todayString = toLocalISOStringInThailand(today);
    document.getElementById('today-date-display').textContent = formatDateThaiShort(today);

    // Populate approver filter dropdown if it's empty
    const approverFilterEl = document.getElementById('pending-approver-filter');
    if (approverFilterEl && approverFilterEl.options.length <= 1) {
        approverFilterEl.innerHTML = '<option value="all">Admin ทั้งหมด</option>';
        admins.forEach(admin => {
            const option = document.createElement('option');
            option.value = admin.username;
            option.textContent = admin.username;
            approverFilterEl.appendChild(option);
        });
    }
    approverFilterEl.value = pendingApproverFilter;

    // 1. Filter pending requests based on current filters
    let allPending = [];
    if (pendingFilterType === 'all' || pendingFilterType === 'leave') {
        allPending.push(...allLeaveRecords.filter(r => r.status === 'รออนุมัติ'));
    }
    if (pendingFilterType === 'all' || pendingFilterType === 'hourly') {
        allPending.push(...allHourlyRecords.filter(r => !r.confirmed));
    }

    if (pendingApproverFilter !== 'all') {
        allPending = allPending.filter(r => r.approver === pendingApproverFilter);
    }

    allPending.sort((a, b) => {
        const dateA = a.createdDate?.seconds || a.timestamp?.seconds || 0;
        const dateB = b.createdDate?.seconds || b.timestamp?.seconds || 0;
        return dateB - dateA;
    });

    // 2. Find who is on leave today (no changes here)
    const onLeaveToday = allLeaveRecords.filter(r => todayString >= r.startDate && todayString <= r.endDate && r.status === 'อนุมัติแล้ว');
    const onHourlyLeaveToday = allHourlyRecords.filter(r => r.date === todayString && r.confirmed);
    const allOnLeaveToday = [...onLeaveToday, ...onHourlyLeaveToday];

    // 3. Update pending count
    document.getElementById('pending-count').textContent = allPending.length;

    // 4. Render pending requests list with new features
    const pendingListEl = document.getElementById('pending-requests-list');
    if (allPending.length === 0) {
        pendingListEl.innerHTML = `<div class="db-list-placeholder">ไม่มีรายการที่รออนุมัติ</div>`;
    } else {
        pendingListEl.innerHTML = allPending.map(r => {
            const user = users.find(u => u.nickname === r.userNickname) || {};
            let title, meta, approveType, deleteType, recordType, recordId = r.id;

            if (r.leaveType) { // Full-day leave
                title = `${user.fullname}(${user.nickname})-${user.position}: ${r.leaveType}`;
                const days = calculateLeaveDays(r.startDate, r.endDate, r.startPeriod, r.endPeriod);
                meta = `${formatDateThaiShort(r.startDate)} - ${formatDateThaiShort(r.endDate)} (${days} วัน)`;
                approveType = 'approveLeave';
                deleteType = 'deleteLeave';
                recordType = 'leave';
            } else { // Hourly leave
                const typeText = r.type === 'leave' ? 'ลาชั่วโมง' : 'ใช้ชั่วโมง';
                title = `${user.fullname}(${user.nickname})-${user.position}: ${typeText}`;
                meta = `${formatDateThaiShort(r.date)} (${r.startTime} - ${r.endTime})`;
                approveType = 'approveHourly';
                deleteType = 'deleteHourly';
                recordType = 'hourly';
            }

            return `
            <div class="db-list-item cursor-pointer" onclick="openPendingDetail('${recordType}','${recordId}')">
                <div class="db-list-item-selector">
                    <input type="checkbox" class="pending-checkbox h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" data-id="${recordId}" data-type="${recordType}" onchange="updateBatchApproveButtonState()">
                </div>
                <div class="db-list-item-content">
                    <p>${title}</p>
                    <span class="meta">ผู้อนุมัติ: ${r.approver} | ${meta}</span>
                </div>
                <div class="db-list-item-actions">
                    <button onclick="manageRecord('${approveType}', '${recordId}')" class="approve-btn text-green-600" title="อนุมัติ">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </button>
                    <button onclick="manageRecord('${deleteType}', '${recordId}')" class="delete-btn text-red-600" title="ปฏิเสธ/ลบ">
                         <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </button>
                </div>
            </div>`;
        }).join('');
    }
    
    // Reset select all checkbox and batch button
    document.getElementById('select-all-pending').checked = false;
    updateBatchApproveButtonState();

    // 5. Render "who is on leave today" list
    const todayListEl = document.getElementById('today-on-leave-list');
    if (allOnLeaveToday.length === 0) {
        todayListEl.innerHTML = `<div class="db-list-placeholder">ไม่มีบุคลากรที่ลาในวันนี้</div>`;
    } else {
        todayListEl.innerHTML = allOnLeaveToday.map(r => {
            const user = users.find(u => u.nickname === r.userNickname) || {};
            let title, meta;

            if (r.leaveType) {
                title = `${user.nickname} (${user.position})`;
                meta = `${r.leaveType} (${r.startPeriod})`;
            } else {
                const typeText = r.type === 'leave' ? 'ลาชม.' : 'ใช้ชม.';
                title = `${user.nickname} (${user.position})`;
                meta = `${typeText} (${r.startTime} - ${r.endTime})`;
            }
            
            return `
            <div class="db-list-item">
                <div class="db-list-item-content">
                    <p>${title}</p>
                    <span class="meta">${meta}</span>
                </div>
            </div>`;
        }).join('');
    }
}


window.updateBatchApproveButtonState = function() {
    const selectedCount = document.querySelectorAll('.pending-checkbox:checked').length;
    const btn = document.getElementById('batch-approve-btn');
    btn.disabled = selectedCount === 0;
}

async function handleBatchApprove() {
    const selectedCheckboxes = document.querySelectorAll('.pending-checkbox:checked');
    if (selectedCheckboxes.length === 0) return;

    const { value: adminUsername } = await Swal.fire({
        title: `อนุมัติ ${selectedCheckboxes.length} รายการ`,
        input: 'select',
        inputOptions: Object.fromEntries(admins.map(admin => [admin.username, admin.username])),
        inputPlaceholder: 'เลือกชื่อผู้อนุมัติ',
        showCancelButton: true,
        confirmButtonText: 'ต่อไป',
        cancelButtonText: 'ยกเลิก',
        inputValidator: (value) => {
            return new Promise((resolve) => {
                if (value) {
                    resolve();
                } else {
                    resolve('กรุณาเลือกชื่อผู้อนุมัติ');
                }
            });
        }
    });

    if (adminUsername) {
        const isPinCorrect = await confirmWithAdminPin(adminUsername, `<p>ยืนยันการอนุมัติ <b>${selectedCheckboxes.length}</b> รายการที่เลือก</p>`);
        if (!isPinCorrect) return;

        showLoadingPopup(`กำลังอนุมัติ ${selectedCheckboxes.length} รายการ...`);
        const updatePromises = [];
        selectedCheckboxes.forEach(checkbox => {
            const { id, type } = checkbox.dataset;
            if (type === 'leave') {
                updatePromises.push(updateDoc(doc(db, "leaveRecords", id), { status: 'อนุมัติแล้ว' }));
            } else if (type === 'hourly') {
                updatePromises.push(updateDoc(doc(db, "hourlyRecords", id), { confirmed: true }));
            }
        });

        try {
            await Promise.all(updatePromises);
            showSuccessPopup(`อนุมัติ ${selectedCheckboxes.length} รายการสำเร็จ`);
            renderAdminDashboard(); // Re-render the dashboard immediately
        } catch (error) {
            console.error("Batch approve failed: ", error);
            showErrorPopup('เกิดข้อผิดพลาดในการอนุมัติ');
        }
    }
}
// ========== END: ฟังก์ชันใหม่สำหรับ Admin Dashboard ==========

// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(registration => {
        console.log('✅ Service Worker registered with scope:', registration.scope);
      })
      .catch(error => {
        console.error('❌ Service Worker registration failed:', error);
      });
  });
}




// --- Added: open pending item detail from Admin Dashboard ---
window.openPendingDetail = function(type, id) {
    try {
        if (type === 'leave') {
            if (typeof showLeaveDetailModal === 'function') {
                showLeaveDetailModal(id);
            } else {
                console.warn('showLeaveDetailModal not found');
            }
        } else {
            if (typeof showHourlyDetailModal === 'function') {
                showHourlyDetailModal(id);
            } else {
                console.warn('showHourlyDetailModal not found');
            }
        }
    } catch (e) {
        console.error('openPendingDetail error', e);
    }
};

// --- Added: edit leave record flow for Admin (requires admin PIN verification) ---
window.editLeaveRecord = async function(id) {
    try {
        const record = allLeaveRecords.find(r => r.id === id);
        if (!record) return showErrorPopup('ไม่พบข้อมูลสำหรับแก้ไข');

        const user = users.find(u => u.nickname === record.userNickname) || {};
        const dateDisplay = record.startDate === record.endDate ? formatDateThaiShort(record.startDate) : (formatDateThaiShort(record.startDate) + ' - ' + formatDateThaiShort(record.endDate));

        const { value: formValues } = await Swal.fire({
            title: 'แก้ไขรายการลา',
            html: `
                <div style="text-align:left">
                    <label class="swal-left">ผู้ลา</label>
                    <input id="edit-user-nickname" class="swal2-input" value="${record.userNickname}" readonly>
                    <label class="swal-left">ประเภทการลา</label>
                    <select id="edit-leave-type" class="swal2-select">
                        <option value="ลาป่วย" ${record.leaveType === 'ลาป่วย' ? 'selected' : ''}>ลาป่วย</option>
                        <option value="ลากิจ" ${record.leaveType === 'ลากิจ' ? 'selected' : ''}>ลากิจ</option>
                        <option value="ลาพักผ่อน" ${record.leaveType === 'ลาพักผ่อน' ? 'selected' : ''}>ลาพักผ่อน</option>
                        <option value="ลาคลอด" ${record.leaveType === 'ลาคลอด' ? 'selected' : ''}>ลาคลอด</option>
                    </select>
                    <label class="swal-left">วันที่เริ่ม</label>
                    <input id="edit-start-date" type="date" class="swal2-input" value="${record.startDate}">
                    <label class="swal-left">วันที่สิ้นสุด</label>
                    <input id="edit-end-date" type="date" class="swal2-input" value="${record.endDate}">
                    <label class="swal-left">ช่วงเริ่ม</label>
                    <select id="edit-start-period" class="swal2-select">
                        <option ${record.startPeriod === 'เต็มวัน' ? 'selected' : ''}>เต็มวัน</option>
                        <option ${record.startPeriod === 'ครึ่งวัน-เช้า' ? 'selected' : ''}>ครึ่งวัน-เช้า</option>
                        <option ${record.startPeriod === 'ครึ่งวัน-บ่าย' ? 'selected' : ''}>ครึ่งวัน-บ่าย</option>
                    </select>
                    <label class="swal-left">ช่วงสิ้นสุด</label>
                    <select id="edit-end-period" class="swal2-select">
                        <option ${record.endPeriod === 'เต็มวัน' ? 'selected' : ''}>เต็มวัน</option>
                        <option ${record.endPeriod === 'ครึ่งวัน-เช้า' ? 'selected' : ''}>ครึ่งวัน-เช้า</option>
                        <option ${record.endPeriod === 'ครึ่งวัน-บ่าย' ? 'selected' : ''}>ครึ่งวัน-บ่าย</option>
                    </select>
                    <label class="swal-left">ผู้อนุมัติ</label>
                    <input id="edit-approver" class="swal2-input" value="${record.approver || ''}">
                    <label class="swal-left">หมายเหตุ</label>
                    <textarea id="edit-note" class="swal2-textarea">${record.note || ''}</textarea>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'บันทึก',
            cancelButtonText: 'ยกเลิก',
            preConfirm: () => {
                return {
                    userNickname: document.getElementById('edit-user-nickname').value,
                    leaveType: document.getElementById('edit-leave-type').value,
                    startDate: document.getElementById('edit-start-date').value,
                    endDate: document.getElementById('edit-end-date').value,
                    startPeriod: document.getElementById('edit-start-period').value,
                    endPeriod: document.getElementById('edit-end-period').value,
                    approver: document.getElementById('edit-approver').value,
                    note: document.getElementById('edit-note').value
                };
            }
        });

        if (!formValues) return;

        // require admin PIN of the approver (if approver exists) OR require any admin PIN if approver missing
        const adminToCheck = formValues.approver || record.approver || (admins[0] && admins[0].username) || null;
        if (!adminToCheck) {
            return showErrorPopup('ไม่พบผู้อนุมัติในระบบ กรุณากำหนดผู้อนุมัติก่อนแก้ไข');
        }

        const confirmHtml = `
            <p>ยืนยันการแก้ไขรายการของ: <b>${user.fullname || record.userNickname}</b></p>
            <p>ประเภท: ${formValues.leaveType}</p>
            <p>ช่วงวันที่: ${formValues.startDate} - ${formValues.endDate}</p>
        `;

        const isPinCorrect = await confirmWithAdminPin(adminToCheck, confirmHtml);
        if (!isPinCorrect) return;

        showLoadingPopup('กำลังบันทึกการแก้ไข...');
        try {
            const recordDoc = doc(db, 'leaveRecords', id);
            await updateDoc(recordDoc, {
                leaveType: formValues.leaveType,
                startDate: formValues.startDate,
                endDate: formValues.endDate,
                startPeriod: formValues.startPeriod,
                endPeriod: formValues.endPeriod,
                approver: formValues.approver || null,
                note: formValues.note || ''
            });
            showSuccessPopup('บันทึกการแก้ไขสำเร็จ');
            renderAdminDashboard();
        } catch (err) {
            console.error('Error updating leave record', err);
            showErrorPopup('เกิดข้อผิดพลาดขณะบันทึก');
        }

    } catch (e) {
        console.error('editLeaveRecord error', e);
        showErrorPopup('เกิดข้อผิดพลาด');
    }
};



/* --- New showHourlyDetailModal (Enhanced UI) --- */
window.showHourlyDetailModal = function(id) {
    const record = allHourlyRecords.find(r => r.id === id);
    if (!record) return showErrorPopup('ไม่พบข้อมูล');

    const user = users.find(u => u.nickname === record.userNickname) || {};
    const durationText = formatHoursAndMinutes(record.duration);
    const label = record.type === 'leave' ? 'ลาชั่วโมง' : 'ใช้ชั่วโมง';
    const tagClass = record.type === 'leave' ? 'modal-tag-red' : 'modal-tag-green';
    const textClass = record.type === 'leave' ? 'hourly-text-red' : 'hourly-text-green';

    const modalHtml = `
        <div class="space-y-3 text-left p-4">
            <p><strong>ชื่อ-สกุล:</strong> ${user.fullname} (${user.nickname})</p>
            <p><strong>ตำแหน่ง:</strong> ${user.position || '-'}</p>
            <hr class="my-2">
            <p><strong>ประเภท:</strong> <span class="modal-tag ${tagClass}">${label}</span></p>
            <p><strong>วันที่:</strong> ${formatDateThaiShort(record.date)}</p>
            <p><strong>ช่วงเวลา:</strong> ${record.startTime} - ${record.endTime}</p>
            <p><strong>รวม:</strong> <span class="${textClass}">${durationText}</span></p>
            <p><strong>ผู้อนุมัติ:</strong> ${record.approver || '-'}</p>
            <p><strong>สถานะ:</strong> 
                <span class="font-semibold ${record.confirmed ? 'text-green-600' : 'text-yellow-500'}">
                    ${record.confirmed ? 'อนุมัติแล้ว' : 'รออนุมัติ'}
                </span>
            </p>
            <p><strong>หมายเหตุ:</strong> ${record.note || '-'}</p>
            <hr class="my-2">
            <p class="text-xs text-gray-500"><strong>วันที่แจ้ง:</strong> 
                ${record.createdDate ? formatDateTimeThaiShort(record.createdDate) : '-'}
            </p>
        </div>
    `;

    Swal.fire({
        title: 'รายละเอียดลาชั่วโมง',
        html: modalHtml,
        width: '480px',
        showCancelButton: true,
        confirmButtonText: 'ปิด',
        cancelButtonText: 'แก้ไขรายการ'
    }).then((result) => {
        if (result.dismiss === Swal.DismissReason.cancel) {
            editHourlyRecord(id);
        }
    });
};



/* --- Enhanced UI editHourlyRecord --- */
window.editHourlyRecord = async function(id) {
    const record = allHourlyRecords.find(r => r.id === id);
    if (!record) return showErrorPopup('ไม่พบข้อมูล');

    const { value: form } = await Swal.fire({
        title: 'แก้ไขลาชั่วโมง',
        width: '600px',
        html: `
            <style>
                .form-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:10px; text-align:left; }
                .form-grid-full { grid-column: span 2; }
                .swal-label { font-weight:600; font-size:14px; margin-bottom:3px; display:block; }
                .swal-input { width:100%; padding:8px 10px; border:1px solid #ccc; border-radius:6px; }
                textarea.swal-input { height:70px; resize:none; }
            </style>
            <div class="form-grid">
                <div class="form-grid-full">
                    <label class="swal-label">ผู้ลา</label>
                    <input class="swal-input" value="${record.userNickname}" readonly>
                </div>
                <div>
                    <label class="swal-label">วันที่</label>
                    <input id="eh-date" type="date" class="swal-input" value="${record.date}">
                </div>
                <div>
                    <label class="swal-label">ประเภท</label>
                    <select id="eh-type" class="swal-input">
                        <option value="leave" ${record.type==='leave'?'selected':''}>ลาชั่วโมง</option>
                        <option value="use" ${record.type==='use'?'selected':''}>ใช้ชั่วโมง</option>
                    </select>
                </div>
                <div>
                    <label class="swal-label">เวลาเริ่ม</label>
                    <input id="eh-start" type="time" class="swal-input" value="${record.startTime}">
                </div>
                <div>
                    <label class="swal-label">เวลาสิ้นสุด</label>
                    <input id="eh-end" type="time" class="swal-input" value="${record.endTime}">
                </div>
                <div class="form-grid-full">
                    <label class="swal-label">ผู้อนุมัติ</label>
                    <input id="eh-apr" class="swal-input" value="${record.approver || ''}">
                </div>
                <div class="form-grid-full">
                    <label class="swal-label">หมายเหตุ</label>
                    <textarea id="eh-note" class="swal-input">${record.note || ''}</textarea>
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'บันทึก',
        cancelButtonText: 'ยกเลิก',
        preConfirm: () => {
            return {
                date: document.getElementById('eh-date').value,
                type: document.getElementById('eh-type').value,
                startTime: document.getElementById('eh-start').value,
                endTime: document.getElementById('eh-end').value,
                approver: document.getElementById('eh-apr').value,
                note: document.getElementById('eh-note').value
            };
        }
    });

    if (!form) return;

    if (!await confirmWithAdminPin(form.approver, '<p>ยืนยันการแก้ไขลาชั่วโมง</p>')) return;

    await updateDoc(doc(db, "hourlyRecords", id), form);
    showSuccessPopup('อัปเดตสำเร็จ');
    renderAdminDashboard();
};


// --- Backup JSON modal control and download functions ---
window.openBackupMenu = function() {
    const m = document.getElementById('backup-modal');
    if (m) m.classList.remove('hidden');
};
window.closeBackupMenu = function() {
    const m = document.getElementById('backup-modal');
    if (m) m.classList.add('hidden');
};

window.downloadHourlyJSON = function() {
    try {
        const data = Array.isArray(allHourlyRecords) ? allHourlyRecords.map(r => ({
            userNickname: r.userNickname,
            type: r.type,
            date: r.date,
            startTime: r.startTime,
            endTime: r.endTime,
            duration: r.duration,
            approver: r.approver || '',
            confirmed: !!r.confirmed,
            fiscalYear: r.fiscalYear,
            note: r.note || ''
        })) : [];
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'backup_hourly_leave.json';
        a.click();
        URL.revokeObjectURL(a.href);
    } catch (e) {
        console.error('downloadHourlyJSON error', e);
        showErrorPopup('ไม่สามารถสร้างไฟล์ JSON ลาชั่วโมงได้');
    }
};

window.downloadNormalLeaveJSON = function() {
    try {
        const data = Array.isArray(allLeaveRecords) ? allLeaveRecords.map(r => ({
            userNickname: r.userNickname,
            leaveType: r.leaveType,
            startDate: r.startDate,
            endDate: r.endDate,
            startPeriod: r.startPeriod || r.period || 'เต็มวัน',
            endPeriod: r.endPeriod || r.period || 'เต็มวัน',
            approver: r.approver || '',
            status: r.status || '',
            fiscalYear: r.fiscalYear,
            note: r.note || ''
        })) : [];
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'backup_full_day_leave.json';
        a.click();
        URL.revokeObjectURL(a.href);
    } catch (e) {
        console.error('downloadNormalLeaveJSON error', e);
        showErrorPopup('ไม่สามารถสร้างไฟล์ JSON การลาปกติได้');
    }
};



/* === Robust UI handlers added by assistant === */

/**
 * Show person's hourly history in a modal.
 * Looks for fields: date, hourlyType, startTime, endTime, approver, note, confirmed
 */
window.showPersonHourlyHistory = function(nickname) {
    const records = (window.allHourlyRecords || []).filter(r => (r.nickname || '').toString() === nickname);
    if (!records || records.length === 0) {
        Swal.fire('ไม่มีประวัติ', `ไม่พบข้อมูลของ ${nickname}`, 'info');
        return;
    }
    const sorted = records.slice().sort((a,b) => new Date(b.date) - new Date(a.date));
    let html = '<div style="max-height:420px; overflow-y:auto; text-align:left;">';
    sorted.forEach(r=>{
        html += `<div style="padding:10px;border-bottom:1px solid #eee;">
            <div><strong>วันที่:</strong> ${r.date || r.startDate || '-'}</div>
            <div><strong>ประเภท:</strong> ${ (r.hourlyType === 'leave' || r.type === 'leave') ? 'ลาชั่วโมง' : (r.hourlyType === 'use' || r.type === 'use' ? 'ใช้ชั่วโมง' : (r.type || r.hourlyType || '-')) }</div>
            <div><strong>เวลา:</strong> ${r.startTime || r.start || '-'} - ${r.endTime || r.end || '-'}</div>
            <div><strong>ผู้อนุมัติ:</strong> ${r.approver || r.approverName || r.approverUser || '-'}</div>
            <div><strong>หมายเหตุ:</strong> ${r.note || r.notes || '-'}</div>
            <div><strong>สถานะ:</strong> ${ (r.confirmed || r.status && /อนุมัติ/i.test(r.status)) ? '✔ อนุมัติแล้ว' : '⏳ รออนุมัติ' }</div>
        </div>`;
    });
    html += '</div>';
    Swal.fire({ title: `ประวัติของ ${nickname}`, html, width: 650, confirmButtonText: 'ปิด' });
};

// Show a single hourly record's details (uses record object or id)
window.showHourlyRecordDetails = function(recOrId){
    const all = window.allHourlyRecords || [];
    let rec = null;
    if(!recOrId) return;
    if(typeof recOrId === 'string') {
        // try find by id
        rec = all.find(r => r.id === recOrId);
    } else if (typeof recOrId === 'object') rec = recOrId;
    if(!rec) {
        // try find by matching nickname+date from a string like "name|date"
        // or fallback to searching by nickname and date in DOM context - skip
        Swal.fire('ไม่พบข้อมูล', 'ไม่สามารถค้นหารายการนี้ได้', 'error');
        return;
    }
    const html = `<div style="text-align:left">
        <div><strong>วันที่:</strong> ${rec.date || rec.startDate || '-'}</div>
        <div><strong>ประเภท:</strong> ${ (rec.hourlyType === 'leave' || rec.type === 'leave') ? 'ลาชั่วโมง' : 'ใช้ชั่วโมง' }</div>
        <div><strong>เวลา:</strong> ${rec.startTime || rec.start || '-'} - ${rec.endTime || rec.end || '-'}</div>
        <div><strong>ผู้อนุมัติ:</strong> ${rec.approver || '-'}</div>
        <div><strong>หมายเหตุ:</strong> ${rec.note || '-'}</div>
        <div><strong>สถานะ:</strong> ${ rec.confirmed ? '✔ อนุมัติแล้ว' : '⏳ รออนุมัติ' }</div>
    </div>`;
    const showEditButton = !(rec.confirmed);
    Swal.fire({
        title: 'รายละเอียดรายการ',
        html: html,
        showCancelButton: !!showEditButton,
        confirmButtonText: 'ปิด',
        cancelButtonText: showEditButton ? 'แก้ไข' : undefined,
        didOpen: () => {},
        preConfirm: () => {}
    }).then(result=>{
        if(result.dismiss === Swal.DismissReason.cancel){
            // if there's an edit flow in original code, call it
            if(typeof window.openEditModal === 'function') {
                window.openEditModal(rec.id);
            } else if (typeof window.openHourlyEditModal === 'function') {
                window.openHourlyEditModal(rec.id);
            } else {
                Swal.fire('แก้ไข', 'ฟังก์ชันแก้ไขไม่พร้อมใช้งาน', 'info');
            }
        }
    });
};

// Delegated click handling for summary and records tables
document.addEventListener('DOMContentLoaded', function(){
    // Summary table: click on first column -> show history
    const sumTable = document.getElementById('hourly-summary-table');
    if(sumTable){
        sumTable.addEventListener('click', function(e){
            const td = e.target.closest('td');
            if(!td) return;
            // assume first column is nickname
            const tr = td.parentElement;
            const tds = Array.from(tr.children);
            const nickname = (tds[1] ? tds[1].textContent : td.textContent).trim() || td.textContent.trim(); // sometimes 2nd column
            if(nickname) showPersonHourlyHistory(nickname);
        });
    }

    // Records table: clicking a row will open details modal (try to resolve record)
    const recTable = document.getElementById('hourly-records-table');
    if(recTable){
        recTable.addEventListener('click', function(e){
            const tr = e.target.closest('tr');
            if(!tr) return;
            // try dataset.id
            const did = tr.dataset && tr.dataset.id;
            if(did){
                showHourlyRecordDetails(did);
                return;
            }
            // else try to read date and nickname cells (assume columns: date, nickname, ...)
            const tds = Array.from(tr.children);
            const dateText = tds[0] ? tds[0].textContent.trim() : '';
            const nickname = tds[1] ? tds[1].textContent.trim() : '';
            if(nickname){
                const match = (window.allHourlyRecords || []).find(r=>{
                    const a = (r.nickname||'').toString().trim();
                    const b = (r.date||r.startDate||'').toString().trim();
                    // compare nickname exactly and date includes dateText or vice versa
                    return a===nickname && (b.indexOf(dateText)!==-1 || dateText.indexOf(b)!==-1 || b===dateText);
                });
                if(match) { showHourlyRecordDetails(match); return; }
                // fallback: show history
                showPersonHourlyHistory(nickname);
            }
        });
    }
});


// Delegated handler for clickable-name elements (fullname or nickname) -> show person's hourly history
(function(){
    if (typeof window.showPersonHourlyHistory !== 'function') return;
    document.addEventListener('click', function(e){
        const el = e.target.closest && e.target.closest('.clickable-name');
        if(!el) return;
        const user = el.dataset && (el.dataset.user || el.dataset.display);
        if(!user) return;
        // try to resolve to nickname if fullname given
        const u = (users || []).find(u => u.nickname === user || u.fullname === user);
        const nickname = u ? u.nickname : user;
        try { showPersonHourlyHistory(nickname); } catch(err){ console.warn('showPersonHourlyHistory error', err); }
    });
})();
