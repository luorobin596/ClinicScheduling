/**
 * 測試專用：驗證 getActiveRun 是否能正確抓取資料
 */
function testGetActiveRun() {
  console.log("🚀 開始測試 getActiveRun()...");
  
  try {
    // 呼叫目標函式
    const result = RepoCore.getActiveRun();
    
    if (result) {
      console.log("✅ 成功找到排班任務！");
      console.log("--------------------------------------------------");
      console.log("🆔 RunID       :", result.data.run_id);
      console.log("📊 目前狀態     :", result.data.status);
      console.log("📍 資料所在列號 :", result.rowIndex);
      console.log("--------------------------------------------------");
      
      // 邏輯驗證：確保抓出來的狀態真的不是 'PUBLISHED'
      if (String(result.data.status) === 'PUBLISHED') {
        console.error("❌ 邏輯錯誤：程式應該要忽略 'PUBLISHED' 的資料，但卻抓到了。");
        console.error("   請檢查：header.indexOf('status') 是否抓到正確的欄位？");
      } else {
        console.log("🆗 驗證通過：抓到的資料狀態符合「非 PUBLISHED」的條件。");
      }
      
    } else {
      console.warn("ℹ️ 回傳值為 null");
      console.log("   這表示：資料表中可能沒有資料，或者所有的資料狀態都已經是 'PUBLISHED'。");
    }
    
  } catch (e) {
    console.error("❌ 執行時發生錯誤：", e.message);
    console.error(e.stack);
  }
}

/**
 * 專用除錯函式：追蹤 PEDS 代班的處理邏輯
 * 用來檢查小兒班和休假衝突時的處理結果
 */
