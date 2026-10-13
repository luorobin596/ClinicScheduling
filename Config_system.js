/**
 * config.gs
 * 系統全域設定
 */
const CONFIG = {
  // 後端 Library 專案的指令碼屬性；使用時才讀取，避免全域初始化相依。
  get DB_SPREADSHEET_ID() {
    return getRequiredScriptProperty_('BACKEND_SHEET_ID');
  },

  get FRONTEND_SPREADSHEET_ID() {
    return getRequiredScriptProperty_('FRONTEND_SHEET_ID');
  },
  
  // 定義工作表名稱對照 (依據 SDD 資料來源 [cite: 197])
  SHEET_NAMES: {
    RUN_CONTROL: 'Run_Control',
    STAFF: 'Staff',
    FT_REQUESTS: 'FT_Requests',
    PT_AVAILABILITY: 'PT_Availability',
    SYSTEM_CONFIG: 'System_Configurations',
    //RULES: 'Rule_Definitions_v2',
    SCHEDULE_OUTPUT: 'Schedule_Output'
  }
};

function getRequiredScriptProperty_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value || !value.trim()) {
    throw new Error(`後端指令碼屬性未設定：${key}`);
  }
  return value.trim();
}

function getDbSpreadsheet() {
  return SpreadsheetApp.openById(CONFIG.DB_SPREADSHEET_ID);
}

/**
 * 系統核心設定檔：包含靜態常數（直接釘在程式碼）與動態設定（讀取試算表）
 */

