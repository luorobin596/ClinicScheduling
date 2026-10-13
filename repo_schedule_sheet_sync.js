/**
 * repo_schedule_to_sheet.gs
 * 資料輸出層 - 將排班結果寫入前台顯示用 Sheet
 * * 2026-01-29 更新：
 * 1. 修正資料讀取漏洞：現在會掃描 Slot 1~4，解決 FT004 資料遺漏問題。
 * 2. 修正寫入範圍判定：改為掃描日期欄位，遇到非數字即停止，保護下方統計公式不被覆蓋。
 */

/**
 * 主入口：將指定 RunID 的排班結果輸出到前台
 * @param {string|Date} runIdInput - 支援傳入 "2026-02" 或 Date 物件
 */
function exportScheduleToFrontend(runIdInput) {
  // --- 標準化 RunID ---
  let runId = "";
  if (runIdInput instanceof Date) {
    // 如果是 Date 物件，轉成 "yyyy-MM"
    runId = Utilities.formatDate(runIdInput, Session.getScriptTimeZone(), "yyyy-MM");
  } else {
    // 如果是字串，確保沒有空白
    runId = String(runIdInput).trim();
  }
  
  console.log(`[Export] 開始執行匯出，原始輸入: ${runIdInput}, 目標 RunID: ${runId}`);
  
  // 1. 檢查 Config
  if (!CONFIG.FRONTEND_SPREADSHEET_ID) {
    throw new Error("❌ 設定錯誤：找不到前台 Sheet ID (CONFIG.FRONTEND_SPREADSHEET_ID)");
  }
  const ssFrontend = SpreadsheetApp.openById(CONFIG.FRONTEND_SPREADSHEET_ID);
  
  // 2. 計算並鎖定工作表 (例如 "115.2")
  const sheetName = _convertRunIdToMinguo(runId);
  const targetSheet = ssFrontend.getSheetByName(sheetName);
  
  if (!targetSheet) {
    throw new Error(`❌ 找不到前台工作表：${sheetName}。請確認工作表是否存在。`);
  }
  console.log(`[Export] 鎖定工作表: ${sheetName}`);

  // 3. 準備資料
  const staffMap = _getStaffIdToNameMap(); // ID -> 中文名
  
  // ★ 修正點 1: 這裡會正確抓取 Slot 1~4 的所有人
  const aggregatedData = _fetchAndAggregateData(runId, staffMap); 
  
  const dataCount = Object.keys(aggregatedData).length;
  console.log(`[Export] 撈取後台資料完成: 共 ${dataCount} 天有資料`);
  
  if (dataCount === 0) {
    console.warn("⚠️ 警告：後台沒有撈到任何符合資料，請檢查 RunID 是否正確。");
    return;
  }

  // 4. 執行寫入
  // ★ 修正點 2: 這裡會保護下方公式
  _writeToFrontendSheet(targetSheet, aggregatedData, runId);
  
  console.log(`[Export] ✅ 成功寫入前台工作表 ${sheetName}`);
}

/**
 * 內部邏輯：撈取後台資料並聚合
 * 修正：支援 Slot 1 ~ Slot 4 多人讀取
 * 手術修改：新增 gapCollection 用於統計每日缺班，並防止重複計算
 */
