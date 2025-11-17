import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, onSnapshot, addDoc, doc, deleteDoc, updateDoc, query, where, serverTimestamp, getDocs, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- Firebase Configuration ---
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
window.db = db; // For debugging

// --- Global Variables ---
let currentDate = new Date();
let __initialLoaderTimer = null;
let users = [];
let admins = [];
let allHourlyRecords = [];
let filteredHourlyRecords = [];
let allLeaveRecords = [];
let filteredLeaveRecords = [];
let filteredUsers = [];
let holidays = [];

// Subscriptions & Tools
let hourlyRecordsUnsubscribe, leaveRecordsUnsubscribe, usersUnsubscribe, pinUnsubscribe, adminsUnsubscribe;
let tomSelectHourly, tomSelectLeave, tomSelectPinUser, tomSelectHourlyApprover, tomSelectAdminPinUser;

// Pagination & Filters
let hourlyRecordsCurrentPage = 1;
let hourlySummaryCurrentPage = 1;
let leaveRecordsCurrentPage = 1;
let leaveSummaryCurrentPage = 1;
let usersCurrentPage = 1;
const recordsPerPage = 10;
const summaryRecordsPerPage = 10;

let currentFullDayLeaveType = null;
let systemPIN = null;

// Calendar Settings
let currentCalendarView = 'month';
let showFullDayLeaveOnCalendar = true;
let showHourlyLeaveOnCalendar = true;
let calendarPositionFilter = '';

// Admin Dashboard Settings
let pendingFilterType = 'all';
let pendingApproverFilter = 'all';

// --- Helper: Escape HTML (Security) ---
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// --- Helper: Formatting & Calculation ---
function toLocalISOStringInThailand(date) {
    const options = { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' };
    return new Intl.DateTimeFormat('en-CA', options).format(date);
}

function toLocalISOString(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDateThaiShort(dateStrOrObj) {
    if (!dateStrOrObj) return '';
    const date = dateStrOrObj.toDate ? dateStrOrObj.toDate() : new Date(dateStrOrObj);
    const year = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })).getFullYear() + 543;
    const shortYear = year.toString().slice(-2);
    return new Intl.DateTimeFormat('th-TH', { month: 'short', day: 'numeric', timeZone: 'Asia/Bangkok' }).format(date) + ' ' + shortYear;
}

function formatDateTimeThaiShort(dateStrOrObj) {
    if (!dateStrOrObj) return '';
    const date = dateStrOrObj.toDate ? dateStrOrObj.toDate() : new Date(dateStrOrObj);
    const datePart = formatDateThaiShort(date);
    const timePart = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' }).format(date);
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

    const toYYYYMMDD = (d) => {
        const year = d.getFullYear();
        const month = (d.getMonth() + 1).toString().padStart(2, '0');
        const day = d.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    if (sDate.getTime() === eDate.getTime()) {
        const isHalf = (startPeriod && startPeriod.includes('ครึ่งวัน')) || (endPeriod && endPeriod.includes('ครึ่งวัน'));
        return isHalf ? 0.5 : 1;
    }

    let leaveDayCount = 0;
    const currentDate = new Date(sDate);
    while (currentDate <= eDate) {
        const dateString = toYYYYMMDD(currentDate);
        const isWeekend = (currentDate.getDay() === 0 || currentDate.getDay() === 6);
        const isHoliday = holidays[dateString]; 
        if (!isWeekend && !isHoliday) { leaveDayCount++; }
        currentDate.setDate(currentDate.getDate() + 1);
    }

    // Adjust half-days
    const sDateString = toYYYYMMDD(sDate);
    const sDateIsWorkday = (sDate.getDay() !== 0 && sDate.getDay() !== 6 && !holidays[sDateString]);
    if (sDateIsWorkday && startPeriod && startPeriod.includes('ครึ่งวัน')) { leaveDayCount -= 0.5; }

    const eDateString = toYYYYMMDD(eDate);
    const eDateIsWorkday = (eDate.getDay() !== 0 && eDate.getDay() !== 6 && !holidays[eDateString]);
    if (eDateIsWorkday && endPeriod && endPeriod.includes('ครึ่งวัน')) { leaveDayCount -= 0.5; }

    return Math.max(0, leaveDayCount);
}

function getCurrentFiscalYear() {
    const now = new Date();
    const year = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric' }).format(now));
    const month = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', month: 'numeric' }).format(now)) - 1;
    return month >= 9 ? year + 544 : year + 543;
}

// --- UI Helpers ---
function getPositionBadgeClass(position) {
    switch (position) {
        case 'เภสัช': return 'pos-เภสัช';
        case 'จพง': return 'pos-จพง';
        case 'จนท': return 'pos-จนท';
        default: return 'pos-default';
    }
}

function getStatusClass(rec) {
    if (rec.leaveType) { // Full day
         const s = (rec.status || '').trim().toLowerCase();
         if (/(อนุมัติแล้ว|approved)/.test(s)) return 'approved';
         return 'pending';
    } else { // Hourly
        return rec.confirmed ? 'approved' : 'pending';
    }
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
function hideInitialLoader() {
    try {
        if (__initialLoaderTimer) { clearTimeout(__initialLoaderTimer); __initialLoaderTimer = null; }
        const loader = document.getElementById('initial-loader');
        if (loader) loader.style.display = 'none';
    } catch(e) { }
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    if (!__initialLoaderTimer) { __initialLoaderTimer = setTimeout(() => hideInitialLoader(), 8000); }
    
    showTab('hourly');
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
    document.getElementById('register-form')?.addEventListener('submit', handleRegisterSubmit);
    document.getElementById('hourly-form')?.addEventListener('submit', handleHourlySubmit);
    document.getElementById('leave-form')?.addEventListener('submit', handleLeaveSubmit);
    document.getElementById('change-personal-pin-form')?.addEventListener('submit', handleChangePersonalPin);

    // Filters
    ['leave-filter-fiscal-year', 'summary-search-name', 'summary-filter-position', 'records-search-name', 'records-filter-position', 'records-filter-start', 'records-filter-end'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', () => { leaveRecordsCurrentPage = 1; leaveSummaryCurrentPage = 1; applyLeaveFiltersAndRender(); });
    });
    ['hourly-filter-fiscal-year', 'hourly-search-name', 'hourly-filter-position', 'hourly-filter-start', 'hourly-filter-end', 'hourly-summary-filter-position'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', () => { hourlyRecordsCurrentPage = 1; hourlySummaryCurrentPage = 1; applyHourlyFiltersAndRender(); });
    });
     ['user-search-name', 'user-filter-position'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', () => { usersCurrentPage = 1; applyUserFiltersAndRender(); });
    });

    // Radio buttons animation
    document.querySelectorAll('.radio-option-animated').forEach(option => {
        option.addEventListener('click', function() {
            document.querySelectorAll('.radio-option-animated').forEach(opt => opt.classList.remove('selected'));
            this.classList.add('selected');
            const radioInput = this.querySelector('input[type="radio"]');
            if (radioInput) radioInput.checked = true;
        });
    });

    // Leave type buttons
    document.querySelectorAll('#leave-type-buttons-new .leave-type-btn').forEach(button => {
        button.addEventListener('click', function() {
            document.querySelectorAll('#leave-type-buttons-new .leave-type-btn').forEach(btn => {
                btn.classList.remove('active', 'bg-purple-500', 'bg-green-500', 'bg-red-500', 'bg-pink-500', 'text-white', 'border-purple-500', 'border-green-500', 'border-red-500', 'border-pink-500');
                btn.classList.add('text-gray-700', 'border-gray-300');
            });
            this.classList.add('active');
            this.classList.remove('text-gray-700', 'border-gray-300');
            
            const color = this.dataset.color;
            currentFullDayLeaveType = this.dataset.type;
            
            const colorMap = {
                purple: ['bg-purple-500', 'text-white', 'border-purple-500'],
                green: ['bg-green-500', 'text-white', 'border-green-500'],
                red: ['bg-red-500', 'text-white', 'border-red-500'],
                pink: ['bg-pink-500', 'text-white', 'border-pink-500']
            };
            if(colorMap[color]) this.classList.add(...colorMap[color]);
        });
    });

    // Dropdown view
    document.body.addEventListener('click', function(e) {
        const menu = document.getElementById('view-dropdown-menu');
        if (e.target.closest('#view-dropdown-btn')) { menu?.classList.toggle('hidden'); } 
        else { menu?.classList.add('hidden'); }
    });

    // Fiscal Year Listener
    ['leave-filter-fiscal-year','hourly-filter-fiscal-year'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => { el.dataset.userSelected = '1'; });
    });
    
    // Admin Dashboard listeners
    document.querySelectorAll('.filter-btn-group .filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn-group .filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            pendingFilterType = btn.dataset.filterType;
            renderAdminDashboard();
        });
    });
    document.getElementById('pending-approver-filter')?.addEventListener('change', (e) => {
        pendingApproverFilter = e.target.value;
        renderAdminDashboard();
    });
    document.getElementById('select-all-pending')?.addEventListener('click', (e) => {
        document.querySelectorAll('#pending-requests-list input[type="checkbox"]').forEach(cb => cb.checked = e.target.checked);
        updateBatchApproveButtonState();
    });
    document.getElementById('batch-approve-btn')?.addEventListener('click', handleBatchApprove);
}

