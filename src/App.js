import React, { useState, useMemo, useEffect } from 'react';
import { Activity, Barcode, LayoutDashboard, History, AlertTriangle, CheckCircle, ArrowRightLeft, ArrowRight, Factory, X, UploadCloud, FileSpreadsheet, Server, Trash2, LogOut, Lock, Download, FileText } from 'lucide-react';

// === FIREBASE CLOUD DATABASE IMPORTS ===
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
// POKA-YOKE: Swapped Firestore for Realtime Database imports. Added 'remove' for data deletion.
import { getDatabase, ref, onValue, set, remove } from 'firebase/database';

// === FIREBASE CONFIGURATION ===
// POKA-YOKE: Handles both local Canvas testing and your future Vercel deployment
const getFirebaseConfig = () => {
  if (typeof __firebase_config !== 'undefined') {
    return JSON.parse(__firebase_config);
  }
  return {
    apiKey: "AIzaSyDKXNIyKPoZ6wKM8BLerJNsC8iw_wclUHI",
  authDomain: "focuz-cloud-mes.firebaseapp.com",
  projectId: "focuz-cloud-mes",
  storageBucket: "focuz-cloud-mes.firebasestorage.app",
  messagingSenderId: "1082764054889",
  appId: "1:1082764054889:web:00d10ea1382f3b7aaf6df8",
  measurementId: "G-V65DL05WJ4"
  };
};

