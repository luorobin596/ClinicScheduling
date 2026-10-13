/**
 * repo_requests.gs
 */
var RepoRequests = {
  /**
 * 保存提交的資料 (Upsert 邏輯：刪除舊的，寫入新的)
 */
  saveStaffRequest: function(runId, payload) {
    const ss = getDbSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.FT_REQUESTS);
    const staffId = String(payload.staffId);
    const targetRunId = String(runId);
    
    // 1. 改名並精簡內容，只保留有意義的紀錄
    let submissionLog = ""; 

    // --- 刪除舊資料邏輯 ---
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const data = sheet.getDataRange().getValues();
      let deleteCount = 0;

      for (let i = lastRow - 1; i >= 1; i--) {
        let rowRunId = data[i][0];
        // 處理日期格式轉換
        if (rowRunId instanceof Date) {
          rowRunId = Utilities.formatDate(rowRunId, "GMT+8", "yyyy-MM");
        }
        const rowStaffId = String(data[i][1]);

        if (String(rowRunId) === targetRunId && rowStaffId === staffId) {
          sheet.deleteRow(i + 1);
          deleteCount++;
        }
      }
      // 2. 紀錄刪除筆數（Upsert 軌跡）
      submissionLog = `Upsert: Deleted ${deleteCount} old records.`;
    } else {
      submissionLog = "First submission for this run.";
    }

    // --- 寫入新資料 ---
    const now = new Date();
    sheet.appendRow([
      targetRunId, 
      staffId,     
      now,         
      (payload.offDates || []).join(';'),   
      (payload.fixedShifts || []).join(';'), 
      "",          
      "ACTIVE",    
      submissionLog // 3. 存入 H 欄作為永久紀錄
    ]);
  },
  

  /**
   * 讀取功能：回傳扁平陣列 (修正版：強健的 RunID 比對 + 空白消除)
   */
  getAllRequestsByRun: function(runId) {
    const ss = getDbSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.FT_REQUESTS);
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return [];

    const staffMap = RepoStaff.getStaffMap();
    const result = [];
    
    // 目標 RunID (字串化)
    const targetRunId = String(runId);

    // 從第 2 列開始遍歷
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      
      // --- 修正重點 1：處理 RunID 可能是 Date 物件的情況 ---
      let rowRunId = row[0];
      if (rowRunId instanceof Date) {
        // 如果是日期，轉成 yyyy-MM 格式
        rowRunId = Utilities.formatDate(rowRunId, Session.getScriptTimeZone(), "yyyy-MM");
      }
      
      // 比對失敗則跳過
      if (String(rowRunId) !== targetRunId) continue;
      // --------------------------------------------------

      const sId = String(row[1]);
      const name = staffMap[sId] || sId;

      // 解析 D 欄: 休假
      const offStr = String(row[3] || "");
      if (offStr) {
        offStr.split(';').forEach(s => {
          // --- 修正重點 2：加上 trim() 去除隱形空白 ---
          const parts = s.split('|').map(p => p.trim()); 
          if (parts[0]) {
            result.push({
              staff_id: sId,   // 必填：員工ID
              date: parts[0],  // 日期 yyyy-MM-dd
              text: name,     
              type: 'off',
              shift: parts[1]  // 班別
            });
          }
        });
      }

      // 解析 E 欄: 指定班
      const fixedStr = String(row[4] || "");
      if (fixedStr) {
        fixedStr.split(';').forEach(s => {
          // --- 修正重點 2：加上 trim() 去除隱形空白 ---
          const parts = s.split('|').map(p => p.trim());
          if (parts.length === 2) {
            result.push({
              staff_id: sId,   // 必填：員工ID
              date: parts[0],
              text: `${name}(${parts[1]})`, 
              type: 'fixed',
              shift: parts[1]
            });
          }
        });
      }
    }
    return result;
  }
};

//debug用函式
function checkRawDataType() {
  const ss = getDbSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.FT_REQUESTS);
  
  // 讀取 FT003 那一列 (假設在第 6 列，請依實際情況調整)
  // 讀取 A 欄 (RunID) 和 D 欄 (Off Dates)
  const range = sheet.getRange("A6:D6"); 
  const values = range.getValues()[0];
  
  console.log("=== 資料型態診斷 ===");
  console.log(`A欄 (RunID) 值: ${values[0]}`);
  console.log(`A欄型態: ${typeof values[0]}`); // 關鍵：如果是 'object' 代表是 Date
  console.log(`D欄 (Off) 值: ${values[3]}`);
  
  if (values[0] instanceof Date) {
    console.warn("⚠️A欄是日期物件");
  } else {
    console.log("A欄是字串或數字。");
  }
}