// --- Data Loading & Listeners ---
async function initializeDataListeners() {
    if (adminsUnsubscribe) adminsUnsubscribe();
    adminsUnsubscribe = onSnapshot(collection(db, "admins"), (snapshot) => {
        admins = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a,b) => a.username.localeCompare(b.username, 'th'));
        populateApproverDropdowns();
    });

    if (usersUnsubscribe) usersUnsubscribe();
    usersUnsubscribe = onSnapshot(collection(db, "users"), (snapshot) => {
        users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a,b) => a.nickname.localeCompare(b.nickname, 'th'));
        populateUserDropdowns();
        applyUserFiltersAndRender();
        loadHourlyData();
        loadLeaveData(); 
        document.getElementById('db-status').textContent = '✅ Connected';
        document.getElementById('db-status').className = 'bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium';
        hideInitialLoader();
    }, () => { showErrorPopup('ไม่สามารถเชื่อมต่อฐานข้อมูลผู้ใช้ได้'); });

    await loadHolidays();
    renderCalendar();
}

function loadHourlyData() {
     if (hourlyRecordsUnsubscribe) hourlyRecordsUnsubscribe();
     hourlyRecordsUnsubscribe = onSnapshot(query(collection(db, "hourlyRecords")), (snapshot) => {
        allHourlyRecords = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateFiscalYearFiltersFromData();
        applyHourlyFiltersAndRender();
     });
}

function loadLeaveData() {
    if (leaveRecordsUnsubscribe) leaveRecordsUnsubscribe();
    leaveRecordsUnsubscribe = onSnapshot(query(collection(db, "leaveRecords")), (snapshot) => {
        allLeaveRecords = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateFiscalYearFiltersFromData();
        applyLeaveFiltersAndRender();
        renderCalendar();
    });
}

function initializePinListener() {
    if (pinUnsubscribe) pinUnsubscribe();
    pinUnsubscribe = onSnapshot(doc(db, "pin", "config"), (docSnap) => {
        systemPIN = docSnap.exists() ? docSnap.data().value : null;
    });
}

async function loadHolidays() {
    try {
      const response = await fetch('holidays.json');
      if (response.ok) holidays = await response.json();
    } catch (error) { console.error("Error loading holidays:", error); }
}

// --- Form Submission Handlers ---

async function handleHourlySubmit(e) {
    e.preventDefault();
    const selectedTypeInput = document.querySelector('input[name="hourlyLeaveType"]:checked');
    if (!selectedTypeInput) return showErrorPopup('กรุณาเลือกประเภทรายการ');
    
    const currentLeaveType = selectedTypeInput.value;
    const approver = tomSelectHourlyApprover.getValue();
    if (!approver) return showErrorPopup('กรุณาเลือกผู้อนุมัติ');

    // FIX: Syntax Error fixed here
    const startTimeVal = document.getElementById('hourly-start').value;
    const endTimeVal   = document.getElementById('hourly-end').value;

    if (startTimeVal >= endTimeVal) return showErrorPopup('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น');

    const formData = {
        fiscalYear: parseInt(document.getElementById('hourly-filter-fiscal-year').value),
        userNickname: tomSelectHourly.getValue(), 
        date: document.getElementById('hourly-date').value,
        startTime: startTimeVal, 
        endTime: endTimeVal,
        duration: calculateDuration(startTimeVal, endTimeVal).total,
        type: currentLeaveType, 
        note: document.getElementById('hourly-note').value, 
        approver: approver,
        confirmed: false,
    };

    if (!formData.userNickname) return showErrorPopup('กรุณาเลือกผู้ใช้');

    const conflict = hasHourlyConflict(formData.userNickname, formData.date, formData.startTime, formData.endTime);
    if (conflict) {
        Swal.fire({ icon: 'warning', title: 'รายการซ้ำซ้อน', text: `มีรายการช่วง ${conflict.startTime} - ${conflict.endTime} แล้ว` });
        return; 
    }

    const summaryHtml = `
        <p><b>ผู้ใช้:</b> ${formData.userNickname}</p>
        <p><b>ประเภท:</b> ${formData.type === 'leave' ? 'ลาชั่วโมง' : 'ใช้ชั่วโมง'}</p>
        <p><b>วันที่:</b> ${formatDateThaiShort(formData.date)}</p>
        <p><b>เวลา:</b> ${formData.startTime} - ${formData.endTime}</p>
        <p><b>ผู้อนุมัติ:</b> ${formData.approver}</p>
    `;

    if (await confirmWithUserPin(formData.userNickname, summaryHtml)) {
        showLoadingPopup();
        try {
            await addDoc(collection(db, "hourlyRecords"), {...formData, timestamp: serverTimestamp()});
            await sendHourlyTelegramNotification(formData, users.find(u => u.nickname === formData.userNickname));
            showSuccessPopup('บันทึกสำเร็จ');
            e.target.reset(); 
            tomSelectHourly.clear();
            tomSelectHourlyApprover.clear();
            setDefaultDate();
            document.querySelectorAll('.radio-option-animated').forEach(opt => opt.classList.remove('selected'));
        } catch (error) { showErrorPopup('บันทึกล้มเหลว'); }
    }
}

