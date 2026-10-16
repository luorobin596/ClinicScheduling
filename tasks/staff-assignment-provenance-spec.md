# 修改規格：逐人排班來源與不可變意願鎖定

狀態：待審閱，僅規格，尚未實作。日期：2026-10-16。

本規格是後續最低覆蓋修補與公平性調整的前置條件，關聯文件：[整體調整方案](plan.md)、[待辦](todo.md)。本次能力範圍是讓每筆員工排班具備正確來源與可移動性判斷；不在本規格內實作修補搜尋或公平性最佳化。

## 1. 目標與已確認問題

目前每個 date/shift/station 的容器只有一個 source，多位員工共用。初始化指定班寫 FT_FIXED，後續自動補班又覆寫同一個 source；輸出 J/K/L 時將該值複製至三個來源欄。

可重現案例：2026-11-03 的骨科 A 班先填 FT001 指定班，後續自動加入 FT002、FT004。FT001 本應保留 FT_FIXED，目前卻與其他人一起輸出 AUTO_A_PHASE3。

成功結果：每個員工的來源互不覆寫，輸出依員工 ID 查找來源；指定休假、指定上班、小兒固定及代班不會因來源標籤變動而變成可移動。單獨導入本修改時，原有班表人選、班數、工時、輪轉及公平性結果不得改變。

## 2. 範圍與相容性前提

- 保留 Apps Script Library 對外函式及目前 staff ID 字串陣列，不要求前台更改呼叫方式。
- 保留 Schedule_Output 的 16 欄順序；J/K/L 分別對應 D/E/F 的員工，M 仍為站別。
- 既有來源代碼保留：FT_FIXED、AUTO_COVER、AUTO_C_PHASE1、AUTO_A_AC_LOCK、AUTO_A_PHASE3、AUTO_B_BC_PATTERN、AUTO_B_AB_PATTERN、AUTO_B_FILL、AUTO_SAT_A、AUTO_SAT_B。
- FT_FIXED 原本同時用於個人指定班與小兒固定班；輸出代碼可相同，但記憶體須以 origin/lockReasons 分辨，不改現有代碼含義。
- 原始需求為骨科每班最多三人、小兒一人，因此既有三個來源欄足以涵蓋目前規則。
- G 欄有 slot4_staff_id，但沒有 source_slot4。本修改仍須在記憶體保存第四人的 metadata，不能挪用 M 欄或偷偷增加欄位。若日後需求提高至同站四人，第四人來源的 Sheet 擴充另行規劃；不得宣稱目前 Sheet 可完整顯示四人來源。
- 不修補或覆寫既有歷史班表。逐人來源正確性自新版重新產生的班表起生效，既有共用來源值不可拿來反推可靠的歷史逐人來源。

## 3. 記憶體資料結構（建議）

保留 staff/off，新增以員工 ID 為鍵的 assignmentMeta；日期、班別、站別由外層 context 決定。

```javascript
ORTHO: {
  staff: ['FT001', 'FT002'],
  off: [],
  assignmentMeta: {
    FT001: {
      source: 'FT_FIXED',
      originalSource: 'FT_FIXED',
      origin: 'STAFF_REQUEST',
      lockReasons: ['STAFF_REQUEST']
    },
    FT002: {
      source: 'AUTO_A_PHASE3',
      originalSource: 'AUTO_A_PHASE3',
      origin: 'AUTO',
      lockReasons: []
    }
  },
  note: ''
}
```

- source：目前指派的來源；後續修補/公平性階段若改動，可更新為專用代碼，並保留異動歷程。
- originalSource/origin：初次建立指派時的來源及類型，後續不能被改寫成自願或固定班。
- lockReasons：可同時包含個人指定、小兒固定或代班原因。可移動性不可只由 source 是否以 AUTO 開頭判斷，AUTO_COVER 也須鎖定。
- constraints：另在 context 保存當月 requests 正規化後的固定位置集合與禁止位置集合。固定位置以 date/shift/staff_id 表示，同一員工同時段只能一個站別；小兒位置另含 station。constraints 是原始限制的權威資料，不隨調整操作移動。
- metadata 是已排班的事實，constraints 是必須遵守的意願；兩者需一致。單獨竄改 source 或 lockReasons 不能繞過 constraints。
- off 既有陣列可暫保留供讀取，但須由相同正規化 requests 建立，避免與 constraints 不一致。
- 不同來源重複指向同一人同班時，不重複加入 staff；例如小兒已排該人且個人亦指定該班，保留一筆 PEDS 指派、原小兒來源及兩種鎖定原因，不再新增 ORTHO。

## 4. 寫入及修改行為

1. 集中使用指派新增/移除/移動/交換入口，staff 與 assignmentMeta 必須同步變動，禁止各階段直接 push 員工再改共用 source。
2. 初始化個人指定班、小兒固定班、小兒代班時立即建立對應 metadata 與鎖定；自動骨科班也逐人建立 metadata。
3. 所有自動階段都需涵蓋：C、AC 配對、剩餘 A、B 的 BC/AB/單節分支、週六 A/B。
4. 每筆已排員工恰有一份 metadata，反向不得有未排員工的殘留 metadata；同班 staff 不可重複。
5. 可移動性統一查詢 constraints、鎖定理由與站別，不依 Sheet 來源欄，也不靠共用 slot.source。
6. 後續修補的移動須刪除原位置 metadata，在新位置建立正確 metadata；保留 originalSource/origin。交換須整組成功才提交，失敗不得殘留半套變更。
7. 後續修補紀錄放在 context 調整歷程，保存操作原因、員工、原/新日期班別站別及前後來源；由試算副本驗證後一起提交。覆蓋修補與公平性調整的實際搜尋不在本次範圍。
8. 共用 slot.source 需從所有來源判斷及輸出路徑移除；不得作為 metadata 缺漏時的回退值，以免再次掩蓋錯誤。