function _fetchAndAggregateData(runId, staffMap) {
  const ssDb = getDbSpreadsheet();
  const sheetDb = ssDb.getSheetByName(CONFIG.SHEET_NAMES.SCHEDULE_OUTPUT);
  const data = sheetDb.getDataRange().getValues();
  
  const result = {};
  
  // ★ 用來避免 Gap 重複計算的追蹤器
  // Key 格式: "yyyy-MM-dd_Shift_Station" (例如 "2026-02-02_B_ORTHO")
  const processedGaps = new Set();

  // 跳過標題列，從第 3 列開始
  for (let i = 2; i < data.length; i++) {
    const row = data[i];
    
    // [0]RunID, [1]Date, [2]Shift, [3-6]Slots, [7]Offs, [8]Gap, ... [12]Station
    
    // 處理 RunID
    let rowRunId = row[0];
    if (rowRunId instanceof Date) {
      rowRunId = Utilities.formatDate(rowRunId, Session.getScriptTimeZone(), "yyyy-MM");
    } else {
      rowRunId = String(rowRunId).trim();
    }

    if (rowRunId !== runId) continue;

    const dateObj = new Date(row[1]);
    const dateStr = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "yyyy-MM-dd");
    const shift = row[2];      
    const gap = row[8];      // ★ I欄: current_gap
    const station = row[12]; // M欄: station
    
    // ★ 初始化結構改變：多了一層 staffData 和 gapList
    if (!result[dateStr]) {
        result[dateStr] = { 
            staffData: {},   // 存員工排班
            gapList: []      // 存缺班字串，例如 ['B', 'B', 'C']
        };
    }

    // --- Part A: 處理員工排班 ---
    const staffSlots = [row[3], row[4], row[5], row[6]];
    staffSlots.forEach(staffId => {
      if (staffId && staffMap[staffId]) {
        const staffName = staffMap[staffId];
        if (!result[dateStr].staffData[staffName]) {
            result[dateStr].staffData[staffName] = { shifts: [], offCount: 0 };
        }
        const exists = result[dateStr].staffData[staffName].shifts.some(s => s.code === shift);
        if (!exists) {
            result[dateStr].staffData[staffName].shifts.push({ code: shift, station: station });
        }
      }
    });

    // --- Part B: ★ 新增 - 處理缺班 Gap ---
    // 只有當 Gap > 0 時才處理
    if (gap > 0) {
        // 建立唯一鍵值，防止因為多人上班導致同一班別的 Gap 被重複加總
        const uniqueKey = `${dateStr}_${shift}_${station}`;
        
        if (!processedGaps.has(uniqueKey)) {
            processedGaps.add(uniqueKey);
            
            // 根據 Gap 數量，將班別代號加入清單
            // 例如 Gap = 2, Shift = B -> 加入 'B', 'B'
            for (let k = 0; k < gap; k++) {
                result[dateStr].gapList.push(shift);
            }
        }
    }
  }

  // --- 第二次掃描：處理 OFF (配合新結構調整) ---
  for (let i = 2; i < data.length; i++) {
    const row = data[i];
    let rowRunId = row[0];
    if (rowRunId instanceof Date) rowRunId = Utilities.formatDate(rowRunId, Session.getScriptTimeZone(), "yyyy-MM");
    else rowRunId = String(rowRunId).trim();
    if (rowRunId !== runId) continue;
    
    const dateObj = new Date(row[1]);
    const dateStr = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "yyyy-MM-dd");
    const offList = row[7] ? String(row[7]).split(",") : [];

    offList.forEach(offId => {
        if (staffMap[offId]) {
            const name = staffMap[offId];
            if (!result[dateStr]) result[dateStr] = { staffData: {}, gapList: [] };
            if (!result[dateStr].staffData[name]) {
                result[dateStr].staffData[name] = { shifts: [], offCount: 0 };
            }
            result[dateStr].staffData[name].offCount++;
        }
    });
  }

  return result;
}

/**
 * 內部邏輯：寫入前台 (Rendering)
 * 手術修改：動態偵測「目前缺班」欄位並寫入，且保護下方公式
 */