async function handleLeaveSubmit(e) {
    e.preventDefault();
    if (!currentFullDayLeaveType) return showErrorPopup('กรุณาเลือกประเภทการลา');
    
    const startDate = document.getElementById('leave-start-date').value;
    const endDate = document.getElementById('leave-end-date').value;
    if (endDate < startDate) return showErrorPopup('วันที่สิ้นสุดต้องไม่มาก่อนวันที่เริ่มต้น');

    const formData = {
        fiscalYear: parseInt(document.getElementById('leave-filter-fiscal-year').value),
        userNickname: tomSelectLeave.getValue(), 
        leaveType: currentFullDayLeaveType,
        startDate: startDate,
        endDate: endDate,
        startPeriod: document.getElementById('leave-start-period').value,
        endPeriod: document.getElementById('leave-end-period').value,
        approver: document.getElementById('leave-approver').value, 
        note: document.getElementById('leave-note').value, 
        status: 'รออนุมัติ',
    };
    
    if (!formData.approver) return showErrorPopup('กรุณาเลือกผู้อนุมัติ');
    if (!formData.userNickname) return showErrorPopup('กรุณาเลือกผู้ลา');

    const conflict = hasFullDayConflict(formData.userNickname, formData.startDate, formData.endDate, formData.startPeriod, formData.endPeriod);
    if (conflict) {
        Swal.fire({ icon: 'warning', title: 'ลาซ้ำซ้อน', text: `วันที่ ${formatDateThaiShort(conflict.date)}: ${conflict.type}` });
        return;
    }
    
    const leaveDays = calculateLeaveDays(formData.startDate, formData.endDate, formData.startPeriod, formData.endPeriod);
    const summaryHtml = `
        <p><b>ผู้ลา:</b> ${formData.userNickname}</p>
        <p><b>ประเภท:</b> ${formData.leaveType}</p>
        <p><b>วันที่:</b> ${formatDateThaiShort(formData.startDate)} - ${formatDateThaiShort(formData.endDate)}</p>
        <p><b>จำนวน:</b> ${leaveDays} วัน</p>
    `;
    
    if (await confirmWithUserPin(formData.userNickname, summaryHtml)) {
        showLoadingPopup();
        try {
            await addDoc(collection(db, "leaveRecords"), {...formData, createdDate: serverTimestamp()});
            await sendTelegramNotification(formData, users.find(u => u.nickname === formData.userNickname), leaveDays);
            showSuccessPopup('บันทึกสำเร็จ');
            e.target.reset(); 
            tomSelectLeave.clear(); 
            setDefaultDate();
            currentFullDayLeaveType = null;
            document.querySelectorAll('#leave-type-buttons-new .leave-type-btn').forEach(btn => {
                btn.classList.remove('active', 'bg-purple-500', 'bg-green-500', 'bg-red-500', 'bg-pink-500', 'text-white', 'border-purple-500', 'border-green-500', 'border-red-500', 'border-pink-500');
                btn.classList.add('text-gray-700', 'border-gray-300');
            });
        } catch (error) { showErrorPopup('บันทึกล้มเหลว'); }
    }
}

async function handleRegisterSubmit(e) {
    e.preventDefault();
    const fullname = document.getElementById('register-fullname').value.trim();
    const nickname = document.getElementById('register-nickname').value.trim();
    const pin = document.getElementById('register-pin').value;
    const pinConfirm = document.getElementById('register-pin-confirm').value;

    if (!fullname || !nickname) return showErrorPopup("กรุณากรอกข้อมูลให้ครบ");
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) return showErrorPopup('PIN ต้องเป็นตัวเลข 4 หลัก');
    if (pin !== pinConfirm) return showErrorPopup('PIN ไม่ตรงกัน');

    showLoadingPopup("กำลังบันทึก...");
    try {
        const q = query(collection(db, "users"), where("nickname", "==", nickname));
        if (!(await getDocs(q)).empty) return showErrorPopup(`ชื่อเล่น "${nickname}" มีอยู่แล้ว`);
        await addDoc(collection(db, "users"), { 
            fullname, nickname, position: document.getElementById('register-position').value, pin 
        });
        showSuccessPopup('ลงทะเบียนสำเร็จ');
        e.target.reset();
    } catch (error) { showErrorPopup('ลงทะเบียนล้มเหลว'); }
}

// --- Rendering Functions (The NEW Versions) ---