## 5. Sheet 輸出契約

```javascript
// 示意：實作應先完成整個 context 的 metadata 一致性驗證。
const id = data.staff[0];
const sourceSlot1 = id ? data.assignmentMeta[id].source : '';
```

- D→J、E→K、F→L，均依當下位置的 staff_id 查 metadata，不能依 metadata 插入順序或複製某人的值。
- 空員工位置來源為空；員工排序改變時，來源跟著員工 ID 正確對應。
- 有員工但 metadata/source 缺漏時，錯誤需包含日期、班別、站別與員工 ID；不可默默填共用來源。
- 必須在清除舊 Schedule_Output、寫入任何資料之前完成來源一致性及輸出列檢查；驗證失敗不得先刪既有資料。
- 保留前台匯出依員工 ID/姓名的既有流程及資料欄位位置。
- 本次不新增來源第四欄、不新增永久歷程工作表。不得把「不寫 Sheet metadata」誤解成不保留記憶體中的來源或鎖定。

## 6. 來源與公平性的界線

- 個人半天休：一班指定上班、其他可營業時段休假；實際只上該班時列為自願單節。
- 個人指定 AB/BC/AC：不扣休假但兩班均鎖定，班型仍納入公平性計算。
- PEDS_FIXED/PEDS_COVER 類型：不是自願單節的依據；若實際形成單節且無本人半天休的明確意願，納入非自願單節。
- 同一班同時有 PEDS 與本人半天休鎖定時，自願與否仍由本人意願決定，不一律歸類非自願。
- 本修改提供可靠判斷資料；正式引擎單節班公平性統計的更新，與整體調整計畫第一項整合驗證，不在來源修正中暗改其他排班目標。

## 7. 驗收案例

| 編號 | 輸入/操作 | 預期結果 |
|---|---|---|
| A1 | FT001 指定 A，FT002/FT004 自動加入 | 三人來源分別正確；FT001 維持 FT_FIXED 且鎖定 |
| A2 | 同一天 A 有 AC 配對加入者與剩餘 A 補入者 | AUTO_A_AC_LOCK 與 AUTO_A_PHASE3 各自保留 |
| A3 | 同一天 B 有 BC、AB、單節來源 | 三個不同來源不互相覆寫 |
| A4 | 小兒固定與代班 | 分別為 FT_FIXED/AUTO_COVER；兩者均不可移動 |
| A5 | 小兒指派又遇到本人同班指定 | 不重複排骨科，不覆寫小兒來源，保留兩種鎖定原因 |
| A6 | staff 順序交換、空位置或移除 | 輸出依 ID 對齊，空位置空來源，無孤兒 metadata |
| A7 | metadata 缺漏或員工重複 | 儲存前報錯，既有 Sheet 資料不被清除 |
| A8 | 修改 AUTO_COVER 的 source 或清空表面鎖定 | 原始 constraints 仍阻止移動小兒班 |
| A9 | 同一段新增邏輯多次接收相同人同班 | 僅一筆指派，重複來源合併規則明確，不默默覆寫 |
| A10 | 第四位員工只存在於測試容器 | 記憶體 metadata 正確；不得把 source_slot4 寫進站別欄 |
| A11 | 半天休單節、小兒非自願單節、指定雙班 | 自願分類與鎖定分開，指定雙班仍計班型公平性 |
| A12 | 同批 100 組意願做來源修改前後比較 | 人選、日期班別站別、班數、工時及公平性統計不變，逐人來源正確 |
| A13 | 移動/交換試算失敗 | staff、metadata、constraints 與歷程均未部分變動 |

## 8. 實作順序與驗證方式（建議，未開始執行）

1. 先寫混合來源覆寫的失敗測試，再新增 metadata 與統一指派入口。
2. 依初始化、C/A、B、週六順序改接入口；每步驗證來源及既有排班結果。
3. 改輸出依 ID 取來源，加入清除舊資料前的完整驗證及假 Sheet 儲存測試。
4. 補鎖定與後續調整的契約測試；用同批 100 組測試驗證排班結果不變。
5. 回報差異與剩餘限制，再銜接最低覆蓋修補；不自動部署線上 Library。

主要檔案：scheduling_engine.js；測試放 tests/，沿用 tests/support/engine-harness.cjs、leave-model.cjs。預計新增 tests/assignment-provenance.test.cjs；必要時擴充假 Sheet 以驗證實際輸出列及不刪舊資料。

完整測試命令（實作後）：

```sh
node --test tests/assignment-provenance.test.cjs
node --test tests/*.test.cjs
git diff --check
```

本規格的來源前後 100 組比較應在記憶體執行並保留舊/新兩份 context；不可直接覆寫先前公平性報告當成比較證據。Google Apps Script 專案沒有本機建置命令，Node vm 測試不能代替線上實際驗證。

## 9. 程式風格與工作界線

沿用 SchedulingEngine 物件方法、camelCase 命名及明確字串來源代碼；既有來源字串不擅自更名，不加入新外部依賴。測試使用 Node 內建 node:test、assert 與 vm，只替換 Google 服務邊界。

- 必須：保持來源與指派一致、不可變意願獨立、驗證後才輸出、保留既有欄位與介面、先有可重現測試再修正。
- 需另行確認範圍：Sheet 欄位變更、歷史資料回填、持久化調整歷程、對外 Library 介面變更。
- 不得：以來源文字推翻原始意願、用共用值補缺失 metadata、順便改輪轉/配額/公平性權重、在本次規格工作中修改正式程式。

尚待決定：日後第四人來源是否擴充 Sheet，以及調整歷程是否需要永久保存；不阻擋目前三人骨科需求下的逐人來源修正。