function debugPedsLogic() {
  const runIdStr = "2026-02"; // ★ 請確認這是不是您測試的月份
  const targetStaff = "FT003"; // ★ 您要測試的員工 ID
  const targetDate = "2026-02-23"; // ★ 請填入您知道有衝突的那一天 (YYYY-MM-DD)
  const targetShift = "C"; // ★ 該日衝突的班別 (A, B 或 C)

  console.log(`=== 開始除錯 PEDS 邏輯 (${runIdStr}) ===`);

  // 1. 初始化 Context
  const context = SchedulingEngine.createContext(runIdStr);
  console.log(`[1] Context 建立完成，目標月份: ${context.runIdStr}`);

  // 2. 獲取規則 (PEDS Rules)
  const pedsRules = RulesConfig.getPedsRules ? RulesConfig.getPedsRules() : RulesConfig.RULES.PEDS_PATTERNS_DEF;
  console.log(`[2] PEDS 規則載入:`);
  let isTargetStaffAssigned = false;
  
  // 檢查該員工是否真的有被指派到規則中
  Object.entries(pedsRules).forEach(([key, rule]) => {
    console.log(`   - 規則 ${key}: 指派給 ${rule.assignee}`);
    if (rule.assignee === targetStaff) isTargetStaffAssigned = true;
  });
  
  if (!isTargetStaffAssigned) {
    console.warn(`⚠️ 警告: ${targetStaff} 根本沒有被指派到任何 PEDS 規則中！檢查 Config 設定。`);
  }

  // 3. 獲取申請資料 (Requests)
  const ftRequests = RepoRequests.getAllRequestsByRun(context.runIdStr);
  console.log(`[3] 讀取申請資料 (共 ${ftRequests.length} 筆)`);
  
  // 過濾出目標員工在目標日期的資料
  const specificReq = ftRequests.filter(r => 
    r.staff_id === targetStaff && 
    r.date === targetDate
  );
  
  console.log(`   - 搜尋 ${targetStaff} 在 ${targetDate} 的申請:`);
  if (specificReq.length === 0) {
    console.error(`❌ 錯誤: 找不到 ${targetStaff} 在 ${targetDate} 的任何申請紀錄！`);
    console.log(`     請檢查 Google Sheet (FT_Requests) 是否有該日期的資料？日期格式是否為文字？`);
  } else {
    specificReq.forEach(r => {
      console.log(`     Found: [${r.type}] 日期:${r.date}, 班別:${r.shift}, ID:${r.staff_id}`);
    });
  }

  // 4. 模擬衝突判定 (核心邏輯重現)
  console.log(`[4] 模擬衝突判定逻辑:`);
  
  // 重建需要的變數
  const reqMap = {};
  ftRequests.forEach(r => {
      const d = r.date instanceof Date ? Utilities.formatDate(r.date, Session.getScriptTimeZone(), "yyyy-MM-dd") : r.date;
      if (!reqMap[d]) reqMap[d] = [];
      reqMap[d].push(r);
  });
  
  const dayReqs = reqMap[targetDate];
  
  if (!dayReqs) {
    console.log(`❌ Map 轉換失敗，日期 ${targetDate} 在 reqMap 中是空的。`);
  } else {
    // 執行判定
    const isOff = dayReqs.some(r => {
      const idMatch = String(r.staff_id) === String(targetStaff);
      const shiftMatch = r.shift === targetShift; // 嚴格比對
      const typeMatch = r.type === 'off';
      
      console.log(`     比對: 資料(${r.staff_id}, ${r.shift}, ${r.type}) vs 目標(${targetStaff}, ${targetShift}, off) -> ID:${idMatch}, Shift:${shiftMatch}, Type:${typeMatch}`);
      return idMatch && shiftMatch && typeMatch;
    });

    if (isOff) {
      console.log(`✅ 判定成功: 系統認定 ${targetStaff} 在 ${targetDate} 的 ${targetShift} 班有衝突 (True)。`);
      
      // 模擬找人
      const allPedsStaff = new Set();
      Object.values(pedsRules).forEach(rule => { if (rule.assignee) allPedsStaff.add(rule.assignee); });
      const pedsList = Array.from(allPedsStaff);
      const substitute = pedsList.find(id => id !== targetStaff);
      
      console.log(`     候選代班名單: ${JSON.stringify(pedsList)}`);
      console.log(`     找到代班人: ${substitute || "無 (NULL)"}`);
      
    } else {
      console.error(`❌ 判定失敗: 系統認為沒有衝突 (isOff = false)。請檢查上方比對日誌，看是 ID、班別還是 Type 對不上。`);
    }
  }
}


/**
 * 專用除錯函式：測試是否能從FT_Requests取得員工的休假資料並回傳陣列
 */
function testGetInitialData() {
  console.log("=== 開始測試 getInitialData ===");
  
  try {
    // 直接呼叫我們剛修改好的核心函式
    const data = getInitialData();
    
    // 1. 檢查月份格式是否正確 (預期: "2026-02")
    console.log(`[檢查 1] 月份字串: ${data.targetMonth}`);
    
    // 2. 檢查是否有撈到其他人的休假資料
    const events = data.existingRequests;
    const dates = Object.keys(events);
    console.log(`[檢查 2] 撈到的資料天數: ${dates.length}`);
    
    if (dates.length > 0) {
      console.log("✅ 成功！撈到了資料。");
      // 印出第一天的資料範例，確認內容沒錯
      const sampleDate = dates[0];
      console.log(`   範例日期: ${sampleDate}`);
      console.log(`   內容: ${JSON.stringify(events[sampleDate])}`);
    } else {
      console.warn("⚠️ 警告：資料是空的 ({})。");
      console.warn("   請確認：1. 資料庫 FT_Requests 真的有該月份資料嗎？");
      console.warn("   請確認：2. Run_Control 的 RunID 是否正確？");
    }

  } catch (e) {
    console.error("❌ 測試失敗:", e.message);
    if (e.message.includes("目前非填寫時間")) {
      console.log("💡 提示：請先去 Run_Control 表單，將該月份狀態改為 'FT_WINDOW_OPEN' 才能測試。");
    }
  }
}