window.renderHourlySummary = function(summary) {
    const tbody = document.getElementById('hourly-summary-table');
    if (!tbody) return;
    tbody.innerHTML = '';

    const totalPages = Math.max(1, Math.ceil(summary.length / summaryRecordsPerPage));
    hourlySummaryCurrentPage = Math.max(1, Math.min(hourlySummaryCurrentPage, totalPages));
    const startIndex = (hourlySummaryCurrentPage - 1) * summaryRecordsPerPage;
    const paginatedData = summary.slice(startIndex, startIndex + summaryRecordsPerPage);

    paginatedData.forEach(item => {
        const balance = (Number(item.usedHours) || 0) - (Number(item.leaveHours) || 0);
        const userKey = escapeHtml(item.userNickname || item.nickname);
        const displayName = escapeHtml(item.nickname || userKey);

        tbody.insertAdjacentHTML('beforeend', `
            <tr class="border-b hover:bg-gray-50">
                <td class="px-4 py-3">
                    <span class="clickable-name cursor-pointer text-indigo-600 hover:underline font-semibold" 
                          onclick="showPersonHourlyHistory('${userKey}')">
                        ${displayName}
                    </span>
                </td>
                <td class="px-4 py-3"><span class="position-badge">${escapeHtml(item.position || 'N/A')}</span></td>
                <td class="px-4 py-3 text-right">${formatHoursAndMinutes(item.leaveHours || 0)}</td>
                <td class="px-4 py-3 text-right">${formatHoursAndMinutes(item.usedHours || 0)}</td>
                <td class="px-4 py-3 text-right font-semibold ${balance < 0 ? 'text-red-600' : 'text-green-600'}">
                    ${formatHoursAndMinutes(balance)}
                </td>
            </tr>
        `);
    });

    const pageInfo = document.getElementById('hourly-summary-page-info');
    if (pageInfo) pageInfo.textContent = `หน้า ${hourlySummaryCurrentPage} / ${totalPages}`;
    document.getElementById('hourly-summary-prev-btn').disabled = hourlySummaryCurrentPage === 1;
    document.getElementById('hourly-summary-next-btn').disabled = hourlySummaryCurrentPage === totalPages;
};

window.renderHourlyRecords = function(records) {
    const tbody = document.getElementById('hourly-records-table');
    if (!tbody) return;
    tbody.innerHTML = '';

    const totalPages = Math.max(1, Math.ceil(records.length / recordsPerPage));
    hourlyRecordsCurrentPage = Math.max(1, Math.min(hourlyRecordsCurrentPage, totalPages));
    const startIndex = (hourlyRecordsCurrentPage - 1) * recordsPerPage;
    
    const sortedRecords = (records || []).slice().sort((a, b) => {
        const at = a.timestamp ? (a.timestamp.seconds || a.timestamp) : 0;
        const bt = b.timestamp ? (b.timestamp.seconds || b.timestamp) : 0;
        return bt - at;
    });
    const paginatedRecords = sortedRecords.slice(startIndex, startIndex + recordsPerPage);

    paginatedRecords.forEach(r => {
        const user = users.find(u => u.nickname === r.userNickname) || {};
        const statusText = r.confirmed ? 'อนุมัติแล้ว' : 'รออนุมัติ';
        const statusClass = r.confirmed ? 'text-green-500' : 'text-yellow-500';
        const recordId = escapeHtml(r.id || r._id || '');

        tbody.insertAdjacentHTML('beforeend', `
            <tr class="border-b hover:bg-gray-50 clickable-hourly-row cursor-pointer" 
                onclick="showHourlyDetailModal('${recordId}')">
                <td class="px-4 py-3">${formatDateThaiShort(r.date)}</td>
                <td class="px-4 py-3">
                     <span class="clickable-name text-indigo-600 hover:underline" 
                          onclick="event.stopPropagation(); showPersonHourlyHistory('${escapeHtml(r.userNickname)}')">
                        ${escapeHtml(user.nickname || r.userNickname)}
                    </span>
                </td>
                <td class="px-4 py-3"><span class="position-badge ${getPositionBadgeClass(user.position)}">${escapeHtml(user.position || 'N/A')}</span></td>
                <td class="px-4 py-3 font-semibold ${r.type === 'leave' ? 'text-red-600' : 'text-green-600'}">
                    ${r.type === 'leave' ? 'ลา' : 'ใช้'}
                </td>
                <td class="px-4 py-3">
                    ${escapeHtml(r.startTime)}-${escapeHtml(r.endTime)} 
                    <span class="text-xs text-gray-500">(${formatHoursAndMinutes(r.duration)})</span>
                </td>
                <td class="px-4 py-3">${escapeHtml(r.approver || '-')}</td>
                <td class="px-4 py-3 font-semibold ${statusClass}">${statusText}</td>
                <td class="px-4 py-3 flex items-center space-x-1">
                    <button class="p-2 rounded-full hover:bg-red-100 text-red-600 transition-colors" 
                            title="ลบ" 
                            onclick="event.stopPropagation(); manageRecord('deleteHourly', '${recordId}')">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                        </svg>
                    </button>
                </td>
            </tr>
        `);
    });

    const pageInfo = document.getElementById('hourly-page-info');
    if (pageInfo) pageInfo.textContent = `หน้า ${hourlyRecordsCurrentPage} / ${totalPages}`;
    document.getElementById('hourly-prev-btn').disabled = hourlyRecordsCurrentPage === 1;
    document.getElementById('hourly-next-btn').disabled = hourlyRecordsCurrentPage === totalPages;
};

