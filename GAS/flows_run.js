/**
 * flows_run.gs
 */

/**
 * 2. 系統排程觸發點：每月 1 號執行
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
    <p>請前往「大墩恆新骨科班表」點選選單：<br>
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
    return withSchedulingScriptLock_(function() {
      const activeRun = RepoCore.getActiveRun();
      if (!activeRun) throw new Error("找不到進行中的排班任務。");
      const status = activeRun.data.status;
      if (status !== 'FT_WINDOW_OPEN' && status !== 'FT_WINDOW_CLOSED') {
        throw new Error(`狀態錯誤：目前狀態為 ${status}，無法執行截止或重試。`);
      }
      const runId = normalizeSchedulingRunId_(activeRun.data.run_id);
      // 只有首次截止寫入時間；截止失敗不能開始排班。
      if (status === 'FT_WINDOW_OPEN') RepoCore.updateToFtClosed(activeRun.rowIndex);
      let stage = 'SCHEDULING';
      try {
        const context = SchedulingEngine.generateSchedule(runId);
        stage = 'FRONTEND_EXPORT';
        exportScheduleToFrontend(context.runIdStr);
        // Notification failure must not roll back a successfully exported roster.
        try {
          ScheduleReport.send(context);
        } catch (mailError) {
          console.error('排班報告未寄出', JSON.stringify({runId: runId, message: mailError.message}));
          return "⚠️ 排班已完成並更新班表，但報告信未寄出，請檢查 ADMIN_EMAIL 與寄信執行紀錄。";
        }
        return "✅ 執行成功！已完成排班並更新班表。";
      } catch (error) {
        const original = schedulingErrorDetails_(error);
        const details = Object.assign({}, error.details || {}, {
          runId: runId,
          stage: (error.details && error.details.stage) || stage,
          flowStage: stage,
          partialWritePossible: stage === 'FRONTEND_EXPORT' || error.code === 'PERSISTENCE_FAILED'
        });
        try {
          // 按 runId 重新查找並核對狀態，不使用可能已變動的舊列位置。
          RepoCore.restoreFtClosed(runId, details);
          details.retryReady = true;
        } catch (recoveryError) {
          details.retryReady = false;
          details.originalError = original;
          details.recoveryError = schedulingErrorDetails_(recoveryError);
          const combined = new Error(error.message + '；狀態還原失敗：' + recoveryError.message);
          combined.code = error.code || 'PERSISTENCE_FAILED';
          combined.details = details;
          throw combined;
        }
        error.code = error.code || (stage === 'FRONTEND_EXPORT' ? 'PERSISTENCE_FAILED' : 'INTERNAL_INVALID');
        error.details = details;
        throw error;
      }
    });
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
    return withSchedulingScriptLock_(function() {
      RepoCore.updateToPublished(normalizeSchedulingRunId_(runId));
      return "SUCCESS";
    });
  },
};

function debugTest() {
  CoreSystem.startFtScheduling();
}

/** 共用提交/截止/發布互斥鎖；同一次 Library 執行期間保持鎖定。 */
function withSchedulingScriptLock_(operation) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return operation();
  } finally {
    lock.releaseLock();
  }
}

function normalizeSchedulingRunId_(runId) {
  if (runId instanceof Date) {
    return Utilities.formatDate(runId, Session.getScriptTimeZone(), 'yyyy-MM');
  }
  return runId == null ? '' : String(runId).trim();
}

function schedulingErrorDetails_(error) {
  return { message: error.message || String(error), code: error.code || null, details: error.details || null };
}
