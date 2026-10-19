/** In-memory Sheets boundary: records mutations so pre-write validation can be proven. */
function fakeSheets(initialRows=[['header'],['description']]) {
 const rows=initialRows.map(row=>row.slice());
 const operations=[];
 const sheet={
  getLastRow:()=>rows.length,
  getLastColumn:()=>Math.max(0,...rows.map(r=>r.length)),
  getDataRange(){return this.getRange(1,1,Math.max(1,rows.length),this.getLastColumn());},
  getRange(row,column,height=1,width=1){return {
   getValues:()=>Array.from({length:height},(_,r)=>Array.from({length:width},(_,c)=>rows[row+r-1]?.[column+c-1]??'')),
   setValues(values){operations.push({type:'write',row,column,values});for(let r=0;r<values.length;r++){rows[row+r-1]??=[];for(let c=0;c<values[r].length;c++)rows[row+r-1][column+c-1]=values[r][c];}return this;},
   clearContent(){operations.push({type:'clear',row,column,height,width});for(let r=0;r<height;r++)for(let c=0;c<width;c++)if(rows[row+r-1])rows[row+r-1][column+c-1]='';return this;}
  };},
  deleteRow(row){operations.push({type:'delete',row});rows.splice(row-1,1);}
 };
 return {rows,operations,sheet,spreadsheet:{getSheetByName:()=>sheet}};
}
module.exports={fakeSheets};