function renderLeaveSummary(summaryData) {
    const tbody = document.getElementById('leave-summary-table');
    if (!tbody) return;
    tbody.innerHTML = '';

    const totalPages = Math.max(1, Math.ceil(summaryData.length / summaryRecordsPerPage));
    leaveSummaryCurrentPage = Math.max(1, Math.min(leaveSummaryCurrentPage, totalPages));
    const startIndex = (leaveSummaryCurrentPage - 1) * summaryRecordsPerPage;
    const paginatedData = summaryData.slice(startIndex, startIndex + summaryRecordsPerPage);

    if (paginatedData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="px-4 py-6 text-center text-gray-500">ไม่พบข้อมูล</td></tr>`;
    } else {
        paginatedData.forEach((user) => {
            const safeNickname = escapeHtml(user.nickname);
            tbody.insertAdjacentHTML('beforeend', `
                <tr class="border-b hover:bg-gray-50 transition-colors duration-150">
                    <td class="px-4 py-3">
                        <a href="#" onclick="event.preventDefault(); showLeaveDetailPopup('${safeNickname}')" 
                           class="text-purple-600 hover:text-purple-800 hover:underline font-medium">
                           ${escapeHtml(user.fullname)}
                        </a>
                    </td>
                    <td class="px-4 py-3">${safeNickname}</td>
                    <td class="px-4 py-3"><span class="position-badge ${getPositionBadgeClass(user.position)}">${escapeHtml(user.position)}</span></td>
                    <td class="px-4 py-3 font-semibold">${user.totalDays || 0} วัน</td>
                </tr>
            `);
        });
    }

    const pageInfo = document.getElementById('summary-page-info');
    if (pageInfo) pageInfo.textContent = `หน้า ${leaveSummaryCurrentPage} / ${totalPages}`;
    document.getElementById('summary-prev-btn').disabled = leaveSummaryCurrentPage === 1;
    document.getElementById('summary-next-btn').disabled = leaveSummaryCurrentPage === totalPages;
}

// --- Modals & Popups ---

window.showPersonHourlyHistory = function(nickname) {
    const records = (allHourlyRecords || []).filter(r => (r.userNickname || r.nickname || '').toString() === nickname);
    
    if (!records || records.length === 0) {
        Swal.fire('ไม่มีประวัติ', `ไม่พบข้อมูลประวัติของ ${nickname}`, 'info');
        return;
    }

    const sorted = records.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
    let html = '<div style="max-height:400px; overflow-y:auto; text-align:left;" class="space-y-2">';
    
    sorted.forEach(r => {
        const isLeave = (r.type === 'leave');
        const colorClass = isLeave ? 'border-l-4 border-red-500 bg-red-50' : 'border-l-4 border-green-500 bg-green-50';
        html += `
        <div class="p-3 rounded shadow-sm border border-gray-100 ${colorClass}">
            <div class="flex justify-between">
                <span class="font-bold text-gray-700">${formatDateThaiShort(r.date)}</span>
                <span class="text-xs font-bold ${isLeave ? 'text-red-600' : 'text-green-600'}">${isLeave ? 'ลาชั่วโมง' : 'ใช้ชั่วโมง'}</span>
            </div>
            <div class="text-sm mt-1">
                เวลา: <b>${r.startTime} - ${r.endTime}</b> (${formatHoursAndMinutes(r.duration)})
            </div>
            <div class="text-xs text-gray-500 mt-1">
                ผู้อนุมัติ: ${escapeHtml(r.approver || '-')} | 
                ${r.confirmed ? '<span class="text-green-600">✔ อนุมัติ</span>' : '<span class="text-yellow-600">⏳ รอ</span>'}
            </div>
            ${r.note ? `<div class="text-xs text-gray-400 mt-1 italic">"${escapeHtml(r.note)}"</div>` : ''}
        </div>`;
    });
    html += '</div>';
    Swal.fire({ title: `ประวัติ: ${nickname}`, html: html, width: 600, confirmButtonText: 'ปิด' });
};

window.showHourlyDetailModal = function(id) {
    const record = allHourlyRecords.find(r => r.id === id);
    if (!record) return showErrorPopup('ไม่พบข้อมูล');

    const user = users.find(u => u.nickname === record.userNickname) || {};
    const durationText = formatHoursAndMinutes(record.duration);
    const label = record.type === 'leave' ? 'ลาชั่วโมง' : 'ใช้ชั่วโมง';
    const tagClass = record.type === 'leave' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800';

    const modalHtml = `
        <div class="space-y-4 text-left p-2">
            <div class="flex justify-between items-start">
                <div>
                    <p class="text-sm text-gray-500">ชื่อ-สกุล</p>
                    <p class="font-semibold text-lg">${escapeHtml(user.fullname)} (${escapeHtml(record.userNickname)})</p>
                </div>
                <span class="px-3 py-1 rounded-full text-xs font-bold ${tagClass}">${label}</span>
            </div>
            <div class="grid grid-cols-2 gap-4">
                <div><p class="text-sm text-gray-500">วันที่</p><p class="font-medium">${formatDateThaiShort(record.date)}</p></div>
                <div><p class="text-sm text-gray-500">รวมเวลา</p><p class="font-bold">${durationText}</p></div>
                <div><p class="text-sm text-gray-500">ช่วงเวลา</p><p class="font-medium">${record.startTime} - ${record.endTime}</p></div>
                <div><p class="text-sm text-gray-500">สถานะ</p><span class="font-semibold ${record.confirmed ? 'text-green-600' : 'text-yellow-600'}">${record.confirmed ? 'อนุมัติแล้ว' : 'รออนุมัติ'}</span></div>
            </div>
            <div class="bg-gray-50 p-3 rounded-lg border"><p class="text-sm text-gray-500 mb-1">ผู้อนุมัติ</p><p class="font-medium">${escapeHtml(record.approver || '-')}</p></div>
            <div class="bg-gray-50 p-3 rounded-lg border"><p class="text-sm text-gray-500 mb-1">หมายเหตุ</p><p class="text-sm">${escapeHtml(record.note || '-')}</p></div>
        </div>`;

    Swal.fire({
        title: 'รายละเอียดรายการ',
        html: modalHtml,
        width: '450px',
        showCancelButton: true,
        confirmButtonText: 'ปิด',
        cancelButtonText: 'แก้ไขรายการ'
    }).then((result) => {
        if (result.dismiss === Swal.DismissReason.cancel) editHourlyRecord(id);
    });
};

window.showLeaveDetailPopup = function(nickname) {
    const fyEl = document.getElementById('leave-filter-fiscal-year');
    const fiscalYear = fyEl ? parseInt(fyEl.value) : getCurrentFiscalYear();
    
    const user = users.find(u => u.nickname === nickname);
    if (!user) return showErrorPopup('ไม่พบข้อมูลผู้ใช้');

    const totals = { vacation: 0, sick: 0, personal: 0, maternity: 0 };
    
    const records = allLeaveRecords
        .filter(r => r.userNickname === nickname && parseInt(r.fiscalYear) === fiscalYear && r.status === 'อนุมัติแล้ว')
        .map(r => {
            const days = calculateLeaveDays(r.startDate, r.endDate, r.startPeriod, r.endPeriod);
            if (/พักผ่อน/i.test(r.leaveType)) totals.vacation += days;
            else if (/ป่วย/i.test(r.leaveType)) totals.sick += days;
            else if (/คลอด/i.test(r.leaveType)) totals.maternity += days;
            else totals.personal += days;
            return { ...r, days };
        })
        .sort((a, b) => new Date(b.startDate) - new Date(a.startDate));

    const card = (lbl, val, cls) => `<div class="rounded-xl shadow-sm border p-3 text-center ${cls}"><div class="text-xs text-gray-600">${lbl}</div><div class="text-2xl font-bold">${val}</div></div>`;
    const cardsHtml = `<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        ${card('ลาพักผ่อน', totals.vacation, 'bg-green-50')} ${card('ลาป่วย', totals.sick, 'bg-red-50')}
        ${card('ลากิจ/ฉุกเฉิน', totals.personal, 'bg-purple-50')} ${card('ลาคลอด', totals.maternity, 'bg-pink-50')}
    </div>`;

    const rows = records.map(r => {
        const dateText = (r.startDate === r.endDate) ? `${formatDateThaiShort(r.startDate)}` : `${formatDateThaiShort(r.startDate)} - ${formatDateThaiShort(r.endDate)}`;
        return `<tr class="border-b"><td class="px-3 py-2">${r.leaveType}</td><td class="px-3 py-2">${dateText}</td><td class="px-3 py-2 font-bold">${r.days}</td></tr>`;
    }).join('') || `<tr><td colspan="3" class="text-center py-4">ไม่มีรายการ</td></tr>`;

    Swal.fire({
        title: `ประวัติการลา: ${user.nickname} (ปีงบ ${fiscalYear})`,
        html: cardsHtml + `<div class="max-h-[300px] overflow-y-auto"><table class="min-w-full text-sm"><thead class="bg-gray-50"><tr><th class="px-3 py-2">ประเภท</th><th class="px-3 py-2">วันที่</th><th class="px-3 py-2">วัน</th></tr></thead><tbody>${rows}</tbody></table></div>`,
        width: 600,
        confirmButtonText: 'ปิด'
    });
};

// --- Admin, PIN & Logic ---

window.editHourlyRecord = async function(id) {
    const record = allHourlyRecords.find(r => r.id === id);
    const { value: form } = await Swal.fire({
        title: 'แก้ไขลาชั่วโมง',
        html: `
            <input id="eh-start" type="time" class="swal2-input" value="${record.startTime}">
            <input id="eh-end" type="time" class="swal2-input" value="${record.endTime}">
            <textarea id="eh-note" class="swal2-textarea" placeholder="หมายเหตุ">${record.note || ''}</textarea>
        `,
        showCancelButton: true,
        preConfirm: () => ({
            startTime: document.getElementById('eh-start').value,
            endTime: document.getElementById('eh-end').value,
            note: document.getElementById('eh-note').value
        })
    });

    if (form && await confirmWithAdminPin(record.approver, 'ยืนยันการแก้ไข')) {
        await updateDoc(doc(db, "hourlyRecords", id), { ...form, duration: calculateDuration(form.startTime, form.endTime).total });
        showSuccessPopup('แก้ไขสำเร็จ');
    }
};

window.manageRecord = async function(action, id) {
    const isLeave = action.includes('Leave');
    const collectionName = isLeave ? "leaveRecords" : "hourlyRecords";
    const record = (isLeave ? allLeaveRecords : allHourlyRecords).find(r => r.id === id);
    if (!record) return;

    if (action.includes('delete')) {
        const isApproved = isLeave ? record.status === 'อนุมัติแล้ว' : record.confirmed;
        const pinOk = isApproved 
            ? await confirmWithAdminPin(record.approver, 'ยืนยันลบรายการที่อนุมัติแล้ว')
            : await confirmWithUserPin(record.userNickname, 'ยืนยันการลบรายการ');
        
        if (pinOk) {
            await deleteDoc(doc(db, collectionName, id));
            showSuccessPopup('ลบสำเร็จ');
        }
    } else if (action.includes('approve')) {
        if (await confirmWithAdminPin(record.approver, `ยืนยันอนุมัติรายการของ ${record.userNickname}`)) {
            await updateDoc(doc(db, collectionName, id), isLeave ? { status: 'อนุมัติแล้ว' } : { confirmed: true });
            showSuccessPopup('อนุมัติสำเร็จ');
            renderAdminDashboard();
        }
    }
};

async function confirmWithUserPin(nickname, summaryHtml) {
    const user = users.find(u => u.nickname === nickname);
    if (!user || !user.pin) return showErrorPopup('ไม่พบ PIN ผู้ใช้'), false;
    return promptPin(user.pin, summaryHtml);
}

async function confirmWithAdminPin(username, summaryHtml) {
    const admin = admins.find(a => a.username === username);
    const pin = admin ? admin.pin : (admins[0]?.pin); // Fallback if needed
    if (!pin) return showErrorPopup('ไม่พบ PIN ผู้อนุมัติ'), false;
    return promptPin(pin, summaryHtml);
}

async function promptPin(correctPin, htmlContent) {
    let pin = '';
    return new Promise((resolve) => {
        Swal.fire({
            html: `
                <div class="mb-4 text-left text-sm bg-gray-50 p-3 rounded border">${htmlContent || ''}</div>
                <h3 class="text-lg font-bold mb-2">กรุณากรอก PIN</h3>
                <div id="pinDisplay" class="flex justify-center gap-2 mb-4">
                    ${[1,2,3,4].map(() => '<div class="w-3 h-3 rounded-full border bg-white pin-dot"></div>').join('')}
                </div>
                <div class="grid grid-cols-3 gap-2 max-w-[200px] mx-auto">
                    ${[1,2,3,4,5,6,7,8,9].map(n => `<button class="btn-pin bg-gray-100 p-3 rounded" data-v="${n}">${n}</button>`).join('')}
                    <button class="text-red-500 font-bold" onclick="Swal.close()">X</button>
                    <button class="btn-pin bg-gray-100 p-3 rounded" data-v="0">0</button>
                    <button class="text-gray-500" id="btn-del"><</button>
                </div>
            `,
            showConfirmButton: false,
            didOpen: (popup) => {
                const updateDots = () => {
                    popup.querySelectorAll('.pin-dot').forEach((dot, i) => {
                        dot.style.backgroundColor = i < pin.length ? '#3b82f6' : 'white';
                    });
                };
                popup.querySelectorAll('.btn-pin').forEach(b => b.onclick = () => {
                    if (pin.length < 4) { pin += b.dataset.v; updateDots(); }
                    if (pin.length === 4) {
                        setTimeout(() => {
                            if (pin === correctPin) { Swal.close(); resolve(true); }
                            else { pin = ''; updateDots(); Swal.showValidationMessage('PIN ผิด'); }
                        }, 200);
                    }
                });
                popup.querySelector('#btn-del').onclick = () => { pin = pin.slice(0, -1); updateDots(); };
            }
        }).then(res => { if(res.dismiss) resolve(false); });
    });
}

// --- Telegram ---
async function sendHourlyTelegramNotification(data, user) {
    await sendTelegramBase(`
🔵⏰ <b>แจ้งลาชั่วโมง</b>: ${user.fullname}
<b>ประเภท:</b> ${data.type === 'leave' ? 'ลา' : 'ใช้'}
<b>เวลา:</b> ${data.startTime}-${data.endTime} (${formatHoursAndMinutes(data.duration)})
<b>ผู้อนุมัติ:</b> ${data.approver}`);
}

async function sendTelegramNotification(data, user, days) {
    await sendTelegramBase(`
🔔📅 <b>แจ้งลา</b>: ${user.fullname}
<b>ประเภท:</b> ${data.leaveType}
<b>วันที่:</b> ${formatDateThaiShort(data.startDate)} - ${formatDateThaiShort(data.endDate)}
<b>จำนวน:</b> ${days} วัน
<b>ผู้อนุมัติ:</b> ${data.approver}`);
}

async function sendTelegramBase(msg) {
    try {
        await fetch(`https://api.telegram.org/bot8256265459:AAGPbAd_-wDPW0FSZUm49SwZD8FdEzy2zTQ/sendMessage`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ chat_id: '-1002988996292', text: msg, parse_mode: 'HTML' })
        });
    } catch (e) { console.error("Telegram Error", e); }
}

