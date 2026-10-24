/**
 * repo_staff.gs
 * 職責：處理員工資料表的讀取與篩選
 */
var RepoStaff = {
  /**
   * 取得正職名單 (用於前端下拉選單)
   * @param {string} targetType 預設為 'FT'
   */
  getAvailableStaff: function(targetType = 'FT') {
    const ss = getDbSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.STAFF);
    if (!sheet) {
      console.error("找不到工作表：" + CONFIG.SHEET_NAMES.STAFF);
      return [];
    }

    const data = sheet.getDataRange().getValues();
    if (data.length < 3) {
      console.warn("Staff 表格中沒有足夠的資料列");
      return [];
    }

    const header = data[0]; // 第一列為標題
    
    // 1. 自動偵測欄位索引 (比對標題名稱)
    const idIdx = header.indexOf('staff_id');
    const nameIdx = header.indexOf('name');
    const typeIdx = header.indexOf('employment_type'); // 截圖顯示為 employment_type
    const statusIdx = header.indexOf('is_active');     // 截圖顯示為 is_active

    // Debug 紀錄：檢查欄位索引是否正確
    console.log("欄位索引檢查:", { idIdx, nameIdx, typeIdx, statusIdx });

    if (idIdx === -1 || nameIdx === -1 || typeIdx === -1 || statusIdx === -1) {
      console.error("Staff 表標題定義不完整，請檢查 A1:F1 的名稱");
      return [];
    }

    const result = [];
    
    // 2. 從第 3 列開始讀取 (index 2)
    for (let i = 2; i < data.length; i++) {
      const row = data[i];
      const sId = String(row[idIdx] || "").trim();
      const sName = String(row[nameIdx] || "").trim();
      const sType = String(row[typeIdx] || "").trim().toUpperCase();
      const sStatus = String(row[statusIdx] || "").trim().toUpperCase();

      // 3. 判斷條件：類型符合且狀態為 TRUE 或 ACTIVE
      if (sType === targetType && (sStatus === 'TRUE' || sStatus === 'ACTIVE')) {
        result.push({
          id: sId,
          name: sName
        });
      }
    }

    console.log(`成功抓取正職名單，共 ${result.length} 位:`, result);
    return result;
  },

  /**
   * 取得員工 ID 到 Name 的對照表 (用於日曆顯示他人名字)
   */
  getStaffMap: function() {
    const map = {};
    const staffList = this.getAvailableStaff('FT');
    staffList.forEach(item => {
      map[item.id] = item.name;
    });
    return map;
  }
};

function testGetStaff() {
  const list = RepoStaff.getAvailableStaff('FT');
  Logger.log(list);
}