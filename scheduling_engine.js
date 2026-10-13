/**
 * scheduling_engine.gs
 * 排班核心引擎 v2.0
 * 修正日期解析錯誤 + 實作第一階段：資料初始化與輸出至 Schedule_Output
 */
var SchedulingEngine = {
  
  /**
   * 主入口：執行排班 (第一階段：初始化 + 固定診填充)
   */
  generateSchedule: function(runId) {
    // 1. 初始化 Context (解析日期與營業規則)
    const context = this.createContext(runId);
    
    // 2. 獲取規則與申請資料
    const pedsRules = RulesConfig.getPedsRules ? RulesConfig.getPedsRules() : RulesConfig.RULES.PEDS_RULES.patterns;
    const ftRequests = RepoRequests.getAllRequestsByRun(context.runIdStr);

    // 3. 執行填充邏輯
    console.log("--- 階段 1: 填充固定班與小兒科 ---");
    this._fillFixedShifts(context, pedsRules, ftRequests);

    // ★ 重大變更：改為單一流程，逐人處理 C -> AC -> A
    console.log("--- 階段 2: 平日排班 (逐人: C -> AC -> A) ---");
    this._assignWeekdayShifts(context);

    console.log("--- 階段 3: 平日 B 班排班 (逐人: 填坑優先) ---");
    this._assignWeekdayBShifts(context);

    // 4-1. 統計平日產生的「非自願單節班」
    const staffList = RepoStaff.getAvailableStaff('FT');
    const singleShiftStats = this._auditSingleShiftFairness(context, staffList);

    // 4-2. 執行週六排班 (傳入統計數據以平衡分配)
    this._assignSaturdayShifts(context, singleShiftStats);

    // 5. 將結果儲存至 Schedule_Output 表格
    this.saveToScheduleOutput(context);

    console.log(`[Engine] 排班完成。月份: ${context.runIdStr}`);
    return context;
  },

  /**
   * 初始化排班情境 (Context)
   * @param {string|Date} runIdInput - 目標月份 (支援 Date 物件或 "2026-02" 字串)
   */
  createContext: function(runIdInput) {
    const dynamicSettings = RulesConfig.loadDynamicConfig();
    
    // --- 修正重點 1：強健的日期解析 ---
    let year, month, runIdStr;
    
    if (runIdInput instanceof Date) {
      year = runIdInput.getFullYear();
      month = runIdInput.getMonth(); // 0-based
      // 轉成字串供後續使用 (yyyy-MM)
      runIdStr = Utilities.formatDate(runIdInput, Session.getScriptTimeZone(), "yyyy-MM");
    } else {
      // 假設是字串 "2026-02"
      runIdStr = String(runIdInput);
      const parts = runIdStr.split('-');
      year = parseInt(parts[0]);
      month = parseInt(parts[1]) - 1; // 轉為 0-based
    }

    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0); 
    
    const days = [];
    let currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      // 統一格式：yyyy-MM-dd (配合 DB 格式)
      const dateStr = Utilities.formatDate(currentDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
      // 備用格式：yyyy/MM/dd (配合 closedDates 可能的格式)
      const dateStrSlash = Utilities.formatDate(currentDate, Session.getScriptTimeZone(), "yyyy/MM/dd");
      
      const dayOfWeek = currentDate.getDay(); // 0=Sun, 1=Mon...
      
      // 檢查是否為營業日
      const isSunday = dayOfWeek === 0;
      const isHoliday = dynamicSettings.closedDates.includes(dateStr) || 
                        dynamicSettings.closedDates.includes(dateStrSlash);
      const isOpen = !isSunday && !isHoliday;

      // --- 修正重點 2：預先初始化 Slots 結構 ---
      let slots = {}; 
      // 即使是休診日，也建立空結構以免報錯，但 Open 日才會初始化陣列
      if (isOpen) {
        if (dayOfWeek === 6) { // 週六
          slots = { 'A': [], 'B': [] }; 
        } else { // 平日
          slots = { 'A': [], 'B': [], 'C': [] };
        }
      }

      days.push({
        date: dateStr,
        dayOfWeek: dayOfWeek,
        isOpen: isOpen,
        isHoliday: isHoliday,
        slots: slots // 這裡已經準備好 {A:[], B:[]...} 等著被塞入
      });

      // 往下一天
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return {
      runIdStr: runIdStr, // 回傳標準化的 ID 字串
      settings: dynamicSettings,
      days: days
    };
  },

  /**
   * 內部私有函式：填充固定診
   * 目標：將小兒科 (PEDS) 和 正職指定班 (Fixed) 填入 slots
   */
  _fillFixedShifts: function(context, pedsRules, requests) {
    // 1. 整理申請資料 Map (Key: yyyy-MM-dd)
    const reqMap = {};
    requests.forEach(r => {
      const standardizedDate = r.date instanceof Date ? 
        Utilities.formatDate(r.date, Session.getScriptTimeZone(), "yyyy-MM-dd") : 
        String(r.date).replace(/\//g, "-");
      
      if (!reqMap[standardizedDate]) reqMap[standardizedDate] = [];
      reqMap[standardizedDate].push(r);
    });

    // ★ 預先收集所有 PEDS 醫生名單 (用於找代班人)
    const allPedsStaff = new Set();
    Object.values(pedsRules).forEach(rule => {
      if (rule.assignee) allPedsStaff.add(rule.assignee);
    });
    const pedsList = Array.from(allPedsStaff); // 例如 ['FT003', 'FT004']

    context.days.forEach(day => {
      if (!day.isOpen) return;

      // 初始化容器 (新增 note 欄位)
      Object.keys(day.slots).forEach(shift => {
        day.slots[shift] = {
          ORTHO: { staff: [], off: [], source: "", note: "" },
          PEDS: { staff: [], off: [], source: "", note: "" }
        };
      });

      // 取得當日的申請資料
      const dayReqs = reqMap[day.date] || [];

      // --- 2. 處理 PEDS (含代班邏輯) ---
      for (const [code, rule] of Object.entries(pedsRules)) {
        if (!rule.assignee) continue;

        rule.shifts.forEach(s => {
          // 如果當天有這個班別 (例如週六只有 AB，這裡就不會跑 C)
          if (s.day === day.dayOfWeek && day.slots[s.shift]) {
            
            const originalStaff = rule.assignee;
            
            // 檢查原定醫生是否請假 (在 dayReqs 裡找：同 ID、同班別、type='off')
            const isOff = dayReqs.some(r => 
              r.staff_id === originalStaff && 
              r.shift === s.shift && 
              r.type === 'off'
            );

            if (isOff) {
              // ★ 觸發代班邏輯
              // 找到另一位 PEDS 醫生 (排除自己)
              const substitute = pedsList.find(id => id !== originalStaff);
              
              if (substitute) {
                day.slots[s.shift].PEDS.staff.push(substitute);
                day.slots[s.shift].PEDS.source = "AUTO_COVER"; // 標記為自動代班
                day.slots[s.shift].PEDS.note = `${originalStaff} OFF, PEDs由${substitute}代理`;
              } else {
                // 萬一找不到代班人 (雖然不太可能)，還是標記一下
                day.slots[s.shift].PEDS.source = "CONFLICT";
                day.slots[s.shift].PEDS.note = `${originalStaff} OFF, 無人代理`;
              }

            } else {
              // 正常排班
              day.slots[s.shift].PEDS.staff.push(originalStaff);
              day.slots[s.shift].PEDS.source = "FT_FIXED";
            }
          }
        });
      }

      // --- 3. 處理正職申請 (Fixed & Off for ORTHO) ---
      // 維持原邏輯，主要處理 ORTHO
      // --- 3. 再處理正職申請 (Fixed & Off for ORTHO) ---
      dayReqs.forEach(req => {
        if (day.slots[req.shift]) {
          if (req.type === 'fixed') {
            // ★ 新增判斷：檢查這個人是否已經在 PEDS 名單中了？
            const isAlreadyInPeds = day.slots[req.shift].PEDS.staff.includes(req.staff_id);

            if (!isAlreadyInPeds) {
              // 只有不在 PEDS 裡，才加到 ORTHO
              day.slots[req.shift].ORTHO.staff.push(req.staff_id);
              day.slots[req.shift].ORTHO.source = "FT_FIXED";
            } else {
              // 如果已經在 PEDS，這裡什麼都不做 (維持小兒班身分)
              console.log(`[修正] ${day.date} ${req.staff_id} 指定 ${req.shift} 班，但已是小兒班，跳過 ORTHO 新增。`);
            }

          } else if (req.type === 'off') {
            // 休假邏輯維持不變
            day.slots[req.shift].ORTHO.off.push(req.staff_id);
          }
        }
      });
    });
  },

  
  /**
   * ★ 核心：逐人排班 (C -> AC -> A)
   */
  _assignWeekdayShifts: function(context) {
    // 1. 取得員工名單
    let staffList = RepoStaff.getAvailableStaff('FT'); // 

    // ★ 修改 A：強制排序，為了讓輪替有意義，必須確保每次拿到的初始名單順序是一樣的 (例如依 ID 排序)
    staffList.sort((a, b) => {
        return a.id.localeCompare(b.id); 
    });

    const weeks = this._groupDaysByWeek(context.days);
    const dailyLimits = RulesConfig.RULES.FT_DAILY_LIMITS;

    // ★ 新增：安全讀取 C 班與 A 班設定，讀不到就報錯
    if (!RulesConfig.SHIFTS || !RulesConfig.SHIFTS.WEEKDAY || !RulesConfig.SHIFTS.WEEKDAY.C || !RulesConfig.SHIFTS.WEEKDAY.A) {
      throw new Error("❌ 嚴重錯誤：讀取不到 A 班或 C 班設定！請檢查 config.gs");
    }
    const MAX_C_PER_DAY = RulesConfig.SHIFTS.WEEKDAY.C.req_total;
    const MAX_A_PER_DAY = RulesConfig.SHIFTS.WEEKDAY.A.req_total;

    weeks.forEach((weekDays, wIndex) => {
      const targetDays = weekDays.filter(d => d.dayOfWeek >= 1 && d.dayOfWeek <= 5 && d.isOpen);
      if (targetDays.length === 0) return;

      console.log(`\n=== [Week ${wIndex + 1}] 平日排班開始 (Days: ${targetDays.length}) ===`);

      // ★ 修改 B：輪替邏輯 (Round-Robin) 取代原本的 _pickRandom
      // wIndex = 0 (第一週) -> offset = 0
      // wIndex = 1 (第二週) -> offset = 1 ... 以此類推
      const count = staffList.length;
      const offset = wIndex % count; // 取餘數，避免週數超過人數時報錯

      // 製作輪替後的名單
      // 邏輯：把陣列切成兩半 [後半段] + [前半段]
      const rotatedStaff = [
        ...staffList.slice(offset),     // 從 offset 開始到最後
        ...staffList.slice(0, offset)   // 從 0 到 offset
      ];

      // 印出當週順序 (方便您 Debug 確認是否有輪替)
      const orderStr = rotatedStaff.map(s => s.id).join(" -> ");
      console.log(`  > 本週選班優先順序: ${orderStr}`);

      // 2. 逐人執行排班 (變數名稱改用 rotatedStaff)
      rotatedStaff.forEach(staff => {
        const staffId = staff.id;
        
        // --- 步驟 0: 計算該員工本週的目標配額 (考慮休假) ---
        const targets = this._calculateTargets(staffId, targetDays);
        
        // 取得目前的統計狀態 (包含已排的固定班)
        let stats = this._getStaffWeeklyStats(staffId, targetDays);
        
        console.log(`  > 處理 ${staffId}: 可用天數=${targets.availableDays}, 目標 C=${targets.targetC}, 目標 A=${targets.targetA}`);

        // ==========================================================
        // 第一輪：補足 C 班 (Target C)
        // ==========================================================
        let neededC = targets.targetC - stats.cCount;
        if (neededC > 0) {
            // 找出可排 C 的日子
            const cCandidates = targetDays.filter(day => {
                if (this._hasShift(day, staffId, 'C')) return false; // 已有 C
                
                // 1. 基本可用性檢查
                if (!this._isStaffAvailableForShift(day, staffId, 'C')) return false;

                // 2. ★ 新增：檢查 C 班每日人數上限
                const currentCount = this._getShiftCount(day, 'C');
                if (currentCount >= MAX_C_PER_DAY) return false;

                return true; // 通過所有檢查
            });

            // ★ 排序邏輯：優先填補空缺 (0人 > 1人 > 2人)
            cCandidates.sort((a, b) => {
                const countA = this._getShiftCount(a, 'C');
                const countB = this._getShiftCount(b, 'C');
                return countA - countB; // 小的排前面 (0, 1, 2)
            });

            // 選取前 N 個
            const assignedC = cCandidates.slice(0, neededC);
            assignedC.forEach(day => {
                day.slots['C'].ORTHO.staff.push(staffId);
                day.slots['C'].ORTHO.source = "AUTO_C_PHASE1";
            });
            // 更新狀態
            stats = this._getStaffWeeklyStats(staffId, targetDays); 
        }

        // ==========================================================
        // 第二輪：鎖定 AC (Target 1 AC)
        // ==========================================================
        // 只有當目標 A >= 1 且目前還沒有 AC 時才執行
        if (targets.targetA >= 1 && !stats.hasACPattern) {
            // 從所有「已有 C 班」的日子中挑一天來排 A
            // 包含：剛排的 Auto C，以及原本的 Fixed C (Peds/Ortho)
            const acCandidates = targetDays.filter(day => {
                const hasC = this._hasShift(day, staffId, 'C');
                const hasA = this._hasShift(day, staffId, 'A');
                // 必須已經有 C，且還沒有 A
                if (hasC && !hasA) {
                    // 必須符合 A 班的排班規則 (Ortho A 沒休假)
                    return this._isStaffAvailableForShift(day, staffId, 'A') &&
                           this._checkDailyRules(day, staffId, 'A', dailyLimits);
                }
                return false;
            });

            // 挑選策略：優先選 A 班人少的日子 (避免那天 A 班爆滿)
            acCandidates.sort((a, b) => {
                const countA = this._getShiftCount(a, 'A');
                const countB = this._getShiftCount(b, 'A');
                return countA - countB;
            });

            if (acCandidates.length > 0) {
                const selectedDay = acCandidates[0];
                selectedDay.slots['A'].ORTHO.staff.push(staffId);
                selectedDay.slots['A'].ORTHO.source = "AUTO_A_AC_LOCK";
                // console.log(`    - 鎖定 AC @ ${selectedDay.date}`);
            }
            // 更新狀態
            stats = this._getStaffWeeklyStats(staffId, targetDays);
        }

        // ==========================================================
        // 第三輪：補足剩餘 A 班 (Target A)
        // ==========================================================
        let neededA = targets.targetA - stats.aCount;
        if (neededA > 0) {
            // 找出可排 A 的日子
            const aCandidates = targetDays.filter(day => {
                if (this._hasShift(day, staffId, 'A')) return false; // 已有 A
                if (this._hasShift(day, staffId, 'C')) return false; // 避開 C

                // 1. 基本規則檢查
                if (!this._isStaffAvailableForShift(day, staffId, 'A')) return false;
                if (!this._checkDailyRules(day, staffId, 'A', dailyLimits)) return false;

                // 2. ★ 新增：檢查 A 班每日人數上限
                const currentCountA = this._getShiftCount(day, 'A');
                if (currentCountA >= MAX_A_PER_DAY) return false;

                return true; // 通過所有檢查
            });

            // ★ 排序邏輯：優先填補空缺 (0人 > 1人 > 2人)
            // 這一步是解決 A 班開天窗的關鍵
            aCandidates.sort((a, b) => {
                const countA = this._getShiftCount(a, 'A');
                const countB = this._getShiftCount(b, 'A');
                return countA - countB;
            });

            const assignedA = aCandidates.slice(0, neededA);
            assignedA.forEach(day => {
                day.slots['A'].ORTHO.staff.push(staffId);
                day.slots['A'].ORTHO.source = "AUTO_A_PHASE3";
            });
        }

      }); // End of Staff Loop

      // 3. 輸出本週摘要 (Log)
      console.log(`[Week ${wIndex + 1} Summary]`);
      staffList.forEach(staff => {
        const finalStats = this._getStaffWeeklyStats(staff.id, targetDays);
        console.log(`  > ${staff.id} | C: ${finalStats.cCount} | A: ${finalStats.aCount} | AC: ${finalStats.hasACPattern ? 'Yes' : 'No'}`);
      });

    }); // End of Week Loop
  },

  /**
   * ★ 階段 3 - 平日 B 班排班 (修正版)
   * 邏輯：逐人執行，優先湊 BC，其次湊 AB，最後才填坑
   */
  _assignWeekdayBShifts: function(context) {
    // 1. 取得員工名單
    let staffList = RepoStaff.getAvailableStaff('FT'); // 

    // ★ 新增步驟 A：強制排序 (確保每週起始順序固定)
    staffList.sort((a, b) => {
        return a.id.localeCompare(b.id); 
    });

    const weeks = this._groupDaysByWeek(context.days);
    const dailyLimits = RulesConfig.RULES.FT_DAILY_LIMITS;
    
    // 安全檢查：讀取 Config
    if (!RulesConfig.SHIFTS || !RulesConfig.SHIFTS.WEEKDAY || !RulesConfig.SHIFTS.WEEKDAY.B) {
      throw new Error("❌ 嚴重錯誤：讀取不到 B 班設定！請檢查 config.gs 中的 RulesConfig.SHIFTS.WEEKDAY.B");
    }
    const MAX_B_PER_DAY = RulesConfig.SHIFTS.WEEKDAY.B.req_total;
    if (!MAX_B_PER_DAY) {
       throw new Error("❌ 設定錯誤：B 班的 req_total (總需求人數) 未設定或為 0");
    }

    weeks.forEach((weekDays, wIndex) => {
      const targetDays = weekDays.filter(d => d.dayOfWeek >= 1 && d.dayOfWeek <= 5 && d.isOpen);
      if (targetDays.length === 0) return;

      console.log(`\n=== [Week ${wIndex + 1}] B 班排班開始 (策略: 優先湊 BC > AB) ===`);

      // ★ 新增步驟 B：計算輪替順序
      const count = staffList.length;
      const offset = wIndex % count;

      // 製作輪替後的名單
      const rotatedStaff = [
        ...staffList.slice(offset),     // 後半段移到前面
        ...staffList.slice(0, offset)   // 前半段移到後面
      ];

      // 印出 Log 確認順序
      console.log(`  > 本週 B 班優先順序: ${rotatedStaff.map(s => s.id).join(" -> ")}`);

      // 2. 逐人執行排班 (使用 rotatedStaff)
      rotatedStaff.forEach(staff => {
        const staffId = staff.id;
        
        // 1. 計算目標配額
        const targetB = this._calculateBTarget(staffId, targetDays);
        
        // 2. 統計目前已有的 B 班 (固定班)
        let currentBCount = 0;
        targetDays.forEach(day => {
            if (this._hasShift(day, staffId, 'B')) currentBCount++;
        });

        let neededB = targetB - currentBCount;

        if (neededB > 0) {
            // 3. 篩選候選日
            const candidates = targetDays.filter(day => {
                // (1) 已經有 B 班 -> 跳過
                if (this._hasShift(day, staffId, 'B')) return false;
                
                // (2) B 班休假 -> 跳過
                if (!this._isStaffAvailableForShift(day, staffId, 'B')) return false;
                
                // (3) 當天 B 班人數已滿 -> 跳過
                const currentCount = this._getShiftCount(day, 'B');
                if (currentCount >= MAX_B_PER_DAY) return false;

                // (4) ★ 禁止 ABC (若已有 AC，不可排 B)
                const hasA = this._hasShift(day, staffId, 'A');
                const hasC = this._hasShift(day, staffId, 'C');
                if (hasA && hasC) return false;

                // (5) 每日上限檢查
                if (!this._checkDailyRules(day, staffId, 'B', dailyLimits)) return false;

                return true;
            });

            // ★ 4. 修改排序邏輯：優先湊合班別 (Pattern Matching)
            candidates.sort((a, b) => {
                // 檢查是否有 C 班
                const hasC_a = this._hasShift(a, staffId, 'C');
                const hasC_b = this._hasShift(b, staffId, 'C');

                // 優先權 1: 優先找有 C 的日子 (形成 BC)
                if (hasC_a !== hasC_b) {
                    return hasC_b - hasC_a; // 有 C 的排前面 (true=1, false=0)
                }

                // 檢查是否有 A 班
                const hasA_a = this._hasShift(a, staffId, 'A');
                const hasA_b = this._hasShift(b, staffId, 'A');

                // 優先權 2: 其次找有 A 的日子 (形成 AB)
                if (hasA_a !== hasA_b) {
                    return hasA_b - hasA_a; // 有 A 的排前面
                }

                // 優先權 3: 如果都沒有 Pattern，才依照原本的填坑邏輯 (0 > 1 > 2)
                const countA = this._getShiftCount(a, 'B');
                const countB = this._getShiftCount(b, 'B');
                return countA - countB;
            });

            // 5. 填入
            const assignedB = candidates.slice(0, neededB);
            assignedB.forEach(day => {
                day.slots['B'].ORTHO.staff.push(staffId);
                // 根據來源給予不同的標記，方便 Debug
                if (this._hasShift(day, staffId, 'C')) {
                    day.slots['B'].ORTHO.source = "AUTO_B_BC_PATTERN";
                } else if (this._hasShift(day, staffId, 'A')) {
                    day.slots['B'].ORTHO.source = "AUTO_B_AB_PATTERN";
                } else {
                    day.slots['B'].ORTHO.source = "AUTO_B_FILL";
                }
            });
        }
      });

      // Log 輸出
      console.log(`[Week ${wIndex + 1} B班排班結果]`);
      staffList.forEach(staff => {
        let bCount = 0;
        targetDays.forEach(d => { if (this._hasShift(d, staff.id, 'B')) bCount++; });
        console.log(`  > ${staff.id} | B班: ${bCount}`);
      });

    });
  },

  /**
   * 輔助：計算 B 班目標
   * 5天->4, 4天->3, 3天->2, 2天->1, 1天->0
   */
  _calculateBTarget: function(staffId, weekDays) {
    let availableDays = 0;
    weekDays.forEach(day => {
        // 只要 B 班沒休假，就算可用
        const bSlot = day.slots['B'];
        const isOffB = bSlot.ORTHO.off.includes(staffId) || bSlot.PEDS.off.includes(staffId);
        if (!isOffB) availableDays++;
    });

    switch (availableDays) {
        case 5: return 4;
        case 4: return 3;
        case 3: return 2;
        case 2: return 1;
        default: return 0;
    }
  },

  /**
   * 輔助：計算動態配額
   * 規則：
   * 5天: C3, A3
   * 4天: C3, A2
   * 3天: C3, A1
   * 2天: C2, A1
   * 1天: C1, A1
   */
  _calculateTargets: function(staffId, weekDays) {
    let availableDays = 0;
    
    weekDays.forEach(day => {
        // 判斷該員當天是否「可上班」
        // 定義：只要 C 班或 A 班其中一個沒請假，就算當天可上班
        // (因為固定班也算上班，所以只看 off)
        const cSlot = day.slots['C'];
        const aSlot = day.slots['A'];
        
        const isOffC = cSlot.ORTHO.off.includes(staffId) || cSlot.PEDS.off.includes(staffId);
        const isOffA = aSlot.ORTHO.off.includes(staffId) || aSlot.PEDS.off.includes(staffId);
        
        if (!isOffC || !isOffA) {
            availableDays++;
        }
    });

    let targetC = 3;
    let targetA = 3;

    switch (availableDays) {
        case 5: targetC = 3; targetA = 3; break;
        case 4: targetC = 3; targetA = 2; break;
        case 3: targetC = 3; targetA = 1; break;
        case 2: targetC = 2; targetA = 1; break;
        case 1: targetC = 1; targetA = 1; break;
        default: targetC = 0; targetA = 0; // 0天
    }

    return { availableDays, targetC, targetA };
  },

  /**
   * 輔助：取得當天某班別的人數 (包含 Ortho + Peds)
   */
  _getShiftCount: function(day, shift) {
    if (!day.slots[shift]) return 999;
    return day.slots[shift].ORTHO.staff.length + day.slots[shift].PEDS.staff.length;
  },

  /**
   * 輔助函式：判斷某人當天某班別是否「可用」
   * 用途：確保不排入休假者 (OFF) 或 已有小兒固定班者
   */
  _isStaffAvailableForShift: function(day, staffId, shift) {
    const slot = day.slots[shift];
    if (!slot) return false;

    // 1. 檢查 OFF (包含 System Config 的休假以及 Requests 的休假)
    // _fillFixedShifts 已經把所有 OFF request 填入 ORTHO.off
    const isOff = slot.ORTHO.off.includes(staffId) || slot.PEDS.off.includes(staffId);
    if (isOff) return false;

    // 2. 檢查已佔用 (ORTHO 或 PEDS)
    // 如果他已經被排了 ORTHO (例如固定班) 或 PEDS (小兒班)，當然不能再排一次
    const isOccupied = slot.ORTHO.staff.includes(staffId) || slot.PEDS.staff.includes(staffId);
    if (isOccupied) return false;

    return true;
  },

  /**
   * 輔助函式：檢查某人當天是否有某個班
   * 用途：統計用，包含 Ortho 和 Peds
   */
  _hasShift: function(day, staffId, shift) {
    if (!day.slots[shift]) return false;
    return day.slots[shift].ORTHO.staff.includes(staffId) || 
           day.slots[shift].PEDS.staff.includes(staffId);
  },

  /**
   * 輔助函式：快速取得某員工當週的統計狀態
   * 回傳：{ cCount, aCount, hasACPattern }
   */
  _getStaffWeeklyStats: function(staffId, weekDays) {
    let cCount = 0;
    let aCount = 0;
    let acCount = 0;

    weekDays.forEach(day => {
      const hasA = this._hasShift(day, staffId, 'A');
      const hasC = this._hasShift(day, staffId, 'C');

      if (hasA) aCount++;
      if (hasC) cCount++;
      if (hasA && hasC) acCount++;
    });

    return {
      cCount: cCount,
      aCount: aCount,
      hasACPattern: acCount > 0 // 只要大於 0 就代表本週已有 AC
    };
  },

  /**
   * 階段 4-1: 單節班公平性審計
   * 目的：計算每位員工的「系統分配單節班」數量，作為週六排班的權重。
   * 排除：如果當天沒上的時段是因為「休假(OFF)」，則視為自願單節，不列入計算。
   */
  _auditSingleShiftFairness: function(context, staffList) {
    console.log("\n=== 單節班公平性審計 (Fairness Audit) ===");
    
    // 初始化計數器
    const singleShiftCounts = {};
    staffList.forEach(s => singleShiftCounts[s.id] = 0);

    context.days.forEach(day => {
      // 只計算平日 (因為這是平日排完後執行的)
      if (day.dayOfWeek < 1 || day.dayOfWeek > 5 || !day.isOpen) return;

      staffList.forEach(staff => {
        const staffId = staff.id;
        
        // 檢查當日班別
        const hasA = this._hasShift(day, staffId, 'A');
        const hasB = this._hasShift(day, staffId, 'B');
        const hasC = this._hasShift(day, staffId, 'C');
        const shiftCount = (hasA ? 1 : 0) + (hasB ? 1 : 0) + (hasC ? 1 : 0);

        // ★ 核心邏輯：只抓單節班 (Count === 1)
        if (shiftCount === 1) {
          let isVoluntary = false;

          // 判斷是否為自願 (即：沒上的那兩節，是不是都休假了？)
          // 情況 1: 只有 A (檢查 B 和 C 是否休假)
          if (hasA) {
            const offB = !this._isStaffAvailableForShift(day, staffId, 'B');
            const offC = !this._isStaffAvailableForShift(day, staffId, 'C');
            if (offB && offC) isVoluntary = true;
          }
          // 情況 2: 只有 B (檢查 A 和 C 是否休假)
          else if (hasB) {
            const offA = !this._isStaffAvailableForShift(day, staffId, 'A');
            const offC = !this._isStaffAvailableForShift(day, staffId, 'C');
            if (offA && offC) isVoluntary = true;
          }
          // 情況 3: 只有 C (檢查 A 和 B 是否休假)
          else if (hasC) {
            const offA = !this._isStaffAvailableForShift(day, staffId, 'A');
            const offB = !this._isStaffAvailableForShift(day, staffId, 'B');
            if (offA && offB) isVoluntary = true;
          }

          if (!isVoluntary) {
            singleShiftCounts[staffId]++;
            // console.log(`  > ${day.date} ${staffId} 被系統分配單節班 (非自願)`);
          }
        }
      });
    });

    // 寫入 Log 並回傳統計結果
    staffList.forEach(staff => {
      const count = singleShiftCounts[staff.id];
      console.log(`  > ${staff.id} 本月非自願單節共計 ${count} 節，列入平分計算`);
    });

    return singleShiftCounts;
  },

  /**
   * 階段 4-2: 週六排班 (Saturday Shifts)
   * 邏輯：
   * 1. 計算每週六的人力供給 (Supply)。
   * 2. 排序：供給少(難排) -> 供給多(好排)。
   * 3. 優先分配 AB 班。
   * 4. 若產生單節班，優先分配給「目前單節班較少」的人。
   */
  _assignSaturdayShifts: function(context, singleShiftCounts) {
    console.log("\n=== [Weekends] 週六排班開始 ===");

    const staffList = RepoStaff.getAvailableStaff('FT');
    
    // 讀取週六設定
    if (!RulesConfig.SHIFTS || !RulesConfig.SHIFTS.SATURDAY) {
       console.warn("⚠️ 未設定週六班表規則，跳過週六排班");
       return;
    }
    const configSat = RulesConfig.SHIFTS.SATURDAY;
    // 假設週六有 A 和 B 兩診 (依照您的描述)
    const reqA = configSat.A ? configSat.A.req_total : 0;
    const reqB = configSat.B ? configSat.B.req_total : 0;

    // 1. 找出所有週六並計算供給量
    const saturdays = context.days.filter(d => d.dayOfWeek === 6 && d.isOpen).map(day => {
      // 計算當天有多少正職可上班 (沒有全天休假)
      const availableStaff = staffList.filter(staff => {
         // 簡單檢查：只要 A 或 B 其中一個能上就算供給
         return this._isStaffAvailableForShift(day, staff.id, 'A') || 
                this._isStaffAvailableForShift(day, staff.id, 'B');
      });
      return {
        dayObj: day,
        supplyCount: availableStaff.length,
        availableStaff: availableStaff
      };
    });

    // 2. 排序：供給少優先 (1 -> 2 -> 3)，供給相同則依日期
    saturdays.sort((a, b) => {
      if (a.supplyCount !== b.supplyCount) {
        return a.supplyCount - b.supplyCount;
      }
      return new Date(a.dayObj.date) - new Date(b.dayObj.date);
    });

    // 3. 開始排班
    saturdays.forEach(item => {
      const day = item.dayObj;
      let available = item.availableStaff;
      
      console.log(`\n>> 排班週六: ${day.date} (供給人數: ${item.supplyCount})`);

      // ★ 關鍵策略：依照「單節班積分」排序候選人
      // 積分越「小」的人 (單節班少)的人去上單節，讓他累積積分。
      // 所以我們把「單節班多」的人排前面(優先拿AB)，「單節班少」的人排後面(撿剩下的，容易變單節)。
      
      available.sort((p1, p2) => {
        const count1 = singleShiftCounts[p1.id] || 0;
        const count2 = singleShiftCounts[p2.id] || 0;
        // 大的排前面 -> 優先分配完整 AB
        // 小的排後面 -> 最後分配，可能只剩 A 或 B
        return count2 - count1; 
      });

      // 追蹤目前的填入狀況
      let currentA = 0;
      let currentB = 0;

      // 第一輪：盡量給每個人 AB (如果是 3 人週，前 2 人拿 AB，第 3 人拿剩下的)
      available.forEach(staff => {
        const staffId = staff.id;
        let assignedA = false;
        let assignedB = false;

        // 嘗試排 A
        if (currentA < reqA && this._isStaffAvailableForShift(day, staffId, 'A')) {
          day.slots['A'].ORTHO.staff.push(staffId);
          day.slots['A'].ORTHO.source = "AUTO_SAT_A";
          currentA++;
          assignedA = true;
        }

        // 嘗試排 B
        if (currentB < reqB && this._isStaffAvailableForShift(day, staffId, 'B')) {
          day.slots['B'].ORTHO.staff.push(staffId);
          day.slots['B'].ORTHO.source = "AUTO_SAT_B";
          currentB++;
          assignedB = true;
        }

        // 即時更新 Log 與 積分
        if (assignedA && assignedB) {
           // 完美 AB，不增加單節積分
           // console.log(`  - ${staffId}: AB (雙診)`);
        } else if (assignedA || assignedB) {
           // 產生單節班，增加積分！
           singleShiftCounts[staffId]++;
           console.log(`  - ${staffId}: ${assignedA ? 'A' : 'B'} (單節 - 積分+1) -> 目前積分: ${singleShiftCounts[staffId]}`);
        } else {
           // 沒排到 (可能是供給過剩，或者該員當天有休假)
           // console.log(`  - ${staffId}: 輪空`);
        }
      });
    });

    // 最終 Log
    console.log("\n[週六排班與單節班平衡 結果]");
    Object.keys(singleShiftCounts).forEach(id => {
        console.log(`  > ${id}: 最終單節班積分 ${singleShiftCounts[id]}`);
    });
  },

  /**
   * 輔助函式：檢查每日規則 (Max 2 & No ABC)
   * @param {Object} day - 日期物件
   * @param {string} staffId - 員工 ID
   * @param {string} newShift - 欲加入的班別 ('A', 'B', 'C')
   * @param {Object} rules - 規則設定
   */
  _checkDailyRules: function(day, staffId, newShift, rules) {
    // 1. 取得該員工當日已有的班別
    const currentShifts = [];
    ['A', 'B', 'C'].forEach(s => {
      if (day.slots[s] && 
         (day.slots[s].ORTHO.staff.includes(staffId) || day.slots[s].PEDS.staff.includes(staffId))) {
        currentShifts.push(s);
      }
    });

    // 2. 檢查總診數
    // 如果加入新班別，總數是否超過 max_shifts (2)
    if (currentShifts.length + 1 > rules.max_shifts) return false;

    // 3. 檢查 ABC 禁止組合
    // 暫時模擬加入新班別後的狀態
    const tempShifts = [...currentShifts, newShift];
    const hasA = tempShifts.includes('A');
    const hasB = tempShifts.includes('B');
    const hasC = tempShifts.includes('C');

    if (hasA && hasB && hasC) return false; // 禁止 ABC 同時存在

    return true;
  },

  /**
   * 輔助函式：將單月天數陣列依「週」分組
   * 邏輯：依據週日 (dayOfWeek === 0) 作為新的一週開始
   */
  _groupDaysByWeek: function(days) {
    const weeks = [];
    let currentWeek = [];
    
    days.forEach(day => {
      // 如果遇到週日且 currentWeek 不為空，結算上一週
      // (視需求而定，若每月1號是週三，第一週就是週三~週六)
      if (day.dayOfWeek === 0 && currentWeek.length > 0) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
      currentWeek.push(day);
    });
    // 補上最後一週
    if (currentWeek.length > 0) weeks.push(currentWeek);
    
    return weeks;
  },

  /**
   * 輔助函式：從陣列中隨機取出 n 個元素
   */
  _pickRandom: function(arr, n) {
    if (n >= arr.length) return arr; // 若需求大於樣本，全回傳
    // 簡單洗牌演算法
    const shuffled = [...arr].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, n);
  },

  /**
   * 將排班結果寫入 Google Sheet (前台顯示用)
   * 更新：修正缺額計算邏輯 (Ortho 讀取 Config, Peds 固定為 1)
   */
  saveToScheduleOutput: function(context) {
    const ss = getDbSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.SCHEDULE_OUTPUT);
    
    // 1. 清除舊資料
    const lastRow = sheet.getLastRow();
    if (lastRow >= 3) {
      const runIdValues = sheet.getRange(3, 1, lastRow - 2, 1).getValues();
      for (let i = runIdValues.length - 1; i >= 0; i--) {
        if (runIdValues[i][0] === context.runIdStr) {
          sheet.deleteRow(i + 3);
        }
      }
    }

    // 2. 準備寫入的資料列
    const rows = [];
    const now = new Date();

    context.days.forEach(day => {
      if (!day.isOpen) return; 

      // 遍歷該日的每個時段 (A, B, C)
      Object.entries(day.slots).forEach(([shift, stations]) => {
        
        // --- ★ 修正重點 1: 分別計算目前人數 ---
        const countOrtho = stations['ORTHO'].staff.length;
        const countPeds = stations['PEDS'].staff.length;

        // --- ★ 修正重點 2: 分別計算目標人數 (Target) ---
        
        // (A) 計算 骨科(ORTHO) 目標
        let targetOrtho = 0;
        // 讀取 Config
        const configSource = (day.dayOfWeek === 6) ? RulesConfig.SHIFTS.SATURDAY : RulesConfig.SHIFTS.WEEKDAY;
        if (configSource && configSource[shift]) {
            targetOrtho = configSource[shift].req_total || 0;
        }

        // (B) 計算 小兒(PEDS) 目標
        // 依照您的指示，小兒班固定目標為 1 人
        const targetPeds = 1;

        // --- ★ 修正重點 3: 分別計算缺額 (Gap) ---
        const gapOrtho = targetOrtho - countOrtho;
        const gapPeds = targetPeds - countPeds;

        // --- 寫入資料 ---
        ['ORTHO', 'PEDS'].forEach(station => {
          const data = stations[station];

          // 決定要用哪一個 Gap 數值
          let currentGap = 0;
          if (station === 'ORTHO') {
              currentGap = gapOrtho;
          } else {
              currentGap = gapPeds;
          }

          // 如果是 PEDS 且沒人 (Count=0)，通常不會產生資料列
          // 但如果您希望看到 "PEDS Gap: 1" 的紀錄，可以把下面這行註解掉
          // 目前維持原樣：沒人就不寫入該行 (避免資料庫太亂)
          if (station === 'PEDS' && data.staff.length === 0) return;

          rows.push([
            context.runIdStr,       // A: RunID
            day.date,               // B: 日期
            shift,                  // C: 班別 (A/B/C)
            data.staff[0] || "",    // D: 員工1
            data.staff[1] || "",    // E: 員工2
            data.staff[2] || "",    // F: 員工3
            data.staff[3] || "",    // G: 員工4
            data.off.join(","),     // H: 休假名單
            currentGap,                    // ★ I: current_gap (計算出的缺額) ★
            data.staff[0] ? data.source : "", // J: Source 1
            data.staff[1] ? data.source : "", // K: Source 2
            data.staff[2] ? data.source : "", // L: Source 3
            station,                // M: Station (ORTHO/PEDS)
            "system",               // N: User
            now,                    // O: Timestamp
            data.note || ""         // P: Note
          ]);
        });
      });
    });

    // 3. 批次寫入
    if (rows.length > 0) {
      const finalLastRow = sheet.getLastRow();
      sheet.getRange(finalLastRow + 1, 1, rows.length, 16).setValues(rows);
    }
  },

  /**
   * 測試用：印出地圖結構
   */
  testMap: function(runId) {
    // 這裡直接呼叫 generateSchedule 來測試完整的第一階段
    const context = this.generateSchedule(runId);
    
    console.log("RunID Str:", context.runIdStr);
    
    // 找一天有資料的來檢查 (例如週一或週三，且有小兒科排班的日子)
    const sampleDay = context.days.find(d => d.isOpen && d.dayOfWeek === 1); // 找一個週一
    if (sampleDay) {
      console.log(`[抽查 ${sampleDay.date} (週一)] 班表狀況:`, JSON.stringify(sampleDay.slots));
    }
    
    const sampleDay2 = context.days.find(d => d.isOpen && d.dayOfWeek === 3); // 找一個週三
    if (sampleDay2) {
      console.log(`[抽查 ${sampleDay2.date} (週三)] 班表狀況:`, JSON.stringify(sampleDay2.slots));
    }
  }
};

/**
 * 測試入口
 */
function testNewEngine() { 
  const activeRun = RepoCore.getActiveRun();
  if (!activeRun) {
    console.log("沒有啟動中的月份，使用預設測試字串");
    SchedulingEngine.testMap("2026-04");
  } else {
    // 這裡傳入 activeRun.data.run_id (可能是 Date 物件)，現在不會報錯了
    SchedulingEngine.testMap(activeRun.data.run_id);
  }
}