var RulesConfig = {
  // ==========================================
  // 1. 靜態設定 (原本在 System_Configurations 的班別與需求)
  // ==========================================
  SHIFTS: {
    // 平日班別定義 (週一 ~ 週五)
    WEEKDAY: {
      'A': { start: '08:00', end: '12:00', hours: 4, req_ft_min: 1, req_total: 3 },
      'B': { start: '13:30', end: '17:30', hours: 4, req_ft_min: 1, req_total: 3 },
      'C': { start: '17:30', end: '21:30', hours: 4, req_ft_min: 1, req_total: 3 }
    },
    // 週六班別定義
    SATURDAY: {
      'A': { start: '08:00', end: '12:00', hours: 4, req_ft_min: 1, req_total: 3 }, // 假設週六A班也要3人
      'B': { start: '13:30', end: '17:30', hours: 4, req_ft_min: 1, req_total: 2 }  // 依照SDD，週六B班需2人
    }
  },

  // 營業規則
  OPERATING_HOURS: {
    closed_weekdays: [0], // 0 = Sunday (週日不營業)
    // 這裡可以定義更細的邏輯，例如週六沒有 C 班，這已經隱含在上面的 SATURDAY 定義中
  },

  // ==========================================
  // 2. 排班規則參數 (原本在 Rule_Definitions_v2)
  // ==========================================
  RULES: {
    // 正職每日限制
    FT_DAILY_LIMITS: {
      max_shifts: 2,           // 每日最多 2 診
      forbidden_pattern: ['A', 'B', 'C'] // 禁止一日三診
    },

    // 正職每週班型組合 (您的核心規則)
    // 1 AC, 2 BC, 2 AB
    FT_WEEKLY_PATTERN: {
      target_ac: 1,
      target_bc: 2,
      target_ab: 2,
      target_c_days: 3 // 一週要有 3 天有 C
    },

    // 小兒科 (PEDS) 特殊班別定義
    PEDS_PATTERNS_DEF: {
      'PEDS_PATTERN_1': [{ day: 1, shift: 'C' }, { day: 4, shift: 'C' }], // 週一C, 週四C
      'PEDS_PATTERN_2': [{ day: 3, shift: 'C' }, { day: 4, shift: 'B' }]  // 週三C, 週四B
    },
    
    // 公平性權重 (之後運算邏輯會用到)
    WEIGHTS: {
      c_shift_fairness: 10,
      //saturday_fairness: 8,
      preference_satisfaction: 5
    }
  },

  // ==========================================
  // 3. 動態設定載入器 (讀取 System_Configurations 前 13 列)
  // ==========================================
  loadDynamicConfig: function() {
    const ss = getDbSpreadsheet(); 
    const sheet = ss.getSheetByName("System_Configurations");
    if (!sheet) throw new Error("找不到工作表: System_Configurations"); 
    const data = sheet.getDataRange().getValues();
    
    // 預設值物件
    const dynamicSettings = {
      targetMonth: "",
      closedDates: [],
      monthlyHours: 176,
      minDaysOff: 9,
      pedsAssignments: {} // ★ 新增：用來存放 PEDS 的人員指派
    };

    // 遍歷表格 (略過標題列，讀取 Key-Value)
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const type = row[0];
      const key = row[1];
      const val = row[2];
      const enabled = row[6]; 

      if (String(enabled).toUpperCase() === "FALSE") continue;

      if (key === 'target_month') dynamicSettings.targetMonth = val; 
      if (key === 'ft_monthly_hours') dynamicSettings.monthlyHours = Number(val);
      if (key === 'ft_min_days_off') dynamicSettings.minDaysOff = Number(val);
      
      // ★ 新增：處理小兒科人員指派 (判斷 key 是否包含 peds_pattern)
      if (key && key.includes('peds_pattern_') && key.endsWith('_assignee')) {
        // 將 key 轉為大寫模式名稱，例如 peds_pattern_1_assignee -> PEDS_PATTERN_1
        const patternKey = key.replace('_assignee', '').toUpperCase();
        dynamicSettings.pedsAssignments[patternKey] = String(val).trim();
      }

      // 處理國定假日 / 特殊休假日
      if (key === 'closed_dates') {
        const rawValues = [row[2], row[3], row[4]]; 
        let allDates = [];

        rawValues.forEach(val => {
          if (!val) return; 

          if (val instanceof Date) {
            allDates.push(Utilities.formatDate(val, "GMT+8", "yyyy/MM/dd"));
          } else {
            const splitDates = String(val).split(/[，,;；\s]+/).filter(d => d.length > 0);
            splitDates.forEach(d => {
              try {
                const dateObj = new Date(d);
                if (!isNaN(dateObj.getTime())) {
                  allDates.push(Utilities.formatDate(dateObj, "GMT+8", "yyyy/MM/dd"));
                }
              } catch (e) {
                console.warn(`日期解析失敗: ${d}`);
              }
            });
          }
        });
        
        dynamicSettings.closedDates = [...new Set(allDates)];
      }
    }
    
    return dynamicSettings;
  },

  // 3. 組合函式：將「時間」與「動態載入的人員」結合
  getPedsRules: function() {
    // 改用 RulesConfig 直接指向，避免 this 抓不到的情況
    const dynamic = RulesConfig.loadDynamicConfig();
    const finalRules = {};
    
    // 檢查點：確保 PEDS_PATTERNS_DEF 不是 undefined
    const patterns = RulesConfig.RULES.PEDS_PATTERNS_DEF;
    if (!patterns) {
      console.error("找不到 PEDS_PATTERNS_DEF 定義！目前嘗試存取 RulesConfig.RULES.PEDS_PATTERNS_DEF");
      return {};
    }

    // 將「時間」與「動態載入的人員」結合
    for (const [code, shifts] of Object.entries(patterns)) {
      finalRules[code] = {
        assignee: dynamic.pedsAssignments[code] || null, 
        shifts: shifts                                  
      };
    }
    return finalRules;
  }
};

//測試用
function testPedsConfig() {
  const config = RulesConfig.loadDynamicConfig();
  
  console.log("=== 小兒科人員指派測試 ===");
  if (Object.keys(config.pedsAssignments).length === 0) {
    console.warn("警告：未偵測到任何 PEDS 人員指派！請檢查試算表設定。");
  } else {
    for (let pattern in config.pedsAssignments) {
      console.log(`模式名稱: ${pattern} -> 指派人員 ID: ${config.pedsAssignments[pattern]}`);
    }
  }
  
  // 如果您有寫 getPedsRules，也順便測試組合結果
  if (RulesConfig.getPedsRules) {
    const finalRules = RulesConfig.getPedsRules();
    console.log("=== 最終規則組合結果 ===");
    console.log(JSON.stringify(finalRules, null, 2));
  }
}