const app = initializeApp(getFirebaseConfig());
const auth = getAuth(app);
// Initialize Realtime Database instead of Firestore
const db = getDatabase(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'focuz-mes-production';

const STAGES = { SMT: 'SMT', PRYSM: 'Prysm', REWORK: 'Rework', COMPLETED: 'Completed' };
const DEFECT_CODES = ['None', 'Solder Bridge', 'Missing Component', 'Tombstoning', 'Shifted Component', 'Failed Functional Test', 'Part Damage', 'Misalignment', 'Non-Wetting', 'Wrong Part Insert'];

export default function App() {
  // === POKA-YOKE: DYNAMIC CSS LOADER FOR CANVAS ===
  const [tailwindLoaded, setTailwindLoaded] = useState(false);

  useEffect(() => {
    // Fail-Safe: Inject Tailwind CSS via CDN if it's missing in this specific environment
    if (!document.getElementById("tailwind-cdn")) {
      const script = document.createElement("script");
      script.id = "tailwind-cdn";
      script.src = "https://cdn.tailwindcss.com";
      script.onload = () => setTailwindLoaded(true);
      document.head.appendChild(script);
    } else {
      setTailwindLoaded(true);
    }

    // POKA-YOKE: Load PDF Generation Libraries dynamically for the Canvas environment
    if (!document.getElementById("jspdf-script")) {
      const jspdfScript = document.createElement("script");
      jspdfScript.id = "jspdf-script";
      jspdfScript.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      document.head.appendChild(jspdfScript);

      jspdfScript.onload = () => {
        if (!document.getElementById("autotable-script")) {
          const autoTableScript = document.createElement("script");
          autoTableScript.id = "autotable-script";
          autoTableScript.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js";
          document.head.appendChild(autoTableScript);
        }
      };
    }
  }, []);

  // Cloud State
  const [user, setUser] = useState(null);
  const [boards, setBoards] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [isDbConnected, setIsDbConnected] = useState(false);

  // UI State
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showReworkModal, setShowReworkModal] = useState(false);
  const [toast, setToast] = useState(null); // Replaces browser alerts
  const [txToDelete, setTxToDelete] = useState(null); 
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false); // NEW: State for mass deletion

  // === NEW: POKA-YOKE SECURITY GATE STATE ===
  const [isAppLocked, setIsAppLocked] = useState(() => {
    return localStorage.getItem('focuz_mes_auth') !== 'true';
  });
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');

  // === NEW: TRACEABILITY LOG FILTERS ===
  const [filterAction, setFilterAction] = useState('All');
  const [filterRoute, setFilterRoute] = useState('All');

  // Form State
  const [scanSn, setScanSn] = useState('');
  const [scanAction, setScanAction] = useState('Transfer to Prysm');
  const [scanDefect, setScanDefect] = useState('None');
  const [scanLocation, setScanLocation] = useState('');
  const [uploadMode, setUploadMode] = useState('manual');
  const [bulkAction, setBulkAction] = useState('Transfer to Prysm');

  // === NEW: HUMAN-READABLE ROLE IDENTIFICATION ===
  const [operatorRole, setOperatorRole] = useState(() => {
    // Poka-Yoke: Remember the last selected role on this specific device
    return localStorage.getItem('focuz_operator_role') || 'SMT-Operator';
  });

  useEffect(() => {
    localStorage.setItem('focuz_operator_role', operatorRole);
  }, [operatorRole]);

  const ROLE_OPTIONS = ['SMT-Operator', 'SMT-Engineer', 'PRYSM-Engineer', 'PRYSM-Tester'];

  // Helper to show on-screen notifications instead of freezing the app with alert()
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  // === NEW: IPC-1782 STANDARDIZED TIMESTAMP FORMATTER ===
  // Converts any localized browser time into a strict 24-hour format (DD/MM/YYYY HH:MM:SS)
  const formatTimestamp = (dateString) => {
    try {
      const d = new Date(dateString);
      if (isNaN(d.getTime())) return dateString; // Fallback if invalid data exists
      return d.toLocaleString('en-GB', { 
        year: 'numeric', month: '2-digit', day: '2-digit', 
        hour: '2-digit', minute: '2-digit', second: '2-digit', 
        hour12: false 
      }).replace(',', '');
    } catch {
      return dateString;
    }
  };

  // === SEPARATED LOGIN & LOGOUT LOGIC ===
  const handleLogin = (e) => {
    e.preventDefault();
    const userLower = loginUser.toLowerCase();
    
    // Front-line security gate with separated credentials for SMT vs PRYSM
    if (userLower === 'smt' && loginPass === 'smt') {
      setIsAppLocked(false);
      setLoginError('');
      localStorage.setItem('focuz_mes_auth', 'true');
      setOperatorRole('SMT-Engineer'); // Poka-Yoke: Auto-assign role to prevent mismatch
    } else if (userLower === 'prysm' && loginPass === 'prysm') {
      setIsAppLocked(false);
      setLoginError('');
      localStorage.setItem('focuz_mes_auth', 'true');
      setOperatorRole('PRYSM-Engineer'); // Poka-Yoke: Auto-assign role to prevent mismatch
    } else {
      setLoginError('Unauthorized: Invalid Station Credentials');
    }
  };

  const handleLogout = () => {
    setIsAppLocked(true);
    localStorage.removeItem('focuz_mes_auth');
    setLoginUser('');
    setLoginPass('');
  };

  // === SIX SIGMA CONTROL PHASE: STRICT AUTHENTICATION GATE ===
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Authentication Failed:", err);
      }
    };
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  // === REAL-TIME DATA SYNCHRONIZATION (IPC-1782 COMPLIANT) ===
  useEffect(() => {
    if (!user) return; // Guard clause: Stop if not authenticated

    // 1. Subscribe to the Master Board Roster (Realtime DB Format)
    const boardsRef = ref(db, `artifacts/${appId}/public/data/boards`);
    const unsubBoards = onValue(boardsRef, (snapshot) => {
      const data = snapshot.val();
      const activeBoards = data ? Object.values(data) : [];
      setBoards(activeBoards);
      setIsDbConnected(true);
    }, (error) => {
      console.error("Database connection lost (Boards):", error);
      setIsDbConnected(false);
    });

    // 2. Subscribe to the Traceability Ledger (Realtime DB Format)
    const txRef = ref(db, `artifacts/${appId}/public/data/transactions`);
    const unsubTx = onValue(txRef, (snapshot) => {
      const data = snapshot.val();
      const txHistory = data ? Object.values(data) : [];
      // Sort newest to oldest
      txHistory.sort((a, b) => b.id - a.id);
      setTransactions(txHistory);
    }, (error) => {
      console.error("Database connection lost (Transactions):", error);
    });

    return () => {
      // Unsubscribe listeners for Realtime DB
      unsubBoards();
      unsubTx();
    };
  }, [user]);

  // Computed Metrics
  const metrics = useMemo(() => {
    return {
      total: boards.length,
      smt: boards.filter(b => b.currentStage === STAGES.SMT).length,
      prysm: boards.filter(b => b.currentStage === STAGES.PRYSM).length,
      rework: boards.filter(b => b.currentStage === STAGES.REWORK).length,
      completed: boards.filter(b => b.currentStage === STAGES.COMPLETED).length,
      highRework: [...boards].sort((a, b) => b.reworkCycles - a.reworkCycles).slice(0, 5)
    };
  }, [boards]);

  // Detailed list of boards currently in rework
  const activeReworkBoards = useMemo(() => {
    return boards
      .filter(b => b.currentStage === STAGES.REWORK)
      .map(board => {
        const defectTx = [...transactions]
          .find(tx => tx.sn === board.sn && tx.to === STAGES.REWORK);
        
        return {
          ...board,
          defectReason: defectTx ? defectTx.defect : 'Unknown',
          defectLocation: defectTx ? defectTx.location : 'N/A',
          dateQuarantined: defectTx ? defectTx.timestamp : 'Unknown'
        };
      });
  }, [boards, transactions]);

  // === MASS DATA INGESTION (CLOUD UPLOAD) ===
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target.result;
      const rows = text.split('\n').map(row => row.trim()).filter(row => row.length > 0);
      
      if (rows.length < 2) {
        showToast("QUALITY ALERT: File appears empty or missing headers.", "error");
        return;
      }

      let successCount = 0;
      let errorCount = 0;
      const promises = [];

      for (let i = 1; i < rows.length; i++) {
        const cols = rows[i].split(',');
        const rawSn = cols[0] ? cols[0].trim().toUpperCase() : '';
        const rawDefect = cols[1] ? cols[1].trim() : 'Unknown';
        const rawLocation = cols[2] ? cols[2].trim() : 'N/A';

        // Poka-Yoke Gate
        const barcodePattern = /^\d{4}-F\d{4,}$/i; 
        if (!barcodePattern.test(rawSn)) {
          errorCount++;
          continue; 
        }

        let board = boards.find(b => b.sn === rawSn) || { sn: rawSn, product: 'Prysm', currentStage: STAGES.SMT, reworkCycles: 0 };
        
        let fromStage = board.currentStage || STAGES.SMT;
        let toStage = board.currentStage;
        let actionLabel = 'Scanned';
        let finalDefect = 'None';
        let finalLocation = 'N/A';

        if (bulkAction === 'Transfer to Prysm') {
          toStage = STAGES.PRYSM; actionLabel = 'Transferred';
        } else if (bulkAction === 'Return for Rework') {
          toStage = STAGES.REWORK; actionLabel = 'Defect Found (Bulk)';
          board.reworkCycles = (board.reworkCycles || 0) + 1;
          finalDefect = rawDefect;
          finalLocation = rawLocation;
        } else if (bulkAction === 'Complete Product') {
          toStage = STAGES.COMPLETED; actionLabel = 'Passed Test';
        } else if (bulkAction === 'Receive from Rework') {
          toStage = STAGES.PRYSM; actionLabel = 'Rework Completed';
        }

        board.currentStage = toStage;

        const txId = Date.now() + i;
        const newTx = {
          id: txId,
          sn: rawSn,
          timestamp: formatTimestamp(new Date()), // UPDATED: Strict standard time
          from: fromStage,
          to: toStage,
          action: actionLabel,
          user: operatorRole, 
          defect: finalDefect,
          location: finalLocation
        };

        // Push commands to cloud batch (Realtime DB Format)
        const boardDocRef = ref(db, `artifacts/${appId}/public/data/boards/${board.sn}`);
        const txDocRef = ref(db, `artifacts/${appId}/public/data/transactions/${txId}`);
        
        promises.push(set(boardDocRef, board));
        promises.push(set(txDocRef, newTx));
        successCount++;
      }

      try {
        await Promise.all(promises);
        showToast(`Upload Complete: ${successCount} boards routed. ${errorCount} rejected formats.`);
      } catch (err) {
        console.error(err);
        showToast("Database Error: Failed to complete bulk upload.", "error");
      }
      e.target.value = ''; 
    };
    reader.readAsText(file);
  };

  // === MANUAL SCAN HANDLER (CLOUD WRITE) ===
  const handleScanSubmit = async (e) => {
    e.preventDefault();
    if (!scanSn) return;

    const barcodePattern = /^\d{4}-F\d{4,}$/i; 
    if (!barcodePattern.test(scanSn)) {
      showToast(`Invalid Barcode (${scanSn}). Must be YYWW-Fxxxx.`, 'error');
      setScanSn(''); 
      return; 
    }

    let board = boards.find(b => b.sn === scanSn) || { sn: scanSn, product: 'Prysm', currentStage: STAGES.SMT, reworkCycles: 0 };
    
    let fromStage = board.currentStage || STAGES.SMT;
    let toStage = board.currentStage;
    let actionLabel = 'Scanned';

    if (scanAction === 'Transfer to Prysm') {
      toStage = STAGES.PRYSM; actionLabel = 'Transferred';
    } else if (scanAction === 'Return for Rework') {
      toStage = STAGES.REWORK; actionLabel = 'Defect Found';
      board.reworkCycles = (board.reworkCycles || 0) + 1;
    } else if (scanAction === 'Complete Product') {
      toStage = STAGES.COMPLETED; actionLabel = 'Passed Test';
    } else if (scanAction === 'Receive from Rework') {
      toStage = STAGES.PRYSM; actionLabel = 'Rework Completed';
    }

    board.currentStage = toStage;

    const txId = Date.now();
    const newTx = {
      id: txId,
      sn: scanSn,
      timestamp: formatTimestamp(new Date()), // UPDATED: Strict standard time
      from: fromStage,
      to: toStage,
      action: actionLabel,
      user: operatorRole, 
      defect: scanAction === 'Return for Rework' ? scanDefect : 'None',
      location: scanAction === 'Return for Rework' ? scanLocation || 'N/A' : 'N/A'
    };

    try {
      // Write to Cloud (Realtime DB Format)
      const boardDocRef = ref(db, `artifacts/${appId}/public/data/boards/${board.sn}`);
      const txDocRef = ref(db, `artifacts/${appId}/public/data/transactions/${txId}`);
      
      await set(boardDocRef, board);
      await set(txDocRef, newTx);
      
      setScanSn('');
      setScanLocation('');
      showToast(`Success: ${scanSn} routed to ${toStage}`);
    } catch (err) {
      console.error(err);
      showToast("Cloud Connection Error: Check network.", "error");
    }
  };

  // === SINGLE DELETE TRANSACTION LOGIC ===
  const confirmDeleteTransaction = async () => {
    if (!txToDelete) return;
    try {
      const txDocRef = ref(db, `artifacts/${appId}/public/data/transactions/${txToDelete.id}`);
      await remove(txDocRef);

      // === RELATIONAL DATA INTEGRITY (ROLLBACK) ===
      // Find all remaining transactions for this specific board
      const remainingTx = transactions.filter(t => t.sn === txToDelete.sn && t.id !== txToDelete.id);
      const boardDocRef = ref(db, `artifacts/${appId}/public/data/boards/${txToDelete.sn}`);

      if (remainingTx.length === 0) {
        // Condition A: If we deleted the very first scan, erase the board from the dashboard completely
        await remove(boardDocRef);
      } else {
        // Condition B: If older scans exist, roll the board's status back to its previous state
        const sortedRemaining = [...remainingTx].sort((a, b) => b.id - a.id);
        const latestTx = sortedRemaining[0]; // The new "most recent" scan
        
        // Recalculate rework cycles
        const reworkCount = sortedRemaining.filter(t => t.to === STAGES.REWORK).length;

        const updatedBoard = {
          sn: txToDelete.sn,
          product: 'Prysm', 
          currentStage: latestTx.to,
          reworkCycles: reworkCount
        };
        await set(boardDocRef, updatedBoard);
      }

      showToast(`Success: Transaction log deleted and dashboard synchronized.`);
    } catch (err) {
      console.error(err);
      showToast("Database Error: Failed to delete record.", "error");
    } finally {
      setTxToDelete(null); // Close the modal
    }
  };

  // === NEW: MASS DELETE LOGIC ===
  const confirmDeleteAll = async () => {
    try {
      // POKA-YOKE: We must wipe both the Trace Log and the Dashboard (Boards) simultaneously
      // to prevent "Orphan Data" and maintain strict Relational Data Integrity.
      const txRef = ref(db, `artifacts/${appId}/public/data/transactions`);
      const boardsRef = ref(db, `artifacts/${appId}/public/data/boards`);
      
      await remove(txRef);
      await remove(boardsRef);
      
      showToast("Success: All data has been permanently erased from the Cloud.");
    } catch (err) {
      console.error(err);
      showToast("Database Error: Failed to clear database.", "error");
    } finally {
      setShowDeleteAllModal(false);
    }
  };

  const renderDashboard = () => (
    <div className="space-y-6 relative">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">Production Overview</h2>
        <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold ${isDbConnected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          <Server size={14} />
          {isDbConnected ? 'Cloud Sync Active' : 'Disconnected'}
        </div>
      </div>
      
      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center border-b-4 border-b-orange-500">
          <span className="text-gray-500 text-sm font-semibold">Total Tracked</span>
          <span className="text-3xl font-bold text-orange-600">{metrics.total}</span>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center border-b-4 border-b-gray-400">
          <span className="text-gray-500 text-sm font-semibold">In SMT</span>
          <span className="text-3xl font-bold text-gray-800">{metrics.smt}</span>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center border-b-4 border-b-gray-400">
          <span className="text-gray-500 text-sm font-semibold">In Prysm</span>
          <span className="text-3xl font-bold text-gray-800">{metrics.prysm}</span>
        </div>
        
        {/* INTERACTIVE REWORK CARD */}
        <div 
          onClick={() => setShowReworkModal(true)}
          className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center border-b-4 border-b-red-500 cursor-pointer hover:bg-red-100 transition-colors group relative"
          title="Click to view boards currently in rework"
        >
          <span className="text-red-700 text-sm font-semibold flex items-center gap-1">
             In Rework (SMT)
          </span>
          <span className="text-3xl font-bold text-red-700">{metrics.rework}</span>
          <span className="text-[10px] text-red-500 font-bold uppercase tracking-wider mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
            Click for Details
          </span>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center border-b-4 border-b-green-400">
          <span className="text-gray-500 text-sm font-semibold">Completed</span>
          <span className="text-3xl font-bold text-green-600">{metrics.completed}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[calc(100vh-280px)] min-h-[400px]">
        {/* Recent Activity */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-col">
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2 shrink-0">
            <Activity size={20} className="text-blue-500"/> Live Cloud Movements
          </h3>
          <div className="space-y-3 overflow-y-auto flex-1 pr-2">
            {transactions.length === 0 ? (
              <div className="text-center text-gray-400 italic py-10">Awaiting initial scans...</div>
            ) : (
              transactions.slice(0, 10).map(tx => (
                <div key={tx.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg text-sm">
                  <div>
                    <div className="font-bold text-gray-700">{tx.sn}</div>
                    <div className="text-gray-500 text-xs">{formatTimestamp(tx.timestamp)}</div>
                  </div>
                  <div className="flex flex-col items-end">
                    <div className="flex items-center gap-2 text-gray-600 mb-1">
                      <span className="bg-gray-200 px-2 py-1 rounded text-xs">{tx.from}</span>
                      <ArrowRight size={14} />
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${tx.to === STAGES.REWORK ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'}`}>{tx.to}</span>
                    </div>
                    {tx.location !== 'N/A' && (
                       <span className="text-[10px] text-red-500 font-bold bg-red-50 px-2 rounded-sm border border-red-100">
                         Loc: {tx.location}
                       </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* High Rework Boards */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-col">
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2 shrink-0">
            <AlertTriangle size={20} className="text-orange-500"/> High Rework Attention
          </h3>
          <div className="overflow-y-auto flex-1 pr-2">
            <table className="w-full text-left text-sm relative">
              <thead className="bg-gray-50 text-gray-600 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="p-2 rounded-tl-lg bg-gray-50">Serial Number</th>
                  <th className="p-2 bg-gray-50">Current Stage</th>
                  <th className="p-2 rounded-tr-lg bg-gray-50">Rework Cycles</th>
                </tr>
              </thead>
              <tbody>
                {metrics.highRework.length === 0 ? (
                  <tr><td colSpan="3" className="text-center text-gray-400 italic py-6">No rework data yet.</td></tr>
                ) : (
                  metrics.highRework.map(b => (
                    <tr key={b.sn} className="border-b border-gray-50">
                      <td className="p-2 font-medium">{b.sn}</td>
                      <td className="p-2">
                        <span className={b.currentStage === STAGES.REWORK ? 'text-red-600 font-bold' : ''}>{b.currentStage}</span>
                      </td>
                      <td className="p-2">
                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${b.reworkCycles > 1 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                          {b.reworkCycles} Cycles
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* REWORK DETAILS MODAL (Pop-up) */}
      {showReworkModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[80vh]">
            
            {/* Modal Header */}
            <div className="px-6 py-4 bg-red-50 border-b border-red-100 flex justify-between items-center">
              <div>
                <h3 className="text-xl font-black text-red-700 flex items-center gap-2">
                  <AlertTriangle size={24} /> 
                  Active Rework Quarantine Queue
                </h3>
                <p className="text-red-500 text-sm font-medium mt-1">Current WIP: {activeReworkBoards.length} Units pending repair in SMT</p>
              </div>
              <button 
                onClick={() => setShowReworkModal(false)}
                className="p-2 text-red-400 hover:text-red-700 hover:bg-red-100 rounded-full transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            {/* Modal Body / Table */}
            <div className="overflow-y-auto p-6">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-600 border-y border-gray-200">
                  <tr>
                    <th className="p-3">Serial Number</th>
                    <th className="p-3">Defect Reason</th>
                    <th className="p-3">Location (Ref Des)</th>
                    <th className="p-3">Date Quarantined</th>
                    <th className="p-3">Cycle Count</th>
                  </tr>
                </thead>
                <tbody>
                  {activeReworkBoards.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="p-6 text-center text-gray-500 italic">No boards currently in rework queue.</td>
                    </tr>
                  ) : (
                    activeReworkBoards.map((board, idx) => (
                      <tr key={board.sn} className={`border-b border-gray-50 hover:bg-red-50/50 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>
                        <td className="p-3 font-bold text-gray-800">{board.sn}</td>
                        <td className="p-3 font-medium text-red-600">{board.defectReason}</td>
                        <td className="p-3">
                           <span className="font-mono bg-red-100 text-red-800 px-2 py-1 rounded text-xs border border-red-200">
                             {board.defectLocation}
                           </span>
                        </td>
                        <td className="p-3 text-gray-600">{board.dateQuarantined}</td>
                        <td className="p-3">
                           <span className="px-2 py-1 rounded bg-gray-200 text-xs font-semibold text-gray-700">
                             {board.reworkCycles}
                           </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button 
                onClick={() => setShowReworkModal(false)}
                className="px-6 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-lg transition-colors"
              >
                Close Window
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderScanner = () => (
    <div className="max-w-2xl mx-auto">
      
      {/* Tab Toggles for Manual vs Bulk Mode */}
      <div className="flex justify-center mb-6 bg-gray-200 p-1 rounded-xl w-fit mx-auto shadow-inner">
        <button 
          onClick={() => setUploadMode('manual')}
          className={`px-6 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${uploadMode === 'manual' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Barcode size={18} /> Manual Scan
        </button>
        <button 
          onClick={() => setUploadMode('bulk')}
          className={`px-6 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${uploadMode === 'bulk' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <FileSpreadsheet size={18} /> CSV Upload
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 md:p-10 transition-all">
        
        {uploadMode === 'manual' ? (
          <>
            <div className="text-center mb-8">
              <div className="inline-block p-4 bg-orange-50 rounded-full mb-4">
                <Barcode size={48} className="text-orange-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-800">Scan & Route Board</h2>
              <p className="text-gray-500 text-sm mt-1">Data saves directly to centralized database</p>
            </div>

            <form onSubmit={handleScanSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Serial Number</label>
                <input 
                  type="text" 
                  autoFocus
                  value={scanSn}
                  onChange={(e) => setScanSn(e.target.value.toUpperCase())}
                  placeholder="e.g. YYWW-F0001"
                  className="w-full text-2xl p-4 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:ring-4 focus:ring-orange-100 outline-none transition-all uppercase"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Action / Route</label>
                  <select 
                    value={scanAction}
                    onChange={(e) => setScanAction(e.target.value)}
                    className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 outline-none bg-white"
                  >
                    <option>Transfer to Prysm</option>
                    <option>Return for Rework</option>
                    <option>Receive from Rework</option>
                    <option>Complete Product</option>
                  </select>
                </div>

                {scanAction === 'Return for Rework' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Defect Reason</label>
                      <select 
                        value={scanDefect}
                        onChange={(e) => setScanDefect(e.target.value)}
                        className="w-full p-3 border-2 border-red-200 rounded-xl focus:border-red-500 outline-none bg-red-50 text-red-900"
                      >
                        {DEFECT_CODES.filter(c => c !== 'None').map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Defect Location Field (Reference Designator) */}
              {scanAction === 'Return for Rework' && (
                <div className="pt-2">
                   <label className="block text-sm font-semibold text-gray-700 mb-1 flex items-center justify-between">
                     <span>Defect Location (Ref Des)</span>
                     <span className="text-xs font-normal text-gray-400">e.g., U2, R31, J2</span>
                   </label>
                   <input 
                     type="text" 
                     value={scanLocation}
                     onChange={(e) => setScanLocation(e.target.value.toUpperCase())}
                     placeholder="Enter exact location..."
                     className="w-full p-3 border-2 border-red-200 rounded-xl focus:border-red-500 outline-none bg-red-50 text-red-900 uppercase placeholder-red-300"
                   />
                </div>
              )}

              <button 
                type="submit"
                className="w-full py-4 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-bold text-lg shadow-lg shadow-orange-200 transition-all flex justify-center items-center gap-2 mt-4"
              >
                <CheckCircle size={24} /> Log Transaction to Cloud
              </button>
            </form>
          </>
        ) : (
          /* BULK UPLOAD VIEW */
          <div className="text-center py-6">
            <div className="inline-block p-4 bg-blue-50 rounded-full mb-6">
              <UploadCloud size={48} className="text-blue-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Cloud CSV Sync</h2>
            <p className="text-gray-500 text-sm mb-6 px-4">
              Select an action below and upload a <b>.CSV</b> file to mass-route boards globally.
            </p>

            {/* Dynamic Bulk Action Selector */}
            <div className="max-w-md mx-auto mb-6 text-left">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Batch Action / Route</label>
              <select 
                value={bulkAction}
                onChange={(e) => setBulkAction(e.target.value)}
                className="w-full p-3 border-2 border-blue-200 rounded-xl focus:border-blue-500 outline-none bg-blue-50 text-blue-900 font-bold"
              >
                <option>Transfer to Prysm</option>
                <option>Return for Rework</option>
                <option>Receive from Rework</option>
                <option>Complete Product</option>
              </select>
            </div>

            <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl p-8 mb-6 relative hover:bg-gray-100 transition-colors">
              <input 
                type="file" 
                accept=".csv"
                onChange={handleFileUpload}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className="flex flex-col items-center justify-center pointer-events-none">
                <span className="text-gray-600 font-bold mb-2">Click to Browse or Drag & Drop</span>
                <span className="text-xs text-gray-400">Supported format: .csv only</span>
              </div>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg text-left text-sm">
              <h4 className="font-bold text-yellow-800 mb-2 flex items-center gap-1">
                <AlertTriangle size={16}/> Required CSV Format (Headers Optional)
              </h4>
              {bulkAction === 'Return for Rework' ? (
                <ul className="list-disc list-inside text-yellow-700 font-mono text-xs space-y-1 ml-1">
                  <li>Column A: Serial Number (e.g., 2544-F0081)</li>
                  <li>Column B: Defect Reason (e.g., Misalignment)</li>
                  <li>Column C: Defect Location (e.g., U2)</li>
                </ul>
              ) : (
                <ul className="list-disc list-inside text-yellow-700 font-mono text-xs space-y-1 ml-1">
                  <li>Column A: Serial Number (e.g., 2522-F0001)</li>
                  <li>Column B: Optional Info</li>
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderHistory = () => {
    // Dynamically generate filter options based on the actual factory data
    const actionOptions = ['All', ...new Set(transactions.map(t => t.action))];
    const routeOptions = ['All', ...new Set(transactions.map(t => `${t.from} \u2192 ${t.to}`))];

    const filteredTx = transactions.filter(tx => {
      const matchesSearch = tx.sn.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            tx.user.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            (tx.location && tx.location.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesAction = filterAction === 'All' || tx.action === filterAction;
      const matchesRoute = filterRoute === 'All' || `${tx.from} \u2192 ${tx.to}` === filterRoute;
      
      return matchesSearch && matchesAction && matchesRoute;
    });

    // === EXPORT TO CSV LOGIC ===
    const handleExportCSV = () => {
      if (filteredTx.length === 0) {
        showToast("No data available to export.", "error");
        return;
      }
      
      const headers = ["Timestamp", "Serial Number", "Action", "From", "To", "Defect Logged", "Location", "Operator ID"];
      const rows = filteredTx.map(tx => [
        `"${formatTimestamp(tx.timestamp)}"`,
        `"${tx.sn}"`,
        `"${tx.action}"`,
        `"${tx.from}"`,
        `"${tx.to}"`,
        `"${tx.defect}"`,
        `"${tx.location}"`,
        `"${tx.user}"`
      ]);

      const csvString = [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
      const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
      
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `Focuz_Traceability_Log_${new Date().toISOString().slice(0,10)}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      showToast("Data exported to Excel (CSV) successfully.");
    };

    // === NEW: EXPORT TO PDF LOGIC ===
    const handleExportPDF = () => {
      if (filteredTx.length === 0) {
        showToast("No data available to export.", "error");
        return;
      }
      
      // Check if the dynamic scripts have finished loading
      if (!window.jspdf || !window.jspdf.jsPDF) {
        showToast("PDF Engine is still loading. Please try again in a few seconds.", "error");
        return;
      }

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();

      // Focuz Branding Header
      doc.setFontSize(18);
      doc.setTextColor(224, 70, 22); // Focuz Orange
      doc.text("Focuz Manufacturing Services", 14, 20);
      
      // Sub-header & Report Metadata
      doc.setFontSize(12);
      doc.setTextColor(71, 85, 105); // Slate 600
      
      doc.setFontSize(10);
      doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 34);

      // Format Data for the AutoTable Plugin
      const tableData = filteredTx.map(tx => [
        formatTimestamp(tx.timestamp),
        tx.sn,
        tx.action,
        `${tx.from} -> ${tx.to}`,
        tx.defect !== 'None' ? tx.defect : '-',
        tx.location !== 'N/A' ? tx.location : '-',
        tx.user
      ]);

      // Generate the stylized table
      doc.autoTable({
        head: [['Time', 'Serial Number', 'Action', 'Route', 'Defect', 'Loc', 'Operator ID']],
        body: tableData,
        startY: 45,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [224, 70, 22], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { top: 45 }
      });

      doc.save(`Focuz_Traceability_Report_${new Date().toISOString().slice(0,10)}.pdf`);
      showToast("Traceability Report (PDF) generated successfully.");
    };

    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 relative">
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-6 gap-4">
          <h2 className="text-2xl font-bold text-gray-800 shrink-0">Traceability</h2>
          
          <div className="flex flex-col md:flex-row gap-3 w-full xl:w-auto items-center flex-wrap xl:flex-nowrap">
            {/* ACTION FILTER */}
            <select 
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              className="p-2 border border-gray-200 rounded-lg text-sm focus:border-orange-500 outline-none bg-gray-50 font-medium text-gray-700 w-full md:w-auto"
              title="Filter by Action"
            >
              <option value="All">All Actions</option>
              {actionOptions.filter(opt => opt !== 'All').map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
            
            {/* ROUTE FILTER */}
            <select 
              value={filterRoute}
              onChange={(e) => setFilterRoute(e.target.value)}
              className="p-2 border border-gray-200 rounded-lg text-sm focus:border-orange-500 outline-none bg-gray-50 font-medium text-gray-700 w-full md:w-auto"
              title="Filter by Route"
            >
              <option value="All">All Routes</option>
              {routeOptions.filter(opt => opt !== 'All').map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>

            <input 
              type="text" 
              placeholder="Search SN, Operator, or Loc..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="p-2 border border-gray-200 rounded-lg w-full md:w-52 focus:border-orange-500 outline-none text-sm"
            />

            {/* ACTION BUTTONS: Export & Delete */}
            <div className="flex gap-2 w-full md:w-auto mt-2 md:mt-0">
              <button 
                onClick={handleExportCSV}
                className="flex-1 md:flex-none p-2 bg-green-50 text-green-700 border border-green-200 rounded-lg text-sm font-bold flex items-center justify-center gap-2 hover:bg-green-100 transition-colors"
                title="Export Data to Excel (CSV)"
              >
                <FileSpreadsheet size={16} /> CSV
              </button>
              
              <button 
                onClick={handleExportPDF}
                className="flex-1 md:flex-none p-2 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm font-bold flex items-center justify-center gap-2 hover:bg-blue-100 transition-colors"
                title="Generate Audit Report (PDF)"
              >
                <FileText size={16} /> PDF
              </button>

              <button 
                onClick={() => setShowDeleteAllModal(true)}
                className="flex-1 md:flex-none p-2 bg-gray-50 text-gray-700 border border-gray-200 rounded-lg text-sm font-bold flex items-center justify-center gap-2 hover:bg-red-100 transition-colors"
                title="Permanently Erase ALL Data"
              >
                <Trash2 size={16} /> All
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto border border-gray-100 rounded-lg">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 bg-gray-50">Time</th>
                <th className="px-3 py-2 bg-gray-50">Serial Number</th>
                <th className="px-3 py-2 bg-gray-50">Action</th>
                <th className="px-3 py-2 bg-gray-50">From &rarr; To</th>
                <th className="px-3 py-2 bg-gray-50">Defect Logged</th>
                <th className="px-3 py-2 bg-gray-50">Location (Ref Des)</th>
                <th className="px-3 py-2 bg-gray-50">User/Auth ID</th>
                <th className="px-3 py-2 text-center bg-gray-50">Delete</th>
              </tr>
            </thead>
            <tbody>
              {filteredTx.length === 0 ? (
                <tr><td colSpan="8" className="text-center py-8 text-gray-400">No records match your filters.</td></tr>
              ) : (
                filteredTx.map(tx => (
                  <tr key={tx.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-3 py-1.5 text-gray-500 font-mono text-xs">{formatTimestamp(tx.timestamp)}</td>
                    <td className="px-3 py-1.5 font-bold text-gray-800">{tx.sn}</td>
                    <td className="px-3 py-1.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold
                        ${tx.action.includes('Defect') ? 'bg-red-100 text-red-700' : 
                          tx.action.includes('Passed') ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                        {tx.action}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-gray-600 flex items-center gap-1">
                      {tx.from} <ArrowRight size={12}/> {tx.to}
                    </td>
                    <td className="px-3 py-1.5">{tx.defect !== 'None' ? <span className="text-red-600 font-medium">{tx.defect}</span> : '-'}</td>
                    <td className="px-3 py-1.5">
                      {tx.location !== 'N/A' ? (
                         <span className="font-mono bg-red-100 text-red-800 px-2 py-0.5 rounded text-xs border border-red-200">
                           {tx.location}
                         </span>
                      ) : '-'}
                    </td>
                    <td className="px-3 py-1.5 text-gray-600 font-mono text-xs" title={tx.user}>{tx.user.length > 15 ? tx.user.substring(0, 15) + '...' : tx.user}</td>
                    <td className="px-3 py-1.5 text-center">
                       {/* POKA-YOKE: Trigger verification modal instead of immediate deletion */}
                       <button 
                         onClick={() => setTxToDelete(tx)}
                         className="p-1.5 bg-gray-100 hover:bg-red-100 text-gray-400 hover:text-red-600 rounded-lg transition-colors"
                         title="Delete Record"
                       >
                         <Trash2 size={16} />
                       </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // Halt rendering until CSS is ready (Poka-Yoke for Canvas specifically)
  if (!tailwindLoaded) {
    return (
      <div style={{ padding: '40px', fontFamily: 'sans-serif', textAlign: 'center', color: '#334155' }}>
        <h2>Initializing Visual Environment...</h2>
        <p>Loading Tailwind CSS Engine, please wait.</p>
      </div>
    );
  }

  // === RENDER LOGIN SCREEN IF LOCKED ===
  if (isAppLocked) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans relative z-0">
        
        {/* Decorative Background Element (Replaces the empty void) */}
        <div className="absolute top-0 left-0 w-full h-96 bg-orange-600 transform -skew-y-2 origin-top-left -z-10 shadow-lg"></div>

        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col border border-gray-100 z-10">
          
          {/* Redesigned Clean White Header with Official Focuz Logo */}
          <div className="p-8 border-b border-gray-100 flex flex-col items-start bg-white">
            <svg viewBox="0 0 280 60" className="h-12 w-auto mb-4" xmlns="http://www.w3.org/2000/svg">
              <polygon points="0,60 15,0 35,0 20,60" fill="#e04616" />
              <text x="45" y="40" fontFamily="Georgia, serif" fontStyle="italic" fontWeight="bold" fontSize="42" fill="#e04616">Focuz</text>
              <text x="50" y="55" fontFamily="Arial, sans-serif" fontWeight="bold" fontSize="11" fill="#475569" letterSpacing="1">MANUFACTURING SERVICES</text>
            </svg>
            <h1 className="text-xl font-black tracking-tight text-slate-800">Secure MES Portal</h1>
            <p className="text-orange-600 text-xs font-bold uppercase tracking-wider mt-1 flex items-center gap-1">
              <Lock size={12} /> Authorized Access Only
            </p>
          </div>
          
          <form onSubmit={handleLogin} className="p-8 space-y-6 bg-slate-50/50">
            {loginError && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-bold flex items-center gap-2 border border-red-100">
                <AlertTriangle size={16} />
                {loginError}
              </div>
            )}
            
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Station ID / Username</label>
              <input 
                type="text" 
                value={loginUser}
                onChange={(e) => setLoginUser(e.target.value)}
                className="w-full p-3 pl-4 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:ring-4 focus:ring-orange-100 outline-none transition-all"
                placeholder="e.g., smt or prysm"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Passcode</label>
              <input 
                type="password" 
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
                className="w-full p-3 pl-4 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:ring-4 focus:ring-orange-100 outline-none transition-all"
                placeholder="••••••"
                required
              />
            </div>
            
            <button 
              type="submit"
              className="w-full py-4 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-bold text-lg shadow-lg shadow-orange-200 transition-all flex justify-center items-center gap-2"
            >
              Access Dashboard <ArrowRight size={20} />
            </button>
          </form>
          
          <div className="p-4 bg-gray-50 text-center border-t border-gray-100 flex justify-between items-center px-8">
             <span className="text-xs text-gray-400 font-medium">IPC-1782 Compliant</span>
             <span className="text-xs text-gray-400 font-medium">v1.2.0</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row font-sans relative">
      
      {/* CUSTOM TOAST NOTIFICATION (Replaces browser alert) */}
      {toast && (
        <div className={`fixed top-4 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-lg shadow-xl z-50 flex items-center gap-2 font-bold text-sm ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>
          {toast.type === 'error' ? <AlertTriangle size={18} /> : <CheckCircle size={18} />}
          {toast.message}
        </div>
      )}

      {/* SINGLE DELETE CONFIRMATION MODAL (Poka-Yoke Gate) */}
      {txToDelete && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-[60] p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col">
            <div className="p-6 text-center">
              <div className="mx-auto w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4">
                <AlertTriangle size={32} />
              </div>
              <h3 className="text-2xl font-black text-gray-800 mb-2">Confirm Deletion</h3>
              <p className="text-gray-600 text-sm mb-4">
                Are you sure you want to permanently delete the log for <span className="font-bold text-red-600">{txToDelete.sn}</span>? This will remove the traceability record from the global database.
              </p>
              
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-left text-xs text-gray-500 font-mono mb-6">
                <p><strong>Action:</strong> {txToDelete.action}</p>
                <p><strong>Timestamp:</strong> {txToDelete.timestamp}</p>
                <p><strong>Operator ID:</strong> {txToDelete.user}</p>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setTxToDelete(null)}
                  className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmDeleteTransaction}
                  className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-lg shadow-red-200 transition-colors flex items-center justify-center gap-2"
                >
                  <Trash2 size={18} /> Delete Record
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* NEW: MASS DELETE ALL CONFIRMATION MODAL (Strict Poka-Yoke) */}
      {showDeleteAllModal && (
        <div className="fixed inset-0 bg-slate-900/80 flex items-center justify-center z-[70] p-4 backdrop-blur-md">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col border-4 border-red-500">
            <div className="p-6 text-center">
              <div className="mx-auto w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4 border-4 border-red-200">
                <AlertTriangle size={40} />
              </div>
              <h3 className="text-3xl font-black text-gray-900 mb-2 uppercase">Critical Warning</h3>
              <p className="text-red-600 text-sm mb-6 font-bold px-4">
                You are about to permanently delete <span className="underline">ALL</span> Traceability Logs and Dashboard metrics.
              </p>

              <div className="flex flex-col gap-3">
                <button 
                  onClick={confirmDeleteAll}
                  className="w-full py-4 bg-red-600 hover:bg-red-700 text-white font-black rounded-xl shadow-lg shadow-red-200 transition-colors flex items-center justify-center gap-2 uppercase tracking-wide"
                >
                  <Trash2 size={20} /> I Understand, Erase All Data
                </button>
                <button 
                  onClick={() => setShowDeleteAllModal(false)}
                  className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold rounded-xl transition-colors"
                >
                  Cancel / Return
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar Navigation */}
      <nav className="w-full md:w-64 bg-white border-r border-gray-200 text-slate-800 flex flex-col shadow-sm z-10">
        <div className="p-6 border-b border-gray-100 flex flex-col items-start">
          <svg viewBox="0 0 280 60" className="h-12 w-auto mb-4" xmlns="http://www.w3.org/2000/svg">
            <polygon points="0,60 15,0 35,0 20,60" fill="#e04616" />
            <text x="45" y="40" fontFamily="Georgia, serif" fontStyle="italic" fontWeight="bold" fontSize="42" fill="#e04616">Focuz</text>
            <text x="50" y="55" fontFamily="Arial, sans-serif" fontWeight="bold" fontSize="11" fill="#475569" letterSpacing="1">MANUFACTURING SERVICES</text>
          </svg>
          <h1 className="text-lg font-black tracking-tight text-slate-800">Focuz Tracking System</h1>
          <p className="text-orange-600 text-xs font-bold uppercase tracking-wider mt-1">Quality Control</p>
        </div>
        
        <div className="flex-1 px-4 py-6 space-y-2">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors font-medium ${activeTab === 'dashboard' ? 'bg-orange-50 text-orange-700 border border-orange-100 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <Activity size={20} /> Dashboard
          </button>
          <button 
            onClick={() => setActiveTab('scan')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors font-medium ${activeTab === 'scan' ? 'bg-orange-50 text-orange-700 border border-orange-100 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <Barcode size={20} /> Scan / Action
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors font-medium ${activeTab === 'history' ? 'bg-orange-50 text-orange-700 border border-orange-100 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <History size={20} /> Traceability Log
          </button>
        </div>

        {/* Multi-User Identify Tag */}
        <div className="p-4 border-t border-gray-100 text-sm">
           <p className="font-bold text-gray-700 mb-2">Station Assignment:</p>
           <select 
             value={operatorRole}
             onChange={(e) => setOperatorRole(e.target.value)}
             className="w-full p-2 border-2 border-orange-200 rounded-lg focus:border-orange-500 outline-none bg-orange-50 text-orange-900 font-bold text-xs"
           >
             {ROLE_OPTIONS.map(role => <option key={role} value={role}>{role}</option>)}
           </select>
        </div>

        {/* LOGOUT BUTTON */}
        <div className="p-4 border-t border-gray-100">
           <button 
             onClick={handleLogout}
             className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-colors font-bold text-sm"
           >
             <LogOut size={16} /> Logout
           </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 p-6 md:p-10 overflow-y-auto">
        {activeTab === 'dashboard' && renderDashboard()}
        {activeTab === 'scan' && renderScanner()}
        {activeTab === 'history' && renderHistory()}
      </main>
    </div>
  );
}