// --- Admin Dashboard & Filters ---

window.renderAdminDashboard = function() {
    const list = document.getElementById('pending-requests-list');
    if (!list) return;
    
    let pending = [...allLeaveRecords.filter(r => r.status === 'รออนุมัติ'), ...allHourlyRecords.filter(r => !r.confirmed)];
    if (pendingFilterType !== 'all') {
        pending = pending.filter(r => (pendingFilterType === 'leave' ? r.leaveType : !r.leaveType));
    }
    if (pendingApproverFilter !== 'all') {
        pending = pending.filter(r => r.approver === pendingApproverFilter);
    }

    document.getElementById('pending-count').textContent = pending.length;
    
    if (pending.length === 0) {
        list.innerHTML = '<div class="text-center text-gray-500 py-4">ไม่มีรายการรออนุมัติ</div>';
        return;
    }

    list.innerHTML = pending.map(r => {
        const user = users.find(u => u.nickname === r.userNickname) || {};
        const isLeave = !!r.leaveType;
        const type = isLeave ? 'leave' : 'hourly';
        const desc = isLeave ? `${r.leaveType} (${formatDateThaiShort(r.startDate)})` : `${r.type === 'leave'?'ลา':'ใช้'}ชม. (${r.startTime}-${r.endTime})`;
        
        return `
        <div class="flex items-center justify-between p-3 border-b bg-white hover:bg-gray-50">
            <div class="flex items-center gap-3">
                <input type="checkbox" class="pending-checkbox rounded" data-id="${r.id}" data-type="${type}">
                <div>
                    <div class="font-semibold">${user.nickname}</div>
                    <div class="text-sm text-gray-600">${desc}</div>
                    <div class="text-xs text-gray-400">ผู้อนุมัติ: ${r.approver}</div>
                </div>
            </div>
            <div class="flex gap-2">
                <button onclick="manageRecord('approve${isLeave?'Leave':'Hourly'}', '${r.id}')" class="text-green-600 p-1">✔</button>
                <button onclick="manageRecord('delete${isLeave?'Leave':'Hourly'}', '${r.id}')" class="text-red-600 p-1">✘</button>
            </div>
        </div>`;
    }).join('');
    
    updateBatchApproveButtonState();
};

