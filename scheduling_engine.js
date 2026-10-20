/**
 * scheduling_engine.gs
 * 排班核心引擎 v2.0
 * 修正日期解析錯誤 + 實作第一階段：資料初始化與輸出至 Schedule_Output
 */
var SchedulingEngine = {
  
  /**
   * 主入口：執行排班 (第一階段：初始化 + 固定診填充)
   */
  generateSchedule: function(runId, options) {
    const context = this.generateInitialSchedule(runId);
    const staff = context.staffList;
    const settings = Object.assign({}, SCHEDULE_SEARCH_OPTIONS, options || {});
    const now = settings.now || Date.now;
    settings.deadline = now() + settings.timeLimitMs;
    const initialStats = ScheduleFairness.measure(context, staff);
    ScheduleAdjustments.validate(context, staff, { requireMinimumCoverage: false });
    const repaired = ScheduleAdjustments.repair(context, staff, settings);
    const optimized = ScheduleAdjustments.improve(repaired.context, staff, settings);
    const result = optimized.context;
    result.adjustmentReport = {
      initial: initialStats, coverageRepaired: ScheduleFairness.measure(repaired.context, staff),
      fairnessAdjusted: optimized.report.after, repair: repaired.report, fairness: optimized.report
    };
    ScheduleAdjustments.validate(result, staff, { requireMinimumCoverage: true });
    this.saveToScheduleOutput(result);
    return result;
  },

  generateInitialSchedule: function(runId) {
    // 1. 初始化 Context (解析日期與營業規則)
    const context = this.createContext(runId);
    context.staffList = RepoStaff.getAvailableStaff('FT');
    
    // 2. 獲取規則與申請資料
    const pedsRules = RulesConfig.getPedsRules ? RulesConfig.getPedsRules(context.settings) : RulesConfig.RULES.PEDS_RULES.patterns;
    const ftRequests = RepoRequests.getAllRequestsByRun(context.runIdStr);
    if (ftRequests.submittedStaffIds) context.submittedStaffIds = ftRequests.submittedStaffIds.slice();

    // 3. 執行填充邏輯
    console.log("--- 階段 1: 填充固定班與小兒科 ---");
    this._fillFixedShifts(context, pedsRules, ftRequests);

    // ★ 重大變更：改為單一流程，逐人處理 C -> AC -> A
    console.log("--- 階段 2: 平日排班 (逐人: C -> AC -> A) ---");
    this._assignWeekdayShifts(context);

    console.log("--- 階段 3: 平日 B 班排班 (逐人: 填坑優先) ---");
    this._assignWeekdayBShifts(context);

    // 4-1. 統計平日產生的「非自願單節班」
    const staffList = context.staffList || RepoStaff.getAvailableStaff('FT');
    const singleShiftStats = this._auditSingleShiftFairness(context, staffList);

    // 4-2. 執行週六排班 (傳入統計數據以平衡分配)
    this._assignSaturdayShifts(context, singleShiftStats);

    // Initial roster is audited and adjusted before any output write.
    ScheduleAssignments.validateMetadata(context);

    console.log(`[Engine] 排班完成。月份: ${context.runIdStr}`);
    return context;
  },

  /**
   * 初始化排班情境 (Context)
   * @param {string|Date} runIdInput - 目標月份 (支援 Date 物件或 "2026-02" 字串)
   */
  createContext: function(runIdInput) {
    let runIdStr;
    if (Object.prototype.toString.call(runIdInput) === '[object Date]' && !isNaN(runIdInput.getTime())) {
      runIdStr = Utilities.formatDate(runIdInput, Session.getScriptTimeZone(), 'yyyy-MM');
    } else {
      const match = /^(\d{4})-(\d{1,2})$/.exec(String(runIdInput || '').trim());
      if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
        throw ScheduleAssignments.error('INPUT_CONFLICT', '無效排班月份，必須為 yyyy-MM', { runId: String(runIdInput) });
      }
      runIdStr = `${match[1]}-${match[2].padStart(2, '0')}`;
    }
    const year = Number(runIdStr.slice(0, 4));
    const month = Number(runIdStr.slice(5)) - 1;
    const dynamicSettings = RulesConfig.loadDynamicConfig();

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
    requests = ScheduleAssignments.prepare(context, requests);
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
              const substitute = pedsList.find(id => id !== originalStaff &&
                !dayReqs.some(r => r.staff_id === id && r.shift === s.shift && r.type === 'off') &&
                !day.slots[s.shift].PEDS.staff.includes(id));
              
              if (substitute) {
                ScheduleAssignments.add(day, s.shift, 'PEDS', substitute, 'AUTO_COVER', 'PEDS_COVER', ['PEDS_COVER']);
                context.constraints.peds[ScheduleAssignments.key(day.date, s.shift, substitute)] = true; // 標記為自動代班
                day.slots[s.shift].PEDS.note = `${originalStaff} OFF, PEDs由${substitute}代理`;
              } else {
                // 萬一找不到代班人 (雖然不太可能)，還是標記一下
                throw ScheduleAssignments.error('INPUT_CONFLICT', `小兒代班衝突：${day.date} ${s.shift} 班，${originalStaff} 休假且無可用代班者，請調整休假。`, { date: day.date, shift: s.shift, id: originalStaff });
              }

            } else {
              // 正常排班
              ScheduleAssignments.add(day, s.shift, 'PEDS', originalStaff, 'FT_FIXED', 'PEDS_FIXED', ['PEDS_FIXED']);
              context.constraints.peds[ScheduleAssignments.key(day.date, s.shift, originalStaff)] = true;
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
              // 固定班也須遵守骨科上限，不能繞過自動排班的人數檢查。
              const shiftConfig = day.dayOfWeek === 6 ? RulesConfig.SHIFTS.SATURDAY : RulesConfig.SHIFTS.WEEKDAY;
              const maxStaff = shiftConfig[req.shift].req_total;
              if (this._getOrthoShiftCount(day, req.shift) >= maxStaff) {
                throw ScheduleAssignments.error('INPUT_CONFLICT', `骨科固定班超額：${day.date} ${req.shift} 班上限 ${maxStaff} 人，請調整指定班。`, { date: day.date, shift: req.shift, id: req.staff_id });
              }
              ScheduleAssignments.add(day, req.shift, 'ORTHO', req.staff_id, 'FT_FIXED', 'STAFF_REQUEST', ['STAFF_REQUEST']);
            } else {
              // Preserve pediatric origin while also recording the personal fixed request.
              const meta = day.slots[req.shift].PEDS.assignmentMeta[req.staff_id];
              if (!meta.lockReasons.includes('STAFF_REQUEST')) meta.lockReasons.push('STAFF_REQUEST');
              console.log(`[修正] ${day.date} ${req.staff_id} 指定 ${req.shift} 班，但已是小兒班，跳過 ORTHO 新增。`);
            }

          } else if (req.type === 'off') {
            // 休假邏輯維持不變
            day.slots[req.shift].ORTHO.off.push(req.staff_id);
          }
        }
      });
    });
    Object.values(context.constraints).forEach(map => Object.freeze(map));
    Object.freeze(context.constraints);
  },

  
  /**
   * 依有效 FT 名單產生每週順序（weekIndex 從 0 起算）。
   * 同一起點正排、反排各一週，再輪替起點；不修改傳入名單。
   * 例：12345 → 54321 → 23451 → 15432 → 34512。
   */
  _getWeeklyStaffOrder: function(staffList, weekIndex) {
    const sortedStaff = staffList.slice().sort((a, b) => a.id.localeCompare(b.id));
    if (sortedStaff.length === 0) return [];

    const offset = Math.floor(weekIndex / 2) % sortedStaff.length;
    const order = [...sortedStaff.slice(offset), ...sortedStaff.slice(0, offset)];
    return weekIndex % 2 === 0 ? order : order.reverse();
  },

  /**
   * ★ 核心：逐人排班 (C -> AC -> A)
   */
  _assignWeekdayShifts: function(context) {
    // 1. 取得員工名單
    const staffList = context.staffList || RepoStaff.getAvailableStaff('FT');

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

      // 每兩週使用同一起點的正反序，再輪替起點。
      const rotatedStaff = this._getWeeklyStaffOrder(staffList, wIndex);

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
                if (!this._checkDailyRules(day, staffId, 'C', dailyLimits)) return false;

                // 2. ★ 新增：檢查 C 班每日人數上限
                const currentCount = this._getOrthoShiftCount(day, 'C');
                if (currentCount >= MAX_C_PER_DAY) return false;

                return true; // 通過所有檢查
            });

            // ★ 排序邏輯：優先填補空缺 (0人 > 1人 > 2人)
            cCandidates.sort((a, b) => {
                const countA = this._getOrthoShiftCount(a, 'C');
                const countB = this._getOrthoShiftCount(b, 'C');
                return countA - countB; // 小的排前面 (0, 1, 2)
            });

            // 選取前 N 個
            const assignedC = cCandidates.slice(0, neededC);
            assignedC.forEach(day => {
                ScheduleAssignments.add(day, 'C', 'ORTHO', staffId, 'AUTO_C_PHASE1');
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
                    return this._getOrthoShiftCount(day, 'A') < MAX_A_PER_DAY &&
                           this._isStaffAvailableForShift(day, staffId, 'A') &&
                           this._checkDailyRules(day, staffId, 'A', dailyLimits);
                }
                return false;
            });

            // 挑選策略：優先選 A 班人少的日子 (避免那天 A 班爆滿)
            acCandidates.sort((a, b) => {
                const countA = this._getOrthoShiftCount(a, 'A');
                const countB = this._getOrthoShiftCount(b, 'A');
                return countA - countB;
            });

            if (acCandidates.length > 0) {
                const selectedDay = acCandidates[0];
                ScheduleAssignments.add(selectedDay, 'A', 'ORTHO', staffId, 'AUTO_A_AC_LOCK');
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
                const currentCountA = this._getOrthoShiftCount(day, 'A');
                if (currentCountA >= MAX_A_PER_DAY) return false;

                return true; // 通過所有檢查
            });

            // ★ 排序邏輯：優先填補空缺 (0人 > 1人 > 2人)
            // 這一步是解決 A 班開天窗的關鍵
            aCandidates.sort((a, b) => {
                const countA = this._getOrthoShiftCount(a, 'A');
                const countB = this._getOrthoShiftCount(b, 'A');
                return countA - countB;
            });

            const assignedA = aCandidates.slice(0, neededA);
            assignedA.forEach(day => {
                ScheduleAssignments.add(day, 'A', 'ORTHO', staffId, 'AUTO_A_PHASE3');
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
    const staffList = context.staffList || RepoStaff.getAvailableStaff('FT');

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

      // 每兩週使用同一起點的正反序，再輪替起點。
      const rotatedStaff = this._getWeeklyStaffOrder(staffList, wIndex);

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
                const currentCount = this._getOrthoShiftCount(day, 'B');
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
                const countA = this._getOrthoShiftCount(a, 'B');
                const countB = this._getOrthoShiftCount(b, 'B');
                return countA - countB;
            });

            // 5. 填入
            const assignedB = candidates.slice(0, neededB);
            assignedB.forEach(day => {
                // 根據來源給予不同的標記，方便 Debug
                if (this._hasShift(day, staffId, 'C')) {
                    ScheduleAssignments.add(day, 'B', 'ORTHO', staffId, 'AUTO_B_BC_PATTERN');
                } else if (this._hasShift(day, staffId, 'A')) {
                    ScheduleAssignments.add(day, 'B', 'ORTHO', staffId, 'AUTO_B_AB_PATTERN');
                } else {
                    ScheduleAssignments.add(day, 'B', 'ORTHO', staffId, 'AUTO_B_FILL');
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
   * 輔助：取得當天骨科班別人數；小兒科不占骨科需求名額
   */
  _getOrthoShiftCount: function(day, shift) {
    if (!day.slots[shift]) return 999;
    return day.slots[shift].ORTHO.staff.length;
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
    const metrics = ScheduleFairness.measure(context, staffList);
    const singleShiftCounts = {};
    metrics.staff.forEach(person => { singleShiftCounts[person.id] = person.involuntarySingle; });

    return singleShiftCounts;
  },

  /** Compare whole-day Saturday plans using the unchanged fairness policy. */
  _assignSaturdayShifts: function(context, singleShiftCounts) {
    const result = SaturdayAllocator.allocate(context, context.staffList || RepoStaff.getAvailableStaff('FT'));
    Object.assign(context, result.context);
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
    ScheduleAssignments.validateMetadata(context);
    const ss = getDbSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.SCHEDULE_OUTPUT);
    
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
            data.staff[0] ? data.assignmentMeta[data.staff[0]].source : "", // J: Source 1
            data.staff[1] ? data.assignmentMeta[data.staff[1]].source : "", // K: Source 2
            data.staff[2] ? data.assignmentMeta[data.staff[2]].source : "", // L: Source 3
            station,                // M: Station (ORTHO/PEDS)
            "system",               // N: User
            now,                    // O: Timestamp
            data.note || ""         // P: Note
          ]);
        });
      });
    });

    if (rows.some(row => row.length !== 16)) throw ScheduleAssignments.error('INTERNAL_INVALID', '輸出列寬度錯誤');
    const lastRow = sheet.getLastRow();
    const oldRows = [];
    const oldRowNumbers = [];
    if (lastRow >= 3) {
      const prior = sheet.getRange(3, 1, lastRow - 2, 16).getValues();
      prior.forEach((row, index) => {
        const value = row[0];
        const id = Object.prototype.toString.call(value) === '[object Date]'
          ? Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM') : String(value).trim();
        if (id === context.runIdStr) { oldRows.push(row); oldRowNumbers.push(index + 3); }
      });
    }
    try {
      oldRowNumbers.slice().reverse().forEach(row => sheet.deleteRow(row));
      if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 16).setValues(rows);
    } catch (error) {
      throw ScheduleAssignments.error('PERSISTENCE_FAILED', '後台班表寫入失敗：' + error.message, {
        stage: 'BACKEND_WRITE', runId: context.runIdStr, oldRows: oldRows,
        oldRowNumbers: oldRowNumbers, attemptedRows: rows.length, partialWritePossible: true
      });
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