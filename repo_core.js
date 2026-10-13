/**
 * repo_core.gs
 * 職責：處理 Run_Control 的讀寫
 */

const RepoCore = {
  /**
   * 建立新的排班 Run 記錄
   * 對應欄位：A:run_id, B:target_month, G:status, I:created_at, J:updated_at, K:last_action
   */
  createNewRun: function(yearMonth) {
    const ss = getDbSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.RUN_CONTROL);
    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    const now = new Date();
    // 準備新列資料 (對應截圖中的 A, B, G, I, J, K)
    // 其餘 C, D, E, F, H 留空
    const newRow = new Array(header.length).fill("");
    
    newRow[header.indexOf('run_id')] = yearMonth;       // A欄
    newRow[header.indexOf('target_month')] = yearMonth; // B欄
    newRow[header.indexOf('status')] = 'RUN_CREATED';  // G欄
    newRow[header.indexOf('created_at')] = now;        // I欄
    newRow[header.indexOf('updated_at')] = now;        // J欄
    newRow[header.indexOf('last_action')] = '時間觸發器啟動'; // K欄
    
    sheet.appendRow(newRow);
    return yearMonth;
  },

  /**
   * 檢查該月份是否已存在，避免重複建立
   */
  isRunExisted: function(yearMonth) {
    const ss = getDbSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.RUN_CONTROL);
    const data = sheet.getDataRange().getValues(); // 包含 Header
    const runIdIdx = 0; // A欄
    
    for (let i = 2; i < data.length; i++) { // 從第3列開始
      if (data[i][runIdIdx] == yearMonth) return true;
    }
    return false;
  },

  /**
   * 取得最新一筆（非 PUBLISHED）的排班紀錄
   */
  getActiveRun: function() {
    const ss = getDbSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.RUN_CONTROL);
    const data = sheet.getDataRange().getValues();
    const header = data[0];
    
    // 從最後一列往回找
    for (let i = data.length - 1; i >= 2; i--) {
      const status = data[i][header.indexOf('status')];
      if (status !== 'PUBLISHED') {
        return {
          rowIndex: i + 1,
          data: this._rowToObject(header, data[i])
        };
      }
    }
    return null;
  },

  /**
   * 更新狀態至 FT_WINDOW_OPEN
   * 更新欄位：C:ft_window_open_at, G:status, J:updated_at, K:last_action
   */
  updateToFtOpen: function(rowIndex) {
    const ss = getDbSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.RUN_CONTROL);
    const now = new Date();
    
    // 根據你的截圖與 SDD 欄位索引 (1-based)
    sheet.getRange(rowIndex, 3).setValue(now);             // C: ft_window_open_at
    sheet.getRange(rowIndex, 7).setValue('FT_WINDOW_OPEN'); // G: status
    sheet.getRange(rowIndex, 10).setValue(now);            // J: updated_at
    sheet.getRange(rowIndex, 11).setValue('管理員啟動正職排班'); // K: last_action
  },

  /**
   * 將 Run 狀態更新為 FT_WINDOW_CLOSED
   */
  updateToFtClosed: function(rowIndex) {
    const ss = getDbSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.RUN_CONTROL);
    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const now = new Date();

    // 自動尋找欄位索引 (如果找不到該欄位，不會報錯，只是不寫入)
    const setVal = (colName, val) => {
      const idx = header.indexOf(colName);
      if (idx !== -1) sheet.getRange(rowIndex, idx + 1).setValue(val);
    };

    setVal('status', 'FT_WINDOW_CLOSED');       // 更新狀態
    setVal('updated_at', now);                  // 更新最後修改時間
    setVal('ft_window_close_at', now);          // 更新關閉時間
    setVal('last_action', '截止正職填寫');        // 更新最後動作
  },

  /**
   * [新增] 將 Run 狀態更新為 PUBLISHED
   * 更新欄位：G:status, J:updated_at, K:last_action
   */
  updateToPublished: function(runId) {
    const ss = getDbSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.RUN_CONTROL);
    const data = sheet.getDataRange().getValues();
    
    let rowIndex = -1;
    
    // 從第 3 列 (Index 2) 開始掃描資料
    for (let i = 2; i < data.length; i++) {
      const cellValue = data[i][0]; // A欄 RunID
      
      // 1. 直接轉字串比對 (針對純文字格式)
      if (String(cellValue) === String(runId)) {
        rowIndex = i + 1;
        break;
      }
      
      // 2. 如果是 Date 物件，轉成 yyyy-MM 再比對 (針對日期格式)
      if (cellValue instanceof Date) {
        const dateStr = Utilities.formatDate(cellValue, Session.getScriptTimeZone(), "yyyy-MM");
        if (dateStr === String(runId)) {
          rowIndex = i + 1;
          break;
        }
      }
    }

    if (rowIndex === -1) {
      // 印出除錯資訊，方便您看看到底讀到了什麼
      console.error(`尋找 RunID: ${runId} 失敗。資料庫前幾筆資料:`, 
        data.slice(2, 5).map(r => r[0])); 
      throw new Error(`資料庫找不到 RunID: ${runId}`);
    }

    const now = new Date();
    // 更新狀態：G=7, J=10, K=11
    sheet.getRange(rowIndex, 7).setValue('PUBLISHED'); 
    sheet.getRange(rowIndex, 10).setValue(now);
    sheet.getRange(rowIndex, 11).setValue('發布班表至日曆');
  },

  _rowToObject: function(header, row) {
    let obj = {};
    header.forEach((key, index) => { if (key) obj[key] = row[index]; });
    return obj;
  }
};