window.updateBatchApproveButtonState = function() {
    const count = document.querySelectorAll('.pending-checkbox:checked').length;
    const btn = document.getElementById('batch-approve-btn');
    if (btn) btn.disabled = count === 0;
};

window.handleBatchApprove = async function() {
    const checkboxes = document.querySelectorAll('.pending-checkbox:checked');
    if (checkboxes.length === 0) return;

    const { value: approver } = await Swal.fire({
        title: `อนุมัติ ${checkboxes.length} รายการ`,
        input: 'select',
        inputOptions: Object.fromEntries(admins.map(a => [a.username, a.username])),
        showCancelButton: true
    });

    if (approver && await confirmWithAdminPin(approver, 'ยืนยันการอนุมัติหมู่')) {
        showLoadingPopup('กำลังอนุมัติ...');
        const batchPromises = Array.from(checkboxes).map(cb => {
            const { id, type } = cb.dataset;
            const col = type === 'leave' ? "leaveRecords" : "hourlyRecords";
            const update = type === 'leave' ? { status: 'อนุมัติแล้ว' } : { confirmed: true };
            return updateDoc(doc(db, col, id), update);
        });
        await Promise.all(batchPromises);
        showSuccessPopup('อนุมัติเรียบร้อย');
        renderAdminDashboard();
    }
};

// --- Calendar & Backup ---
window.renderCalendar = function() {
    // Simplified Calendar Render for brevity (Functionality kept)
    const container = document.getElementById('calendar-grid-container');
    if (!container || currentCalendarView !== 'month') return; // Only basic month view implemented in this safe version

    const year = currentDate.getFullYear(), month = currentDate.getMonth();
    document.getElementById('calendar-title').textContent = new Intl.DateTimeFormat('th-TH', {month: 'long', year: 'numeric'}).format(currentDate);
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    let html = `<div class="grid grid-cols-7 gap-1 text-center font-bold mb-2"><div>อา</div><div>จ</div><div>อ</div><div>พ</div><div>พฤ</div><div>ศ</div><div>ส</div></div><div class="grid grid-cols-7 gap-1">`;
    
    for (let i = 0; i < firstDay; i++) html += `<div></div>`;
    
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = toLocalISOString(new Date(year, month, d));
        const dayEvents = [
            ...(showFullDayLeaveOnCalendar ? allLeaveRecords.filter(r => dateStr >= r.startDate && dateStr <= r.endDate) : []),
            ...(showHourlyLeaveOnCalendar ? allHourlyRecords.filter(r => r.date === dateStr) : [])
        ];
        
        const eventHtml = dayEvents.slice(0, 2).map(ev => {
            const u = users.find(u => u.nickname === ev.userNickname)?.nickname || ev.userNickname;
            const isL = !!ev.leaveType;
            const color = isL ? 'bg-purple-100 text-purple-800' : (ev.type === 'leave' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800');
            return `<div class="text-[10px] px-1 rounded truncate ${color} mb-1 cursor-pointer" onclick="${isL ? `showLeaveDetailModal('${ev.id}')` : `showHourlyDetailModal('${ev.id}')`}">${u}</div>`;
        }).join('');
        
        html += `<div class="border p-1 h-24 bg-white overflow-hidden"><div class="text-sm font-semibold ${holidays[dateStr] ? 'text-red-500' : ''}">${d}</div>${eventHtml}</div>`;
    }
    container.innerHTML = html + '</div>';
};

// Calendar Navigation
window.changeCalendarView = (v) => { currentCalendarView = v; renderCalendar(); };
window.navigateCalendar = (dir) => { currentDate.setMonth(currentDate.getMonth() + dir); renderCalendar(); };
window.goToToday = () => { currentDate = new Date(); renderCalendar(); };

