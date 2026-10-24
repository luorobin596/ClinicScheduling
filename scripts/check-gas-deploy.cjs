'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

// Read-only local checks. Fetch origin first; PR approval is enforced on GitHub.
function check(root) {
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  if (git('branch', '--show-current') !== 'main') throw new Error('請切換至 main 後再部署。');
  if (git('status', '--porcelain')) throw new Error('工作目錄有未提交變更，請先完成 PR 與合併。');
  if (git('rev-parse', 'HEAD') !== git('rev-parse', 'refs/remotes/origin/main')) {
    throw new Error('本機 main 與 origin/main 不一致，請先更新。');
  }
  const configFile = path.join(root, '.clasp.json');
  if (!fs.existsSync(configFile)) throw new Error('缺少 .clasp.json，請依 docs/gas-deployment.md 設定。');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  if (typeof config.scriptId !== 'string' || !/^[\w-]+$/.test(config.scriptId) || config.scriptId === 'REPLACE_WITH_SCRIPT_ID') {
    throw new Error('請填入有效的 Script ID；實際專案與權限仍須由部署者核對。');
  }
  if (config.rootDir !== 'GAS') throw new Error('rootDir 必須為 GAS。');
  const manifest = 'GAS/appsscript.json';
  if (!fs.existsSync(path.join(root, manifest))) throw new Error('缺少 GAS/appsscript.json，請先從既有 GAS 專案取得。');
  git('ls-files', '--error-unmatch', manifest);
  const settings = JSON.parse(fs.readFileSync(path.join(root, manifest), 'utf8'));
  if (settings.runtimeVersion !== 'V8' || settings.timeZone !== 'Asia/Taipei') {
    throw new Error('manifest 須確認 runtimeVersion 為 V8、timeZone 為 Asia/Taipei，並經 PR 審核。');
  }
  return git('rev-parse', 'HEAD');
}
if (require.main === module) {
  try {
    const commit = check(path.resolve(__dirname, '..'));
    console.log(`本機部署檢查通過：${commit}\n請確認已執行 git fetch origin、測試通過且 PR 已核准合併，再手動執行 clasp push。`);
  } catch (error) {
    console.error(`部署檢查未通過：${error.message}`);
    process.exitCode = 1;
  }
}
module.exports = {check};
