/**
 * web_entry.gs
 * 修正版：配合未修改的 HTML 格式
 */

function doGet(e) {
  const template = HtmlService.createTemplateFromFile('FT_Portal');
  
  try {
    const initData = getInitialData();
    
    // 1. 確保月份是字串 "YYYY-MM" (解決 split 錯誤)
    template.targetMonth = initData.targetMonth;
    
    // 2. 傳遞人員清單
    template.ftList = initData.staffList;
    
    // 3. 關鍵：傳遞正確的事件結構 (Map)
    template.existingEvents = JSON.stringify(initData.existingRequests);

    template.closedDates = JSON.stringify(initData.closedDates);

    return template.evaluate()
        .setTitle('正職排班意願填寫')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    return HtmlService.createHtmlOutput(`<h2 style="color:red;text-align:center;">系統錯誤：${err.message}</h2>`);
  }
}

function getInitialData() {
  // 為了安全，直接讀取 RepoCore，不透過 CoreSystem 以免觸發額外邏輯
  const activeRun = RepoCore.getActiveRun();
  if (!activeRun || activeRun.data.status !== 'FT_WINDOW_OPEN') {
    throw new Error("目前非填寫時間");
  }

  // 格式化月份為 YYYY-MM 字串
  let monthStr = activeRun.data.target_month;
  if (monthStr instanceof Date) {
    const y = monthStr.getFullYear();
    const m = String(monthStr.getMonth() + 1).padStart(2, '0');
    monthStr = `${y}-${m}`;
  }

  const staffList = RepoStaff.getAvailableStaff('FT');

  // --- ✂️ 修改開始：這裡加入 run_id 的標準化邏輯 ---
  
  // 1. 取得原始 RunID
  let runIdStandardized = activeRun.data.run_id;
  
  // 2. 如果是 Date 物件，轉成 "yyyy-MM" 字串 (跟 monthStr 邏輯一致)
  if (runIdStandardized instanceof Date) {
    // 使用 GAS 內建工具轉比較穩，或者你要用上面的手動轉法也可以
    runIdStandardized = Utilities.formatDate(runIdStandardized, Session.getScriptTimeZone(), "yyyy-MM");
  } else {
    // 如果原本就是字串，確保去空白
    runIdStandardized = String(runIdStandardized).trim();
  }

  // 3. 使用「標準化後的 runIdStandardized」來撈資料，將陣列轉為 HTML 需要的 Map
  const existingEvents = _buildExistingEvents(runIdStandardized);

  // --- 新增：取得店休日期 ---
  const dynamicConfig = RulesConfig.loadDynamicConfig();
  const closedDatesArray = dynamicConfig.closedDates || [];

  return {
    staffList: staffList,
    targetMonth: monthStr,
    existingRequests: existingEvents,
    closedDates: closedDatesArray
  };
}

/**
 * 處理提交 (完全獨立，不檢查 Email)
 */
function processFtSubmission(payload) {
  try {
    // 1. 取得 RunID (若前端沒傳，嘗試從後端讀取)
    let runId = payload.runId;
    if (!runId) {
       const activeRun = RepoCore.getActiveRun();
       runId = activeRun ? activeRun.data.run_id : null;
    }
    if (!runId) throw new Error("無法確認排班月份 (RunID Missing)");

    // 2. 直接寫入，不進行額外驗證
    RepoRequests.saveStaffRequest(runId, payload);

    return { success: true };
  } catch (e) {
    // 錯誤會被 HTML 的 withFailureHandler 捕捉
    throw new Error(e.message);
  }
}

/**
 * 私有函式：將 Repo 的扁平陣列轉換為 HTML 需要的 Map 結構
 * 結構：{ '2026-02-01': [ {text: '小羅(A)', type: 'fixed'}, ... ] }
 */
function _buildExistingEvents(runId) {
  // 從 Repo 取得扁平資料
  const flatData = RepoRequests.getAllRequestsByRun(runId);
  const eventsMap = {};

  flatData.forEach(item => {
    const dateKey = item.date; // 格式 YYYY-MM-DD
    if (!eventsMap[dateKey]) {
      eventsMap[dateKey] = [];
    }
    
    // 根據 HTML 邏輯填入 text 與 type
    // item.text 已經在 Repo 裡組裝好 (例如 "小羅" 或 "小羅(A)")
    eventsMap[dateKey].push({
      text: item.text,
      type: item.type
    });
  });

  return eventsMap;
}
