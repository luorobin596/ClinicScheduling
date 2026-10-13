/**
 * flows_run.gs
 */

/**
 * 2. 系統排程觸發點：每月 5 號執行
 */
function autoCreateMonthlyRun() {
  const now = new Date();
  const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const yearMonth = Utilities.formatDate(nextMonthDate, "GMT+8", "yyyy-MM");

  if (RepoCore.isRunExisted(yearMonth)) {
    console.log(yearMonth + " 的排班任務已存在，跳過建立。");
    return;
  }

  const adminEmail = getRequiredScriptProperty_('ADMIN_EMAIL');
  RepoCore.createNewRun(yearMonth);

  const subject = `【系統通知】${yearMonth} 月份排班流程已啟動`;
  const body = `
    <p>管理員您好：</p>
    <p>系統已自動建立 <b>${yearMonth}</b> 月份的排班紀錄，狀態為：<b>RUN_CREATED</b>。</p>
    <p>請前往「TEST_大墩排班表」點選選單：<br>
    <b>【排班系統管理】->【正職排班開始】</b></p>
    <p>系統將會開放前端 Portal 供正職同仁填寫意願。</p>
  `;
  
  Notify.sendEmail(adminEmail, subject, body);
}

/**
 * 3. 核心流程控制物件 (由 UI 選單或 Web App 呼叫)
 */
var CoreSystem = {
  /**
   * 執行「正職排班開始」流程
   * 狀態轉換：RUN_CREATED -> FT_WINDOW_OPEN
   */
  startFtScheduling: function() {
    // 1. 取得目前活躍的排班紀錄
    const activeRunInfo = RepoCore.getActiveRun();
    
    if (!activeRunInfo) {
      throw new Error("找不到進行中的排班任務。請先確認每月 5 號的自動建立流程是否已執行。");
    }

    const runData = activeRunInfo.data;
    const rowIndex = activeRunInfo.rowIndex;

    // 2. 檢查狀態：如果已經是 FT_WINDOW_OPEN 則回報錯誤給前台
    if (runData.status === 'FT_WINDOW_OPEN') {
      throw new Error(`狀態錯誤：${runData.run_id} 已經處於正職填寫中，不需重複啟動。`);
    }

    // 3. 確保只有在 RUN_CREATED 狀態下才能啟動
    if (runData.status !== 'RUN_CREATED') {
      throw new Error(`狀態錯誤：目前的狀態為 ${runData.status}，無法啟動正職排班。`);
    }

    // 4. 執行資料庫更新 (寫入時間戳記、更新狀態、更新 updated_at 與 last_action)
    try {
      RepoCore.updateToFtOpen(rowIndex);
      console.log(`RunID ${runData.run_id} 已成功更新為 FT_WINDOW_OPEN`);
    } catch (err) {
      throw new Error("寫入資料庫時發生錯誤：" + err.message);
    }
  },

  /**
   * [新增] 執行「截止正職填寫」流程
   * 1. 本地更新 Run_Control 狀態
   * 2. 呼叫 scheduling engine 進行排班運算
   */
  closeFtWindow: function() {
    // 1. 取得任務 & 基本檢查
    const activeRun = RepoCore.getActiveRun();
    if (!activeRun) throw new Error("找不到進行中的排班任務。");
    
    // 如果不是 OPEN 狀態就報錯，防止重複執行
    if (activeRun.data.status !== 'FT_WINDOW_OPEN') {
      throw new Error(`狀態錯誤：目前狀態為 ${activeRun.data.status}，無法執行截止。`);
    }

    // 2. 更新狀態為 CLOSED (鎖定)
    // 如果這裡資料庫寫入失敗，程式會自動報錯並停止，前端會顯示錯誤
    RepoCore.updateToFtClosed(activeRun.rowIndex);
    console.log(`RunID ${activeRun.data.run_id} 已關閉窗口`);

    // 3. 呼叫引擎運算，並接住回傳的 context
    const context = SchedulingEngine.generateSchedule(activeRun.data.run_id);

    // 4. context.runIdStr是引擎內部已經用 Utilities.formatDate 轉好的 "2026-02" 字串
    exportScheduleToFrontend(context.runIdStr);
    
    // 若執行到這裡代表全部成功
    return "✅ 執行成功！已完成排班並更新班表。";
  },

  /**
   * 驗證正職排班視窗是否開啟，並回傳當前 Run 資料
   * 給 web_entry.gs 呼叫用
   */
  validateFtWindowOpen: function() {
    const activeRun = RepoCore.getActiveRun();
    
    if (!activeRun) {
      throw new Error("系統目前沒有活躍的排班任務。");
    }
    
    if (activeRun.data.status !== 'FT_WINDOW_OPEN') {
      throw new Error("目前非正職排班開放時間，請等待管理員通知。");
    }

    return activeRun.data;
  },

  /**
   * [新增] 執行發布檢核
   * @param {string} runId - 例如 "2026-02"
   */
  publishSchedule: function(runId) {
    // 1. 取得任務資訊
    const activeRun = RepoCore.getActiveRun();
    
    // 防呆：確認目前 Active 的任務是否就是要發布的那個月份
    // (或是您允許發布歷史月份，這行可以視需求拿掉)
    if (activeRun && String(activeRun.data.run_id) !== String(runId)) {
       // 這裡僅做警告，邏輯上還是依傳入的 runId 為主去查資料庫
    }
    // 3. 通過檢查，更新資料庫
    RepoCore.updateToPublished(runId);
    
    return "SUCCESS"; // 回傳成功訊號給前台
  },
};

function debugTest() {
  CoreSystem.startFtScheduling();
}