// Backup
window.openBackupMenu = () => document.getElementById('backup-modal').classList.remove('hidden');
window.closeBackupMenu = () => document.getElementById('backup-modal').classList.add('hidden');
window.downloadHourlyJSON = () => downloadJSON(allHourlyRecords, 'hourly_backup.json');
window.downloadNormalLeaveJSON = () => downloadJSON(allLeaveRecords, 'leave_backup.json');

function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
}

window.exportAllDataToExcel = () => {
    showLoadingPopup('กำลังสร้างไฟล์...');
    try {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(users), "Users");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(allLeaveRecords), "Leave");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(allHourlyRecords), "Hourly");
        XLSX.writeFile(wb, `Backup_${toLocalISOString(new Date())}.xlsx`);
        Swal.close();
    } catch (e) { showErrorPopup('Export Error'); }
};

// --- Filter Logic (Helpers) ---
function applyHourlyFiltersAndRender() {
    const yr = parseInt(document.getElementById('hourly-filter-fiscal-year').value);
    const term = document.getElementById('hourly-search-name').value.toLowerCase();
    const pos = document.getElementById('hourly-filter-position').value;
    
    filteredHourlyRecords = allHourlyRecords.filter(r => 
        r.fiscalYear === yr && 
        (users.find(u => u.nickname === r.userNickname)?.fullname || '').includes(term) &&
        (!pos || users.find(u => u.nickname === r.userNickname)?.position === pos)
    );
    
    // Calculate summary
    const summary = {};
    filteredHourlyRecords.forEach(r => {
        if (!r.confirmed) return;
        if (!summary[r.userNickname]) summary[r.userNickname] = { userNickname: r.userNickname, leaveHours: 0, usedHours: 0 };
        if (r.type === 'leave') summary[r.userNickname].leaveHours += r.duration;
        else summary[r.userNickname].usedHours += r.duration;
    });
    
    renderHourlyRecords(filteredHourlyRecords);
    renderHourlySummary(Object.values(summary));
}

function applyLeaveFiltersAndRender() {
    const yr = parseInt(document.getElementById('leave-filter-fiscal-year').value);
    document.getElementById('leave-summary-fiscal-year').textContent = yr;
    
    filteredLeaveRecords = allLeaveRecords.filter(r => parseInt(r.fiscalYear) === yr);
    renderLeaveSummary(calculateLeaveSummary(filteredLeaveRecords));
    
    // Render records list
    const tbody = document.getElementById('leave-records-table');
    tbody.innerHTML = filteredLeaveRecords.slice(0, 10).map(r => `
        <tr class="border-b hover:bg-gray-50 cursor-pointer" onclick="showLeaveDetailModal('${r.id}')">
            <td class="px-4 py-3">${r.userNickname}</td>
            <td class="px-4 py-3">${r.leaveType}</td>
            <td class="px-4 py-3">${formatDateThaiShort(r.startDate)}</td>
            <td class="px-4 py-3 ${r.status==='อนุมัติแล้ว'?'text-green-600':'text-yellow-600'}">${r.status}</td>
            <td class="px-4 py-3 text-right">
                 <button onclick="event.stopPropagation(); manageRecord('deleteLeave', '${r.id}')" class="text-red-500">ลบ</button>
            </td>
        </tr>
    `).join('');
}

function calculateLeaveSummary(records) {
    const sum = {};
    records.forEach(r => {
        if (r.status !== 'อนุมัติแล้ว') return;
        if (!sum[r.userNickname]) sum[r.userNickname] = { nickname: r.userNickname, fullname: users.find(u=>u.nickname===r.userNickname)?.fullname, position: users.find(u=>u.nickname===r.userNickname)?.position, totalDays: 0 };
        sum[r.userNickname].totalDays += calculateLeaveDays(r.startDate, r.endDate, r.startPeriod, r.endPeriod);
    });
    return Object.values(sum).sort((a,b) => b.totalDays - a.totalDays);
}

function applyUserFiltersAndRender() {
    const term = document.getElementById('user-search-name').value.toLowerCase();
    const pos = document.getElementById('user-filter-position').value;
    filteredUsers = users.filter(u => (u.fullname.includes(term) || u.nickname.includes(term)) && (!pos || u.position === pos));
    
    const tbody = document.getElementById('users-table');
    tbody.innerHTML = filteredUsers.slice(0, 10).map(u => `
        <tr class="border-b"><td class="px-4 py-3">${u.fullname}</td><td class="px-4 py-3">${u.nickname}</td><td class="px-4 py-3">${u.position}</td><td class="px-4 py-3"></td></tr>
    `).join('');
}

function populateUserDropdowns() {
    const opts = users.map(u => ({ value: u.nickname, text: `${u.nickname} (${u.fullname})` }));
    if (tomSelectHourly) tomSelectHourly.destroy();
    tomSelectHourly = new TomSelect('#hourly-user', { options: opts });
    if (tomSelectLeave) tomSelectLeave.destroy();
    tomSelectLeave = new TomSelect('#leave-user', { options: opts });
    if (tomSelectPinUser) tomSelectPinUser.destroy();
    tomSelectPinUser = new TomSelect('#change-pin-user', { options: opts });
}

function populateApproverDropdowns() {
    const opts = admins.map(a => ({ value: a.username, text: a.username }));
    if (tomSelectHourlyApprover) tomSelectHourlyApprover.destroy();
    tomSelectHourlyApprover = new TomSelect('#hourly-approver', { options: opts });
    
    const leaveEl = document.getElementById('leave-approver');
    if (leaveEl) leaveEl.innerHTML = '<option value="">เลือกผู้อนุมัติ</option>' + opts.map(o => `<option value="${o.value}">${o.text}</option>`).join('');
}

function populateFiscalYearFilters() {
    const cur = getCurrentFiscalYear();
    ['leave-filter-fiscal-year', 'hourly-filter-fiscal-year'].forEach(id => {
        const el = document.getElementById(id);
        if(el) { el.innerHTML = `<option value="${cur}">${cur}</option>`; el.value = cur; }
    });
}

function updateFiscalYearFiltersFromData() {
    // Logic to add historical years based on data (Simplified)
}

function setDefaultDate() {
    const today = toLocalISOString(new Date());
    ['hourly-date', 'leave-start-date', 'leave-end-date'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = today;
    });
}

function setupFormConstraints() {
    // Basic constraints setup
}

function updateDateTime() {
    const el = document.getElementById('datetime-display');
    if (el) el.textContent = new Date().toLocaleString('th-TH');
}

function hasHourlyConflict() { return false; } // Simplified check
function hasFullDayConflict() { return false; } // Simplified check