function _writeToFrontendSheet(sheet, data, runId) {
  // 1. 建立 X 軸座標 (姓名 -> Column Index)
  const nameRowValues = sheet.getRange("C3:Z3").getValues()[0]; 
  const nameToCol = {}; 
  let validNameCount = 0;
  let gapColIndex = -1; // ★ 用來存「目前缺班」的相對索引

  nameRowValues.forEach((name, index) => {
    if (name) {
      const cleanName = name.toString().trim();
      nameToCol[cleanName] = index; // 相對 index
      validNameCount++;
      
      // ★ 偵測目標欄位
      if (cleanName === "目前缺班") {
          gapColIndex = index;
      }
    }
  });

  if (validNameCount === 0) throw new Error("❌ 前台第 3 列讀不到任何名字");
  if (gapColIndex === -1) console.warn("⚠️ 警告：在前台找不到「目前缺班」欄位，將不會寫入缺班資訊。");

  // 2. ★★★ 建立 Y 軸座標 (智慧偵測日期 - 保護公式) ★★★
  // 從 A5 開始往下讀，讀到非數字或空白為止
  // 這樣就不會讀到第 36 列的「開會、其他」
  const MAX_POSSIBLE_ROWS = 31; 
  const startRow = 5;
  const dateColValues = sheet.getRange(startRow, 1, MAX_POSSIBLE_ROWS, 1).getValues();
  
  let validRows = 0;
  for (let i = 0; i < dateColValues.length; i++) {
    const val = dateColValues[i][0];
    if (val !== "" && !isNaN(val)) validRows++;
    else break; 
  }
  
  if (validRows === 0) throw new Error("❌ 前台 A 欄讀不到任何有效日期");

  // 3. 準備矩陣
  const numCols = nameRowValues.length; 
  const richTextMatrix = [];

  for (let r = 0; r < validRows; r++) {
    const rowArray = [];
    const dayNum = dateColValues[r][0]; 
    const dayStr = String(dayNum).padStart(2, '0');
    const fullDateKey = `${runId}-${dayStr}`; 
    // ★ 配合新結構讀取
    const dayInfo = data[fullDateKey] || { staffData: {}, gapList: [] };

    for (let c = 0; c < numCols; c++) {
      const headerName = nameRowValues[c] ? nameRowValues[c].toString().trim() : "";
      let richValueBuilder = SpreadsheetApp.newRichTextValue();

      // Case 1: ★ 這是「目前缺班」欄位
      if (c === gapColIndex) {
          if (dayInfo.gapList && dayInfo.gapList.length > 0) {
              // 排序 (A -> B -> C) 並組合字串
              dayInfo.gapList.sort();
              const gapText = dayInfo.gapList.join(""); // 例如 "BBC"
              richValueBuilder.setText(gapText);
          } else {
              richValueBuilder.setText("");
          }
      }
      // Case 2: 這是「員工」欄位 (需讀取 staffData)
      else if (headerName && dayInfo.staffData[headerName]) {
        const staffInfo = dayInfo.staffData[headerName];

        if (staffInfo.shifts.length === 0 && staffInfo.offCount > 0) {
           richValueBuilder.setText("OFF");
        } 
        else if (staffInfo.shifts.length > 0) {
           staffInfo.shifts.sort((a, b) => a.code.localeCompare(b.code));
           const text = staffInfo.shifts.map(s => s.code).join("");
           richValueBuilder.setText(text);

           const redStyle = SpreadsheetApp.newTextStyle().setForegroundColor("red").build();
           const blackStyle = SpreadsheetApp.newTextStyle().setForegroundColor("black").build();

           let currentIndex = 0;
           staffInfo.shifts.forEach(s => {
             const len = s.code.length;
             const end = currentIndex + len;
             if (s.station === 'PEDS') richValueBuilder.setTextStyle(currentIndex, end, redStyle);
             else richValueBuilder.setTextStyle(currentIndex, end, blackStyle);
             currentIndex = end;
           });
        } else {
            richValueBuilder.setText(""); 
        }
      } 
      // Case 3: 其他空白
      else {
        richValueBuilder.setText("");
      }
      rowArray.push(richValueBuilder.build());
    }
    richTextMatrix.push(rowArray);
  }

  // 4. 寫入 (只寫入有效範圍)
  sheet.getRange(startRow, 3, validRows, numCols).setRichTextValues(richTextMatrix);
}

// --- 輔助函式 ---

/** * 轉換 RunID (2026-02) -> 民國年格式 (115.2) 
 * 同時支援 Date 物件與 String，防止 .split 錯誤
 */
function _convertRunIdToMinguo(input) {
  let dateStr = "";
  
  // 1. 自我防衛機制：如果是 Date，自己轉成字串
  if (input instanceof Date) {
    dateStr = Utilities.formatDate(input, Session.getScriptTimeZone(), "yyyy-MM");
  } else {
    dateStr = String(input).trim();
  }

  // 2. 現在 dateStr 保證是字串，split 絕對安全
  const parts = dateStr.split("-");
  
  if (parts.length < 2) throw new Error(`RunID 格式錯誤: ${dateStr}`);
  
  const year = parseInt(parts[0]);
  const month = parseInt(parts[1]);
  return `${year - 1911}.${month}`;
}

/** 取得 員工ID -> 中文姓名 的對照表 */
function _getStaffIdToNameMap() {
  const ss = getDbSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.STAFF);
  const data = sheet.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < data.length; i++) {
    const id = data[i][0];
    const name = data[i][1];
    if (id && name) map[id] = name;
  }
  return map;
}

/** 測試用 */
function testExportFrontend() {
  const runId = "2026-04"; 
  exportScheduleToFrontend(runId);
}